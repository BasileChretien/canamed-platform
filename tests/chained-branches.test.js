/* tests/chained-branches.test.js
 *
 * Chained branching (2026-05-22) — the next step the BRANCHING CASES note
 * anticipated: a committed decision UNLOCKS a follow-up decision, which itself
 * branches. dec_prognosis_next (Module B, Mrs Tanaka) is the worked example —
 * it stays hidden until the room locks in dec_prognosis, then opens as a fresh
 * decision whose three options each branch to a distinct continuation.
 *
 * The gate reuses the existing unlockWhen schema (decisionUnlocked() in
 * script.js) with a new `afterDecision` key that reads the synced
 * votes/<id>/committed — so no new Firebase path or rules are needed.
 *
 * Static source-text checks, mirroring branching-cases.test.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CASE = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("dec_prognosis_next is a Module B follow-up gated behind dec_prognosis", () => {
  const start = CASE.indexOf('id: "dec_prognosis_next"');
  assert.ok(start > -1, "dec_prognosis_next must exist");
  // It must sit AFTER dec_ercp_stent so it doesn't pollute the
  // branching-cases.test.js slice (which counts exactly 3 dec_prognosis
  // branches between dec_prognosis and dec_ercp_stent).
  assert.ok(start > CASE.indexOf('id: "dec_ercp_stent"'),
    "dec_prognosis_next must be appended after dec_ercp_stent");
  const block = CASE.slice(start, CASE.indexOf("var DECISIONS_C", start));
  assert.match(block, /module:\s*"B"/, "dec_prognosis_next is a Module B decision");
  assert.match(block, /unlockWhen:\s*\{\s*afterDecision:\s*"dec_prognosis"\s*\}/,
    "must gate behind a committed dec_prognosis via unlockWhen.afterDecision");
  assert.match(block, /hideWhenLocked:\s*true/,
    "must stay hidden until unlocked (continuation, not a spoiler teaser)");
});

test("all three dec_prognosis_next options branch trilingually", () => {
  const start = CASE.indexOf('id: "dec_prognosis_next"');
  const block = CASE.slice(start, CASE.indexOf("var DECISIONS_C", start));
  const revealBlocks = block.split("branch: { reveal:").slice(1);
  assert.strictEqual(revealBlocks.length, 3,
    "all three follow-up options must carry a branch.reveal (got " + revealBlocks.length + ")");
  for (const rb of revealBlocks) {
    const head = rb.slice(0, 2000);
    assert.match(head, /\ben:/, "branch.reveal must have en");
    assert.match(head, /\bfr:/, "branch.reveal must have fr");
    assert.match(head, /\bja:/, "branch.reveal must have ja");
  }
});

test("decisionUnlocked() evaluates the afterDecision gate off synced committed votes", () => {
  const i = SCRIPT.indexOf("function decisionUnlocked");
  assert.ok(i > -1, "decisionUnlocked must exist");
  const blk = SCRIPT.slice(i, i + 1600);
  assert.match(blk, /afterDecision/, "must handle the afterDecision key");
  assert.match(blk, /roomVotes\[depId\]/, "must read the dependency decision's synced votes");
  assert.match(blk, /committed\b/, "must require the dependency to be committed");
  assert.match(blk, /needOption|needOpt|spec\.option/,
    "must support option-specific gating ({ id, option })");
});

test("renderDecisions() gates ALL modules and hides hideWhenLocked follow-ups", () => {
  const i = SCRIPT.indexOf("function renderDecisions");
  assert.ok(i > -1, "renderDecisions must exist");
  const blk = SCRIPT.slice(i, i + 2600);
  // The old code only gated Module A: `(mod === "A") ? decisionUnlocked(d) : ...`.
  // Gating must now apply to every module so Module B chains can lock.
  assert.doesNotMatch(blk, /mod === "A"\s*\)\s*\?\s*decisionUnlocked/,
    "gating must no longer be restricted to Module A");
  assert.match(blk, /const gate = decisionUnlocked\(d\)/,
    "every decision must be evaluated through decisionUnlocked");
  assert.match(blk, /hideWhenLocked/,
    "a locked hideWhenLocked decision must render nothing (surprise fork)");
  // The unlock-transition nudge must be computed across both modules.
  assert.match(blk, /allUnlockedNow/,
    "the unlock nudge must track a combined cross-module unlocked set");
});

test("the afterDecision 'ready when…' hint is wired + localised (en/fr/ja)", () => {
  const i = SCRIPT.indexOf("function decisionUnlockHint");
  const blk = SCRIPT.slice(i, i + 1200);
  assert.match(blk, /case "afterDecision"/, "the hint must handle the afterDecision key");
  assert.match(blk, /modA\.decision\.unlock\.after/, "must use the i18n key for the hint lead");
  // The key must exist in all three primary languages.
  const after = I18N.match(/"modA\.decision\.unlock\.after":/g) || [];
  assert.ok(after.length >= 3,
    "modA.decision.unlock.after must be defined in en, fr and ja (got " + after.length + ")");
});
