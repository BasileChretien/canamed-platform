"use strict";
/* Enumerate every session in the database, across BOTH session trees.
 *
 * Sessions live in two places:
 *   sessions/<code>                        the default (non-org) tree
 *   orgs/<slug>/sessions/<sessionId>       one parallel tree per partner org
 *
 * orgs.js shipped with a full parallel rules tree and /o/{slug}/ routing, but
 * all three retention jobs (cleanup-stale-sessions, backup-sessions,
 * pseudonymise-export) were hard-scoped to db.ref("sessions"). Org-scoped
 * sessions were therefore never purged, never backed up and never
 * pseudonymised — a live GDPR Art. 5(1)(e) storage-limitation gap, found by the
 * 2026-07-23 Phase-4e legal fact-check (gap 2). This module is the single place
 * that knows where sessions live, so a future third tree only needs adding here.
 *
 * `sessionLocations` is PURE (no firebase-admin) so it can be unit-tested; the
 * scripts do their own I/O and hand it the two subtree values.
 */

/**
 * Flatten both trees into one list of session locations.
 *
 * @param {object} sessionsVal value of `sessions` (may be null/undefined)
 * @param {object} orgsVal     value of `orgs` (may be null/undefined)
 * @returns {Array<{key:string, code:string, orgSlug:string|null, path:string,
 *                  adminSecretPath:string, recoveryPath:string,
 *                  roomChatPath:string,
 *                  roomChatAuthorsPath:string,
 *                  certIdsPath:string, withdrawalsPath:string,
 *                  purgedMarkerPath:string, rosterPath:string, data:object}>}
 *   `key` is unique across trees and is what exports should be keyed by — two
 *   orgs can legitimately use the same session code, so keying an export by the
 *   bare code would silently overwrite one with the other.
 */
/* `orgs` IS NOT A SESSION CODE in the default tree. Every per-session tree
 * outside `sessions/` keeps organisation sessions under a literal `orgs`
 * child (adminSecrets/orgs/<slug>/<code>, roomChat/orgs/…, certIds/orgs/…,
 * withdrawals/orgs/…, purgedSessions/orgs/…), so the paths of a default-tree
 * session coded `orgs` would be the ROOTS of every organisation's data — and
 * the purge deletes a session's paths. Until 2026-10-07 nothing reserved the
 * key, and one anonymous write under `sessions/orgs/` was enough to have the
 * next purge remove all of it. The rules now refuse the key; this is the
 * second lock: no location is ever built for it. */
const RESERVED_DEFAULT_CODES = new Set(["orgs"]);
const isReservedCode = (orgSlug, code) => orgSlug === null && RESERVED_DEFAULT_CODES.has(code);

/* Lists are returned with the number of reserved keys they left out, as a
 * NON-enumerable property: callers that only want the list are unaffected,
 * and the purge can say that something is sitting under a key it will not
 * touch. */
function withReservedCount(list, skipped) {
  Object.defineProperty(list, "reservedSkipped", { value: skipped, enumerable: false });
  return list;
}

function locationFor(orgSlug, code) {
  if (isReservedCode(orgSlug, code)) {
    throw new Error("'" + code + "' is a reserved key, not a session code: its paths " +
      "would be the roots of every organisation's data");
  }
  /* THE SINGLE SOURCE OF THE PURGE TARGETS. cleanup-stale-sessions derives
   * every path it DELETES from this object, so the two enumerators below must
   * not each build their own copy — a divergence here deletes the wrong node
   * or silently misses one. Hence one builder, two callers, and a test that
   * asserts they agree. */
  if (orgSlug === null) {
    return {
      key: code,
      code: code,
      orgSlug: null,
      path: "sessions/" + code,
      adminSecretPath: "adminSecrets/" + code,
      // recovery/ mirrors the session path, like rosters/ and UNLIKE
      // adminSecrets/: the client writes "recovery/" + oPath(code), and oPath
      // is _sessionPrefix(org) + code. tests/purge-tree-coverage.test.js
      // derives both branches from database.rules.json.
      recoveryPath: "recovery/sessions/" + code,
      roomChatPath: "roomChat/" + code,
      roomChatAuthorsPath: "roomChatAuthors/" + code,
      certIdsPath: "certIds/" + code,
      withdrawalsPath: "withdrawals/" + code,
      // WRITTEN by the purge, not deleted by it — see purgedMarkers() below.
      purgedMarkerPath: "purgedSessions/" + code,
      // rosters/ mirrors the session path exactly — the client writes
      // "rosters/" + sPath(uid), and sPath is _sessionPrefix(org) + code, so
      // this is that same prefix with the uid left off.
      rosterPath: "rosters/sessions/" + code
    };
  }
  return {
    key: "orgs/" + orgSlug + "/" + code,
    code: code,
    orgSlug: orgSlug,
    path: "orgs/" + orgSlug + "/sessions/" + code,
    adminSecretPath: "adminSecrets/orgs/" + orgSlug + "/" + code,
    recoveryPath: "recovery/orgs/" + orgSlug + "/sessions/" + code,
    roomChatPath: "roomChat/orgs/" + orgSlug + "/" + code,
    roomChatAuthorsPath: "roomChatAuthors/orgs/" + orgSlug + "/" + code,
    certIdsPath: "certIds/orgs/" + orgSlug + "/" + code,
    withdrawalsPath: "withdrawals/orgs/" + orgSlug + "/" + code,
    purgedMarkerPath: "purgedSessions/orgs/" + orgSlug + "/" + code,
    rosterPath: "rosters/orgs/" + orgSlug + "/sessions/" + code
  };
}

function sessionLocations(sessionsVal, orgsVal) {
  const out = [];
  let skipped = 0;

  for (const code of Object.keys(sessionsVal || {})) {
    if (isReservedCode(null, code)) { skipped++; continue; }
    out.push(Object.assign(locationFor(null, code), { data: sessionsVal[code] }));
  }

  for (const slug of Object.keys(orgsVal || {})) {
    const org = orgsVal[slug];
    const sessions = (org && org.sessions) || {};
    for (const code of Object.keys(sessions)) {
      out.push(Object.assign(locationFor(slug, code), { data: sessions[code] }));
    }
  }

  return withReservedCount(out, skipped);
}

/**
 * The same list, built from KEYS ALONE — no session bodies anywhere.
 *
 * Returned objects deliberately carry NO `data` property (not `data: null`):
 * a caller that needs bodies should fail obviously rather than quietly write
 * nulls into a backup. `metadataOnly: true` marks them for the same reason.
 *
 * @param {string[]} sessionCodes keys under `sessions`
 * @param {Object<string,string[]>} orgSessionCodes slug -> keys under
 *   `orgs/<slug>/sessions`
 */
function sessionLocationsFromKeys(sessionCodes, orgSessionCodes) {
  const out = [];
  let skipped = 0;
  for (const code of sessionCodes || []) {
    if (isReservedCode(null, code)) { skipped++; continue; }
    out.push(Object.assign(locationFor(null, code), { metadataOnly: true }));
  }
  for (const slug of Object.keys(orgSessionCodes || {})) {
    for (const code of orgSessionCodes[slug] || []) {
      out.push(Object.assign(locationFor(slug, code), { metadataOnly: true }));
    }
  }
  return withReservedCount(out, skipped);
}

/**
 * The `withdrawals` tree, regrouped by the location key each branch belongs to:
 *
 *   withdrawals/<code>/<uid>               ->  "<code>"
 *   withdrawals/orgs/<slug>/<code>/<uid>   ->  "orgs/<slug>/<code>"
 *
 * This goes the OTHER way from everything above: it starts from the records
 * that exist, not from the sessions that do. A participant may withdraw after
 * their session has been purged — the rule on `withdrawals/<code>/<uid>`
 * accepts it: for any code until the marker backfill has been run, and after
 * that when the purge left a marker — and a reader that only visits
 * `withdrawalsPath` for each live session never sees that record at all. That
 * is how an erasure request could be accepted, acknowledged on screen, and
 * then read by no job.
 *
 * Keys come from locationFor(), so they are the keys `erasures/` records carry
 * and cannot drift from the purge's own.
 *
 * ⚠️ A key here is NOT by itself evidence that a session ever existed. Until
 * 2026-10-07 the rule looked only at the uid, so any signed-in visitor — an
 * anonymous one included — could write `withdrawals/<any code>/<their own
 * uid>`, and records from then may still be here. Since then a record needs a
 * session in the database or a purge marker. Callers that need "is this
 * session still in the database" compare against sessionLocations(); callers
 * that need "was it ever one" compare against purgedMarkers().
 *
 * `orgs` directly under `withdrawals` is always the org subtree, never a
 * session code: the rules give that literal key no per-uid write.
 *
 * @param {object} withdrawalsVal value of `withdrawals` (may be null/undefined)
 * @returns {Object<string, object>} locationKey -> { uid: record }
 */
function withdrawalLocations(withdrawalsVal) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const out = {};
  const top = asKeyed(withdrawalsVal);
  if (top === null) return out;

  for (const code of Object.keys(top)) {
    if (isReservedCode(null, code)) continue;
    if (isObj(top[code])) out[locationFor(null, code).key] = top[code];
  }

  const orgs = asKeyed(top.orgs) || {};
  for (const slug of Object.keys(orgs)) {
    const codes = asKeyed(orgs[slug]);
    if (codes === null) continue;
    for (const code of Object.keys(codes)) {
      if (isObj(codes[code])) out[locationFor(slug, code).key] = codes[code];
    }
  }
  return out;
}

/* A node read through the Admin SDK comes back as an ARRAY when its keys are
 * all small integers (0, 1, 2…), with null in the gaps. A tree keyed by
 * session code is not normally shaped like that — but a code is chosen by
 * whoever creates the session, and "an array, so nothing here" is, for the
 * monitor, the answer that hides requests. Arrays are read as what they are:
 * a map from index to value. Anything that is not a tree at all is null. */
function asKeyed(v) {
  if (Array.isArray(v)) {
    const out = {};
    v.forEach((child, i) => { if (child !== null && child !== undefined) out[String(i)] = child; });
    return out;
  }
  return v !== null && typeof v === "object" ? v : null;
}

/**
 * THE SWITCH that turns on "a withdrawal must name a session that exists or
 * was purged": epoch ms of the confirmed marker backfill that set it.
 *
 * The rule on `withdrawals/…` wants the session's `created` record or a purge
 * marker ONLY once this node exists. Sessions purged before the purge wrote
 * markers have none; requiring one from the day the rule shipped would have
 * refused their participants' withdrawals until an operator ran
 * scripts/backfill-purged-markers.js — and for a session purged more than 90
 * days earlier, for good, with nobody having decided that. So the backfill
 * writes this node in the same update as the markers, and until then the rule
 * asks only what it asked before: that the record be the writer's own.
 *
 * Written by the backfill and by nothing else. `ops/` has no entry in
 * database.rules.json, so no client can read or write it; a rule that opened
 * any of `ops/` would hand this switch to whoever found it
 * (tests/withdrawal.test.js holds the two together).
 */
const PURGED_MARKERS_BACKFILLED_PATH = "ops/purgedMarkersBackfilledAt";

/**
 * WAS THIS EVER A SESSION? Only if it had a `created/at` or a `closed/at`.
 *
 * Something under `sessions/<code>` is not evidence of a session: any signed-in
 * visitor may write their own membership row under any code, created or not.
 * `created` is written by whoever creates a session and `closed` by its
 * administrator. ONE definition, used by the purge (which leaves a marker
 * only for a session) and by the marker backfill (which rebuilds exactly the
 * markers the purge would have left) — they disagreed once, and the backfill
 * handed a made-up code the five-year marker the purge had just refused it.
 *
 * @param {*} createdAt value of `created/at`
 * @param {*} closedAt  value of `closed/at`
 */
function hadSessionTimestamp(createdAt, closedAt) {
  return typeof createdAt === "number" || typeof closedAt === "number";
}

/** The same question of a whole session body, as a snapshot holds it. */
function bodyWasSession(body) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObj(body)) return false;
  return hadSessionTimestamp(
    isObj(body.created) ? body.created.at : undefined,
    isObj(body.closed) ? body.closed.at : undefined);
}

/**
 * What makes a session THAT session, taken from a body: null if it never was
 * one. `created` and `creatorUid` are written once and the rules let nobody
 * change or remove them, so for as long as a session lives they do not move;
 * `creatorUid` can only ever be the account that wrote it.
 */
function sessionIdentity(body) {
  if (!bodyWasSession(body)) return null;
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const num = (v) => (typeof v === "number" ? v : null);
  return {
    createdAt: isObj(body.created) ? num(body.created.at) : null,
    closedAt: isObj(body.closed) ? num(body.closed.at) : null,
    creatorUid: typeof body.creatorUid === "string" && body.creatorUid !== "" ? body.creatorUid : null,
  };
}

/**
 * IS WHAT THE DATABASE HOLDS UNDER A CODE THE SESSION A SNAPSHOT HOLDS?
 *
 * "Something has this key" is not that. Any signed-in visitor can put their
 * own membership row under any code, and can create a session under a code
 * that has become free — so a session that was purged can have something
 * under its code again, the same day or years later. The marker backfill once
 * read a key in the listing as "still in the database", gave such a session
 * no marker, and the erasure tool then let a request about it be dismissed
 * unanswered.
 *
 * It is the same session only if what is there
 *   - is a session by the purge's own test (`hadSessionTimestamp`), AND
 *   - has the same `created/at` (or, for a session old enough to have only a
 *     `closed`, the same `closed/at`), AND
 *   - where the snapshot recorded a `creatorUid`, has that same one.
 *
 * THE LIMIT. A snapshot session with NO `creatorUid` is told apart by a date
 * alone, and a date can be copied by anyone who read it while the session was
 * there. Every session the product creates has a `creatorUid`; the ones that
 * do not are a `created` somebody wrote by hand.
 *
 * @param {object|null} archived sessionIdentity() of a snapshot's body
 * @param {object|null} live     the same three values, read from the database
 */
function isSameSession(archived, live) {
  if (!archived || !live) return false;
  if (!hadSessionTimestamp(live.createdAt, live.closedAt)) return false;
  if (archived.createdAt !== null) {
    if (live.createdAt !== archived.createdAt) return false;
  } else if (live.closedAt !== archived.closedAt) {
    return false;
  }
  if (archived.creatorUid !== null && live.creatorUid !== archived.creatorUid) return false;
  return true;
}

/**
 * The location a KEY names, whether or not that session is in the database.
 *
 * Needed by everything that starts from a record rather than from a session:
 * an erasure request or a purge marker carries a location key, and the paths
 * that belong to it (its withdrawal branch, its marker) must come from the
 * same builder the purge uses, not from a second parser of the key.
 *
 * A key is "<code>" or "orgs/<slug>/<code>". Neither a code nor a slug can
 * contain "/" — they are database keys — so the split is unambiguous.
 *
 * @param {string} key
 */
function locationForKey(key) {
  const m = /^orgs\/([^/]+)\/([^/]+)$/.exec(String(key));
  return m ? locationFor(m[1], m[2]) : locationFor(null, String(key));
}

/**
 * The `purgedSessions` tree, regrouped by location key:
 *
 *   purgedSessions/<code>               = <when it was purged, epoch ms>
 *   purgedSessions/orgs/<slug>/<code>   = <the same>
 *
 * WHAT A MARKER IS. The purge writes one, in the same update that deletes the
 * session, and nothing else can: the node has no client write. It holds a
 * session code and a date — no participant, no content — and it is the only
 * thing left in the database that shows a session EXISTED. Three things lean
 * on that:
 *   - ONCE THE MARKER BACKFILL HAS BEEN RUN (PURGED_MARKERS_BACKFILLED_PATH
 *     below; until then the rule accepts a record for any code, as it did
 *     before), the rule on `withdrawals/<code>/<uid>` accepts a record only
 *     for a session whose `created` record exists, or that has a marker, so
 *     a request can then no longer be made under a code where no session was
 *     ever created (the purge writes a marker only for a session that had a
 *     timestamp — a node with none is debris anyone could have written);
 *   - the erasure tool writes a suppression record for a session that is gone
 *     only under a marker — `erasures/` is never deleted, so it must not fill
 *     with records for sessions that did not exist;
 *   - the nightly sweep deletes an answered withdrawal record only under a
 *     marker, never because a session merely failed to appear in a listing.
 *
 * A value that is not a number is not a marker and is left out: every caller
 * treats "no marker" as "nothing shows this session existed", which is the
 * safe reading of something this code did not write.
 *
 * @param {object} markersVal value of `purgedSessions` (may be null/undefined)
 * @returns {Object<string, number>} locationKey -> purged-at, epoch ms
 */
function purgedMarkers(markersVal) {
  const out = {};
  const top = asKeyed(markersVal);
  if (top === null) return out;

  for (const code of Object.keys(top)) {
    if (isReservedCode(null, code)) continue;
    if (typeof top[code] === "number") out[locationFor(null, code).key] = top[code];
  }

  const orgs = asKeyed(top.orgs) || {};
  for (const slug of Object.keys(orgs)) {
    const codes = asKeyed(orgs[slug]);
    if (codes === null) continue;
    for (const code of Object.keys(codes)) {
      if (typeof codes[code] === "number") out[locationFor(slug, code).key] = codes[code];
    }
  }
  return out;
}

/**
 * Read both trees and return their locations. Kept separate from the pure
 * function above so tests never need firebase-admin.
 * @param {object} db a firebase-admin database() handle
 */
async function readSessionLocations(db) {
  const [sessionsSnap, orgsSnap] = await Promise.all([
    db.ref("sessions").once("value"),
    db.ref("orgs").once("value")
  ]);
  return sessionLocations(sessionsSnap.val(), orgsSnap.val());
}

/**
 * Turn one RTDB `?shallow=true` response body into a key list.
 *
 * ⚠️ THE FAILURE MODE THAT MATTERS IS AN EMPTY LIST, NOT AN EXCEPTION. This
 * feeds the retention purge: if a broken read returns `[]`, the job reports
 * "0 sessions", exits 0, and looks perfectly healthy while nothing is ever
 * deleted again — a storage-limitation breach that is invisible in the logs.
 * So anything that is not a genuine empty node THROWS. `null` is the one
 * legitimate empty: that is what RTDB returns for a path with no children.
 *
 * AN ARRAY IS A LISTING TOO, when it is the array a listing could be. RTDB
 * renders a node keyed 0, 1, 2… as an array over REST, null in the gaps, and
 * a key is chosen by whoever writes under it: any signed-in visitor can put
 * their own membership row under `orgs/<any slug>/sessions/0`. Whether a
 * `?shallow=true` listing really comes back as an array was not established
 * when this was written — the emulator suite records what the emulator does
 * ("a listing of integer keys") — so both shapes are read rather than letting
 * one write stop every job that lists sessions. Accepted only as `true` where
 * a key exists and null where none does, with at least one key: an empty or
 * all-null array is not something a listing produces, and still throws.
 */
function shallowKeysOf(body, path) {
  if (body === null || body === undefined) return [];
  if (Array.isArray(body) && body.length > 0
      && body.every((v) => v === true || v === null) && body.some((v) => v === true)) {
    return body.map((v, i) => (v === true ? String(i) : null)).filter((k) => k !== null);
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new Error(
      "shallow read of '" + path + "' returned " + typeof body +
      ", expected an object of keys or null. Refusing to treat this as an " +
      "empty tree — see the note above shallowKeysOf()."
    );
  }
  return Object.keys(body);
}

/**
 * Enumerate both trees WITHOUT reading a single session body.
 *
 * Why this exists: cleanup-stale-sessions needs `created/at` and `closed/at`
 * per session and nothing else — its own per-session read says so in a comment
 * — but it got its list from readSessionLocations(), which deep-reads all of
 * `sessions` and `orgs`. Every participant name, answer and chat turn was
 * therefore copied onto a GitHub Actions runner in the United States, daily,
 * and thrown away unused. Art. 5(1)(c). The bodies are still available to the
 * jobs that genuinely need them (backup, pseudonymised export).
 *
 * The Node Admin SDK cannot project children, and `once("value")` is always
 * deep, so this goes over the RTDB REST API, whose `?shallow=true` is exactly
 * the documented way to list keys without values.
 *
 * @param {object} opts
 * @param {string} opts.databaseURL   e.g. https://x-default-rtdb.europe-west1.firebasedatabase.app
 * @param {object} [opts.app]         firebase-admin app, for its credential
 * @param {function} [opts.fetchShallow] injectable `(path) => Promise<body>`, for tests
 */
async function readSessionLocationsShallow(opts) {
  const fetchShallow = (opts && opts.fetchShallow) || makeRestShallowReader(opts || {});

  const codes = shallowKeysOf(await fetchShallow("sessions"), "sessions");
  const slugs = shallowKeysOf(await fetchShallow("orgs"), "orgs");

  /* One extra request per org, because org sessions are a level deeper. There
   * is one org in production and it maps back to the default tree, so this is
   * a loop over ~0-1 items — but it is written as a loop because the rules
   * tree permits more. */
  const orgSessionCodes = {};
  for (const slug of slugs) {
    const p = "orgs/" + slug + "/sessions";
    orgSessionCodes[slug] = shallowKeysOf(await fetchShallow(p), p);
  }

  return sessionLocationsFromKeys(codes, orgSessionCodes);
}

/**
 * Default REST reader. Uses the admin credential's OAuth token in an
 * Authorization header — NOT the `?access_token=` query parameter RTDB also
 * accepts, so the credential never lands in a URL that something might log.
 */
function makeRestShallowReader(opts) {
  return makeRestGetter(opts, "?shallow=true", "shallow read");
}

/**
 * The same reader WITHOUT `shallow` — for a node whose value is itself small
 * and wanted (one uid, one map of counters). Never point it at a session
 * subtree: that is the deep read `readSessionLocationsShallow` exists to avoid.
 */
function makeRestValueReader(opts) {
  return makeRestGetter(opts, "", "read");
}

/**
 * A database path as it has to appear in a REST URL: each SEGMENT
 * percent-encoded, the slashes between them kept.
 *
 * A key is not always one the platform generated. The rules validate the org
 * slug under `orgs/` but not under `recovery/orgs/`, and any signed-in visitor
 * can write a key of their choosing in either session tree — and a key may
 * contain `?`, `%`, `&` or a space. Unencoded, a `?` ends the path where the
 * key began, so the read fails or lands on a different node; and a key that
 * LOOKS encoded (`x%20y`) asks the server for another key (`x y`) and returns
 * that one's children. The keys the platform itself writes — session codes,
 * uids, slugs: letters, digits, `-` and `_` — come out byte-identical.
 *
 * ⚠️ THE READERS BELOW DO NOT APPLY THIS THEMSELVES, and must not start to.
 * The caller encodes, once. scripts/lib/anonymous-retention-job.js already
 * encodes every path before it calls them; when the reader encoded as well
 * (for one commit, 2026-10-07) that job asked for `My%2520Code` where the key
 * was `My Code`, got null, and read it as "this session has no members to
 * protect" — in a job that deletes on a schedule. Encoding twice is not a
 * no-op; it is a different node.
 */
function encodeRestPath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function makeRestGetter(opts, query, what) {
  const base = String(opts.databaseURL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) {
    throw new Error("readSessionLocationsShallow needs an https databaseURL, got: " + base);
  }
  const cred = opts.app && opts.app.options && opts.app.options.credential;
  if (!cred || typeof cred.getAccessToken !== "function") {
    throw new Error(
      "readSessionLocationsShallow needs an admin app whose credential exposes " +
      "getAccessToken(). Pass { app } from initializeApp(), or supply " +
      "{ fetchShallow } directly."
    );
  }

  return async function restGet(path) {
    const { access_token: token } = await cred.getAccessToken();
    const res = await fetch(base + "/" + path + ".json" + query, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) {
      /* Never degrade to "no sessions" — see shallowKeysOf. The status alone
       * is logged; a REST error body can echo the path, which carries the
       * session code, and these logs are world-readable.
       *
       * `code` is for callers whose PATHS are sensitive too: a read of
       * `sessions/<code>/members` puts the join code in this message, so such
       * a caller logs `e.code` and never `e.message`. */
      const err = new Error(what + " of '" + path + "' failed: HTTP " + res.status);
      err.code = "HTTP_" + res.status;
      throw err;
    }
    return res.json();
  };
}

/**
 * A log-safe label for a location. Session join-codes must never reach a
 * world-readable Actions log (see CLEANUP_QUIET), but the ORG SLUG is not a
 * secret and is the useful part when diagnosing which tree a row came from.
 */
function safeLabel(loc, quiet) {
  if (!quiet) return loc.key;
  return loc.orgSlug ? "orgs/" + loc.orgSlug + "/<redacted>" : "<redacted>";
}

module.exports = {
  sessionLocations,
  sessionLocationsFromKeys,
  withdrawalLocations,
  PURGED_MARKERS_BACKFILLED_PATH,
  hadSessionTimestamp,
  bodyWasSession,
  sessionIdentity,
  isSameSession,
  locationForKey,
  purgedMarkers,
  readSessionLocations,
  readSessionLocationsShallow,
  makeRestShallowReader,
  makeRestValueReader,
  encodeRestPath,
  shallowKeysOf,
  safeLabel
};
