/* tests-e2e/reference-toolbar.spec.js
 *
 * 2026-06-02 UX change: the three reference lookups (historical context /
 * guidelines / recap table) are now a single row of buttons at the TOP of each
 * module (A & B); clicking a button expands its panel below and collapses the
 * others (accordion — one open at a time). Separately, the stage card no longer
 * pins to the top of the viewport; a floating "↑ Back to top" button gives the
 * one-tap return instead.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js — no Firebase). Listed in the
 * mobile-iphone / mobile-ipad / mobile-android testMatch in playwright.config.js
 * so it runs per-device (chromium/firefox/webkit + the three mobile viewports)
 * per the standing per-device-tests rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Surface a single stage of the room view (so its reference toolbar is in the
 * layout and the body is tall enough to scroll). The toolbars + the back-to-top
 * button are wired once at startup, regardless of which stage is visible. */
async function surfaceStage(page, stageId) {
  await page.goto("/");
  await page.evaluate(async (sid) => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-1", "stage-2", "stage-3"].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const s = document.getElementById(sid);
    if (s) s.classList.remove("hidden");
  }, stageId);
}

const MODULES = [
  { name: "Module A", stage: "stage-1", prefix: "refA" },
  { name: "Module B", stage: "stage-2", prefix: "refB" },
];

test.describe("Reference toolbar — 3-button accordion at the top of each module", () => {
  for (const mod of MODULES) {
    test(`${mod.name}: the 3 buttons toggle their panels (accordion, one open at a time)`, async ({ page }) => {
      await surfaceStage(page, mod.stage);

      const hist = page.locator(`#${mod.prefix}-btn-history`);
      const guide = page.locator(`#${mod.prefix}-btn-guidelines`);
      const recap = page.locator(`#${mod.prefix}-btn-recap`);
      const histPanel = page.locator(`#${mod.prefix}-panel-history`);
      const guidePanel = page.locator(`#${mod.prefix}-panel-guidelines`);

      // All three buttons are present; every panel starts collapsed.
      await expect(hist).toBeVisible();
      await expect(guide).toBeVisible();
      await expect(recap).toBeVisible();
      await expect(histPanel).toBeHidden();
      await expect(guidePanel).toBeHidden();
      await expect(hist).toHaveAttribute("aria-expanded", "false");

      // On wide viewports the 3 buttons share a single row; below the 520px
      // breakpoint they intentionally stack full-width.
      const vw = (page.viewportSize() && page.viewportSize().width) || 1280;
      if (vw >= 560) {
        const sameRow = await page.evaluate((p) => {
          const tops = ["history", "guidelines", "recap"].map((k) =>
            Math.round(document.getElementById(p + "-btn-" + k).getBoundingClientRect().top));
          return tops[0] === tops[1] && tops[1] === tops[2];
        }, mod.prefix);
        expect(sameRow, "the 3 reference buttons share one row on wide viewports").toBe(true);
      }

      // Open "Historical context" → its panel shows; aria-expanded flips true.
      await hist.click();
      await expect(histPanel).toBeVisible();
      await expect(hist).toHaveAttribute("aria-expanded", "true");

      // Open "Guidelines" → history collapses (only one panel open at a time).
      await guide.click();
      await expect(guidePanel).toBeVisible();
      await expect(histPanel).toBeHidden();
      await expect(hist).toHaveAttribute("aria-expanded", "false");
      await expect(guide).toHaveAttribute("aria-expanded", "true");

      // Click the open button again → it collapses (toggle off).
      await guide.click();
      await expect(guidePanel).toBeHidden();
      await expect(guide).toHaveAttribute("aria-expanded", "false");
    });
  }
});

test.describe("Back-to-top button + un-pinned stage card", () => {
  test("appears after scrolling down and returns to the top", async ({ page }) => {
    await surfaceStage(page, "stage-1");
    const btn = page.locator("#back-to-top");
    await expect(btn).toHaveCount(1);

    // At the top of the page the button is not shown.
    expect(await btn.evaluate((b) => b.classList.contains("is-visible"))).toBe(false);

    // Scroll well past the show threshold (600px) → the button appears.
    await page.evaluate(() => window.scrollTo(0, 1400));
    await expect(btn).toHaveClass(/is-visible/);

    // Clicking it scrolls the page back to (near) the top.
    await btn.click();
    await expect
      .poll(() => page.evaluate(() =>
        Math.round(window.pageYOffset || document.documentElement.scrollTop || 0)))
      .toBeLessThan(50);
  });

  test("the stage card is not pinned (position is not sticky/fixed)", async ({ page }) => {
    await surfaceStage(page, "stage-1");
    const pos = await page.evaluate(() => {
      const card = document.querySelector("#stage-1 .stage-card") ||
        document.querySelector(".stage-card");
      return card ? getComputedStyle(card).position : null;
    });
    // It scrolls with the page now — must be static/relative, never sticky/fixed.
    expect(["static", "relative", null]).toContain(pos);
  });
});
