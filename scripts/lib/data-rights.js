/* scripts/lib/data-rights.js
 *
 * The two data-subject rights Annex VI G12 named besides erasure itself:
 * whether an erasure request is being ACTED ON in time (GDPR Art. 12(3)), and
 * RECTIFICATION (Art. 16), which the platform could not perform at all once a
 * session closed.
 *
 * Pure — no Firebase, no clock, no I/O. `now` is passed in, so a caller cannot
 * get a different answer by running at a different moment, and the overdue
 * arithmetic is testable without waiting a month.
 *
 * WHY A MONITOR IS PART OF THE RIGHT, not decoration. #376 gave participants a
 * button that records an erasure request; #375 gave an operator a tool that
 * performs one. Nothing connected them. An unread queue discharges no duty —
 * Art. 12(3) requires action "without undue delay and in any event within one
 * month of receipt", and a request nobody looks at fails that silently while
 * every part of the system reports success.
 */

"use strict";

const { withdrawalLocations } = require("./session-trees");

/** GDPR Art. 12(3): one month. Extendable by two further months for complex
 *  cases, which is a decision a human makes and records, not a default. */
const DEADLINE_DAYS = 30;
const DAY_MS = 86400000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* Joins a location key and a uid into one Set key. A NUL cannot occur in
   either, so the pair cannot be confused with another pair. BUILT, not typed:
   written as a string literal it was stored as a raw NUL byte, and git then
   treated this whole file as binary: no diff of it could be read in a pull
   request from the day it was added (2026-09-03) until 2026-10-07. */
const SEP = String.fromCharCode(0);

/** One request: this person, in this session. */
const requestKey = (locationKey, uid) => locationKey + SEP + uid;

/** `erasures/<pushId>.records[]`, as one list. A record with no date of its own
 *  takes its entry's: `erasures/<id> = { at, records }`, one entry per run. */
function flattenErasures(node) {
  const out = [];
  for (const id of Object.keys(isObj(node) ? node : {})) {
    const entry = node[id];
    if (!isObj(entry)) continue;
    for (const rec of Object.values(entry.records || {})) {
      out.push(isObj(rec) && rec.at === undefined && entry.at !== undefined
        ? Object.assign({ at: entry.at }, rec) : rec);
    }
  }
  return out;
}

/**
 * Which requests each (session, person) has had ANSWERED. Matching on uid AND
 * location, not uid alone: someone may withdraw from one session and not
 * another, and treating any past erasure as covering every future request
 * would mark new requests done on arrival.
 *
 * ONE DEFINITION, SHARED — with isAnswered() below. The monitor uses it to
 * decide what is still open; the nightly purge and sweep use it to decide
 * which withdrawal records may be deleted (scripts/lib/withdrawal-retention.js).
 * If those two ever disagreed, the purge would delete a request the monitor
 * still counted as open — which is the defect this arrangement exists to end.
 *
 * @param {object[]} erasureRecords flattened `erasures/*.records[]`
 * @returns {Map<string, {stamps: Set<number>, unstampedLatest: number}>}
 *   requestKey() -> the `requestAt` stamps of its records, and — for records
 *   that carry no stamp at all — the latest of their dates in epoch ms
 *   (-Infinity when none can be read)
 */
function answeredIndex(erasureRecords) {
  const index = new Map();
  for (const rec of erasureRecords || []) {
    if (!rec || !rec.uid || !rec.locationKey) continue;
    const key = requestKey(rec.locationKey, rec.uid);
    if (!index.has(key)) index.set(key, { stamps: new Set(), unstampedLatest: -Infinity });
    const entry = index.get(key);
    if (typeof rec.requestAt === "number") { entry.stamps.add(rec.requestAt); continue; }
    const parsed = typeof rec.at === "string" ? Date.parse(rec.at) : NaN;
    if (Number.isFinite(parsed) && parsed > entry.unstampedLatest) entry.unstampedLatest = parsed;
  }
  return index;
}

/**
 * Has THIS request been answered?
 *
 * A record answers the request it was written for, and says which: it carries
 * `requestAt`, a copy of that request's own `at` (0 when it was written with
 * no request in the queue). The match is on that value. Nothing is compared
 * across clocks.
 *
 * WHY NOT "A RECORD FOR THIS PERSON AND SESSION EXISTS". `erasures/` is never
 * deleted, so that stays true for ever: erased, back in the same session on
 * the same account, new work, a second request — answered before it was made,
 * never shown, and deleted by the purge.
 *
 * WHY NOT "…DATED AT OR AFTER THE REQUEST" either, which is what this did for
 * a few hours on 2026-10-07. The record's date is the operator's clock and the
 * request's is the participant's device, which the rules let run up to a day
 * behind the server. A second request from a slow device, made after the
 * erasure, is dated before it.
 *
 * RECORDS WITH NO STAMP were written before stamps existed. For those, and
 * only those, the date comparison is all there is. It is wrong by up to the
 * 24 hours the rule allows, in one direction: a request made within a day
 * AFTER such a record can read as answered. No such record is written any
 * more, so that window closes a day after this is deployed.
 *
 * An undated request is answered by any record (nothing identifies it, and it
 * must stay closable); a record with no stamp and no readable date answers
 * nothing that has a date.
 *
 * @param {Map} index from answeredIndex()
 * @param {string} locationKey
 * @param {string} uid
 * @param {*} requestAt the request's `at` (epoch ms)
 */
function isAnswered(index, locationKey, uid, requestAt) {
  const entry = index.get(requestKey(locationKey, uid));
  if (!entry) return false;
  if (typeof requestAt !== "number") return true;
  return entry.stamps.has(requestAt) || entry.unstampedLatest >= requestAt;
}

/**
 * Which erasure requests are still outstanding, and which are late.
 *
 * @param {object} withdrawalsByLocation { locationKey: { uid: {research, at, erasure} } }
 * @param {object[]} erasureRecords flattened `erasures/*.records[]`
 * @param {number} now epoch ms
 * @param {number} [deadlineDays]
 * @returns {{pending: object[], overdue: object[], handled: number}}
 */
function pendingErasures(withdrawalsByLocation, erasureRecords, now,
                         deadlineDays = DEADLINE_DAYS) {
  const done = answeredIndex(erasureRecords);

  const pending = [];
  let handled = 0;
  for (const locationKey of Object.keys(withdrawalsByLocation || {})) {
    const byUid = withdrawalsByLocation[locationKey];
    if (!isObj(byUid)) continue;
    for (const uid of Object.keys(byUid)) {
      const w = byUid[uid];
      /* Only an explicit erasure ask counts. A bare withdrawal already has its
         full effect the moment it is written — the export honours it — so
         listing those as "outstanding" would bury the real ones in noise. */
      if (!isObj(w) || w.erasure !== true) continue;
      if (isAnswered(done, locationKey, uid, w.at)) { handled++; continue; }
      const at = typeof w.at === "number" ? w.at : null;
      const ageDays = at === null ? null : Math.floor((now - at) / DAY_MS);
      pending.push({
        locationKey,
        uid,
        at,
        ageDays,
        /* An undated request is treated as OVERDUE, not as fresh. The rules
           require `at`, so a missing one means something wrote outside them —
           and the safe reading of "we do not know when this arrived" is that
           it may already be late. */
        overdue: ageDays === null || ageDays >= deadlineDays,
      });
    }
  }
  pending.sort((a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity));
  return { pending, overdue: pending.filter((p) => p.overdue), handled };
}

/**
 * The erasure queue, read from the requests themselves.
 *
 * pendingErasures() answers for whatever map it is handed. The monitor used to
 * build that map by visiting `withdrawals/<code>` for each session still in the
 * database, so a request written after its session was purged — which the
 * rules allow, and which the account dialog's history row is there for — was
 * in no map and therefore never open, due or late. This starts from the whole
 * `withdrawals` tree instead, and only then asks which sessions still exist.
 *
 * @param {object} args
 * @param {object} args.withdrawals value of `withdrawals` (both trees)
 * @param {object[]} args.erasureRecords flattened `erasures/*.records[]`
 * @param {string[]} args.liveLocationKeys keys of the sessions in the database
 * @param {string[]} [args.purgedLocationKeys] keys that carry a purge marker
 *   (session-trees purgedMarkers()). Omitted = none known.
 * @param {number} args.now epoch ms
 * @param {number} [args.deadlineDays]
 * @returns {{pending: object[], overdue: object[], handled: number,
 *            sessionGone: object[], noMarker: object[]}} as pendingErasures(),
 *   each pending item also carrying `sessionInDatabase` and `sessionPurged`.
 *   `sessionGone` is the pending items whose session is not in the database;
 *   `noMarker` is the part of those that NOTHING shows ever existed — written
 *   before the rules required a session or a marker, or for a session purged
 *   before the purge wrote markers. `sessionPurged` is true wherever a marker
 *   exists, whether or not something is in the database under that code again.
 */
function erasureQueue({ withdrawals, erasureRecords, liveLocationKeys, purgedLocationKeys,
                        now, deadlineDays }) {
  const live = new Set(liveLocationKeys || []);
  const purged = new Set(purgedLocationKeys || []);
  const found = pendingErasures(
    withdrawalLocations(withdrawals), erasureRecords, now, deadlineDays);
  /* TWO INDEPENDENT FACTS. "Something is under this code now" does not undo
     "a session with this code was purged": anyone can put a node under a
     purged code (their own membership row is writable under any code), and
     the snapshots still hold the session that was purged. Treating a code
     that is in the database as "not purged" is how a request for a purged
     session came to be offered for dismissal. */
  const pending = found.pending.map((p) => ({
    ...p,
    sessionInDatabase: live.has(p.locationKey),
    sessionPurged: purged.has(p.locationKey),
  }));
  return {
    pending,
    overdue: pending.filter((p) => p.overdue),
    handled: found.handled,
    sessionGone: pending.filter((p) => !p.sessionInDatabase),
    noMarker: pending.filter((p) => !p.sessionInDatabase && !p.sessionPurged),
  };
}

/** Fields a participant may have corrected. Deliberately short: these are the
 *  values they typed about themselves. Their ANSWERS are not here — work is not
 *  made "accurate" by rewriting it, and Art. 16 is about factual accuracy. */
const RECTIFIABLE = ["name", "university", "year", "english"];

/** The roster holds only these. It is NOT the same shape as a pool entry, and
 *  its rule seals unknown keys with `$other: {".validate": false}` — so writing
 *  `year` there would invent a field the schema forbids. The Admin SDK bypasses
 *  rules, which means the mistake would SUCCEED and leave data no client could
 *  ever write or validate. Hence two lists, not one. */
const ROSTER_FIELDS = ["name", "university"];

/**
 * Where a corrected value has to land for it to be true everywhere.
 *
 * The same fact is stored in two places written at different moments — the
 * per-browser `pool` entry and the session `roster` — so correcting one leaves
 * the system disagreeing with itself, which is a fresh accuracy problem rather
 * than a fix.
 *
 * @param {object} session the session subtree
 * @param {object} identity from erasure.resolveIdentity()
 * @param {object} fields e.g. { name: "Corrected Name" }
 * @param {string} rosterPath the session's roster path
 * @param {object} [rosterNode] the roster's current contents. REQUIRED to touch
 *   the roster at all: without it a mistyped uid would CREATE a roster row —
 *   inventing a participant, with a name in it, in the name of correcting one.
 *   Rectification may only ever update a row that already exists.
 * @returns {{updates: object, skipped: string[]}} `updates` keyed by path
 *   RELATIVE to the database root for the roster, and relative to the SESSION
 *   for pool entries — the caller prefixes the latter.
 */
function planRectification(session, identity, fields, rosterPath, rosterNode) {
  const s = isObj(session) ? session : {};
  const updates = {};
  const skipped = [];

  for (const key of Object.keys(fields || {})) {
    if (!RECTIFIABLE.includes(key)) {
      skipped.push(key);
      continue;
    }
    const value = fields[key];
    const pool = isObj(s.pool) ? s.pool : {};
    for (const cid of identity.clientIds || []) {
      if (Object.prototype.hasOwnProperty.call(pool, cid)) {
        updates[`session:pool/${cid}/${key}`] = value;
      }
    }
    const rosterHasThem = isObj(rosterNode)
      && Object.prototype.hasOwnProperty.call(rosterNode, identity.uid);
    if (identity.uid && rosterPath && rosterHasThem && ROSTER_FIELDS.includes(key)) {
      updates[`${rosterPath}/${identity.uid}/${key}`] = value;
    }
  }
  return { updates, skipped };
}

module.exports = {
  DEADLINE_DAYS,
  RECTIFIABLE,
  ROSTER_FIELDS,
  requestKey,
  flattenErasures,
  answeredIndex,
  isAnswered,
  pendingErasures,
  erasureQueue,
  planRectification,
};
