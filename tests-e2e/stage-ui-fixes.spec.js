/* tests-e2e/stage-ui-fixes.spec.js
 *
 * Stage-bar + Module A/B clean-ups (2026-06-02, user requests):
 *   1. The "Stage X of 4" text is redundant with the numbered
 *      #global-stage-progress stepper, so it is hidden visually (kept sr-only
 *      for screen-reader position announcements).
 *   2. The "I'm just observing" participant button (#observer-btn) was removed.
 *   6. Module B's right column held only the (phase-gated) group-answers card,
 *      so the right ~37% sat empty for most of the module; it now collapses to
 *      full width in every phase except the final "bullets" phase.
 *   7. The case's actual diagnosis is surfaced at the wrap-up for Module A.
 *
 * Runs on the desktop matrix (chromium/firefox/webkit) and is registered into
 * the mobile-iphone / mobile-ipad / mobile-android projects (per-device cover,
 * per the project's standing instruction).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function surfaceApp(page) {
  await page.goto("/");
  // room-only CSS is lazily <link>ed by ensureRoomStyles() on real room entry;
  // this spec surfaces the room synthetically, so load it explicitly (same
  // convention as branched-format.spec.js awaiting ensureBranchedStyles).
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
  });
}

async function showStage(page, id) {
  await page.evaluate((sid) => {
    ["stage-0", "stage-1", "stage-2", "stage-3"].forEach((s) => {
      const n = document.getElementById(s);
      if (n) n.classList.toggle("hidden", s !== sid);
    });
  }, id);
}

test.describe("Stage bar redundancy + observer button removal", () => {
  test("'Stage X of 4' is sr-only; the numbered stepper is the visible map", async ({ page }) => {
    await surfaceApp(page);
    await showStage(page, "stage-1");
    const indicator = page.locator("#stage-indicator");
    // Still in the DOM (aria-live position announcement for screen readers)…
    await expect(indicator).toHaveCount(1);
    await expect(indicator).toHaveClass(/sr-only/);
    // …but collapsed to the 1px sr-only box, i.e. not a visible text line.
    const box = await indicator.boundingBox();
    expect(box === null || box.height <= 1).toBeTruthy();
    // the numbered stepper remains in the DOM as the visible session map
    await expect(page.locator("#global-stage-progress")).toBeAttached();
  });

  test("the 'I'm just observing' button no longer exists", async ({ page }) => {
    await surfaceApp(page);
    await showStage(page, "stage-1");
    await expect(page.locator("#observer-btn")).toHaveCount(0);
  });

  test("the patient intro is fused into one readable section; the chart title is gone", async ({ page }) => {
    // 2026-07-15 (user request): the separate "📋 consultation note" + "👥 shared
    // chart" header on the cream chart (muted text, ~6.6:1) was fused into the
    // high-contrast patient vignette. One intro section, readable colours.
    await surfaceApp(page);
    await showStage(page, "stage-1");

    // the "shared chart / discuss first" framing now lives in the vignette…
    const note = page.locator(".vignette .vignette-shared-note");
    await expect(note).toHaveCount(1);
    await expect(note).toBeVisible();

    // …and is gone from the chart, along with the redundant consultation-note title
    await expect(page.locator(".consultation-note .chart-team-warning")).toHaveCount(0);
    await expect(page.locator(".consultation-note-title")).toHaveCount(0);
    // the chart still has an accessible name via aria-label
    await expect(page.locator(".consultation-note")).toHaveAttribute("aria-label", /.+/);

    // the fused note reads at high contrast (not the old washed-out muted text):
    // ink text on a themed surface, well above the WCAG-AA 4.5:1 floor.
    const ratio = await note.evaluate((el) => {
      const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
      const parse = (s) => (s.match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number);
      const effBg = (n) => { while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; n = n.parentElement; } return "rgb(255,255,255)"; };
      const fg = lum(parse(getComputedStyle(el).color));
      const bg = lum(parse(effBg(el)));
      const a = Math.max(fg, bg), b = Math.min(fg, bg);
      return (a + 0.05) / (b + 0.05);
    });
    expect(ratio).toBeGreaterThan(4.5);
  });
});

test.describe("Module B right-column collapse", () => {
  test("collapses except in the answer phases (exchange + reflect)", async ({ page }) => {
    await surfaceApp(page);
    await showStage(page, "stage-2");
    const cols = page.locator("#stage-2 .columns.modB-columns");
    await expect(cols).toHaveCount(1);
    // setup / play / swap / replay: the answer cards are hidden → full width
    for (const phase of ["setup", "play", "swap", "replay"]) {
      await page.evaluate((p) => window.applyModBPhaseVisibility(p), phase);
      await expect(cols).toHaveClass(/rcol-collapsed/);
    }
    // 2026-06-26: the answer cards now show in P3 "exchange" (two questions) and
    // P6 "reflect" (what improved) → the two-column layout returns in both.
    for (const phase of ["exchange", "reflect"]) {
      await page.evaluate((p) => window.applyModBPhaseVisibility(p), phase);
      await expect(cols).not.toHaveClass(/rcol-collapsed/);
    }
  });
});

test.describe("Module A diagnosis at wrap-up", () => {
  test("the active case's diagnosis is available for the wrap-up", async ({ page }) => {
    await surfaceApp(page);
    const dx = await page.evaluate(() =>
      typeof window.moduleADiagnosis === "function" ? window.moduleADiagnosis() : null);
    expect(dx).toBeTruthy();
    expect(typeof dx.body).toBe("string");
    // default Franco-Japanese scenario → chronic non-specific low-back pain
    expect(dx.body).toMatch(/low-back pain/i);
  });
});

test.describe("Module B follow-ups (2026-06-02)", () => {
  test("team decisions appear in the exchange phase, not setup", async ({ page }) => {
    await surfaceApp(page);
    await showStage(page, "stage-2");
    const dec = page.locator("#decisions-B");
    await expect(dec).toHaveCount(1);
    // setup: gated out (is-phase-hidden → not visible)
    await page.evaluate(() => window.applyModBPhaseVisibility("setup"));
    await expect(dec).toHaveClass(/is-phase-hidden/);
    // exchange: revealed
    await page.evaluate(() => window.applyModBPhaseVisibility("exchange"));
    await expect(dec).not.toHaveClass(/is-phase-hidden/);
  });

  test("the phase-nav has a prominent Next + an explicit 'tap Next' hint", async ({ page }) => {
    await surfaceApp(page);
    await showStage(page, "stage-2");
    await expect(page.locator("#modB-phase-next.phase-nav-btn--next")).toHaveCount(1);
    await expect(page.locator("#modB-phase-nav-hint")).toBeVisible();
  });

  test("the safety-note prose is no longer capped to the narrow reading column", async ({ page }) => {
    await surfaceApp(page);
    await showStage(page, "stage-2");
    await page.evaluate(() => window.applyModBPhaseVisibility("setup"));
    const maxW = await page.evaluate(() => {
      const p = document.querySelector("#stage-2 .safety-note p");
      return p ? getComputedStyle(p).maxWidth : null;
    });
    expect(maxW).toBe("none");
  });
});
