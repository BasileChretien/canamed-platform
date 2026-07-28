/* tests/section-slot-state.test.js
 *
 * S2b-1: room state becomes per-SLOT, with an active-slot pointer.
 *
 * A session may run two sections of the same TYPE (decision 1), so "the
 * revealed items" and "the hypotheses" are one map per slot, not one per room.
 * Rather than thread a slot argument through ~115 read sites, the store holds
 * every slot and `revealed` / `hypotheses` stay POINTERS at the slot on screen —
 * unambiguous because exactly one stage is visible at a time.
 *
 * S2b-1 is a SEAM: listeners still bind to the legacy moduleA/moduleB paths, so
 * nothing changes for today's sessions. S2b-2 repoints them.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function fnOf(name) {
  const i = SCRIPT.indexOf("function " + name + "(");
  assert.ok(i > -1, name + "() must exist");
  const j = SCRIPT.indexOf("\n}", i);
  return SCRIPT.slice(i, j + 2);
}

test("the store is keyed by slot and lazily created", () => {
  const f = fnOf("slotState");
  assert.match(f, /sectionState\[k\]/);
  assert.match(f, /revealed: \{\}, hypotheses: \{\}/);
});

test("the pointer follows the stage on screen", () => {
  const f = fnOf("refreshActiveSlotState");
  assert.match(f, /slotAtStage\(viewStage\)/,
    "walking Back into an earlier section must show THAT section's state");
  assert.match(f, /revealed = st\.revealed/);
  assert.match(f, /hypotheses = st\.hypotheses/);
});

test("the pointer aliases the stored object — it must not copy it", () => {
  /* Some render code mutates `revealed` in place; a copy would silently drop
     those writes into a detached object. */
  const f = fnOf("refreshActiveSlotState");
  assert.ok(!/Object\.assign|\.\.\.st\.|JSON\.parse/.test(f),
    "assign the same object reference, not a clone");
});

test("renderStage repoints before it renders", () => {
  const i = SCRIPT.indexOf("function renderStage()");
  const head = SCRIPT.slice(i, i + 700);
  const rp = head.indexOf("refreshActiveSlotState()");
  const view = head.indexOf("stageViewId(viewStage)");
  assert.ok(rp > -1 && view > -1 && rp < view,
    "the pointer must be current before the view is resolved");
});

test("listeners write into the SLOT, not straight onto the pointer", () => {
  const i = SCRIPT.indexOf('refRevealed.on("value"');
  const fn = SCRIPT.slice(i, i + 700);
  assert.match(fn, /slotState\(_legacySlotFor\("pbl"\)\)\.revealed = snap\.val\(\)/,
    "writing straight to `revealed` makes the last listener to fire win once " +
    "two PBL slots exist");
  assert.match(fn, /refreshActiveSlotState\(\)/);
});

test("teardown clears the whole store, not just the pointer", () => {
  /* Clearing only the pointer leaves the previous room's reveals behind, and
     the next room's first refresh hands them straight back. */
  const i = SCRIPT.indexOf("sectionState = {}; activeSlot = 1;");
  assert.ok(i > -1, "the room teardown must reset the store");
  const near = SCRIPT.slice(i, i + 200);
  assert.match(near, /revealed = \{\}; hypotheses = \{\};/);
});

test("the legacy slot resolver degrades instead of throwing", () => {
  const f = fnOf("_legacySlotFor");
  assert.match(f, /sectionSlots\(\)\.find\(s => s\.type === type\)/);
  assert.match(f, /: 1;/,
    "a session with no slot of that type still needs a home for the state");
});
