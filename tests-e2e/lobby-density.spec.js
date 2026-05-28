/* tests-e2e/lobby-density.spec.js
 *
 * Sim 2026-05-18 surfaced lobby density: after a facilitator clicked
 * "I am a facilitator", the lobby exposed BOTH "Forgot the password?"
 * AND "Super admin: set / change the password" buttons. They opened
 * the SAME super-admin panel from two different framings — pure
 * redundancy added when the recovery link was bolted on top of the
 * existing setup toggle. This suite locks in the collapsed UI:
 *
 *   - One single recovery affordance, labelled "Need to set or
 *     recover the admin password?".
 *   - The legacy super-admin toggle stays in the DOM but is hidden +
 *     aria-hidden so a returning facilitator does NOT see two
 *     buttons doing the same thing.
 *   - Clicking the single link still opens the super-admin panel.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openLobby(page, code) {
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 10_000 });
}

async function createSession(page) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Lead Fac");
  await page.locator("#splash-create-pass").fill("e2e-lobby-density");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  return (await codeNode.textContent()).trim();
}

test.describe("Lobby density — admin section no longer carries duplicate controls", () => {
  test("only ONE password-recovery affordance is visible in the lobby", async ({ page, context }) => {
    const code = await createSession(page);

    const tab2 = await context.newPage();
    await tab2.addInitScript(() => {
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
        localStorage.removeItem("canamed_name");
      } catch (e) {}
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value, set: () => {}, configurable: true, enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await openLobby(tab2, code);
    await tab2.locator("#admin-toggle").click();

    // The single recovery link must be visible …
    await expect(tab2.locator("#forgot-pass-link")).toBeVisible();
    // … and the legacy duplicate must be hidden (still in the DOM for
    // back-compat with any code that wires it, but invisible).
    await expect(tab2.locator("#superadmin-toggle")).toBeHidden();

    // Sanity: the recovery link still opens the super-admin panel.
    await expect(tab2.locator("#superadmin-panel")).toBeHidden();
    await tab2.locator("#forgot-pass-link").click();
    await expect(tab2.locator("#superadmin-panel")).toBeVisible();
    await expect(tab2.locator("#superadmin-key-input")).toBeVisible();
    await tab2.close();
  });

  test("post-expand button count stays at a sane budget (≤ 7 buttons in the lobby)", async ({ page, context }) => {
    const code = await createSession(page);
    const tab2 = await context.newPage();
    await tab2.addInitScript(() => {
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
        localStorage.removeItem("canamed_name");
      } catch (e) {}
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value, set: () => {}, configurable: true, enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await openLobby(tab2, code);
    await tab2.locator("#admin-toggle").click();

    // Count visible buttons strictly inside the #lobby container — the
    // global header (Settings, mute) is intentionally excluded.
    const count = await tab2.evaluate(() => {
      const lobby = document.getElementById("lobby");
      if (!lobby) return 0;
      return Array.from(lobby.querySelectorAll("button"))
        .filter(b => !b.hidden && b.offsetParent !== null)
        .length;
    });
    // Before the fix this was 8 (with a stale super-admin toggle).
    // The current contract is "no more than 7" — leaves room for the
    // legitimate set of: Save name, Join the waiting room, I am a
    // facilitator, Open admin dashboard, Forgot the password,
    // (optional) leaves room for inline help toggles. Going over 7
    // means a new control was added without a UX review.
    expect(count, "lobby exposes too many buttons after admin-expand").toBeLessThanOrEqual(7);
    await tab2.close();
  });
});
