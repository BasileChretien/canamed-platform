/* tests/retention-quiz.test.js
 *
 * Spaced-reinforcement retention quiz (2026-05-22): a standalone revisit.html
 * (off the splash budget) that re-presents the session's post-test as a
 * few-days-later self-check, scored locally. Saveable link + QR at wrap-up.
 * Built CSP-compliant (external css/js — prod CSP is style-src/script-src 'self').
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const HTMLp = path.join(P, "revisit.html");
const REVHTML = fs.readFileSync(HTMLp, "utf8");
const REVJS = fs.readFileSync(path.join(P, "revisit.js"), "utf8");
const DOCCSS = fs.readFileSync(path.join(P, "docs-page.css"), "utf8");
const DOCJS = fs.readFileSync(path.join(P, "docs-page.js"), "utf8");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const SW = fs.readFileSync(path.join(P, "sw.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();
const COMPLIANCE = fs.readFileSync(path.join(P, "compliance.html"), "utf8");

test("revisit.html is a CSP-compliant standalone page (external css + scripts)", () => {
  assert.match(REVHTML, /<!doctype html>/i, "full document");
  assert.match(REVHTML, /<link rel="stylesheet" href="docs-page\.css">/, "external stylesheet");
  assert.match(REVHTML, /src="case-content\.js/, "loads the scenario data");
  assert.match(REVHTML, /src="revisit\.js/, "loads the quiz logic");
  assert.match(REVHTML, /id="revisit-app"/, "has the quiz mount point");
  assert.doesNotMatch(REVHTML, /<style>|onclick=/, "no inline style/handler (prod CSP)");
});

test("revisit.js runs the post-test as a locally-scored self-check", () => {
  assert.doesNotThrow(() => new Function(REVJS), "revisit.js must parse");
  assert.match(REVJS, /window\.CANAMED_SCENARIOS/, "reads the scenario registry");
  assert.match(REVJS, /\.postTest/, "uses the scenario's post-test bank");
  assert.match(REVJS, /qs\("s"\)/, "reads the scenario from the URL");
  assert.match(REVJS, /qs\("lang"\)/, "honours the language param");
  assert.match(REVJS, /opt\.correct/, "scores against the correct option");
  assert.match(REVJS, /retention/i, "frames the score as retention");
});

test("the existing doc pages were made CSP-compliant (no inline style)", () => {
  assert.doesNotMatch(COMPLIANCE, /<style>/, "compliance.html must not use inline <style>");
  assert.match(COMPLIANCE, /href="docs-page\.css"/, "compliance.html must use the external stylesheet");
  assert.match(DOCJS, /data-print/, "docs-page.js wires the print button");
  assert.match(DOCCSS, /\.q-opt/, "docs-page.css carries the quiz styles");
});

test("the facilitator retention-reminder card was removed from the wrap-up", () => {
  // 2026-07-16 (user request): the "📅 Schedule the retention reminder" card
  // (calendar .ics / Google-Calendar links to send students the revisit link) was
  // removed from the wrap-up, along with its initRetentionReminder wiring and the
  // .ics/gcal builders. The student revisit.html self-check page is unchanged.
  assert.doesNotMatch(INDEX, /id="wrapup-revisit-qr"/, "the student revisit QR card is gone");
  assert.doesNotMatch(INDEX, /id="retention-reminder-card"/, "the reminder card must be removed");
  assert.doesNotMatch(INDEX, /id="retention-ics-btn"/, "the .ics button must be gone");
  assert.doesNotMatch(INDEX, /id="retention-gcal-link"/, "the Google Calendar link must be gone");
  assert.doesNotMatch(SCRIPT, /function initRetentionReminder/, "initRetentionReminder must be removed");
  assert.doesNotMatch(SCRIPT, /function _buildIcs/, "the .ics builder must be removed");
  assert.doesNotMatch(SCRIPT, /function _gcalUrl/, "the gcal builder must be removed");
});

test("the revisit self-check assets are still precached (revisit.html unchanged)", () => {
  for (const a of ["/revisit.html", "/revisit.js", "/docs-page.css", "/docs-page.js"]) {
    assert.match(SW, new RegExp('"' + a.replace(/[/.]/g, "\\$&") + '"'), "sw must precache " + a);
  }
});
