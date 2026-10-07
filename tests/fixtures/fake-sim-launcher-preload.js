"use strict";
/* tests/fixtures/fake-sim-launcher-preload.js
 *
 * Loaded with `node -r`, so that the REAL scripts/sim/sim-with-emulator.js can
 * run to completion in a child process without Java, without the firebase CLI,
 * without a browser and without the real ports (tests/sim-launcher-run.test.js).
 *
 * WHY THIS EXISTS. The launcher does its work at load time and ends in
 * process.exit(), so a test cannot require() it, and it needed Java, the CLI
 * and port 8765 to run at all: until 2026-10-08 everything it does was covered
 * by text checks, and a review found four changes to it that no test noticed
 * (the yield before the readiness decision deleted; the sim no longer stopped
 * when the emulator goes; the readiness refusal deleted; the emulator's exit
 * ignored until the sim exists). Each of the four is a difference in what RUNS
 * WHEN, which a regex over the source cannot see.
 *
 * WHAT IS REPLACED — the programs the launcher starts, never its own logic:
 *   `java -version`, `npx firebase --version`   → a process that exits 0
 *   `npx firebase emulators:start …`            → fake-emulators-exec.js
 *   `node scripts/sim/simulate-session.js`      → fake-simulate-session.js
 *   build-emulator-rules.js                     → nothing: it writes generated
 *       rule files into the checkout, and the launcher deletes them on exit —
 *       a unit test has no business doing either, so the unlink is held back
 *       as well (another run in this checkout may be using those files).
 * The static platform server is the real one (on a throwaway port). So is
 * everything the launcher does about ports and processes — netstat/lsof, the
 * process table, kill/taskkill — except where a test STAGES a condition:
 *
 *   FAKE_PS=fail
 *       the process table cannot be read (what a machine without ps, or a
 *       PowerShell that times out, looks like to process-lineage.js).
 *   FAKE_PS=fail-once
 *       the same, for the first read only: a PowerShell that timed out once,
 *       on a loaded machine, and answers the next time it is asked.
 *   FAKE_PS=cli-exits-during-read
 *       the emulator CLI is alive in the table that is read, and has exited by
 *       the time the read returns — the lookup takes seconds on Windows, and a
 *       CLI that loses the race for the ports dies in just that window.
 *   FAKE_SLOW_READ_AFTER_CLI_EXIT_MS=<n>
 *       the first look at the ports or the process table AFTER the launcher
 *       has been told its CLI exited takes n ms longer (and notes when it
 *       began, in the file `read-after-cli-exit`). On a loaded machine that
 *       look takes seconds anyway; this makes "was the sim stopped before it,
 *       or left writing throughout?" a question with a definite answer.
 *   FAKE_HOLD_READ_AFTER_CLI_EXIT=1
 *       that same first look does not begin until the test writes the file
 *       `read-go` — so the test can put something on the ports for it to find,
 *       however long that takes, instead of racing a fixed delay.
 *
 * Files written into FAKE_EXEC_DIR: `sim-spawned`, the moment the launcher
 * spawns the sim — before that process has run a line, so a sim that is
 * started and killed at once is still seen.
 */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const FAKE_CLI = path.join(__dirname, "fake-emulators-exec.js");
const FAKE_SIM = path.join(__dirname, "fake-simulate-session.js");
const SIM_SCRIPT = path.join(ROOT, "scripts", "sim", "simulate-session.js");
const BUILD_RULES = path.join(ROOT, "scripts", "sim", "build-emulator-rules.js");

const DIR = process.env.FAKE_EXEC_DIR;
const PS = process.env.FAKE_PS || "";
const SLOW_MS = parseInt(process.env.FAKE_SLOW_READ_AFTER_CLI_EXIT_MS || "0", 10);
const HOLD = process.env.FAKE_HOLD_READ_AFTER_CLI_EXIT === "1";
const file = (name) => path.join(DIR, name);

/* A synchronous pause: the lookups being staged are synchronous too, which is
   the whole difficulty they cause. */
function block(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* ── the rules build, and the unlink that would undo someone else's ─── */
const buildRules = require.resolve(BUILD_RULES);   // the key require() will look up
require.cache[buildRules] = {
  id: buildRules, filename: buildRules, loaded: true,
  exports: { buildEmulatorRules() {} }
};
const realUnlinkSync = fs.unlinkSync;
fs.unlinkSync = function (target) {
  if (/\.emulator\.json$/.test(String(target))) return;
  return realUnlinkSync.apply(this, arguments);
};

/* ── the programs ─────────────────────────────────────────────────── */
let cliExitSeen = false;
const realSpawn = childProcess.spawn;
childProcess.spawn = function (cmd, args, opts) {
  const argv = Array.isArray(args) ? args.map(String) : [];
  if (argv.includes("-version") || argv.includes("--version")) {
    return realSpawn(process.execPath, ["-e", "console.log('0.0.0-stand-in')"],
      { stdio: "pipe" });
  }
  if (argv.includes("emulators:start")) {
    const cli = realSpawn(process.execPath, [FAKE_CLI], {
      stdio: ["ignore", "inherit", "inherit"],
      env: (opts && opts.env) || process.env
    });
    /* Registered at the spawn, so it runs BEFORE the launcher's own "exit"
       handler: from that handler's first line on, the launcher knows. */
    cli.on("exit", () => { cliExitSeen = true; });
    return cli;
  }
  if (argv.length === 1 && path.resolve(argv[0]) === SIM_SCRIPT) {
    fs.writeFileSync(file("sim-spawned"), String(Date.now()), "utf8");
    return realSpawn(process.execPath, [FAKE_SIM], opts);
  }
  return realSpawn.apply(this, arguments);
};

/* ── the lookups ──────────────────────────────────────────────────── */
/* process-lineage.js reads the whole table with one of these two commands;
   emulator-ports.js's `ps -p <pid>` (an image name) is not one of them. */
function isProcessTable(cmd, args) {
  return cmd === "powershell.exe" ||
    (cmd === "ps" && Array.isArray(args) && args.includes("-A"));
}

let slowed = false;
let cliReleased = false;
let tableReads = 0;
const realExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = function (cmd, args) {
  if ((SLOW_MS || HOLD) && cliExitSeen && !slowed) {
    slowed = true;
    fs.writeFileSync(file("read-after-cli-exit"), String(Date.now()), "utf8");
    if (SLOW_MS) block(SLOW_MS);
    const giveUp = Date.now() + 60000;
    while (HOLD && !fs.existsSync(file("read-go")) && Date.now() < giveUp) block(20);
  }
  if (!isProcessTable(cmd, args)) return realExecFileSync.apply(this, arguments);
  tableReads++;
  if (PS === "fail" || (PS === "fail-once" && tableReads === 1)) {
    throw new Error("staged by the test: no process table");
  }
  const table = realExecFileSync.apply(this, arguments);
  if (PS === "cli-exits-during-read" && !cliReleased) {
    cliReleased = true;
    fs.writeFileSync(file("release"), "", "utf8");
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(file("cli-exited")) && Date.now() < deadline) block(20);
    block(200);   // it wrote the file on its way out: let it finish going
  }
  return table;
};
