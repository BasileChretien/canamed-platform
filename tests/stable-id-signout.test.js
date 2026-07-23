/* tests/stable-id-signout.test.js
 *
 * Phase-4e compliance gap 4: `canamed_stable_id` survived sign-out.
 *
 * handleAuthStateChange() binds stableId to currentUser.uid for a non-anonymous
 * user and persists it to localStorage. accountSignOut() cleared neither, so the
 * key kept holding the SIGNED-OUT account's Firebase uid and the next person on
 * that browser inherited it — their research writes were stamped with the
 * previous account's durable identifier.
 *
 * Unlike leaveAndReload/switchSession (which clear the key then reload), the
 * account dialog stays on the page, so clearing localStorage alone would leave
 * the stale uid live in the in-memory `stableId`. These tests EXECUTE the real
 * mintStableId/resetStableId source in a sandbox rather than just grepping for
 * it, so they fail if the re-mint half is dropped.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

/* Slice one top-level `function name(...) { ... }` out of the source by
 * brace-matching from its declaration. */
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.notStrictEqual(start, -1, "could not find function " + name);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces in " + name);
}

/* A sandbox holding just enough of the module scope for the two helpers. */
function makeSandbox(initialStored, initialInMemory) {
  const store = new Map();
  if (initialStored !== undefined) store.set("canamed_stable_id", initialStored);
  const sandbox = {
    stableId: initialInMemory,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); }
    },
    crypto: {
      getRandomValues(buf) {
        for (let i = 0; i < buf.length; i++) buf[i] = (i * 37 + 11) % 256;
        return buf;
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    'const STABLE_ID_KEY = "canamed_stable_id";\n' +
    extractFn(SCRIPT, "mintStableId") + "\n" +
    extractFn(SCRIPT, "resetStableId") + "\n",
    sandbox
  );
  sandbox._store = store;
  return sandbox;
}

test("resetStableId replaces a signed-out uid in BOTH localStorage and memory", () => {
  const UID = "firebase-uid-of-the-signed-out-account";
  const s = makeSandbox(UID, UID);

  vm.runInContext("resetStableId();", s);

  assert.notStrictEqual(s.stableId, UID,
    "the in-memory stableId must not keep the signed-out account's uid");
  assert.notStrictEqual(s._store.get("canamed_stable_id"), UID,
    "the persisted stableId must not keep the signed-out account's uid");
  assert.strictEqual(s.stableId, s._store.get("canamed_stable_id"),
    "memory and storage must agree after the reset");
});

test("the replacement is a freshly minted anonymous id, not an empty value", () => {
  const s = makeSandbox("some-uid", "some-uid");
  vm.runInContext("resetStableId();", s);
  // Same shape as the module-init mint: "s" + 8 random bytes as hex.
  assert.match(s.stableId, /^s[0-9a-f]{16}$/,
    "reset must mint a well-formed anonymous stableId");
});

test("mintStableId persists what it returns", () => {
  const s = makeSandbox(undefined, null);
  const id = vm.runInContext("mintStableId();", s);
  assert.match(id, /^s[0-9a-f]{16}$/);
  assert.strictEqual(s._store.get("canamed_stable_id"), id);
});

test("a disabled localStorage does not break the reset (private mode)", () => {
  const s = makeSandbox("some-uid", "some-uid");
  vm.runInContext(
    "localStorage = { getItem(){ throw new Error('denied'); }," +
    " setItem(){ throw new Error('denied'); }," +
    " removeItem(){ throw new Error('denied'); } };",
    s
  );
  assert.doesNotThrow(() => vm.runInContext("resetStableId();", s),
    "storage failures are best-effort and must not throw");
  assert.match(s.stableId, /^s[0-9a-f]{16}$/,
    "the in-memory id must still be replaced when storage is unavailable");
});

test("accountSignOut resets the stableId after the sign-out resolves", () => {
  const fn = extractFn(SCRIPT, "accountSignOut");
  assert.match(fn, /resetStableId\(\)/,
    "accountSignOut must drop the signed-out account's stableId");
  // Inside the .then, not before the await — clearing it on a FAILED sign-out
  // would throw away a still-valid id.
  const thenAt = fn.indexOf(".then");
  assert.ok(thenAt !== -1 && fn.indexOf("resetStableId()") > thenAt,
    "the reset must happen in the success path, after signOut() resolves");
});

test("accountDelete also resets the stableId", () => {
  const fn = extractFn(SCRIPT, "accountDelete");
  assert.match(fn, /resetStableId\(\)/,
    "a deleted account's uid must not linger as this browser's stableId");
});

test("the module-init comment no longer claims signOut() clears the key", () => {
  const head = SCRIPT.slice(0, SCRIPT.indexOf("const STABLE_ID_KEY"));
  assert.ok(!/signOut\(\) removes it/.test(head),
    "the old comment asserted a clear that did not happen — it must not come back");
});
