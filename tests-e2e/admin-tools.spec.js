/* tests-e2e/admin-tools.spec.js
 *
 * Lazy admin-tools.js + the accreditation-evidence report (2026-05-22). Drives
 * the real path: lazy-load the chunk via CanamedLoader.ensureAdminTools(), then
 * invoke the report generator and assert it opens a titled, sectioned,
 * printable competency-evidence page (graceful with no room data — which also
 * proves admin-tools.js parses + boots in a real browser).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Admin tools — accreditation evidence", () => {
  test("lazy-loads admin-tools.js and generates a competency-evidence report", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // Lazy-load the chunk the same way the dashboard button does.
    await page.evaluate(() =>
      (window.CanamedLoader && window.CanamedLoader.ensureAdminTools)
        ? window.CanamedLoader.ensureAdminTools()
        : Promise.reject(new Error("ensureAdminTools missing")));

    // The competency map + generator must now be present.
    const ok = await page.evaluate(() =>
      typeof window.generateAccreditationReport === "function" &&
      !!(window.CANAMED_COMPETENCY_MAP && Array.isArray(window.CANAMED_COMPETENCY_MAP.competencies) &&
         window.CANAMED_COMPETENCY_MAP.competencies.length >= 3));
    expect(ok, "admin-tools.js must expose the generator + a populated competency map").toBe(true);

    // Invoking it opens the report in a new tab.
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateAccreditationReport())
    ]);
    await popup.waitForLoadState("domcontentloaded");

    await expect(popup.locator("h1")).toContainText("Competency Evidence");
    await expect(popup.locator("h2", { hasText: "Competencies exercised" })).toBeVisible();
    await expect(popup.locator("button", { hasText: "Print" })).toBeVisible();
    await expect(popup.locator("body")).toContainText("aggregate + pseudonymous");
    // At least one competency row rendered (e.g. the SPIKES breaking-bad-news row).
    await expect(popup.locator("td", { hasText: "Breaking bad news" })).toBeVisible();
    await popup.close();
  });
});
