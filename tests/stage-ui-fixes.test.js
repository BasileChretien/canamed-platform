/* tests/stage-ui-fixes.test.js
 *
 * Structural lock-ins for the 2026-06-02 stage-bar + Module A/B clean-ups
 * (user requests). These are fast text assertions on the served sources; the
 * observable behaviour is covered per-device by
 * tests-e2e/stage-ui-fixes.spec.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

test("Item 1 — the room #stage-indicator is sr-only (visually hidden, still announced)", () => {
  assert.match(INDEX, /id="stage-indicator"[^>]*class="stage-indicator sr-only"[^>]*aria-live="polite"/,
    "the participant #stage-indicator must carry sr-only + keep aria-live");
  // JS still writes the position string (sr announcement) — unchanged.
  assert.match(JS, /el\("stage-indicator"\)\.textContent =\s*"Stage " \+ \(viewStage \+ 1\) \+ " of " \+ STAGE_COUNT;/,
    "the position string must still be written for screen readers");
  // controls stay right-aligned now the indicator no longer holds the left.
  assert.match(CSS, /\.stage-controls--participant\s*\{\s*margin-left:\s*auto/,
    "participant controls must keep an auto left margin");
});

test("Item 2 — the 'I'm just observing' button and its wiring are gone", () => {
  assert.ok(!INDEX.includes('id="observer-btn"'), "#observer-btn must be removed from index.html");
  assert.ok(!/\binitObserver\s*\(\s*\)\s*;/.test(JS), "initObserver() must no longer be called");
  assert.ok(!/function\s+initObserver\s*\(/.test(JS), "the initObserver function must be removed");
  // The Module B roleplay observer ROLE is a different feature — keep it.
  assert.ok(INDEX.includes('id="modB-observe-instead-btn"'),
    "the Module B observer-role affordance must be untouched");
});

test("Item 3 — renderStage scrolls to the top of the window on a stage change", () => {
  const fn = fnBody("renderStage");
  assert.match(fn, /viewStage !== _lastRenderedViewStage/, "must guard on an actual stage change");
  assert.match(fn, /window\.scrollTo\(\s*\{\s*top:\s*0/, "must scroll the window to the top");
  assert.match(JS, /let _lastRenderedViewStage = -1;/, "the guard variable must be declared");
});

test("Item 6 — Module B collapses its empty right column except in 'bullets'", () => {
  const fn = fnBody("applyModBPhaseVisibility");
  assert.match(fn, /\.columns\.modB-columns/, "must target the Module B columns wrapper");
  assert.match(fn, /classList\.toggle\("rcol-collapsed",\s*phaseKey !== "bullets"\)/,
    "must collapse for every phase except 'bullets'");
  assert.match(CSS, /#stage-2 \.columns\.rcol-collapsed\s*\{\s*grid-template-columns:\s*1fr/,
    "the #stage-2 rcol-collapsed CSS rule must exist");
  assert.match(CSS, /#stage-2 \.columns\.rcol-collapsed > \.col-right\s*\{\s*display:\s*none/,
    "the collapsed right column must be hidden");
});

test("Item 4 — reference prose fills the panel width and breaks nicely", () => {
  // The full-width accordion panel must NOT re-narrow the historical prose to a
  // 70ch sidebar column (that left empty space + caused phrase-cutting wraps).
  const m = CSS.match(/\.history-card p\s*\{[^}]*\}/);
  assert.ok(m, ".history-card p rule must exist");
  assert.ok(!/max-width/.test(m[0]), ".history-card p must not cap the width to a narrow column");
  // text-wrap:pretty for nicer break points / no last-line orphans.
  assert.match(CSS, /\.reference-panel p,[\s\S]*?text-wrap:\s*pretty/,
    "reference-panel prose must use text-wrap:pretty");
});

test("Item 7 — the Module A diagnosis is surfaced at the wrap-up", () => {
  assert.match(JS, /function moduleADiagnosis\(/, "moduleADiagnosis must be defined");
  const fn = fnBody("moduleADiagnosis");
  assert.match(fn, /itemById\(SYNTH_ID\)/, "must read the active scenario's synthesis item");
  assert.match(fn, /diagnos|診断/, "must locate the labelled Diagnosis segment");
  assert.match(JS, /moduleADiagnosis\(\)/, "renderWrapupSummary must call moduleADiagnosis");
  assert.match(JS, /p\.className = "wrapup-diagnosis"/, "must render the diagnosis with the wrapup-diagnosis class");
  assert.match(CSS, /\.wrapup-diagnosis\s*\{/, "the .wrapup-diagnosis style must exist");
});
