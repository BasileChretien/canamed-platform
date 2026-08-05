#!/usr/bin/env node
/* scripts/ops/run-rules-e2e.js — the rules-exercising E2E run, with hygiene
 *
 * `npm run test:e2e:rules` used to be a single shell line:
 *
 *   build-emulator-rules && firebase emulators:exec ... "playwright test ..."
 *
 * which had no preflight and no teardown. Three defects followed from that,
 * all observed on 2026-08-05 and all of which present as something else:
 *
 *   1. NO TEARDOWN. `emulators:exec` signals its child, but on Windows the
 *      RTDB emulator is a Java grandchild (npx → node → java) that survives.
 *      Three consecutive runs each left a listener on :9000 and :9099 after
 *      exiting 0.
 *   2. NO PREFLIGHT. Given (1), the NEXT run's readiness probe succeeds
 *      instantly against the stale emulator — carrying the PREVIOUS run's
 *      rules — so the suite validates the wrong thing, or hangs until every
 *      test times out. That reads as "the environment is broken", not as
 *      "there is an old process on 9000", and has cost real debugging time.
 *   3. PORT COLLISION. The Playwright config hardcoded :8765, which
 *      AnkiConnect also owns on at least one dev machine, and combined it
 *      with reuseExistingServer — so the run would silently ADOPT a server
 *      started without SIM_EMULATOR_MODE=1, whose CSP forbids connecting to
 *      the emulator. Every test then fails on a CSP violation that looks
 *      like a rules failure.
 *
 * So: check first (naming any squatter and refusing to guess), run, and free
 * the emulator ports whatever the outcome. The sweep is OWNERSHIP-SCOPED — it
 * kills only PIDs observed listening on the emulator ports while our own child
 * was running, because a preflight proves the port state at one instant and an
 * unrelated process could bind :9000 afterwards; anything else on those ports
 * is reported with a manual command, never killed. It also only ever runs
 * AFTER the child has exited (a signal to this runner forwards to the child
 * and waits first) — it is a survivor sweep, not a kill switch.
 *
 * Usage:  node scripts/ops/run-rules-e2e.js [extra playwright args...]
 *         PORT=8771 node scripts/ops/run-rules-e2e.js
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ports = require("./emulator-ports.js");

const ROOT = path.resolve(__dirname, "..", "..");
const DB_PORT = parseInt(process.env.SIM_DB_PORT || "9000", 10);
const AUTH_PORT = parseInt(process.env.SIM_AUTH_PORT || "9099", 10);
const WEB_PORT = parseInt(process.env.PORT || "8765", 10);
const EMU_PORTS = [DB_PORT, AUTH_PORT];

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

/* ── 1. Preflight ─────────────────────────────────────────────────── */
let held;
try {
  held = ports.survey([...EMU_PORTS, WEB_PORT]);
} catch (e) {
  /* Fail CLOSED. If we cannot see who holds the ports we must not assume they
     are free — that is how a stale emulator gets waved through. */
  fatal("rules-e2e: FATAL — " + (e && e.message || e));
}
if (held.length) {
  fatal(
    "rules-e2e: FATAL — a port this run needs is already in use:\n" +
    ports.describe(held) + "\n\n" +
    "Emulator ports (" + EMU_PORTS.join(", ") + "): a stale listener makes the\n" +
    "readiness probe succeed against the WRONG emulator, so the suite either\n" +
    "validates the previous run's rules or times out looking like an\n" +
    "environment fault.\n" +
    "Web port (" + WEB_PORT + "): the platform server must be started by THIS run\n" +
    "with SIM_EMULATOR_MODE=1 — a server started without it serves a CSP that\n" +
    "forbids connecting to the emulator, and every test fails on that instead\n" +
    "of on a rule. (AnkiConnect owns 8765 on some machines: re-run with\n" +
    "PORT=8771.)\n\n" +
    "Clear the emulator ports with:\n  node scripts/ops/emulator-ports.js free\n" +
    "or, directly:\n  " + ports.clearCommand(held));
}

/* ── 2. Emulator-compatible rules ─────────────────────────────────── */
console.log("rules-e2e: building emulator-compatible rules…");
const build = spawnSync(process.execPath,
  [path.join(ROOT, "scripts", "sim", "build-emulator-rules.js")],
  { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) fatal("rules-e2e: build-emulator-rules.js failed.");

/* ── 3. Run under emulators:exec ──────────────────────────────────── */
/* emulators:exec runs its command through a SHELL, so the nested command has to
   survive one round of shell tokenisation. A bare join(" ") does not: forwarded
   arguments like `--grep "roomOf peer"` would be split back into two tokens and
   the filter would silently match nothing. Quote any token that is not plainly
   safe, per platform. */
function shQuote(tok) {
  const s = String(tok);
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(s)) return s;      // nothing a shell reads
  if (process.platform === "win32") {
    // cmd.exe: double quotes, and "" escapes an embedded double quote.
    return '"' + s.replace(/"/g, '""') + '"';
  }
  // POSIX sh: single quotes are literal; close/escape/reopen for an embedded '.
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
const playwright = ["npx", "playwright", "test",
  "--config=playwright.emulator.config.js", ...process.argv.slice(2)]
  .map(shQuote).join(" ");

/* emulators:exec takes the whole command as ONE argument, and getting that one
   argument to it differs sharply by platform.
 *
 * POSIX: shell is false, so argv reaches emulators:exec literally. Pass the
 * command string as-is; an added quote would become part of the command.
 *
 * WINDOWS: we must go through cmd.exe (npx is npx.cmd), and Node does not quote
 * argv when shelling out — it joins with spaces — so an unwrapped string
 * arrives as five separate arguments and emulators:exec runs only `npx`.
 * Wrapping it in quotes fixes THAT, but breaks the moment a forwarded argument
 * is itself quoted (`--grep "roomOf peer"`): cmd.exe has no escape for a double
 * quote inside a double-quoted string, so the nesting mis-parses and firebase
 * reports "Too many arguments". Observed, not theorised.
 *
 * So on Windows the command goes into a temp .cmd file and emulators:exec is
 * handed the PATH — one token, quoted once, with no nested quotes anywhere.
 * Whatever the arguments contain, they are written verbatim into the script.
 * (`%` is doubled: it is the only character cmd expands inside a batch file.) */
let tempScript = null;
let execArg = playwright;
if (process.platform === "win32") {
  tempScript = path.join(os.tmpdir(), "canamed-rules-e2e-" + process.pid + ".cmd");
  fs.writeFileSync(tempScript,
    "@echo off\r\n" +
    /* The file is written UTF-8, but cmd.exe reads a batch file in the OEM
       codepage — so a non-ASCII argument arrives mangled. Observed: a
       `--grep` containing an arrow became "Ôåæ" and matched no tests, which
       presents as "No tests found" (i.e. "there is no such test") rather than
       "your argument was corrupted". cmd re-reads the file line by line, so
       switching the codepage here governs every later line. Verified against
       a mangling repro, not assumed. */
    "chcp 65001 >nul\r\n" +
    playwright.replace(/%/g, "%%") + "\r\n", "utf8");
  execArg = '"' + tempScript + '"';
}
function dropTempScript() {
  if (!tempScript) return;
  try { fs.unlinkSync(tempScript); } catch (e) { /* already gone */ }
  tempScript = null;
}

console.log("rules-e2e: starting emulators (database + auth) and running the suite…");
const child = spawn("npx", [
  "firebase", "emulators:exec",
  "--only", "database,auth",
  "--config", "docs/Third_session/PBL_platform/firebase.emulator.json",
  "--project", "canamed-sim",
  execArg
], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",   // npx.cmd on Windows
  env: Object.assign({}, process.env, { PORT: String(WEB_PORT) })
});

/* ── 4. Establish OWNERSHIP while the run is live ─────────────────── */
/* The preflight proves the port state at one instant. Between then and the
   sweep an unrelated process could bind :9000, and a sweep that went by port
   number alone would kill a stranger. So record every PID seen listening on
   the emulator ports WHILE our child is running: those are the ones this run
   caused. A survivor not in this set is reported, never killed. */
const ownedPids = new Set();
const ownershipPoll = setInterval(() => {
  try {
    for (const row of ports.survey(EMU_PORTS)) ownedPids.add(String(row.pid));
  } catch (e) { /* transient; the sweep reports what it cannot prove */ }
}, 2000);
ownershipPoll.unref();

/* ── 5. Survivor sweep, whatever happened ─────────────────────────── */
let swept = false;
function sweep() {
  if (swept) return;
  swept = true;
  dropTempScript();
  clearInterval(ownershipPoll);
  let survivors;
  try {
    survivors = ports.survey(EMU_PORTS);
  } catch (e) {
    console.warn("rules-e2e: could not inspect the emulator ports at exit (" +
      (e && e.message || e) + ") — check them by hand: npm run emulator:ports");
    return;
  }
  if (!survivors.length) return;
  const strangers = survivors.filter((r) => !ownedPids.has(String(r.pid)));
  const mine = survivors.filter((r) => ownedPids.has(String(r.pid)));
  if (mine.length) {
    const killed = ports.free(EMU_PORTS, { onlyPids: ownedPids });
    console.log("rules-e2e: emulators:exec left " + killed.length +
      " listener(s) behind; freed them:\n" + ports.describe(killed));
  }
  if (strangers.length) {
    console.warn("rules-e2e: these listeners were NOT started by this run, so " +
      "they were left alone:\n" + ports.describe(strangers) +
      "\nClear them yourself if they are stale:\n  " + ports.clearCommand(strangers));
  }
}

/* A signal to the RUNNER must not race the child. Sweeping immediately would
   force-kill the emulator ports while emulators:exec is still running against
   them. Forward the signal, wait (bounded — a wedged child must not hang the
   shell forever), then sweep. */
function stop(signal, exitCode) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    } else {
      child.kill(signal);
    }
  } catch (e) { /* already gone */ }
  const deadline = Date.now() + 10000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},150)"], { stdio: "ignore" });
  }
  sweep();
  process.exit(exitCode);
}
process.on("SIGINT", () => stop("SIGINT", 130));
process.on("SIGTERM", () => stop("SIGTERM", 143));

child.on("exit", (code, signal) => {
  sweep();
  const status = code === null ? 1 : code;
  console.log("rules-e2e: suite exited with " +
    (signal ? "signal " + signal : "code " + status) + ".");
  process.exit(status);
});
child.on("error", (err) => {
  sweep();
  fatal("rules-e2e: could not start emulators:exec — " + (err && err.message || err));
});
