"use strict";
/* tests/fixtures/fake-simulate-session.js
 *
 * Stands in for scripts/sim/simulate-session.js when the real sim launcher is
 * run by tests/sim-launcher-run.test.js (fake-sim-launcher-preload.js redirects
 * the spawn here). The real one drives two dozen browser tabs against the
 * emulator; all that matters to the launcher is that it is a child process
 * which is WRITING for as long as it lives.
 *
 * In FAKE_EXEC_DIR:
 *   sim-base-url the SIM_BASE_URL it was started with, written before sim.pid
 *   sim.pid      written once, at start
 *   sim-beats    one line every few ms, the time: the last COMPLETE line is
 *                when this process was last alive and "writing". Appended,
 *                never rewritten — a rewrite truncates first, and a process
 *                killed between the two leaves an empty file (seen: the test
 *                read NaN, about one run in five on Linux)
 *   sim-finish   written by the test to let the sim end normally (exit 0)
 *
 *   FAKE_SIM_BYSTANDER_PORT  start a listener on this port, detached, with its
 *                PID in `bystander.pid`. It is a child of the sim that does not
 *                depend on it — so it shows whether stopping the sim stopped
 *                the sim, or everything that names it as a parent.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DIR = process.env.FAKE_EXEC_DIR;
if (!DIR) {
  console.error("fake-simulate-session: FAKE_EXEC_DIR is required");
  process.exit(2);
}
const file = (name) => path.join(DIR, name);
const GIVE_UP_MS = 240000;
const started = Date.now();

if (process.env.FAKE_SIM_BYSTANDER_PORT) {
  spawn(process.execPath, [
    path.join(__dirname, "port-listener.js"),
    process.env.FAKE_SIM_BYSTANDER_PORT,
    file("bystander.pid")
  ], { stdio: "ignore", detached: true, windowsHide: true }).unref();
}

/* Where it was told the platform is served: the launcher's to get right. */
fs.writeFileSync(file("sim-base-url"), String(process.env.SIM_BASE_URL), "utf8");
fs.writeFileSync(file("sim.pid"), String(process.pid), "utf8");
setInterval(() => {
  /* The test has cleaned up and gone, or nobody is ever going to end this. */
  if (!fs.existsSync(DIR) || Date.now() - started > GIVE_UP_MS) process.exit(4);
  if (fs.existsSync(file("sim-finish"))) process.exit(0);
  /* One missed beat (a reader has the file open, on Windows) is not an error;
     the next one is 10 ms away. */
  try { fs.appendFileSync(file("sim-beats"), Date.now() + "\n", "utf8"); } catch (e) {}
}, 10);
