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

    // New email/password form fields + buttons.
    await expect(page.locator("#splash-email-form")).toBeVisible();
    await expect(page.locator("#splash-email-input")).toBeVisible();
    await expect(page.locator("#splash-password-input")).toBeVisible();
    await expect(page.locator("#splash-email-signin")).toBeVisible();
    await expect(page.locator("#splash-email-signup")).toBeVisible();
  });

  test("email sign-in shows a clear error in LOCAL mode (no Firebase wired)", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();

    await page.locator("#splash-email-input").fill("nobody@example.test");
    await page.locator("#splash-password-input").fill("ignored-in-local-mode");
    await page.locator("#splash-email-signin").click();

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
