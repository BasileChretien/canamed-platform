"use strict";
/* tests/fixtures/real-run-harness.js
 *
 * What the tests that RUN an emulator-backed entry point share: the real
 * script, in a child process, against real listeners on throwaway ports, with
 * a stand-in for the firebase CLI. It began inside
 * tests/emulator-sweep-lineage.test.js and moved here when two more files
 * needed it (the runner's signal handler, the sim launcher). What that added:
 * ports are reserved across test FILES, not only within one; a PID is read
 * from a file only once the file holds one; a run reports when its process
 * ended separately from when its output did; a stranger can be started before
 * it binds.
 *
 * Nothing here touches 9000, 9099, 4400 or 8765: another session may be using
 * them.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const emulatorPorts = require("../../scripts/ops/emulator-ports.js");

const ROOT = path.join(__dirname, "..", "..");
const LISTENER = path.join(__dirname, "port-listener.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ports already given to a scenario. The scenarios run at once, and a port is
   only reserved for as long as the probe below holds it: without this the OS
   could hand the same number to two of them, and one scenario's "stranger"
   would be sitting on the other's emulator port.

   `handedOut` covers one test file. The files run at once too, each in its own
   process, and so do two sessions' unit suites on one machine — hence the
   marker file per port, which is the same promise made across processes. A
   marker a crashed run left behind stops counting after RESERVED_FOR_MS. */
const handedOut = new Set();
const RESERVE_DIR = path.join(os.tmpdir(), "canamed-test-ports");
const RESERVED_FOR_MS = 10 * 60 * 1000;
function reserve(port) {
  if (handedOut.has(port)) return false;
  const marker = path.join(RESERVE_DIR, String(port));
  fs.mkdirSync(RESERVE_DIR, { recursive: true });
  try {
    fs.writeFileSync(marker, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let age = 0;
    try { age = Date.now() - fs.statSync(marker).mtimeMs; } catch (_) { /* just released */ }
    if (age <= RESERVED_FOR_MS) return false;
    fs.writeFileSync(marker, String(process.pid), "utf8");   // stale: take it over
  }
  handedOut.add(port);
  return true;
}
function unreserve(port) {
  try { fs.unlinkSync(path.join(RESERVE_DIR, String(port))); } catch (e) { /* gone */ }
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => {
        try {
          resolve(reserve(port) ? port : freePort());
        } catch (e) { reject(e); }
      });
    });
  });
}

function isListening(port) {
  return new Promise((resolve) => {
    const c = net.connect(port, "127.0.0.1");
    c.on("connect", () => { c.destroy(); resolve(true); });
    c.on("error", () => resolve(false));
  });
}

/* Not a PID is not "dead". process.kill(NaN, 0) throws like a missing process
   does, so a PID that was never read would make every "it has been stopped"
   assertion pass on nothing. */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("isAlive: not a PID: " + pid);
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

async function until(what, cond, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await sleep(40);
  }
  throw new Error("timed out after " + ms + " ms waiting for " + what);
}

/* The PID a process wrote into `file`. A writer creates the file and THEN
   fills it, so "the file exists" comes a moment before "the file holds a PID":
   read in between, it is empty (measured here: 2 first reads in 1500). */
async function pidIn(file, ms) {
  let pid = NaN;
  await until(path.basename(file) + " to hold a PID", () => {
    try { pid = parseInt(fs.readFileSync(file, "utf8"), 10); } catch (e) { pid = NaN; }
    return Number.isInteger(pid) && pid > 0;
  }, ms);
  return pid;
}

/* A listener the TEST starts — so, as far as the script under test is
   concerned, one that somebody else started: another session's live emulator.
   `kind` "http" makes it answer a request, for a caller whose readiness probe
   is an HTTP one (the sim launcher's).

   opts.waiting — the process is started now and binds only when bind() is
   called. That is how a stranger comes to be OLDER than the run it then takes
   a port from, which is what lets a sweep on POSIX show that it is not the
   run's own (there a process is judged by its own age alone). */
async function startStranger(port, dir, name, kind, opts) {
  const pidFile = path.join(dir, name + ".pid");
  const waitFile = opts && opts.waiting ? path.join(dir, name + ".bind") : null;
  const proc = spawn(process.execPath,
    [LISTENER, String(port), pidFile, kind || "tcp"].concat(waitFile ? [waitFile] : []),
    { stdio: "ignore", windowsHide: true });
  const listening = async () => {
    try {
      await until(name + " to listen on :" + port, () => fs.existsSync(pidFile), 15000);
    } catch (e) {
      proc.kill();   // or it outlives the failure and holds this process open
      throw e;
    }
  };
  const stranger = { proc, pid: proc.pid, port, startedAt: Date.now() };
  if (!waitFile) {
    await listening();
    return stranger;
  }
  stranger.bind = async () => {
    fs.writeFileSync(waitFile, "", "utf8");
    await listening();
  };
  return stranger;
}

/* The script under test, as a child process: `node -r <preload> <script>`. */
function startScript(script, preload, env) {
  const child = spawn(process.execPath, ["-r", preload, script], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: Object.assign({}, process.env, env)
  });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });
  /* Two different moments. `gone` is the process ending. `exited` is its
     output ending too — which waits for every process that inherited its
     stdout, so a stand-in CLI that outlives the script holds it open. Time a
     run by `gone`; read its output after `exited`. */
  let end = null;
  const gone = new Promise((resolve) => child.on("exit", (code, signal) => {
    end = { code, signal, at: Date.now() };
    resolve(end);
  }));
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return {
    child, exited, gone,
    output: () => output,
    endedAt: () => end && end.at,
    endedBy: () => end && end.signal
  };
}

/* One scenario's worth of ports and scratch space, and a cleanup that leaves
   nothing behind whatever the outcome — including the listeners a regressed
   sweep would have failed to free.

   The cleanup obeys the rule these files are about. It never kills by a PID it
   merely remembers: by then that process has usually exited, and on Windows
   the number can already belong to someone else (found in review — the first
   version did exactly that). Our own children are ended through their
   ChildProcess handle, which is a no-op once they have gone. A process that is
   nobody's child here (`ctx.leftover`) is ended only while it is still the
   process listening on the port this scenario was given.

   Ending the script under test by its handle also ends what IT started, which
   matters when a scenario fails with the script still running (the sim
   launcher has a real static server under it). On POSIX the handle sends
   SIGTERM, and both scripts tear down on that. On Windows it is
   TerminateProcess and no handler runs — but an ordinary child of a Node
   process does not outlive it there (probed 2026-10-08: gone within 100 ms;
   a DETACHED child survives, which is what `ctx.leftover` is for).

   `script` and `preload` say what ctx.run() starts. */
function scenarios(script, preload) {
  return async function scenario(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emulator-real-run-"));
    const ports = {
      db: await freePort(), auth: await freePort(),
      web: await freePort(), hub: await freePort(), spare: await freePort()
    };
    const children = [];
    const leftovers = [];   // [{ port, pidFile }]
    const file = (name) => path.join(dir, name);
    const ctx = {
      dir, ports, file,
      env: (extra) => Object.assign({
        SIM_DB_PORT: String(ports.db),
        SIM_AUTH_PORT: String(ports.auth),
        SIM_HUB_PORT: String(ports.hub),
        PORT: String(ports.web),
        FAKE_EXEC_DIR: dir
      }, extra),
      stranger: async (port, name, kind, opts) => {
        const s = await startStranger(port, dir, name, kind, opts);
        children.push(s.proc);
        return s;
      },
      /* A listener that the script under test (or its stand-in children) will
         start on `port`, writing its PID to `name`: ended in the cleanup only
         while it is still the one listening there. */
      leftover: (port, name) => { leftovers.push({ port, pidFile: file(name) }); },
      run: (env) => {
        if (env && env.FAKE_EXEC_ORPHAN_PORT) {
          ctx.leftover(parseInt(env.FAKE_EXEC_ORPHAN_PORT, 10), "orphan.pid");
        }
        const r = startScript(script, preload, ctx.env(env));
        children.push(r.child);
        return r;
      },
      exists: (name) => fs.existsSync(file(name)),
      read: (name) => fs.readFileSync(file(name), "utf8"),
      touch: (name) => fs.writeFileSync(file(name), "", "utf8"),
      release: () => ctx.touch("release"),
      /* The PID written into `name` — once it is there (see pidIn). */
      pid: (name, ms) => pidIn(file(name), ms || 30000),
      orphanPid: () => ctx.pid("orphan.pid")
    };
    try {
      await fn(ctx);
    } finally {
      try { ctx.release(); } catch (e) { /* the directory may already be gone */ }
      for (const child of children) child.kill();
      for (const { port, pidFile } of leftovers) {
        try {
          const pid = fs.readFileSync(pidFile, "utf8").trim();
          if (emulatorPorts.listeningPids(port).includes(pid)) process.kill(parseInt(pid, 10));
        } catch (e) { /* never started, or it has gone — the goal */ }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      Object.values(ports).forEach(unreserve);
    }
  };
}

module.exports = {
  ROOT, sleep, freePort, isListening, isAlive, until, pidIn, startStranger, startScript, scenarios
};
