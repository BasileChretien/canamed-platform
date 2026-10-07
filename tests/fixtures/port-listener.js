"use strict";
/* tests/fixtures/port-listener.js <port> <pidFile> [tcp|http] [waitFile]
 *
 * A process that listens on a TCP port and does nothing else: the stand-in for
 * an emulator in tests/emulator-sweep-lineage.test.js. Who STARTED it is the
 * whole point of that file — the same script is "another run's live emulator"
 * when the test spawns it, and "this run's leftover" when the fake
 * emulators:exec does.
 *
 * With `http` it answers a request instead of dropping the connection: the sim
 * launcher's readiness probe is an HTTP GET, and to that probe a listener that
 * hangs up is a port that is not open yet.
 *
 * With a waitFile it starts at once and binds only when that file appears: a
 * process that is OLDER than the run whose port it then takes.
 *
 * It writes its PID once it is really listening, so a test waits on the file
 * instead of sleeping, and it ends itself after a while: a test that fails
 * before its cleanup must not leave a listener behind for the next run to trip
 * over, which is the very defect the file under test is about.
 */

const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");

const port = parseInt(process.argv[2], 10);
const pidFile = process.argv[3];
const waitFile = process.argv[5];
const LIFETIME_MS = 300000;

const server = process.argv[4] === "http"
  ? http.createServer((req, res) => res.end("ok"))
  : net.createServer((socket) => socket.destroy());
server.on("error", (e) => {
  console.error("port-listener: cannot listen on :" + port + " — " + e.message);
  process.exit(1);
});
function listen() {
  server.listen(port, "127.0.0.1", () => {
    fs.writeFileSync(pidFile, String(process.pid), "utf8");
  });
}
if (waitFile) {
  const tick = setInterval(() => {
    if (!fs.existsSync(waitFile)) return;
    clearInterval(tick);
    listen();
  }, 20);
} else {
  listen();
}
setTimeout(() => process.exit(0), LIFETIME_MS);
