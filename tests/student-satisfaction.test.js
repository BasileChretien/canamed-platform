/* tests/student-satisfaction.test.js
 *
 * Student-satisfaction batch (2026-05-22):
 *  1. "I'd rather observe" panic affordance — the safety-note promises a
 *     no-explanation exit into the observer role; this makes it one calm tap.
 *  2. "agree ↩" support stance on the existing disagree/counter-bullet — debate
 *     isn't only dissent; quieter students can amplify a point they back.
 *
 * Static source-text checks; the panic affordance is also driven end-to-end in
 * tests-e2e/student-satisfaction.spec.js (+ a mobile.spec.js case).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

test("the role-picker exposes an 'I'd rather observe' escape + reassurance region", () => {
  assert.match(HTML, /id="modB-observe-instead-btn"/, "the observe-escape button must exist");
  const i = HTML.indexOf('id="modB-observe-reassure"');
  assert.ok(i > -1, "the reassurance region must exist");
  const blk = HTML.slice(i - 120, i + 80);
  assert.match(blk, /aria-live="polite"/, "the reassurance must be a polite live region");
});

test("the observe escape selects the observer role (reuses the synced pick)", () => {
  assert.match(SCRIPT, /function wireObserveEscape\(\)/, "wireObserveEscape must exist");
  const i = SCRIPT.indexOf("function wireObserveEscape");
  const blk = SCRIPT.slice(i, i + 900);
  assert.match(blk, /role-chip\[data-role="observer"\]/, "must target the observer chip");
  assert.match(blk, /observerChip\.click\(\)/,
    "must reuse the chip-select path so the role syncs + coach hooks fire");
  assert.match(blk, /modB\.observe\.reassure/, "must show the localised reassurance");
  // It must be wired from initRolePicker.
  assert.match(SCRIPT, /wireObserveEscape\(\);/, "wireObserveEscape must be wired in initRolePicker");
});

test("the counter-bullet now supports an agree/support stance", () => {
  // Both buttons render on a teammate's answer.
  assert.match(SCRIPT, /entry-agree/, "an 'agree' button must render on teammate answers");
  assert.match(SCRIPT, /openCounterBullet\(entry, li, "support"\)/, "agree must open a support-stance form");
  assert.match(SCRIPT, /openCounterBullet\(entry, li, "disagree"\)/, "disagree must pass its stance explicitly");
  // The form carries the stance through to the synced reply.
  assert.match(SCRIPT, /function _setCounterFormStance\(form, stance\)/, "stance helper must exist");
  const i = SCRIPT.indexOf("function openCounterBullet");
  const blk = SCRIPT.slice(i, i + 1800);
  assert.match(blk, /form\.dataset\.stance === "support" \? "support" : "disagree"/,
    "the submitted reply must be tagged with the form's stance");
});

test("the new student copy ships in en / fr / ja", () => {
  for (const key of ["modB.observe.escape", "modB.observe.reassure",
                     "answer.support.send", "answer.support.placeholder"]) {
    const n = (I18N.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length;
    assert.ok(n >= 3, key + " must be defined in en, fr and ja (got " + n + ")");
  }
});

test("the new affordances are styled", () => {
  assert.match(CSS, /\.role-observer-escape\b/, "the observe-escape must be styled");
  assert.match(CSS, /\.entry-agree\b/, "the agree button must be styled");
});
