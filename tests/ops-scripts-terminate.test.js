/* tests/ops-scripts-terminate.test.js
 *
 * Every scheduled ops script must END ITS OWN PROCESS.
 *
 * These scripts open a firebase-admin Realtime Database connection, and that
 * connection keeps the Node event loop alive indefinitely. Falling off the end
 * of main() therefore does not exit — the job runs until `timeout-minutes`
 * kills it. GitHub records a timeout as **"cancelled"**, not "failure", so it
 * sends no failure mail and does not read as red at a glance.
 *
 * That is not hypothetical. `cleanup-expired-credentials` set `process.exitCode`
 * and returned, and **all 11 of its scheduled runs were cancelled at the same
 * step**. It had never once completed, so expired certificate records were never
 * purged — a GDPR retention duty that silently did nothing from the day it
 * shipped. It was found on 2026-09-01 by reading the run list while waiting on
 * an unrelated deploy, which is not a detection strategy.
 *
 * `process.exitCode = 1` looks like it does the job and does not. That is the
 * specific trap this file exists to catch, so it is asserted against explicitly
 * rather than only checking that some exit call is present somewhere.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* The scripts a workflow runs on a cron. Derived from the workflows rather than
   hardcoded, so a new scheduled job is covered the day it is added — the whole
   failure here was a job nobody was watching. */
function scheduledScripts() {
  const dir = path.join(ROOT, ".github", "workflows");
  const out = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    const yml = fs.readFileSync(path.join(dir, f), "utf8");
    const live = yml.split("\n").some((l) => /^\s*-\s*cron:/.test(l) && !/^\s*#/.test(l));
    if (!live) continue;
    for (const m of yml.matchAll(/node\s+(scripts\/[\w./-]+\.js)/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/* THE RULE APPLIES ONLY TO SCRIPTS THAT OPEN A DATABASE CONNECTION, and getting
   that scoping right mattered: the first version of this file required an
   explicit exit from every scheduled script and immediately failed on
   scripts/synthetic-uptime-check.js — which uses plain fetch, holds nothing
   open, exits by itself, and whose runs all succeed. A guard that reports
   healthy code as broken is worse than no guard: it trains people to ignore it.

   firebase-admin is the thing that keeps the loop alive, so that is the
   precondition. One level of require() is followed, which covers the lib/
   helpers the ops scripts share. */
function holdsDatabaseConnection(rel, seen = new Set()) {
  if (seen.has(rel)) return false;
  seen.add(rel);
  let src;
  try {
    src = read(rel);
  } catch {
    return false;
  }
  if (/require\(\s*["'`]firebase-admin/.test(src)) return true;
  for (const m of src.matchAll(/require\(["'](\.\/[\w./-]+)["']\)/g)) {
    const dep = path.posix.join(path.posix.dirname(rel), m[1]);
    if (holdsDatabaseConnection(dep.endsWith(".js") ? dep : dep + ".js", seen)) return true;
  }
  return false;
}

/* Arrow, not a bare reference: Array.filter passes (element, index, array), so
   `.filter(holdsDatabaseConnection)` would hand the INDEX to the `seen`
   recursion guard and throw on `seen.has`. */
const atRisk = () => scheduledScripts().filter((rel) => holdsDatabaseConnection(rel));

test("the derivation finds the scheduled scripts that hold a connection", () => {
  /* Anti-vacuity: the assertions below iterate this list, so an empty one would
     pass while checking nothing. */
  const scripts = atRisk();
  assert.ok(scripts.length >= 2,
    "expected several scheduled scripts using firebase-admin, found: " +
      JSON.stringify(scripts));
  /* And the exclusion is real, not an accident of the regex: the probe must be
     scheduled but NOT in the at-risk set. */
  const all = scheduledScripts();
  assert.ok(all.includes("scripts/synthetic-uptime-check.js"),
    "the probe should still be found as a scheduled script");
  assert.ok(!atRisk().includes("scripts/synthetic-uptime-check.js"),
    "the probe holds no database connection and must not be required to exit " +
      "explicitly — see the note above holdsDatabaseConnection()");
});

test("every scheduled script that holds a connection exits explicitly", () => {
  for (const rel of atRisk()) {
    assert.match(
      read(rel), /process\.exit\(/,
      rel + " never calls process.exit(). firebase-admin holds the event loop " +
        "open, so this job will run to its timeout and be recorded as CANCELLED " +
        "— which sends no failure mail. See the header of this file."
    );
  }
});

test("none of them relies on process.exitCode alone", () => {
  /* The exact shape of the bug. `process.exitCode = 1` sets the code that WOULD
     be used if the process ended by itself — and with an open RTDB handle it
     never does. Allowed only alongside a real exit call. */
  for (const rel of atRisk()) {
    const src = read(rel);
    if (!/process\.exitCode\s*=/.test(src)) continue;
    assert.match(
      src, /process\.exit\(/,
      rel + " sets process.exitCode but never calls process.exit(). That does not " +
        "end a process holding a database connection; the job will hang until its " +
        "timeout and be reported as cancelled rather than failed."
    );
  }
});

test("the credential purge in particular exits, and passes its error state on", () => {
  /* Named specifically because this is the job that had never completed: a
     failure here should say which one regressed, not just that one did. */
  const src = read("scripts/cleanup-expired-credentials.js");
  assert.match(src, /process\.exit\(res\.errors \? 1 : 0\)/,
    "the credential purge must exit explicitly AND still report failed deletions " +
      "— exiting 0 unconditionally would hide them instead of hanging on them");
});

/* ---------------------------------------------------------------------------
 * The same rule, widened beyond the cron (2026-09-03).
 *
 * The population above is "scripts a workflow runs on a cron", because a hang
 * there is invisible — recorded as cancelled, no mail, nobody watching. But the
 * HAZARD is the firebase-admin connection, not the schedule, and operator-run
 * tools have it too: `scripts/erase-participant.js` and
 * `scripts/restore-sessions.js` were added for Annex VI G12, are run by hand, and
 * so appeared in no workflow and were covered by nothing.
 *
 * ⚠️ WHAT THIS CANNOT CATCH, stated because a guard read as stronger than it is
 * becomes a reason not to look. These are text checks. They prove a script has
 * *an* exit; they CANNOT prove the TERMINAL path exits. A script that exits in
 * an early branch — a dry-run return, a validation failure — and then falls off
 * the end of main() on the success path would satisfy every assertion here and
 * still hang. Verified, not assumed: replacing the final
 * `.then(() => process.exit(0))` in restore-sessions.js with `process.exitCode`
 * leaves this file green, because its dry-run branch still exits.
 * Distinguishing the two needs real parsing or an actual run against a
 * database. The residual risk is named here instead of being papered over.
 * ------------------------------------------------------------------------- */

function allScriptsHoldingAConnection() {
  const dir = path.join(ROOT, "scripts");
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith(".js"))
    .map((n) => "scripts/" + n)
    .filter((rel) => holdsDatabaseConnection(rel))
    .sort();
}

test("EVERY script holding a database connection exits explicitly, cron or not", () => {
  const scripts = allScriptsHoldingAConnection();
  /* Anti-vacuity, and a real check: this set must be a superset of the
     scheduled one, or the derivation has broken rather than found nothing. */
  assert.ok(scripts.length >= atRisk().length,
    "the all-scripts derivation found fewer scripts than the scheduled one, " +
    "which is impossible unless it is broken: " + JSON.stringify(scripts));
  assert.ok(scripts.length >= 5, "derivation found almost nothing — it broke");

  for (const rel of scripts) {
    assert.match(read(rel), /process\.exit\(/,
      rel + " holds a firebase-admin connection and never calls process.exit(). " +
      "It will hang instead of finishing. `process.exitCode = n` is NOT enough — " +
      "that is the exact trap that left cleanup-expired-credentials with 11 " +
      "cancelled runs and zero completions.");
  }
});

test("each of them can exit SUCCESSFULLY, not only on error", () => {
  /* A script whose only exits are failure paths finishes a clean run by
     hanging — the success case being the one that hangs is worse than the
     reverse, because the failure case at least gets looked at.
     The test accepts a computed code, because two scripts legitimately use one:
     `process.exit(errors > 0 ? 1 : 0)` and `process.exit(res.errors ? 1 : 0)`.
     So the rule is "an exit whose argument is not a non-zero literal". */
  for (const rel of allScriptsHoldingAConnection()) {
    const calls = [...read(rel).matchAll(/process\.exit\(([^)]*)\)/g)].map((m) => m[1].trim());
    const nonFailure = calls.filter((arg) => !/^[1-9]\d*$/.test(arg));
    assert.ok(nonFailure.length > 0,
      rel + " only ever exits with a non-zero literal, so a successful run has " +
      "no way to end. Found: " + JSON.stringify(calls));
  }
});

test("the operator-run erasure tools are actually in that set", () => {
  /* Named explicitly. The widening only helps if these two are what it caught,
     and a derivation that quietly stopped matching them would stay green while
     covering nothing new. */
  const scripts = allScriptsHoldingAConnection();
  for (const rel of ["scripts/erase-participant.js", "scripts/restore-sessions.js"]) {
    assert.ok(scripts.includes(rel),
      rel + " is not in the connection-holding set. If it stopped using " +
      "firebase-admin that is fine — remove it from this list in the same " +
      "change. If it still uses it, the derivation is broken.");
  }
});
