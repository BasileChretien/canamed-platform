/* tests/round2-a11y.test.js
 *
 * Lock-in tests for the Round-2 specialist-agent a11y BLOCKER fixes
 * (see sim-output/round2-a11y-inclusion.md):
 *
 *   A1  #a11y-stage-announce live region exists in index.html
 *       (script.js:5438 writes to this id; missing element silently
 *       dropped every facilitator-call SR announcement)
 *
 *   A2  Foreign-language inline phrases carry lang= attributes so JP
 *       / FR cohort doesn't get English-voice mispronunciation
 *       (要配慮個人情報, mayaku, loi Kouchner, Annoncer une mauvaise nouvelle)
 *
 *   A3  Tour overlay no longer claims role="dialog" + aria-modal="false"
 *       (contradictory). Uses role="region" instead.
 *
 *   A4  Tour overlay click only dismisses on the LAST step (no silent
 *       skip-by-stray-click for motor-impaired users).
 *
 *   A5  dismiss() restores focus to the activeElement captured on start().
 *
 *   A7  .consultation-note has aria-labelledby tying it to its h3.
 *
 *   A8  --n-500 contrast bumped (≈5.6:1 minimum on --bg).
 *
 *   A9  prefers-reduced-motion block kills .conn-badge.conn-lost shake.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX_HTML = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const TOUR_JS    = fs.readFileSync(path.join(PLATFORM, "tour.js"),    "utf8");
const STYLE_CSS  = fs.readFileSync(path.join(PLATFORM, "style.css"),  "utf8") +
  // design tokens were extracted to tokens.css (Clinical Editorial restyle);
  // token-value assertions below apply to the pair as one cascade
  fs.readFileSync(path.join(PLATFORM, "tokens.css"), "utf8");

// ------------------------------------------------------------------
// A1 — missing live region restored
// ------------------------------------------------------------------
test("Round2-A1: index.html has an #a11y-stage-announce polite live region", () => {
  // The element script.js:5438 writes to. Must be aria-live=polite +
  // sr-only, otherwise the facilitator-call confirmation is silent.
  const re = /<div\s+id="a11y-stage-announce"[^>]*aria-live="polite"[^>]*>/;
  assert.match(INDEX_HTML, re,
    "index.html must define #a11y-stage-announce with aria-live='polite'");
  assert.match(INDEX_HTML, /id="a11y-stage-announce"[^>]*class="sr-only"/,
    "#a11y-stage-announce must be sr-only so it's off-screen visually");
});

// ------------------------------------------------------------------
// A2 — foreign phrases have lang= annotations
// ------------------------------------------------------------------
test("Round2-A2: 要配慮個人情報 carries lang='ja'", () => {
  assert.match(INDEX_HTML,
    /<strong\s+lang="ja">要配慮個人情報<\/strong>/,
    "the APPI special-category term must be annotated lang='ja'");
});
test("Round2-A2: 'mayaku' carries lang='ja'", () => {
  assert.match(INDEX_HTML,
    /<em\s+lang="ja">mayaku<\/em>/,
    "the romanised Japanese term 'mayaku' must be annotated lang='ja'");
});
test("Round2-A2: 'loi Kouchner' inline use carries lang='fr'", () => {
  // At least one instance must be annotated; reference-list "loi
  // Kouchner" can stay if the surrounding French context is annotated.
  const matches = INDEX_HTML.match(/<em\s+lang="fr">loi Kouchner<\/em>/g) || [];
  assert.ok(matches.length >= 1,
    "at least one inline use of 'loi Kouchner' must carry lang='fr'");
});
test("Round2-A2: 'Annoncer une mauvaise nouvelle' carries lang='fr'", () => {
  assert.match(INDEX_HTML,
    /<em\s+lang="fr">Annoncer une mauvaise nouvelle<\/em>/,
    "the HAS document title must be annotated lang='fr'");
});

// ------------------------------------------------------------------
// A3 — tour role contradiction fixed
// ------------------------------------------------------------------
test("Round2-A3: tour root no longer declares role='dialog'", () => {
  // The previous code set role='dialog' + aria-modal='false', which
  // is contradictory. Switch to role='region'.
  assert.doesNotMatch(TOUR_JS,
    /setAttribute\(\s*"role"\s*,\s*"dialog"\s*\)/,
    "tour.buildRoot must NOT set role='dialog'");
  assert.match(TOUR_JS,
    /setAttribute\(\s*"role"\s*,\s*"region"\s*\)/,
    "tour.buildRoot must set role='region' instead");
});

// ------------------------------------------------------------------
// A4 — overlay click only dismisses on last step
// ------------------------------------------------------------------
test("Round2-A4: overlay click no longer advances mid-tour", () => {
  // The fixed handler should call dismiss(true) on the last step only;
  // it must NOT call goTo() to advance. Grep the overlay click handler.
  const m = TOUR_JS.match(
    /overlay\.addEventListener\("click",\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
  assert.ok(m, "overlay click handler must exist");
  const body = m[1];
  assert.match(body, /dismiss\(true\)/,
    "overlay click must dismiss on the last step");
  assert.doesNotMatch(body, /goTo\(/,
    "overlay click must NOT call goTo (motor-accessibility hazard)");
});

// ------------------------------------------------------------------
// A5 — focus restore on dismiss
// ------------------------------------------------------------------
test("Round2-A5: tour.start() captures the opener element", () => {
  assert.match(TOUR_JS, /opener\s*=\s*document\.activeElement/,
    "start() must capture document.activeElement as the opener");
  assert.match(TOUR_JS, /active\s*=\s*\{[\s\S]*?opener\b/,
    "the opener must be stashed on the `active` object");
});
test("Round2-A5: tour.dismiss() restores focus to the opener", () => {
  // dismiss() must call opener.focus() inside a try/catch (the element
  // may have been removed from the DOM by stage transitions).
  assert.match(TOUR_JS,
    /opener\.focus\s*\(\s*\)/,
    "dismiss() must call opener.focus() to restore keyboard focus");
});


// ------------------------------------------------------------------
// A7 — consultation-note accessible name
// ------------------------------------------------------------------
test("Round2-A7: .consultation-note carries an accessible name", () => {
  // 2026-07-15: the visible "consultation note" h3 was fused into the patient
  // vignette; the article now names itself with a concise aria-label (the old
  // aria-labelledby pointed at the removed h3).
  assert.match(INDEX_HTML,
    /<article\s+class="consultation-note"[\s\S]{0,120}?aria-label="[^"]+"/,
    ".consultation-note <article> must carry an aria-label accessible name");
});

// ------------------------------------------------------------------
// A8 — --n-500 contrast bump
// ------------------------------------------------------------------
test("Round2-A8: --n-500 is no longer #5b6b7a (bumped for AA comfort)", () => {
  // The original failing token. The new value must be a darker grey to
  // raise contrast on warm-paper --bg.
  assert.doesNotMatch(STYLE_CSS,
    /--n-500:\s*#5b6b7a\b/,
    "--n-500 #5b6b7a fails AA comfort margin on warm-paper background");
  assert.match(STYLE_CSS,
    /--n-500:\s*#4d5b6a\b/,
    "--n-500 should be #4d5b6a (≈5.6:1 on --bg)");
});

// ------------------------------------------------------------------
// A9 — reduced-motion gates the conn-lost shake
// ------------------------------------------------------------------
test("Round2-A9: prefers-reduced-motion kills .conn-badge.conn-lost shake", () => {
  // The reduced-motion block must list .conn-badge.conn-lost { animation: none; }
  // somewhere in style.css.
  assert.match(STYLE_CSS,
    /prefers-reduced-motion[\s\S]*?\.conn-badge\.conn-lost\s*\{[^}]*animation:\s*none/,
    "reduced-motion block must disable the conn-lost shake animation");
});
