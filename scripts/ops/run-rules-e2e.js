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
 * the emulator ports in a `finally` whatever the outcome. The port sweep is
 * scoped to the ports this run owns, and only ever runs AFTER the child has
 * exited — it is a survivor sweep, not a kill switch.
 *
 * Usage:  node scripts/ops/run-rules-e2e.js [extra playwright args...]
 *         PORT=8771 node scripts/ops/run-rules-e2e.js
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const path = require("path");

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
const held = ports.survey([...EMU_PORTS, WEB_PORT]);
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
const playwright = ["npx", "playwright", "test",
  "--config=playwright.emulator.config.js", ...process.argv.slice(2)].join(" ");

/* emulators:exec takes the whole command as ONE argument. On Windows we spawn
   through cmd.exe (shell:true, for npx.cmd), and Node does NOT quote argv when
   shelling out — it joins with spaces — so this string would arrive as five
   separate arguments and emulators:exec would run only `npx`. Quote it here,
   exactly as the npm one-liner this replaced had to. Off Windows, shell is
   false and argv is passed literally, where an added quote would become part
   of the command. */
const execArg = process.platform === "win32" ? '"' + playwright + '"' : playwright;

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

/* ── 4. Survivor sweep, whatever happened ─────────────────────────── */
let swept = false;
function sweep() {
  if (swept) return;
  swept = true;
  const killed = ports.free(EMU_PORTS);
  if (killed.length) {
    console.log("rules-e2e: emulators:exec left " + killed.length +
      " listener(s) behind; freed them:\n" + ports.describe(killed));
  }
}
process.on("SIGINT", () => { sweep(); process.exit(130); });
process.on("SIGTERM", () => { sweep(); process.exit(143); });

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
