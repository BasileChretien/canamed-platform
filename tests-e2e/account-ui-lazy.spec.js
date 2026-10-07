/* tests-e2e/account-ui-lazy.spec.js
 *
 * Contract for the account screens' lazy split. The sign-in view, the account
 * dialog and the profile-setup save are in account-ui.js, which the page
 * fetches through CanamedLoader.ensureAccountUI() the first time one of them is
 * asked for — and at no other time.
 *
 * Three things must stay true in a browser:
 *   1. The page does not ask for the chunk on the front page, nor on the way
 *      from a session code through the join into a room. Otherwise the bytes
 *      taken out of script.js are downloaded anyway, by everybody.
 *   2. It asks ONCE when the sign-in view opens and when the dialog opens, and
 *      what the chunk wires then works.
 *   3. A click made before the chunk has arrived is neither lost nor doubled,
 *      and a chunk that cannot be fetched is said, on screen, with a second try
 *      that works.
 *
 * "The page does not ask" is meant literally: the service worker precaches the
 * file in the background when it installs, as it does every chunk, and that
 * request is not the page's. What script.js and the chunk keep as text is
 * tests/account-ui-lazy-split.test.js; the wait itself, with an account that
 * changes during it, is tests/account-dialog-state.test.js (section J).
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is registered
 * in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures.js");

const CHUNK = /\/account-ui\.js(\?|$)/;
const CODE = "ABC-123";

/* Every script the page asks for, from before it loads. */
function watch(page) {
  const seen = { scripts: [], chunk: [] };
  page.on("request", (r) => {
    const u = r.url();
    if (/\.js(\?|$)/.test(u)) seen.scripts.push(u);
    if (CHUNK.test(u)) seen.chunk.push(u);
  });
  return seen;
}
/* The loader's idle prefetch has run: without this, "the chunk was not asked
   for" could be true only because nothing had been asked for yet. */
const idlePrefetchDone = (seen) =>
  expect.poll(() => seen.scripts.some((u) => /\/tour\.js\?/.test(u)), { timeout: 15_000 }).toBe(true);
/* Whether the chunk has been run in the page. */
const chunkIn = (page) => page.evaluate(() =>
  typeof openAccountDialog === "function" && typeof wireAccountChunk === "function");
const tags = (page) => page.locator('script[src*="account-ui.js"]').count();

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  return errors;
}

/* Stand a signed-in user in on the front page and paint the signed-in row, as
   the app's own auth-state handler does (LOCAL mode has no auth backend). */
async function signedInOnFrontPage(page) {
  await page.goto("/");
  await page.waitForFunction(() => typeof paintUserChip === "function" && typeof dbInit === "function");
  await page.evaluate(async (code) => {
    dbInit();
    /* `currentUser` is a script-scope `let`, so this assigns the app's own binding. */
    currentUser = { uid: "u_local", email: "local@example.test", isAnonymous: false };
    await db.ref("users/u_local/history/" + code).set({ code, joinedAt: Date.now() });
    paintUserChip();
  }, CODE);
  await expect(page.locator("#splash-signed-in-account")).toBeVisible();
}

/* ---- 1. not asked for where nobody needs it ------------------------------ */

test("the front page does not ask for account-ui.js", async ({ page }) => {
  const seen = watch(page);
  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();
  await idlePrefetchDone(seen);

  expect(seen.chunk, "account-ui.js was requested by the front page").toEqual([]);
  expect(await tags(page)).toBe(0);
  // None of it is defined either: a copy left in script.js would pass the line above.
  expect(await chunkIn(page)).toBe(false);
  expect(await page.evaluate(() => [typeof signInWithEmail, typeof scorePassword, typeof authErrorMessage]))
    .toEqual(["undefined", "undefined", "undefined"]);
  // And what leads to it is there, waiting for a click.
  await expect(page.locator("#splash-go-account")).toBeVisible();
});

/* A facilitator's tab: creates a session and opens its dashboard. Confirms are
   accepted for it (the in-page modal and the native ones), as a facilitator
   would. Same flow as advance-and-close.spec.js. */
async function createSession(adminPage) {
  await adminPage.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    const tryAccept = () => {
      const dlg = /** @type {HTMLDialogElement} */ (document.getElementById("canamed-modal"));
      const ok = document.getElementById("canamed-modal-confirm");
      if (dlg && dlg.open && ok) ok.click();
    };
    document.addEventListener("DOMContentLoaded", () => { setInterval(tryAccept, 200); });
  });
  adminPage.on("dialog", (d) => { d.accept().catch(() => {}); });
  await adminPage.goto("/");
  await adminPage.locator("#splash-go-create").click();
  await adminPage.locator("#splash-create-name").fill("E2E Fac");
  await adminPage.locator("#splash-create-label").fill("E2E account-ui lazy");
  await adminPage.locator("#splash-create-pass").fill("e2e-lazy-pw");
  await adminPage.locator("#splash-create-submit").click();
  const codeNode = adminPage.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  await adminPage.locator("#splash-go-admin").click();
  await expect(adminPage.locator("#admin-app")).toBeVisible({ timeout: 20_000 });
  return code;
}

test("nor does entering a code, joining and working in a room", async ({ page, context }) => {
  const admin = watch(page);
  const code = await createSession(page);

  /* The participant: a second tab of the same browser (LocalDB syncs across
     them). The fixture pins LOCAL mode on ITS page only, so it is pinned here
     too — without it this tab would load the real Firebase configuration. */
  const tab = await context.newPage();
  await forceLocalMode(tab);
  await tab.addInitScript(() => {
    for (const k of ["canamed_session", "canamed_resume", "canamed_name"]) localStorage.removeItem(k);
  });
  const seen = watch(tab);
  const errors = collectErrors(tab);
  await tab.goto("/");
  expect(await tab.evaluate(() => MODE), "the participant's tab must be in LOCAL mode").toBe("local");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 20_000 });
  await tab.locator("#name-input").fill("E2E Student");
  const uni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab.locator("#uni-input").selectOption(uni);
  await tab.locator("#consent-workshop").check();
  await expect(tab.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await tab.locator("#join-btn").click();
  await expect(tab.locator("#waiting")).toBeVisible({ timeout: 20_000 });

  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 15_000 });
  await page.locator("#start-session-btn").click();
  await expect(tab.locator("#app"), "the participant must reach the room").toBeVisible({ timeout: 20_000 });
  await expect(tab.locator("#stage-indicator")).toContainText(/Stage 1/, { timeout: 15_000 });
  await idlePrefetchDone(seen);

  expect(seen.chunk, "the participant's page requested account-ui.js on the way to the room").toEqual([]);
  expect(await chunkIn(tab)).toBe(false);
  expect(admin.chunk, "so did the facilitator's, creating and starting the session").toEqual([]);
  expect(await chunkIn(page)).toBe(false);
  expect(errors, "and none of it threw for want of the chunk").toEqual([]);
  await tab.close();
});

/* ---- 2. asked for once, where it is needed -------------------------------- */

test("opening the sign-in view fetches the chunk once, and its controls work", async ({ page }) => {
  const errors = collectErrors(page);
  const seen = watch(page);
  await page.goto("/");
  await expect(page.locator("#splash-go-account")).toBeVisible();
  expect(seen.chunk).toEqual([]);

  await page.locator("#splash-go-account").click();
  await expect(page.locator("#splash-view-account")).toBeVisible();
  expect(await chunkIn(page)).toBe(true);
  expect(seen.chunk.length, "one request").toBe(1);
  expect(seen.chunk[0], "root-absolute and versioned, like every chunk").toMatch(/^https?:\/\/[^/]+\/account-ui\.js\?v=v\d+$/);

  // What only the chunk wires: the mode tabs, the strength meter, Back.
  await expect(page.locator("#splash-password-confirm")).toBeHidden();
  await page.locator("#splash-email-mode-signup").click();
  await expect(page.locator("#splash-password-confirm")).toBeVisible();
  await page.locator("#splash-password-input").fill("Str0ng-Pass!2025");
  await expect(page.locator("#splash-pwd-strength-fill")).toHaveAttribute("data-score", "4");
  await page.locator("#splash-back-from-account").click();
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  await expect(page.locator("#splash-password-input"), "Back empties the form").toHaveValue("");

  // A second visit asks for nothing.
  await page.locator("#splash-go-account").click();
  await expect(page.locator("#splash-view-account")).toBeVisible();
  expect(seen.chunk.length).toBe(1);
  expect(await tags(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("opening the account dialog from the front page fetches the chunk once", async ({ page }) => {
  const errors = collectErrors(page);
  const seen = watch(page);
  await signedInOnFrontPage(page);
  expect(seen.chunk).toEqual([]);
  expect(await chunkIn(page)).toBe(false);

  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("local@example.test");
  await expect(page.locator("#account-history .account-history-code")).toHaveText(CODE);
  expect(seen.chunk.length, "one request").toBe(1);

  // What only the chunk wires: Close. Then the same opener again, at once.
  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  await page.locator("#splash-signed-in-account").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  expect(seen.chunk.length).toBe(1);
  expect(await tags(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("so does the header chip, inside a session", async ({ page }) => {
  const errors = collectErrors(page);
  const seen = watch(page);
  await signedInOnFrontPage(page);
  /* The chip is in the header, which a locked page hides: unlock it as entering
     a session does, so that the click is a real one on a visible control. */
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    document.getElementById("splash").classList.add("hidden");
  });
  await expect(page.locator("#user-chip")).toBeVisible();
  expect(seen.chunk).toEqual([]);

  await page.locator("#user-chip").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("local@example.test");
  expect(seen.chunk.length).toBe(1);
  expect(errors).toEqual([]);
});

/* ---- 3. the wait, and a fetch that fails ---------------------------------- */

/* These hold or refuse the chunk's request, which page.route() cannot do for a
   request a service worker makes on the page's behalf. */
test.describe("while the chunk is on its way, or cannot come", () => {
  test.use({ serviceWorkers: "block" });

  test("clicks made before it has arrived are neither lost nor doubled", async ({ page }) => {
    const errors = collectErrors(page);
    const seen = watch(page);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route(CHUNK, async (route) => { await held; await route.continue(); });
    await signedInOnFrontPage(page);

    const account = page.locator("#splash-signed-in-account");
    await account.click();
    await account.click();                              // an impatient second press
    await page.locator("#splash-go-account").click();   // and another way in
    await expect.poll(() => seen.chunk.length).toBe(1);
    await expect(page.locator("#account-dialog"), "nothing opens before its code is there").toBeHidden();
    await expect(page.locator("#splash-view-enter")).toBeVisible();
    expect(await chunkIn(page)).toBe(false);

    release();
    await expect(page.locator("#account-dialog"), "the click is not lost").toBeVisible();
    await expect(page.locator("#account-email")).toHaveText("local@example.test");
    /* Opened ONCE: showModal() on a dialog that is already open throws, and the
       app then falls back to its polyfill, which marks the dialog. */
    await expect(page.locator("#account-dialog")).not.toHaveClass(/dialog-polyfill/);
    expect(seen.chunk.length, "one file, one request").toBe(1);
    expect(await tags(page)).toBe(1);
    await page.locator("#account-dialog-close").click();
    await expect(page.locator("#account-dialog")).toBeHidden();
    await expect(page.locator("#splash-view-account"), "nor is the other click").toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a sign-in view that cannot be fetched says so, and the next click works", async ({ page }) => {
    const seen = watch(page);
    await page.route(CHUNK, (route) => route.abort());
    await page.goto("/");
    await page.locator("#splash-go-account").click();

    const toast = page.locator("#toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/sign-in screen/i);
    await expect(toast).toContainText(/check your connection and try again/i);
    await expect(page.locator("#splash-view-enter"), "and the page is left as it was").toBeVisible();
    await expect(page.locator("#splash-view-account")).toBeHidden();
    expect(await chunkIn(page)).toBe(false);

    await page.unroute(CHUNK);
    await page.locator("#splash-go-account").click();
    await expect(page.locator("#splash-view-account"), "'try again' must be true").toBeVisible();
    expect(seen.chunk.length, "the second click asked again").toBe(2);
    expect(await chunkIn(page)).toBe(true);
  });

  test("an account dialog that cannot be fetched says so, and the next click works", async ({ page }) => {
    await page.route(CHUNK, (route) => route.abort());
    await signedInOnFrontPage(page);
    await page.locator("#splash-signed-in-account").click();

    const toast = page.locator("#toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/your account/i);
    await expect(toast).toContainText(/check your connection and try again/i);
    await expect(page.locator("#account-dialog")).toBeHidden();

    await page.unroute(CHUNK);
    await page.locator("#splash-signed-in-account").click();
    await expect(page.locator("#account-dialog")).toBeVisible();
    await expect(page.locator("#account-email")).toHaveText("local@example.test");
  });

  test("a profile-setup form whose code cannot be fetched says nothing was saved, and saves on the next try", async ({ page }) => {
    await page.route(CHUNK, (route) => route.abort());
    await signedInOnFrontPage(page);
    /* The form is shown by script.js's own handler for an account with no
       profile; shown here the same way, since LOCAL mode has no account. */
    await page.evaluate(() => {
      populateProfileSelects("splash-prof-uni");
      splashShowView("profile-setup");
    });
    await page.locator("#splash-prof-name").fill("Local Student");
    const uni = await page.locator("#splash-prof-uni option:not([disabled])").first().getAttribute("value");
    await page.locator("#splash-prof-uni").selectOption(uni);
    await page.locator("#splash-profile-setup-submit").click();

    const hint = page.locator("#splash-profile-setup-hint");
    await expect(hint).toContainText(/nothing was saved/i);
    await expect(hint).toHaveClass(/(^|\s)err(\s|$)/);
    await expect(page, "the browser's own submit must not have reloaded the page").toHaveURL(/\/$/);
    await expect(page.locator("#splash-prof-name"), "and the form is as it was filled").toHaveValue("Local Student");
    expect(await page.evaluate(() => db.ref("users/u_local/profile").once("value").then((s) => s.val()))).toBeNull();

    await page.unroute(CHUNK);
    await page.locator("#splash-profile-setup-submit").click();
    await expect(page.locator("#splash-view-enter")).toBeVisible();
    const saved = await page.evaluate(() => db.ref("users/u_local/profile").once("value").then((s) => s.val()));
    expect(saved.name).toBe("Local Student");
    expect(saved.university).toBe(uni);
  });
});
