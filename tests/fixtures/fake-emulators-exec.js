"use strict";
/* tests/fixtures/fake-emulators-exec.js
 *
 * Stands in for the firebase CLI when a test runs an emulator-backed entry
 * point for real: `firebase emulators:exec` under scripts/ops/run-rules-e2e.js
 * (tests/emulator-sweep-lineage.test.js, tests/emulator-runner-signal.test.js)
 * and `firebase emulators:start` under scripts/sim/sim-with-emulator.js
 * (tests/sim-launcher-run.test.js). The preloads next to this file redirect
 * the spawn here. It needs neither Java nor the firebase CLI, and it never
 * touches the real emulator ports.
 *
 *   FAKE_EXEC_MODE   "port-taken" — bind nothing and fail, as the CLI does when
 *                      another emulator took the port after the preflight.
 *                    "orphan"     — start a listener of its own on
 *                      FAKE_EXEC_ORPHAN_PORT and exit 0 WITHOUT stopping it: the
 *                      Java grandchild that outlives emulators:exec on Windows.
 *                    "serve"      — be the emulators: answer HTTP on SIM_DB_PORT
 *                      and SIM_AUTH_PORT from this very process, until released
 *                      (then exit 1, as a CLI that crashes mid-run does).
 *                    "vanish"     — the same, but both listeners close once the
 *                      auth port has answered a request: emulators that came up,
 *                      answered the readiness probe and went, under a CLI that
 *                      is still running.
 *   FAKE_EXEC_DIR    directory for the hand-shake files:
 *                      started     written by this script once it is in place
 *                      release     written by the test to let this script exit
 *                      cli-exited  written by this script just before it exits
 *                      orphan.pid  written by the listener it started
 *   FAKE_EXEC_ON_SIGNAL   what a SIGINT / SIGTERM does to this process. Unset,
 *                      it dies of it at once, like any process with no handler.
 *                    "ignore"     — nothing at all: a wedged CLI.
 *                    "linger"     — it carries on for FAKE_EXEC_LINGER_MS, as a
 *                      CLI shutting its emulators down does, then notes whether
 *                      its own listener is still up (file `listener-at-exit`:
 *                      "listening" or "closed") and exits 0, leaving it.
 *                    Each signal received is appended to the file `signals`.
 *
 * The hand-shake is what keeps the tests free of sleeps: the test decides when
 * this "CLI" exits, so it can put a stranger on the port while the run is live.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const MODE = process.env.FAKE_EXEC_MODE;
const DIR = process.env.FAKE_EXEC_DIR;
if (!MODE || !DIR) {
  console.error("fake-emulators-exec: FAKE_EXEC_MODE and FAKE_EXEC_DIR are required");
  process.exit(2);
}

const GIVE_UP_MS = 240000;
const started = Date.now();
const file = (name) => path.join(DIR, name);

function waitFor(name, then) {
  const tick = setInterval(() => {
    if (fs.existsSync(file(name))) {
      clearInterval(tick);
      then();
    } else if (!fs.existsSync(DIR)) {
      /* The test has cleaned up and gone; nobody will ever write the file. */
      clearInterval(tick);
      process.exit(4);
    } else if (Date.now() - started > GIVE_UP_MS) {
      clearInterval(tick);
      console.error("fake-emulators-exec: gave up waiting for " + name);
      process.exit(3);
    }
  }, 25);
}

function announce() {
  fs.writeFileSync(file("started"), String(process.pid), "utf8");
}

/* Exit, saying so first: a test (or the preload, mid-lookup) can then wait for
   this process to be really on its way out instead of sleeping. */
function leave(code) {
  try { fs.writeFileSync(file("cli-exited"), String(code), "utf8"); } catch (e) { /* DIR gone */ }
  process.exit(code);
}

const ON_SIGNAL = process.env.FAKE_EXEC_ON_SIGNAL;
if (ON_SIGNAL) {
  let lingering = false;
  const noteListenerAndLeave = () => {
    const probe = net.connect(parseInt(process.env.FAKE_EXEC_ORPHAN_PORT, 10), "127.0.0.1");
    const done = (state) => {
      fs.writeFileSync(file("listener-at-exit"), state, "utf8");
      leave(0);
    };
    probe.on("connect", () => { probe.destroy(); done("listening"); });
    probe.on("error", () => done("closed"));
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      fs.appendFileSync(file("signals"), signal + "\n", "utf8");
      if (ON_SIGNAL !== "linger" || lingering) return;
      lingering = true;
      setTimeout(noteListenerAndLeave, parseInt(process.env.FAKE_EXEC_LINGER_MS || "1500", 10));
    });
  }
}

if (MODE === "port-taken") {
  announce();
  waitFor("release", () => {
    console.error("Error: Could not start Database Emulator, port taken.");
    leave(1);
  });
} else if (MODE === "orphan") {
  /* detached + ignored stdio, so it outlives this process on every platform —
     the surviving emulator is exactly a child nobody waited for. */
  const orphan = spawn(process.execPath, [
    path.join(__dirname, "port-listener.js"),
    process.env.FAKE_EXEC_ORPHAN_PORT,
    file("orphan.pid")
  ], { stdio: "ignore", detached: true, windowsHide: true });
  orphan.unref();
  waitFor("orphan.pid", () => {
    announce();
    waitFor("release", () => leave(0));
  });
} else if (MODE === "serve" || MODE === "vanish") {
  const servers = [];
  const listen = (port, onRequest) => new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.end("{}");
      if (onRequest) onRequest();
    });
    servers.push(server);
    server.on("error", reject);
    server.listen(parseInt(port, 10), "127.0.0.1", resolve);
  });
  /* "vanish": the launcher probes the database port, then the auth port. The
     first answer on the auth port is therefore its last probe — and the
     listeners are gone before it can look at who they were. */
  const vanish = MODE === "vanish"
    ? () => { for (const server of servers) server.close(); servers.length = 0; }
    : null;
  Promise.all([
    listen(process.env.SIM_DB_PORT),
    listen(process.env.SIM_AUTH_PORT, vanish)
  ]).then(() => {
    announce();
    waitFor("release", () => {
      console.error("Error: the emulators have stopped unexpectedly.");
      leave(1);
    });
  }, (e) => {
    console.error("fake-emulators-exec: cannot serve — " + e.message);
    leave(1);
  });
} else {
  console.error("fake-emulators-exec: unknown FAKE_EXEC_MODE " + JSON.stringify(MODE));
  process.exit(2);
}
