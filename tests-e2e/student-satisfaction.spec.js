/* tests-e2e/student-satisfaction.spec.js
 *
 * Student-satisfaction batch (2026-05-22): the "I'd rather observe" panic
 * affordance. Breaking-bad-news roleplay can hit close to home; one calm tap
 * must move the student into the observer role (reusing the synced role pick)
 * and surface a reassuring, no-judgment note — without picking a role first.
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
    if (typeof window.initRolePicker === "function") window.initRolePicker();
  });
}

test.describe("Student satisfaction — 'I'd rather observe' panic affordance", () => {
  test("one tap selects observer and shows reassurance, no role picked first", async ({ page }) => {
    await page.goto("/");
    await revealModuleBPicker(page);

    const observer = page.locator('#modB-role-picker .role-chip[data-role="observer"]');
    const physician = page.locator('#modB-role-picker .role-chip[data-role="physician"]');
    await expect(observer).toHaveAttribute("aria-checked", "false");

    // Tap the calm escape hatch — no prior role selection.
    await page.locator("#modB-observe-instead-btn").click();

    await expect(observer, "escape must select the observer role")
      .toHaveAttribute("aria-checked", "true");
    await expect(physician).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#modB-observe-reassure"),
      "a reassuring note must appear").toBeVisible();
  });

  test("the escape works even after a student had picked a speaking role", async ({ page }) => {
    await page.goto("/");
    await revealModuleBPicker(page);

    // Pick physician, then panic out to observer mid-scene.
    await page.locator('#modB-role-picker .role-chip[data-role="physician"]').click();
    await page.locator("#modB-observe-instead-btn").click();

    await expect(page.locator('#modB-role-picker .role-chip[data-role="observer"]'))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.locator('#modB-role-picker .role-chip[data-role="physician"]'))
      .toHaveAttribute("aria-checked", "false");
  });
});
