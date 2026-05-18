/* tests-e2e/splash-lang-switcher.spec.js
 *
 * R2-42 + R2-47 regression. The splash language switcher used to expose
 * only 3 of the 8 supported UI languages (en/fr/ja), which Maria's
 * Spanish-first simulation flagged as a blocker. The privacy.html page
 * has full standalone translations only for en/fr/ja; for the other
 * 5 languages it surfaces a localised banner pointing to the closest
 * available reviewed text. These tests pin both behaviours so a future
 * contributor who, say, hardcodes a 3-button switcher again will go red.
 *
 * Selector strategy: stable IDs (#splash-lang-select) + lang-specific
 * substrings from the i18n table. Substring matches are intentionally
 * short to survive minor copy edits in a single language without
 * cascading to a failed assertion.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const ALL_LANGS = ["en", "fr", "ja", "es", "pt", "de", "ko", "zh"];

test.describe("Splash language switcher — R2-42", () => {
  test("dropdown lists exactly the 8 supported languages, in canonical order", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#splash-lang-select", { state: "visible" });
    const values = await page.locator("#splash-lang-select option").evaluateAll(
      opts => opts.map(o => o.value)
    );
    expect(values).toEqual(ALL_LANGS);
  });

  test("selecting each language re-renders the splash in that language + persists to localStorage", async ({ page }) => {
    const expectedSubstring = {
      en: /Enter\s*→/i,
      fr: /Entrer\s*→/i,
      ja: /入室/,
      es: /Entrar\s*→/i,
      pt: /Entrar\s*→/i,
      de: /Beitreten/,
      ko: /입장/,
      zh: /进入/
    };

    await page.goto("/");
    await page.waitForSelector("#splash-lang-select", { state: "visible" });

    for (const lang of ALL_LANGS) {
      // Drive the switcher via setLang() — equivalent to a user picking
      // the dropdown option, but deterministic across browsers (some
      // engines suppress the change event when selectOption picks the
      // already-selected value, which would mask a real regression).
      await page.evaluate((l) => window.setLang(l), lang);
      await expect(page.locator("#splash-enter")).toContainText(
        expectedSubstring[lang],
        { timeout: 5_000 }
      );
      const stored = await page.evaluate(() => localStorage.getItem("canamed_lang"));
      expect(stored).toBe(lang);
      // And the <select> stays in sync with the active language.
      const selVal = await page.locator("#splash-lang-select").inputValue();
      expect(selVal).toBe(lang);
    }
  });

  test("a pre-set localStorage language paints the splash in that language on first load", async ({ page }) => {
    // Pre-set Spanish via init script BEFORE the page's i18n.js runs.
    await page.addInitScript(() => {
      try { localStorage.setItem("canamed_lang", "es"); } catch (e) {}
    });
    await page.goto("/");
    await page.waitForSelector("#splash-lang-select", { state: "visible" });
    // The Enter button should already be in Spanish on first paint.
    await expect(page.locator("#splash-enter")).toContainText(/Entrar/i);
    // And the dropdown should reflect the persisted choice.
    const sel = await page.locator("#splash-lang-select").inputValue();
    expect(sel).toBe("es");
  });
});

test.describe("Privacy page i18n fallback — R2-47", () => {
  // Each language gets a fresh browser page so the inline initialiser
  // in privacy.html reads the freshly-set localStorage value on first
  // paint — re-using one page would mean the inline script only ran
  // once (during the very first goto) and the toggle would be stale.
  test("en/fr/ja: no fallback banner shown (static full translation exists)", async ({ context }) => {
    for (const lang of ["en", "fr", "ja"]) {
      const tab = await context.newPage();
      await tab.addInitScript((targetLang) => {
        try { localStorage.setItem("canamed_lang", targetLang); } catch (e) {}
      }, lang);
      await tab.goto("/privacy.html");
      await tab.waitForSelector("main.privacy", { state: "visible" });
      const banner = tab.locator("#privacy-lang-banner");
      await expect(banner).toBeHidden();
      await tab.close();
    }
  });

  test("es/pt/de/ko/zh: localised fallback banner is visible on privacy.html", async ({ context }) => {
    for (const lang of ["es", "pt", "de", "ko", "zh"]) {
      const tab = await context.newPage();
      await tab.addInitScript((targetLang) => {
        try { localStorage.setItem("canamed_lang", targetLang); } catch (e) {}
      }, lang);
      await tab.goto("/privacy.html");
      await tab.waitForSelector("main.privacy", { state: "visible" });
      const banner = tab.locator("#privacy-lang-banner");
      await expect(banner).toBeVisible({ timeout: 5_000 });
      const html = await banner.innerHTML();
      expect(html.length).toBeGreaterThan(20);
      expect(html).toMatch(/privacy-fr\.html|privacy-ja\.html/);
      await tab.close();
    }
  });
});

test.describe("Privacy page — R2-48 (no [contact email] placeholder)", () => {
  test("privacy.html no longer contains placeholder mailbox literals in §9 / §16", async ({ page }) => {
    await page.goto("/privacy.html");
    await page.waitForSelector("main.privacy", { state: "visible" });
    const body = await page.locator("main.privacy").textContent();
    // The simulation flagged the literal "[canamed-ethics@unicaen.fr —
    // confirm stable mailbox]" and "[contact email — see privacy
    // policy]" — neither should still appear in production.
    expect(body).not.toMatch(/\[canamed-ethics@unicaen\.fr.*confirm/i);
    expect(body).not.toMatch(/\[contact email/i);
    // The real mailto link is now in place.
    const mailto = await page.locator('a[href="mailto:canamed-ethics@unicaen.fr"]').count();
    expect(mailto).toBeGreaterThan(0);
  });
});
