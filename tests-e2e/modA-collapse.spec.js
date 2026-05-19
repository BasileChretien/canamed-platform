/* tests-e2e/modA-collapse.spec.js
 *
 * Runtime check for the Module A progressive-disclosure change
 * (2026-05-20). The sim repeatedly flagged Module A opening with ~30
 * buttons / ~5x viewport. History stays open; Examination, Working
 * hypotheses and Investigations are collapsed by default and their
 * button groups must NOT be visible until the team expands the section.
 *
 * Mode: LOCAL (forceLocalMode). We reveal #stage-1 directly — the chart
 * <details> sections are static markup, so their open/closed state and
 * the visibility of their inner content can be asserted without a full
 * room flow. Runs on the desktop browser matrix (chromium/firefox/webkit).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function revealStage1(page) {
  await page.evaluate(() => {
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    document.getElementById("app").classList.remove("hidden");
    const s1 = document.getElementById("stage-1");
    if (s1) s1.classList.remove("hidden");
    document.body.classList.remove("locked");
  });
}

test.describe("Module A opens with progressive disclosure", () => {
  test("History is open; Examination / Hypotheses / Investigations are collapsed", async ({ page }) => {
    await page.goto("/");
    await revealStage1(page);

    // History — open, its button-group container visible.
    const history = page.locator("#chart-section-history");
    await expect(history).toHaveAttribute("open", "");
    await expect(page.locator("#group-history")).toBeVisible();

    // The other three sections must be collapsed: the <details> has no
    // open attribute and the inner content is not rendered/visible.
    for (const sectionId of ["chart-section-exam", "chart-hypotheses", "chart-investigations"]) {
      const open = await page.locator("#" + sectionId).evaluate(
        el => el.hasAttribute("open"));
      expect(open, sectionId + " must be collapsed by default").toBe(false);
    }
    // Concretely: the Examination and Investigations button groups are hidden.
    await expect(page.locator("#group-exam")).toBeHidden();
    await expect(page.locator("#group-labs")).toBeHidden();
  });

  test("expanding Examination reveals its group (accordion still works)", async ({ page }) => {
    await page.goto("/");
    await revealStage1(page);
    // Click the Examination summary to expand it.
    await page.locator("#chart-section-exam > summary").click();
    await expect(page.locator("#chart-section-exam")).toHaveAttribute("open", "");
    await expect(page.locator("#group-exam")).toBeVisible();
  });
});
