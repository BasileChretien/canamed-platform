"use strict";
/* tests/fixtures/fake-emulators-exec.js
 *
 * Stands in for `firebase emulators:exec` when scripts/ops/run-rules-e2e.js is
 * run by tests/emulator-sweep-lineage.test.js (the preload next to this file
 * redirects the runner's spawn here). It needs neither Java nor the firebase
 * CLI, and it never touches the real emulator ports.
 *
 *   FAKE_EXEC_MODE   "port-taken" — bind nothing and fail, as the CLI does when
 *                      another emulator took the port after the preflight.
 *                    "orphan"     — start a listener of its own on
 *                      FAKE_EXEC_ORPHAN_PORT and exit 0 WITHOUT stopping it: the
 *                      Java grandchild that outlives emulators:exec on Windows.
 *   FAKE_EXEC_DIR    directory for the hand-shake files:
 *                      started     written by this script once it is in place
 *                      release     written by the test to let this script exit
 *                      orphan.pid  written by the listener it started
 *
 * The hand-shake is what keeps the tests free of sleeps: the test decides when
 * this "CLI" exits, so it can put a stranger on the port while the run is live.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MODE = process.env.FAKE_EXEC_MODE;
const DIR = process.env.FAKE_EXEC_DIR;
if (!MODE || !DIR) {
  console.error("fake-emulators-exec: FAKE_EXEC_MODE and FAKE_EXEC_DIR are required");
  process.exit(2);
}

const GIVE_UP_MS = 240000;
const started = Date.now();

function waitFor(file, then) {
  const tick = setInterval(() => {
    if (fs.existsSync(path.join(DIR, file))) {
      clearInterval(tick);
      then();
    } else if (Date.now() - started > GIVE_UP_MS) {
      clearInterval(tick);
      console.error("fake-emulators-exec: gave up waiting for " + file);
      process.exit(3);
    }
  }, 25);
}

function announce() {
  fs.writeFileSync(path.join(DIR, "started"), String(process.pid), "utf8");
}

if (MODE === "port-taken") {
  announce();
  waitFor("release", () => {
    console.error("Error: Could not start Database Emulator, port taken.");
    process.exit(1);
  });
} else if (MODE === "orphan") {
  /* detached + ignored stdio, so it outlives this process on every platform —
     the surviving emulator is exactly a child nobody waited for. */
  const orphan = spawn(process.execPath, [
    path.join(__dirname, "port-listener.js"),
    process.env.FAKE_EXEC_ORPHAN_PORT,
    path.join(DIR, "orphan.pid")
  ], { stdio: "ignore", detached: true, windowsHide: true });
  orphan.unref();
  waitFor("orphan.pid", () => {
    announce();
    waitFor("release", () => process.exit(0));
  });
} else {
  console.error("fake-emulators-exec: unknown FAKE_EXEC_MODE " + JSON.stringify(MODE));
  process.exit(2);
}
