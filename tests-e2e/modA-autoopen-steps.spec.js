/* tests-e2e/modA-autoopen-steps.spec.js
 *
 * Debate + answers MERGED (2026-06-25): the standalone Debate discussion-prompt
 * tab/panel + its progressive-prompt subsystem were removed. The Debate and the
 * two answer questions now live in ONE "Debate & answers" tab (#rcol-tab-answers)
 * that reveals on the ≥1-hypothesis phase gate. This spec pins that reveal + the
 * merged panel's two question inputs.
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
    // Reveal every Module A item AND commit two working hypotheses (the gate
    // needs only one — phaseGateOpen = hypothesisCount() >= 1 — but committing
    // two is a realistic state), so the phase gate that reveals the merged
    // "Debate & answers" tab is open.
    const ids = window._test_getItemIds ? window._test_getItemIds() : [];
    const r = {};
    ids.forEach(id => { r[id] = { by: "T", at: Date.now() }; });
    window._test_setRevealed(r);
    if (window._test_setHypotheses) {
      window._test_setHypotheses({
        h1: { text: "mechanical low back pain", by: "T", at: 1 },
        h2: { text: "axial spondyloarthritis", by: "T", at: 1 }
      });
    }
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

test.describe("Module A — the merged Debate & answers tab reveals on the gate", () => {
  test("committing a working hypothesis reveals the merged Debate & answers tab", async ({ page }) => {
    await setupModA(page);
    const out = await page.evaluate(() => {
      if (window.revealModARightCol) window.revealModARightCol();
      const tab = document.getElementById("rcol-tab-answers");
      return {
        revealed: !!(tab && !tab.hidden),
        noDiscussionTab: !document.getElementById("rcol-tab-discussion")
      };
    });
    expect(out.revealed, "Debate & answers reveals once ≥1 hypothesis is committed").toBe(true);
    expect(out.noDiscussionTab, "the standalone Debate tab is gone (merged)").toBe(true);
  });

  test("switching to the merged tab shows the two questions (diagnosis + culture)", async ({ page }) => {
    await setupModA(page);
    const out = await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (window.revealModARightCol) window.revealModARightCol();
      if (window.switchRcolTab) window.switchRcolTab("answers");
      const p = document.querySelector('.rcol-panel[data-panel="answers"]');
      return {
        active: !!(p && p.classList.contains("is-active") && !p.hidden),
        diagnosis: !!document.getElementById("answer-input-moduleA-diagnosis"),
        culture: !!document.getElementById("answer-input-moduleA-culture")
      };
    });
    expect(out.active, "the merged panel is active after switching to it").toBe(true);
    expect(out.diagnosis && out.culture, "both question inputs are present").toBe(true);
  });
});
