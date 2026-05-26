/* tests-e2e/modb-role-objective.spec.js
 *
 * Dry-run finding (2026-05-26): Module B's role chips printed every role's
 * full brief publicly, leaking the patient's hidden stance and the family's
 * secret request to the physician before the scene started. Fix: chips show
 * only the role NAME; the picked role's brief is revealed in a PRIVATE panel
 * on that student's own device only.
 *
 * This spec surfaces stage-2 (Module B) and wires the role picker directly via
 * window.initRolePicker() — the same lightweight approach as
 * module-b-i18n.spec.js — then asserts: (a) no role brief is visible before a
 * pick, (b) picking a role reveals ONLY that role's brief, (c) switching roles
 * swaps the brief and never shows two at once, (d) un-picking hides the panel.
 *
 * Listed in the mobile-iphone / mobile-ipad / mobile-android testMatch in
 * playwright.config.js, so it runs per-device (chromium + the three mobile
 * viewports) per the standing per-device-tests rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const PATIENT_SECRET = /deep down, do you want to know everything/i;
const FAMILY_SECRET = /quietly take the physician aside/i;
const PHYSICIAN_BRIEF = /Deliver the news with empathy/i;

async function openModuleBPicker(page) {
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
    const stage2 = document.getElementById("stage-2");
    if (stage2) stage2.classList.remove("hidden");
    // Wire the role picker's click handlers (normally done on stage entry).
    if (typeof window.initRolePicker === "function") window.initRolePicker();
  });
}

test.describe("Module B — private per-role objective", () => {
  test("chips show only the role name; no brief leaks before a pick", async ({ page }) => {
    await openModuleBPicker(page);

    // The chips are present and show their names.
    await expect(page.locator('.role-chip[data-role="patient"]')).toBeVisible();
    await expect(page.locator('.role-chip[data-role="patient"] .role-chip-name'))
      .toContainText("Patient");

    // None of the secret briefs are anywhere on screen yet.
    const picker = page.locator("#modB-role-picker");
    await expect(picker).not.toContainText(PATIENT_SECRET);
    await expect(picker).not.toContainText(FAMILY_SECRET);
    await expect(picker).not.toContainText(PHYSICIAN_BRIEF);

    // The private objective panel starts hidden.
    await expect(page.locator("#modB-role-objective")).toBeHidden();
  });

  test("picking a role reveals ONLY that role's brief, privately", async ({ page }) => {
    await openModuleBPicker(page);

    await page.locator('.role-chip[data-role="patient"]').click();

    const panel = page.locator("#modB-role-objective");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(PATIENT_SECRET);
    // The private-brief label frames it as for-your-eyes-only.
    await expect(page.locator("#modB-role-objective .role-objective-label"))
      .toBeVisible();

    // Crucially, the OTHER roles' briefs are not revealed.
    await expect(panel).not.toContainText(FAMILY_SECRET);
    await expect(panel).not.toContainText(PHYSICIAN_BRIEF);
  });

  test("switching roles swaps the brief — never two at once", async ({ page }) => {
    await openModuleBPicker(page);

    await page.locator('.role-chip[data-role="patient"]').click();
    const panel = page.locator("#modB-role-objective");
    await expect(panel).toContainText(PATIENT_SECRET);

    // Pick the physician instead.
    await page.locator('.role-chip[data-role="physician"]').click();
    await expect(panel).toContainText(PHYSICIAN_BRIEF);
    await expect(panel).not.toContainText(PATIENT_SECRET);
  });

  test("un-picking the held role hides the objective panel", async ({ page }) => {
    await openModuleBPicker(page);

    const patient = page.locator('.role-chip[data-role="patient"]');
    await patient.click();
    await expect(page.locator("#modB-role-objective")).toBeVisible();

    // Re-tap to clear the role (deselect toggle).
    await patient.click();
    await expect(page.locator("#modB-role-objective")).toBeHidden();
  });
});
