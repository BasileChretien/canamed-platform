/* tests/synthetic-uptime.test.js
 *
 * The synthetic uptime probe is the only thing watching production between
 * sessions, and its whole value is that a red run means "the site is down".
 * It did not mean that. Of the three non-success runs in the last 100
 * scheduled runs (879 runs total), NONE was an outage — and the probe did not
 * even execute in two of them. Diagnosed 2026-08-07 from the Actions API:
 *
 *   run 31117781423 (2026-08-06 15:53, cancelled)
 *     Got a runner at 15:55:20. `Set up job` ran 15:56:19 -> 15:58:52 and was
 *     cancelled 3 m 32 s after job start, against the job's
 *     `timeout-minutes: 3`. Steps completed: 1 of 3. THE PROBE NEVER RAN.
 *     Cause: `timeout-minutes` on a JOB is measured from job start, so it
 *     covers runner setup. Sizing it for the probe alone means infrastructure
 *     eats the budget. Fourth time in this repo (#275, #284, #286).
 *
 *   run 31124435945 (2026-08-06 17:53, failure)
 *     `runner_name: ""`, zero steps, pending 17:53:27 -> 18:08:29 (15 m 02 s),
 *     then killed. THE PROBE NEVER RAN. GitHub-side runner starvation; not
 *     fixable from here, only diagnosable — hence the operator note in the
 *     workflow header.
 *
 *   run 30941925842 (2026-08-04 19:08, failure)
 *     The probe DID run, and genuinely failed:
 *       [FAIL] splash           status=0 ms=0 error=Request timed out after 15000ms
 *       [FAIL] privacy.html     status=0 ms=0 error=Request timed out after 15000ms
 *       [OK]   healthcheck.html status=200 ms=214
 *     Two 15 s timeouts and then an instant 200 from the same host. A ~30 s
 *     blip from one Azure region, alerted as an outage, because the probe had
 *     no retry.
 *
 * So this file pins three things: the retry actually absorbs a transient and
 * still goes red on a real one, the failed-attempt log carries real elapsed
 * time (it was hardcoded to 0, which is why the 08-04 log cannot distinguish
 * a hang from an instant refusal), and the workflow's timeout budget cannot
 * silently drift back to the shape that killed the 15:53 run.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const probe = require("../scripts/synthetic-uptime-check.js");

const ROOT = path.join(__dirname, "..");
const WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "synthetic-uptime.yml");
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, "utf8");

/** A check shaped like the real splash check. */
const SPLASH = {
  url: "https://example.invalid/",
  label: "splash",
  expectStatuses: [200],
  mustContain: ["CaNaMED", "splash"]
};

const GOOD_BODY = "<title>CaNaMED</title><div id=\"splash\"></div>";

/** Never actually wait, so the retry tests run in milliseconds. */
const noSleep = async () => {};

/* ── the retry ────────────────────────────────────────────────────────── */

test("a healthy check is not retried", async () => {
  let calls = 0;
  const fetchUrl = async () => {
    calls++;
    return { status: 200, body: GOOD_BODY, ms: 214 };
  };
  const r = await probe.runOne(SPLASH, { fetchUrl, sleep: noSleep });
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.attempt, 1, "a passing check must return on the first attempt");
  assert.strictEqual(calls, 1, "a passing check must issue exactly one request");
});

test("a transient failure is absorbed instead of alerting (the 2026-08-04 shape)", async () => {
  let calls = 0;
  const fetchUrl = async () => {
    calls++;
    // Attempt 1 reproduces the observed failure verbatim; attempt 2 is the
    // 214 ms 200 that the very next request actually got that day.
    if (calls === 1) throw new Error("Request timed out after 15000ms");
    return { status: 200, body: GOOD_BODY, ms: 214 };
  };
  const r = await probe.runOne(SPLASH, { fetchUrl, sleep: noSleep });
  assert.strictEqual(
    r.pass,
    true,
    "a check that succeeds on retry must not fail the run — that alert was noise"
  );
  assert.strictEqual(r.attempt, 2, "the pass must be recorded as coming from attempt 2");
  assert.strictEqual(calls, 2, "the probe must stop retrying as soon as it passes");
});

test("a persistent failure still goes red", async () => {
  let calls = 0;
  const fetchUrl = async () => {
    calls++;
    throw new Error("Request timed out after 15000ms");
  };
  const r = await probe.runOne(SPLASH, { fetchUrl, sleep: noSleep });
  assert.strictEqual(r.pass, false, "retrying must not swallow a real outage");
  assert.strictEqual(calls, probe.ATTEMPTS, `all ${probe.ATTEMPTS} attempts must be spent`);
});

test("a persistent content mismatch still goes red", async () => {
  // 200 OK serving the wrong page is the failure mode a status-only probe
  // misses, so the retry must not turn it green either.
  let calls = 0;
  const fetchUrl = async () => {
    calls++;
    return { status: 200, body: "<title>Firebase Hosting Setup Complete</title>", ms: 12 };
  };
  const r = await probe.runOne(SPLASH, { fetchUrl, sleep: noSleep });
  assert.strictEqual(r.pass, false);
  assert.strictEqual(calls, probe.ATTEMPTS);
  assert.deepStrictEqual(r.missing, ["CaNaMED", "splash"]);
});

test("the backoff is actually waited between attempts", async () => {
  const waited = [];
  let calls = 0;
  const fetchUrl = async () => {
    calls++;
    throw new Error("nope");
  };
  await probe.runOne(SPLASH, { fetchUrl, sleep: async (ms) => { waited.push(ms); } });
  assert.deepStrictEqual(
    waited,
    probe.BACKOFF_MS.slice(0, probe.ATTEMPTS - 1),
    "one backoff before each retry, none before the first attempt"
  );
});

/* ── the failed-attempt log ───────────────────────────────────────────── */

test("a failed attempt reports real elapsed time, not 0", async () => {
  // `ms: 0` was hardcoded on the error path. That is why the 2026-08-04 log
  // reads `status=0 ms=0` for a request that had in fact hung for the full
  // 15 s — indistinguishable from an instant connection refusal, which has a
  // completely different cause.
  const fetchUrl = () => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("Request timed out after 15000ms")), 25);
  });
  const r = await probe.runOne(SPLASH, { fetchUrl, sleep: noSleep, attempts: 1 });
  assert.strictEqual(r.pass, false);
  assert.ok(
    r.ms >= 20,
    `the error path must report how long the attempt took; got ms=${r.ms}`
  );
});

test("formatResult marks a retried pass so the log shows it happened", () => {
  const line = probe.formatResult({
    label: "splash", pass: true, status: 200, ms: 214, attempt: 2, attempts: 3, missing: []
  });
  assert.match(line, /\[OK\]/);
  assert.match(line, /attempt 2\/3/);
});

/* ── the whole probe ──────────────────────────────────────────────────── */

test("main() exits 0 when a check recovers and 1 when it does not", async () => {
  const checks = [SPLASH];

  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error("Request timed out after 15000ms");
    return { status: 200, body: GOOD_BODY, ms: 9 };
  };
  const okCode = await probe.main({
    checks, fetchUrl: flaky, sleep: noSleep, log: () => {}, logErr: () => {}
  });
  assert.strictEqual(okCode, 0, "a recovered check must exit 0");

  const dead = async () => { throw new Error("ECONNREFUSED"); };
  const badCode = await probe.main({
    checks, fetchUrl: dead, sleep: noSleep, log: () => {}, logErr: () => {}
  });
  assert.strictEqual(badCode, 1, "an unrecoverable check must still exit 1");
});

/* ── the workflow's timeout budget ────────────────────────────────────── */

/** Text of the job before `steps:` (job-level keys only). */
function jobHead() {
  const i = WORKFLOW.search(/^ {4}steps:/m);
  assert.ok(i > 0, "synthetic-uptime.yml has no `    steps:` line");
  return WORKFLOW.slice(0, i);
}

/** Text of the `Run synthetic probe` step, up to the next step or EOF. */
function probeStep() {
  const start = WORKFLOW.search(/^ {6}- name: Run synthetic probe/m);
  assert.ok(start > 0, "synthetic-uptime.yml has no `- name: Run synthetic probe` step");
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.search(/^ {6}- /m);
  return next < 0 ? rest : rest.slice(0, next);
}

function minutes(text, what) {
  const m = text.match(/^ +timeout-minutes: *(\d+)/m);
  assert.ok(m, `${what} has no timeout-minutes`);
  return Number(m[1]);
}

test("the probe step carries its own timeout, so runner setup cannot eat it", () => {
  const step = minutes(probeStep(), "the `Run synthetic probe` step");
  const job = minutes(jobHead(), "the probe job");
  assert.ok(
    step < job,
    `the probe step's timeout (${step}m) must be tighter than the job's (${job}m) — ` +
      "a job-only cap is measured from JOB START and covers runner setup, which is " +
      "what cancelled run 31117781423 while `Set up job` was still running"
  );
  assert.ok(
    job - step >= 5,
    `the job cap (${job}m) must leave at least 5 minutes of headroom above the step ` +
      `cap (${step}m) for runner setup; \`Set up job\` alone has been observed at 2 m 33 s`
  );
});

test("the probe step's timeout is above the probe's own worst case", () => {
  const nChecks = probe.buildChecks("https://example.invalid").length;
  const backoff = probe.BACKOFF_MS
    .slice(0, probe.ATTEMPTS - 1)
    .reduce((a, b) => a + b, 0);
  const worstCaseMs = nChecks * (probe.ATTEMPTS * probe.TIMEOUT_MS + backoff);
  const stepMs = minutes(probeStep(), "the `Run synthetic probe` step") * 60_000;
  assert.ok(
    stepMs > worstCaseMs,
    `the probe can take up to ${Math.round(worstCaseMs / 1000)}s (${nChecks} checks x ` +
      `${probe.ATTEMPTS} attempts x ${probe.TIMEOUT_MS}ms + ${backoff}ms backoff) but the ` +
      `step is capped at ${Math.round(stepMs / 1000)}s — raise the cap or lower the retry budget`
  );
});

test("no concurrency group can evict a pending scheduled run", () => {
  assert.doesNotMatch(
    WORKFLOW,
    /^concurrency:/m,
    "GitHub keeps only ONE pending run per concurrency group, and this probe has been " +
      "observed pending for a full 15-minute tick (run 31124435945). A group here can only " +
      "turn runner starvation into a red run and an operator email. See the note in the file."
  );
});

test("the workflow's stated cadence matches its cron", () => {
  const cron = WORKFLOW.match(/^ *- cron: *"\*\/(\d+) \* \* \* \*"/m);
  assert.ok(cron, "synthetic-uptime.yml has no `*/N * * * *` schedule");
  const stated = WORKFLOW.match(/^# Runs every (\d+) minutes/m);
  assert.ok(stated, "synthetic-uptime.yml's header does not state its cadence");
  assert.strictEqual(
    stated[1],
    cron[1],
    `the header says every ${stated[1]} minutes but the cron runs every ${cron[1]}. ` +
      "The probe script's header claimed a 5-minute cron for a */15 schedule until 2026-08-07; " +
      "this guard exists so that drift fails a test instead of misleading the next reader."
  );
});
