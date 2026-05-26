/* tests/modb-vote-autoopen.test.js
 *
 * Dry-run feedback (2026-05-26): "the decide-together / vote panel should
 * auto-open when a vote is due." Previously a newly-unlocked decision only
 * fired a toast + a tab-badge nudge; students missed it. renderDecisions now
 * surfaces the vote panel on the locked→unlocked transition (switch to the
 * Module A "decisions" tab + scroll the panel into view), guarded so it never
 * yanks focus from a teammate mid-answer. Static source-text checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function renderDecisionsFn() {
  const start = SCRIPT.indexOf("function renderDecisions");
  assert.ok(start >= 0, "renderDecisions must exist");
  // up to the next top-level function (buildLockedDecision)
  const end = SCRIPT.indexOf("function buildLockedDecision");
  return SCRIPT.slice(start, end > start ? end : start + 4000);
}

test("a newly-due vote auto-opens the decisions panel (tab switch + scroll)", () => {
  const fn = renderDecisionsFn();
  // still announces (toast retained)
  assert.match(fn, /toast\(/, "the unlock transition must still toast");
  // Module A: bring the rcol decisions tab forward
  assert.match(fn, /switchRcolTab\("decisions"\)/, "must switch to the decisions tab when a vote is due");
  // bring the panel into view (works for the always-visible Module B card too)
  assert.match(fn, /scrollIntoView/, "must scroll the decisions panel into view");
});

test("auto-open is gated on the unlock transition, not every render", () => {
  const fn = renderDecisionsFn();
  // the switch lives inside the allUnlockedNow transition loop
  const loop = fn.slice(fn.indexOf("allUnlockedNow.forEach"));
  assert.match(loop, /lastUnlockedDecisionIds\.has\(id\)/, "only fires for a NEWLY unlocked decision");
  assert.match(loop, /switchRcolTab\("decisions"\)/, "the auto-open must be inside the transition loop");
});

test("auto-open never steals focus from someone mid-answer", () => {
  const fn = renderDecisionsFn();
  assert.match(fn, /document\.activeElement/, "must check the active element");
  assert.match(fn, /TEXTAREA\|INPUT/, "must treat a focused textarea/input as 'typing'");
  assert.match(fn, /!typing/, "must skip the auto-open while a teammate is typing");
});
