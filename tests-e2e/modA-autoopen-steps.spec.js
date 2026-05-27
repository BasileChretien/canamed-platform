/* tests-e2e/modA-autoopen-steps.spec.js
 *
 * Dry-run feedback (2026-05-27): the right-column steps ("decide together"
 * decisions, the Debate/Discussion prompts, and the final Group answers)
 * did not open by themselves — students finished a step and didn't notice
 * the next one had become available. This spec pins the auto-open flow:
 *
 *   - completing the synthesis (keyRevealed) auto-opens the Discussion panel;
 *   - finishing every Exchange prompt (promptCursor === total, RTDB-synced)
 *     auto-opens the Group answers panel;
 *   - neither auto-open steals focus from someone mid-typing.
 *
 * Driven through the platform's _test_ hooks (no Firebase round-trip), the
 * same lightweight approach as case-cluster-by-category / sim-recommendations.
 * Listed in the mobile testMatch in playwright.config.js so it runs per-device.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setupModA(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    if (typeof window._test_rebuildCaseDerived === "function") {
      window._test_rebuildCaseDerived();
    }
    // Reveal every Module A item so keyRevealed() (the synthesis gate) is true.
    const ids = window._test_getItemIds ? window._test_getItemIds() : [];
    const r = {};
    ids.forEach(id => { r[id] = { by: "T", at: Date.now() }; });
    window._test_setRevealed(r);
    // Surface Module A (stage-1) so the right-column panels are in the layout.
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-2", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const stage1 = document.getElementById("stage-1");
    if (stage1) stage1.classList.remove("hidden");
  });
}

test.describe("Module A — steps auto-open as the flow advances", () => {
  test("completing the synthesis auto-opens the Debate (Discussion) panel", async ({ page }) => {
    await setupModA(page);
    const active = await page.evaluate(() => {
      // Realistic state: the synthesis is completed by clicking a button, so
      // no text input holds focus. (This partial surfacing leaves the lobby
      // form in the tree; WebKit parks focus on its first textbox, which would
      // otherwise trip the "don't interrupt typing" guard.)
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window._test_setPromptCursor(0);
      if (window.switchRcolTab) window.switchRcolTab("decisions"); // default, not discussion
      window.renderPrompts();
      const p = document.querySelector('.rcol-panel[data-panel="discussion"]');
      return !!(p && p.classList.contains("is-active") && !p.hidden);
    });
    expect(active, "Discussion should auto-open once the synthesis unlocks").toBe(true);
  });

  test("finishing the Exchange prompts auto-opens Group answers", async ({ page }) => {
    await setupModA(page);
    const active = await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const total = ((window._test_getCase() && window._test_getCase().prompts) || []).length;
      window._test_setPromptCursor(0);
      if (window.switchRcolTab) window.switchRcolTab("decisions");
      window.renderPrompts();                // lands on Discussion
      window._test_setPromptCursor(total);    // team cycled every prompt
      window.renderPrompts();                // → done → auto-open answers
      const p = document.querySelector('.rcol-panel[data-panel="answers"]');
      return !!(p && p.classList.contains("is-active") && !p.hidden);
    });
    expect(active, "Group answers should auto-open once the debate is done").toBe(true);
  });

  test("auto-open does not steal focus while someone is typing", async ({ page }) => {
    await setupModA(page);
    const discussionStayedClosed = await page.evaluate(() => {
      window._test_setPromptCursor(0);
      if (window.switchRcolTab) window.switchRcolTab("decisions");
      // Simulate a teammate mid-answer: a focused textarea.
      const ta = document.createElement("textarea");
      document.body.appendChild(ta);
      ta.focus();
      window.renderPrompts();
      const p = document.querySelector('.rcol-panel[data-panel="discussion"]');
      return !(p && p.classList.contains("is-active"));
    });
    expect(discussionStayedClosed, "typing must suppress the auto-switch").toBe(true);
  });
});
