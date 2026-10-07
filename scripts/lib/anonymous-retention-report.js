"use strict";
/* What the anonymous-account retention job PRINTS, and the exit code it ends
 * with — issue #347.
 *
 * Kept out of the CLI on purpose. scripts/cleanup-anonymous-accounts.js cannot
 * be loaded without firebase-admin and credentials, so anything written there
 * is unreachable from the unit suite; and these two functions are the ones
 * whose mistakes are invisible in use. A wrong exit code turns a failed
 * deletion into a green run, and the output goes to a world-readable log.
 *
 * Both take the report the job returns, which holds COUNTS and nothing else —
 * so nothing here can print a uid or a session code, because it is never
 * handed one.
 */

/**
 * 0 only when everything asked for was done. Anything short of that is 1:
 * a database write that failed, an account that could not be deleted, accounts
 * left in place because their records could not be removed first, or a read
 * that had to be skipped (which means something was not looked at).
 */
function exitCodeFor(report) {
  const failed =
    report.written.failedUpdates > 0 ||
    report.auth.failed > 0 ||
    report.auth.skipped ||
    report.records.readErrors > 0 ||
    report.rateLimits.readErrors > 0;
  return failed ? 1 : 0;
}

/**
 * @param {object} report from runAnonymousRetention()
 * @param {object} opts   { confirm:boolean, days:number, sweepOrphans:boolean }
 * @returns {string[]} the lines to print
 */
function formatReport(report, opts) {
  const a = report.accounts, r = report.records, l = report.rateLimits;
  const out = [];
  out.push(`Sessions:    ${report.sessions} live, whose members and creators are never removed`);
  out.push(`Accounts:    ${a.total} total — ${a.anonymous} anonymous, ${a.named} signed-in (untouched)`);
  out.push(`Anonymous:   ${a.expired} idle > ${opts.days}d, ${a.kept} kept`);
  out.push(`  kept because: ${a.protected} still in a live session or allowlisted, ` +
    `${a.contradicted} the database contradicts, ${a.recheckChanged} changed since the listing, ` +
    `${a.undated} with no readable last-use date, ${a.unusable} with an unusable uid`);
  if (a.recheckGone) out.push(`  ${a.recheckGone} no longer had an account when re-checked`);
  out.push(`Records:     ${r.expiredPaths} users/ node(s) of those accounts`);
  out.push(`History:     ${r.historyPaths} other anonymous account(s) with a users/ node`);
  if (r.historyPaths) {
    out.push("             Expected on the first live run only. Anonymous joiners stopped");
    out.push("             getting a history record on 2026-08-25 (#348); a count that");
    out.push("             comes back afterwards means that write has regressed.");
  }
  out.push(`Orphans:     ${r.orphans.users} users, ${r.orphans.scenarios} scenarios with no account — ` +
    (opts.sweepOrphans ? `${r.orphanPaths} included` : "reported only (ANON_SWEEP_ORPHANS=1 to remove)"));
  if (r.skippedKeys) out.push(`Skipped:     ${r.skippedKeys} key(s) that are not a well-formed uid`);
  if (r.readErrors) {
    out.push(`Unreadable:  ${r.readErrors} users/ node(s) could not be read; their accounts were spared`);
  }
  out.push(`Rate limits: ${l.staleUid} per-uid + ${l.staleSession} per-session bucket(s) past ` +
    `their window, ${l.kept} current` +
    (l.unparsed ? `, ${l.unparsed} in no known format` : "") +
    (l.readErrors ? ` — ${l.readErrors} READ(S) FAILED, those counters were not swept` : ""));
  out.push(`Paths:       ${report.paths} database path(s) — ${opts.confirm ? "deleted" : "would delete"}`);
  if (!opts.confirm) {
    if (report.paths + a.expired > 0) out.push("(Set ANON_CONFIRM=1 to actually delete.)");
    return out;
  }

  const w = report.written, au = report.auth;
  out.push(`Written:     ${w.paths} path(s) removed` +
    (w.failedUpdates ? `, ${w.failedUpdates} update(s) FAILED [${w.errorCodes.join(", ")}]` : ""));
  if (au.skipped) {
    out.push("Auth:        NO account deleted — a database write failed, and an account");
    out.push("             is only removed after its records. The next run retries both.");
  } else {
    out.push(`Auth:        ${au.deleted} account(s) deleted` +
      (au.failed ? `, ${au.failed} FAILED` : "") +
      (au.httpStatuses.length ? ` [HTTP ${au.httpStatuses.join(", ")}]` : "") +
      (au.networkErrors ? ` [${au.networkErrors} request(s) did not complete]` : ""));
  }
  return out;
}

module.exports = { exitCodeFor, formatReport };
