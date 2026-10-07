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
const path = require("node:path");

const { ROOT, isListening, isAlive, until, scenarios } =
  require("./fixtures/real-run-harness.js");

const RUNNER = path.join(ROOT, "scripts", "ops", "run-rules-e2e.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-emulators-exec-preload.js");

/* How long a scenario waits for the runner to SAY it has classified a listener
   before letting its child exit regardless. Normally that takes a poll (2 s)
   plus one process-table read — instant on POSIX, 1.5 s of PowerShell on an
   idle Windows machine, and 10 s and more on one running several sessions'
   suites, which is why this is generous. It is only ever waited out in full by
   a runner that never says it: one that classifies nothing, or classifies by
   port as the old one did (it failed these tests at 8 s). */
const CLASSIFY_WAIT_MS = 60000;
const SCENARIO_TIMEOUT_MS = 240000;

/* One scenario's ports, scratch space and cleanup: fixtures/real-run-harness.js,
   where the helpers this file used to carry now live (two more files run a
   real entry point the same way). */
const scenario = scenarios(RUNNER, PRELOAD);

describe("the survivor sweep, run for real", { concurrency: true }, () => {
  it("does not kill a listener that took the port after the preflight — another run's live emulator",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
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
      /* What makes the stranger provably not the runner's, on Windows, is that
         it hangs off THIS process, which is older than the runner's child. Make
         that true by a margin no scheduler can eat: this scenario is among the
         first things the file does, and an earlier version of the test relied
         on the runner merely taking a while to start (it failed about one
         loaded run in three). */
      await until("this process to be clearly older than the run",
        () => process.uptime() > 1.5, 10000);
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
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
      const run = ctx.run({
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
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
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
