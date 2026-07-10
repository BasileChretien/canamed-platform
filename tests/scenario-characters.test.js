/* tests/scenario-characters.test.js
 *
 * Slice 0 of the facilitator-authored-scenario work: the LLM persona comes from
 * the scenario, not from a constant.
 *
 * Regression guard for the production bug this replaced — every scenario voiced
 * "Mr Lefebvre, 45-year-old office worker who wants oxycodone" while quoting the
 * applied scenario's facts, because PATIENT_IDENTITY was hardcoded in
 * modA-llm-prompts.js while CASE.history[] was swapped by applyScenario().
 *
 * Static / off-network like the rest of tests/.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");

/* Load case-content.js + modA-llm-prompts.js into a shared `window` shim, the
 * same way tests/modA-llm-bridge.test.js does. */
function loadPrompts() {
  const ctx = {};
  ctx.module = { exports: {} };

  let caseSrc = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  caseSrc += "\nthis.CASE = CASE;";
  new Function("window", "self", "module", caseSrc).call(ctx, ctx, ctx, ctx.module);

  const src = fs.readFileSync(path.join(P, "modA-llm-prompts.js"), "utf8");
  new Function("window", "self", "module", src).call(ctx, ctx, ctx, ctx.module);

  return ctx;
}

/* Mirror of applyScenario() in script.js: swap the case AND the cast. */
function applyScenario(ctx, id) {
  const sc = ctx.CANAMED_SCENARIOS[id];
  assert.ok(sc, "scenario " + id + " exists");
  ctx.CASE = sc.case;
  ctx.CURRENT_SCENARIO_CHARACTERS = Array.isArray(sc.characters) ? sc.characters : null;
  return sc;
}

// ---------------------------------------------------------------- schema ----

test("every built-in scenario declares exactly one index patient", () => {
  const ctx = loadPrompts();
  const ids = Object.keys(ctx.CANAMED_SCENARIOS);
  assert.ok(ids.length >= 3, "at least the three built-ins");

  for (const id of ids) {
    const chars = ctx.CANAMED_SCENARIOS[id].characters;
    assert.ok(Array.isArray(chars) && chars.length, id + " declares characters[]");

    const patients = chars.filter(c => c.role === "patient");
    assert.equal(patients.length, 1, id + " has exactly one role:'patient'");

    for (const c of chars) {
      assert.ok(c.id, id + "/" + c.id + " has an id");
      assert.ok(c.name, id + "/" + c.id + " has a name");
      const persona = typeof c.persona === "string" ? c.persona : (c.persona && c.persona.en);
      assert.ok(persona && persona.length > 200,
        id + "/" + c.id + " has a substantive persona");
    }
  }
});

test("case-content seeds the default scenario's cast on window", () => {
  const ctx = loadPrompts();
  assert.ok(Array.isArray(ctx.CURRENT_SCENARIO_CHARACTERS));
  assert.equal(ctx.CURRENT_SCENARIO_CHARACTERS[0].name.en, "Mr Lefebvre");
});

// -------------------------------------------------------------- the bug -----

test("each scenario's prompt names its OWN patient and no other", () => {
  const expected = {
    "chronic-pain-opioids":         { name: "Lefebvre", strangers: ["Tanaka", "Moreau"] },
    "breaking-bad-news-disclosure": { name: "Tanaka",   strangers: ["Lefebvre", "Moreau"] },
    "respiratory-stewardship":      { name: "Moreau",   strangers: ["Lefebvre", "Tanaka"] }
  };

  for (const [id, want] of Object.entries(expected)) {
    const ctx = loadPrompts();
    applyScenario(ctx, id);
    const prompt = ctx.modALLMPrompts.buildPatientPrompt("en");

    assert.ok(prompt.includes(want.name), id + " prompt names " + want.name);
    for (const stranger of want.strangers) {
      assert.ok(!prompt.includes(stranger),
        id + " prompt must not mention " + stranger);
    }
  }
});

test("the opioid stance does not bleed into the other scenarios", () => {
  // Scenario 1's persona is the only one that should ask for oxycodone. Before
  // slice 0, Mrs Tanaka demanded it too.
  for (const id of ["breaking-bad-news-disclosure", "respiratory-stewardship"]) {
    const ctx = loadPrompts();
    applyScenario(ctx, id);
    const prompt = ctx.modALLMPrompts.buildPatientPrompt("en").toLowerCase();
    assert.ok(!prompt.includes("oxycodone"), id + " must not mention oxycodone");
    assert.ok(!prompt.includes("office worker"), id + " must not be an office worker");
  }
});

test("facts still come from the applied scenario's history", () => {
  const ctx = loadPrompts();
  applyScenario(ctx, "breaking-bad-news-disclosure");
  const prompt = ctx.modALLMPrompts.buildPatientPrompt("en");
  assert.ok(prompt.includes("yellow"), "Tanaka's jaundice history is in <facts>");
  assert.ok(!prompt.includes("back pain"), "Lefebvre's history is not");
});

test("the Module B patient must not know her own diagnosis", () => {
  // The whole point of the case is that the doctor breaks the news to her.
  const ctx = loadPrompts();
  applyScenario(ctx, "breaking-bad-news-disclosure");
  const persona = ctx.modALLMPrompts.findCharacter().persona;
  assert.ok(/never name one|do NOT know what is wrong/i.test(persona),
    "persona forbids naming a diagnosis");
});

// ------------------------------------------------------------- fallbacks ----

test("a scenario with no characters falls back to a generic patient", () => {
  const ctx = loadPrompts();
  ctx.CASE = ctx.CANAMED_SCENARIOS["breaking-bad-news-disclosure"].case;
  ctx.CURRENT_SCENARIO_CHARACTERS = null;   // v1 scenario pasted as custom JSON

  const prompt = ctx.modALLMPrompts.buildPatientPrompt("en");
  assert.ok(!prompt.includes("Lefebvre"),
    "a v1 custom scenario must NOT inherit the previous cast");
  assert.ok(prompt.includes("the patient"), "generic identity is used");
  assert.ok(prompt.includes("yellow"), "its own facts are still loaded");
});

test("characterName resolves per language, with a neutral default", () => {
  const ctx = loadPrompts();
  applyScenario(ctx, "chronic-pain-opioids");
  assert.equal(ctx.modALLMPrompts.characterName("en"), "Mr Lefebvre");
  assert.equal(ctx.modALLMPrompts.characterName("ja"), "ルフェーブル氏");

  ctx.CURRENT_SCENARIO_CHARACTERS = null;
  assert.equal(ctx.modALLMPrompts.characterName("en"), "the patient");
});

test("a history item owned by another character is withheld", () => {
  const ctx = loadPrompts();
  const prompt = ctx.modALLMPrompts.buildPatientPrompt("en", {
    character: { id: "patient", role: "patient", name: "Mr Doe", persona: "You are Mr Doe." },
    caseObj: {
      history: [
        { q: "How long?", a: "Six weeks of cough." },
        { q: "Her mood?", a: "She has been very low since her husband died.", who: "daughter" },
        { q: "Stage direction", a: "He flinches.", narratorOnly: true }
      ]
    }
  });
  assert.ok(prompt.includes("Six weeks of cough"), "own fact is present");
  assert.ok(!prompt.includes("very low since"), "the daughter's fact is withheld");
  assert.ok(!prompt.includes("flinches"), "narratorOnly is still excluded");
});

test("an explicit character.facts entry reaches the facts block", () => {
  const ctx = loadPrompts();
  const prompt = ctx.modALLMPrompts.buildPatientPrompt("en", {
    character: {
      id: "nurse", role: "colleague", name: "Nurse Ada", persona: "You are Nurse Ada.",
      facts: ["Her blood pressure was 96 over 60 at triage."]
    },
    caseObj: { history: [] }
  });
  assert.ok(prompt.includes("96 over 60"));
  assert.ok(prompt.includes("Nurse Ada"));
});

// ------------------------------------------- server guard + reply stripper ---

const hf = require("../docs/Third_session/PBL_platform/functions/lib/hf-helpers.js");

test("SERVER_GUARD covers non-patient characters", () => {
  assert.ok(/simulated character/i.test(hf.SERVER_GUARD));
  assert.ok(/relative/i.test(hf.SERVER_GUARD));
  assert.ok(!/simulated patient/i.test(hf.SERVER_GUARD),
    "a nurse is not a 'simulated patient'");
});

test("safeCharacterName rejects anything that could alter a RegExp", () => {
  assert.equal(hf.safeCharacterName("Mr Lefebvre"), "Mr Lefebvre");
  assert.equal(hf.safeCharacterName("Mme O’Brien-Dupont"), "Mme O’Brien-Dupont");
  assert.equal(hf.safeCharacterName("田中さん"), "田中さん");
  assert.equal(hf.safeCharacterName("evil(.*)"), "");
  assert.equal(hf.safeCharacterName("a".repeat(41)), "");
  assert.equal(hf.safeCharacterName(null), "");
});

test("buildRolePrefixRe strips the scenario's own character name", () => {
  const strip = (name, s) => s.replace(hf.buildRolePrefixRe(name), "");

  // honorific dot present in the model's output but not in the scenario name
  assert.equal(strip("Mr Lefebvre", "Mr. Lefebvre: It hurts."), "It hurts.");
  assert.equal(strip("Mr Lefebvre", "**Mr Lefebvre**: hello"), "hello");
  assert.equal(strip("Mrs Tanaka", "Mrs. Tanaka, age 75: I am tired."), "I am tired.");
  assert.equal(strip("Mme Moreau", "Mme Moreau: My throat hurts."), "My throat hurts.");

  // generic role words keep working with or without a name
  assert.equal(strip("Mrs Tanaka", "Patient: fine."), "fine.");
  assert.equal(strip("", "Patient: fine."), "fine.");

  // a name-shaped body must survive untouched
  assert.equal(strip("Mrs Tanaka", "Mrs Tanaka is my mother."), "Mrs Tanaka is my mother.");
});

test("an unsafe name degrades to the generic stripper, it does not throw", () => {
  const re = hf.buildRolePrefixRe("evil(.*)");
  assert.equal("Patient: ok".replace(re, ""), "ok");
  assert.equal("Mr X: ok".replace(re, ""), "Mr X: ok");
});

// -------------------------------------------------------------------- i18n ---

test("the chat chrome names the scenario's patient, not Mr Lefebvre", () => {
  const KEYS = ["modA.chart.title", "modA.chart.team-click-warning",
                "modA.chat.disclosure", "modA.chat.placeholder",
                "modA.chat.thinking", "modA.coach.read-case"];

  const saved = { window: global.window, self: global.self };
  global.window = undefined;
  global.self = undefined;
  delete require.cache[require.resolve("../docs/Third_session/PBL_platform/i18n.js")];
  const i18n = require("../docs/Third_session/PBL_platform/i18n.js");

  try {
    for (const k of KEYS) {
      assert.ok(i18n._T.en[k].includes("{patientName}"),
        k + " must carry the {patientName} placeholder");
      assert.ok(!/Lefebvre/.test(i18n._T.en[k]), k + " must not hardcode a name");
    }

    global.CURRENT_SCENARIO_CHARACTERS = [{ role: "patient", name: { en: "Mrs Tanaka" } }];
    assert.equal(i18n.t("modA.chat.thinking"), "Mrs Tanaka is thinking…");
    assert.ok(i18n.t("modA.chat.placeholder").includes("Ask Mrs Tanaka"));

    global.CURRENT_SCENARIO_CHARACTERS = null;
    assert.equal(i18n.t("modA.chat.thinking"), "the patient is thinking…",
      "no cast → a neutral noun, never a raw {patientName}");
  } finally {
    delete global.CURRENT_SCENARIO_CHARACTERS;
    global.window = saved.window;
    global.self = saved.self;
  }
});
