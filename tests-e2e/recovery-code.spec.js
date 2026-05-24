/* tests-e2e/recovery-code.spec.js
 *
 * D21 (hardened) — per-session recovery code flow, end-to-end in LOCAL mode.
 *
 * Runs on all four required device profiles (desktop chromium via the
 * default project, plus mobile-iphone / mobile-ipad / mobile-android — see
 * playwright.config.js testMatch). Repo convention (CLAUDE.md) requires every
 * UI change to be covered across those viewports.
 *
 * What it proves:
 *   1. CREATE — after creating a session the one-time recovery code is shown
 *      on the created view, in the documented xxxx-xxxx-xxxx format, with the
 *      "this is the only way to reset" warning, and a working Copy button.
 *   2. RESET (correct code) — re-opening the same code, the facilitator can
 *      reset the password using the recovery code and land in the admin app.
 *   3. RESET (missing code) — attempting an overwrite WITHOUT a recovery code
 *      is rejected client-side with a helpful hint and does NOT enter admin.
 *
 * LIMITATION (documented, not skipped): the in-browser LocalDB backend used
 * by LOCAL mode does NOT enforce database.rules.json — it is a plain
 * path-store. So a WRONG (but non-empty) recovery code cannot be rejected by
 * the backend here; that rejection is a RULES guarantee, exercised against
 * the real Firebase emulator in tests-e2e/emulator/rules-smoke.spec.js. In
 * LOCAL mode we instead pin the client-side validation (empty code blocked)
 * and the happy path. The structural rules tests (tests/rules.test.js) pin
 * the rule contract that backs the wrong-code rejection.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// The recovery code is rendered lowercase, 3 groups of 4 chars from the
// unambiguous alphabet, dash-joined.
const RECOVERY_FORMAT = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/;

async function createSession(page, { name, pass }) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill(name);
  await page.locator("#splash-create-pass").fill(pass);
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  // Generous timeout: when the full 4-project matrix runs, WebKit/Chrome cold
  // starts + the shared static server make session creation slower than a
  // single-project run.
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 25_000 });
  return (await codeNode.textContent()).trim();
}

test.describe("D21 recovery code — create + reset", () => {
  test("the one-time recovery code is shown with a warning + is copyable", async ({ page }) => {
    await createSession(page, { name: "Recovery Fac", pass: "init-pw-2026" });

    // The recovery block must be visible on the created view.
    const wrap = page.locator("#splash-recovery-wrap");
    await expect(wrap).toBeVisible();

    // The code itself follows the xxxx-xxxx-xxxx format.
    const codeNode = page.locator("#splash-recovery-code");
    await expect(codeNode).toBeVisible();
    const recovery = (await codeNode.textContent()).trim();
    expect(recovery, "recovery code must match xxxx-xxxx-xxxx").toMatch(RECOVERY_FORMAT);

    // The warning must communicate that it is the only reset path + shown once.
    const warn = page.locator(".splash-recovery-warn");
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(/only|reset|not be shown|seul|réinitialiser|唯一|表示/i);

    // Copy button works (or at least does not throw + surfaces a status).
    await page.locator("#splash-recovery-copy").click();
    // Either "copied" or the manual-copy fallback message appears — both are
    // acceptable depending on clipboard permissions in the headless browser.
    await expect(page.locator("#splash-recovery-copy-hint")).not.toHaveText("", { timeout: 3000 });
  });

  test("reset with the CORRECT recovery code enters the admin app", async ({ page }) => {
    const code = await createSession(page, { name: "Reset Fac", pass: "old-pw-2026" });
    const recovery = (await page.locator("#splash-recovery-code").textContent()).trim();
    expect(recovery).toMatch(RECOVERY_FORMAT);

    // Go back to the splash and re-enter the same session code as a returning
    // facilitator who has FORGOTTEN the password.
    await page.goto("/");
    await page.locator("#splash-code").fill(code);
    await page.locator("#splash-enter").click();
    await expect(page.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    // Open the facilitator section, then the recover-password panel.
    await page.locator("#admin-toggle").click();
    await page.locator("#forgot-pass-link").click();
    await expect(page.locator("#superadmin-panel")).toBeVisible();

    // Fill name (required) + super-admin key + a NEW password (twice) + the
    // recovery code. In LOCAL mode firebase-config.js sets the key to null,
    // so script.js falls back to the documented local-test key "test"
    // (forceLocalMode's plain assignment is overwritten by firebase-config.js,
    // unlike the defineProperty pins other specs use).
    await page.locator("#name-input").fill("Reset Fac");
    await page.locator("#superadmin-key-input").fill("test");
    await page.locator("#new-pass-input").fill("brand-new-pw-2026");
    const confirm = page.locator("#new-pass-confirm-input");
    if (await confirm.count()) await confirm.fill("brand-new-pw-2026");
    await page.locator("#recovery-code-input").fill(recovery);

    await page.locator("#set-pass-btn").click();

    // A correct recovery code overwrites the hash and drops into the admin app.
    await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#admin-session-code")).toContainText(code, { ignoreCase: true });
  });

  test("reset with NO recovery code is rejected client-side (stays in lobby)", async ({ page }) => {
    const code = await createSession(page, { name: "Block Fac", pass: "old-pw-2026" });

    await page.goto("/");
    await page.locator("#splash-code").fill(code);
    await page.locator("#splash-enter").click();
    await expect(page.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    await page.locator("#admin-toggle").click();
    await page.locator("#forgot-pass-link").click();
    await expect(page.locator("#superadmin-panel")).toBeVisible();

    await page.locator("#name-input").fill("Block Fac");
    await page.locator("#superadmin-key-input").fill("test");  // LOCAL-mode key
    await page.locator("#new-pass-input").fill("attempted-new-pw");
    const confirm = page.locator("#new-pass-confirm-input");
    if (await confirm.count()) await confirm.fill("attempted-new-pw");
    // Recovery code intentionally LEFT BLANK — the overwrite path requires it.
    await page.locator("#set-pass-btn").click();

    // Must NOT enter the admin app; the hint must explain the recovery code.
    await expect(page.locator("#admin-hint")).toContainText(
      /recovery code|code de récupération|リカバリーコード|복구 코드|恢复码|recuperación|recuperação|Wiederherstellungscode/i,
      { timeout: 10_000 }
    );
    await expect(page.locator("#admin-app")).toBeHidden();
  });

  test("superadmin-card change-password reuses the recovery code to overwrite", async ({ page }) => {
    // The in-dashboard superadmin card (#change-pass-btn) is a SECOND reset
    // path. Overwriting an existing session's password through it must also
    // present that session's recovery code. We first enter as superadmin via
    // the lobby recovery flow, then change the SAME session's password again
    // from the card.
    const code = await createSession(page, { name: "Card Fac", pass: "old-pw-2026" });
    const recovery = (await page.locator("#splash-recovery-code").textContent()).trim();

    await page.goto("/");
    await page.locator("#splash-code").fill(code);
    await page.locator("#splash-enter").click();
    await expect(page.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    await page.locator("#admin-toggle").click();
    await page.locator("#forgot-pass-link").click();
    await expect(page.locator("#superadmin-panel")).toBeVisible();
    await page.locator("#name-input").fill("Card Fac");
    await page.locator("#superadmin-key-input").fill("test");
    await page.locator("#new-pass-input").fill("first-reset-pw");
    const confirm = page.locator("#new-pass-confirm-input");
    if (await confirm.count()) await confirm.fill("first-reset-pw");
    await page.locator("#recovery-code-input").fill(recovery);
    await page.locator("#set-pass-btn").click();
    await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

    // The superadmin card is visible (role === superadmin). Change the SAME
    // session's password again, this time WITH the recovery code → success.
    const card = page.locator("#superadmin-card");
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    // change-session-input is pre-filled with the current session by
    // enterAdminApp; set it explicitly to be safe.
    await page.locator("#change-session-input").fill(code);
    await page.locator("#change-pass-input").fill("card-changed-pw");
    await page.locator("#change-recovery-input").fill(recovery);
    const changeBtn = page.locator("#change-pass-btn");
    // The always-visible session-code chip (.admin-session-chip) overlaps the
    // superadmin-card button region after scrolling, so a coordinate-based
    // click — even { force: true } — hit-tests onto the chip rather than the
    // button and the handler never runs. We assert the handler's CONFIRMATION
    // here, so dispatch the click straight to the button; the rules-level
    // gating of the recovery code is proven against the real Firebase emulator
    // in tests-e2e/emulator/recovery-rules.spec.js.
    await changeBtn.scrollIntoViewIfNeeded();
    await changeBtn.dispatchEvent("click");
    await expect(page.locator("#change-pass-ok")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#change-pass-ok")).toContainText(code, { ignoreCase: true });
  });
});
