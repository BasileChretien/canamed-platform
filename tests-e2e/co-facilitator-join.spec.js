/* tests-e2e/co-facilitator-join.spec.js
 *
 * Regression: a co-facilitator who lands on the lobby and clicks
 * "I am a facilitator" + types the admin password + clicks "Open admin
 * dashboard" must actually reach the admin dashboard.
 *
 * Sim 2026-05-18 surfaced the bug: the shared #name-input is required
 * by joinAdmin() but easily missed (admin sub-panel sits below the
 * fold). Without a name, joinAdmin() returned silently — the user
 * stayed on the lobby with no visible explanation.
 *
 * Two paths are now both supported:
 *   1. Type a name first, then expand the admin section → joinAdmin
 *      uses the typed name as-is.
 *   2. Skip the name field entirely → joinAdmin auto-fills it (from
 *      localStorage.canamed_name if available, else "Facilitator") and
 *      surfaces an informational hint so the user knows what happened.
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
  await page.locator("#splash-create-label").fill("co-fac test");
  await page.locator("#splash-create-pass").fill("e2e-co-fac-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  return (await codeNode.textContent()).trim();
}

test.describe("Co-facilitator can join the admin dashboard from the lobby", () => {
  test("happy path: type name → expand admin → type password → reach dashboard", async ({ page, context }) => {
    const code = await createSession(page);

    const tab2 = await context.newPage();
    tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
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
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    await tab2.locator("#name-input").fill("Dr Co-Fac");
    await tab2.locator("#admin-toggle").click();
    await expect(tab2.locator("#admin-pass-input")).toBeVisible();
    await tab2.locator("#admin-pass-input").fill("e2e-co-fac-pw");
    await tab2.locator("#join-admin-btn").click();

    await expect(tab2.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#lobby")).toBeHidden();
    await tab2.close();
  });

  test("forgotten-name path: empty name still reaches dashboard with a default + informational hint", async ({ page, context }) => {
    const code = await createSession(page);

    const tab2 = await context.newPage();
    tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
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
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    // Skip the name field entirely — head straight for the facilitator panel.
    await tab2.locator("#admin-toggle").click();
    await expect(tab2.locator("#admin-pass-input")).toBeVisible();
    // When the admin section opens, the platform must surface an inline hint
    // because the name field is still empty.
    await expect(tab2.locator("#admin-hint")).toContainText(/name above/i, { timeout: 3000 });

    await tab2.locator("#admin-pass-input").fill("e2e-co-fac-pw");
    await tab2.locator("#join-admin-btn").click();

    // The forgotten-name fallback fills "Facilitator" (or the cached name) and
    // proceeds — the dashboard must paint, not bounce back.
    await expect(tab2.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#name-input")).toHaveValue(/Facilitator|Animateur|ファシリテーター/i);
    await tab2.close();
  });

  test("wrong password keeps the user on the lobby + shows 'Incorrect password.'", async ({ page, context }) => {
    const code = await createSession(page);

    const tab2 = await context.newPage();
    tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
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
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await tab2.locator("#name-input").fill("Wrong Pass User");
    await tab2.locator("#admin-toggle").click();
    await tab2.locator("#admin-pass-input").fill("definitely-wrong");
    await tab2.locator("#join-admin-btn").click();

    await expect(tab2.locator("#admin-hint")).toContainText(/incorrect/i, { timeout: 5000 });
    await expect(tab2.locator("#admin-app")).toBeHidden();
    await expect(tab2.locator("#lobby")).toBeVisible();
    await tab2.close();
  });
});
