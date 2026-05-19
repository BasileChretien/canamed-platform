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

const PLATFORM_DIR = path.resolve(__dirname, "..", "..",
  "docs", "Third_session", "PBL_platform");
const FIREBASE_CONFIG = path.join(PLATFORM_DIR, "firebase.json");
const RULES_PROD = path.join(PLATFORM_DIR, "database.rules.json");
const RULES_EMU  = path.join(PLATFORM_DIR, "database.rules.emulator.json");
const FIREBASE_CONFIG_EMU = path.join(PLATFORM_DIR, "firebase.emulator.json");
const SERVE_PLATFORM = path.resolve(__dirname, "..", "serve-platform.js");
const SIM_SCRIPT     = path.resolve(__dirname, "simulate-session.js");

/* The production database.rules.json uses `\\s` inside RegExp literals
 * (`[^\\s]+` for "non-whitespace"). Real Firebase RTDB accepts this;
 * the local emulator's stricter regex parser rejects it with
 * "Illegal regular expression, 'whitespacechar' not found". Workaround:
 * write an emulator-only copy that swaps `\\s` for an explicit
 * whitespace class. Production rules are NOT modified. */
function buildEmulatorRules() {
  // Swap the JSON-escaped \s (which the file stores as the two-char
  // sequence \\s, displayed in od as `\ \ s`) for the JSON-escaped
  // explicit whitespace class \t\n\r and a literal space (each
  // metachar is two backslashes in JSON). The function-form replace
  // keeps the literal string intact regardless of shell quoting.
  const src = fs.readFileSync(RULES_PROD, "utf8");
  const patched = src.replace(/\\\\s/g, () => "\\\\t\\\\n\\\\r ");
  fs.writeFileSync(RULES_EMU, patched, "utf8");
  // Companion firebase.json that points at the patched rules.
  const cfgSrc = JSON.parse(fs.readFileSync(FIREBASE_CONFIG, "utf8"));
  if (cfgSrc.database) cfgSrc.database.rules = "database.rules.emulator.json";
  fs.writeFileSync(FIREBASE_CONFIG_EMU, JSON.stringify(cfgSrc, null, 2), "utf8");
}
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
