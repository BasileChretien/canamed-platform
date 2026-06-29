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

/* Array option gate: a node may unlock after ANY of several options of its
 * parent (afterDecision: { id, option: [1, 2] }) — so multiple wrong choices of
 * a 4-option node converge onto one consequence node without duplicating it. */
function arrayGateTree() {
  return [
    {
      id: "m0",
      prompt: { en: "first move" },
      options: [
        { text: { en: "right" }, branch: { reveal: { en: "good" } } },
        { text: { en: "wrong a" }, branch: { reveal: { en: "bad a" } } },
        { text: { en: "wrong b" }, branch: { reveal: { en: "bad b" } } },
        { text: { en: "wrong c" }, branch: { reveal: { en: "bad c" } } },
      ],
    },
    {
      id: "m_good",
      unlockWhen: { afterDecision: { id: "m0", option: 0 } },
      prompt: { en: "good path" },
      options: [{ text: { en: "x" }, branch: { reveal: { en: "ok" } } }],
    },
    {
      id: "m_bad",
      unlockWhen: { afterDecision: { id: "m0", option: [1, 2, 3] } },
      prompt: { en: "recover" },
      options: [{ text: { en: "y" }, branch: { reveal: { en: "rescued" } } }],
    },
  ];
}

test("array gate: every listed wrong option converges to the same node", () => {
  [1, 2, 3].forEach((opt) => {
    const r = branchedPath(arrayGateTree(), { m0: opt });
    assert.strictEqual(r.active.id, "m_bad", "m0 option " + opt + " → m_bad");
    assert.strictEqual(r.trail[0].id, "m0");
  });
});

test("array gate: the correct option still diverges to its own node", () => {
  const r = branchedPath(arrayGateTree(), { m0: 0 });
  assert.strictEqual(r.active.id, "m_good");
});

test("array gate: an option NOT in the list unlocks neither branch", () => {
  // m0 has no option 4; a value outside both gates leaves nothing active.
  const r = branchedPath(arrayGateTree(), { m0: 9 });
  assert.strictEqual(r.active, null);
});

test("array gate: an EMPTY/invalid option array never widens to 'any option'", () => {
  // A malformed empty array must NOT behave like null (any option) — otherwise a
  // typo would silently unlock the branch on every choice. The gated node simply
  // never unlocks (it is treated as a dangling/malformed reference).
  const tree = [
    {
      id: "p",
      prompt: { en: "pick" },
      options: [
        { text: { en: "a" }, branch: { reveal: { en: "ra" } } },
        { text: { en: "b" }, branch: { reveal: { en: "rb" } } },
      ],
    },
    {
      id: "child",
      unlockWhen: { afterDecision: { id: "p", option: [] } },
      prompt: { en: "should never open" },
      options: [{ text: { en: "x" }, branch: { reveal: { en: "rx" } } }],
    },
  ];
  // Committing p to either option must NOT activate the empty-array child.
  assert.notStrictEqual(branchedPath(tree, { p: 0 }).active && branchedPath(tree, { p: 0 }).active.id, "child");
  assert.notStrictEqual(branchedPath(tree, { p: 1 }).active && branchedPath(tree, { p: 1 }).active.id, "child");
});
