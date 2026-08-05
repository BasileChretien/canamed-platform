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

/* ── An UNRESOLVABLE gate is dropped, not left dangling ──────────────────────
 * This block previously asserted the opposite ("left alone, not silently
 * renamed"), on the reasoning that an edge pointing outside the section is
 * already broken and renaming it would hide that. Leaving it alone hid it just
 * as thoroughly, and cost more: the section split puts a scenario's decisions
 * on separate stages BY MODULE, so an entirely reasonable authored gate ("this
 * Module B decision opens once the team commits that Module A one") becomes an
 * outside-the-section edge. Left raw it matches no vote key, decisionUnlocked()
 * reports it permanently unmet, and the decision is locked for the whole
 * session — invisible outright when `hideWhenLocked` is set. No error anywhere.
 *
 * So the gate is dropped and the decision is available, with a warning. The
 * authoring-time check in scenario-author.js validate() is the real fix; this
 * is the safety net for scenarios already written. */
function captureWarn(fn) {
  const orig = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(a.join(" "));
  try { return { out: fn(), warnings: seen }; } finally { console.warn = orig; }
}

test("a gate pointing OUTSIDE the section is DROPPED, so the decision still opens", () => {
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "only", unlockWhen: { afterDecision: "elsewhere" } }],
    { position: 1, type: "pbl" }));
  assert.equal(r.out[0].unlockWhen, undefined,
    "an unlockWhen holding only the dead gate goes with it — the decision reads as ungated");
  assert.ok(r.warnings.some(w => /elsewhere/.test(w) && /not in this section/.test(w)),
    "dropping it must not be silent — it changes authored meaning");
});

test("the object form { id, option } is dropped too — same dead reference", () => {
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "only", unlockWhen: { afterDecision: { id: "elsewhere", option: 2 } } }],
    { position: 1, type: "pbl" }));
  assert.equal(r.out[0].unlockWhen, undefined);
});

test("dropping the dead gate keeps the COUNT gates declared beside it", () => {
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "only", unlockWhen: { afterDecision: "elsewhere", hypotheses: 2 } }],
    { position: 1, type: "pbl" }));
  assert.equal(r.out[0].unlockWhen.afterDecision, undefined, "only the dead reference goes");
  assert.equal(r.out[0].unlockWhen.hypotheses, 2,
    "a co-declared count gate is still satisfiable — dropping it would ungate more than necessary");
});

test("a RESOLVABLE gate is still rewritten, and never warns", () => {
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "a" }, { id: "b", unlockWhen: { afterDecision: "a" } }],
    { position: 2, type: "pbl" }));
  assert.equal(r.out[1].unlockWhen.afterDecision, "s2_a");
  assert.deepEqual(r.warnings, [], "the working case must stay quiet");
});

/* The lookup map is keyed by AUTHORED ids, so on a plain `{}` every
   Object.prototype name reads as an existing decision. A gate on an ABSENT
   "toString" was therefore rewritten to `s<slot>_toString` — manufacturing
   exactly the permanently-locked decision this function exists to prevent. */
["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"].forEach((name) => {
  test("a gate on the absent inherited name '" + name + "' is dropped, not rewritten", () => {
    const r = captureWarn(() => ctx({}).api.namespaceDecisions(
      [{ id: "only", unlockWhen: { afterDecision: name } }],
      { position: 2, type: "roleplay" }));
    assert.equal(r.out[0].unlockWhen, undefined,
      "no decision named '" + name + "' exists, so the gate must go");
  });
});

test("a decision genuinely NAMED an inherited key still resolves in-section", () => {
  /* The mirror: `own["__proto__"] = true` on a plain object sets the prototype
     instead of adding a key, so this only ever resolved by accident. */
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "__proto__" }, { id: "d2", unlockWhen: { afterDecision: "__proto__" } }],
    { position: 1, type: "pbl" }));
  assert.equal(r.out[1].unlockWhen.afterDecision, "s1___proto__");
  assert.deepEqual(r.warnings, [], "a real in-section gate must not warn");
});

test("the warning never claims the decision is available", () => {
  /* A co-declared count gate can still hold it locked, so saying "available"
     would be false. Report only what was removed. */
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "only", unlockWhen: { afterDecision: "elsewhere", hypotheses: 2 } }],
    { position: 1, type: "pbl" }));
  assert.equal(r.out[0].unlockWhen.hypotheses, 2, "the count gate still locks it");
  assert.ok(r.warnings.length === 1, "one warning");
  assert.ok(!/available/.test(r.warnings[0]),
    "must not claim availability while another gate remains: " + r.warnings[0]);
  assert.match(r.warnings[0], /afterDecision gate has been dropped/);
});

test("a decision published in BOTH sections keeps the gate pointing at it", () => {
  /* section-registry.js byModule() puts a `module: ["A","B"]` decision into
     BOTH sections, so inside the roleplay section the gate's target IS present
     and must be rewritten, not dropped. The drop keys off what this section
     actually carries, which is exactly why it gets this right. */
  const r = captureWarn(() => ctx({}).api.namespaceDecisions(
    [{ id: "shared", module: ["A", "B"] },
     { id: "b_only", module: "B", unlockWhen: { afterDecision: "shared" } }],
    { position: 2, type: "roleplay" }));
  assert.equal(r.out[1].unlockWhen.afterDecision, "s2_shared",
    "the shared decision travels with this section, so the gate still resolves");
  assert.deepEqual(r.warnings, []);
});

test("the cross-module gate the section split broke: B gated on A", () => {
  /* The end-to-end shape of the defect. The scenario's decisions are split by
     module, so the two ids never meet in one section — and the id the gate
     names is not the id slot 1 published. */
  const r = captureWarn(() => {
    const a = ctx({}).api.namespaceDecisions(
      [{ id: "dec_a1" }], { position: 1, type: "pbl" });
    const b = ctx({}).api.namespaceDecisions(
      [{ id: "dec_b1", unlockWhen: { afterDecision: "dec_a1" } }],
      { position: 2, type: "roleplay" });
    return { a, b };
  });
  assert.equal(r.out.a[0].id, "s1_dec_a1");
  assert.equal(r.out.b[0].id, "s2_dec_b1");
  assert.equal(r.out.b[0].unlockWhen, undefined,
    "raw 'dec_a1' matches no published id, so the student would never see this decision");
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

/* ── The fallback must not fire for a session that HAS a pick ────────────────
 * The ambient path below the pick exists for sessions with nothing to resolve —
 * a pre-cutover session, or a branchedRef composition. It used to be entered
 * whenever the pick produced an EMPTY list (`if (out.length) return out;`),
 * which conflates "this session's branched section declares no graph" with
 * "this session has no branched section to read". On a dashboard tab the two
 * have very different consequences: the ambient globals are another case, so
 * the second reading renders that case's tree — including a node marked
 * "deciding now" — for a room that never saw it. Probed live 2026-08-05.
 */
test("a PICK that resolves to an empty graph yields nothing, never the ambient case's", () => {
  const win = {
    /* The picked section is real and typed branched — it simply declares no
       decisions (an authored section saved without a graph, or a registry entry
       whose scenario carried none). */
    CANAMED_SECTIONS: { w: { id: "w", type: "branched", content: { format: "branched", decisions: [] } } },
    /* …and this tab happens to hold ANOTHER case's composed branched nodes,
       which is exactly the dashboard's state for a session whose scenario was
       applied alongside the pick. */
    DECISIONS: [{ id: "br_b_assess", module: "branched" },
                { id: "br_b_escalate", module: "branched" }],
    CURRENT_SCENARIO_FORMAT: "standard"
  };
  const slots = [{ position: 1, stage: 1, type: "branched", standalone: true, sectionId: "w" }];
  assert.deepEqual(runSessionBranched(win, slots), [],
    "the pick is authoritative — an empty graph is an answer, not a missing one");
});

test("…and the same holds when the ambient tab claims the branched FORMAT", () => {
  /* The other fallback branch: format "branched" returns the WHOLE ambient list,
     so this path substituted every decision the tab held — A/B nodes included. */
  const win = {
    CANAMED_SECTIONS: { w: { id: "w", type: "branched", content: { decisions: [] } } },
    DECISIONS: [{ id: "b_assess" }, { id: "dec_plan" }],
    CURRENT_SCENARIO_FORMAT: "branched"
  };
  const slots = [{ position: 1, stage: 1, type: "branched", standalone: true, sectionId: "w" }];
  assert.deepEqual(runSessionBranched(win, slots), []);
});

test("a mixed pick where ONE branched section has a graph keeps just that one", () => {
  /* The regression guard for the two tests above: dropping the fall-through
     must not drop a pick that DOES resolve. */
  const win = {
    CANAMED_SECTIONS: {
      empty: { id: "empty", type: "branched", content: { decisions: [] } },
      w: BRANCHED("w", NODES)
    },
    DECISIONS: [{ id: "br_x", module: "branched" }],
    CURRENT_SCENARIO_FORMAT: "standard"
  };
  const slots = [
    { position: 1, stage: 1, type: "branched", sectionId: "empty" },
    { position: 2, stage: 2, type: "branched", sectionId: "w" }
  ];
  assert.deepEqual(runSessionBranched(win, slots).map(d => d.id),
    ["s2_b_assess", "s2_b_escalate"]);
});
