/* tests-e2e/modB-observer-checklist.spec.js
 *
 * Runtime check for the Module B observer SPIKES checklist (2026-05-20):
 * a per-tab private scratchpad. Tick a step + type a note, reload, and
 * confirm the state restored from sessionStorage (no Firebase).
 *
 * Mode: LOCAL (forceLocalMode). Runs on the desktop browser matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function revealModuleB(page) {
  await page.evaluate(() => {
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    document.getElementById("app").classList.remove("hidden");
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    document.body.classList.remove("locked");
    // The observer checklist now lives in the "Your role" reference tab — open
    // that panel (2026-06-26) before opening the (default-collapsed) checklist.
    const roleBtn = document.getElementById("refB-btn-role");
    if (roleBtn) roleBtn.setAttribute("aria-expanded", "true");
    const rolePanel = document.getElementById("refB-panel-role");
    if (rolePanel) rolePanel.hidden = false;
    // open the (default-collapsed) observer checklist
    const d = document.getElementById("observer-checklist");
    if (d) d.setAttribute("open", "");
  });
}

test.describe("Module B observer SPIKES checklist", () => {
  test("ticking a step + a note persists across a reload (per-tab, local)", async ({ page }) => {
    await page.goto("/");
    await revealModuleB(page);

    // Tick the "Knowledge" step and type a win note.
    await page.locator('#observer-spikes-list input[data-obs="k"]').check();
    await page.locator("#observer-note-win").fill("paused after the warning shot");

    // sessionStorage should now hold the state.
    const stored = await page.evaluate(() => sessionStorage.getItem("canamed_obs_spikes"));
    expect(stored, "checklist state must be written to sessionStorage").toBeTruthy();

    // Reload (same tab → sessionStorage survives) and re-reveal.
    await page.reload();
    await revealModuleB(page);

    await expect(page.locator('#observer-spikes-list input[data-obs="k"]')).toBeChecked();
    await expect(page.locator("#observer-note-win")).toHaveValue("paused after the warning shot");
    // A step we never ticked stays unchecked.
    await expect(page.locator('#observer-spikes-list input[data-obs="s"]')).not.toBeChecked();
  });
});
