/* tests/cohort-comparison.test.js
 *
 * Cohort comparison (Caen × Nagoya) (2026-05-22): a lazy admin-tools report
 * that splits the live session by university — the built-in quasi-experiment —
 * with per-cohort contribution + paired pre→post learning gain.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");

test("cohortRows splits by university with per-cohort gain", () => {
  assert.match(TOOLS, /function cohortRows\(\)/, "cohortRows must exist");
  const fn = TOOLS.slice(TOOLS.indexOf("function cohortRows"),
    TOOLS.indexOf("function generateCohortComparison"));
  assert.match(fn, /e\.university/, "must read university from answer entries");
  assert.match(fn, /byUni/, "must bucket by university");
  assert.match(fn, /\(postPct - prePct\) \/ \(100 - prePct\)/, "must compute paired gain per cohort");
  assert.match(fn, /nPaired/, "must track the per-cohort paired N");
});

test("generateCohortComparison renders a per-cohort table + exposes itself", () => {
  assert.match(TOOLS, /function generateCohortComparison\(\)/, "the report fn must exist");
  const fn = TOOLS.slice(TOOLS.indexOf("function generateCohortComparison"),
    TOOLS.indexOf("// Expose on window"));
  assert.match(fn, /Cohort Comparison/, "must be titled");
  assert.match(fn, /natural experiment|quasi/i, "must frame the quasi-experiment");
  assert.match(fn, /window\.print\(\)/, "must be printable");
  assert.match(TOOLS, /window\.generateCohortComparison = generateCohortComparison/, "must be exposed");
});

test("the cohort button is wired + localised", () => {
  assert.match(HTML, /id="admin-cohort-btn"/, "the button must exist");
  assert.match(SCRIPT, /runAdminTool\("generateCohortComparison"\)/, "the button must be wired");
  const n = (I18N.match(/"impact\.cohort":/g) || []).length;
  assert.ok(n >= 3, "impact.cohort must be defined in en, fr and ja (got " + n + ")");
});
