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

test.describe("Reference bar floats at the top of the screen (sticky)", () => {
  // User 2026-06-25: "make that line a floating menu so it always appears on the
  // top of their screen." The reference bar (the row of Historical context /
  // Guidelines / Recap buttons) is now position:sticky; top:0 in BOTH modules,
  // so the lookups stay reachable however far the student scrolls. Verified
  // per-device (this file is in the mobile testMatch).
  for (const mod of MODULES) {
    test(`${mod.name}: the reference bar is sticky-pinned to the top of the viewport`, async ({ page }) => {
      await surfaceStage(page, mod.stage);
      const section = page.locator(`#${mod.stage} .reference-section`);

      // Wait out the stage's `card-rise` entrance animation. It briefly applies a
      // translateY transform to the stage, which (like any transformed ancestor)
      // makes a sticky descendant compute its pin offset in the transform's frame
      // — so measuring mid-animation reads a transient few-px offset. Once the
      // animation settles to transform:none, sticky pins to the viewport exactly.
      await page.evaluate((stageId) => {
        const st = document.getElementById(stageId);
        const anims = st && st.getAnimations ? st.getAnimations() : [];
        return Promise.all(anims.map((a) => a.finished.catch(() => {})));
      }, mod.stage);

      // Declared sticky at top:0 — the floating-menu contract.
      const css = await section.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { position: cs.position, top: cs.top };
      });
      expect(css.position).toBe("sticky");
      expect(css.top).toBe("0px");

      // It starts below the top of the viewport (there's a header + vignette
      // above it), so scrolling past it is a meaningful test of pinning.
      const startTop = await section.evaluate((el) =>
        Math.round(el.getBoundingClientRect().top));
      expect(startTop, "the bar starts below the top of the viewport").toBeGreaterThan(0);

      // Guarantee the page is tall enough to scroll the bar all the way to the
      // top. In this synthetic surfaced stage the chart buttons aren't built, so
      // the natural content below the bar can be shorter than `startTop` — which
      // would clamp the scroll before the bar ever reaches the top and tell us
      // nothing about stickiness. A tall spacer at the end of the stage isolates
      // the CSS behaviour from incidental content height.
      await page.evaluate((stageId) => {
        const sp = document.createElement("div");
        sp.id = "__sticky-test-spacer";
        sp.style.height = "2000px";
        document.getElementById(stageId).appendChild(sp);
      }, mod.stage);

      // Scroll well past the bar's natural position but stay inside its sticky
      // range. A NON-sticky element would now sit at ≈ -600px (off-screen); a
      // sticky one pins at the viewport top (rect.top ≈ 0).
      await page.evaluate((t) => window.scrollTo(0, t + 600), startTop);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

      const pinnedTop = await section.evaluate((el) =>
        Math.round(el.getBoundingClientRect().top));
      await page.evaluate(() => {
        const sp = document.getElementById("__sticky-test-spacer");
        if (sp) sp.remove();
      });
      expect(pinnedTop, "the reference bar stays pinned at the top after scrolling")
        .toBeLessThanOrEqual(1);
      expect(pinnedTop, "the reference bar does not scroll off-screen")
        .toBeGreaterThanOrEqual(-2);
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
