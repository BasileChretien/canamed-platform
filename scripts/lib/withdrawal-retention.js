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
 * "Answered" is data-rights.js answeredKeys(): the same definition the monitor
 * uses to decide what is still open. Sharing it is the point — if the two
 * disagreed, the purge would again delete something the monitor was counting.
 *
 * Pure: no Firebase, no clock.
 */

"use strict";

const { requestKey } = require("./data-rights");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Is this record a request nobody has acted on yet?
 *  `answered === null` means the erasure ledger could not be read: nothing can
 *  then be shown to be answered, so every request counts as open. */
function isOpenRequest(record, locationKey, uid, answered) {
  if (!isObj(record) || record.erasure !== true) return false;
  return answered === null || !answered.has(requestKey(locationKey, uid));
}

/**
 * For ONE session that is being purged: which of its withdrawal records go
 * with it, and which stay.
 *
 * @param {object|null} byUid value of `withdrawals/<code>` ({ uid: record })
 * @param {string} locationKey the session's location key
 * @param {Set<string>|null} answered from answeredKeys(); null = ledger unreadable
 * @returns {{deleteUids: string[], keptUids: string[]}}
 */
function planPurgedSessionWithdrawals(byUid, locationKey, answered) {
  const deleteUids = [];
  const keptUids = [];
  for (const uid of Object.keys(isObj(byUid) ? byUid : {})) {
    if (isOpenRequest(byUid[uid], locationKey, uid, answered)) keptUids.push(uid);
    else deleteUids.push(uid);
  }
  return { deleteUids: deleteUids.sort(), keptUids: keptUids.sort() };
}

module.exports = { isOpenRequest, planPurgedSessionWithdrawals };
