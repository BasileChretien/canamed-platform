#!/usr/bin/env node
/* scripts/sim/sim-with-emulator.js
 *
 * Drive scripts/sim/simulate-session.js against the local Firebase
 * emulator suite. This is the *reliable* sim path — unlike the default
 * LocalDB-backed run, the emulator gives every browser tab a real
 * WebSocket to a real RTDB process, so stage advances + presence sync
 * cross-tab without the storage-event drops we hit at 24-tab scale.
 *
 * Flow:
 *   1. Spawn `npx firebase emulators:start --only=database,auth` in
 *      the background. Wait until both ports are listening.
 *   2. Spawn the static platform server (scripts/serve-platform.js) on
 *      its usual port (8765).
 *   3. Set SIM_EMULATOR_MODE=1 + the host/port env vars so
 *      simulate-session.js's Playwright contexts pin
 *      window.CANAMED_EMULATOR = {host, dbPort, authPort} on init.
 *   4. Run simulate-session.js as a child process.
 *   5. Tear everything down regardless of pass/fail.
 *
 * No external deps beyond firebase-tools (already in node_modules — the
 * RTDB rules-test framework was bundled in for ops/cleanup-stale-sessions).
 * Java is required for the database emulator; the script checks early
 * and exits with a clear message if it isn't on PATH.
 *
 * Usage:
 *   node scripts/sim/sim-with-emulator.js
 *   SIM_STUDENTS=16 SIM_ROOM_COUNT=4 node scripts/sim/sim-with-emulator.js
 */

"use strict";

const { spawn, spawnSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const emulatorPorts = require("../ops/emulator-ports.js");
const processLineage = require("../ops/process-lineage.js");
/* The emulator needs its own copy of database.rules.json — its regex parser
 * rejects `\s` outright and MIS-PARSES every other backslash escape. The whole
 * transform, and the empirical evidence behind each substitution, lives in
 * build-emulator-rules.js.
 *
 * This file used to carry an inline SECOND COPY of that transform. The two
 * would have drifted the moment either was touched: build-emulator-rules.js was
 * fixed on 2026-08-06 and this copy would not have been, so `npm run
 * sim:emulator` would have kept running the broken rules while `npm run
 * test:e2e:rules` ran the fixed ones — two suites disagreeing about what the
 * rules say, with no signal that they did. Delegate, don't duplicate. */
const { buildEmulatorRules } = require("./build-emulator-rules.js");

const PLATFORM_DIR = path.resolve(__dirname, "..", "..",
  "docs", "Third_session", "PBL_platform");
const FIREBASE_CONFIG = path.join(PLATFORM_DIR, "firebase.json");
const RULES_EMU  = path.join(PLATFORM_DIR, "database.rules.emulator.json");
const FIREBASE_CONFIG_EMU = path.join(PLATFORM_DIR, "firebase.emulator.json");
const SERVE_PLATFORM = path.resolve(__dirname, "..", "serve-platform.js");
const SIM_SCRIPT     = path.resolve(__dirname, "simulate-session.js");

function cleanupEmulatorRules() {
  for (const p of [RULES_EMU, FIREBASE_CONFIG_EMU]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}

const DB_PORT   = parseInt(process.env.SIM_DB_PORT   || "9000", 10);
const AUTH_PORT = parseInt(process.env.SIM_AUTH_PORT || "9099", 10);
const HOST      = "127.0.0.1";

/* Helpers ─────────────────────────────────────────────────────────── */

function isPortOpen(port) {
  return new Promise(resolve => {
    const req = http.request({
      host: HOST, port: port, method: "GET", path: "/", timeout: 1000
    }, () => { resolve(true); req.destroy(); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { resolve(false); req.destroy(); });
    req.end();
  });
}
async function waitForPort(port, label, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(label + " never came up on port " + port +
    " (waited " + deadlineMs + "ms)");
}

/* Process management ───────────────────────────────────────────────── */

let firebaseProc = null;
let serveProc    = null;
/* Which emulator-port listeners THIS run started — the evidence the cleanup
   sweep needs before it may kill anything. That is LINEAGE from firebaseProc
   (ops/process-lineage.js), settled while the emulator is up.

   Until 2026-10-07 this was a set of every PID seen listening on the ports
   after waitForPort() — and waitForPort() succeeds against ANY listener. The
   ports are fixed and shared by every checkout on the machine, so a run that
   lost the race for :9000 to another session recorded THAT session's emulator
   as its own and killed it at cleanup. Seeing is not owning. */
let lineage = null;
function observeListeners() {
  if (!lineage) return;
  try {
    lineage.observe(emulatorPorts.listeners([DB_PORT, AUTH_PORT]).map(r => r.pid));
  } catch (_) { /* transient; the sweep reports what it cannot prove */ }
}
let simProc = null;
/* Set by cleanup(). Until then our emulator has no business exiting, and if it
   does, whatever answers on the ports afterwards is not it. */
let tearingDown = false;

/* The run cannot go on: what holds the emulator ports is not our emulator.
   Says so, kills nothing, and exits — the "exit" handler then cleans up by
   lineage, which leaves these listeners alone. */
function refuseForeign(rows, how) {
  console.error("FATAL: ANOTHER RUN HOLDS THE EMULATOR PORTS — " + how + ":\n" +
    emulatorPorts.describe(rows) + "\n\n" +
    "The ports were free at this run's preflight and were taken before its own\n" +
    "emulator could bind them. The firebase CLI says so as \"Port " + DB_PORT + " is not\n" +
    "open … could not start Database Emulator\"; \"emulator hub unable to start on\n" +
    "port 4400, starting on 4401 instead\" is the tell-tale that another hub is\n" +
    "alive. The sim is not being run against that listener.\n\n" +
    "NOTHING OF THEIRS IS KILLED: this run now stops its own processes, and\n" +
    "those only. Two sessions cannot run an emulator suite at once: wait for\n" +
    "the other run to end, then run this again — do not retry in a loop.");
  process.exit(1);
}

function cleanup() {
  tearingDown = true;
  for (const p of [simProc, firebaseProc, serveProc]) {
    /* exitCode: a child that has already ended has no tree left to kill, and
       its PID may be someone else's by now. */
    if (!p || p.killed || p.exitCode !== null) continue;
    try {
      if (process.platform === "win32") {
        // SIGTERM doesn't reliably kill Java grandchildren on Windows;
        // taskkill /T cascades through the process tree. Synchronous, so the
        // survey below sees what SURVIVED it rather than what it is still
        // killing (and so it runs at all from the "exit" handler).
        spawnSync("taskkill", ["/F", "/T", "/PID", String(p.pid)],
          { stdio: "ignore" });
      } else {
        p.kill("SIGTERM");
      }
    } catch (_) {}
  }
  /* Tree-kill only reaches the tree we own, and it did not reliably reap the
     RTDB emulator: observed 2026-08-05 leaving a java.exe listening on :9000
     after a clean exit, three runs for three. A leftover listener makes the
     NEXT run's waitForPort() succeed instantly against the STALE emulator, so
     the sim runs against the previous run's rules — or falls back to LocalDB
     and validates nothing at all. So look at the PORTS as a backstop — but
     kill only by LINEAGE: a listener is freed when it was shown to descend
     from firebaseProc and is still that process. Anything else there is
     another run's emulator or cannot be told from one, and is reported with
     the command to clear it by hand. */
  try {
    const survivors = emulatorPorts.survey([DB_PORT, AUTH_PORT]);
    const sorted = lineage
      ? lineage.partition(survivors)
      : { mine: [], notMine: [], unproven: survivors, why: [] };
    const ownedPids = new Set(sorted.mine.map(r => String(r.pid)));
    if (sorted.mine.length) {
      const killed = emulatorPorts.free([DB_PORT, AUTH_PORT], { onlyPids: ownedPids });
      console.log("Sim/emu: swept " + killed.length +
        " emulator listener(s) the tree-kill missed:\n" +
        emulatorPorts.describe(killed));
    }
    if (sorted.notMine.length) {
      console.warn("Sim/emu: these listeners were NOT started by this run, so " +
        "they were left alone:\n" + emulatorPorts.describe(sorted.notMine) +
        "\n\n" + emulatorPorts.LIVE_RUN_CAVEAT +
        "\n\nOnly when you know they are stale:\n  " +
        emulatorPorts.clearCommand(sorted.notMine));
    }
    if (sorted.unproven.length) {
      console.warn("Sim/emu: these listeners could NOT BE SHOWN to have been " +
        "started by this run, so they were left alone:\n" +
        emulatorPorts.describe(sorted.unproven) +
        (sorted.why.length ? "\n(" + sorted.why.join("; ") + ")" : "") +
        "\n\n" + emulatorPorts.LIVE_RUN_CAVEAT +
        "\n\nOnly when you know they are stale:\n  " +
        emulatorPorts.clearCommand(sorted.unproven));
    }
  } catch (e) {
    console.warn("Sim/emu: could not inspect the emulator ports at exit (" +
      ((e && e.message) || e) + ") — check by hand: npm run emulator:ports");
  }
}
process.on("SIGINT",  () => { cleanup(); cleanupEmulatorRules(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); cleanupEmulatorRules(); process.exit(143); });
process.on("exit",    () => { cleanup(); cleanupEmulatorRules(); });

/* Pre-flight ──────────────────────────────────────────────────────── */

function check(cmd, args, label) {
  return new Promise(resolve => {
    // shell:true so Windows can resolve `npx`/`java` from PATH variants
    // (`.cmd` / `.bat`) without us hardcoding the .cmd suffix.
    const p = spawn(cmd, args, {
      stdio: "pipe",
      shell: process.platform === "win32"
    });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    p.on("error", () => resolve(null));
    p.on("close", code => resolve(code === 0 ? out.trim() : null));
  });
}

(async () => {
  console.log("Sim/emu: pre-flight checks…");
  const javaV = await check("java", ["-version"], "java");
  if (javaV === null) {
    console.error("FATAL: Java is required for the Firebase RTDB emulator " +
      "but was not found on PATH. Install JDK 11+ (https://adoptium.net) " +
      "and re-run.");
    process.exit(1);
  }
  const fbV = await check("npx", ["firebase", "--version"], "firebase-tools");
  if (fbV === null) {
    console.error("FATAL: `npx firebase --version` failed. Run " +
      "`npm install firebase-tools --no-save` first.");
    process.exit(1);
  }
  console.log("Sim/emu: firebase-tools " + fbV + " · java OK");

  /* A STALE emulator is worse than none. waitForPort() below only checks that
     something is listening, so an orphan from a previous run (see cleanup())
     makes the readiness probe pass instantly and the sim then runs against
     THAT emulator — carrying the previous run's rules — or falls back to
     LocalDB and validates nothing. Fail loudly instead, the same way the
     :8765 check below already does. */
  const squatters = emulatorPorts.survey([DB_PORT, AUTH_PORT]);
  if (squatters.length) {
    console.error("FATAL: the emulator ports are already in use:\n" +
      emulatorPorts.describe(squatters) + "\n\n" +
      emulatorPorts.LIVE_RUN_CAVEAT + "\n\n" +
      "A STALE emulator would make this run silently validate the PREVIOUS\n" +
      "run's rules, or fall back to LocalDB and validate nothing. Only when you\n" +
      "know it is stale — a leftover from a run that has ended — clear it:\n" +
      "  npm run emulator:free\n" +
      "or, directly:\n  " + emulatorPorts.clearCommand(squatters) + "\n\n" +
      "If this is an emulator you started on purpose (`npm run emulator`),\n" +
      "stop it first — the sim must own its own instance.");
    process.exit(1);
  }

  if (!fs.existsSync(FIREBASE_CONFIG)) {
    console.error("FATAL: " + FIREBASE_CONFIG + " not found.");
    process.exit(1);
  }

  /* ── Boot the platform static server. We do NOT reuse an existing
     server on :8765 because the emulator-mode CSP relaxation lives in
     serve-platform.js's SIM_EMULATOR_MODE branch — an unbranded
     pre-existing server would block every emulator request with a
     "Refused to connect to http://127.0.0.1:9000" CSP violation.
     If something is on the port, surface it as a fatal so the user
     stops the conflicting process. */
  if (await isPortOpen(8765)) {
    console.error("FATAL: port 8765 is in use. Stop the existing server " +
      "(`taskkill /F /PID <pid>` on Windows, `lsof -i:8765` on Unix) " +
      "before running the emulator sim — its CSP must allow localhost " +
      "connections to the emulator, which the default dev server does not.");
    process.exit(1);
  }
  console.log("Sim/emu: starting static platform server on :8765 (emulator-CSP mode)…");
  serveProc = spawn(process.execPath, [SERVE_PLATFORM], {
    stdio: ["ignore", "inherit", "inherit"],
    env: Object.assign({}, process.env, { SIM_EMULATOR_MODE: "1" })
  });
  await waitForPort(8765, "static server", 10_000);

  /* ── Boot the Firebase emulator (using the emulator-patched rules). */
  console.log("Sim/emu: preparing emulator-compatible rules…");
  buildEmulatorRules();
  console.log("Sim/emu: starting firebase emulators (database + auth)…");
  const spawnedAt = Date.now();   // BEFORE the spawn: nothing of ours is older
  firebaseProc = spawn("npx", [
    "firebase", "emulators:start",
    "--only=database,auth",
    "--config", FIREBASE_CONFIG_EMU,
    "--project", "canamed-sim"
  ], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",   // npx.cmd on Windows
    env: Object.assign({}, process.env, {
      // The DB emulator picks a working directory from where it's
      // invoked when no --project is given; --project + a stable cwd
      // avoid the "Cannot determine project ID" error.
      FIREBASE_PROJECT_ID: "canamed-sim"
    })
  });
  lineage = processLineage.track(firebaseProc.pid, { spawnedAt });
  firebaseProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error("Sim/emu: firebase emulator exited with code " + code);
    }
    if (tearingDown) return;
    /* Our emulator has gone while the run still needs it — which is what
       losing the race for the ports looks like from here: the CLI finds :9000
       taken and exits. This must END the run, at whatever point it happens:
       waitForPort() below is satisfied by ANY listener, so without this the
       sim would go on against whoever holds the ports. It does not depend on
       reading the process table, which may be slow or unavailable. */
    /* WHO holds the ports now decides what is said, not whether the run ends.
       Only a listener SHOWN not to be ours is called another run's: one left
       behind by our own emulator crashing looks the same from the port, and
       blaming another session for that would send the reader the wrong way. */
    let sorted = { notMine: [], unproven: [] };
    try {
      sorted = lineage.partition(emulatorPorts.survey([DB_PORT, AUTH_PORT]));
    } catch (_) { /* reported as the plain exit below */ }
    if (sorted.notMine.length) {
      refuseForeign(sorted.notMine,
        "this run's own emulator has exited, and what holds the ports is not it");
    }
    console.error("FATAL: this run's emulator exited before the sim was done " +
      "(see the firebase CLI's output above)." +
      (sorted.unproven.length
        ? "\nStill on the ports, and NOT SHOWN to be this run's:\n" +
          emulatorPorts.describe(sorted.unproven) + "\n\n" +
          emulatorPorts.LIVE_RUN_CAVEAT
        : ""));
    process.exit(1);
  });
  // Wait for BOTH the DB + Auth emulator ports to come up. The DB
  // emulator spends ~10s downloading + warming up on first run, so the
  // deadline is generous.
  await waitForPort(DB_PORT,   "RTDB emulator",  120_000);
  await waitForPort(AUTH_PORT, "Auth emulator",  60_000);
  /* "Something answers on the port" is NOT "our emulator is up". The ports
     were free at the preflight, but that was one instant: another session's
     emulator can have bound them since, in which case OURS failed to start and
     waitForPort() has just succeeded against THEIRS. Running the sim now would
     validate their rules and write our test data into their database — and
     the old cleanup then killed their emulator on the way out. So look at who
     is listening before going any further. */
  observeListeners();
  /* Everything since the probe answered has been synchronous (the lookup above
     can take seconds), and a child that died in the meantime still reads as
     running until the event loop turns. Let it turn: if our CLI has exited,
     its "exit" handler above ends the run here, before the sim starts. */
  await new Promise(r => setTimeout(r, 250));
  const foreign = emulatorPorts.survey([DB_PORT, AUTH_PORT])
    .filter(r => lineage.verdict(r.pid) === "not-ours");
  if (foreign.length) refuseForeign(foreign, "this run did not start");
  const ownershipPoll = setInterval(observeListeners, 5000);
  ownershipPoll.unref();
  console.log("Sim/emu: emulator is up — RTDB on :" + DB_PORT +
    ", Auth on :" + AUTH_PORT);

  /* ── Run the sim. Inherit stdio so its progress + report path appear
     inline. */
  console.log("Sim/emu: running simulate-session.js against the emulator…");
  const simEnv = Object.assign({}, process.env, {
    SIM_EMULATOR_MODE: "1",
    SIM_EMULATOR_HOST: HOST,
    SIM_DB_PORT: String(DB_PORT),
    SIM_AUTH_PORT: String(AUTH_PORT)
  });
  /* Module-level, so that a run cut short (our emulator gone, see the "exit"
     handler above) takes the sim down with it instead of leaving it writing
     to whoever holds the ports. */
  simProc = spawn(process.execPath, [SIM_SCRIPT], {
    stdio: ["ignore", "inherit", "inherit"], env: simEnv
  });
  await new Promise(resolve => {
    simProc.on("exit", code => {
      console.log("Sim/emu: sim exited with code " + code);
      resolve(code);
    });
  });
  console.log("Sim/emu: done — tearing down emulator + server.");
  cleanup();
  // give the cleanup taskkill a tick to dispatch before exit
  setTimeout(() => process.exit(0), 500);
})().catch(err => {
  console.error("Sim/emu: FATAL", err && err.stack || err);
  cleanup();
  process.exit(1);
});
