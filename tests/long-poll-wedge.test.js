/* tests/long-poll-wedge.test.js
 *
 * Regression coverage for the 2026-05-30 "stuck on Checking…" wedge.
 *
 * Root cause (diagnosed live against the deployed site): the Firebase JS SDK
 * caches `firebase:previous_websocket_failure` in localStorage after a single
 * transient WebSocket hiccup, then permanently prefers the long-poll transport
 * for that origin. Under RTDB App Check *enforcement*, long-poll returns HTTP
 * 503 for App-Check-passing requests (the WebSocket transport works), so a
 * wedged client can never establish a realtime connection. Every `once`/`on`
 * read then hangs forever WITHOUT rejecting, so sessionStatus()'s `.catch`
 * never fires and the splash sits on "Checking…" indefinitely.
 *
 * Two defenses, both asserted here:
 *   1. dbInit() clears the sticky flag BEFORE firebase.database() is built, so
 *      the SDK re-attempts the working WebSocket transport.
 *   2. sessionStatus() races the read against a timeout and returns a
 *      distinguishable { unreachable: true } instead of hanging, and the
 *      splash + auto-resume surface a real connectivity error + retry.
 *
 * script.js can't be required in Node (depends on window/document/firebase),
 * so the pure flag-clearing helper is extracted and run in a vm sandbox; the
 * wiring is asserted structurally on the file text.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

// ---- Extract _clearStickyLongPollFlag's source for behavioural testing ----
function extractFn(name) {
  const start = SCRIPT.indexOf("function " + name);
  assert.ok(start !== -1, "could not find function " + name + " in script.js");
  // Walk braces from the first "{" after the signature to find the body end.
  const open = SCRIPT.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SCRIPT.length; i++) {
    if (SCRIPT[i] === "{") depth++;
    else if (SCRIPT[i] === "}") { depth--; if (depth === 0) return SCRIPT.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces extracting " + name);
}

function makeLocalStorageMock(initial) {
  const store = Object.assign({}, initial);
  return {
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] ?? null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store
  };
}

function loadClearFn(localStorageMock) {
  const src = extractFn("_clearStickyLongPollFlag");
  const sandbox = { localStorage: localStorageMock };
  vm.createContext(sandbox);
  vm.runInContext(src + "\n_clearStickyLongPollFlag;", sandbox);
  return vm.runInContext("_clearStickyLongPollFlag", sandbox);
}

test("_clearStickyLongPollFlag removes the sticky websocket-failure flag(s)", () => {
  const ls = makeLocalStorageMock({
    "firebase:previous_websocket_failure": "true",
    "canamed_session": "abc-def",
    "firebase:previous_websocket_failure:https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app": "true"
  });
  const fn = loadClearFn(ls);
  const cleared = fn();
  assert.strictEqual(cleared, 2, "both websocket-failure keys should be cleared");
  assert.strictEqual(ls.getItem("firebase:previous_websocket_failure"), null);
  assert.strictEqual(
    ls.getItem("firebase:previous_websocket_failure:https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app"),
    null);
  // unrelated keys are left untouched
  assert.strictEqual(ls.getItem("canamed_session"), "abc-def");
});

test("_clearStickyLongPollFlag is a no-op when no flag is present", () => {
  const ls = makeLocalStorageMock({ "canamed_session": "abc-def" });
  const fn = loadClearFn(ls);
  assert.strictEqual(fn(), 0);
  assert.strictEqual(ls.getItem("canamed_session"), "abc-def");
});

test("_clearStickyLongPollFlag never throws when localStorage throws", () => {
  const hostile = {
    get length() { throw new Error("storage disabled"); },
    key() { throw new Error("storage disabled"); },
    removeItem() { throw new Error("storage disabled"); }
  };
  const fn = loadClearFn(hostile);
  assert.doesNotThrow(() => assert.strictEqual(fn(), 0));
});

// ---------------------- Structural wiring assertions ----------------------

test("dbInit clears the sticky long-poll flag BEFORE building firebase.database()", () => {
  const clearIdx = SCRIPT.indexOf("_clearStickyLongPollFlag();");
  const dbIdx = SCRIPT.indexOf("db = firebase.database();");
  assert.ok(clearIdx !== -1, "dbInit must call _clearStickyLongPollFlag()");
  assert.ok(dbIdx !== -1, "dbInit must build firebase.database()");
  assert.ok(clearIdx < dbIdx,
    "the flag must be cleared BEFORE firebase.database() is constructed, " +
    "otherwise the SDK has already chosen the broken long-poll transport");
});

test("sessionStatus races the read against a timeout and reports unreachable", () => {
  const fnIdx = SCRIPT.indexOf("function sessionStatus(");
  assert.ok(fnIdx !== -1, "sessionStatus must exist");
  const body = SCRIPT.slice(fnIdx, fnIdx + 1400);
  assert.match(body, /SESSION_STATUS_TIMEOUT_MS/,
    "sessionStatus must bound the read with a timeout constant");
  assert.match(body, /Promise\.race/,
    "sessionStatus must race the read against the timeout");
  assert.match(body, /unreachable:\s*true/,
    "the timeout / error path must yield a distinguishable unreachable result");
});

test("splash tryEnter surfaces the unreachable error instead of 'no session matches'", () => {
  // The unreachable guard must come BEFORE the !status.exists branch so a
  // connectivity failure is never mislabelled as a bad code.
  const guardIdx = SCRIPT.indexOf("if (status.unreachable)");
  const noMatchIdx = SCRIPT.indexOf("No session matches this code");
  assert.ok(guardIdx !== -1, "tryEnter must check status.unreachable");
  assert.ok(noMatchIdx !== -1, "tryEnter must still have the no-match branch");
  assert.ok(guardIdx < noMatchIdx,
    "the unreachable guard must precede the no-match branch");
  assert.match(SCRIPT, /splash\.enter\.unreachable/,
    "the unreachable message must use the i18n key splash.enter.unreachable");
});

test("auto-resume shows the splash (not a blank screen) and keeps the code when unreachable", () => {
  const idx = SCRIPT.indexOf("canamed_db_unreachable");
  assert.ok(idx !== -1, "auto-resume must flag DB-unreachable for the splash hint");
  // The unreachable branch must NOT remove canamed_session (the code may be
  // valid) — assert the removeItem("canamed_session") only lives in the stale
  // branch, i.e. it is not the action taken on the unreachable path.
  const block = SCRIPT.slice(SCRIPT.indexOf("} else if (status.unreachable) {"),
                            SCRIPT.indexOf("} else if (status.unreachable) {") + 700);
  assert.doesNotMatch(block, /removeItem\("canamed_session"\)/,
    "the unreachable path must preserve the stored session code");
  assert.match(block, /showSplash\(\)/,
    "the unreachable path must show the splash so the user is never stranded");
});

test("splash.enter.unreachable is translated in fr and ja locales", () => {
  const fr = fs.readFileSync(path.join(ROOT, "locales", "fr.js"), "utf8");
  const ja = fs.readFileSync(path.join(ROOT, "locales", "ja.js"), "utf8");
  assert.match(fr, /"splash\.enter\.unreachable":/, "fr locale must define the key");
  assert.match(ja, /"splash\.enter\.unreachable":/, "ja locale must define the key");
});
