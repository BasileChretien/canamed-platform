/* tests-e2e/splash-editorial-split.spec.js
 *
 * The editorial split front page (2026-07): an institutional masthead strip
 * across the top, the deep-navy statement panel (.splash-about) on the left,
 * the join panel (.splash-card) on the right. On viewports ≤900px the layout
 * stacks with the JOIN panel first — students arrive holding a session code,
 * so code entry must precede the mission statement.
 *
 * Runs on every device project (desktop + mobile-iphone/ipad/android):
 * assertions branch on the actual viewport width, mirroring the CSS
 * breakpoint. LOCAL mode, hermetic.
 */
const { test, expect } = require("./fixtures.js");

const BREAKPOINT = 900; // keep in sync with the #splash @media in style.css

test.describe("Splash — editorial split layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#splash")).toBeVisible();
  });

  test("masthead strip names the partnership above the fold", async ({ page }) => {
    const masthead = page.locator(".splash-masthead");
    await expect(masthead).toBeVisible();
    await expect(masthead).toContainText(/Caen Normandie/);
    await expect(masthead).toContainText(/Nagoya University/);
    const box = await masthead.boundingBox();
    expect(box.y).toBeLessThan(120); // strip sits at the very top
  });

  test("panels compose side-by-side on wide viewports, join-first when stacked", async ({ page }) => {
    const vw = page.viewportSize().width;
    const about = await page.locator(".splash-about").boundingBox();
    const card = await page.locator(".splash-card").boundingBox();
    if (vw > BREAKPOINT) {
      // statement panel left of the join panel, same row
      expect(about.x + about.width).toBeLessThanOrEqual(card.x + 1);
      expect(Math.abs(about.y - card.y)).toBeLessThan(8);
    } else {
      // stacked: join panel ABOVE the statement panel
      expect(card.y + card.height).toBeLessThanOrEqual(about.y + 1);
    }
  });

  test("the session-code input is reachable and usable in the new layout", async ({ page }) => {
    const code = page.locator("#splash-code");
    await code.scrollIntoViewIfNeeded();
    await expect(code).toBeVisible();
    await code.fill("ABC-123");
    await expect(code).toHaveValue("ABC-123");
    // no horizontal overflow introduced by the grid (the mobile zoom/hit-test
    // failure class from PR #172)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("statement panel keeps the masthead ink on its navy field", async ({ page }) => {
    const mission = page.locator(".splash-mission");
    await mission.scrollIntoViewIfNeeded();
    await expect(mission).toBeVisible();
    const styles = await mission.evaluate((el) => {
      const c = getComputedStyle(el);
      return { color: c.color, family: c.fontFamily };
    });
    expect(styles.family).toMatch(/Source Serif 4/);
    expect(styles.color).toBe("rgb(255, 255, 255)"); // --masthead-ink, theme-constant
  });
});
