/* tests/account-delete.test.js
 *
 * What deleting an account removes — and the order it removes it in.
 *
 * THE DEFECT: the handler removed `users/<uid>` and then the sign-in account.
 * `scenarios/<uid>` is readable and writable by that uid ONLY, so it was kept
 * for ever with nobody able to reach it; the user's published copies under
 * `sharedScenarios/` stayed on offer under their display name with no owner
 * left to withdraw them. The confirm dialog promised "permanently removes your
 * profile and history" and said session contributions were "no longer linked to
 * your identity" — while pool/<cid>/name still held the name.
 *
 * WHERE THE CODE IS: deleteMyAccount() in the LAZY data-rights.js; script.js
 * keeps accountDelete() as an on-click shim that loads the chunk. Both halves
 * are executed here.
 *
 * These tests EXECUTE the real functions, sliced out of the source, against a
 * fake database that keeps the two behaviours the code depends on: a key-range
 * query, and Firebase's forEach() contract (a truthy return STOPS the walk —
 * so `snap.forEach(c => ids.push(c.key))` silently finds one entry). Grepping
 * the source for the right path strings would pass on either mistake.
 *
 * What a fake CANNOT show is that the rules accept the removal as one update
 * and refuse it whole when one path is refused. That is driven for real in
 * tests-e2e/emulator/account-delete.spec.js.
 *
 * A SECOND DEFECT lives here because it made the first one unreachable:
 * `_historyListenerRef` lost its declaration in #264, so openAccountDialog()
 * threw before showing the dialog. The last tests run that path.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const CHUNK = fs.readFileSync(path.join(P, "data-rights.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");

/* The key-range sentinel, built rather than typed: as a literal it is an
   invisible private-use glyph, and as an escape some tools rewrite it. */
const SENTINEL = String.fromCharCode(0xf8ff);

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

const UID = "uidOwner";
const OTHER = "uidStranger";
const shared = (ownerUid) => ({ ownerUid, scenarioId: "x", bodyJson: "{}" });

/* The tree a deletion runs against. Keys chosen to sit on every edge of the
   selection: two the owner published, one a stranger parked INSIDE the owner's
   key range, and neighbours on both sides of that range. */
function seedStore() {
  return {
    users: { [UID]: { profile: { name: "A" } }, [OTHER]: { profile: { name: "B" } } },
    scenarios: { [UID]: { one: {}, two: {} }, [OTHER]: { theirs: {} } },
    sharedScenarios: {
      [UID + "_one"]: shared(UID),
      [UID + "_two"]: shared(UID),
      [UID + "_squat"]: shared(OTHER),          // in range, not the owner's
      [UID + "x_other"]: shared(UID + "x"),     // a uid that merely STARTS the same
      [OTHER + "_theirs"]: shared(OTHER),
      ["aaa_before"]: shared("aaa")
    }
  };
}

/* A fake RTDB holding just what deleteMyAccount() touches.
     fail:  a step to reject — "list" | "update" | "authDelete"
     throwSync: make the query throw synchronously instead
     hold:  keep the update pending until world.release() is called
     closeThrows: make the tidy-up after a successful deletion throw */
function makeWorld(opts) {
  const o = Object.assign({ confirm: true, fail: null, store: seedStore() }, opts || {});
  const log = [];          // the order things happened in
  const world = { log, hints: [], progress: [], confirms: [], updates: [], queries: [], store: o.store };
  let releaseUpdate = null;
  world.release = () => { if (releaseUpdate) releaseUpdate(); };

  const query = (node) => {
    const q = { lo: null, hi: null };
    const api = {
      orderByKey() { q.byKey = true; return api; },
      startAt(v) { q.lo = v; return api; },
      endAt(v) { q.hi = v; return api; },
      once() {
        world.queries.push({ node, byKey: !!q.byKey, lo: q.lo, hi: q.hi });
        log.push("list");
        if (o.fail === "list") return Promise.reject(Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }));
        const tree = world.store[node] || {};
        const keys = Object.keys(tree).sort()
          .filter(k => (q.lo === null || k >= q.lo) && (q.hi === null || k <= q.hi));
        return Promise.resolve({
          // Firebase's contract: a truthy return from the callback stops the walk.
          forEach(cb) {
            for (const k of keys) {
              if (cb({ key: k, val: () => tree[k] })) return true;
            }
            return false;
          }
        });
      }
    };
    return api;
  };

  const applyUpdate = (obj) => {
    for (const full of Object.keys(obj)) {
      assert.strictEqual(obj[full], null, "the update must only ever DELETE: " + full);
      const [top, key, ...rest] = full.split("/");
      assert.strictEqual(rest.length, 0, "unexpected depth in " + full);
      delete world.store[top][key];
    }
  };

  const db = {
    ref(p) {
      if (p === undefined) {
        return {
          update(obj) {
            world.updates.push(obj);
            log.push("update");
            if (o.fail === "update") {
              return Promise.reject(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));
            }
            if (o.hold) {
              return new Promise(resolve => {
                releaseUpdate = () => { applyUpdate(obj); resolve(); };
              });
            }
            applyUpdate(obj);
            return Promise.resolve();
          }
        };
      }
      if (o.throwSync) throw new TypeError("db is not ready");
      return query(p);
    }
  };

  const user = {
    uid: UID,
    delete() {
      log.push("authDelete");
      if (o.fail === "authDelete") {
        return Promise.reject(Object.assign(new Error("stale"), { code: "auth/requires-recent-login" }));
      }
      return Promise.resolve();
    }
  };

  const sandbox = {
    db, auth: {}, currentUser: user,
    confirm: (msg) => { world.confirms.push(msg); return o.confirm; },
    el: () => ({ id: "account-action-hint" }),
    splashHintErr: (node, msg) => { world.hints.push(msg); },
    splashHintOk: (node, msg) => { world.progress.push(msg); },
    authErrorMessage: (e) => "AUTH[" + ((e && e.code) || "?") + "]",
    resetStableId: () => { log.push("resetStableId"); },
    closeAccountDialog: () => {
      log.push("closeDialog");
      if (o.closeThrows) throw new Error("tidy-up blew up");
    },
    console: { warn() {} }
  };
  vm.createContext(sandbox);
  /* The in-flight flag is taken from the chunk itself — seeding it in the
     sandbox would let the chunk lose its declaration unnoticed, which is the
     exact failure that kept the account dialog shut for two months. */
  const flag = CHUNK.match(/^let _accountDeleteInFlight\s*=\s*false;/m);
  assert.ok(flag, "data-rights.js must declare _accountDeleteInFlight at top level");
  vm.runInContext(
    flag[0] + "\n" +
    extractFn(CHUNK, "listOwnSharedScenarioIds") + "\n" +
    extractFn(CHUNK, "accountDeletionPaths") + "\n" +
    extractFn(CHUNK, "deleteMyAccount") + "\n",
    sandbox
  );
  world.sandbox = sandbox;
  /* deleteMyAccount() returns nothing — its chain is fire-and-forget.
     Macrotask turns drain every microtask queued in between. */
  world.settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    return world;
  };
  world.click = () => { vm.runInContext("deleteMyAccount();", sandbox); };
  world.run = async () => { world.click(); return world.settle(); };
  return world;
}

test("the paths removed are exactly the account's own, shared copies first", () => {
  const w = makeWorld();
  const paths = vm.runInContext(
    'accountDeletionPaths("u1", ["u1_a", "u1_b"])', w.sandbox);
  assert.deepStrictEqual(Array.from(paths), [
    "sharedScenarios/u1_a",
    "sharedScenarios/u1_b",
    "scenarios/u1",
    "users/u1"
  ]);
  // No published copies is the common case — it must still remove the rest.
  assert.deepStrictEqual(
    Array.from(vm.runInContext('accountDeletionPaths("u1", [])', w.sandbox)),
    ["scenarios/u1", "users/u1"]);
});

test("deleting an account removes the profile, the scenarios and the published copies", async () => {
  const w = await makeWorld().run();

  assert.strictEqual(w.updates.length, 1,
    "the removal must be ONE multi-path update, so the rules accept or refuse it whole");
  assert.deepStrictEqual(Object.keys(w.updates[0]).sort(), [
    "scenarios/" + UID,
    "sharedScenarios/" + UID + "_one",
    "sharedScenarios/" + UID + "_two",
    "users/" + UID
  ]);

  assert.strictEqual(w.store.users[UID], undefined, "users/<uid> must be gone");
  assert.strictEqual(w.store.scenarios[UID], undefined, "scenarios/<uid> must be gone");
  assert.strictEqual(w.store.sharedScenarios[UID + "_one"], undefined);
  assert.strictEqual(w.store.sharedScenarios[UID + "_two"], undefined,
    "EVERY published copy must go — a forEach callback that returns push()'s " +
    "length stops after the first one");
});

test("it removes nothing that belongs to anyone else", async () => {
  const w = await makeWorld().run();
  assert.ok(w.store.users[OTHER] && w.store.scenarios[OTHER]);
  assert.ok(w.store.sharedScenarios[OTHER + "_theirs"]);
  assert.ok(w.store.sharedScenarios[UID + "x_other"],
    "a uid that merely begins with this one is a different person");
  assert.ok(w.store.sharedScenarios.aaa_before);
});

test("an entry a stranger parked under the owner's key prefix is left out", async () => {
  /* The rules let anyone CREATE sharedScenarios/<any key> with their own
     ownerUid, and let only the owner delete it. A multi-path update is refused
     whole if one path is — so including this entry would make the account
     undeletable by a third party's choice. */
  const w = await makeWorld().run();
  assert.ok(!Object.keys(w.updates[0]).includes("sharedScenarios/" + UID + "_squat"),
    "selection must be by ownerUid, not by key prefix alone");
  assert.deepStrictEqual(w.store.sharedScenarios[UID + "_squat"], shared(OTHER));
  assert.deepStrictEqual(w.log, ["list", "update", "authDelete", "resetStableId", "closeDialog"],
    "and the deletion still completes");
});

test("the published copies are found by a key range over the owner's prefix", async () => {
  const w = await makeWorld().run();
  assert.deepStrictEqual(w.queries, [{
    node: "sharedScenarios", byKey: true, lo: UID + "_", hi: UID + "_" + SENTINEL
  }]);
});

test("the range sentinel is written as an escape, not as an invisible character", () => {
  /* Typed raw, U+F8FF renders as nothing: a diff shows `endAt(uid + "_")`, a
     reviewer cannot see it, and a tool that strips it narrows the range to the
     single key `<uid>_` — every published copy is then missed in silence. */
  const fn = extractFn(CHUNK, "listOwnSharedScenarioIds");
  assert.ok(!fn.includes(SENTINEL), "the raw U+F8FF glyph must not appear in the source");
  assert.ok(fn.includes(String.fromCharCode(92) + "uf8ff"), "use the backslash-u escape");
});

test("only account-scoped trees are touched — no session records, no reports", async () => {
  /* The decision the confirm dialog describes. Reports are write-once and
     unreadable, so a client COULD not remove one; session records follow the
     session's own retention. If either ever becomes removable here, the dialog
     text and DPA Annex VI G8 have to change in the same commit. */
  const w = await makeWorld().run();
  for (const p of Object.keys(w.updates[0])) {
    assert.match(p, /^(users|scenarios|sharedScenarios)\//, "unexpected removal: " + p);
  }
});

test("the data goes BEFORE the sign-in account does", async () => {
  /* Auth-first would orphan scenarios/<uid>: it is writable by that uid only,
     so nothing could ever remove it afterwards. */
  const w = await makeWorld().run();
  assert.ok(w.log.indexOf("update") !== -1 && w.log.indexOf("authDelete") !== -1);
  assert.ok(w.log.indexOf("update") < w.log.indexOf("authDelete"),
    "the Auth account must outlive the data removal: " + w.log.join(" > "));
});

test("the sign-in account is not touched until the removal has actually landed", async () => {
  /* Stronger than ordering in a log: with the update still PENDING, the Auth
     delete must not have been called at all. */
  const w = makeWorld({ hold: true });
  w.click();
  await w.settle();
  assert.deepStrictEqual(w.log, ["list", "update"], "nothing may follow a pending update");
  w.release();
  await w.settle();
  assert.deepStrictEqual(w.log, ["list", "update", "authDelete", "resetStableId", "closeDialog"]);
});

test("if the data removal is refused, the sign-in account is NOT deleted", async () => {
  const w = await makeWorld({ fail: "update" }).run();
  assert.ok(!w.log.includes("authDelete"),
    "deleting the account after a refused removal orphans exactly that data");
  assert.ok(!w.log.includes("resetStableId"), "the user is still signed in");
  assert.strictEqual(w.hints.length, 1, "the failure must be shown, once");
  assert.match(w.hints[0], /nothing was removed/i);
  assert.ok(w.store.users[UID] && w.store.scenarios[UID], "and nothing was");
});

test("if the published copies cannot be listed, nothing is deleted at all", async () => {
  /* Skipping the list on error and carrying on would delete the account and
     strand its published copies — the original defect by another route. */
  const w = await makeWorld({ fail: "list" }).run();
  assert.deepStrictEqual(w.log, ["list"]);
  assert.strictEqual(w.updates.length, 0);
  assert.match(w.hints[0], /nothing was removed/i);
});

test("a synchronous throw from the query is reported, not lost", async () => {
  /* The query is built before any promise exists. Thrown outside the chain it
     would escape the click handler with no message and the button left dead. */
  const w = makeWorld({ throwSync: true });
  assert.doesNotThrow(() => w.click(), "the click itself must not throw");
  await w.settle();
  assert.deepStrictEqual(w.log, []);
  assert.strictEqual(w.hints.length, 1);
  assert.match(w.hints[0], /nothing was removed/i);
  // ...and the button works again afterwards.
  w.click();
  assert.strictEqual(w.confirms.length, 2, "a failed run must release the in-flight guard");
});

test("an error from the removal is surfaced even though it carries a code", async () => {
  /* The old catch treated any error with a `.code` as "already shown", and
     PERMISSION_DENIED has one — so a refused removal failed in silence. */
  const w = await makeWorld({ fail: "update" }).run();
  assert.strictEqual(w.hints.length, 1);
});

test("if only the sign-in deletion fails, the message says what is already gone", async () => {
  const w = await makeWorld({ fail: "authDelete" }).run();
  assert.deepStrictEqual(w.log, ["list", "update", "authDelete"]);
  assert.ok(!w.log.includes("resetStableId"),
    "the account still exists and is still signed in — its id stays bound");
  assert.strictEqual(w.hints.length, 1);
  assert.match(w.hints[0], /^AUTH\[auth\/requires-recent-login\]/);
  assert.match(w.hints[0], /scenarios have already been removed/i);
});

test("a failure AFTER the account is deleted is not reported as a failed deletion", async () => {
  /* closeAccountDialog() threw on every call for two months. Had that reached
     this handler, the user would have been told the deletion failed about an
     account that no longer existed. */
  const w = await makeWorld({ closeThrows: true }).run();
  assert.deepStrictEqual(w.log, ["list", "update", "authDelete", "resetStableId", "closeDialog"]);
  assert.deepStrictEqual(w.hints, [], "no error may be shown: the account IS deleted");
});

test("a second click while a deletion is running does nothing", async () => {
  /* Otherwise the second run's Auth delete fails on the account the first run
     just removed, and reports "only the sign-in account is left". */
  const w = makeWorld({ hold: true });
  w.click();
  await w.settle();
  w.click();
  w.click();
  await w.settle();
  assert.strictEqual(w.confirms.length, 1, "no second confirmation while one is in flight");
  assert.strictEqual(w.updates.length, 1);
  w.release();
  await w.settle();
  assert.strictEqual(w.log.filter(x => x === "authDelete").length, 1);
});

test("the user is shown that a deletion is in progress, and it is cleared on success", async () => {
  const w = await makeWorld().run();
  assert.match(w.progress[0], /Deleting your account/);
  assert.strictEqual(w.progress[w.progress.length - 1], "",
    "a stale 'Deleting…' must not be left behind in the dialog");
});

test("declining the confirmation touches nothing", async () => {
  const w = await makeWorld({ confirm: false }).run();
  assert.deepStrictEqual(w.log, []);
  assert.strictEqual(w.updates.length, 0);
  assert.strictEqual(w.confirms.length, 1);
  assert.deepStrictEqual(w.progress, [], "no progress message for a cancelled deletion");
});

test("the confirmation says what is removed and what is not", async () => {
  const w = await makeWorld({ confirm: false }).run();
  const msg = w.confirms[0];
  const [removed, kept] = msg.split("It does NOT remove");
  assert.ok(kept, "the dialog must have a section on what is NOT removed");

  assert.match(removed, /profile/i);
  assert.match(removed, /scenario/i, "authored scenarios are removed and must be named");
  assert.match(removed, /shared library/i, "so must their published copies");

  assert.match(kept, /the name you joined under/i);
  assert.match(kept, /answers/i);
  assert.match(kept, /chat messages/i, "the free-text chat is a session record too");
  assert.match(kept, /roster entry \(your name and email\)/i,
    "the roster holds the EMAIL of exactly the people who have accounts");
  assert.match(kept, /certificate/i);
  assert.match(kept, /reports you filed/i, "reports are deliberately left and must be named");
  assert.match(kept, /filed about yours/i);
  assert.match(kept, /privacy notice/i, "and the route to have the rest erased");
  assert.match(kept, /withdraw research consent[\s\S]*BEFORE deleting/i,
    "the history list is the only in-product withdrawal route and goes with the account");

  assert.doesNotMatch(msg, /no longer linked/i,
    "session records keep the name typed at join — they are NOT unlinked " +
    "(legal/participant-consent-draft.md: do not repeat that claim on screen)");
});

test("the account dialog's standing text makes the same promise as the confirmation", () => {
  const m = HTML.match(/<p class="hint" id="account-delete-scope">([\s\S]*?)<\/p>/);
  assert.ok(m, "index.html must carry the #account-delete-scope paragraph");
  const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /every scenario you authored/i);
  assert.match(text, /shared library/i);
  assert.match(text, /does not remove/i);
  assert.match(text, /chat messages/i);
  assert.match(text, /name and email/i);
  assert.match(text, /reports you filed/i);
  assert.match(text, /withdraw research consent[\s\S]*before deleting/i);
  assert.doesNotMatch(HTML, /no longer linked to your identity/i);
});

/* ---- the shim in script.js ----------------------------------------------- */

test("script.js keeps no copy of the deletion — only the shim", () => {
  /* They share the global script scope: a second declaration of any of these
     is a SyntaxError that fires only when the chunk evaluates, on the click. */
  for (const name of ["listOwnSharedScenarioIds", "accountDeletionPaths", "deleteMyAccount"]) {
    assert.ok(CHUNK.includes("function " + name + "("), name + " must be in data-rights.js");
    assert.ok(!SCRIPT.includes("function " + name + "("), name + " must not be in script.js");
  }
  assert.doesNotMatch(SCRIPT, /_accountDeleteInFlight/);
  const shim = extractFn(SCRIPT, "accountDelete");
  assert.doesNotMatch(shim, /\.update\(|\.remove\(|\.delete\(/,
    "the shim must not delete anything itself");
});

/* Runs the real accountDelete() shim. `loader` is what CanamedLoader looks
   like; `signedIn` whether there is an account and an auth backend. */
function runShim({ loader, signedIn = true, preloaded = false }) {
  const calls = { ran: 0, hints: [], loads: 0 };
  const window = {};
  if (loader !== undefined) window.CanamedLoader = loader(window, calls);
  if (preloaded) window.deleteMyAccount = () => { calls.ran++; };
  const sandbox = {
    window,
    currentUser: signedIn ? { uid: UID } : null,
    auth: signedIn ? {} : null,
    el: () => ({}),
    splashHintErr: (node, msg) => { calls.hints.push(msg); },
    console: { warn() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(SCRIPT, "accountDelete") + "\naccountDelete();", sandbox);
  return new Promise(r => setImmediate(() => setImmediate(() => r(calls))));
}

test("the shim loads the chunk on the first click and then runs the deletion", async () => {
  const c = await runShim({
    loader: (window, calls) => ({
      ensureDataRights() {
        calls.loads++;
        window.deleteMyAccount = () => { calls.ran++; };
        return Promise.resolve();
      }
    })
  });
  assert.deepStrictEqual([c.loads, c.ran, c.hints.length], [1, 1, 0]);
});

test("the shim does not reload a chunk that is already there", async () => {
  const c = await runShim({
    preloaded: true,
    loader: (window, calls) => ({ ensureDataRights() { calls.loads++; return Promise.resolve(); } })
  });
  assert.deepStrictEqual([c.loads, c.ran], [0, 1]);
});

test("a chunk that fails to load says nothing was deleted", async () => {
  const c = await runShim({
    loader: () => ({ ensureDataRights: () => Promise.reject(new Error("offline")) })
  });
  assert.strictEqual(c.ran, 0);
  assert.strictEqual(c.hints.length, 1);
  assert.match(c.hints[0], /nothing was deleted/i);
});

test("an older cached loader without ensureDataRights degrades the same way", async () => {
  for (const loader of [() => ({}), undefined]) {
    const c = await runShim({ loader });
    assert.strictEqual(c.ran, 0);
    assert.match(c.hints[0], /nothing was deleted/i);
  }
});

test("a chunk that loads without defining the handler is reported, not thrown", async () => {
  const c = await runShim({ loader: () => ({ ensureDataRights: () => Promise.resolve() }) });
  assert.strictEqual(c.ran, 0);
  assert.match(c.hints[0], /nothing was deleted/i);
});

test("with no account or no auth backend the shim does nothing at all", async () => {
  const c = await runShim({
    signedIn: false,
    loader: (window, calls) => ({ ensureDataRights() { calls.loads++; return Promise.resolve(); } })
  });
  assert.deepStrictEqual([c.loads, c.ran, c.hints.length], [0, 0, 0]);
});

/* ---- the account dialog could not open ---------------------------------- */

test("every name the account dialog reads is declared", () => {
  /* `_historyListenerRef` is read by openAccountDialog() -> loadHistoryForDialog()
     and by closeAccountDialog(). #264 deleted its `let` with a comment block; a
     bare read of an undeclared name THROWS, so the dialog never reached
     dialogShow(). `node --check` cannot see this and no test executed it. */
  assert.match(SCRIPT, /^let _historyListenerRef\s*=\s*null;/m,
    "script.js must declare _historyListenerRef at top level");
});

test("opening and closing the account dialog runs without a ReferenceError", () => {
  const decl = SCRIPT.match(/^let _historyListenerRef\s*=\s*null;/m);
  assert.ok(decl, "no declaration to run against");

  const shown = [];
  const listeners = [];
  const node = () => ({
    textContent: "", value: "", className: "", innerHTML: "", hidden: false,
    appendChild() {}, classList: { add() {}, remove() {} }, addEventListener() {}
  });
  const sandbox = {
    currentUser: { uid: UID, email: "a@example.test" },
    currentProfile: null,
    db: {
      ref: (p) => ({
        on: (ev, cb) => { listeners.push(p); cb({ val: () => null }); },
        off: () => { listeners.push("off:" + p); }
      })
    },
    el: () => node(),
    document: { createElement: () => node() },
    populateProfileSelects() {}, setRoleRadio() {}, applyProfileRoleVisibility() {},
    splashHintOk() {}, t: (k) => k, runWithdrawalFlow() {},
    dialogShow: () => { shown.push("show"); },
    dialogClose: () => { shown.push("close"); }
  };
  vm.createContext(sandbox);
  /* The declaration is taken from script.js itself — pre-seeding it in the
     sandbox would make this pass on the broken file. */
  vm.runInContext(
    decl[0] + "\n" +
    extractFn(SCRIPT, "openAccountDialog") + "\n" +
    extractFn(SCRIPT, "closeAccountDialog") + "\n" +
    extractFn(SCRIPT, "loadHistoryForDialog") + "\n",
    sandbox
  );

  assert.doesNotThrow(() => vm.runInContext("openAccountDialog();", sandbox));
  assert.deepStrictEqual(shown, ["show"],
    "the dialog must actually be shown — the throw used to come before this");
  assert.deepStrictEqual(listeners, ["users/" + UID + "/history"]);

  assert.doesNotThrow(() => vm.runInContext("closeAccountDialog();", sandbox));
  assert.deepStrictEqual(shown, ["show", "close"]);
  assert.deepStrictEqual(listeners,
    ["users/" + UID + "/history", "off:users/" + UID + "/history"],
    "closing must drop the history subscription");
});
