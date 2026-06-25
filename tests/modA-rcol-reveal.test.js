/* tests/modA-rcol-reveal.test.js
 *
 * UX de-clutter (2026-06-01). Module A's right-column tabs (Decide together /
 * Debate / Our final answers) used to all show from the moment the student
 * landed on the stage. They now reveal one per phase via revealModARightCol().
 *
 * Static guards on the render contract + CSS (the live reveal flow is exercised
 * by tests-e2e/modA-rcol-progressive.spec.js across the device matrix).
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

test("the two tab buttons still exist in the markup (reveal is runtime-only)", () => {
  // The reveal toggles the `hidden` attribute at runtime; the buttons must stay
  // in the static HTML so a11y / structural guards keep finding them. The Debate
  // tab was MERGED into "Debate & answers" (2026-06-25).
  for (const id of ["rcol-tab-decisions", "rcol-tab-answers"]) {
    assert.match(INDEX, new RegExp('id="' + id + '"'),
      `tab button #${id} must remain in index.html`);
  }
  assert.doesNotMatch(INDEX, /id="rcol-tab-discussion"/,
    "the standalone Debate tab must be gone (merged into Debate & answers)");
});

test("revealModARightCol exists and reveals one tab per phase", () => {
  assert.match(SCRIPT, /function revealModARightCol\(\)/,
    "revealModARightCol() must be defined");
  const at = SCRIPT.indexOf("function revealModARightCol()");
  const body = SCRIPT.slice(at, at + 2200);
  // The three phase gates.
  assert.match(body, /revealedCountByGroup\("history"\)/, "Decide gate reads history reveals");
  assert.match(body, /revealedCountByGroup\("exam"\)/, "Decide gate reads exam reveals");
  assert.match(body, /phaseGateOpen\(\)/, "Debate gate is the ≥1-hypothesis phase gate");
  assert.match(body, /rcol-collapsed/, "collapses the column while nothing is revealed");
  assert.match(body, /dataset\.revealed/, "reveal must be sticky (dataset.revealed flag)");
});

test("switchRcolTab un-hides its target tab + un-collapses the column", () => {
  const at = SCRIPT.indexOf("function switchRcolTab(");
  const body = SCRIPT.slice(at, at + 1200);
  assert.match(body, /targetBtn\.hidden = false/,
    "switching to a tab must make its button visible");
  assert.match(body, /classList\.remove\("rcol-collapsed"\)/,
    "switching to a tab must un-collapse the right column");
});

test("the reveal is driven from the central state hook + decision render", () => {
  // updateModANextStep() and renderDecisions() both call it.
  const upd = SCRIPT.indexOf("function updateModANextStep()");
  const updBody = SCRIPT.slice(upd, SCRIPT.indexOf("function updateModBNextStep()"));
  assert.match(updBody, /revealModARightCol\(\)/,
    "updateModANextStep must call revealModARightCol");
});

test("the collapse CSS is scoped to #stage-1 (no global layout change)", () => {
  assert.match(CSS, /#stage-1 \.columns\.rcol-collapsed\s*\{/,
    "the single-column collapse must be scoped to #stage-1");
  assert.match(CSS, /#stage-1 \.columns\.rcol-collapsed > \.col-right\s*\{[^}]*display:\s*none/,
    "the empty right column must be hidden under #stage-1 only");
});

test("the stage header no longer repeats the module name", () => {
  // #stage-indicator is just the position counter; the stepper owns the name.
  assert.match(SCRIPT, /el\("stage-indicator"\)\.textContent =\s*"Stage " \+ \(viewStage \+ 1\) \+ " of " \+ STAGE_COUNT;/,
    "#stage-indicator must be 'Stage N of M' only");
  assert.doesNotMatch(SCRIPT, /STAGE_COUNT \+ " · " \+ stageLabel\(viewStage\)/,
    "the duplicated '· <module name>' suffix must be gone");
});
