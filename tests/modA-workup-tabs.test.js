/* tests/modA-workup-tabs.test.js
 *
 * Lock-in for the Module A workup-tabs change (2026-06-25). The three
 * data-gathering modes — Dialogue (the LLM patient chat), Examination and
 * Investigations — moved from three stacked <details> into a horizontal tab
 * strip (.chart-tabs) showing one panel at a time. Working hypotheses stays a
 * collapsed <details> BELOW the strip (a sequential commit step, not a
 * data-gathering mode). The optional "First impressions" textarea had already
 * been deleted; this also guards that it stays gone.
 *
 * Static assertions against index.html. The live behaviour (click + arrow-key
 * switching, the unread badge) is covered by tests-e2e/chart-tabs.spec.js.
 * Replaces tests/modA-progressive-disclosure.test.js, which locked in the
 * <details> progressive-disclosure model this supersedes.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const INDEX = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "index.html"),
  "utf8");

// Pull out the opening tag (<section ...> or <details ...>) for a given id.
function openingTagFor(id) {
  const re = new RegExp("<(?:section|details)[^>]*\\bid=\"" + id + "\"[^>]*>");
  const m = INDEX.match(re);
  assert.ok(m, "expected a <section>/<details> with id=\"" + id + "\" in index.html");
  return m[0];
}

test("Module A: a role=tablist workup strip carries Dialogue / Examination / Investigations tabs in order", () => {
  assert.match(INDEX, /class="chart-tabs"[^>]*role="tablist"/,
    "the workup strip must be a role=tablist");
  const di = INDEX.indexOf('data-chart-tab="dialogue"');
  const ex = INDEX.indexOf('data-chart-tab="exam"');
  const la = INDEX.indexOf('data-chart-tab="labs"');
  assert.ok(di > -1 && ex > -1 && la > -1, "all three tab buttons must exist");
  assert.ok(di < ex && ex < la, "tabs must be ordered Dialogue < Examination < Investigations");
});

test("Module A: the Dialogue panel is the active tabpanel (visible on entry)", () => {
  const tag = openingTagFor("chart-section-history");
  assert.match(tag, /role="tabpanel"/, "Dialogue panel must be a tabpanel");
  assert.match(tag, /\bis-active\b/, "Dialogue is the default-active panel");
  assert.doesNotMatch(tag, /\bhidden\b/, "the active panel must NOT be hidden");
});

test("Module A: Examination + Investigations panels are hidden tabpanels until selected", () => {
  for (const id of ["chart-section-exam", "chart-investigations"]) {
    const tag = openingTagFor(id);
    assert.match(tag, /role="tabpanel"/, id + " must be a tabpanel");
    assert.match(tag, /\bhidden\b/, id + " must start hidden (only one panel shows at a time)");
  }
});

test("Module A: Working hypotheses stays a collapsed <details> below the strip", () => {
  const tag = openingTagFor("chart-hypotheses");
  assert.match(tag, /^<details/, "Working hypotheses must remain a <details>");
  assert.doesNotMatch(tag, /\bopen\b/, "Working hypotheses must NOT carry the open attribute");
});

test("Module A: the 'First impressions' textarea is gone", () => {
  assert.doesNotMatch(INDEX, /id="chart-impressions"/,
    "the chart-impressions section must be absent");
  assert.doesNotMatch(INDEX, /id="impressions-input"/,
    "the impressions-input textarea must be absent");
});
