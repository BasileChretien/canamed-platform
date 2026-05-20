/* tests/modA-progressive-disclosure.test.js
 *
 * Lock-in for the Module A progressive-disclosure change (2026-05-20).
 * The sim repeatedly flagged Module A opening with ~30 buttons / ~5x
 * viewport tall. History stays open (first step); Examination, Working
 * hypotheses and Investigations are collapsed by default so the stage
 * opens compact and the team expands sections as it works the case.
 *
 * Static assertions against index.html (the <details open> attributes).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const INDEX = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "index.html"),
  "utf8");

// Pull out the opening <details ...> tag for a given chart-section id.
function detailsTagFor(id) {
  const re = new RegExp("<details[^>]*\\bid=\"" + id + "\"[^>]*>");
  const m = INDEX.match(re);
  assert.ok(m, "expected a <details> with id=\"" + id + "\" in index.html");
  return m[0];
}

test("Module A: History section stays open by default (first step)", () => {
  assert.match(detailsTagFor("chart-section-history"), /\bopen\b/,
    "History should remain open so the team has an obvious starting point");
});

test("Module A: Examination is collapsed by default", () => {
  assert.doesNotMatch(detailsTagFor("chart-section-exam"), /\bopen\b/,
    "Examination must NOT carry the open attribute (progressive disclosure)");
});

test("Module A: Working hypotheses is collapsed by default", () => {
  assert.doesNotMatch(detailsTagFor("chart-hypotheses"), /\bopen\b/,
    "Working hypotheses must NOT carry the open attribute");
});

test("Module A: Investigations is collapsed by default", () => {
  assert.doesNotMatch(detailsTagFor("chart-investigations"), /\bopen\b/,
    "Investigations must NOT carry the open attribute");
});

test("Module A: First impressions remains collapsed (unchanged)", () => {
  assert.doesNotMatch(detailsTagFor("chart-impressions"), /\bopen\b/,
    "First-impressions stays collapsed as before");
});
