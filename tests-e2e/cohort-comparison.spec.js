/* tests-e2e/cohort-comparison.spec.js
 *
 * Cohort comparison (2026-05-22): lazy-load admin-tools and generate the
 * Caen × Nagoya cohort report. With no live room data it renders the graceful
 * empty state (which also proves the chunk parses + the generator runs).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Cohort comparison", () => {
  test("lazy-loads and generates the cohort report", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => window.CanamedLoader.ensureAdminTools());

    const ok = await page.evaluate(() =>
      typeof window.generateCohortComparison === "function" &&
      typeof window.CanamedAdminTools.cohortRows === "function");
    expect(ok, "cohort tools must be exposed").toBe(true);

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateCohortComparison())
    ]);
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup.locator("h1")).toContainText("Cohort Comparison");
    await expect(popup.locator("button", { hasText: "Print" })).toBeVisible();
    await popup.close();
  });
});
