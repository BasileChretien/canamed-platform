/* tests/glossary-marker-tap.test.js
 *
 * UX-overload Phase-3 item #4: make the 📖 .glossary-marker reachable by TAP
 * and KEYBOARD, not hover-only.
 *
 * The constraint: the marker lives INSIDE the reveal <button>, so it must stay
 * a non-interactive <span> (a focusable/interactive descendant of a <button>
 * is invalid HTML). So tapping the marker opens the gloss with stopPropagation
 * (the reveal must NOT fire), and the keyboard path surfaces the gloss when the
 * BUTTON gets keyboard focus (:focus-visible) — SR users already get it via the
 * button's aria-description (preserved; see round4-a11y.test.js).
 *
 * Runtime behaviour (tap opens popover + suppresses reveal; Escape dismisses)
 * is covered by tests-e2e/glossary-marker-tap.spec.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");

function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

test("the gloss marker / popover helpers exist and are wired from the annotator", () => {
  assert.ok(JS.includes("function _wireGlossMarker("), "_wireGlossMarker must exist");
  assert.ok(JS.includes("function _showGloss("), "_showGloss must exist");
  assert.ok(JS.includes("function _hideGloss("), "_hideGloss must exist");
  assert.match(fnBody("_annotateButtonWithGlossary"), /_wireGlossMarker\(btn,\s*mark,/,
    "_annotateButtonWithGlossary must wire the marker after appending it");
});

test("the marker stays a non-interactive <span> (no interactive nested in the button)", () => {
  const fn = fnBody("_annotateButtonWithGlossary");
  assert.match(fn, /createElement\("span"\)/, "the marker must be a <span>");
  // it must NOT become a button / anchor / get tabindex (would be invalid
  // interactive content inside the <button> and break HTML validity)
  assert.doesNotMatch(fn, /mark\.(setAttribute\("tabindex"|tabIndex)/,
    "the marker must not be focusable (no tabindex) — keep it valid inside the button");
  assert.doesNotMatch(fn, /createElement\("(button|a)"\)/,
    "the marker must not be a button/anchor nested in the reveal button");
});

test("TAP: the marker click opens the gloss and stops the reveal from firing", () => {
  const fn = fnBody("_wireGlossMarker");
  assert.match(fn, /addEventListener\("click"/, "the marker must handle click");
  assert.match(fn, /stopPropagation\(\)/, "the marker click must stopPropagation (no reveal)");
  assert.match(fn, /preventDefault\(\)/, "the marker click must preventDefault");
  assert.match(fn, /_showGloss\(/, "the marker click must open the gloss");
});

test("KEYBOARD: the gloss shows on the button's keyboard focus (:focus-visible)", () => {
  const fn = fnBody("_wireGlossMarker");
  assert.match(fn, /addEventListener\("focus"/, "must react to button focus");
  assert.match(fn, /:focus-visible/, "must gate on :focus-visible so mouse focus doesn't flash it");
  assert.match(fn, /addEventListener\("blur",\s*_hideGloss\)/, "must hide on blur");
});

test("the popover is a visual, dismissible, aria-hidden node", () => {
  const fn = fnBody("_glossPop");
  assert.match(fn, /"gloss-pop"/, "popover class");
  assert.match(fn, /aria-hidden"?,\s*"true"/, "popover is aria-hidden (SR uses aria-description)");
  assert.match(fn, /"Escape"/, "Escape must dismiss the popover (WCAG 1.4.13)");
  // CSS for the popover + the enlarged tap target on the marker
  assert.match(CSS, /\.gloss-pop\s*\{/, ".gloss-pop must be styled");
  assert.match(CSS, /\.glossary-marker\s*\{[^}]*padding:/, "the marker must have a padded tap target");
});
