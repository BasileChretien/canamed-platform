/* tests-e2e/splash.spec.js
 *
 * The splash page is the entry point for ~100% of users. Anything that
 * breaks here breaks the whole platform.
 *
 * Covered:
 *   - splash actually loads (no white-screen-of-death from a CSP violation
 *     or a typo in script.js)
 *   - the session-code input + Enter button are reachable
 *   - the "I'm a facilitator" + "Sign in with Google" affordances exist
 *   - clicking the facilitator link navigates to the create-session view
 *   - clicking Back returns to the splash
 *   - in local mode, no Firebase auth/database errors hit the console
 *
 * Not covered here (covered in create-session.spec.js / admin.spec.js):
 *   - actually creating a session
 *   - joining as a participant
 *   - admin login + dashboard
 *
 * Selector strategy: prefer stable element IDs over text/placeholder
 * lookups. The lobby page reuses several placeholder strings ("e.g.
 * ABC-DEF" exists on both splash AND lobby), so by-placeholder lookups
 * trigger Playwright's strict-mode-violation on duplicate matches. IDs
 * are the script.js contract and are stable.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Splash page", () => {
  test("loads with code input + facilitator and sign-in affordances", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");

    // The CaNaMED title is the unmistakable signal the page rendered.
    await expect(page.getByRole("heading", { name: "CANAMED" })).toBeVisible();

    // Code-entry input + submit (scoped by ID — same placeholder text
    // appears on the lobby page).
    await expect(page.locator("#splash-code")).toBeVisible();
    await expect(page.locator("#splash-enter")).toBeVisible();

    // Both alternate entry points exist (buttons on the splash card).
    await expect(page.locator("#splash-go-create")).toBeVisible();
    await expect(page.locator("#splash-go-account")).toBeVisible();

    // No JavaScript errors during page load.
    expect(errors, "splash should load without console / page errors").toEqual([]);
  });

  test("facilitator link opens the create-session view, Back returns", async ({ page }) => {
    await page.goto("/");

    await page.locator("#splash-go-create").click();

    // Create-session view markers (paragraph header, not h*, so use text).
    await expect(page.getByText(/Create a CANAMED session/i)).toBeVisible();
    await expect(page.locator("#splash-create-name")).toBeVisible();
    await expect(page.locator("#splash-create-submit")).toBeVisible();

    // Back button returns to splash.
    await page.locator("#splash-back-from-create").click();
    await expect(page.locator("#splash-code")).toBeVisible();
  });

  test("rejects invalid session codes gracefully", async ({ page }) => {
    await page.goto("/");

    await page.locator("#splash-code").fill("xxx-xxx");
    await page.locator("#splash-enter").click();

    // A hint should appear (the exact wording can drift; we just look
    // for any text content in the splash-hint region of the enter view).
    const hint = page.locator("#splash-hint");
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveText("", { timeout: 5000 });
  });
});
