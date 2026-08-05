/* tests/emulator-run-hygiene.test.js
 *
 * The rules-exercising E2E run (`npm run test:e2e:rules`) is the ONLY thing in
 * this repo that validates database.rules.json — the LOCAL Playwright suite
 * does not touch rules at all. Three infrastructure defects made it unreliable
 * in ways that each present as something other than what they are (all
 * observed 2026-08-05):
 *
 *   1. NO TEARDOWN. `firebase emulators:exec` signals its child, but the RTDB
 *      emulator is a Java grandchild (npx → node → java) that survives on
 *      Windows. Three consecutive runs each left listeners on :9000 / :9099
 *      after exiting 0.
 *   2. NO PREFLIGHT. Given (1), the next run's readiness probe succeeds
 *      instantly against the STALE emulator — carrying the previous run's
 *      rules — so the suite validates the wrong thing or times out. That reads
 *      as an environment fault, not as a stale process.
 *   3. PORT COLLISION + reuseExistingServer. The config hardcoded :8765
 *      (AnkiConnect's port on at least one dev machine) and would ADOPT a
 *      server started without SIM_EMULATOR_MODE=1, whose CSP forbids reaching
 *      the emulator — so every test failed on a CSP violation that looks like
 *      a rules failure. It also shared test-results/ with the LOCAL suite, and
 *      Playwright clears its output dir at start-up, so a concurrent LOCAL run
 *      aborted the rules run with ENOTEMPTY.
 *
 * These are all "the tooling lied about what it validated" defects, the same
 * class CLAUDE.md's STATUS-CLAIM RULE covers. Pin the fixes.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const PKG = JSON.parse(read("package.json"));
const EMU_CFG = read("playwright.emulator.config.js");
const RUNNER = read("scripts", "ops", "run-rules-e2e.js");
const GITIGNORE = read(".gitignore");

const ports = require("../scripts/ops/emulator-ports.js");

/* ── the port utility actually works ──────────────────────────────── */

test("a listening port is detected, named, and reported with a clear command", async () => {
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const rows = ports.survey([port]);
    assert.strictEqual(rows.length, 1, "the listener on :" + port + " must be found");
    assert.strictEqual(rows[0].port, port);
    assert.strictEqual(String(rows[0].pid), String(process.pid),
      "the PID reported must be the process that actually holds the port");
    assert.match(ports.describe(rows), new RegExp(":" + port + " held by PID"));
    assert.match(ports.clearCommand(rows), new RegExp(String(process.pid)),
      "the guidance must name the PID the operator has to kill");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a free port surveys empty (no false positive would block every run)", () => {
  /* A false positive here is worse than a false negative: it would make the
     preflight refuse to run the only rules validation the repo has. */
  const server = http.createServer(() => {});
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => {
        try {
          assert.deepStrictEqual(ports.survey([port]), []);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});

test("check and free are separate verbs — nothing is killed implicitly", () => {
  const cli = read("scripts", "ops", "emulator-ports.js");
  assert.match(cli, /if \(verb === "free"\)/);
  assert.match(cli, /if \(verb === "check" \|\| verb === undefined\)/,
    "the DEFAULT verb must be the non-destructive one");
  const checkAt = cli.indexOf('verb === "check"');
  const checkBody = cli.slice(checkAt);
  assert.doesNotMatch(checkBody, /\bfree\(ports\)/,
    "check must never kill — an unattended kill would take out a deliberate " +
    "`npm run emulator` session");
});

/* ── the runner wires preflight → run → sweep ─────────────────────── */

test("npm run test:e2e:rules goes through the runner, not a bare exec line", () => {
  assert.strictEqual(PKG.scripts["test:e2e:rules"],
    "node scripts/ops/run-rules-e2e.js",
    "the raw `emulators:exec` one-liner had no preflight and no teardown");
  assert.ok(PKG.scripts["emulator:free"], "an operator escape hatch must exist");
});

test("the runner preflights the emulator ports AND the web port", () => {
  assert.match(RUNNER, /ports\.survey\(\[\.\.\.EMU_PORTS, WEB_PORT\]\)/,
    "all three ports must be checked before anything is started");
  const at = RUNNER.indexOf("ports.survey([...EMU_PORTS, WEB_PORT])");
  const spawnAt = RUNNER.indexOf('spawn("npx"');
  const buildAt = RUNNER.indexOf("build-emulator-rules.js");
  assert.ok(at > 0 && at < buildAt && at < spawnAt,
    "the preflight must run BEFORE the rules build and the emulator spawn");
});

test("the runner sweeps survivors on every exit path", () => {
  assert.match(RUNNER, /child\.on\("exit"[\s\S]{0,80}?sweep\(\)/,
    "a normal exit must sweep");
  assert.match(RUNNER, /child\.on\("error"[\s\S]{0,120}?sweep\(\)/,
    "a failure to start must sweep");
  assert.match(RUNNER, /process\.on\("SIGINT"[\s\S]{0,60}?sweep\(\)/,
    "Ctrl-C must sweep — an interrupted run is the commonest way to orphan one");
  assert.match(RUNNER, /let swept = false/,
    "the sweep must be idempotent; several paths can reach it");
});

test("the runner propagates the suite's exit code (a swept run is not a pass)", () => {
  assert.match(RUNNER, /const status = code === null \? 1 : code/);
  assert.match(RUNNER, /process\.exit\(status\)/);
});

test("the sweep is scoped to the emulator ports and runs only after the child", () => {
  /* Sweeping the WEB port would kill a server Playwright owns; sweeping before
     the child exits would kill the emulator mid-suite. */
  assert.match(RUNNER, /ports\.free\(EMU_PORTS\)/);
  assert.doesNotMatch(RUNNER, /ports\.free\(\[[^\]]*WEB_PORT/);
});

/* ── the Playwright config's three fixes ──────────────────────────── */

test("the emulator config's port is overridable (8765 collides with AnkiConnect)", () => {
  assert.match(EMU_CFG, /parseInt\(process\.env\.PORT \|\| "8765", 10\)/);
});

test("the emulator config NEVER reuses an existing server", () => {
  assert.match(EMU_CFG, /reuseExistingServer: false/,
    "adopting a server started without SIM_EMULATOR_MODE=1 makes every test " +
    "fail on a CSP violation that reads as a rules failure");
  assert.doesNotMatch(EMU_CFG, /reuseExistingServer: !process\.env\.CI/);
});

test("the emulator suite has its OWN output dir, not the shared test-results/", () => {
  assert.match(EMU_CFG, /outputDir: "\.\/test-results-emulator"/,
    "Playwright clears its output dir at start-up, so sharing test-results/ " +
    "let a concurrent LOCAL run abort the rules run with ENOTEMPTY");
  assert.match(GITIGNORE, /^test-results-emulator\/$/m,
    "the new output dir must be git-ignored or it lands in a commit");
});

test("the emulator config still serves with SIM_EMULATOR_MODE=1", () => {
  /* The CSP relaxation that lets the page reach 127.0.0.1:9000 lives behind
     this env var; losing it is silent until every test fails on the splash. */
  assert.match(EMU_CFG, /env: \{ SIM_EMULATOR_MODE: "1" \}/);
});

test("the playwright command reaches emulators:exec as ONE argument", () => {
  /* emulators:exec takes the whole command as a single argument. On Windows we
     spawn through cmd.exe for npx.cmd, and Node does not quote argv when
     shelling out — it joins with spaces — so an unquoted string would arrive
     as five arguments and emulators:exec would run only `npx`, i.e. the suite
     would silently not run. The npm one-liner this replaced had to escape the
     same quotes. */
  assert.match(RUNNER, /process\.platform === "win32" \? '"' \+ playwright \+ '"' : playwright/,
    "the command must be quoted on Windows and NOT quoted elsewhere");
  assert.match(RUNNER, /^\s*execArg\s*$/m,
    "the quoted form, not the bare join, must be what is spawned");
});

/* ── the sim launcher gets the same two guards ────────────────────── */

test("sim-with-emulator preflights the emulator ports (waitForPort cannot)", () => {
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  assert.match(SIM, /emulatorPorts\.survey\(\[DB_PORT, AUTH_PORT\]\)/,
    "waitForPort only proves SOMETHING is listening — a stale emulator makes " +
    "it pass instantly and the sim then validates the previous run's rules");
  const surveyAt = SIM.indexOf("emulatorPorts.survey([DB_PORT, AUTH_PORT])");
  const startAt = SIM.indexOf('"emulators:start"');
  assert.ok(surveyAt > 0 && surveyAt < startAt,
    "the check must precede the emulator spawn");
});

test("sim-with-emulator sweeps by port after its tree-kill", () => {
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const at = SIM.indexOf("function cleanup()");
  assert.ok(at > 0);
  const body = SIM.slice(at, SIM.indexOf("process.on(\"SIGINT\"", at));
  assert.match(body, /emulatorPorts\.free\(\[DB_PORT, AUTH_PORT\]\)/,
    "taskkill /T only reaches the tree we own; the RTDB emulator survived it");
  assert.match(body, /taskkill/,
    "the port sweep is a BACKSTOP — the tree-kill must still run first");
});
