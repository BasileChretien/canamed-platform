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
const http = require("node:http");

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

test("a slow-drip response cannot outlive its deadline", async (t) => {
  // The whole retry budget — and therefore the workflow's step cap derived
  // from it — assumes a request cannot exceed its timeout. `req.setTimeout`
  // alone does NOT give that: it is a socket-IDLE timeout that every received
  // byte resets. Measured locally 2026-08-07 against a server writing one byte
  // every 200 ms, a 1 000 ms `setTimeout` had still not fired after 5 000 ms.
  //
  // This runs against a REAL server that trickles forever, so it fails if the
  // wall-clock deadline is ever removed rather than merely asserting it exists.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    const drip = setInterval(() => { try { res.write("."); } catch (_e) { /* closed */ } }, 20);
    req.on("close", () => clearInterval(drip));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });

  const check = {
    url: `http://127.0.0.1:${server.address().port}/`,
    label: "drip",
    expectStatuses: [200],
    mustContain: ["never appears"],
    timeoutMs: 300
  };

  const startedAt = Date.now();
  const raced = await Promise.race([
    probe.runOne(check, { sleep: noSleep, attempts: 1 }).then(r => ({ done: true, r })),
    new Promise((res) => setTimeout(() => res({ done: false }), 4000))
  ]);
  const elapsed = Date.now() - startedAt;

  assert.ok(
    raced.done,
    "the drip-feed request was never cut off after 4 s against a 300 ms timeout — " +
      "the request has no wall-clock deadline, so `worst case = attempts x timeoutMs` " +
      "is not enforced and the workflow's step cap is sized against a guarantee that " +
      "does not hold"
  );
  assert.strictEqual(raced.r.pass, false);
  assert.ok(elapsed < 3000, `expected the deadline to cut in near 300 ms; took ${elapsed}ms`);
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

/* ── the backend checks ───────────────────────────────────────────────── */
/*
 * Checks 1-3 only prove Firebase Hosting is serving files, and Hosting has
 * never failed. Both production outages this platform has actually had were
 * in its dependencies, and the probe was GREEN through both:
 *
 *   2026-05-30  RTDB App Check -> Enforce; grecaptcha.execute() hangs, no
 *               token mints, the DB rejects all access. Clients hang on
 *               "Checking…" then "Couldn't reach the session server".
 *   2026-06-03  hfPatient App Check likewise; the chat fell back to the stub
 *               patient on every message, silently.
 *
 * In both cases the HTML served perfectly. So the useful signal is not "is
 * Hosting up" but "do the backends answer" — and for an unauthenticated
 * prober, a REJECTION is the healthy answer. Both bodies below were verified
 * against production on 2026-08-07.
 */

const DEP = (label) => {
  const c = probe.buildChecks("https://example.invalid").find(x => x.label === label);
  assert.ok(c, `no ${label} check in buildChecks()`);
  return c;
};

test("the rtdb check demands the denial BODY, not just a 401", async () => {
  const rtdb = DEP("rtdb");
  assert.deepStrictEqual(rtdb.expectStatuses, [401]);
  assert.deepStrictEqual(rtdb.mustContain, ["Permission denied"]);

  // The failure that matters: a 401 from something OTHER than a live ruleset
  // (a proxy, a parked domain, a Google error page) must not read as healthy.
  const wrong = async () => ({ status: 401, body: "<html>401 Unauthorized</html>", ms: 5 });
  const bad = await probe.runOne(rtdb, { fetchUrl: wrong, sleep: noSleep });
  assert.strictEqual(bad.pass, false, "a 401 with the wrong body must fail");

  const right = async () => ({ status: 401, body: "{\n  \"error\" : \"Permission denied\"\n}", ms: 607 });
  const ok = await probe.runOne(rtdb, { fetchUrl: right, sleep: noSleep });
  assert.strictEqual(ok.pass, true, "the real production response must pass");
});

test("the hfPatient check POSTs and demands the handler's own error", async () => {
  const fn = DEP("hfPatient");
  assert.strictEqual(fn.method, "POST", "a GET does not reach a callable's handler");
  assert.deepStrictEqual(fn.expectStatuses, [401]);
  // `auth required` is the HANDLER's message. Getting it proves the request
  // reached the function rather than being turned away in front of it — which
  // is exactly what App Check Enforce did on 2026-06-03.
  assert.deepStrictEqual(fn.mustContain, ["auth required", "UNAUTHENTICATED"]);

  const enforced = async () => ({ status: 401, body: "{\"error\":{\"message\":\"Unauthenticated\",\"status\":\"UNAUTHENTICATED\"}}", ms: 5 });
  const bad = await probe.runOne(fn, { fetchUrl: enforced, sleep: noSleep });
  assert.strictEqual(
    bad.pass,
    false,
    "a 401 that is NOT the handler's own `auth required` means something in front of the " +
      "function rejected the call — that is the 2026-06-03 incident and must go red"
  );

  const real = async () => ({ status: 401, body: "{\"error\":{\"message\":\"auth required\",\"status\":\"UNAUTHENTICATED\"}}", ms: 311 });
  const ok = await probe.runOne(fn, { fetchUrl: real, sleep: noSleep });
  assert.strictEqual(ok.pass, true, "the real production response must pass");
});

test("attemptOne forwards method, body and per-check timeout to the transport", async () => {
  // Without this the hfPatient check would silently degrade to a GET, which
  // does not reach a callable's handler and would fail for the wrong reason.
  const fn = DEP("hfPatient");
  let seen = null;
  const spy = async (_url, opts) => { seen = opts; return { status: 401, body: "auth required UNAUTHENTICATED", ms: 1 }; };
  await probe.attemptOne(fn, spy);
  assert.strictEqual(seen.method, "POST");
  assert.strictEqual(seen.body, JSON.stringify({ data: {} }));
  assert.strictEqual(seen.timeoutMs, probe.DEP_TIMEOUT_MS);
  // Headers matter as much as the method: a callable that does not receive
  // `Content-Type: application/json` can be rejected BEFORE the handler runs,
  // and this check's whole value is that it reaches the handler.
  assert.deepStrictEqual(seen.headers, { "Content-Type": "application/json" });
});

test("no check's mustContain is vacuous", async () => {
  // The pass rule used to be implicit — "any status other than 200 skips the
  // body assertion" — which silently made every non-200 check's `mustContain`
  // decorative. That is the same defect #299 found in the rules suite: an
  // assertion that would pass with the thing it guards deleted.
  //
  // This is deliberately GENERIC rather than naming rtdb and hfPatient, so a
  // future backend check cannot be added into the same trap. Each check that
  // declares content is served its own expected status with an EMPTY body; a
  // check that still passes is not really asserting anything.
  const checks = probe.buildChecks("https://example.invalid");
  for (const c of checks) {
    if (!c.mustContain.length) continue;
    if (Array.isArray(c.tolerate) && c.tolerate.length) continue;
    for (const status of c.expectStatuses) {
      const emptyBody = async () => ({ status, body: "", ms: 1 });
      const r = await probe.runOne(c, { fetchUrl: emptyBody, sleep: noSleep, attempts: 1 });
      assert.strictEqual(
        r.pass,
        false,
        `${c.label} passes on status ${status} with an EMPTY body, so its ` +
          `mustContain (${JSON.stringify(c.mustContain)}) is vacuous`
      );
    }
  }
});

test("`tolerate` is explicit, and only healthcheck.html has it", async () => {
  const checks = probe.buildChecks("https://example.invalid");
  const tolerant = checks.filter(c => Array.isArray(c.tolerate) && c.tolerate.length);
  assert.deepStrictEqual(
    tolerant.map(c => c.label),
    ["healthcheck.html"],
    "only the not-yet-shipped healthcheck page may skip its body assertion"
  );

  // and the tolerance itself still works
  const hc = DEP("healthcheck.html");
  const notFound = async () => ({ status: 404, body: "nope", ms: 3 });
  const r = await probe.runOne(hc, { fetchUrl: notFound, sleep: noSleep });
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.tolerated, true);
});

test("the probed backend URLs are the ones the app itself resolves", () => {
  // A region or project change that missed the probe would leave it happily
  // watching an endpoint nothing uses — green while production is dark.
  const cfg = fs.readFileSync(
    path.join(ROOT, "docs/Third_session/PBL_platform/firebase-config.js"), "utf8");
  const fns = fs.readFileSync(
    path.join(ROOT, "docs/Third_session/PBL_platform/functions/index.js"), "utf8");

  const dbUrl = cfg.match(/^\s*databaseURL:\s*"([^"]+)"/m);
  const projectId = cfg.match(/^\s*projectId:\s*"([^"]+)"/m);
  assert.ok(dbUrl, "firebase-config.js has no databaseURL");
  assert.ok(projectId, "firebase-config.js has no projectId");

  const hfStart = fns.indexOf("exports.hfPatient = onCall({");
  assert.ok(hfStart > 0, "functions/index.js has no `exports.hfPatient = onCall({`");
  const hfRegion = fns.slice(hfStart).match(/^\s*region:\s*"([^"]+)"/m);
  assert.ok(hfRegion, "the hfPatient onCall block declares no region");

  assert.strictEqual(
    probe.RTDB_URL,
    dbUrl[1].replace(/\/$/, ""),
    "the probe's RTDB_URL must be the databaseURL the client connects to"
  );
  assert.strictEqual(
    probe.FN_BASE,
    `https://${hfRegion[1]}-${projectId[1]}.cloudfunctions.net`,
    "the probe's function base must match hfPatient's deployed region and the project id"
  );
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
  // Uses the script's OWN arithmetic, not a copy of it, so adding a check or
  // retuning the retry budget cannot drift away from the cap it needs.
  const checks = probe.buildChecks("https://example.invalid");
  const worst = probe.worstCaseMs(checks);
  const stepMs = minutes(probeStep(), "the `Run synthetic probe` step") * 60_000;
  assert.ok(
    stepMs > worst,
    `the probe can take up to ${Math.round(worst / 1000)}s across its ${checks.length} checks ` +
      `(${probe.ATTEMPTS} attempts each) but the step is capped at ` +
      `${Math.round(stepMs / 1000)}s — raise the cap or lower the retry budget`
  );
});

test("the probe's checkout does not persist the workflow token", () => {
  // actions/checkout writes the token into .git/config by default, leaving it
  // readable by every later step. Nothing here runs a git command after the
  // checkout, so there is no reason to keep it.
  const start = WORKFLOW.search(/^ {6}- uses: actions\/checkout@/m);
  assert.ok(start > 0, "synthetic-uptime.yml has no actions/checkout step");
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.search(/^ {6}- /m);
  const checkoutStep = next < 0 ? rest : rest.slice(0, next);
  assert.match(
    checkoutStep,
    /persist-credentials: false/,
    "the probe only reads the checked-out source; the workflow token must not be persisted"
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

test("the pre-session gate the workflow points at actually exists", () => {
  // The header tells the next operator NOT to treat this cron as the
  // pre-session check, and names healthcheck.html as the thing that is. That
  // redirection is only safe while the page exists and still says so — if it
  // were removed or repurposed, the workflow would be quietly pointing an
  // operator at nothing, which is worse than not mentioning it. The measured
  // cadence numbers in that header cannot be pinned by a test; this can.
  assert.match(
    WORKFLOW,
    /healthcheck\.html/,
    "the header must name the on-demand pre-session page"
  );
  const page = path.join(ROOT, "docs", "Third_session", "PBL_platform", "healthcheck.html");
  assert.ok(fs.existsSync(page), "healthcheck.html is referenced by the workflow but does not exist");
  const html = fs.readFileSync(page, "utf8");
  assert.match(
    html,
    /before each live session/,
    "healthcheck.html no longer presents itself as the pre-session check, so the " +
      "workflow header must stop redirecting operators to it"
  );
  for (const row of ["firebase-db", "app-check"]) {
    assert.match(
      html,
      new RegExp(`data-check="${row}"`),
      `the header claims healthcheck.html covers ${row}, but that row is gone`
    );
  }
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
