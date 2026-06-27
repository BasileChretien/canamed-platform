/* tests/branched-author.test.js
 *
 * The authoring emit core: forward edges (option.next → target node) translated
 * to the runtime's reverse unlockWhen.afterDecision gates. The acceptance bar is
 * a round-trip: a sensible forward-edge node list must build a scenario the
 * graph validator accepts.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const { buildBranchedScenario } = require(path.join(P, "branched-author.js"));
const { validateBranchedGraph } = require(path.join(P, "branched-validate.js"));

/* Editor node list: n0 → (opt0) n1, (opt1) ends; n1 → both opts end. */
function nodes() {
  return [
    {
      id: "n0",
      stem: "Start?",
      points: 10,
      penalty: 5,
      options: [
        { text: "go on", consequence: "you proceed", next: "n1" },
        { text: "stop", consequence: "the end", correct: false },
      ],
    },
    {
      id: "n1",
      stem: "Then?",
      options: [
        { text: "good", consequence: "great", correct: true },
        { text: "bad", consequence: "ouch" },
      ],
    },
  ];
}

test("a sensible forward-edge tree builds a graph the validator accepts", () => {
  const { scenario, warnings } = buildBranchedScenario(
    { id: "x", title: "X case" },
    nodes(),
  );
  assert.strictEqual(scenario.format, "branched");
  const r = validateBranchedGraph(scenario);
  assert.strictEqual(r.ok, true, "errors: " + JSON.stringify(r.errors));
  assert.strictEqual(warnings.length, 0);
});

test("the entry node carries no gate; the targeted node is gated on its source option", () => {
  const { scenario } = buildBranchedScenario({ id: "x" }, nodes());
  const byId = Object.fromEntries(scenario.decisions.map((d) => [d.id, d]));
  assert.strictEqual(byId.n0.unlockWhen, undefined, "n0 is the entry");
  assert.deepStrictEqual(byId.n1.unlockWhen, {
    afterDecision: { id: "n0", option: 0 },
  });
  assert.strictEqual(byId.n1.hideWhenLocked, true);
});

test("forward edges become consequences (branch.reveal) and carry correctness", () => {
  const { scenario } = buildBranchedScenario({ id: "x" }, nodes());
  const n0 = scenario.decisions[0];
  assert.strictEqual(n0.options[0].branch.reveal.en, "you proceed");
  assert.strictEqual(n0.module, "A");
  assert.strictEqual(scenario.decisions[1].options[0].correct, true);
});

test("several options of one parent converging on a node → id-only (any-option) gate", () => {
  const conv = [
    {
      id: "a",
      stem: "pick",
      options: [
        { text: "left", consequence: "l", next: "b" },
        { text: "right", consequence: "r", next: "b" },
      ],
    },
    {
      id: "b",
      stem: "next",
      options: [
        { text: "x", consequence: "end x", correct: true },
        { text: "y", consequence: "end y" },
      ],
    },
  ];
  const { scenario, warnings } = buildBranchedScenario({ id: "c" }, conv);
  const b = scenario.decisions.find((d) => d.id === "b");
  assert.deepStrictEqual(
    b.unlockWhen,
    { afterDecision: "a" },
    "converges via id-only gate",
  );
  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(validateBranchedGraph(scenario).ok, true);
});

test("cross-parent convergence is flagged as a warning (single-gate model limit)", () => {
  const cross = [
    {
      id: "p1",
      stem: "one",
      options: [
        { text: "to t", consequence: "c", next: "t" },
        { text: "end", consequence: "e" },
      ],
    },
    {
      id: "p2",
      stem: "two",
      options: [
        { text: "to t too", consequence: "c", next: "t" },
        { text: "end", consequence: "e" },
      ],
    },
    {
      id: "t",
      stem: "target",
      options: [
        { text: "a", consequence: "end a", correct: true },
        { text: "b", consequence: "end b" },
      ],
    },
  ];
  const { warnings } = buildBranchedScenario({ id: "z" }, cross);
  assert.ok(
    warnings.some((w) => /more than one node/.test(w)),
    "must warn on cross-parent merge",
  );
});

test("a dangling next target is warned, not silently dropped", () => {
  const ns = nodes();
  ns[0].options[0].next = "ghost"; // points at a node that does not exist
  const { warnings } = buildBranchedScenario({ id: "x" }, ns);
  assert.ok(
    warnings.some((w) => /ghost/.test(w) && /not a node/.test(w)),
    "must warn that the choice points at a non-node",
  );
});

test("content is English-only (no fr/ja keys emitted)", () => {
  const { scenario } = buildBranchedScenario({ id: "x", title: "T" }, nodes());
  assert.deepStrictEqual(Object.keys(scenario.name), ["en"]);
  assert.deepStrictEqual(Object.keys(scenario.decisions[0].prompt), ["en"]);
});
