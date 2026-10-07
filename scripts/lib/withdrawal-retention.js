/* scripts/lib/withdrawal-retention.js
 *
 * What becomes of a withdrawal record (`withdrawals/<code>/<uid>`) when its
 * session is purged, and afterwards.
 *
 * A record is two things at once. `research: false` keeps the participant out
 * of the research export — and the export reads sessions that are in the
 * database, so once the session is gone that half protects nothing. With
 * `erasure: true` it is also a REQUEST, addressed to a person, with a legal
 * time limit (GDPR Art. 12(3)); that half is not finished until someone has
 * acted on it, whatever has happened to the session meanwhile.
 *
 * Until 2026-10-07 the purge treated the whole record as the first thing and
 * deleted it with the session. Run against the real schedule (purge 03:17,
 * monitor 04:11), that deleted ANY unanswered request, whenever it was made:
 *
 *   made after the session closed, or in its last day    never red at all
 *   made earlier                                         red for some days,
 *                                                        then green by itself
 *
 * and in every case no erasure record existed, so the nightly snapshots — up
 * to 90 of them — had nothing telling a restore to leave the participant out.
 *
 * THE RULE NOW, in one place:
 *
 *   an erasure request that has not been answered      is kept, without limit
 *   an erasure request that has been answered          goes
 *   a record that asks for no erasure                  goes
 *
 * "Answered" is data-rights.js isAnswered(): the same definition the monitor
 * uses to decide what is still open. Sharing it is the point — if the two
 * disagreed, the purge would again delete something the monitor was counting.
 *
 * The planning is pure — no Firebase, no clock. sweepPurgedSessionRecords()
 * takes a database handle, so it can be driven against a stand-in.
 */

"use strict";

const { isAnswered } = require("./data-rights");
const { purgedMarkers, locationForKey } = require("./session-trees");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Is this record a request nobody has acted on yet?
 *  `answered === null` means the erasure ledger could not be read: nothing can
 *  then be shown to be answered, so every request counts as open. */
function isOpenRequest(record, locationKey, uid, answered) {
  if (!isObj(record) || record.erasure !== true) return false;
  return answered === null || !isAnswered(answered, locationKey, uid, record.at);
}

/** Does this branch (`withdrawals/<code>`) hold an erasure request at all?
 *  The ledger is only worth reading — it is identifiers and dates, on a hosted
 *  runner — when the answer is yes. */
function holdsErasureRequest(byUid) {
  return Object.values(isObj(byUid) ? byUid : {}).some((r) => isObj(r) && r.erasure === true);
}

/**
 * For ONE session that is being purged: which of its withdrawal records go
 * with it, and which stay.
 *
 * @param {object|null} byUid value of `withdrawals/<code>` ({ uid: record })
 * @param {string} locationKey the session's location key
 * @param {Map<string, number>|null} answered from answeredIndex(); null = ledger unreadable
 * @returns {{deleteUids: string[], keptUids: string[], answeredUids: string[]}}
 *   `answeredUids` is the part of `deleteUids` that were erasure requests —
 *   for the report only.
 */
function planPurgedSessionWithdrawals(byUid, locationKey, answered) {
  const deleteUids = [];
  const keptUids = [];
  const answeredUids = [];
  for (const uid of Object.keys(isObj(byUid) ? byUid : {})) {
    const record = byUid[uid];
    if (isOpenRequest(record, locationKey, uid, answered)) { keptUids.push(uid); continue; }
    deleteUids.push(uid);
    if (isObj(record) && record.erasure === true) answeredUids.push(uid);
  }
  return {
    deleteUids: deleteUids.sort(), keptUids: keptUids.sort(), answeredUids: answeredUids.sort(),
  };
}

/**
 * The nightly sweep: the withdrawal records of sessions that have ALREADY
 * been purged, by the same rule as above.
 *
 * WHY IT IS NEEDED. Two kinds of record are left under a session that is
 * gone: a request the purge kept, once someone has answered it; and anything
 * written after the purge — which the rules allow, because withdrawing from a
 * session that has been purged is what the account dialog's history row is
 * for. Before this, neither was ever deleted: the only thing that removed
 * `withdrawals/<code>` was the update that removed the session.
 *
 * POSITIVE EVIDENCE ONLY. It visits a branch only where a purge MARKER says
 * the session was purged, and skips any such session that is in the database
 * again (a restore, a reused code). It never acts because a session merely
 * failed to appear in a listing: a record with `research: false` under a
 * session that is in fact still there is what keeps that participant out of
 * the research export, and deleting it would undo a withdrawal of consent.
 * A branch with neither a session nor a marker is therefore left alone — the
 * monitor counts those, and scripts/backfill-purged-markers.js or an operator
 * settles them.
 *
 * IT READS ONLY WHAT IT MAY DELETE: the markers, then one branch per purged
 * session, then the erasure ledger if any of those branches holds a request.
 * Never the withdrawal records of a session that is in the database.
 *
 * A marker itself goes once it is older than the window AND nothing is left
 * under it. While an unanswered request hangs off a marker it stays, however
 * old: the marker is what lets the erasure tool act on that request.
 *
 * @param {object} db a firebase-admin database() handle (or a stand-in)
 * @param {object} opts
 * @param {string[]} opts.liveLocationKeys sessions in the database
 * @param {function(): Promise<Map<string, number>|null>} opts.answered resolves to
 *   answeredIndex(), or null when the ledger cannot be read. Called at most
 *   once, and only if a request is found.
 * @param {number} opts.markerCutoffMs a marker older than this may expire
 * @param {boolean} opts.confirm false = report only
 * @param {function(Error): void} [opts.onError] told of each failed read/write
 * @returns {Promise<{markers:number, answered:number, noRequest:number,
 *   open:number, markersExpired:number, errors:number}>} counts — never whose
 */
async function sweepPurgedSessionRecords(db, opts) {
  const out = { markers: 0, answered: 0, noRequest: 0, open: 0, markersExpired: 0, errors: 0 };
  const fail = (e) => { out.errors++; if (opts.onError) opts.onError(e); };

  let markers;
  try {
    markers = purgedMarkers((await db.ref("purgedSessions").once("value")).val());
  } catch (e) {
    fail(e);
    return out;
  }

  const live = new Set(opts.liveLocationKeys || []);
  const updates = {};
  for (const key of Object.keys(markers)) {
    out.markers++;
    if (live.has(key)) continue;
    const loc = locationForKey(key);
    try {
      const byUid = (await db.ref(loc.withdrawalsPath).once("value")).val();
      const plan = planPurgedSessionWithdrawals(
        byUid, key, holdsErasureRequest(byUid) ? await opts.answered() : new Map());
      for (const uid of plan.deleteUids) updates[`${loc.withdrawalsPath}/${uid}`] = null;
      out.answered += plan.answeredUids.length;
      out.noRequest += plan.deleteUids.length - plan.answeredUids.length;
      out.open += plan.keptUids.length;
      if (markers[key] < opts.markerCutoffMs && plan.keptUids.length === 0) {
        updates[loc.purgedMarkerPath] = null;
        out.markersExpired++;
      }
    } catch (e) {
      fail(e);
    }
  }

  if (opts.confirm && Object.keys(updates).length) {
    try {
      await db.ref().update(updates);
    } catch (e) {
      /* One update, all or nothing: if it failed, nothing was deleted, and the
         report must not say otherwise. */
      fail(e);
      out.answered = 0;
      out.noRequest = 0;
      out.markersExpired = 0;
    }
  }
  return out;
}

module.exports = {
  isOpenRequest, holdsErasureRequest, planPurgedSessionWithdrawals, sweepPurgedSessionRecords,
};
