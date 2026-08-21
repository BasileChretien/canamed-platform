"use strict";
/* Certificate-record retention — Annex VI item G6.
 *
 * `credentials/<certId>` is the public, unauthenticated verification record for
 * a take-home certificate: { nameHash, session, sessionLabel, at,
 * retentionUntil }. It is deliberately long-lived, because a certificate nobody
 * can check is not a certificate — but "long-lived" is not "forever", and until
 * 2026-08-21 nothing deleted it. `retentionUntil` was written on every record
 * and capped by the database rules at roughly five years, then never read back
 * by anything: no script in scripts/ referenced it, or `credentials/`, at all.
 *
 * That made the participant-facing retention statement unpublishable — an
 * intention does not satisfy GDPR Art. 5(1)(e). This module is the decision half
 * of the job that closes it; scripts/cleanup-expired-credentials.js does the I/O.
 *
 * THE RULES CAP THE VALUE, NOT ITS EXISTENCE. `retentionUntil` is validated when
 * present but is NOT in the required-children list
 * (hasChildren(['nameHash','session','at'])), so a record may legitimately have
 * none. Our own client always writes one, which makes this a latent gap rather
 * than a live one — but a retention job must not assume the field is there.
 *
 * WHAT IS DELETED, and what is deliberately not:
 *   - retentionUntil present and valid  -> expired when retentionUntil <= now.
 *     This is the authoritative signal: it is what the participant was told and
 *     what the rules capped.
 *   - retentionUntil absent/unusable    -> fall back to at + fallbackDays.
 *   - NEITHER usable                    -> KEEP, and report it.
 *
 * That last branch matters. The tempting alternative — treat an undated record
 * as infinitely old and delete it — deletes exactly the records we understand
 * least, permanently, and a malformed write would silently become a deletion
 * rule. Retention failing loudly is recoverable; over-deletion is not. The count
 * is surfaced so an operator can see the shape of what is being skipped.
 */

/** Read a millisecond timestamp, rejecting anything that is not a finite,
 *  positive number. Firebase happily returns strings, nulls and objects here. */
function _ms(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * Decide the fate of one credential record.
 *
 * @param {object} rec           the credential value
 * @param {number} nowMs         current time
 * @param {number} fallbackMs    retention window applied to `at` when
 *                               `retentionUntil` is missing or unusable
 * @returns {{expired:boolean, basis:"retentionUntil"|"at"|"none", dueMs:number|null}}
 */
function credentialVerdict(rec, nowMs, fallbackMs) {
  if (!rec || typeof rec !== "object") return { expired: false, basis: "none", dueMs: null };

  const until = _ms(rec.retentionUntil);
  if (until !== null) return { expired: until <= nowMs, basis: "retentionUntil", dueMs: until };

  const at = _ms(rec.at);
  if (at !== null) {
    const due = at + fallbackMs;
    return { expired: due <= nowMs, basis: "at", dueMs: due };
  }

  // Undated: never deleted. See the header — over-deletion is not recoverable.
  return { expired: false, basis: "none", dueMs: null };
}

/**
 * Partition a whole `credentials` map.
 *
 * @param {object} credentialsVal value of `credentials` (may be null/undefined)
 * @returns {{expired:string[], kept:string[], undated:string[]}} cert ids.
 *   `undated` is a subset of `kept`, listed separately so the job can report it.
 */
function partitionCredentials(credentialsVal, nowMs, fallbackMs) {
  const expired = [], kept = [], undated = [];
  for (const id of Object.keys(credentialsVal || {})) {
    const v = credentialVerdict(credentialsVal[id], nowMs, fallbackMs);
    if (v.expired) expired.push(id);
    else {
      kept.push(id);
      if (v.basis === "none") undated.push(id);
    }
  }
  return { expired, kept, undated };
}

/**
 * Delete expired credential records.
 *
 * Reads `credentials` whole and filters in memory rather than querying
 * orderByChild("retentionUntil").endAt(now): that form needs an `.indexOn`, and
 * `credentials` is public-read by exact id with the parent collection
 * `.read:false` — adding an index there is a change to a security-sensitive
 * node for a job that runs once a day over a few thousand rows. Same reasoning
 * as metrics-retention.js. Revisit if certificate volume ever reaches millions.
 *
 * @param {object} db      firebase-admin Database
 * @param {object} opts    { nowMs, fallbackMs, confirm }
 */
async function pruneExpiredCredentials(db, opts) {
  const nowMs = opts.nowMs;
  const fallbackMs = opts.fallbackMs;
  const confirm = !!opts.confirm;

  const snap = await db.ref("credentials").once("value");
  const all = snap.val() || {};
  const { expired, kept, undated } = partitionCredentials(all, nowMs, fallbackMs);

  let deleted = 0, errors = 0;
  if (confirm) {
    for (const id of expired) {
      try {
        await db.ref("credentials/" + id).remove();
        deleted++;
      } catch (e) {
        errors++;
      }
    }
  }

  return {
    total: expired.length + kept.length,
    expired: expired.length,
    kept: kept.length,
    undated: undated.length,
    deleted,
    errors,
    expiredIds: expired,
    undatedIds: undated
  };
}

module.exports = { credentialVerdict, partitionCredentials, pruneExpiredCredentials };
