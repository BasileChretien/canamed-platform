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
  /* Locate the spawn STRUCTURALLY, not by its command literal. This used to
     be indexOf('spawn("npx"'), which went stale the moment the CLI was pinned
     (2026-08-17) and the command became the resolved firebase binary. A stale
     locator returns -1 and the ordering assertion then fails as a bogus
     "preflight runs too late" — a misleading error about the wrong thing, the
     exact class this file exists to prevent. Hence the explicit found-checks
     below: a future rename fails as "locator stale", saying what it means. */
  const spawnAt = RUNNER.indexOf("const child = spawn(");
  const buildAt = RUNNER.indexOf("build-emulator-rules.js");
  assert.ok(spawnAt > 0, "locator stale: the emulator spawn was not found");
  assert.ok(buildAt > 0, "locator stale: the rules build was not found");
  assert.ok(at > 0 && at < buildAt && at < spawnAt,
    "the preflight must run BEFORE the rules build and the emulator spawn");
});

test("the emulator runs against the PINNED firebase CLI, not whatever npx finds", () => {
  /* The CLI is selected by an explicit path, NOT by putting the pinned .bin on
     $PATH and still calling `npx firebase`. npx resolves the local
     node_modules/.bin and then the npm GLOBAL prefix, and ignores PATH: on a
     machine carrying a global firebase-tools it silently runs THAT one.
     Measured 2026-08-17 — with the pinned 15.27.0 first on PATH,
     `npx firebase --version` still reported the global 15.19.0, while a plain
     shell `firebase --version` reported 15.27.0. A pin npx quietly ignores is
     worse than no pin, because it reads as pinned. Same "the tooling lied
     about what it validated" class as the three defects in the header. */
  assert.match(RUNNER, /"tools",\s*"firebase-cli"/,
    "the runner must resolve the pinned CLI under tools/firebase-cli");
  assert.ok(!/spawn\("npx"/.test(RUNNER),
    "the emulator must not be launched via a literal `spawn(\"npx\"…)` — npx " +
    "ignores PATH and can pick a global firebase-tools over the pinned one");

  const cliPkg = JSON.parse(read("tools", "firebase-cli", "package.json"));
  assert.ok(cliPkg.dependencies && cliPkg.dependencies["firebase-tools"],
    "tools/firebase-cli must declare firebase-tools");

  const lock = JSON.parse(read("tools", "firebase-cli", "package-lock.json"));
  const locked = lock.packages && lock.packages["node_modules/firebase-tools"];
  assert.ok(locked && locked.version,
    "firebase-tools must be pinned by a COMMITTED lockfile. A version range " +
    "alone still floats the ~670 packages beneath it, and a transitive dep is " +
    "exactly what broke the four ops workflows for five days over " +
    "2026-07-31..08-04 (see .github/workflows/cleanup-stale-sessions.yml)");
  assert.ok(locked.integrity || locked.resolved,
    "the locked firebase-tools entry must carry integrity/resolved");
});

test("the runner sweeps survivors on every exit path", () => {
  /* `sweep(` — it takes an argument since 2026-10-07 (did the child fail of
     its own accord?), which the report needs and the kill decision does not. */
  /* The child's "exit" handler sweeps TWICE over, on two paths: an interrupted
     run ends there (see the signal test below), and so does a normal one. Cut
     the handler out and ask for both, rather than "a sweep( within 120
     characters" — which the first of them satisfied on its own once it was
     added, whatever became of the second. */
  const exitAt = RUNNER.indexOf('child.on("exit"');
  assert.ok(exitAt > 0, "locator stale: the child's exit handler was not found");
  const onExit = RUNNER.slice(exitAt, RUNNER.indexOf('child.on("error"', exitAt));
  assert.match(onExit, /sweep\(status !== 0 && !signal\);/,
    "a normal exit must sweep");
  assert.match(RUNNER, /child\.on\("error"[\s\S]{0,120}?sweep\(/,
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

test("a PORT that cannot work is refused before either script has anything to undo", () => {
  /* The sim launcher says it refuses "before the handlers exist", and only its
     place in the file makes that so. With the refusal moved below the three
     process.on(…) lines the real-run scenario still passes (found in the
     second review of PR #444) — and the exit would then run cleanup(), which
     kills nothing there but unlinks the generated *.emulator.json files:
     another run's, since a run refused at that point built none. */
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const refusedAt = SIM.indexOf("if (WEB.problem) {");
  assert.ok(refusedAt > 0, "locator stale: the launcher's PORT refusal was not found");
  assert.match(SIM.slice(refusedAt, refusedAt + 200),
    /^if \(WEB\.problem\) \{\r?\n\s*console\.error\([^\n]*\r?\n\s*process\.exit\(1\);\r?\n\}/,
    "the refusal must say why and exit — nothing else");
  for (const handler of ['process.on("SIGINT"', 'process.on("SIGTERM"', 'process.on("exit"']) {
    const at = SIM.indexOf(handler);
    assert.ok(at > 0, "locator stale: the launcher's " + handler + " handler was not found");
    assert.ok(refusedAt < at,
      "the launcher's PORT refusal must come BEFORE " + handler + ", …): from " +
      "there on an exit runs cleanup(), and cleanup() unlinks the generated " +
      "emulator rule files");
  }

  /* The runner has no such handlers; there it is the preflight and the spawn
     that the refusal must come before. */
  const refusedByRunnerAt = RUNNER.indexOf("if (WEB.problem) fatal(");
  assert.ok(refusedByRunnerAt > 0, "locator stale: the runner's PORT refusal was not found");
  const surveyAt = RUNNER.indexOf("ports.survey([...EMU_PORTS, WEB_PORT])");
  assert.ok(surveyAt > 0, "locator stale: the runner's preflight was not found");
  assert.ok(refusedByRunnerAt < surveyAt,
    "the runner must refuse a bad PORT before it looks at any port");

  /* And both read PORT through the one function, so they cannot disagree. */
  for (const [name, src] of [["run-rules-e2e", RUNNER], ["sim-with-emulator", SIM]]) {
    assert.match(src, /webPort\.read\(process\.env\.PORT, \{ db: DB_PORT, auth: AUTH_PORT \}\)/,
      name + " must read PORT with ops/web-port.js");
    assert.doesNotMatch(src, /parseInt\(process\.env\.PORT/,
      name + " reads PORT with a bare parseInt again: \"8771abc\" is then 8771, " +
      "\"abc\" is NaN, and an emulator's own port is taken");
  }
});

test("sim-with-emulator sweeps by port after its tree-kill", () => {
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const at = SIM.indexOf("function cleanup()");
  assert.ok(at > 0);
  const body = SIM.slice(at, SIM.indexOf("process.on(\"SIGINT\"", at));
  assert.match(body, /emulatorPorts\.free\(\[DB_PORT, AUTH_PORT\], \{ onlyPids: ownedPids \}\)/,
    "taskkill /T only reaches the tree we own; the RTDB emulator survived it — " +
    "but the backstop sweep must still prove ownership before killing");
  /* The tree-kill moved into stopChild() (the "exit" handler needs it too). */
  const killAt = body.indexOf("stopChild(firebaseProc, { tree: true });");
  assert.ok(killAt > 0, "locator stale: cleanup() no longer tree-kills its emulator CLI");
  assert.ok(killAt < body.indexOf("emulatorPorts.survey("),
    "the port sweep is a BACKSTOP — the tree-kill must still run first");
  assert.match(SIM,
    /function stopChild\(p, opts\) \{[\s\S]{0,300}?if \(opts && opts\.tree && process\.platform === "win32"\) \{\r?\n\s*spawnSync\("taskkill", \["\/F", "\/T", "\/PID"/,
    "and stopping the emulator CLI must still be a synchronous TREE kill on " +
    "Windows: the handle there is a shell, with the emulators beneath it");
  assert.match(SIM, /p\.exitCode !== null \|\| stopped\.has\(p\)\) return;/,
    "a child that has ended, or was already stopped, must not be killed again " +
    "by its remembered PID");
});

test("the sim launcher tree-kills its emulator CLI, and nothing else", () => {
  /* `taskkill /T` rebuilds the tree from ParentProcessId with no creation-time
     check, so it also takes any process that still names a recycled PID in
     that tree as its parent — the reading the lineage work refuses. PR #439
     removed it from the ownership-scoped sweep and, in the same commits, ADDED
     it for the sim (stopChild() tree-killed whatever it was handed). The sim
     is one node process whose browsers exit with it, and the static server
     has no children: both are ended through their handles. What that does to
     a child of the sim is run for real in tests/sim-launcher-run.test.js —
     on Windows, the only place the difference exists; this names the shape on
     every platform. */
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  assert.strictEqual((SIM.match(/\{ tree: true \}/g) || []).length, 1,
    "exactly one child may be stopped with its tree");
  assert.match(SIM, /stopChild\(firebaseProc, \{ tree: true \}\);/,
    "and it is the emulator CLI");
  assert.strictEqual((SIM.match(/spawnSync\("taskkill"/g) || []).length, 1,
    "locator stale: the launcher no longer has exactly one taskkill call");
  assert.match(SIM, /\} else \{\r?\n\s*p\.kill\(\);/,
    "every other child is ended through its handle");
  const cleanupAt = SIM.indexOf("function cleanup()");
  const cleanup = SIM.slice(cleanupAt, SIM.indexOf('process.on("SIGINT"', cleanupAt));
  assert.match(cleanup,
    /stopChild\(simProc\);[^\n]*\r?\n\s*stopChild\(firebaseProc, \{ tree: true \}\);\r?\n\s*stopChild\(serveProc\);/,
    "cleanup() stops the sim first (it is what writes), then the emulator, " +
    "then the server");
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
  /* ⚠ THIS TEST WAS GREEN ON THE DEFECT, and the three assertions it had then
     still are. `onlyPids: ownedPids` reads the same whether `ownedPids` holds
     what the run STARTED or what it merely SAW on the ports — and until
     2026-10-07 it held the latter, so one session's sweep killed another
     session's live emulator while this test passed. What decides the matter is
     where the set comes FROM, and only a run with a real stranger on the port
     shows that: tests/emulator-sweep-lineage.test.js. The checks added below
     name the old shape so that it cannot come back unnoticed in the sim
     launcher, which that file does not run. */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const cli = read("scripts", "ops", "emulator-ports.js");
  for (const [name, src] of [["run-rules-e2e", RUNNER2], ["sim-with-emulator", SIM]]) {
    assert.match(src, /onlyPids: ownedPids/,
      name + " must restrict its automatic sweep to PIDs it established");
    assert.match(src, /were NOT started by this run, so/,
      name + " must REPORT a stranger on the port, not kill it");

    assert.doesNotMatch(src, /ownedPids\.add\(/,
      name + " adds PIDs to its owned set one by one — the old shape, where " +
      "every PID seen listening on the port during the run went in. Seeing a " +
      "process on a shared port is not having started it.");
    assert.match(src, /const ownedPids = new Set\((?:sorted\.)?mine\.map\(/,
      name + ": the owned set must be built from the lineage tracker's `mine`");
    assert.match(src, /processLineage\.track\(\w+\.pid, \{ spawnedAt \}\)/,
      name + " must follow the lineage of the child IT spawned");
    assert.match(src, /lineage\.partition\(survivors\)/,
      name + " must sort survivors by lineage before freeing any");
  }
  assert.match(cli, /const killed = free\(ports\);/,
    "the explicit `free` verb stays unrestricted — there the operator decides");
});

test("an ownership-scoped kill is NOT a tree kill; only the operator's verb is", () => {
  /* `taskkill /T` walks ParentProcessId, which Windows never rewrites: an
     unrelated orphan whose dead parent's PID has since gone to the listener
     would be read as its child and killed with it. The caller verified the
     listeners it names — not whatever claims them as a parent. (Found in
     review; an independent count on a quiet machine had 2 of 883 processes
     in exactly that state.) */
  const cli = read("scripts", "ops", "emulator-ports.js");
  assert.match(cli,
    /execFileSync\("taskkill", onlyPids \? \["\/F", "\/PID", pid\] : \["\/F", "\/T", "\/PID", pid\]/,
    "free() must drop /T when it is handed onlyPids, and keep it otherwise");
  assert.strictEqual((cli.match(/execFileSync\("taskkill"/g) || []).length, 1,
    "locator stale: free() no longer has exactly one taskkill call");
});

test("the sim ends the run when its own emulator exits before teardown", () => {
  /* waitForPort() is satisfied by ANY listener. If our CLI lost the race for
     :9000 and exited, the listener answering is another session's emulator —
     and the sim would run against it. The first version of this guard read
     `firebaseProc.exitCode` right after a synchronous lookup, where a child
     that had just died still reads as running (found in review). The "exit"
     event is the only reliable signal, and it must not depend on the process
     table being readable.

     These are text checks, and were the ONLY cover this handler had until
     2026-10-08 (the launcher wanted Java, the firebase CLI and port 8765). A
     review then found four changes to it that they did not notice. The
     launcher is now run for real in tests/sim-launcher-run.test.js, which is
     where what it DOES is established; what stays here names the shape, so
     that losing it is reported at once and by name. */
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const at = SIM.indexOf('firebaseProc.on("exit"');
  assert.ok(at > 0, "locator stale: the emulator's exit handler was not found");
  /* The handler closes at the first "});" at its own indentation; "\n" alone
     in the needle, so a CRLF checkout matches too. */
  const end = SIM.indexOf("\n  });", at);
  assert.ok(end > at, "locator stale: the end of the exit handler was not found");
  const handler = SIM.slice(at, end + "\n  });".length);
  assert.match(handler, /if \(tearingDown\) return;/,
    "an exit during our own teardown is expected and must not abort anything");
  assert.match(handler, /refuseForeign\(sorted\.notMine,/,
    "an exit at any other time, with the ports held by something SHOWN not to " +
    "be ours, must refuse and name it — and only then call it another run's: " +
    "our own emulator crashing leaves a listener too");
  assert.match(handler, /process\.exit\(1\);\s*\}\);\s*$/,
    "and with the ports free it must still end the run, not carry on");
  assert.ok(handler.indexOf("if (tearingDown) return;") < handler.indexOf("refuseForeign("),
    "the teardown check must come first");
  const stopAt = handler.indexOf("stopChild(simProc);");
  assert.ok(stopAt > 0, "the handler must stop the sim itself");
  assert.ok(stopAt < handler.indexOf("lineage.partition("),
    "and BEFORE it works out whose the ports are: that reads the process table " +
    "(seconds, and it can fail), and until the sim is stopped it may be writing " +
    "into another session's database (review round 3)");

  const cleanupAt = SIM.indexOf("function cleanup()");
  const cleanup = SIM.slice(cleanupAt, SIM.indexOf('process.on("SIGINT"', cleanupAt));
  assert.match(cleanup, /^function cleanup\(\) \{\r?\n\s*tearingDown = true;/,
    "cleanup() must mark the teardown BEFORE it kills the emulator");
  assert.match(cleanup, /\r?\n\s*stopChild\(simProc\);/,
    "a run cut short must take the sim down too, or it keeps writing to whoever " +
    "holds the ports");

  /* The readiness check: the sim is held until the listeners are shown to be
     ours. "Not shown to be someone else's" was the old test, and it let a
     listener with no verdict through. */
  assert.match(SIM, /unplaced = rows\.filter\(r => lineage\.verdict\(r\.pid\) !== "ours"\);/,
    "anything short of a shown \"ours\" must hold the sim back");
  assert.doesNotMatch(SIM, /The sim is not being run against that listener/,
    "the unconditional claim about the sim must not come back: it was made on " +
    "paths where the sim had been running");
  assert.doesNotMatch(SIM, /firebaseProc\.exitCode !== null\) \{/,
    "the stale-read form of the guard must not come back");
});

test("every message that offers to clear a port says first that it may be a live run", () => {
  /* The other half of the 2026-10-07 incident. A refused preflight used to go
     straight from "the port is held" to `emulator:free` and call the listener
     stale; a session that follows that against another session's run in
     progress kills it. The caveat is one shared constant so the four places
     cannot drift apart. */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  const SIM = read("scripts", "sim", "sim-with-emulator.js");
  const cli = read("scripts", "ops", "emulator-ports.js");
  assert.match(ports.LIVE_RUN_CAVEAT, /LIVE EMULATOR/);
  assert.match(ports.LIVE_RUN_CAVEAT, /two sessions cannot run an emulator suite at once/);

  /* Each REFUSAL message, cut out from where it starts: the caveat also
     appears in the sweeps' reports, and an occurrence there must not stand in
     for one that went missing here. */
  const refusals = [
    ["run-rules-e2e", RUNNER2, "a port this run needs is already in use", "ports.LIVE_RUN_CAVEAT"],
    ["sim-with-emulator", SIM, "FATAL: the emulator ports are already in use", "emulatorPorts.LIVE_RUN_CAVEAT"],
    ["emulator-ports check", cli, "emulator-ports: FATAL", "LIVE_RUN_CAVEAT"]
  ];
  for (const [name, src, opening, caveat] of refusals) {
    const from = src.indexOf(opening);
    assert.ok(from > 0, "locator stale: " + name + "'s refusal message was not found");
    const message = src.slice(from, from + 1600);
    const caveatAt = message.indexOf(caveat);
    const clearAt = message.search(/emulator-ports\.js free|npm run emulator:free/);
    assert.ok(caveatAt > 0, name + "'s refusal never states the live-run caveat");
    assert.ok(clearAt > 0, "locator stale: " + name + " no longer names the clear command");
    assert.ok(caveatAt < clearAt,
      name + " offers the clear command BEFORE saying the listener may be " +
      "another session's emulator, mid-suite");
  }
});

/* Every name that is CALLED in a piece of source: `name(` and `a.b.name(`,
   with comments and string literals taken out first (the runner's messages are
   full of parentheses). Control keywords are not calls. Deliberately simple —
   it reads code written in this file's plain style, and a call spelled so as
   to dodge it (`[spawnSync][0](…)`) is not what it is for. */
function calleesOf(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, "\"\"");
  const names = [];
  const call = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
  for (let m = call.exec(code); m; m = call.exec(code)) {
    if (!["if", "for", "while", "switch", "catch", "function", "return"].includes(m[1])) {
      names.push(m[1]);
    }
  }
  return names;
}

test("calleesOf() sees a call however it is reached, and not what only looks like one", () => {
  /* The check on stop() below is only as good as this reading. */
  assert.deepStrictEqual(calleesOf(
    "  if (x) { a(); b.c (1); /* d() */ e(\"f(\"); } // g()\n" +
    "  try { runNow(process.argv[0]); } catch (err) { h.i.j(() => k()); }\n"),
    ["a", "b.c", "e", "runNow", "h.i.j", "k"]);
});

test("a signal to the runner forwards to the child, and sweeps only after it", () => {
  /* Sweeping straight away would force-kill the emulator ports while
     emulators:exec was still running against them.

     ⚠ THIS TEST USED TO PIN THE DEFECT. It required the wait verbatim —
       while (child.exitCode === null && child.signalCode === null && Date.now() < deadline)
     — under the message "the wait must be bounded". That loop slept
     synchronously, and exitCode is set by the event loop it was blocking: the
     condition could never change, so it was a fixed 10 s on every Ctrl-C. The
     assertion was green on that and red on any repair, so it is gone.

     What the handler DOES — returns the shell when the child exits, gives up
     at the bound, sweeps only afterwards, takes a second signal in its stride —
     is run for real in tests/emulator-runner-signal.test.js; a regex cannot
     tell a wait from a sleep, which is how the old one passed. What is left
     here is the shape that makes those properties possible, so that losing it
     is named at once and on every platform (two of those scenarios need a
     POSIX signal and are skipped on Windows). */
  const RUNNER2 = read("scripts", "ops", "run-rules-e2e.js");
  assert.match(RUNNER2, /function stop\(signal, exitCode\)/);
  const stopAt = RUNNER2.indexOf("function stop(");
  const body = RUNNER2.slice(stopAt, RUNNER2.indexOf("process.on(\"SIGINT\"", stopAt));
  assert.match(body, /taskkill[\s\S]{0,80}?String\(child\.pid\)/,
    "the child TREE must be signalled on Windows");
  assert.match(body, /child\.kill\(signal\);/, "and the signal forwarded everywhere else");

  /* On Windows the ownership poll stops once the tree is killed: it has no
     lineage left to show, and each look is a synchronous netstat between this
     handler and the child's "exit". What that buys is time on a loaded
     machine, which no test here measures (a correct runner was seen taking
     17 s from signal to exit in the full suite) — so this only keeps the line
     from being lost unnoticed. */
  assert.match(body,
    /spawnSync\("taskkill"[^\n]*\r?\n[\s\S]{0,600}?clearTimeout\(ownershipPoll\);\r?\n\s*\} else \{\r?\n\s*child\.kill\(signal\);/,
    "after the Windows tree-kill the ownership poll must be stopped — and only " +
    "there: elsewhere the child is still alive, and still worth watching");

  /* Bounded: a timer, of a named length, is what ends the wait for a child
     that never exits. */
  const timerAt = body.indexOf("setTimeout(");
  assert.ok(timerAt > 0, "locator stale: stop() no longer bounds its wait with a timer");
  assert.match(body, /\}, STOP_WAIT_MS\);\r?\n\}\s*$/,
    "the bound must be the last thing stop() arranges — a wedged child must " +
    "not hang the shell");
  /* A wait, not a sleep: stop() has to RETURN for the child's exit to be seen
     at all, so nothing in it may block. */
  assert.doesNotMatch(body, /\bwhile\s*\(|\bfor\s*\(|Atomics\.wait/,
    "stop() must not loop or sleep synchronously: the child's exit is reported " +
    "by the event loop, which a blocked handler never lets turn");
  /* Nor run ANYTHING synchronously but the one call that ends the child. The
     first form of this ban named `spawnSync(process.execPath` only — the
     exact shape of the old sleep — and a ten-second `spawnSync(process.argv[0],
     …)` put just before the wait got past it, and past both scenarios that
     run on Windows (they time the wait as the runner reports it, which starts
     AFTER that point; found in review). The POSIX scenarios assert wall-clock
     and would catch it; this is what stands in for that on Windows. */
  assert.deepStrictEqual(body.match(/\b(?:spawnSync|execSync|execFileSync)\s*\(/g), ["spawnSync("],
    "stop() may make exactly one synchronous child call");
  assert.match(body, /spawnSync\("taskkill", \["\/F", "\/T", "\/PID", String\(child\.pid\)\]/,
    "and it is the tree-kill of the child, on Windows");
  /* …and may call NOTHING that is not on a list. Counting three names sees
     only direct calls by those names. Four delays placed before the wait got
     past it (found in the second review of PR #444): a helper wrapping the ten
     second spawnSync; an alias, `const runNow = spawnSync`; a call to
     observeListeners(), which is two synchronous netstat; and a call to
     processLineage.processTable(), seconds of PowerShell. The last two get
     past the POSIX wall-clock assertion as well — they take milliseconds
     there. A list of what may be called turns "the delays we thought of" into
     "the calls we allowed": whatever is added to stop() has to be added here,
     by someone who has asked whether it can block. */
  const STOP_MAY_CALL = [
    "console.log", "console.warn", "Date.now", "String",
    "spawnSync",                 // once, the tree-kill: pinned just above
    "clearTimeout", "child.kill", "setTimeout",
    "sweep", "process.exit"      // inside the timer only: pinned just below
  ];
  const strangers = [...new Set(calleesOf(body.slice(body.indexOf("{") + 1)))]
    .filter((name) => !STOP_MAY_CALL.includes(name));
  assert.deepStrictEqual(strangers, [],
    "stop() calls something that is not on its list. It must return at once " +
    "for the child's exit to be seen: anything added to it may be a synchronous " +
    "delay in front of the wait, which the Windows scenarios cannot see");
  /* After the wait: the only sweep in stop() is the one inside the timer. */
  const sweepAt = body.indexOf("sweep(");
  assert.ok(sweepAt > timerAt,
    "stop() must not sweep before its wait is over (the sweep must come after " +
    "the child has exited, or after the bound)");
  assert.strictEqual(body.indexOf("sweep(", sweepAt + 1), -1,
    "locator stale: stop() now sweeps in more than one place");

  /* The other end of the wait: the child's own exit ends an interrupted run. */
  assert.match(RUNNER2,
    /child\.on\("exit", \(code, signal\) => \{\r?\n\s*if \(interrupted\) \{[\s\S]{0,600}?sweep\(false\);\r?\n\s*process\.exit\(interrupted\.exitCode\);/,
    "an interrupted run must end — swept, with the signal's exit code — from " +
    "the child's exit event");
  assert.match(body, /^function stop\(signal, exitCode\) \{\r?\n\s*if \(interrupted\) \{[\s\S]{0,200}?return;\r?\n\s*\}\r?\n\s*interrupted = \{ signal, exitCode, at: Date\.now\(\) \};/,
    "a second signal must change nothing: the first is being handled");
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
