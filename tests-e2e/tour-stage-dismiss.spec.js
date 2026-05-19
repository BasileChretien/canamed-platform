/* tests-e2e/tour-stage-dismiss.spec.js
 *
 * Regression for sim 2026-05-19 finding: the `studentModA` walkthrough
 * overlay used to persist into Module B and the Wrap-up screen if the
 * student hadn't clicked through it before the admin Advanced the
 * room. The fix dismisses any stage-bound tour (`student` at stage 0,
 * `studentModA` at stage 1) when renderStage() detects the stage no
 * longer matches the tour's home stage.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). The test drives the
 * tour directly via window.CanamedTour + bumps viewStage via the
 * platform's test hooks — we don't need a full room flow to verify
 * the dismiss logic.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function loadTour(page) {
  // CanamedTour is lazy-loaded by script-loader.js; force the load.
  await page.evaluate(async () => {
    if (window.CanamedLoader && typeof window.CanamedLoader.ensureTour === "function") {
      await window.CanamedLoader.ensureTour();
    }
    for (let i = 0; i < 30; i++) {
      if (window.CanamedTour) break;
      await new Promise(r => setTimeout(r, 100));
    }
  });
}

test.describe("Stage-bound tours auto-dismiss when the room advances", () => {
  test("activeSet() reports the current set after start()", async ({ page }) => {
    await page.goto("/");
    await loadTour(page);
    const before = await page.evaluate(() => window.CanamedTour.activeSet());
    expect(before, "no tour active by default").toBeNull();
    const after = await page.evaluate(() => {
      // Reveal #app so anchors exist, then start the studentModA tour.
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s1 = document.getElementById("stage-1");
      if (s1) s1.classList.remove("hidden");
      document.body.classList.remove("locked");
      window.CanamedTour.start("studentModA");
      return window.CanamedTour.activeSet();
    });
    expect(after, "activeSet() must return the started set").toBe("studentModA");
    // tear-down so the overlay doesn't pollute the next test
    await page.evaluate(() => window.CanamedTour.dismiss());
  });

  test("studentModA tour persists while viewStage stays at 1, dismisses when it changes", async ({ page }) => {
    await page.goto("/");
    await loadTour(page);
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s1 = document.getElementById("stage-1");
      if (s1) s1.classList.remove("hidden");
      document.body.classList.remove("locked");
      // Module A stage; start the tour. We bypass the localStorage
      // "done" guard so the tour fires even on a re-run.
      try { localStorage.removeItem("canamed_tour_student_moda_done"); } catch (e) {}
      window.CanamedTour.start("studentModA");
    });

    // Still on Module A → calling renderStage() shouldn't dismiss.
    const stillActive = await page.evaluate(() => {
      // Drive the global viewStage to 1 and re-render. Module A.
      if (window._test_setViewStage) window._test_setViewStage(1);
      if (typeof window.renderStage === "function") window.renderStage();
      return window.CanamedTour.activeSet();
    });
    expect(stillActive, "tour must stay open while still on Module A").toBe("studentModA");

    // Advance stage to Module B (2) → renderStage MUST dismiss.
    const afterAdvance = await page.evaluate(() => {
      if (window._test_setViewStage) window._test_setViewStage(2);
      if (typeof window.renderStage === "function") window.renderStage();
      return window.CanamedTour.activeSet();
    });
    expect(afterAdvance,
      "studentModA tour MUST dismiss when room advances to Module B"
    ).toBeNull();
  });

  test("student welcome tour dismisses when stage moves off Welcome", async ({ page }) => {
    await page.goto("/");
    await loadTour(page);
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s0 = document.getElementById("stage-0");
      if (s0) s0.classList.remove("hidden");
      document.body.classList.remove("locked");
      try { localStorage.removeItem("canamed_tour_student_done"); } catch (e) {}
      window.CanamedTour.start("student");
    });
    const after = await page.evaluate(() => {
      if (window._test_setViewStage) window._test_setViewStage(1);
      if (typeof window.renderStage === "function") window.renderStage();
      return window.CanamedTour.activeSet();
    });
    expect(after, "student welcome tour MUST dismiss past stage 0").toBeNull();
  });
});
