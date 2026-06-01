/* tests/lobby-join-density.test.js
 *
 * Regression guard for the UX-overload fix (2026-06-01) to the join screen.
 * The lobby was the densest screen in the journey: a default-OPEN 6-paragraph
 * GDPR/APPI privacy wall plus a ~90-word certificate-verification paragraph
 * sat on the critical path before the Join button.
 *
 * The fix collapses the legal walls WITHOUT hiding the consent control
 * (lazy-locale-consent.spec.js + good consent practice require the consent
 * checkbox to render on first paint):
 *   1. the privacy <details> is CLOSED by default (no `open`);
 *   2. the verification paragraph is MOVED inside that <details>;
 *   3. the consent checkbox stays present + not behind a hidden step.
 *
 * Static assertions against index.html, matching the repo's test style.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const INDEX = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "index.html"),
  "utf8");

// The privacy-note <details> block (opening tag through its </details>).
function privacyDetailsBlock() {
  const start = INDEX.indexOf('<details class="privacy-note"');
  assert.ok(start !== -1, "the privacy-note <details> must exist");
  const end = INDEX.indexOf("</details>", start);
  assert.ok(end !== -1, "the privacy-note <details> must be closed");
  return INDEX.slice(start, end + "</details>".length);
}

test("the privacy notice is CLOSED by default (no `open` attribute)", () => {
  const openTag = INDEX.match(/<details class="privacy-note"[^>]*>/);
  assert.ok(openTag, "privacy-note <details> opening tag must exist");
  assert.doesNotMatch(openTag[0], /\bopen\b/,
    "the 6-paragraph privacy wall must not be open by default on the join screen");
});

test("the certificate-verification paragraph lives INSIDE the privacy disclosure", () => {
  const block = privacyDetailsBlock();
  assert.match(block, /data-i18n="lobby\.consent-verification"/,
    "the verification note must be moved inside the privacy <details> (off the critical path)");
});

test("the verification note appears exactly once and NOT on the critical path", () => {
  const occurrences = INDEX.split('data-i18n="lobby.consent-verification"').length - 1;
  assert.strictEqual(occurrences, 1, "the verification note must not be duplicated");
  // it must not sit in the consent block between the checkboxes and the join button
  const consentStart = INDEX.indexOf('id="consent-workshop"');
  const joinStart = INDEX.indexOf('id="join-btn"');
  const verifyAt = INDEX.indexOf('data-i18n="lobby.consent-verification"');
  assert.ok(consentStart !== -1 && joinStart !== -1 && verifyAt !== -1);
  assert.ok(!(verifyAt > consentStart && verifyAt < joinStart),
    "the verification note must no longer sit between the consent boxes and Join");
});

test("the consent control is NOT hidden behind a step (renders on first paint)", () => {
  // the consent checkbox + version line must still be present; consent must
  // not be wrapped in a hidden/collapsed step container (the test suite +
  // good practice require it visible at first paint).
  assert.match(INDEX, /id="consent-workshop"/, "workshop-consent checkbox must exist");
  assert.match(INDEX, /id="consent-version"/, "consent-version line must exist");
  // guard against a regression that buries consent inside a hidden wrapper
  const consentBlock = INDEX.slice(
    INDEX.indexOf('class="consent-block"'),
    INDEX.indexOf('id="join-btn"'));
  assert.ok(!/hidden/.test(consentBlock.slice(0, 40)),
    "the consent-block itself must not be hidden");
});
