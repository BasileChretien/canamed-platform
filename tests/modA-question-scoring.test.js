/* tests/modA-question-scoring.test.js
 *
 * Lock-in for the Module A free-text question scoring (LLM-patient pilot,
 * 2026-05-28). Loads case-content.js (for SCORING.moduleA_questions and
 * SCORING.moduleA_question_penalties) plus modA-question-scoring.js, and
 * exercises scoreQuestion() across EN/FR/JA, dedupe, penalties, and unlocks.
 *
 * Stays static / off-network like the rest of tests/ — runs under
 * `node --test tests/*.test.js`.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");

function loadScoring() {
  // case-content.js declares `var SCORING = ...` which, under new Function(),
  // binds to the function scope rather than to `this`. Mirror the trick from
  // modA-vote-flow.test.js: append an explicit `this.SCORING = SCORING`
  // tail so the value lands on our shared context. Then evaluate the scoring
  // helper (an IIFE that reads window.SCORING) against the same context.
  const ctx = {};
  ctx.module = { exports: {} };

  let caseSrc = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  caseSrc += "\nthis.SCORING = SCORING; this.CASE = CASE;";
  // eslint-disable-next-line no-new-func
  new Function("window", "self", "module", caseSrc).call(ctx, ctx, ctx, ctx.module);

  const scoringSrc = fs.readFileSync(path.join(P, "modA-question-scoring.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "self", "module", scoringSrc).call(ctx, ctx, ctx, ctx.module);

  return ctx.modAQuestionScoring || ctx.module.exports;
}

function loadCases() {
  const ctx = {};
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.SCORING = SCORING; this.CASE = CASE;";
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, ctx, ctx);
  return ctx;
}

test("case-content.js exposes the moduleA_questions and penalty families", () => {
  const ctx = loadCases();
  assert.ok(Array.isArray(ctx.SCORING.moduleA_questions),
    "SCORING.moduleA_questions must be an array");
  assert.ok(ctx.SCORING.moduleA_questions.length >= 7,
    "expect at least 7 question families");
  assert.ok(Array.isArray(ctx.SCORING.moduleA_question_penalties),
    "SCORING.moduleA_question_penalties must be an array");
  ctx.SCORING.moduleA_questions.concat(ctx.SCORING.moduleA_question_penalties).forEach(fam => {
    assert.ok(fam.id, "every family needs an id");
    assert.equal(typeof fam.points, "number", fam.id + " needs numeric points");
    assert.ok(fam.label && fam.label.en && fam.label.fr && fam.label.ja,
      fam.id + " needs trilingual label");
    assert.ok(Array.isArray(fam.any) && fam.any.length > 0,
      fam.id + " needs an any[] stem list");
  });
});

test("EN red-flag question scores EACH category assessed, all unlock history:1", () => {
  const { scoreQuestion } = loadScoring();
  // fever → infection ; weight loss + night pain → malignancy. Both categories
  // must score (2026-06-03: "points for every red flag assessed").
  const r = scoreQuestion("Any fever, weight loss or night pain?", {});
  assert.ok(r.award.includes("qr_rf_infection"), "fever scores infection");
  assert.ok(r.award.includes("qr_rf_malignancy"), "weight loss / night pain scores malignancy");
  assert.ok(r.unlocks.includes("history:1"), "any red flag unlocks the synthesis gate");
  assert.deepEqual(r.penalty, []);
});

test("a comprehensive red-flag screen scores EACH of the four categories", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion(
    "Any fever or night sweats, recent weight loss or history of cancer, " +
    "any recent trauma or a fall, and morning stiffness that improves with exercise?",
    {});
  ["qr_rf_infection", "qr_rf_malignancy", "qr_rf_fracture", "qr_rf_inflammatory"]
    .forEach(id => assert.ok(r.award.includes(id), id + " must score"));
  assert.ok(r.unlocks.includes("history:1"));
});

test("FR cauda-equina question fires qr_cauda with unlocks=history:2", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion(
    "Avez-vous des troubles de la vessie ou une anesthésie en selle ?", {});
  assert.ok(r.award.includes("qr_cauda"));
  assert.ok(r.unlocks.includes("history:2"));
});

test("JA cauda-equina question fires qr_cauda (馬尾)", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion("馬尾症候群が心配です。膀胱の症状はありますか？", {});
  assert.ok(r.award.includes("qr_cauda"));
  assert.ok(r.unlocks.includes("history:2"));
});

test("EN neuro-exam question fires qr_neuro with unlocks=exam:3", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion("Any weakness or tingling, and how are your reflexes?", {});
  assert.ok(r.award.includes("qr_neuro"));
  assert.ok(r.unlocks.includes("exam:3"));
});

test("Three red-flag asks across EN/FR/JA unlock all three SYNTH_PREREQS items", () => {
  const { scoreQuestion } = loadScoring();
  const awarded = {};
  const all = [];
  ["Any fever or weight loss?",
   "Avez-vous une anesthésie en selle ou des troubles urinaires ?",
   "下肢の筋力低下や反射の異常はありますか？"
  ].forEach(q => {
    const r = scoreQuestion(q, awarded);
    r.award.forEach(id => { awarded[id] = true; });
    r.unlocks.forEach(u => all.push(u));
  });
  assert.ok(all.includes("history:1"), "history:1 unlocked by red-flag screen");
  assert.ok(all.includes("history:2"), "history:2 unlocked by cauda screen");
  assert.ok(all.includes("exam:3"),    "exam:3 unlocked by neuro intent");
});

test("Yellow-flag question fires qr_yellow with NO unlocks (no gate item)", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion("How is your mood and sleep lately?", {});
  assert.ok(r.award.includes("qr_yellow"));
  assert.equal(r.unlocks.length, 0, "yellow flags do not gate the synthesis");
});

test("Opioid-handling question fires qr_opioid_handling", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion(
    "Tell me more about why you want oxycodone — what do you hope it will do?",
    {});
  assert.ok(r.award.includes("qr_opioid_handling"));
});

test("Penalty: promising oxycodone before workup fires pen_chat_prescribe", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion("OK, I'll prescribe oxycodone for you today.", {});
  assert.ok(r.penalty.includes("pen_chat_prescribe"));
});

test("Penalty: dismissive language fires pen_chat_dismissive", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion("It's just back pain, nothing serious.", {});
  assert.ok(r.penalty.includes("pen_chat_dismissive"));
});

test("Once-only: a family already awarded is not awarded again", () => {
  const { scoreQuestion } = loadScoring();
  const r1 = scoreQuestion("Any fever?", {});
  assert.deepEqual(r1.award, ["qr_rf_infection"]);
  assert.deepEqual(r1.unlocks, ["history:1"]);

  const awarded = { qr_rf_infection: true };
  const r2 = scoreQuestion("And are you still feverish?", awarded);
  assert.deepEqual(r2.award, [], "must not double-award the same family");
  assert.deepEqual(r2.unlocks, [], "no fresh unlocks once already awarded");
});

test("Innocuous text scores nothing", () => {
  const { scoreQuestion } = loadScoring();
  const r = scoreQuestion("Hello, how do you do today?", {});
  assert.deepEqual(r.award, []);
  assert.deepEqual(r.unlocks, []);
  assert.deepEqual(r.penalty, []);
});

test("Empty / nullish input is safe", () => {
  const { scoreQuestion } = loadScoring();
  assert.deepEqual(scoreQuestion("", {}), { award: [], penalty: [], unlocks: [] });
  assert.deepEqual(scoreQuestion(null, {}), { award: [], penalty: [], unlocks: [] });
  assert.deepEqual(scoreQuestion(undefined, {}), { award: [], penalty: [], unlocks: [] });
});

test("familyById returns the matching family or null", () => {
  const { familyById } = loadScoring();
  const fam = familyById("qr_cauda");
  assert.ok(fam && fam.id === "qr_cauda");
  assert.equal(fam.unlocks, "history:2");
  assert.equal(familyById("nope"), null);
  assert.equal(familyById(""), null);
  assert.equal(familyById(null), null);
});
