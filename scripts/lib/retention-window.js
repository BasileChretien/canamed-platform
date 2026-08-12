"use strict";
/* Parse a retention window (in days) from a free-form string.
 *
 * The cleanup job's windows arrive as workflow_dispatch string inputs, and they
 * are the only thing standing between the job and the whole database. parseInt()
 * is far too forgiving for that, and both of its failure modes are silent:
 *
 *   "-1"   → Date.now() - (-1 * DAY) is a cutoff in the FUTURE, so every live
 *            row satisfies `at < cutoff` and the job deletes current data.
 *            With CLEANUP_RETENTION_CLOSED_DAYS that is every session.
 *   "abc"  → NaN. Every comparison against NaN is false, so nothing is ever
 *            purged and retention silently stops happening — the exact outcome
 *            this job exists to prevent, presented as a clean run.
 *   "30.5" → parseInt truncates to 30, quietly ignoring what was asked for.
 *
 * Pure and separately testable because a source-grep cannot show that the guard
 * actually rejects "-1". Returns {ok:true, value} or {ok:false, error}; the
 * caller decides how loudly to fail (the script aborts — a retention job with an
 * unusable window must not guess). Flagged by CodeRabbit on #314.
 */
function parseRetentionDays(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: fallback };
  const reject = {
    ok: false,
    error: `${JSON.stringify(String(raw))} is not a positive whole number of days`
  };

  /* Plain decimal digits ONLY for strings. Number() alone is still too clever:
     it reads "0x1f" as 31 and " 30 " as 30, so a typo would be silently honoured
     as a policy nobody chose — the same objection as truncating "30.5". This is
     a deletion window typed into a workflow form; it should mean exactly what it
     looks like or be refused. (parseInt is worse again: it TRUNCATES "30.5" and
     "30abc" to 30 instead of rejecting them.) */
  if (typeof raw === "string" && !/^\d+$/.test(raw)) return reject;

  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return reject;
  return { ok: true, value: n };
}

module.exports = { parseRetentionDays };
