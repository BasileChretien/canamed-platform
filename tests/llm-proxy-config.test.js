/* llm-proxy-config.test.js
 *
 * Turning on the self-hosted LLM proxy takes TWO edits in two different
 * files: the endpoint in firebase-config.js, and its origin in the
 * Content-Security-Policy in index.html. Do only the first and the browser
 * blocks every request — and because the chat bridge treats ANY failure as
 * "backend unavailable", the room silently gets the stub patient instead of
 * an error. That is the same class of silent degradation as the nine-day
 * uidMembers outage: green everywhere, wrong for every student.
 *
 * So the two are pinned to each other here. The check is INERT while the
 * proxy is off (url null), which is the shipped default — it only has an
 * opinion once someone actually configures an endpoint.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), "utf8");

/* Read the configured value without executing the whole file: firebase-config.js
 * is a browser script full of `window.` assignments. */
function configuredProxy() {
  const src = read("firebase-config.js");
  /* Anchored to LINE START on purpose: the doc comment above the assignment
   * contains a worked example (` *   window.CANAMED_LLM_PROXY = { … }`), and
   * an unanchored pattern matches that instead — reporting the documentation
   * as the live configuration. */
  const m = /^window\.CANAMED_LLM_PROXY\s*=\s*([\s\S]*?);\s*$/m.exec(src);
  assert.ok(m, "firebase-config.js no longer declares window.CANAMED_LLM_PROXY");
  const literal = m[1].trim();
  if (literal === "null") return null;
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  return new Function("return (" + literal + ");").call(sandbox);
}

/* ⚠ THE CSP LIVES IN TWO PLACES, and the one that matters in production is
 * NOT the one in index.html.
 *
 * index.html carries a <meta> CSP as a fallback; firebase.json sets the real
 * Content-Security-Policy RESPONSE HEADER, and a header overrides the meta
 * tag. An earlier version of this file checked only index.html — so it passed
 * while the deployed CSP still blocked the proxy, which would have shown up as
 * every room silently getting the stub patient. That is precisely the failure
 * this test exists to catch, and it walked straight past it.
 *
 * Both surfaces are now returned, and the caller requires the origin in EACH. */
function connectSrcSurfaces() {
  const out = {};
  for (const [label, file] of [["index.html meta", "index.html"],
                               ["firebase.json header", "firebase.json"]]) {
    const m = /connect-src([^;]*);/.exec(read(file));
    assert.ok(m, `${file} has no connect-src directive`);
    out[label] = m[1].split(/\s+/).map(s => s.trim()).filter(Boolean);
  }
  return out;
}

test("a configured proxy URL is https and not a placeholder", () => {
  /* This REPLACED an assertion that CANAMED_LLM_PROXY must ship as `null`, on
   * the reasoning that "a URL committed here would point every deployment of
   * this public repo at one person's endpoint". That premise was wrong:
   * firebase-config.js ALREADY commits this deployment's apiKey, projectId and
   * databaseURL, so the file is deployment-specific by design and the proxy URL
   * belongs alongside them. The URL is also not a secret — it is a public
   * endpoint whose protection is the Firebase-auth check, the roomOf membership
   * check and the origin allowlist, none of which depend on it being unguessable.
   *
   * What IS worth pinning is the shape, because both failure modes below are
   * silent: the chat falls back to the stub patient with nothing in the UI. */
  const cfg = configuredProxy();
  if (cfg === null) return;   // OFF remains a valid state

  assert.ok(cfg.url, "a configured proxy must carry a url");
  const u = new URL(cfg.url);
  assert.equal(u.protocol, "https:",
    "the client sends a Firebase ID token in the Authorization header — never over plaintext");
  assert.ok(!/example|placeholder|REPLACE|<|>/i.test(cfg.url),
    `CANAMED_LLM_PROXY still looks like a placeholder: ${cfg.url}`);
});

test("if a proxy IS configured, its origin is in the CSP connect-src", () => {
  const cfg = configuredProxy();
  if (!cfg || !cfg.url) return;   // inert while off — see the header

  const origin = new URL(cfg.url).origin;
  for (const [label, sources] of Object.entries(connectSrcSurfaces())) {
  const allowed = sources.some((s) => {
    if (s === origin) return true;
    // Wildcard host form, e.g. https://*.workers.dev
    if (s.startsWith("https://*.")) {
      /* KEEP THE DOT. Stripping it made "evilworkers.dev" satisfy
       * "*.workers.dev" — a suffix match that ignores the DNS label boundary,
       * so this would bless a CSP that does not actually permit the
       * configured origin. The SCHEME matters too: an http: URL is blocked by
       * an https: source, and the browser falls back to the stub in silence. */
      const suffix = s.slice("https://*".length);     // ".workers.dev" — dot kept
      const u = new URL(cfg.url);
      return u.protocol === "https:" && u.hostname.endsWith(suffix);
    }
    return false;
  });
  assert.ok(allowed,
    `CANAMED_LLM_PROXY points at ${origin}, which no connect-src source in ` +
    `${label} permits. The browser will block every chat request and the room ` +
    `will silently get the stub patient. Add ${origin} to connect-src there.`);
  }
});

test("if a proxy IS configured, the unsafe-path acknowledgement is explicit", () => {
  const cfg = configuredProxy();
  if (!cfg || !cfg.url) return;
  assert.equal(cfg.acknowledgeUnsafe, true,
    "the proxy path has no App Check; the client requires acknowledgeUnsafe:true " +
    "and will otherwise ignore the endpoint and stay on the stub");
});

test("the client prefers the proxy OVER the callable when one is configured", () => {
  /* The pre-existing endpoint branch was an `else if` after the Functions
   * SDK check, and `fb.functions` being a function says nothing about
   * whether the FUNCTION is deployed. On Spark the SDK loads fine and the
   * function is dead, so that ordering could never reach the proxy: it would
   * always pick the callable, call a 500, and fall back to the stub. */
  const src = read("modA-llm-init.js");
  const proxyBranch = src.indexOf("proxyCfg && proxyCfg.url");
  const callableBranch = src.indexOf('typeof fb.functions === "function"');
  assert.ok(proxyBranch > 0, "modA-llm-init.js does not test window.CANAMED_LLM_PROXY");
  assert.ok(callableBranch > 0, "modA-llm-init.js no longer has the callable branch");
  assert.ok(proxyBranch < callableBranch,
    "the proxy branch must be evaluated BEFORE the Firebase callable branch");
});

test("the proxy path mints a FRESH id token per turn", () => {
  /* A Firebase ID token expires after an hour. setEndpoint()'s headers are
   * captured once, which is exactly why this path goes through setCallable()
   * instead — a static Authorization header works for one session and 401s
   * every one after it. */
  const src = read("modA-llm-init.js");
  const branch = src.slice(src.indexOf("proxyCfg && proxyCfg.url"),
    src.indexOf('} else if (fb && typeof fb.functions === "function") {'));
  assert.match(branch, /getIdToken\(\)/,
    "the proxy wrapper must call getIdToken() inside the per-request path");
  assert.match(branch, /bridge\.setCallable\(/,
    "must wire through setCallable(), not setEndpoint()");
  assert.ok(!/bridge\.setEndpoint\(/.test(branch),
    "setEndpoint() cannot carry roomCode/roomId, so the proxy would refuse every call");
});

test("the proxy path sends the room context the membership check needs", () => {
  const src = read("modA-llm-init.js");
  const branch = src.slice(src.indexOf("proxyCfg && proxyCfg.url"),
    src.indexOf('} else if (fb && typeof fb.functions === "function") {'));
  for (const field of ["roomCode", "roomId", "orgSlug"]) {
    assert.ok(branch.includes(field),
      `the proxy request omits ${field}; the server would refuse every call as "not a member"`);
  }
});

test("the proxy branch requires an INITIALISED Firebase app, not just the SDK", () => {
  /* In LOCAL mode the compat SDK script still loads, so `firebase.auth` IS a
   * function — but `initializeApp()` is never called, and `fb.auth()` then
   * throws "No Firebase App '[DEFAULT]' has been created" SYNCHRONOUSLY.
   *
   * A synchronous throw inside the callable escapes the bridge's promise
   * chain, so its stub-patient `.catch` never runs and the turn gets NO reply
   * at all — strictly worse than the degraded reply the fallback exists to
   * provide. `firebase.apps` is the SDK's own record of initialised apps, so a
   * non-empty array is the honest test. Caught by
   * tests-e2e/modA-chat-controls.spec.js on every browser. */
  const src = read("modA-llm-init.js");
  assert.match(src, /fb\.apps\s*&&\s*fb\.apps\.length\s*>\s*0/,
    "the proxy branch must require firebase.apps.length > 0");

  const branch = src.slice(src.indexOf("proxyCfg && proxyCfg.url"),
    src.indexOf('} else if (fb && typeof fb.functions === "function") {'));
  assert.ok(!/if \(proxyCfg && proxyCfg\.url && proxyCfg\.acknowledgeUnsafe === true &&\s*\n\s*fb && typeof fb\.auth === "function"\) \{/.test(branch),
    "the old SDK-presence-only gate must not come back");
});

test("nothing in the proxy wrapper can throw synchronously", () => {
  /* Belt and braces for the same failure class: the bridge converts a
   * REJECTED promise into the stub patient, but a synchronous throw bypasses
   * that entirely. The wrapper therefore funnels everything through a
   * try/catch that turns any throw into a rejection. */
  const src = read("modA-llm-init.js");
  const wrapper = src.slice(src.indexOf("bridge.setCallable(function (body)"),
    src.indexOf("function _proxyCall(body)"));
  assert.match(wrapper, /try\s*\{/, "the wrapper body must be wrapped in try/catch");
  assert.match(wrapper, /return Promise\.reject\(e\)/,
    "a caught throw must become a rejected promise so the bridge can fall back");
});
