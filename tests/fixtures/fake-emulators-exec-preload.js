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
 */

const childProcess = require("node:child_process");
const path = require("node:path");

const FAKE_CLI = path.join(__dirname, "fake-emulators-exec.js");

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
