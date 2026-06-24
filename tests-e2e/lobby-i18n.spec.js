/* tests-e2e/lobby-i18n.spec.js
 *
 * Regression tests for the lobby + waiting-room i18n wiring fixed in
 * fix/participant-i18n-core. The simulation in
 * docs/Third_session/PBL_platform/ARCHITECTURE/SIMULATION_PARTICIPANTS.md
 * flagged the lobby privacy-note and the waiting-room HTML as English-
 * only despite the surrounding consent text being localised. This test
 * pins down the FR + JA renderings so any future regression (a missing
 * data-i18n attribute, a deleted key) shows up red.
 *
 * Strategy: stub localStorage.canamed_lang BEFORE the i18n module's
 * auto-detect runs, so the page paints in the requested language on
 * first load (no flash of English).
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

test.describe("Lobby i18n — privacy notice + consent block", () => {
  test("French lobby renders the privacy paragraphs in French (not English)", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "fr");

    // The privacy <details> summary
    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/Utilisation de vos données/i);

    // P1 — controllers paragraph
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/Caen Normandie/i);
    // The French rendition mentions "responsables conjoints" (joint
    // controllers under GDPR Art. 26). If we still see the English
    // "joint controllers" phrase, the data-i18n-html wiring is broken.
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/responsables conjoints/i);

    // P3 — Belgium / EU transfer note in FR
    await expect(tab.locator(".privacy-note"))
      .toContainText(/transfert transfrontalier/i);

    // Consent-version line is now translated
    await expect(tab.locator("#consent-version"))
      .toContainText(/Version de la notice/i);

    // The grade-note has been promoted into the lobby and is in French
    await expect(tab.locator(".lobby-grade-note"))
      .toContainText(/note universitaire/i);

    // Phase 3 (English-canonical UI): the consent + privacy copy above stays
    // French, but the waiting-room is informational chrome and now renders in
    // English for everyone.
    await tab.locator("#name-input").fill("Camille");
    const realUni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab.locator("#uni-input").selectOption(realUni);
    await tab.locator("#consent-workshop").check();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
    await expect(tab.locator("#waiting h2")).toContainText(/joined/i);

    await tab.close();
  });

  test("Japanese lobby renders the privacy paragraphs in Japanese (not English)", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "ja");

    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/データの利用方法/);
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/名古屋大学/);
    // Anchor on the controller-pair string — if EN leaked through we'd
    // see "joint controllers under GDPR" instead.
    await expect(tab.locator(".privacy-note"))
      .toContainText(/共同管理者/);
    // P3 — Belgium/EU storage note in JA
    await expect(tab.locator(".privacy-note"))
      .toContainText(/越境移転/);

    // Consent-version line is translated
    await expect(tab.locator("#consent-version"))
      .toContainText(/説明文書のバージョン/);

    // Grade-note in JA above the consent block
    await expect(tab.locator(".lobby-grade-note"))
      .toContainText(/成績/);

    // Phase 3 (English-canonical UI): consent + privacy stays Japanese above;
    // the waiting-room is informational chrome and now renders in English.
    await tab.locator("#name-input").fill("ユキ");
    const realUni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab.locator("#uni-input").selectOption(realUni);
    await tab.locator("#consent-workshop").check();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
    await expect(tab.locator("#waiting h2")).toContainText(/joined/i);

    await tab.close();
  });

  test("Join button lock-tooltip is translated and clears once consent ticked", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "fr");
    const joinBtn = tab.locator("#join-btn");
    // Disabled at first, with a French tooltip
    await expect(joinBtn).toBeDisabled();
    await expect(joinBtn).toHaveAttribute(
      "title",
      /Cochez la case de consentement/i
    );
    // Ticking consent clears the tooltip and enables the button.
    await tab.locator("#consent-workshop").check();
    await expect(joinBtn).toBeEnabled();
    await expect(joinBtn).not.toHaveAttribute("title", /.+/);
    await tab.close();
  });

  // R2-43: the lobby.privacy.* and lobby.consent-version* keys used to
  // exist only for en/fr/ja. Spanish / Portuguese / German / Korean /
  // Chinese participants saw English privacy paragraphs in an otherwise
  // translated lobby. This test walks the lobby in Spanish + Chinese
  // and asserts the privacy notice has actually been localised.
  test("R2-43: Spanish lobby renders privacy notice + consent-version in Spanish", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "es");
    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/Cómo se utilizan|Cómo se usan|Como se utilizan/i);
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/Nagoya|investigación CaNaMED/i);
    // Consent-version line is now translated.
    await expect(tab.locator("#consent-version"))
      .toContainText(/Versión del aviso/i);
    await tab.close();
  });

  test("R2-43: Chinese lobby renders privacy notice + consent-version in Chinese", async ({ page, context }) => {
    const { tab } = await openLobbyInLanguage(page, context, "zh");
    await expect(tab.locator(".privacy-note summary"))
      .toContainText(/数据|您的数据/);
    await expect(tab.locator(".privacy-note p").first())
      .toContainText(/名古屋大学|CaNaMED 研究团队/);
    await expect(tab.locator("#consent-version"))
      .toContainText(/告知版本/);
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
