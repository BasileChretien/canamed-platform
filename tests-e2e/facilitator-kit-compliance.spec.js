/* tests-e2e/facilitator-kit-compliance.spec.js
 *
 * The two static self-service pages (2026-05-22): facilitator-guide.html and
 * compliance.html. Verify each renders, exposes its key content, and is free of
 * horizontal scroll at both desktop and a 375px phone width.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function noHorizontalScroll(page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);
}

test.describe("Self-service pages", () => {
  test("compliance.html renders its statement sections, no h-scroll (desktop + 375px)", async ({ page }) => {
    await page.goto("/compliance.html");
    await expect(page.locator("h1")).toContainText("Compliance");
    await expect(page.locator("h2", { hasText: "Accessibility" })).toBeVisible();
    await expect(page.locator("h2", { hasText: "Data protection" })).toBeVisible();
    await expect(page.locator("h2", { hasText: "Security" })).toBeVisible();
    await expect(page.locator("body")).toContainText("WCAG");
    await expect(page.locator("body")).toContainText("GDPR");
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 375, height: 700 });
    await noHorizontalScroll(page);
  });

  test("facilitator-guide.html renders the quick-start with a print button", async ({ page }) => {
    await page.goto("/facilitator-guide.html");
    await expect(page.locator("h1")).toContainText("Quick-Start");
    await expect(page.locator("button", { hasText: "Print" })).toBeVisible();
    await expect(page.locator("ol.steps > li")).toHaveCount(5);
    await expect(page.locator("body")).toContainText("session code");
    await expect(page.locator("body")).toContainText("Impact report");
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 375, height: 700 });
    await noHorizontalScroll(page);
  });
});
