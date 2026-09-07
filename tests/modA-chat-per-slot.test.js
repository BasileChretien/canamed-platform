/* tests/modA-chat-per-slot.test.js
 *
 * The Module A chat store is PER SLOT (section model, 2026-09-07).
 *
 * A session may run several PBL sections and the room has ONE roomChat tree,
 * so before this change two PBL sections shared one transcript: the earlier
 * section's conversation replayed in the later one, and — because the
 * once-only award map and the score/auto event ids were per ROOM — a scoring
 * family that fired in section 1 could never fire again in section 2. This
 * file pins the pure halves (bridge threads keyed by slot, the rules' `slot`
 * field in both trees) and the source-level wiring in modA-llm-init.js /
 * script.js; the DOM behaviour is proven in a real two-section room in
 * tests-e2e/modA-chat-per-slot.spec.js, and the rule against the emulator.
 *
 * The invariant, stated once: A TURN WITH NO `slot` BELONGS TO THE SESSION'S
 * FIRST PBL SLOT — every transcript written before this change.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INIT = fs.readFileSync(path.join(P, "modA-llm-init.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
/* Comments explain what was retired by naming it; strip them before asserting
   a path is GONE, or the explanation trips the guard (a known trap here). */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/mg, "");
const RULES = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;

const CASE = {
  history: [
    { q: { en: "How are you sleeping?" }, a: { en: "PATIENT-LINE: badly." } }
  ]
};

function loadAll() {
  const ctx = {};
  ctx.module = { exports: {} };
  ["modA-question-scoring.js", "modA-llm-prompts.js", "modA-llm-bridge.js"].forEach(f => {
    const src = fs.readFileSync(path.join(P, f), "utf8");
    // eslint-disable-next-line no-new-func
    new Function("window", "self", "module", src).call(ctx, ctx, ctx, ctx.module);
  });
  ctx.CURRENT_SCENARIO_CHARACTERS = [{ id: "patient", role: "patient", name: "Mayumi", persona: "…" }];
  ctx.CASE = CASE;
  ctx.SCORING = { moduleA_questions: [{ id: "q_sleep", points: 4, any: ["sleep"] }] };
  return ctx;
}

function fnOf(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at > 0, name + " must exist");
  return src.slice(at, at + 2500);
}

/* ── bridge ────────────────────────────────────────────────────────────────── */

test("bridge: threads are keyed by slot first — the same character in two sections is two conversations", async () => {
  const ctx = loadAll();
  const seen = [];
  const bridge = ctx.modALLMBridge.create({
    persistTurn(role, content, character, slot) { seen.push([role, character, slot]); }
  });
  bridge.setSlot(1);
  const r1 = await bridge.submit("first section, how are you sleeping?");
  bridge.setSlot(2);
  const r2 = await bridge.submit("second section, how are you sleeping?");
  assert.equal(r1.slot, 1);
  assert.equal(r2.slot, 2);
  assert.deepEqual(bridge._internal.getSlots().sort(), ["1", "2"]);
  assert.equal(bridge._internal.getThreads(1).patient.length, 2);
  assert.equal(bridge._internal.getThreads(2).patient.length, 2);
  assert.match(bridge._internal.getThreads(1).patient[0].content, /^first section/);
  assert.match(bridge._internal.getThreads(2).patient[0].content, /^second section/);
  // getTranscript() is the ACTIVE slot's active character — slot 2 now.
  assert.match(bridge._internal.getTranscript()[0].content, /^second section/);
  assert.deepEqual(seen.map(t => t[2]), [1, 1, 2, 2], "persistTurn is told the slot of every turn");
});

test("bridge: the model sees only the active slot's thread", async () => {
  const ctx = loadAll();
  const bridge = ctx.modALLMBridge.create({});
  const bodies = [];
  bridge.setCallable(body => { bodies.push(body); return Promise.resolve({ data: { reply: "ok", state: "ok" } }); });
  bridge.setSlot(1);
  await bridge.submit("slot one");
  bridge.setSlot(2);
  await bridge.submit("slot two");
  bridge.setSlot(1);
  await bridge.submit("slot one again");
  const texts = bodies[2].messages.slice(1).map(m => m.content);
  assert.deepEqual(texts, ["slot one", "ok", "slot one again"],
    "section 2's turn must not appear in section 1's conversation");
});

test("bridge: scoring hooks receive the slot, and the awarded map is asked for per slot", async () => {
  const ctx = loadAll();
  const asked = [];
  const awards = [];
  const maps = { 1: { q_sleep: true }, 2: {} };   // section 1 already earned it
  const bridge = ctx.modALLMBridge.create({
    getAwarded(slot) { asked.push(slot); return maps[slot]; },
    onAward(id, fam, slot) { awards.push([id, slot]); }
  });
  bridge.setSlot(1);
  await bridge.submit("how are you sleeping?");
  bridge.setSlot(2);
  await bridge.submit("how are you sleeping?");
  assert.deepEqual(asked, [1, 2]);
  assert.deepEqual(awards, [["q_sleep", 2]],
    "the family fires in section 2 even though section 1 already has it — dedupe is per slot");
});

test("bridge: loadTranscript files turns by slot, defaulting untagged turns to the given first PBL slot", () => {
  const bridge = loadAll().modALLMBridge.create({});
  bridge.loadTranscript([
    { role: "user", content: "old" },                    // pre-per-slot turn
    { role: "assistant", content: "old reply" },
    { role: "user", content: "new", slot: 3 },
    { role: "assistant", content: "new reply", slot: 3 }
  ], 2);
  assert.deepEqual(bridge._internal.getThreads(2).patient.map(t => t.content), ["old", "old reply"]);
  assert.deepEqual(bridge._internal.getThreads(3).patient.map(t => t.content), ["new", "new reply"]);
});

test("bridge: setSlot() rejects nonsense and falls back to slot 1", () => {
  const bridge = loadAll().modALLMBridge.create({});
  bridge.setSlot("x"); assert.equal(bridge.getSlot(), 1);
  bridge.setSlot(0);   assert.equal(bridge.getSlot(), 1);
  bridge.setSlot("4"); assert.equal(bridge.getSlot(), 4);
  bridge.setSlot(2.7); assert.equal(bridge.getSlot(), 2);
});

/* ── rules ─────────────────────────────────────────────────────────────────── */

const TURN_RULES = [
  ["sessions", RULES.roomChat.$sessionId.$roomId.$turnId],
  ["orgs", RULES.roomChat.orgs.$orgSlug.$sessionId.$roomId.$turnId]
];
for (const [tree, node] of TURN_RULES) {
  test(`rules (${tree}): a roomChat turn may carry a slot 1–9, and need not`, () => {
    const v = node[".validate"];
    assert.match(v, /!newData\.hasChild\('slot'\)/, "OPTIONAL — every pre-per-slot turn lacks it");
    assert.match(v, /child\('slot'\)\.isNumber\(\)/);
    assert.match(v, /child\('slot'\)\.val\(\) >= 1/);
    assert.match(v, /child\('slot'\)\.val\(\) <= 9/,
      "the same bound as sections/$slot (`^[1-9]$`) — a slot the room state cannot hold is not a slot");
  });
}

test("rules: the per-slot awarded node the chat now writes exists in BOTH trees", () => {
  const s = RULES.sessions.$sessionId.rooms.$roomId.sections.$slot.scoring.awarded.$familyId;
  const o = RULES.orgs.$orgSlug.sessions.$sessionId.rooms.$roomId.sections.$slot.scoring.awarded.$familyId;
  for (const n of [s, o]) {
    assert.match(n[".write"], /!data\.exists\(\)/, "write-once per slot");
    assert.match(n[".write"], /roomOf'\)\.child\(auth\.uid\)\.child\('room'\)\.val\(\) == \$roomId/);
  }
});

/* ── init wiring ───────────────────────────────────────────────────────────── */

test("init: every persisted turn carries the slot it was spoken in", () => {
  const at = INIT.indexOf("persistTurn: function (role, content, characterId, slot)");
  assert.ok(at > 0);
  assert.match(INIT.slice(at, at + 900), /turn\.slot = slot \|\| activeSlotId;/);
});

test("init: the once-only award map is the PER-SLOT node; the module-literal node is no longer read", () => {
  assert.match(INIT, /"\/sections\/" \+ slot \+ "\/scoring\/awarded"/);
  assert.ok(!/moduleA\/scoring\/awarded|modABase/.test(stripComments(INIT)),
    "rooms/$room/moduleA/scoring/awarded must not be read or written any more");
  assert.match(fnOf(INIT, "_watchAwarded"), /refs\.awardedFor\(slot\)/);
});

test("init: award and penalty event ids are namespaced per slot", () => {
  const at = INIT.indexOf("onAward: function (famId, fam, slot)");
  assert.ok(at > 0);
  const body = INIT.slice(at, at + 2600);
  assert.match(body, /refs\.scoreAuto\.child\(_scoreEventId\(sl, famId\)\)/);
  assert.match(body, /refs\.scorePenalties\.child\(_penaltyEventId\(sl, famId\)\)/);
  assert.ok(!/refs\.scoreAuto\.child\("chatA_" \+ famId\)/.test(INIT), "the unnamespaced id must be gone");
});

test("init: a turn from another slot is cached, not rendered; a slot change rebuilds from the cache", () => {
  const child = fnOf(INIT, "_onChatChild");
  assert.match(child, /turns\.push\(t\);/);
  assert.match(child, /if \(_slotOf\(t\) !== activeSlotId\) return;/);
  const rebuild = fnOf(INIT, "_rebuildForSlot");
  assert.match(rebuild, /transcriptEl\.textContent = ""/);
  assert.match(rebuild, /if \(_slotOf\(t\) !== activeSlotId\) continue;/);
  assert.match(rebuild, /_renderCast\(\);/);
  const change = fnOf(INIT, "_onSlotChange");
  assert.match(change, /bridge\.setSlot\(next\)/);
  assert.match(change, /_watchAwarded\(next\)/);
  assert.match(change, /activeId = _defaultId\(\);/,
    "a new section opens on its own default addressee, not the previous section's");
});

test("init: an untagged turn belongs to the session's FIRST PBL slot", () => {
  assert.match(fnOf(INIT, "_slotOf"), /_firstPblSlot\(\)/);
  assert.match(fnOf(INIT, "_firstPblSlot"), /CANAMED_FIRST_PBL_SLOT/);
});

test("init: the slot listener is attached, and detached on destroy with every awarded subscription", () => {
  assert.match(INIT, /window\.addEventListener\("canamed:slotchange", _onSlotChange\)/);
  const d = fnOf(INIT, "destroy");
  assert.match(d, /removeEventListener\("canamed:slotchange", _onSlotChange\)/);
  assert.match(d, /Object\.keys\(awardedSubs\)\.forEach/);
});

/* ── script.js wiring ──────────────────────────────────────────────────────── */

test("script: refreshActiveSlotState publishes the active slot and announces a change once", () => {
  const f = fnOf(SCRIPT, "refreshActiveSlotState");
  assert.match(f, /window\.CANAMED_ACTIVE_SLOT = activeSlot;/);
  assert.match(f, /window\.CANAMED_FIRST_PBL_SLOT = _legacySlotFor\("pbl"\);/);
  assert.match(f, /if \(activeSlot !== _lastAnnouncedSlot\)/, "announce on CHANGE, not on every render");
  assert.match(f, /new CustomEvent\("canamed:slotchange"/);
  // The announcement comes AFTER the content is applied, so the chat's
  // rebuild sees the new section's cast.
  assert.ok(f.indexOf("applySectionContent(slot);") < f.indexOf("canamed:slotchange"));
});

test("script: teardown resets the announced slot so the next room announces its first slot", () => {
  assert.match(SCRIPT, /sectionState = \{\}; activeSlot = 1; _appliedSectionId = null; _lastAnnouncedSlot = null;/);
});

test("script: the id helpers exist, are exposed to the lazy chunk, and agree with the chunk's fallbacks", () => {
  assert.match(SCRIPT, /function chatScoreEventId\(slot, famId\) \{ return "chatA_s" \+ slot \+ "_" \+ famId; \}/);
  assert.match(SCRIPT, /function chatPenaltyEventId\(slot, famId\) \{ return "s" \+ slot \+ "_" \+ famId; \}/);
  assert.match(SCRIPT, /window\.chatScoreEventId = chatScoreEventId;/);
  assert.match(SCRIPT, /window\.chatPenaltyEventId = chatPenaltyEventId;/);
  assert.match(INIT, /return "chatA_s" \+ slot \+ "_" \+ famId;/);
  assert.match(INIT, /return "s" \+ slot \+ "_" \+ famId;/);
});

test("script: renderObjectives reads the per-slot id and still honours a pre-per-slot award", () => {
  const f = fnOf(SCRIPT, "renderObjectives");
  assert.match(f, /ev: chatScoreEventId\(activeSlot, f\.id\), legacy: "chatA_" \+ f\.id/);
  assert.match(f, /const done = !!earned\[o\.ev\] \|\| !!\(o\.legacy && earned\[o\.legacy\]\);/);
});

test("script: penaltyMeta strips the slot prefix before looking a chat penalty up", () => {
  const f = fnOf(SCRIPT, "penaltyMeta");
  assert.match(f, /const famId = ev\.replace\(\/\^s\\d\+_\/, ""\);/);
  assert.match(f, /find\(pp => pp\.id === famId\)/);
});
