/* tests/global-stage-stepper.test.js
 *
 * Regression guard for the global "you are here" session stepper
 * (UX-overload fix 2026-06-01).
 *
 * The only VISUAL numbered stepper used to be Module A's LOCAL phase
 * stepper, so students mistook module sub-progress for their position in
 * the whole session. A compact 4-segment global stepper now sits at the top
 * of the stage card, marking the viewed stage, completed stages, and the
 * room's live stage.
 *
 * Static assertions (the DOM render is exercised by Playwright); these pin
 * the markup hook, the render contract, and the CSS so the component can't
 * silently regress.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");

test("the global stepper container exists with an accessible name", () => {
  assert.match(INDEX, /<ol[^>]*id="global-stage-progress"[^>]*aria-label="[^"]+"/,
    "index.html must have an <ol id=global-stage-progress> with an aria-label");
});

test("renderStage fills the stepper with one step per session stage", () => {
  // it loops STAGE_COUNT and targets the container
  assert.match(SCRIPT, /el\("global-stage-progress"\)/,
    "renderStage must populate #global-stage-progress");
  assert.match(SCRIPT, /for \(let i = 0; i < STAGE_COUNT; i\+\+\)[\s\S]*?global-stage-progress|global-stage-progress[\s\S]*?for \(let i = 0; i < STAGE_COUNT; i\+\+\)/,
    "the stepper must render STAGE_COUNT segments");
});

test("the stepper marks current / done / live state and is accessible", () => {
  assert.match(SCRIPT, /i === viewStage[\s\S]*?is-current/,
    "the viewed stage must get .is-current");
  assert.match(SCRIPT, /i < viewStage[\s\S]*?is-done/,
    "completed stages must get .is-done");
  assert.match(SCRIPT, /i === roomStage && i !== viewStage[\s\S]*?is-live/,
    "the room's live stage (when viewing an earlier one) must get .is-live");
  assert.match(SCRIPT, /setAttribute\("aria-current", "step"\)/,
    "the current step must expose aria-current=step");
  // names come from stageLabel(), not hardcoded — and via textContent (XSS-safe)
  assert.match(SCRIPT, /stageLabel\(i\)/, "segment labels must come from stageLabel(i)");
});

test("the stepper is built with textContent, never innerHTML (scenario names may be authored)", () => {
  // take the render window starting at the container lookup and confirm it
  // builds nodes (textContent) rather than injecting stageLabel via innerHTML
  const at = SCRIPT.indexOf('const gsp = el("global-stage-progress");');
  assert.ok(at !== -1, "could not locate the stepper render block");
  const block = SCRIPT.slice(at, at + 1400);
  assert.doesNotMatch(block, /innerHTML/,
    "the stepper must not inject stageLabel() via innerHTML");
  assert.match(block, /\.textContent =/,
    "the stepper must set node text via textContent (XSS-safe)");
});

test("the stepper CSS defines the segment + current/done states", () => {
  assert.match(CSS, /\.global-stage-progress\s*\{/, "missing .global-stage-progress");
  assert.match(CSS, /\.gsp-step\.is-current\s*\{/, "missing current-step style");
  assert.match(CSS, /\.gsp-step\.is-done\b/, "missing done-step style");
  assert.match(CSS, /\.gsp-num\s*\{/, "missing step-number style");
});
