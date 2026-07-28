/* tests/module-set.test.js
 *
 * Phase M0 of the module-set work (ARCHITECTURE/module-set-design.md).
 *
 * Two things are pinned here:
 *
 * 1. THE SEAM. Every place that used to hardcode "stage 1 is Module A, stage 2
 *    is Module B" now resolves through MODULE_REGISTRY / moduleAtStage() /
 *    moduleSet(). M0 must return EXACTLY the old answer — it is a refactor, not
 *    a behaviour change — so these tests double as the regression net for M1/M2,
 *    which will make the set scenario-driven and facilitator-narrowable.
 *
 * 2. THE DEAD-STAGE BUG. stageFlow() has always produced variable-length
 *    sessions (a branched scenario returns [0,1,3], skipping stage 2), but five
 *    navigation sites bypassed it and did raw arithmetic on STAGE_COUNT. The
 *    worst case was silent: stepping BACK from Wrap-up in a branched session
 *    targeted the skipped stage 2, which snapStageToFlow() then rolled FORWARD
 *    again — so "back" did nothing. These assertions fail if anyone reintroduces
 *    raw ±1 / STAGE_COUNT arithmetic at those sites.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const SECTION_CONTENT = fs.readFileSync(path.join(P, "section-content.js"), "utf8");
/* S3a — the roleplay content (cast, panels, framework, phases) lives in the
   room-only section-content.js chunk now. These assertions are about the
   CODE, not which file carries it. */

/* Rough source slice of a top-level `function name(...) { … }` body — brace
   counting from the signature. Good enough for regex assertions on small fns. */
function fnBodyOf(name) {
  /* S3a — look in script.js first, then in the room-only section-content.js
     chunk the roleplay content moved to. */
  const SRC = (SCRIPT.indexOf("function " + name + "(") > -1) ? SCRIPT : SECTION_CONTENT;
  const at = SRC.indexOf("function " + name + "(");
  assert.notStrictEqual(at, -1, "function not found: " + name);
  let i = SRC.indexOf("{", at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(i, j + 1);
  }
  throw new Error("unbalanced braces for " + name);
}

/* The resolver block is self-contained (its only dependency is `window`), so we
   can slice it out and evaluate it for REAL behavioural coverage rather than
   another source-regex. */
function loadResolver(win) {
  /* S1b — the slice starts at MAX_SECTION_SLOTS, not MODULE_REGISTRY: the slot
     model (sectionSlots / stageCount / lastStage) lives in the same block and
     reads that cap, so a slice that skipped it threw a ReferenceError the
     moment refreshModuleStages() ran. */
  const start = SCRIPT.indexOf("const MAX_SECTION_SLOTS");
  assert.notStrictEqual(start, -1, "MAX_SECTION_SLOTS must exist");
  const endMarker = "\nfunction snapStageToFlow(";
  const end = SCRIPT.indexOf(endMarker, start);
  assert.notStrictEqual(end, -1, "the resolver block must sit above snapStageToFlow()");
  const src = SCRIPT.slice(start, end);
  const factory = new Function("window", src +
    "\nreturn { MODULE_REGISTRY, moduleAtStage, stageForModule, moduleSet, moduleNameTrio," +
    "\n         moduleHasContent, moduleNameEn, moduleHasScoring, refreshModuleStages," +
    "\n         setSessionModules, scenarioModuleSet, sectionSlots, slotAtStage," +
    "\n         stageCount, lastStage, stageViewId, allStageViewIds, standardStageFlow };");
  return factory(win);
}

const TRIO = (en) => ({ en, fr: "", ja: "" });

test("M0: the registry maps stages to modules positionally", () => {
  const r = loadResolver({});
  assert.equal(r.moduleAtStage(1), "A", "stage 1 is Module A");
  assert.equal(r.moduleAtStage(2), "B", "stage 2 is Module B");
  assert.equal(r.moduleAtStage(0), null, "Welcome is not a module stage");
  // M4b: the branched decision case became a real module at stage 3, and
  // wrap-up moved 3 → 4 to keep the flow monotonic.
  assert.equal(r.moduleAtStage(3), "branched", "stage 3 is the branched decision case");
  assert.equal(r.moduleAtStage(4), null, "Wrap-up is not a module stage");
  assert.equal(r.stageForModule("A"), 1);
  assert.equal(r.stageForModule("B"), 2);
  assert.equal(r.stageForModule("branched"), 3);
  assert.equal(r.stageForModule("C"), -1, "an unknown module has no stage yet");
});

/* ── M4b: the 5-stage model (branched gets a real stage), landing INERT ────── */

test("M4b: there are 5 stages and wrap-up is last", () => {
  /* SUPERSEDED BY S1b, and kept deliberately rather than deleted: what M4b was
     really protecting is that the wrap-up index is DERIVED, never a literal.
     S1b made it per-session (Welcome + N sections + Wrap-up), so "5 stages" is
     no longer a fact about the app — a 1-section session has 3 stages. The
     no-literals guard below is the part that still earns its keep. */
  assert.ok(!/viewStage === 3\b/.test(SCRIPT), "wrap-up must not be hardcoded");
  assert.ok(!/roomStage === 3\b/.test(SCRIPT), "wrap-up must not be hardcoded");
  assert.ok(!/viewStage === 4\b/.test(SCRIPT), "nor at its post-M4b index");

  const r = loadResolver({ CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
                           CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B") });
  assert.equal(r.stageCount(), 4, "Welcome + 2 sections + Wrap-up");
  assert.equal(r.lastStage(), 3, "wrap-up is the last stage, whatever its number");
  assert.deepStrictEqual(r.standardStageFlow(), [0, 1, 2, 3],
    "the flow is CONTIGUOUS since S1b — it was [0,1,2,4] with stage 3 skipped");

  const one = loadResolver({ CURRENT_SCENARIO_MODULES: ["A"],
                             CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A") });
  assert.equal(one.lastStage(), 2, "a 1-section session ends at stage 2");
  assert.deepStrictEqual(one.standardStageFlow(), [0, 1, 2]);

  /* The per-stage tables are keyed by ROLE / section TYPE now, because a stage
     number no longer implies what is running on it. */
  assert.match(SCRIPT, /const STAGE_LABELS = \{[\s\S]*?welcome:[\s\S]*?wrapup:/,
    "STAGE_LABELS must be role-keyed");
  assert.match(SCRIPT, /const STAGE_MINUTES_BY_ROLE = \{[\s\S]*?pbl: 40[\s\S]*?\}/,
    "planned minutes must be keyed by section type");
  assert.ok(!/const STAGE_MINUTES = \[/.test(SCRIPT),
    "the index-keyed minutes array must be gone");
});

test("M4b: stage 3 is INERT — an A/B session skips it entirely", () => {
  // This is the whole safety argument: adding the stage changes nothing until a
  // scenario actually declares the branched module.
  const win = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Chronic pain"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Breaking bad news")
  };
  const r = loadResolver(win);
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "branched must not be inferred");
  r.refreshModuleStages();
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1, 2], "only A and B stages are published");
});

test("M4b: branched is never NAME- or SCORING-inferred into a standard scenario", () => {
  // It has no CURRENT_SCENARIO_MODULE_branched_NAME and no scoring.modulebranched,
  // so the two inference paths cannot pick it up by accident.
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A only"),
    SCORING: { moduleA: [{ id: "a1" }], moduleB: [{ id: "b1" }] }
  });
  assert.equal(r.moduleNameEn("branched"), "", "branched has no scenario name field");
  assert.equal(r.moduleHasScoring("branched"), false, "branched has no scoring family");
  assert.ok(r.moduleSet().indexOf("branched") === -1, "branched must not appear by inference");
});

test("M4b: a scenario CAN declare branched explicitly, and it lands at stage 3", () => {
  const win = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay"),
    CURRENT_SCENARIO_MODULES: ["A", "branched", "B"]
  };
  const r = loadResolver(win);
  // Returned in STAGE order, which is what keeps the flow monotonic.
  assert.deepStrictEqual(r.moduleSet(), ["A", "B", "branched"]);
  r.refreshModuleStages();
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1, 2, 3]);
});

test("M4b: the lazy branched chunk DERIVES the wrap-up index from the shell", () => {
  // branched-render.js hardcoded LAST_STAGE = 3; the 5th stage would have
  // silently desynced the lazy chunk from the shell.
  const BR = fs.readFileSync(path.join(P, "branched-render.js"), "utf8");
  assert.ok(!/var LAST_STAGE = 3;/.test(BR), "the hardcoded LAST_STAGE must be gone");
  assert.match(BR, /root\.CANAMED_LAST_STAGE/, "it must read the published global");
  /* S1b — the wrap-up index is per-session, so it is republished by
     refreshModuleStages() rather than computed once from a constant. */
  assert.match(SCRIPT, /window\.CANAMED_LAST_STAGE = lastStage\(\)/,
    "the shell must publish the wrap-up index");
});

/* ── M4c: composition — a mixed scenario REFERENCES a branched scenario ────── */

test("M4c: renderDecisions renders every registry module, not a hardcoded A/B", () => {
  const fn = fnBodyOf("renderDecisions");
  assert.match(fn, /MODULE_REGISTRY\.map\(m => m\.id\)\.forEach/,
    "the render loop must come from the registry so a composed branched module renders");
  assert.ok(!/\["A", "B"\]\.forEach/.test(fn), "the hardcoded A/B loop must be gone");
  assert.match(fn, /el\("decisions-" \+ mod\)/, "each module renders into its own container");
});

test("M4c: composeBranchedModule namespaces ids and rewrites graph edges", () => {
  const fn = fnBodyOf("composeBranchedModule");
  // Node ids become RTDB vote keys (votes/$voteId), so a composed graph must not
  // collide with the outer scenario's own decision ids.
  assert.match(fn, /BRANCHED_ID_PREFIX/, "composed node ids must be namespaced");
  assert.match(fn, /copy\.module = "branched"/, "composed nodes are tagged for the branched stage");
  // Both accepted afterDecision shapes must be rewritten or the graph breaks.
  assert.match(fn, /typeof uw\.afterDecision === "string"/, "bare-id edges rewritten");
  assert.match(fn, /uw\.afterDecision\.id = nsId/, "{id, option} edges rewritten");
  assert.match(fn, /d\.module === "branched"/, "previously composed nodes are dropped first");
});

test("M4c: composition is inert for a scenario with no branchedRef", () => {
  assert.match(SCRIPT, /window\.CURRENT_SCENARIO_BRANCHED_REF = \(sc && sc\.branchedRef\) \|\| null/,
    "the reference comes off the scenario body");
  const fn = fnBodyOf("composeBranchedModule");
  assert.match(fn, /if \(!ref \|\| typeof ref !== "string"\) return;/,
    "no branchedRef → nothing composed");
});

test("M4c: compose runs AFTER the finalStep assignment (it may override it)", () => {
  // The referenced branched scenario owns its own deliverable prompt; running
  // compose before applyScenario's finalStep line would clobber it.
  const fin = SCRIPT.indexOf("window.CURRENT_SCENARIO_FINAL_STEP = (sc && sc.finalStep)");
  const call = SCRIPT.indexOf("composeBranchedModule();", fin);
  assert.ok(fin !== -1 && call !== -1 && call > fin,
    "composeBranchedModule() must be called after CURRENT_SCENARIO_FINAL_STEP is set");
});

test("M4c: the branched engine walks ONLY the composed subtree in a mixed session", () => {
  const BR = fs.readFileSync(path.join(P, "branched-render.js"), "utf8");
  // Walking the outer A/B decisions as part of the graph would corrupt the path.
  assert.match(BR, /function branchedDecisions\(\)/, "the engine needs a subtree selector");
  assert.match(BR, /d\.module === "branched"/, "a composed session walks only branched nodes");
  assert.match(BR, /branched-final-host-3/,
    "a composed session's deliverable lands on the branched stage's own host");
});

/* ── M4d: a composed branched module gets its own answers bucket ───────────── */

test("M4d: answers/moduleBranched is declared in BOTH trees and HARDENED", () => {
  const rules = JSON.parse(
    fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
  const sess = rules.sessions.$sessionId.rooms.$roomId.answers;
  const orgs = rules.orgs.$orgSlug.sessions.$sessionId.rooms.$roomId.answers;
  [["sessions", sess], ["orgs", orgs]].forEach(([label, ans]) => {
    assert.ok(ans.moduleBranched, label + " must declare answers/moduleBranched");
    const e = ans.moduleBranched.$entryId;
    /* Deliberately STRICTER than the moduleA rule it was cloned from. moduleA /
       moduleB still carry the older, looser contract (any authed user, no
       $other) — a PRE-EXISTING gap, tracked separately. A brand-new node must
       not be introduced at the weaker standard. */
    /* Assert the COMPLETE predicate, not just token presence: a substring check
       for "uidMembers"/"closed" would still pass a permissive or wrongly-ordered
       rule (e.g. an `||` where an `&&` belongs, or a gate on the wrong room).
       Behavioural evaluation of these rules lives in the emulator spec
       (member/non-member, closed session, unknown field, cross-room, both
       trees) — this is the cheap structural lock that catches a weakening edit. */
    const root = label === "sessions"
      ? "root.child('sessions').child($sessionId)"
      : "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)";
    assert.strictEqual(
      e[".write"],
      "auth != null && !" + root + ".child('closed').exists() && " +
      root + ".child('rooms').child($roomId).child('uidMembers').child(auth.uid).exists()",
      label + ": exact write predicate (authed AND not closed AND a member of THIS room)");
    assert.strictEqual(e.$other[".validate"], false,
      label + ": unknown entry fields must be rejected ($other sentinel)");
    // Every field the client actually writes must be declared, or the $other
    // sentinel would reject a legitimate answer.
    ["text", "by", "cid", "at", "university", "bulletKey", "edits"].forEach(f => {
      assert.ok(e[f], label + ": must declare the client-written field " + f);
    });
    assert.match(e.text[".validate"], /length <= 1000/, label + ": text bounded");
    /* Strictly stronger than moduleA — shown POSITIVELY, by the conjunct
       moduleA lacks, rather than by a notStrictEqual that any difference would
       satisfy. If moduleA is ever hardened too (tracked in CLAUDE.md), this
       flips to both having the gate, and the assertion below should be updated
       deliberately rather than deleted. */
    const modA = ans.moduleA.$entryId[".write"];
    assert.ok(!/uidMembers/.test(modA),
      label + ": moduleA is still the un-gated legacy contract (update this test " +
      "when moduleA is hardened)");
    assert.ok(/uidMembers/.test(e[".write"]),
      label + ": moduleBranched adds the membership conjunct moduleA lacks");
  });
  // The two trees are NOT interchangeable: each must gate on its OWN root, or an
  // org session would be checked against the default tree (and vice versa).
  assert.notStrictEqual(sess.moduleBranched.$entryId[".write"],
    orgs.moduleBranched.$entryId[".write"],
    "each tree's rule must reference its own root path");
});

test("M4d: standalone branched still writes to moduleA; composed writes elsewhere", () => {
  const BR = fs.readFileSync(path.join(P, "branched-render.js"), "utf8");
  const fn = BR.slice(BR.indexOf("function branchedAnswerBucket()"),
                      BR.indexOf("function branchedDecisions()"));
  // Live rooms hold standalone branched data under moduleA — changing that would
  // orphan it, so standalone MUST stay on moduleA.
  assert.match(fn, /=== "branched"\) return "moduleA";/,
    "standalone branched keeps writing to moduleA (data continuity)");
  // And the composed branch keys off composed nodes EXISTING — not merely on
  // "the format isn't branched", which is also true when no scenario is applied
  // and would rename the input ids out from under addAnswer().
  assert.match(fn, /d\.module === "branched"/, "composed is detected by the nodes themselves");
  assert.match(fn, /composed \? "moduleBranched" : "moduleA"/,
    "only a genuinely composed session uses the new bucket");
});

test("M4d: the textarea ids follow the bucket (else addAnswer silently no-ops)", () => {
  // addAnswer() resolves its input as `answer-input-<moduleKey>-<bulletKey>`.
  // If the ids stayed hardcoded to moduleA while the write bucket changed, the
  // Add button would find no element and do NOTHING, with no error.
  const BR = fs.readFileSync(path.join(P, "branched-render.js"), "utf8");
  assert.ok(!/"answer-input-moduleA-"/.test(BR),
    "no hardcoded moduleA input id may remain");
  assert.match(BR, /"answer-input-" \+ branchedAnswerBucket\(\) \+ "-"/,
    "ids must be built from the same bucket the write uses");
  assert.match(BR, /answers\[branchedAnswerBucket\(\)\]/,
    "the read-back must use the same bucket too");
});

test("M4d: the client subscribes to the new bucket (state, listener, teardown)", () => {
  assert.match(SCRIPT, /let answers = \{ moduleA: \{\}, moduleB: \{\}, moduleBranched: \{\} \}/,
    "the answers state needs the bucket");
  assert.match(SCRIPT, /refAnswers\.moduleBranched = db\.ref\(base \+ "\/answers\/moduleBranched"\)/,
    "the ref must be created");
  assert.match(SCRIPT, /refAnswers\.moduleBranched\.on\("value"/, "…and subscribed");
  assert.match(SCRIPT, /if \(refAnswers\.moduleBranched\) refAnswers\.moduleBranched\.off\(\);/,
    "…and torn down with the room");
});

/* ── M1: the module set is scenario-driven ────────────────────────────────── */

test("M1: BACK-COMPAT — a scenario that names both modules still runs A+B", () => {
  // This is the migration story: all three built-ins declare both names, so
  // inference must return A+B for them with no `modules` field and no data edit.
  const bothNames = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Chronic pain"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Breaking bad news")
  };
  assert.deepStrictEqual(loadResolver(bothNames).moduleSet(), ["A", "B"]);
  assert.deepStrictEqual(
    loadResolver(Object.assign({ CURRENT_SCENARIO_FORMAT: "standard" }, bothNames)).moduleSet(),
    ["A", "B"]);
});

test("M1: an explicit scenario `modules` declaration wins over inference", () => {
  // Names for BOTH are present, but the scenario declares it only runs A.
  const win = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay"),
    CURRENT_SCENARIO_MODULES: ["A"]
  };
  assert.deepStrictEqual(loadResolver(win).moduleSet(), ["A"]);
  win.CURRENT_SCENARIO_MODULES = ["B"];
  assert.deepStrictEqual(loadResolver(win).moduleSet(), ["B"]);
  win.CURRENT_SCENARIO_MODULES = ["B", "A"];
  assert.deepStrictEqual(loadResolver(win).moduleSet(), ["A", "B"],
    "the set is always returned in stage order, whatever order it was declared");
});

test("M1: inference — a module with no name and no scoring family is absent", () => {
  assert.deepStrictEqual(
    loadResolver({ CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning only") }).moduleSet(),
    ["A"], "naming only Module A yields an A-only session");
  assert.deepStrictEqual(
    loadResolver({ CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay only") }).moduleSet(),
    ["B"], "naming only Module B yields a B-only session");
});

test("M1: a scoring family alone is enough to make a module present", () => {
  const r = loadResolver({ SCORING: { moduleB: [{ id: "b1" }] } });
  assert.equal(r.moduleHasContent("B"), true);
  assert.equal(r.moduleHasContent("A"), false);
  assert.deepStrictEqual(r.moduleSet(), ["B"]);
  // An EMPTY family is not content (scenario-author emits scoring.moduleB: []).
  assert.equal(loadResolver({ SCORING: { moduleB: [] } }).moduleHasContent("B"), false);
});

test("M1: a stale SCORING table cannot resurrect a module the scenario doesn't name", () => {
  // applyScenario() resets the module NAMES for every scenario but only
  // overwrites window.SCORING when the new scenario has a scoring key. So after
  // switching from an A+B scenario to an A-only one, window.SCORING.moduleB can
  // still be populated — it must not put Module B back into the session.
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning only"),
    SCORING: { moduleA: [{ id: "a1" }], moduleB: [{ id: "b1" }] }   // leftover
  });
  assert.deepStrictEqual(r.moduleSet(), ["A"],
    "names are authoritative when present, so the leftover B scoring is ignored");
  // The scoring fallback still applies when NO module is named at all.
  assert.deepStrictEqual(
    loadResolver({ SCORING: { moduleB: [{ id: "b1" }] } }).moduleSet(), ["B"]);
});

test("M1: a branched scenario declares no A/B module, whatever else is set", () => {
  assert.deepStrictEqual(loadResolver({ CURRENT_SCENARIO_FORMAT: "branched" }).moduleSet(), [],
    "its content is the node graph, not an A/B module");
  assert.deepStrictEqual(loadResolver({
    CURRENT_SCENARIO_FORMAT: "branched",
    CURRENT_SCENARIO_MODULES: ["A", "B"],
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("placeholder")
  }).moduleSet(), [], "branched wins over both a declaration and inference");
});

test("M1: a malformed standard scenario still yields a navigable session", () => {
  // No names, no scoring, no declaration: rather than collapse the flow to
  // Welcome → Wrap-up, keep one module stage.
  assert.deepStrictEqual(loadResolver({}).moduleSet(), ["A"]);
  // A declaration naming nothing we recognise falls through to inference.
  assert.deepStrictEqual(
    loadResolver({ CURRENT_SCENARIO_MODULES: ["Z"],
                   CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay") }).moduleSet(),
    ["B"]);
});

test("M1: refreshModuleStages publishes the enabled modules' stage indices", () => {
  const win = { CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"), CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B") };
  loadResolver(win).refreshModuleStages();
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1, 2]);

  const aOnly = { CURRENT_SCENARIO_MODULES: ["A"], CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A") };
  loadResolver(aOnly).refreshModuleStages();
  assert.deepStrictEqual(aOnly.CANAMED_MODULE_STAGES, [1], "A-only drops stage 2");

  /* S1b — stages are POSITIONS, so the single section of a B-only session runs
     on stage 1. Before S1b it ran on stage 2 with stage 1 skipped; that fixed
     module→stage map is exactly what the phase removed. */
  const bOnly = { CURRENT_SCENARIO_MODULES: ["B"], CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B") };
  loadResolver(bOnly).refreshModuleStages();
  assert.deepStrictEqual(bOnly.CANAMED_MODULE_STAGES, [1],
    "B-only runs its one section on stage 1, not on Module B's old fixed index");
});

test("M1: applyScenario publishes the declared set, in the right order", () => {
  // CURRENT_SCENARIO_MODULES must be assigned AFTER the format (moduleSet reads
  // it) and refreshModuleStages() must run after both, or the first stageFlow()
  // of a session would use a stale set.
  const fmt = SCRIPT.indexOf("window.CURRENT_SCENARIO_FORMAT = (sc && sc.format)");
  const mods = SCRIPT.indexOf("window.CURRENT_SCENARIO_MODULES =");
  const refresh = SCRIPT.indexOf("refreshModuleStages();", mods);
  assert.ok(fmt !== -1 && mods !== -1 && refresh !== -1, "all three must exist in applyScenario");
  assert.ok(fmt < mods, "format must be published before the module set");
  assert.ok(mods < refresh, "the stage list must be refreshed after the set is published");
  assert.match(SCRIPT, /Array\.isArray\(sc && sc\.modules\)/,
    "the scenario's `modules` field is the declaration");
});

test("M0: moduleNameTrio resolves the scenario's module names, unfiltered by the set", () => {
  const trioA = { en: "Chronic pain", fr: "", ja: "" };
  const trioB = { en: "Breaking bad news", fr: "", ja: "" };
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: trioA,
    CURRENT_SCENARIO_MODULE_B_NAME: trioB
  });
  assert.deepStrictEqual(r.moduleNameTrio("A"), trioA);
  assert.deepStrictEqual(r.moduleNameTrio("B"), trioB);
  assert.equal(r.moduleNameTrio(null), null, "no module → no trio");
  assert.equal(r.moduleNameTrio("C"), null);
  // Deliberately unfiltered: branched-author.js writes moduleAName as the node
  // title, so a branched session must still be able to label stage 1.
  const branched = loadResolver({
    CURRENT_SCENARIO_FORMAT: "branched",
    CURRENT_SCENARIO_MODULE_A_NAME: trioA
  });
  assert.deepStrictEqual(branched.moduleNameTrio(branched.moduleAtStage(1)), trioA,
    "a branched stage-1 label must still resolve even though moduleSet() is empty");
});

test("M0: stageLabel resolves the module trio through the registry, not stage literals", () => {
  /* S1b moved the trio lookup into stageSectionTitle(), which resolves the SLOT
     at a stage rather than the module fixed to that index — the same principle,
     one level further along: a stage number implies neither a module nor a
     title any more. */
  const title = SCRIPT.slice(SCRIPT.indexOf("function stageSectionTitle("),
                             SCRIPT.indexOf("function stageLabel("));
  assert.match(title, /slotAtStage\(i\)/, "the title must come from the slot at that stage");
  assert.match(title, /moduleNameTrio\(slot\.module\)/, "resolved through the registry trio");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function stageLabel("),
                          SCRIPT.indexOf("/* Stage-flow wrappers"));
  assert.doesNotMatch(fn, /i\s*===\s*1/, "the hardcoded stage-1 literal must be gone");
  assert.doesNotMatch(fn, /i\s*===\s*2/, "the hardcoded stage-2 literal must be gone");
});

/* ── the dead-stage bug ───────────────────────────────────────────────────── */

test("M0: objectives + celebration derive the module from the registry", () => {
  assert.match(SCRIPT, /const mod = moduleAtStage\(viewStage\) \|\| "A";/,
    "renderObjectives must not use (viewStage === 2) ? 'B' : 'A'");
  assert.match(SCRIPT, /moduleAtStage\(roomStage\) === "B"/,
    "celebrateEvents must not test roomStage === 2 directly");
});

/* doesNotMatch on a 690 KB source dumps the whole file into the failure output,
   which is unreadable — assert on a boolean instead. */
function absent(re, msg) {
  assert.ok(!re.test(SCRIPT), msg);
}

test("M0: every stage-nav site steps through the ACTIVE flow, not raw arithmetic", () => {
  // Dashboard row Back / Advance.
  assert.match(SCRIPT, /const _dprev = adjacentStage\(st, -1\);/);
  assert.match(SCRIPT, /const _dnext = adjacentStage\(st, 1\);/);
  assert.match(SCRIPT, /back\.disabled = _dprev === st;/);
  assert.match(SCRIPT, /fwd\.disabled = _dnext === st;/);
  assert.match(SCRIPT, /setRoomStage\(r, st, _dprev\)/);
  assert.match(SCRIPT, /setRoomStage\(r, st, _dnext\)/);

  // Admin sidebar per-room arrows.
  assert.match(SCRIPT, /const _sprev = adjacentStage\(st, -1\);/);
  assert.match(SCRIPT, /const _snext = adjacentStage\(st, 1\);/);
  assert.match(SCRIPT, /back\.disabled = _sprev === st;/,
    "sidebar back must disable on the flow, not st === 0");
  assert.match(SCRIPT, /fwd\.disabled = _snext === st;/,
    "sidebar forward must disable on the flow, not st === STAGE_COUNT - 1");
  assert.match(SCRIPT, /setRoomStage\(r, st, _sprev\)/);
  assert.match(SCRIPT, /setRoomStage\(r, st, _snext\)/);

  // Room-view Back / Advance (the silent no-op case).
  assert.match(SCRIPT, /setRoomStage\(myRoom, roomStage, adjacentStage\(roomStage, -1\)\)/,
    "room-admin Back must resolve through the flow or it is a no-op when a stage is skipped");
  assert.match(SCRIPT, /setRoomStage\(myRoom, roomStage, adjacentStage\(roomStage, 1\)\)/);

  // Disable logic for both roles.
  assert.match(SCRIPT, /el\("prev-btn"\)\.disabled = adjacentStage\(roomStage, -1\) === roomStage;/);
  assert.match(SCRIPT, /el\("next-btn"\)\.disabled = adjacentStage\(roomStage, 1\) === roomStage;/);
  assert.match(SCRIPT, /el\("prev-btn"\)\.disabled = adjacentStage\(viewStage, -1\) === viewStage;/);

  // "Advance all rooms" preview + write.
  assert.match(SCRIPT, /const nxt = adjacentStage\(cur, 1\);/,
    "advance-all must preview/target the stage the room will actually land on");
  assert.match(SCRIPT, /if \(nxt !== cur\) setRoomStage\(r, cur, nxt\);/);

  // No nav site may do raw last-index / ±1 arithmetic any more. (The surviving
  // STAGE_COUNT uses are legitimate: the stageFlow() fallbacks, setRoomStage's
  // bounds clamp, the show/hide loop over ALL stage sections — which must also
  // hide a skipped one — and "is this the wrap-up stage", since the last index
  // is in every flow.)
  absent(/roomStage >= STAGE_COUNT - 1/,
    "raw STAGE_COUNT arithmetic in stage nav reintroduces the dead-stage bug");
  absent(/st === STAGE_COUNT - 1/, "a room-stepper still compares against the raw last index");
  absent(/cur < STAGE_COUNT - 1/, "advance-all still uses raw arithmetic");
  absent(/setRoomStage\([^)]*,\s*st\s*[-+]\s*1\s*\)/, "a stepper still writes st±1 directly");
  absent(/setRoomStage\(myRoom, roomStage, roomStage\s*[-+]\s*1\)/,
    "room-view nav still writes roomStage±1 directly");
});

/* ── M2: the facilitator narrows the scenario's set per session ───────────── */

test("M2: a session's narrowing intersects the scenario's set", () => {
  const win = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B")
  };
  const r = loadResolver(win);
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "no narrowing → the scenario's set");
  r.setSessionModules("A");
  assert.deepStrictEqual(r.moduleSet(), ["A"]);
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1], "the stage list refreshes with it");
  r.setSessionModules("B");
  assert.deepStrictEqual(r.moduleSet(), ["B"]);
  // S1b: one section → one stage, at position 1 whichever module it is.
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1]);
  r.setSessionModules("B,A");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "stage order, not declaration order");
  r.setSessionModules(null);
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "clearing it restores the scenario's set");
});

test("M2: a narrowing that would empty the session is ignored", () => {
  // e.g. an A-only scenario carrying a stale "B" selection.
  const r = loadResolver({ CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A only") });
  r.setSessionModules("B");
  assert.deepStrictEqual(r.moduleSet(), ["A"],
    "an empty intersection falls back to the scenario's set, never a dead session");
});

test("M2: setSessionModules tolerates whitespace, empties and unknown ids", () => {
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B")
  });
  r.setSessionModules("  A , B ");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "whitespace is trimmed");
  r.setSessionModules("");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "empty string = no narrowing");
  r.setSessionModules("Z");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "an unknown id intersects to nothing → ignored");
});

test("M2: the scenario set is still reachable independently of the narrowing", () => {
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B")
  });
  r.setSessionModules("A");
  assert.deepStrictEqual(r.scenarioModuleSet(), ["A", "B"],
    "scenarioModuleSet() reports what the scenario CONTAINS");
  assert.deepStrictEqual(r.moduleSet(), ["A"],
    "moduleSet() reports what this session RUNS");
});

test("M2: createSession records the narrowing write-once, and only a subset", () => {
  assert.match(SCRIPT, /oPath\(code, "modules"\)\)\.set\(modCsv\)/,
    "createSession must write the CSV to the session's modules field");
  assert.match(SCRIPT, /if \(modCsv\) writes\.push/,
    "an unnarrowed session must write NO modules field at all");
  /* S3b — the create form's "Modules to run" tick-row is GONE: the section
     picker supersedes it, expressing the same choice at the right granularity
     (a pick may name two sections of one type, which a module tick-row cannot).
     `modules` itself stays supported on the read side for sessions created
     before the picker, so the write path above is still asserted. */
  assert.ok(!/splash-create-mod-/.test(SCRIPT),
    "the module tick-row is superseded by the section picker");
  assert.match(SCRIPT, /oPath\(code, "sections"\)\)\.set\(sections\)/,
    "the create form must write the ordered section pick instead");
});

test("M2: loadSessionScenario publishes the narrowing BEFORE applyScenario", () => {
  // applyScenario() calls refreshModuleStages(); if the narrowing were published
  // after it, the session's first stageFlow() would use the scenario's full set
  // and briefly offer a stage this session does not run.
  const read = SCRIPT.indexOf('oPath(code, "modules")).once("value")');
  const set = SCRIPT.indexOf("setSessionModules(res[3]", read);
  const apply = SCRIPT.indexOf("applyScenario(null, custom)", set);
  assert.ok(read !== -1, "loadSessionScenario must read the session's modules");
  assert.ok(set !== -1, "…and publish it via setSessionModules");
  assert.ok(apply !== -1 && set < apply, "…before applyScenario()");
});

test("M2: `modules` is declared write-once in BOTH rule trees", () => {
  const rules = JSON.parse(
    fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
  const s = rules.sessions.$sessionId.modules;
  const o = rules.orgs.$orgSlug.sessions.$sessionId.modules;
  [["sessions", s], ["orgs", o]].forEach(([label, node]) => {
    // sessions/$sessionId has NO $other catch-all, so an undeclared child is
    // denied — the field must be declared in both trees or M2 silently fails.
    assert.ok(node, label + " tree must declare `modules`");
    assert.equal(node[".write"], "auth != null && !data.exists()",
      label + ": must be write-once, mirroring scenarioId");
    assert.match(node[".validate"], /A-Za-z0-9_-/,
      label + ": ids validated generically (no A|B whitelist, so module C needs no rules change)");
  });
  assert.equal(s[".validate"], o[".validate"], "both trees must validate identically");
});

/* ── M3b: phase-based progress is a data-driven, reusable seam ─────────────── */

test("M3b: MODULE_PROGRESS.B reuses the existing MODB constants, not a copy", () => {
  const reg = SCRIPT.slice(SCRIPT.indexOf("const MODULE_PROGRESS = {"));
  const bCfg = reg.slice(0, reg.indexOf("};"));
  // The registry must POINT AT the canonical constants, so the section table has
  // one source of truth (a divergent copy would silently drift from the DOM).
  assert.match(bCfg, /phases:\s*MODB_PHASES\b/, "B.phases must reference MODB_PHASES");
  assert.match(bCfg, /sections:\s*MODB_PHASE_SECTIONS\b/, "B.sections must reference MODB_PHASE_SECTIONS");
  assert.match(bCfg, /stageId:\s*"stage-2"/);
  assert.match(bCfg, /prevId:\s*"modB-phase-prev"/);
  assert.match(bCfg, /nextId:\s*"modB-phase-next"/);
});

test("M3b: the Module B functions are name-preserving wrappers over the shared plumbing", () => {
  // The ~11 callers/specs that drive these must keep working, so the names stay
  // and the bodies delegate to the generic helpers.
  assert.match(fnBodyOf("applyModBPhaseVisibility"), /applyPhaseVisibility\(/,
    "applyModBPhaseVisibility delegates to applyPhaseVisibility");
  /* S1c-3b — the config is resolved per section (modBProgressCfg()) so an
     authored roleplay can declare its own phases; MODULE_PROGRESS.B is still
     what that returns when nothing is declared. */
  assert.match(fnBodyOf("renderModBPhase"), /renderModulePhase\(modBCfg\(\), modBPhase\)/,
    "renderModBPhase delegates to renderModulePhase with the section's config");
  assert.match(fnBodyOf("modBProgressCfg"), /if \(!authored\) return MODULE_PROGRESS\.B;/,
    "and falls back to the shipped config untouched");
  // The generic helpers exist and take config, not hardcoded Module B specifics.
  assert.match(SCRIPT, /function applyPhaseVisibility\(stageId, sections, phaseKey, columnsSel, expandedIn\)/);
  assert.match(SCRIPT, /function renderModulePhase\(cfg, phaseIndex\)/);
});

test("M3b: Module A is DELIBERATELY absent from the phase registry (derived gate)", () => {
  const reg = SCRIPT.slice(SCRIPT.indexOf("const MODULE_PROGRESS = {"));
  const body = reg.slice(0, reg.indexOf("};") + 2);
  // A phase entry for A would be wrong: its progress is a derived hypothesis
  // gate (revealModARightCol), not an ordinal phase list. Guard against a future
  // edit "helpfully" registering it.
  assert.doesNotMatch(body, /(^|[^A-Za-z])A\s*:/,
    "Module A must not gain a phase-registry entry — it keeps its derived-gate visibility");
  // And Module A's visibility function is untouched by M3b.
  assert.match(SCRIPT, /function revealModARightCol\(/,
    "revealModARightCol must remain Module A's own visibility function");
});

/* ── M1: the author can produce a single-module scenario ──────────────────── */

const AUTHOR_JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  new Function("window", "document", AUTHOR_JS)(win, doc);
  return win.__scenarioAuthor;
}
/* Install a scenario as the live STATE (STATE itself is closure-private). */
function installAuthor(api, scenario) {
  const parsed = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, parsed);
}
const NO_TRIO = { en: "", fr: "", ja: "" };

test("M1: a Module-A-only scenario validates (Module B name no longer required)", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  s.moduleBName = NO_TRIO;
  s.scoring.moduleB = [];
  installAuthor(api, s);
  assert.deepStrictEqual(api.validate(), [],
    "naming only Module A must be a valid single-module scenario");
});

test("M1: a Module-B-only scenario validates", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  s.moduleAName = NO_TRIO;
  s.scoring.moduleA = [];
  s.decisions.forEach((d) => { d.module = "B"; });   // move the decision across
  installAuthor(api, s);
  assert.deepStrictEqual(api.validate(), []);
});

test("M1: a scenario that names NO module is rejected", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  s.moduleAName = NO_TRIO; s.moduleBName = NO_TRIO;
  s.scoring.moduleA = []; s.scoring.moduleB = [];
  installAuthor(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /at least one module/i.test(e)),
    "a scenario running no module at all must be rejected; got " + JSON.stringify(errs));
});

test("M1: a decision in a module the scenario does not run is rejected", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  // Make it B-only while the skeleton's decision is still Module A → that
  // decision would render into a stage the session never visits.
  s.moduleAName = NO_TRIO;
  s.scoring.moduleA = [];
  installAuthor(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /only runs Module B/.test(e)),
    "an unreachable decision must be flagged; got " + JSON.stringify(errs));
});

test("M1: an explicit `modules` override survives an author round-trip", () => {
  // The runtime honours `modules` over inference; the editor has no control for
  // it, so it must ride Phase 1's passthrough bag rather than being dropped.
  const api = loadAuthor();
  const s = api.skeleton();
  s.modules = ["A"];
  installAuthor(api, s);
  assert.deepStrictEqual(api.toJson().modules, ["A"]);
});

test("M0: the debrief legend lists only the stages the session visits", () => {
  assert.match(SCRIPT, /stageFlow\(\)\.forEach\(\(i\) => \{[\s\S]{0,400}debrief|stageFlow\(\)\.forEach/,
    "the legend must iterate the flow");
  const legend = SCRIPT.slice(SCRIPT.indexOf('legend.className = "debrief-time-legend"'),
                              SCRIPT.indexOf('sec.appendChild(legend)'));
  assert.match(legend, /stageFlow\(\)\.forEach/,
    "the legend must not loop 0..STAGE_COUNT (it would advertise a skipped stage)");
  assert.doesNotMatch(legend, /STAGE_COUNT/);
});
