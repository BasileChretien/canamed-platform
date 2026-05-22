/* tests-e2e/retention-quiz.spec.js
 *
 * Retention quiz (2026-05-22): revisit.html loads the scenario's post-test and
 * runs a locally-scored self-check. Drives the real page in a browser.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Retention quiz (revisit.html)", () => {
  test("loads the scenario post-test and gives per-question feedback", async ({ page }) => {
    await page.goto("/revisit.html?s=chronic-pain-opioids&lang=en");
    // Scenario title resolves once case-content.js + revisit.js run.
    await expect(page.locator("#revisit-scenario")).toContainText("Chronic Pain");
    // First question + options render.
    const firstCard = page.locator("#revisit-app .q-card").first();
    await expect(firstCard.locator(".q-text")).toBeVisible();
    const opts = firstCard.locator(".q-opt");
    await expect(opts.first()).toBeVisible();

    // Answering reveals the correct option + explanation + a Next control.
    await opts.first().click();
    await expect(firstCard.locator(".q-opt.correct")).toBeVisible();
    await expect(firstCard.locator(".q-exp")).toBeVisible();
    await expect(firstCard.locator("button", { hasText: /Next|retention score/ })).toBeVisible();
  });

  test("a bad/missing scenario param falls back to a real quiz (no crash)", async ({ page }) => {
    await page.goto("/revisit.html?s=does-not-exist");
    // Falls back to the first registered scenario → still renders a question.
    await expect(page.locator("#revisit-app .q-text").first()).toBeVisible();
  });
});
