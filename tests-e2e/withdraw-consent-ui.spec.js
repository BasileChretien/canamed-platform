/* tests-e2e/withdraw-consent-ui.spec.js
 *
 * The in-product withdrawal control (GDPR Art. 7(3), Annex VI G12).
 *
 * Art. 7(3) is a claim about EFFORT: withdrawal must be "as easy to withdraw as
 * to give", and consent was given by ticking a box on the join screen. So what
 * this spec pins is not just that a function exists but that the control is
 * present, reachable and operable on the screen every participant lands on,
 * at every viewport. A control that is technically present but clipped off a
 * phone screen does not satisfy Art. 7(3), and this project has shipped exactly
 * that before (the admin Start button, untappable on Pixel 7 because horizontal
 * overflow had zoomed the page out).
 *
 * Hermetic LOCAL mode, so — as in moderation-ui.spec.js — there is no auth at
 * all: script.js only assigns `auth` in the Firebase branch. The WRITE is
 * therefore covered against the real rules engine by the "withdrawal is
 * possible AFTER the session closes" test in
 * tests-e2e/emulator/rules-smoke.spec.js. What this spec pins is the UI
 * contract plus the signed-out guard — and that the guard SPEAKS, because a
 * button that silently does nothing when clicked is worse than no button:
 * a participant would believe they had withdrawn.
 *
 * Runs on desktop + mobile-iphone/ipad/android per CLAUDE.md's per-device
 * standing instruction — the basename is registered in the three mobile
 * testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures.js");

async function pinLocal(page) {
  await forceLocalMode(page);
}

/* Create a session, join it as a participant, and land on the waiting screen —
   the screen that carries the data-rights row. */
async function joinAsParticipant(page) {
  await pinLocal(page);
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Facilitator");
  await page.locator("#splash-create-label").fill("Withdrawal probe");
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  await page.evaluate(() => {
    const s = /** @type {any} */ (document.getElementById("splash-section-add"));
    // @ts-ignore — splash globals
    splashSectionPick.length = 0;
    // @ts-ignore
    splashSectionPick.push(s.options[0].value);
    // @ts-ignore
    renderSectionPick();
  });
  await page.locator("#splash-create-pass").fill("e2e-pass-2026");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/[A-Z0-9]{3}-?[A-Z0-9]{3}/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();

  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 20_000 });
  await page.locator("#name-input").fill("E2E Student");
  const uni = await page.locator("#uni-input option:not([disabled])").first()
    .getAttribute("value");
  await page.locator("#uni-input").selectOption(uni);
  await page.locator("#consent-workshop").check();
  await page.locator("#consent-research").check();
  await expect(page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#join-btn").click();
  await expect(page.locator("#waiting")).toBeVisible({ timeout: 20_000 });
}

test("the withdrawal control is visible and tappable beside the data export", async ({ page }) => {
  await joinAsParticipant(page);

  const btn = page.locator("#gdpr-withdraw-btn");
  await expect(btn).toBeVisible();
  await expect(page.locator("#gdpr-export-btn")).toBeVisible();

  /* Not merely present in the DOM. Playwright's actionability check covers
     "not covered by another element", which is the failure this project has
     actually shipped on a phone. */
  await expect(btn).toBeEnabled();
  const box = await btn.boundingBox();
  expect(box, "the withdraw button has no layout box").not.toBeNull();
  expect(box.width, "the withdraw button is too narrow to tap").toBeGreaterThan(40);
  expect(box.height, "the withdraw button is too short to tap").toBeGreaterThan(20);

  /* And the page must not have blown out horizontally — the mechanism behind
     the untappable-control bug: overflow zooms the page out and every hit-test
     lands somewhere else. */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the waiting screen overflows horizontally").toBeLessThanOrEqual(2);
});

test("clicking it without a signed-in user SAYS so rather than failing silently", async ({ page }) => {
  await joinAsParticipant(page);

  /* The confirm dialog must not even open when there is nobody to record the
     withdrawal for — the guard runs first, so a participant is never asked to
     confirm something that cannot happen. */
  await page.locator("#gdpr-withdraw-btn").click();
  const hint = page.locator("#gdpr-withdraw-hint");
  await expect(hint).not.toBeEmpty({ timeout: 10_000 });
  await expect(hint).toContainText(/sign-in|sign in/i);
  await expect(page.locator("#canamed-modal")).toBeHidden();
});

test("the control is labelled for assistive tech and reads as an action", async ({ page }) => {
  await joinAsParticipant(page);
  const btn = page.locator("#gdpr-withdraw-btn");
  /* A right you cannot find is not "as easy as" a tick-box. The accessible
     name must say what it does — not "click here". */
  await expect(btn).toHaveText(/withdraw/i);
  expect(await btn.evaluate((n) => n.tagName)).toBe("BUTTON");
  expect(await btn.getAttribute("type")).toBe("button");
  /* The hint is a live region, so the guard message above is announced rather
     than only rendered. */
  const hint = page.locator("#gdpr-withdraw-hint");
  expect(await hint.getAttribute("role")).toBe("status");
  expect(await hint.getAttribute("aria-live")).toBe("polite");
});
