/* tests/emulator-sweep-lineage.test.js
 *
 * The survivor sweep must kill only what THIS RUN STARTED.
 *
 * `npm run test:e2e:rules` (scripts/ops/run-rules-e2e.js) binds the emulators
 * to FIXED ports and, once its child has exited, frees whatever it left on
 * them — the RTDB emulator is a Java grandchild that outlives
 * `firebase emulators:exec` on Windows. Until 2026-10-07 the sweep called that
 * "ownership-scoped", and it was not: it killed every PID it had SEEN listening
 * on the emulator ports while its own child was alive. Seeing a process on a
 * port is not having started it.
 *
 * Several sessions work in this repository at once, each in its own worktree,
 * and all of them share ports 9000 and 9099. So:
 *
 *   1. run A passes its preflight — the ports are free;
 *   2. run B's emulator binds :9000 before A's `emulators:exec` gets there;
 *   3. A's emulator fails ("Could not start Database Emulator, port taken"),
 *      but A's poll has meanwhile "observed" B's java.exe on :9000 — and A's
 *      sweep kills it, printing "emulators:exec left 1 listener(s) behind;
 *      freed them". B's run then dies mid-suite.
 *
 * Observed in both directions on 2026-10-07, two sessions each retrying and
 * each killing the other.
 *
 * WHY A CHILD PROCESS, AND REAL PIDs. The runner does everything at load time
 * and ends in process.exit(); its sweep was covered by text checks alone, and a
 * text check is what let this through — `ports.free(EMU_PORTS, { onlyPids:
 * ownedPids })` reads exactly the same whether `ownedPids` holds what the run
 * started or what it happened to see. So the REAL runner is run here (the
 * preload swaps `firebase emulators:exec` for a stand-in and nothing else),
 * against real listeners on throwaway ports, and the assertions are on which
 * processes are still alive afterwards.
 *
 * EVERY DENIAL HAS AN ALLOW LEG. "The stranger survived" would also be true of
 * a sweep that kills nothing at all, which would quietly bring back the leaked
 * emulator the sweep exists for. So a listener the run's own child started and
 * left behind must still be freed — alone, and in the same sweep as a stranger.
 *
 * Nothing here touches 9000, 9099 or 4400: another session may be using them.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const emulatorPorts = require("../scripts/ops/emulator-ports.js");

const ROOT = path.join(__dirname, "..");
const RUNNER = path.join(ROOT, "scripts", "ops", "run-rules-e2e.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-emulators-exec-preload.js");
const LISTENER = path.join(__dirname, "fixtures", "port-listener.js");

/* How long a scenario waits for the runner to SAY it has classified a listener
   before letting its child exit regardless. Normally that takes a poll (2 s)
   plus one process-table read — instant on POSIX, 1.5 s of PowerShell on an
   idle Windows machine, and 10 s and more on one running several sessions'
   suites, which is why this is generous. It is only ever waited out in full by
   a runner that never says it: one that classifies nothing, or classifies by
   port as the old one did (it failed these tests at 8 s). */
const CLASSIFY_WAIT_MS = 60000;
const SCENARIO_TIMEOUT_MS = 240000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ports already given to a scenario. The scenarios run at once, and a port is
   only reserved for as long as the probe below holds it: without this the OS
   could hand the same number to two of them, and one scenario's "stranger"
   would be sitting on the other's emulator port. */
const handedOut = new Set();
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => {
        if (handedOut.has(port)) return resolve(freePort());
        handedOut.add(port);
        resolve(port);
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

function isAlive(pid) {
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

/* A listener the TEST starts — so, as far as the runner is concerned, one that
   somebody else started: another session's live emulator. */
async function startStranger(port, dir, name) {
  const pidFile = path.join(dir, name + ".pid");
  const proc = spawn(process.execPath, [LISTENER, String(port), pidFile],
    { stdio: "ignore", windowsHide: true });
  try {
    await until(name + " to listen on :" + port, () => fs.existsSync(pidFile), 15000);
  } catch (e) {
    proc.kill();   // or it outlives the failure and holds this process open
    throw e;
  }
  return { proc, pid: proc.pid, port };
}

function startRunner(env) {
  const child = spawn(process.execPath, ["-r", PRELOAD, RUNNER], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: Object.assign({}, process.env, env)
  });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return { child, exited, output: () => output };
}

/* One scenario's worth of ports and scratch space, and a cleanup that leaves
   nothing behind whatever the outcome — including the listeners a regressed
   sweep would have failed to free.

   The cleanup obeys the rule this file is about. It never kills by a PID it
   merely remembers: by then that process has usually exited, and on Windows
   the number can already belong to someone else (found in review — the first
   version did exactly that). Our own children are ended through their
   ChildProcess handle, which is a no-op once they have gone. The orphan is
   nobody's child here, so it is ended only while it is still the process
   listening on the port this scenario was given. */
async function scenario(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-e2e-sweep-"));
  const ports = {
    db: await freePort(), auth: await freePort(),
    web: await freePort(), hub: await freePort()
  };
  const children = [];
  let orphanPort = null;
  const ctx = {
    dir, ports,
    env: (extra) => Object.assign({
      SIM_DB_PORT: String(ports.db),
      SIM_AUTH_PORT: String(ports.auth),
      SIM_HUB_PORT: String(ports.hub),
      PORT: String(ports.web),
      FAKE_EXEC_DIR: dir
    }, extra),
    stranger: async (port, name) => {
      const s = await startStranger(port, dir, name);
      children.push(s.proc);
      return s;
    },
    runner: (env) => {
      if (env.FAKE_EXEC_ORPHAN_PORT) orphanPort = parseInt(env.FAKE_EXEC_ORPHAN_PORT, 10);
      const r = startRunner(ctx.env(env));
      children.push(r.child);
      return r;
    },
    release: () => fs.writeFileSync(path.join(dir, "release"), "", "utf8"),
    orphanPid: () => parseInt(fs.readFileSync(path.join(dir, "orphan.pid"), "utf8"), 10)
  };
  try {
    await fn(ctx);
  } finally {
    try { ctx.release(); } catch (e) { /* the directory may already be gone */ }
    for (const child of children) child.kill();
    try {
      const orphan = String(ctx.orphanPid());
      if (orphanPort !== null && emulatorPorts.listeningPids(orphanPort).includes(orphan)) {
        process.kill(parseInt(orphan, 10));
      }
    } catch (e) { /* no orphan in this scenario, or it has gone — the goal */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("the survivor sweep, run for real", { concurrency: true }, () => {
  it("does not kill a listener that took the port after the preflight — another run's live emulator",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      const run = ctx.runner({ FAKE_EXEC_MODE: "port-taken" });
      await until("the stand-in emulators:exec to start",
        () => fs.existsSync(path.join(ctx.dir, "started")), 30000);

      /* The preflight has passed and the run's own child is alive. NOW the
         other session's emulator takes the port, and its hub with it. */
      const theirs = await ctx.stranger(ctx.ports.db, "their-emulator");
      const theirHub = await ctx.stranger(ctx.ports.hub, "their-hub");

      await until("the runner to notice", () => /DID NOT START/.test(run.output()),
        CLASSIFY_WAIT_MS).catch(() => {});
      ctx.release();
      const code = await run.exited;
      const out = run.output();

      assert.ok(isAlive(theirs.pid) && await isListening(ctx.ports.db),
        "the sweep KILLED a listener this run did not start (PID " + theirs.pid +
        " on :" + ctx.ports.db + "). It was put there by another process after the " +
        "preflight — exactly what another session's live emulator looks like.\n" +
        "Runner output:\n" + out);
      assert.ok(isAlive(theirHub.pid), "and nothing else of theirs was touched");

      assert.notStrictEqual(code, 0, "a run whose emulator could not start is a failure");
      assert.match(out, /ANOTHER RUN HOLDS THE EMULATOR PORTS/,
        "the runner must say plainly what happened\n" + out);
      assert.match(out, new RegExp(":" + ctx.ports.db + " held by PID " + theirs.pid),
        "and name the listener it left alone");
      assert.match(out, /NOTHING WAS KILLED/);
      assert.match(out, new RegExp(":" + ctx.ports.hub + " held by PID " + theirHub.pid),
        "a live emulator hub is the tell-tale that another emulator is running");
      assert.match(out, /cannot be run by two sessions at once/);
      assert.match(out, new RegExp(
        (process.platform === "win32" ? "taskkill /F /T /PID " : "kill -9 ") + theirs.pid),
        "the manual command must be given — for the operator to run, if it IS stale");
      assert.doesNotMatch(out, /freed them/,
        "nothing was freed, so nothing may be reported as freed");
    }));

  it("does not kill it either when its own child dies before it has looked",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* The timing of the real incident: a CLI that fails on "port taken" is
         gone within seconds — before the runner's first look at the ports. No
         verdict was reached while the child lived, so the sweep meets the
         stranger cold. */
      const run = ctx.runner({ FAKE_EXEC_MODE: "port-taken" });
      await until("the stand-in emulators:exec to start",
        () => fs.existsSync(path.join(ctx.dir, "started")), 30000);
      const theirs = await ctx.stranger(ctx.ports.db, "their-emulator");
      ctx.release();                      // at once: the child fails and exits
      const code = await run.exited;
      const out = run.output();

      assert.ok(isAlive(theirs.pid) && await isListening(ctx.ports.db),
        "a listener the sweep knows nothing about is NOT a listener it may kill " +
        "(PID " + theirs.pid + " on :" + ctx.ports.db + ").\nRunner output:\n" + out);
      assert.notStrictEqual(code, 0);
      assert.match(out, new RegExp(":" + ctx.ports.db + " held by PID " + theirs.pid),
        "it must still be reported");
      assert.doesNotMatch(out, /freed them/);
      assert.match(out, /LIVE EMULATOR|ANOTHER RUN HOLDS THE EMULATOR PORTS/,
        "and the report must say it may be another run's, not just that it is there");
      if (process.platform === "win32") {
        /* Not a soft assertion: on Windows this path is DETERMINISTIC, and it
           is the one the incident took. The stranger hangs off a process older
           than the runner's child, which is proof enough without having seen
           it during the run. POSIX re-parents orphans, so there the same
           listener is merely unproven — reported, with the caveat, not named. */
        assert.match(out, /ANOTHER RUN HOLDS THE EMULATOR PORTS/, out);
      }
    }));

  it("still frees its OWN leftover — and, in the same sweep, spares a stranger (the allow leg)",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* emulators:exec starts a listener on the DB port and will exit 0 without
         stopping it: the Java grandchild that survives on Windows. */
      const run = ctx.runner({
        FAKE_EXEC_MODE: "orphan",
        FAKE_EXEC_ORPHAN_PORT: String(ctx.ports.db)
      });
      await until("the stand-in emulators:exec to start its listener",
        () => fs.existsSync(path.join(ctx.dir, "started")), 30000);
      const orphan = ctx.orphanPid();
      assert.ok(isAlive(orphan) && await isListening(ctx.ports.db),
        "fixture: the run's own listener must be up before the child exits");
      const theirs = await ctx.stranger(ctx.ports.auth, "stranger");

      /* Lineage can only be shown while the child is alive, so the child must
         not exit before the runner has looked — at BOTH: the two listeners can
         come up either side of one poll, and the stranger's verdict is what
         the report below is checked against. */
      await until("the runner to classify both listeners",
        () => /this run's own/.test(run.output()) && /DID NOT START/.test(run.output()),
        CLASSIFY_WAIT_MS).catch(() => {});
      ctx.release();                      // emulators:exec exits 0, listener survives
      const code = await run.exited;
      const out = run.output();

      await until("the leftover to die", () => !isAlive(orphan), 10000).catch(() => {});
      assert.ok(!isAlive(orphan),
        "a listener this run's own child started and left behind must be freed — " +
        "otherwise the NEXT run's readiness probe succeeds against this one, and " +
        "validates the previous run's rules.\nRunner output:\n" + out);
      assert.strictEqual(await isListening(ctx.ports.db), false, "and its port is free again");
      assert.match(out, new RegExp(
        "left 1 listener\\(s\\) behind; freed them:\\s+:" + ctx.ports.db + " held by PID " + orphan));

      assert.ok(isAlive(theirs.pid) && await isListening(ctx.ports.auth),
        "the stranger on :" + ctx.ports.auth + " (PID " + theirs.pid + ") must stay — " +
        "same sweep, same moment, different lineage.\nRunner output:\n" + out);
      assert.match(out, /were NOT started by this run, so/);
      assert.match(out, new RegExp(":" + ctx.ports.auth + " held by PID " + theirs.pid));
      assert.strictEqual(code, 0, "freeing a leftover does not turn a passing run into a failure");
    }));

  it("refuses to start when a listener is already there, and kills nothing",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      const theirs = await ctx.stranger(ctx.ports.db, "already-there");
      const run = ctx.runner({ FAKE_EXEC_MODE: "port-taken" });
      const code = await run.exited;
      const out = run.output();

      assert.strictEqual(code, 1);
      assert.ok(!fs.existsSync(path.join(ctx.dir, "started")),
        "the preflight must stop the run BEFORE anything is started");
      assert.ok(isAlive(theirs.pid) && await isListening(ctx.ports.db),
        "a preflight reports; it never kills");
      assert.match(out, new RegExp(":" + ctx.ports.db + " held by PID " + theirs.pid));
      assert.match(out, /LIVE EMULATOR/,
        "the message must say the listener may be another session's run in progress, " +
        "BEFORE it says how to clear one — a session that reads only 'clear it with " +
        "emulator:free' kills the other session's run\n" + out);
      assert.ok(out.indexOf("LIVE EMULATOR") < out.indexOf("emulator-ports.js free"),
        "the caveat must come before the command it qualifies");
    }));
});
