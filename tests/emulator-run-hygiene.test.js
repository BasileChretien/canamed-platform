/* tests/emulator-run-hygiene.test.js
 *
 * The rules-exercising E2E run (`npm run test:e2e:rules`) is one of only two
 * things in this repo that validate database.rules.json — the other is the
 * emulator-backed sim (`npm run sim:emulator`). The LOCAL Playwright suite does
 * not touch rules at all. Three infrastructure defects made it unreliable
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
  assert.match(RUNNER, /process\.on\("SIGINT", \(\) => stop\("SIGINT", 130\)\)/,
    "Ctrl-C must reach stop() — an interrupted run is the commonest way to " +
    "orphan one — and stop() forwards to the child, waits, THEN sweeps");
  assert.match(RUNNER, /process\.on\("SIGTERM", \(\) => stop\("SIGTERM", 143\)\)/);
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
  assert.match(RUNNER, /ports\.free\(EMU_PORTS, \{ onlyPids: ownedPids \}\)/);
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
  assert.match(RUNNER, /^let execArg = playwright;$/m,
    "off Windows argv is passed literally — an added quote would become part " +
    "of the command");
  assert.match(RUNNER, /if \(process\.platform === "win32"\) \{\r?\n\s*tempScript =/,
    "only Windows needs the wrapper (see the temp-script test below)");
  assert.match(RUNNER, /^\s*execArg\s*$/m,
    "the wrapped form, not the bare join, must be what is spawned");
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
  assert.match(body, /emulatorPorts\.free\(\[DB_PORT, AUTH_PORT\], \{ onlyPids: ownedPids \}\)/,
    "taskkill /T only reaches the tree we own; the RTDB emulator survived it — " +
    "but the backstop sweep must still prove ownership before killing");
  assert.match(body, /taskkill/,
    "the port sweep is a BACKSTOP — the tree-kill must still run first");
});

/* ── the review round: fail closed, kill once, prove ownership ────── */

test("port inspection FAILS CLOSED when the tool is missing (never 'free')", () => {
  /* Returning [] on any error made 'netstat/lsof is absent' indistinguishable
     from 'the port is free', so a machine without the tool would wave a stale
     emulator straight through — the exact failure this module prevents. */
  const cli = read("scripts", "ops", "emulator-ports.js");
  assert.match(cli, /if \(!IS_WIN && e && e\.status === 1\) return \[\];/,
    "lsof's documented exit-1-no-match is the ONLY silent-empty case");
  assert.match(cli, /e\.code === "ENOENT"/, "a missing tool must be named");
  assert.match(cli, /throw new Error\(\s*\n?\s*"cannot determine who is listening/,
    "every other inspection failure must propagate, not read as 'free'");
});

test("a missing inspection tool surfaces to the caller rather than reporting free", () => {
  const orig = process.env.PATH;
  try {
    process.env.PATH = path.join(ROOT, "no-such-dir-for-tests");
    delete require.cache[require.resolve("../scripts/ops/emulator-ports.js")];
    const fresh = require("../scripts/ops/emulator-ports.js");
    let threw = null;
    try { fresh.survey([9000]); } catch (e) { threw = e; }
    assert.ok(threw, "survey must throw when it cannot inspect the port");
    assert.match(String(threw.message), /cannot determine who is listening on :9000/);
  } finally {
    process.env.PATH = orig;
    delete require.cache[require.resolve("../scripts/ops/emulator-ports.js")];
    require("../scripts/ops/emulator-ports.js");
  }
});

test("one process on BOTH ports is killed once, not twice", async () => {
  /* The second kill of an already-dead PID reports ESRCH / a taskkill failure,
     and the CLI would exit non-zero having actually released every listener. */
  const http2 = require("node:http");
  const a = http2.createServer(() => {});
  const b = http2.createServer(() => {});
  await new Promise((r) => a.listen(0, "127.0.0.1", r));
  await new Promise((r) => b.listen(0, "127.0.0.1", r));
  const ports2 = [a.address().port, b.address().port];
  try {
    const rows = ports.survey(ports2);
    assert.strictEqual(rows.length, 2, "both ports must be seen");
    assert.strictEqual(rows[0].pid, rows[1].pid, "same process holds both");
    // Do not actually kill this test process — assert the grouping instead.
    const cli = read("scripts", "ops", "emulator-ports.js");
    assert.match(cli, /const byPid = new Map\(\)/,
      "free() must group rows by PID before terminating");
    assert.match(cli, /if \(error\) for \(const row of group\) row\.error = error;/,
      "one outcome must be shared across every row for that PID");
  } finally {
    await new Promise((r) => a.close(r));
    await new Promise((r) => b.close(r));
  }
});

test("free() honours an ownership restriction and skips unproven listeners", async () => {
  const http2 = require("node:http");
  const s = http2.createServer(() => {});
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  try {
    // onlyPids that excludes the real holder ⇒ nothing acted on, nothing killed.
    const acted = ports.free([port], { onlyPids: new Set(["999999"]) });
    assert.deepStrictEqual(acted, [],
      "a listener whose ownership is not established must be skipped entirely");
    assert.strictEqual(ports.survey([port]).length, 1,
      "and it must still be alive");
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test("automatic sweeps are ownership-scoped; only `emulator:free` is unrestricted", () => {
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const cli = read("scripts", "ops", "emulator-ports.js");
  for (const [name, src] of [["run-rules-e2e", RUNNER2], ["sim-with-emulator", SIM]]) {
    assert.match(src, /onlyPids: ownedPids/,
      name + " must restrict its automatic sweep to PIDs it established");
    assert.match(src, /were NOT started by this run, so/,
      name + " must REPORT a stranger on the port, not kill it");
  }
  assert.match(cli, /const killed = free\(ports\);/,
    "the explicit `free` verb stays unrestricted — there the operator decides");
});

test("a signal to the runner forwards to the child and waits before sweeping", () => {
  /* Sweeping straight away would force-kill the emulator ports while
     emulators:exec was still running against them. */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  assert.match(RUNNER2, /function stop\(signal, exitCode\)/);
  assert.match(RUNNER2, /taskkill[\s\S]{0,80}?String\(child\.pid\)/,
    "the child TREE must be signalled on Windows");
  assert.match(RUNNER2, /while \(child\.exitCode === null && child\.signalCode === null && Date\.now\(\) < deadline\)/,
    "the wait must be bounded — a wedged child must not hang the shell");
  const stopAt = RUNNER2.indexOf("function stop(");
  const body = RUNNER2.slice(stopAt, RUNNER2.indexOf("process.on(\"SIGINT\"", stopAt));
  assert.ok(body.indexOf("deadline") < body.indexOf("sweep()"),
    "the wait must come BEFORE the sweep");
});

test("forwarded playwright arguments survive the shell emulators:exec runs", () => {
  /* `--grep "roomOf peer"` joined bare would split into two tokens and the
     filter would silently match nothing. */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  assert.match(RUNNER2, /function shQuote\(tok\)/);
  assert.match(RUNNER2, /\.map\(shQuote\)\.join\(" "\)/,
    "every token must be quoted individually, not the joined string");
  assert.match(RUNNER2, /\^\[A-Za-z0-9_@%\+=:,\.\/~-\]\+\$/,
    "only plainly-safe tokens may pass through unquoted");
});

test("on Windows the nested command goes via a temp script, not nested quotes", () => {
  /* Wrapping the joined command in quotes is required on Windows (Node does not
     quote argv when shelling out), but cmd.exe has no escape for a double quote
     inside a double-quoted string — so the moment a forwarded argument was
     itself quoted, firebase reported "Too many arguments". Observed running
     `--grep "roomOf peer-write denial"`, not theorised. A temp .cmd file makes
     it one token with no nesting at all. */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  assert.match(RUNNER2, /tempScript = path\.join\(os\.tmpdir\(\)/);
  assert.match(RUNNER2, /playwright\.replace\(\/%\/g, "%%"\)/,
    "% is the one character cmd expands inside a batch file");
  assert.match(RUNNER2, /execArg = '"' \+ tempScript \+ '"'/,
    "emulators:exec must receive the PATH, quoted once");
  assert.match(RUNNER2, /function dropTempScript\(\)/);
  const sweepAt = RUNNER2.indexOf("swept = true;");
  assert.ok(RUNNER2.slice(sweepAt, sweepAt + 120).includes("dropTempScript()"),
    "the temp script must be removed on the same path that sweeps");
});

test("the temp script switches to UTF-8, so a non-ASCII argument survives cmd", () => {
  /* The .cmd is written UTF-8 but cmd.exe reads batch files in the OEM
     codepage, so `--grep "create → join"` arrived as "create Ôåæ join" and
     matched nothing. That surfaces as "No tests found" — indistinguishable
     from "there is no such test" — which is the worst kind of failure: it
     looks like an answer. cmd re-reads the file line by line, so the codepage
     switch must come BEFORE the command line it governs. */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  /* Plain substring, not a regex. The escape sequence is LITERAL text in the
     source — "chcp 65001 >nul" then backslash-r backslash-n — so a regex
     written \r\n would look for a real CRLF and never match. (It didn't: this
     assertion failed on its first run for exactly that reason.) */
  assert.ok(RUNNER2.includes('"chcp 65001 >nul' + String.raw`\r\n` + '"'),
    "the temp script must switch cmd to UTF-8");
  const chcpAt = RUNNER2.indexOf('"chcp 65001 >nul');
  const cmdAt = RUNNER2.indexOf('playwright.replace(/%/g, "%%")');
  assert.ok(chcpAt > 0 && chcpAt < cmdAt,
    "the codepage switch must precede the command it governs");
});
