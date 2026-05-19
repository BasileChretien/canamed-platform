/* tests-e2e/module-b-collapsible.spec.js
 *
 * Sim 2026-05-18 surfaced Module B density: 17 visible buttons, 4.5×
 * viewport tall. The button count is mostly load-bearing (role chips,
 * answer add/remove buttons) but the SCROLL is largely the
 * informational cards (vignette, safety-note, etc.) that stay
 * permanently expanded.
 *
 * Fix: the multi-paragraph "Before you start — two things" safety
 * card is now a <details open class="collapsible-card">. Default-open
 * preserves the first-read affordance — a single click later moves it
 * out of the way for the rest of the scene.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Module B safety-note — collapsible <details>", () => {
  test("the safety-note card is a default-open <details> with a clickable summary", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => {
      const stage2 = document.getElementById("stage-2");
      if (!stage2) return { found: false };
      const note = stage2.querySelector(".safety-note");
      if (!note) return { found: false };
      return {
        found: true,
        tag: note.tagName,
        hasOpen: note.hasAttribute("open"),
        hasCollapsibleClass: note.classList.contains("collapsible-card"),
        hasSummary: !!note.querySelector("summary"),
        summaryHasHeading: !!(note.querySelector("summary") && note.querySelector("summary strong"))
      };
    });
    expect(info.found, "Module B safety-note must still be present").toBe(true);
    expect(info.tag, "safety-note must be <details> for collapsibility").toBe("DETAILS");
    expect(info.hasOpen, "must default-open so first-time users see the warnings").toBe(true);
    expect(info.hasCollapsibleClass, "must opt into the .collapsible-card pattern").toBe(true);
    expect(info.hasSummary).toBe(true);
    expect(info.summaryHasHeading, "summary must wrap the original heading").toBe(true);
  });

  test("collapsing the safety-note shortens the visible card", async ({ page }) => {
    await page.goto("/");
    // Render Module B so the card paints.
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const stage2 = document.getElementById("stage-2");
      if (stage2) stage2.classList.remove("hidden");
      document.body.classList.remove("locked");
    });

    const noteOpen = await page.evaluate(() => {
      const note = document.querySelector("#stage-2 .safety-note");
      return note ? note.getBoundingClientRect().height : 0;
    });
    expect(noteOpen, "open safety-note must have a measurable height").toBeGreaterThan(80);

    await page.evaluate(() => {
      const note = document.querySelector("#stage-2 .safety-note");
      note.querySelector("summary").click();
    });

    const noteClosed = await page.evaluate(() => {
      const note = document.querySelector("#stage-2 .safety-note");
      return note ? note.getBoundingClientRect().height : 0;
    });
    expect(noteClosed, "collapsing must shrink the card to ~ summary-row height")
      .toBeLessThan(noteOpen * 0.5);
  });
});
