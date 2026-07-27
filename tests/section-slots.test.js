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
function seam(moduleSetImpl, win) {
  const grab = name => {
    const i = SCRIPT.indexOf("function " + name + "(");
    assert.ok(i >= 0, name + "() must exist in script.js");
    const j = SCRIPT.indexOf("\nfunction ", i + 1);
    return SCRIPT.slice(i, j > 0 ? j : SCRIPT.length);
  };
  const tables = ["SECTION_TYPE_FOR_MODULE", "STAGE_VIEW_FOR_TYPE",
                  "WELCOME_VIEW_ID", "WRAPUP_VIEW_ID", "MAX_SECTION_SLOTS"].map(n => {
    const i = SCRIPT.indexOf("const " + n + " =");
    assert.ok(i >= 0, n + " must exist");
    return SCRIPT.slice(i, SCRIPT.indexOf("\n", i));
  }).join("\n");

  const src = tables + "\n" +
    "const window = arguments[2];\n" +
    "const moduleSet = arguments[0];\n" +
    "const stageForModule = arguments[1];\n" +
    grab("sectionSlots") + "\n" + grab("stageCount") + "\n" + grab("lastStage") + "\n" +
    grab("slotAtStage") + "\n" +
    grab("stageViewId") + "\n" + grab("allStageViewIds") + "\n" +
    "return { sectionSlots, slotAtStage, stageViewId, allStageViewIds, " +
    "stageCount, lastStage };";
  const REG = { A: 1, B: 2, branched: 3 };
  // eslint-disable-next-line no-new-func
  return new Function(src)(moduleSetImpl,
    id => (REG[id] === undefined ? -1 : REG[id]), win || {});
}

const standard = () => seam(() => ["A", "B"]);
const branchedStandalone = () => seam(() => [], { CURRENT_SCENARIO_FORMAT: "branched" });
const mixed = () => seam(() => ["A", "B", "branched"]);

test("a standard session has two slots, at the stages they occupy today", () => {
  const slots = standard().sectionSlots();
  assert.deepEqual(slots.map(s => [s.position, s.stage, s.type]),
    [[1, 1, "pbl"], [2, 2, "roleplay"]]);
});

test("S1b — a slot's stage is its POSITION, so pick order decides the running order", () => {
  /* The behaviour flip: before S1b a roleplay always ran on stage 2 because
     Module B was pinned there, and a B-only session left stage 1 empty. */
  const rpFirst = seam(() => ["B", "A"]);
  assert.deepEqual(rpFirst.sectionSlots().map(s => [s.stage, s.type]),
    [[1, "roleplay"], [2, "pbl"]],
    "a roleplay picked first runs on stage 1");
  assert.equal(rpFirst.stageViewId(1), "stage-2", "…showing the roleplay view there");
  assert.equal(rpFirst.stageViewId(2), "stage-1", "…and the PBL view second");
});

test("S1b — the session is Welcome + N sections + Wrap-up, contiguously", () => {
  assert.equal(standard().stageCount(), 4);
  assert.equal(standard().lastStage(), 3);
  assert.equal(mixed().lastStage(), 4);
  assert.equal(seam(() => ["A"]).lastStage(), 2, "a 1-section session ends at stage 2");
});

test("S1b — the wrap-up KEEPS its DOM id whatever number it sits at", () => {
  /* The trap this guards: the wrap-up markup is #stage-4, but in a 2-section
     session the wrap-up is stage 3. Resolving "stage-" + n would show the
     branched view as the wrap-up. */
  assert.equal(standard().stageViewId(3), "stage-4");
  assert.equal(seam(() => ["A"]).stageViewId(2), "stage-4");
});

test("S1b — no more slots than the physical cap the DB rules accept", () => {
  const many = seam(() => ["A", "B", "branched", "A", "B", "A", "B", "A", "B", "A"]);
  assert.equal(many.sectionSlots().length, 8, "capped at MAX_SECTION_SLOTS");
  assert.equal(many.lastStage(), 9, "so the largest stage index stays bounded");
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
  /* Its content is the node graph, not a module, so moduleSet() is empty. S1b
     gives it a SYNTHETIC slot instead of relying on the like-numbered fallback,
     because the flow now has to know the session has exactly one section. It
     must still borrow the PBL view: the branched engine's standalone render
     targets (#decisions-A, #branched-final-host) live there. A regression here
     blanks the whole session. */
  const b = branchedStandalone();
  assert.equal(b.stageViewId(1), "stage-1");
  assert.equal(b.slotAtStage(1).type, "branched");
  assert.equal(b.slotAtStage(1).standalone, true);
  assert.equal(b.lastStage(), 2, "Welcome + the case + Wrap-up");
});

test("a B-only session puts the roleplay view on the stage it runs", () => {
  const s = seam(() => ["B"]);
  /* S1b: its one section runs at position 1 — before the phase it sat at
     stage 2 with stage 1 skipped. */
  assert.deepEqual(s.sectionSlots().map(x => [x.position, x.stage]), [[1, 1]]);
  assert.equal(s.stageViewId(1), "stage-2", "stage 1 shows the ROLEPLAY view");
  assert.equal(s.stageViewId(2), "stage-4", "and stage 2 is the wrap-up");
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
