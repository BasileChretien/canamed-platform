/* tests/section-split-on-load.test.js
 *
 * S5 / decision 14 — a facilitator's existing whole-scenario cloud saves are
 * AUTO-SPLIT on load into the PBL + Roleplay pair, rather than keeping a second
 * shape alive in the library forever.
 *
 * The split must mirror section-registry.js's buildSection() exactly: a section
 * authored here has to behave identically to the same section derived at
 * runtime. Divergence would be invisible until a session ran.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");

function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  new Function("window", "document", JS)(win, doc);
  return win.__scenarioAuthor;
}
const split = (json) => loadAuthor().splitScenario(json);

const T = (en) => ({ en, fr: "", ja: "" });
const WHOLE = {
  id: "my-workshop",
  name: T("My workshop"),
  summary: T("Both halves."),
  moduleAName: T("The workup"),
  moduleBName: T("The conversation"),
  case: { history: [{ q: T("q"), a: T("a") }], exam: [], labs: [], prompts: [T("p")] },
  synthId: "labs:0",
  synthPrereqs: ["history:0"],
  characters: [
    { id: "patient", module: ["A"], persona: T("You are the patient.") },
    { id: "relative", module: ["B"], persona: T("You are the relative.") }
  ],
  scoring: { moduleA: [{ id: "a1" }], moduleB: [{ id: "b1" }] },
  penalties: [{ id: "p1", item: "history:0" }],
  decisions: [{ id: "dA", module: "A" }, { id: "dB", module: "B" }],
  preTest: [{ id: "q1" }],
  postTest: [{ id: "q1" }]
};

test("a two-module scenario splits into a PBL and a Roleplay section", () => {
  const parts = split(WHOLE);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].modules, ["A"]);
  assert.deepEqual(parts[1].modules, ["B"]);
});

test("the workup, penalties and synthesis gate go to the PBL half only", () => {
  const [pbl, rp] = split(WHOLE);
  assert.ok(pbl.case && pbl.penalties.length && pbl.synthId);
  assert.equal(rp.case, undefined, "a roleplay has no workup board");
  assert.equal(rp.penalties, undefined);
  assert.equal(rp.synthId, undefined);
});

test("scoring, decisions and characters are filtered by module", () => {
  const [pbl, rp] = split(WHOLE);
  assert.deepEqual(pbl.scoring, { moduleA: [{ id: "a1" }] });
  assert.deepEqual(rp.scoring, { moduleB: [{ id: "b1" }] });
  assert.deepEqual(pbl.decisions.map(d => d.id), ["dA"]);
  assert.deepEqual(rp.decisions.map(d => d.id), ["dB"]);
  assert.deepEqual(pbl.characters.map(c => c.id), ["patient"]);
  assert.deepEqual(rp.characters.map(c => c.id), ["relative"],
    "the roleplay's own characters must travel with it");
});

/* A decision declaring BOTH modules belongs to both sections — byModule() puts
   it in each half, exactly as section-registry.js does at runtime. It reaches
   the form with its set intact (the form used to keep only the first id, which
   deleted the decision from the roleplay half on the next export), so what each
   half must carry is the ARRAY, not a per-half rewrite. */
test("a decision declared in both modules travels with BOTH halves", () => {
  const [pbl, rp] = split(Object.assign({}, WHOLE, {
    decisions: [{ id: "dA", module: "A" }, { id: "shared", module: ["A", "B"] }]
  }));
  assert.deepEqual(pbl.decisions.map(d => d.id), ["dA", "shared"]);
  assert.deepEqual(rp.decisions.map(d => d.id), ["shared"],
    "the roleplay half is where a collapsed module set would delete it");
  assert.deepEqual(rp.decisions[0].module, ["A", "B"],
    "…and its module set must survive the split unchanged");
});

test("each half gets its OWN id, so saving cannot overwrite the original", () => {
  const [pbl, rp] = split(WHOLE);
  assert.equal(pbl.id, "my-workshop-pbl");
  assert.equal(rp.id, "my-workshop-roleplay");
  assert.notEqual(pbl.id, WHOLE.id);
});

test("each half is named by its own module name, not the workshop's", () => {
  const [pbl, rp] = split(WHOLE);
  assert.equal(pbl.name.en, "The workup");
  assert.equal(rp.name.en, "The conversation");
});

test("a single-module scenario is returned UNCHANGED, as one section", () => {
  const aOnly = Object.assign({}, WHOLE, { modules: ["A"], moduleBName: undefined });
  const parts = split(aOnly);
  assert.equal(parts.length, 1);
  assert.strictEqual(parts[0], aOnly, "no needless rewriting of an already-section");
});

test("a BRANCHED scenario is never split — its content is a node graph", () => {
  const br = { id: "b", format: "branched", decisions: [{ id: "n1" }] };
  assert.deepEqual(split(br), [br]);
});

test("the split never mutates the scenario it was given", () => {
  const before = JSON.stringify(WHOLE);
  split(WHOLE);
  assert.equal(JSON.stringify(WHOLE), before);
});

test("splitting is driven name-first, matching the runtime's precedence", () => {
  /* A scenario with no `modules` key but both names is still two sections —
     that is how every pre-section save looks. */
  const noModules = Object.assign({}, WHOLE);
  delete noModules.modules;
  assert.equal(split(noModules).length, 2);
  /* And one with only a scoring family, no names at all, still resolves. */
  const scoringOnly = { id: "s", scoring: { moduleA: [{ id: "a" }], moduleB: [{ id: "b" }] } };
  assert.equal(split(scoringOnly).length, 2);
});

test("both halves carry the tests, since a v1 scenario had only one set", () => {
  /* Decision 3 gives each section its own items, but a legacy save has one
     shared set — duplicating it is the honest conversion, and the author can
     then delete what does not belong. */
  const [pbl, rp] = split(WHOLE);
  assert.ok(pbl.preTest.length && rp.preTest.length);
  assert.ok(pbl.postTest.length && rp.postTest.length);
});

test("load routes a two-module save through the split picker", () => {
  const i = JS.indexOf("function applyScenarioJson(json, msg)");
  const fn = JS.slice(i, JS.indexOf("\n  function applySectionJson", i));
  assert.match(fn, /splitScenarioIntoSections\(json\)/);
  assert.match(fn, /if \(parts\.length > 1\) \{ openSectionSplitPicker/,
    "opening a whole workshop would present two sections' fields as one");
});
