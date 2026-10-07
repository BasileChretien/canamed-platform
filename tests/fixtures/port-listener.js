"use strict";
/* tests/fixtures/port-listener.js <port> <pidFile>
 *
 * A process that listens on a TCP port and does nothing else: the stand-in for
 * an emulator in tests/emulator-sweep-lineage.test.js. Who STARTED it is the
 * whole point of that file — the same script is "another run's live emulator"
 * when the test spawns it, and "this run's leftover" when the fake
 * emulators:exec does.
 *
 * It writes its PID once it is really listening, so a test waits on the file
 * instead of sleeping, and it ends itself after a while: a test that fails
 * before its cleanup must not leave a listener behind for the next run to trip
 * over, which is the very defect the file under test is about.
 */

const net = require("node:net");
const fs = require("node:fs");

const port = parseInt(process.argv[2], 10);
const pidFile = process.argv[3];
const LIFETIME_MS = 300000;

const server = net.createServer((socket) => socket.destroy());
server.on("error", (e) => {
  console.error("port-listener: cannot listen on :" + port + " — " + e.message);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  fs.writeFileSync(pidFile, String(process.pid), "utf8");
});
setTimeout(() => process.exit(0), LIFETIME_MS);
