/* tests-e2e/create-and-admin.spec.js
 *
 * The full facilitator path:
 *
 *   1. open splash
 *   2. "I'm a facilitator" → fill form → Create session → get a code
 *   3. "Open admin dashboard" → admin app renders with the new code
 *
 * Plus the participant path:
 *
 *   - second tab in the same context enters the code → fills lobby form
 *     → lands in the waiting room
 *
 * In LOCAL mode this exercises every code path that production needs
 * (createSession + joinAdmin + session writes), and would catch
 * regressions like the round-2 anon-stuck-on-profile-setup bug or the
 * !started.val() rules syntax error.
 *
 * Selector strategy: by-ID throughout. Several placeholder strings
 * appear on both the splash AND the lobby (e.g. "ABC-DEF"), so
 * placeholder-based locators violate Playwright's strict mode.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Create-session + admin flow", () => {
  test("facilitator creates a session and lands in the admin dashboard", async ({ page }) => {
    await page.goto("/");

    // Step into the facilitator branch
    await page.locator("#splash-go-create").click();
    await expect(page.getByText(/Create a CANAMED session/i)).toBeVisible();

    // Fill the create form (by ID — placeholders may drift / collide)
    await page.locator("#splash-create-name").fill("E2E Facilitator");
    await page.locator("#splash-create-label").fill("E2E smoke run");
    await page.locator("#splash-create-pass").fill("e2e-password-2026");

    await page.locator("#splash-create-submit").click();

    // The success banner shows the new session code as XXX-XXX inside
    // #splash-shown-code. Wait for it to populate.
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toBeVisible();
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i);

    // Open admin dashboard from the success banner.
    await page.locator("#splash-go-admin").click();

    // Admin app must now be visible; landmark is #admin-app. The literal
    // text "Admin dashboard" appears 3x in the document (stage indicator
    // span, the section h2, ARIA label) and triggers a strict-mode
    // violation, so we anchor on the landmark + the unique IDs.
    await expect(page.locator("#admin-app")).toBeVisible();
    await expect(page.locator("#admin-mode-line")).toBeVisible();
    // The session code is shown in the admin header
    await expect(page.locator("#admin-session-code")).toContainText(code, { ignoreCase: true });
  });

  test("created session is then joinable as participant (same browser context)", async ({ page, context }) => {
    // Step A: create a session in tab 1.
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac");
    await page.locator("#splash-create-label").fill("E2E join run");
    await page.locator("#splash-create-pass").fill("e2e-join-pw");
    await page.locator("#splash-create-submit").click();

    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    // Step B: in a second tab of the same context (so LocalDB is shared),
    // a participant joins using the code.
    const tab2 = await context.newPage();
    // Inherit the same forceLocalMode init for the new tab. Uses the same
    // defineProperty trick as fixtures.js so the real firebase-config.js
    // values don't land.
    await tab2.addInitScript(() => {
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
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await tab2.goto("/");

    // Enter the code on the splash, then submit.
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();

    // The lobby (Join as a participant) should now be visible.
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    // Fill participant fields + tick consent. Use stable IDs — the
    // placeholder text drifts, but the IDs are part of the script.js
    // contract.
    await tab2.locator("#name-input").fill("E2E Student");
    // pick the first option that's not the disabled placeholder
    const realUni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    expect(realUni, "at least one cohort should be selectable").toBeTruthy();
    await tab2.locator("#uni-input").selectOption(realUni);
    await tab2.locator("#consent-workshop").check();

    // The join button is disabled until consent + name + uni are all valid.
    const joinBtn = tab2.locator("#join-btn");
    await expect(joinBtn).toBeEnabled({ timeout: 5000 });
    await joinBtn.click();

    // Should land in the waiting room ("waiting" container becomes visible).
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

    await tab2.close();
  });
});
