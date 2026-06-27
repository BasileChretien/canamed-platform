/* tests/branched-runtime.test.js
 *
 * Path resolver for the branched-scenarios format: given the branch tree and
 * the room's committed choices, which ONE node is active now and what trail of
 * consequences led here. Pure unit tests, no DOM/Firebase.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { branchedPath } = require(
  path.join(
    __dirname,
    "..",
    "docs",
    "Third_session",
    "PBL_platform",
    "branched-runtime.js",
  ),
);

/* Three-node tree: n0 (entry) → option 0 unlocks n1 → option 1 unlocks n2.
 * Option 1 of n0 is an immediate ending (consequence, no follow-up). */
function tree() {
  return [
    {
      id: "n0",
      prompt: { en: "start" },
      options: [
        { text: { en: "go on" }, branch: { reveal: { en: "you proceed" } } },
        {
          text: { en: "stop here" },
          branch: { reveal: { en: "the end (early)" } },
        },
      ],
    },
    {
      id: "n1",
      unlockWhen: { afterDecision: { id: "n0", option: 0 } },
      prompt: { en: "second" },
      options: [
        { text: { en: "left" }, branch: { reveal: { en: "left result" } } },
        { text: { en: "right" }, branch: { reveal: { en: "right result" } } },
      ],
    },
    {
      id: "n2",
      unlockWhen: { afterDecision: { id: "n1", option: 1 } },
      prompt: { en: "third" },
      options: [
        { text: { en: "a" }, branch: { reveal: { en: "end a" } } },
        { text: { en: "b" }, branch: { reveal: { en: "end b" } } },
      ],
    },
  ];
}

test("with nothing committed, the entry node is active and the trail is empty", () => {
  const r = branchedPath(tree(), {});
  assert.strictEqual(r.active.id, "n0");
  assert.strictEqual(r.trail.length, 0);
  assert.strictEqual(r.done, false);
});

test("committing n0→0 advances to n1 and records the consequence", () => {
  const r = branchedPath(tree(), { n0: 0 });
  assert.strictEqual(r.active.id, "n1");
  assert.strictEqual(r.trail.length, 1);
  assert.strictEqual(r.trail[0].id, "n0");
  assert.strictEqual(r.trail[0].optionIndex, 0);
  assert.strictEqual(r.trail[0].reveal.en, "you proceed");
});

test("the chain walks n0→0 then n1→1 to reach n2, in order", () => {
  const r = branchedPath(tree(), { n0: 0, n1: 1 });
  assert.strictEqual(r.active.id, "n2");
  assert.deepStrictEqual(
    r.trail.map((t) => t.id),
    ["n0", "n1"],
  );
  assert.strictEqual(r.trail[1].reveal.en, "right result");
});

test("an ending option (no follow-up) leaves no active node → done", () => {
  const r = branchedPath(tree(), { n0: 1 });
  assert.strictEqual(r.active, null);
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.trail.length, 1);
  assert.strictEqual(r.trail[0].reveal.en, "the end (early)");
});

test("a fully traversed tree (terminal committed) is done with full trail", () => {
  const r = branchedPath(tree(), { n0: 0, n1: 1, n2: 0 });
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.active, null);
  assert.deepStrictEqual(
    r.trail.map((t) => t.id),
    ["n0", "n1", "n2"],
  );
});

test("committing the OFF-path option does not unlock the other branch's node", () => {
  // n0→1 ends; n1 is gated on n0→0, so it must NOT be active.
  const r = branchedPath(tree(), { n0: 1 });
  assert.notStrictEqual(r.active && r.active.id, "n1");
});

test("an empty tree resolves to no active node, done", () => {
  const r = branchedPath([], {});
  assert.strictEqual(r.active, null);
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.trail.length, 0);
});
