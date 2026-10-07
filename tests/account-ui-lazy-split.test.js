/* tests/account-ui-lazy-split.test.js
 *
 * The account screens — the sign-in view, the account dialog, the profile-setup
 * save — are in the lazy account-ui.js, fetched by CanamedLoader.ensureAccountUI()
 * the first time one of them is asked for. This file holds what must stay true
 * of the two files as TEXT for that split to be safe:
 *   1. script.js keeps no copy, or the bytes come back with every test green;
 *   2. no top-level name is declared in two classic scripts (they share one
 *      scope: the second declaration is a SyntaxError that fires only when the
 *      chunk is evaluated, on the click);
 *   3. script.js names a function of the chunk ONLY inside accountUI()'s
 *      callbacks — anywhere else is a ReferenceError for a visitor who has not
 *      fetched it;
 *   4. the loader, the service worker and the perf budget know the file.
 *
 * What the code DOES — the wait, a click repeated during it, a fetch that
 * fails, an account that changes meanwhile — is executed in
 * tests/account-dialog-state.test.js (section J), and in a browser by
 * tests-e2e/account-ui-lazy.spec.js.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
/* Read as LF: a Windows checkout has core.autocrlf=true, and `.` does not
   cross a "\r". */
const read = (...p) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read(PLATFORM, "script.js");
const CHUNK = read(PLATFORM, "account-ui.js");
const LOADER = read(PLATFORM, "script-loader.js");
const SW = read(PLATFORM, "sw.js");
const INDEX = read(PLATFORM, "index.html");
const PERF = read(__dirname, "..", "tests-e2e", "perf.spec.js");

/* The names a classic script declares at top level. */
function declared(src) {
  return [...src.matchAll(/^(?:async\s+)?(?:function\*?|let|const|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}
const CHUNK_NAMES = declared(CHUNK);

/* What moved, by name: a list, so that a function quietly moved BACK is a
   failure here rather than a silent undoing of the reclaim. */
const MOVED = ["authErrorMessage", "signInWithProvider", "scorePassword", "wireEmailAuthForm", "signInWithEmail",
  "signUpWithEmail", "signInDone", "profileUpdatesForRole", "profileSetupSubmit", "openAccountDialog",
  "loadHistoryForDialog", "accountSaveBtn", "accountDelete"];

test("the account screens are declared in account-ui.js and nowhere in script.js", () => {
  const eager = new Set(declared(SCRIPT));
  for (const name of MOVED) {
    assert.ok(CHUNK_NAMES.includes(name), name + " must be declared in account-ui.js");
    assert.ok(!eager.has(name), name + " is declared in script.js: the reclaim is undone, or it is declared twice");
  }
  assert.ok(CHUNK_NAMES.includes("wireAccountChunk"), "the chunk must wire its own controls");
});

test("what runs at load, at join and on a change of account stays in script.js", () => {
  /* The other side of the cut. Each of these is called with no click: by the
     auth-state handler, by the join, or by the reset on a change of uid. In
     the chunk, the first visitor who had not fetched it would get a
     ReferenceError — or, behind a typeof, a reset that silently does nothing. */
  const eager = new Set(declared(SCRIPT));
  for (const name of ["ensureSignedIn", "handleAuthStateChange", "resetAccountUI", "clearSignInForm",
    "closeAccountDialog", "_historyListenerRef", "_anonShown", "_joinFill", "loadProfile", "saveProfile",
    "pushSessionToHistory", "populateProfileSelects", "paintUserChip", "applyProfileToJoinForm",
    "setRoleRadio", "applyProfileRoleVisibility", "accountSignOut", "wireAccountUI"]) {
    assert.ok(eager.has(name), name + " must be declared in script.js");
    assert.ok(!CHUNK_NAMES.includes(name), name + " must not be declared in account-ui.js");
  }
});

test("no top-level name of account-ui.js is declared by another script of the page", () => {
  /* Every script the page can load beside it: the eager ones index.html names
     and every chunk the loader addresses. */
  const others = new Set(["script.js"]);
  for (const m of INDEX.matchAll(/<script\b[^>]*\bsrc="\/?([\w.-]+\.js)\?v=/g)) others.add(m[1]);
  for (const m of LOADER.matchAll(/\bv\("([\w.-]+\.js)"\)/g)) others.add(m[1]);
  others.delete("account-ui.js");
  assert.ok(others.size > 25, "only " + others.size + " scripts found: the two patterns above have stopped matching");
  assert.ok(others.has("data-rights.js") && others.has("script-loader.js"), "premise");
  for (const f of others) {
    const theirs = new Set(declared(read(PLATFORM, f)));
    const both = CHUNK_NAMES.filter((n) => theirs.has(n));
    assert.deepStrictEqual(both, [], "declared in both account-ui.js and " + f + ": " + both.join(", "));
  }
});

/* script.js without its comments, position for position. Two regexes are not a
   parser, so the result is COMPILED: had they eaten code, or left half a
   comment behind, this fails instead of quietly searching less of the file. */
const CODE = (() => {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const out = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;{}),])\/\/.*$/mg, (m, a) => a + blank(m.slice(a.length)));
  assert.doesNotThrow(() => new vm.Script(out), "script.js no longer compiles with its comments blanked");
  assert.strictEqual(out.length, SCRIPT.length);
  return out;
})();

/* The top-level function of script.js that the code at `at` belongs to: the
   last one declared before it. (Top-level code between two functions is
   attributed to the one above, which the test below then refuses as well.) */
const TOP = [...CODE.matchAll(/^function ([A-Za-z_$][\w$]*)\(/gm)].map((m) => ({ name: m[1], at: m.index }));
function enclosing(at) {
  let found = "(before any function)";
  for (const f of TOP) { if (f.at <= at) found = f.name; else break; }
  return found;
}

test("script.js names a function of the chunk only inside accountUI()'s callbacks", () => {
  /* Where the chunk is named, and by whom. Each of these four is a function
     whose every use of the chunk is a callback handed to accountUI() (asserted
     below), or accountUI() itself asking whether the chunk is in. */
  const uses = {};
  for (const name of CHUNK_NAMES) {
    for (const m of CODE.matchAll(new RegExp("(?<![\\w$.])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g"))) {
      (uses[name] = uses[name] || new Set()).add(enclosing(m.index));
    }
  }
  const found = Object.fromEntries(Object.keys(uses).sort().map((k) => [k, [...uses[k]].sort()]));
  assert.deepStrictEqual(found, {
    authErrorMessage: ["showAuthError"],
    openAccountDialog: ["openAccount"],
    profileSetupSubmit: ["submitProfileSetup"],
    wireAccountChunk: ["accountUI"]
  });

  const body = (name) => {
    const a = TOP.find((f) => f.name === name).at;
    const next = TOP.find((f) => f.at > a);
    return CODE.slice(a, next ? next.at : CODE.length);
  };
  assert.match(body("showAuthError"), /accountUI\(null, \(\) => splashHintErr\(hint, authErrorMessage\(e\)\),/);
  assert.match(body("openAccount"), /accountUI\("dialog", \(\) => openAccountDialog\(\),/);
  assert.match(body("submitProfileSetup"), /accountUI\("setup", \(\) => profileSetupSubmit\(\),/);
  /* accountUI() itself: `typeof` only, which is safe on a name not declared yet. */
  const probes = [...body("accountUI").matchAll(/(\w+)?\s*wireAccountChunk/g)].map((m) => m[1]);
  assert.ok(probes.length >= 2 && probes.every((p) => p === "typeof"),
    "accountUI() may only ask `typeof wireAccountChunk`, never call or read it");
});

test("the chunk declares no top-level `let` or `const` that script.js could read too early", () => {
  /* `typeof` on a function not declared yet is "undefined"; on a `let` whose
     script threw before reaching it, it THROWS. So script.js probes a function,
     and the chunk's one binding is its own. */
  const bindings = [...CHUNK.matchAll(/^(?:let|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.deepStrictEqual(bindings, ["_accountChunkWired"]);
  assert.ok(!new RegExp("(?<![\\w$])_accountChunkWired(?![\\w$])").test(CODE), "script.js must not read the chunk's flag");
});

test("the chunk wires its own controls when it is evaluated, whoever loaded it", () => {
  // The last statement of the file, at top level: a chunk that is in is a chunk that is wired.
  assert.match(CHUNK.trimEnd(), /\n\}\n\nwireAccountChunk\(\);$/);
});

test("account-ui.js is not an eager <script> in index.html, and no page other than the loader asks for it", () => {
  assert.doesNotMatch(INDEX, /account-ui\.js/);
  assert.doesNotMatch(SCRIPT, /account-ui\.js["'?]/, "script.js must go through CanamedLoader, which versions the address");
});

test("the loader exposes ensureAccountUI(), versions the address, and never prefetches it", () => {
  const at = LOADER.indexOf("function ensureAccountUI()");
  assert.ok(at > 0, "script-loader.js must declare ensureAccountUI()");
  const fn = LOADER.slice(at, LOADER.indexOf("\n  }", at));
  assert.match(fn, /var src = v\("account-ui\.js"\);/, "the address must go through v(): root-absolute, with ?v=");
  assert.match(fn, /return loadScript\(src\)\.catch\(function \(e\) \{ inflight\.delete\(src\); throw e; \}\);/,
    "a fetch that failed must be forgotten, so that the next click asks again");
  assert.match(LOADER, /^\s*ensureAccountUI,\s*$/m, "must be on the public CanamedLoader namespace");
  const idle = LOADER.slice(LOADER.indexOf("function prefetchAfterIdle()"));
  assert.ok(idle.length > 200, "could not find prefetchAfterIdle()");
  assert.doesNotMatch(idle, /ensureAccountUI|account-ui/, "the front page must not fetch it in its idle time");
  assert.strictEqual((LOADER.match(/ensureAccountUI\(\)/g) || []).length, 1,
    "nothing in the loader may call it: only its declaration");
});

test("account-ui.js is precached by the service worker and listed as lazy in the perf budget", () => {
  assert.match(SW, /^\s*"\/account-ui\.js",$/m, "sw.js SHELL_ASSETS must list it");
  const a = PERF.indexOf("const LAZY_CHUNKS");
  const lazy = PERF.slice(a, PERF.indexOf("])", a));
  assert.match(lazy, /"account-ui\.js"/, "perf.spec.js LAZY_CHUNKS must list it");
});

test("the shell-version guard watches the new file", () => {
  /* tests/shell-version-bump.test.js derives its watched set from these two
     patterns. Asserted on the patterns it uses, so that a change of spelling
     here that it would not see is caught here. */
  assert.ok([...LOADER.matchAll(/\bv\(\s*"([^"]+)"\s*\)/g)].some((m) => m[1] === "account-ui.js"));
  const manifest = SW.match(/SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/);
  assert.ok(manifest && /"\/account-ui\.js"/.test(manifest[1]));
});
