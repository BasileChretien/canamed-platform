/* scripts/lib/erasure.js
 *
 * Works out WHAT to erase for one participant. Pure: no Firebase, no I/O, no
 * clock. Callers apply the plan — `scripts/erase-participant.js` against the
 * live database, `scripts/lib/suppression.js` against an archived snapshot.
 *
 * THAT SHARING IS THE POINT. Annex VI G12 asks for erasure that reaches the
 * nightly archive as well as the live tree. If the archive were stripped by its
 * own separate code, the two would drift and the archive would quietly become
 * the copy that still holds the participant. One planner, two consumers, so
 * "the archive is treated like the live tree" is structurally true rather than
 * promised in a comment.
 *
 * IDENTITY. A participant appears under three different keys:
 *   - clientId  a per-browser id; ONE PERSON CAN HAVE SEVERAL in a session
 *   - uid       the Firebase auth uid
 *   - stableId  the cross-session research identifier
 * `sessions/$id/clientMapping/$clientId -> uid` and
 * `sessions/$id/stableIdMapping/$stableId -> uid` are the joins, so from any
 * one of the three the rest are derivable WITHIN a session. They are resolved
 * per session, never carried between sessions: clientIds are not global.
 *
 * WHAT IT DELIBERATELY WILL NOT DO. Some content records its author as a
 * display NAME (`by`) with no id beside it. This planner never matches on a
 * name: two students called "Sato Yuki" in one cohort is not a rare event, and
 * deleting a namesake's work in the name of erasure would be a worse defect
 * than the one being fixed. Name-only matches are reported as AMBIGUOUS for a
 * human to decide. Likewise `roomChat` turns carry no author at all (rules:
 * role/content/at), so a participant's chat cannot be separated from their
 * roommates'; that is reported as UNERASABLE rather than silently skipped.
 */

"use strict";

/* Session-level nodes keyed directly by one of the three identifiers. */
const BY_CLIENT_ID = ["pool", "poll", "clientMapping"];
const BY_UID = ["members", "roomOf"];
const BY_STABLE_ID = ["stableIdMapping"];

/* Room-level nodes keyed by clientId. `tests` and `survey` use $cid in the
   rules; the rest use $clientId. Same identifier, two spellings. */
const ROOM_BY_CLIENT_ID = [
  "presence", "typing", "observers", "roleChoices", "tests", "survey",
];
const ROOM_BY_UID = ["uidMembers"];

/* Room-level collections of authored entries that carry `cid`. */
const ROOM_AUTHORED = [
  "moduleA/hypotheses",
  "answers/moduleA",
  "answers/moduleB",
  "answers/moduleBranched",
  "answerReplies",
  "events",
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function child(node, path) {
  let cur = node;
  for (const seg of path.split("/")) {
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Resolve every identifier the participant holds IN THIS SESSION.
 *
 * @param {object} session one session subtree
 * @param {object} seed at least one of {uid, clientId, stableId}
 * @returns {{uid: string|null, clientIds: string[], stableIds: string[]}}
 */
function resolveIdentity(session, seed) {
  const s = isObj(session) ? session : {};
  const clientMapping = isObj(s.clientMapping) ? s.clientMapping : {};
  const stableMapping = isObj(s.stableIdMapping) ? s.stableIdMapping : {};

  let uid = seed.uid || null;
  if (!uid && seed.clientId) uid = clientMapping[seed.clientId] || null;
  if (!uid && seed.stableId) uid = stableMapping[seed.stableId] || null;

  const clientIds = new Set();
  const stableIds = new Set();

  /* A seeded clientId belongs to the participant even when no mapping row
     exists yet — the join chain writes `pool` before `clientMapping`, so a
     participant who dropped out mid-join has the former and not the latter.
     Erasing only what is mapped would leave exactly those rows behind. */
  if (seed.clientId && (s.pool && seed.clientId in s.pool ||
                        seed.clientId in clientMapping)) {
    clientIds.add(seed.clientId);
  }
  if (seed.stableId && seed.stableId in stableMapping) {
    stableIds.add(seed.stableId);
  }

  if (uid) {
    for (const cid of Object.keys(clientMapping)) {
      if (clientMapping[cid] === uid) clientIds.add(cid);
    }
    for (const sid of Object.keys(stableMapping)) {
      if (stableMapping[sid] === uid) stableIds.add(sid);
    }
  }

  return {
    uid,
    clientIds: [...clientIds].sort(),
    stableIds: [...stableIds].sort(),
  };
}

/**
 * Build the erasure plan for one session subtree.
 *
 * @param {object} session the session subtree
 * @param {object} identity from resolveIdentity()
 * @returns {{deletes: string[], ambiguous: object[]}}
 *   `deletes` are paths RELATIVE to the session root, deepest-last is not
 *   guaranteed — callers must not assume ordering.
 */
function planSessionErasure(session, identity) {
  const s = isObj(session) ? session : {};
  const cids = new Set(identity.clientIds || []);
  const sids = new Set(identity.stableIds || []);
  const uid = identity.uid || null;

  const deletes = [];
  const ambiguous = [];

  const has = (node, key) => isObj(node) && Object.prototype.hasOwnProperty.call(node, key);

  for (const node of BY_CLIENT_ID) {
    for (const cid of cids) if (has(s[node], cid)) deletes.push(`${node}/${cid}`);
  }
  for (const node of BY_UID) {
    if (uid && has(s[node], uid)) deletes.push(`${node}/${uid}`);
  }
  for (const node of BY_STABLE_ID) {
    for (const sid of sids) if (has(s[node], sid)) deletes.push(`${node}/${sid}`);
  }

  /* The participant's display name, used only to RECOGNISE ambiguous entries —
     never to delete one. */
  const names = new Set();
  for (const cid of cids) {
    const entry = child(s, `pool/${cid}`);
    if (isObj(entry) && typeof entry.name === "string") names.add(entry.name);
  }

  const rooms = isObj(s.rooms) ? s.rooms : {};
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    if (!isObj(room)) continue;
    const base = `rooms/${roomId}`;

    for (const node of ROOM_BY_CLIENT_ID) {
      for (const cid of cids) if (has(room[node], cid)) deletes.push(`${base}/${node}/${cid}`);
    }
    for (const node of ROOM_BY_UID) {
      if (uid && has(room[node], uid)) deletes.push(`${base}/${node}/${uid}`);
    }

    /* votes/$voteId/ballots/$clientId */
    const votes = isObj(room.votes) ? room.votes : {};
    for (const voteId of Object.keys(votes)) {
      const ballots = child(votes[voteId], "ballots");
      for (const cid of cids) {
        if (has(ballots, cid)) deletes.push(`${base}/votes/${voteId}/ballots/${cid}`);
      }
    }

    for (const coll of ROOM_AUTHORED) {
      const entries = child(room, coll);
      if (!isObj(entries)) continue;
      for (const entryId of Object.keys(entries)) {
        const e = entries[entryId];
        if (!isObj(e)) continue;
        const path = `${base}/${coll}/${entryId}`;
        if (typeof e.cid === "string" && cids.has(e.cid)) {
          deletes.push(path);
        } else if (typeof e.by === "string" && names.has(e.by) &&
                   typeof e.cid !== "string") {
          /* Authored by someone with this display name, with no id to confirm
             it. Never deleted automatically — see the header. */
          ambiguous.push({
            path,
            reason: "attributed by display name only; no cid to confirm identity",
            by: e.by,
          });
        }
      }
    }
  }

  /* NB there is no `unerasable` field here on purpose. The one thing that
     genuinely cannot be erased per participant — `roomChat`, whose turns carry
     no author — lives OUTSIDE the session subtree, so this function never sees
     it and could only ever return an empty list. An always-empty `unerasable`
     would read as "nothing is unerasable", which is the opposite of true.
     `scripts/erase-participant.js` reports it, at the level that can see it. */
  return {
    deletes: deletes.sort(),
    ambiguous,
  };
}

/**
 * Apply a plan to a plain object (an archived session subtree). Returns a NEW
 * object; the input is not mutated, so a caller cannot half-erase a snapshot
 * and then fail.
 */
function applyPlan(session, plan) {
  const out = JSON.parse(JSON.stringify(session === undefined ? null : session));
  for (const p of plan.deletes || []) {
    const segs = p.split("/");
    const last = segs.pop();
    let cur = out;
    let ok = true;
    for (const seg of segs) {
      if (!isObj(cur) || !(seg in cur)) { ok = false; break; }
      cur = cur[seg];
    }
    if (ok && isObj(cur)) delete cur[last];
  }
  return out;
}

module.exports = {
  resolveIdentity,
  planSessionErasure,
  applyPlan,
  /* exported for tests and for the runner's reporting */
  BY_CLIENT_ID,
  BY_UID,
  BY_STABLE_ID,
  ROOM_BY_CLIENT_ID,
  ROOM_BY_UID,
  ROOM_AUTHORED,
};
