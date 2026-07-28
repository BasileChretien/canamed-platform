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
