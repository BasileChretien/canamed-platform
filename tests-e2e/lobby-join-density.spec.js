/* tests-e2e/lobby-join-density.spec.js
 *
 * UX-overload fix (2026-06-01): the join screen was the densest in the
 * journey — a default-OPEN 6-paragraph GDPR/APPI privacy wall plus a ~90-word
 * certificate-verification paragraph sat on the critical path before the Join
 * button. The fix collapses those legal walls WITHOUT hiding the consent
 * control (lazy-locale-consent + good consent practice require the consent
 * checkbox to render on first paint).
 *
 * This spec runs on desktop (chromium/firefox/webkit) and — via the
 * testMatch entries in playwright.config.js — on mobile-iphone / mobile-ipad /
 * mobile-android, the device classes the workshop actually runs on.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function createSession(page) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Lead Fac");
  await page.locator("#splash-create-pass").fill("e2e-join-density");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  return (await codeNode.textContent()).trim();
}

async function openParticipantLobby(context, code) {
  const tab = await context.newPage();
  await tab.addInitScript(() => {
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
    } catch (e) {}
    function pin(n, v) {
      Object.defineProperty(window, n, { get: () => v, set: () => {}, configurable: true, enumerable: true });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
  });
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  return tab;
}

test.describe("Lobby join density — collapsed legal walls, consent still first-paint", () => {
  test("privacy wall is collapsed by default; consent still renders on first paint", async ({ page, context }) => {
    const code = await createSession(page);
    const tab = await openParticipantLobby(context, code);

    // The consent control + version line must be visible on first paint — the
    // contract lazy-locale-consent protects. We collapse the legal walls, NOT
    // the consent control.
    await expect(tab.locator("#consent-workshop")).toBeVisible();
    await expect(tab.locator("#consent-version")).toBeVisible();

    // The 6-paragraph privacy notice is collapsed: summary visible, body hidden.
    await expect(tab.locator(".privacy-note summary")).toBeVisible();
    await expect(tab.locator(".privacy-note p").first()).toBeHidden();

    // The verification note is no longer on the critical path: it lives INSIDE
    // the (collapsed) privacy disclosure.
    await expect(
      tab.locator('.privacy-note p[data-i18n="lobby.consent-verification"]')
    ).toHaveCount(1);
    await expect(
      tab.locator('.privacy-note p[data-i18n="lobby.consent-verification"]')
    ).toBeHidden();

    // Opening the disclosure reveals the paragraphs AND the verification note.
    await tab.locator(".privacy-note summary").click();
    await expect(tab.locator(".privacy-note p").first()).toBeVisible();
    await expect(
      tab.locator('.privacy-note p[data-i18n="lobby.consent-verification"]')
    ).toBeVisible();

    await tab.close();
  });

  test("a participant can still complete the join after the density fix", async ({ page, context }) => {
    const code = await createSession(page);
    const tab = await openParticipantLobby(context, code);

    await tab.locator("#name-input").fill("E2E Density Student");
    const uni = await tab
      .locator("#uni-input option:not([disabled])")
      .first()
      .getAttribute("value");
    await tab.locator("#uni-input").selectOption(uni);
    await tab.locator("#consent-workshop").check();
    await expect(tab.locator("#join-btn")).toBeEnabled();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 15_000 });

    await tab.close();
  });
});
