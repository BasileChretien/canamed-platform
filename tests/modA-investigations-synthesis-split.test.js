/* tests/modA-investigations-synthesis-split.test.js
 *
 * 2026-06-02 Module A restructure: the old combined "Investigations & synthesis"
 * section was split into a FREE "Investigations" section (imaging/bloods, labs:1+)
 * and a gated "Clinical synthesis" section (labs:0). The Working hypotheses block
 * moved BELOW Investigations behind a "Ready to write…" CTA, and writing ≥2
 * hypotheses (phaseGateOpen) unlocks the synthesis + the Debate.
 *
 * Static structural guards (the live flow is exercised by
 * tests-e2e/hypothesis-placement.spec.js, investigations-anytime.spec.js and
 * modA-rcol-progressive.spec.js across the device matrix).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

test("the markup has separate Investigations + Synthesis sections + a hypotheses CTA", () => {
  assert.match(INDEX, /id="chart-investigations"/, "Investigations section present");
  assert.match(INDEX, /id="group-labs"/, "Investigations button group present");
  assert.match(INDEX, /id="chart-synthesis"/, "Synthesis section present (split out)");
  assert.match(INDEX, /id="group-synthesis"/, "Synthesis button group present");
  assert.match(INDEX, /id="synthesis-locked-hint"/, "Synthesis locked-hint present");
  assert.match(INDEX, /data-i18n="modA\.chart\.hypotheses\.cta"/,
    "the hypotheses section uses the 'ready to write…' CTA");
  // The Investigations title is no longer "Investigations & synthesis".
  assert.match(INDEX, /data-i18n="modA\.chart\.investigations\.title">Investigations</,
    "Investigations section is titled just 'Investigations'");
});

test("buildButtons routes the synthesis (SYNTH_ID) to #group-synthesis, others to #group-labs", () => {
  const at = SCRIPT.indexOf("function buildButtons(");
  const body = SCRIPT.slice(at, at + 1600);
  assert.match(body, /el\("group-synthesis"\)/, "buildButtons targets #group-synthesis");
  assert.match(body, /id === SYNTH_ID \? synContainer : container|id === SYNTH_ID && synContainer/,
    "SYNTH_ID routes to the synthesis container, everything else to #group-labs");
});

test("phaseGateOpen() is the ≥2-hypotheses gate and drives synthesis + Debate", () => {
  assert.match(SCRIPT, /function phaseGateOpen\(\)[\s\S]*?hypothesisCount\(\) >= 2/,
    "phaseGateOpen() === hypothesisCount() >= 2");
  // reveal() hard-gates only the synthesis on it.
  const rv = SCRIPT.slice(SCRIPT.indexOf("function reveal("), SCRIPT.indexOf("function renderButtons("));
  assert.match(rv, /id === SYNTH_ID && !phaseGateOpen\(\)/,
    "reveal() gates the synthesis on phaseGateOpen()");
  // renderPrompts unlocks the Debate on it.
  assert.match(SCRIPT, /const unlocked = \(typeof phaseGateOpen === "function"\) && phaseGateOpen\(\);/,
    "the discussion prompts unlock on phaseGateOpen()");
});

test("the chat no longer auto-reveals the synthesis (it's a gated section now)", () => {
  const llmInit = fs.readFileSync(path.join(PLATFORM, "modA-llm-init.js"), "utf8");
  const onUnlock = llmInit.slice(llmInit.indexOf("onUnlock:"), llmInit.indexOf("onUnlock:") + 900);
  assert.doesNotMatch(onUnlock, /reveal\(window\.SYNTH_ID\)/,
    "onUnlock must NOT auto-reveal the synthesis any more");
});

test("the chat consent button has a dark-mode contrast override (white-on-cyan fails AA)", () => {
  // The consent button fills with var(--primary). In light/high-contrast that's
  // a dark blue (white text passes); in DARK, --primary is the lighter cyan
  // (--nagoya-500), where white text fails 4.5:1 — so dark mode must force dark
  // text, like the splash primaries. Now that the chat is default-on this is a
  // live concern for every dark-mode user.
  const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
  assert.match(CSS, /html\[data-theme="dark"\] \.moda-chat-consent-btn\s*\{[^}]*color:\s*#0e1620/,
    "dark theme must override the consent button text to dark");
  assert.match(CSS,
    /prefers-color-scheme: dark[\s\S]{0,200}\.moda-chat-consent-btn\s*\{[^}]*color:\s*#0e1620/,
    "auto (prefers-color-scheme: dark) must also override the consent button text");
});
