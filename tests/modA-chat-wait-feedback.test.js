/* tests/modA-chat-wait-feedback.test.js
 *
 * Module A chat, WAITING for a reply (found live 2026-09-11, shell v171).
 * Replies through the self-hosted proxy took 7–19 s, and during that wait the
 * only feedback was a static "<Character> is thinking…", so students took the
 * chat for frozen. Two defects, two halves of this file:
 *
 *   1. NO CLIENT-SIDE TIMEOUT on the proxy path. _proxyCall chained
 *      getIdToken() → fetch() → r.json() with no AbortController; the bridge's
 *      DEFAULTS.timeoutMs covers only the unused setEndpoint() path. A stalled
 *      request left "thinking" on screen and the input disabled indefinitely.
 *      Fixed by the pure modALLMBridge.withDeadline(), proven here with mock
 *      timers — including THROUGH the bridge, where a timeout must become the
 *      stub reply + fallback flag the existing notice already renders.
 *
 *   2. NO PROGRESS CUE. The dots and the elapsed counter are DOM behaviour and
 *      are proven per device in tests-e2e/modA-chat-wait.spec.js; what a Node
 *      test can see — the wiring order, teardown, the CSS contract — is pinned
 *      below.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const P = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(P, f), "utf8");
const INIT = read("modA-llm-init.js");
const ROOM_CSS = read("room.css");
const STYLE_CSS = read("style.css");
const TOKENS = read("tokens.css");
const HANDLER = fs.readFileSync(path.join(ROOT, "proxy", "src", "handler.js"), "utf8");

const CASE = { history: [{ q: { en: "Any fever recently?" }, a: { en: "STUB-LINE: no fever." } }] };

function loadBridge() {
  const ctx = { module: { exports: {} } };
  ["modA-question-scoring.js", "modA-llm-prompts.js", "modA-llm-bridge.js"].forEach((f) => {
    // eslint-disable-next-line no-new-func
    new Function("window", "self", "module", read(f)).call(ctx, ctx, ctx, ctx.module);
  });
  ctx.CURRENT_SCENARIO_CHARACTERS = [{ id: "patient", role: "patient", name: "Mr Lefebvre", persona: "…" }];
  ctx.CASE = CASE;
  ctx.SCORING = { moduleA_questions: [] };
  return ctx;
}

/* Let every queued promise continuation run. setImmediate is NOT among the
   mocked APIs below, so it still yields to the real event loop. */
const flush = () => new Promise((r) => setImmediate(r));

function track(p) {
  const s = { state: "pending", value: undefined, error: undefined };
  p.then((v) => { s.state = "resolved"; s.value = v; },
         (e) => { s.state = "rejected"; s.error = e; });
  return s;
}

const fnOf = (src, name, len) => {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at > 0, name + " must exist");
  return src.slice(at, at + (len || 1500));
};

/* ── 1. the deadline ───────────────────────────────────────────────────────── */

test("withDeadline: a stalled call rejects AT the deadline — not a tick before — and aborts its signal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { withDeadline } = loadBridge().modALLMBridge;
  let signal = null;
  const s = track(withDeadline((sig) => { signal = sig; return new Promise(() => {}); }, 50000));

  t.mock.timers.tick(49999);
  await flush();
  assert.equal(s.state, "pending", "still waiting 1 ms before the deadline");
  assert.ok(signal, "start() receives an AbortSignal");
  assert.equal(signal.aborted, false);

  t.mock.timers.tick(1);
  await flush();
  assert.equal(s.state, "rejected", "a stall must REJECT, so the bridge can fall back");
  assert.equal(s.error.code, "timeout");
  assert.equal(signal.aborted, true, "the request is cancelled, not left holding a socket");
});

test("withDeadline: a prompt reply resolves unchanged, and its timer is cleared (no late abort)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { withDeadline } = loadBridge().modALLMBridge;
  let signal = null;
  const reply = { data: { reply: "It hurts here, doctor.", state: "ok" } };
  const s = track(withDeadline((sig) => { signal = sig; return Promise.resolve(reply); }, 50000));
  await flush();
  assert.equal(s.state, "resolved");
  assert.strictEqual(s.value, reply, "the outcome passes through untouched");

  // Had the timer survived, firing it would abort the signal.
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(signal.aborted, false, "a settled call leaves no pending deadline behind");
  assert.equal(s.state, "resolved");
});

test("withDeadline: a failure before the deadline passes through as itself, not as a timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { withDeadline } = loadBridge().modALLMBridge;
  const s = track(withDeadline(() => Promise.reject(new Error("HTTP 429")), 50000));
  await flush();
  assert.equal(s.state, "rejected");
  assert.equal(s.error.message, "HTTP 429");
  assert.notEqual(s.error.code, "timeout");
});

test("withDeadline: a synchronous throw inside start() becomes a rejection, never a throw", async () => {
  const { withDeadline } = loadBridge().modALLMBridge;
  let p;
  assert.doesNotThrow(() => { p = withDeadline(() => { throw new Error("no Firebase App"); }, 50000); });
  await assert.rejects(p, /no Firebase App/);
});

test("bridge: a stalled proxy call degrades to the stub reply with fallback:true once the deadline passes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = loadBridge();
  const turns = [];
  const bridge = ctx.modALLMBridge.create({ persistTurn: (role, content) => turns.push([role, content]) });
  bridge.setCallable(() => ctx.modALLMBridge.withDeadline(() => new Promise(() => {}), 50000));

  const s = track(bridge.submit("Any fever recently?"));
  t.mock.timers.tick(49999);
  await flush();
  assert.equal(s.state, "pending", "no fallback before the deadline");

  t.mock.timers.tick(1);
  await flush();
  assert.equal(s.state, "resolved", "the student's turn settles instead of hanging on 'thinking'");
  assert.equal(s.value.fallback, true, "flagged, so the 'endpoint unavailable' notice shows");
  assert.match(s.value.reply, /^STUB-LINE/);
  assert.deepEqual(turns.map((x) => x[0]), ["user", "assistant"], "the stub reply is persisted like any reply");
});

test("bridge: a prompt reply through the same deadline is unaffected — the model's words, no fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = loadBridge();
  const bridge = ctx.modALLMBridge.create({});
  bridge.setCallable(() => ctx.modALLMBridge.withDeadline(
    () => Promise.resolve({ data: { reply: "No fever, doctor.", state: "ok" } }), 50000));
  const out = await bridge.submit("Any fever recently?");
  assert.equal(out.reply, "No fever, doctor.");
  assert.ok(!out.fallback);
});

/* ── 1b. the deadline is wired into the proxy path ─────────────────────────── */

test("init: PROXY_TIMEOUT_MS is a named constant ABOVE the proxy's own upstream budget", () => {
  const m = /^\s*var PROXY_TIMEOUT_MS = (\d+);/m.exec(INIT);
  assert.ok(m, "modA-llm-init.js must declare PROXY_TIMEOUT_MS");
  const client = Number(m[1]);
  const b = /const TOTAL_BUDGET_MS = ([\d_]+);/.exec(HANDLER);
  assert.ok(b, "proxy/src/handler.js no longer declares TOTAL_BUDGET_MS — re-point this check");
  const budget = Number(b[1].replace(/_/g, ""));
  assert.ok(client > budget,
    `client deadline ${client} ms must exceed the proxy's ${budget} ms upstream budget, or the client ` +
    "abandons replies the proxy is still entitled to send");
  const code = INIT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/mg, "");
  assert.equal((code.match(new RegExp("\\b" + client + "\\b", "g")) || []).length, 1,
    "the value is spelled once, in the constant — no inline copy");
});

test("init: the WHOLE proxy turn — token, request, body — runs inside withDeadline(…, PROXY_TIMEOUT_MS)", () => {
  const call = fnOf(INIT, "_proxyCall", 900);
  assert.match(call, /return window\.modALLMBridge\.withDeadline\(function \(signal\) \{\s*return _proxyRequest\(user, body, signal\);\s*\}, PROXY_TIMEOUT_MS\);/);
  assert.ok(!/getIdToken\(\)/.test(call.slice(0, call.indexOf("withDeadline"))),
    "the ID-token fetch must be INSIDE the deadline — a stalled token refresh hangs the turn just as well");
  const req = fnOf(INIT, "_proxyRequest", 1600);
  assert.match(req, /user\.getIdToken\(\)/);
  assert.match(req, /signal: signal \|\| undefined/, "the fetch is given the deadline's signal, so it is aborted");
  assert.match(req, /r\.json\(\)/, "the body parse is inside the same chain, so a stalled body is bounded too");
  assert.equal(typeof loadBridge().modALLMBridge.withDeadline, "function", "the bridge exports the helper");
});

/* ── 2. the waiting cue (DOM behaviour: tests-e2e/modA-chat-wait.spec.js) ──── */

test("init: the dots start AFTER submit() persists the question, and stop on every settle path", () => {
  const f = fnOf(INIT, "_onSubmit", 2600);
  const submitAt = f.indexOf("var turn = bridge.submit(text);");
  const startAt = f.indexOf("_startWaiting(askedId);");
  assert.ok(submitAt > 0 && startAt > submitAt,
    "submit() renders the question's bubble synchronously; the dots must go BELOW it");
  assert.match(f, /turn\.then\(function \(res\) \{\s*_stopWaiting\(\);/, "success and fallback");
  assert.match(f, /\.catch\(function \(err\) \{\s*_stopWaiting\(\);/, "error");
  assert.match(f, /_setStatus\(statusEl, _thinkingFor\(askedId\), "pending"\);/,
    "the status names who was ASKED, and is marked pending so the counter may append to it");
});

test("init: the dots come down before this client writes the reply, and on destroy()", () => {
  const at = INIT.indexOf("persistTurn: function (role, content, characterId, slot) {");
  assert.ok(at > 0);
  assert.match(INIT.slice(at, at + 200), /if \(role === "assistant"\) _stopWaiting\(\);/,
    "a local write renders the reply through child_added at once — the dots must already be gone");
  assert.match(fnOf(INIT, "destroy", 300), /_stopWaiting\(\);/,
    "a panel torn down mid-wait must not keep a ticking interval");
});

test("init: stopping clears the interval and removes both the dots and the counter", () => {
  const stop = fnOf(INIT, "_stopWaiting", 500);
  assert.match(stop, /clearInterval\(w\.timer\);/);
  assert.match(stop, /w\.bubble\.parentNode\.removeChild\(w\.bubble\)/);
  assert.match(stop, /\.moda-chat-elapsed/);
});

test("init: the dots are aria-hidden and not a bubble; the counter is aria-hidden and only joins a PENDING line", () => {
  const start = fnOf(INIT, "_startWaiting", 900);
  assert.match(start, /_ce\("div", \{ "class": "moda-chat-typing", "aria-hidden": "true" \}\)/);
  assert.ok(!/moda-chat-bub/.test(start), "specs and the closed-session guard count .moda-chat-bub — the dots must not be one");
  assert.match(start, /_threadEl\(id\)/, "in the thread of the character who was asked");
  const tick = fnOf(INIT, "_tickWaiting", 1000);
  assert.match(tick, /if \(ms < w\.hintAfter \|\| statusEl\.dataset\.kind !== "pending"\) return;/,
    "a refused write or a closed session owns the line — no counter appended to it");
  assert.match(tick, /"aria-hidden": "true"/,
    "the status is a polite live region: a per-second number would be re-announced every second");
  assert.match(INIT, /var WAIT_HINT_AFTER_MS = 5000;/);
  assert.match(INIT, /var WAIT_TICK_MS = 1000;/);
});

test("init: a turn landing in the waited-on thread keeps the dots below it", () => {
  const child = fnOf(INIT, "_onChatChild", 1400);
  assert.match(child, /_renderTurn\(_threadEl\(who\), t\.role, t\.content, fresh && who === activeId\);\s*_keepWaitingLast\(_threadEl\(who\)\);/);
});

test("css: the dots live in room.css with an animation, still dots under reduced motion, tokens only", () => {
  const start = ROOM_CSS.indexOf("/* ── Waiting for a reply");
  assert.ok(start > 0, "the waiting block must be in room.css, beside the chat it styles");
  const block = ROOM_CSS.slice(start, ROOM_CSS.indexOf(".moda-chat-form {", start));
  assert.match(block, /\.moda-chat-typing \{/);
  assert.match(block, /\.moda-chat-typing-dot \{[^}]*animation: moda-typing /);
  assert.match(block, /@keyframes moda-typing/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*\.moda-chat-typing-dot \{ animation: none;/);
  assert.ok(!/\.moda-chat-typing/.test(STYLE_CSS), "room-only styles stay out of the eager style.css (perf budget)");

  const noComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(noComments), "no raw hex — tokens.css owns colour");
  assert.ok(!/\b\d+px\b/.test(noComments), "no px literals — spacing and radii come from tokens");
  for (const m of noComments.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
    assert.ok(TOKENS.includes(m[1] + ":"), m[1] + " must exist in tokens.css (an unknown custom property is silently dropped)");
  }
});
