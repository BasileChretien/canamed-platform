/* tests-e2e/account-dialog-state.spec.js
 *
 * What the account UI keeps between two accounts, and across a reload — driven
 * in a real browser, on every viewport. Each section below opens with the
 * defect it covers.
 *
 * STANDING AN ACCOUNT IN. Hermetic LOCAL mode has no auth backend, so `auth` is
 * null and nobody is ever signed in. standInAuth() gives the page one that
 * behaves like the SDK where these defects depend on it: it reports a change to
 * the app's own handleAuthStateChange() AFTER the call that caused it has
 * returned; signing out reports "no user" and nothing else; and it is the app's
 * own ensureSignedIn() that then asks for the anonymous user. Everything after
 * that is the app: the real handler, the real dialog, the real buttons.
 *
 * The same behaviour is executed against a fake page in
 * tests/account-dialog-state.test.js, which also covers what a browser test
 * cannot time: a profile read that comes back after its account has gone.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is registered
 * in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const ALICE = { uid: "u_alice", email: "alice@example.test" };
const BOB = { uid: "u_bob", email: "bob@example.test" };
const ALICE_PROFILE = { name: "Alice", university: "Nagoya", year: 5, english: "C1", role: "student", updatedAt: 1 };

/* Give the loaded page an auth backend, and the anonymous user every visitor
   has. Must be called again after a navigation. */
async function standInAuth(page) {
  await page.waitForFunction(() =>
    typeof handleAuthStateChange === "function" && typeof dbInit === "function");
  await page.evaluate(async () => {
    dbInit();
    let anon = 0;
    /* Like the SDK (12.17.1 keeps a lastNotifiedUid): the app's handler is told
       only when the UID changes. */
    let lastUid = null;
    /* What this backend told the page (__reported), and every call of the
       page's handler whoever made it (__handled): uids, or null for nobody.
       A function declared at the top of a classic script is a property of
       window, and the script's own calls look it up there. */
    window.__reported = [];
    window.__handled = [];
    const handler = handleAuthStateChange;
    window.handleAuthStateChange = (user) => { window.__handled.push(user ? user.uid : null); return handler(user); };
    const report = (user) => {
      lastUid = user ? user.uid : null;
      window.__reported.push(lastUid);
      handleAuthStateChange(user);
    };
    const later = (user) => Promise.resolve().then(() => {
      if ((user ? user.uid : null) !== lastUid) report(user);
    });
    const refuse = (code, more) => Promise.reject(Object.assign(new Error(code), { code }, more));
    const account = (who) => Object.assign({
      displayName: null, isAnonymous: false,
      delete() { auth.currentUser = null; return later(null); }
    }, who);
    /* The accounts the e-mail form can sign in to: address -> { user, password }. */
    const accounts = {};
    /* `auth` is a script-scope `let` in script.js, so this assigns the app's own
       binding. */
    auth = {
      currentUser: null,
      signInAnonymously() {
        const user = {
          uid: "u_anon" + (++anon), email: null, displayName: null, isAnonymous: true,
          /* A sign-up upgrades the anonymous user IN PLACE: the uid stays, and
             the SDK shipped here (12.17.1) reports to onAuthStateChanged only
             when the uid changes — so the app's handler is not called. */
          linkWithCredential(cred) {
            // An address that already is an account cannot be linked.
            if (accounts[cred.email]) return refuse("auth/email-already-in-use");
            user.isAnonymous = false;
            user.email = cred.email;
            return Promise.resolve({ user });
          },
          /* The same upgrade through a provider's popup. window.__popup is
             what happens in it: { email, displayName }, or { error: code }. */
          linkWithPopup() {
            const p = window.__popup;
            if (p.error) return refuse(p.error);
            user.isAnonymous = false;
            user.email = p.email;
            user.displayName = p.displayName || null;
            return Promise.resolve({ user });
          }
        };
        auth.currentUser = user;
        return later(user).then(() => ({ user }));
      },
      signInWithEmailAndPassword(email, password) {
        const a = accounts[email];
        if (!a || a.password !== password) return refuse("auth/invalid-credential");
        auth.currentUser = a.user;
        return later(a.user).then(() => ({ user: a.user }));
      },
      signInWithCredential(cred) { return auth.signInWithEmailAndPassword(cred.email, cred.password); },
      signOut() { auth.currentUser = null; return later(null); }
    };
    /* LOCAL mode never calls the SDK; the sign-up and provider paths ask it
       for a credential and a provider object. */
    window.firebase = { auth: {
      EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
      GoogleAuthProvider: class { setCustomParameters() {} }
    } };
    window.__register = (who, password) => { accounts[who.email] = { user: account(who), password }; };
    window.__signIn = (who) => {
      const user = account(who);
      auth.currentUser = user;
      report(user);
    };
    await ensureSignedIn();
  });
  await expect.poll(() => page.evaluate(() => !!(currentUser && currentUser.isAnonymous)),
    { message: "premise: the visitor starts out anonymous" }).toBe(true);
}

async function frontPage(page) {
  await page.goto("/");
  await standInAuth(page);
}

const signIn = (page, who) => page.evaluate((who) => { window.__signIn(who); }, who);
const stored = (page, path) =>
  page.evaluate((path) => db.ref(path).once("value").then((s) => s.val()), path);
const seed = (page, path, value) =>
  page.evaluate(({ path, value }) => db.ref(path).set(value), { path, value });

/* What an untouched cohort list starts on. Read from the page rather than
   written down: WHICH university that is is not what this spec is about. */
const untouchedUniversity = (page, id) => page.evaluate((id) => {
  populateProfileSelects(id);
  return /** @type {HTMLSelectElement} */ (document.getElementById(id)).value;
}, id);

const dialogFields = (page) => page.evaluate(() => {
  const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
  return {
    email: document.getElementById("account-email").textContent,
    name: v("account-name"), university: v("account-uni"),
    year: v("account-year"), english: v("account-english"),
    role: /** @type {HTMLInputElement} */ (
      document.querySelector('input[name="account-role"]:checked')).value
  };
});
const setupFields = (page) => page.evaluate(() => {
  const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
  return {
    name: v("splash-prof-name"), university: v("splash-prof-uni"),
    year: v("splash-prof-year"), english: v("splash-prof-english"),
    role: /** @type {HTMLInputElement} */ (
      document.querySelector('input[name="splash-prof-role"]:checked')).value
  };
});

/* A stored profile without its two timestamps. */
function withoutTimes(profile) {
  const p = Object.assign({}, profile);
  delete p.createdAt;
  delete p.updatedAt;
  return p;
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  return errors;
}

/* ======================= A. one account's profile, shown to the next =======
 *
 * A new account saw, and could save, the PREVIOUS account's profile. The
 * dialog filled its fields only for an account that had a profile and never
 * emptied them; signing out does not reload the page. So on a shared machine
 * the second person got the first one's name, university, year and level under
 * their own e-mail address, and Save stored whatever they did not retype. The
 * profile-setup form kept a previous user's entries the same way. And on a
 * fresh page the dialog offered "A2" where profile setup and the lobby both
 * start from B2.
 */

test("A: a second account in the same tab sees none of the first one's profile, and Save stores only its own", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  const untouched = await untouchedUniversity(page, "account-uni");
  expect(untouched, "premise: Alice's university differs from an untouched list's").not.toBe("Nagoya");
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);

  // Alice signs in, opens Account, signs out.
  await signIn(page, ALICE);
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Alice");
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  expect(await dialogFields(page), "premise: the dialog shows Alice her own profile").toEqual({
    email: "alice@example.test", name: "Alice", university: "Nagoya", year: "5", english: "C1", role: "student"
  });
  await page.locator("#account-signout-btn").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  await expect(page.locator("#splash-signed-in")).toBeHidden();

  // Bob signs in to a new account in the same tab: nothing stored, so profile setup.
  await signIn(page, BOB);
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  await expect(page.locator("#splash-signed-in-name")).toHaveText("bob@example.test");
  expect(await stored(page, "users/u_bob"), "premise: Bob has no profile").toBeNull();
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();

  expect(await dialogFields(page), "Bob's dialog must hold his own values or the defaults, never Alice's").toEqual({
    email: "bob@example.test", name: "", university: untouched, year: "1", english: "B2", role: "student"
  });

  // He types his name and changes nothing else — which is what a person does.
  await page.locator("#account-name").fill("Bob");
  await page.locator("#account-save-btn").click();
  await expect(page.locator("#account-action-hint")).toHaveText("Profile saved.");
  expect(withoutTimes(await stored(page, "users/u_bob/profile")),
    "what he did not retype must not be saved as his").toEqual(
    { name: "Bob", university: untouched, role: "student", year: 1, english: "B2" });
  expect(await stored(page, "users/u_alice/profile"), "and Alice's profile is untouched")
    .toEqual(ALICE_PROFILE);
  expect(errors).toEqual([]);
});

test("A: on a fresh page a new account's dialog starts from the year and level profile setup uses", async ({ page }) => {
  /* Nobody's values are left over here — and the dialog still showed "A2",
     because its level list had no default while the other two have one. */
  await frontPage(page);
  await signIn(page, BOB);
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  const setup = await setupFields(page);
  expect({ year: setup.year, english: setup.english }, "premise: what profile setup starts from")
    .toEqual({ year: "1", english: "B2" });

  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  const dlg = await dialogFields(page);
  expect({ year: dlg.year, english: dlg.english }).toEqual({ year: setup.year, english: setup.english });
  expect(dlg.university, "and the same university as the form behind it").toBe(setup.university);
  expect(dlg.name).toBe("");
  // What is on screen, not only the value behind it.
  await expect(page.locator("#account-english option:checked")).toHaveText(/^B2\b/);
});

test("A: the profile-setup form shown to a second account holds none of the first one's entries", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  const untouched = await untouchedUniversity(page, "splash-prof-uni");
  expect(untouched).not.toBe("Nagoya");

  // Alice signs in to a new account, fills profile setup in and saves it.
  await signIn(page, ALICE);
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  await expect(page.locator("#splash-prof-name"), "premise: the name starts from HER address")
    .toHaveValue("alice");
  await page.locator("#splash-prof-name").fill("Alice A");
  await page.locator("#splash-prof-uni").selectOption("Nagoya");
  await page.locator("#splash-prof-year").selectOption("5");
  await page.locator("#splash-prof-english").selectOption("C1");
  await page.locator("#splash-profile-setup-submit").click();
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  expect(withoutTimes(await stored(page, "users/u_alice/profile")), "premise: her profile was saved")
    .toEqual({ name: "Alice A", university: "Nagoya", role: "student", year: 5, english: "C1" });

  await page.locator("#splash-signed-in-out").click();
  await expect(page.locator("#splash-signed-in")).toBeHidden();

  // Bob signs in to a new account in the same tab.
  await signIn(page, BOB);
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  expect(await setupFields(page),
    "Bob's form must start from his own address and the defaults, never from what Alice typed").toEqual(
    { name: "bob", university: untouched, year: "1", english: "B2", role: "student" });

  /* He saves it as it stands: the form, submitted by a signed-in account,
     writes that account's profile and nothing of the previous one's. */
  await page.locator("#splash-profile-setup-submit").click();
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  expect(withoutTimes(await stored(page, "users/u_bob/profile"))).toEqual(
    { name: "bob", university: untouched, role: "student", year: 1, english: "B2" });
  expect(errors).toEqual([]);
});

/* ======================= B. the setup form outliving the account ==========
 *
 * After "Sign out" or "Delete account" during profile setup, the setup form
 * stayed on screen for the now-anonymous visitor, and submitting it wrote a
 * profile under the ANONYMOUS uid — data the product gives nobody a way to see
 * or delete.
 *
 * "Nothing was written" needs a save path that works: the last step of the A
 * test just above is that positive control — the same form, submitted by a
 * signed-in account, does write.
 *
 * "Delete account" runs the real code (the lazy data-rights.js, behind the
 * real button and the real confirmation). LocalDB has neither a key-range query
 * nor a root ref, which that code uses, so letLocalDbDelete() adds the two —
 * the range filter is ignored, and the code's own ownerUid test does the
 * selecting. What only real rules and a real account can show about deletion
 * is tests-e2e/emulator/account-delete.spec.js.
 */

const CODE = "abc-123";

async function letLocalDbDelete(page) {
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(db.ref("x"));
    proto.orderByKey = proto.startAt = proto.endAt = function () { return this; };
    const ref = db.ref.bind(db);
    db.ref = (p) => ref(p === undefined ? "" : p);
  });
}

/* The front page back on "enter a session", with nothing of an account left. */
async function expectPlainFrontPage(page) {
  await expect(page.locator("#splash-view-profile-setup")).toBeHidden();
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  await expect(page.locator("#splash-code")).toBeVisible();
  await expect(page.locator("#splash-signed-in")).toBeHidden();
  await expect(page.locator("#account-dialog")).toBeHidden();
}

/* The save path reached anyway — a submit already on its way when the account
   went. The form is no longer on screen, so it is filled and submitted from
   script, through the form's own submit listener. Returns what is stored:
   the uids that have anything under users/ (LocalDB keeps an emptied parent as
   {}, where the real database prunes it — hence keys, not the node). */
async function submitProfileSetupAnyway(page) {
  return page.evaluate(async () => {
    const set = (id, v) => { /** @type {HTMLInputElement} */ (document.getElementById(id)).value = v; };
    populateProfileSelects("splash-prof-uni");
    set("splash-prof-name", "Alice A");
    set("splash-prof-uni", "Nagoya");
    document.getElementById("splash-profile-setup-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    // LocalDB settles within a microtask; this is several turns of slack.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 20));
    return {
      anonymous: !!(currentUser && currentUser.isAnonymous),
      users: Object.keys((await db.ref("users").once("value")).val() || {}),
      hint: document.getElementById("splash-profile-setup-hint").textContent
    };
  });
}

test("B: after Sign out during profile setup the form is gone, and no profile is saved for the anonymous visitor", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  await signIn(page, ALICE);                 // a new account: straight to profile setup
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  await expect(page.locator("#splash-prof-name")).toHaveValue("alice");

  await page.locator("#splash-signed-in-out").click();

  await expectPlainFrontPage(page);
  await expect(page.locator("#splash-prof-name"),
    "the form left behind must not keep the name it was prefilled with").toHaveValue("");

  const after = await submitProfileSetupAnyway(page);
  expect(after.anonymous, "premise: the visitor is anonymous again").toBe(true);
  expect(after.users, "nothing may be stored under users/ — least of all under the anonymous uid")
    .toEqual([]);
  expect(after.hint, "and the refusal must say why").toMatch(/not signed in/i);
  await expectPlainFrontPage(page);
  expect(errors).toEqual([]);
});

test("B: after Delete account during profile setup the form is gone, and no profile is saved for the anonymous visitor", async ({ page }) => {
  const errors = collectErrors(page);
  const confirms = [];
  page.on("dialog", (d) => { confirms.push(d.message()); d.accept().catch(() => {}); });
  await frontPage(page);
  await letLocalDbDelete(page);
  // Something of hers to delete, so that the deletion can be seen to have run.
  await seed(page, "users/u_alice/history/" + CODE, { code: CODE, joinedAt: 1 });
  await signIn(page, ALICE);
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();

  // The "Account" link is on the profile-setup view too (#431).
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await page.locator("#account-delete-btn").scrollIntoViewIfNeeded();
  await page.locator("#account-delete-btn").click();

  await expectPlainFrontPage(page);
  expect(confirms.length, "premise: the real deletion asked, once").toBe(1);
  expect(confirms[0]).toContain("Delete your account?");
  expect(await stored(page, "users/u_alice"), "premise: her data was deleted").toBeNull();

  const after = await submitProfileSetupAnyway(page);
  expect(after.anonymous, "premise: the visitor is anonymous again").toBe(true);
  expect(after.users, "the deleted account's form must not create a profile for anyone").toEqual([]);
  expect(after.hint).toMatch(/not signed in/i);
  await expectPlainFrontPage(page);
  expect(errors).toEqual([]);
});

/* ======================= C. the chip after a reload inside a session ======
 *
 * After a reload inside a session the header chip did nothing. Its listener,
 * and those of every button in the dialog, were attached only when the splash
 * was shown, and auto-resume never shows it.
 */

test("C: after a reload inside a session the header chip opens the dialog, and its buttons work", async ({ page }) => {
  /* Inside a session the WebKit-family projects take about two seconds to pass
     each click's stability check on this suite's hardware, and there are six
     clicks here: ~18 s on webkit, more on the iPad project (measured
     2026-10-07). Same allowance as the other in-session specs. */
  test.setTimeout(90_000);
  const errors = collectErrors(page);

  // Enter a session through the front page, as a participant does.
  await page.goto("/");
  await page.waitForFunction(() => typeof dbInit === "function");
  await page.evaluate(async (code) => {
    dbInit();
    await db.ref("sessions/" + code + "/created").set({ at: Date.now(), by: "E2E" });
  }, CODE);
  await page.locator("#splash-code").fill(CODE);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#splash")).toBeHidden({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#splash")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("body")).not.toHaveClass(/(^|\s)locked(\s|$)/, { timeout: 10_000 });
  /* Positive control for "the splash was never shown": on this load the
     splash's own wiring did not run. Without it the test would pass by the
     route that always worked. */
  expect(await page.evaluate(() => splashWired)).toBe(false);

  await standInAuth(page);
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);
  await signIn(page, ALICE);

  const chip = page.locator("#user-chip");
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("alice@example.test");
  await expect(page.locator("#account-name")).toHaveValue("Alice");

  // Save.
  await page.locator("#account-name").fill("Alice B");
  await page.locator("#account-save-btn").click();
  await expect(page.locator("#account-action-hint")).toHaveText("Profile saved.");
  expect((await stored(page, "users/u_alice/profile")).name).toBe("Alice B");

  // Close.
  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();

  // Sign out — from the dialog, reopened by the chip.
  await chip.click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await page.locator("#account-signout-btn").scrollIntoViewIfNeeded();
  await page.locator("#account-signout-btn").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  await expect(chip).toBeHidden();
  // Still in the session: signing out of an account is not leaving a session.
  await expect(page.locator("#splash")).toBeHidden();
  expect(errors).toEqual([]);
});

/* ======================= D. one account replacing another directly =========
 *
 * Found in review (PR #440, finding 1). Emptying the forms on a change of
 * account was not enough: the profile the dialog reads, the header chip and
 * the "Signed in as …" row were only replaced when the NEW account's profile
 * read came back. Alice leaves herself signed in; Bob uses "Sign in with Google
 * or email…" — nothing hides it while someone is signed in — and the SDK swaps
 * them in one event, with no "nobody" in between. Until his read returned the
 * page still said "Signed in as Alice · Account", the dialog opened on her
 * profile under his e-mail address, and Save wrote it over his own.
 *
 * Every test above signs the first account out before the second signs in.
 */

const BOB_PROFILE = { name: "Bob", university: "Caen", year: 2, english: "B1", role: "student", createdAt: 5, updatedAt: 5 };

/* A slow network: a read of `path` stays in flight until __releaseRead(). */
async function holdRead(page, path) {
  await page.evaluate((path) => {
    const ref = db.ref.bind(db);
    db.ref = (p) => {
      const r = ref(p);
      if (p === path) {
        const once = r.once.bind(r);
        r.once = () => new Promise((resolve) => {
          window.__releaseRead = () => { db.ref = ref; once().then(resolve); };
        });
      }
      return r;
    };
  }, path);
}

test("D: an account that replaces another directly sees nothing of it while its own profile is still being read", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);
  await seed(page, "users/u_bob/profile", BOB_PROFILE);
  await signIn(page, ALICE);
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Alice");
  await expect(page.locator("#splash-signed-in-account"), "premise: her Account link is on screen").toBeVisible();

  await holdRead(page, "users/u_bob/profile");
  await signIn(page, BOB);                    // no sign-out in between

  expect(await page.evaluate(() => ({ uid: currentUser.uid, profile: currentProfile })),
    "he is the current user, and her profile is no longer the current one").toEqual({ uid: "u_bob", profile: null });
  await expect(page.locator("#splash-signed-in"), "the row must not go on saying 'Signed in as Alice'").toBeHidden();
  await expect(page.locator("#splash-signed-in-account")).toBeHidden();
  await expect(page.locator("#user-chip")).toHaveClass(/(^|\s)hidden(\s|$)/);
  /* Nothing on screen opens the dialog now. Opened by any other route, it
     still must not hold her values. */
  const forced = await page.evaluate(() => {
    openAccountDialog();
    const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
    const seen = {
      email: document.getElementById("account-email").textContent, name: v("account-name"),
      university: v("account-uni"), year: v("account-year"), english: v("account-english")
    };
    closeAccountDialog();
    return seen;
  });
  expect(forced.email, "premise: the dialog is his").toBe("bob@example.test");
  expect([forced.name, forced.university, forced.year, forced.english].filter(
    (x, i) => x === ["Alice", "Nagoya", "5", "C1"][i]), "none of her values in his dialog").toEqual([]);

  // His read lands: the openers come back as his, and the dialog is his own.
  await page.evaluate(() => { window.__releaseRead(); });
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Bob");
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  expect(await dialogFields(page)).toEqual({
    email: "bob@example.test", name: "Bob", university: "Caen", year: "2", english: "B1", role: "student"
  });
  await page.locator("#account-save-btn").click();
  await expect(page.locator("#account-action-hint")).toHaveText("Profile saved.");
  expect(withoutTimes(await stored(page, "users/u_bob/profile")), "Save keeps what was his").toEqual(
    { name: "Bob", university: "Caen", year: 2, english: "B1", role: "student" });
  expect(await stored(page, "users/u_alice/profile")).toEqual(ALICE_PROFILE);
  expect(errors).toEqual([]);
});

/* ======================= E. the lobby's join form ==========================
 *
 * Found in review (finding 2), and older than this spec. A loaded or saved
 * profile also fills the lobby's "Join as a participant" form, and nothing took
 * it out again when the account went: Alice signs in and out, the next student
 * types a session code in the same tab and is offered her name, year and level.
 *
 * What is NOT taken out — a name the participant typed, choices they made
 * before signing in or after — is in the unit tests, section E.
 */

const joinFields = (page) => page.evaluate(() => {
  const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
  return { name: v("name-input"), university: v("uni-input"), year: v("year-input"), english: v("english-input") };
});

test("E: after an account signs out, the next student's join form holds nothing of it", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);
  await seed(page, "sessions/" + CODE + "/created", { at: Date.now(), by: "E2E" });
  await signIn(page, ALICE);
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Alice");
  expect(await joinFields(page), "premise: her profile is in the join form behind the front page")
    .toEqual({ name: "Alice", university: "Nagoya", year: "5", english: "C1" });

  await page.locator("#splash-signed-in-out").click();
  await expect(page.locator("#splash-signed-in")).toBeHidden();

  // The next student, same tab, no reload: a session code, then the lobby.
  await page.locator("#splash-code").fill(CODE);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#splash")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  expect(await joinFields(page), "the form they are shown must be nobody's")
    .toEqual({ name: "", university: "", year: "1", english: "B2" });
  expect(errors).toEqual([]);
});

/* ======================= F. the sign-in form ===============================
 *
 * Found in review (finding 3), and older than this spec. The e-mail sign-in
 * form was only ever read: a successful sign-in emptied nothing and neither did
 * sign-out, so the previous person's address AND PASSWORD stayed in the three
 * inputs for as long as the tab lived. The next person opens "Sign in", finds
 * them, and "Sign in" enters her account.
 */

const PASSWORD = "Correct-Horse-9";
const NOTHING = { email: "", password: "", confirm: "" };
const signInFields = (page) => page.evaluate(() => {
  const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
  return { email: v("splash-email-input"), password: v("splash-password-input"), confirm: v("splash-password-confirm") };
});

test("F: the sign-in form keeps nobody's e-mail address or password", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  await page.evaluate(({ who, password }) => { window.__register(who, password); }, { who: ALICE, password: PASSWORD });
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);

  /* 0. An attempt that fails keeps what was typed, so that it can be corrected
        — but "Back" must empty it: it only switched the view, and the address
        and the near-miss password stayed in the hidden form for the next
        person to open "Sign in" (review round 2). */
  await page.locator("#splash-go-account").click();
  await expect(page.locator("#splash-view-account")).toBeVisible();
  await page.locator("#splash-email-input").fill(ALICE.email);
  await page.locator("#splash-password-input").fill("Correct-Horse-8");
  await page.locator("#splash-email-submit").click();
  await expect(page.locator("#splash-account-hint"), "premise: the attempt failed").toHaveClass(/(^|\s)err(\s|$)/);
  expect(await signInFields(page), "premise: a failed attempt keeps what was typed")
    .toEqual({ email: ALICE.email, password: "Correct-Horse-8", confirm: "" });
  await page.locator("#splash-back-from-account").click();
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  expect(await signInFields(page), "after Back").toEqual(NOTHING);

  // 1. Alice signs in through the form itself.
  await page.locator("#splash-go-account").click();
  await expect(page.locator("#splash-view-account")).toBeVisible();
  await page.locator("#splash-email-input").fill(ALICE.email);
  await page.locator("#splash-password-input").fill(PASSWORD);
  await page.locator("#splash-email-submit").click();
  await expect(page.locator("#splash-signed-in-name"), "premise: the sign-in worked").toHaveText("Alice");
  expect(await signInFields(page), "after a successful sign-in").toEqual(NOTHING);

  /* 1b. She signs in AGAIN while still signed in. Same uid, so the SDK reports
         nothing and only the sign-in's own success can empty the form. */
  await page.locator("#splash-go-account").click();
  await page.locator("#splash-email-input").fill(ALICE.email);
  await page.locator("#splash-password-input").fill(PASSWORD);
  await page.locator("#splash-email-submit").click();
  await expect.poll(() => signInFields(page), { message: "after signing in again as the same account" })
    .toEqual(NOTHING);
  await expect(page.locator("#splash-account-hint"), "premise: it succeeded, with no error shown").toHaveText("");

  /* 2. The sign-in view stays reachable while she is signed in, so the form
        can hold a half-typed address and password when her account goes. */
  await expect(page.locator("#splash-view-account"), "premise: still on the sign-in view").toBeVisible();
  await page.locator("#splash-email-input").fill("bob@example.test");
  await page.locator("#splash-password-input").fill("Half-typed-1");
  await page.locator("#splash-signed-in-out").click();
  await expect(page.locator("#splash-signed-in")).toBeHidden();
  expect(await signInFields(page), "after sign-out").toEqual(NOTHING);

  /* 3. A sign-up upgrades the anonymous visitor in place and the SDK reports
        no change, so nothing that runs "when the account changes" runs here. */
  await expect(page.locator("#splash-view-account"), "premise: still on the sign-in view").toBeVisible();
  await page.locator("#splash-email-mode-signup").click();
  const meter = page.locator("#splash-pwd-strength-label");
  const idle = await meter.textContent();
  await page.locator("#splash-email-input").fill("new@example.test");
  await page.locator("#splash-password-input").fill(PASSWORD);
  await page.locator("#splash-password-confirm").fill(PASSWORD);
  await expect(meter, "premise: the meter rates what was typed").not.toHaveText(idle);
  await page.locator("#splash-email-submit").click();
  await expect.poll(() => page.evaluate(() => auth.currentUser.isAnonymous === false && auth.currentUser.email),
    { message: "premise: the sign-up succeeded" }).toBe("new@example.test");
  await expect.poll(() => signInFields(page), { message: "after a sign-up" }).toEqual(NOTHING);
  await expect(meter, "and the meter must not go on rating the previous person's password").toHaveText(idle);
  expect(errors).toEqual([]);
});

/* ======================= G. a save acknowledged too late ===================
 *
 * Found in review (finding 4). A profile read that comes back after its
 * account has gone is dropped; the acknowledgement of a profile SAVE was not.
 * If the account changed while a save was in flight, the acknowledgement made
 * the departed account's profile the current one, repainted the row with its
 * name, refilled the lobby's join form — and, from profile setup, sent whoever
 * was now on screen out of their own setup form.
 */

/* A slow network the other way: a write to `path` lands, but its
   acknowledgement stays back until __releaseAck(). */
async function holdAck(page, path) {
  await page.evaluate((path) => {
    const ref = db.ref.bind(db);
    db.ref = (p) => {
      const r = ref(p);
      if (p === path) {
        const set = r.set.bind(r);
        r.set = (v) => {
          set(v);
          return new Promise((resolve) => { window.__releaseAck = () => { db.ref = ref; resolve(); }; });
        };
      }
      return r;
    };
  }, path);
}

test("G: a profile save acknowledged after another account took over changes nothing for that account", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  await signIn(page, ALICE);                  // a new account, on profile setup
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  await page.locator("#splash-prof-name").fill("Alice A");
  await page.locator("#splash-prof-uni").selectOption("Nagoya");
  await holdAck(page, "users/u_alice/profile");
  await page.locator("#splash-profile-setup-submit").click();
  await expect(page.locator("#splash-profile-setup-hint"), "premise: her save is in flight")
    .toHaveText(/Saving your profile/);
  expect((await stored(page, "users/u_alice/profile")).name, "premise: the write itself has landed")
    .toBe("Alice A");

  await signIn(page, BOB);                    // Bob signs in meanwhile: a new account too
  await expect(page.locator("#splash-prof-name"), "premise: Bob is asked for HIS profile").toHaveValue("bob");
  await expect(page.locator("#splash-signed-in-name")).toHaveText("bob@example.test");

  await page.evaluate(async () => {
    window.__releaseAck();
    // Every chance for the acknowledgement's follow-ups to run.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 20));
  });

  await expect(page.locator("#splash-view-profile-setup"), "her acknowledgement must not take his form away")
    .toBeVisible();
  await expect(page.locator("#splash-prof-name")).toHaveValue("bob");
  await expect(page.locator("#splash-signed-in-name"), "nor repaint the row with her name")
    .toHaveText("bob@example.test");
  expect(await page.evaluate(() => currentProfile), "nor make her profile his current one").toBeNull();
  expect((await joinFields(page)).name, "nor fill the lobby's join form with it").toBe("");
  expect((await stored(page, "users/u_alice/profile")).name, "her own save stays where it landed").toBe("Alice A");
  await expect(page.locator("#splash-profile-setup-hint"),
    "nor leave her 'Saving your profile…' on his form (review round 2)").toHaveText("");
  expect(errors).toEqual([]);
});

/* ======================= H. the dialog's list of joined sessions ===========
 *
 * Found in review, round 2 (blocking), and older than this spec. The dialog's
 * "Sessions you have joined" list was emptied only inside the listener's
 * callback, and the dialog was shown straight after subscribing. So the next
 * account to open Account saw the PREVIOUS account's rows — session code, date
 * joined, scenario name — under its own e-mail address for one database round
 * trip, or for good if the answer never came; and their Withdraw buttons were
 * live, and would have acted on her session codes under his uid.
 *
 * LocalDB answers a listener inside the call, which is why nothing saw it: the
 * real database answers later. holdListener() makes LocalDB do the same.
 */

/* A slow network once more: a listener on `path` is not answered until
   __releaseList(). */
async function holdListener(page, path) {
  await page.evaluate((path) => {
    const ref = db.ref.bind(db);
    db.ref = (p) => {
      const r = ref(p);
      if (p === path) {
        const on = r.on.bind(r);
        r.on = (ev, cb) => {
          window.__releaseList = () => { db.ref = ref; on(ev, cb); };
          return cb;
        };
      }
      return r;
    };
  }, path);
}

test("H: the next account's dialog lists none of the previous account's sessions while its own list is being read", async ({ page }) => {
  const errors = collectErrors(page);
  await frontPage(page);
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);
  await seed(page, "users/u_alice/history", {
    "abc-123": { code: "abc-123", joinedAt: 2000, scenarioName: "Opioid stewardship" },
    "def-456": { code: "def-456", joinedAt: 1000 }
  });
  await seed(page, "users/u_bob/profile", BOB_PROFILE);
  await seed(page, "users/u_bob/history", { "xyz-789": { code: "xyz-789", joinedAt: 3000 } });

  // Alice opens Account, sees her sessions, signs out.
  await signIn(page, ALICE);
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Alice");
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-history .account-history-code"), "premise: her dialog lists her sessions")
    .toHaveText(["ABC-123", "DEF-456"]);
  await expect(page.locator("#account-history .account-history-withdraw")).toHaveCount(2);
  await page.locator("#account-signout-btn").scrollIntoViewIfNeeded();
  await page.locator("#account-signout-btn").click();
  await expect(page.locator("#account-dialog")).toBeHidden();

  // Bob signs in and opens Account before his own list has come back.
  await holdListener(page, "users/u_bob/history");
  await signIn(page, BOB);
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Bob");
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email"), "premise: the dialog is his").toHaveText("bob@example.test");
  await expect(page.locator("#account-history .account-history-code"), "none of her sessions under his name")
    .toHaveCount(0);
  await expect(page.locator("#account-history .account-history-withdraw"),
    "and no Withdraw button that would act on her session codes under his uid").toHaveCount(0);

  await page.evaluate(() => { window.__releaseList(); });
  await expect(page.locator("#account-history .account-history-code"), "then his own, and only his own")
    .toHaveText(["XYZ-789"]);
  await expect(page.locator("#account-history .account-history-withdraw")).toHaveCount(1);
  expect(errors).toEqual([]);
});

/* ======================= I. an upgrade the SDK does not report =============
 *
 * A sign-up, or a first Google sign-in, left the page as it was until a
 * reload. Creating an account LINKS the anonymous user every visitor is, so the
 * uid is kept; the SDK reports a user only when the uid changes; and nothing
 * else called the page's handler. The visitor was signed in with no "signed in
 * as" row, no profile setup, no Account and no Sign out — and since the form is
 * emptied on success, it looked as if the form had silently reset.
 *
 * WHAT THIS CAN AND CANNOT SHOW. The form, the Google button, the views, the
 * dialog and the handler are the real page on each viewport. The auth backend
 * is the stand-in above: THAT a link keeps the uid and is not reported is read
 * from the SDK's source and modelled, not exercised — and there is no real
 * Google popup, no redirect fallback and no database rule here.
 */

const NEW = "new@example.test";
const pageState = (page, since) => page.evaluate((since) => ({
  uid: currentUser.uid, anonymous: currentUser.isAnonymous,
  reported: window.__reported.slice(since.reported), handled: window.__handled.slice(since.handled)
}), since);
const mark = (page) => page.evaluate(() => ({ reported: window.__reported.length, handled: window.__handled.length }));

/* From profile setup to signed out again, through the page's own controls. */
async function setUpThenSignOut(page, uid) {
  await page.locator("#splash-prof-name").fill("Nova");
  await page.locator("#splash-prof-uni").selectOption("Caen");
  await page.locator("#splash-profile-setup-submit").click();
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  expect(withoutTimes(await stored(page, "users/" + uid + "/profile")), "her profile, under the uid she had as a visitor")
    .toEqual({ name: "Nova", university: "Caen", role: "student", year: 1, english: "B2" });
  await expect(page.locator("#splash-signed-in-name")).toHaveText("Nova");

  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  expect(await dialogFields(page)).toEqual(
    { email: NEW, name: "Nova", university: "Caen", year: "1", english: "B2", role: "student" });
  await page.locator("#account-signout-btn").scrollIntoViewIfNeeded();
  await page.locator("#account-signout-btn").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  await expect(page.locator("#splash-signed-in")).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!(currentUser && currentUser.isAnonymous)),
    { message: "signed out: an anonymous visitor again" }).toBe(true);
  expect(await page.evaluate(() => currentUser.uid), "and a new one").not.toBe(uid);
}

test("I: an account created with the e-mail form is on the page at once: profile setup, Account and Sign out", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await frontPage(page);
  const uid = await page.evaluate(() => currentUser.uid);
  // What the visitor has typed in the lobby's join form, behind the front page.
  await page.evaluate(() => { /** @type {HTMLInputElement} */ (document.getElementById("name-input")).value = "Typed Name"; });

  await page.locator("#splash-go-account").click();
  await page.locator("#splash-email-mode-signup").click();
  await page.locator("#splash-email-input").fill(NEW);
  await page.locator("#splash-password-input").fill(PASSWORD);
  await page.locator("#splash-password-confirm").fill(PASSWORD);
  const since = await mark(page);
  await page.locator("#splash-email-submit").click();

  await expect(page.locator("#splash-view-profile-setup"), "a new account is asked for its profile").toBeVisible();
  expect(await pageState(page, since), "premise: upgraded in place, unreported; handled once by the page itself")
    .toEqual({ uid, anonymous: false, reported: [], handled: [uid] });
  await expect(page.locator("#splash-view-account")).toBeHidden();
  await expect(page.locator("#splash-signed-in")).toBeVisible();
  await expect(page.locator("#splash-signed-in-name")).toHaveText(NEW);
  await expect(page.locator("#splash-prof-name"), "starting from her own address").toHaveValue("new");
  expect(await signInFields(page), "the sign-in form is emptied, as after any sign-in").toEqual(NOTHING);
  expect((await joinFields(page)).name, "not a change of account: what the visitor typed stays").toBe("Typed Name");

  await setUpThenSignOut(page, uid);
  expect(errors).toEqual([]);
});

test("I: so is an account made with the Google button, and a popup that is closed changes nothing", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await frontPage(page);
  const uid = await page.evaluate(() => currentUser.uid);
  await page.locator("#splash-go-account").click();
  await expect(page.locator("#splash-view-account")).toBeVisible();

  // 1. The popup is closed without choosing an account.
  let since = await mark(page);
  await page.evaluate(() => { window.__popup = { error: "auth/popup-closed-by-user" }; });
  await page.locator("#splash-google-signin").click();
  await expect(page.locator("#splash-account-hint")).toHaveText("Sign-in was cancelled.");
  await expect(page.locator("#splash-account-hint")).toHaveClass(/(^|\s)err(\s|$)/);
  expect(await pageState(page, since), "still the anonymous visitor, and nothing handled")
    .toEqual({ uid, anonymous: true, reported: [], handled: [] });
  await expect(page.locator("#splash-view-account")).toBeVisible();
  await expect(page.locator("#splash-signed-in")).toBeHidden();

  // 2. An address and a password typed first, then the Google button instead.
  await page.locator("#splash-email-input").fill("half@example.test");
  await page.locator("#splash-password-input").fill("Half-typed-1");
  since = await mark(page);
  await page.evaluate((email) => { window.__popup = { email, displayName: "Nova Example" }; }, NEW);
  await page.locator("#splash-google-signin").click();

  await expect(page.locator("#splash-view-profile-setup")).toBeVisible();
  expect(await pageState(page, since), "premise: upgraded in place, unreported; handled once by the page itself")
    .toEqual({ uid, anonymous: false, reported: [], handled: [uid] });
  await expect(page.locator("#splash-signed-in")).toBeVisible();
  await expect(page.locator("#splash-signed-in-name")).toHaveText(NEW);
  await expect(page.locator("#splash-prof-name"), "starting from the name Google gave").toHaveValue("Nova");
  await expect(page.locator("#splash-account-hint")).toHaveText("");
  expect(await signInFields(page), "what was typed in the e-mail form is not left in it").toEqual(NOTHING);

  await setUpThenSignOut(page, uid);
  expect(errors).toEqual([]);
});

test("I: a sign-up that turns out to be another account is reported by the SDK and handled once, not twice", async ({ page }) => {
  /* The address already has an account: the link is refused, the page signs in
     to that account instead, the uid changes and the SDK reports it. */
  const errors = collectErrors(page);
  await frontPage(page);
  await page.evaluate(({ who, password }) => { window.__register(who, password); }, { who: ALICE, password: PASSWORD });
  await seed(page, "users/u_alice/profile", ALICE_PROFILE);
  await page.locator("#splash-go-account").click();
  await page.locator("#splash-email-mode-signup").click();
  await page.locator("#splash-email-input").fill(ALICE.email);
  await page.locator("#splash-password-input").fill(PASSWORD);
  await page.locator("#splash-password-confirm").fill(PASSWORD);
  const since = await mark(page);
  await page.locator("#splash-email-submit").click();

  await expect(page.locator("#splash-signed-in-name")).toHaveText("Alice");
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  expect(await pageState(page, since))
    .toEqual({ uid: "u_alice", anonymous: false, reported: ["u_alice"], handled: ["u_alice"] });
  expect(await signInFields(page)).toEqual(NOTHING);
  expect(errors).toEqual([]);
});
