/* tests/modA-llm-bridge.test.js
 *
 * Lock-in for the Module A LLM-patient bridge (chat flow + scoring +
 * persistence hooks). Loads case-content.js, modA-question-scoring.js,
 * modA-llm-prompts.js, and modA-llm-bridge.js into a shared `window`
 * shim; then drives the bridge with mock hooks + a stub fetch.
 *
 * Static / off-network like the rest of tests/.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");

function loadAll() {
  const ctx = {};
  ctx.module = { exports: {} };

  // Step 1: case-content.js. Need to expose SCORING + CASE on the shared ctx.
  let caseSrc = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  caseSrc += "\nthis.SCORING = SCORING; this.CASE = CASE;";
  // eslint-disable-next-line no-new-func
  new Function("window", "self", "module", caseSrc).call(ctx, ctx, ctx, ctx.module);

  // Step 2-4: scoring + prompts + bridge — IIFEs that write to window.*
  ["modA-question-scoring.js", "modA-llm-prompts.js", "modA-llm-bridge.js"].forEach(f => {
    const src = fs.readFileSync(path.join(P, f), "utf8");
    // eslint-disable-next-line no-new-func
    new Function("window", "self", "module", src).call(ctx, ctx, ctx, ctx.module);
  });

  return ctx;
}

function mockHooks() {
  const calls = { award: [], penalty: [], unlock: [], turns: [], errors: [] };
  const awarded = {};
  return {
    calls,
    awarded,
    hooks: {
      onAward(famId, fam) { calls.award.push({ famId, fam }); awarded[famId] = true; },
      onPenalty(famId, fam) { calls.penalty.push({ famId, fam }); awarded[famId] = true; },
      onUnlock(itemId) { calls.unlock.push(itemId); },
      persistTurn(role, content) { calls.turns.push({ role, content }); },
      logError(err) { calls.errors.push(err); },
      getAwarded() { return awarded; }
    }
  };
}

test("submit() with empty text resolves null and calls no hooks", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  const r1 = await bridge.submit("");
  const r2 = await bridge.submit("   ");
  assert.equal(r1, null);
  assert.equal(r2, null);
  assert.equal(m.calls.turns.length, 0);
});

test("stub mode: a red-flag question awards qr_redflags, unlocks history:1, persists both turns", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setLang("en");

  const out = await bridge.submit("Any fever, weight loss or night pain recently?");
  assert.ok(out, "submit returns a result");
  assert.ok(out.reply && out.reply.length > 0, "stub patient replied");
  assert.deepEqual(m.calls.award.map(x => x.famId), ["qr_redflags"]);
  assert.deepEqual(m.calls.unlock, ["history:1"]);
  assert.equal(m.calls.turns.length, 2, "user + assistant persisted");
  assert.equal(m.calls.turns[0].role, "user");
  assert.equal(m.calls.turns[1].role, "assistant");
});

test("once-only: asking the same family twice awards once, unlocks once", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setLang("en");

  await bridge.submit("Any fever or weight loss?");
  await bridge.submit("And any night pain?");
  assert.equal(m.calls.award.length, 1, "qr_redflags only fires once");
  assert.equal(m.calls.unlock.length, 1);
  assert.deepEqual(m.calls.unlock, ["history:1"]);
});

test("three red-flag asks across EN/FR/JA unlock the SYNTH_PREREQS trio", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);

  bridge.setLang("en");
  await bridge.submit("Any fever or weight loss?");
  bridge.setLang("fr");
  await bridge.submit("Avez-vous une anesthésie en selle ou des troubles urinaires ?");
  bridge.setLang("ja");
  await bridge.submit("下肢の筋力低下や反射の異常はありますか？");

  assert.ok(m.calls.unlock.includes("history:1"), "history:1 unlocked");
  assert.ok(m.calls.unlock.includes("history:2"), "history:2 unlocked");
  assert.ok(m.calls.unlock.includes("exam:3"),    "exam:3 unlocked");
});

test("penalty: promising oxycodone fires onPenalty, NOT onAward", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setLang("en");

  await bridge.submit("OK, I'll prescribe oxycodone for you today.");
  assert.equal(m.calls.penalty.length, 1);
  assert.equal(m.calls.penalty[0].famId, "pen_chat_prescribe");
  assert.equal(m.calls.award.length, 0);
});

test("endpoint call: fetch is invoked with the chat-completion messages", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  let captured = null;
  ctx.fetch = function (url, init) {
    captured = { url, init };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ reply: "It's been about 8 months." })
    });
  };
  ctx.AbortController = function () { this.abort = () => {}; this.signal = {}; };
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;

  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setEndpoint("https://example.invalid/llm", { "x-test-token": "abc" });
  bridge.setLang("en");

  const out = await bridge.submit("Tell me about your back pain.");
  assert.equal(out.reply, "It's been about 8 months.");
  assert.ok(captured, "fetch was invoked");
  assert.equal(captured.url, "https://example.invalid/llm");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["x-test-token"], "abc");
  const body = JSON.parse(captured.init.body);
  assert.ok(Array.isArray(body.messages), "messages[] sent");
  assert.equal(body.messages[0].role, "system",
    "first message is the system prompt");
  assert.ok(body.messages[0].content.indexOf("Lefebvre") >= 0,
    "system prompt names the patient");
  assert.equal(body.lang, "en");
});

test("network failure falls back to stub reply and reports fallback:true", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  ctx.fetch = function () { return Promise.reject(new Error("boom")); };
  ctx.AbortController = function () { this.abort = () => {}; this.signal = {}; };
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;

  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setEndpoint("https://example.invalid/llm", null);
  bridge.setLang("en");

  const out = await bridge.submit("Any fever?");
  assert.ok(out.fallback === true, "fallback flag set");
  assert.ok(out.reply.length > 0, "stub reply emitted");
  assert.equal(m.calls.errors.length, 1, "error was logged");
  // Scoring + reveals still happen even when the endpoint dies.
  assert.deepEqual(m.calls.unlock, ["history:1"]);
});

test("malformed endpoint reply (no .reply field) falls back to stub", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  ctx.fetch = function () {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ foo: "bar" }) });
  };
  ctx.AbortController = function () { this.abort = () => {}; this.signal = {}; };
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;

  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setEndpoint("https://example.invalid/llm", null);
  const out = await bridge.submit("Any fever?");
  assert.ok(out.fallback === true);
  assert.equal(m.calls.errors.length, 1);
});

test("sanitiseReply: strips 'Patient:' prefix, rejects JSON-shaped replies, caps length", () => {
  const ctx = loadAll();
  const bridge = ctx.modALLMBridge.create({});
  const s = bridge._internal.sanitiseReply;
  assert.equal(s("Patient: Hello doctor.", 600), "Hello doctor.");
  assert.equal(s("Mr. Lefebvre: I'm in pain.", 600), "I'm in pain.");
  assert.equal(s('{"reply":"x"}', 600), "", "JSON-shaped reply rejected");
  const long = "a".repeat(700);
  const out = s(long, 600);
  assert.ok(out.length <= 600);
  assert.ok(/…$/.test(out));
});

test("input > maxInputLen is clipped before scoring/persistence", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setConfig({ maxInputLen: 20 });
  await bridge.submit("Any fever and weight loss in the last six months?");
  const persisted = m.calls.turns.find(t => t.role === "user").content;
  assert.equal(persisted.length, 20, "user turn was clipped");
});

test("sanitiseReply: broader prefix patterns are stripped (M4 hardening)", () => {
  const ctx = loadAll();
  const bridge = ctx.modALLMBridge.create({});
  const s = bridge._internal.sanitiseReply;
  assert.equal(s("**Patient**: I'm in pain.", 600), "I'm in pain.");
  assert.equal(s("[Patient response] So my back...", 600), "So my back...");
  assert.equal(s("Mr. Lefebvre, age 45: It hurts.", 600), "It hurts.");
  assert.equal(s("Réponse: J'ai mal au dos.", 600), "J'ai mal au dos.");
  assert.equal(s("- I've been hurting", 600), "I've been hurting",
    "leading bullet stripped (list-continuation guard)");
  assert.equal(s("「腰が痛いんです」", 600), "腰が痛いんです",
    "JA corner quotes trimmed");
  assert.equal(s("> Mr. Lefebvre: hello", 600), "hello",
    "quote-block prefix tolerated");
});

test("narratorOnly history items are excluded from the patient prompt (H2)", () => {
  const ctx = loadAll();
  const prompt = ctx.modALLMPrompts.buildPatientPrompt("en");
  // These third-person stage directions live in CASE.history[9..15] which
  // are now flagged narratorOnly; the patient must never see them.
  assert.ok(!prompt.includes("He flinches"),       "no 'He flinches' in EN prompt");
  assert.ok(!prompt.includes("He looks startled"), "no narrator startled");
  assert.ok(!prompt.includes("He brightens"),      "no narrator brightens");
  assert.ok(!prompt.includes("Anal tone"),         "no exam-finding leak");
  assert.ok(!prompt.includes("Diffuse tenderness"),"exam[] is fully excluded");
  // But genuine patient-voice answers ARE present
  assert.ok(prompt.match(/8 months|back/),         "first-person facts kept");
});

test("anti-jailbreak rule is present in EN/FR/JA prompts (H4)", () => {
  const ctx = loadAll();
  const en = ctx.modALLMPrompts.buildPatientPrompt("en");
  const fr = ctx.modALLMPrompts.buildPatientPrompt("fr");
  const ja = ctx.modALLMPrompts.buildPatientPrompt("ja");
  // Identity anchor
  assert.ok(en.includes("NOT an AI"),  "EN identity anchors NOT AI");
  assert.ok(fr.includes("PAS une IA"), "FR identity anchors NOT AI");
  assert.ok(ja.includes("AIでも"),     "JA identity anchors NOT AI");
  // Anti-jailbreak / meta-question deflection
  assert.ok(/system prompt|instructions/i.test(en), "EN has anti-jailbreak rule");
  assert.ok(/prompt système|instructions/i.test(fr),"FR has anti-jailbreak rule");
  assert.ok(ja.includes("システムプロンプト") || ja.includes("指示"), "JA has anti-jailbreak rule");
  // No invented symptoms rule
  assert.ok(/NEVER invent/.test(en),         "EN forbids invention");
  assert.ok(/N'INVENTEZ JAMAIS/.test(fr),    "FR forbids invention");
  assert.ok(ja.includes("絶対に作らない"),    "JA forbids invention");
  // Few-shot example
  assert.ok(en.includes("Example"),  "EN includes example anchor");
  assert.ok(fr.includes("Exemple"),  "FR includes example anchor");
  assert.ok(ja.includes("例"),       "JA includes example anchor");
  // FACTS fence
  assert.ok(en.includes("<facts>") && en.includes("</facts>"), "EN FACTS is XML-fenced");
});

test("loadTranscript() seeds context for the next call", async () => {
  const ctx = loadAll();
  const m = mockHooks();
  let lastBody = null;
  ctx.fetch = function (url, init) {
    lastBody = JSON.parse(init.body);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: "ok" }) });
  };
  ctx.AbortController = function () { this.abort = () => {}; this.signal = {}; };
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;

  const bridge = ctx.modALLMBridge.create(m.hooks);
  bridge.setEndpoint("https://example.invalid/llm", null);
  bridge.loadTranscript([
    { role: "user", content: "earlier question" },
    { role: "assistant", content: "earlier reply" }
  ]);
  await bridge.submit("new question");
  const roles = lastBody.messages.map(x => x.role);
  // system + earlier user + earlier assistant + new user
  assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
  assert.equal(lastBody.messages[1].content, "earlier question");
});
