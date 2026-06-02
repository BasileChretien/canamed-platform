/* tests-e2e/control-row-overflow.spec.js
 *
 * UX-overload Phase-3 item #5: control-row clarity.
 *
 *   - Desktop: Teams / leave stay inline in the control row (the overflow
 *     <details> is display:contents), so nothing regresses.
 *   - Narrow: "Call a facilitator" is the prominent primary action and the
 *     secondary actions collapse behind a "More" disclosure; opening it reveals
 *     leave. (The "I'm just observing" button was removed 2026-06-02.)
 *
 * The participant control row lives in the always-present #app stage-row, so we
 * just surface #app. Registered in the mobile testMatch for per-device cover.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function surfaceRoom(page) {
  await page.goto("/");
  await page.evaluate(() => {
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
    // wire the "More" toggle (wireRoomUI isn't run in this partial surface)
    if (typeof window.initStageOverflow === "function") window.initStageOverflow();
  });
}

test.describe("Control-row clarity", () => {
  test("desktop: secondary actions stay inline (no overflow toggle)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await surfaceRoom(page);
    // Call + the secondary actions are all visible inline; the More toggle is not.
    // (#observer-btn "I'm just observing" was removed 2026-06-02 — Leave remains.)
    await expect(page.locator("#call-prof-btn")).toBeVisible();
    await expect(page.locator("#leave-btn")).toBeVisible();
    await expect(page.locator(".stage-controls--participant .stage-overflow-toggle")).toBeHidden();
  });

  test("narrow: Call is primary, secondary actions hide behind 'More' until opened", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await surfaceRoom(page);

    await expect(page.locator("#call-prof-btn")).toBeVisible();
    const toggle = page.locator(".stage-controls--participant .stage-overflow-toggle");
    await expect(toggle).toBeVisible();

    // collapsed by default: the secondary actions (Leave) are not shown
    await expect(page.locator("#leave-btn")).toBeHidden();

    // open the disclosure → the secondary actions appear
    await toggle.click();
    await expect(page.locator("#leave-btn")).toBeVisible();
  });

  test("narrow: Call a facilitator is full-width (the prominent primary action)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await surfaceRoom(page);
    const call = page.locator("#call-prof-btn");
    const row = page.locator(".stage-controls--participant");
    const cb = await call.boundingBox();
    const rb = await row.boundingBox();
    expect(cb && rb).toBeTruthy();
    if (cb && rb) {
      // full-width line: at least ~85% of the control row's width
      expect(cb.width).toBeGreaterThan(rb.width * 0.85);
    }
  });
});
