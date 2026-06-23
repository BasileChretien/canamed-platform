/* tests/modA-merge-discuss.test.js
 *
 * Locks in the 2026-06-23 merge: Module A's separate "Debate" (discussion
 * prompts) and "Our final answers" tabs were folded into ONE "Discuss together"
 * section — a discussion rule + two focused fields (the group's plan, and a
 * France↔Japan pain-management cultural difference). Scoring is kept; the phase
 * gate dropped from ≥2 to ≥1 working hypothesis.
 *
 * Static / off-network: reads the shipped files as text and asserts structure.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const EN = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
const FR = fs.readFileSync(path.join(P, "locales", "fr.js"), "utf8");
const JA = fs.readFileSync(path.join(P, "locales", "ja.js"), "utf8");

test("the separate Debate tab + panel are gone (merged into one section)", () => {
  assert.doesNotMatch(INDEX, /id="rcol-tab-discussion"/, "the Debate tab button must be removed");
  assert.doesNotMatch(INDEX, /id="rcol-p-discussion"/, "the Debate panel must be removed");
  assert.doesNotMatch(INDEX, /data-tab="discussion"/, "no discussion tab/mtab anywhere");
  assert.doesNotMatch(INDEX, /id="mtab-badge-discussion"/, "no discussion mobile mtab");
});

test("the merged section keeps EXACTLY two answer fields: plan + the France↔Japan difference", () => {
  const keys = [...INDEX.matchAll(/id="answer-input-moduleA-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["plan", "differ"], "only the plan + differ fields remain (no disagree/takehome)");
  assert.doesNotMatch(INDEX, /id="answer-input-moduleA-disagree"/, "disagree input removed");
  assert.doesNotMatch(INDEX, /id="answer-input-moduleA-takehome"/, "takehome input removed");
  // The engine's bullet list must match the DOM.
  assert.match(SCRIPT, /moduleA:\s*\["plan",\s*"differ"\]/,
    "ANSWER_BULLETS.moduleA must be exactly [plan, differ]");
});

test("the differ field is reframed to France↔Japan pain-management culture", () => {
  assert.match(INDEX, /id="answer-input-moduleA-differ"/, "the differ field stays");
  for (const [lang, src] of [["en", EN], ["fr", FR], ["ja", JA]]) {
    assert.match(src, /"modA\.answers\.bullet\.differ\.label":/, `${lang}: differ label key present`);
  }
  assert.match(EN, /"modA\.answers\.bullet\.differ\.label":[^\n]*pain management/i,
    "EN differ label names pain management");
  assert.match(FR, /"modA\.answers\.bullet\.differ\.label":[^\n]*douleur/i,
    "FR differ label names la douleur");
  assert.match(JA, /"modA\.answers\.bullet\.differ\.label":[^\n]*疼痛/,
    "JA differ label names 疼痛");
});

test("the discussion rule (discuss together + cultural differences) ships in all 3 languages", () => {
  assert.match(INDEX, /data-i18n="modA\.answers\.rule"/, "the rule banner is wired in the HTML");
  for (const [lang, src] of [["en", EN], ["fr", FR], ["ja", JA]]) {
    assert.match(src, /"modA\.answers\.rule":/, `${lang}: modA.answers.rule present (i18n parity)`);
  }
});

test("the merged tab is titled 'Discuss together' in all 3 languages", () => {
  assert.match(EN, /"rcol\.tab\.answers":\s*"Discuss together"/, "EN tab label");
  assert.match(FR, /"rcol\.tab\.answers":\s*"Discuter ensemble"/, "FR tab label");
  assert.match(JA, /"rcol\.tab\.answers":\s*"一緒に話し合う"/, "JA tab label");
});

test("the phase gate is ≥1 working hypothesis (was ≥2)", () => {
  assert.match(SCRIPT, /function phaseGateOpen\(\)[\s\S]*?hypothesisCount\(\) >= 1/,
    "phaseGateOpen() === hypothesisCount() >= 1");
  assert.doesNotMatch(SCRIPT, /hypothesisCount\(\) >= 2/, "no ≥2 gate left in script.js");
});

test("renderPrompts is now an inert no-op when its (removed) container is absent", () => {
  const at = SCRIPT.indexOf("function renderPrompts(");
  const body = SCRIPT.slice(at, at + 400);
  assert.match(body, /if \(!el\("prompts-locked"\)\) return;/,
    "renderPrompts must early-return when #prompts-locked is gone");
});
