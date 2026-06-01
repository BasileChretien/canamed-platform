/* tests-e2e/glossary-marker-tap.spec.js
 *
 * UX-overload Phase-3 item #4: the 📖 glossary marker is reachable by TAP.
 *
 * The marker lives inside the reveal <button>. Tapping it must open the
 * plain-language gloss popover WITHOUT firing the reveal (stopPropagation),
 * and the popover must be dismissible (Escape / outside tap). We exercise this
 * on a synthetic glossed .req-btn built from the live CANAMED_GLOSSARY so the
 * test doesn't depend on which case-content button happens to carry a term.
 *
 * Registered in the mobile testMatch so it runs per-device (touch is the whole
 * point of this fix).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setupGlossButton(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    if (window.CanamedLoader && window.CanamedLoader.ensureGlossary) {
      await window.CanamedLoader.ensureGlossary();
    }
    // Clear the splash gate so a body-level button is clickable.
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");

    const term = Object.keys(window.CANAMED_GLOSSARY || {})[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "gloss-test-btn";
    btn.className = "req-btn";
    btn.textContent = "Order test about " + term + " now";
    btn.style.cssText = "position:fixed;top:12px;left:12px;z-index:9999";
    window.__revealFired = false;
    btn.addEventListener("click", () => { window.__revealFired = true; });
    document.body.appendChild(btn);
    // Annotate it the same way renderButtons does for real reveal buttons.
    window._annotateButtonWithGlossary(btn);
    return { term, hasMarker: !!btn.querySelector(".glossary-marker") };
  });
}

test.describe("Glossary marker — tap reachable", () => {
  test("tapping the 📖 opens the gloss and does NOT fire the reveal", async ({ page }) => {
    await setupGlossButton(page);
    const marker = page.locator("#gloss-test-btn .glossary-marker");
    await expect(marker).toBeVisible();

    await marker.click();

    // Gloss popover appears…
    await expect(page.locator(".gloss-pop")).toBeVisible();
    // …and the reveal button did NOT fire (stopPropagation worked).
    expect(await page.evaluate(() => window.__revealFired)).toBe(false);
  });

  test("Escape dismisses the gloss popover (WCAG 1.4.13)", async ({ page }) => {
    await setupGlossButton(page);
    await page.locator("#gloss-test-btn .glossary-marker").click();
    await expect(page.locator(".gloss-pop")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".gloss-pop")).toBeHidden();
  });

  test("clicking the button body (not the marker) still fires the reveal", async ({ page }) => {
    await setupGlossButton(page);
    // Click the label area, away from the marker.
    await page.locator("#gloss-test-btn").click({ position: { x: 8, y: 10 } });
    expect(await page.evaluate(() => window.__revealFired)).toBe(true);
  });
});
