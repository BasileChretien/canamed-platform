/* tests/web-port.test.js
 *
 * PORT — the platform server's port — means the same thing to both
 * emulator-backed entry points, and a PORT that cannot work is refused by
 * each of them before it starts anything.
 *
 * WHY. `npm run sim:emulator` got a check of its own on 2026-10-08 (PR #444)
 * and `npm run test:e2e:rules` kept a bare parseInt, so the two disagreed, and
 * the new check was too strict: in cmd.exe `set PORT=8771 && npm run
 * sim:emulator` hands node "8771 " — the space before `&&` belongs to the
 * value — and "all digits" called that not a port. The reading is now one
 * function, scripts/ops/web-port.js, used by both.
 *
 * For the RUNNER this is consistency, not a safety fix: with a bare parseInt a
 * bad PORT there failed late, inside Playwright, and nothing unsafe followed
 * (traced in #444's second review). What changes is that it now fails at
 * once, by name, with nothing started — and that the two say the same thing.
 *
 * The launcher's half of the real runs is in tests/sim-launcher-run.test.js,
 * beside its other scenarios; the runner's is here.
 */
"use strict";

const { describe, it, test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const webPort = require("../scripts/ops/web-port.js");
const { ROOT, until, scenarios } = require("./fixtures/real-run-harness.js");

const EMULATORS = { db: 9000, auth: 9099 };
const NOT_A_PORT = /^that is not a port \(a whole number from 1 to 65535\)$/;

test("no PORT, an empty one or a blank one is the default", () => {
  for (const raw of [undefined, null, "", " ", "\t\r\n"]) {
    assert.deepStrictEqual(webPort.read(raw, EMULATORS),
      { asked: "8765", port: 8765, problem: null }, JSON.stringify(raw));
  }
});

test("a port number is taken, with whatever whitespace came around it", () => {
  /* "8771 " is what cmd.exe passes for `set PORT=8771 && …`. */
  for (const raw of ["8771", "8771 ", " 8771", "  8771\t", "8771\r\n", 8771]) {
    assert.deepStrictEqual(webPort.read(raw, EMULATORS),
      { asked: "8771", port: 8771, problem: null }, JSON.stringify(raw));
  }
  assert.strictEqual(webPort.read("1", EMULATORS).problem, null);
  assert.strictEqual(webPort.read("65535", EMULATORS).problem, null);
});

test("what is not a whole number from 1 to 65535 is not a port", () => {
  /* parseInt alone reads the first three of the second row as numbers. */
  const bad = [
    "abc", "0", "65536", "70000", "-1", "+8771", "87.5", "1e3",
    "8771abc", "0x2233", "8771 8772", "87 71", "８７７１"
  ];
  for (const raw of bad) {
    const web = webPort.read(raw, EMULATORS);
    assert.match(String(web.problem), NOT_A_PORT, JSON.stringify(raw));
    assert.strictEqual(web.asked, raw.trim(), "the message must quote what was asked for");
  }
  assert.ok(Number.isNaN(webPort.read("abc", EMULATORS).port),
    "and no number may be made of it for a caller that forgets to look at `problem`");
});

test("an emulator's own port is refused, by name — whitespace or not", () => {
  assert.strictEqual(webPort.read("9000", EMULATORS).problem,
    "that is the database emulator's port");
  assert.strictEqual(webPort.read("9000 ", EMULATORS).problem,
    "that is the database emulator's port",
    "trimmed first: a trailing space must not turn this into 'not a port'");
  assert.strictEqual(webPort.read(" 9099", EMULATORS).problem,
    "that is the auth emulator's port");
  assert.strictEqual(webPort.read("9001", EMULATORS).problem, null);
});

test("the refusal names the value, the reason and the way out", () => {
  const said = webPort.refusal(webPort.read(" 9000 ", EMULATORS), "npm run sim:emulator");
  assert.ok(said.startsWith(
    "PORT=\"9000\" cannot be the platform server's port — that is the database emulator's port."),
    said);
  assert.match(said, /Nothing was started\./);
  assert.match(said, /PORT=8771 npm run sim:emulator$/);
});

/* ── the runner, run for real ──────────────────────────────────────── */

const RUNNER = path.join(ROOT, "scripts", "ops", "run-rules-e2e.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-emulators-exec-preload.js");
const scenario = scenarios(RUNNER, PRELOAD);
const SCENARIO_TIMEOUT_MS = 240000;

/* The runner's end — or its stand-in CLI having been started, which for a
   PORT that must be refused is already the finding. */
async function endedOrStarted(ctx, run) {
  await until("the runner to end", () => run.endedAt() !== null || ctx.exists("started"), 60000);
  return run.endedAt() !== null;
}

describe("PORT and the rules-e2e runner, run for real", { concurrency: true }, () => {
  it("refuses a PORT that cannot be the platform server's — before anything is started",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      const cases = [
        ["abc", "abc", /that is not a port/],
        ["0", "0", /that is not a port/],
        [ctx.ports.spare + "abc", ctx.ports.spare + "abc", /that is not a port/],
        [String(ctx.ports.db), String(ctx.ports.db), /that is the database emulator's port/],
        [ctx.ports.auth + " ", String(ctx.ports.auth), /that is the auth emulator's port/]
      ];
      for (const [port, quoted, why] of cases) {
        const run = ctx.run({ PORT: port, FAKE_EXEC_MODE: "port-taken" });
        const ended = await endedOrStarted(ctx, run);
        assert.ok(ended && !ctx.exists("started"),
          "PORT=" + JSON.stringify(port) + ": the runner went on and started " +
          "emulators:exec\n" + run.output());
        const { code } = await run.gone;
        await run.exited;
        const out = run.output();
        assert.strictEqual(code, 1, out);
        assert.ok(out.includes("rules-e2e: FATAL — PORT=\"" + quoted +
          "\" cannot be the platform server's port"),
          "PORT=" + JSON.stringify(port) + " must be refused by name\n" + out);
        assert.match(out, why, "and for the right reason\n" + out);
        assert.match(out, /npm run test:e2e:rules/, "with its own command in the way out\n" + out);
        assert.doesNotMatch(out, /building emulator-compatible rules|starting emulators/,
          "nothing may have been started\n" + out);
      }
    }));

  it("takes a PORT with a space after it — what cmd.exe passes for `set PORT=8771 && …`",
    { timeout: SCENARIO_TIMEOUT_MS }, () => scenario(async (ctx) => {
      /* The allow leg: a runner that refused every PORT would pass the
         scenario above. (It took this one before too; the launcher did not.) */
      const run = ctx.run({ PORT: ctx.ports.web + " ", FAKE_EXEC_MODE: "port-taken" });
      const ended = await endedOrStarted(ctx, run);
      assert.ok(!ended && ctx.exists("started"),
        "the runner refused a port number for the space after it\n" + run.output());
      ctx.release();
      await run.exited;
      assert.doesNotMatch(run.output(), /cannot be the platform server's port/);
    }));
});
