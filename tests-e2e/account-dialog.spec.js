/* tests-e2e/account-dialog.spec.js
 *
 * The account dialog OPENS, and says truthfully what "Delete account" does.
 *
 * Two reasons this spec exists:
 *
 *   1. Nothing opened this dialog in a browser. `_historyListenerRef` lost its
 *      declaration in #264 (2026-07-31); from then on openAccountDialog() threw
 *      a ReferenceError before reaching dialogShow(), so the profile editor,
 *      sign-out, "Delete account" and the per-session withdrawal button were
 *      all unreachable in production — for over two months, with every check
 *      green. The controls were covered only by tests that looked for their
 *      markup.
 *   2. The dialog's standing text described deletion as removing "your profile
 *      and history" and said session contributions were "no longer linked to
 *      your identity". Neither was accurate (see tests/account-delete.test.js).
 *      The replacement text is longer, so it is checked for overflow on every
 *      viewport.
 *
 * Hermetic LOCAL mode has no auth at all, so no user is ever signed in and the
 * header chip that opens the dialog stays hidden. The tests stand a user in —
 * the dialog reads only `uid` and `email` — and call the app's own
 * openAccountDialog(), which is the function that was broken. The deletion
 * itself needs real rules and a real account: that is
 * tests-e2e/emulator/account-delete.spec.js.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const CODE = "ABC-123";

async function openDialog(page) {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof openAccountDialog === "function" && typeof dbInit === "function");
  await page.evaluate(async (code) => {
    dbInit();
    /* `currentUser` is a script-scope `let`, so this assigns the app's own
       binding. */
    currentUser = { uid: "u_local", email: "local@example.test", isAnonymous: false };
    await db.ref("users/u_local/history/" + code).set({ code, joinedAt: Date.now() });
    openAccountDialog();
  }, CODE);
}

test("the account dialog opens and lists joined sessions with a withdraw control", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));

  await openDialog(page);

  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("local@example.test");
  // The history is painted by loadHistoryForDialog() — the function that threw.
  await expect(page.locator("#account-history .account-history-code")).toHaveText(CODE);
  /* The only in-product route a signed-in participant has to withdraw from a
     session once it is over (DPA Annex VI, G12). */
  await expect(page.locator("#account-history .account-history-withdraw")).toBeVisible();

  // Closing reads the same variable, AFTER it has hidden the dialog — so a
  // broken close would still look closed. The error list is what catches it.
  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  expect(errors, "opening and closing the dialog must not throw").toEqual([]);
});

test("the dialog says what Delete account removes and what it does not, without overflowing", async ({ page }) => {
  await openDialog(page);

  const scope = page.locator("#account-delete-scope");
  await scope.scrollIntoViewIfNeeded();
  await expect(scope).toBeVisible();
  await expect(scope).toContainText("every scenario you authored");
  await expect(scope).toContainText("shared library");
  await expect(scope).toContainText("does not remove");
  await expect(scope).toContainText("the name you joined under");
  await expect(scope).toContainText("reports you filed");
  await expect(scope).not.toContainText("no longer linked");
  // The route to have the rest erased has to be reachable from here.
  await expect(scope.locator("a")).toHaveAttribute("href", /privacy/);

  await expect(page.locator("#account-delete-btn")).toBeVisible();

  /* The paragraph roughly tripled in length. On a phone the dialog is 92vw: the
     text must wrap inside its own box, stay inside the fieldset that holds it,
     and leave the destructive button unclipped.

     Scoped to THIS paragraph and button on purpose. The dialog as a whole
     already scrolls sideways on phones — the PROFILE fieldset sticks out of the
     content box by 6 px at 412 px wide and 25 px at 393 px — and it measures
     identically with this paragraph removed (2026-10-07). That is a separate
     layout defect; asserting `scrollWidth <= clientWidth` on the whole dialog
     here would pin this spec to it. */
  const m = await page.evaluate(() => {
    const p = document.getElementById("account-delete-scope");
    const zone = p.closest("fieldset").getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const btn = document.getElementById("account-delete-btn").getBoundingClientRect();
    return {
      pScroll: p.scrollWidth, pClient: p.clientWidth,
      pLeft: pr.left, pRight: pr.right, zoneLeft: zone.left, zoneRight: zone.right,
      btnLeft: btn.left, btnRight: btn.right,
      docScroll: document.documentElement.scrollWidth, vw: window.innerWidth
    };
  });
  expect(m.pScroll, "the text must wrap, not overflow its own box").toBeLessThanOrEqual(m.pClient + 1);
  expect(m.pLeft, "the text must stay inside its fieldset").toBeGreaterThanOrEqual(m.zoneLeft);
  expect(m.pRight, "the text must stay inside its fieldset").toBeLessThanOrEqual(m.zoneRight + 1);
  expect(m.zoneRight, "that fieldset must be inside the viewport").toBeLessThanOrEqual(m.vw + 1);
  expect(m.btnLeft).toBeGreaterThanOrEqual(0);
  expect(m.btnRight, "Delete account must not be clipped").toBeLessThanOrEqual(m.vw + 1);
  expect(m.docScroll, "the page must not scroll sideways").toBeLessThanOrEqual(m.vw + 1);
});

test("Delete account asks nothing where there is no auth backend (LOCAL mode)", async ({ page }) => {
  /* What this covers is the `!auth` guard, and only that: the tests stand a
     USER in, but LOCAL mode never assigns `auth`. The button's shim must return
     before asking anything — and before fetching the lazy deletion code — when
     there is no account system behind it. A confirm appearing here would be a
     prompt to delete an account that does not exist. */
  const dialogs = [];
  page.on("dialog", d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await openDialog(page);
  await page.locator("#account-delete-btn").scrollIntoViewIfNeeded();
  await page.locator("#account-delete-btn").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => typeof window.deleteMyAccount),
    "the lazy chunk must not be fetched for a click that can do nothing").toBe("undefined");
});
