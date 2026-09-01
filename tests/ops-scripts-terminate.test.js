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
