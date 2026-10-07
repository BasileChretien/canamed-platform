/* tests/emulator-runner-signal.test.js
 *
 * A SIGINT / SIGTERM to `npm run test:e2e:rules` (scripts/ops/run-rules-e2e.js)
 * must stop the suite, WAIT FOR IT TO EXIT, sweep what it left on the emulator
 * ports, and return the shell — in that order, and without waiting longer than
 * the child takes.
 *
 * THE DEFECT (found 2026-10-07 by a probe; older than the lineage work). The
 * handler forwarded the signal and then "waited" like this:
 *
 *     while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
 *       spawnSync(process.execPath, ["-e", "setTimeout(()=>{},150)"], { stdio: "ignore" });
 *     }
 *
 * `exitCode` and `signalCode` are set from libuv's exit callback, which runs
 * only when the event loop turns — and a synchronous loop never lets it. So
 * the condition could not change through the child exiting: the loop ALWAYS
 * ran to its 10 s deadline. Every Ctrl-C cost ten seconds, child gone or not,
 * and what the comment above it called a bounded wait-for-exit was a fixed
 * sleep.
 *
 * A text check pinned that while-condition verbatim ("the wait must be
 * bounded"), so it pinned the defect: green on the fixed sleep, red on any
 * repair. Hence a run for real, as in tests/emulator-sweep-lineage.test.js —
 * the same harness, the same stand-in for `firebase emulators:exec`.
 *
 * HOW THE SIGNAL GETS THERE.
 *   POSIX    a real one, to the runner's process.
 *   Windows  none can be sent: ChildProcess.kill() is TerminateProcess, so the
 *            runner would die and its handler never run — and a test that
 *            "passed" that way would have tested nothing. The preload emits
 *            the event on `process` instead, which is what Node itself does
 *            when a console Ctrl-C arrives. The handler under test and its
 *            Windows branch (the tree-kill) are reached; signal delivery is
 *            not, and is not claimed.
 *
 * Two of the scenarios need a child that RECEIVES the signal and outlives it
 * (one ignores it, one takes its time). On Windows the runner stops its child
 * with `taskkill /F`, which no process can ignore or delay, so those two cannot
 * be staged there: they are skipped on win32 by name, with the reason, and run
 * on CI (ubuntu-latest).
 *
 * Nothing here touches 9000, 9099 or 4400: another session may be using them.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { ROOT, sleep, isListening, isAlive, until, scenarios } =
  require("./fixtures/real-run-harness.js");

const RUNNER = path.join(ROOT, "scripts", "ops", "run-rules-e2e.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-emulators-exec-preload.js");
const scenario = scenarios(RUNNER, PRELOAD);

const IS_WIN = process.platform === "win32";
const SCENARIO_TIMEOUT_MS = 240000;
const CLASSIFY_WAIT_MS = 60000;
/* The runner's own bound on the wait (STOP_WAIT_MS there). */
const BOUND_MS = 10000;
/* "It did not wait out the bound." The old handler could not get past its wait
   in less than the full 10 s, ever; the repaired one is past it as soon as the
   child has gone. Anything under the bound tells the two apart, so the
   threshold sits close to it.

   WHAT IS TIMED is the wait, as the runner itself reports it ("the suite was
   gone N ms after it was stopped") — from the child having been told, to its
   exit being seen. NOT the wall-clock from the signal to the runner's exit.
   That also holds the telling and the look at the ports afterwards, and on
   Windows both go through tools that slow to a crawl on a busy machine: with
   the whole unit suite running — a dozen real-process scenarios reading the
   process table at once — `taskkill` alone took 16 s, and a correct runner
   17 s from signal to exit (seen twice in a dozen runs; the first version of
   this test failed on it). The wall-clock is quoted in the failure message,
   where it helps tell a slow wait from a slow machine. */
const PROMPT_MS = 8000;

/* The wait the runner reported, in ms — or null if it never said its child
   had gone (it gave up at the bound, or its handler never returned to the
   event loop at all, as the old one did not). */
function waitReported(out, signal) {
  const said = new RegExp("the suite was gone (\\d+) ms after it was stopped \\(" +
    signal + "; stopping it took \\d+ ms\\) — sweeping").exec(out);
  return said ? parseInt(said[1], 10) : null;
}

const POSIX_ONLY = IS_WIN
  ? "needs a child that receives the signal and outlives it; on Windows the " +
    "runner stops its child with `taskkill /F`, which cannot be ignored or " +
    "delayed. Runs on CI (ubuntu-latest)."
  : false;

/* Deliver `signal` to the runner (see the header for why Windows differs), and
   say when. */
function send(ctx, run, signal) {
  if (IS_WIN) ctx.touch("signal-" + signal);
  else run.child.kill(signal);
  return Date.now();
}

/* The stand-in emulators:exec is in place: its PID. */
function started(ctx) {
  return ctx.pid("started", 30000);
}

describe("a signal to the rules-e2e runner, run for real", { concurrency: true }, () => {
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    it(signal + " ends the run as soon as its child has exited — not ten seconds later",
      { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
        const run = ctx.run({ FAKE_EXEC_MODE: "port-taken" });
        const cli = await started(ctx);

        const sentAt = send(ctx, run, signal);
        const { code } = await run.gone;
        const took = run.endedAt() - sentAt;
        const reached = !isAlive(cli);
        /* If the signal never reached the child, it is alive and holds the
           runner's output open: let it go before reading that output. */
        ctx.release();
        await run.exited;
        const out = run.output();

        const waited = waitReported(out, signal);
        assert.ok(waited !== null && waited < PROMPT_MS,
          "the runner " + (waited === null
            ? "never saw its child exit"
            : "waited " + waited + " ms for its child") + " after " + signal +
          ", with a child that dies of the signal at once (" + took + " ms from the " +
          "signal to the runner's exit). The wait must end when the child exits; " +
          "one that only ends at its " + BOUND_MS + " ms bound is a fixed sleep.\n" +
          "Runner output:\n" + out);
        assert.strictEqual(code, exitCode,
          "an interrupted run exits 128 + the signal's number\n" + out);
        assert.strictEqual(run.endedBy(), null,
          "and exits by its own hand, after its handler ran — it was not killed");
        assert.doesNotMatch(out, /did not exit within/,
          "the child did exit, so nothing may say that it did not\n" + out);
        assert.ok(reached, "the signal must have reached the child\n" + out);
      }));
  }

  it("a child that ignores the signal cannot hang the shell — the wait is bounded",
    { timeout: SCENARIO_TIMEOUT_MS, skip: POSIX_ONLY }, () => scenario(async (ctx) => {
      const run = ctx.run({ FAKE_EXEC_MODE: "port-taken", FAKE_EXEC_ON_SIGNAL: "ignore" });
      const cli = await started(ctx);

      const sentAt = send(ctx, run, "SIGINT");
      /* Bounded here too: a runner with no bound waits for as long as its
         child lives, and this child never exits by itself. */
      await until("the runner to give up on its child",
        () => run.endedAt() !== null, BOUND_MS + 45000);
      const { code } = await run.gone;
      const took = run.endedAt() - sentAt;
      const outlived = isAlive(cli);
      /* The wedged child inherited the runner's stdout and still holds it
         open: let it go, or the output never ends. */
      ctx.release();
      await run.exited;
      const out = run.output();

      assert.strictEqual(ctx.read("signals"), "SIGINT\n",
        "fixture: the child must have RECEIVED the signal, or this shows nothing");
      assert.ok(outlived, "fixture: and must have outlived the runner");
      assert.ok(took >= BOUND_MS - 500,
        "the runner gave up on a live child after only " + took + " ms: the sweep " +
        "would then run while emulators:exec is still using the ports\n" + out);
      assert.strictEqual(waitReported(out, "SIGINT"), null,
        "it never saw this child exit, so it must not say that it did\n" + out);
      assert.match(out, /did not exit within 10 s of SIGINT/,
        "and it must say that it gave up waiting, not exit as if all were well\n" + out);
      assert.strictEqual(code, 130);
    }));

  it("the sweep waits for the child, and a second signal does not hurry it",
    { timeout: SCENARIO_TIMEOUT_MS, skip: POSIX_ONLY }, () => scenario(async (ctx) => {
      /* emulators:exec has a listener of its own up, and on a signal takes 1.5 s
         to shut down — then exits WITHOUT stopping that listener, which is the
         leftover the sweep exists for. */
      const run = ctx.run({
        FAKE_EXEC_MODE: "orphan",
        FAKE_EXEC_ORPHAN_PORT: String(ctx.ports.db),
        FAKE_EXEC_ON_SIGNAL: "linger",
        FAKE_EXEC_LINGER_MS: "1500"
      });
      await started(ctx);
      const orphan = await ctx.orphanPid();
      /* Lineage is shown only while the child is alive: without this the sweep
         would have nothing it may free, and "it was freed" could not be asked. */
      await until("the runner to recognise its own listener",
        () => /this run's own/.test(run.output()), CLASSIFY_WAIT_MS).catch(() => {});

      const sentAt = send(ctx, run, "SIGINT");
      await sleep(400);
      send(ctx, run, "SIGTERM");          // an impatient second signal, mid-wait
      const { code } = await run.gone;
      const took = run.endedAt() - sentAt;
      /* A child the signal never reached is still alive, holding the runner's
         output open: let it go before reading that output. */
      ctx.release();
      await run.exited;
      const out = run.output();

      assert.ok(ctx.exists("listener-at-exit"),
        "the child never acted on the signal: it was not forwarded\n" + out);
      assert.strictEqual(ctx.read("listener-at-exit"), "listening",
        "the sweep freed this run's listener while its own child was still " +
        "shutting down — a signal to the runner must not race the child, and " +
        "a second one is no reason to\n" + out);
      assert.strictEqual(ctx.read("signals"), "SIGINT\n",
        "the child is told ONCE: the second signal changes nothing, and is not " +
        "forwarded\n" + out);
      assert.strictEqual(code, 130, "the exit code is the first signal's\n" + out);

      await until("the leftover to die", () => !isAlive(orphan), 10000).catch(() => {});
      assert.ok(!isAlive(orphan) && !(await isListening(ctx.ports.db)),
        "and once the child HAS exited, the sweep must still run: the leftover " +
        "is freed (the allow leg — a handler that never swept would pass " +
        "everything above)\n" + out);
      assert.match(out, /left 1 listener\(s\) behind; freed them/);
      assert.ok(took >= 1400,
        "the run ended " + took + " ms after the signal, before its child had exited");
      const waited = waitReported(out, "SIGINT");
      assert.ok(waited !== null && waited >= 1400 && waited < PROMPT_MS,
        "the runner reported a wait of " + waited + " ms for a child that takes " +
        "1500 to go: it must wait that long, and no longer (" + took + " ms from " +
        "the signal to the runner's exit)\n" + out);
    }));
});
