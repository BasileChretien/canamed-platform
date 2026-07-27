/* tests/section-slots.test.js
 *
 * S1a of the section model: a stage is a POSITION and the stage DOM is a
 * per-TYPE view the active slot borrows — not one hand-authored node per stage
 * number. Because exactly one stage is visible at a time, N sections need no
 * DOM cloning; that is what removes the "static DOM" blocker the design doc
 * called the biggest cost.
 *
 * S1a is a SEAM: every assertion below must describe TODAY's behaviour. The
 * tests that pin "identical to before" are the point — S1b flips slots to
 * positional and these are what will catch an accidental early behaviour
 * change.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");

/* Evaluate the seam in isolation: pull the four functions plus their two lookup
   tables out of script.js and run them against a stubbed moduleSet(). Loading
   all 14k lines would need the whole Firebase/DOM world. */
function seam(moduleSetImpl, stageCount) {
  const grab = name => {
    const i = SCRIPT.indexOf("function " + name + "(");
    assert.ok(i >= 0, name + "() must exist in script.js");
    const j = SCRIPT.indexOf("\nfunction ", i + 1);
    return SCRIPT.slice(i, j > 0 ? j : SCRIPT.length);
  };
  const tables = ["SECTION_TYPE_FOR_MODULE", "STAGE_VIEW_FOR_TYPE"].map(n => {
    const i = SCRIPT.indexOf("const " + n + " =");
    assert.ok(i >= 0, n + " must exist");
    return SCRIPT.slice(i, SCRIPT.indexOf("\n", i));
  }).join("\n");

  const src = tables + "\n" +
    "const STAGE_COUNT = " + stageCount + ";\n" +
    "const moduleSet = arguments[0];\n" +
    "const stageForModule = arguments[1];\n" +
    grab("sectionSlots") + "\n" + grab("slotAtStage") + "\n" +
    grab("stageViewId") + "\n" + grab("allStageViewIds") + "\n" +
    "return { sectionSlots, slotAtStage, stageViewId, allStageViewIds };";
  const REG = { A: 1, B: 2, branched: 3 };
  // eslint-disable-next-line no-new-func
  return new Function(src)(moduleSetImpl, id => (REG[id] === undefined ? -1 : REG[id]));
}

const standard = () => seam(() => ["A", "B"], 5);
const branchedStandalone = () => seam(() => [], 5);
const mixed = () => seam(() => ["A", "B", "branched"], 5);

test("a standard session has two slots, at the stages they occupy today", () => {
  const slots = standard().sectionSlots();
  assert.deepEqual(slots.map(s => [s.position, s.stage, s.type]),
    [[1, 1, "pbl"], [2, 2, "roleplay"]]);
});

test("each section type resolves to its own view node", () => {
  const s = mixed();
  assert.equal(s.stageViewId(1), "stage-1");   // PBL view
  assert.equal(s.stageViewId(2), "stage-2");   // roleplay view
  assert.equal(s.stageViewId(3), "stage-3");   // branched view
});

test("welcome and wrap-up resolve to the fixed ends", () => {
  const s = standard();
  assert.equal(s.stageViewId(0), "stage-0");
  assert.equal(s.stageViewId(4), "stage-4");
});

test("a standalone branched session still resolves stage 1 (empty moduleSet)", () => {
  /* Its content is the node graph, not a module, so no slot maps to stage 1 —
     the like-numbered fallback is what keeps the épuré branched view on screen.
     A regression here blanks the whole session. */
  assert.equal(branchedStandalone().stageViewId(1), "stage-1");
  assert.equal(branchedStandalone().slotAtStage(1), null);
});

test("a B-only session puts the roleplay view on the stage it runs", () => {
  const s = seam(() => ["B"], 5);
  assert.deepEqual(s.sectionSlots().map(x => [x.position, x.stage]), [[1, 2]]);
  assert.equal(s.stageViewId(2), "stage-2");
  /* S1a is a seam: stage 1 is NOT in a B-only flow (stageFlow gives [0,2,4]),
     so its resolution is unused — but it must not throw or steal the view. */
  assert.equal(s.stageViewId(1), "stage-1");
});

test("every view is hidden before one is shown — including unused types", () => {
  const ids = standard().allStageViewIds();
  ["stage-0", "stage-1", "stage-2", "stage-3", "stage-4"].forEach(id => {
    assert.ok(ids.indexOf(id) !== -1, id + " must be in the hide list");
  });
  assert.equal(new Set(ids).size, ids.length, "no duplicate toggles");
});

test("renderStage() drives the views through the resolver, not stage numbers", () => {
  const i = SCRIPT.indexOf("function renderStage()");
  const body = SCRIPT.slice(i, i + 700);
  assert.ok(body.indexOf("allStageViewIds()") !== -1 &&
            body.indexOf("stageViewId(viewStage)") !== -1,
    "renderStage must resolve the active view");
  assert.ok(body.indexOf('el("stage-" + i)') === -1,
    "the old index-keyed loop must be gone — it is what pins the DOM to stage " +
    "numbers and blocks reordering");
});

test("the three view nodes exist in the shell", () => {
  ["stage-0", "stage-1", "stage-2", "stage-3", "stage-4"].forEach(id => {
    assert.ok(HTML.indexOf('id="' + id + '"') !== -1, id + " must exist");
  });
});

test("the shell version is bumped in lockstep (script.js changed)", () => {
  const sw = fs.readFileSync(path.join(P, "sw.js"), "utf8");
  const loader = fs.readFileSync(path.join(P, "script-loader.js"), "utf8");
  const v = (sw.match(/canamed-shell-(v\d+)/) || [])[1];
  assert.ok(v, "sw.js must carry a shell version");
  assert.ok(loader.indexOf('SHELL_VERSION = "' + v + '"') !== -1,
    "script-loader.js must agree with sw.js");
  assert.ok(HTML.indexOf("?v=" + v) !== -1, "index.html must agree too");
});
