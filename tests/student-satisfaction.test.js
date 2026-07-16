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
const I18N = require("./_i18n_source.js").readI18nSource();
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

// The "I'd rather observe" escape button + wireObserveEscape() were removed
// 2026-07-16 (user request) as a duplicate of the Observer role chip; their
// existence/wiring assertions moved to stage-ui-fixes.test.js (Item 2), which
// now pins that the button is GONE and the Observer chip remains.

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
  for (const key of ["answer.support.send", "answer.support.placeholder"]) {
    const n = (I18N.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length;
    assert.ok(n >= 3, key + " must be defined in en, fr and ja (got " + n + ")");
  }
});

test("the new affordances are styled", () => {
  assert.match(CSS, /\.entry-agree\b/, "the agree button must be styled");
});
