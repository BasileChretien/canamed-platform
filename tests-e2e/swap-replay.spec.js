/* tests-e2e/swap-replay.spec.js
 *
 * Swap-and-replay loop (2026-05-22): after a roleplay round the room rotates
 * roles (physician → patient → family → observer) and replays the scene from
 * the other side. This drives the REAL runtime in a browser (LOCAL/solo mode):
 * pick a role, hit "Swap roles & replay", and assert the client's own role
 * rotated one seat, the reflective banner appeared, and the round advanced.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function revealModuleBPicker(page) {
  await page.evaluate(() => {
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    document.body.classList.remove("locked");
    // Wire the role picker + swap button (normally wired on room entry).
    if (typeof window.initRolePicker === "function") window.initRolePicker();
    if (typeof window.initModBPhaseNav === "function") window.initModBPhaseNav();
    // The swap button lives in the Phase-4 "swap & replay" card now (2026-06-26),
    // so move the synced phase there — the card (and the role picker) are visible.
    if (typeof window.setModBPhase === "function") window.setModBPhase(3);
  });
}

test.describe("Swap-and-replay roleplay loop", () => {
  test("swapping rotates the client's own role one seat + shows the banner", async ({ page }) => {
    await page.goto("/");
    await revealModuleBPicker(page);

    const physician = page.locator('#modB-role-picker .role-chip[data-role="physician"]');
    const patient = page.locator('#modB-role-picker .role-chip[data-role="patient"]');

    // Round 1: pick physician.
    await physician.click();
    await expect(physician).toHaveAttribute("aria-checked", "true");

    // Swap & replay → physician rotates to patient (next seat in the cycle).
    await page.locator("#modB-swap-replay-btn").click();
    await expect(patient, "physician must rotate to patient on swap")
      .toHaveAttribute("aria-checked", "true");
    await expect(physician, "the old role must be released")
      .toHaveAttribute("aria-checked", "false");

    // The reflective banner appears and the round indicator advances.
    await expect(page.locator("#modB-replay-banner")).toBeVisible();
    await expect(page.locator("#modB-replay-round")).toContainText("2");
  });

  test("a full rotation returns to the starting role and caps the rounds", async ({ page }) => {
    await page.goto("/");
    await revealModuleBPicker(page);

    const physician = page.locator('#modB-role-picker .role-chip[data-role="physician"]');
    await physician.click();

    // Four swaps = a full cycle (physician→patient→family→observer→physician).
    const swap = page.locator("#modB-swap-replay-btn");
    await swap.click(); // → patient (round 2)
    await swap.click(); // → family  (round 3)
    await swap.click(); // → observer (round 4)
    await expect(page.locator('#modB-role-picker .role-chip[data-role="observer"]'))
      .toHaveAttribute("aria-checked", "true");

    // A 5th press is capped (rounds 1..4) — the role must stay observer.
    await swap.click();
    await expect(page.locator('#modB-role-picker .role-chip[data-role="observer"]'),
      "rounds are capped at a full rotation").toHaveAttribute("aria-checked", "true");
  });
});
