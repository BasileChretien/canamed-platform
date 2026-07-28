/* tests/roleplay-panels.test.js
 *
 * S1c-2: a roleplay's four reference panels (historical context, guidelines,
 * recap, useful sentences) become OPTIONAL section data (decision 11).
 *
 * They were static case-specific prose in index.html shown to every roleplay,
 * so a facilitator's own roleplay still displayed France/Japan disclosure
 * history. The safety property pinned here is the no-op: a section that
 * declares no `panels` key must leave the shipped markup exactly as authored,
 * so the three built-in roleplays cannot regress.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");

function fn(name) {
  const i = SCRIPT.indexOf("function " + name + "(");
  assert.ok(i > -1, name + "() must exist");
  const j = SCRIPT.indexOf("\nfunction ", i + 1);
  return SCRIPT.slice(i, j > 0 ? j : SCRIPT.length);
}

test("a section with no panels declaration leaves the shipped markup alone", () => {
  assert.match(fn("renderRoleplayPanels"), /if \(!panels\) return;/,
    "the built-in roleplays must not be re-rendered from data");
});

test("an unfilled panel hides its TOOLBAR BUTTON too, not just the region", () => {
  const f = fn("renderRoleplayPanels");
  assert.match(f, /el\("refB-btn-" \+ id\)/, "the button must be resolved");
  assert.match(f, /btn\.classList\.toggle\("hidden", !on\)/,
    "a button opening an empty region is worse than an absent one");
});

test("panel content is text-only — it is facilitator-authored", () => {
  const f = fn("_fillRoleplayPanel");
  assert.ok(!/innerHTML/.test(f), "never innerHTML for authored prose");
  assert.match(f, /textContent = str\(/);
  assert.match(f, /createElement\("p"\)/);
  assert.match(f, /createElement\("li"\)/);
});

test("all four panels are addressable, and only those four", () => {
  const i = SCRIPT.indexOf("const ROLEPLAY_PANEL_IDS");
  const line = SCRIPT.slice(i, SCRIPT.indexOf("\n", i));
  assert.match(line, /"history".*"guidelines".*"recap".*"useful"/);
  ["history", "guidelines", "recap", "useful"].forEach(id => {
    assert.ok(HTML.indexOf('id="refB-panel-' + id + '"') > -1, id + " panel must exist");
    assert.ok(HTML.indexOf('id="refB-btn-' + id + '"') > -1, id + " button must exist");
  });
});

test("applyScenario refreshes the panels alongside the cast", () => {
  const i = SCRIPT.indexOf("window.CURRENT_SECTION_ROLEPLAY =");
  const after = SCRIPT.slice(i, i + 700);
  assert.match(after, /renderRoleplayPanels\(\)/);
  assert.match(after, /catch \(e\)/, "applyScenario also runs before the DOM exists");
});
