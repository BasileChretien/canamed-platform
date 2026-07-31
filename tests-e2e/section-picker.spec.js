/* tests-e2e/section-picker.spec.js
 *
 * S3b — the create form's section picker, in a real browser.
 *
 * This is the phase where the user's original request becomes visible:
 * "Scenario (the clinical case for this workshop)" stops being the control a
 * facilitator uses, replaced by picking the SECTIONS the session runs — in
 * order, possibly from different clinical cases, possibly two of a kind.
 *
 * Registered into the mobile projects per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openCreate(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();     // open the create form
  /* The section library is a lazy chunk; the picker fills itself once it lands,
     so wait for the add-list to have options rather than racing it. */
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  /* The picker SEEDS a default section once the library lands (the Scenario
     select it replaced was never empty either). These tests exercise the
     ARRANGEMENT mechanics, so they start from a known-empty list; the seeding
     itself is asserted in its own test below. */
  await page.evaluate(() => {
    splashSectionPick.length = 0;
    renderSectionPick();
  });
}

const ids = (page) =>
  page.locator("#splash-section-list .splash-section-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-section-id")));

async function add(page, id) {
  await page.selectOption("#splash-section-add", id);
  await page.locator("#splash-section-add-btn").click();
}

test.describe("S3b — the section picker", () => {
  test("the library is offered as sections, labelled by type", async ({ page }) => {
    await openCreate(page);
    const opts = await page.locator("#splash-section-add option")
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    expect(opts.length).toBeGreaterThanOrEqual(7);   // 3 PBL + 3 roleplay + branched
    expect(opts.some((o) => o.startsWith("PBL — "))).toBe(true);
    expect(opts.some((o) => o.startsWith("Roleplay — "))).toBe(true);
    expect(opts.some((o) => o.startsWith("Branched — "))).toBe(true);
    // The retired "Module A/B" wording must not resurface here.
    expect(opts.join(" ")).not.toMatch(/Module [AB]/);
  });

  test("the empty state tells the facilitator what to do", async ({ page }) => {
    await openCreate(page);
    await expect(page.locator("#splash-section-empty")).toBeVisible();
    await add(page, "chronic-pain-pbl");
    await expect(page.locator("#splash-section-empty")).toBeHidden();
  });

  test("sections from DIFFERENT cases can be combined", async ({ page }) => {
    await openCreate(page);
    await add(page, "jaundice-pbl");
    await add(page, "sore-throat-roleplay");
    expect(await ids(page)).toEqual(["jaundice-pbl", "sore-throat-roleplay"]);
    // Numbered by position, exactly as the student's stage label will read.
    await expect(page.locator(".splash-section-row").first())
      .toContainText("Section 1 — ");
    await expect(page.locator(".splash-section-row").nth(1))
      .toContainText("Section 2 — ");
  });

  test("TWO SECTIONS OF THE SAME TYPE — what the module tick-row could not express",
    async ({ page }) => {
      await openCreate(page);
      await add(page, "chronic-pain-pbl");
      await add(page, "jaundice-pbl");
      expect(await ids(page)).toEqual(["chronic-pain-pbl", "jaundice-pbl"]);
    });

  test("pick order is running order, and can be changed", async ({ page }) => {
    await openCreate(page);
    await add(page, "chronic-pain-pbl");
    await add(page, "sore-throat-roleplay");
    await page.locator(".splash-section-row").nth(1)
      .locator(".splash-section-up").click();
    expect(await ids(page)).toEqual(["sore-throat-roleplay", "chronic-pain-pbl"]);
    // …and the numbering follows the new order.
    await expect(page.locator(".splash-section-row").first())
      .toContainText("Section 1 — ");
  });

  test("the ends of the list cannot be moved off it", async ({ page }) => {
    await openCreate(page);
    await add(page, "chronic-pain-pbl");
    await add(page, "jaundice-pbl");
    const rows = page.locator(".splash-section-row");
    await expect(rows.first().locator(".splash-section-up")).toBeDisabled();
    await expect(rows.nth(1).locator(".splash-section-down")).toBeDisabled();
  });

  test("a section can be removed", async ({ page }) => {
    await openCreate(page);
    await add(page, "chronic-pain-pbl");
    await add(page, "jaundice-pbl");
    await page.locator(".splash-section-row").first()
      .locator(".splash-section-remove").click();
    expect(await ids(page)).toEqual(["jaundice-pbl"]);
  });

  test("the pick becomes the CSV the session stores", async ({ page }) => {
    await openCreate(page);
    await add(page, "sore-throat-roleplay");
    await add(page, "jaundice-pbl");
    /* sectionPickCsv() is a top-level function declaration, so it is reachable
       as a bare global in the page. */
    expect(await page.evaluate(() => sectionPickCsv()))
      .toBe("sore-throat-roleplay,jaundice-pbl");
  });

  test("the superseded 'Modules to run' tick-row is gone from the form", async ({ page }) => {
    await openCreate(page);
    await expect(page.locator("#splash-create-mod-A")).toHaveCount(0);
    await expect(page.locator("#splash-create-mod-B")).toHaveCount(0);
  });
});

test.describe("S7 — the picker seeds a default", () => {
  test("a facilitator who touches nothing still gets a runnable session", async ({ page }) => {
    /* The Scenario select this replaced ALWAYS had a selection — the first
       built-in. Shipping an empty picker would have been an accidental
       behaviour change: a facilitator who fills in only a name and a password,
       exactly as before, would hit a blocking "add at least one section" error
       where the old form simply worked. */
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => {
      const s = document.getElementById("splash-section-add");
      return !!(s && s.options.length > 0);
    });
    const picked = await page.locator("#splash-section-list .splash-section-row").count();
    expect(picked, "the picker must seed one section").toBe(1);
    expect(await page.evaluate(() => sectionPickCsv())).toBeTruthy();
  });

  test("removing the last section is RESPECTED, not instantly re-seeded", async ({ page }) => {
    /* Seeding is tracked by a flag, not by "is the pick empty" — otherwise
       clearing the list would fight the facilitator, re-adding a section on
       every render. Emptying it must stick, and the empty-state must show. */
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => {
      const s = document.getElementById("splash-section-add");
      return !!(s && s.options.length > 0);
    });
    await page.locator(".splash-section-row").first()
      .locator(".splash-section-remove").click();
    await expect(page.locator("#splash-section-list .splash-section-row")).toHaveCount(0);
    await expect(page.locator("#splash-section-empty")).toBeVisible();
    // …and it stays empty across a re-render.
    await page.evaluate(() => populateSectionPicker());
    await expect(page.locator("#splash-section-list .splash-section-row")).toHaveCount(0);
  });
});
