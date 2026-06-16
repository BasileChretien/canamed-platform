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

test("the wrap-up offers a facilitator one-click retention reminder (calendar), scenario-aware", () => {
  // 2026-06-16 (PI request): the student "test your retention" card was replaced
  // by a facilitator-only calendar reminder (≈3 weeks out) to send the link.
  assert.doesNotMatch(INDEX, /id="wrapup-revisit-qr"/, "the student revisit QR card is gone");
  assert.match(INDEX, /id="retention-reminder-card"/, "wrap-up must have the facilitator reminder card");
  assert.match(INDEX, /id="retention-ics-btn"/, "an .ics (Apple/Outlook) download button");
  assert.match(INDEX, /id="retention-gcal-link"/, "a Google Calendar link");
  const rr = SCRIPT.slice(SCRIPT.indexOf("function initRetentionReminder"),
                          SCRIPT.indexOf("function initRetentionReminder") + 1600);
  assert.match(rr, /isRoomAdmin/, "the reminder is shown only to room admins");
  assert.match(rr, /revisit\.html/, "builds the scenario-specific revisit URL to send");
  assert.match(rr, /CURRENT_SCENARIO_ID/, "uses the session's scenario id");
  // Pure builders: a valid .ics (VCALENDAR/VEVENT) + a Google Calendar template URL.
  const ics = SCRIPT.slice(SCRIPT.indexOf("function _buildIcs"), SCRIPT.indexOf("function _buildIcs") + 900);
  assert.match(ics, /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT/, "emits a VCALENDAR with a VEVENT");
  const g = SCRIPT.slice(SCRIPT.indexOf("function _gcalUrl"), SCRIPT.indexOf("function _gcalUrl") + 400);
  assert.match(g, /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/, "Google Calendar template URL");
});

test("retention assets are precached + the copy ships in en/fr/ja", () => {
  for (const a of ["/revisit.html", "/revisit.js", "/docs-page.css", "/docs-page.js"]) {
    assert.match(SW, new RegExp('"' + a.replace(/[/.]/g, "\\$&") + '"'), "sw must precache " + a);
  }
  const n = (I18N.match(/"stage\.wrap\.reminder\.title":/g) || []).length;
  assert.ok(n >= 3, "facilitator reminder copy must be in en, fr and ja (got " + n + ")");
});
