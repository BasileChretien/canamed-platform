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
  /* S2b-2 — one listener set per slot, bound at the per-slot path. Writing
     straight to `revealed` would make the last snapshot to arrive win once two
     PBL slots exist. */
  const i = SCRIPT.indexOf('R.revealed.on("value"');
  assert.ok(i > -1, "the revealed listener must be bound per slot");
  const fn = SCRIPT.slice(i, i + 700);
  assert.match(fn, /slotState\(slot\)\.revealed = snap\.val\(\)/);
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

/* ── S2b-2 — the listeners now bind at the PER-SLOT paths ─────────────────── */

test("state binds at rooms/$roomId/sections/$slot, not moduleA/moduleB", () => {
  const f = fnOf("bindSectionRefs");
  assert.match(f, /base \+ "\/sections\/" \+ slot/);
  assert.ok(!/db\.ref\([^)]*module[AB]\//.test(SCRIPT),
    "no room-state ref may still be built from a module-literal path");
});

test("a listener set is bound for EVERY slot, not just the visible one", () => {
  const f = fnOf("bindSectionRefs");
  assert.match(f, /sectionSlots\(\)\.forEach/,
    "the wrap-up aggregates every slot and Back can land on any of them");
  ["revealed", "hypotheses", "phase", "roleAssign"].forEach(n =>
    assert.ok(f.indexOf("R." + n + ".on(") > -1, n + " must be bound per slot"));
});

test("only the ACTIVE slot's phase/roleAssign snapshots drive the shared UI", () => {
  /* An inactive slot's roleplay phase must not repaint the stage the student is
     looking at. revealed/hypotheses need no such guard — they land in their own
     slot's store and the pointer decides what renders. */
  const f = fnOf("bindSectionRefs");
  const ph = f.slice(f.indexOf("R.phase.on("));
  assert.match(ph.slice(0, 200), /if \(slot !== activeSlot\) return;/);
  const ra = f.slice(f.indexOf("R.roleAssign.on("));
  assert.match(ra.slice(0, 200), /if \(slot !== activeSlot\) return;/);
});

test("the WRITE refs follow the active slot too", () => {
  /* Otherwise an item revealed while looking at section 3 lands in section 1's
     node — the write sites are unchanged precisely because these are pointers. */
  const f = fnOf("pointSectionRefs");
  ["refRevealed", "refHypotheses", "refModBPhase", "refRoleAssign"].forEach(r =>
    assert.ok(f.indexOf(r + " ") > -1 || f.indexOf(r + "=") > -1, r + " must be repointed"));
  assert.match(fnOf("refreshActiveSlotState"), /pointSectionRefs\(\)/);
});

test("teardown detaches every slot's listeners", () => {
  const f = fnOf("unbindSectionRefs");
  assert.match(f, /Object\.keys\(refSection\)\.forEach/);
  assert.match(f, /refSection = \{\}/);
  assert.match(SCRIPT, /unbindSectionRefs\(\);/, "room teardown must call it");
});

test("binding is idempotent — it unbinds before it rebinds", () => {
  /* Called again without unbinding, every slot would carry two listeners and
     each snapshot would render twice. */
  const f = fnOf("bindSectionRefs");
  assert.ok(f.indexOf("unbindSectionRefs()") < f.indexOf("sectionSlots()"),
    "unbind must come first");
});
