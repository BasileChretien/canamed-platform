/* tests/section-content-apply.test.js
 *
 * S3c: the ACTIVE SLOT supplies the content.
 *
 * With sections picked from different clinical cases, "the case" stops being a
 * property of the session and becomes a property of the SLOT. The globals the
 * render code reads (CASE, SCORING, PENALTIES, DECISIONS, the synthesis gate,
 * the characters) are re-pointed as the student moves between stages — the same
 * pointer pattern as the per-slot state and the write refs.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function load() {
  const start = SCRIPT.indexOf("let _appliedSectionId = null;");
  assert.ok(start > -1, "applySectionContent must exist");
  const end = SCRIPT.indexOf("\n/* Deep-copy a section's decisions", start);
  const decStart = SCRIPT.indexOf("function sectionDecisionPrefix");
  const decEnd = SCRIPT.indexOf("\n}", SCRIPT.indexOf("function namespaceDecisions")) + 2;
  const src = SCRIPT.slice(start, end) + "\n" + SCRIPT.slice(decStart, decEnd) +
    "\nreturn { applySectionContent, namespaceDecisions, sectionDecisionPrefix," +
    "\n         reset: () => { _appliedSectionId = null; } };";
  // eslint-disable-next-line no-new-func
  return new Function("window", "rebuildCaseDerived", "SYNTH_ID", "SYNTH_PREREQS", src);
}

function ctx(sections) {
  const win = { CANAMED_SECTIONS: sections };
  let rebuilt = 0;
  const api = load()(win, () => { rebuilt++; }, "", []);
  return { win, api, rebuilt: () => rebuilt };
}

const PBL = (id, dec) => ({
  id, type: "pbl",
  content: { case: { history: [{ q: id }] }, penalties: [{ item: "history:0" }],
             scoring: [{ id: "fam-" + id }], synthId: "labs:0",
             synthPrereqs: ["history:0"], decisions: dec || [] }
});

test("no pick ⇒ the globals are left exactly as applyScenario set them", () => {
  const c = ctx({});
  c.win.CASE = { sentinel: true };
  c.api.applySectionContent(null);
  c.api.applySectionContent({ position: 1, type: "pbl" });   // no sectionId
  assert.deepEqual(c.win.CASE, { sentinel: true },
    "a single-scenario session must keep today's behaviour");
});

test("the active slot's case, penalties and synthesis gate are published", () => {
  const c = ctx({ a: PBL("a") });
  c.api.applySectionContent({ position: 1, type: "pbl", sectionId: "a" });
  assert.deepEqual(c.win.CASE, { history: [{ q: "a" }] });
  assert.equal(c.win.PENALTIES.length, 1);
  assert.deepEqual(c.win.SYNTH_PREREQS, ["history:0"]);
});

test("scoring lands under the module key the engine looks up", () => {
  const c = ctx({ a: PBL("a"), r: { id: "r", type: "roleplay",
    content: { scoring: [{ id: "fam-r" }], decisions: [] } } });
  c.api.applySectionContent({ position: 1, type: "pbl", sectionId: "a" });
  assert.equal(c.win.SCORING.moduleA[0].id, "fam-a");
  c.api.applySectionContent({ position: 2, type: "roleplay", sectionId: "r" });
  assert.equal(c.win.SCORING.moduleB[0].id, "fam-r");
});

test("a roleplay slot does NOT blank the PBL slot's board", () => {
  /* Walking from a PBL section into a roleplay and back must not strip the
     case: a roleplay section simply carries none. */
  const c = ctx({ a: PBL("a"), r: { id: "r", type: "roleplay", content: { decisions: [] } } });
  c.api.applySectionContent({ position: 1, type: "pbl", sectionId: "a" });
  c.api.applySectionContent({ position: 2, type: "roleplay", sectionId: "r" });
  assert.deepEqual(c.win.CASE, { history: [{ q: "a" }] }, "the case must survive");
  assert.ok(c.win.PENALTIES.length === 1, "and its penalties");
});

test("re-applying the same section is a no-op — rebuildCaseDerived is not cheap", () => {
  const c = ctx({ a: PBL("a") });
  const slot = { position: 1, type: "pbl", sectionId: "a" };
  c.api.applySectionContent(slot);
  const after = c.rebuilt();
  c.api.applySectionContent(slot);
  c.api.applySectionContent(slot);
  assert.equal(c.rebuilt(), after,
    "re-running it mid-stage rebuilds ITEM_IDS under a half-rendered board");
});

/* ── vote-id namespacing ──────────────────────────────────────────────────── */

test("decision ids are namespaced per slot — two PBL sections must not share a tally", () => {
  /* Both built-in workups carry a `dec_plan`; unnamespaced they would collide
     on votes/$voteId, so a vote cast in section 1 would appear pre-cast in
     section 3. */
  const dec = [{ id: "dec_plan", options: [] }];
  const c = ctx({ a: PBL("a", dec), b: PBL("b", dec) });
  c.api.applySectionContent({ position: 1, type: "pbl", sectionId: "a" });
  const first = c.win.DECISIONS[0].id;
  c.api.applySectionContent({ position: 3, type: "pbl", sectionId: "b" });
  const second = c.win.DECISIONS[0].id;
  assert.equal(first, "s1_dec_plan");
  assert.equal(second, "s3_dec_plan");
  assert.notEqual(first, second, "the whole point");
});

test("graph edges are rewritten in lockstep, or the unlock silently breaks", () => {
  const dec = [
    { id: "first", options: [] },
    { id: "second", unlockWhen: { afterDecision: "first" } },
    { id: "third", unlockWhen: { afterDecision: { id: "first", option: 2 } } }
  ];
  const out = ctx({}).api.namespaceDecisions(dec, { position: 2, type: "pbl" });
  assert.deepEqual(out.map(d => d.id), ["s2_first", "s2_second", "s2_third"]);
  assert.equal(out[1].unlockWhen.afterDecision, "s2_first");
  assert.equal(out[2].unlockWhen.afterDecision.id, "s2_first");
  assert.equal(out[2].unlockWhen.afterDecision.option, 2, "the option must survive");
});

test("an edge pointing OUTSIDE the section is left alone, not silently renamed", () => {
  const out = ctx({}).api.namespaceDecisions(
    [{ id: "only", unlockWhen: { afterDecision: "elsewhere" } }],
    { position: 1, type: "pbl" });
  assert.equal(out[0].unlockWhen.afterDecision, "elsewhere",
    "it is already broken — renaming it would hide that");
});

test("namespacing is pure: the library entry is never mutated", () => {
  const dec = [{ id: "dec_plan", options: [] }];
  const c = ctx({ a: PBL("a", dec) });
  c.api.applySectionContent({ position: 1, type: "pbl", sectionId: "a" });
  assert.equal(dec[0].id, "dec_plan",
    "switching back to a slot must re-derive the same graph, not a doubly-prefixed one");
});

test("each slot's decisions are tagged with the module its stage renders into", () => {
  const out = ctx({}).api.namespaceDecisions([{ id: "x" }], { position: 1, type: "roleplay" });
  assert.equal(out[0].module, "B");
});

/* ── The ADMIN side of the same problem ──────────────────────────────────────
 * applySectionContent() is driven by refreshActiveSlotState(), a STAGE-CHANGE
 * path — so it runs for a student walking into a slot and never for the
 * facilitator dashboard, which does not enter a room. Anything on the admin
 * side that needs the session's content therefore cannot read the globals: on
 * that tab they still describe whatever scenario loaded by default. That is
 * what left the per-room choice tree blank for a section-picked branched
 * session, with DECISIONS holding the default case's nodes and
 * CURRENT_SCENARIO_FORMAT reading "standard".
 */
function loadSessionBranched() {
  const start = SCRIPT.indexOf("function sessionBranchedDecisions()");
  assert.ok(start > -1, "sessionBranchedDecisions must exist");
  const end = SCRIPT.indexOf("\n}", start) + 2;
  const decStart = SCRIPT.indexOf("function sectionDecisionPrefix");
  const decEnd = SCRIPT.indexOf("\n}", SCRIPT.indexOf("function namespaceDecisions")) + 2;
  const src = SCRIPT.slice(start, end) + "\n" + SCRIPT.slice(decStart, decEnd) +
    "\nreturn sessionBranchedDecisions;";
  // eslint-disable-next-line no-new-func
  return new Function("window", "sectionSlots", "SECTION_MODULE_FOR_TYPE", src);
}
/* Build it against a fake window + slot list and CALL it — the loader hands back
   the function, mirroring load()/ctx() above. */
function runSessionBranched(win, slots) {
  return loadSessionBranched()(win, () => slots, MODMAP)();
}
const BRANCHED = (id, dec) => ({ id, type: "branched", content: { format: "branched", decisions: dec } });
const NODES = [
  { id: "b_assess", options: [{ correct: true }] },
  { id: "b_escalate", unlockWhen: { afterDecision: "b_assess" } }
];
const MODMAP = { pbl: "A", roleplay: "B", branched: "branched" };

test("the admin resolves the branched graph from the PICK, not from DECISIONS", () => {
  /* The globals here are deliberately the WRONG session — exactly the state the
     dashboard tab is in: a default scenario applied, no section content ever
     published, format still "standard". */
  const win = {
    CANAMED_SECTIONS: { "ward-escalation-branched": BRANCHED("ward-escalation-branched", NODES) },
    DECISIONS: [{ id: "dec_plan" }, { id: "dec_other" }],
    CURRENT_SCENARIO_FORMAT: "standard"
  };
  const slots = [{ position: 1, stage: 1, type: "branched", standalone: true,
                   sectionId: "ward-escalation-branched" }];
  const out = runSessionBranched(win, slots);
  assert.deepEqual(out.map(d => d.id), ["b_assess", "b_escalate"],
    "the picked section's nodes, NOT the default scenario's decisions");
});

test("a STANDALONE branched pick keeps RAW ids — the ones the room voted under", () => {
  /* The vote keys are the decision ids. Namespacing the admin's copy would
     produce a graph that looks right and matches nothing in rooms/<r>/votes. */
  const win = {
    CANAMED_SECTIONS: { w: BRANCHED("w", NODES) },
    DECISIONS: [], CURRENT_SCENARIO_FORMAT: "standard"
  };
  const slots = [{ position: 1, stage: 1, type: "branched", standalone: true, sectionId: "w" }];
  const out = runSessionBranched(win, slots);
  assert.deepEqual(out.map(d => d.id), ["b_assess", "b_escalate"]);
  assert.equal(out[1].unlockWhen.afterDecision, "b_assess", "edges stay raw in lockstep");
});

test("a MIXED pick namespaces them, matching what that session's room wrote", () => {
  const win = {
    CANAMED_SECTIONS: { a: PBL("a"), w: BRANCHED("w", NODES) },
    DECISIONS: [], CURRENT_SCENARIO_FORMAT: "standard"
  };
  const slots = [
    { position: 1, stage: 1, type: "pbl", sectionId: "a" },
    { position: 2, stage: 2, type: "branched", sectionId: "w" }
  ];
  const out = runSessionBranched(win, slots);
  assert.deepEqual(out.map(d => d.id), ["s2_b_assess", "s2_b_escalate"],
    "prefixed by slot, and ONLY the branched slot's nodes");
  assert.equal(out[1].unlockWhen.afterDecision, "s2_b_assess");
});

test("a session with no branched section yields nothing — no tree is drawn", () => {
  const win = {
    CANAMED_SECTIONS: { a: PBL("a", [{ id: "dec_plan" }]) },
    DECISIONS: [{ id: "dec_plan" }], CURRENT_SCENARIO_FORMAT: "standard"
  };
  const slots = [{ position: 1, stage: 1, type: "pbl", sectionId: "a" }];
  assert.deepEqual(runSessionBranched(win, slots), []);
});

test("a PRE-CUTOVER session still resolves — it has no pick to read", () => {
  /* A session created before the section model has no sectionId anywhere, so
     the ambient globals ARE the session. Dropping that fallback would blank the
     choice tree for every branched session already in flight. */
  const win = {
    CANAMED_SECTIONS: null,
    DECISIONS: [{ id: "b_assess" }, { id: "b_escalate" }],
    CURRENT_SCENARIO_FORMAT: "branched"
  };
  const slots = [{ position: 1, stage: 1, type: "branched", standalone: true }];  // no sectionId
  assert.deepEqual(runSessionBranched(win, slots).map(d => d.id),
    ["b_assess", "b_escalate"]);
});

test("a branchedRef-COMPOSED session takes only its branched-tagged nodes", () => {
  const win = {
    CANAMED_SECTIONS: null,
    DECISIONS: [{ id: "dec_plan", module: "A" }, { id: "br_b_assess", module: "branched" }],
    CURRENT_SCENARIO_FORMAT: "standard"
  };
  assert.deepEqual(runSessionBranched(win, null).map(d => d.id),
    ["br_b_assess"], "the outer A/B decisions are not part of the tree");
});
