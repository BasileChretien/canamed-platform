/* tests-e2e/program-dashboard.spec.js
 *
 * Program-level (cross-session) dashboard (2026-05-22). Seeds the local
 * program-session rollup (the durable list closeSession writes, kept across
 * close), then drives generateProgramDashboard() and asserts the cross-session
 * aggregation renders (cumulative students, per-session table, trend).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Program overview (cross-session)", () => {
  test("aggregates the local rollup into a program-level report", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // Seed two closed sessions (pseudonymous aggregates, as closeSession writes).
    await page.evaluate(() => {
      localStorage.setItem("canamed_program_sessions", JSON.stringify([
        { code: "AAA-AAA", at: Date.now() - 86400000, participants: 12, rooms: 3,
          contribPct: 80, meanGini: 0.25, decisionAccuracyPct: 70, answers: 30 },
        { code: "BBB-BBB", at: Date.now(), participants: 16, rooms: 4,
          contribPct: 88, meanGini: 0.18, decisionAccuracyPct: 82, answers: 44 }
      ]));
    });

    await page.evaluate(() =>
      (window.CanamedLoader && window.CanamedLoader.ensureAdminTools)
        ? window.CanamedLoader.ensureAdminTools()
        : Promise.reject(new Error("ensureAdminTools missing")));

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateProgramDashboard())
    ]);
    await popup.waitForLoadState("domcontentloaded");

    await expect(popup.locator("h1")).toContainText("Program Overview");
    await expect(popup.locator("body")).toContainText("students trained");
    // Cumulative students = 12 + 16 = 28.
    await expect(popup.locator(".kpi", { hasText: "students trained" })).toContainText("28");
    // Both sessions appear in the per-session table.
    await expect(popup.locator("td", { hasText: "AAA-AAA" })).toBeVisible();
    await expect(popup.locator("td", { hasText: "BBB-BBB" })).toBeVisible();
    await expect(popup.locator("button", { hasText: "Print" })).toBeVisible();
    await popup.close();
  });

  test("shows a friendly empty state with no recorded sessions", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => localStorage.removeItem("canamed_program_sessions"));
    await page.evaluate(() => window.CanamedLoader.ensureAdminTools());

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateProgramDashboard())
    ]);
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup.locator("body")).toContainText("No closed sessions are recorded");
    await popup.close();
  });
});
