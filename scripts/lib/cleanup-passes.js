"use strict";
/* cleanup-passes.js — the ORDER of the nightly cleanup, and exactly what a
 * blocked backup gate is allowed to stop.
 *
 * ── WHY THIS EXISTS (2026-10-07) ─────────────────────────────────────────
 * cleanup-stale-sessions.js runs two passes on two different clocks:
 *
 *   sessions   the 30/90-day windows. Archived first by backup-sessions.
 *   metrics    the hfPatient tree, 30 days. Hangs off no session and is in NO
 *              archive — backup-sessions walks `sessions` and `orgs` only.
 *
 * The backup interlock (scripts/lib/backup-marker.js) exists so the FIRST pass
 * cannot delete the only copy of a session. The script's comment said as much
 * — "the gate stops SESSION purges only" — and gave the reason: blocking the
 * metrics pass too "would create a second retention gap while trying to
 * prevent a data-loss one".
 *
 * The code did not do that. A blocked gate called process.exit(3) on the spot,
 * before the session loop AND before the metrics pass, so an armed gate with a
 * stale or missing marker stopped ALL retention for as long as the backup
 * stayed broken. The comment stated a property the job did not have, and
 * nothing could notice: the ordering lived in a main() that cannot be loaded
 * without firebase-admin, so no test had ever run it.
 *
 * Hence this module. The sequencing is here with both passes INJECTED, so it
 * can be driven in a test — the same reason metrics-retention.js keeps its
 * orchestration out of the script. tests/cleanup-passes.test.js runs it with
 * stand-ins, and then runs the real script end to end in a child process,
 * because moving the ordering here does not by itself prove main() uses it.
 *
 * ── A THIRD PASS (2026-10-07) ────────────────────────────────────────────
 *   withdrawals   the withdrawal records of sessions ALREADY purged, and the
 *                 purge's own markers (scripts/lib/withdrawal-retention.js).
 *
 * It stands where the metrics pass stands, for the same reason: it concerns
 * sessions that are gone, the session backup holds none of it, and so a
 * blocked gate must not stop it. It runs last, and always.
 */

/* 2 is the script's own: a bad retention window, or an uncaught failure. */
const EXIT_OK = 0;
const EXIT_ERRORS = 1;
const EXIT_BLOCKED = 3;

const METRIC_COUNTS = ["events", "usage", "sessionUsage", "dailyDays", "dailyUids"];

/* 3 wins over 1. A blocked run is already red, and the stale backup is what an
 * operator has to act on first. The cost is stated rather than hidden: 3 means
 * "the session purge was refused", NOT "and nothing else went wrong" — a
 * blocked run whose metrics pass also failed exits 3 too. Those failures are
 * not lost, but they are carried by the ERROR lines and the Summary count, not
 * by the code. */
function exitCodeFor(blocked, errors) {
  if (blocked) return EXIT_BLOCKED;
  return errors > 0 ? EXIT_ERRORS : EXIT_OK;
}

/**
 * Run the session pass (unless the gate blocks it), then ALWAYS the metrics
 * pass and the withdrawal sweep, print the summaries, and return the code the
 * caller must exit with.
 *
 * It returns the code rather than exiting so that it can be tested; the script
 * still ends in an explicit process.exit() — see
 * tests/ops-scripts-terminate.test.js for why that must not be dropped.
 *
 * @param {object} opts
 * @param {{block: boolean}} opts.gate   the backupGateReport() verdict
 * @param {function(): Promise<{kept:number, purged:number, errors:number}>} opts.purgeSessions
 * @param {function(): Promise<object>} opts.pruneMetrics  resolves to the
 *   pruneHfPatientMetrics() counts
 * @param {function(): Promise<{changes:number, errors:number}>} opts.sweepWithdrawals
 *   the withdrawal records and markers of sessions already purged. It prints
 *   its own report; `changes` is how many nodes it deleted, or would in a dry run
 * @param {boolean} [opts.confirm]       true = live run, otherwise dry-run wording
 * @param {number} [opts.metricsDays]    for the summary line only
 * @param {number} [opts.sessionCount]   sessions enumerated, for a blocked summary
 * @param {function} [opts.log]
 * @param {function} [opts.logError]
 * @returns {Promise<{blocked:boolean, kept:number, purged:number, errors:number,
 *                    metrics:object, exitCode:number}>}
 */
async function runCleanupPasses(opts) {
  const o = opts || {};
  const { gate, purgeSessions, pruneMetrics, sweepWithdrawals } = o;
  /* Checked BEFORE any pass runs. A missing metrics pass discovered after
   * the sessions were already purged would be found one irreversible step too
   * late, and a gate with no usable verdict must not be read as "not blocked":
   * `undefined` is falsy, so a plain `if (gate.block)` would fail OPEN. */
  if (!gate || typeof gate.block !== "boolean") {
    throw new TypeError("runCleanupPasses: `gate` must be the backupGateReport() verdict");
  }
  if (typeof purgeSessions !== "function" || typeof pruneMetrics !== "function" ||
      typeof sweepWithdrawals !== "function") {
    throw new TypeError("runCleanupPasses: `purgeSessions`, `pruneMetrics` and " +
      "`sweepWithdrawals` must all be functions");
  }
  const log = o.log || console.log;
  const logError = o.logError || console.error;
  const confirm = o.confirm === true;
  const verb = confirm ? "purged" : "would-purge";

  let kept = 0, purged = 0, errors = 0;
  if (gate.block) {
    /* The session pass is skipped WHOLE — not run in dry-run, not partially.
     * Nothing has been deleted at this point. */
    logError("BLOCKED: no sessions were purged. Metrics pruning still runs — it has " +
      "its own clock and the session backup does not cover it. So does the sweep of " +
      "withdrawal records left by sessions already purged.");
  } else {
    const s = await purgeSessions();
    kept = s.kept;
    purged = s.purged;
    errors = s.errors;
  }

  // hfPatient metrics: uid-keyed rows with no session to hang retention off, so
  // they are pruned on their own clock rather than with the session that
  // produced them. Runs when the gate blocked, and when the session pass had
  // errors — neither a stale backup nor an unrelated session failure may
  // silently skip a retention obligation.
  const m = await pruneMetrics();
  errors += m.errors;
  log("");
  log(`Metrics (hfPatient, > ${o.metricsDays}d): ${verb} ` +
    `${m.events} events, ${m.usage} uid buckets, ${m.sessionUsage} session buckets, ` +
    `${m.dailyDays} daily counters, ${m.dailyUids} spent uid nodes. ` +
    "global/<day> aggregates kept (no identifier).");

  // Withdrawal records and purge markers of sessions that are already gone.
  // Like the metrics, in no archive and on its own clock — so it too runs when
  // the gate blocked and when an earlier pass had errors. It prints its own
  // report, before the summary below.
  const w = await sweepWithdrawals();
  errors += w.errors;

  log("");
  /* A blocked run must not print "0 kept, 0 purged": no session was looked at,
   * and that line is what a clean run on an empty database prints. */
  log(gate.block
    ? `Summary: session purge BLOCKED by the backup gate — ${o.sessionCount} sessions left untouched, ${errors} errors.`
    : `Summary: ${kept} kept, ${purged} ${verb}, ${errors} errors.`);
  const metricsTotal = METRIC_COUNTS.reduce((sum, k) => sum + m[k], 0);
  if (!confirm && (purged > 0 || metricsTotal > 0 || w.changes > 0)) {
    log("(Set CLEANUP_CONFIRM=1 in the workflow env to actually delete.)");
  }

  return {
    blocked: gate.block, kept, purged, errors, metrics: m, withdrawals: w,
    exitCode: exitCodeFor(gate.block, errors)
  };
}

module.exports = { runCleanupPasses, EXIT_OK, EXIT_ERRORS, EXIT_BLOCKED };
