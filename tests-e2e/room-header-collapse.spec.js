/* tests-e2e/room-header-collapse.spec.js
 *
 * Collapsible room-header + inline live-leaderboard (2026-07-15, user request):
 *   - The room stage-card header is now a single line: score chip + stage
 *     controls + a "Details" toggle on the left, and a compact Live-leaderboard
 *     disclosure on the right.
 *   - The session stepper, the "waiting for a facilitator" line and the room
 *     presence collapse into #stage-details, hidden by default; the "Details"
 *     toggle shows/hides them and the choice is remembered across reloads (the
 *     "for all sessions" ask) via localStorage "canamedStageDetailsOpen".
 *   - The leaderboard used to be its own full-width card below the header; it is
 *     now a right-aligned disclosure whose panel drops below as a popover, so it
 *     must never push the page into horizontal scroll — checked per device.
 *
 * Registered into the mobile-iphone / mobile-ipad / mobile-android projects (per
 * the project's standing per-device-cover instruction) in addition to the
 * desktop chromium/firefox/webkit matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Surface the room view directly (mirrors tests-e2e/stage-ui-fixes.spec.js) and
 * wire the header toggle exactly as wireRoomUI() does on real room entry. */
async function surfaceRoom(page) {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const waiting = document.getElementById("waiting");
    if (waiting) waiting.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    // @ts-ignore — global function declaration exposed on window
    if (typeof initStageDetailsToggle === "function") initStageDetailsToggle();
  });
}

test.describe("Collapsible room header + inline leaderboard", () => {
  test("the header is collapsed to a single line by default", async ({ page }) => {
    await surfaceRoom(page);

    // the detail block ships hidden…
    await expect(page.locator("#stage-details")).toBeHidden();
    // …and the toggle reflects the collapsed state
    const toggle = page.locator("#stage-details-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // the toggle AND the leaderboard disclosure live INSIDE the header row
    await expect(page.locator(".stage-row #stage-details-toggle")).toHaveCount(1);
    await expect(page.locator(".stage-row #leaderboard-card")).toHaveCount(1);

    // the stepper / presence moved into the collapsed block → hidden by default
    await expect(page.locator("#global-stage-progress")).toBeHidden();
    await expect(page.locator(".presence-line")).toBeHidden();

    // the leaderboard is no longer its own full-width card (only one exists,
    // and it is the inline variant)
    await expect(page.locator("#leaderboard-card")).toHaveCount(1);
    await expect(page.locator("#leaderboard-card")).toHaveClass(/leaderboard-inline/);
  });

  test("the Details toggle reveals the detail and remembers the choice across reloads", async ({ page }) => {
    await surfaceRoom(page);
    const details = page.locator("#stage-details");
    const toggle = page.locator("#stage-details-toggle");

    await expect(details).toBeHidden();
    await toggle.click();
    await expect(details).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // the presence line (a concrete, text-bearing child) is now revealed; the
    // empty stepper <ol> has no intrinsic size in this surfaced state, so we
    // assert on the container being shown rather than the empty <ol> itself.
    await expect(page.locator(".presence-line")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("canamedStageDetailsOpen"))).toBe("1");

    // the choice survives a reload — a facilitator who opened the detail keeps it
    // in every room they open ("for all sessions")
    await surfaceRoom(page);
    await expect(page.locator("#stage-details")).toBeVisible();
    await expect(page.locator("#stage-details-toggle")).toHaveAttribute("aria-expanded", "true");

    // collapsing again persists "0"
    await page.locator("#stage-details-toggle").click();
    await expect(page.locator("#stage-details")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("canamedStageDetailsOpen"))).toBe("0");
  });

  test("the leaderboard opens full-width below WHILE its chip stays on the top line", async ({ page }) => {
    await surfaceRoom(page);

    // closed by default: the panel (and its hint) are hidden
    await expect(page.locator("#leaderboard-card .lb-panel")).toBeHidden();

    // remember where the chip sits BEFORE opening — measured RELATIVE to its
    // own .stage-row, so the assertion is immune to the page scrolling when
    // the panel opens (boundingBox is viewport-relative; short CI viewports
    // scroll on open and made the first version of this assertion flaky).
    const chipPos = () => page.evaluate(() => {
      const el = document.querySelector("#leaderboard-card > summary");
      const row = el.closest(".stage-row");
      const e = el.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { x: e.x - r.x, y: e.y - r.y };
    });
    const chipBefore = await chipPos();

    // open via its summary — the panel REPARENTS to .stage-card while open
    // (initLeaderboardFlow), so locate it there.
    await page.locator("#leaderboard-card > summary").click();
    await expect(page.locator(".stage-card > .lb-panel")).toBeVisible();

    // 2026-07-18 (user request): opening must NOT reflow the chip to a new
    // row — it stays exactly where it was in the header line.
    const chipAfter = await chipPos();
    // Tolerance 8px: opening changes the row's height, so vertical centering
    // can settle the chip by a few px — that is not the failure mode this
    // guards (a reflow to a NEW row shifts it by the full row height, 40px+).
    expect(Math.abs(chipAfter.y - chipBefore.y), "summary chip stays on the top line").toBeLessThan(8);
    expect(Math.abs(chipAfter.x - chipBefore.x), "summary chip keeps its place").toBeLessThan(8);

    const layout = await page.evaluate(() => {
      const panel = document.querySelector(".stage-card > .lb-panel") ||
                    document.querySelector("#leaderboard-card > .lb-panel");
      const card = document.querySelector(".stage-card");
      const pb = panel.getBoundingClientRect();
      const cb = card.getBoundingClientRect();
      return {
        panelWidth: pb.width,
        cardWidth: cb.width,
        left: pb.left,
        right: pb.right,
        panelBottom: pb.bottom,
        cardBottom: cb.bottom,
        docScrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      };
    });

    // 2026-07-21 (user request #3 on this element): the ranking expands IN
    // FLOW — the stage card grows to contain it and the content below is
    // pushed down, never covered by an overlay.
    expect(layout.panelBottom <= layout.cardBottom + 1,
      "panel expands in flow inside the stage card (no overlay)").toBe(true);

    // The 2026-07-15 readability guarantee is about WIDTH, not flow mechanics:
    // the panel spans (nearly) the full stage-card content width, not a ~360px
    // right-anchored box (it is now a full-strip dropdown so the chip can stay
    // on the top line — see the assertion above).
    expect(layout.panelWidth, "panel is full-width").toBeGreaterThan(layout.cardWidth * 0.7);
    // …never pushing the page into horizontal scroll, and fully within the viewport.
    expect(layout.docScrollW <= layout.clientW + 1, "no horizontal overflow").toBe(true);
    expect(layout.left >= -1 && layout.right <= layout.clientW + 1, "within viewport").toBe(true);
  });
});
