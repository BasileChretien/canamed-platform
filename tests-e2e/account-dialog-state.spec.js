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
    const later = (user) => Promise.resolve().then(() => { handleAuthStateChange(user); });
    /* `auth` is a script-scope `let` in script.js, so this assigns the app's own
       binding. */
    auth = {
      currentUser: null,
      signInAnonymously() {
        const user = { uid: "u_anon" + (++anon), email: null, displayName: null, isAnonymous: true };
        auth.currentUser = user;
        return later(user).then(() => ({ user }));
      },
      signOut() { auth.currentUser = null; return later(null); }
    };
    window.__signIn = (who) => {
      const user = Object.assign({
        displayName: null, isAnonymous: false,
        delete() { auth.currentUser = null; return later(null); }
      }, who);
      auth.currentUser = user;
      handleAuthStateChange(user);
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
