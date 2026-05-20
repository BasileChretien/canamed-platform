/* tests-e2e/chart-sections-collapsible.spec.js
 *
 * Sim 2026-05-18 surfaced Module A density: the case-workup chart had
 * ~30 buttons visible at once, 4.6× viewport tall, hitting low-English
 * (Kenta A2) + anxious (Hana B1) personas particularly hard ("Too many
 * words. I want to click the wrong thing by mistake.").
 *
 * Each chart section (History / Examination / Working hypotheses /
 * Investigations) is a <details> with a <summary> heading.
 *
 * PROGRESSIVE DISCLOSURE (2026-05-20): the sim kept flagging Module A
 * opening with ~30 buttons / ~5× viewport. History stays default-OPEN
 * (the obvious starting point) while Examination, Working hypotheses and
 * Investigations are default-COLLAPSED — their labelled summaries stay
 * visible so discoverability is preserved, and the team expands each
 * section as it works down the chart. renderButtons still populates the
 * (hidden) groups, so no gameplay option is removed.
 *
 * This suite locks in:
 *   1. Every chart section is a <details> with a <summary> heading;
 *      History defaults open, the other three default collapsed.
 *   2. Clicking a section heading toggles its button-group visibility.
 *   3. The default (collapsed) layout is meaningfully shorter than the
 *      fully-expanded layout.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Module A chart sections — collapsible <details>", () => {
  test("chart sections are <details>+<summary>; History open, others collapsed", async ({ page }) => {
    await page.goto("/");
    const tags = await page.evaluate(() => {
      const ids = ["chart-section-history", "chart-section-exam",
                   "chart-hypotheses", "chart-investigations"];
      return ids.map(id => {
        const e = document.getElementById(id);
        if (!e) return { id: id, tag: "MISSING" };
        const summary = e.querySelector("summary");
        return {
          id: id,
          tag: e.tagName,
          open: e.hasAttribute("open"),
          hasSummary: !!summary,
          summaryHasHeader: !!(summary && summary.querySelector("svg, span"))
        };
      });
    });
    // Which sections must default-open vs default-collapsed.
    const shouldBeOpen = { "chart-section-history": true };
    for (const t of tags) {
      expect(t.tag, t.id + " must be <details>").toBe("DETAILS");
      expect(t.hasSummary, t.id + " must contain a <summary> click target").toBe(true);
      expect(t.summaryHasHeader, t.id + " summary must wrap the icon + heading").toBe(true);
      const wantOpen = !!shouldBeOpen[t.id];
      expect(t.open,
        t.id + (wantOpen ? " must default-open (first step)"
                         : " must default-collapse (progressive disclosure)")
      ).toBe(wantOpen);
    }
  });

  test("clicking the summary collapses the section + hides its buttons", async ({ page }) => {
    await page.goto("/");
    // Reveal the room view so children of #app actually paint; pump 5
    // case-buttons into group-history so the collapse has something
    // measurable to hide. We're testing the <details> mechanics — the
    // real buildButtons() path only fires once a student is in a room.
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      // Module A's chart sits inside #stage-1 which defaults to hidden
      // until the room state machine advances. Reveal it directly so
      // the children paint.
      const stage1 = document.getElementById("stage-1");
      if (stage1) stage1.classList.remove("hidden");
      document.body.classList.remove("locked");
      const group = document.getElementById("group-history");
      group.innerHTML = "";
      for (let i = 0; i < 5; i++) {
        const b = document.createElement("button");
        b.className = "req-btn";
        b.textContent = "history button " + i;
        group.appendChild(b);
      }
    });

    // Open state: buttons are interactable (rect.height > 0).
    const visibleOpen = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#group-history button"))
        .filter(b => b.getClientRects().length > 0).length;
    });
    expect(visibleOpen).toBe(5);

    // Click the summary to collapse. Use evaluate() so we call the
    // .click() that fires the native details-toggle (Playwright's
    // .click() on a summary can sometimes hit a child element which
    // doesn't bubble the same way in headless).
    await page.evaluate(() => {
      const d = document.getElementById("chart-section-history");
      const s = d.querySelector("summary");
      s.click();
    });
    const isOpenAfterCollapse = await page.evaluate(
      () => document.getElementById("chart-section-history").hasAttribute("open")
    );
    expect(isOpenAfterCollapse, "summary click should toggle <details> open attr").toBe(false);

    // Buttons no longer paint (browser-native details hides children).
    const visibleClosed = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#group-history button"))
        .filter(b => b.getClientRects().length > 0).length;
    });
    expect(visibleClosed, "collapsing the section must hide its case buttons").toBe(0);

    // Click again → re-opens.
    await page.evaluate(() => {
      const d = document.getElementById("chart-section-history");
      d.querySelector("summary").click();
    });
    const isOpenAfterReopen = await page.evaluate(
      () => document.getElementById("chart-section-history").hasAttribute("open")
    );
    expect(isOpenAfterReopen).toBe(true);
    const visibleReopened = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#group-history button"))
        .filter(b => b.getClientRects().length > 0).length;
    });
    expect(visibleReopened).toBe(5);
  });

  test("the default collapsed layout is meaningfully shorter than fully-expanded", async ({ page }) => {
    await page.goto("/");
    // Render the room view + populate each group with 10 buttons so the
    // collapse-effect is measurable.
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      // Module A's chart sits inside #stage-1 which defaults to hidden
      // until the room state machine advances. Reveal it directly so
      // the children paint.
      const stage1 = document.getElementById("stage-1");
      if (stage1) stage1.classList.remove("hidden");
      document.body.classList.remove("locked");
      ["history", "exam", "labs"].forEach(g => {
        const group = document.getElementById("group-" + g);
        if (!group) return;
        group.innerHTML = "";
        for (let i = 0; i < 10; i++) {
          const b = document.createElement("button");
          b.className = "req-btn";
          b.textContent = g + " " + i;
          group.appendChild(b);
        }
      });
    });

    const SECTIONS = ["chart-section-history", "chart-section-exam",
                      "chart-hypotheses", "chart-investigations"];

    // Fully-expanded baseline: force every section open.
    const heightAllOpen = await page.evaluate((ids) => {
      ids.forEach(id => { const e = document.getElementById(id); if (e) e.setAttribute("open", ""); });
      return document.body.scrollHeight;
    }, SECTIONS);

    // Default layout: History open, the other three collapsed (the
    // shipped progressive-disclosure state).
    const heightDefault = await page.evaluate((ids) => {
      ids.forEach(id => {
        const e = document.getElementById(id);
        if (!e) return;
        if (id === "chart-section-history") e.setAttribute("open", "");
        else e.removeAttribute("open");
      });
      return document.body.scrollHeight;
    }, SECTIONS);

    expect(heightDefault,
      "the default collapsed layout must be shorter than fully-expanded"
    ).toBeLessThan(heightAllOpen);
    // The 3 collapsed button groups together account for several hundred px;
    // require a meaningful reduction so we don't pass on a no-op.
    expect(heightAllOpen - heightDefault,
      "expected at least 200px shorter in the default layout"
    ).toBeGreaterThan(200);
  });
});
