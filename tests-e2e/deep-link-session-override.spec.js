/* tests-e2e/deep-link-session-override.spec.js
 *
 * Regression: a connection link (?s=CODE) to a NEW session must override the
 * silent auto-resume of a PREVIOUS session the device already holds.
 *
 * Reported 2026-06-08: "When people were connected to a previous session, and
 * they get a connection link to a new session, they still connect to the
 * previous session."
 *
 * Root cause: initEntry() short-circuited (early `return`) on a stored
 * `canamed_session` and auto-resumed it BEFORE showSplash() — the only path
 * that runs tryConsumeDeepLink() — ever executed, so the ?s= link was never
 * consumed. Fix: only auto-resume the stored session when there is no deep
 * link, or the link points at the SAME session.
 *
 * LOCAL mode is hermetic and localStorage-backed, so two sessions created via
 * the real facilitator flow both persist in LocalDB across navigations and
 * sessionStatus() resolves against them.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/** Normalise a code the way the platform's sanitizeCode() does (lowercase,
 *  [a-z0-9_-], max 20) so test assertions compare apples-to-apples with the
 *  stored canamed_session pointer. */
function norm(code) {
  return String(code || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
}

/** Drive the splash facilitator flow and return the created session code
 *  (canonical "XXX-XXX", upper-case as shown on the success banner). Assumes
 *  the page is already on a fresh splash (enter view). */
async function createSession(page, label) {
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("e2e-deep-link-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  // Generous timeout: under the slow iPad/Android emulation passes the LocalDB
  // create write can lag, and the node sits at its "—" placeholder meanwhile.
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 15_000 });
  return (await codeNode.textContent()).trim();
}

test.describe("deep link overrides previous-session auto-resume", () => {
  test("a ?s= link to a different session wins over the stored session", async ({ page }) => {
    // Create two real sessions, A then B (reload between to get a clean splash).
    await page.goto("/");
    const codeA = await createSession(page, "Deep-link A");

    await page.goto("/");
    const codeB = await createSession(page, "Deep-link B");
    expect(norm(codeB)).not.toBe(norm(codeA));

    // Simulate "this device was connected to session A" — the exact state that
    // used to trap the user (a stored pointer to a still-live session).
    await page.evaluate((a) => localStorage.setItem("canamed_session", a), codeA);

    // The user opens a connection link to the NEW session B.
    await page.goto("/?s=" + encodeURIComponent(codeB));

    // The deep link must take over: the splash unlocks into B, not A.
    await expect(page.locator("#splash")).toBeHidden({ timeout: 10_000 });
    const landed = await page.evaluate(() => localStorage.getItem("canamed_session"));
    expect(norm(landed)).toBe(norm(codeB));
    expect(norm(landed)).not.toBe(norm(codeA));
  });

  test("no deep link → the stored session still auto-resumes (no regression)", async ({ page }) => {
    await page.goto("/");
    const codeA = await createSession(page, "Auto-resume A");

    await page.evaluate((a) => localStorage.setItem("canamed_session", a), codeA);

    // Plain reload, no ?s= — the previous-session auto-resume must be intact.
    await page.goto("/");
    await expect(page.locator("#splash")).toBeHidden({ timeout: 10_000 });
    const landed = await page.evaluate(() => localStorage.getItem("canamed_session"));
    expect(norm(landed)).toBe(norm(codeA));
  });

  test("a ?s= link to the SAME stored session resumes it (smoother path)", async ({ page }) => {
    await page.goto("/");
    const codeA = await createSession(page, "Same-link A");

    await page.evaluate((a) => localStorage.setItem("canamed_session", a), codeA);

    await page.goto("/?s=" + encodeURIComponent(codeA));
    await expect(page.locator("#splash")).toBeHidden({ timeout: 10_000 });
    const landed = await page.evaluate(() => localStorage.getItem("canamed_session"));
    expect(norm(landed)).toBe(norm(codeA));
  });
});
