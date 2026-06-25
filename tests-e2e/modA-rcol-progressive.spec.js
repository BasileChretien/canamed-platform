/* tests-e2e/modA-rcol-progressive.spec.js
 *
 * UX de-clutter (2026-06-01): Module A used to show all three right-column tabs
 * (Decide together / Debate / Our final answers) from the moment the student
 * landed on the stage — none of them usable yet, and "Debate" even carried a 🔒
 * "locked" teaser. They now reveal one per phase, as each becomes actionable:
 *
 *   - at entry (nothing gathered)        → the whole right column is collapsed;
 *   - history ≥1 AND exam ≥1             → "Decide together" appears;
 *   - ≥1 working hypothesis (phaseGateOpen) → "Debate" appears (no 🔒 teaser);
 *   - the Exchange is underway           → "Our final answers" appears.
 *
 * Reveal is sticky (a tab never vanishes once shown). Driven through the
 * platform's _test_ hooks in LOCAL mode (no Firebase). Listed in the mobile
 * testMatch in playwright.config.js so it runs on iPhone / iPad / Android too.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Surface Module A (stage-1) with NOTHING revealed, so each test controls the
 * reveal state itself. Mirrors setupModA in modA-autoopen-steps.spec.js but
 * without the blanket reveal. */
async function surfaceModA(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    if (typeof window._test_rebuildCaseDerived === "function") {
      window._test_rebuildCaseDerived();
    }
    window._test_setRevealed({});               // start with a clean chart
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
    if (typeof window.revealModARightCol === "function") window.revealModARightCol();
  });
}

/* Reveal a set of chart items by id and re-run the reveal logic. */
async function reveal(page, ids) {
  await page.evaluate((revealIds) => {
    const r = {};
    revealIds.forEach(id => { r[id] = { by: "T", at: 1 }; });
    window._test_setRevealed(r);
    if (typeof window.renderFindings === "function") window.renderFindings();
    if (typeof window.revealModARightCol === "function") window.revealModARightCol();
  }, ids);
}

test.describe("Module A — right-column tabs reveal one per phase", () => {
  test("at entry the whole right column is collapsed (no tabs shown)", async ({ page }) => {
    await surfaceModA(page);
    await expect(page.locator("#stage-1 .columns")).toHaveClass(/rcol-collapsed/);
    await expect(page.locator("#rcol-tab-decisions")).toBeHidden();
    await expect(page.locator("#rcol-tab-discussion")).toBeHidden();
    await expect(page.locator("#rcol-tab-answers")).toBeHidden();
  });

  test("'Decide together' appears once the patient is interviewed AND examined", async ({ page }) => {
    await surfaceModA(page);
    // Reveal one history item + one exam item — enough for the Decide gate. No
    // hypotheses yet, so the phase gate (≥1 hypothesis) is closed → Debate +
    // Answers stay hidden.
    const picked = await page.evaluate(() => {
      const ids = window._test_getItemIds ? window._test_getItemIds() : [];
      const h = ids.find(id => id.indexOf("history:") === 0);
      const e = ids.find(id => id.indexOf("exam:") === 0);
      return { h, e };
    });
    expect(picked.h, "case must define a history item").toBeTruthy();
    expect(picked.e, "case must define an exam item").toBeTruthy();

    await reveal(page, [picked.h, picked.e]);
    await expect(page.locator("#rcol-tab-decisions")).toBeVisible();
    await expect(page.locator("#rcol-tab-discussion")).toBeHidden();
    await expect(page.locator("#rcol-tab-answers")).toBeHidden();
  });

  test("'Debate' appears once the first working hypothesis is written (no lock teaser)", async ({ page }) => {
    // Gate threshold lowered to ≥1 hypothesis (user 2026-06-25). No hypotheses →
    // Debate stays hidden; the FIRST hypothesis crosses the gate.
    await surfaceModA(page);
    const allIds = await page.evaluate(() =>
      window._test_getItemIds ? window._test_getItemIds() : []);
    await reveal(page, allIds);
    // Zero hypotheses → still locked (the rest of the chart being revealed must
    // NOT open the Debate on its own).
    await page.evaluate(() => {
      window._test_setHypotheses({});
      if (window.renderPrompts) window.renderPrompts();
      if (window.revealModARightCol) window.revealModARightCol();
    });
    await expect(page.locator("#rcol-tab-discussion")).toBeHidden();
    // One hypothesis crosses the gate.
    await page.evaluate(() => {
      window._test_setHypotheses({ a: { text: "mechanical LBP", by: "T", at: 1 } });
      if (window.renderPrompts) window.renderPrompts();
      if (window.revealModARightCol) window.revealModARightCol();
    });
    await expect(page.locator("#rcol-tab-discussion")).toBeVisible();
    // The 🔒 locked teaser must NOT be showing (it only renders under .is-locked).
    await expect(page.locator("#rcol-tab-discussion")).not.toHaveClass(/is-locked/);
  });

  test("'Our final answers' appears once the Exchange is underway", async ({ page }) => {
    await surfaceModA(page);
    const allIds = await page.evaluate(() =>
      window._test_getItemIds ? window._test_getItemIds() : []);
    await reveal(page, allIds);
    // Open the gate (≥1 hypothesis), then walk through every Exchange prompt →
    // the bullets phase begins.
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window._test_setHypotheses({
        a: { text: "mechanical LBP", by: "T", at: 1 },
        b: { text: "axial spondyloarthritis", by: "T", at: 1 }
      });
      const total = ((window._test_getCase() && window._test_getCase().prompts) || []).length;
      window._test_setPromptCursor(total);
      if (typeof window.renderPrompts === "function") window.renderPrompts();
      if (typeof window.revealModARightCol === "function") window.revealModARightCol();
    });
    await expect(page.locator("#rcol-tab-answers")).toBeVisible();
  });

  test("the mobile thumb-reach bar mirrors the reveal (no premature Debate/Answers)", async ({ page }) => {
    // DOM-property reads (el.hidden) so this is viewport-independent: on desktop
    // the whole bar is display:none, but the per-tab hidden mirroring still must
    // be correct for when the phone layout shows it.
    await surfaceModA(page);
    const mtabHidden = () => page.evaluate(() => ({
      decisions: document.querySelector('.mtab[data-tab="decisions"]').hidden,
      discussion: document.querySelector('.mtab[data-tab="discussion"]').hidden,
      answers: document.querySelector('.mtab[data-tab="answers"]').hidden,
      barHidden: document.getElementById("mobile-rcol-tabbar").hidden
    }));

    // At entry: every mirrored tab hidden, and the bar itself is down.
    let s = await mtabHidden();
    expect(s, "no mobile tab before any phase is reached").toEqual(
      { decisions: true, discussion: true, answers: true, barHidden: true });

    // After history + exam: only the Decide mirror is revealed.
    const picked = await page.evaluate(() => {
      const ids = window._test_getItemIds ? window._test_getItemIds() : [];
      return [ids.find(id => id.indexOf("history:") === 0),
              ids.find(id => id.indexOf("exam:") === 0)].filter(Boolean);
    });
    await reveal(page, picked);
    s = await mtabHidden();
    expect(s.decisions, "Decide mirror shows after history+exam").toBe(false);
    expect(s.barHidden, "the bar comes up once a tab is revealed").toBe(false);
    // No hypotheses yet → the phase gate is closed → Debate + Answers mirrors
    // stay hidden.
    expect(s.discussion, "Debate mirror stays hidden before any hypothesis").toBe(true);
    expect(s.answers, "Answers mirror stays hidden before any hypothesis").toBe(true);
  });
});
