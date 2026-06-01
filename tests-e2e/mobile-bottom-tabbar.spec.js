/* tests-e2e/mobile-bottom-tabbar.spec.js
 *
 * UX-overload Phase-2 item #1: the mobile-only sticky bottom tab bar that
 * mirrors the Module A right-column tabs (Decide / Debate / Answers).
 *
 * The regression this pins: a naive position:fixed bar inside the right column
 * does NOT pin to the viewport — #app / #stage-1 carry the stage-transition
 * transform, which becomes the containing block for a fixed descendant, so the
 * bar lands ~4700px down at the stage bottom. The fix is a BODY-LEVEL <nav>
 * (#mobile-rcol-tabbar) outside those transformed ancestors. This spec proves
 * the bar sits at the VIEWPORT bottom on a phone, mirrors + drives the real
 * tabs, hides behind the keyboard, and never shows on desktop / tablet.
 *
 * Driven through the platform's _test_ hooks (no Firebase), the same approach
 * as modA-autoopen-steps. Registered in the mobile-iphone/ipad/android
 * testMatch in playwright.config.js so it runs per-device.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// Surface Module A (stage-1) and wire the bottom bar, the same lightweight way
// modA-autoopen-steps does. wireRoomUI() doesn't run in this partial-surface
// harness, so we init the bar explicitly (it's idempotent in production).
async function setupModA(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    if (typeof window._test_rebuildCaseDerived === "function") {
      window._test_rebuildCaseDerived();
    }
    // Reveal every Module A item so the discussion gate (keyRevealed) is open.
    const ids = window._test_getItemIds ? window._test_getItemIds() : [];
    const r = {};
    ids.forEach((id) => { r[id] = { by: "T", at: Date.now() }; });
    if (window._test_setRevealed) window._test_setRevealed(r);

    // Surface Module A (stage-1) so the right-column panels are in the layout.
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-2", "stage-3"].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const stage1 = document.getElementById("stage-1");
    if (stage1) stage1.classList.remove("hidden");

    // The partial surface can leave a lobby textbox focused (WebKit parks focus
    // on its first input); blur it so the keyboard-hide guard doesn't suppress
    // the bar before we've asserted on it.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    // Wire + paint the bar (wireRoomUI is not exercised in this harness).
    if (typeof window.initMobileTabbar === "function") window.initMobileTabbar();
    if (typeof window.updateMobileTabbar === "function") window.updateMobileTabbar();
  });
}

test.describe("Module A — mobile sticky bottom tab bar", () => {
  test("per-device: shown + pinned to the viewport bottom on phones, hidden on wide screens", async ({ page }) => {
    await setupModA(page);
    const bar = page.locator("#mobile-rcol-tabbar");
    const vp = page.viewportSize();
    const width = vp ? vp.width : 1280;

    if (width <= 720) {
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox();
      expect(box, "the bar must have a layout box when shown").not.toBeNull();
      if (box && vp) {
        // The whole point of the body-level fix: the bar's bottom edge sits at
        // the viewport bottom, NOT thousands of px down at the stage bottom.
        expect(box.y, `bar top ${box.y} should be near the viewport bottom (${vp.height}), not ~4700px (the transform bug)`)
          .toBeGreaterThan(vp.height - 160);
        expect(Math.round(box.y + box.height), "bar bottom must reach the viewport bottom")
          .toBeLessThanOrEqual(vp.height + 2);
      }
    } else {
      // Tablet / desktop: the bar is display:none (the canonical top tabs serve).
      await expect(bar).toBeHidden();
    }
  });

  test("a phone tap on the bar switches the right-column panel and syncs active state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupModA(page);
    const bar = page.locator("#mobile-rcol-tabbar");
    await expect(bar).toBeVisible();

    // Default is Decide together (decisions). Tap the Answers tab.
    await bar.locator('.mtab[data-tab="answers"]').click();

    await expect(page.locator('.rcol-panel[data-panel="answers"]'))
      .toHaveClass(/is-active/);
    await expect(page.locator('.rcol-panel[data-panel="decisions"]'))
      .not.toHaveClass(/is-active/);
    // the mirror reflects the new active tab…
    await expect(bar.locator('.mtab[data-tab="answers"]'))
      .toHaveAttribute("aria-current", "true");
    // …and the canonical top tab moved in lockstep (single source of truth).
    await expect(page.locator('.rcol-tab[data-tab="answers"]'))
      .toHaveClass(/is-active/);
  });

  test("the bar hides while a text field is focused (never floats over the keyboard)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupModA(page);
    const bar = page.locator("#mobile-rcol-tabbar");
    await expect(bar).toBeVisible();

    await page.evaluate(() => {
      const ta = document.createElement("textarea");
      ta.id = "_kbtest";
      document.body.appendChild(ta);
      ta.focus();
    });
    await expect(bar).toBeHidden();

    await page.evaluate(() => {
      const ta = document.getElementById("_kbtest");
      if (ta) { ta.blur(); ta.remove(); }
    });
    await expect(bar).toBeVisible();
  });

  test("the bar is suppressed on a desktop-width viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupModA(page);
    await expect(page.locator("#mobile-rcol-tabbar")).toBeHidden();
  });
});
