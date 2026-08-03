/* tests-e2e/section-row-change.spec.js
 *
 * A picked section can be changed IN PLACE.
 *
 * The picker seeds a default section so a facilitator who touches nothing still
 * gets a runnable session. But the row rendered that section as static text, so
 * the only way to replace it was to notice the small ×, remove it, and then add
 * another — which reads as "section 1 is fixed". Each row now carries a select.
 *
 * Registered in the three mobile testMatch allowlists per the standing
 * per-device rule: this is a create-form UI change.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openPicker(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
}
const rowIds = (page) =>
  page.locator("#splash-section-list .splash-section-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-section-id")));

test.describe("A picked section can be changed in place", () => {
  test("the seeded default is a SELECT, not fixed text", async ({ page }) => {
    await openPicker(page);
    const rows = page.locator("#splash-section-list .splash-section-row");
    await expect(rows).toHaveCount(1);
    const pick = rows.first().locator("select.splash-section-pick");
    await expect(pick).toBeVisible();
    // It shows the section currently in that slot…
    expect(await pick.inputValue()).toBe((await rowIds(page))[0]);
    // …and offers the whole library, not just the current one.
    expect(await pick.locator("option").count()).toBeGreaterThanOrEqual(7);
  });

  test("changing it replaces THAT slot and nothing else", async ({ page }) => {
    await openPicker(page);
    // Build a 2-section pick so we can prove the other slot is untouched.
    await page.selectOption("#splash-section-add", "sore-throat-roleplay");
    await page.locator("#splash-section-add-btn").click();
    expect(await rowIds(page)).toEqual(["chronic-pain-pbl", "sore-throat-roleplay"]);

    const first = page.locator(".splash-section-row").first().locator("select.splash-section-pick");
    await first.selectOption("jaundice-pbl");
    expect(await rowIds(page), "only slot 1 changes").toEqual(
      ["jaundice-pbl", "sore-throat-roleplay"]);

    /* The CSV the session stores must follow the change — otherwise the form
       would show one thing and create another, which is worse than not being
       able to change it at all. */
    expect(await page.evaluate(() => sectionPickCsv()))
      .toBe("jaundice-pbl,sore-throat-roleplay");
  });

  test("the type chip follows the new section", async ({ page }) => {
    await openPicker(page);
    const row = page.locator(".splash-section-row").first();
    await row.locator("select.splash-section-pick").selectOption("sore-throat-roleplay");
    await expect(row.locator(".splash-section-type")).toHaveText(/Roleplay|Jeu de rôle|ロールプレイ/);
  });

  test("changing a slot to the SAME section twice is allowed (duplicates are legal)", async ({ page }) => {
    await openPicker(page);
    await page.selectOption("#splash-section-add", "jaundice-pbl");
    await page.locator("#splash-section-add-btn").click();
    const first = page.locator(".splash-section-row").first().locator("select.splash-section-pick");
    await first.selectOption("jaundice-pbl");
    expect(await rowIds(page), "running the same section twice stays legal")
      .toEqual(["jaundice-pbl", "jaundice-pbl"]);
  });

  test("the position label still reads Section k", async ({ page }) => {
    await openPicker(page);
    await page.selectOption("#splash-section-add", "jaundice-pbl");
    await page.locator("#splash-section-add-btn").click();
    const rows = page.locator(".splash-section-row");
    await expect(rows.nth(0)).toContainText(/Section 1/);
    await expect(rows.nth(1)).toContainText(/Section 2/);
  });

  test("the row select does not push the form off a phone viewport", async ({ page }) => {
    /* The create form has overflowed narrow viewports before (PR #172 class),
       and a select carrying long option labels is exactly the risk. */
    await page.setViewportSize({ width: 320, height: 800 });
    await openPicker(page);
    for (const id of ["sore-throat-roleplay", "jaundice-pbl"]) {
      await page.selectOption("#splash-section-add", id);
      await page.locator("#splash-section-add-btn").click();
    }
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth
    }));
    expect(sw, `no horizontal overflow at 320px (scrollWidth ${sw} vs ${cw})`)
      .toBeLessThanOrEqual(cw + 1);
  });
});
