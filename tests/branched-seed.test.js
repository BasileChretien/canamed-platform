/* tests/branched-seed.test.js
 *
 * The first built-in branched scenario ("ward-escalation-branched") must be a
 * sound graph by the validator's rules, English-canonical, scored, and shaped
 * the way the engine + stage flow expect. Locks the seed so a content edit
 * can't silently ship a broken tree.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SEED = require(path.join(P, "branched-seed.js"));
const { validateBranchedGraph } = require(path.join(P, "branched-validate.js"));

test("the seed scenario passes the graph validator with no errors", () => {
  const r = validateBranchedGraph(SEED);
  assert.strictEqual(r.ok, true, "errors: " + JSON.stringify(r.errors));
  assert.strictEqual(r.errors.length, 0);
});

test("the seed declares the branched format and an entry node", () => {
  assert.strictEqual(SEED.format, "branched");
  assert.ok(Array.isArray(SEED.decisions) && SEED.decisions.length >= 3);
  const entries = SEED.decisions.filter((d) => !d.unlockWhen);
  assert.strictEqual(entries.length, 1, "exactly one entry node");
  assert.strictEqual(entries[0].id, "b_assess");
});

test("the whole tree is single-stage (every node module A → stage-1)", () => {
  // A pure decision flow has no use for Module B's roleplay phase/role
  // machinery, so the branch runs entirely in stage-1's decision column.
  const mods = new Set(SEED.decisions.map((d) => d.module));
  assert.deepStrictEqual(
    [...mods],
    ["A"],
    "every node renders in #decisions-A",
  );
});

test("every node is scored: points, penalty, and exactly one correct option", () => {
  SEED.decisions.forEach((d) => {
    assert.ok(
      typeof d.points === "number" && d.points > 0,
      d.id + " has points",
    );
    assert.ok(
      typeof d.penalty === "number" && d.penalty > 0,
      d.id + " has penalty",
    );
    const correct = d.options.filter((o) => o.correct);
    assert.strictEqual(
      correct.length,
      1,
      d.id + " has exactly one correct option",
    );
  });
});

test("the seed is English-canonical: no fr/ja keys leak into content", () => {
  // Walk the localisable fields; each must be { en } only (the hovering reader
  // supplies fr/ja at read-time, so authored content stays English-only).
  const enOnly = (field, where) => {
    assert.ok(field && typeof field.en === "string", where + " has en");
    assert.deepStrictEqual(
      Object.keys(field).sort(),
      ["en"],
      where + " is en-only",
    );
  };
  enOnly(SEED.name, "name");
  enOnly(SEED.summary, "summary");
  SEED.decisions.forEach((d) => {
    enOnly(d.prompt, d.id + ".prompt");
    d.options.forEach((o, i) => {
      enOnly(o.text, d.id + ".opt" + i + ".text");
      if (o.branch && o.branch.reveal)
        enOnly(o.branch.reveal, d.id + ".opt" + i + ".reveal");
      if (o.why) enOnly(o.why, d.id + ".opt" + i + ".why");
    });
  });
});

test("the consequence trail and endings resolve through the runtime", () => {
  const { branchedPath } = require(path.join(P, "branched-runtime.js"));
  // The 'good' path: correct option at each node, reaching an Act-II ending.
  const r = branchedPath(SEED.decisions, {
    b_assess: 0,
    b_escalate: 0,
    b_family: 1,
  });
  assert.strictEqual(r.done, true);
  assert.deepStrictEqual(
    r.trail.map((t) => t.id),
    ["b_assess", "b_escalate", "b_family"],
  );
  assert.match(r.trail[2].reveal.en, /straight with me/);
});
