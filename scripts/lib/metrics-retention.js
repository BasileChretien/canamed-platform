"use strict";
/* Retention decisions for the hfPatient metrics tree — pure, so the rules can
 * be unit-tested without firebase-admin (see tests/metrics-retention.test.js).
 *
 * WHY THIS EXISTS. `metrics/hfPatient/*` had NO retention at all: the cleanup
 * job walked sessions only, so every row written since the LLM pilot went live
 * (2026-05-30) accumulated forever. Those rows are not anonymous — each carries
 * the Firebase Auth `uid`, either as a field (`events`) or as the KEY itself
 * (`usage/<uid>`, `dailyUid/<uid>`). A persistent online identifier is personal
 * data in pseudonymous form (GDPR Recital 30), so an unbounded store of them is
 * a storage-limitation gap under GDPR Art. 5(1)(e) / APPI Art. 21 — the same
 * commitment the session cleanup already enforces. Surfaced 2026-08-12 while
 * correcting the functions README, which had claimed "No PII logged".
 *
 * WHAT IS KEPT. `metrics/hfPatient/global/<day>` is a bare per-day invocation
 * COUNT with no uid, no session code, and no free text — it cannot identify
 * anyone, and it is the cost history the $1 budget alert is reasoned against.
 * Deleting it would destroy the only long-run usage record to no privacy gain,
 * so it is deliberately out of scope. Everything uid- or session-keyed expires.
 */

/* The UTC yyyymmdd integer the function keys its daily counters by. Imported
   rather than reimplemented: a second copy would silently disagree the first
   time either side changed, and this one decides what gets DELETED. */
const { dayKey } = require("../../docs/Third_session/PBL_platform/functions/lib/hf-helpers");

/* `events/<pushId>` = { uid, at, lang, msgCount, replyLen, latencyMs }.
   Expire on `at`. A row with a missing or non-numeric `at` cannot be shown to
   be within retention, so it expires — the safe direction for a retention job
   (the opposite would let a malformed row outlive the policy forever). */
function expiredEventKeys(events, cutoffMs) {
  if (!events || typeof events !== "object") return [];
  return Object.keys(events).filter(k => {
    const at = events[k] && events[k].at;
    return typeof at !== "number" || at < cutoffMs;
  });
}

/* `usage/<uid>` and `sessionUsage/<code>` = { count, windowStart, lastAt }.
   The KEY is the identifier here, so an expired bucket is removed whole.
   `lastAt` was added later than `windowStart`, so fall back to it rather than
   treating an older row as un-expirable. */
function expiredBucketKeys(buckets, cutoffMs) {
  if (!buckets || typeof buckets !== "object") return [];
  return Object.keys(buckets).filter(k => {
    const b = buckets[k];
    if (!b || typeof b !== "object") return true;      // malformed → expire
    const stamp = typeof b.lastAt === "number" ? b.lastAt
      : (typeof b.windowStart === "number" ? b.windowStart : null);
    return stamp === null || stamp < cutoffMs;
  });
}

/* `dailyUid/<uid>/<yyyymmdd>` = count.
   Returns the individual day paths to delete, plus the uids whose every day
   expired — those parent nodes must go too, or the tree keeps one empty node
   per participant for ever, which is still a uid-keyed record of who used it. */
/* A key must be exactly eight digits AND a real UTC calendar date.
 *
 * parseInt() is the trap here, and it fails in the direction that KEEPS data:
 * "20261301" (month 13) parses to a number larger than any real cutoff, and
 * "20260812junk" parses to 20260812 — both then read as recent and survive the
 * window for ever, which contradicts the malformed-expires rule the rest of
 * this file follows. Flagged by CodeRabbit on #314. */
function _validDayKey(k) {
  if (!/^\d{8}$/.test(k)) return false;
  const y = +k.slice(0, 4), m = +k.slice(4, 6), d = +k.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Round-trip catches month 13, day 32, and 30 February (which Date rolls over).
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function expiredDailyPaths(daily, cutoffMs) {
  const out = { dayPaths: [], emptyUids: [] };
  if (!daily || typeof daily !== "object") return out;
  const cutoffDay = dayKey(cutoffMs);
  for (const uid of Object.keys(daily)) {
    const days = daily[uid];
    if (!days || typeof days !== "object") { out.emptyUids.push(uid); continue; }
    const keys = Object.keys(days);
    const expired = keys.filter(d => !_validDayKey(d) || Number(d) < cutoffDay);
    if (expired.length === keys.length) out.emptyUids.push(uid);
    else for (const d of expired) out.dayPaths.push(uid + "/" + d);
  }
  return out;
}

/* The orchestration lives here rather than in the script so it can be driven
   against a fake db in tests. The pure rules above decide WHAT expires; this
   decides what is actually deleted, which is where a wrong path would do real
   damage (an `update()` on the wrong node can drop the whole tree).
 *
 * Logs COUNTS ONLY, in every mode. The session pass has CLEANUP_QUIET because
 * session codes are sensitive in world-readable Actions logs; these nodes are
 * keyed by Firebase Auth uid, which identifies a person, so there is no verbose
 * variant to opt into. Errors are reported by `code` for the same reason — an
 * admin error message can embed the node path, and therefore the uid. */
async function pruneHfPatientMetrics(db, opts) {
  const { cutoffMs, confirm } = opts;
  const log = opts.log || console.error;
  const base = "metrics/hfPatient";
  const n = { events: 0, usage: 0, sessionUsage: 0, dailyDays: 0, dailyUids: 0, errors: 0 };

  const val = async p => (await db.ref(`${base}/${p}`).once("value")).val();
  const removeKeys = async (p, keys) => {
    if (!confirm || !keys.length) return;
    const updates = {};
    for (const k of keys) updates[k] = null;
    await db.ref(`${base}/${p}`).update(updates);
  };
  const section = async (name, fn) => {
    try { await fn(); }
    catch (e) { n.errors++; log(`ERROR    metrics/${name}  ${(e && e.code) || "error"}`); }
  };

  await section("events", async () => {
    const keys = expiredEventKeys(await val("events"), cutoffMs);
    n.events = keys.length;
    await removeKeys("events", keys);
  });
  await section("usage", async () => {
    const keys = expiredBucketKeys(await val("usage"), cutoffMs);
    n.usage = keys.length;
    await removeKeys("usage", keys);
  });
  await section("sessionUsage", async () => {
    const keys = expiredBucketKeys(await val("sessionUsage"), cutoffMs);
    n.sessionUsage = keys.length;
    await removeKeys("sessionUsage", keys);
  });
  await section("dailyUid", async () => {
    const { dayPaths, emptyUids } = expiredDailyPaths(await val("dailyUid"), cutoffMs);
    n.dailyDays = dayPaths.length;
    n.dailyUids = emptyUids.length;
    await removeKeys("dailyUid", dayPaths.concat(emptyUids));
  });

  return n;
}

module.exports = {
  expiredEventKeys, expiredBucketKeys, expiredDailyPaths, dayKey, pruneHfPatientMetrics
};
