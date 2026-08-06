/* tests/room-stage-single-writer.test.js
 *
 * INVARIANT: a room's `stage` has exactly ONE writer — the facilitator's
 * setRoomStage() in script-admin.js.
 *
 * Why this is worth a test of its own. `rooms/$roomId/stage` became an
 * admin-identity-bound node in Phase 4a (PR #223, 2026-07-22), but a
 * participant-side initialiser that predated the rules kept writing 0 to it on
 * every room entry (script.js startRoom()). For real participants the rules
 * rejected it, so it only ever showed up as a console error — invisible. For
 * the one caller whose uid DOES satisfy the rule (a facilitator who is also in
 * the room — which is every cross-tab e2e run, since a second tab in the same
 * browser context reuses the anonymous session) it was permitted, and it RACED
 * the Advance: `stage` read as absent, so `set(0)` was already in flight when
 * the facilitator wrote 1, and landed after it. The observable end state was a
 * room whose `stageAt` and stage event both recorded the advance while `stage`
 * itself sat at 0, one stage behind, with nothing left to re-write it. It
 * presented as an intermittent e2e failure and was written off as flake three
 * times before being traced.
 *
 * Static assertions — the emulator-backed behaviour is covered by
 * tests-e2e/emulator/rules-smoke.spec.js ("create → join → advance"), which now
 * asserts the DB value before the rendered indicator.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), "utf8");

const SCRIPT_JS = read("script.js");
const SCRIPT_ADMIN_JS = read("script-admin.js");
const RULES = JSON.parse(read("database.rules.json"));

/* Lines that both name a stage ref and perform a write. Line-scoped on purpose:
   it reports the offending source line, not just "a regex matched". */
function stageWriteLines(src) {
  return src.split(/\r?\n/)
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) =>
      /refStage|["']\/stage["']|\/stage["']/.test(line) &&
      /\.\s*(set|update|transaction|push)\s*\(/.test(line));
}

test("script.js never WRITES a room's stage — the participant only listens", () => {
  const offenders = stageWriteLines(SCRIPT_JS);
  assert.deepStrictEqual(offenders, [],
    "script.js is the participant-facing bundle and rooms/$roomId/stage is " +
    "admin-only (Phase 4a). A write here is rejected for every real " +
    "participant and, for a facilitator sitting in their own room, races " +
    "setRoomStage() and rolls the room back a stage. Offending line(s): " +
    JSON.stringify(offenders));
});

test("script.js still SUBSCRIBES to the stage so an advance propagates", () => {
  assert.match(SCRIPT_JS, /refStage\s*\.\s*on\s*\(\s*["']value["']/,
    "removing the participant's stage WRITE must not remove its listener — " +
    "that listener is how a facilitator's Advance reaches the room");
});

test("script-admin.js is the single writer (setRoomStage still sets it)", () => {
  assert.match(SCRIPT_ADMIN_JS, /stageRef\s*\.\s*set\s*\(/,
    "setRoomStage() must still write the stage — otherwise Advance is dead and " +
    "the invariant above is satisfied vacuously");
});

/* If the client write is ever reintroduced, the rules are the backstop that
   keeps it from taking effect in production. Pin them in both trees. */
for (const [label, node] of [
  ["sessions", RULES.rules.sessions.$sessionId.rooms.$roomId.stage],
  ["orgs", RULES.rules.orgs.$orgSlug.sessions.$sessionId.rooms.$roomId.stage]
]) {
  test(`rooms/$roomId/stage stays admin-identity-bound (${label} tree)`, () => {
    const w = node[".write"];
    assert.ok(w, `${label}: stage must carry an explicit .write`);
    assert.match(w, /creatorUid/,
      `${label}: the creator branch of the admin-identity predicate is missing`);
    assert.match(w, /adminSecrets/,
      `${label}: the password-proof branch of the admin-identity predicate is missing`);
    assert.doesNotMatch(w, /^\s*["']?auth\s*!=\s*null["']?\s*$/,
      `${label}: stage must not fall back to "any authenticated user"`);
  });
}
