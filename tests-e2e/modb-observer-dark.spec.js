/* tests-e2e/modb-observer-dark.spec.js
 *
 * Dry-run #5 (observer-message gap): the Module B "you're observing now"
 * reassurance note (.role-observe-reassure) used a hardcoded light-green
 * background with color:var(--ink), so in dark mode it rendered near-white
 * text on a light-green surface (~1.x:1, unreadable). It now paints with the
 * themed --ok-50 / --ok-strong tokens. This spec verifies at RUNTIME that the
 * tokens resolve to a legible pairing (WCAG-AA contrast) in dark mode — a
 * static source check can't prove the token actually resolves dark.
 *
 * Listed in the mobile testMatch in playwright.config.js so it runs per-device
 * (chromium + iPhone/iPad/Android) per the standing per-device-tests rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// Relative luminance + WCAG contrast ratio from a CSS rgb()/rgba() string.
function contrastFromComputed(bg, fg) {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2]];
  };
  const lum = (rgb) => {
    const a = rgb.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const b = parse(bg), f = parse(fg);
  if (!b || !f) return null;
  const L1 = lum(b), L2 = lum(f);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

async function showObserveNote(page, theme) {
  await page.goto("/");
  return page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    const note = document.getElementById("modB-observe-reassure");
    if (!note) return null;
    note.classList.remove("hidden");
    note.textContent = "That's completely fine — you're observing now.";
    const cs = getComputedStyle(note);
    return { bg: cs.backgroundColor, color: cs.color };
  }, theme);
}

test.describe("Module B observer message — dark-mode legibility", () => {
  test("the observe-reassurance note is WCAG-AA legible in dark mode", async ({ page }) => {
    const out = await showObserveNote(page, "dark");
    expect(out, "#modB-observe-reassure must exist").not.toBeNull();
    const ratio = contrastFromComputed(out.bg, out.color);
    expect(ratio, `contrast was ${ratio} for bg=${out.bg} fg=${out.color}`).not.toBeNull();
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // And the background must actually be dark (token resolved, not the old light green).
    const m = out.bg.match(/rgba?\(([^)]+)\)/);
    const [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
    expect(r + g + b, `dark-mode bg ${out.bg} should be a dark surface`).toBeLessThan(300);
  });

  test("still legible in light mode (no regression)", async ({ page }) => {
    const out = await showObserveNote(page, "light");
    const ratio = contrastFromComputed(out.bg, out.color);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
