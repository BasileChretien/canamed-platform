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

/** `erasures/<pushId>.records[]`, as one list. */
function flattenErasures(node) {
  const out = [];
  for (const id of Object.keys(isObj(node) ? node : {})) {
    const entry = node[id];
    if (!isObj(entry)) continue;
    for (const rec of Object.values(entry.records || {})) out.push(rec);
  }
  return out;
}

/**
 * Which requests have been ANSWERED: an erasure record exists for the same
 * person in the same session. Matching on uid AND location, not uid alone:
 * someone may withdraw from one session and not another, and treating any past
 * erasure as covering every future request would mark new requests done on
 * arrival.
 *
 * ONE DEFINITION, SHARED. The monitor uses it to decide what is still open;
 * the nightly purge and sweep use it to decide which withdrawal records may be
 * deleted (scripts/lib/withdrawal-retention.js). If those two ever disagreed,
 * the purge would delete a request the monitor still counted as open — which
 * is the defect this arrangement exists to end.
 *
 * @param {object[]} erasureRecords flattened `erasures/*.records[]`
 * @returns {Set<string>} of requestKey()s
 */
function answeredKeys(erasureRecords) {
  const done = new Set();
  for (const rec of erasureRecords || []) {
    if (rec && rec.uid && rec.locationKey) done.add(requestKey(rec.locationKey, rec.uid));
  }
  return done;
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
  const done = answeredKeys(erasureRecords);

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
      if (done.has(requestKey(locationKey, uid))) { handled++; continue; }
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
 *   before the purge wrote markers. A session that is in the database is live
 *   whatever marker an earlier purge left (a restore, a reused code).
 */
function erasureQueue({ withdrawals, erasureRecords, liveLocationKeys, purgedLocationKeys,
                        now, deadlineDays }) {
  const live = new Set(liveLocationKeys || []);
  const purged = new Set(purgedLocationKeys || []);
  const found = pendingErasures(
    withdrawalLocations(withdrawals), erasureRecords, now, deadlineDays);
  const pending = found.pending.map((p) => {
    const sessionInDatabase = live.has(p.locationKey);
    return { ...p, sessionInDatabase, sessionPurged: !sessionInDatabase && purged.has(p.locationKey) };
  });
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
  answeredKeys,
  pendingErasures,
  erasureQueue,
  planRectification,
};
