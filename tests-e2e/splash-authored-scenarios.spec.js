/* tests-e2e/splash-authored-scenarios.spec.js
 *
 * Coverage for the Phase 1–3 UI additions (2026-05-29):
 *
 *   - Splash account view now offers email/password sign-in alongside Google.
 *   - The "Author scenarios" splash row is hidden by default (revealed only
 *     once a non-anonymous user signs in, which can't happen in LOCAL mode).
 *   - The SECTION picker on the create-session view still works in LOCAL
 *     mode — authored scenarios fail-soft to an empty list, built-ins show.
 *
 * S7 CUTOVER — the Scenario select (#splash-create-scenario) is gone. A shared
 * scenario now reaches the facilitator as a SECTION in #splash-section-add,
 * keyed "authored:<uid>:<scenarioId>:<type>" instead of "__ref:shared:<uid>:<id>".
 *
 * LOCAL mode caveat: forceLocalMode() pins CANAMED_FIREBASE = null, so
 * sign-in attempts deliberately bail with "Sign-in is not available in
 * local-test mode." That's exactly what we assert here — proves the auth
 * helpers were wired without raising; full sign-in coverage would need
 * the Firebase emulator (out of scope for the hermetic suite).
 *
 * Runs on every configured viewport (desktop, mobile-iphone, mobile-ipad,
 * mobile-android) per CLAUDE.md's per-device standing instruction —
 * Playwright projects handle the viewport multiplexing.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Splash — authored scenarios entry points", () => {
  test("account view exposes email/password form alongside Google", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();

    // Existing Google button still present.
    await expect(page.locator("#splash-google-signin")).toBeVisible();

    // New email/password form: mode tabs + fields + single submit button.
    await expect(page.locator("#splash-email-form")).toBeVisible();
    await expect(page.locator("#splash-email-mode-signin")).toBeVisible();
    await expect(page.locator("#splash-email-mode-signup")).toBeVisible();
    await expect(page.locator("#splash-email-input")).toBeVisible();
    await expect(page.locator("#splash-password-input")).toBeVisible();
    await expect(page.locator("#splash-email-submit")).toBeVisible();
    // Confirm-password + strength meter are sign-up only and start hidden.
    await expect(page.locator("#splash-password-confirm")).toBeHidden();
  });

  test("switching to 'Create a new account' reveals confirm + strength meter", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();
    await page.locator("#splash-email-mode-signup").click();
    await expect(page.locator("#splash-password-confirm")).toBeVisible();
    await expect(page.locator("#splash-pwd-strength-label")).toBeVisible();
    // Submit button relabels from "Sign in" → "Create account".
    await expect(page.locator("#splash-email-submit")).toContainText(/create account|cr.er un compte|アカウントを作成/i);

    // Typing a weak password lights up the meter at a low score.
    await page.locator("#splash-password-input").fill("aaaaaaaa");
    await expect(page.locator("#splash-pwd-strength-fill"))
      .toHaveAttribute("data-score", /[0-1]/);

    // A strong password lights it up at a high score.
    await page.locator("#splash-password-input").fill("Str0ng-Pass!2025");
    await expect(page.locator("#splash-pwd-strength-fill"))
      .toHaveAttribute("data-score", /[3-4]/);
  });

  test("sign-up blocks mismatched passwords and weak passwords with a clear error", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();
    await page.locator("#splash-email-mode-signup").click();
    await page.locator("#splash-email-input").fill("new@example.test");
    await page.locator("#splash-password-input").fill("Str0ng-Pass!2025");
    await page.locator("#splash-password-confirm").fill("typo-typo-typo");
    await page.locator("#splash-email-submit").click();
    await expect(page.locator("#splash-account-hint"))
      .toContainText(/don't match|ne correspondent|一致しません/i);

    // Matching but weak password → blocked with the strength error.
    await page.locator("#splash-password-input").fill("aaaaaaaa");
    await page.locator("#splash-password-confirm").fill("aaaaaaaa");
    await page.locator("#splash-email-submit").click();
    await expect(page.locator("#splash-account-hint"))
      .toContainText(/stronger|plus fort|より強い/i);
  });

  test("email sign-in shows a clear error in LOCAL mode (no Firebase wired)", async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();

    await page.locator("#splash-email-input").fill("nobody@example.test");
    await page.locator("#splash-password-input").fill("ignored-in-local-mode");
    await page.locator("#splash-email-submit").click();

    const hint = page.locator("#splash-account-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/local-test|sign-in is not available/i,
      { timeout: 3000 });
  });

  test("'Author scenarios' splash link is visible WITHOUT signing in (S7 cutover)", async ({ page }) => {
    /* INVERTED DELIBERATELY. This test used to pin the opposite: the row stayed
       hidden until a non-anonymous sign-in, "to keep the participant landing
       page uncluttered". That decision had a consequence nobody had connected
       to it — the fill-in authoring BOARD (scenario-author.html: 15 form
       sections, a PBL/Roleplay/Branched skeleton picker) was the hidden thing,
       while the create form still offered a raw-JSON textarea in plain sight.
       Facilitators therefore met JSON and never met the board, and reported the
       platform as "JSON-only" — the board existed the whole time.

       So the gate moved rather than disappeared: the board is now findable by
       anyone, and signing in is prompted when SAVING to the cloud, which is the
       only step that actually needs an identity. Reverting this to hidden
       re-creates the original complaint, which is why the assertion is
       explicit rather than just deleted. */
    await page.goto("/");

    const row = page.locator("#splash-author-row");
    await expect(row).toBeAttached();
    // LOCAL mode never produces a non-anonymous user, so if visibility still
    // depended on sign-in this would fail — that is the point of the check.
    await expect(row).toBeVisible();
    await expect(page.locator("#splash-go-author"))
      .toHaveAttribute("href", "scenario-author.html");
  });

  test("shared scenarios seeded in LocalDB populate the picker in LOCAL mode", async ({ page }) => {
    // Regression coverage: listSharedScenarios() iterates the snapshot
    // with snap.forEach(child => ...). LocalDB snapshots used to expose
    // only { val() }, so LOCAL mode threw "snap.forEach is not a
    // function" (swallowed by the .catch) and the shared list silently
    // came back empty. Seed the LocalDB storage key before any page
    // script runs, then assert the "Shared scenarios" optgroup renders.
    const warnings = [];
    page.on("console", (msg) => {
      if (/listSharedScenarios failed/.test(msg.text())) warnings.push(msg.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem("canamed_localdb_v1", JSON.stringify({
        sharedScenarios: {
          u_demo_scn: {
            ownerUid: "u_demo",
            scenarioId: "scn",
            ownerName: "Dr. Local",
            meta: { name: "Locally Shared Scenario" },
            /* S7 — the picker derives SECTIONS from the body, so a row carrying
               only `meta` yields nothing to list. `moduleAName` is the
               name-first declaration that makes it a PBL section. */
            bodyJson: JSON.stringify({
              id: "scn",
              name: { en: "Locally Shared Scenario", fr: "", ja: "" },
              moduleAName: { en: "Locally Shared Scenario", fr: "", ja: "" }
            })
          }
        }
      }));
    });

    await page.goto("/");
    await page.locator("#splash-go-create").click();

    const picker = page.locator("#splash-section-add");
    await expect(picker).toBeVisible();
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());

    // The authored sections are appended asynchronously after the built-ins
    // (they need their own DB read); poll for the shared entry.
    const sharedOption = picker.locator('option[value="authored:u_demo:scn:pbl"]');
    await expect.poll(async () => await sharedOption.count(), { timeout: 10_000 }).toBe(1);
    /* The option is labelled by TYPE — "PBL — <title>" — the same wording the
       built-ins use, so a shared section is not visually second-class. */
    await expect(sharedOption).toHaveText(/^PBL — .*Locally Shared Scenario/);

    expect(warnings, "listSharedScenarios must not fail in LOCAL mode").toEqual([]);
  });

  test("create-session section picker still works when authored scenarios are empty", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await page.locator("#splash-go-create").click();

    const picker = page.locator("#splash-section-add");
    await expect(picker).toBeVisible();

    // Built-in sections populate the add-list. Wait until the picker has at
    // least one option (case-content.js + section-registry.js are lazy).
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await expect.poll(async () =>
      await picker.locator("option").count()
    ).toBeGreaterThan(0);

    /* No authored:… options should appear with nothing seeded. This asserts an
       ABSENCE, so the authored pass must have RUN — ensureCaseContent() and the
       built-in options only prove the built-in half landed. Without awaiting it
       the count is 0 because nothing has looked yet, not because LOCAL mode
       produced nothing, and the assertion passes vacuously. */
    await page.evaluate(() => loadAuthoredSectionsIntoPicker());
    const refOptionCount = await picker.locator('option[value^="authored:"]').count();
    expect(refOptionCount).toBe(0);

    // No JS errors from the new picker / storage helpers.
    expect(errors, "create-session view should load without errors").toEqual([]);
  });
});
