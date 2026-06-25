/* tests/modA-investigations-synthesis-split.test.js
 *
 * 2026-06-02 Module A restructure (round 2): the on-screen "Clinical synthesis"
 * section was REMOVED. Investigations stay a free section (imaging/bloods,
 * labs:1+); the synthesis item (SYNTH_ID = labs:0) is no longer rendered as a
 * button — its model write-up now ships only in the stage-4 take-home export
 * (downloadMyRoomAnswers). Writing ≥1 hypothesis (phaseGateOpen) still unlocks
 * the Debate.
 *
 * Static structural guards (the live flow is exercised across the device matrix
 * by tests-e2e/hypothesis-placement.spec.js, investigations-anytime.spec.js and
 * modA-rcol-progressive.spec.js).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

test("Investigations stays; the on-screen Clinical synthesis section is gone", () => {
  assert.match(INDEX, /id="chart-investigations"/, "Investigations section present");
  assert.match(INDEX, /id="group-labs"/, "Investigations button group present");
  assert.doesNotMatch(INDEX, /id="chart-synthesis"/, "Clinical synthesis section removed");
  assert.doesNotMatch(INDEX, /id="group-synthesis"/, "Synthesis button group removed");
  assert.doesNotMatch(INDEX, /id="synthesis-progress"/, "Synthesis progress chip removed");
  assert.match(INDEX, /data-i18n="modA\.chart\.hypotheses\.cta"/,
    "the hypotheses section keeps the 'ready to write…' CTA");
  assert.match(INDEX, /data-i18n="modA\.chart\.investigations\.title">Investigations</,
    "Investigations section is titled just 'Investigations'");
});

test("buildButtons skips SYNTH_ID (no synthesis button is rendered)", () => {
  const at = SCRIPT.indexOf("function buildButtons(");
  const body = SCRIPT.slice(at, at + 1600);
  assert.doesNotMatch(body, /group-synthesis/, "buildButtons no longer targets #group-synthesis");
  assert.match(body, /if \(id === SYNTH_ID\) return;/, "buildButtons skips the SYNTH_ID item");
});

test("phaseGateOpen() is the ≥1-hypothesis gate and drives the Debate", () => {
  assert.match(SCRIPT, /function phaseGateOpen\(\)[\s\S]*?hypothesisCount\(\) >= 1/,
    "phaseGateOpen() === hypothesisCount() >= 1");
  // reveal() no longer hard-gates the synthesis (there is no synthesis button).
  const rv = SCRIPT.slice(SCRIPT.indexOf("function reveal("), SCRIPT.indexOf("function renderButtons("));
  assert.doesNotMatch(rv, /SYNTH_ID && !phaseGateOpen/,
    "reveal() no longer carries the synthesis gate guard");
  // renderPrompts unlocks the Debate on it.
  assert.match(SCRIPT, /const unlocked = \(typeof phaseGateOpen === "function"\) && phaseGateOpen\(\);/,
    "the discussion prompts unlock on phaseGateOpen()");
});

test("the stage-4 take-home export carries the clinical-synthesis write-up", () => {
  const start = SCRIPT.indexOf("function downloadMyRoomAnswers(");
  const dl = SCRIPT.slice(start, start + 4000);
  assert.match(dl, /Clinical synthesis \(model summary\)/,
    "the export has a Clinical synthesis section heading");
  assert.match(dl, /itemById\(SYNTH_ID\)/, "the export pulls the SYNTH_ID case item");
  assert.match(dl, /aParts/, "the export prefers the labelled aParts");
});

test("the chat no longer auto-reveals the synthesis", () => {
  const llmInit = fs.readFileSync(path.join(PLATFORM, "modA-llm-init.js"), "utf8");
  const onUnlock = llmInit.slice(llmInit.indexOf("onUnlock:"), llmInit.indexOf("onUnlock:") + 900);
  assert.doesNotMatch(onUnlock, /reveal\(window\.SYNTH_ID\)/,
    "onUnlock must NOT auto-reveal the synthesis");
});

test("the chat consent button has a dark-mode contrast override (white-on-cyan fails AA)", () => {
  // The consent button fills with var(--primary). In light/high-contrast that's
  // a dark blue (white text passes); in DARK, --primary is the lighter cyan
  // (--nagoya-500), where white text fails 4.5:1 — so dark mode must force dark
  // text, like the splash primaries.
  const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
  assert.match(CSS, /html\[data-theme="dark"\] \.moda-chat-consent-btn\s*\{[^}]*color:\s*#0e1620/,
    "dark theme must override the consent button text to dark");
  assert.match(CSS,
    /prefers-color-scheme: dark[\s\S]{0,200}\.moda-chat-consent-btn\s*\{[^}]*color:\s*#0e1620/,
    "auto (prefers-color-scheme: dark) must also override the consent button text");
});
