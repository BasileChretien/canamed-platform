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
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8") +
  // room-only rules moved to the lazily-loaded room.css (perf reclaim)
  " " + fs.readFileSync(path.join(PLATFORM, "room.css"), "utf8");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const I18N = fs.readFileSync(path.join(PLATFORM, "i18n.js"), "utf8");
const FR = fs.readFileSync(path.join(PLATFORM, "locales", "fr.js"), "utf8");
const JA = fs.readFileSync(path.join(PLATFORM, "locales", "ja.js"), "utf8");
const TOUR = fs.readFileSync(path.join(PLATFORM, "tour.js"), "utf8");

function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

test("Item 1 — the room #stage-indicator is sr-only (visually hidden, still announced)", () => {
  assert.match(INDEX, /id="stage-indicator"[^>]*class="stage-indicator sr-only"[^>]*aria-live="polite"/,
    "the participant #stage-indicator must carry sr-only + keep aria-live");
  // JS still writes a "Stage X of Y" position string (sr announcement). It now
  // counts by position in the active stageFlow() — branched scenarios skip
  // stage 2, so the total is the flow length, not the raw STAGE_COUNT.
  assert.match(JS, /el\("stage-indicator"\)\.textContent =\s*\n?\s*"Stage " \+ \(\(_pos === -1 \? viewStage : _pos\) \+ 1\) \+ " of " \+ _flow\.length;/,
    "the position string must still be written for screen readers (flow-aware)");
  // 2026-07-15: the header is now a single line — score chip + controls + the
  // Details toggle cluster on the LEFT (margin-left:0), and the inline Live-
  // leaderboard disclosure owns the right edge with the auto margin instead.
  assert.match(CSS, /\.stage-controls--participant\s*\{\s*margin-left:\s*0/,
    "participant controls no longer grab the right edge (leaderboard does)");
  assert.match(CSS, /\.stage-row\s*>\s*\.leaderboard-inline\s*\{\s*margin-left:\s*auto/,
    "the inline leaderboard must own the right edge of the header row");
});

test("Item 2 — the 'I'm just observing' button and its wiring are gone", () => {
  assert.ok(!INDEX.includes('id="observer-btn"'), "#observer-btn must be removed from index.html");
  assert.ok(!/\binitObserver\s*\(\s*\)\s*;/.test(JS), "initObserver() must no longer be called");
  assert.ok(!/function\s+initObserver\s*\(/.test(JS), "the initObserver function must be removed");
  // The separate Module B "I'd rather just observe" escape button was removed
  // 2026-07-16 (user request) as a duplicate of the Observer role chip.
  assert.ok(!INDEX.includes('id="modB-observe-instead-btn"'),
    "the duplicate Module B observe-escape button must be removed");
  assert.ok(!INDEX.includes('id="modB-observe-reassure"'),
    "its reassurance region must be removed too");
  // …and the Observer role chip remains the single observe path.
  assert.ok(INDEX.includes('data-role="observer"'),
    "the Observer role chip must remain in the picker");
});

test("Item 3 — renderStage scrolls to the top of the window on a stage change", () => {
  const fn = fnBody("renderStage");
  assert.match(fn, /viewStage !== _lastRenderedViewStage/, "must guard on an actual stage change");
  assert.match(fn, /window\.scrollTo\(\s*\{\s*top:\s*0/, "must scroll the window to the top");
  assert.match(JS, /let _lastRenderedViewStage = -1;/, "the guard variable must be declared");
});

test("Item 6 — Module B collapses its empty right column except in the answer phases", () => {
  const fn = fnBody("applyModBPhaseVisibility");
  assert.match(fn, /\.columns\.modB-columns/, "must target the Module B columns wrapper");
  // 2026-06-26: the answer cards now show in P3 "exchange" (the two questions)
  // and P6 "reflect" (what improved); collapse the right column everywhere else.
  assert.match(fn, /classList\.toggle\("rcol-collapsed",\s*phaseKey !== "exchange" && phaseKey !== "reflect"\)/,
    "must collapse for every phase except 'exchange' and 'reflect'");
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
  // The official answer renders AFTER the team's own answers, in a clearly
  // labelled block so it doesn't read as something the team wrote.
  assert.match(JS, /className = "wrapup-official"/, "must render the official-answer block");
  assert.match(JS, /wrapup-official-label/, "must carry an explicit 'official answer' label");
  assert.match(CSS, /\.wrapup-official\s*\{/, "the .wrapup-official style must exist");
  // The official block must come AFTER the team's answers list in the source.
  const wrapFn = JS.slice(JS.indexOf("function renderWrapupSummary"));
  const body = wrapFn.slice(0, wrapFn.indexOf("\nfunction ", 1));
  assert.ok(body.indexOf('className = "answers-list"') < body.indexOf('className = "wrapup-official"'),
    "the team's answers must render before the official answer");
});

/* ---- 2026-06-02 second batch (Module A/B follow-ups) ---- */

test("Module B prose fills the width (70ch cap lifted inside #stage-2)", () => {
  assert.match(CSS, /#stage-2 \.safety-note p[\s\S]{0,160}max-width:\s*none/,
    "Module B safety-note prose must not be capped to the narrow reading column");
});

test("Module A timed phase stepper + bullet-progress are removed", () => {
  assert.ok(!/class="phase-stepper" aria-label="Module A phases"/.test(INDEX),
    "the Module A phase stepper must be gone");
  assert.ok(!INDEX.includes('id="modA-bullet-progress"'),
    "the Module A bullet-progress checklist must be gone");
  // The Module B phase stepper stays (it's a separate, kept feature).
  assert.match(INDEX, /class="phase-stepper" aria-label="Module B phases"/,
    "the Module B phase stepper must remain");
  // The studentModA tour must not point at the deleted bullet-progress.
  assert.ok(!TOUR.includes('anchor: "modA-bullet-progress"'),
    "the tour must no longer anchor to the removed bullet-progress");
});

test("Module B: a clear 'tap Next' affordance (prominent button + hint, all langs)", () => {
  assert.match(INDEX, /id="modB-phase-next"[^>]*phase-nav-btn--next|phase-nav-btn--next[^>]*id="modB-phase-next"/,
    "the Next button must carry the prominence modifier class");
  assert.match(INDEX, /id="modB-phase-nav-hint"/, "the phase-nav hint must exist");
  assert.match(CSS, /\.phase-nav-btn--next:not\(:disabled\)/, "the prominent Next style must exist");
  for (const [name, src] of [["en", I18N], ["fr", FR], ["ja", JA]]) {
    assert.match(src, /"modB\.phase\.nav-hint"\s*:/, `modB.phase.nav-hint must exist in ${name}`);
  }
});

test("Module B: team decisions gated to the exchange phase + hidden when filled", () => {
  const sections = JS.slice(JS.indexOf("MODB_PHASE_SECTIONS = ["));
  const arr = sections.slice(0, sections.indexOf("];"));
  assert.match(arr, /sel:\s*"#decisions-B",\s*phases:\s*\["exchange"\]/,
    "#decisions-B must be gated to the exchange phase");
  // renderDecisions hides the card once every Module B decision is committed.
  assert.match(JS, /classList\.toggle\("decisions-locked",\s*allCommitted\)/,
    "renderDecisions must toggle decisions-locked when all are committed");
  assert.match(CSS, /\.decisions-card\.decisions-locked\s*\{\s*display:\s*none/,
    "a committed Module B decisions card must be hidden");
});
