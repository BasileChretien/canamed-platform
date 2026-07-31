/* tests-e2e/splash-overflow.spec.js
 *
 * The splash must never be wider than the viewport.
 *
 * Horizontal overflow on a phone is not a cosmetic scroll — mobile browsers
 * zoom the page out to fit the document width, and once they do, synthetic
 * pointer events (and real taps near a control's edge) land a few pixels off.
 * That is exactly how the admin Start button became untappable in PR #172, and
 * it is how the section picker's reorder controls became untappable here.
 *
 * The bug this guards: `#splash` stacks to a single column under 900px with
 * `grid-template-columns: 1fr`. A bare `1fr` is `minmax(auto, 1fr)`, so the
 * track's FLOOR is the widest grid item's min-content — and the card holds
 * <select>s whose min-content is their longest <option> label. The scenario
 * picker alone floored the page at 419px; the section picker's "add" list
 * ("Roleplay — The antibiotic-request conversation across cultures") pushed it
 * to 528px against a 412px Pixel 7. Fix: `minmax(0, 1fr)`.
 *
 * Registered into the mobile projects per the standing per-device rule; the
 * desktop projects run it too, at explicit narrow viewports.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/** Widths that matter: iPhone SE, small Android, iPhone 14 Pro, Pixel 7. */
const NARROW = [320, 360, 390, 412];

const overflow = (page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });

/** Fails with the widest offending element named, not just a number. */
async function expectNoOverflow(page, where) {
  const { scrollWidth, clientWidth } = await overflow(page);
  if (scrollWidth > clientWidth + 1) {
    const worst = await page.evaluate(() =>
      [...document.querySelectorAll("#splash *")]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => ({
          tag: e.tagName,
          cls: String(e.className || "").slice(0, 40),
          id: e.id,
          right: Math.round(e.getBoundingClientRect().right)
        }))
        .sort((a, b) => b.right - a.right)
        .slice(0, 5));
    throw new Error(
      `${where}: document is ${scrollWidth}px wide in a ${clientWidth}px viewport. ` +
      `Widest: ${JSON.stringify(worst)}`);
  }
  expect(scrollWidth, `${where}: no horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

async function openCreate(page) {
  await page.locator("#splash-go-create").click();
  // The section library is a lazy chunk; its long option labels ARE the thing
  // under test, so wait for them rather than asserting against an empty list.
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  /* The picker SEEDS one default section once the library lands. Clear it, so
     "+ 3 sections" below means exactly three rows — otherwise the count assert
     trips on four and the OVERFLOW check, which is the point of this spec,
     never runs at all. */
  await page.evaluate(() => { splashSectionPick.length = 0; renderSectionPick(); });
}

test.describe("Splash fits the viewport", () => {
  for (const width of NARROW) {
    test(`no horizontal overflow at ${width}px — entry, create, create+sections`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expectNoOverflow(page, `entry view @${width}`);

      await openCreate(page);
      await expectNoOverflow(page, `create view @${width}`);

      // A populated picker is the worst case: each row carries a long section
      // title, a type chip and three controls.
      for (const id of ["chronic-pain-pbl", "sore-throat-roleplay", "jaundice-pbl"]) {
        await page.selectOption("#splash-section-add", id);
        await page.locator("#splash-section-add-btn").click();
      }
      await expect(page.locator(".splash-section-row")).toHaveCount(3);
      await expectNoOverflow(page, `create view + 3 sections @${width}`);
    });
  }

  test("the stacked splash grid track cannot exceed the viewport", async ({ page }) => {
    // Guards the root cause directly: if someone reverts `minmax(0, 1fr)` to a
    // bare `1fr`, the single track grows to the card's min-content and this
    // fails even before anything visibly overflows.
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/");
    await openCreate(page);
    const { track, avail } = await page.evaluate(() => {
      const splash = /** @type {HTMLElement} */ (document.getElementById("splash"));
      return {
        track: parseFloat(getComputedStyle(splash).gridTemplateColumns),
        avail: splash.clientWidth
      };
    });
    expect(track).toBeLessThanOrEqual(avail + 1);
  });

  test("no horizontal overflow at the device's own viewport", async ({ page }) => {
    // Mobile projects supply the real device metrics (Pixel 7 / iPhone 14 Pro /
    // iPad Pro 11); desktop projects exercise the wide two-column layout.
    await page.goto("/");
    await expectNoOverflow(page, "entry view @device");
    await openCreate(page);
    await expectNoOverflow(page, "create view @device");
  });
});
