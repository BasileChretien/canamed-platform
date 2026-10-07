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
    const report = (user) => { lastUid = user ? user.uid : null; handleAuthStateChange(user); };
    const later = (user) => Promise.resolve().then(() => {
      if ((user ? user.uid : null) !== lastUid) report(user);
    });
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
            user.isAnonymous = false;
            user.email = cred.email;
            return Promise.resolve({ user });
          }
        };
        auth.currentUser = user;
        return later(user).then(() => ({ user }));
      },
      signInWithEmailAndPassword(email, password) {
        const a = accounts[email];
        if (!a || a.password !== password) {
          return Promise.reject(Object.assign(new Error("refused"), { code: "auth/invalid-credential" }));
        }
        auth.currentUser = a.user;
        return later(a.user).then(() => ({ user: a.user }));
      },
      signOut() { auth.currentUser = null; return later(null); }
    };
    /* LOCAL mode never calls the SDK; the sign-up path asks it for one thing. */
    window.firebase = { auth: { EmailAuthProvider: { credential: (email, password) => ({ email, password }) } } };
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
