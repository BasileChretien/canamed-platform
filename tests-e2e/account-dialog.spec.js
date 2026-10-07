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
 *   3. Once it could open again, it could still only be opened from INSIDE a
 *      session: its one caller was the header chip, and `body.locked` hides the
 *      whole header until a session code has been accepted. A signed-in person
 *      on the front page — which is where someone coming back weeks later to
 *      withdraw or delete lands, possibly with a code that has since been
 *      purged — had "Signed in as … Sign out" and nothing else. The front-page
 *      tests at the bottom open it through the link that row now carries.
 *
 * Hermetic LOCAL mode has no auth at all, so no user is ever signed in and
 * neither control that opens the dialog is shown. The tests stand a user in —
 * the dialog reads only `uid` and `email`. The first three call the app's own
 * openAccountDialog(), which is the function that was broken; the front-page
 * ones call paintUserChip() and then CLICK, because there the route is the
 * thing under test. The deletion itself needs real rules and a real account:
 * that is tests-e2e/emulator/account-delete.spec.js.
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

/* ---- reaching the dialog from the front page ------------------------------ */

/* Stand a user in on the front page and paint the signed-in row, as the app's
   own auth-state handler does. No session code is entered at any point. */
async function signedInOnFrontPage(page, user) {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof paintUserChip === "function" && typeof dbInit === "function");
  await page.evaluate(async ({ user, code }) => {
    dbInit();
    currentUser = Object.assign({ uid: "u_local", isAnonymous: false }, user);
    await db.ref("users/u_local/history/" + code).set({ code, joinedAt: Date.now() });
    paintUserChip();
  }, { user, code: CODE });
}

test("a signed-in user opens the dialog from the front page, without a session code", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));

  await signedInOnFrontPage(page, { email: "local@example.test" });

  /* Positive control for "not in a session": the page is still locked, so the
     header — and the chip in it, which paintUserChip() has just un-hidden — is
     not displayed. Without this the test would pass just as well from inside a
     session, where the dialog was always reachable. */
  await expect(page.locator("body")).toHaveClass(/(^|\s)locked(\s|$)/);
  await expect(page.locator("#user-chip")).not.toHaveClass(/hidden/);
  await expect(page.locator("#user-chip")).toBeHidden();

  const link = page.locator("#splash-signed-in-account");
  await expect(link).toBeVisible();
  // The text, not just the element: a missing i18n key renders as the raw key.
  await expect(link).toHaveText("Account");
  await link.click();

  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("local@example.test");
  /* What a returning participant comes for: the per-session withdrawal control
     and Delete account, both reachable with no working session code. */
  await expect(page.locator("#account-history .account-history-code")).toHaveText(CODE);
  await expect(page.locator("#account-history .account-history-withdraw")).toBeVisible();
  await page.locator("#account-delete-btn").scrollIntoViewIfNeeded();
  await expect(page.locator("#account-delete-btn")).toBeVisible();

  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  // Still on the front page, still locked: opening it must not have let anyone in.
  await expect(page.locator("body")).toHaveClass(/(^|\s)locked(\s|$)/);
  await expect(page.locator("#splash")).toBeVisible();
  expect(errors, "opening the dialog from the front page must not throw").toEqual([]);
});

test("the signed-in row keeps both of its links inside the card, whatever the name", async ({ page }) => {
  /* The row shows the profile name, or the e-mail address when there is no
     profile yet — and an institutional address has no break opportunity for
     fifty characters. The row grew a third item; on a phone it has to wrap
     rather than push "Sign out" out of the card. */
  await signedInOnFrontPage(page,
    { email: "firstname.middlename.familyname.u4@student.mail.example-university.test" });

  const row = page.locator("#splash-signed-in");
  await expect(row).toBeVisible();
  await expect(page.locator("#splash-signed-in-name"))
    .toHaveText("firstname.middlename.familyname.u4@student.mail.example-university.test");
  await expect(page.locator("#splash-signed-in-account")).toBeVisible();
  await expect(page.locator("#splash-signed-in-out")).toBeVisible();

  const m = await page.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    const row = box("splash-signed-in");
    const card = document.querySelector(".splash-card").getBoundingClientRect();
    const name = box("splash-signed-in-name"), acct = box("splash-signed-in-account"),
          out = box("splash-signed-in-out");
    return {
      rowLeft: row.left, rowRight: row.right, cardLeft: card.left, cardRight: card.right,
      nameLeft: name.left, nameRight: name.right,
      acctLeft: acct.left, acctRight: acct.right, acctTop: acct.top, acctBottom: acct.bottom,
      outLeft: out.left, outRight: out.right, outTop: out.top, outBottom: out.bottom,
      docScroll: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth
    };
  });
  expect(m.rowLeft, "the row must stay inside the card").toBeGreaterThanOrEqual(m.cardLeft - 1);
  expect(m.rowRight, "the row must stay inside the card").toBeLessThanOrEqual(m.cardRight + 1);
  expect(m.nameLeft, "the name must stay inside the row").toBeGreaterThanOrEqual(m.rowLeft - 1);
  expect(m.nameRight, "the name must wrap, not run out of the row").toBeLessThanOrEqual(m.rowRight + 1);
  for (const [what, l, r] of [["Account", m.acctLeft, m.acctRight], ["Sign out", m.outLeft, m.outRight]]) {
    expect(l, what + " must stay inside the row").toBeGreaterThanOrEqual(m.rowLeft - 1);
    expect(r, what + " must stay inside the row").toBeLessThanOrEqual(m.rowRight + 1);
  }
  /* Two tap targets, not one: they may share a line or sit on two, but their
     boxes must not overlap. */
  const sameLine = m.acctTop < m.outBottom && m.outTop < m.acctBottom;
  if (sameLine) {
    expect(m.acctRight, "Account and Sign out must not overlap").toBeLessThanOrEqual(m.outLeft + 1);
  }
  expect(m.docScroll, "the page must not scroll sideways").toBeLessThanOrEqual(m.vw + 1);
});
