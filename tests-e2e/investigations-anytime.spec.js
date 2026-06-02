/* tests-e2e/investigations-anytime.spec.js
 *
 * Dry-run feedback (2026-05-26): investigations (imaging + bloods) are
 * clickable AT ANY TIME — ordering one prematurely / without indication is
 * penalised, not blocked — while only the clinical SYNTHESIS (labs:0) stays
 * gated on the red-flag screen. Renders the default scenario's investigation
 * buttons via buildButtons()/renderButtons() (no room/Firebase needed) and
 * checks the disabled state directly.
 *
 * Listed in the mobile-iphone / mobile-ipad / mobile-android testMatch in
 * playwright.config.js so it runs per-device (chromium + the three mobile
 * viewports) per the standing per-device-tests rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function buildLabs(page, revealed, hyps) {
  return page.evaluate(async (args) => {
    const rev = args.rev, hyps = args.hyps;
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    if (window._test_setHypotheses) window._test_setHypotheses(hyps || {});
    if (window._test_setRevealed) window._test_setRevealed(rev || {});
    if (typeof window.buildButtons === "function") window.buildButtons();
    if (typeof window.renderButtons === "function") window.renderButtons();
    const dis = (id) => {
      const b = document.querySelector('.req-btn[data-id="' + id + '"]');
      return b ? b.disabled : null;
    };
    return { imaging: dis("labs:1"), bloods: dis("labs:3"), synth: dis("labs:0") };
  }, { rev: revealed, hyps: hyps });
}

const TWO_HYPS = {
  a: { text: "mechanical low back pain", by: "t", at: 1 },
  b: { text: "axial spondyloarthritis", by: "t", at: 1 }
};

test.describe("Module A — investigations clickable any time, synthesis gated", () => {
  test("imaging + bloods are clickable with no hypotheses; synthesis is gated", async ({ page }) => {
    await page.goto("/");
    const s = await buildLabs(page, {}, {});
    expect(s.imaging, "imaging (labs:1) clickable any time").toBe(false);
    expect(s.bloods, "bloods (labs:3) clickable any time").toBe(false);
    expect(s.synth, "synthesis (labs:0) gated until ≥2 hypotheses").toBe(true);
  });

  test("synthesis unlocks after ≥2 working hypotheses; investigations stay clickable", async ({ page }) => {
    await page.goto("/");
    const s = await buildLabs(page, {}, TWO_HYPS);
    expect(s.synth, "synthesis unlocks once ≥2 working hypotheses are written").toBe(false);
    expect(s.imaging, "imaging stays clickable").toBe(false);
    expect(s.bloods, "bloods stays clickable").toBe(false);
  });

  test("the investigations panel is never greyed out as locked", async ({ page }) => {
    await page.goto("/");
    await buildLabs(page, {});
    const locked = await page.evaluate(() => {
      const inv = document.getElementById("chart-investigations");
      // renderHypotheses() runs on hypothesis render; trigger it if available.
      if (typeof window.renderHypotheses === "function") window.renderHypotheses();
      return inv ? inv.classList.contains("is-locked") : null;
    });
    expect(locked, "investigations panel must not carry the .is-locked class").toBe(false);
  });
});
