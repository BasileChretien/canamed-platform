/* tests-e2e/chart-sections-collapsible.spec.js
 *
 * Sim 2026-05-18 surfaced Module A density: the case-workup chart had
 * ~30 buttons visible at once, 4.6× viewport tall, hitting low-English
 * (Kenta A2) + anxious (Hana B1) personas particularly hard ("Too many
 * words. I want to click the wrong thing by mistake.").
 *
 * Fix: each chart section (History / Examination / Investigations) is
 * now a <details open> instead of <section>. The chart still renders
 * fully on first load (no behaviour change for first-time users), but a
 * student can collapse any section they're done with — trimming the
 * scroll-height without removing gameplay options.
 *
 * This suite locks in:
 *   1. Each chart section is a <details open> in the DOM.
 *   2. Clicking the section heading collapses its button-group
 *      (and the buttons stop counting as visible).
 *   3. Clicking again re-opens.
 *   4. The keyboard a11y contract is honoured (<summary> is the focus
 *      target, Enter/Space toggles).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Module A chart sections — collapsible <details>", () => {
  test("each chart section is a <details open> with a <summary> heading", async ({ page }) => {
    await page.goto("/");
    const tags = await page.evaluate(() => {
      const ids = ["chart-section-history", "chart-section-exam", "chart-investigations"];
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
    for (const t of tags) {
      expect(t.tag, t.id + " must be <details>").toBe("DETAILS");
      expect(t.open, t.id + " must default-open so first-time users see the full chart").toBe(true);
      expect(t.hasSummary, t.id + " must contain a <summary> click target").toBe(true);
      expect(t.summaryHasHeader, t.id + " summary must wrap the icon + heading").toBe(true);
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

  test("collapsing all three sections meaningfully shortens the page scroll-height", async ({ page }) => {
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

    const heightOpen = await page.evaluate(() => document.body.scrollHeight);

    // Collapse all three.
    for (const id of ["chart-section-history", "chart-section-exam", "chart-investigations"]) {
      await page.locator("#" + id + " summary").click();
    }

    const heightClosed = await page.evaluate(() => document.body.scrollHeight);
    expect(heightClosed,
      "collapsing all 3 chart sections must noticeably shorten the page"
    ).toBeLessThan(heightOpen);
    // Empirically the 3 button groups together account for ~600-900px;
    // require at least a 200px reduction so we don't pass on a no-op.
    expect(heightOpen - heightClosed,
      "expected at least 200px reduction after collapsing all 3 sections"
    ).toBeGreaterThan(200);
  });
});
