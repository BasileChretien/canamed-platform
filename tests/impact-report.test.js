/* tests/impact-report.test.js
 *
 * Impact report (2026-05-22): a one-click, dean-ready session summary built
 * client-side from the live dashboard data (allRooms). Aggregate + pseudonymous
 * (no individual names), opened as a printable page. Built to drop into an
 * accreditation dossier / partnership report.
 *
 * Static source-text checks (matching the dashboard-test convention — the
 * report reads module-scoped allRooms that isn't drivable in node). The
 * generation path is exercised in tests-e2e/impact-report.spec.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("the Impact report generator is defined (kept in code; removed from the lean menu 2026-06-25)", () => {
  // The "More tools" menu was slimmed to a lean set 2026-06-25 — the Impact
  // report button was removed from the UI, but the generator stays in script.js
  // (still tested below) so it can be re-surfaced if needed.
  assert.match(SCRIPT, /function generateImpactReport\(\)/, "generateImpactReport must still exist");
  assert.doesNotMatch(HTML, /id="admin-impact-btn"/, "the impact-report button must be gone from the lean menu");
});

test("_impactMetrics aggregates participation, equity, decisions and engagement", () => {
  assert.match(SCRIPT, /function _impactMetrics\(\)/, "_impactMetrics must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function _impactMetrics"),
    SCRIPT.indexOf("function _impactEsc"));
  assert.match(fn, /roomParticipation\(d\)/, "must reuse roomParticipation for equity");
  assert.match(fn, /gini/, "must aggregate the Gini balance measure");
  assert.match(fn, /_debriefBucket\(d\)/, "must reuse the score bucket");
  assert.match(fn, /committed\.choice/, "must read committed team decisions");
  assert.match(fn, /opt && opt\.correct/, "decision accuracy must score against the correct option");
  assert.match(fn, /decisionAccuracyPct/, "must return an overall decision-accuracy %");
  assert.match(fn, /contribPct/, "must return a contributing %");
});

test("generateImpactReport builds a self-contained, escaped, printable report", () => {
  assert.match(SCRIPT, /function generateImpactReport\(\)/, "generateImpactReport must exist");
  assert.match(SCRIPT, /function _archiveCsvCell\b/, "slice end-anchor _archiveCsvCell must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function generateImpactReport"),
    SCRIPT.indexOf("function _archiveCsvCell"));
  assert.match(fn, /Session Impact Report/, "must render a titled report");
  assert.match(fn, /window\.print\(\)/, "must offer Print / Save as PDF");
  assert.match(fn, /_impactEsc/, "interpolated values must be HTML-escaped");
  assert.match(fn, /window\.open/, "must open the report in a new window");
  assert.match(fn, /a\.download/, "must fall back to a download if the popup is blocked");
  // Privacy: the report must state it is aggregate + pseudonymous.
  assert.match(fn, /aggregate and pseudonymous/i, "must declare aggregate + pseudonymous");
});

test("_impactEsc escapes HTML metacharacters", () => {
  assert.match(SCRIPT, /function _impactEsc\(/, "_impactEsc must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function _impactEsc"),
    SCRIPT.indexOf("function _impactEsc") + 350);
  assert.match(fn, /&amp;/, "must escape &");
  assert.match(fn, /&lt;/, "must escape <");
  assert.match(fn, /&quot;/, "must escape \"");
});

test("the impact-report button label ships in en / fr / ja", () => {
  const n = (I18N.match(/"impact\.button":/g) || []).length;
  assert.ok(n >= 3, "impact.button must be defined in en, fr and ja (got " + n + ")");
});
