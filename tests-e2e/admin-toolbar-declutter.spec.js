/* tests-e2e/admin-toolbar-declutter.spec.js
 *
 * 2026-06-03 (user request: "clean the admin dashboard that has many useless
 * buttons"): rarely-used tools moved behind a single "More tools ▾" menu.
 * 2026-06-25 (user request: "refund the more tools button to keep only the most
 * needed tools" + a non-destructive "download archive" with CSV/JSON): the menu
 * is now a LEAN set — the post-hoc analytics reports (Impact / Accreditation /
 * Program / Item-difficulty / Cohort) and the Markdown answers dump were removed
 * from the UI; the inline plain-text "Download all group answers" button was
 * replaced by a CSV/JSON archive control.
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

// The LEAN "More tools" set — only the most-needed facilitator tools remain.
const MENU_TOOLS = [
  "#admin-research-btn", "#admin-research-csv-btn", "#admin-roster-btn",
  "#admin-attest-btn", "#admin-revoke-cert-btn", "#admin-error-log-btn",
  "#admin-bug-report-btn"
];

// Removed from the UI on 2026-06-25 — must no longer exist in the DOM.
const REMOVED_TOOLS = [
  "#admin-download-btn", "#admin-download-md-btn", "#admin-impact-btn",
  "#admin-accred-btn", "#admin-program-btn", "#admin-itemdiff-btn",
  "#admin-cohort-btn"
];

test.describe("Admin toolbar — lean 'More tools' menu + archive control", () => {
  test("core controls stay inline; the lean tool set hides behind 'More tools'", async ({ page }) => {
    await openAdminToolbar(page);

    // The toggle + the core live-session controls are visible inline. The old
    // plain-text answers download is gone — a CSV/JSON archive replaces it.
    await expect(page.locator("#admin-overflow-toggle")).toBeVisible();
    await expect(page.locator("#admin-archive-csv-btn")).toBeVisible();
    await expect(page.locator("#admin-archive-json-btn")).toBeVisible();
    await expect(page.locator("#admin-debrief-btn")).toBeVisible();
    await expect(page.locator("#admin-leave-btn")).toBeVisible();

    // The dropped tools are gone from the DOM entirely.
    for (const sel of REMOVED_TOOLS) {
      await expect(page.locator(sel), sel + " removed").toHaveCount(0);
    }

    // Every kept tool is present in the DOM but hidden inside the closed menu.
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
    await expect(page.locator("#admin-research-btn")).toBeVisible();
    await expect(page.locator("#admin-roster-btn")).toBeVisible();

    // Escape closes the menu and hides the tools again.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#admin-research-btn")).toBeHidden();

    // Re-open, then picking a tool closes the menu (error-log does nothing
    // notable in LOCAL with no buffer — but the menu must still collapse).
    await toggle.dispatchEvent("click");
    await expect(page.locator("#admin-error-log-btn")).toBeVisible();
    await page.locator("#admin-error-log-btn").dispatchEvent("click");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
