"use strict";
/* tests/mixed-branched-stage-flow.test.js
 *
 * A MIXED session (sections: PBL + branched) must keep the section flow.
 *
 * stageFlow()/snapStageToFlow()/adjacentStage() delegate to the LAZY
 * branched-render.js as soon as that chunk is loaded. branched-render derives
 * the flow from CURRENT_SCENARIO_FORMAT / CANAMED_MODULE_STAGES — neither knows
 * about picked sections — so in a section-picked session it spoke for a flow it
 * could not see and returned its own [0, 1, LAST].
 *
 * Live symptom (2026-08-12, a 2-section session): the stepper read "Stage 1 of
 * 4" and "Stage 2 of 4", then "Stage 3 of 3" the instant the branched chunk
 * loaded for the branched SECTION — and the room's real stage (2) was not even
 * a member of the returned flow, so the wrap-up rendered as "Stage 3 of 3" too.
 * The session still completed, so nothing failed loudly.
 *
 * The fix gates the delegation on there being no explicit section pick. With no
 * pick (legacy scenarios and STANDALONE branched cases) the branched engine
 * still owns the flow — pinned below so the fix cannot regress that path.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SCRIPT = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "script.js"), "utf8");

/* Same slicing approach as module-set.test.js, extended past adjacentStage()
   so all three flow wrappers are in scope. */
function loadFlow(win) {
  const start = SCRIPT.indexOf("const MAX_SECTION_SLOTS");
  assert.notStrictEqual(start, -1, "MAX_SECTION_SLOTS must exist");
  const end = SCRIPT.indexOf("\nfunction tFallback(", start);
  assert.notStrictEqual(end, -1, "the flow block must sit above tFallback()");
  const factory = new Function("window", SCRIPT.slice(start, end) +
    "\nreturn { stageFlow, standardStageFlow, snapStageToFlow, adjacentStage," +
    "\n         sectionSlots, stageCount, lastStage, pickedSections, _branchedFlowOwner };");
  return factory(win);
}

/* A branched renderer that reports the STANDALONE branched flow, exactly as the
   real one does when CURRENT_SCENARIO_FORMAT === "branched". */
const BRANCHED_STUB = {
  stageFlow: () => [0, 1, 3],
  snapStageToFlow: () => 3,
  adjacentStage: () => 3
};

const SECTIONS = {
  "s-pbl": { id: "s-pbl", type: "pbl" },
  "s-branched": { id: "s-branched", type: "branched" }
};

function mixedWindow() {
  return {
    CANAMED_SESSION_SECTIONS: ["s-pbl", "s-branched"],
    CANAMED_SECTIONS: SECTIONS,
    CanamedBranchedRender: BRANCHED_STUB
  };
}

test("mixed PBL+branched session: 4 stages, and the pick wins over branched-render", () => {
  const f = loadFlow(mixedWindow());
  assert.strictEqual(f.stageCount(), 4, "Welcome + 2 sections + Wrap-up");
  assert.deepStrictEqual(f.stageFlow(), [0, 1, 2, 3],
    "the section pick is authoritative — branched-render must not collapse it to [0,1,3]");
  assert.deepStrictEqual(f.stageFlow(), f.standardStageFlow(),
    "a picked session must resolve through the standard (section) flow");
});

test("every stage the room can reach is a MEMBER of the flow", () => {
  /* The actual defect: the room sat on stage 2 while the flow was [0,1,3], so
     the stepper fell back to the last segment and printed "3 of 3" for both the
     branched section AND the wrap-up. */
  const f = loadFlow(mixedWindow());
  const flow = f.stageFlow();
  for (let s = 0; s <= f.lastStage(); s++) {
    assert.ok(flow.includes(s), `stage ${s} must be in the flow ${JSON.stringify(flow)}`);
  }
  assert.strictEqual(new Set(flow).size, flow.length, "no duplicate stages");
});

test("mixed session: navigation agrees with the stepper", () => {
  /* If nav kept delegating while the stepper did not, Advance would jump the
     branched section entirely — the disagreement standardStageFlow warns about. */
  const f = loadFlow(mixedWindow());
  assert.strictEqual(f.adjacentStage(1, 1), 2, "stage 1 → 2, not straight to wrap-up");
  assert.strictEqual(f.adjacentStage(2, 1), 3);
  assert.strictEqual(f.adjacentStage(2, -1), 1);
  assert.strictEqual(f.adjacentStage(3, 1), 3, "wrap-up is terminal");
  assert.strictEqual(f.adjacentStage(0, -1), 0, "welcome is the floor");
  assert.strictEqual(f.snapStageToFlow(2, 1), 2, "a real stage snaps to itself");
});

test("STANDALONE branched (no section pick) still delegates to branched-render", () => {
  // The behaviour the gate must NOT change.
  const win = { CanamedBranchedRender: BRANCHED_STUB };
  const f = loadFlow(win);
  assert.strictEqual(f.pickedSections(), null, "no pick in this session");
  assert.deepStrictEqual(f.stageFlow(), [0, 1, 3], "branched engine still owns the flow");
  assert.strictEqual(f.adjacentStage(1, 1), 3, "and still owns navigation");
});

test("a LONE branched pick is a section pick, so the section flow applies", () => {
  /* sectionSlots() already treats a single branched pick as standalone (it
     routes to the stage-1 view so the case keeps its deliverable). The flow must
     still come from the pick, and stays 3 stages here — the same LENGTH as the
     branched engine's, which is why this case never looked broken. */
  const f = loadFlow({
    CANAMED_SESSION_SECTIONS: ["s-branched"],
    CANAMED_SECTIONS: SECTIONS,
    CanamedBranchedRender: BRANCHED_STUB
  });
  assert.strictEqual(f.stageCount(), 3);
  assert.deepStrictEqual(f.stageFlow(), [0, 1, 2]);
  assert.strictEqual(f.sectionSlots()[0].standalone, true,
    "a lone branched pick keeps the standalone view routing");
});

test("no branched chunk loaded: the standard flow, unchanged", () => {
  const f = loadFlow({ CANAMED_SESSION_SECTIONS: ["s-pbl", "s-branched"], CANAMED_SECTIONS: SECTIONS });
  assert.strictEqual(f._branchedFlowOwner(), null);
  assert.deepStrictEqual(f.stageFlow(), [0, 1, 2, 3]);
});
