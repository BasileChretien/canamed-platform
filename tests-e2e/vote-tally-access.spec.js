/* tests-e2e/vote-tally-access.spec.js
 *
 * UX-overload Phase-3 item #3: live-vote accessibility (Module A decisions).
 * (Filename avoids the "*a11y.spec.js" pattern, which the desktop projects
 * testIgnore and the axe-only `a11y` project testMatches.)
 *
 *   1. A room-wide ballot triggers a full innerHTML rebuild of #decisions-A.
 *      Keyboard focus on a vote option must SURVIVE that rebuild (it used to
 *      fall to <body> whenever a teammate voted).
 *   2. A persistent, visually-hidden polite live region (#dec-live-A) is seeded
 *      silently on first paint and announces the tally on subsequent changes.
 *
 * Driven via the platform's _test_ hooks (no Firebase), like
 * modA-autoopen-steps. Registered in the mobile testMatch so it runs
 * per-device.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setupDecisions(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    if (typeof window._test_rebuildCaseDerived === "function") {
      window._test_rebuildCaseDerived();
    }
    // Reveal every item so synthesis-gated Module A decisions unlock.
    const ids = window._test_getItemIds ? window._test_getItemIds() : [];
    const r = {};
    ids.forEach((id) => { r[id] = { by: "T", at: Date.now() }; });
    if (window._test_setRevealed) window._test_setRevealed(r);
    if (window._test_setRoomVotes) window._test_setRoomVotes({});

    // Surface Module A (stage-1) + its decisions panel.
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-2", "stage-3"].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const stage1 = document.getElementById("stage-1");
    if (stage1) stage1.classList.remove("hidden");
    if (window.switchRcolTab) window.switchRcolTab("decisions");
    if (window.renderDecisions) window.renderDecisions();
  });
}

test.describe("Module A — live-vote accessibility", () => {
  test("keyboard focus on a vote option survives a teammate's ballot rebuild", async ({ page }) => {
    await setupDecisions(page);
    const firstOpt = page.locator("#decisions-A .dec-opt").first();
    await expect(firstOpt).toBeVisible();
    const decId = await firstOpt.getAttribute("data-dec");
    const optIdx = await firstOpt.getAttribute("data-opt");
    expect(decId, "the option must carry a stable data-dec").toBeTruthy();

    await firstOpt.focus();
    await expect(firstOpt).toBeFocused();

    // Simulate a teammate casting a ballot (room-wide) → full rebuild.
    await page.evaluate((id) => {
      const votes = {};
      votes[id] = { ballots: { teammateXYZ: { choice: 0, at: Date.now() } } };
      window._test_setRoomVotes(votes);
      window.renderDecisions();
    }, decId);

    // Focus must be back on the SAME option, not lost to <body>.
    const active = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? { dec: a.getAttribute("data-dec"), opt: a.getAttribute("data-opt"), tag: a.tagName } : null;
    });
    expect(active, "focus must not fall back to <body>").not.toBeNull();
    expect(active && active.dec).toBe(decId);
    expect(active && active.opt).toBe(optIdx);
  });

  test("the decisions panel exposes a polite live region, seeded silently then announcing", async ({ page }) => {
    await setupDecisions(page);
    const live = page.locator("#dec-live-A");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toHaveAttribute("aria-atomic", "true");
    // First paint seeds the region silently (no announcement on load).
    expect(((await live.textContent()) || "").trim()).toBe("");

    // A ballot on a real (unlocked) decision updates the announcement.
    const decId = await page.locator("#decisions-A .dec-opt").first().getAttribute("data-dec");
    await page.evaluate((id) => {
      const votes = {};
      votes[id] = { ballots: { teammateXYZ: { choice: 0, at: Date.now() } } };
      window._test_setRoomVotes(votes);
      window.renderDecisions();
    }, decId);

    await expect(live).not.toHaveText("");
    await expect(live).toContainText("voted");
  });
});
