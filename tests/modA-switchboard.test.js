/* tests/modA-switchboard.test.js
 *
 * The Module A chat SWITCHBOARD (scenario-characters design, slice 2): a
 * section may declare several Module A characters, the student picks who they
 * are speaking to, and each character is its own thread — its own bubbles,
 * its own conversation at the model, its own facts. This file pins the pure
 * halves (scorer, prompt builder, bridge), the rules, and the source-level
 * wiring in modA-llm-init.js / script.js that a Node test can see; the DOM
 * behaviour is proven per device in tests-e2e/modA-switchboard.spec.js and
 * the rule is proven against the real emulator in rules-smoke.spec.js.
 *
 * The invariant that matters most, stated once: A TURN WITH NO `character`
 * BELONGS TO THE INDEX PATIENT. Every transcript written before this change
 * has that shape, so every reader here must default that way.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INIT = fs.readFileSync(path.join(P, "modA-llm-init.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const ROOM_CSS = fs.readFileSync(path.join(P, "room.css"), "utf8");
const RULES = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;

/* A three-member cast with facts routed by `who`, so a reply sourced from the
   wrong character is obvious rather than plausible. */
const CAST = [
  { id: "patient", role: "patient", module: ["A"], present: "start",
    name: "Mayumi", persona: "You are Mayumi, 15, guarded and sullen." },
  { id: "mother", role: "relative", module: ["A"], present: "start",
    name: "Mayumi's Mother", persona: "You are Mayumi's mother, warm but anxious." },
  { id: "father", role: "relative", module: ["A"], present: "start",
    name: "Mayumi's Father", persona: "You are Mayumi's father, practical and a little defensive." },
  { id: "nurse", role: "colleague", module: ["B"], present: "start",
    name: "Ward nurse", persona: "Module B only — must not appear in the Module A cast." },
  { id: "teacher", role: "other", module: ["A"], present: "onCue",
    name: "Form teacher", persona: "Enters on cue — not offered yet." }
];

const CASE = {
  history: [
    { q: { en: "How are you sleeping?" }, a: { en: "PATIENT-LINE: I can't sleep unless I drink." } },
    { q: { en: "How is your own mood, how are you sleeping?" }, who: "mother",
      a: { en: "MOTHER-LINE: Every spring and autumn I feel tired and down." } },
    { q: { en: "How is home, how are you sleeping?" }, who: "father",
      a: { en: "FATHER-LINE: Home is fine. She used to be such a good girl." } }
  ]
};

const SCORING = {
  moduleA_questions: [
    { id: "q_sleep", points: 4, any: ["sleep"] },
    { id: "q_family_psych", points: 6, any: ["mood", "depress"], askOf: "mother" },
    { id: "q_home", points: 3, any: ["home"], askOf: ["father", "mother"] }
  ],
  moduleA_question_penalties: [
    { id: "p_blame", points: 2, any: ["your fault"], askOf: "patient" }
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
  ctx.CURRENT_SCENARIO_CHARACTERS = CAST;
  ctx.CASE = CASE;
  ctx.SCORING = SCORING;
  return ctx;
}

/* ── scorer: askOf ─────────────────────────────────────────────────────────── */

test("askOf: a family scores only when the question was put to a named character", () => {
  const SC = loadAll().modAQuestionScoring;
  assert.deepEqual(SC.scoreQuestion("how is your mood?", {}, "mother").award, ["q_family_psych"]);
  assert.deepEqual(SC.scoreQuestion("how is your mood?", {}, "patient").award, [],
    "the same words at the patient earn nothing — the point is WHO was asked");
  assert.deepEqual(SC.scoreQuestion("how is your mood?", {}, "father").award, []);
});

test("askOf: an array names several acceptable addressees", () => {
  const SC = loadAll().modAQuestionScoring;
  assert.deepEqual(SC.scoreQuestion("how is home?", {}, "father").award, ["q_home"]);
  assert.deepEqual(SC.scoreQuestion("how is home?", {}, "mother").award, ["q_home"]);
  assert.deepEqual(SC.scoreQuestion("how is home?", {}, "patient").award, []);
});

test("askOf: a family with no askOf scores whoever it was asked of (pre-switchboard behaviour)", () => {
  const SC = loadAll().modAQuestionScoring;
  for (const who of ["patient", "mother", "father", undefined, null]) {
    assert.deepEqual(SC.scoreQuestion("do you sleep?", {}, who).award, ["q_sleep"], String(who));
  }
});

test("askOf: no characterId means the index patient — legacy callers keep scoring exactly as before", () => {
  const SC = loadAll().modAQuestionScoring;
  assert.deepEqual(SC.scoreQuestion("it is your fault", {}).penalty, ["p_blame"],
    "a two-argument call is the patient, so a patient-only penalty fires");
  assert.deepEqual(SC.scoreQuestion("it is your fault", {}, "mother").penalty, [],
    "…and does not fire when the mother was addressed");
});

test("askOf: with no characterId the default is the scenario's index patient, whatever its id", () => {
  const ctx = loadAll();
  ctx.CURRENT_SCENARIO_CHARACTERS = [
    { id: "mayumi", role: "patient", name: "Mayumi", persona: "…" },
    { id: "mother", role: "relative", name: "Mother", persona: "…" }
  ];
  ctx.SCORING = { moduleA_questions: [{ id: "q_self", points: 1, any: ["school"], askOf: "mayumi" }] };
  assert.deepEqual(ctx.modAQuestionScoring.scoreQuestion("how is school?", {}).award, ["q_self"],
    "a two-argument call resolves to the index patient's REAL id, not the literal 'patient'");
});

test("askOf: an empty array is an authoring slip and means no restriction, not 'nobody'", () => {
  const ctx = loadAll();
  ctx.SCORING = { moduleA_questions: [{ id: "q_x", points: 1, any: ["school"], askOf: [] }] };
  assert.deepEqual(ctx.modAQuestionScoring.scoreQuestion("how is school?", {}, "father").award, ["q_x"]);
});

/* ── prompts: the Module A cast ────────────────────────────────────────────── */

test("moduleACharacters offers Module A, present-from-start characters, in authored order", () => {
  const PR = loadAll().modALLMPrompts;
  assert.deepEqual(PR.moduleACharacters().map(c => c.id), ["patient", "mother", "father"],
    "the Module B nurse and the on-cue teacher are not offered");
});

test("a character with no `module` is offered (legacy single-patient casts declare none)", () => {
  const ctx = loadAll();
  ctx.CURRENT_SCENARIO_CHARACTERS = [{ id: "patient", role: "patient", name: "Mrs Tanaka", persona: "…" }];
  assert.deepEqual(ctx.modALLMPrompts.moduleACharacters().map(c => c.id), ["patient"]);
});

test("defaultCharacterId is the index patient's id, 'patient' when there is no cast", () => {
  const ctx = loadAll();
  assert.equal(ctx.modALLMPrompts.defaultCharacterId(), "patient");
  ctx.CURRENT_SCENARIO_CHARACTERS = [{ id: "mayumi", role: "patient", name: "Mayumi", persona: "…" }];
  assert.equal(ctx.modALLMPrompts.defaultCharacterId(), "mayumi");
  ctx.CURRENT_SCENARIO_CHARACTERS = null;
  assert.equal(ctx.modALLMPrompts.defaultCharacterId(), "patient");
});

test("buildChatMessages with a characterId uses THAT character's persona and only their facts", () => {
  const PR = loadAll().modALLMPrompts;
  const sys = PR.buildChatMessages("en", [], "hello", { characterId: "mother" })[0].content;
  assert.match(sys, /You are Mayumi's mother/);
  assert.match(sys, /MOTHER-LINE/);
  assert.doesNotMatch(sys, /PATIENT-LINE/, "the patient's facts must not leak into the mother's prompt");
  assert.doesNotMatch(sys, /FATHER-LINE/);
});

/* ── bridge: one thread per character ─────────────────────────────────────── */

function mockHooks() {
  const calls = { turns: [], award: [] };
  const awarded = {};
  return {
    calls,
    hooks: {
      persistTurn(role, content, character) { calls.turns.push({ role, content, character }); },
      onAward(id) { calls.award.push(id); awarded[id] = true; },
      getAwarded() { return awarded; }
    }
  };
}

test("bridge: threads are isolated per character, and the stub answers as the addressee", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);

  bridge.setCharacter("mother");
  const r1 = await bridge.submit("How are you sleeping?");
  assert.equal(r1.character, "mother");
  assert.match(r1.reply, /^MOTHER-LINE/, "the stub must answer from the MOTHER's facts");

  bridge.setCharacter("patient");
  const r2 = await bridge.submit("How are you sleeping?");
  assert.equal(r2.character, "patient");
  assert.match(r2.reply, /^PATIENT-LINE/);

  const threads = bridge._internal.getThreads();
  assert.deepEqual(Object.keys(threads).sort(), ["mother", "patient"]);
  assert.equal(threads.mother.length, 2, "user + assistant turn in the mother's thread");
  assert.equal(threads.patient.length, 2);
  assert.match(threads.mother[1].content, /^MOTHER-LINE/);
  assert.match(threads.patient[1].content, /^PATIENT-LINE/);

  // getTranscript() is the ACTIVE thread — the pre-switchboard reading.
  assert.deepEqual(bridge._internal.getTranscript(), threads.patient);
});

test("bridge: persistTurn is told the addressee of every turn", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setCharacter("father");
  await bridge.submit("How is home?");
  assert.deepEqual(m.calls.turns.map(t => [t.role, t.character]),
    [["user", "father"], ["assistant", "father"]]);
});

test("bridge: a host that never calls setCharacter() addresses the index patient", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  assert.equal(bridge.getCharacter(), "patient");
  const r = await bridge.submit("How are you sleeping?");
  assert.equal(r.character, "patient");
  assert.match(r.reply, /^PATIENT-LINE/);
  assert.equal(m.calls.turns[0].character, "patient");
});

test("bridge: setCharacter(null) returns to the index patient", () => {
  const bridge = loadAll().modALLMBridge.create({});
  bridge.setCharacter("mother");
  assert.equal(bridge.getCharacter(), "mother");
  bridge.setCharacter(null);
  assert.equal(bridge.getCharacter(), "patient");
});

test("bridge: scoring is run against the addressee, so askOf families fire for the right person", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setCharacter("patient");
  await bridge.submit("How is your mood these days?");
  assert.deepEqual(m.calls.award, [], "mood asked of the PATIENT scores nothing");
  bridge.setCharacter("mother");
  await bridge.submit("How is your mood these days?");
  assert.deepEqual(m.calls.award, ["q_family_psych"], "…asked of the MOTHER it scores");
});

test("bridge: the model sees only the addressee's thread — one persona per call", async () => {
  const ctx = loadAll();
  const bridge = ctx.modALLMBridge.create({});
  const seen = [];
  bridge.setCallable(body => { seen.push(body); return Promise.resolve({ data: { reply: "ok", state: "ok" } }); });

  bridge.setCharacter("mother");
  await bridge.submit("first to mother");
  bridge.setCharacter("father");
  await bridge.submit("first to father");
  bridge.setCharacter("mother");
  await bridge.submit("second to mother");

  const last = seen[2];
  assert.equal(last.characterName, "Mayumi's Mother", "the prefix stripper is told the addressee's name");
  assert.match(last.messages[0].content, /Mayumi's mother/);
  const texts = last.messages.slice(1).map(m => m.content);
  assert.deepEqual(texts, ["first to mother", "ok", "second to mother"],
    "the father's turn must not appear in the mother's conversation");
});

test("bridge: loadTranscript groups persisted turns by character, defaulting to the patient", () => {
  const bridge = loadAll().modALLMBridge.create({});
  bridge.loadTranscript([
    { role: "user", content: "a" },                          // pre-switchboard turn
    { role: "assistant", content: "b" },
    { role: "user", content: "c", character: "mother" },
    { role: "assistant", content: "d", character: "mother" }
  ]);
  const threads = bridge._internal.getThreads();
  assert.deepEqual(threads.patient.map(t => t.content), ["a", "b"]);
  assert.deepEqual(threads.mother.map(t => t.content), ["c", "d"]);
});

/* ── rules: the optional, validated `character` field, in BOTH trees ───────── */

const TURN_RULES = [
  ["sessions", RULES.roomChat.$sessionId.$roomId.$turnId],
  ["orgs", RULES.roomChat.orgs.$orgSlug.$sessionId.$roomId.$turnId]
];

for (const [tree, node] of TURN_RULES) {
  test(`rules (${tree}): a roomChat turn may carry a validated character id, and need not`, () => {
    const v = node[".validate"];
    assert.match(v, /!newData\.hasChild\('character'\)/,
      "the field must be OPTIONAL — every pre-switchboard turn lacks it");
    assert.match(v, /child\('character'\)\.isString\(\)/);
    assert.match(v, /child\('character'\)\.val\(\)\.matches\(\/\^\[a-z0-9_-\]\{1,40\}\$\/\)/,
      "a character id is an authored slug: lower-case, ≤40, no separators the emulator mistranslates");
    assert.doesNotMatch(v, /\\[a-zA-Z]/,
      "no backslash escape in the rule: the emulator drops them inside a character class (CLAUDE.md, 2026-08-06)");
  });
}

test("rules: the character regex is the same one the prompt builder's ids satisfy", () => {
  const re = /^[a-z0-9_-]{1,40}$/;
  for (const c of CAST) assert.ok(re.test(c.id), c.id);
  assert.ok(!re.test("Mayumi's Mother"), "a display NAME is not an id");
  assert.ok(!re.test("x".repeat(41)));
});

/* ── init + script wiring (source-level) ───────────────────────────────────── */

test("init: a turn is tagged with its addressee only when the cast is plural", () => {
  const at = INIT.indexOf("persistTurn: function (role, content, characterId)");
  assert.ok(at > 0, "persistTurn must accept the addressee");
  const body = INIT.slice(at, at + 600);
  assert.match(body, /if \(characterId && _isMulti\(\)\) turn\.character = String\(characterId\);/,
    "a single-patient section must keep writing the exact pre-switchboard shape");
});

test("init: a persisted turn with no character renders into the index patient's thread", () => {
  const at = INIT.indexOf("function _onChatChild(snap)");
  const body = INIT.slice(at, at + 700);
  assert.match(body, /var who = t\.character \? String\(t\.character\) : _defaultId\(\);/);
  assert.match(body, /_renderTurn\(_threadEl\(who\)/);
});

test("init: the cast follows the section — castchange is listened for and detached on destroy", () => {
  assert.match(INIT, /window\.addEventListener\("canamed:castchange", _onCastChange\)/);
  assert.match(INIT, /window\.removeEventListener\("canamed:castchange", _onCastChange\)/);
  const at = SCRIPT.indexOf("function applySectionContent(slot)");
  const body = SCRIPT.slice(at, at + 1500);
  assert.match(body, /new CustomEvent\("canamed:castchange"\)/,
    "applySectionContent must announce a republished cast");
});

test("init: the chip row is hidden below two characters, so single-patient scenarios show no new chrome", () => {
  const at = INIT.indexOf("function _renderCast()");
  const body = INIT.slice(at, at + 400);
  assert.match(body, /if \(list\.length < 2\) \{\s*castEl\.hidden = true;/);
});

test("css: chip, badge and thread rules exist in room.css, hidden states included, tokens only", () => {
  const start = ROOM_CSS.indexOf("/* ── Switchboard");
  assert.ok(start > 0, "the switchboard block must be in room.css (the chat's own stylesheet)");
  const block = ROOM_CSS.slice(start, ROOM_CSS.indexOf(".moda-chat-bub {", start));
  for (const sel of [".moda-chat-cast[hidden]", ".moda-chat-thread[hidden]", ".moda-chat-chip-badge[hidden]"]) {
    assert.match(block, new RegExp(sel.replace(/[.[\]]/g, "\\$&") + "\\s*\\{\\s*display:\\s*none;"), sel);
  }
  assert.match(block, /\.moda-chat-chip\[aria-pressed="true"\]/);
  const noComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(noComments), "no raw hex — tokens.css owns colour");
  const tokens = fs.readFileSync(path.join(P, "tokens.css"), "utf8");
  for (const m of noComments.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
    assert.ok(tokens.includes(m[1] + ":"), m[1] + " must exist in tokens.css (an unknown custom property is silently dropped)");
  }
});
