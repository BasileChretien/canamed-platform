/* tests-e2e/item-difficulty.spec.js
 *
 * Item-difficulty / curriculum feedback (2026-05-22). Seeds the program rollup
 * with per-decision correct-rates and drives generateItemDifficulty(), checking
 * decisions rank hardest-first with the reteach flag.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Item difficulty", () => {
  test("ranks decisions hardest-first and flags low-accuracy items to reteach", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => {
      localStorage.setItem("canamed_program_sessions", JSON.stringify([
        { code: "AAA", at: 1, decAcc: { dec_hard: 30, dec_easy: 90 } },
        { code: "BBB", at: 2, decAcc: { dec_hard: 40, dec_easy: 95 } }
      ]));
    });
    await page.evaluate(() => window.CanamedLoader.ensureAdminTools());

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateItemDifficulty())
    ]);
    await popup.waitForLoadState("domcontentloaded");

    await expect(popup.locator("h1")).toContainText("Item Difficulty");
    // dec_hard (mean 35%) must be flagged reteach and appear before dec_easy.
    await expect(popup.locator("td", { hasText: "dec_hard" })).toBeVisible();
    await expect(popup.locator("body")).toContainText("reteach");
    const order = await popup.evaluate(() => {
      const cells = Array.from(document.querySelectorAll("tbody td:first-child")).map(td => td.textContent);
      return { hard: cells.indexOf("dec_hard"), easy: cells.indexOf("dec_easy") };
    });
    expect(order.hard, "hardest item must rank first").toBeLessThan(order.easy);
    await popup.close();
  });
});
