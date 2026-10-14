/* tests/sim-launcher-run.test.js
 *
 * `npm run sim:emulator` (scripts/sim/sim-with-emulator.js), RUN — the real
 * launcher in a child process, with stand-ins for the three programs it starts
 * (the firebase CLI, Java, the sim itself) and real listeners on throwaway
 * ports. See tests/fixtures/fake-sim-launcher-preload.js for exactly what is
 * replaced and what is not.
 *
 * WHY. The launcher starts a sim that WRITES to whatever answers on the
 * emulator ports, and those ports are shared by every checkout on the machine.
 * So the questions that matter are about order and about whose listener it is:
 * is the sim started only once the listeners are shown to be this run's? is it
 * stopped the moment this run's emulator goes — before anything slow? Until
 * 2026-10-08 the launcher could not be run by the unit suite (it wanted Java,
 * the CLI and port 8765), so those were text checks, and a review of PR #439
 * found four changes to the launcher that no test noticed. Each scenario below
 * says which of them it is there for.
 *
 * It also found two defects, fixed with this file:
 *
 *   A. THE READINESS CHECK FAILED OPEN. It refused to start the sim only on a
 *      listener SHOWN not to be this run's. One with no verdict — the process
 *      table could not be read, or the listener's creation time could not —
 *      was let through: with another session's emulator on the port, the sim
 *      was started against it and wrote into its database until this run's
 *      own CLI gave up. And the refusal message said, whatever had happened,
 *      "the sim is not being run against that listener".
 *   B. THE SIM WAS STOPPED WITH A TREE KILL (`taskkill /F /T`, Windows). The
 *      tree is rebuilt from ParentProcessId, which Windows never rewrites, so a
 *      process that merely names a recycled PID in it as its parent dies too.
 *      It is ended through its handle now.
 *
 * EVERY DENIAL HAS AN ALLOW LEG. "The sim was never started" is also true of a
 * launcher that cannot start one under this harness at all; the first scenario
 * is the run that does, and that tears everything down afterwards.
 *
 * Nothing here touches 9000, 9099, 4400 or 8765: another session may be using
 * them.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { ROOT, sleep, isListening, isAlive, until, scenarios } =
  require("./fixtures/real-run-harness.js");

const LAUNCHER = path.join(ROOT, "scripts", "sim", "sim-with-emulator.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-sim-launcher-preload.js");
const scenario = scenarios(LAUNCHER, PRELOAD);

const SCENARIO_TIMEOUT_MS = 240000;
/* How long the launcher gets to reach a point, or to end. Each step is quick
   on an idle machine; a process-table read alone is 5–15 s of PowerShell on a
   Windows machine running several sessions' suites, and the launcher takes up
   to three. What these bounds must stay UNDER is the launcher's own patience
   with a port nothing answers on — 120 s — which is how long a run that
   ignores its emulator's exit sits there. */
const REACH_MS = 90000;

/* The stand-in firebase CLI is in place: its PID. A launcher that has ENDED
   instead is the finding, made at once and with what it said — not after the
   whole bound (one that refused a PORT it should have taken was waited on for
   90 s before this looked). */
async function cliStarted(ctx, run) {
  await until("the stand-in firebase CLI to start",
    () => ctx.exists("started") || run.endedAt() !== null, REACH_MS);
  assert.ok(ctx.exists("started"),
    "the launcher ended without starting its emulator CLI\n" + run.output());
  return ctx.pid("started", REACH_MS);
}

/* The launcher's exit code and everything it printed. Bounded: a launcher that
   never ends is a finding, not a reason to hang the suite. */
async function ended(run) {
  await until("the launcher to end", () => run.endedAt() !== null, REACH_MS);
  await Promise.race([run.exited, sleep(10000)]);
  return { code: (await run.gone).code, out: run.output() };
}

/* Another session's emulator: it answers the launcher's readiness probe. */
async function theirEmulator(ctx) {
  return [
    await ctx.stranger(ctx.ports.db, "their-db", "http"),
    await ctx.stranger(ctx.ports.auth, "their-auth", "http")
  ];
}

async function assertUntouched(ctx, strangers, out) {
  for (const s of strangers) {
    assert.ok(isAlive(s.pid) && await isListening(s.port),
      "the launcher KILLED a listener it did not start (PID " + s.pid + " on :" +
      s.port + ") — another session's emulator.\nLauncher output:\n" + out);
    assert.match(out, new RegExp(":" + s.port + " held by PID " + s.pid),
      "and it must name what it left alone\n" + out);
  }
}

function assertSimNeverStarted(ctx, out) {
  assert.ok(!ctx.exists("sim-spawned"),
    "the launcher STARTED THE SIM. What answered on the emulator ports had not " +
    "been shown to be this run's emulator, and the sim writes to whatever " +
    "answers there.\nLauncher output:\n" + out);
}

/* For the scenarios that need the sim RUNNING: wait for it to be writing (and
   for `also`, a file it leaves when it is fully set up) — or for the launcher
   to have ended instead, which is then the finding, made at once rather than
   after waiting out a sim that is never coming. */
async function simRunning(ctx, run, also) {
  await until("the sim to be running",
    () => run.endedAt() !== null || (ctx.exists("sim-beats") && (!also || ctx.exists(also))),
    REACH_MS);
  assert.strictEqual(run.endedAt(), null,
    "the launcher ended without ever running the sim against its OWN emulator\n" +
    run.output());
}

/* When the stand-in sim last wrote: the last COMPLETE line of its log. It is
   killed mid-run here, so the line it was writing at that instant may be cut
   short — and that one is not a time. */
function lastSimWrite(ctx) {
  const log = ctx.read("sim-beats");
  const lines = log.slice(0, log.lastIndexOf("\n")).split("\n");
  return parseInt(lines[lines.length - 1], 10);
}

/* For the scenarios in which the sim must NEVER start: the launcher's end, or
   the sim's start — whichever comes first. A launcher that has started the sim
   waits for it for as long as it runs, and by then the finding is made. */
async function endedWithoutSim(ctx, run) {
  await until("the launcher to end",
    () => run.endedAt() !== null || ctx.exists("sim-spawned"), REACH_MS);
  assertSimNeverStarted(ctx, run.output());
  return ended(run);
}

/* All at once everywhere but Windows, where it is four at a time. Each scenario
   there costs process-table reads and kills that go through WMI, and those
   slow each other down: beside the unit suite, a read was measured at 2.3 s
   median and 11 s at worst, a kill at 1.2 s and 10 s (103 of each, none
   failed). tests/emulator-sweep-lineage.test.js runs in the same minute and
   has failed once on this machine under load, cause not established — so this
   file, which brought ten more such scenarios, does not pile them all on at
   the same instant. It costs this file about 11 s (23 s → 35 s, alone). */
const AT_ONCE = process.platform === "win32" ? 4 : true;

describe("the sim launcher, run for real", { concurrency: AT_ONCE }, () => {
  it("refuses a PORT that cannot be the platform server's — before anything is started",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* A bare parseInt used to let each of these through to fail late and
         say something untrue: "starting static platform server on :NaN" and a
         10 s wait; or, for an emulator's own port, the platform server bound
         there, the emulator unable to, and the run refused as ANOTHER RUN
         HOLDS THE EMULATOR PORTS — about this run's own node.exe. */
      const cases = [
        ["abc", /that is not a port/],
        ["0", /that is not a port/],
        ["70000", /that is not a port/],
        /* parseInt would read the number and ignore the rest. (This scenario's
           own spare port, so that a launcher which did just that would bind
           nothing anyone else is using.) */
        [ctx.ports.spare + "abc", /that is not a port/],
        [String(ctx.ports.db), /that is the database emulator's port/],
        [String(ctx.ports.auth), /that is the auth emulator's port/],
        /* With the space cmd.exe leaves on `set PORT=9000 && …`. It is an
           emulator's port all the same, and must be refused as THAT: the
           first version of this check tested for digits before trimming, and
           called it "not a port". */
        [ctx.ports.db + " ", /that is the database emulator's port/]
      ];
      for (const [port, why] of cases) {
        const run = ctx.run({ PORT: port, FAKE_EXEC_MODE: "serve" });
        const { code, out } = await ended(run);
        assert.strictEqual(code, 1, "PORT=" + port + "\n" + out);
        assert.ok(out.includes("FATAL: PORT=\"" + port.trim() + "\" cannot be the platform server's port"),
          "PORT=" + port + " must be refused by name\n" + out);
        assert.match(out, why, "and the reason given must be the right one\n" + out);
        assert.doesNotMatch(out, /pre-flight checks|starting static platform server|ANOTHER RUN/,
          "PORT=" + port + ": nothing may have been started, or said about other runs\n" + out);
        assert.ok(!ctx.exists("started") && !ctx.exists("sim-spawned"),
          "PORT=" + port + ": the emulator CLI and the sim must not have been spawned");
      }
    }));

  it("runs the sim against its own emulator, then leaves nothing behind (the allow leg)",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* PORT with a space after it: what cmd.exe passes for `set PORT=8771 &&
         npm run sim:emulator`. A port all the same — the first PORT check
         refused it (found in review), which would have made this the scenario
         where the sim never runs. Every other scenario here passes it bare. */
      const run = ctx.run({ FAKE_EXEC_MODE: "serve", PORT: ctx.ports.web + " " });
      const cli = await cliStarted(ctx, run);
      await simRunning(ctx, run);
      const sim = await ctx.pid("sim.pid");
      assert.ok(await isListening(ctx.ports.web),
        "the platform server must be on the port PORT names — not on 8765, which " +
        "this file used to have written into it");
      assert.strictEqual(ctx.read("sim-base-url"), "http://127.0.0.1:" + ctx.ports.web,
        "and the sim must be TOLD where that is: left to its default it loads " +
        "the platform from :8765, whatever is there");

      ctx.touch("sim-finish");
      const { code, out } = await ended(run);

      assert.match(out, /Sim\/emu: emulator is up/,
        "listeners its own CLI started must be recognised as its own\n" + out);
      assert.match(out, /Sim\/emu: sim exited with code 0/);
      assert.strictEqual(code, 0, out);
      await until("its processes to be gone", () => !isAlive(cli) && !isAlive(sim), 15000)
        .catch(() => {});
      assert.ok(!isAlive(cli), "its emulator CLI must be stopped at the end\n" + out);
      assert.ok(!isAlive(sim));
      for (const port of [ctx.ports.db, ctx.ports.auth, ctx.ports.web]) {
        assert.strictEqual(await isListening(port), false,
          ":" + port + " must be free again — a leftover makes the NEXT run's " +
          "readiness probe pass against it\n" + out);
      }
    }));

  it("looks again when a lookup cannot be made — one failed read is not a refusal (the allow leg of A)",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* [mutant: one look only] Its own emulator, and a process table that
         cannot be read the first time: a PowerShell that timed out, on a
         machine running several sessions' suites. Failing closed must not
         mean failing on the first hiccup — or the fix for A would trade a sim
         that runs against a stranger for a sim that seldom runs at all. */
      const run = ctx.run({ FAKE_EXEC_MODE: "serve", FAKE_PS: "fail-once" });
      await cliStarted(ctx, run);
      await until("the sim to start, or the launcher to give up",
        () => ctx.exists("sim-spawned") || run.endedAt() !== null, REACH_MS);
      assert.ok(ctx.exists("sim-spawned"),
        "the launcher refused its OWN emulator after a single failed lookup\n" + run.output());

      ctx.touch("sim-finish");
      const { code, out } = await ended(run);
      assert.match(out, /Sim\/emu: emulator is up/);
      assert.strictEqual(code, 0, out);
    }));

  it("refuses when another run's emulator answers the readiness probe — the sim is never started",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* [mutant: the readiness refusal deleted] The launcher's own CLI is still
         alive (the real one takes seconds to notice "port taken"), so nothing
         but the readiness check stands between the sim and their database. */
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
      await cliStarted(ctx, run);
      const theirs = await theirEmulator(ctx);
      const { code, out } = await endedWithoutSim(ctx, run);

      await assertUntouched(ctx, theirs, out);
      assert.strictEqual(code, 1, out);
      assert.match(out, /ANOTHER RUN HOLDS THE EMULATOR PORTS/);
      assert.match(out, /The sim was NOT started/,
        "what it says of the sim must be what happened\n" + out);
      assert.match(out, /NOTHING OF THEIRS IS KILLED/);
    }));

  it("refuses when it cannot be SHOWN whose the listeners are — no verdict is not a pass (finding A)",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* Same listeners, same live CLI; the process table cannot be read, so
         nothing can be shown about them either way. Before the fix the sim
         was started here. */
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken", FAKE_PS: "fail" });
      await cliStarted(ctx, run);
      const theirs = await theirEmulator(ctx);
      const { code, out } = await endedWithoutSim(ctx, run);

      await assertUntouched(ctx, theirs, out);
      assert.strictEqual(code, 1, out);
      assert.match(out, /could NOT BE SHOWN to be this run's own emulator/);
      assert.match(out, /cannot read the process table \(staged by the test: no process table\)/,
        "and it must give the reason it has\n" + out);
      assert.match(out, /The sim was NOT started/);
      assert.match(out, /LIVE EMULATOR/,
        "it may be another session's emulator: the report must say so\n" + out);
      assert.doesNotMatch(out, /ANOTHER RUN HOLDS THE EMULATOR PORTS/,
        "that was not shown either, and must not be claimed\n" + out);
    }));

  it("refuses when the listeners that answered the probe are gone by the time it looks",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* The probe was answered, and then there is nothing on the ports to be
         shown to be anyone's — under a CLI that is still alive, so its "exit"
         does not end the run either. An empty port is not "every listener is
         ours": whatever binds it next is what the sim would write to. */
      const run = ctx.run({ FAKE_EXEC_MODE: "vanish" });
      const { code, out } = await endedWithoutSim(ctx, run);

      assert.strictEqual(code, 1, out);
      assert.match(out, /could NOT BE SHOWN to be this run's own emulator/);
      assert.match(out, new RegExp(
        "nothing is listening on :" + ctx.ports.db + ", :" + ctx.ports.auth + " any more"), out);
    }));

  it("ends the run when its emulator exits before anything answers — it does not wait out the probe",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* [mutant: the emulator's exit ignored until the sim exists] With the
         "exit" handler returning early, the launcher sits in waitForPort() for
         its full 120 s — and, with another session's emulator on the port,
         walks straight on to the sim. */
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
      await cliStarted(ctx, run);
      ctx.release();                      // the CLI fails and exits; nothing listens
      const releasedAt = Date.now();
      const { code, out } = await endedWithoutSim(ctx, run);

      assert.ok(run.endedAt() - releasedAt < REACH_MS);
      assert.strictEqual(code, 1, out);
      assert.match(out, /this run's emulator exited before the sim was done/);
    }));

  it("the lost race for the ports: their emulator binds, this run's CLI exits — nothing of theirs is touched",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* The 2026-10-07 incident, from the losing side. Which guard gets there
         first depends on timing — the CLI's exit, or the readiness check —
         and either must do. */
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
      await cliStarted(ctx, run);
      const theirs = await theirEmulator(ctx);
      ctx.release();                      // "Could not start Database Emulator, port taken."
      const { code, out } = await endedWithoutSim(ctx, run);

      await assertUntouched(ctx, theirs, out);
      assert.strictEqual(code, 1, out);
      assert.match(out, /LIVE EMULATOR|ANOTHER RUN HOLDS THE EMULATOR PORTS/,
        "the report must say it may be another run's, not just that it is there\n" + out);
      assert.doesNotMatch(out, /swept \d+ emulator listener/,
        "nothing was freed, so nothing may be reported as freed");
    }));

  it("sees an emulator that died DURING the ownership lookup, before starting the sim",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* [mutant: the yield before the readiness decision deleted] The lookup
         is synchronous and takes seconds on Windows. Here the CLI is alive in
         the table that is read — so its listeners are, correctly, "ours" — and
         has exited by the time the read returns. Only a turn of the event loop
         lets the launcher learn that. */
      const run = ctx.run({ FAKE_EXEC_MODE: "serve", FAKE_PS: "cli-exits-during-read" });
      const { code, out } = await endedWithoutSim(ctx, run);

      assert.ok(ctx.exists("cli-exited"),
        "fixture: the CLI must have exited during the lookup, or this shows nothing\n" + out);
      assert.strictEqual(code, 1, out);
      assert.match(out, /this run's emulator exited before the sim was done/);
    }));

  it("stops the sim FIRST when its emulator goes mid-run — and only the sim (finding B)",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* [mutant: the handler no longer stops the sim] The launcher's next step
         after its emulator exits is to work out whose the ports are now, which
         reads the ports and the process table: seconds, and here 1.5 s by
         construction. Until the sim is stopped it is writing to whatever
         answers there. */
      const SLOW_MS = 1500;
      ctx.leftover(ctx.ports.spare, "bystander.pid");
      const run = ctx.run({
        FAKE_EXEC_MODE: "serve",
        FAKE_SLOW_READ_AFTER_CLI_EXIT_MS: String(SLOW_MS),
        FAKE_SIM_BYSTANDER_PORT: String(ctx.ports.spare)
      });
      await cliStarted(ctx, run);
      await simRunning(ctx, run, "bystander.pid");
      const sim = await ctx.pid("sim.pid");

      ctx.release();                      // this run's emulator crashes
      const { code, out } = await ended(run);

      assert.ok(ctx.exists("read-after-cli-exit"),
        "fixture: the launcher never looked at the ports after its emulator exited\n" + out);
      const lookedAt = parseInt(ctx.read("read-after-cli-exit"), 10);
      const lastWrite = lastSimWrite(ctx);
      assert.ok(Number.isFinite(lookedAt) && Number.isFinite(lastWrite),
        "fixture: both moments must have been recorded, or the comparison below " +
        "is of nothing (" + lookedAt + ", " + lastWrite + ")");
      assert.ok(lastWrite - lookedAt < 300,
        "the sim was still writing " + (lastWrite - lookedAt) + " ms into the " +
        SLOW_MS + " ms the launcher spent working out whose the ports were. It " +
        "must be stopped BEFORE that: if the ports are another session's by " +
        "then, every one of those writes went into its database.\n" + out);
      assert.ok(!isAlive(sim), "and it must be stopped at all\n" + out);
      assert.strictEqual(code, 1, out);
      assert.match(out, /this run's emulator exited before the sim was done/);

      /* A child of the sim that does not depend on it. On Windows `taskkill /T`
         takes it too — along with anything else that names the sim's PID as
         its parent, which is how a tree kill reaches a process this run never
         started. (POSIX never tree-killed, so there this cannot fail.) */
      assert.ok(await isListening(ctx.ports.spare),
        "stopping the sim killed a process that merely had it as a parent: the " +
        "sim must be ended through its handle, not by its tree\n" + out);
    }));

  it("says what happened to the sim when the ports change hands mid-run",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* This run's emulator was up and the sim running; the emulator goes, and
         by the time the launcher looks, another session's answers on its port.
         The message used to say "the sim is not being run against that
         listener" here too.

         Their process is started FIRST, and binds later: with the launcher's
         own CLI gone there is no lineage left to show, so what shows that a
         listener is not this run's is that it is OLDER than the run — by more
         than the 2 s + 1 s a POSIX creation time can be off by. And the
         launcher's look at the ports is held until that listener is in place,
         rather than raced. */
      const theirs = await ctx.stranger(ctx.ports.db, "their-db", "http", { waiting: true });
      await until("their process to be clearly older than this run",
        () => Date.now() - theirs.startedAt > 3500, 10000);

      const run = ctx.run({ FAKE_EXEC_MODE: "serve", FAKE_HOLD_READ_AFTER_CLI_EXIT: "1" });
      await cliStarted(ctx, run);
      await simRunning(ctx, run);

      ctx.release();                      // this run's emulator goes
      await until("the launcher to learn its emulator has gone",
        () => ctx.exists("read-after-cli-exit"), REACH_MS);
      await theirs.bind();                // and theirs takes the port it left
      ctx.touch("read-go");
      const { code, out } = await ended(run);

      await assertUntouched(ctx, [theirs], out);
      assert.strictEqual(code, 1, out);
      assert.match(out, /ANOTHER RUN HOLDS THE EMULATOR PORTS/, out);
      assert.match(out, /This run's emulator was up, and has gone/,
        "it lost no race for the ports: its emulator was up, and verified\n" + out);
      assert.match(out, /The sim WAS RUNNING and has been stopped/, out);
      assert.match(out, /may have reached that listener/);
      assert.doesNotMatch(out, /The sim was NOT started|not being run against/,
        "it WAS started, and ran until its emulator went\n" + out);
    }));
});
