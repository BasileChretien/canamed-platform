/* tests-e2e/modb-phase-flow.spec.js
 *
 * Module B SIX-phase synced flow (2026-06-26): setup → play → exchange (two
 * questions + vote) → swap → replay → reflect (what improved). The room moves
 * through together (any participant can advance); only the current phase's
 * action sections show.
 *
 * Driven via window.setModBPhase / initModBPhaseNav with the LOCAL fallback (no
 * room / Firebase needed). Listed in the mobile testMatch so it runs per-device.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setupModB(page) {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-1", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    if (window.initModBPhaseNav) window.initModBPhaseNav();
  });
}

// A section is "shown" when it exists and is not phase-hidden.
function shown(page, sel) {
  return page.evaluate(s => {
    const n = document.querySelector("#stage-2 " + s);
    return !!n && !n.classList.contains("is-phase-hidden");
  }, sel);
}

test.describe("Module B — six-phase synced flow", () => {
  test("Phase 1 (setup) shows the situation + role picker; later phases hidden", async ({ page }) => {
    await setupModB(page);
    expect(await shown(page, ".vignette"), "vignette shows in setup").toBe(true);
    expect(await shown(page, "#modB-role-picker"), "role picker shows in setup").toBe(true);
    expect(await shown(page, ".answers-card-modB-exchange"), "P3 exchange hidden in setup").toBe(false);
    expect(await shown(page, "#modB-swap-card"), "P4 swap hidden in setup").toBe(false);
    expect(await shown(page, "#modB-replay-card"), "P5 replay hidden in setup").toBe(false);
    expect(await shown(page, ".answers-card-modB-reflect"), "P6 reflect hidden in setup").toBe(false);
    // Reference tabs exist; the old SPIKES strip + 6-prompt exchange stepper are gone.
    await expect(page.locator("#refB-btn-useful"), "Useful-sentences tab exists").toHaveCount(1);
    await expect(page.locator("#refB-btn-role"), "Your-role tab exists").toHaveCount(1);
    await expect(page.locator("#stage-2 .spikes-strip"), "old SPIKES strip removed").toHaveCount(0);
    await expect(page.locator("#modB-exchange-list"), "old 6-prompt exchange stepper removed").toHaveCount(0);
  });

  test("Phase 3 (exchange) shows the TWO questions + the vote; hides setup", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(2));
    expect(await shown(page, ".answers-card-modB-exchange"), "exchange answers show").toBe(true);
    expect(await shown(page, "#decisions-B"), "vote shows in exchange").toBe(true);
    expect(await shown(page, ".vignette"), "vignette hidden in exchange").toBe(false);
    expect(await shown(page, "#modB-role-picker"), "role picker hidden in exchange").toBe(false);
    // Two questions — not the old six prompts, not three bullets.
    expect(await page.locator(".answers-card-modB-exchange .answer-bullet").count(),
      "exactly two exchange questions").toBe(2);
  });

  test("Phase 4 (swap) shows the swap card with the swap button", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(3));
    expect(await shown(page, "#modB-swap-card"), "swap card shows in swap phase").toBe(true);
    await expect(page.locator("#modB-swap-card #modB-swap-replay-btn"), "swap button lives in the swap card")
      .toBeVisible();
    expect(await shown(page, ".answers-card-modB-exchange"), "exchange hidden in swap").toBe(false);
  });

  test("Phase 5 (replay) shows the replay card + the role picker", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(4));
    expect(await shown(page, "#modB-replay-card"), "replay card shows").toBe(true);
    expect(await shown(page, "#modB-role-picker"), "role picker shows for round 2").toBe(true);
    expect(await shown(page, "#modB-swap-card"), "swap card hidden in replay").toBe(false);
  });

  test("Phase 6 (reflect) shows the 'what improved' card", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(5));
    expect(await shown(page, ".answers-card-modB-reflect"), "reflect card shows").toBe(true);
    expect(await shown(page, "#modB-replay-card"), "replay hidden in reflect").toBe(false);
    expect(await page.locator(".answers-card-modB-reflect .answer-bullet:not(.answer-bullet-unsorted)").count(),
      "two reflection questions").toBe(2);
  });

  test("prev/next + chip jumps move the synced phase (six phases)", async ({ page }) => {
    await setupModB(page);
    await page.click("#modB-phase-next");   // setup → play
    const playCurrent = await page.evaluate(() =>
      document.querySelector('#stage-2 .phase-step[data-phase="play"]').classList.contains("is-current"));
    expect(playCurrent, "Next advances to the play phase").toBe(true);
    // Jump straight to the last phase (reflect) via its chip — dispatchEvent fires
    // the handler directly (avoids the mobile chip-occlusion hit-test artifact).
    await page.locator('#stage-2 .phase-step[data-phase="reflect"] .phase-step-btn').dispatchEvent("click");
    await expect(page.locator("#stage-2 .answers-card-modB-reflect").first(), "chip jump lands on reflect")
      .not.toHaveClass(/is-phase-hidden/);
    await expect(page.locator("#modB-phase-indicator"), "indicator counts out of six").toContainText("/ 6");
  });
});
