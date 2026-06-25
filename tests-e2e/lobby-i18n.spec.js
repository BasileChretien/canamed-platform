/* tests-e2e/lobby-i18n.spec.js
 *
 * English-only lobby contract (user 2026-06-25: "delete all the French and
 * Japanese inside the website; keep only the dictionaries"). The whole UI —
 * consent + privacy notice included — renders in English regardless of the
 * language picker. The picker now only re-targets the in-page reading-aid's
 * per-word hover gloss (lang-reader.js), never any UI string. These tests pin
 * that: selecting French or Japanese leaves the lobby English and joinable, and
 * the localized strings that used to appear (e.g. "responsables conjoints",
 * "共同管理者") must NOT leak through. The translation TABLES stay intact for the
 * standalone privacy.html legal page + the i18n parity unit tests.
 *
 * Strategy: stub localStorage.canamed_lang BEFORE the i18n module's
 * auto-detect runs, so the page boots with that language selected.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// Helper: create a session in tab A (English UI), grab its code, then open
// tab B with the requested language pinned and walk to the lobby.
async function openLobbyInLanguage(page, context, lang) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill("E2E i18n run");
  await page.locator("#splash-create-pass").fill("e2e-i18n-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();

  const tab = await context.newPage();
  // Same forceLocalMode pinning so firebase-config.js doesn't reach prod,
  // PLUS pre-set the language so the first paint is already in `lang`.
  await tab.addInitScript((targetLang) => {
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value,
        set: () => {},
        configurable: true,
        enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    try { localStorage.setItem("canamed_lang", targetLang); } catch (e) {}
  }, lang);
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  return { tab, code };
}

test.describe("Lobby i18n — English-only, picker drives the reader not the UI", () => {
  test("French selected: the lobby + consent stay English and still join", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "fr");

    // The privacy <details> summary renders the English canonical…
    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/How your data is used/i);
    // …and the old French renditions must NOT leak through.
    await expect(tab.locator(".privacy-note summary"))
      .not.toContainText(/Utilisation de vos données/i);

    // P1 — controllers paragraph in English ("joint controllers"), not the
    // French "responsables conjoints".
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/joint controllers/i);
    await expect(tab.locator(".privacy-note"))
      .not.toContainText(/responsables conjoints/i);

    // Consent-version line is English now (consent is no longer localized).
    await expect(tab.locator("#consent-version"))
      .toContainText(/Notice version/i);
    await expect(tab.locator("#consent-version"))
      .not.toContainText(/Version de la notice/i);

    // Grade-note stays English (as it always did).
    await expect(tab.locator(".lobby-grade-note"))
      .toContainText(/not affected/i);

    // The whole flow still joins with French selected.
    await tab.locator("#name-input").fill("Camille");
    const realUni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab.locator("#uni-input").selectOption(realUni);
    await tab.locator("#consent-workshop").check();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
    await expect(tab.locator("#waiting h2")).toContainText(/joined/i);

    await tab.close();
  });

  test("Japanese selected: the lobby + consent stay English and still join", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "ja");

    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/How your data is used/i);
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/joint controllers/i);
    // No Japanese must leak into the consent / privacy block.
    await expect(tab.locator(".privacy-note"))
      .not.toContainText(/共同管理者|データの利用方法/);
    await expect(tab.locator("#consent-version"))
      .toContainText(/Notice version/i);
    await expect(tab.locator("#consent-version"))
      .not.toContainText(/説明文書のバージョン/);

    await tab.locator("#name-input").fill("Yuki");
    const realUni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab.locator("#uni-input").selectOption(realUni);
    await tab.locator("#consent-workshop").check();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
    await expect(tab.locator("#waiting h2")).toContainText(/joined/i);

    await tab.close();
  });

  test("Join button lock-tooltip is English and clears once consent ticked", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "fr");
    const joinBtn = tab.locator("#join-btn");
    // Disabled at first, with the English tooltip (not the old French one).
    await expect(joinBtn).toBeDisabled();
    await expect(joinBtn).toHaveAttribute("title", /workshop-consent box/i);
    await expect(joinBtn).not.toHaveAttribute("title", /Cochez la case de consentement/i);
    // Ticking consent clears the tooltip and enables the button.
    await tab.locator("#consent-workshop").check();
    await expect(joinBtn).toBeEnabled();
    await expect(joinBtn).not.toHaveAttribute("title", /.+/);
    await tab.close();
  });

  test("Grade-note appears in the lobby BEFORE the consent block (DOM order)", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "en");
    // The grade-note container has class .lobby-grade-note. Assert it
    // physically precedes the .consent-block in the document so a
    // participant reads the "no effect on your grade" message at the
    // moment of consent decision.
    const positions = await tab.evaluate(() => {
      const g = document.querySelector(".lobby-grade-note");
      const c = document.querySelector(".consent-block");
      if (!g || !c) return null;
      // Node.DOCUMENT_POSITION_FOLLOWING = 4
      return { followingMask: g.compareDocumentPosition(c) & 4 };
    });
    expect(positions).not.toBeNull();
    expect(positions.followingMask).toBe(4); // grade-note precedes consent
    await tab.close();
  });
});
