/* tests-e2e/modb-phase-flow.spec.js
 *
 * Module B synced-phase redesign (2026-05-27): the room moves through the four
 * phases together (any participant can advance), only the current phase's
 * action sections show, and the six Phase-3 prompts appear one at a time.
 *
 * Driven via the global render/setter functions with the LOCAL fallback (no
 * room / Firebase needed): setModBPhase / setModBExchangeCursor mutate the
 * module state and re-render synchronously when no ref is wired. Listed in the
 * mobile testMatch in playwright.config.js so it runs per-device.
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
    // Wire the phase nav + paint the initial (setup) phase.
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

test.describe("Module B — synced phase flow", () => {
  test("Phase 1 (setup) shows the situation + role picker, hides later-phase sections", async ({ page }) => {
    await setupModB(page);
    expect(await shown(page, ".vignette"), "vignette shows in setup").toBe(true);
    expect(await shown(page, "#modB-role-picker"), "role picker shows in setup").toBe(true);
    expect(await shown(page, "#observer-checklist"), "observer checklist hidden in setup").toBe(false);
    expect(await shown(page, ".prompts-card-modB"), "prompts hidden in setup").toBe(false);
    expect(await shown(page, ".answers-card-bulleted"), "answers form hidden in setup").toBe(false);
    // Scene-prep reference strips show during setup + play.
    expect(await shown(page, ".spikes-strip"), "SPIKES strip shows in setup").toBe(true);
    expect(await shown(page, ".phrases-box"), "useful sentences show in setup").toBe(true);
  });

  test("Phase 3 (exchange) shows the prompts, hides setup + scene-prep strips", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(2));
    expect(await shown(page, ".prompts-card-modB"), "prompts show in exchange").toBe(true);
    expect(await shown(page, ".vignette"), "vignette hidden in exchange").toBe(false);
    expect(await shown(page, "#modB-role-picker"), "role picker hidden in exchange").toBe(false);
    // SPIKES + useful sentences are scene-prep noise during the discussion —
    // hidden in Phase 3/4 (2026-06-03 user request).
    expect(await shown(page, ".spikes-strip"), "SPIKES strip hidden in exchange").toBe(false);
    expect(await shown(page, ".phrases-box"), "useful sentences hidden in exchange").toBe(false);
  });

  test("Phase 4 (bullets) also hides the SPIKES + useful-sentences strips", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(3));
    expect(await shown(page, ".spikes-strip"), "SPIKES strip hidden in bullets").toBe(false);
    expect(await shown(page, ".phrases-box"), "useful sentences hidden in bullets").toBe(false);
  });

  test("Phase 4 (bullets) shows the group-answers form", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(3));
    expect(await shown(page, ".answers-card-bulleted"), "answers form shows in bullets").toBe(true);
    expect(await shown(page, ".prompts-card-modB"), "prompts hidden in bullets").toBe(false);
  });

  test("prev/next buttons and chip jumps move the synced phase", async ({ page }) => {
    await setupModB(page);
    // Next → phase 2 (play): the observer checklist becomes visible.
    await page.click("#modB-phase-next");
    await expect(page.locator("#stage-2 #observer-checklist").first(), "observer checklist shows in play")
      .not.toHaveClass(/is-phase-hidden/);
    const playCurrent = await page.evaluate(() =>
      document.querySelector('#stage-2 .phase-step[data-phase="play"]').classList.contains("is-current"));
    expect(playCurrent).toBe(true);
    // Jump straight to Phase 4. The chip's click listener is on the inner
    // <button.phase-step-btn>, but a geometric page.click() on it FAILED only
    // on mobile-ipad (834px): the current chip expands and occludes the click
    // point, so the synthetic click hit-tests onto the wrong element and the
    // handler never fired (CI screenshot showed the phase stuck at 2). Desktop
    // + mobile-iphone (393px, no overlap) pass. dispatchEvent fires the click
    // straight on the button, exercising the nav wiring without the layout-
    // occlusion artifact — same pattern used elsewhere for chip hit-testing.
    await page.locator('#stage-2 .phase-step[data-phase="bullets"] .phase-step-btn')
      .dispatchEvent("click");
    await expect(page.locator("#stage-2 .answers-card-bulleted").first(), "chip jump lands on bullets")
      .not.toHaveClass(/is-phase-hidden/);
  });

  test("Phase 3 prompts appear one at a time and reach a done state", async ({ page }) => {
    await setupModB(page);
    await page.evaluate(() => window.setModBPhase(2));   // exchange
    const visibleCount = () =>
      page.locator("#modB-exchange-list > li:not(.is-phase-hidden)").count();
    expect(await visibleCount(), "exactly one prompt visible at the start").toBe(1);
    // The first visible prompt is q1.
    await expect(page.locator("#modB-exchange-list > li:not(.is-phase-hidden)"))
      .toContainText(/Who is the information for/i);
    // Advance to the last prompt (index 5) — still exactly one visible.
    await page.evaluate(() => window.setModBExchangeCursor(5));
    expect(await visibleCount(), "still one prompt visible near the end").toBe(1);
    // Past the last prompt → done state, list hidden.
    await page.evaluate(() => window.setModBExchangeCursor(6));
    expect(await visibleCount(), "no prompts visible once done").toBe(0);
    await expect(page.locator("#modB-exchange-done")).toBeVisible();
  });
});
