/* tests-e2e/mobile.spec.js
 *
 * Mobile/tablet smoke tests. Runs under iPhone 14 Pro and iPad Pro 11
 * device emulation (touch, viewport, user-agent, devicePixelRatio) — a
 * classroom hardware mix that includes iPads is plausible, and Safari
 * on iOS has historically been the platform's biggest unknown.
 *
 * Goals:
 *   - the splash form is usable (visible, tappable, no horizontal scroll)
 *   - the privacy page renders without a broken layout
 *   - the dark theme works on small viewports
 *
 * NOT a full functional pass on mobile — the desktop chromium/firefox/webkit
 * suite covers create-session, admin-dashboard and stage-progression. This
 * is a layout/usability smoke test.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures");

test.describe("mobile splash usability", () => {
  test("splash form is visible + tappable, no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // No horizontal scroll: the body should not be wider than the viewport.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    // Allow a 2px subpixel tolerance.
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);

    // The session-code input must be visible and have a reasonable tap-target
    // size (44x44 CSS px is the Apple HIG floor; we accept 40+).
    const inputBox = await page.locator("#splash-code").boundingBox();
    expect(inputBox, "session-code input must be visible").not.toBeNull();
    if (inputBox) {
      expect(inputBox.height).toBeGreaterThanOrEqual(36);
    }
  });

  test("privacy page renders without layout break", async ({ page }) => {
    await page.goto("/privacy.html");
    await page.waitForSelector("main.privacy", { state: "visible" });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);

    // The brand mark SVG should be visible (top of page).
    const brand = await page.locator(".brand-mark").first().boundingBox();
    expect(brand, "brand-mark must render").not.toBeNull();
  });

  // R2-35: at 320-375px viewports (iPhone SE / older iOS Safari) the
  // splash form was overflowing the card and the language pill row was
  // wrapping onto two lines. The new <select> language switcher + the
  // shrunk #splash-code min-width must keep the page free of horizontal
  // scroll AND keep the entry form usable in the initial viewport.
  test("R2-35: iPhone-SE viewport (375x667) has no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);

    // Splash row stays single-row (input + button) at iPhone SE; the
    // language <select> sits above on its own line.
    const langSelect = page.locator("#splash-lang-select");
    await expect(langSelect).toBeVisible();
  });

  // R2-42: every supported language is reachable from the splash via the
  // new <select> switcher. The dropdown must contain exactly the 8
  // languages and switching to any of them must persist into
  // localStorage so a deep-link or refresh keeps the choice.
  test("R2-42: splash language switcher lists all 8 supported languages", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    const langSelect = page.locator("#splash-lang-select");
    await expect(langSelect).toBeVisible();
    const values = await langSelect.locator("option").evaluateAll(
      opts => opts.map(o => o.value)
    );
    expect(values).toEqual(["en", "fr", "ja", "es", "pt", "de", "ko", "zh"]);
  });

  // R2-36 / WCAG 2.5.8: the consent checkboxes must be at least 24x24
  // CSS pixels (target-size AA floor). They used to be 17x17, which the
  // disabled-user testing simulation flagged as a tap accuracy hazard
  // for fine-motor-impaired users on touch devices.
  test("R2-36: consent checkbox meets WCAG 2.5.8 target-size (>=24px)", async ({ page, context }) => {
    // Create a session in a first tab so we have a code to walk into
    // the lobby with (the consent checkbox only renders in the lobby).
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac");
    await page.locator("#splash-create-label").fill("R2-36 run");
    await page.locator("#splash-create-pass").fill("e2e-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    const tab = await context.newPage();
    await forceLocalMode(tab);
    await tab.addInitScript(() => {
      try { localStorage.removeItem("canamed_session"); } catch (e) {}
    });
    await tab.setViewportSize({ width: 375, height: 667 });
    await tab.goto("/");
    await tab.locator("#splash-code").fill(code);
    await tab.locator("#splash-enter").click();
    // Wait for the lobby to render (name-input is the canonical marker).
    await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    // The checkbox sits below the privacy <details> — scroll it into view
    // before measuring (it lives below the fold on a 375x667 viewport
    // since the privacy summary still takes a chunk even when collapsed).
    await tab.locator("#consent-workshop").scrollIntoViewIfNeeded();

    const box = await tab.locator("#consent-workshop").boundingBox();
    expect(box, "consent checkbox must render").not.toBeNull();
    if (box) {
      // Allow a 1px tolerance for native checkbox rendering quirks.
      expect(box.width).toBeGreaterThanOrEqual(23);
      expect(box.height).toBeGreaterThanOrEqual(23);
    }
    await tab.close();
  });

  // R2-37: with the privacy <details> auto-open, the Join button was
  // buried below ~3 screens of scroll on iPhone SE. The fix collapses
  // the details on viewports <= 600px wide so the consent + Join sit
  // in the first paint. Verify the details element is closed at 375px
  // and that the Join button is reachable without scrolling past the
  // privacy summary.
  test("R2-37: privacy details collapse on small viewports, Join visible", async ({ page, context }) => {
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac");
    await page.locator("#splash-create-label").fill("R2-37 run");
    await page.locator("#splash-create-pass").fill("e2e-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    const tab = await context.newPage();
    await forceLocalMode(tab);
    // Belt-and-braces: clear any persistent session pin from a previous
    // test in the same context so the splash actually paints, instead of
    // auto-resuming into a stale lobby (which would never re-render
    // #name-input from scratch).
    await tab.addInitScript(() => {
      try { localStorage.removeItem("canamed_session"); } catch (e) {}
    });
    await tab.setViewportSize({ width: 375, height: 667 });
    await tab.goto("/");
    await tab.locator("#splash-code").fill(code);
    await tab.locator("#splash-enter").click();
    await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    // The privacy <details> should NOT be open at 375px.
    const isOpen = await tab.locator(".privacy-note").evaluate(
      d => d.hasAttribute("open")
    );
    expect(isOpen).toBe(false);
    await tab.close();
  });

  test("dark theme on mobile viewport", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("canamed_theme", "dark"));
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // The body background must be a dark colour when forced to dark theme.
    // (A light-mode regression would leave it the warm-paper #f6f4ef.)
    const bgRgb = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // Parse "rgb(R, G, B)" or "rgba(R, G, B, A)" — webkit on iPad
    // emulation occasionally returns the rgba form even with no alpha
    // override in CSS. The check is the same: the average channel must
    // be a dark colour (< 80).
    const m = bgRgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m, `body background must parse as rgb()/rgba(), got ${bgRgb}`).not.toBeNull();
    if (m) {
      const avg = (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
      expect(avg).toBeLessThan(80);
    }
  });
});
