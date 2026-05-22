/* tests/scenario-author-preview.test.js
 *
 * Scenario-authoring hardening (2026-05-22): a human-readable Preview (how the
 * scenario reads to participants, not raw JSON) + a discoverable play-test path.
 * The authoring tool already validates structure thoroughly; this adds the
 * content sanity-check authors were missing.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "scenario-author.html"), "utf8");
const CSS = fs.readFileSync(path.join(P, "scenario-author.css"), "utf8");

test("scenario-author.js still parses with the preview", () => {
  assert.doesNotThrow(() => new Function(JS));
});

test("a Preview button + panel + play-test guidance exist", () => {
  assert.match(HTML, /id="btn-preview"/, "Preview button must exist");
  assert.match(HTML, /id="preview-output"/, "preview panel must exist");
  assert.match(HTML, /play-test/i, "must document the play-test path");
  assert.match(HTML, /Custom scenario/i, "must point at the custom-scenario create flow");
});

test("renderPreview renders content (decisions with the safest option flagged)", () => {
  assert.match(JS, /function renderPreview\(\)/, "renderPreview must exist");
  assert.match(JS, /getElementById\("btn-preview"\)[\s\S]{0,120}addEventListener/, "Preview must be wired");
  const fn = JS.slice(JS.indexOf("function renderPreview"),
    JS.indexOf("function renderPreview") + 3000);
  assert.match(fn, /Team decisions/, "must list the team decisions");
  assert.match(fn, /✓ safest|safest/, "must flag the correct (safest) option");
  assert.match(fn, /preTest[\s\S]*postTest|postTest[\s\S]*preTest/, "must surface pre/post test presence");
  assert.match(fn, /knowledge-gain/i, "must nudge adding a pre/post test for gain measurement");
  // Safety: user content goes through el() text (textContent), not innerHTML.
  assert.doesNotMatch(fn, /\.innerHTML\s*=\s*[^"';]*(json|d\.|o\.)/, "must not innerHTML user content");
});

test("preview has styles", () => {
  assert.match(CSS, /\.preview-decision\b/, "preview decisions styled");
  assert.match(CSS, /\.preview-correct\b/, "the safest-option marker styled");
});
