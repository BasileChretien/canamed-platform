"use strict";
/* tests/fixtures/fake-emulators-exec-preload.js
 *
 * Loaded with `node -r`, so that the REAL scripts/ops/run-rules-e2e.js can run
 * to completion in a child process without Java, without the firebase CLI and
 * without the real emulator ports (see tests/emulator-sweep-lineage.test.js).
 *
 * WHY THIS EXISTS. The runner does its work at load time and ends in
 * process.exit(), so a test cannot require() it; until now everything it does
 * between "spawn" and "exit" was covered by text checks alone. The defect that
 * prompted this file lived exactly there: the survivor sweep killed whatever
 * PID it had SEEN on the emulator ports, which is not the same as what it had
 * started — and a regex over the source cannot tell the two apart. Only a run
 * with a real stranger on the port can.
 *
 * Two calls are redirected, and nothing else:
 *   - the `emulators:exec` spawn goes to fake-emulators-exec.js instead, as a
 *     real child process, so the PIDs the runner reasons about are real ones;
 *   - the rules build is skipped: it writes the generated rule files into the
 *     checkout, which a unit test has no business doing.
 * Everything the runner does about ports and processes — netstat/lsof, the
 * process table, taskkill/kill — is left untouched; that is what is under test.
 *
 * ONE THING IS ADDED, on Windows only: a way to reach the runner's SIGINT /
 * SIGTERM handler (tests/emulator-runner-signal.test.js). A signal cannot be
 * sent to a Node process there — ChildProcess.kill() is TerminateProcess, so
 * the process dies and no handler runs. What Node does when a console Ctrl-C
 * arrives is emit the event on `process`; so, when the test writes the file
 * `signal-SIGINT` (or -SIGTERM) into FAKE_EXEC_DIR, that is what happens here.
 * It reaches the same handler by the same call; it does not test delivery,
 * and on POSIX the test sends a real signal instead.
 */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FAKE_CLI = path.join(__dirname, "fake-emulators-exec.js");

if (process.platform === "win32" && process.env.FAKE_EXEC_DIR) {
  const asked = (signal) => path.join(process.env.FAKE_EXEC_DIR, "signal-" + signal);
  setInterval(() => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      if (!fs.existsSync(asked(signal))) continue;
      fs.unlinkSync(asked(signal));
      process.emit(signal, signal);
    }
  }, 25).unref();
}

const realSpawn = childProcess.spawn;
childProcess.spawn = function (cmd, args, opts) {
  if (Array.isArray(args) && args.includes("emulators:exec")) {
    return realSpawn(process.execPath, [FAKE_CLI], {
      stdio: "inherit",
      env: (opts && opts.env) || process.env
    });
  }
  return realSpawn.apply(this, arguments);
};

const realSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (cmd, args) {
  if (Array.isArray(args) && args.some((a) => /build-emulator-rules\.js$/.test(String(a)))) {
    return { status: 0, signal: null, error: undefined };
  }
  return realSpawnSync.apply(this, arguments);
};
