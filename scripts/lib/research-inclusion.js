"use strict";
/* scripts/lib/research-inclusion.js
 *
 * WHO the research export keeps (transform version 3). Pure, no I/O.
 * scripts/lib/pseudonymise.js calls selectIncluded() first, then scrubs names
 * and identifiers out of what is left.
 *
 * THE PRINCIPLE. A record attributable to a person is kept only when it can be
 * shown to belong to an INCLUDED participant: one whose pool row records
 * research consent (`consent.research === true`), is bound to an account by a
 * `clientMapping` row, and has not withdrawn. Whatever cannot be shown is
 * removed, and counted, by reason, in `stats` for the job's log.
 *
 * Before version 3 the export removed only what was KEYED by a declining
 * participant. What they wrote into a room's shared lists went out with the
 * name redacted and their clientId beside it; rows under an identity with no
 * pool row went out as written; and one invented row recording consent made a
 * session exportable on its own.
 *
 * HOW A RECORD NAMES ITS AUTHOR — read from the client (script.js and the lazy
 * chunks) and from database.rules.json, both trees, on 2026-10-14. Four ways:
 *
 *   1. By the KEY of its container: a clientId (pool, poll, presence, typing,
 *      observers, roleChoices, tests, survey, the assignments of a roleAssign),
 *      an account uid (members, rekeyed in pseudonymise.js) or a ballot key
 *      (a stableId, or a clientId before the stableId existed). A child is
 *      kept only under an included participant's identifier, and only in
 *      that container: an identifier is never removed "wherever it appears",
 *      because a clientId is chosen by whoever writes the row, and a row keyed
 *      `rooms` would take the whole rooms tree with it.
 *   2. By a `cid` field: answers (every module and section), deleted answers,
 *      hypotheses (Module A and per section), replies. Kept only when the cid
 *      is an included participant's — and when no `by` in the record (its
 *      own, or an edit's) names somebody no included participant is called.
 *      The stock client lets only an entry's author edit or delete it
 *      (renderAnswers: `entry.cid === clientId`), so the cid speaks for every
 *      text in it; the rules do not enforce that, and a `by` naming an
 *      outsider is the one trace another hand leaves.
 *   3. By a CLIENTID in `by`: roleAssign (assignRolesRandomly() writes
 *      `by: clientId`). Kept only when that clientId is an included one.
 *   4. By a display NAME in `by` and nothing else: room events (and the `by`
 *      inside their payload), reveals, triage choices, the call for help.
 *      Kept only when every name in the record is held by an included
 *      participant AND by nobody else the session records — the pool rows not
 *      included that a `clientMapping` row binds to an account, and the
 *      facilitator's name as the admin-only records give it.
 *      Exception: the name-only records (events, reveals, triage choices,
 *      calls for help) of a participant who is not included and is bound to
 *      no account are kept as an included namesake's, if one exists — the
 *      price of not letting an unbound row, which anyone holding the session
 *      code can write, remove an included participant's records.
 *
 * DECISIONS, EACH WITH ITS COST.
 *   - Name-only attribution fails closed. Display names are not unique: when
 *     an included participant shares hers with somebody bound to an account
 *     who is not included, her events, reveals and triage choices go too
 *     (stats.nameShared). THAT IS A LEVER, not only a coincidence: any
 *     signed-in visitor holding the code who binds a pool row of their own
 *     under her display name removes her name-only records from the export.
 *     Unbound rows do not count (anyone can write one, so counting them made
 *     the lever free); the price is the exception stated under 4 above — a
 *     participant who is not included and is bound to no account (e.g. a
 *     decliner whose clientMapping claim failed) keeps their
 *     name-only records in the export under an included namesake's pseudonym
 *     (pinned by tests/pseudonymise-consent-scope.test.js). Which of the two
 *     prices to pay is the controller's (DPA Annex VI G1 (a)). Two included participants sharing
 *     a name are both kept, and both become the first one's pseudonym — a
 *     misattribution between two people who both consented.
 *   - The gate counts only a row bound to an account. Every stock client
 *     claims `clientMapping/<cid>` before it writes its row
 *     (_joinParticipantAfterAuth), so a participant whose claim failed loses
 *     everything (stats.participantsUnbound). What this does NOT stop: a
 *     visitor who claims a mapping too is, to the database, a participant.
 *   - Facilitator records stay: `audit`, `score/manual`, `created`, `closed`
 *     and the session's configuration are writable by the facilitator alone
 *     (creator-or-proof in the rules; `created` by its first writer, who is
 *     the facilitator by definition), with the name redacted. Whether they
 *     belong in research data at all — the facilitator ticks no research
 *     consent — is for the controller (DPA Annex VI G1). A facilitator's
 *     entries in a SHARED list (an event, a reply, a reveal) go: anyone with
 *     a room claim can write one under any name.
 *   - Room-level state with no author and no text stays: stage, stage times,
 *     scores, awarded points, a committed vote. A reveal is not such state —
 *     it records who revealed the item — so the room's set of revealed items
 *     loses the ones revealed by somebody not included. `teamName` goes: it is
 *     free text, typed by somebody in the room, and nothing records whom.
 *   - Ballots keep the two properties pseudonymise.js gave them: a stableId
 *     is removed under `ballots` only, and a non-included row's own
 *     `stableId` is believed unconditionally (its cost — a declining row that
 *     names another's stableId removes that participant's ballots — is pinned
 *     by tests/pseudonymise.test.js). On top of that a ballot is now kept only
 *     under a key shown to be an included participant's.
 *
 * WHAT THIS CANNOT SHOW. A record is the writer's word: the rules bind no
 * `cid`, no `by` and no payload to the account that writes it, so a
 * participant who writes in an included participant's name or clientId is not
 * detected. A position the rules no longer declare, and which no list below
 * names, passes through (the per-prompt reply lists of sessions created before
 * 2026-07-24 are listed). tests/pseudonymise-consent-coverage.test.js derives
 * from the rules every container keyed by a participant identity and every
 * record that carries `by` or `cid`, and runs this on each.
 */

/* A RECORD is a plain object. A CONTAINER may also be an array, and every
   filter below must treat one exactly like an object keyed by its indices:
   the job reads with the Admin SDK's `.val()`, which returns a node whose keys
   are small integers as an array. Section slots are integer-keyed by rule
   (`$slot` is /^[1-9]$/), so `rooms/<r>/sections` and `answers/sections`
   come back as arrays in every multi-section session; the legacy reply lists
   are indexed from 0; and anyone may write `poll/0`, `poll/1`, … The first
   version of this filter descended into plain objects only, and judged
   nothing under those (found in review; tests/fixtures/rtdb-shape.js).
   Object.keys() of an array gives its indices and skips holes; `delete`
   leaves a hole, which JSON writes as null — the database's "absent". */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isMap = (v) => v !== null && typeof v === "object";
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// The longest `payload` a client writes (logEvent cuts there); pseudonymise.js
// removes a longer one. Only used here to read the author out of one.
const PAYLOAD_MAX_CHARS = 500;

/* Containers keyed by a clientId. Paths relative to a ROOM; the two at the
   session root are handled separately. The last two are legacy: their rules
   were removed on 2026-07-24 (#244), keyed `$promptIdx/$cid`. */
const ROOM_KEYED_BY_CLIENT_ID = ["presence", "typing", "observers", "roleChoices", "tests", "survey"];
const ROOM_KEYED_BY_CLIENT_ID_UNDER_INDEX = ["moduleA/promptReplies", "moduleB/exchangeReplies"];
const ROOT_KEYED_BY_CLIENT_ID = ["poll"];

/* Collections of records that carry a `cid`, relative to a room. A `*` is a
   level of ids that is not an author (a slot, the answer a reply is on). */
const ROOM_RECORDS_BY_CID = [
  "answers/moduleA/*", "answers/moduleB/*", "answers/moduleBranched/*", "answers/sections/*/*",
  "answersDeleted/*", "moduleA/hypotheses/*", "sections/*/hypotheses/*", "answerReplies/*/*"
];
/* Single records whose `by` is a clientId. */
const ROOM_RECORDS_BY_CLIENT_ID_IN_BY = ["moduleB/roleAssign", "sections/*/roleAssign"];
/* Records whose author is a display name and nothing else. */
const ROOM_RECORDS_BY_NAME = [
  "events/*", "moduleA/revealed/*", "sections/*/revealed/*", "sections/*/triage/*", "callForHelp"
];
/* Free text at room level with no author recorded. */
const ROOM_UNATTRIBUTED_TEXT = ["teamName"];

const STAT_KEYS = ["participantsIncluded", "participantsNoConsent", "participantsUnbound",
  "keyedRows", "ballots", "cidNotIncluded", "byNamesNobodyIncluded", "nameNotIncluded",
  "nameShared", "teamNames"];

function normName(s) {
  return typeof s === "string" ? s.normalize("NFC").trim() : s;
}

/**
 * Did this pool row opt in to research use? Fail-closed: only an explicit
 * boolean true counts (GDPR Art. 7 — never inferred from silence).
 */
function hasResearchConsent(poolEntry) {
  return !!(poolEntry && poolEntry.consent && poolEntry.consent.research === true);
}

function boundUid(sess, cid) {
  const m = isMap(sess && sess.clientMapping) ? sess.clientMapping : {};
  const u = hasOwn(m, cid) ? m[cid] : undefined;
  return typeof u === "string" && u.length > 0 ? u : null;
}

/** Is pool row `cid` an included participant (consent, bound, not withdrawn)? */
function isIncluded(sess, cid) {
  const pool = isMap(sess && sess.pool) ? sess.pool : {};
  return hasOwn(pool, cid) && hasResearchConsent(pool[cid]) && boundUid(sess, cid) !== null;
}

/** True if the session has at least one included participant. */
function sessionHasConsent(sess) {
  const pool = isMap(sess && sess.pool) ? sess.pool : {};
  return Object.keys(pool).some((cid) => isIncluded(sess, cid));
}

/* Names in the records only the facilitator can write. */
function facilitatorNames(s) {
  const names = [];
  const push = (rec) => { if (isObj(rec) && typeof rec.by === "string") names.push(rec.by); };
  push(s.created); push(s.closed); push(s._adminPresence);
  if (isMap(s.audit)) Object.values(s.audit).forEach(push);
  const rooms = isMap(s.rooms) ? s.rooms : {};
  for (const room of Object.values(rooms)) {
    const manual = isMap(room) && isMap(room.score) && isMap(room.score.manual) ? room.score.manual : {};
    Object.values(manual).forEach(push);
  }
  return names;
}

/**
 * Who is in, who is out, and the identifiers and names that say so.
 * @param {object} sess the raw session subtree (withdrawals already applied)
 */
function participantSets(sess) {
  const s = isObj(sess) ? sess : {};
  const pool = isMap(s.pool) ? s.pool : {};
  const stableIdMapping = isMap(s.stableIdMapping) ? s.stableIdMapping : {};
  const included = [];
  const excluded = [];
  let unbound = 0;
  for (const cid of Object.keys(pool)) {
    if (isIncluded(s, cid)) { included.push(cid); continue; }
    excluded.push(cid);
    if (hasResearchConsent(pool[cid])) unbound++;
  }
  const includedUids = new Set(included.map((cid) => boundUid(s, cid)));
  const excludedUids = new Set(excluded.map((cid) => boundUid(s, cid)).filter(Boolean));
  const rowStableId = (cid) => {
    const v = isObj(pool[cid]) ? pool[cid].stableId : undefined;
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const includedBallotKeys = new Set(included);
  const excludedBallotKeys = new Set();
  for (const cid of included) { const sid = rowStableId(cid); if (sid) includedBallotKeys.add(sid); }
  for (const cid of excluded) { const sid = rowStableId(cid); if (sid) excludedBallotKeys.add(sid); }
  for (const sid of Object.keys(stableIdMapping)) {
    if (includedUids.has(stableIdMapping[sid])) includedBallotKeys.add(sid);
    if (excludedUids.has(stableIdMapping[sid])) excludedBallotKeys.add(sid);
  }
  const includedNames = new Set();
  const otherNames = new Set();
  const addName = (set, v) => { const n = normName(v); if (typeof n === "string" && n) set.add(n); };
  for (const cid of included) addName(includedNames, isObj(pool[cid]) ? pool[cid].name : null);
  /* Only a row BOUND to an account counts against an included participant's
     name. A pool row needs neither consent nor a mapping row, so counting
     every row let anyone holding the code write pool/x = { name: <hers> } and
     remove her name-only records — and her reveals from the room's revealed
     set (found in review). Binding raises the bar and does not close it: a
     signed-in visitor who binds a row of their own under her name still
     removes them. The other side of it: an unbound namesake's name-only
     records, if any, are judged as hers. */
  for (const cid of excluded) {
    if (boundUid(s, cid)) addName(otherNames, isObj(pool[cid]) ? pool[cid].name : null);
  }
  for (const n of facilitatorNames(s)) addName(otherNames, n);
  return {
    included, excluded, unbound,
    includedCids: new Set(included), includedUids, excludedUids,
    includedBallotKeys, excludedBallotKeys, includedNames, otherNames
  };
}

/* "included" | "shared" | "notIncluded" */
function nameStatus(sets, v) {
  const n = normName(v);
  if (typeof n !== "string" || !sets.includedNames.has(n)) return "notIncluded";
  return sets.otherNames.has(n) ? "shared" : "included";
}

/* The `by` inside an event's payload, when the payload is what a client writes. */
function payloadAuthor(rec) {
  const p = rec.payload;
  if (typeof p !== "string" || p.length > PAYLOAD_MAX_CHARS) return undefined;
  try {
    const o = JSON.parse(p);
    return isObj(o) && hasOwn(o, "by") ? o.by : undefined;
  } catch (e) {
    return undefined; // unreadable: pseudonymise.js removes the payload itself
  }
}

/* Why a record attributed by `cid` cannot be kept, or null. */
function cidRecordFault(sets, rec) {
  if (!isObj(rec) || typeof rec.cid !== "string" || !sets.includedCids.has(rec.cid)) {
    return "cidNotIncluded";
  }
  const names = [];
  if (hasOwn(rec, "by")) names.push(rec.by);
  if (isMap(rec.edits)) {
    for (const e of Object.values(rec.edits)) if (isObj(e) && hasOwn(e, "by")) names.push(e.by);
  }
  return names.every((n) => nameStatus(sets, n) !== "notIncluded") ? null : "byNamesNobodyIncluded";
}

/* Why a record attributed by a name only cannot be kept, or null. */
function nameRecordFault(sets, rec) {
  if (!isObj(rec)) return "nameNotIncluded";
  const names = [rec.by];
  const inPayload = payloadAuthor(rec);
  if (inPayload !== undefined) names.push(inPayload);
  const status = names.map((n) => nameStatus(sets, n));
  if (status.includes("notIncluded")) return "nameNotIncluded";
  return status.includes("shared") ? "nameShared" : null;
}

/* Why a record whose `by` is a clientId cannot be kept, or null. */
function clientIdInByFault(sets, rec) {
  return isObj(rec) && typeof rec.by === "string" && sets.includedCids.has(rec.by)
    ? null : "cidNotIncluded";
}

/* Visit every node at `pattern` below `root` (`*` = every child). The callback
   gets the parent and the key, so it can delete. */
function eachAt(root, pattern, fn) {
  const segs = pattern.split("/");
  (function go(node, i) {
    if (!isMap(node)) return;
    const seg = segs[i];
    const keys = seg === "*" ? Object.keys(node) : (hasOwn(node, seg) ? [seg] : []);
    for (const k of keys) {
      if (i === segs.length - 1) fn(node, k);
      else go(node[k], i + 1);
    }
  })(root, 0);
}

function keepKeys(container, keep, stats, statKey) {
  if (!isMap(container)) return;
  for (const k of Object.keys(container)) {
    if (!keep(k)) { delete container[k]; stats[statKey]++; }
  }
}

function filterRoom(room, sets, stats) {
  const inCid = (k) => sets.includedCids.has(k);
  for (const name of ROOM_KEYED_BY_CLIENT_ID) keepKeys(room[name], inCid, stats, "keyedRows");
  for (const path of ROOM_KEYED_BY_CLIENT_ID_UNDER_INDEX) {
    eachAt(room, path + "/*", (parent, idx) => keepKeys(parent[idx], inCid, stats, "keyedRows"));
  }
  eachAt(room, "votes/*/ballots", (parent, k) => keepKeys(parent[k],
    (key) => sets.includedBallotKeys.has(key) && !sets.excludedBallotKeys.has(key), stats, "ballots"));

  const judge = (patterns, fault) => {
    for (const p of patterns) {
      eachAt(room, p, (parent, k) => {
        const why = fault(sets, parent[k]);
        if (why) { delete parent[k]; stats[why]++; }
      });
    }
  };
  judge(ROOM_RECORDS_BY_CID, cidRecordFault);
  judge(ROOM_RECORDS_BY_NAME, nameRecordFault);
  judge(ROOM_RECORDS_BY_CLIENT_ID_IN_BY, clientIdInByFault);
  for (const p of ROOM_RECORDS_BY_CLIENT_ID_IN_BY) {
    eachAt(room, p + "/assignments", (parent, k) => keepKeys(parent[k], inCid, stats, "keyedRows"));
  }
  for (const k of ROOM_UNATTRIBUTED_TEXT) {
    if (hasOwn(room, k)) { delete room[k]; stats.teamNames++; }
  }
}

/**
 * A copy of the session holding only what can be shown to belong to an
 * included participant (plus facilitator records and authorless room state).
 * Names and identifiers are NOT scrubbed here — pseudonymise.js does that.
 *
 * @param {object} sess the raw session subtree, withdrawals already applied
 * @param {object} [stats] counters to add to (see STAT_KEYS); created if absent
 * @returns {{session: object, sets: object}} the input is not mutated
 */
function selectIncluded(sess, stats) {
  const counts = stats || {};
  for (const k of STAT_KEYS) if (typeof counts[k] !== "number") counts[k] = 0;
  const sets = participantSets(sess);
  const out = JSON.parse(JSON.stringify(sess));
  counts.participantsIncluded += sets.included.length;
  counts.participantsUnbound += sets.unbound;
  counts.participantsNoConsent += sets.excluded.length - sets.unbound;
  if (isMap(out.pool)) {
    for (const cid of Object.keys(out.pool)) if (!sets.includedCids.has(cid)) delete out.pool[cid];
  }
  for (const name of ROOT_KEYED_BY_CLIENT_ID) {
    keepKeys(out[name], (k) => sets.includedCids.has(k), counts, "keyedRows");
  }
  const rooms = isMap(out.rooms) ? out.rooms : {};
  for (const roomId of Object.keys(rooms)) {
    if (isMap(rooms[roomId])) filterRoom(rooms[roomId], sets, counts);
  }
  return { session: out, sets };
}

module.exports = {
  selectIncluded,
  participantSets,
  isIncluded,
  sessionHasConsent,
  hasResearchConsent,
  normName,
  STAT_KEYS,
  ROOT_KEYED_BY_CLIENT_ID,
  ROOM_KEYED_BY_CLIENT_ID,
  ROOM_KEYED_BY_CLIENT_ID_UNDER_INDEX,
  ROOM_RECORDS_BY_CID,
  ROOM_RECORDS_BY_CLIENT_ID_IN_BY,
  ROOM_RECORDS_BY_NAME,
  ROOM_UNATTRIBUTED_TEXT
};
