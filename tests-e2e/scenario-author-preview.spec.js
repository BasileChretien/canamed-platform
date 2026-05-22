/* tests-e2e/scenario-author-preview.spec.js
 *
 * Scenario-authoring Preview (2026-05-22): the authoring tool renders a
 * human-readable preview of the authored scenario. Drives the real page.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Scenario authoring — preview", () => {
  test("Preview renders the scenario readably (modules + decisions)", async ({ page }) => {
    await page.goto("/scenario-author.html");
    await expect(page.locator("#btn-preview")).toBeVisible();

    // Validation already works on the default state; Preview should render content.
    await page.locator("#btn-preview").click();
    const out = page.locator("#preview-output");
    await expect(out).toBeVisible();
    await expect(out.locator("h3")).toBeVisible();                  // scenario name
    await expect(out).toContainText("Module A");
    await expect(out).toContainText("Pre/post test");
    await expect(out).toContainText("Team decisions");
  });

  test("Validate still works (regression guard for the action bar)", async ({ page }) => {
    await page.goto("/scenario-author.html");
    await page.locator("#btn-validate").click();
    await expect(page.locator("#validation-output")).not.toBeEmpty();
  });
});
