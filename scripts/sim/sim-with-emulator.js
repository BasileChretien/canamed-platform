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

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const emulatorPorts = require("../ops/emulator-ports.js");
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
/* PIDs seen listening on the emulator ports while THIS run owned them — the
   evidence the cleanup sweep needs before it may kill anything. Filled in once
   the emulator comes up, and topped up as the run proceeds. */
const ownedPids = new Set();
function noteOwnedPids() {
  try {
    for (const row of emulatorPorts.survey([DB_PORT, AUTH_PORT])) {
      ownedPids.add(String(row.pid));
    }
  } catch (_) { /* transient; the sweep reports what it cannot prove */ }
}
function cleanup() {
  for (const p of [firebaseProc, serveProc]) {
    if (!p || p.killed) continue;
    try {
      if (process.platform === "win32") {
        // SIGTERM doesn't reliably kill Java grandchildren on Windows;
        // taskkill /T cascades through the process tree.
        spawn("taskkill", ["/F", "/T", "/PID", String(p.pid)],
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
     and validates nothing at all. Sweep by PORT as a backstop.
     OWNERSHIP-SCOPED: only PIDs seen listening on the emulator ports while THIS
     run held them are killed. The preflight proves the port state at one
     instant; a process that bound the port afterwards is not ours to kill, so
     it is reported with a manual command instead. */
  try {
    const survivors = emulatorPorts.survey([DB_PORT, AUTH_PORT]);
    const mine = survivors.filter(r => ownedPids.has(String(r.pid)));
    const strangers = survivors.filter(r => !ownedPids.has(String(r.pid)));
    if (mine.length) {
      const killed = emulatorPorts.free([DB_PORT, AUTH_PORT], { onlyPids: ownedPids });
      console.log("Sim/emu: swept " + killed.length +
        " emulator listener(s) the tree-kill missed:\n" +
        emulatorPorts.describe(killed));
    }
    if (strangers.length) {
      console.warn("Sim/emu: these listeners were NOT started by this run, so " +
        "they were left alone:\n" + emulatorPorts.describe(strangers) +
        "\nClear them yourself if they are stale:\n  " +
        emulatorPorts.clearCommand(strangers));
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
      "A stale emulator would make this run silently validate the PREVIOUS\n" +
      "run's rules, or fall back to LocalDB and validate nothing. Clear it:\n" +
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
  firebaseProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error("Sim/emu: firebase emulator exited with code " + code);
    }
  });
  // Wait for BOTH the DB + Auth emulator ports to come up. The DB
  // emulator spends ~10s downloading + warming up on first run, so the
  // deadline is generous.
  await waitForPort(DB_PORT,   "RTDB emulator",  120_000);
  await waitForPort(AUTH_PORT, "Auth emulator",  60_000);
  /* The ports were verified FREE in the preflight, and we started what is on
     them now — so whatever is listening at this moment is ours, and that is the
     evidence cleanup() needs before it may kill by port number. */
  noteOwnedPids();
  const ownershipPoll = setInterval(noteOwnedPids, 5000);
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
  const sim = spawn(process.execPath, [SIM_SCRIPT], {
    stdio: ["ignore", "inherit", "inherit"], env: simEnv
  });
  await new Promise(resolve => {
    sim.on("exit", code => {
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
