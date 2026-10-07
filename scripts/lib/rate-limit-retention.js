"use strict";
/* Retention for the LLM proxy's rate-limit counters — pure decisions plus the
 * one function that applies them, so both can be driven against a fake db.
 *
 *   rateLimits/uid/<uid>/<bucket>       = count
 *   rateLimits/session/<code>/<bucket>  = count
 *
 * WHY THIS EXISTS. The counters moved into RTDB with the self-hosted proxy
 * (2026-08-31), and RTDB has no expiry: `rtdbStore.increment()` is handed a TTL
 * and ignores it, with a comment saying the stale nodes "are swept by
 * scripts/cleanup-stale-sessions.js". Nothing swept them — no script in this
 * repository referenced `rateLimits` at all. So every hour and every day in
 * which a participant used the chat stayed on record under their Firebase Auth
 * uid, for ever. A persistent identifier with a usage timeline is personal data
 * (GDPR Recital 30), and an unbounded store of it is the same storage-limitation
 * gap as the hfPatient metrics tree before it (see metrics-retention.js). Found
 * 2026-10-07 while tracing every uid-keyed node for issue #347.
 *
 * THE BUCKET IS THE WINDOW. The proxy bakes the period into the key:
 *
 *   "h" + floor(now / 1h)      an hour bucket
 *   "d" + yyyymmdd (UTC)       a day bucket
 *
 * and asks its store for a TTL of twice the window (2 h, 2 days). That TTL is
 * what this implements: a bucket is stale once `now >= start + 2 x window`. A
 * counter stops being consulted the moment its window passes, so nothing here
 * can change a limit that is still in force.
 *
 * tests/rate-limit-retention.test.js pins the two key formats and the factor
 * against proxy/src/handler.js, because this file decides what is DELETED from
 * a format it does not own.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* The proxy passes `2 * window` as the TTL for both bucket kinds. */
const TTL_WINDOWS = 2;

/* The two scopes the rules declare. Anything else under `rateLimits` is
   rejected by `$other: false`, so it can only have been written by an admin —
   and is left alone rather than guessed at. */
const SCOPES = ["uid", "session"];

/**
 * The period a bucket key covers.
 *
 * @param {string} bucket
 * @returns {{startMs:number, windowMs:number}|null} null when the key is not
 *   one of the two formats the proxy writes
 */
function bucketWindow(bucket) {
  if (typeof bucket !== "string") return null;

  const h = /^h(\d{1,9})$/.exec(bucket);
  if (h) return { startMs: Number(h[1]) * HOUR_MS, windowMs: HOUR_MS };

  const d = /^d(\d{4})(\d{2})(\d{2})$/.exec(bucket);
  if (d) {
    const y = Number(d[1]), mo = Number(d[2]), day = Number(d[3]);
    const startMs = Date.UTC(y, mo - 1, day);
    const back = new Date(startMs);
    /* Date.UTC rolls an impossible date forward ("d20260231" becomes 3 March),
       which would give a junk key a real, later window and keep it alive. */
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 ||
        back.getUTCDate() !== day) return null;
    return { startMs, windowMs: DAY_MS };
  }
  return null;
}

/**
 * Is this bucket past the TTL the proxy asked for?
 *
 * A key in neither format is STALE. It cannot be shown to be inside a window,
 * and the rules let a participant write any bucket name under their own uid, so
 * keeping unknown keys would let junk outlive the policy for ever. The cost of
 * being wrong is small and bounded — a counter restarts — and such keys are
 * counted separately so a change of format on the proxy side shows up in the
 * report instead of hiding in the total.
 */
function isStaleBucket(bucket, nowMs) {
  const w = bucketWindow(bucket);
  if (!w) return true;
  return nowMs >= w.startMs + TTL_WINDOWS * w.windowMs;
}

/**
 * Decide what to delete from a whole `rateLimits` value.
 *
 * @param {object} rateLimitsVal value of `rateLimits` (may be null/undefined)
 * @param {number} nowMs
 * @returns {{paths:string[], stale:{uid:number, session:number},
 *            kept:number, unparsed:number}}
 *   `paths` are relative to `rateLimits`. `unparsed` is a subset of the stale
 *   counts: keys in neither bucket format.
 */
function planRateLimitSweep(rateLimitsVal, nowMs) {
  const out = { paths: [], stale: { uid: 0, session: 0 }, kept: 0, unparsed: 0 };
  if (!rateLimitsVal || typeof rateLimitsVal !== "object") return out;

  for (const scope of SCOPES) {
    const ids = rateLimitsVal[scope];
    if (!ids || typeof ids !== "object") continue;
    for (const id of Object.keys(ids)) {
      const buckets = ids[id];
      if (!buckets || typeof buckets !== "object") {
        /* A bare value where a bucket map belongs: not a counter, and nothing
           the proxy can read back. Removed whole. */
        out.paths.push(scope + "/" + id);
        out.stale[scope]++;
        out.unparsed++;
        continue;
      }
      for (const bucket of Object.keys(buckets)) {
        if (!isStaleBucket(bucket, nowMs)) { out.kept++; continue; }
        out.paths.push(scope + "/" + id + "/" + bucket);
        out.stale[scope]++;
        if (!bucketWindow(bucket)) out.unparsed++;
      }
    }
  }
  return out;
}

module.exports = {
  bucketWindow, isStaleBucket, planRateLimitSweep,
  TTL_WINDOWS, HOUR_MS, DAY_MS, SCOPES
};
