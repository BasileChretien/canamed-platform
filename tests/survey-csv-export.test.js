/* tests/survey-csv-export.test.js
 *
 * Lock-in for the 2026-05-22 feature: the end-of-session feedback questionnaire
 * is now captured IN-PLATFORM (Wrap-up stage → /rooms/{room}/survey/{cid}) and
 * the facilitator can download the research data as CSV (participant pre/post
 * scores + survey responses + room decisions) alongside the existing JSON.
 *
 * Source-string assertions (the suite convention), plus one executable check of
 * the SURVEY bank shape so a malformed item / missing translation is caught.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const TOOLS  = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const INDEX  = fs.readFileSync(path.join(P, "index.html"), "utf8");
const CASE   = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
const CSS    = fs.readFileSync(path.join(P, "style.css"), "utf8");
// #48 split the non-English tables into locales/<lang>.js; read the COMBINED
// i18n source (i18n.js + every locale chunk) so the en/fr/ja key-count holds.
const I18N   = require("./_i18n_source.js").readI18nSource();
const RULES  = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));

/* ── SURVEY question bank ──────────────────────────────────────────────── */
test("SURVEY bank loads and every item is well-formed in en/fr/ja", () => {
  // case-content.js assigns window.SURVEY at the bottom; eval with a window shim.
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", CASE)(win, win);
  const SURVEY = win.SURVEY;
  assert.ok(Array.isArray(SURVEY) && SURVEY.length >= 10,
    "window.SURVEY must be a non-trivial array");
  const ids = new Set();
  const types = new Set(["likert", "single", "open"]);
  for (const item of SURVEY) {
    assert.ok(item && typeof item.id === "string" && item.id, "item needs an id");
    assert.ok(!ids.has(item.id), "duplicate survey id: " + item.id);
    ids.add(item.id);
    assert.ok(types.has(item.type), item.id + ": type must be likert|single|open");
    ["en", "fr", "ja"].forEach(l => {
      assert.ok(item.q && typeof item.q[l] === "string" && item.q[l].length > 0,
        item.id + ": q." + l + " must be a non-empty string");
    });
    if (item.type === "single") {
      assert.ok(Array.isArray(item.options) && item.options.length >= 2,
        item.id + ": single must have >=2 options");
      item.options.forEach(o => {
        assert.ok(o && typeof o.v === "string" && o.v.length > 0, item.id + ": option needs a string v");
        ["en", "fr", "ja"].forEach(l => {
          assert.ok(o.text && typeof o.text[l] === "string" && o.text[l].length > 0,
            item.id + ": option text." + l + " must be non-empty");
        });
      });
    }
  }
});

/* ── In-platform survey runner (script.js) ─────────────────────────────── */
test("survey runner exists and writes to the per-room survey node", () => {
  assert.match(SCRIPT, /function renderSurvey\(\)/, "renderSurvey() must exist");
  assert.match(SCRIPT, /function _mountSurveyForm\(/, "_mountSurveyForm() must exist");
  const ref = SCRIPT.slice(SCRIPT.indexOf("function _surveyRef"),
    SCRIPT.indexOf("function _surveyRef") + 400);
  assert.match(ref, /rooms\/"\s*\+\s*myRoom\s*\+\s*"\/survey\/"\s*\+\s*clientId/,
    "_surveyRef must point at rooms/<room>/survey/<clientId>");
  const save = SCRIPT.slice(SCRIPT.indexOf("function _saveSurveyComplete"),
    SCRIPT.indexOf("function _saveSurveyComplete") + 500);
  assert.match(save, /completedAt/, "completion must stamp completedAt");
  assert.match(save, /"responses\/"\s*\+\s*qid/, "responses are written under responses/<qid>");
});

test("survey is rendered at wrap-up and exposed for E2E", () => {
  assert.match(SCRIPT, /viewStage === STAGE_COUNT - 1\) renderSurvey\(\)/,
    "renderSurvey() must run on the final (wrap-up) stage");
  assert.match(SCRIPT, /window\.renderSurvey = renderSurvey/, "renderSurvey must be exposed");
  assert.match(SCRIPT, /window\._mountSurveyForm = _mountSurveyForm/, "_mountSurveyForm must be exposed");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function renderSurvey"),
    SCRIPT.indexOf("function renderSurvey") + 600);
  assert.match(fn, /isRoomAdmin/, "renderSurvey must hide the card for room admins");
});

test("survey card markup + i18n exist", () => {
  assert.match(INDEX, /id="survey-card"/, "wrap-up must include the survey card");
  ["survey-start-btn", "survey-skip-btn", "survey-body"].forEach(id => {
    assert.match(INDEX, new RegExp('id="' + id + '"'), "survey markup must include #" + id);
  });
  assert.match(INDEX, /data-i18n="survey\.title"/, "survey title must be i18n-bound");
  // chrome strings present in en/fr/ja (inline i18n.js — each key appears 3×)
  ["survey.title", "survey.submit", "survey.skip", "survey.likert.1", "survey.likert.5"].forEach(k => {
    const n = I18N.split('"' + k + '"').length - 1;
    assert.strictEqual(n, 3, k + " must be in en/fr/ja (got " + n + ")");
  });
});

test("survey CSS ships with touch-sized likert controls", () => {
  assert.match(CSS, /\.survey-likert-opt\s*\{[^}]*min-height:\s*44px/,
    "likert option buttons must be >=44px tall for touch targets");
});

/* ── CSV research export (admin-tools.js) ──────────────────────────────── */
test("CSV export functions exist and ship the linked analysis files", () => {
  assert.match(TOOLS, /function generateResearchExportCSV\(\)/, "generateResearchExportCSV must exist");
  assert.match(TOOLS, /function researchCsvParticipantRows\(\)/, "researchCsvParticipantRows must exist");
  assert.match(TOOLS, /function _toCSV\(/, "_toCSV serializer must exist");
  const start = TOOLS.indexOf("function generateResearchExportCSV");
  const gen = TOOLS.slice(start, start + 4000);
  assert.match(gen, /research_participants\.csv/, "must download a participants CSV");
  assert.match(gen, /research_reveals\.csv/, "must download a reveals CSV (clinical action log + order)");
  assert.match(gen, /research_votes\.csv/, "must download an individual-votes CSV");
  assert.match(gen, /research_freetext\.csv/, "must download a free-text CSV");
  assert.match(gen, /research_decisions\.csv/, "must download a decisions CSV");
  assert.match(gen, /research_codebook\.csv/, "must download a codebook CSV");
});

test("CSV joins pre/post scores + survey responses per participant", () => {
  const fn = TOOLS.slice(TOOLS.indexOf("function researchCsvParticipantRows"),
    TOOLS.indexOf("function generateResearchExportCSV"));
  assert.match(fn, /\.tests\b/, "must read the per-room tests node");
  assert.match(fn, /\.survey\b/, "must read the per-room survey node");
  assert.match(fn, /\(postPct - prePct\) \/ \(100 - prePct\)/, "must compute Hake's normalized gain");
  assert.match(fn, /normGain/, "participant row must carry the gain");
});

test("CSV is UTF-8 BOM + fully quoted (Excel-safe, free-text-safe)", () => {
  const fn = TOOLS.slice(TOOLS.indexOf("function _csvCell"),
    TOOLS.indexOf("function _surveyColumns"));
  assert.match(fn, /replace\(\/\\r\?\\n\/g/, "newlines must be stripped so a free-text answer can't break a row");
  assert.match(fn, /""/, "embedded quotes must be doubled");
  assert.match(TOOLS, /"﻿" \+ head/, "_toCSV must prepend a UTF-8 BOM for Excel");
});

test("the feedback survey is also added to the JSON research bundle", () => {
  const gen = TOOLS.slice(TOOLS.indexOf("function generateResearchExport"),
    TOOLS.indexOf("function generateResearchExportCSV"));
  assert.match(gen, /const survey = \[\]/, "JSON export must collect survey rows");
  assert.match(gen, /survey: survey/, "JSON bundle must include the survey array");
});

test("CSV export is wired to a facilitator button + exposed", () => {
  // Icon system 2026-07-17: the localised label now lives on an inner <span>
  // (sibling of the sprite icon), so allow the key anywhere inside the button.
  assert.match(INDEX, /id="admin-research-csv-btn"[\s\S]{0,400}?data-i18n="impact\.research-csv"/,
    "the dashboard must include the CSV export button");
  const n = I18N.split('"impact.research-csv"').length - 1;
  assert.strictEqual(n, 3, "impact.research-csv must be in en/fr/ja (got " + n + ")");
  assert.match(SCRIPT, /admin-research-csv-btn[\s\S]{0,160}?runAdminTool\("generateResearchExportCSV"\)/,
    "the CSV button must invoke generateResearchExportCSV");
  assert.match(TOOLS, /window\.generateResearchExportCSV = generateResearchExportCSV/,
    "generateResearchExportCSV must be exposed on window");
});

/* ── Database security rules ───────────────────────────────────────────── */
test("a validated survey node exists in BOTH the default and org subtrees", () => {
  const def = RULES.rules.sessions.$sessionId.rooms.$roomId.survey;
  assert.ok(def && def.$cid, "default sessions subtree must have rooms/$roomId/survey/$cid");
  assert.ok(def.$cid[".validate"].includes("startedAt"), "survey node must validate startedAt");
  assert.ok(def.$cid.responses.$qid[".validate"].includes("'v'"),
    "survey responses must validate a v field");
  assert.ok(def.$cid[".write"].includes("clientMapping"), "survey writes must be owner-gated");

  const org = RULES.rules.orgs.$orgSlug.sessions.$sessionId.rooms.$roomId.survey;
  assert.ok(org && org.$cid, "org subtree must also have rooms/$roomId/survey/$cid");
  assert.ok(org.$cid[".write"].includes("orgs"), "org survey write must reference the orgs path");
  assert.ok(org.$cid.responses.$qid[".validate"].includes("2000"),
    "org survey free-text must be length-capped");
});
