#!/usr/bin/env node
/* synthetic-uptime-check.js
 *
 * External health probe for the CaNaMED platform. Runs from GitHub Actions
 * on the cron in `.github/workflows/synthetic-uptime.yml` so we know the
 * production site is reachable from outside Firebase's network — catches
 * OAuth/Hosting outages we'd otherwise discover at session-start.
 *
 * Checks:
 *   1. GET  https://canamed-69785.web.app/                      (splash)
 *   2. GET  https://canamed-69785.web.app/privacy.html          (privacy)
 *   3. GET  https://canamed-69785.web.app/healthcheck.html      (smoke page; tolerated 404 if not yet shipped)
 *   4. GET  <rtdb>/.json                                        (database reachable + rules loaded)
 *   5. POST <fn>/hfPatient                                      (LLM-patient callable reachable)
 *
 * 1-3 must return HTTP 200 and contain the brand mark and title. 4 and 5 must
 * return 401 with a SPECIFIC body — see below. If any check fails, the script
 * exits 1, the GitHub Actions job goes red and the operator gets an email.
 *
 * ── WHY CHECKS 4 AND 5 EXIST (2026-08-07) ────────────────────────────────
 * Checks 1-3 only prove Firebase Hosting is serving files. Hosting has never
 * failed. Both production outages this platform has actually had were in its
 * DEPENDENCIES, and this probe was green through both of them:
 *
 *   2026-05-30  RTDB App Check switched to Enforce. reCAPTCHA's
 *               grecaptcha.execute() intermittently hangs, so no App Check
 *               token mints, so the DB rejected ALL access, realtime and
 *               REST. Every client hung on "Checking…" and then "Couldn't
 *               reach the session server". The HTML still served perfectly.
 *   2026-06-03  hfPatient App Check likewise. The chat fell back to the stub
 *               patient on EVERY message — silently, because the bridge
 *               treats any failure as "backend unavailable". Again the HTML
 *               served perfectly.
 *
 * So a facilitator could open a green dashboard and still be unable to run a
 * session. Both new checks are unauthenticated, which is what makes them
 * usable from CI, and in both cases A REJECTION IS THE HEALTHY ANSWER:
 *
 *   rtdb       401 {"error":"Permission denied"}   <- root is `.read: false`,
 *              so this proves DNS + TLS + the database instance + a loaded
 *              ruleset. Verified live 2026-08-07: 401 in 0.6 s.
 *   hfPatient  401 {"error":{"message":"auth required",
 *                            "status":"UNAUTHENTICATED"}}
 *              <- `auth required` is the HANDLER's own message, so getting it
 *              proves the request reached the function: deployed, right
 *              region, and NOT rejected by an App Check layer in front of it.
 *              Verified live 2026-08-07.
 *
 * That last clause is the point, and it is not a side effect. CLAUDE.md
 * already names this exact tokenless POST as the only CLI-verifiable way to
 * know whether App Check is enforcing on hfPatient, because `.env` is
 * git-ignored and the setting cannot be read from the repo. It is currently a
 * manual step in a document that has gone stale before — which is what the
 * file's own STATUS-CLAIM RULE was written about. Running it every 15 minutes
 * means re-enabling Enforce cannot happen silently: the probe goes red, and
 * the operator either reverts or updates this check in the same change.
 *
 * NOT THE ONLY BACKEND COVERAGE, and deliberately not a replacement for it:
 * healthcheck.html is an on-demand pre-session page ("open it ~30 minutes
 * before each live session") whose `firebase-db` and `app-check` rows probe
 * these same dependencies FROM THE BROWSER, with real auth. That is the
 * richer signal and the one a facilitator should act on. What it cannot be is
 * continuous — it only runs when a human opens it. These checks are the
 * unattended, credential-free half, watching between sessions from outside
 * Google's network. Note healthcheck.html does not cover hfPatient at all.
 *
 * NB these checks cost ~96 RTDB denials and ~96 function invocations a day at
 * the NOMINAL cadence (~2.9k/month against a 2M/month free tier, returning 64
 * bytes) — inside the tier the $1 budget alert guards. The real figure is far
 * lower: measured across the last 100 scheduled runs (2026-07-29..08-07) only
 * 13% of ticks actually fired, a median of 107 min between probes, because
 * GitHub drops scheduled runs on public repos under load.
 *
 * That 107 min is an INTERVAL BETWEEN RUNS, not a detection latency — nothing
 * here was sampled against a known outage. It bounds when the backends are
 * LOOKED AT, and the gap it leaves is not merely "noticed late": an outage
 * shorter than the current interval can begin and end between two probes and
 * never be observed at all. Which is the other reason healthcheck.html above
 * is the pre-session gate and this is not.
 *
 * ── WHY THERE IS A RETRY (2026-08-07) ────────────────────────────────────
 * An alert is only worth having if a red run means "the site is down". Over
 * the last 100 scheduled runs there were three non-success runs, and NOT ONE
 * of them was an outage:
 *
 *   2026-08-06 15:53 (cancelled) — the job got a runner but `Set up job`
 *     alone took 2 m 33 s and the job's `timeout-minutes: 3` killed it.
 *     THE PROBE NEVER EXECUTED. Fixed in the workflow: the tight bound now
 *     sits on the probe STEP, and the job cap is loose enough that runner
 *     setup cannot consume it. Same defect class as #275/#284/#286.
 *   2026-08-06 17:53 (failure) — the run sat pending 15 m 02 s, never got a
 *     runner at all (`runner_name` empty, zero steps) and was killed.
 *     THE PROBE NEVER EXECUTED. Nothing in this repo can prevent that; it is
 *     GitHub-side runner starvation. Recorded here so the next operator does
 *     not re-diagnose it as an outage.
 *   2026-08-04 19:08 (failure) — the probe DID run, and this is the one this
 *     retry addresses. Two consecutive requests timed out at 15 s each and
 *     then the THIRD request returned 200 in 214 ms:
 *         [FAIL] splash        status=0 ms=0 error=Request timed out after 15000ms
 *         [FAIL] privacy.html  status=0 ms=0 error=Request timed out after 15000ms
 *         [OK]   healthcheck.html status=200 ms=214
 *     A ~30 s blip from one Azure region is not an outage a facilitator would
 *     ever notice, but it emailed the operator as if it were.
 *
 * So: each check is attempted up to ATTEMPTS times with a backoff, and only
 * fails the run when EVERY attempt fails. A healthy check still returns on
 * attempt 1, so the normal run is unchanged (~1 s); only the pathological
 * path is slow, which is exactly when patience is wanted. Retries cover
 * content mismatches too, not just network errors — a truncated body reads
 * as a content mismatch, and retrying a genuinely wrong page costs a bounded
 * few seconds and still goes red.
 *
 * `ms` is now the real elapsed time on the ERROR path as well. It used to be
 * hardcoded to 0, which is why the 2026-08-04 log above cannot distinguish
 * "hung for the full 15 s" from "refused instantly" — the two have completely
 * different causes.
 *
 * No external dependencies — uses node's built-in https module so it runs
 * without `npm install`. Works on node >= 18.
 *
 * Usage:
 *   node scripts/synthetic-uptime-check.js
 *   PROBE_URL=https://staging.example node scripts/synthetic-uptime-check.js
 */

"use strict";

const http = require("node:http");
const https = require("node:https");

const BASE = (process.env.PROBE_URL || "https://canamed-69785.web.app").replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

// Attempts PER CHECK, and the wait before attempt 2 and attempt 3. Worst case
// for one check is 3 x 15 s + 2 s + 5 s = 52 s, so all three checks cannot
// exceed ~2 m 36 s. The workflow's probe-step timeout must stay above that —
// `tests/synthetic-uptime.test.js` pins the two together.
const ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 5_000];

// The two backends the platform cannot run without. They answer in well under
// a second, so they get a tighter per-request timeout than the HTML pages.
// `tests/synthetic-uptime.test.js` pins both URLs to the config that the app
// itself resolves, so a region or project change fails a unit test rather than
// leaving the probe watching an endpoint nothing uses.
const RTDB_URL = (process.env.PROBE_RTDB_URL ||
  "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/$/, "");
const FN_BASE = (process.env.PROBE_FN_URL ||
  "https://europe-west1-canamed-69785.cloudfunctions.net").replace(/\/$/, "");
const DEP_TIMEOUT_MS = 10_000;

function buildChecks(base, rtdb, fnBase) {
  const db = (rtdb || RTDB_URL).replace(/\/$/, "");
  const fn = (fnBase || FN_BASE).replace(/\/$/, "");
  return [
    {
      url: base + "/",
      label: "splash",
      expectStatuses: [200],
      mustContain: ["CaNaMED", "splash"]
    },
    {
      url: base + "/privacy.html",
      label: "privacy.html",
      expectStatuses: [200],
      mustContain: ["Privacy Policy", "GDPR"]
    },
    {
      // healthcheck page is shipped in a separate PR; treat 404 as tolerable
      // here (probe still records it, just doesn't fail the run on 404)
      url: base + "/healthcheck.html",
      label: "healthcheck.html",
      expectStatuses: [200, 404],
      tolerate: [404],
      mustContain: []
    },
    {
      // A DENIAL IS THE HEALTHY ANSWER. Root is `.read: false`, so an
      // unauthenticated REST read must come back 401 "Permission denied" —
      // which proves DNS, TLS, the database instance and a loaded ruleset all
      // at once. An unreachable or rule-less database answers differently
      // (5xx, a timeout, or — the interesting one — data).
      url: db + "/.json",
      label: "rtdb",
      expectStatuses: [401],
      mustContain: ["Permission denied"],
      timeoutMs: DEP_TIMEOUT_MS
    },
    {
      // Likewise: `auth required` is the HANDLER's own error, so receiving it
      // proves the request reached the function — right region, deployed, not
      // rejected by a layer in front of it. See the header for why that last
      // clause is the point.
      url: fn + "/hfPatient",
      label: "hfPatient",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
      expectStatuses: [401],
      mustContain: ["auth required", "UNAUTHENTICATED"],
      timeoutMs: DEP_TIMEOUT_MS
    }
  ];
}

const CHECKS = buildChecks(BASE, RTDB_URL, FN_BASE);

/* Longest the probe can possibly take, used to size the workflow's step cap.
 * This arithmetic is only sound because fetchUrl enforces a WALL-CLOCK
 * deadline per request — see the note there. */
function worstCaseMs(checks) {
  const backoff = BACKOFF_MS.slice(0, ATTEMPTS - 1).reduce((a, b) => a + b, 0);
  return (checks || CHECKS).reduce((sum, c) => {
    const t = typeof c.timeoutMs === "number" ? c.timeoutMs : TIMEOUT_MS;
    return sum + ATTEMPTS * t + backoff;
  }, 0);
}

/* Production is https; http is accepted so the deadline below can be tested
 * against a real local server instead of a stubbed transport. */
function transportFor(url) {
  return String(url).startsWith("http://") ? http : https;
}

function fetchUrl(url, opts) {
  const o = opts || {};
  const method = o.method || "GET";
  const payload = o.body || null;
  const timeoutMs = typeof o.timeoutMs === "number" ? o.timeoutMs : TIMEOUT_MS;
  const headers = Object.assign({ "User-Agent": "canamed-synthetic-probe" }, o.headers || {});
  if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let deadline = null;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      fn(arg);
    };

    const req = transportFor(url).request(url, { method, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => finish(resolve, {
        status: res.statusCode,
        body,
        ms: Date.now() - startedAt,
        headers: res.headers
      }));
    });
    req.on("error", (e) => finish(reject, e));

    // TWO timers, because they bound different things and only one of them
    // bounds what the workflow's step cap is sized against.
    //
    // req.setTimeout is a socket-IDLE timeout: it fires when nothing arrives
    // for timeoutMs, and every byte received RESETS it. A server that trickles
    // output therefore keeps a request alive indefinitely under it — verified
    // locally 2026-08-07 against a server writing one byte every 200 ms, where
    // a 1 000 ms setTimeout had still not fired after 5 000 ms. It also does
    // not cover DNS resolution, since it only arms once a socket is assigned.
    //
    // So it cannot be the guarantee that "worst case = attempts x timeoutMs"
    // rests on, and the step cap derived from that arithmetic would not hold.
    // The wall-clock deadline is what actually enforces it. The idle timeout
    // stays because it fires EARLIER on a silent socket, which keeps the
    // common failure fast rather than always paying the full deadline.
    deadline = setTimeout(() => {
      req.destroy(new Error("Request exceeded its " + timeoutMs + "ms deadline"));
    }, timeoutMs);

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timed out after " + timeoutMs + "ms"));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* One attempt at one check. Never throws — a transport error is a failed
 * result, not an exception, so the retry loop above stays simple. */
async function attemptOne(check, fetchImpl) {
  const startedAt = Date.now();
  try {
    const r = await fetchImpl(check.url, {
      method: check.method,
      body: check.body,
      headers: check.headers,
      timeoutMs: check.timeoutMs
    });
    const statusOk = check.expectStatuses.indexOf(r.status) >= 0;
    const body = typeof r.body === "string" ? r.body : "";
    const contentOk = check.mustContain.every(s => body.indexOf(s) >= 0);
    // `tolerate` is an EXPLICIT list of statuses that skip the body assertion
    // (the not-yet-shipped healthcheck page's 404). It replaces the old
    // implicit rule "any status other than 200 skips the body", which would
    // have made the 401 backend checks below vacuous — they assert on the
    // body, and a 401 is their healthy answer.
    const tolerated = Array.isArray(check.tolerate) && check.tolerate.indexOf(r.status) >= 0;
    const pass = statusOk && (tolerated || contentOk);
    return {
      label: check.label,
      url: check.url,
      pass: pass,
      status: r.status,
      ms: typeof r.ms === "number" ? r.ms : Date.now() - startedAt,
      missing: contentOk ? [] : check.mustContain.filter(s => body.indexOf(s) < 0),
      tolerated: tolerated
    };
  } catch (e) {
    return {
      label: check.label,
      url: check.url,
      pass: false,
      status: 0,
      // Real elapsed time, not 0 — see the header. This is what tells a hang
      // apart from an instant refusal when reading a failed run's log.
      ms: Date.now() - startedAt,
      missing: [],
      error: e.message
    };
  }
}

/* Run one check, retrying until it passes or the attempts are exhausted.
 * Returns the LAST result, annotated with `attempt` (which attempt produced
 * it) and `attempts` (how many were allowed). */
async function runOne(check, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchUrl || fetchUrl;
  const sleepImpl = o.sleep || sleep;
  const attempts = typeof o.attempts === "number" ? o.attempts : ATTEMPTS;
  const backoff = o.backoffMs || BACKOFF_MS;

  let result = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleepImpl(backoff[Math.min(i - 1, backoff.length - 1)]);
    result = await attemptOne(check, fetchImpl);
    result.attempt = i + 1;
    result.attempts = attempts;
    if (result.pass) return result;
  }
  return result;
}

function formatResult(r) {
  const tag = r.pass ? (r.tolerated ? "TOLERATED" : "OK") : "FAIL";
  const retried = r.attempt > 1 ? " (attempt " + r.attempt + "/" + r.attempts + ")" : "";
  return "[" + tag + "]" + retried + " " + String(r.label).padEnd(20) +
    " status=" + r.status + " ms=" + r.ms +
    (r.error ? " error=" + r.error : "") +
    (r.missing && r.missing.length ? " missing=" + r.missing.join("|") : "");
}

/* Returns the process exit code rather than calling process.exit, so the whole
 * probe is exercisable from a unit test. */
async function main(opts) {
  const o = opts || {};
  const checks = o.checks || CHECKS;
  const log = o.log || console.log;
  const logErr = o.logErr || console.error;

  log("Probing " + (o.base || BASE) + " at " + new Date().toISOString());
  const results = [];
  for (const c of checks) {
    const r = await runOne(c, o);
    log(formatResult(r));
    results.push(r);
  }
  const hardFails = results.filter(r => !r.pass);
  if (hardFails.length > 0) {
    logErr("FAIL: " + hardFails.length + " check(s) failed");
    return 1;
  }
  log("OK: all checks passed");
  return 0;
}

module.exports = {
  ATTEMPTS,
  BACKOFF_MS,
  TIMEOUT_MS,
  DEP_TIMEOUT_MS,
  RTDB_URL,
  FN_BASE,
  buildChecks,
  worstCaseMs,
  attemptOne,
  runOne,
  formatResult,
  main
};

if (require.main === module) {
  // process.exitCode rather than process.exit so nothing is truncated mid-write.
  // Both paths have been timed against production: a healthy run exits 0 in ~1 s,
  // and a failing run exits 1 as soon as the retry budget is spent (no socket
  // keeps the loop alive).
  main()
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error("FAIL: probe crashed:", e && e.stack ? e.stack : e);
      process.exitCode = 1;
    });
}
