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

test("the passthrough helpers are wired into (de)serialisation", () => {
  assert.match(JS, /function extraKeys\(/, "extraKeys helper must exist");
  assert.match(JS, /function mergeExtra\(/, "mergeExtra helper must exist");
  // toScenarioJson merges the top-level extra bag
  assert.match(JS, /mergeExtra\(\{[\s\S]{0,400}?\},\s*STATE\._extra\)/, "top-level export must merge STATE._extra");
  // parse side captures the extra bags
  assert.match(JS, /s\._extra\s*=\s*extraKeys\(obj,/, "scenarioJsonToState must capture top-level extras");
  assert.match(JS, /s\._scoringExtra\s*=\s*extraKeys\(sc,/, "scenarioJsonToState must capture scoring extras");
});
