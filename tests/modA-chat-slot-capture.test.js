/* tests/modA-chat-slot-capture.test.js
 *
 * A patient reply must be answered out of the case and language the student
 * actually ASKED in, not whatever is on screen when the promise resolves.
 *
 * `window.CASE` and the bridge's `cfg` are per-active-slot globals:
 * `applySectionContent()` republishes `window.CASE` when the session moves to
 * another section, and `bridge.setLang()` fires from modA-llm-init's
 * `canamed:langchange` handler whenever the participant switches language. The
 * bridge's fallback paths — empty reply, network failure, no endpoint — used to
 * read both at RESOLUTION time:
 *
 *     .then(function (clean) {
 *       if (!clean) return _stubReply(userText, W.CASE, cfg.lang);   // <- later
 *     })
 *
 * so a reply landing after a section change answered the student's question
 * from a DIFFERENT case. Nothing throws; the answer is simply attributed to the
 * wrong section, and it flows on into the transcript, the take-home and the
 * research export. Same defect family as #275 (authored content silently
 * replaced by a default).
 *
 * NOTE ON THE ORIGINAL REPORT: the defect was recorded as "scoreQuestion()
 * reads window.SCORING at resolution time". That part is NOT true — verified
 * on 2026-08-05: `_runScoring()` is called synchronously inside `submit()`,
 * before `_getPatientReply()` is awaited, and the award/persist hooks close
 * over `refs` captured at bridge-creation time. Scoring was never exposed.
 * The real exposure was `W.CASE` / `cfg.lang` in the reply fallbacks, which is
 * what these tests pin.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const BRIDGE_SRC = fs.readFileSync(path.join(PLATFORM, "modA-llm-bridge.js"), "utf8");

/* Two cases whose canned answers are unmistakably distinct, so a reply sourced
   from the wrong one is obvious rather than plausible. */
const CASE_A = {
  history: [{ q: { en: "chest pain radiating to the arm" },
              a: { en: "ANSWER-FROM-CASE-A", fr: "REPONSE-CAS-A" } }]
};
const CASE_B = {
  history: [{ q: { en: "chest pain radiating to the arm" },
              a: { en: "ANSWER-FROM-CASE-B", fr: "REPONSE-CAS-B" } }]
};

function loadBridge() {
  /* Fresh module per test: the bridge attaches to a window-ish global and we
     mutate that global mid-flight, which is the whole point. */
  delete require.cache[require.resolve(path.join(PLATFORM, "modA-llm-bridge.js"))];
  return require(path.join(PLATFORM, "modA-llm-bridge.js"));
}

test("a reply that lands AFTER a section change is answered from the case the student asked in", async () => {
  const bridge = loadBridge().create({});
  globalThis.CASE = CASE_A;

  /* No endpoint configured is the synchronous stub path; to exercise the
     ASYNC fallback we give it an endpoint whose fetch rejects, which lands in
     submit()'s .catch — a genuine resolution-time continuation. */
  bridge.setEndpoint("https://example.invalid/patient", null);
  globalThis.fetch = () => new Promise((_, reject) =>
    setImmediate(() => reject(new Error("network down"))));

  const pending = bridge.submit("chest pain radiating to the arm");
  // The facilitator advances to another section while the request is in flight.
  globalThis.CASE = CASE_B;

  const out = await pending;
  assert.ok(out, "submit must resolve");
  assert.strictEqual(out.reply, "ANSWER-FROM-CASE-A",
    "the fallback must answer from the case that was active at SUBMIT time; " +
    "got a reply sourced from the case that arrived later");
});

test("a reply that lands AFTER a language switch keeps the language it was asked in", async () => {
  const bridge = loadBridge().create({});
  globalThis.CASE = CASE_A;
  bridge.setLang("fr");
  bridge.setEndpoint("https://example.invalid/patient", null);
  globalThis.fetch = () => new Promise((_, reject) =>
    setImmediate(() => reject(new Error("network down"))));

  const pending = bridge.submit("chest pain radiating to the arm");
  bridge.setLang("en");            // participant flips the UI language mid-flight

  const out = await pending;
  assert.strictEqual(out.reply, "REPONSE-CAS-A",
    "the fallback must use the language the question was asked in");
});

test("the transcript records the reply that was actually returned", async () => {
  /* Derivation and publication are two links: a correct return value proves
     nothing if the persisted turn disagrees with it. */
  const bridge = loadBridge().create({});
  globalThis.CASE = CASE_A;
  const persisted = [];
  const b2 = loadBridge().create({
    persistTurn: (role, content) => persisted.push([role, content])
  });
  globalThis.CASE = CASE_A;
  b2.setEndpoint("https://example.invalid/patient", null);
  globalThis.fetch = () => new Promise((_, reject) =>
    setImmediate(() => reject(new Error("network down"))));

  const pending = b2.submit("chest pain radiating to the arm");
  globalThis.CASE = CASE_B;
  const out = await pending;

  const assistant = persisted.filter(([r]) => r === "assistant").map(([, c]) => c);
  assert.deepStrictEqual(assistant, [out.reply],
    "the persisted assistant turn must be the reply that was returned");
  assert.strictEqual(assistant[0], "ANSWER-FROM-CASE-A");
  assert.ok(bridge, "keep the first bridge referenced so the linter is happy");
});

/* ── structural guards: the capture must stay, and stay used ───────── */

test("the request context is captured once, before anything awaits", () => {
  assert.match(BRIDGE_SRC, /function _captureRequestContext\(\)/);
  const submitAt = BRIDGE_SRC.indexOf("function submit(text)");
  const body = BRIDGE_SRC.slice(submitAt, submitAt + 1600);
  const capAt = body.indexOf("_captureRequestContext()");
  const replyAt = body.indexOf("_getPatientReply(clean, req)");
  assert.ok(capAt > 0 && replyAt > capAt,
    "submit must capture the context BEFORE dispatching the request");
});

test("no fallback path reads the per-slot globals at resolution time", () => {
  /* The bug in one line: any `W.CASE` or `cfg.lang` reachable from a .then /
     .catch continuation re-reads a global that may have moved on. */
  const a = BRIDGE_SRC.indexOf("function _getPatientReply(");
  const b = BRIDGE_SRC.indexOf("return {", BRIDGE_SRC.indexOf("function submit(text)"));
  const region = BRIDGE_SRC.slice(a, b);
  assert.doesNotMatch(region, /_stubReply\([^)]*W\.CASE/,
    "a stub fallback must use the captured case, not window.CASE");
  assert.doesNotMatch(region, /_stubReply\([^)]*cfg\.lang/,
    "a stub fallback must use the captured language, not cfg.lang");
  assert.doesNotMatch(region, /_sanitiseReply\([^)]*cfg\.maxReplyLen/,
    "sanitising must use the captured cap");
});

test("transport config is still read live — only CONTENT context is captured", () => {
  /* endpointUrl/headers/timeout describe WHERE to send, not what the answer is
     about; freezing them would break setEndpoint() taking effect. */
  const a = BRIDGE_SRC.indexOf("function _getPatientReply(");
  const b = BRIDGE_SRC.indexOf("/* submit(text)");
  const region = BRIDGE_SRC.slice(a, b);
  for (const k of ["cfg.endpointUrl", "cfg.endpointHeaders", "cfg.timeoutMs"]) {
    assert.ok(region.includes(k), k + " must still be read live");
  }
});

test("scoring was never exposed to this race, and still is not", () => {
  /* Guards the CORRECTED premise: _runScoring is synchronous within submit(),
     before the reply is awaited. If someone later moves it into a
     continuation, that WOULD introduce the reported-but-nonexistent bug. */
  const submitAt = BRIDGE_SRC.indexOf("function submit(text)");
  const body = BRIDGE_SRC.slice(submitAt, submitAt + 1600);
  // The switchboard added the addressee as a second argument; match the call
  // by its first argument so the check survives that without weakening.
  const scoreAt = body.indexOf("_runScoring(clean");
  const awaitAt = body.indexOf("_getPatientReply(clean, req)");
  assert.ok(scoreAt > 0 && awaitAt > scoreAt,
    "scoring must run synchronously at submit time, before the reply is awaited");
});
