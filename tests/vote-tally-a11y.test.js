/* tests/vote-tally-a11y.test.js
 *
 * UX-overload Phase-3 item #3: live-vote accessibility.
 *
 * renderDecisions() rebuilds #decisions-A / -B via innerHTML on EVERY ballot or
 * presence change (the votes are room-wide), which used to (a) drop keyboard
 * focus to <body> whenever a teammate voted while you were on the options, and
 * (b) give screen-reader users no signal that the tally moved or the team
 * locked in. This change preserves focus across the rebuild (stable
 * data-dec/data-opt on options, data-dec-lock on the lock button) and feeds a
 * persistent, visually-hidden polite live region per module.
 *
 * Static assertions on the wiring; the runtime behaviour (focus survives a
 * teammate vote, the region announces on change) is covered by
 * tests-e2e/vote-tally-access.spec.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

test("the live-vote a11y helpers exist", () => {
  assert.ok(JS.includes("function _captureDecisionFocus("), "_captureDecisionFocus must exist");
  assert.ok(JS.includes("function _restoreDecisionFocus("), "_restoreDecisionFocus must exist");
  assert.ok(JS.includes("function _announceDecisions("), "_announceDecisions must exist");
});

test("vote controls carry stable identity for focus restore", () => {
  const build = fnBody("buildDecision");
  assert.match(build, /dataset\.dec\s*=\s*d\.id/, "option buttons must carry data-dec");
  assert.match(build, /dataset\.opt\s*=/, "option buttons must carry data-opt");
  assert.match(build, /dataset\.decLock\s*=\s*d\.id/, "the lock button must carry data-dec-lock");
});

test("renderDecisions preserves focus across the innerHTML rebuild", () => {
  const render = fnBody("renderDecisions");
  assert.match(render, /_captureDecisionFocus\(\)/, "must capture focus before the rebuild");
  assert.match(render, /_restoreDecisionFocus\(/, "must restore focus after the rebuild");
  // capture must come before restore in the source
  assert.ok(
    render.indexOf("_captureDecisionFocus()") < render.indexOf("_restoreDecisionFocus("),
    "capture must precede restore"
  );
});

test("renderDecisions feeds a per-module SR tally", () => {
  const render = fnBody("renderDecisions");
  assert.match(render, /srLines/, "must collect per-module SR lines");
  assert.match(render, /buildDecision\(d,\s*srLines\[mod\]\)/, "buildDecision must receive the sink");
  assert.match(render, /_announceDecisions\(mod,/, "must announce the module tally");
});

test("the live region is a polite, atomic, visually-hidden region", () => {
  const ann = fnBody("_announceDecisions");
  assert.match(ann, /aria-live"?,\s*"polite"/, "must be aria-live=polite");
  assert.match(ann, /aria-atomic"?,\s*"true"/, "must be aria-atomic so the whole tally is read");
  assert.match(ann, /"sr-only"/, "must be visually hidden (sr-only)");
  // initial population is seeded silently (no announcement on first paint)
  assert.match(ann, /_decLiveLast\[mod\]\s*=\s*text;\s*\/\/ seed without announcing/,
    "first paint must seed without announcing");
});

test("buildDecision feeds the sink with the existing tally / lock strings", () => {
  const build = fnBody("buildDecision");
  assert.match(build, /srSink\.push\(/, "must push to the SR sink");
  assert.match(build, /voted/, "open decisions must announce the 'N voted' tally");
  assert.match(build, /locked in/, "committed decisions must announce the lock-in result");
});
