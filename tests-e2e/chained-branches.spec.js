/* tests-e2e/chained-branches.spec.js
 *
 * Chained branching (2026-05-22): a committed decision unlocks a follow-up
 * decision. dec_prognosis_next is gated behind dec_prognosis via
 * unlockWhen.afterDecision and carries hideWhenLocked, so until the room
 * locks in dec_prognosis the follow-up must NOT appear in the DOM.
 *
 * This exercises the REAL render path in a real browser: load the
 * breaking-bad-news decision pack (DECISIONS_B) into the engine, paint the
 * Module B decision cards, and assert the gating renders correctly — the
 * prior decision is present, the gated follow-up is absent. The runtime
 * unlock transition (which needs a synced commit) is covered by the
 * gate-logic assertions in tests/chained-branches.test.js.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// Paint the Module B team-decision cards with the breaking-bad-news pack.
async function paintModuleBDecisions(page) {
  return page.evaluate(() => {
    // Reveal the room + Module B stage.
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    document.body.classList.remove("locked");
    // Load the breaking-bad-news decision pack (dec_prognosis + the chained
    // dec_prognosis_next follow-up live here) and paint the cards.
    if (window.DECISIONS_B) window.DECISIONS = window.DECISIONS_B;
    if (typeof window.renderDecisions === "function") window.renderDecisions();
    const box = document.getElementById("decisions-B");
    return {
      painted: !!(box && box.querySelector(".decision")),
      html: box ? box.textContent : ""
    };
  });
}

test.describe("Chained branching — gated follow-up decision", () => {
  test("the prior decision renders; the hideWhenLocked follow-up stays hidden", async ({ page }) => {
    await page.goto("/");
    const info = await paintModuleBDecisions(page);

    expect(info.painted, "Module B decision cards must paint").toBe(true);

    // dec_prognosis (the prior decision) must be present.
    const priorCount = await page.locator("#decisions-B .dec-prompt", {
      hasText: "How long do I have"
    }).count();
    expect(priorCount, "the prior decision (dec_prognosis) must render").toBeGreaterThan(0);

    // dec_prognosis_next (gated + hideWhenLocked) must be ABSENT until the
    // team commits dec_prognosis — its prompt text must not be in the DOM.
    const followUp = await page.locator("#decisions-B", {
      hasText: "her son is beside her"
    }).count();
    expect(followUp, "the gated follow-up must stay hidden while locked").toBe(0);

    // And no locked-placeholder leaks for it either (hideWhenLocked → render nothing).
    const lockedPlaceholders = await page.locator("#decisions-B .decision-locked").count();
    expect(lockedPlaceholders, "hideWhenLocked must render nothing, not a locked teaser").toBe(0);
  });
});
