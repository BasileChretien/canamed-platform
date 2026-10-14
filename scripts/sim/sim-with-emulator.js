#!/usr/bin/env node
/* scripts/sim/sim-with-emulator.js
 *
 * Drive scripts/sim/simulate-session.js against the local Firebase
 * emulator suite. This is the *reliable* sim path — unlike the default
 * LocalDB-backed run, the emulator gives every browser tab a real
 * WebSocket to a real RTDB process, so stage advances + presence sync
 * cross-tab without the storage-event drops we hit at 24-tab scale.
 *
 * Flow:
 *   1. Spawn `npx firebase emulators:start --only=database,auth` in
 *      the background. Wait until both ports are listening.
 *   2. Spawn the static platform server (scripts/serve-platform.js) on
 *      its usual port (8765, or PORT).
 *   3. Set SIM_EMULATOR_MODE=1 + the host/port env vars so
 *      simulate-session.js's Playwright contexts pin
 *      window.CANAMED_EMULATOR = {host, dbPort, authPort} on init.
 *   4. Run simulate-session.js as a child process.
 *   5. Tear everything down regardless of pass/fail.
 *
 * No external deps beyond firebase-tools (already in node_modules — the
 * RTDB rules-test framework was bundled in for ops/cleanup-stale-sessions).
 * Java is required for the database emulator; the script checks early
 * and exits with a clear message if it isn't on PATH.
 *
 * Usage:
 *   node scripts/sim/sim-with-emulator.js
 *   SIM_STUDENTS=16 SIM_ROOM_COUNT=4 node scripts/sim/sim-with-emulator.js
 *   PORT=8771 node scripts/sim/sim-with-emulator.js   # when 8765 is taken
 */

"use strict";

const { spawn, spawnSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const emulatorPorts = require("../ops/emulator-ports.js");
const processLineage = require("../ops/process-lineage.js");
const webPort = require("../ops/web-port.js");
/* The emulator needs its own copy of database.rules.json — its regex parser
 * rejects `\s` outright and MIS-PARSES every other backslash escape. The whole
 * transform, and the empirical evidence behind each substitution, lives in
 * build-emulator-rules.js.
 *
 * This file used to carry an inline SECOND COPY of that transform. The two
 * would have drifted the moment either was touched: build-emulator-rules.js was
 * fixed on 2026-08-06 and this copy would not have been, so `npm run
 * sim:emulator` would have kept running the broken rules while `npm run
 * test:e2e:rules` ran the fixed ones — two suites disagreeing about what the
 * rules say, with no signal that they did. Delegate, don't duplicate. */
const { buildEmulatorRules } = require("./build-emulator-rules.js");

const PLATFORM_DIR = path.resolve(__dirname, "..", "..",
  "docs", "Third_session", "PBL_platform");
const FIREBASE_CONFIG = path.join(PLATFORM_DIR, "firebase.json");
const RULES_EMU  = path.join(PLATFORM_DIR, "database.rules.emulator.json");
const FIREBASE_CONFIG_EMU = path.join(PLATFORM_DIR, "firebase.emulator.json");
const SERVE_PLATFORM = path.resolve(__dirname, "..", "serve-platform.js");
const SIM_SCRIPT     = path.resolve(__dirname, "simulate-session.js");

function cleanupEmulatorRules() {
  for (const p of [RULES_EMU, FIREBASE_CONFIG_EMU]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}

const DB_PORT   = parseInt(process.env.SIM_DB_PORT   || "9000", 10);
const AUTH_PORT = parseInt(process.env.SIM_AUTH_PORT || "9099", 10);
/* The platform server's port: PORT, as for `npm run test:e2e:rules` (8765 is
   AnkiConnect's on at least one dev machine). Until 2026-10-08 this file had
   8765 written into it three times while serve-platform.js, which it starts
   with this environment, read PORT — so `PORT=8771 npm run sim:emulator`
   started the server on 8771, waited for it on 8765 and gave up.
   What a PORT may be is ops/web-port.js's to say, for this file and for the
   rules runner alike. */
const WEB       = webPort.read(process.env.PORT, { db: DB_PORT, auth: AUTH_PORT });
const WEB_PORT  = WEB.port;
const HOST      = "127.0.0.1";

/* A PORT that cannot work is refused HERE — before anything is started, and
   BEFORE THE HANDLERS BELOW EXIST, so that there is nothing to tear down.
   That order matters and nothing but its place in the file gives it: moved
   below the three process.on(…) lines, this exit would run cleanup(), which
   kills nothing here but does unlink the generated *.emulator.json files —
   another run's, since this one built none. (A text check holds it in place:
   tests/emulator-run-hygiene.test.js.) */
if (WEB.problem) {
  console.error("FATAL: " + webPort.refusal(WEB, "npm run sim:emulator"));
  process.exit(1);
}
/* How the readiness check looks at the emulator ports (ownEmulatorOrRefuse).
   Three looks, because lineage.observe() stops asking about a PID after three
   snapshots without an answer: a fourth would only be waiting. */
const READY_LOOKS = 3;
const READY_LOOK_EVERY_MS = 500;
const READY_YIELD_MS = 250;

/* Helpers ─────────────────────────────────────────────────────────── */

function isPortOpen(port) {
  return new Promise(resolve => {
    const req = http.request({
      host: HOST, port: port, method: "GET", path: "/", timeout: 1000
    }, () => { resolve(true); req.destroy(); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { resolve(false); req.destroy(); });
    req.end();
  });
}
async function waitForPort(port, label, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(label + " never came up on port " + port +
    " (waited " + deadlineMs + "ms)");
}

/* Process management ───────────────────────────────────────────────── */

let firebaseProc = null;
let serveProc    = null;
/* Which emulator-port listeners THIS run started — the evidence the cleanup
   sweep needs before it may kill anything. That is LINEAGE from firebaseProc
   (ops/process-lineage.js), settled while the emulator is up.

   Until 2026-10-07 this was a set of every PID seen listening on the ports
   after waitForPort() — and waitForPort() succeeds against ANY listener. The
   ports are fixed and shared by every checkout on the machine, so a run that
   lost the race for :9000 to another session recorded THAT session's emulator
   as its own and killed it at cleanup. Seeing is not owning. */
let lineage = null;
function observeListeners() {
  if (!lineage) return;
  try {
    lineage.observe(emulatorPorts.listeners([DB_PORT, AUTH_PORT]).map(r => r.pid));
  } catch (_) { /* transient; the sweep reports what it cannot prove */ }
}
let simProc = null;
/* Set by cleanup(). Until then our emulator has no business exiting, and if it
   does, whatever answers on the ports afterwards is not it. */
let tearingDown = false;
/* Set once every listener on the emulator ports has been shown to be ours. */
let emulatorWasOurs = false;

/* What can truthfully be said about the sim and a listener that is not ours.
   Until 2026-10-08 every refusal said "the sim is not being run against that
   listener" — including the one made when our emulator went away with the sim
   minutes into its run, and the one made after the sim had been started
   against a listener nothing was known about. */
function whatOfTheSim() {
  if (!simProc) {
    return "The sim was NOT started, so nothing of this run's was sent to that listener.";
  }
  if (simProc.exitCode !== null || simProc.signalCode !== null) {
    return "The sim had already finished.";
  }
  return "The sim WAS RUNNING and has been stopped. Whatever it sent between this\n" +
    "run's emulator going away and now may have reached that listener.";
}

const KILLS_NOTHING_OF_THEIRS =
  "NOTHING OF THEIRS IS KILLED: this run now stops its own processes, and\n" +
  "those only. Two sessions cannot run an emulator suite at once: wait for\n" +
  "the other run to end, then run this again — do not retry in a loop.";

/* The run cannot go on: what holds the emulator ports is not our emulator.
   Says so, kills nothing, and exits — the "exit" handler then cleans up by
   lineage, which leaves these listeners alone. */
function refuseForeign(rows, how) {
  console.error("FATAL: ANOTHER RUN HOLDS THE EMULATOR PORTS — " + how + ":\n" +
    emulatorPorts.describe(rows) + "\n\n" +
    (emulatorWasOurs
      ? "This run's emulator was up, and has gone: what answers on its ports now\n" +
        "is not it."
      : "The ports were free at this run's preflight and were taken before its own\n" +
        "emulator could bind them. The firebase CLI says so as \"Port " + DB_PORT + " is not\n" +
        "open … could not start Database Emulator\"; \"emulator hub unable to start on\n" +
        "port 4400, starting on 4401 instead\" is the tell-tale that another hub is\n" +
        "alive.") + "\n" +
    whatOfTheSim() + "\n\n" + KILLS_NOTHING_OF_THEIRS);
  process.exit(1);
}

/* The run cannot go on: nothing shows that what answers on the emulator ports
   is our emulator. NOT "another run holds them" — that is not shown either. */
function refuseUnproven(rows, missing, why) {
  console.error("FATAL: what answers on the emulator ports could NOT BE SHOWN to be " +
    "this run's own emulator" +
    (rows.length ? ":\n" + emulatorPorts.describe(rows) : ".") +
    (missing.length
      ? "\n  nothing is listening on :" + missing.join(", :") + " any more"
      : "") +
    (why.length ? "\n(" + why.join("; ") + ")" : "") + "\n\n" +
    "The readiness probe is answered by ANY listener, and these ports are shared\n" +
    "by every checkout on the machine. A listener that cannot be shown to be\n" +
    "ours may be another session's emulator: the sim would validate ITS rules\n" +
    "and write this run's test data into ITS database.\n" +
    whatOfTheSim() + "\n\n" +
    emulatorPorts.LIVE_RUN_CAVEAT + "\n\n" + KILLS_NOTHING_OF_THEIRS);
  process.exit(1);
}

/* "Something answers on the port" is NOT "our emulator is up". The ports were
   free at the preflight, but that was one instant: another session's emulator
   can have bound them since, in which case OURS failed to start and
   waitForPort() has just succeeded against THEIRS. Running the sim now would
   validate their rules and write our test data into their database.

   So the sim is held until EVERY listener on both ports has been SHOWN to be
   ours, and the run is refused when that cannot be done. Until 2026-10-08 only
   a listener shown NOT to be ours stopped it; one with no verdict went
   through. No verdict is what an unreadable process table gives, or a listener
   whose creation time cannot be read — and with another session's emulator on
   the port, the sim was then started against it and wrote into its database
   for the seconds until our own CLI gave up on "port taken". What cannot be
   shown to be ours is not run against.

   A read of the PORTS that fails is not caught here: it ends the run. */
async function ownEmulatorOrRefuse() {
  const wanted = [DB_PORT, AUTH_PORT];
  let unplaced = [];
  let missing = [];
  for (let look = 1; look <= READY_LOOKS; look++) {
    const rows = emulatorPorts.survey(wanted);
    lineage.observe(rows.map(r => r.pid));
    /* Everything since the probe answered has been synchronous (the lookup
       above can take seconds), and a child that died in the meantime still
       reads as running until the event loop turns. Let it turn: if our CLI has
       exited, its "exit" handler ends the run here, before the sim starts. */
    await new Promise(r => setTimeout(r, READY_YIELD_MS));
    const foreign = rows.filter(r => lineage.verdict(r.pid) === "not-ours");
    if (foreign.length) refuseForeign(foreign, "this run did not start");
    unplaced = rows.filter(r => lineage.verdict(r.pid) !== "ours");
    missing = wanted.filter(port => !rows.some(r => r.port === port));
    if (!unplaced.length && !missing.length) return;
    if (look < READY_LOOKS) await new Promise(r => setTimeout(r, READY_LOOK_EVERY_MS));
  }
  /* One more read, for the reasons — and it can settle what the lookups during
     the wait could not: a listener older than our CLI is not ours. */
  const sorted = lineage.partition(unplaced);
  if (sorted.notMine.length) refuseForeign(sorted.notMine, "this run did not start");
  refuseUnproven(unplaced, missing, sorted.why);
}

/* Stop one of OUR children — once. A child that has ended, or that we have
   already stopped, has nothing left to kill, and its PID may be someone else's
   by now: `stopped` is what keeps a second call (cleanup() runs again from the
   "exit" handler) from handing a dead number to taskkill.

   Through its HANDLE, which names the process we started and nothing else.

   opts.tree — on Windows, kill the tree under it instead (`taskkill /F /T`).
   For the emulator CLI only: there the handle is a cmd.exe (npx.cmd needs a
   shell) with npx → node → java beneath it, so ending the handle ends a shell
   and leaves the emulators running. `/T` rebuilds that tree from
   ParentProcessId with no creation-time check — Windows never rewrites the
   field, so a process that still names a recycled PID in the tree as its
   parent dies with it. That is the reading process-lineage.js refuses; it is
   accepted here because nothing else stops the emulators this run started,
   and NOT where it buys nothing. The sim was tree-killed too until 2026-10-08:
   it is one node process whose only children are Playwright's browsers, and
   those exit when their driver does (checked on Windows with the pinned
   Playwright, 1.63: three runs, all 7 Chromium processes gone within seconds
   of the driver being ended by its handle). The static server has no children.

   The tree kill is synchronous (spawnSync), so the survey that follows it in
   cleanup() sees what SURVIVED it rather than what it is still killing. A
   handle kill is a request: the process is gone a moment later, not on
   return — which is all that is needed of the sim and the server, since
   nothing afterwards waits on their having gone. (On POSIX the CLI's is a
   request too, as it always was; the sweep in cleanup() is its backstop.)
   Both forms work from the process "exit" handler, where nothing
   asynchronous would. */
const stopped = new Set();
function stopChild(p, opts) {
  if (!p || p.killed || p.exitCode !== null || stopped.has(p)) return;
  stopped.add(p);
  try {
    if (opts && opts.tree && process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(p.pid)],
        { stdio: "ignore" });
    } else {
      p.kill();   // TerminateProcess on Windows, SIGTERM everywhere else
    }
  } catch (_) {}
}

function cleanup() {
  tearingDown = true;
  stopChild(simProc);                       // first: it is what writes
  stopChild(firebaseProc, { tree: true });
  stopChild(serveProc);
  /* Tree-kill only reaches the tree we own, and it did not reliably reap the
     RTDB emulator: observed 2026-08-05 leaving a java.exe listening on :9000
     after a clean exit, three runs for three. A leftover listener makes the
     NEXT run's waitForPort() succeed instantly against the STALE emulator, so
     the sim runs against the previous run's rules — or falls back to LocalDB
     and validates nothing at all. So look at the PORTS as a backstop — but
     kill only by LINEAGE: a listener is freed when it was shown to descend
     from firebaseProc and is still that process. Anything else there is
     another run's emulator or cannot be told from one, and is reported with
     the command to clear it by hand. */
  try {
    const survivors = emulatorPorts.survey([DB_PORT, AUTH_PORT]);
    const sorted = lineage
      ? lineage.partition(survivors)
      : { mine: [], notMine: [], unproven: survivors, why: [] };
    const ownedPids = new Set(sorted.mine.map(r => String(r.pid)));
    if (sorted.mine.length) {
      const killed = emulatorPorts.free([DB_PORT, AUTH_PORT], { onlyPids: ownedPids });
      console.log("Sim/emu: swept " + killed.length +
        " emulator listener(s) the tree-kill missed:\n" +
        emulatorPorts.describe(killed));
    }
    if (sorted.notMine.length) {
      console.warn("Sim/emu: these listeners were NOT started by this run, so " +
        "they were left alone:\n" + emulatorPorts.describe(sorted.notMine) +
        "\n\n" + emulatorPorts.LIVE_RUN_CAVEAT +
        "\n\nOnly when you know they are stale:\n  " +
        emulatorPorts.clearCommand(sorted.notMine));
    }
    if (sorted.unproven.length) {
      console.warn("Sim/emu: these listeners could NOT BE SHOWN to have been " +
        "started by this run, so they were left alone:\n" +
        emulatorPorts.describe(sorted.unproven) +
        (sorted.why.length ? "\n(" + sorted.why.join("; ") + ")" : "") +
        "\n\n" + emulatorPorts.LIVE_RUN_CAVEAT +
        "\n\nOnly when you know they are stale:\n  " +
        emulatorPorts.clearCommand(sorted.unproven));
    }
  } catch (e) {
    console.warn("Sim/emu: could not inspect the emulator ports at exit (" +
      ((e && e.message) || e) + ") — check by hand: npm run emulator:ports");
  }
}
process.on("SIGINT",  () => { cleanup(); cleanupEmulatorRules(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); cleanupEmulatorRules(); process.exit(143); });
process.on("exit",    () => { cleanup(); cleanupEmulatorRules(); });

/* Pre-flight ──────────────────────────────────────────────────────── */

function check(cmd, args, label) {
  return new Promise(resolve => {
    // shell:true so Windows can resolve `npx`/`java` from PATH variants
    // (`.cmd` / `.bat`) without us hardcoding the .cmd suffix.
    const p = spawn(cmd, args, {
      stdio: "pipe",
      shell: process.platform === "win32"
    });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    p.on("error", () => resolve(null));
    p.on("close", code => resolve(code === 0 ? out.trim() : null));
  });
}

(async () => {
  console.log("Sim/emu: pre-flight checks…");
  const javaV = await check("java", ["-version"], "java");
  if (javaV === null) {
    console.error("FATAL: Java is required for the Firebase RTDB emulator " +
      "but was not found on PATH. Install JDK 11+ (https://adoptium.net) " +
      "and re-run.");
    process.exit(1);
  }
  const fbV = await check("npx", ["firebase", "--version"], "firebase-tools");
  if (fbV === null) {
    console.error("FATAL: `npx firebase --version` failed. Run " +
      "`npm install firebase-tools --no-save` first.");
    process.exit(1);
  }
  console.log("Sim/emu: firebase-tools " + fbV + " · java OK");

  /* A STALE emulator is worse than none. waitForPort() below only checks that
     something is listening, so an orphan from a previous run (see cleanup())
     makes the readiness probe pass instantly and the sim then runs against
     THAT emulator — carrying the previous run's rules — or falls back to
     LocalDB and validates nothing. Fail loudly instead, the same way the
     web-port check below already does. */
  const squatters = emulatorPorts.survey([DB_PORT, AUTH_PORT]);
  if (squatters.length) {
    console.error("FATAL: the emulator ports are already in use:\n" +
      emulatorPorts.describe(squatters) + "\n\n" +
      emulatorPorts.LIVE_RUN_CAVEAT + "\n\n" +
      "A STALE emulator would make this run silently validate the PREVIOUS\n" +
      "run's rules, or fall back to LocalDB and validate nothing. Only when you\n" +
      "know it is stale — a leftover from a run that has ended — clear it:\n" +
      "  npm run emulator:free\n" +
      "or, directly:\n  " + emulatorPorts.clearCommand(squatters) + "\n\n" +
      "If this is an emulator you started on purpose (`npm run emulator`),\n" +
      "stop it first — the sim must own its own instance.");
    process.exit(1);
  }

  if (!fs.existsSync(FIREBASE_CONFIG)) {
    console.error("FATAL: " + FIREBASE_CONFIG + " not found.");
    process.exit(1);
  }

  /* ── Boot the platform static server. We do NOT reuse an existing
     server on the web port because the emulator-mode CSP relaxation lives
     in serve-platform.js's SIM_EMULATOR_MODE branch — an unbranded
     pre-existing server would block every emulator request with a
     "Refused to connect to http://127.0.0.1:9000" CSP violation.
     If something is on the port, surface it as a fatal so the user
     stops the conflicting process, or picks another port. */
  if (await isPortOpen(WEB_PORT)) {
    console.error("FATAL: port " + WEB_PORT + " is in use. Stop the existing server " +
      "(`taskkill /F /PID <pid>` on Windows, `lsof -i:" + WEB_PORT + "` on Unix) " +
      "before running the emulator sim — its CSP must allow localhost " +
      "connections to the emulator, which the default dev server does not. " +
      "If the port is something else's (AnkiConnect owns 8765 on some " +
      "machines), re-run with PORT=8771 instead.");
    process.exit(1);
  }
  console.log("Sim/emu: starting static platform server on :" + WEB_PORT +
    " (emulator-CSP mode)…");
  serveProc = spawn(process.execPath, [SERVE_PLATFORM], {
    stdio: ["ignore", "inherit", "inherit"],
    env: Object.assign({}, process.env,
      { SIM_EMULATOR_MODE: "1", PORT: String(WEB_PORT) })
  });
  await waitForPort(WEB_PORT, "static server", 10_000);

  /* ── Boot the Firebase emulator (using the emulator-patched rules). */
  console.log("Sim/emu: preparing emulator-compatible rules…");
  buildEmulatorRules();
  console.log("Sim/emu: starting firebase emulators (database + auth)…");
  const spawnedAt = Date.now();   // BEFORE the spawn: nothing of ours is older
  firebaseProc = spawn("npx", [
    "firebase", "emulators:start",
    "--only=database,auth",
    "--config", FIREBASE_CONFIG_EMU,
    "--project", "canamed-sim"
  ], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",   // npx.cmd on Windows
    env: Object.assign({}, process.env, {
      // The DB emulator picks a working directory from where it's
      // invoked when no --project is given; --project + a stable cwd
      // avoid the "Cannot determine project ID" error.
      FIREBASE_PROJECT_ID: "canamed-sim"
    })
  });
  lineage = processLineage.track(firebaseProc.pid, { spawnedAt });
  firebaseProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error("Sim/emu: firebase emulator exited with code " + code);
    }
    if (tearingDown) return;
    /* Our emulator has gone while the run still needs it — which is what
       losing the race for the ports looks like from here: the CLI finds :9000
       taken and exits. This must END the run, at whatever point it happens:
       waitForPort() below is satisfied by ANY listener, so without this only
       the readiness check would stand between the sim and whoever holds the
       ports — and a run whose emulator simply failed would sit out the probe.

       Stop the sim FIRST. If the ports are another session's, every moment it
       runs is a write into their database, and working out whose they are
       (next) reads the process table, which takes seconds and can fail.
       Neither stopping the sim nor ending the run depends on that read. */
    stopChild(simProc);
    /* WHO holds the ports now decides what is said, not whether the run ends.
       Only a listener SHOWN not to be ours is called another run's: one left
       behind by our own emulator crashing looks the same from the port, and
       blaming another session for that would send the reader the wrong way. */
    let sorted = { notMine: [], unproven: [] };
    try {
      sorted = lineage.partition(emulatorPorts.survey([DB_PORT, AUTH_PORT]));
    } catch (_) { /* reported as the plain exit below */ }
    if (sorted.notMine.length) {
      refuseForeign(sorted.notMine,
        "this run's own emulator has exited, and what holds the ports is not it");
    }
    console.error("FATAL: this run's emulator exited before the sim was done " +
      "(see the firebase CLI's output above)." +
      (sorted.unproven.length
        ? "\nStill on the ports, and NOT SHOWN to be this run's:\n" +
          emulatorPorts.describe(sorted.unproven) + "\n" +
          whatOfTheSim() + "\n\n" +
          emulatorPorts.LIVE_RUN_CAVEAT
        : ""));
    process.exit(1);
  });
  // Wait for BOTH the DB + Auth emulator ports to come up. The DB
  // emulator spends ~10s downloading + warming up on first run, so the
  // deadline is generous.
  await waitForPort(DB_PORT,   "RTDB emulator",  120_000);
  await waitForPort(AUTH_PORT, "Auth emulator",  60_000);
  /* The probe is answered by ANY listener: go no further until the ones on
     these ports have been shown to be ours. */
  await ownEmulatorOrRefuse();
  emulatorWasOurs = true;
  const ownershipPoll = setInterval(observeListeners, 5000);
  ownershipPoll.unref();
  console.log("Sim/emu: emulator is up — RTDB on :" + DB_PORT +
    ", Auth on :" + AUTH_PORT);

  /* ── Run the sim. Inherit stdio so its progress + report path appear
     inline. */
  console.log("Sim/emu: running simulate-session.js against the emulator…");
  const simEnv = Object.assign({}, process.env, {
    SIM_EMULATOR_MODE: "1",
    SIM_EMULATOR_HOST: HOST,
    SIM_DB_PORT: String(DB_PORT),
    SIM_AUTH_PORT: String(AUTH_PORT),
    /* The server this run started, wherever PORT put it — unless the caller
       has pointed the sim somewhere itself. */
    SIM_BASE_URL: process.env.SIM_BASE_URL || "http://" + HOST + ":" + WEB_PORT
  });
  /* Module-level, so that a run cut short (our emulator gone, see the "exit"
     handler above) takes the sim down with it instead of leaving it writing
     to whoever holds the ports. */
  simProc = spawn(process.execPath, [SIM_SCRIPT], {
    stdio: ["ignore", "inherit", "inherit"], env: simEnv
  });
  await new Promise(resolve => {
    simProc.on("exit", code => {
      console.log("Sim/emu: sim exited with code " + code);
      resolve(code);
    });
  });
  console.log("Sim/emu: done — tearing down emulator + server.");
  cleanup();
  // give the cleanup taskkill a tick to dispatch before exit
  setTimeout(() => process.exit(0), 500);
})().catch(err => {
  console.error("Sim/emu: FATAL", err && err.stack || err);
  cleanup();
  process.exit(1);
});
