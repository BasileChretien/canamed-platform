/* tests/scenario-cast-leak.test.js
 *
 * Regression for a production report: in a Chronic-Pain (Mr Lefebvre) session,
 * one student's Module A patient chat voiced "Mrs Tanaka" — the breaking-bad-news
 * patient. Root cause: CURRENT_SCENARIO_CHARACTERS (+ CASE, …) is a mutable
 * global, and loadSessionScenario() had three paths that returned WITHOUT
 * re-applying a scenario — a session with no scenarioId, a failed scenarioRef,
 * and the .catch. On those paths the client KEPT whatever cast a PRIOR session
 * had left in the tab. A student whose tab earlier ran breaking-bad-news, then
 * joined a chronic-pain session whose scenario read fell through, therefore kept
 * the Tanaka cast.
 *
 * The fix: every resolution path ends on a DETERMINISTIC scenario —
 * applyDefaultScenario() re-applies window.CANAMED_DEFAULT_SCENARIO_ID whenever
 * no usable scenario applied, so a prior session's cast can never leak.
 *
 * Static / off-network like the rest of tests/: case-content.js is executed in a
 * window shim (its cast data is the invariant the fix relies on), and script.js
 * is asserted structurally (the repo tests it as text — see branching-cases.test.js).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

/* Execute case-content.js + modA-llm-prompts.js into a shared window shim, the
 * same way scenario-characters.test.js does. */
function loadPrompts() {
  const ctx = { module: { exports: {} } };
  let caseSrc = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  caseSrc += "\nthis.CASE = CASE;";
  new Function("window", "self", "module", caseSrc).call(ctx, ctx, ctx, ctx.module);
  const src = fs.readFileSync(path.join(P, "modA-llm-prompts.js"), "utf8");
  new Function("window", "self", "module", src).call(ctx, ctx, ctx, ctx.module);
  return ctx;
}

/* Mirror of applyScenario() in script.js — swap the case AND the cast. */
function applyScenario(ctx, id) {
  const sc = ctx.CANAMED_SCENARIOS[id];
  assert.ok(sc, "scenario " + id + " exists");
  ctx.CASE = sc.case;
  ctx.CURRENT_SCENARIO_CHARACTERS = Array.isArray(sc.characters) ? sc.characters : null;
  return sc;
}

// ---- the data invariant the fix relies on -------------------------------------

test("the platform default scenario is the chronic-pain / Mr Lefebvre case", () => {
  const ctx = loadPrompts();
  assert.equal(ctx.CANAMED_DEFAULT_SCENARIO_ID, "chronic-pain-opioids",
    "applyDefaultScenario() falls back to this id");
  const def = ctx.CANAMED_SCENARIOS[ctx.CANAMED_DEFAULT_SCENARIO_ID];
  const patient = def.characters.find(c => c.role === "patient");
  assert.equal(patient.name.en, "Mr Lefebvre");
});

test("re-applying the default clears a prior session's cast (Tanaka → Lefebvre)", () => {
  const ctx = loadPrompts();

  // A student's tab ran the breaking-bad-news case first — the cast is Mrs Tanaka.
  applyScenario(ctx, "breaking-bad-news-disclosure");
  assert.equal(ctx.modALLMPrompts.characterName("en"), "Mrs Tanaka");

  // They then join a session that pins no usable scenario (missing field / read
  // error). The fix re-applies the platform default INSTEAD of keeping the stale
  // cast — which must land back on the chronic-pain patient, not Mrs Tanaka.
  applyScenario(ctx, ctx.CANAMED_DEFAULT_SCENARIO_ID);
  assert.equal(ctx.modALLMPrompts.characterName("en"), "Mr Lefebvre",
    "the default cast overwrites the leaked Tanaka cast");

  // And the built patient prompt names only Lefebvre — no Tanaka bleed-through.
  const prompt = ctx.modALLMPrompts.buildPatientPrompt("en");
  assert.ok(prompt.includes("Lefebvre") && !prompt.includes("Tanaka"),
    "the persona is fully back to the chronic-pain patient");
});

// ---- the script.js fix is wired -----------------------------------------------

test("applyDefaultScenario() re-applies the platform default scenario", () => {
  assert.match(SCRIPT, /function applyDefaultScenario\s*\(/,
    "applyDefaultScenario() must exist");
  const at = SCRIPT.indexOf("function applyDefaultScenario");
  const body = SCRIPT.slice(at, SCRIPT.indexOf("\n}", at) + 2);
  assert.match(body, /CANAMED_DEFAULT_SCENARIO_ID/, "must read the default scenario id");
  assert.match(body, /applyScenario\(/, "must apply it through applyScenario");
});

test("loadSessionScenario never keeps a prior session's cast (no stale-cast leak)", () => {
  const at = SCRIPT.indexOf("function loadSessionScenario");
  assert.ok(at !== -1, "loadSessionScenario must exist");
  const fnBody = SCRIPT.slice(at, SCRIPT.indexOf("\nfunction ", at + 1));

  // the old leak — "keep whatever default case-content loaded" then `return false`
  // on the fallback/catch — must be gone.
  assert.ok(!/keep whatever default case-content loaded/.test(fnBody),
    "the stale-cast fallback must be replaced");

  // both the no-scenario fallback AND the .catch must re-apply the default.
  const applies = (fnBody.match(/applyDefaultScenario\(\)/g) || []).length;
  assert.ok(applies >= 2,
    "the fallback and the catch must both call applyDefaultScenario() (got " + applies + ")");
  assert.match(fnBody, /\.catch\([\s\S]*applyDefaultScenario\(\)/,
    "the .catch must re-establish a deterministic cast, not return false");
});
