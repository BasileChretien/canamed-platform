/* tests/roleplay-vignette.test.js
 *
 * S1c-3c: the roleplay's TITLE and VIGNETTE become section data — the last
 * hardcoded case-specific block on the roleplay stage. The <h2> read
 * "Module B — Breaking Bad News: A Cross-Cultural Roleplay" and the situation
 * paragraph named Mr/Mrs Tanaka-Martin, for every roleplay.
 *
 * The heading also carried the "Module B" wording decision 8 retired.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8") +
  /* S3a — the roleplay content renderers were extracted to the room-only
     section-content.js chunk to reclaim splash bytes. These assertions are
     about the CODE, not about which file carries it. */
  fs.readFileSync(path.join(P, "section-content.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");

const FN = (() => {
  const i = SCRIPT.indexOf("function renderRoleplayVignette");
  return SCRIPT.slice(i, SCRIPT.indexOf("\nconst SECTION_TYPE_FOR_MODULE", i));
})();

test("declaring neither title nor vignette leaves the shipped markup alone", () => {
  assert.match(FN, /if \(!rp \|\| \(!rp\.title && !rp\.vignette\)\) return;/);
});

test("an authored title also DROPS the i18n binding, not just the text", () => {
  /* applyI18n() runs on every language switch and would otherwise put the
     shipped heading straight back over the authored one. */
  assert.match(FN, /h\.removeAttribute\("data-i18n"\)/);
  assert.match(FN, /h\.removeAttribute\("data-i18n-html"\)/);
});

test("the vignette accepts one paragraph or several", () => {
  assert.match(FN, /Array\.isArray\(rp\.vignette\) \? rp\.vignette : \[rp\.vignette\]/);
});

test("only the prose is replaced — the editorial SVG survives", () => {
  assert.match(FN, /card\.querySelectorAll\("p"\)/,
    "remove the paragraphs, not the card's children wholesale");
  assert.ok(!/card\.textContent = ""/.test(FN),
    "the spot illustration is shell decoration, not section content");
  assert.ok(HTML.indexOf('class="spot-illustration"') > -1);
});

test("authored prose is text, never markup", () => {
  assert.ok(!/innerHTML/.test(FN));
  assert.match(FN, /p\.textContent = str\(t\)/);
});

test("applyScenario refreshes the vignette with the rest of the section", () => {
  const i = SCRIPT.indexOf("window.CURRENT_SECTION_ROLEPLAY =");
  const after = SCRIPT.slice(i, i + 900);
  ["renderRoleChips", "renderRoleplayPanels", "renderObserverChecklist",
   "renderPhaseStepper", "renderRoleplayVignette"].forEach(f =>
    assert.ok(after.indexOf(f + "()") > -1, f + " must run on a scenario switch"));
});
