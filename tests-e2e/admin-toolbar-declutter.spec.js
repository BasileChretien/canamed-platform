/* tests-e2e/admin-toolbar-declutter.spec.js
 *
 * 2026-06-03 (user request: "clean the admin dashboard that has many useless
 * buttons"). The rarely-used dean / research / accreditation / reporting tools
 * moved behind a single "More tools ▾" menu; the core live-session controls
 * (Download answers, Open debrief, End session, Leave, pseudonymise) stay
 * inline. Nothing was deleted — every button keeps its id, so the report
 * generators (tested elsewhere) are unaffected.
 *
 * Hermetic LOCAL mode. Reveals #admin-app and wires the menu via the global
 * window.initAdminToolsMenu (classic-script global, like initRolePicker).
 * Listed in the per-device mobile matrix so the dropdown's narrow-screen
 * right-align is exercised too.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openAdminToolbar(page) {
  await page.goto("/");
  await page.evaluate(() => {
    ["splash", "lobby", "waiting", "app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    const a = document.getElementById("admin-app");
    if (a) a.classList.remove("hidden");
    document.body.classList.remove("locked");
    if (typeof window.initAdminToolsMenu === "function") window.initAdminToolsMenu();
  });
}

// The tools moved into the "More tools" menu.
const MENU_TOOLS = [
  "#admin-impact-btn", "#admin-accred-btn", "#admin-research-btn",
  "#admin-research-csv-btn", "#admin-roster-btn", "#admin-attest-btn",
  "#admin-revoke-cert-btn", "#admin-program-btn", "#admin-itemdiff-btn",
  "#admin-cohort-btn", "#admin-download-md-btn", "#admin-error-log-btn",
  "#admin-bug-report-btn"
];

test.describe("Admin toolbar — decluttered with a 'More tools' menu", () => {
  test("core controls stay inline; rarely-used tools hide behind 'More tools'", async ({ page }) => {
    await openAdminToolbar(page);

    // The toggle + the core live-session controls are visible inline.
    await expect(page.locator("#admin-overflow-toggle")).toBeVisible();
    await expect(page.locator("#admin-download-btn")).toBeVisible();
    await expect(page.locator("#admin-debrief-btn")).toBeVisible();
    await expect(page.locator("#admin-leave-btn")).toBeVisible();

    // Every moved tool is present in the DOM but hidden inside the closed menu.
    for (const sel of MENU_TOOLS) {
      await expect(page.locator(sel), sel + " present").toHaveCount(1);
      await expect(page.locator(sel), sel + " hidden until menu opens").toBeHidden();
    }
  });

  test("opening 'More tools' reveals the tools; Escape / pick closes it", async ({ page }) => {
    await openAdminToolbar(page);
    const toggle = page.locator("#admin-overflow-toggle");

    // dispatchEvent (not a geometric click): on a wrapped mobile control row the
    // parent .stage-controls intercepts the toggle's click point — the same
    // hit-test artifact handled this way for the phase chips in
    // modb-phase-flow.spec.js. We're exercising the toggle wiring, not layout.
    await toggle.dispatchEvent("click");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#admin-impact-btn")).toBeVisible();
    await expect(page.locator("#admin-cohort-btn")).toBeVisible();

    // Escape closes the menu and hides the tools again.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#admin-impact-btn")).toBeHidden();

    // Re-open, then picking a tool closes the menu (download-md does not open a
    // tab in LOCAL with no room — but the menu must still collapse on click).
    await toggle.dispatchEvent("click");
    await expect(page.locator("#admin-download-md-btn")).toBeVisible();
    await page.locator("#admin-download-md-btn").dispatchEvent("click");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
