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
 * what THIS RUN left on the emulator ports, whatever the outcome.
 *
 * THE SWEEP KILLS BY LINEAGE, NEVER BY PORT. It frees a listener only when
 * that process was SHOWN — while our own child was still alive — to descend
 * from the child this runner spawned (npx → node → java on Windows), and is
 * still that same process when the sweep runs (process-lineage.js does the
 * showing). Any other listener on those ports is reported, with the command to
 * clear it by hand, and left alone. It is a survivor sweep, not a kill switch:
 * it runs from the child's own "exit" event, on the normal path and on a
 * signal alike. On a signal to this runner, stop() forwards it to the child and
 * the run ends when the child has exited — or after 10 s, if it has not: the
 * bound is real, and on POSIX a child slower than that to shut down is swept
 * while still exiting.
 *
 * That rule is the repair of a FOURTH defect, which the sweep itself brought in:
 *
 *   4. TWO RUNS AT ONCE (2026-10-07). This header used to call the sweep
 *      "OWNERSHIP-SCOPED — it kills only PIDs observed listening on the
 *      emulator ports while our own child was running". Observing a process on
 *      a port is not having started it. Several sessions work in this
 *      repository at once, each in its own worktree, all on the same two
 *      ports: run A passed its preflight, run B's emulator bound :9000 before
 *      A's `emulators:exec` got there, A's emulator failed to start — and A's
 *      poll had meanwhile "observed" B's java.exe on :9000, so A's sweep killed
 *      it and printed "emulators:exec left 1 listener(s) behind; freed them".
 *      B then died mid-suite ("Database Emulator has exited with code: 1", or
 *      every test timing out). Seen in both directions, two sessions each
 *      retrying and each killing the other.
 *
 * THE RULES SUITE CANNOT BE RUN BY TWO SESSIONS AT ONCE. The ports are fixed:
 * 9000/9099 are hard-coded in tests-e2e/emulator/fixtures.js, so the
 * SIM_DB_PORT / SIM_AUTH_PORT read below move this runner's CHECKS, not the
 * emulators. A second run is refused by the preflight. The preflight proves
 * the port state at one instant, though, and nothing can close the seconds
 * between it and our emulator binding; a run that loses that race fails to
 * start ("Port 9000 is not open on 127.0.0.1, could not start Database
 * Emulator", and "emulator hub unable to start on port 4400, starting on 4401
 * instead" — the tell-tale that another hub is alive). It then exits non-zero
 * and KILLS NOTHING, and says that ANOTHER RUN HOLDS THE EMULATOR PORTS
 * whenever that can be shown: the listener was seen outside our child's tree
 * while the child lived, or is older than our child, or (Windows) hangs off a
 * process that is. Where none of those holds — on POSIX, a CLI that died
 * before the first look at a listener younger than itself — the same listener
 * is reported as one that "could NOT BE SHOWN" to be this run's, with the same
 * warning that it may be another session's emulator.
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
const processLineage = require("./process-lineage.js");

const ROOT = path.resolve(__dirname, "..", "..");
const DB_PORT = parseInt(process.env.SIM_DB_PORT || "9000", 10);
const AUTH_PORT = parseInt(process.env.SIM_AUTH_PORT || "9099", 10);
const WEB_PORT = parseInt(process.env.PORT || "8765", 10);
const EMU_PORTS = [DB_PORT, AUTH_PORT];
/* How often the emulator ports are looked at while the child runs. FAST until
   each port's listener has a verdict: lineage can only be shown while the
   child is alive, and a run that ends quickly (a filter matching no test, a
   config error) must not end before its own emulator has been recognised —
   that leftover would then be reported instead of freed. Bounded, because a
   port that never gets a verdict must not keep netstat spinning all suite. */
const OWNERSHIP_POLL_FAST_MS = 500;
const OWNERSHIP_POLL_MS = 2000;
const OWNERSHIP_FAST_FOR_MS = 60000;

/* Resolve the firebase CLI.
 *
 * Prefer the version-pinned copy in tools/firebase-cli — its own package +
 * lockfile, so the CLI's whole tree (670 packages) is pinned by integrity
 * hash without any of it entering the ROOT lock. Fall back to `npx firebase`
 * so a checkout that has not installed it behaves exactly as before.
 *
 * Do NOT try to select the pinned copy by putting its .bin directory on PATH
 * and still calling `npx firebase`. npx resolves the local node_modules/.bin
 * and then the npm GLOBAL prefix, and ignores PATH — so on a machine that has
 * a global firebase-tools it silently runs THAT version. Verified 2026-08-17:
 * with the pinned 15.27.0 first on PATH, `npx firebase --version` still
 * reported the global 15.19.0, while a plain shell `firebase --version`
 * correctly reported 15.27.0. A pin that npx quietly ignores is worse than no
 * pin, because it reads as pinned. Hence the explicit path below. */
function firebaseCli() {
  const win = process.platform === "win32";
  const pinned = path.join(ROOT, "tools", "firebase-cli", "node_modules",
                           ".bin", win ? "firebase.cmd" : "firebase");
  if (!fs.existsSync(pinned)) {
    return { cmd: "npx", pre: ["firebase"], label: "npx firebase (UNPINNED fallback)" };
  }
  /* shell:true on Windows re-parses the command through cmd.exe, so a path
     containing a space has to arrive quoted. */
  return {
    cmd: win && /\s/.test(pinned) ? '"' + pinned + '"' : pinned,
    pre: [],
    label: pinned
  };
}

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
    ports.LIVE_RUN_CAVEAT + "\n\n" +
    "Emulator ports (" + EMU_PORTS.join(", ") + "): a STALE listener makes the\n" +
    "readiness probe succeed against the WRONG emulator, so the suite either\n" +
    "validates the previous run's rules or times out looking like an\n" +
    "environment fault.\n" +
    "Web port (" + WEB_PORT + "): the platform server must be started by THIS run\n" +
    "with SIM_EMULATOR_MODE=1 — a server started without it serves a CSP that\n" +
    "forbids connecting to the emulator, and every test fails on that instead\n" +
    "of on a rule. (AnkiConnect owns 8765 on some machines: re-run with\n" +
    "PORT=8771.)\n\n" +
    "Only when you know the listener is stale — a leftover from a run that has\n" +
    "ended — clear the emulator ports with:\n  node scripts/ops/emulator-ports.js free\n" +
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
const fbCli = firebaseCli();
console.log("rules-e2e: firebase CLI -> " + fbCli.label);
const spawnedAt = Date.now();   // BEFORE the spawn: nothing of ours is older
const child = spawn(fbCli.cmd, fbCli.pre.concat([
  "emulators:exec",
  "--only", "database,auth",
  "--config", "docs/Third_session/PBL_platform/firebase.emulator.json",
  "--project", "canamed-sim",
  execArg
]), {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",   // firebase.cmd / npx.cmd on Windows
  env: Object.assign({}, process.env, { PORT: String(WEB_PORT) })
});

/* ── 4. Establish OWNERSHIP while the run is live ─────────────────── */
/* The preflight proves the port state at one instant. Between then and the
   sweep another process can bind :9000 — in practice another session's run —
   and a sweep that went by port number would kill it.

   So ownership is LINEAGE: a listener is ours when it descends from `child`.
   That has to be settled NOW, while the chain from the listener up to `child`
   is alive: by the time the sweep runs, the survivor it is for is an orphan
   whose parent no longer exists, and nothing could be shown about it. Each
   new listener on the emulator ports is therefore looked up once
   (process-lineage.js), and the verdict remembered for the sweep.

   What the poll must NOT do is what it did until 2026-10-07: add every PID it
   sees on the ports to an "owned" set. See defect 4 in the header. */
const lineage = processLineage.track(child.pid, { spawnedAt });
const announced = new Set();
const settledPorts = new Set();
function observeListeners() {
  let rows;
  try {
    rows = ports.listeners(EMU_PORTS);
  } catch (e) {
    return;   // transient; the sweep reports what it cannot prove
  }
  lineage.observe(rows.map((r) => r.pid));
  for (const row of rows) {
    const verdict = lineage.verdict(row.pid);
    const key = row.port + "/" + row.pid;
    if (!verdict || announced.has(key)) continue;
    announced.add(key);
    settledPorts.add(row.port);
    const who = "PID " + row.pid + " (" + ports.imageName(row.pid) + ")";
    if (verdict === "ours") {
      console.log("rules-e2e: :" + row.port + " is this run's own emulator — " + who + ".");
    } else {
      /* Said the moment it is seen, so it sits next to the CLI's own "port
         taken" in the log rather than only in the summary at the end. */
      console.warn("rules-e2e: WARNING — :" + row.port + " is held by " + who +
        ", which this run DID NOT START. Another run holds the emulator ports, " +
        "so this run's own emulator cannot bind them. Nothing will be killed.");
    }
  }
}
let ownershipPoll = null;
function pollOwnership() {
  observeListeners();
  const fast = Date.now() - spawnedAt < OWNERSHIP_FAST_FOR_MS &&
    !EMU_PORTS.every((p) => settledPorts.has(p));
  ownershipPoll = setTimeout(pollOwnership, fast ? OWNERSHIP_POLL_FAST_MS : OWNERSHIP_POLL_MS);
  ownershipPoll.unref();
}
ownershipPoll = setTimeout(pollOwnership, OWNERSHIP_POLL_FAST_MS);
ownershipPoll.unref();

/* ── 5. Survivor sweep, whatever happened ─────────────────────────── */
/* `failed` — our child exited non-zero of its own accord. Together with a
   listener that is not ours, that is the lost race for the ports, and the
   report says so in as many words instead of leaving a "port taken" from the
   CLI to be read as an environment fault. */
function reportAnotherRun(notMine, freedPids) {
  let hub = [];
  try {
    hub = ports.survey([ports.HUB_PORT]).filter((r) => !freedPids.has(String(r.pid)));
  } catch (e) { /* the hub is supporting evidence only */ }
  console.error(
    "rules-e2e: ANOTHER RUN HOLDS THE EMULATOR PORTS. This run did not start:\n" +
    ports.describe(notMine) + "\n" +
    (hub.length
      ? ports.describe(hub) + "   <- the emulator hub: another emulator is alive\n"
      : "") +
    "\nThe ports were free at this run's preflight and were taken before its own\n" +
    "emulator could bind them. That is what \"Port " + DB_PORT + " is not open … could\n" +
    "not start Database Emulator\" above means, and \"emulator hub unable to start\n" +
    "on port 4400, starting on 4401 instead\" is the same tell-tale.\n\n" +
    (freedPids.size ? "NOTHING OF THEIRS WAS KILLED" : "NOTHING WAS KILLED") +
    ": that listener is another run's emulator, and killing it\n" +
    "fails that run mid-suite. The rules suite cannot be run by two sessions at once.\n" +
    "Wait for the other run to end, then run this again — do not retry in a loop.\n\n" +
    "Only when you know no other run is in progress (the listener is a leftover):\n  " +
    ports.clearCommand(notMine));
}

let swept = false;
function sweep(failed) {
  if (swept) return;
  swept = true;
  dropTempScript();
  clearTimeout(ownershipPoll);
  let survivors;
  try {
    survivors = ports.survey(EMU_PORTS);
  } catch (e) {
    console.warn("rules-e2e: could not inspect the emulator ports at exit (" +
      (e && e.message || e) + ") — check them by hand: npm run emulator:ports");
    return;
  }
  if (!survivors.length) return;
  const { mine, notMine, unproven, why } = lineage.partition(survivors);
  const ownedPids = new Set(mine.map((r) => String(r.pid)));
  if (mine.length) {
    const killed = ports.free(EMU_PORTS, { onlyPids: ownedPids });
    console.log("rules-e2e: emulators:exec left " + killed.length +
      " listener(s) behind; freed them:\n" + ports.describe(killed));
  }
  if (notMine.length && failed) {
    reportAnotherRun(notMine, ownedPids);
  } else if (notMine.length) {
    console.warn("rules-e2e: these listeners were NOT started by this run, so " +
      "they were left alone:\n" + ports.describe(notMine) + "\n\n" +
      ports.LIVE_RUN_CAVEAT + "\n\nOnly when you know they are stale:\n  " +
      ports.clearCommand(notMine));
  }
  if (unproven.length) {
    console.warn("rules-e2e: these listeners could NOT BE SHOWN to have been " +
      "started by this run, so they were left alone:\n" + ports.describe(unproven) +
      "\n(" + (why.length
        ? why.join("; ")
        : "they appeared after this run's last look at the ports, or outlived " +
          "the process that would have vouched for them") + ")\n\n" +
      ports.LIVE_RUN_CAVEAT + "\n\nOnly when you know they are stale:\n  " +
      ports.clearCommand(unproven));
  }
}

/* A signal to the RUNNER must not race the child. Sweeping immediately would
   force-kill the emulator ports while emulators:exec is still running against
   them. So: forward the signal, WAIT FOR THE CHILD TO EXIT, then sweep.

   The wait is the child's own "exit" event — the handler below is where an
   interrupted run ends — bounded by a timer, because a wedged child must not
   hang the shell forever. Both need the event loop, so stop() RETURNS: it
   must never wait for the child synchronously. (Windows' taskkill is the one
   synchronous step left in it; that is what ends the child, and it is brief.)

   Until 2026-10-08 it did. It looped on `child.exitCode === null` around a
   synchronous sleep, and exitCode is set by the same turn of the event loop
   that would have emitted "exit": the condition could not change, so the loop
   always ran to its deadline. Every Ctrl-C cost the full 10 s, child gone or
   not.

   A second signal while the first is being handled changes nothing. The child
   has been told once — telling it again gains nothing, and on Windows it would
   be a second walk of ParentProcessId over a tree the first has already
   killed. The bound is already running, and the exit code stays the first
   signal's. */
const STOP_WAIT_MS = 10000;
let interrupted = null;   // { signal, exitCode }, from the first signal on
function stop(signal, exitCode) {
  if (interrupted) {
    console.warn("rules-e2e: " + signal + " — already stopping (" +
      interrupted.signal + "); waiting for the suite to exit.");
    return;
  }
  interrupted = { signal, exitCode };
  console.log("rules-e2e: " + signal + " — stopping the suite, then sweeping once " +
    "it has exited (" + STOP_WAIT_MS / 1000 + " s at most).");
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    } else {
      child.kill(signal);
    }
  } catch (e) { /* already gone */ }
  setTimeout(() => {
    console.warn("rules-e2e: the suite did not exit within " + STOP_WAIT_MS / 1000 +
      " s of " + signal + " — sweeping without waiting for it any longer.");
    sweep(false);   // interrupted, not failed: nothing can be read into the exit
    process.exit(exitCode);
  }, STOP_WAIT_MS);
}
process.on("SIGINT", () => stop("SIGINT", 130));
process.on("SIGTERM", () => stop("SIGTERM", 143));

child.on("exit", (code, signal) => {
  if (interrupted) {
    /* The wait stop() began ends here: the child is gone, so the sweep can no
       longer race it. */
    sweep(false);
    process.exit(interrupted.exitCode);
  }
  const status = code === null ? 1 : code;
  sweep(status !== 0 && !signal);
  console.log("rules-e2e: suite exited with " +
    (signal ? "signal " + signal : "code " + status) + ".");
  process.exit(status);
});
child.on("error", (err) => {
  sweep(false);   // nothing was started, so nothing lost a race
  fatal("rules-e2e: could not start emulators:exec — " + (err && err.message || err));
});
