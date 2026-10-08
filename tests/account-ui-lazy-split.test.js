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

/* A script with its comments blanked, position for position. A scanner, not a
   parser: it knows the two comment forms and what can hide one (strings,
   template literals, regex literals). Whatever it is used on is COMPILED
   afterwards, so a file it misreads fails here instead of being searched less. */
const REGEX_AFTER = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await"]);
function withoutComments(src) {
  const out = src.split("");
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  const stack = [];   // "`" inside a template's text; a number (brace depth) inside one of its ${ }
  const n = src.length;
  let i = 0, last = "", word = "";
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (stack[stack.length - 1] === "`") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); last = "`"; word = ""; i++; continue; }
      if (c === "$" && d === "{") { stack.push(0); last = "{"; word = ""; i += 2; continue; }
      i++; continue;
    }
    if (c === "/" && d === "/") { let j = i; while (j < n && src[j] !== "\n") j++; blank(i, j); i = j; continue; }
    if (c === "/" && d === "*") { let j = src.indexOf("*/", i + 2); j = j === -1 ? n : j + 2; blank(i, j); i = j; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      i = j + 1; last = c; word = ""; continue;
    }
    if (c === "`") { stack.push("`"); i++; continue; }
    /* A slash starts a regex where a value cannot end: after an operator, an
       opening bracket, a closing brace, or a keyword such as `return`. */
    if (c === "/" && (last === "" || "(,=:[!&|?{};+-*%<>~^}".includes(last) ||
        (/[\w$]/.test(last) && REGEX_AFTER.has(word)))) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n" && (cls || src[j] !== "/")) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      i = j; last = "/"; word = ""; continue;
    }
    if (typeof stack[stack.length - 1] === "number") {
      if (c === "{") stack[stack.length - 1]++;
      else if (c === "}" && stack[stack.length - 1]-- === 0) { stack.pop(); i++; continue; }
    }
    if (/[\w$]/.test(c)) { word = (/[\w$]/.test(src[i - 1] || "") ? word : "") + c; last = c; }
    else if (!/\s/.test(c)) { last = c; word = ""; }
    i++;
  }
  return out.join("");
}

/* Every script the platform serves from its top folder, the chunk aside: what
   a visitor's page can run beside it, whichever page that is. */
const SERVED = fs.readdirSync(PLATFORM).filter((f) => /\.js$/.test(f) && f !== "account-ui.js").sort();
const CODE = Object.fromEntries(SERVED.map((f) => {
  const src = read(PLATFORM, f);
  const out = withoutComments(src);
  assert.strictEqual(out.length, src.length, f);
  assert.doesNotThrow(() => new vm.Script(out, { filename: f }), f + " no longer compiles with its comments blanked");
  return [f, out];
}));
const CHUNK_CODE = withoutComments(CHUNK);
assert.doesNotThrow(() => new vm.Script(CHUNK_CODE), "account-ui.js no longer compiles with its comments blanked");

/* The function the code at `at` belongs to: the last one declared before it, at
   any depth. (Code that follows a function's end is attributed to that
   function, which the tests below then refuse as well.) */
function enclosing(code, at) {
  let found = "(before any function)";
  for (const m of code.matchAll(/^[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    if (m.index > at) break;
    found = m[1];
  }
  return found;
}
/* Where `names` are used in `code`, as { name: [function, ...] }. `x.name` is a
   property of something else — unless x is the global object, which is the
   same name by another spelling. */
function usesOf(code, names) {
  const uses = {};
  for (const name of names) {
    for (const m of code.matchAll(new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g"))) {
      const before = code.slice(Math.max(0, m.index - 16), m.index);
      if (/\.\s*$/.test(before) && !/(?:^|[^\w$.])(?:window|globalThis|self)\s*\.\s*$/.test(before)) continue;
      (uses[name] = uses[name] || new Set()).add(enclosing(code, m.index));
    }
  }
  return Object.fromEntries(Object.keys(uses).sort().map((k) => [k, [...uses[k]].sort()]));
}
/* A top-level function of script.js, from its declaration to the next one. */
function body(name) {
  const code = CODE["script.js"];
  const top = [...code.matchAll(/^function ([A-Za-z_$][\w$]*)\(/gm)];
  const k = top.findIndex((m) => m[1] === name);
  assert.notStrictEqual(k, -1, name + "() is not a top-level function of script.js");
  return code.slice(top[k].index, k + 1 < top.length ? top[k + 1].index : code.length);
}

test("no served script names the chunk's functions, except where the chunk is known to be in", () => {
  /* Every top-level script the platform serves is searched, not script.js
     alone: any of them can run in a page that has not fetched the chunk. */
  assert.ok(SERVED.length > 40 && SERVED.includes("script.js") && SERVED.includes("data-rights.js"),
    "only " + SERVED.length + " scripts found in the platform's folder");
  const found = {};
  for (const f of SERVED) {
    const uses = usesOf(CODE[f], CHUNK_NAMES);
    if (Object.keys(uses).length) found[f] = uses;
  }
  assert.deepStrictEqual(found, {
    /* script.js: four functions, each of whose uses is a callback handed to
       accountUI() — or accountUI() itself asking whether the chunk is in. */
    "script.js": {
      authErrorMessage: ["showAuthError"],
      openAccountDialog: ["openAccount"],
      profileSetupSubmit: ["submitProfileSetup"],
      wireAccountChunk: ["accountUI"]
    },
    /* The loader asks, once the file has loaded, whether it declared anything. */
    "script-loader.js": { wireAccountChunk: ["ensureAccountUI"] },
    /* THE ONE EXCEPTION: another chunk calling into this one. deleteMyAccount()
       puts an auth error into words when the sign-in account cannot be deleted.
       It is safe only because of who calls it, which is asserted below. */
    "data-rights.js": { authErrorMessage: ["deleteMyAccount"] }
  });

  assert.match(body("showAuthError"), /accountUI\(null, \(\) => splashHintErr\(hint, authErrorMessage\(e\)\),/);
  assert.match(body("openAccount"), /accountUI\("dialog", \(\) => openAccountDialog\(\),/);
  assert.match(body("submitProfileSetup"), /accountUI\("setup", \(\) => profileSetupSubmit\(\),/);
  /* `typeof` only, in both places that ask: it is safe on a name not declared yet. */
  const loaderFn = CODE["script-loader.js"].slice(CODE["script-loader.js"].indexOf("function ensureAccountUI()"));
  for (const [where, code] of [["accountUI()", body("accountUI")],
    ["ensureAccountUI()", loaderFn.slice(0, loaderFn.indexOf("\n  }") + 4)]]) {
    const probes = [...code.matchAll(/(\w+)?\s*wireAccountChunk/g)].map((m) => m[1]);
    assert.ok(probes.length >= 1 && probes.every((p) => p === "typeof"),
      where + " may only ask `typeof wireAccountChunk`, never call or read it");
  }
});

test("deleteMyAccount() is called from the chunk and from nowhere else", () => {
  /* What makes data-rights.js's call to authErrorMessage() safe: the chunk is
     in whenever deleteMyAccount() runs, because accountDelete() — declared in
     the chunk — is the one thing that calls it. */
  const callers = {};
  for (const f of SERVED) {
    const uses = usesOf(CODE[f], ["deleteMyAccount"]);
    if (uses.deleteMyAccount) callers[f] = uses.deleteMyAccount;
  }
  assert.deepStrictEqual(callers, { "data-rights.js": ["deleteMyAccount"] },
    "outside the chunk, deleteMyAccount may appear only where it is declared");
  assert.deepStrictEqual(usesOf(CHUNK_CODE, ["deleteMyAccount"]), { deleteMyAccount: ["accountDelete"] });
});

test("the chunk declares no top-level `let` or `const` that another script could read too early", () => {
  /* `typeof` on a function not declared yet is "undefined"; on a `let` whose
     script threw before reaching it, it THROWS. So the page probes a function,
     and the chunk's one binding is its own (the search above covers it: it is
     one of the chunk's names). */
  const bindings = [...CHUNK.matchAll(/^(?:let|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.deepStrictEqual(bindings, ["_accountChunkWired"]);
  assert.ok(CHUNK_NAMES.includes("_accountChunkWired"), "premise: the search above looks for it");
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
  /* What it does with a fetch that failed, or that brought something else than
     the file, is executed in tests/account-dialog-state.test.js (section J). */
  assert.match(fn, /return loadScript\(src\)\.then\(/);
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
