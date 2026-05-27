/* tests-e2e/case-cluster-by-category.spec.js
 *
 * Dry-run feedback (2026-05-26): cluster the Module A History + Examination
 * reveal buttons by clinical category so the dense button wall reads as a few
 * labelled clinical sections. Display-only grouping — item indices are
 * untouched. This spec renders the default scenario's buttons via
 * window.buildButtons() (same lightweight approach as module-b-i18n.spec.js)
 * and asserts: History & Examination render category sub-groups with headings,
 * every reveal button is still present (none dropped) and lives inside a
 * category, and Investigations stay flat (no category headings).
 *
 * Listed in the mobile-iphone / mobile-ipad / mobile-android testMatch in
 * playwright.config.js so it runs per-device (chromium + the three mobile
 * viewports) per the standing per-device-tests rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function renderChart(page) {
  await page.goto("/");
  // Surface Module A (stage-1) and build the reveal buttons. buildButtons()
  // reads window.CASE (loaded by case-content.js) and fills #group-history/
  // exam/labs — no room or Firebase needed to render the grouping.
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-2", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const stage1 = document.getElementById("stage-1");
    if (stage1) stage1.classList.remove("hidden");
    if (typeof window.buildButtons === "function") window.buildButtons();
  });
}

test.describe("Module A — reveal buttons clustered by clinical category", () => {
  test("History & Examination render labelled category sub-groups", async ({ page }) => {
    await renderChart(page);

    for (const group of ["history", "exam"]) {
      const cats = page.locator(`#group-${group} .req-category`);
      expect(await cats.count(), `${group} must render 2+ category clusters`)
        .toBeGreaterThanOrEqual(2);
      // every cluster carries a non-empty heading (textContent, since the
      // Examination <details> is collapsed by default → innerText would be "")
      const labels = page.locator(`#group-${group} .req-category-label`);
      const n = await labels.count();
      expect(n).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < n; i++) {
        const txt = (await labels.nth(i).textContent()) || "";
        expect(txt.trim().length).toBeGreaterThan(0);
      }
    }

    // The default scenario's first History category heading is recognisable
    // (History defaults OPEN, so it is visible).
    await expect(page.locator("#group-history .req-category-label").first())
      .toHaveText(/History & background/i);
  });

  test("no reveal button is lost — every button sits inside a category", async ({ page }) => {
    await renderChart(page);

    for (const group of ["history", "exam"]) {
      const total = await page.locator(`#group-${group} .req-btn`).count();
      const inCategory = await page.locator(`#group-${group} .req-category .req-btn`).count();
      expect(total, `${group} must have buttons`).toBeGreaterThan(0);
      expect(inCategory, `every ${group} button must live inside a category`).toBe(total);
    }
  });

  test("Investigations stay flat — no category headings", async ({ page }) => {
    await renderChart(page);
    await expect(page.locator("#group-labs .req-category")).toHaveCount(0);
    // but the investigation buttons are still rendered
    expect(await page.locator("#group-labs .req-btn").count()).toBeGreaterThan(0);
  });

  test("each category is a collapsible <details> — first open, rest collapsed", async ({ page }) => {
    await renderChart(page);

    for (const group of ["history", "exam"]) {
      // Categories are <details> elements (so they open/close).
      const detailsCount = await page.locator(`#group-${group} details.req-category`).count();
      const catCount = await page.locator(`#group-${group} .req-category`).count();
      expect(detailsCount, `${group} categories must be <details>`).toBe(catCount);
      expect(detailsCount).toBeGreaterThanOrEqual(2);

      // First category open as an entry point; every later one collapsed so
      // the section isn't a wall of buttons + answers at once.
      const opens = await page.locator(`#group-${group} .req-category`)
        .evaluateAll(els => els.map(e => e.open));
      expect(opens[0], `first ${group} category should start open`).toBe(true);
      expect(opens.slice(1).every(o => o === false),
        `later ${group} categories should start collapsed`).toBe(true);
    }
  });

  test("a collapsed category's buttons are hidden until its summary is clicked", async ({ page }) => {
    await renderChart(page);
    // The second history category is collapsed by default → its buttons are
    // not visible. Clicking its summary reveals them. (Exam's top-level
    // <details> is collapsed, so we use History which defaults open.)
    const secondCat = page.locator("#group-history .req-category").nth(1);
    const firstBtn = secondCat.locator(".req-btn").first();
    await expect(firstBtn).toBeHidden();
    await secondCat.locator("summary.req-category-label").click();
    await expect(firstBtn).toBeVisible();
  });

  test("category headings re-translate on language switch", async ({ page }) => {
    await renderChart(page);
    const first = page.locator("#group-history .req-category-label").first();
    await expect(first).toHaveText(/History & background/i);

    // Switch to French and re-render (canamed:langchange drives buildButtons).
    await page.evaluate(async () => {
      if (window.setLang) await window.setLang("fr");
      if (typeof window.buildButtons === "function") window.buildButtons();
    });
    await expect(page.locator("#group-history .req-category-label").first())
      .toHaveText(/Anamnèse et antécédents/i);
  });
});
