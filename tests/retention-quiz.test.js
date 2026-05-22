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
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
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

test("the wrap-up offers a saveable revisit link + QR, scenario-aware", () => {
  assert.match(INDEX, /id="wrapup-revisit-link"/, "wrap-up must have the revisit link");
  assert.match(INDEX, /id="wrapup-revisit-qr"/, "wrap-up must have the QR holder");
  const ep = SCRIPT.slice(SCRIPT.indexOf("function initEndPoll"), SCRIPT.indexOf("function initEndPoll") + 2400);
  assert.match(ep, /revisit\.html\?s=/, "must build a scenario-specific revisit URL");
  assert.match(ep, /CURRENT_SCENARIO_ID/, "must use the session's scenario id");
  assert.match(ep, /ensureQrcode/, "must lazily draw the scan-to-save QR");
});

test("retention assets are precached + the copy ships in en/fr/ja", () => {
  for (const a of ["/revisit.html", "/revisit.js", "/docs-page.css", "/docs-page.js"]) {
    assert.match(SW, new RegExp('"' + a.replace(/[/.]/g, "\\$&") + '"'), "sw must precache " + a);
  }
  const n = (I18N.match(/"stage\.wrap\.retention\.title":/g) || []).length;
  assert.ok(n >= 3, "retention copy must be in en, fr and ja (got " + n + ")");
});
