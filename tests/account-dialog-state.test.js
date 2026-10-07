/* tests/account-dialog-state.test.js
 *
 * What the account UI keeps between two accounts, and between two page loads.
 *
 * Each section below opens with the defect it covers. All of them became
 * reachable once the account dialog could be opened from the front page (#431).
 *
 * HOW THESE TESTS RUN. They execute the real code: the whole account section of
 * script.js (handleAuthStateChange() down to wireAccountUI()) is cut out by its
 * boundaries and run against a fake document, database and auth backend. It is
 * cut out as a RANGE, not function by function, on purpose: a helper added to
 * that section comes along without the test naming it, so the tests fail on
 * what the code DOES, not on a function being absent.
 *
 * The fake <select> follows the browser where these defects depend on it: the
 * year and level lists are read from index.html with their `selected`
 * attributes, a select with nothing chosen shows its first enabled option, and
 * assigning a value it does not have leaves it empty.
 *
 * What a fake cannot show — that the real page behaves this way on every
 * viewport, with the real dialog, the real lazy chunk and a real reload — is
 * tests-e2e/account-dialog-state.spec.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
/* Read as LF. A Windows checkout has core.autocrlf=true, and a regex that walks
   with `.` or `[^>]` behaves differently across "\r". */
const read = (f) => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("script.js");
const HTML = read("index.html");

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

/* The account section, whole: every top-level declaration from the auth-state
   handler to the end of wireAccountUI(). */
const SECTION_FROM = "function handleAuthStateChange(";
const SECTION_TO = "/* ===================== Observer SPIKES checklist";
const ACCOUNT_SECTION = (() => {
  const a = SCRIPT.indexOf(SECTION_FROM), b = SCRIPT.indexOf(SECTION_TO);
  assert.ok(a !== -1 && b > a, "could not find the account section of script.js");
  const src = SCRIPT.slice(a, b);
  for (const fn of ["saveProfile", "profileSetupSubmit", "openAccountDialog", "accountSaveBtn",
    "accountSignOut", "wireAccountUI"]) {
    assert.ok(src.includes("function " + fn + "("), fn + "() is no longer in the account section");
  }
  return src;
})();

/* The options of a static <select> in index.html, with their attributes. */
function optionsOf(id) {
  const m = new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(HTML);
  assert.ok(m, "index.html has no <select id=\"" + id + "\">");
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>/g)].map((o) => ({
    value: o[1], selected: /\bselected\b/.test(o[2]), disabled: /\bdisabled\b/.test(o[2])
  }));
}
/* The option a browser shows before anything is chosen. */
function htmlDefault(id) {
  const opts = optionsOf(id);
  assert.ok(opts.length > 0, "#" + id + " has no options in index.html");
  return (opts.filter((x) => x.selected).pop() || opts.find((x) => !x.disabled) || { value: "" }).value;
}

/* ---- a fake page ---------------------------------------------------------- */

function makeNode(id) {
  const cls = new Set();
  const listeners = {};
  const node = {
    id, textContent: "", className: "", title: "", hidden: false, value: "",
    open: false, dataset: {}, children: [], listeners,
    classList: {
      add: (c) => { cls.add(c); },
      remove: (c) => { cls.delete(c); },
      contains: (c) => cls.has(c)
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) {
      (listeners[type] || []).slice().forEach((fn) => fn({ target: node, preventDefault() {} }));
    },
    count(type) { return (listeners[type] || []).length; },
    appendChild(c) { node.children.push(c); return c; },
    querySelector() { return null; },
    setAttribute() {}, removeAttribute() {}, hasAttribute() { return false; },
    focus() {}, select() {}
  };
  Object.defineProperty(node, "innerHTML", {
    configurable: true, get: () => "", set: () => { node.children = []; }
  });
  return node;
}

function makeSelect(id, options) {
  const node = makeNode(id);
  let opts = [];
  Object.defineProperties(node, {
    options: { get: () => opts },
    value: {
      get: () => { const s = opts.find((x) => x.selected); return s ? s.value : ""; },
      // The first option carrying that value, or nothing at all.
      set: (v) => {
        let hit = false;
        opts.forEach((x) => { x.selected = !hit && x.value === String(v); hit = hit || x.selected; });
      }
    },
    innerHTML: { get: () => "", set: () => { opts = []; } }
  });
  node.appendChild = (c) => {
    if (c.selected) opts.forEach((x) => { x.selected = false; });
    opts.push(c);
    // Nothing chosen: a single-choice select shows its first enabled option.
    if (!opts.some((x) => x.selected)) {
      const first = opts.find((x) => !x.disabled);
      if (first) first.selected = true;
    }
    return c;
  };
  (options || []).forEach((x) => node.appendChild(Object.assign({}, x)));
  return node;
}

function makeRadios(values) {
  const group = [];
  values.forEach((value, i) => {
    let checked = i === 0;
    const r = { value, addEventListener() {}, _uncheck() { checked = false; } };
    Object.defineProperty(r, "checked", {
      get: () => checked,
      set: (on) => { if (on) group.forEach((x) => x._uncheck()); checked = !!on; }
    });
    group.push(r);
  });
  return group;
}

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/* An in-memory database: ref(path).once/set/on/off. hold(path) keeps a read of
   that path pending until release(path). Values cross the boundary as copies,
   so what is stored is plain data in THIS realm. */
function makeDb() {
  const tree = {};
  const writes = [];
  const held = new Map();
  const get = (p) => p.split("/").filter(Boolean).reduce((n, k) =>
    (n !== null && typeof n === "object" && Object.prototype.hasOwnProperty.call(n, k)) ? n[k] : null, tree);
  const set = (p, v) => {
    const parts = p.split("/").filter(Boolean);
    let n = tree;
    parts.slice(0, -1).forEach((k) => { if (n[k] === null || typeof n[k] !== "object") n[k] = {}; n = n[k]; });
    const last = parts[parts.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = v;
  };
  const snap = (p) => ({ val: () => clone(get(p)) });
  return {
    tree, writes, get: (p) => clone(get(p)), seed: (p, v) => set(p, clone(v)),
    hold(p) { held.set(p, []); },
    release(p) { const q = held.get(p) || []; held.delete(p); q.forEach((go) => go()); },
    ref(p) {
      return {
        once() {
          if (held.has(p)) return new Promise((resolve) => { held.get(p).push(() => resolve(snap(p))); });
          return Promise.resolve(snap(p));
        },
        set(v) { writes.push(p); set(p, clone(v)); return Promise.resolve(); },
        on(ev, cb) { cb(snap(p)); },
        off() {}
      };
    }
  };
}

const VIEWS = ["enter", "create", "created", "account", "profile-setup", "my-sessions"];
const ALICE = { uid: "uidAlice", email: "alice@example.test", displayName: null, isAnonymous: false };
const BOB = { uid: "uidBob", email: "bob@example.test", displayName: null, isAnonymous: false };
const ALICE_PROFILE = { name: "Alice", university: "Nagoya", year: 5, english: "C1", role: "student", updatedAt: 1 };

/* A page with the account section loaded.
     backend: false  -> no auth backend at all (`auth` is null, as in LOCAL mode)
     stored          -> what localStorage holds when the page loads
     globals         -> further names the code under test may call
     source          -> further source, run after the account section */
function makeWorld(opts) {
  const o = Object.assign({ backend: true, stored: {}, globals: {}, source: "" }, opts || {});
  const nodes = new Map();
  const radios = { "splash-prof-role": makeRadios(["student", "facilitator"]),
                   "account-role": makeRadios(["student", "facilitator"]) };
  const db = makeDb();

  const el = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  };
  for (const id of ["splash-prof-uni", "account-uni"]) nodes.set(id, makeSelect(id, []));
  for (const id of ["splash-prof-year", "splash-prof-english", "account-year", "account-english",
    "year-input", "english-input", "uni-input"]) {
    nodes.set(id, makeSelect(id, optionsOf(id)));
  }
  // The front page as index.html ships it: the "enter a code" view showing.
  VIEWS.forEach((v) => { el("splash-view-" + v).hidden = (v !== "enter"); });
  el("splash-signed-in").hidden = true;
  el("user-chip").classList.add("hidden");

  const document = {
    body: makeNode("body"), title: "",
    createElement: (tag) => (tag === "option"
      ? { value: "", disabled: false, selected: false, textContent: "" } : makeNode(null)),
    querySelector(sel) {
      let m = /^input\[name="([\w-]+)"\]:checked$/.exec(sel);
      if (m) return radios[m[1]].find((r) => r.checked) || null;
      m = /^input\[name="([\w-]+)"\]\[value="([\w-]+)"\]$/.exec(sel);
      if (m) return radios[m[1]].find((r) => r.value === m[2]) || null;
      throw new Error("fake document.querySelector: unexpected selector " + sel);
    },
    querySelectorAll(sel) {
      const m = /^input\[name="([\w-]+)"\]$/.exec(sel);
      return m ? radios[m[1]] : [];
    }
  };

  const storage = new Map(Object.entries(o.stored));
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); }
  };

  /* The auth backend. Like the SDK it tells its listener about a change AFTER
     the call that caused it has returned, and it signs nobody in by itself:
     the page's own ensureSignedIn() asks for the anonymous user. */
  let anon = 0;
  const notify = (user) => Promise.resolve().then(() => { sandbox.handleAuthStateChange(user); });
  const auth = {
    currentUser: null,
    signInAnonymously() {
      const user = { uid: "uidAnon" + (++anon), email: null, displayName: null, isAnonymous: true };
      auth.currentUser = user;
      return notify(user).then(() => ({ user }));
    },
    signOut() { auth.currentUser = null; return notify(null); }
  };

  const sandbox = Object.assign({
    console: { warn() {}, info() {}, error() {}, log() {} },
    window: {}, document, localStorage, el, db,
    setTimeout: () => 0,
    auth: o.backend ? auth : null,
    currentUser: null, currentProfile: null,
    authReady: null, _authReadyResolve: null, _anonSignInPromise: null,
    stableId: "s0", STABLE_ID_KEY: "canamed_stable_id",
    COHORTS: [{ id: "Caen", label: "Caen" }, { id: "Nagoya", label: "Nagoya" }],
    CFG: {}, tc: (x) => x, t: (k) => k,
    resetStableId() {},
    dialogShow(dlg) { dlg.open = true; },
    dialogClose(dlg) { dlg.open = false; },
    authErrorMessage: () => "AUTH",
    runWithdrawalFlow() {}, wireEmailAuthForm() {}, signInWithProvider() {}
  }, o.globals);
  vm.createContext(sandbox);
  vm.runInContext(["ensureSignedIn", "splashShowView", "splashHintErr", "splashHintOk"]
    .map((fn) => extractFn(SCRIPT, fn)).join("\n") + "\n" + ACCOUNT_SECTION + "\n" + o.source, sandbox);

  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const role = (name) => (radios[name].find((r) => r.checked) || {}).value;
  return {
    sandbox, db, auth, el, settle,
    run: (code) => vm.runInContext(code, sandbox),
    /* An account signs in. `profile` is what it already has stored, if any. */
    async signIn(user, profile) {
      if (profile) db.seed("users/" + user.uid + "/profile", profile);
      auth.currentUser = user;
      sandbox.handleAuthStateChange(user);
      await settle();
    },
    /* The page's own "Sign out". */
    async signOut() { sandbox.accountSignOut(); await settle(); },
    /* The account goes away without this page asking: deleted, revoked, or
       signed out from another tab. */
    async vanish() {
      auth.currentUser = null;
      sandbox.handleAuthStateChange(null);
      await settle();
    },
    views: () => VIEWS.filter((v) => !el("splash-view-" + v).hidden),
    dialog: () => ({
      email: el("account-email").textContent, name: el("account-name").value,
      university: el("account-uni").value, year: el("account-year").value,
      english: el("account-english").value, role: role("account-role")
    }),
    setupForm: () => ({
      name: el("splash-prof-name").value, university: el("splash-prof-uni").value,
      year: el("splash-prof-year").value, english: el("splash-prof-english").value,
      role: role("splash-prof-role")
    }),
    fill(prefix, v) {
      // The cohort list is built by script; an untouched form has none yet.
      sandbox.populateProfileSelects(prefix + "-uni");
      el(prefix + "-name").value = v.name;
      el(prefix + "-uni").value = v.university;
      el(prefix + "-year").value = v.year;
      el(prefix + "-english").value = v.english;
    },
    /* A stored profile without its two timestamps. */
    stored(uid) {
      const p = db.get("users/" + uid + "/profile");
      if (p) { delete p.createdAt; delete p.updatedAt; }
      return p;
    }
  };
}

/* What a pristine page shows a brand-new account for the university. Read from
   a fresh page rather than written down: which option an untouched cohort list
   starts on is not what these tests are about. */
async function freshUniversities() {
  const w = makeWorld();
  await w.signIn(BOB);
  const setup = w.setupForm().university;
  w.sandbox.openAccountDialog();
  return { setup, dialog: w.dialog().university };
}

/* ======================= A. one account's profile, shown to the next =======
 *
 * A NEW ACCOUNT SAW, AND COULD SAVE, THE PREVIOUS ACCOUNT'S PROFILE.
 * openAccountDialog() filled its fields only when the account had a profile,
 * and nothing emptied them otherwise; signing out does not reload the page.
 * Alice opens Account and signs out; Bob signs in to an account with no profile
 * in the same tab and opens Account: his e-mail address above her name,
 * university, year and level, and Save stored whatever he did not retype as his
 * own. The profile-setup form leaked the same way (its name was filled only
 * `if (!nm.value)`, the selects never). And on a fresh page the dialog offered
 * a new account "A2", where the setup form and the lobby both start from B2.
 */

test("A: a second account opening the dialog sees none of the first account's profile", async () => {
  const fresh = await freshUniversities();
  assert.notStrictEqual(fresh.dialog, "Nagoya",
    "premise: Alice's university must differ from what a fresh page shows");

  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  assert.deepStrictEqual(w.dialog(), {
    email: "alice@example.test", name: "Alice", university: "Nagoya", year: "5", english: "C1", role: "student"
  }, "premise: the dialog shows an account its own profile");

  await w.signOut();
  assert.strictEqual(w.el("account-dialog").open, false, "premise: signing out closes the dialog");
  await w.signIn(BOB);                       // a new account: nothing stored
  assert.strictEqual(w.db.get("users/uidBob"), null, "premise: Bob has no profile");
  w.sandbox.openAccountDialog();

  assert.deepStrictEqual(w.dialog(), {
    email: "bob@example.test", name: "", university: fresh.dialog, year: "1", english: "B2", role: "student"
  }, "Bob's dialog must hold his own values or the defaults — never Alice's");
});

test("A: Save in the second account's dialog stores nothing of the first account", async () => {
  const fresh = await freshUniversities();
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  await w.signOut();
  await w.signIn(BOB);
  w.sandbox.openAccountDialog();

  // He types his name and changes nothing else — which is what a person does.
  w.el("account-name").value = "Bob";
  w.sandbox.accountSaveBtn();
  await w.settle();

  assert.deepStrictEqual(w.stored("uidBob"),
    { name: "Bob", university: fresh.dialog, role: "student", year: 1, english: "B2" },
    "what he did not retype must not be saved as his");
  assert.deepStrictEqual(w.stored("uidAlice"),
    { name: "Alice", university: "Nagoya", year: 5, english: "C1", role: "student" },
    "and Alice's own profile is untouched");
});

test("A: an account with a profile gets its own values back, whatever the dialog last showed", async () => {
  /* The other direction: one account's values must not show through another's
     either. A stored field that is EMPTY counts — a facilitator has no year and
     no level, and the previous student's must not be left in their place. */
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  await w.signOut();
  await w.signIn(BOB, { name: "Dr Bob", university: "Caen", year: null, english: null, role: "facilitator", updatedAt: 1 });
  w.sandbox.openAccountDialog();

  assert.deepStrictEqual(w.dialog(), {
    email: "bob@example.test", name: "Dr Bob", university: "Caen", year: "1", english: "B2", role: "facilitator"
  });
});

test("A: a new account's dialog starts from the same year and level as profile setup and the lobby", async () => {
  /* On a fresh page nobody's values are left over — and the dialog still showed
     "A2", because its level list had no default while the other two do. */
  const w = makeWorld();
  await w.signIn(BOB);
  w.sandbox.openAccountDialog();
  const d = w.dialog();
  assert.strictEqual(d.english, "B2");
  assert.strictEqual(d.year, "1");
  assert.strictEqual(d.english, w.setupForm().english, "the dialog and the profile-setup form must agree");
  assert.strictEqual(d.english, w.el("english-input").value, "and so must the lobby's join form");
  assert.strictEqual(d.year, w.setupForm().year);
  assert.strictEqual(d.year, w.el("year-input").value);
});

test("A: the three level lists and the three year lists mark the same default in index.html", () => {
  /* The script sets the dialog's fields on every open, so this is the second
     line of defence: markup that is right by itself, for any route that shows
     the dialog without going through openAccountDialog(). */
  assert.strictEqual(htmlDefault("splash-prof-english"), "B2", "premise: profile setup starts from B2");
  assert.strictEqual(htmlDefault("english-input"), "B2", "premise: the lobby starts from B2");
  assert.strictEqual(htmlDefault("account-english"), "B2",
    "#account-english must mark B2 `selected`, like the other two level lists");
  assert.strictEqual(htmlDefault("account-year"), htmlDefault("splash-prof-year"));
  assert.strictEqual(htmlDefault("account-year"), htmlDefault("year-input"));
});

for (const submitted of [true, false]) {
  test("A: the profile-setup form shown to a second account holds none of the first one's entries" +
       (submitted ? " (she saved it)" : " (she left it half-filled)"), async () => {
    const fresh = await freshUniversities();
    const w = makeWorld();
    await w.signIn(ALICE);                   // a new account: straight to profile setup
    assert.deepStrictEqual(w.views(), ["profile-setup"], "premise: a new account is asked for a profile");
    assert.strictEqual(w.setupForm().name, "alice", "premise: the name starts from HER address");
    w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
    if (submitted) {
      w.sandbox.profileSetupSubmit();
      await w.settle();
      assert.deepStrictEqual(w.stored("uidAlice"),
        { name: "Alice A", university: "Nagoya", role: "student", year: 5, english: "C1" },
        "premise: her profile was saved");
    }

    await w.signOut();
    await w.signIn(BOB);
    assert.deepStrictEqual(w.views(), ["profile-setup"]);
    assert.deepStrictEqual(w.setupForm(),
      { name: "bob", university: fresh.setup, year: "1", english: "B2", role: "student" },
      "Bob's form must start from his own address and the defaults — never from what Alice typed");
  });
}

test("A: an auth event repeated for the SAME account leaves what it is typing alone", async () => {
  /* The guard on the other side. Emptying the form is right when the account
     CHANGES; an SDK that reports the same account twice must not wipe a form
     somebody is half-way through. */
  const w = makeWorld();
  await w.signIn(ALICE);
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.sandbox.handleAuthStateChange(ALICE);
  await w.settle();
  assert.deepStrictEqual(w.setupForm(),
    { name: "Alice A", university: "Nagoya", year: "5", english: "C1", role: "student" });
  assert.deepStrictEqual(w.views(), ["profile-setup"]);
});

test("A: a dialog left open is closed when the account behind it changes", async () => {
  /* Sign-out and deletion close it themselves. An account that changes from
     ANOTHER tab does not pass through either, and the open dialog would go on
     showing the old account's fields above a Save that writes to the new one. */
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  assert.strictEqual(w.el("account-dialog").open, true);
  await w.vanish();
  assert.strictEqual(w.el("account-dialog").open, false);
});

/* ======================= B. the setup form outliving the account ==========
 *
 * THE PROFILE-SETUP FORM OUTLIVED THE ACCOUNT. After "Sign out" or "Delete
 * account" during setup the form stayed on screen for the now-anonymous
 * visitor, and submitting it wrote their name and university to
 * users/<anonymous uid>/profile — which the product gives nobody a way to see
 * or delete (the account chip and the dialog are hidden for an anonymous user).
 */

test("B: signing out during profile setup returns the front page to 'enter a session'", async () => {
  const w = makeWorld();
  await w.signIn(ALICE);
  assert.deepStrictEqual(w.views(), ["profile-setup"], "premise");
  assert.strictEqual(w.el("splash-signed-in").hidden, false, "premise: the signed-in row is showing");

  await w.signOut();

  assert.ok(w.sandbox.currentUser && w.sandbox.currentUser.isAnonymous,
    "premise: the visitor is signed back in anonymously, as every visitor is");
  assert.deepStrictEqual(w.views(), ["enter"],
    "an anonymous visitor must not be left on 'Set up your profile'");
  assert.strictEqual(w.el("splash-signed-in").hidden, true);
  assert.strictEqual(w.setupForm().name, "",
    "and the form left behind must not keep the name it was prefilled with");
});

for (const backend of [true, false]) {
  test("B: the same when the account disappears without a sign-out from this page" +
       (backend ? "" : " (no auth backend)"), async () => {
    /* What "Delete account" ends in — the SDK reports no user, then the
       anonymous one — and equally a revoked token or a sign-out in another tab.
       Without a backend there is no anonymous user to follow. */
    const w = makeWorld({ backend });
    await w.signIn(ALICE);
    assert.deepStrictEqual(w.views(), ["profile-setup"], "premise");
    await w.vanish();
    assert.strictEqual(!!w.sandbox.currentUser, backend);
    assert.deepStrictEqual(w.views(), ["enter"]);
    assert.strictEqual(w.el("splash-signed-in").hidden, true);
  });
}

test("B: a view other than profile setup is left where it is when the account changes", async () => {
  /* Going back to "enter" is for the setup form only. The first auth event of
     every page load is a change of account too (nobody -> the anonymous user),
     and it must not pull a facilitator out of the create form. */
  const w = makeWorld();
  w.sandbox.splashShowView("create");
  await w.vanish();
  assert.ok(w.sandbox.currentUser.isAnonymous, "premise: an anonymous user arrived");
  assert.deepStrictEqual(w.views(), ["create"]);
});

test("B: a profile is never saved for an anonymous visitor, from either form", async () => {
  const w = makeWorld();
  await w.signIn(ALICE);
  await w.signOut();
  const anonUid = w.sandbox.currentUser.uid;
  assert.ok(w.sandbox.currentUser.isAnonymous, "premise");
  w.db.writes.length = 0;

  // The save path reached anyway: a submit that was already on its way.
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.sandbox.profileSetupSubmit();
  await w.settle();
  w.fill("account", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.sandbox.accountSaveBtn();
  await w.settle();

  assert.strictEqual(w.db.get("users/" + anonUid), null,
    "nothing may be stored under the anonymous uid — nobody could ever see or delete it");
  assert.deepStrictEqual(w.db.writes, [], "no write may even be attempted");
  for (const id of ["splash-profile-setup-hint", "account-action-hint"]) {
    assert.match(w.el(id).textContent, /not signed in/i, "#" + id + " must say why nothing was saved");
    assert.strictEqual(w.el(id).className, "splash-hint err");
  }

  await assert.rejects(Promise.resolve(w.sandbox.saveProfile({ name: "Alice A", university: "Nagoya" })),
    "saveProfile() itself must refuse, whoever calls it");
  assert.deepStrictEqual(w.db.writes, []);
});

test("B: nor when nobody is signed in at all", async () => {
  const w = makeWorld({ backend: false });
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.sandbox.profileSetupSubmit();
  await w.settle();
  assert.deepStrictEqual(w.db.writes, []);
  assert.match(w.el("splash-profile-setup-hint").textContent, /not signed in/i);
});

test("B: a signed-in account still saves its profile from both forms (positive control)", async () => {
  /* Without this, the two tests above would pass on a save path that had
     simply stopped working. */
  const w = makeWorld();
  await w.signIn(BOB);
  w.fill("splash-prof", { name: "Bob", university: "Caen", year: "3", english: "B1" });
  w.sandbox.profileSetupSubmit();
  await w.settle();
  assert.deepStrictEqual(w.stored("uidBob"), { name: "Bob", university: "Caen", role: "student", year: 3, english: "B1" });
  assert.deepStrictEqual(w.views(), ["enter"], "and profile setup hands over to the front page");
  assert.strictEqual(w.el("splash-profile-setup-hint").textContent, "");

  w.sandbox.openAccountDialog();
  assert.deepStrictEqual(w.dialog(),
    { email: "bob@example.test", name: "Bob", university: "Caen", year: "3", english: "B1", role: "student" });
  w.el("account-name").value = "Robert";
  w.sandbox.accountSaveBtn();
  await w.settle();
  assert.strictEqual(w.stored("uidBob").name, "Robert");
  assert.strictEqual(w.el("account-action-hint").textContent, "Profile saved.");
});

for (const hasProfile of [false, true]) {
  test("B: a profile read that comes back after the account has gone is dropped" +
       (hasProfile ? " (it had a profile)" : " (it had none)"), async () => {
    /* The read is asynchronous and the account can go while it is in flight.
       Applied late, an empty result put 'Set up your profile' in front of the
       anonymous visitor, and a full one left the old account's profile as the
       current one. */
    const w = makeWorld();
    if (hasProfile) w.db.seed("users/uidAlice/profile", ALICE_PROFILE);
    w.db.hold("users/uidAlice/profile");
    w.auth.currentUser = ALICE;
    w.sandbox.handleAuthStateChange(ALICE);
    await w.settle();

    await w.vanish();
    assert.ok(w.sandbox.currentUser.isAnonymous, "premise: the anonymous user is current");
    w.db.release("users/uidAlice/profile");
    await w.settle();

    assert.strictEqual(w.sandbox.currentProfile, null, "the old account's profile must not become current");
    assert.deepStrictEqual(w.views(), ["enter"]);
    assert.strictEqual(w.el("splash-signed-in").hidden, true);
    assert.strictEqual(w.el("user-chip").classList.contains("hidden"), true);
  });
}

test("B: a profile read that comes back for the account still signed in is applied (positive control)", async () => {
  const w = makeWorld();
  w.db.seed("users/uidAlice/profile", ALICE_PROFILE);
  w.db.hold("users/uidAlice/profile");
  w.auth.currentUser = ALICE;
  w.sandbox.handleAuthStateChange(ALICE);
  await w.settle();
  assert.strictEqual(w.sandbox.currentProfile, null, "premise: the read is still pending");
  w.db.release("users/uidAlice/profile");
  await w.settle();
  assert.strictEqual(w.sandbox.currentProfile.name, "Alice");
  assert.strictEqual(w.el("user-chip").classList.contains("hidden"), false);
});

/* ======================= C. the account UI wired on every way in ==========
 *
 * THE HEADER CHIP DID NOTHING AFTER A RELOAD INSIDE A SESSION. wireAccountUI()
 * was reached only through wireSplash(), which runs only when the splash is
 * shown. Auto-resume never shows it, so the chip — painted, titled "open your
 * account" — and every button in the dialog had no listener.
 *
 * These run script.js's own START block (what the page does when it has
 * loaded) with the real initEntry(), session entry and wireSplash(), so the
 * wiring is found wherever on that path it is done.
 */

const START_MARKER = "/* ===================== START ===================== */";
const START_BLOCK = (() => {
  const a = SCRIPT.indexOf(START_MARKER);
  assert.notStrictEqual(a, -1, "could not find script.js's START block");
  return SCRIPT.slice(a);
})();

const ACCOUNT_CONTROLS = ["user-chip", "splash-signed-in-account", "account-dialog-close",
  "account-save-btn", "account-signout-btn", "account-delete-btn", "account-dialog"];
const clicks = (w) => Object.fromEntries(ACCOUNT_CONTROLS.map((id) => [id, w.el(id).count("click")]));
const ONCE = Object.fromEntries(ACCOUNT_CONTROLS.map((id) => [id, 1]));

/* Load the page: `stored` is what localStorage holds. */
async function boot(stored) {
  const entered = [];
  /* The flag is taken from script.js itself — seeding it here would let the
     real file lose its declaration unnoticed. */
  const flag = SCRIPT.match(/^let splashWired\s*=\s*false;/m);
  assert.ok(flag, "script.js must declare splashWired at top level");
  const w = makeWorld({
    stored: stored || {},
    globals: {
      currentOrgInvalid: false, sessionNum: "",
      sanitizeCode: (c) => String(c || "").toLowerCase(),
      peekDeepLinkCode: () => "",
      sessionStatus: () => Promise.resolve({ exists: true, closed: false }),
      loadSessionScenario: () => Promise.resolve(true),
      initLobby() { entered.push("initLobby"); },
      lobbyShowLockedSession() {}, subscribeClosedListener() {}, autoResume() {},
      tryConsumeDeepLink() {}, paintSavedSessionBanner() {}, paintMySessionsLink() {},
      loadLastWorkshop: () => null,
      initObserverChecklist() {}, wireReferenceToolbars() {}, wireBackToTop() {}
    },
    source: flag[0] + "\n" + ["setUnlockedSession", "enterUnlockedSession", "initEntry", "wireSplash"]
      .map((fn) => extractFn(SCRIPT, fn)).join("\n")
  });
  w.entered = entered;
  w.run(START_BLOCK);
  await w.settle();
  return w;
}

test("C: after a reload inside a session the header chip and the dialog's buttons are wired", async () => {
  const w = await boot({ canamed_session: "abc-123" });

  /* Positive control for "the splash was never shown": the session was entered
     and wireSplash() — until now the only caller of wireAccountUI() — did not
     run. Without it this would pass by the route that always worked. */
  assert.ok(w.entered.includes("initLobby"), "premise: the stored session was resumed");
  assert.strictEqual(w.sandbox.sessionNum, "abc-123");
  assert.strictEqual(w.run("splashWired"), false, "premise: the splash was never wired");

  assert.deepStrictEqual(clicks(w), ONCE,
    "every account control needs its listener on the auto-resume path too");

  // And they do what they say.
  await w.signIn(ALICE, ALICE_PROFILE);
  w.el("user-chip").fire("click");
  assert.strictEqual(w.el("account-dialog").open, true, "the chip must open the dialog");
  assert.strictEqual(w.el("account-email").textContent, "alice@example.test");
  w.el("account-dialog-close").fire("click");
  assert.strictEqual(w.el("account-dialog").open, false, "and Close must close it");
});

test("C: on the front page they are wired once, not twice", async () => {
  const w = await boot();
  assert.strictEqual(w.run("splashWired"), true, "premise: no stored session, so the splash was shown");
  assert.deepStrictEqual(w.views(), ["enter"]);
  /* Two listeners would open the dialog twice per click — and showModal() on an
     open dialog throws. */
  assert.deepStrictEqual(clicks(w), ONCE);
});

test("C: wiring the account UI again, from anywhere and in any order, adds nothing", async () => {
  for (const stored of [{ canamed_session: "abc-123" }, {}]) {
    const w = await boot(stored);
    w.run("wireAccountUI(); wireSplash(); wireAccountUI(); wireSplash();");
    assert.deepStrictEqual(clicks(w), ONCE);
  }
});
