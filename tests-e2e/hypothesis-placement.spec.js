/* tests-e2e/hypothesis-placement.spec.js
 *
 * Locks in the sim-2026-05-19 specialist-panel recommendations on
 * Module A's hypothesis flow:
 *
 *   1. The canonical "Working hypotheses" block sits BETWEEN
 *      Examination and Investigations in the DOM order — NOT above
 *      History (anchoring-bias risk per healthcare-CDSS reviewer).
 *   2. (The "First impressions" textarea was removed 2026-06-23 — PI request.)
 *   3. The Investigations unlock gate requires (a) ≥1 hypothesis AND
 *      (b) the red-flag screen (history:1 + history:2 + exam:3 all
 *      revealed). Typing a throwaway hypothesis alone no longer
 *      unlocks the panel — students must also screen NICE NG59
 *      red flags first.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Module A hypothesis-block placement (specialist consensus)", () => {
  test("DOM order is History < Examination < Investigations < Hypotheses", async ({ page }) => {
    // 2026-06-02 restructure: the team works up FREELY (history chat + exam +
    // investigations), THEN commits ≥2 working hypotheses (the gate that unlocks
    // the Debate). The on-screen Clinical synthesis section was REMOVED (its
    // write-up moved to the stage-4 take-home), so hypotheses is now the last
    // chart section.
    await page.goto("/");
    const order = await page.evaluate(() => {
      const ids = ["chart-section-history", "chart-section-exam",
                   "chart-investigations", "chart-hypotheses"];
      const map = {};
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) { map[id] = null; return; }
        let rank = 0, prev = el;
        while (prev = prev.previousElementSibling) {
          if (prev.classList && prev.classList.contains("chart-section")) rank++;
        }
        map[id] = rank;
      });
      return map;
    });
    for (const id of ["chart-section-history", "chart-section-exam",
                      "chart-investigations", "chart-hypotheses"]) {
      expect(order[id], id + " must be present").not.toBeNull();
    }
    const synthGone = await page.evaluate(() => !document.getElementById("chart-synthesis"));
    expect(synthGone, "the on-screen chart-synthesis section must be removed").toBe(true);
    expect(order["chart-section-exam"]).toBeGreaterThan(order["chart-section-history"]);
    expect(order["chart-investigations"]).toBeGreaterThan(order["chart-section-exam"]);
    expect(order["chart-hypotheses"]).toBeGreaterThan(order["chart-investigations"]);
  });

  test("the First-impressions section is gone (removed 2026-06-23)", async ({ page }) => {
    await page.goto("/");
    const gone = await page.evaluate(() => ({
      noSection: !document.getElementById("chart-impressions"),
      noTextarea: !document.getElementById("impressions-input")
    }));
    expect(gone.noSection, "chart-impressions section must be removed").toBe(true);
    expect(gone.noTextarea, "impressions textarea must be removed").toBe(true);
  });

  test("Investigations are clickable any time; there is no on-screen synthesis button", async ({ page }) => {
    // 2026-06-02: investigations (imaging + bloods) are freely clickable. The
    // Clinical synthesis section was removed, so labs:0 (SYNTH_ID) is never
    // rendered as a button. The Debate now gates on ≥2 working hypotheses
    // (covered in modA-rcol-progressive.spec.js).
    await page.goto("/");
    const out = await page.evaluate(async () => {
      if (!window.CanamedLoader || !window.CanamedLoader.ensureCaseContent) return "no-loader";
      await window.CanamedLoader.ensureCaseContent();
      const disabled = (sel) => {
        const b = document.querySelector(sel);
        return b ? b.disabled : null;
      };
      if (window._test_setRevealed) window._test_setRevealed({});
      if (window._test_setHypotheses) window._test_setHypotheses({});
      if (typeof window.buildButtons === "function") window.buildButtons();
      if (typeof window.renderButtons === "function") window.renderButtons();
      const imagingNoHyp = disabled('.req-btn[data-id="labs:1"]');
      const synthBtnPresent = !!document.querySelector('.req-btn[data-id="labs:0"]');
      return { imagingNoHyp, synthBtnPresent };
    });
    expect(out.imagingNoHyp, "imaging is clickable with no hypotheses").toBe(false);
    expect(out.synthBtnPresent, "labs:0 (synthesis) must NOT be rendered as a button").toBe(false);
  });

  test("Investigations show a free hint; the synthesis lock hint is gone", async ({ page }) => {
    await page.goto("/");
    const t = await page.evaluate(() => ({
      inv: (document.querySelector('#chart-investigations .chart-section-hint') || {}).textContent || "",
      synLockPresent: !!document.getElementById("synthesis-locked-hint")
    }));
    // Investigations: a free "yours to choose, like the examination" hint — no lock.
    expect(t.inv).toMatch(/indicated|choose|examination|indiqué|choisir|適応|選ぶ/i);
    expect(t.inv).not.toMatch(/🔒|Locked|Verrouillé|ロック中/);
    // The synthesis lock hint was removed with the section.
    expect(t.synLockPresent, "synthesis-locked-hint must be gone").toBe(false);
  });
});

test.describe("Theme readability tokens", () => {
  test("--note-bg + --note-ink + --note-accent-ink are themed for light / dark / high-contrast", async ({ page }) => {
    await page.goto("/");
    const results = {};
    for (const theme of ["light", "dark", "high-contrast"]) {
      results[theme] = await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
        const cs = getComputedStyle(document.documentElement);
        return {
          noteBg:        cs.getPropertyValue("--note-bg").trim(),
          noteInk:       cs.getPropertyValue("--note-ink").trim(),
          noteAccentInk: cs.getPropertyValue("--note-accent-ink").trim()
        };
      }, theme);
    }
    // Every theme must define a non-empty value for each token (so the
    // consultation-note never falls back to the hard-coded #fbf9f3 +
    // brown title that the previous CSS shipped — that combo was
    // unreadable in dark mode).
    for (const t of ["light", "dark", "high-contrast"]) {
      expect(results[t].noteBg, t + " --note-bg must be defined").not.toBe("");
      expect(results[t].noteInk, t + " --note-ink must be defined").not.toBe("");
      expect(results[t].noteAccentInk, t + " --note-accent-ink must be defined").not.toBe("");
    }
    // light theme keeps the warm-paper look (#fbf9f3-ish).
    expect(results.light.noteBg.toLowerCase()).toMatch(/^#fbf9f3$|^rgb/);
    // dark theme MUST NOT use the cream paper bg (would be invisible
    // text over cream in dark mode).
    expect(results.dark.noteBg.toLowerCase()).not.toBe("#fbf9f3");
    // high-contrast uses pure white surface.
    expect(results["high-contrast"].noteBg.toLowerCase()).toMatch(/^#(ffffff|fff)$|^rgb\(255,\s*255,\s*255\)/);
  });

  test("Consultation-note element actually receives the themed background in each theme", async ({ page }) => {
    await page.goto("/");
    // The .consultation-note element only renders inside the room view —
    // reveal #app + #stage-1 so the element paints, then sample its
    // computed background-color in each theme.
    await page.evaluate(() => {
      ["splash","lobby","waiting","admin-app","session-ended"].forEach(id => {
        const e = document.getElementById(id); if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s1 = document.getElementById("stage-1"); if (s1) s1.classList.remove("hidden");
      document.body.classList.remove("locked");
    });
    const out = {};
    for (const theme of ["light", "dark", "high-contrast"]) {
      out[theme] = await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
        const e = document.querySelector(".consultation-note");
        if (!e) return null;
        const cs = getComputedStyle(e);
        return { bg: cs.backgroundColor, color: cs.color };
      }, theme);
      expect(out[theme], theme + " consultation-note must paint").not.toBeNull();
    }
    // The three themes must produce three DIFFERENT background colours
    // (proves the theme-token override actually flows through, not
    // just lives in :root and gets ignored).
    const bgs = new Set([out.light.bg, out.dark.bg, out["high-contrast"].bg]);
    expect(bgs.size).toBeGreaterThanOrEqual(2);
  });
});
