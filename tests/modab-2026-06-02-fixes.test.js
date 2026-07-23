/* tests/modab-2026-06-02-fixes.test.js
 *
 * Structural + functional lock-ins for the 2026-06-02 Module A/B user requests:
 *   1. Examination / Investigations chart sections no longer auto-collapse on
 *      reveal (clicking an item must not close the section).
 *   2. Free-text patient questions show point-of-action feedback (toast + chip)
 *      when they earn OR cost points.
 *   3. An inappropriate (penalised) exam/investigation reveal is coloured RED,
 *      not the usual green ✓.
 *   4. The "Discussed verbally — skip ahead →" prompt button is removed.
 *   5. Module A: a "call a facilitator to move to Module B" button appears once
 *      all four group-answer bullets are filled.
 *   6. Module B: the 4-phase stepper sits right after the role picker, and a
 *      "call a facilitator to go to the final section" button appears once all
 *      three group-answer bullets are filled.
 *
 * Fast text/source assertions on the served files; observable behaviour is
 * covered per-device in tests-e2e/modab-2026-06-02-fixes.spec.js. Runs under
 * `node --test tests/*.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8") +
  // room-only rules moved to the lazily-loaded room.css (perf reclaim)
  " " + fs.readFileSync(path.join(P, "room.css"), "utf8");
const JS = fs.readFileSync(path.join(P, "script.js"), "utf8");
const INIT = fs.readFileSync(path.join(P, "modA-llm-init.js"), "utf8");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
const FR = fs.readFileSync(path.join(P, "locales", "fr.js"), "utf8");
const JA = fs.readFileSync(path.join(P, "locales", "ja.js"), "utf8");

function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

/* Load case-content.js so we can read the real PENALTIES list (mirrors the
 * loader trick in tests/modA-question-scoring.test.js). */
function loadCaseContent() {
  const ctx = {};
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.PENALTIES = PENALTIES; this.CASE = CASE;";
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, ctx, ctx);
  return ctx;
}

/* ── #1 auto-collapse removed ─────────────────────────────────────────────── */

test("#1 the chart-section auto-collapse function was removed", () => {
  assert.ok(!/function _autoCollapseCompletedChartSections/.test(JS),
    "_autoCollapseCompletedChartSections must be gone");
  assert.ok(!/_AUTO_COLLAPSE_MIN/.test(JS),
    "the _AUTO_COLLAPSE_MIN threshold constant must be gone");
});

test("#1 renderButtons no longer calls the auto-collapse routine", () => {
  const body = fnBody("renderButtons");
  assert.ok(body.length > 0, "renderButtons must exist");
  assert.ok(!/_autoCollapseCompletedChartSections\(\)/.test(body),
    "renderButtons must not auto-collapse sections on reveal");
});

/* ── #3 inappropriate reveals coloured red ────────────────────────────────── */

test("#3 rebuildCaseDerived builds the penalised-item id set", () => {
  const body = fnBody("rebuildCaseDerived");
  assert.match(body, /PENALTY_ITEM_IDS\s*=\s*new Set\(/,
    "rebuildCaseDerived must (re)derive PENALTY_ITEM_IDS from the active PENALTIES");
  assert.match(JS, /let PENALTY_ITEM_IDS = new Set\(\);/,
    "PENALTY_ITEM_IDS must be a module-scoped Set binding");
});

test("#3 renderButtons toggles a 'wrong-choice' class on revealed penalty items", () => {
  const body = fnBody("renderButtons");
  assert.match(body, /classList\.toggle\("wrong-choice",\s*!!revealed\[id\] && PENALTY_ITEM_IDS\.has\(id\)\)/,
    "a revealed penalty item must get the wrong-choice class");
  assert.match(body, /inline\.classList\.toggle\("wrong",\s*PENALTY_ITEM_IDS\.has\(id\)\)/,
    "the inline reveal must get the wrong class for penalty items");
});

test("#3 CSS paints a wrong-choice reveal red with a ✗ mark", () => {
  // Hardcoded #c0392b (not the --key token) so the red is theme-independent —
  // the dark-theme --key is a light salmon that fails contrast on the light
  // wrong background. Mirrors the existing .decision.committed.wrong styling.
  assert.match(CSS, /\.req-btn\.done\.wrong-choice\s*\{[^}]*#c0392b/,
    "wrong-choice button must use the hardcoded red #c0392b");
  assert.match(CSS, /\.req-btn\.done\.wrong-choice::before\s*\{[^}]*content:\s*"\\2717/,
    "wrong-choice button must show a ✗ instead of the green ✓");
  assert.match(CSS, /\.req-inline-reveal\.wrong/,
    "the inline reveal must have a .wrong red style");
});

test("#3 the penalised items really are the exam/investigation 'wrong moves'", () => {
  const ctx = loadCaseContent();
  assert.ok(Array.isArray(ctx.PENALTIES), "PENALTIES must load");
  const items = new Set(ctx.PENALTIES.map(p => p.item));
  // Investigations the case does not need + the two wrong examinations.
  ["labs:1", "labs:2", "labs:3", "labs:4", "exam:5", "exam:6"].forEach(id => {
    assert.ok(items.has(id), "PENALTIES must penalise " + id);
  });
});

/* ── #2 points feedback in the chat ───────────────────────────────────────── */

test("#2 toast() supports a green 'gain' variant", () => {
  assert.match(JS, /kind === "gain" \? " gain"/,
    "toast() must add a .gain class for award toasts");
  assert.match(CSS, /\.toast\.gain\s*\{/, "a .toast.gain (green) style must exist");
});

test("#2 the chat renders point-of-action feedback for scored questions", () => {
  assert.match(INIT, /function _showScoreFeedback\(/,
    "modA-llm-init must define _showScoreFeedback");
  assert.match(INIT, /_showScoreFeedback\(res, transcriptEl\)/,
    "_onSubmit must call _showScoreFeedback after a turn");
  // award path → green toast (gain); penalty path → loss toast.
  assert.match(INIT, /"gain"\)/, "award feedback must use the gain toast");
  assert.match(INIT, /"loss"\)/, "penalty feedback must use the loss toast");
  assert.match(INIT, /moda-chat-score/, "an inline score chip must be rendered");
});

test("#2 CSS styles the in-chat award (green) and penalty (red) chips", () => {
  assert.match(CSS, /\.moda-chat-score\.is-award/, "award chip style must exist");
  assert.match(CSS, /\.moda-chat-score\.is-penalty/, "penalty chip style must exist");
});

/* ── #4 skip button removed ───────────────────────────────────────────────── */

test("#4 the 'skip ahead' prompt button is gone from the DOM + JS + i18n", () => {
  assert.ok(!/id="prompt-skip"/.test(INDEX), "#prompt-skip must be removed from index.html");
  assert.ok(!/Discussed verbally/.test(INDEX), "the skip copy must be gone from index.html");
  assert.ok(!/el\("prompt-skip"\)/.test(JS), "script.js must not look up #prompt-skip");
  [I18N, FR, JA].forEach(src => {
    assert.ok(!/"prompts\.skip"/.test(src), "the prompts.skip i18n key must be removed");
  });
});

/* ── #5 Module A completion CTA ───────────────────────────────────────────── */

test("#5 Module A answers card carries the completion CTA", () => {
  assert.match(INDEX, /id="modA-answers-complete"/, "the Module A completion box must exist");
  assert.match(INDEX, /id="modA-call-next-btn"/, "the Module A call-facilitator button must exist");
  assert.match(INDEX, /data-i18n="modA\.answers\.complete\.cta"/, "button must be i18n-wired");
});

test("#5 updateModANextStep reveals the CTA when all four bullets are covered", () => {
  const body = fnBody("updateModANextStep");
  assert.match(body, /_updateAnswersCompleteCta\("modA-answers-complete",\s*"modA-call-next-btn",\s*allBulletsCovered/,
    "updateModANextStep must toggle the Module A CTA on allBulletsCovered");
});

/* ── #6 Module B layout + completion CTA ──────────────────────────────────── */

test("#6 the Module B phase stepper now sits AFTER the role picker", () => {
  const rolePicker = INDEX.indexOf('id="modB-role-picker"');
  const stepper = INDEX.indexOf('class="phase-stepper" aria-label="Module B phases"');
  assert.ok(rolePicker > 0, "the role picker must exist");
  assert.ok(stepper > 0, "the Module B phase stepper must exist");
  assert.ok(stepper > rolePicker,
    "the phase stepper must appear after the role picker in source order");
  // The phase-nav (Prev/Next) travelled with it.
  const nav = INDEX.indexOf('id="modB-phase-nav"');
  assert.ok(nav > rolePicker, "the phase nav must also sit after the role picker");
});

test("#6 Module B answers card carries the completion CTA", () => {
  assert.match(INDEX, /id="modB-answers-complete"/, "the Module B completion box must exist");
  assert.match(INDEX, /id="modB-call-next-btn"/, "the Module B call-facilitator button must exist");
  assert.match(INDEX, /data-i18n="modB\.answers\.complete\.cta"/, "button must be i18n-wired");
});

test("#6 updateModBNextStep reveals the CTA when all three bullets are covered", () => {
  const body = fnBody("updateModBNextStep");
  assert.match(body, /_updateAnswersCompleteCta\("modB-answers-complete",\s*"modB-call-next-btn",\s*allBulletsCovered/,
    "updateModBNextStep must toggle the Module B CTA on allBulletsCovered");
});

test("#5/#6 the advance buttons reuse callForHelp with a phase-specific message", () => {
  const body = fnBody("_callFacilitatorToAdvance");
  assert.ok(body.length > 0, "_callFacilitatorToAdvance must exist");
  assert.match(body, /refCallForHelp\.set\(\{ by: myName, at: now, msg: reason \}/,
    "it must write the reason into callForHelp.msg");
  assert.match(body, /HELP_CALL_THROTTLE_MS/, "it must respect the existing help-call throttle");
});

test("#5/#6 the completion i18n keys ship in en/fr/ja", () => {
  ["modA.answers.complete.cta", "modB.answers.complete.cta", "room.call.sent"].forEach(key => {
    [I18N, FR, JA].forEach(src => {
      assert.ok(src.indexOf('"' + key + '"') >= 0, key + " must exist in every shipped locale");
    });
  });
});
