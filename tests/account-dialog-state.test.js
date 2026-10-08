/* tests/account-dialog-state.test.js
 *
 * What the account UI keeps between two accounts, and between two page loads.
 *
 * Each section below opens with the defect it covers. A to C became reachable
 * once the account dialog could be opened from the front page (#431); D to H
 * were found by the independent review of the PR that fixed those. I is the
 * other side: an account that the page did NOT show until a reload.
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
const lib = require("../docs/Third_session/PBL_platform/lib.js");

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
    dispatchEvent(ev) { node.fire(ev.type); return true; },
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
   that path pending until release(path); holdAck(path) lets a write to that
   path land but keeps its acknowledgement back until releaseAck(path), which
   refuses the write instead when given an error. Values cross the boundary as
   copies, so what is stored is plain data in THIS realm. `reads` lists the
   path of every once(), in order.

   on("value") NEVER answers inside the call — the real database does not, and
   a fake that did hid a defect (section H): the first answer comes a microtask
   later, or, after holdOn(path), when releaseOn(path) is called. off() detaches
   every listener at that path, as ref.off() does, so a late answer goes nowhere. */
function makeDb() {
  const tree = {};
  const writes = [];
  const reads = [];
  const held = new Map();
  const acks = new Map();
  const listeners = new Map();
  const onHeld = new Set();
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
    tree, writes, reads, get: (p) => clone(get(p)), seed: (p, v) => set(p, clone(v)),
    hold(p) { held.set(p, []); },
    release(p) { const q = held.get(p) || []; held.delete(p); q.forEach((go) => go()); },
    holdAck(p) { acks.set(p, []); },
    releaseAck(p, error) {
      const q = acks.get(p) || [];
      acks.delete(p);
      q.forEach((a) => (error ? a.reject(error) : a.resolve()));
    },
    holdOn(p) { onHeld.add(p); },
    releaseOn(p) {
      onHeld.delete(p);
      (listeners.get(p) || []).forEach((l) => { if (l.live) l.cb(snap(p)); });
    },
    ref(p) {
      return {
        once() {
          reads.push(p);
          if (held.has(p)) return new Promise((resolve) => { held.get(p).push(() => resolve(snap(p))); });
          return Promise.resolve(snap(p));
        },
        set(v) {
          writes.push(p);
          set(p, clone(v));
          if (acks.has(p)) return new Promise((resolve, reject) => { acks.get(p).push({ resolve, reject }); });
          return Promise.resolve();
        },
        on(ev, cb) {
          const l = { cb, live: true };
          if (!listeners.has(p)) listeners.set(p, []);
          listeners.get(p).push(l);
          if (!onHeld.has(p)) Promise.resolve().then(() => { if (l.live) cb(snap(p)); });
        },
        off() {
          (listeners.get(p) || []).forEach((l) => { l.live = false; });
          listeners.delete(p);
        }
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
     the call that caused it has returned; it tells it only when the UID
     changes (12.17.1 keeps a lastNotifiedUid and compares); and it signs nobody
     in by itself: the page's own ensureSignedIn() asks for the anonymous user. */
  let anon = 0;
  let made = 0;
  let lastUid = null;
  /* Every user the backend told the page about, and every call of the page's
     handler whoever made it (see below): uids, or null for "nobody". */
  const reported = [];
  const handled = [];
  const deliver = (user) => {
    lastUid = user ? user.uid : null;
    reported.push(lastUid);
    sandbox.handleAuthStateChange(user);
  };
  const notify = (user) => Promise.resolve().then(() => {
    if ((user ? user.uid : null) !== lastUid) deliver(user);
  });
  const fail = (code, more) => Promise.reject(Object.assign(new Error(code), { code }, more));
  /* A call that signs somebody in. The listener is told before the call's
     promise resolves — or, with `auth.late`, only after the caller's own
     success handler has run: nothing in the page may depend on that order.

     The SDK builds a NEW user object for a sign-in. Where the uid changes the
     page is told and takes it. Where it is the uid ALREADY signed in, the page
     is told nothing and the object it holds has been superseded — the case
     reproduced here: a fresh object, which is the account's from then on. */
  const signedInAs = (registered) => {
    let user = registered;
    if (auth.currentUser && auth.currentUser.uid === registered.uid) {
      user = Object.assign({}, registered);
      Object.values(auth.accounts).forEach((a) => { if (a.user === registered) a.user = user; });
    }
    auth.currentUser = user;
    if (!auth.late) return notify(user).then(() => ({ user }));
    setImmediate(() => { if (user.uid !== lastUid) deliver(user); });
    return Promise.resolve({ user });
  };
  const auth = {
    currentUser: null,
    /* The accounts that exist: e-mail address -> { user, password }. One made
       through a provider has no password. */
    accounts: {},
    /* What happens in a provider's popup: { email, displayName } for the
       identity chosen in it, or { error: code }. */
    popup: null,
    late: false,
    redirected: false,
    signInAnonymously() {
      const user = {
        uid: "uidAnon" + (++anon), email: null, displayName: null, isAnonymous: true,
        /* Upgrading the anonymous user IN PLACE. The uid does not change, and
           the SDK shipped here (12.17.1) tells onAuthStateChanged about a change
           of uid only — so the page's handler is NOT called. The user object
           changes when the backend answers, not inside the call: a second
           submit made meanwhile still finds an anonymous user. */
        linkWithCredential(cred) {
          return Promise.resolve().then(() => {
            if (auth.accounts[cred.email]) return fail("auth/email-already-in-use");
            user.isAnonymous = false;
            user.email = cred.email;
            auth.accounts[cred.email] = { user, password: cred.password };
            return { user };
          });
        },
        /* The same upgrade through a provider. An identity that already is an
           account of its own cannot be linked: the error carries a credential
           to sign in to that account with. */
        linkWithPopup() {
          const p = auth.popup;
          return Promise.resolve().then(() => {
            if (p.error) return fail(p.error);
            if (auth.accounts[p.email]) {
              return fail("auth/credential-already-in-use", { credential: { provider: p.email } });
            }
            user.isAnonymous = false;
            user.email = p.email;
            user.displayName = p.displayName || null;
            auth.accounts[p.email] = { user };
            return { user };
          });
        },
        // The page is left for the provider's: this never resolves.
        linkWithRedirect() { auth.redirected = true; return new Promise(() => {}); }
      };
      auth.currentUser = user;
      return notify(user).then(() => ({ user }));
    },
    signInWithEmailAndPassword(email, password) {
      return auth.signInWithCredential({ email, password });
    },
    signInWithCredential(cred) {
      const a = auth.accounts[cred.provider || cred.email];
      if (!a) return fail("auth/user-not-found");
      if (!cred.provider && a.password !== cred.password) return fail("auth/wrong-password");
      return signedInAs(a.user);
    },
    createUserWithEmailAndPassword(email, password) {
      if (auth.accounts[email]) return fail("auth/email-already-in-use");
      const user = { uid: "uidNew" + (++made), email, displayName: null, isAnonymous: false };
      auth.accounts[email] = { user, password };
      return signedInAs(user);
    },
    signInWithPopup() {
      const p = auth.popup;
      if (p.error) return fail(p.error);
      if (!auth.accounts[p.email]) {
        auth.accounts[p.email] = { user: {
          uid: "uidNew" + (++made), email: p.email, displayName: p.displayName || null, isAnonymous: false } };
      }
      return signedInAs(auth.accounts[p.email].user);
    },
    signInWithRedirect() { auth.redirected = true; return new Promise(() => {}); },
    signOut() { auth.currentUser = null; return notify(null); }
  };

  const sandbox = Object.assign({
    console: { warn() {}, info() {}, error() {}, log() {} },
    window: {}, document, localStorage, el, db,
    setTimeout: () => 0,
    Event: class { constructor(type) { this.type = type; } },
    firebase: { auth: {
      EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
      GoogleAuthProvider: class { setCustomParameters() {} },
      OAuthProvider: class { setCustomParameters() {} addScope() {} }
    } },
    auth: o.backend ? auth : null,
    currentUser: null, currentProfile: null,
    authReady: null, _authReadyResolve: null, _anonSignInPromise: null,
    stableId: "s0", STABLE_ID_KEY: "canamed_stable_id",
    /* The clock a saved profile is dated with; lib.js's own, as on the page. */
    serverNow: lib.serverNow,
    COHORTS: [{ id: "Caen", label: "Caen" }, { id: "Nagoya", label: "Nagoya" }],
    CFG: {}, tc: (x) => x, t: (k) => k,
    resetStableId() {},
    dialogShow(dlg) { dlg.open = true; },
    dialogClose(dlg) { dlg.open = false; },
    runWithdrawalFlow() {}, wireEmailAuthForm() {}
  }, o.globals);
  vm.createContext(sandbox);
  vm.runInContext(["ensureSignedIn", "splashShowView", "splashHintErr", "splashHintOk", "authErrorMessage",
    "scorePassword", "signInWithProvider", "signInWithEmail", "signUpWithEmail"]
    .map((fn) => extractFn(SCRIPT, fn)).join("\n") + "\n" + ACCOUNT_SECTION + "\n" + o.source, sandbox);
  /* Count the calls of the page's handler, the page's own included: a function
     declared at the top of the script is a property of this sandbox, and the
     script's own calls look it up there. */
  const handler = sandbox.handleAuthStateChange;
  sandbox.handleAuthStateChange = (user) => { handled.push(user ? user.uid : null); return handler(user); };

  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const role = (name) => (radios[name].find((r) => r.checked) || {}).value;
  return {
    sandbox, db, auth, el, settle, reported, handled,
    run: (code) => vm.runInContext(code, sandbox),
    /* An account signs in. `profile` is what it already has stored, if any. */
    async signIn(user, profile) {
      if (profile) db.seed("users/" + user.uid + "/profile", profile);
      auth.currentUser = user;
      deliver(user);
      await settle();
    },
    /* The page's own "Sign out". */
    async signOut() { sandbox.accountSignOut(); await settle(); },
    /* The account goes away without this page asking: deleted, revoked, or
       signed out from another tab. */
    async vanish() {
      auth.currentUser = null;
      deliver(null);
      await settle();
    },
    /* One account replaces another in a single event, with no "nobody" in
       between: what the SDK reports when somebody signs in while another
       account is still signed in. */
    async replaceWith(user) {
      auth.currentUser = user;
      deliver(user);
      await settle();
    },
    /* The state every visitor starts in: the anonymous user. */
    async visit() { sandbox.ensureSignedIn(); await settle(); },
    /* ANOTHER TAB of this browser creates the account. The SDK copies the
       change into this tab's user object and, the uid being the same, reports
       nothing: the user here is an account and the page has not been told. */
    otherTabUpgrades(email, password) {
      const user = auth.currentUser;
      user.isAnonymous = false;
      user.email = email;
      auth.accounts[email] = { user, password };
    },
    views: () => VIEWS.filter((v) => !el("splash-view-" + v).hidden),
    /* Who the page says is signed in, and whether either opener of the account
       dialog is on screen. */
    signedIn: () => ({
      row: !el("splash-signed-in").hidden, chip: !el("user-chip").classList.contains("hidden"),
      name: el("splash-signed-in-name").textContent
    }),
    /* The lobby's "Join as a participant" form. */
    joinForm: () => ({
      name: el("name-input").value, university: el("uni-input").value,
      year: el("year-input").value, english: el("english-input").value
    }),
    /* The sign-in / sign-up form on the front page. */
    signInForm: () => ({
      email: el("splash-email-input").value, password: el("splash-password-input").value,
      confirm: el("splash-password-confirm").value
    }),
    typeSignIn(v) {
      el("splash-email-input").value = v.email;
      el("splash-password-input").value = v.password;
      el("splash-password-confirm").value = v.confirm || "";
    },
    /* The dialog's "Sessions you have joined": the codes of the rows in it, and
       how many of those rows carry a wired Withdraw button. */
    sessionsListed: () => el("account-history").children
      .filter((li) => li.className === "account-history-row").map((li) => li.children[0].textContent),
    withdrawButtons: () => el("account-history").children.filter((li) =>
      li.children.some((c) => /account-history-withdraw/.test(c.className) && c.count("click") > 0)).length,
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
    await w.signIn(ALICE);

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
  await w.signIn(ALICE);
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

/* ======================= D. one account replacing another directly =========
 *
 * FOUND IN REVIEW (PR #440, finding 1). Emptying the forms when the uid changes
 * was not enough: `currentProfile`, the header chip and the front page's
 * "Signed in as …" row were only replaced when the NEW account's profile read
 * came back, and the dialog reads `currentProfile` on every open.
 *
 * Alice leaves herself signed in on a shared machine. Bob clicks "Sign in with
 * Google or email…" — nothing hides it while someone is signed in — and signs
 * in; the SDK swaps them in ONE event, with no "nobody" in between. Until his
 * read returned (and for good if it hung) the page went on saying "Signed in as
 * Alice · Account"; he clicked Account and got his e-mail address above her
 * name, university, year and level, and Save wrote them over his own stored
 * profile.
 *
 * Every other test here signs the first account out before the second signs
 * in, which is why none of them saw it.
 */

const BOB_PROFILE = { name: "Bob", university: "Caen", year: 2, english: "B1", role: "student", createdAt: 5, updatedAt: 5 };
const HERS = { name: "Alice", university: "Nagoya", year: "5", english: "C1" };

test("D: an account that replaces another directly is shown nothing of it while its own profile is being read", async () => {
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Alice" }, "premise");
  w.db.seed("users/uidBob/profile", BOB_PROFILE);
  w.db.hold("users/uidBob/profile");           // a slow network: his read is in flight
  await w.replaceWith(BOB);

  assert.strictEqual(w.sandbox.currentUser.uid, "uidBob", "premise: he is the current user");
  assert.strictEqual(w.sandbox.currentProfile, null, "her profile must not stay current for him");
  assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false],
    "neither opener may stay on screen saying 'Signed in as Alice' — nor come back before HIS profile is read");

  /* Nothing on screen opens the dialog now. Opened by any other route it still
     must not hold her values. Save from there then writes nothing — but ONLY
     because the name field is empty and Save refuses an empty name: with a name
     typed it would replace his stored profile with the defaults. That is why
     the openers are hidden until his profile has been read, and not repainted
     at once ("D-repaint" in the put-backs). */
  w.sandbox.openAccountDialog();
  const d = w.dialog();
  assert.strictEqual(d.email, "bob@example.test", "premise: the dialog is his");
  for (const k of Object.keys(HERS)) assert.notStrictEqual(d[k], HERS[k], "her " + k + " in his dialog");
  w.sandbox.accountSaveBtn();
  await w.settle();
  assert.strictEqual(w.el("account-action-hint").textContent, "Enter your name.",
    "it is the empty name that stops this Save, nothing else");
  assert.deepStrictEqual(w.db.get("users/uidBob/profile"), BOB_PROFILE,
    "so none of her values are written over his profile");
  w.sandbox.closeAccountDialog();

  w.db.release("users/uidBob/profile");
  await w.settle();
  assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Bob" },
    "once his own profile has been read the openers come back — as his");
  w.sandbox.openAccountDialog();
  assert.deepStrictEqual(w.dialog(),
    { email: "bob@example.test", name: "Bob", university: "Caen", year: "2", english: "B1", role: "student" });
  w.sandbox.accountSaveBtn();
  await w.settle();
  assert.deepStrictEqual(w.stored("uidBob"),
    { name: "Bob", university: "Caen", year: 2, english: "B1", role: "student" },
    "and Save keeps what was his");
});

test("D: an account with no profile that replaces another directly is asked for its own (positive control)", async () => {
  /* Hiding the openers until the read lands must not hide them for good when
     the read comes back empty. */
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  await w.replaceWith(BOB);
  assert.strictEqual(w.sandbox.currentProfile, null);
  assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "bob@example.test" });
  assert.deepStrictEqual(w.views(), ["profile-setup"]);
  assert.strictEqual(w.setupForm().name, "bob");
});

/* ======================= E. the lobby's join form ==========================
 *
 * FOUND IN REVIEW (finding 2), and older than this file. applyProfileToJoinForm()
 * fills the lobby's "Join as a participant" form whenever a profile is loaded
 * or saved, and nothing took it out again when the account went. Alice signs in
 * and out; the next student types a session code in the same tab and is
 * offered "Alice", Year 5, C1.
 *
 * What is given back is what the ACCOUNT put there, and nothing else: a field
 * the participant typed or chose before signing in goes back to that, one they
 * changed afterwards is left as they changed it, and a name that was ALREADY in
 * the field when the profile was applied was never the account's.
 *
 * "Still holds what the account put" is a comparison of VALUES, so two cases
 * count as the account's although a person could argue otherwise, and both are
 * pinned below rather than left implied: a field re-entered by hand with the
 * very value the account had put; and a name the account filled first that
 * initLobby() then "restores" from `canamed_name` as the same string.
 */

const NOBODY = { name: "", university: "", year: "1", english: "B2" };

test("E: the lobby's join form holds nothing of an account that has signed out", async () => {
  const w = makeWorld();
  assert.deepStrictEqual(w.joinForm(), NOBODY, "premise: the form as index.html ships it");
  await w.signIn(ALICE, ALICE_PROFILE);
  assert.deepStrictEqual(w.joinForm(), { name: "Alice", university: "Nagoya", year: "5", english: "C1" },
    "premise: a loaded profile fills the join form");
  await w.signOut();
  assert.deepStrictEqual(w.joinForm(), NOBODY, "the next student must not be offered her details");
});

test("E: nor of an account that another one replaced directly", async () => {
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.db.seed("users/uidBob/profile", BOB_PROFILE);
  w.db.hold("users/uidBob/profile");
  await w.replaceWith(BOB);
  assert.deepStrictEqual(w.joinForm(), NOBODY, "while his profile is being read: nothing of hers");
  w.db.release("users/uidBob/profile");
  await w.settle();
  assert.deepStrictEqual(w.joinForm(), { name: "Bob", university: "Caen", year: "2", english: "B1" });
});

test("E: what the participant had typed and chosen before signing in comes back", async () => {
  const w = makeWorld();
  await w.visit();
  w.el("name-input").value = "Zoe";
  w.el("uni-input").value = "Caen";
  w.el("year-input").value = "3";
  w.el("english-input").value = "B1";
  await w.signIn(ALICE, ALICE_PROFILE);
  assert.deepStrictEqual(w.joinForm(), { name: "Zoe", university: "Nagoya", year: "5", english: "C1" },
    "premise: the account overwrites the three lists and leaves a name that is already there");
  await w.signOut();
  assert.deepStrictEqual(w.joinForm(), { name: "Zoe", university: "Caen", year: "3", english: "B1" },
    "her choices go; the participant's own come back, not the defaults");
});

test("E: what the participant changed after the account filled the form is kept", async () => {
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.el("name-input").value = "Ali";
  w.el("year-input").value = "4";
  await w.signOut();
  assert.deepStrictEqual(w.joinForm(), { name: "Ali", university: "", year: "4", english: "B2" },
    "only the fields still holding what the account put there are given back");
});

test("E: a name that was already in the field when the profile was applied is not the account's to remove", async () => {
  /* The guard on the other side. The name is in the field BEFORE the profile
     lands — typed, or put there by an initLobby() that had already run — so
     the account never writes it, even when it is the profile's name too. */
  const w = makeWorld();
  await w.visit();
  w.el("name-input").value = "Alice";
  await w.signIn(ALICE, ALICE_PROFILE);
  await w.signOut();
  assert.strictEqual(w.joinForm().name, "Alice");
});

test("E: a name the account filled first is taken out even if the same name is put there again afterwards", async () => {
  /* The limit of the rule, recorded so that no comment promises more. On the
     front page the profile lands while the field is still empty, so the ACCOUNT
     fills the name; entering a session then runs initLobby(), which writes the
     name stored in `canamed_name` over it — the same string, if she joined
     under her profile name before. At sign-out the field still holds what the
     account put, and is emptied. `canamed_name` itself is not touched, and
     initLobby() restores from it again on the next entry. The same goes for a
     list re-picked by hand to the value the account had put. */
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  assert.strictEqual(w.joinForm().name, "Alice", "premise: the account filled the empty name");
  w.el("name-input").value = "Alice";          // initLobby(): nameInput.value = savedName
  w.el("uni-input").value = "Nagoya";          // picked again by hand, same value
  await w.signOut();
  assert.deepStrictEqual(w.joinForm(), NOBODY);
});

test("E: a profile saved again while signed in still gives the form back as it was before the account", async () => {
  /* The form is filled on load AND on every save. Undoing only the last fill
     would restore the account's own earlier values. */
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  w.el("account-year").value = "6";
  w.sandbox.accountSaveBtn();
  await w.settle();
  assert.strictEqual(w.joinForm().year, "6", "premise: a saved profile is applied to the join form again");
  await w.signOut();
  assert.deepStrictEqual(w.joinForm(), NOBODY);
});

/* ======================= F. the sign-in form ===============================
 *
 * FOUND IN REVIEW (finding 3), and older than this file. The front page's
 * e-mail sign-in form was only ever READ: a successful sign-in emptied nothing,
 * and neither did sign-out. So the previous person's e-mail address AND
 * PASSWORD stayed in the three inputs for as long as the tab lived — the next
 * person opens "Sign in", finds them, and "Sign in" enters her account.
 *
 * A sign-up needs its own test: it upgrades the anonymous user in place, the
 * uid does not change, and the SDK then reports nothing at all — so emptying
 * the form "when the account changes" never runs for it.
 */

const EMPTY = { email: "", password: "", confirm: "" };
const PASSWORD = "Correct-Horse-9";

test("F: a successful sign-in leaves no e-mail address or password in the form", async () => {
  const w = makeWorld();
  w.auth.accounts["alice@example.test"] = { user: ALICE, password: PASSWORD };
  w.db.seed("users/uidAlice/profile", ALICE_PROFILE);
  await w.visit();
  w.typeSignIn({ email: "alice@example.test", password: PASSWORD });
  w.sandbox.signInWithEmail("alice@example.test", PASSWORD);
  await w.settle();
  assert.strictEqual(w.sandbox.currentUser.uid, "uidAlice", "premise: she is signed in");
  assert.deepStrictEqual(w.signInForm(), EMPTY);
});

test("F: nor does signing in again to the account that is already signed in, which reports no change", async () => {
  /* The same uid again: the SDK tells the page nothing, so nothing that runs
     "when the account changes" runs. The sign-in's own success has to empty
     the form. */
  const w = makeWorld();
  w.auth.accounts["alice@example.test"] = { user: ALICE, password: PASSWORD };
  await w.signIn(ALICE, ALICE_PROFILE);
  w.typeSignIn({ email: "alice@example.test", password: PASSWORD });
  w.el("splash-account-hint").textContent = "stale";
  w.sandbox.signInWithEmail("alice@example.test", PASSWORD);
  await w.settle();
  assert.strictEqual(w.el("splash-account-hint").textContent, "", "premise: the sign-in succeeded");
  assert.strictEqual(w.sandbox.currentUser, ALICE, "premise: and no auth event replaced the user");
  assert.deepStrictEqual(w.signInForm(), EMPTY);
});

test("F: nor does a sign-up, which upgrades the anonymous visitor in place and reports no change", async () => {
  const w = makeWorld();
  await w.visit();
  const visitor = w.sandbox.currentUser;
  let inputEvents = 0;
  w.el("splash-password-input").addEventListener("input", () => { inputEvents++; });
  w.typeSignIn({ email: "new@example.test", password: PASSWORD, confirm: PASSWORD });
  w.sandbox.signUpWithEmail("new@example.test", PASSWORD);
  await w.settle();

  assert.strictEqual(w.auth.currentUser, visitor, "premise: the same user object, upgraded in place");
  assert.strictEqual(visitor.isAnonymous, false, "premise: the sign-up succeeded");
  assert.strictEqual(w.el("splash-account-hint").textContent, "", "premise: and reported no error");
  assert.deepStrictEqual(w.signInForm(), EMPTY);
  /* The strength meter is driven by the field's `input` event, which a value
     set from script does not fire. Without one it goes on showing how strong
     the previous person's password was. */
  assert.ok(inputEvents > 0, "emptying the password field must tell its listeners");
});

test("F: a sign-in that FAILS keeps what was typed, so that it can be corrected", async () => {
  // The guard on the other side: emptying is for a sign-in that worked.
  const w = makeWorld();
  w.auth.accounts["alice@example.test"] = { user: ALICE, password: PASSWORD };
  await w.visit();
  w.typeSignIn({ email: "alice@example.test", password: "a-typo" });
  w.sandbox.signInWithEmail("alice@example.test", "a-typo");
  await w.settle();
  assert.ok(w.sandbox.currentUser.isAnonymous, "premise: nobody was signed in");
  assert.strictEqual(w.el("splash-account-hint").className, "splash-hint err", "premise: the failure is shown");
  assert.deepStrictEqual(w.signInForm(), { email: "alice@example.test", password: "a-typo", confirm: "" });
});

for (const how of ["signOut", "vanish", "replaceWith"]) {
  test("F: whatever is in the form is emptied when the account goes or changes (" + how + ")", async () => {
    /* The sign-in view stays reachable while somebody is signed in, so the form
       can hold a half-typed address and password when the account goes. */
    const w = makeWorld();
    await w.signIn(ALICE, ALICE_PROFILE);
    w.typeSignIn({ email: "bob@example.test", password: PASSWORD, confirm: PASSWORD });
    if (how === "replaceWith") await w.replaceWith(BOB); else await w[how]();
    assert.deepStrictEqual(w.signInForm(), EMPTY);
  });
}

test("F: the first auth event of a page load leaves the form alone", async () => {
  /* Nobody -> the anonymous visitor is a change of uid too, but no account has
     gone: what is in the form then was put there by the browser (a password
     manager fills it as the page loads), not by a previous person in this tab. */
  const w = makeWorld();
  w.typeSignIn({ email: "saved@example.test", password: "from-the-browser" });
  await w.visit();
  assert.ok(w.sandbox.currentUser.isAnonymous, "premise: the first event has arrived");
  assert.deepStrictEqual(w.signInForm(), { email: "saved@example.test", password: "from-the-browser", confirm: "" });
});

test("F: Back from the sign-in view empties the form, so an attempt that failed is not left in it", async () => {
  /* FOUND IN REVIEW, round 2. A failed attempt rightly keeps what was typed —
     but "Back" only switched the view, so the address and the near-miss
     password stayed in the hidden form until some account changed, and nobody's
     had: the next person to open "Sign in" found them. */
  const w = makeWorld();
  w.auth.accounts["alice@example.test"] = { user: ALICE, password: PASSWORD };
  w.sandbox.wireAccountUI();
  await w.visit();
  w.sandbox.splashShowView("account");
  w.typeSignIn({ email: "alice@example.test", password: "Correct-Horse-8" });
  w.sandbox.signInWithEmail("alice@example.test", "Correct-Horse-8");
  await w.settle();
  assert.ok(w.sandbox.currentUser.isAnonymous, "premise: the attempt failed");
  assert.deepStrictEqual(w.signInForm(), { email: "alice@example.test", password: "Correct-Horse-8", confirm: "" },
    "premise: and what was typed is still there, to be corrected");

  w.el("splash-back-from-account").fire("click");

  assert.deepStrictEqual(w.views(), ["enter"], "premise: Back still goes back");
  assert.deepStrictEqual(w.signInForm(), EMPTY);
});

/* ======================= G. a save acknowledged too late ===================
 *
 * FOUND IN REVIEW (finding 4). The late profile READ is dropped when its
 * account has gone (section B); the acknowledgement of a profile SAVE was not.
 * If the account changes while a save is in flight, the acknowledgement made
 * the departed account's profile the current one, repainted the row with its
 * name, refilled the lobby's join form with it — and, from profile setup, sent
 * whoever was now on screen back to "enter a session".
 */

test("G: a profile-setup save acknowledged after another account took over changes nothing for that account", async () => {
  const w = makeWorld();
  await w.signIn(ALICE);                      // a new account, on profile setup
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.db.holdAck("users/uidAlice/profile");
  w.sandbox.profileSetupSubmit();             // the write is sent; its acknowledgement is not back
  await w.settle();
  await w.replaceWith(BOB);                   // Bob signs in meanwhile: a new account too
  assert.deepStrictEqual(w.views(), ["profile-setup"], "premise: Bob is asked for HIS profile");
  assert.strictEqual(w.setupForm().name, "bob", "premise");

  w.db.releaseAck("users/uidAlice/profile");
  await w.settle();

  assert.strictEqual(w.sandbox.currentProfile, null, "her saved profile must not become his current one");
  assert.deepStrictEqual(w.views(), ["profile-setup"], "her acknowledgement must not take his form away");
  assert.strictEqual(w.signedIn().name, "bob@example.test", "nor repaint the row with her name");
  assert.strictEqual(w.joinForm().name, "", "nor fill the lobby's join form with it");
  assert.deepStrictEqual(w.stored("uidAlice"),
    { name: "Alice A", university: "Nagoya", role: "student", year: 5, english: "C1" },
    "her own save did land — it was hers to make");
});

test("G: a save from the dialog acknowledged after sign-out changes nothing for the visitor", async () => {
  const w = makeWorld();
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  w.el("account-name").value = "Alice B";
  w.db.holdAck("users/uidAlice/profile");
  w.sandbox.accountSaveBtn();
  await w.settle();
  await w.signOut();
  assert.ok(w.sandbox.currentUser.isAnonymous, "premise: she has gone before the acknowledgement");

  w.db.releaseAck("users/uidAlice/profile");
  await w.settle();

  assert.strictEqual(w.sandbox.currentProfile, null);
  assert.notStrictEqual(w.el("account-action-hint").textContent, "Profile saved.");
  assert.deepStrictEqual(w.joinForm(), NOBODY, "the join form must not be refilled with her details");
  assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false]);
});

test("G: her 'Saving your profile…' is not left on the next account's setup form", async () => {
  /* FOUND IN REVIEW, round 2. The stale acknowledgement now changes nothing —
     including the status line her submit had written, which sat on HIS form. */
  const w = makeWorld();
  await w.signIn(ALICE);
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.db.holdAck("users/uidAlice/profile");
  w.sandbox.profileSetupSubmit();
  await w.settle();
  assert.match(w.el("splash-profile-setup-hint").textContent, /^Saving your profile/, "premise");

  await w.replaceWith(BOB);

  assert.deepStrictEqual(w.views(), ["profile-setup"], "premise: he is on his own setup form");
  assert.strictEqual(w.el("splash-profile-setup-hint").textContent, "");
  assert.strictEqual(w.el("splash-profile-setup-hint").className, "splash-hint");
});

test("G: nor is 'Could not save' when her save is refused after she has gone, on either form", async () => {
  const denied = Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });

  // From profile setup, with Bob taking over before the refusal arrives.
  const w = makeWorld();
  await w.signIn(ALICE);
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.db.holdAck("users/uidAlice/profile");
  w.sandbox.profileSetupSubmit();
  await w.settle();
  await w.replaceWith(BOB);
  w.db.releaseAck("users/uidAlice/profile", denied);
  await w.settle();
  assert.strictEqual(w.el("splash-profile-setup-hint").textContent, "",
    "her refusal must not be reported on his setup form");
  assert.deepStrictEqual(w.views(), ["profile-setup"]);

  // From the dialog, with a sign-out before the refusal arrives.
  const v = makeWorld();
  await v.signIn(ALICE, ALICE_PROFILE);
  v.sandbox.openAccountDialog();
  v.el("account-name").value = "Alice B";
  v.db.holdAck("users/uidAlice/profile");
  v.sandbox.accountSaveBtn();
  await v.settle();
  await v.signOut();
  v.db.releaseAck("users/uidAlice/profile", denied);
  await v.settle();
  assert.strictEqual(v.el("account-action-hint").textContent, "",
    "nor in the dialog the next account will open");
});

test("G: a save refused for the account still signed in is reported (positive control)", async () => {
  // Without this, dropping a stale refusal could pass by dropping every refusal.
  const w = makeWorld();
  await w.signIn(ALICE);
  w.fill("splash-prof", { name: "Alice A", university: "Nagoya", year: "5", english: "C1" });
  w.db.holdAck("users/uidAlice/profile");
  w.sandbox.profileSetupSubmit();
  await w.settle();
  w.db.releaseAck("users/uidAlice/profile", new Error("denied"));
  await w.settle();
  assert.strictEqual(w.el("splash-profile-setup-hint").textContent, "Could not save: denied");
  assert.strictEqual(w.el("splash-profile-setup-hint").className, "splash-hint err");
});

/* ======================= H. the dialog's list of joined sessions ===========
 *
 * FOUND IN REVIEW, round 2 (blocking), and older than this file. The dialog's
 * "Sessions you have joined" list was emptied only INSIDE the listener's
 * callback, and the dialog was shown straight after subscribing. So Alice opens
 * Account and signs out, or is replaced; Bob signs in and opens Account; and
 * under his e-mail address and name he sees HER rows — session code, date
 * joined, scenario name — for one database round trip, or for good if that
 * answer never comes (the listener has no error handler). Their Withdraw
 * buttons were live, and would have acted on her session codes under his uid.
 *
 * No test saw it because LocalDB, and this file's fake until now, answered
 * on("value") inside the call. The real database answers later.
 */

const HER_SESSIONS = {
  "abc-123": { code: "abc-123", joinedAt: 2000, scenarioName: "Opioid stewardship" },
  "def-456": { code: "def-456", joinedAt: 1000 }
};
const HIS_SESSIONS = { "xyz-789": { code: "xyz-789", joinedAt: 3000 } };

for (const how of ["signOut", "replaceWith"]) {
  test("H: the next account's dialog lists none of the previous account's sessions while its own list is being read (" +
       how + ")", async () => {
    const w = makeWorld();
    w.db.seed("users/uidAlice/history", HER_SESSIONS);
    w.db.seed("users/uidBob/history", HIS_SESSIONS);
    w.db.seed("users/uidBob/profile", BOB_PROFILE);
    await w.signIn(ALICE, ALICE_PROFILE);
    w.sandbox.openAccountDialog();
    await w.settle();
    assert.deepStrictEqual(w.sessionsListed(), ["ABC-123", "DEF-456"], "premise: her dialog lists her sessions");
    assert.strictEqual(w.withdrawButtons(), 2, "premise: each with a Withdraw button");

    w.db.holdOn("users/uidBob/history");        // his list has not come back yet
    if (how === "signOut") { await w.signOut(); await w.signIn(BOB); } else await w.replaceWith(BOB);
    w.sandbox.openAccountDialog();
    await w.settle();

    assert.strictEqual(w.el("account-dialog").open, true, "premise: his dialog is open");
    assert.strictEqual(w.el("account-email").textContent, "bob@example.test", "premise");
    assert.deepStrictEqual(w.sessionsListed(), [], "none of her sessions under his name");
    assert.strictEqual(w.withdrawButtons(), 0,
      "and no Withdraw button that would act on her session codes under his uid");

    w.db.releaseOn("users/uidBob/history");
    await w.settle();
    assert.deepStrictEqual(w.sessionsListed(), ["XYZ-789"], "then his own, and only his own");
  });
}

test("H: a dialog reopened after Escape shows no row it has not just read", async () => {
  /* Escape closes a native <dialog> without telling the page, so nothing was
     emptied on the way out. Emptying BEFORE subscribing is what keeps a list
     that has not been read — or cannot be — from standing there with live
     buttons. */
  const w = makeWorld();
  w.db.seed("users/uidAlice/history", HER_SESSIONS);
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  await w.settle();
  assert.strictEqual(w.sessionsListed().length, 2, "premise");

  w.el("account-dialog").open = false;          // Escape: no closeAccountDialog()
  w.db.holdOn("users/uidAlice/history");
  w.sandbox.openAccountDialog();
  await w.settle();
  assert.deepStrictEqual(w.sessionsListed(), []);
  assert.strictEqual(w.withdrawButtons(), 0);

  w.db.releaseOn("users/uidAlice/history");
  await w.settle();
  assert.deepStrictEqual(w.sessionsListed(), ["ABC-123", "DEF-456"]);
});

test("H: when the account goes, nothing of its list is left in the closed dialog", async () => {
  const w = makeWorld();
  w.db.seed("users/uidAlice/history", HER_SESSIONS);
  await w.signIn(ALICE, ALICE_PROFILE);
  w.sandbox.openAccountDialog();
  await w.settle();
  assert.strictEqual(w.sessionsListed().length, 2, "premise");
  await w.signOut();
  assert.strictEqual(w.el("account-dialog").open, false, "premise: signing out closed the dialog");
  assert.deepStrictEqual(w.sessionsListed(), []);
});

test("H: an answer for a list that is no longer subscribed goes nowhere (positive control for the detach)", async () => {
  /* Her dialog is open with her list still unanswered when Bob replaces her.
     The page detaches her listener on the way; were it still attached, her
     rows would be written into his dialog when the answer finally came. */
  const w = makeWorld();
  w.db.seed("users/uidAlice/history", HER_SESSIONS);
  w.db.seed("users/uidBob/profile", BOB_PROFILE);
  await w.signIn(ALICE, ALICE_PROFILE);
  w.db.holdOn("users/uidAlice/history");
  w.sandbox.openAccountDialog();
  await w.settle();
  await w.replaceWith(BOB);
  w.sandbox.openAccountDialog();
  await w.settle();
  assert.deepStrictEqual(w.sessionsListed(), [], "premise: he has no sessions, and the list says so");

  w.db.releaseOn("users/uidAlice/history");
  await w.settle();
  assert.deepStrictEqual(w.sessionsListed(), [], "her late answer must not fill his dialog");
});

/* ======================= I. an upgrade the SDK does not report =============
 *
 * A SIGN-UP, OR A FIRST GOOGLE SIGN-IN, LEFT THE PAGE AS IT WAS UNTIL A RELOAD.
 * Every visitor is signed in anonymously, and creating an account LINKS that
 * anonymous user: the uid is kept, so that what is stored under it stays the
 * account's. The SDK shipped here (12.17.1) tells onAuthStateChanged about a
 * change of UID only, so after a link it says nothing — and nothing else called
 * the page's handler. The visitor was signed in with no chip, no "signed in as"
 * row, no profile setup and no way to sign out; and since the form is emptied
 * on success (section F), it looked like a form that had silently reset.
 *
 * The page now takes the upgraded user through the SAME handler the SDK calls.
 * The other half is what must not change: wherever the SDK does report (the uid
 * changed), the handler still runs once, not twice — in either order of "the
 * call resolved" and "the listener was told".
 */

const NEW = "new@example.test";

/* A visitor on the front page's sign-in view. */
async function onSignInView() {
  const w = makeWorld();
  w.sandbox.wireAccountUI();
  await w.visit();
  w.sandbox.splashShowView("account");
  return w;
}

/* The two ways an anonymous visitor becomes an account with no change of uid.
   `name` is what profile setup then starts from. */
const UPGRADES = [
  { how: "an e-mail sign-up", name: "new", go(w) {
    w.typeSignIn({ email: NEW, password: PASSWORD, confirm: PASSWORD });
    w.sandbox.signUpWithEmail(NEW, PASSWORD);
  } },
  { how: "a first Google sign-in", name: "Nova", go(w) {
    // An address and a password typed first, then the Google button instead.
    w.typeSignIn({ email: "half@example.test", password: "Half-typed-1" });
    w.auth.popup = { email: NEW, displayName: "Nova Example" };
    w.sandbox.signInWithProvider("google");
  } }
];
const profileReads = (w, uid) => w.db.reads.filter((p) => p === "users/" + uid + "/profile").length;

for (const up of UPGRADES) {
  test("I: after " + up.how + " the visitor is shown as signed in and asked for a profile, with no reload", async () => {
    const w = await onSignInView();
    const visitor = w.sandbox.currentUser;
    const uid = visitor.uid;
    const told = w.reported.length;
    assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false],
      "premise: an anonymous visitor is shown as nobody");

    up.go(w);
    await w.settle();

    assert.strictEqual(w.auth.currentUser, visitor, "premise: the same user, upgraded in place");
    assert.deepStrictEqual([visitor.uid, visitor.isAnonymous], [uid, false], "premise: with the uid it had");
    assert.strictEqual(w.reported.length, told, "premise: and the SDK reported nothing");

    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: NEW },
      "the chip and the 'signed in as' row, which carry Account and Sign out");
    assert.strictEqual(profileReads(w, uid), 1, "the account's profile is read");
    assert.deepStrictEqual(w.views(), ["profile-setup"], "and, having none, it is asked for one");
    assert.strictEqual(w.setupForm().name, up.name);
    assert.strictEqual(w.el("splash-account-hint").textContent, "");
    assert.deepStrictEqual(w.signInForm(), EMPTY, "the sign-in form is emptied, as after any sign-in");
  });

  test("I: she can then save her profile, open her account and sign out (" + up.how + ")", async () => {
    const w = await onSignInView();
    const uid = w.sandbox.currentUser.uid;
    up.go(w);
    await w.settle();
    assert.deepStrictEqual(w.views(), ["profile-setup"]);

    w.fill("splash-prof", { name: "Nova", university: "Caen", year: "3", english: "C1" });
    w.sandbox.profileSetupSubmit();
    await w.settle();
    assert.deepStrictEqual(w.stored(uid), { name: "Nova", university: "Caen", role: "student", year: 3, english: "C1" });
    assert.deepStrictEqual(w.views(), ["enter"]);
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Nova" });

    w.el("splash-signed-in-account").fire("click");
    assert.strictEqual(w.el("account-dialog").open, true);
    assert.strictEqual(w.dialog().email, NEW);
    w.el("account-signout-btn").fire("click");
    await w.settle();
    assert.ok(w.sandbox.currentUser.isAnonymous && w.sandbox.currentUser.uid !== uid,
      "signed out: a new anonymous visitor");
    assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false]);
    assert.strictEqual(w.el("account-dialog").open, false);
  });

  test("I: what is stored under the visitor's uid is the account's at once (" + up.how + ")", async () => {
    /* The promise the link makes: the uid is kept, so a profile and a list of
       sessions stored under it are the new account's. They are read from that
       same uid straight away; and work is stamped with the uid from then on,
       which is what a reload did. */
    const w = await onSignInView();
    const uid = w.sandbox.currentUser.uid;
    w.db.seed("users/" + uid + "/profile", ALICE_PROFILE);
    w.db.seed("users/" + uid + "/history", HER_SESSIONS);
    assert.notStrictEqual(w.sandbox.stableId, uid, "premise: an anonymous visitor's work carries a random id");

    up.go(w);
    await w.settle();

    assert.strictEqual(w.sandbox.currentUser.uid, uid, "premise: the uid is kept");
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Alice" });
    assert.deepStrictEqual(w.views(), ["enter"], "an account that has a profile goes back to 'enter a session'");
    assert.deepStrictEqual(w.joinForm(), { name: "Alice", university: "Nagoya", year: "5", english: "C1" });
    w.el("splash-signed-in-account").fire("click");
    await w.settle();
    assert.deepStrictEqual(w.sessionsListed(), ["ABC-123", "DEF-456"]);
    assert.strictEqual(w.sandbox.stableId, uid);
    assert.strictEqual(w.sandbox.localStorage.getItem("canamed_stable_id"), uid);
  });

  test("I: " + up.how + " is not a change of account: what the visitor typed in the join form stays", async () => {
    const w = await onSignInView();
    const uid = w.sandbox.currentUser.uid;
    const typed = { name: "Typed Name", university: "Caen", year: "3", english: "C1" };
    w.el("name-input").value = typed.name;
    w.el("uni-input").value = typed.university;
    w.el("year-input").value = typed.year;
    w.el("english-input").value = typed.english;
    const before = w.handled.length;

    up.go(w);
    await w.settle();

    assert.deepStrictEqual(w.handled.slice(before), [uid], "the upgraded user is handled once");
    assert.deepStrictEqual(w.joinForm(), typed);
  });
}

test("I: signing in again through Google to the account already shown changes nothing on the page", async () => {
  /* The other same-uid case, and the one where a dialog can be open: the page
     already shows this account, the SDK reports nothing, and nothing is to be
     handled again — what she is in the middle of is hers. */
  const w = makeWorld();
  w.sandbox.wireAccountUI();
  w.auth.accounts[ALICE.email] = { user: ALICE };
  await w.signIn(ALICE, ALICE_PROFILE);
  w.el("splash-signed-in-account").fire("click");
  w.el("account-name").value = "Alice, halfway through";
  const before = w.handled.length;

  w.auth.popup = { email: ALICE.email };
  w.sandbox.signInWithProvider("google");
  await w.settle();

  assert.strictEqual(w.el("splash-account-hint").textContent, "", "premise: the sign-in succeeded");
  assert.deepStrictEqual(w.handled.slice(before), [], "nothing to handle: same account, already shown");
  assert.strictEqual(w.el("account-dialog").open, true);
  assert.strictEqual(w.dialog().name, "Alice, halfway through");
  assert.deepStrictEqual(w.joinForm(), { name: "Alice", university: "Nagoya", year: "5", english: "C1" });
});

/* Where the uid DOES change, the SDK reports the user and the page must not
   handle it a second time. */
const REPORTED = [
  { what: "a sign-up with an address that already has an account", go(w) {
    w.typeSignIn({ email: ALICE.email, password: PASSWORD, confirm: PASSWORD });
    w.sandbox.signUpWithEmail(ALICE.email, PASSWORD);
  } },
  { what: "a plain sign-in", go(w) {
    w.typeSignIn({ email: ALICE.email, password: PASSWORD });
    w.sandbox.signInWithEmail(ALICE.email, PASSWORD);
  } },
  { what: "a Google sign-in to an account that already exists", go(w) {
    w.auth.popup = { email: ALICE.email };
    w.sandbox.signInWithProvider("google");
  } }
];

for (const late of [false, true]) {
  const order = "the SDK's report arriving " + (late ? "after" : "before") + " the call resolves";

  for (const r of REPORTED) {
    test("I: " + r.what + " is handled once, not twice (" + order + ")", async () => {
      const w = await onSignInView();
      w.auth.accounts[ALICE.email] = { user: ALICE, password: PASSWORD };
      w.db.seed("users/uidAlice/profile", ALICE_PROFILE);
      w.auth.late = late;
      const before = w.handled.length;

      r.go(w);
      await w.settle();

      assert.strictEqual(w.sandbox.currentUser, ALICE, "premise: she is signed in, under her own uid");
      assert.deepStrictEqual(w.handled.slice(before), ["uidAlice"]);
      assert.strictEqual(profileReads(w, "uidAlice"), 1);
      assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Alice" });
      assert.deepStrictEqual(w.views(), ["enter"]);
      assert.deepStrictEqual(w.signInForm(), EMPTY);
    });
  }

  test("I: an account shown that signs in as ANOTHER account is handled once, not twice (" + order + ")", async () => {
    const w = makeWorld();
    w.sandbox.wireAccountUI();
    w.auth.accounts[BOB.email] = { user: BOB, password: PASSWORD };
    w.db.seed("users/uidBob/profile", BOB_PROFILE);
    await w.signIn(ALICE, ALICE_PROFILE);
    w.auth.late = late;
    const before = w.handled.length;

    w.typeSignIn({ email: BOB.email, password: PASSWORD });
    w.sandbox.signInWithEmail(BOB.email, PASSWORD);
    await w.settle();

    assert.deepStrictEqual(w.handled.slice(before), ["uidBob"]);
    assert.strictEqual(profileReads(w, "uidBob"), 1);
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Bob" });
    assert.deepStrictEqual(w.signInForm(), EMPTY);
  });

  test("I: after another tab made the visitor an account, signing in here as ANOTHER account and then as that one " +
       "is handled once each (" + order + ")", async () => {
    /* FOUND IN REVIEW, round 2. Two things no test held. The page must look at
       the user the SDK has NOW, not at the one it was last told about: in the
       second-tab state that one is an account under the uid the page still
       shows as a visitor, so a sign-in to somebody else would be handled as
       it. And a reported ACCOUNT must clear what the page remembers of that
       visitor, or signing in to the visitor's own account afterwards — a change
       of uid, which the SDK reports — is handled by the page as well. */
    const w = await onSignInView();
    const uid = w.sandbox.currentUser.uid;
    w.auth.accounts[ALICE.email] = { user: ALICE, password: PASSWORD };
    w.db.seed("users/uidAlice/profile", ALICE_PROFILE);
    w.otherTabUpgrades(NEW, PASSWORD);
    w.auth.late = late;

    let before = w.handled.length;
    w.typeSignIn({ email: ALICE.email, password: PASSWORD });
    w.sandbox.signInWithEmail(ALICE.email, PASSWORD);
    await w.settle();
    assert.deepStrictEqual(w.handled.slice(before), ["uidAlice"], "another account: the SDK's report, and only that");
    assert.strictEqual(w.sandbox.currentUser, w.auth.currentUser);
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: "Alice" });

    before = w.handled.length;
    w.typeSignIn({ email: NEW, password: PASSWORD });
    w.sandbox.signInWithEmail(NEW, PASSWORD);
    await w.settle();
    assert.deepStrictEqual(w.handled.slice(before), [uid],
      "then the account the other tab made: a change of uid, so the SDK's report again and only that");
    assert.strictEqual(w.sandbox.currentUser, w.auth.currentUser);
    assert.strictEqual(profileReads(w, uid), 1);
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: NEW });
    assert.deepStrictEqual(w.views(), ["profile-setup"]);
  });

  test("I: a sign-up when there is no anonymous visitor to upgrade is handled once, not twice (" + order + ")", async () => {
    // Anonymous sign-in refused or not answered yet: the account is created outright.
    const w = makeWorld();
    w.sandbox.wireAccountUI();
    w.sandbox.splashShowView("account");
    w.auth.late = late;
    assert.strictEqual(w.auth.currentUser, null, "premise: nobody at all");

    w.typeSignIn({ email: NEW, password: PASSWORD, confirm: PASSWORD });
    w.sandbox.signUpWithEmail(NEW, PASSWORD);
    await w.settle();

    assert.deepStrictEqual(w.handled, ["uidNew1"]);
    assert.strictEqual(profileReads(w, "uidNew1"), 1);
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: NEW });
    assert.deepStrictEqual(w.views(), ["profile-setup"]);
    assert.deepStrictEqual(w.signInForm(), EMPTY);
  });
}

/* A sign-up or a link that FAILS leaves the visitor exactly as they were. These
   pass before the fix too: they are here so that it cannot reach a failure. */
async function expectStillAVisitor(w, before, message) {
  await w.settle();
  assert.ok(w.sandbox.currentUser.isAnonymous, "still the anonymous visitor");
  assert.deepStrictEqual(w.handled.slice(before), [], "nothing was handled");
  assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false]);
  assert.deepStrictEqual(w.views(), ["account"], "still on the sign-in view");
  assert.strictEqual(w.el("splash-account-hint").className, "splash-hint err");
  assert.match(w.el("splash-account-hint").textContent, message);
}

test("I: a sign-up refused for a weak password leaves the visitor as they were, with what they typed", async () => {
  const w = await onSignInView();
  const before = w.handled.length;
  w.typeSignIn({ email: NEW, password: "weak", confirm: "weak" });
  w.sandbox.signUpWithEmail(NEW, "weak");
  await expectStillAVisitor(w, before, /^Pick a stronger password/);
  assert.deepStrictEqual(w.signInForm(), { email: NEW, password: "weak", confirm: "weak" });
});

test("I: so does a sign-up with an address in use and the wrong password", async () => {
  const w = await onSignInView();
  w.auth.accounts[ALICE.email] = { user: ALICE, password: PASSWORD };
  const before = w.handled.length;
  w.typeSignIn({ email: ALICE.email, password: "Wrong-Horse-9", confirm: "Wrong-Horse-9" });
  w.sandbox.signUpWithEmail(ALICE.email, "Wrong-Horse-9");
  await expectStillAVisitor(w, before, /^Wrong password/);
  assert.deepStrictEqual(w.signInForm(), { email: ALICE.email, password: "Wrong-Horse-9", confirm: "Wrong-Horse-9" });
});

/* What somebody had typed in the e-mail form before pressing the Google button. */
const HALF = { email: "half@example.test", password: "Half-typed-1", confirm: "" };

test("I: so does a Google popup closed without choosing an account", async () => {
  const w = await onSignInView();
  const before = w.handled.length;
  w.typeSignIn(HALF);
  w.auth.popup = { error: "auth/popup-closed-by-user" };
  w.sandbox.signInWithProvider("google");
  await expectStillAVisitor(w, before, /^Sign-in was cancelled\.$/);
  assert.strictEqual(w.auth.redirected, false);
  assert.deepStrictEqual(w.signInForm(), HALF, "only a sign-in that WORKED empties the form");
});

test("I: a blocked popup still goes on to the full-page redirect, and nothing is handled meanwhile", async () => {
  const w = await onSignInView();
  const before = w.handled.length;
  w.typeSignIn(HALF);
  w.auth.popup = { error: "auth/popup-blocked" };
  w.sandbox.signInWithProvider("google");
  await w.settle();
  assert.strictEqual(w.auth.redirected, true);
  assert.strictEqual(w.el("splash-account-hint").textContent, "Redirecting to Google…");
  assert.ok(w.sandbox.currentUser.isAnonymous);
  assert.deepStrictEqual(w.handled.slice(before), []);
  assert.deepStrictEqual(w.signInForm(), HALF);
});

/* ---- the same account, upgraded where this page could not see it ----------
 *
 * FOUND IN REVIEW. The first version of the fix asked the LIVE user object
 * whether the visitor was anonymous when a route started. The SDK changes that
 * object under the page: when another tab of the same browser creates the
 * account, this tab's user becomes an account with the same uid, and nothing is
 * reported. Somebody who then signs in HERE — with the new address, with
 * Google, or by pressing "Create account" again — was signed in to a page that
 * went on showing nobody: the original symptom.
 *
 * What the page now compares is what its HANDLER last handled: a signed-in
 * account whose uid the page still shows as an anonymous visitor is a page that
 * has not been told, whichever route led there.
 */

const SECOND_TAB = [
  { how: "signs in with the new address", go(w) {
    w.typeSignIn({ email: NEW, password: PASSWORD });
    w.sandbox.signInWithEmail(NEW, PASSWORD);
  } },
  { how: "signs in with Google", go(w) {
    w.auth.popup = { email: NEW };
    w.sandbox.signInWithProvider("google");
  } },
  { how: "presses 'Create account' again with the same address", go(w) {
    w.typeSignIn({ email: NEW, password: PASSWORD, confirm: PASSWORD });
    w.sandbox.signUpWithEmail(NEW, PASSWORD);
  } }
];

for (const s of SECOND_TAB) {
  test("I: an account created in another tab is shown here as soon as somebody " + s.how, async () => {
    const w = await onSignInView();
    const visitor = w.sandbox.currentUser;
    const uid = visitor.uid;
    w.otherTabUpgrades(NEW, PASSWORD);
    const before = w.handled.length;
    const told = w.reported.length;
    assert.deepStrictEqual([w.auth.currentUser.uid, w.auth.currentUser.isAnonymous], [uid, false],
      "premise: the user is an account already");
    assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false],
      "premise: and the page, told nothing, shows nobody");

    s.go(w);
    await w.settle();

    assert.strictEqual(w.el("splash-account-hint").textContent, "", "premise: the sign-in succeeded");
    assert.strictEqual(w.reported.length, told, "premise: and the SDK reported nothing, the uid being the same");
    assert.notStrictEqual(w.auth.currentUser, visitor, "premise: the sign-in built a new user object for that uid");
    assert.deepStrictEqual(w.handled.slice(before), [uid], "handled once, by the page");
    assert.strictEqual(w.sandbox.currentUser, w.auth.currentUser,
      "with the user the SDK now has, not the object that sign-in superseded");
    assert.deepStrictEqual(w.signedIn(), { row: true, chip: true, name: NEW });
    assert.deepStrictEqual(w.views(), ["profile-setup"]);
    assert.deepStrictEqual(w.signInForm(), EMPTY);
  });
}

test("I: an account already shown that presses 'Create account' with its own address is not handled again", async () => {
  /* The route does not link (she is not anonymous); the address is in use; the
     page signs in with what was typed; the uid is hers. Nothing changed, and
     nothing of what she is in the middle of may be reset. */
  const w = makeWorld();
  w.sandbox.wireAccountUI();
  w.auth.accounts[ALICE.email] = { user: ALICE, password: PASSWORD };
  await w.signIn(ALICE, ALICE_PROFILE);
  w.el("splash-signed-in-account").fire("click");
  w.el("account-name").value = "Alice, halfway through";
  const before = w.handled.length;

  w.typeSignIn({ email: ALICE.email, password: PASSWORD, confirm: PASSWORD });
  w.sandbox.signUpWithEmail(ALICE.email, PASSWORD);
  await w.settle();

  assert.strictEqual(w.el("splash-account-hint").textContent, "", "premise: it succeeded");
  assert.deepStrictEqual(w.signInForm(), EMPTY, "premise");
  assert.deepStrictEqual(w.handled.slice(before), []);
  assert.strictEqual(w.el("account-dialog").open, true);
  assert.strictEqual(w.dialog().name, "Alice, halfway through");
  assert.deepStrictEqual(w.joinForm(), { name: "Alice", university: "Nagoya", year: "5", english: "C1" });
});

test("I: 'Create account' pressed twice is handled once", async () => {
  /* Both submits start from the anonymous visitor: the first link has not been
     answered when the second is sent. The first creates the account; the second
     finds the address in use and signs in to it — the same uid again. */
  const w = await onSignInView();
  const uid = w.sandbox.currentUser.uid;
  const before = w.handled.length;
  w.typeSignIn({ email: NEW, password: PASSWORD, confirm: PASSWORD });
  w.sandbox.signUpWithEmail(NEW, PASSWORD);
  assert.ok(w.auth.currentUser.isAnonymous, "premise: still anonymous when the second submit is sent");
  w.sandbox.signUpWithEmail(NEW, PASSWORD);
  await w.settle();

  assert.deepStrictEqual([w.auth.currentUser.uid, w.auth.currentUser.isAnonymous], [uid, false], "premise");
  assert.strictEqual(w.el("splash-account-hint").textContent, "", "premise: neither submit ended in an error");
  assert.deepStrictEqual(w.handled.slice(before), [uid]);
  assert.strictEqual(profileReads(w, uid), 1);
  assert.deepStrictEqual(w.views(), ["profile-setup"]);
});

test("I: a sign-up answered after its visitor has gone handles nothing more", async () => {
  /* The account goes in another tab while the link is on its way: this page is
     told (a change of uid), and signs in a new anonymous visitor. When the link
     is then answered, the user signed in here is that visitor — nobody to show. */
  const w = await onSignInView();
  const before = w.handled.length;
  w.typeSignIn({ email: NEW, password: PASSWORD, confirm: PASSWORD });
  w.sandbox.signUpWithEmail(NEW, PASSWORD);
  await w.vanish();

  const now = w.sandbox.currentUser;
  assert.ok(now.isAnonymous && now.uid === "uidAnon2", "premise: a new anonymous visitor");
  assert.ok(w.auth.accounts[NEW], "premise: and the link was answered");
  assert.deepStrictEqual(w.handled.slice(before), [null, "uidAnon2"], "the SDK's two reports, and nothing else");
  assert.deepStrictEqual([w.signedIn().row, w.signedIn().chip], [false, false]);
});
