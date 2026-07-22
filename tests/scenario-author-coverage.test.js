/* tests/scenario-author-coverage.test.js
 *
 * Phase 1 (integrity) — the scenario-author round-trip must be LOSSLESS.
 * toScenarioJson() historically emitted only a subset of the scenario shape,
 * so loading a built-in case, tweaking it, and re-exporting SILENTLY DROPPED
 * every field the form has no control for: item group/cite/narratorOnly,
 * decision unlockWhen, option branch.reveal, scoring-family unlocks, the whole
 * scoring.moduleA_questions / moduleA_question_penalties families, and
 * top-level persona / preTest / postTest. A facilitator editing a built-in
 * would corrupt it. The "passthrough bag" (extraKeys/mergeExtra) preserves
 * those fields; this test pins that behaviour.
 *
 * Harness: scenario-author.js is a browser IIFE that exposes
 * window.__scenarioAuthor at the end. We load it with document.readyState =
 * "loading" so its boot() (which needs a real DOM) never fires, then exercise
 * the pure toJson/fromJson via the exposed API by mutating the live STATE
 * reference returned by getState() — no DOM stubbing required.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");

/* Load the IIFE with a minimal window/document, boot() deferred (never fires). */
function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  // Bare `window`/`document` inside the IIFE resolve to these params.
  const factory = new Function("window", "document", JS);
  factory(win, doc);
  const api = win.__scenarioAuthor;
  assert.ok(api && typeof api.toJson === "function" && typeof api.fromJson === "function",
    "scenario-author.js must expose window.__scenarioAuthor.{toJson,fromJson}");
  return api;
}

/* Run a scenario object through fromJson → toJson without touching the DOM:
   parse it, replace the live STATE reference's contents, then serialise. */
function roundTrip(api, scenario) {
  const parsed = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, parsed);
  return api.toJson();
}

const T = (en, fr, ja) => ({ en, fr, ja }); // full trio (asTrio normalises to all 3)

/* A normalisation-stable fixture that carries EVERY field the standard editor
   does not model, so a lossless round-trip must reproduce it exactly. */
function makeFixture() {
  return {
    id: "roundtrip-fixture",
    name: T("Round-trip fixture", "Fixture aller-retour", "往復フィクスチャ"),
    summary: T("s-en", "s-fr", "s-ja"),
    moduleAName: T("A-en", "A-fr", "A-ja"),
    moduleBName: T("B-en", "B-fr", "B-ja"),
    synthId: "labs:0",
    synthPrereqs: ["history:0", "exam:0"],
    case: {
      history: [
        { group: "hx", q: T("q1en", "q1fr", "q1ja"), a: T("a1en", "a1fr", "a1ja"), cite: "src-1", narratorOnly: true }
      ],
      exam: [
        { group: "ex", q: T("q2en", "q2fr", "q2ja"), a: T("a2en", "a2fr", "a2ja") }
      ],
      labs: [
        { group: "lb", key: true, q: T("q3en", "q3fr", "q3ja"), a: T("a3en", "a3fr", "a3ja"), cite: "src-3" }
      ],
      prompts: [T("p1en", "p1fr", "p1ja")]
    },
    scoring: {
      moduleA: [{ id: "fam-a", points: 5, label: T("la-en", "la-fr", "la-ja"), any: ["stem1", "stem2"], unlocks: "labs:0" }],
      moduleB: [{ id: "fam-b", points: 4, label: T("lb-en", "lb-fr", "lb-ja"), cohorts: true }],
      moduleA_questions: [
        { id: "q-fam", points: 3, label: T("qa-en", "qa-fr", "qa-ja"), any: ["how long", "duration"], unlocks: "history:0" }
      ],
      moduleA_question_penalties: [
        { id: "qp-fam", points: 2, label: T("qp-en", "qp-fr", "qp-ja"), any: ["opioid", "oxycodone"] }
      ]
    },
    penalties: [
      { id: "pen1", item: "labs:0", points: 6, title: T("t-en", "t-fr", "t-ja"), why: T("w-en", "w-fr", "w-ja") }
    ],
    decisions: [
      {
        id: "dec1", module: "A", points: 10, penalty: 5, prompt: T("d-en", "d-fr", "d-ja"),
        unlockWhen: { hypotheses: 2 },
        options: [
          { text: T("o1en", "o1fr", "o1ja"), correct: true, why: T("wy1en", "wy1fr", "wy1ja"), branch: { reveal: T("r-en", "r-fr", "r-ja") } },
          { text: T("o2en", "o2fr", "o2ja"), correct: false, why: T("wy2en", "wy2fr", "wy2ja") }
        ]
      }
    ],
    preTest: [
      { id: "pre1", q: T("pq-en", "pq-fr", "pq-ja"), options: [{ text: T("x", "x", "x"), correct: true }, { text: T("y", "y", "y"), correct: false }], explanation: T("e-en", "e-fr", "e-ja") }
    ],
    postTest: [
      { id: "post1", q: T("poq-en", "poq-fr", "poq-ja"), options: [{ text: T("m", "m", "m"), correct: false }, { text: T("n", "n", "n"), correct: true }], explanation: T("pe-en", "pe-fr", "pe-ja") }
    ],
    persona: { name: T("Ms. Test", "Mme Test", "テストさん"), identity: T("pid-en", "pid-fr", "pid-ja") }
  };
}

test("scenario-author.js exposes the round-trip API without a DOM", () => {
  const api = loadAuthor();
  assert.strictEqual(typeof api.getState, "function");
});

test("round-trip is lossless for a fixture carrying every unmodeled field", () => {
  const api = loadAuthor();
  const fixture = makeFixture();
  const out = roundTrip(api, fixture);
  assert.deepStrictEqual(out, fixture);
});

test("previously-dropped fields survive the round-trip (targeted)", () => {
  const api = loadAuthor();
  const out = roundTrip(api, makeFixture());
  // item-level passthrough
  assert.strictEqual(out.case.history[0].group, "hx");
  assert.strictEqual(out.case.history[0].cite, "src-1");
  assert.strictEqual(out.case.history[0].narratorOnly, true);
  assert.strictEqual(out.case.labs[0].group, "lb");
  // decision + option passthrough
  assert.deepStrictEqual(out.decisions[0].unlockWhen, { hypotheses: 2 });
  assert.deepStrictEqual(out.decisions[0].options[0].branch, { reveal: { en: "r-en", fr: "r-fr", ja: "r-ja" } });
  // scoring passthrough
  assert.strictEqual(out.scoring.moduleA[0].unlocks, "labs:0");
  assert.ok(Array.isArray(out.scoring.moduleA_questions), "moduleA_questions preserved");
  assert.ok(Array.isArray(out.scoring.moduleA_question_penalties), "moduleA_question_penalties preserved");
  // top-level passthrough
  assert.ok(Array.isArray(out.preTest) && out.preTest.length === 1, "preTest preserved");
  assert.ok(Array.isArray(out.postTest) && out.postTest.length === 1, "postTest preserved");
  assert.ok(out.persona && out.persona.identity.en === "pid-en", "persona preserved");
});

/* Load the real built-in scenarios (pure data on window, no DOM). */
function loadBuiltins() {
  const win = {};
  const CC = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  new Function("window", CC)(win);
  assert.ok(win.CANAMED_SCENARIOS, "case-content.js must expose CANAMED_SCENARIOS");
  return win;
}

test("real built-in scenarios round-trip without dropping known fields", () => {
  const api = loadAuthor();
  const win = loadBuiltins();
  const scenarios = win.CANAMED_SCENARIOS;
  // The fields the OLD serialiser silently dropped. For each built-in, any of
  // these present in the source must still be present after a round-trip.
  const guarded = ["narratorOnly", "group", "cite", "unlocks",
    "moduleA_questions", "moduleA_question_penalties", "branch", "unlockWhen",
    "preTest", "postTest", "persona"];
  const ids = Object.keys(scenarios);
  assert.ok(ids.length > 0, "expected at least one built-in scenario");
  ids.forEach((id) => {
    const orig = scenarios[id];
    if (orig && orig.format === "branched") return; // separate serialiser
    const origStr = JSON.stringify(orig);
    const outStr = JSON.stringify(roundTrip(api, orig));
    guarded.forEach((field) => {
      const tag = '"' + field + '"';
      if (origStr.includes(tag)) {
        assert.ok(outStr.includes(tag),
          "scenario '" + id + "': field " + field + " must survive the round-trip");
      }
    });
  });
});

test("Phase 3: moduleA_questions / moduleA_question_penalties + unlocks are modeled", () => {
  const api = loadAuthor();
  const scenario = {
    id: "chat-scoring", name: T("Chat", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""),
    synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: {
      moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["walk"], unlocks: "labs:0" }],
      moduleB: [{ id: "fb", points: 4, label: T("l", "", ""), cohorts: true }],
      moduleA_questions: [{ id: "cq", points: 3, label: T("cl", "", ""), any: ["how long", "onset"], unlocks: "history:0" }],
      moduleA_question_penalties: [{ id: "cp", points: 2, label: T("pl", "", ""), any: ["prescribe", "oxycodone"] }]
    },
    penalties: [], decisions: []
  };

  // fromJson populates the dedicated STATE arrays + the unlocks field, and does
  // NOT stash the chat families in the passthrough bag (they are now modeled).
  const st = api.fromJson(scenario);
  assert.strictEqual(st.scoringAQ.length, 1);
  assert.strictEqual(st.scoringAQP.length, 1);
  assert.strictEqual(st.scoringA[0].unlocks, "labs:0");
  assert.strictEqual(st.scoringAQ[0].unlocks, "history:0");
  assert.ok(!("moduleA_questions" in (st._scoringExtra || {})),
    "moduleA_questions must be modeled, not captured in _scoringExtra");

  // Round-trip is lossless for the chat families + the unlocks field.
  const out = roundTrip(api, scenario);
  assert.deepStrictEqual(out.scoring.moduleA_questions, scenario.scoring.moduleA_questions);
  assert.deepStrictEqual(out.scoring.moduleA_question_penalties, scenario.scoring.moduleA_question_penalties);
  assert.strictEqual(out.scoring.moduleA[0].unlocks, "labs:0");
});

test("Phase 3: empty chat-scoring families are omitted from the export", () => {
  const api = loadAuthor();
  const minimal = {
    id: "no-chat", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""),
    synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [], decisions: []
  };
  const out = roundTrip(api, minimal);
  assert.ok(!("moduleA_questions" in out.scoring), "no moduleA_questions key when none authored");
  assert.ok(!("moduleA_question_penalties" in out.scoring), "no penalties key when none authored");
});

test("Phase 3: validate() flags a chat-scoring family with no stems and a bad unlocks", () => {
  const api = loadAuthor();
  const bad = {
    id: "bad-chat", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""),
    synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: {
      moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }],
      moduleB: [],
      moduleA_questions: [{ id: "cq", points: 3, label: T("cl", "", ""), any: [], unlocks: "nonsense" }]
    },
    penalties: [], decisions: []
  };
  const st = api.fromJson(bad);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, st);
  const errs = api.validate();
  assert.ok(errs.some((e) => /moduleA_questions.*stem|moduleA_questions.*cohorts/.test(e)),
    "must flag a chat family with neither stems nor cohorts");
  assert.ok(errs.some((e) => /unlocks 'nonsense'/.test(e)),
    "must flag an unlocks that isn't group:index");
});

test("Phase 3: decision branch.reveal + unlockWhen are modeled and preserve unknown sub-keys", () => {
  const api = loadAuthor();
  const scenario = {
    id: "branchy", name: T("B", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""),
    synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [],
    decisions: [{
      id: "d1", module: "A", points: 10, penalty: 5, prompt: T("dp", "", ""),
      // includes a key the editor does NOT model (customGate) — must survive.
      unlockWhen: { hypotheses: 2, afterDecision: "d0", customGate: true },
      options: [
        // branch with a non-reveal key (goto) — must survive.
        { text: T("o1", "", ""), correct: true, why: T("w1", "", ""), branch: { reveal: T("r1", "", ""), goto: "nodeX" } },
        { text: T("o2", "", ""), correct: false, why: T("w2", "", "") }
      ]
    }]
  };

  const st = api.fromJson(scenario);
  assert.deepStrictEqual(st.decisions[0].unlockWhen, { hypotheses: 2, afterDecision: "d0", customGate: true });
  assert.deepStrictEqual(st.decisions[0].options[0].branch, { reveal: { en: "r1", fr: "", ja: "" }, goto: "nodeX" });
  assert.strictEqual(st.decisions[0].options[1].branch, null);
  assert.ok(!("unlockWhen" in (st.decisions[0]._extra || {})), "unlockWhen must be modeled, not passthrough");
  assert.ok(!("branch" in (st.decisions[0].options[0]._extra || {})), "branch must be modeled, not passthrough");

  const out = roundTrip(api, scenario);
  assert.deepStrictEqual(out.decisions[0].unlockWhen, { hypotheses: 2, afterDecision: "d0", customGate: true });
  assert.deepStrictEqual(out.decisions[0].options[0].branch, { reveal: { en: "r1", fr: "", ja: "" }, goto: "nodeX" });
  assert.ok(!("branch" in out.decisions[0].options[1]), "option with no branch stays branch-less");
});

test("Phase 3: preTest / postTest are modeled and round-trip losslessly", () => {
  const api = loadAuthor();
  const q = (id) => ({
    id, q: T("stem", "", ""),
    options: [{ text: T("a", "", ""), correct: true }, { text: T("b", "", ""), correct: false }],
    explanation: T("because", "", "")
  });
  const scenario = {
    id: "tested", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""),
    synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [], decisions: [],
    preTest: [q("pre1"), q("pre2")],
    postTest: [q("post1")]
  };
  const st = api.fromJson(scenario);
  assert.strictEqual(st.preTest.length, 2);
  assert.strictEqual(st.postTest.length, 1);
  assert.ok(!("preTest" in (st._extra || {})), "preTest must be modeled, not captured in _extra");
  const out = roundTrip(api, scenario);
  assert.deepStrictEqual(out.preTest, scenario.preTest);
  assert.deepStrictEqual(out.postTest, scenario.postTest);
});

test("Phase 3: empty pre/post tests are omitted; validate flags a bad question", () => {
  const api = loadAuthor();
  const base = {
    id: "t2", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""), synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [], decisions: []
  };
  const out = roundTrip(api, base);
  assert.ok(!("preTest" in out), "no preTest key when none authored");
  assert.ok(!("postTest" in out), "no postTest key when none authored");

  const bad = Object.assign({}, base, {
    preTest: [{
      id: "p1", q: T("", "", ""),
      options: [{ text: T("a", "", ""), correct: false }, { text: T("b", "", ""), correct: false }],
      explanation: T("e", "", "")
    }]
  });
  const st = api.fromJson(bad);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, st);
  const errs = api.validate();
  assert.ok(errs.some((e) => /preTest\[0\] needs an English question/.test(e)));
  assert.ok(errs.some((e) => /preTest\[0\] has no option marked correct/.test(e)));
});

test("Phase 3: characters are modeled — trio persona, string persona, module array, unknown key", () => {
  const api = loadAuthor();
  const scenario = {
    id: "cast", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""),
    synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [], decisions: [],
    characters: [
      // trio persona (like Lefebvre) + a future/unknown key that must survive
      {
        id: "patient", role: "patient", module: ["A"], present: "start",
        name: T("Mr Trio", "M. Trio", "トリオ氏"), blurb: T("blurb", "", ""),
        persona: T("You are Mr Trio.", "Vous êtes M. Trio.", "あなたはトリオ氏です。"),
        example: T("Doctor: hi\nMr Trio: hello", "", ""), schemaVersion: 2
      },
      // string persona (like Tanaka) — English only, must stay a string
      { id: "relative", role: "relative", module: ["A"], present: "start",
        name: T("The Daughter", "", ""), persona: "You are the worried daughter." }
    ]
  };

  const st = api.fromJson(scenario);
  assert.strictEqual(st.characters.length, 2);
  assert.strictEqual(st.characters[0].personaWasString, false);
  assert.strictEqual(st.characters[1].personaWasString, true);
  assert.strictEqual(st.characters[0].module, "A"); // array joined for editing
  assert.ok(!("characters" in (st._extra || {})), "characters must be modeled, not captured in _extra");

  const out = roundTrip(api, scenario);
  assert.deepStrictEqual(out.characters[0].persona, scenario.characters[0].persona); // trio stays trio
  assert.strictEqual(typeof out.characters[1].persona, "string");                    // string stays string
  assert.strictEqual(out.characters[1].persona, "You are the worried daughter.");
  assert.deepStrictEqual(out.characters[0].module, ["A"]);                           // array restored
  assert.strictEqual(out.characters[0].schemaVersion, 2);                            // unknown key preserved
  assert.ok(!("example" in out.characters[1]), "no example emitted when none authored");
});

test("Phase 3: real built-in characters round-trip faithfully (trio + string personas)", () => {
  const api = loadAuthor();
  const win = loadBuiltins();
  const scenarios = win.CANAMED_SCENARIOS;
  Object.keys(scenarios).forEach((id) => {
    const orig = scenarios[id];
    if (!Array.isArray(orig.characters) || orig.format === "branched") return;
    const out = roundTrip(api, orig);
    assert.deepStrictEqual(out.characters, orig.characters,
      "scenario '" + id + "' characters must survive the round-trip unchanged");
  });
});

test("Phase 3: validate() requires a patient character to have an id, name, and persona", () => {
  const api = loadAuthor();
  const bad = {
    id: "novoice", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""), synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [], decisions: [],
    characters: [{ id: "", role: "patient", module: ["A"], name: T("", "", ""), persona: "" }]
  };
  const st = api.fromJson(bad);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, st);
  const errs = api.validate();
  assert.ok(errs.some((e) => /characters\[0\] is missing an id/.test(e)));
  assert.ok(errs.some((e) => /characters\[0\] needs an English name/.test(e)));
  assert.ok(errs.some((e) => /role=patient.*needs a persona/.test(e)));
});

test("Phase 3 (review): validate() resolves unlockWhen.afterDecision + flags duplicate test ids", () => {
  const api = loadAuthor();
  const mkOpt = (t, c) => ({ text: T(t, "", ""), correct: c, why: T(t + "-why", "", "") });
  const mkQ = (id) => ({
    id, q: T("stem", "", ""),
    options: [{ text: T("a", "", ""), correct: true }, { text: T("b", "", ""), correct: false }],
    explanation: T("e", "", "")
  });
  const scenario = {
    id: "rev", name: T("N", "", ""), summary: T("s", "", ""),
    moduleAName: T("A", "", ""), moduleBName: T("B", "", ""), synthId: "labs:0", synthPrereqs: [],
    case: {
      history: [{ q: T("q", "", ""), a: T("a", "", "") }],
      exam: [{ q: T("q", "", ""), a: T("a", "", "") }],
      labs: [{ key: true, q: T("q", "", ""), a: T("a", "", "") }],
      prompts: [T("p", "", "")]
    },
    scoring: { moduleA: [{ id: "fa", points: 5, label: T("l", "", ""), any: ["x"] }], moduleB: [] },
    penalties: [],
    decisions: [
      { id: "d1", module: "A", points: 10, penalty: 5, prompt: T("p", "", ""),
        unlockWhen: { afterDecision: "d1" }, options: [mkOpt("o", true), mkOpt("o2", false)] },
      { id: "d2", module: "A", points: 10, penalty: 5, prompt: T("p", "", ""),
        unlockWhen: { afterDecision: "ghost", examRevealed: 99 }, options: [mkOpt("o", true), mkOpt("o2", false)] }
    ],
    preTest: [mkQ("q1"), mkQ("q1")] // duplicate ids
  };
  const st = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, st);
  const errs = api.validate();
  assert.ok(errs.some((e) => /d1.*afterDecision refers to itself/.test(e)), "self-reference flagged");
  assert.ok(errs.some((e) => /afterDecision 'ghost' is not an existing decision id/.test(e)), "dangling afterDecision flagged");
  assert.ok(errs.some((e) => /examRevealed \(99\) exceeds/.test(e)), "over-count exam gate flagged");
  assert.ok(errs.some((e) => /preTest has duplicate id 'q1'/.test(e)), "duplicate preTest id flagged");
});

test("the passthrough helpers are wired into (de)serialisation", () => {
  assert.match(JS, /function extraKeys\(/, "extraKeys helper must exist");
  assert.match(JS, /function mergeExtra\(/, "mergeExtra helper must exist");
  // toScenarioJson merges the top-level extra bag onto the assembled scenario
  assert.match(JS, /mergeExtra\(scenarioOut,\s*STATE\._extra\)/, "top-level export must merge STATE._extra");
  // parse side captures the extra bags
  assert.match(JS, /s\._extra\s*=\s*extraKeys\(obj,/, "scenarioJsonToState must capture top-level extras");
  assert.match(JS, /s\._scoringExtra\s*=\s*extraKeys\(sc,/, "scenarioJsonToState must capture scoring extras");
});
