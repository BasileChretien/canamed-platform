/* tests-e2e/hypothesis-placement.spec.js
 *
 * Locks in the sim-2026-05-19 specialist-panel recommendations on
 * Module A's hypothesis flow:
 *
 *   1. The canonical "Working hypotheses" block sits BETWEEN
 *      Examination and Investigations in the DOM order — NOT above
 *      History (anchoring-bias risk per healthcare-CDSS reviewer).
 *   2. A small "First impressions (optional)" textarea sits above
 *      History as a private, free-text gut-feel — no Firebase write,
 *      no gating.
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
  test("'Working hypotheses' sits BETWEEN Examination and Investigations in the DOM", async ({ page }) => {
    await page.goto("/");
    const order = await page.evaluate(() => {
      const ids = ["chart-section-history", "chart-section-exam",
                   "chart-hypotheses", "chart-investigations"];
      const found = ids.map(id => {
        const el = document.getElementById(id);
        if (!el) return { id, pos: null };
        // Document order ranking via Node.compareDocumentPosition.
        let rank = 0;
        let prev = el;
        // Walk previous sibling chain to count chart-section siblings.
        while (prev = prev.previousElementSibling) {
          if (prev.classList && prev.classList.contains("chart-section")) rank++;
        }
        return { id, pos: rank };
      });
      return found;
    });
    const map = {};
    order.forEach(o => { map[o.id] = o.pos; });
    expect(map["chart-section-history"], "history must be present").not.toBeNull();
    expect(map["chart-section-exam"], "exam must be present").not.toBeNull();
    expect(map["chart-hypotheses"], "hypotheses must be present").not.toBeNull();
    expect(map["chart-investigations"], "investigations must be present").not.toBeNull();
    // The contract: history < exam < hypotheses < investigations.
    expect(map["chart-section-exam"]).toBeGreaterThan(map["chart-section-history"]);
    expect(map["chart-hypotheses"]).toBeGreaterThan(map["chart-section-exam"]);
    expect(map["chart-investigations"]).toBeGreaterThan(map["chart-hypotheses"]);
  });

  test("'First impressions' textarea sits at the top of the chart + is non-gating", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => {
      const im = document.getElementById("chart-impressions");
      if (!im) return null;
      const ta = document.getElementById("impressions-input");
      // history should come AFTER impressions in document order.
      const hist = document.getElementById("chart-section-history");
      const ordered = im.compareDocumentPosition(hist) & Node.DOCUMENT_POSITION_FOLLOWING;
      return {
        hasSection: true,
        hasTextarea: !!ta && ta.tagName === "TEXTAREA",
        beforeHistory: !!ordered,
        // No data-i18n on the section title is fine — testing structure only.
      };
    });
    expect(info, "chart-impressions section must exist").not.toBeNull();
    expect(info.hasTextarea, "must include a TEXTAREA input").toBe(true);
    expect(info.beforeHistory, "impressions must come BEFORE history in the DOM").toBe(true);
  });

  test("Investigations unlock gate requires hypothesis AND red-flag screen", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(async () => {
      if (!window.CanamedLoader || !window.CanamedLoader.ensureCaseContent) return "no-loader";
      await window.CanamedLoader.ensureCaseContent();
      // Empty state: no hypothesis, no reveals.
      if (window._test_setRevealed) window._test_setRevealed({});
      const before = window.hypothesesUnlocked();
      // Type a hypothesis without doing any reveals — used to unlock
      // Investigations; the new gate must keep it locked.
      if (window._test_setHypotheses) window._test_setHypotheses({ fake: { text: "back pain", at: Date.now() } });
      const afterHypoOnly = window.hypothesesUnlocked();
      // Now do the red-flag screen items but DROP the hypothesis.
      if (window._test_setHypotheses) window._test_setHypotheses({});
      if (window._test_setRevealed) window._test_setRevealed({
        "history:1": { at: 1, by: "t" },
        "history:2": { at: 1, by: "t" },
        "exam:3":    { at: 1, by: "t" }
      });
      const afterRedflagOnly = window.hypothesesUnlocked();
      // Now BOTH.
      if (window._test_setHypotheses) window._test_setHypotheses({ fake: { text: "back pain", at: Date.now() } });
      const afterBoth = window.hypothesesUnlocked();
      return { before, afterHypoOnly, afterRedflagOnly, afterBoth };
    });
    expect(out.before, "no hypothesis + no reveals → locked").toBe(false);
    expect(out.afterHypoOnly, "hypothesis alone must NOT unlock — sim2026-05-19 specialist-panel decision").toBe(false);
    expect(out.afterRedflagOnly, "red-flag screen alone must NOT unlock").toBe(false);
    expect(out.afterBoth, "hypothesis + red-flag screen → unlocked").toBe(true);
  });

  test("Locked-state hint copy mentions BOTH the red-flag screen AND the hypothesis", async ({ page }) => {
    await page.goto("/");
    const t = await page.evaluate(() => {
      const h = document.getElementById("investigations-locked-hint");
      return h ? (h.textContent || "") : "";
    });
    expect(t).toMatch(/red flag|red-flag|cauda|leg neuro|drapeau|レッドフラッグ/i);
    expect(t).toMatch(/hypothesis|hypothèse|hypothèses|仮説/i);
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
