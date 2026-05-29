/* tests-e2e/splash-authored-scenarios.spec.js
 *
 * Coverage for the Phase 1–3 UI additions (2026-05-29):
 *
 *   - Splash account view now offers email/password sign-in alongside Google.
 *   - The "Author scenarios" splash row is hidden by default (revealed only
 *     once a non-anonymous user signs in, which can't happen in LOCAL mode).
 *   - The scenario picker on the create-session view still works in LOCAL
 *     mode — authored scenarios fail-soft to an empty list, built-ins show.
 *
 * LOCAL mode caveat: forceLocalMode() pins CANAMED_FIREBASE = null, so
 * sign-in attempts deliberately bail with "Sign-in is not available in
 * local-test mode." That's exactly what we assert here — proves the auth
 * helpers were wired without raising; full sign-in coverage would need
 * the Firebase emulator (out of scope for the hermetic suite).
 *
 * Runs on every configured viewport (desktop, mobile-iphone, mobile-ipad,
 * mobile-android) per CLAUDE.md's per-device standing instruction —
 * Playwright projects handle the viewport multiplexing.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Splash — authored scenarios entry points", () => {
  test("account view exposes email/password form alongside Google", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();

    // Existing Google button still present.
    await expect(page.locator("#splash-google-signin")).toBeVisible();

    // New email/password form: mode tabs + fields + single submit button.
    await expect(page.locator("#splash-email-form")).toBeVisible();
    await expect(page.locator("#splash-email-mode-signin")).toBeVisible();
    await expect(page.locator("#splash-email-mode-signup")).toBeVisible();
    await expect(page.locator("#splash-email-input")).toBeVisible();
    await expect(page.locator("#splash-password-input")).toBeVisible();
    await expect(page.locator("#splash-email-submit")).toBeVisible();
    // Confirm-password + strength meter are sign-up only and start hidden.
    await expect(page.locator("#splash-password-confirm")).toBeHidden();
  });

  test("switching to 'Create a new account' reveals confirm + strength meter", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();
    await page.locator("#splash-email-mode-signup").click();
    await expect(page.locator("#splash-password-confirm")).toBeVisible();
    await expect(page.locator("#splash-pwd-strength-label")).toBeVisible();
    // Submit button relabels from "Sign in" → "Create account".
    await expect(page.locator("#splash-email-submit")).toContainText(/create account|cr.er un compte|アカウントを作成/i);

    // Typing a weak password lights up the meter at a low score.
    await page.locator("#splash-password-input").fill("aaaaaaaa");
    await expect(page.locator("#splash-pwd-strength-fill"))
      .toHaveAttribute("data-score", /[0-1]/);

    // A strong password lights it up at a high score.
    await page.locator("#splash-password-input").fill("Str0ng-Pass!2025");
    await expect(page.locator("#splash-pwd-strength-fill"))
      .toHaveAttribute("data-score", /[3-4]/);
  });

  test("sign-up blocks mismatched passwords and weak passwords with a clear error", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();
    await page.locator("#splash-email-mode-signup").click();
    await page.locator("#splash-email-input").fill("new@example.test");
    await page.locator("#splash-password-input").fill("Str0ng-Pass!2025");
    await page.locator("#splash-password-confirm").fill("typo-typo-typo");
    await page.locator("#splash-email-submit").click();
    await expect(page.locator("#splash-account-hint"))
      .toContainText(/don't match|ne correspondent|一致しません/i);

    // Matching but weak password → blocked with the strength error.
    await page.locator("#splash-password-input").fill("aaaaaaaa");
    await page.locator("#splash-password-confirm").fill("aaaaaaaa");
    await page.locator("#splash-email-submit").click();
    await expect(page.locator("#splash-account-hint"))
      .toContainText(/stronger|plus fort|より強い/i);
  });

  test("email sign-in shows a clear error in LOCAL mode (no Firebase wired)", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();

    await page.locator("#splash-email-input").fill("nobody@example.test");
    await page.locator("#splash-password-input").fill("ignored-in-local-mode");
    await page.locator("#splash-email-submit").click();

    const hint = page.locator("#splash-account-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/local-test|sign-in is not available/i,
      { timeout: 3000 });
  });

  test("'Author scenarios' splash link is hidden until a real user signs in", async ({ page }) => {
    await page.goto("/");

    // In LOCAL mode no user ever becomes non-anonymous, so the row stays hidden.
    const row = page.locator("#splash-author-row");
    await expect(row).toBeAttached();
    await expect(row).toBeHidden();
  });

  test("create-session picker still works when authored scenarios are empty", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await page.locator("#splash-go-create").click();

    const picker = page.locator("#splash-create-scenario");
    await expect(picker).toBeVisible();

    // Built-in scenarios populate inside an optgroup. Wait until the
    // picker has at least one option (case-content.js is lazy-loaded).
    await expect.poll(async () =>
      await picker.locator("option").count()
    ).toBeGreaterThan(0);

    // No __ref:… authored options should appear in LOCAL mode.
    const refOptionCount = await picker.locator('option[value^="__ref:"]').count();
    expect(refOptionCount).toBe(0);

    // No JS errors from the new picker / storage helpers.
    expect(errors, "create-session view should load without errors").toEqual([]);
  });
});
