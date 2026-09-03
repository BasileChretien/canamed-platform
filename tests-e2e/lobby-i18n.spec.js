/* tests-e2e/lobby-i18n.spec.js
 *
 * The lobby language contract, REWRITTEN 2026-09-03 for Annex VI L7.
 *
 * It used to pin an English-only lobby, consent included — the 2026-06-25
 * instruction ("delete all the French and Japanese inside the website; keep
 * only the dictionaries") applied to every string. That instruction still holds
 * for CONTENT, and this file still proves it: the workshop chrome around the
 * consent block stays English whatever the picker says.
 *
 * But a consent form is not content. GDPR Art. 12(1) and APPI Art. 21 require
 * information in an intelligible form, and consent that is not informed is not
 * consent — which would undercut the Art. 6(1)(a) basis the live notice relies
 * on. So the consent surface (the privacy summary, the consent rows, the notice
 * version, the data-rights controls) localizes again, and NOTHING ELSE does.
 *
 * Both halves are asserted in every test here. Checking only that French
 * appears would pass just as well on a fully re-translated UI, which is exactly
 * what the 2026-06-25 decision rules out.
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

test.describe("Lobby i18n — the consent surface localizes, the workshop UI does not", () => {
  test("French selected: consent is French, the surrounding UI is English, join works", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "fr");

    // THE CONSENT SURFACE IS FRENCH — this is the L7 fix.
    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/Utilisation de vos données/i);
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/responsables conjoints/i);
    await expect(tab.locator("#consent-version"))
      .toContainText(/Version de la notice/i);

    /* …AND THE WORKSHOP UI IS NOT. The grade-note sits inside the lobby, right
       beside the consent block, and is deliberately outside the localized
       prefixes — so it is the sharpest available check that the exception did
       not widen into a general re-translation. */
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

  test("Japanese selected: consent is Japanese, the surrounding UI is English, join works", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "ja");

    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/データの利用方法/);
    await expect(tab.locator("#consent-version"))
      .toContainText(/説明文書のバージョン/);
    // The workshop chrome beside it stays English.
    await expect(tab.locator(".lobby-grade-note"))
      .toContainText(/not affected/i);

    await tab.locator("#name-input").fill("Yuki");
    const realUni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab.locator("#uni-input").selectOption(realUni);
    await tab.locator("#consent-workshop").check();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
    await expect(tab.locator("#waiting h2")).toContainText(/joined/i);

    await tab.close();
  });

  test("Join button lock-tooltip follows the consent surface and clears once ticked", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "fr");
    const joinBtn = tab.locator("#join-btn");
    /* The tooltip explains WHY the button is locked — it is part of the consent
       surface, so it localizes with it. A French participant told in English
       why they cannot proceed is the same Art. 12(1) problem one control down. */
    await expect(joinBtn).toBeDisabled();
    await expect(joinBtn).toHaveAttribute("title", /consentement/i);
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
