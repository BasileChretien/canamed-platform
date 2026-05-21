/* tests/round4-a11y.test.js
 *
 * Lock-in tests for the Round-4 specialist-agent a11y fixes
 * (see sim-output/round4-a11y.md). Static source assertions in the
 * same style as tests/round2-a11y.test.js — no DOM here (the live
 * flows are covered by Playwright); we pin the source-level contracts
 * so a future refactor that drops one of these goes red.
 *
 *   R4-1  renderContrib() emits a NON-VISUAL contributed / not-yet
 *         status label per chip (colour + dot-fill alone failed
 *         WCAG 1.4.1 / 1.3.1). The dot is aria-hidden; the name is
 *         still rendered via createTextNode (never innerHTML).
 *
 *   R4-2  Glossed buttons get an accessible, NON-title hook
 *         (aria-description + a real .glossary-marker child with an
 *         accessible name), so the gloss is reachable without a mouse
 *         hover (WCAG 1.4.13 / 2.1.1).
 *
 *   R4-3  The dense History group is sub-grouped into a short visible
 *         cluster + a collapsed labelled <details> so the at-once
 *         button count drops for the A2/B1 cohort, without removing
 *         any option (round4-a11y Rec 4).
 *
 *   R4-4  The Module B role-picker radiogroup arrow handler MOVES AND
 *         SELECTS (updates aria-checked + fires the click side-effects),
 *         matching the WAI-ARIA radio pattern (WCAG 2.1.1).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT_JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const STYLE_CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
const I18N_JS   = fs.readFileSync(path.join(PLATFORM, "i18n.js"),   "utf8");

// Helper: extract a function body by name from script.js source so an
// assertion can be scoped to one function and not match incidentally
// elsewhere. Returns the source slice from the function header to a
// heuristic end (next top-level `function ` declaration).
function fnSlice(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.ok(start !== -1, "function " + name + " must exist in script.js");
  const after = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, after === -1 ? undefined : after);
}

// ------------------------------------------------------------------
// R4-1 — renderContrib non-visual status label
// ------------------------------------------------------------------
test("Round4-1: renderContrib emits a visually-hidden contributed/not-yet status", () => {
  const fn = fnSlice(SCRIPT_JS, "renderContrib");
  // a sr-only status span is appended per chip
  assert.match(fn, /className\s*=\s*"sr-only"/,
    "renderContrib must append an sr-only status span per chip");
  // both the acted and not-yet states are conveyed as TEXT (via i18n keys
  // with English fallbacks) — no number is introduced (no-shame design)
  assert.match(fn, /modA\.contrib\.acted/,
    "renderContrib must reference the 'contributed' status key");
  assert.match(fn, /modA\.contrib\.not-yet/,
    "renderContrib must reference the 'not yet' status key");
  assert.match(fn, /"contributed"/, "English fallback 'contributed' must be present");
  assert.match(fn, /"not yet"/, "English fallback 'not yet' must be present");
  // the dot is decorative now → aria-hidden
  assert.match(fn, /dot\.setAttribute\(\s*"aria-hidden"\s*,\s*"true"\s*\)/,
    "the contrib dot must be aria-hidden (meaning carried by the sr-only text)");
  // names still go through createTextNode, never innerHTML, in this fn
  assert.match(fn, /createTextNode\(nm\)/,
    "the contributor name must be rendered via createTextNode");
  assert.doesNotMatch(fn, /\binnerHTML\b\s*=\s*[^"']*\bnm\b/,
    "the contributor name must never be assigned via innerHTML");
});

test("Round4-1: contrib status i18n keys exist in en/fr/ja", () => {
  for (const key of ["modA.contrib.acted", "modA.contrib.not-yet"]) {
    assert.ok(I18N_JS.indexOf('"' + key + '"') !== -1,
      "i18n.js must define " + key);
  }
  // present in all three core blocks (en/fr/ja) — count occurrences
  const occ = (I18N_JS.match(/"modA\.contrib\.acted"/g) || []).length;
  assert.ok(occ >= 3, "modA.contrib.acted should appear in at least en/fr/ja blocks");
});

// ------------------------------------------------------------------
// R4-2 — glossary non-title accessible hook
// ------------------------------------------------------------------
test("Round4-2: glossed buttons get a NON-title accessible hook", () => {
  const fn = fnSlice(SCRIPT_JS, "_annotateButtonWithGlossary");
  // aria-description carries the gloss into the accessible name computation
  assert.match(fn, /setAttribute\(\s*"aria-description"/,
    "_annotateButtonWithGlossary must set aria-description (not just title)");
  // a real child marker element (keyboard/touch/SR discoverable), not a
  // CSS ::after pseudo-element
  assert.match(fn, /className\s*=\s*"glossary-marker"/,
    "_annotateButtonWithGlossary must append a real .glossary-marker element");
  // the marker has an accessible name
  assert.match(fn, /setAttribute\(\s*"aria-label"/,
    "the glossary marker must carry an accessible aria-label");
  assert.match(fn, /modA\.glossary\.marker-label/,
    "the glossary marker label must be i18n-driven");
});

test("Round4-2: the decorative ::after marker is suppressed when the real marker is present", () => {
  assert.match(STYLE_CSS, /has-glossary:not\(:has\(\.glossary-marker\)\)::after/,
    "the ::after ⓘ badge must be suppressed when a real .glossary-marker exists");
});

// ------------------------------------------------------------------
// R4-3 — History sub-grouping
// ------------------------------------------------------------------
test("Round4-3: History group is split into a visible cluster + collapsed sub-group", () => {
  const fn = fnSlice(SCRIPT_JS, "buildButtons");
  // only the dense history group is sub-grouped
  assert.match(fn, /group\s*===\s*"history"/,
    "buildButtons must special-case the dense history group");
  // a collapsed <details> overflow sub-group carrying the rest
  assert.match(fn, /createElement\(\s*"details"\s*\)/,
    "history overflow must live in a <details> so it starts collapsed");
  assert.match(fn, /history-sub-more/,
    "the overflow sub-group must use the .history-sub-more class");
  // the primary cluster is a labelled group
  assert.match(fn, /modA\.history\.sub\.primary/,
    "the primary history cluster must carry an i18n group label");
  assert.match(fn, /modA\.history\.sub\.more/,
    "the overflow history sub-group must carry an i18n label");
  // ALL buttons are still produced (slice 0..N and slice N..) — no item dropped
  assert.match(fn, /\.slice\(\s*0\s*,\s*HISTORY_VISIBLE_COUNT\s*\)/,
    "the first cluster must take the first HISTORY_VISIBLE_COUNT items");
  assert.match(fn, /\.slice\(\s*HISTORY_VISIBLE_COUNT\s*\)/,
    "the overflow must take ALL remaining items (none dropped)");
});

test("Round4-3: History sub-group i18n labels exist in en/fr/ja", () => {
  for (const key of ["modA.history.sub.primary", "modA.history.sub.more"]) {
    const occ = (I18N_JS.match(new RegExp('"' + key.replace(/\./g, "\\.") + '"', "g")) || []).length;
    assert.ok(occ >= 3, key + " should appear in at least en/fr/ja blocks (found " + occ + ")");
  }
});

// ------------------------------------------------------------------
// R4-4 — radiogroup arrow keys move AND select
// ------------------------------------------------------------------
test("Round4-4: initRolePicker arrow handler updates aria-checked (select-on-move)", () => {
  const fn = fnSlice(SCRIPT_JS, "initRolePicker");
  // a shared select() routine sets aria-checked across siblings + persists
  assert.match(fn, /const\s+select\s*=/,
    "initRolePicker must define a shared select() routine");
  assert.match(fn, /setAttribute\(\s*"aria-checked"\s*,\s*"true"\s*\)/,
    "select() must set aria-checked='true' on the chosen chip");
  // the arrow-key handler must MOVE focus AND call select() on the next chip
  const arrowBlock = fn.slice(fn.indexOf('"ArrowRight"'));
  assert.match(arrowBlock, /next\.focus\(\)/,
    "arrow handler must move focus to the next chip");
  assert.match(arrowBlock, /select\(\s*next\s*\)/,
    "arrow handler must SELECT the focused chip (update aria-checked), not just move focus");
});
