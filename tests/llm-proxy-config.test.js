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

function connectSrc() {
  const html = read("index.html");
  const m = /connect-src([^;]*);/.exec(html);
  assert.ok(m, "index.html has no connect-src directive in its CSP");
  return m[1].split(/\s+/).map(s => s.trim()).filter(Boolean);
}

test("the shipped default leaves the proxy OFF", () => {
  /* The default must stay null: a URL committed here would point every
   * deployment of this public repo at one person's endpoint. */
  assert.equal(configuredProxy(), null,
    "CANAMED_LLM_PROXY must ship as null — configure it per deployment, never in git");
});

test("if a proxy IS configured, its origin is in the CSP connect-src", () => {
  const cfg = configuredProxy();
  if (!cfg || !cfg.url) return;   // inert while off — see the header

  const origin = new URL(cfg.url).origin;
  const sources = connectSrc();
  const allowed = sources.some((s) => {
    if (s === origin) return true;
    // Wildcard host form, e.g. https://*.workers.dev
    if (s.startsWith("https://*.")) {
      const suffix = s.slice("https://*".length);     // ".workers.dev"
      return new URL(cfg.url).hostname.endsWith(suffix.slice(1)) ||
             origin.endsWith(suffix);
    }
    return false;
  });
  assert.ok(allowed,
    `CANAMED_LLM_PROXY points at ${origin}, which no connect-src source in ` +
    `index.html permits. The browser will block every chat request and the ` +
    `room will silently get the stub patient. Add ${origin} to connect-src.`);
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
