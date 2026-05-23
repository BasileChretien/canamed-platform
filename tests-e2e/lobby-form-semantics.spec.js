/* tests-e2e/lobby-a11y.spec.js
 *
 * WCAG 2.1 AA form-semantics regression for the lobby join form.
 *
 * ACCESSIBILITY_AUDIT.md §5 flagged that the participant-join inputs
 * carried a visible <label> but none of the machine-readable form
 * semantics assistive tech relies on:
 *   - autocomplete (WCAG 1.3.5 — Identify Input Purpose)
 *   - aria-required on the JS-gated required fields (WCAG 3.3.1/3.3.2)
 *   - aria-describedby linking each input to its visible hint
 *
 * The inputs live in the static index.html markup (the lobby view is
 * hidden until a code is entered), so a bare goto("/") can assert the
 * attributes without standing up a session. Registered against the
 * mobile-iphone / mobile-ipad / mobile-android projects (and run by the
 * desktop projects by default) per the per-device standing instruction.
 */

// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Lobby form accessibility (WCAG 1.3.5 / 3.3.1 / 3.3.2)", () => {
  test("join-form inputs expose autocomplete + required + describedby", async ({ page }) => {
    await page.goto("/");

    // Name — required to join; identify-input-purpose = name.
    const name = page.locator("#name-input");
    await expect(name).toHaveAttribute("autocomplete", "name");
    await expect(name).toHaveAttribute("aria-required", "true");
    await expect(name).toHaveAttribute("required", "");

    // University — required; organization purpose; described by the
    // room-placement hint so AT users hear why it's collected.
    const uni = page.locator("#uni-input");
    await expect(uni).toHaveAttribute("autocomplete", "organization");
    await expect(uni).toHaveAttribute("aria-required", "true");
    await expect(uni).toHaveAttribute("aria-describedby", "lobby-join-hint");
    await expect(page.locator("#lobby-join-hint")).toHaveCount(1);

    // English level — has a sensible default, so not "required", but the
    // CEFR hint must be programmatically associated.
    const eng = page.locator("#english-input");
    await expect(eng).toHaveAttribute("aria-describedby", "lobby-english-hint");
    await expect(page.locator("#lobby-english-hint")).toHaveCount(1);
  });
});
