/* tests-e2e/verify-page.spec.js — public certificate verification page.
 *
 * PIS v2 §18: verify.html confirms a certificate's ID + name match an entry
 * in /credentials, returning "valid" / "no match" / "not found" without ever
 * publishing the name. This spec drives the page in LOCAL mode via the
 * window._test_verifyCredentials hook (no Firebase round-trip): it injects a
 * realistic credential entry, then walks the form through the three outcomes.
 * Listed in the mobile testMatch (playwright.config.js) so it runs per-device.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function gotoVerify(page, qs) {
  await page.goto("/verify.html" + (qs ? "?" + qs : ""));
  // Wait for the page chrome + pure-utils + verify.js to load.
  await page.waitForFunction(() =>
    typeof window.credentialNameHash === "function" && !!document.getElementById("verify-form"));
}

// Seed a credential entry (with a real SHA-256 hash of the name + session) so
// the page's own normalisation + hash path matches at lookup time.
async function seedCredential(page, id, name, session, extras) {
  await page.evaluate(async ({ id, name, session, extras }) => {
    const hash = await window.credentialNameHash(name, session);
    window._test_verifyCredentials = window._test_verifyCredentials || {};
    window._test_verifyCredentials[id] = Object.assign({
      nameHash: hash, session: session, sessionLabel: "", at: Date.now()
    }, extras || {});
  }, { id, name, session, extras: extras || null });
}

test.describe("Public certificate verification page (verify.html)", () => {
  test("a matching ID + name returns 'valid'", async ({ page }) => {
    await gotoVerify(page);
    await seedCredential(page, "CNM-T582B-V53WX", "Akari Tanaka", "ABC-DEF",
      { sessionLabel: "CaNaMED Session 3" });
    await page.fill("#verify-id", "CNM-T582B-V53WX");
    await page.fill("#verify-name", "Akari Tanaka");
    await page.click("#verify-submit");
    const r = page.locator("#verify-result");
    await expect(r).toHaveClass(/verify-valid/);
    await expect(r).toContainText(/Valid/i);
  });

  test("a normalised name (whitespace / case) still matches", async ({ page }) => {
    await gotoVerify(page);
    await seedCredential(page, "CNM-T582B-V53WX", "Akari Tanaka", "ABC-DEF");
    await page.fill("#verify-id", "CNM-T582B-V53WX");
    await page.fill("#verify-name", "  akari   TANAKA  ");        // ugly typing
    await page.click("#verify-submit");
    await expect(page.locator("#verify-result")).toHaveClass(/verify-valid/);
  });

  test("a wrong name returns 'no match' (does NOT reveal the real name)", async ({ page }) => {
    await gotoVerify(page);
    await seedCredential(page, "CNM-T582B-V53WX", "Akari Tanaka", "ABC-DEF");
    await page.fill("#verify-id", "CNM-T582B-V53WX");
    await page.fill("#verify-name", "Someone Else");
    await page.click("#verify-submit");
    const r = page.locator("#verify-result");
    await expect(r).toHaveClass(/verify-invalid/);
    await expect(r).toContainText(/no match|match/i);
    // The real name must NEVER be leaked back to the verifier on a miss.
    const txt = (await r.textContent()) || "";
    expect(txt.toLowerCase()).not.toContain("akari");
    expect(txt.toLowerCase()).not.toContain("tanaka");
  });

  test("an unknown ID returns 'not found'", async ({ page }) => {
    await gotoVerify(page);
    // Seed an EMPTY map so the test seam is authoritative (instead of falling
    // through to a real-Firebase lookup that wouldn't exist in LOCAL mode).
    await page.evaluate(() => { window._test_verifyCredentials = {}; });
    await page.fill("#verify-id", "CNM-XXXXX-YYYYY");
    await page.fill("#verify-name", "Whoever");
    await page.click("#verify-submit");
    // verify.not-found copy: certificates are published to the registry by
    // default now, so a miss means a mistyped/incorrect ID or a removed entry.
    // Match the current "couldn't find … may be incorrect / removed" phrasing
    // as well as older variants for resilience.
    await expect(page.locator("#verify-result")).toContainText(/couldn't find|not in the public registry|may be incorrect|not found/i);
  });

  test("the ?id= URL param pre-fills the ID input (QR scan path)", async ({ page }) => {
    await gotoVerify(page, "id=CNM-T582B-V53WX");
    await expect(page.locator("#verify-id")).toHaveValue("CNM-T582B-V53WX");
  });

  test("a malformed ID is rejected by format check before any lookup", async ({ page }) => {
    await gotoVerify(page);
    await page.fill("#verify-id", "not-a-cnm-id");
    await page.fill("#verify-name", "Whoever");
    await page.click("#verify-submit");
    await expect(page.locator("#verify-result")).toContainText(/doesn't look like|CNM-XXXXX/i);
  });
});
