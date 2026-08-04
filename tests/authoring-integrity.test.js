/* tests/authoring-integrity.test.js
 *
 * Two defects of ONE class: a facilitator's authored work is DESTROYED or
 * DROPPED with no error, because the missing state is indistinguishable from a
 * legitimate "not set".
 *
 * DEFECT A — the branched editor destroyed ~41% of a case on load.
 *   branchedJsonToState() modelled only id/stem/points/penalty and
 *   options{text,consequence,correct}; buildBranchedScenario() re-emitted only
 *   those. Neither had the `_extra` passthrough the STANDARD editor has used
 *   since Phase 1, so loading the real shipped `ward-escalation-branched`
 *   through "Load JSON" (or the cloud loader) and re-exporting lost:
 *     - all 5 evidence `documents` panels (the vitals/labs/CXR the runtime
 *       renders — including the X-ray image and its alt text),
 *     - all 16 option `why` rationales,
 *     - one of the three gates: `{ afterDecision: { id, option: [1,2,3] } }`
 *       was unreadable by the reverse mapper AND unexpressible by the forward
 *       one, which could only say "one option" or "any option".
 *   9948 → 5862 bytes, and validate() said nothing, because "this node has no
 *   documents" is a legitimate state.
 *   ACCEPTANCE BAR (below): the real shipped case must round-trip DEEP-EQUAL.
 *
 * DEFECT B — a character's `module` was unvalidated free text.
 *   section-registry.js byModule() does an EXACT match, so "", "a" and
 *   "branched" all routed the character to NO section. The Module A chat then
 *   falls back to a generic patient — silently, because a section with no
 *   declared character is legitimate. A roleplay author who cleared the box
 *   lost their patient persona.
 *
 * Harness: same as scenario-author-coverage.test.js — load the browser IIFE
 * with document.readyState="loading" so boot() never fires, and drive the pure
 * toJson/fromJson. branched-author.js must be loaded into the SAME window,
 * because toBranchedJson() calls window.CanamedBranchedAuthor.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const AUTHOR_JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
const BRANCHED_AUTHOR_JS = fs.readFileSync(path.join(P, "branched-author.js"), "utf8");
const SEED = require(path.join(P, "branched-seed.js"));
const { validateBranchedGraph } = require(path.join(P, "branched-validate.js"));
const REG = require(path.join(P, "section-registry.js"));

function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  // branched-author.js first: scenario-author.js's branched emit path calls it.
  new Function("window", "module", BRANCHED_AUTHOR_JS)(win, { exports: {} });
  new Function("window", "document", AUTHOR_JS)(win, doc);
  const api = win.__scenarioAuthor;
  assert.ok(api && api.toJson && api.fromJson, "expected window.__scenarioAuthor");
  assert.ok(win.CanamedBranchedAuthor, "expected window.CanamedBranchedAuthor");
  return api;
}

/* fromJson → toJson without a DOM: replace the live STATE reference in place. */
function roundTrip(api, scenario) {
  const parsed = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, parsed);
  return api.toJson();
}

/* ------------------------------------------------------------------ */
/* DEFECT A — branched round-trip fidelity                            */
/* ------------------------------------------------------------------ */

test("ACCEPTANCE: the real shipped branched case round-trips deep-equal", () => {
  const api = loadAuthor();
  const out = roundTrip(api, SEED);
  assert.deepStrictEqual(out, SEED,
    "loading ward-escalation-branched and re-exporting must change nothing");
});

test("the branched round-trip keeps the content the old serialiser destroyed", () => {
  const api = loadAuthor();
  const out = roundTrip(api, SEED);
  const inStr = JSON.stringify(SEED);
  const outStr = JSON.stringify(out);
  const count = (s, key) => s.split('"' + key + '"').length - 1;

  // The measured losses, pinned one by one so a regression names itself.
  ["documents", "why", "hideWhenLocked", "unlockWhen", "branch", "image", "alt"]
    .forEach((key) => {
      assert.strictEqual(count(outStr, key), count(inStr, key),
        "every '" + key + "' must survive the round-trip");
    });
  assert.strictEqual(outStr.length, inStr.length, "no bytes lost");

  // The evidence panels are real objects, not just a surviving key name.
  const assess = out.decisions.find((d) => d.id === "b_assess");
  assert.strictEqual(assess.documents.length, 1);
  assert.ok(assess.documents[0].text.en.includes("SpO"), "document text intact");
  // The subset gate the forward-edge model could not express.
  const det = out.decisions.find((d) => d.id === "b_deteriorate");
  assert.deepStrictEqual(det.unlockWhen, { afterDecision: { id: "b_assess", option: [1, 2, 3] } });
  // Still a graph the runtime validator accepts.
  assert.strictEqual(validateBranchedGraph(out).ok, true,
    "errors: " + JSON.stringify(validateBranchedGraph(out).errors));
});

test("a branched case carrying unknown/future keys round-trips untouched", () => {
  const api = loadAuthor();
  const synthetic = {
    id: "future-branched",
    format: "branched",
    name: { en: "Future case" },
    summary: { en: "carries fields no editor models yet" },
    moduleAName: { en: "Future" },
    moduleBName: { en: "Named on purpose" },
    case: { history: [{ q: { en: "q" }, a: { en: "a" } }], exam: [], labs: [] },
    scoring: { moduleA: [] },
    penalties: [],
    synthPrereqs: [],
    // Top-level keys section-registry.js's branched path actually reads, plus
    // ones nothing reads yet — all previously destroyed.
    finalStep: { title: { en: "Hand over" }, prompt: { en: "Write the SBAR" } },
    characters: [{ id: "daughter", role: "relative", persona: "You are worried." }],
    documents: [{ title: { en: "Ward policy" }, text: { en: "Escalate early." } }],
    preTest: [{ id: "p1", q: { en: "?" }, options: [{ text: { en: "x" }, correct: true }] }],
    schemaVersion: 2,
    decisions: [
      {
        id: "n0",
        module: "A",
        points: 10,
        penalty: 5,
        prompt: { en: "First move?" },
        provenance: "future-key-on-a-node",
        options: [
          {
            text: { en: "good" },
            correct: true,
            why: { en: "because" },
            branch: { reveal: { en: "it works" }, groupVote: true },
            tag: "future-key-on-an-option",
          },
          { text: { en: "bad" }, correct: false, why: { en: "no" } },
        ],
      },
      {
        id: "n1",
        module: "A",
        points: 10,
        penalty: 5,
        // A gate that ALSO carries a condition the editor draws no arrow for,
        // and an explicit hideWhenLocked:false the editor must not flip back.
        unlockWhen: { afterDecision: { id: "n0", option: 0 }, hypotheses: 2 },
        hideWhenLocked: false,
        prompt: { en: "Then?" },
        options: [{ text: { en: "end" }, correct: true }],
      },
    ],
  };
  assert.deepStrictEqual(roundTrip(api, synthetic), synthetic);
});

test("a branched case authored from scratch still emits the runtime stand-ins", () => {
  const api = loadAuthor();
  const st = api.getState();
  st.format = "branched";
  st.meta.id = "fresh-case";
  st.meta.name = { en: "Fresh", fr: "", ja: "" };
  const out = api.toJson();
  assert.strictEqual(out.format, "branched");
  assert.deepStrictEqual(out.case, { history: [], exam: [], labs: [] });
  assert.deepStrictEqual(out.penalties, []);
  assert.deepStrictEqual(out.synthPrereqs, []);
  /* No fabricated moduleBName. The old emit hardcoded {en:"Reflection"} on
     every branched scenario, which no shipped branched case has and which
     makes the runtime's NAME-first module inference read a Module B that does
     not exist. A branched case has no reflection stage. */
  assert.ok(!("moduleBName" in out), "must not invent a Module B name");
});

/* The forward-edge → gate translation, at the level the author draws it. */
test("a SUBSET of a parent's choices becomes an option-array gate, not any-option", () => {
  const { buildBranchedScenario } = require(path.join(P, "branched-author.js"));
  const nodes = [
    {
      id: "a",
      stem: "pick",
      options: [
        { text: "right", correct: true, next: "good" },
        { text: "wrong 1", next: "bad" },
        { text: "wrong 2", next: "bad" },
        { text: "wrong 3", next: "bad" },
      ],
    },
    { id: "good", stem: "g", options: [{ text: "end", correct: true }, { text: "stop" }] },
    { id: "bad", stem: "b", options: [{ text: "end", correct: true }, { text: "stop" }] },
  ];
  const { scenario, warnings } = buildBranchedScenario({ id: "subset" }, nodes);
  const byId = Object.fromEntries(scenario.decisions.map((d) => [d.id, d]));
  assert.deepStrictEqual(byId.good.unlockWhen, { afterDecision: { id: "a", option: 0 } });
  assert.deepStrictEqual(byId.bad.unlockWhen, { afterDecision: { id: "a", option: [1, 2, 3] } },
    "3 of 4 choices is a SUBSET — an id-only gate would also open it on choice 0");
  assert.strictEqual(warnings.length, 0);
  const r = validateBranchedGraph(scenario);
  assert.strictEqual(r.ok, true, "errors: " + JSON.stringify(r.errors));
});

/* ------------------------------------------------------------------ */
/* DEFECT A (round 2) — gates the forward-edge model cannot hold      */
/* ------------------------------------------------------------------ */

/* An option carries ONE forward edge; the gate model it reverses is richer
   (branched-validate.js childrenOf() returns EVERY node whose afterDecision
   matches a parent+option). Each of these gates used to be dropped in silence,
   and the node then exported with no unlockWhen at all — becoming a second
   entry node, i.e. a graph the validator ACCEPTS turned into one it REJECTS. */
function branchedCase(id, decisions) {
  return {
    id: id, format: "branched",
    name: { en: id }, summary: { en: "s" }, moduleAName: { en: id },
    case: { history: [], exam: [], labs: [] },
    scoring: {}, penalties: [], synthPrereqs: [],
    decisions: decisions,
  };
}
function bnode(id, texts, extra) {
  return Object.assign({
    id: id, module: "A", points: 10, penalty: 5,
    prompt: { en: id + "?" },
    options: texts.map((t, i) => ({
      text: { en: t }, correct: i === 0,
      branch: { reveal: { en: t + " happens" } },
    })),
  }, extra || {});
}
const gated = (spec) => ({ unlockWhen: { afterDecision: spec }, hideWhenLocked: true });

test("two decisions gating on the SAME parent option both keep their gate", () => {
  const api = loadAuthor();
  const twin = branchedCase("twin-gate", [
    bnode("n0", ["go", "stop"]),
    bnode("twinA", ["end a", "stop a"], gated({ id: "n0", option: 0 })),
    bnode("twinB", ["end b", "stop b"], gated({ id: "n0", option: 0 })),
  ]);
  // The SOURCE is a graph the runtime validator accepts — this is legal data.
  assert.strictEqual(validateBranchedGraph(twin).ok, true,
    "fixture must be legal: " + JSON.stringify(validateBranchedGraph(twin).errors));

  const out = roundTrip(api, twin);
  assert.deepStrictEqual(out, twin);
  // The specific failure: twinA lost its gate and became a second entry node,
  // so the output was INVALID even though the input was valid.
  const r = validateBranchedGraph(out);
  assert.strictEqual(r.ok, true, "errors: " + JSON.stringify(r.errors));
  assert.ok(!r.errors.some((e) => /Multiple entry nodes/.test(e)),
    "the editor must not manufacture a second entry node");
});

test("a gate the editor cannot draw is kept verbatim, and the author is told", () => {
  const api = loadAuthor();
  const cases = {
    // option index outside the parent's options
    "out-of-range": [
      bnode("n0", ["go", "stop"]),
      bnode("child", ["end", "stop"], gated({ id: "n0", option: 7 })),
    ],
    // parent id that resolves to no node
    dangling: [
      bnode("n0", ["go", "stop"]),
      bnode("child", ["end", "stop"], gated({ id: "nope", option: 0 })),
    ],
    // an "any option" gate whose parent's options are all already claimed
    starved: [
      bnode("n0", ["a", "b"]),
      bnode("byIndex0", ["end", "stop"], gated({ id: "n0", option: 0 })),
      bnode("byIndex1", ["end", "stop"], gated({ id: "n0", option: 1 })),
      bnode("anyOpt", ["end", "stop"], gated("n0")),
    ],
  };
  Object.keys(cases).forEach((label) => {
    const src = branchedCase(label, cases[label]);
    assert.deepStrictEqual(roundTrip(api, src), src, label + " must round-trip intact");
  });

  // And it is SURFACED, not silently preserved: the author sees no arrow for
  // that node and would otherwise "fix" a link that is already correct.
  const { buildBranchedScenario } = require(path.join(P, "branched-author.js"));
  const st = api.fromJson(branchedCase("dangling", cases.dangling));
  const { warnings } = buildBranchedScenario(
    { id: "dangling", name: "dangling", shell: st.branchedShell, extra: st.branchedExtra },
    st.branchedNodes,
  );
  assert.ok(warnings.some((w) => /keeps the gate it was loaded with/.test(w) && /child/.test(w)),
    "expected a warning naming the node; got " + JSON.stringify(warnings));
});

test("a PARTIAL claim is never drawn — it would narrow the author's gate", () => {
  const api = loadAuthor();
  /* n0 has 3 choices. `precise` owns choice 0; `any` opens on ANY choice.
     Drawing `any` on the two free options would derive `option:[1,2]` on
     export — quietly dropping choice 0 from a gate the author wrote as
     "whatever they pick". */
  const src = branchedCase("partial", [
    bnode("n0", ["a", "b", "c"]),
    bnode("precise", ["end", "stop"], gated({ id: "n0", option: 0 })),
    bnode("any", ["end", "stop"], gated("n0")),
  ]);
  const out = roundTrip(api, src);
  assert.deepStrictEqual(out.decisions.find((d) => d.id === "any").unlockWhen,
    { afterDecision: "n0" }, "the any-option gate must not narrow to a subset");
  assert.deepStrictEqual(out, src);
});

test("a branched node's module is preserved, not hardcoded to A", () => {
  const api = loadAuthor();
  /* composeBranchedModule() stamps module:"branched" on merged nodes, and
     branched-render.js routes the answers bucket off exactly that value —
     rewriting it to "A" silently re-routes a composed case's deliverables. */
  const src = branchedCase("mod-preserved", [
    bnode("n0", ["go", "stop"]),
    Object.assign(bnode("nB", ["end", "stop"], gated({ id: "n0", option: 0 })),
      { module: "branched" }),
  ]);
  const out = roundTrip(api, src);
  assert.strictEqual(out.decisions[1].module, "branched");
  assert.deepStrictEqual(out, src);
});

test("a node authored from scratch still defaults to module A", () => {
  const { buildBranchedScenario } = require(path.join(P, "branched-author.js"));
  const { scenario } = buildBranchedScenario({ id: "fresh" }, [
    { id: "n0", stem: "s", options: [{ text: "a", correct: true }] },
  ]);
  assert.strictEqual(scenario.decisions[0].module, "A");
});

test("EVERY choice of a parent converging still becomes the id-only gate", () => {
  const { buildBranchedScenario } = require(path.join(P, "branched-author.js"));
  const nodes = [
    { id: "a", stem: "pick", options: [{ text: "l", correct: true, next: "b" }, { text: "r", next: "b" }] },
    { id: "b", stem: "next", options: [{ text: "end", correct: true }, { text: "stop" }] },
  ];
  const { scenario } = buildBranchedScenario({ id: "conv" }, nodes);
  const b = scenario.decisions.find((d) => d.id === "b");
  assert.deepStrictEqual(b.unlockWhen, { afterDecision: "a" });
});

/* ------------------------------------------------------------------ */
/* DEFECT B — the character `module` field                            */
/* ------------------------------------------------------------------ */

/* A one-character scenario in a given format, ready for toJson(). */
function characterScenario(format, moduleText) {
  return {
    id: "cast-test",
    format: format,
    name: { en: "Cast test" },
    summary: { en: "s" },
    moduleAName: format === "roleplay" ? undefined : { en: "Workup" },
    moduleBName: format === "pbl" ? undefined : { en: "Roleplay" },
    modules: format === "pbl" ? ["A"] : format === "roleplay" ? ["B"] : ["A", "B"],
    case: {
      history: [{ q: { en: "q" }, a: { en: "a" } }],
      exam: [{ q: { en: "q" }, a: { en: "a" } }],
      labs: [{ key: true, q: { en: "q" }, a: { en: "a" } }],
      prompts: [{ en: "p" }],
    },
    scoring: {}, penalties: [], decisions: [],
    synthId: "labs:0", synthPrereqs: [],
    characters: [{
      id: "c1", role: "patient", module: moduleText,
      name: { en: "Mr Okada" }, persona: "You are breathless.",
    }],
  };
}

/* WHAT THE USER ACTUALLY GETS: run the emitted scenario through the real
   section-registry and report which sections carry the character. */
function sectionsCarryingCast(json) {
  const out = { pbl: [], roleplay: [] };
  REG.sectionsForScenario(json, "cast").forEach((sec) => {
    if (out[sec.type]) {
      out[sec.type] = ((sec.content || {}).characters || []).map((c) => c.id);
    }
  });
  return out;
}

test("MATRIX: every module value now reaches a section (roleplay scenario)", () => {
  const api = loadAuthor();
  const seen = {};
  ["A", "B", "A,B", "", "a", "b", "BRANCHED"].forEach((v) => {
    const out = roundTrip(api, characterScenario("roleplay", v));
    seen[v === "" ? "<blank>" : v] = {
      emitted: out.characters[0].module,
      routed: sectionsCarryingCast(out),
    };
  });

  // Explicit, correct values are unchanged.
  assert.deepStrictEqual(seen["B"].emitted, ["B"]);
  assert.deepStrictEqual(seen["B"].routed.roleplay, ["c1"]);
  assert.deepStrictEqual(seen["A,B"].emitted, ["A", "B"]);

  // BLANK now means "this section" instead of "nowhere" — the whole defect.
  assert.deepStrictEqual(seen["<blank>"].emitted, ["B"],
    "a roleplay scenario's blank module box must default to B");
  assert.deepStrictEqual(seen["<blank>"].routed.roleplay, ["c1"],
    "the persona must survive an empty module box");

  // Case is folded, because the vocabulary has no case-only ambiguity.
  assert.deepStrictEqual(seen["a"].emitted, ["A"]);
  assert.deepStrictEqual(seen["b"].emitted, ["B"]);
  assert.deepStrictEqual(seen["b"].routed.roleplay, ["c1"], '"b" now routes like "B"');
  assert.deepStrictEqual(seen["BRANCHED"].emitted, ["branched"]);
});

test("a blank module box follows the scenario's own module (pbl / combined)", () => {
  const api = loadAuthor();
  assert.deepStrictEqual(roundTrip(api, characterScenario("pbl", "")).characters[0].module, ["A"]);
  assert.deepStrictEqual(
    roundTrip(api, characterScenario("combined", "")).characters[0].module, ["A", "B"],
    "a legacy two-module scenario keeps the character reachable from either half");
});

test("an UNRECOGNISED module is reported by validate(), not silently dropped", () => {
  const api = loadAuthor();
  const live = api.getState();
  Object.assign(live, api.fromJson(characterScenario("roleplay", "banana")));
  const errs = api.validate();
  assert.ok(errs.some((e) => /banana/.test(e) && /not a module/.test(e)),
    "expected an error naming the bad value; got " + JSON.stringify(errs));
  // And it is emitted VERBATIM, so the preview shows what would actually ship.
  assert.deepStrictEqual(api.toJson().characters[0].module, ["banana"]);
});

test('"branched" on a standard scenario is reported (it matches no section there)', () => {
  const api = loadAuthor();
  const live = api.getState();
  Object.assign(live, api.fromJson(characterScenario("roleplay", "branched")));
  const errs = api.validate();
  assert.ok(errs.some((e) => /branched/.test(e) && /Use A and\/or B/.test(e)),
    "expected the branched-is-not-a-section error; got " + JSON.stringify(errs));
  // The routing that error describes is real.
  assert.deepStrictEqual(sectionsCarryingCast(api.toJson()).roleplay, []);
});

test("a module this scenario does not run is reported", () => {
  const api = loadAuthor();
  const live = api.getState();
  Object.assign(live, api.fromJson(characterScenario("roleplay", "A")));
  const errs = api.validate();
  assert.ok(errs.some((e) => /"A" is not a module this scenario runs/.test(e)),
    "expected the wrong-module error; got " + JSON.stringify(errs));
});

test("a correctly-pointed character raises no character error", () => {
  const api = loadAuthor();
  const live = api.getState();
  Object.assign(live, api.fromJson(characterScenario("roleplay", "B")));
  assert.strictEqual(api.validate().filter((e) => /^Character /.test(e)).length, 0);
  Object.assign(live, api.fromJson(characterScenario("roleplay", "")));
  assert.strictEqual(api.validate().filter((e) => /^Character /.test(e)).length, 0,
    "a blank box is defaulted, not reported");
});

test("the built-in casts still round-trip unchanged (no invented modules)", () => {
  const api = loadAuthor();
  const win = {};
  new Function("window", fs.readFileSync(path.join(P, "case-content.js"), "utf8"))(win);
  Object.keys(win.CANAMED_SCENARIOS).forEach((id) => {
    const orig = win.CANAMED_SCENARIOS[id];
    if (!orig || orig.format === "branched" || !Array.isArray(orig.characters)) return;
    const out = roundTrip(api, orig);
    orig.characters.forEach((c, i) => {
      assert.deepStrictEqual(out.characters[i].module, c.module,
        id + " character " + c.id + ": module must be untouched");
    });
  });
});
