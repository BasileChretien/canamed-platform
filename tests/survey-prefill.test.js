/* tests/survey-prefill.test.js
 *
 * Dry-run feedback (2026-05-26): the end-of-session questionnaire re-asked the
 * participant's university and year of study, which we already collect on the
 * join form. The two demographic questions are now PRE-FILLED from the join
 * profile (the live #uni-input / #year-input, or the myUniversity / myYear
 * globals), so the student never re-enters them — while the values stay in the
 * survey export (linked, not lost) and stay editable in case the join entry was
 * wrong.
 *
 * Static source-text checks (the suite convention) + an executable check of the
 * SURVEY demographic shape so a missing prefill marker / year-option gap is
 * caught.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const CASE = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

function loadSurvey() {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", CASE)(win, win);
  return win.SURVEY;
}

test("the demographic survey items carry a prefill marker tied to the join profile", () => {
  const SURVEY = loadSurvey();
  const uni = SURVEY.find(i => i.id === "demo_university");
  const year = SURVEY.find(i => i.id === "demo_year");
  assert.ok(uni, "demo_university item must exist");
  assert.ok(year, "demo_year item must exist");
  assert.strictEqual(uni.prefill, "university", "demo_university must declare prefill:'university'");
  assert.strictEqual(year.prefill, "year", "demo_year must declare prefill:'year'");
});

test("demographic option values match what the join form can produce (so every join value pre-fills)", () => {
  const SURVEY = loadSurvey();
  const uniVals = new Set((SURVEY.find(i => i.id === "demo_university").options || []).map(o => o.v));
  // The two partner cohorts (platform-config.js ids) + the Other escape hatch.
  ["Caen", "Nagoya", "Other"].forEach(v =>
    assert.ok(uniVals.has(v), "demo_university must offer option '" + v + "' to mirror the cohorts"));

  const yearVals = new Set((SURVEY.find(i => i.id === "demo_year").options || []).map(o => o.v));
  // index.html #year-input offers 1..7 (7 = Postgraduate/Resident). Every one of
  // those must have a matching survey option or it cannot be pre-filled.
  for (let y = 1; y <= 7; y++) {
    assert.ok(yearVals.has(String(y)),
      "demo_year must offer year option '" + y + "' to mirror the join form #year-input");
  }
});

test("_mountSurveyForm pre-selects the option from the join profile and flags it", () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf("function _mountSurveyForm"),
    SCRIPT.indexOf("function renderSurvey"));
  assert.match(fn, /item\.prefill/, "must read item.prefill on the survey item");
  assert.match(fn, /\bsel\.value\s*=/, "must set the select's value to the pre-filled answer");
  assert.match(fn, /survey-prefill-hint|survey-prefilled/,
    "must visually flag a pre-filled field");
});

test("the prefill resolver reads the join profile (globals first, live inputs as fallback)", () => {
  // a dedicated resolver so the source of truth is explicit + testable
  assert.match(SCRIPT, /function _surveyProfileVal\(/, "_surveyProfileVal resolver must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function _surveyProfileVal"),
    SCRIPT.indexOf("function _surveyProfileVal") + 600);
  assert.match(fn, /myUniversity/, "university must come from the join profile global");
  assert.match(fn, /myYear/, "year must come from the join profile global");
  assert.match(fn, /uni-input/, "must fall back to the live #uni-input value");
  assert.match(fn, /year-input/, "must fall back to the live #year-input value");
});

test("the pre-filled hint string ships in en / fr / ja", () => {
  const n = I18N.split('"survey.prefilled"').length - 1;
  assert.strictEqual(n, 3, "survey.prefilled must be defined in en, fr and ja (got " + n + ")");
});
