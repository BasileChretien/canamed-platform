/* tests/module-b-dark-contrast.test.js
 *
 * Dry-run feedback (2026-05-26): "SPIKES in Module B is very hard to read in
 * dark mode" — and the same for the observer/role message and the recap table.
 *
 * Root cause: the warm-neutral surface tokens --n-25 / --n-50 / --n-100 were
 * NOT remapped in the dark theme, so panels that paint with them
 * (.spikes-strip, .recap-table th / even rows) kept a LIGHT background while the
 * ink flipped to near-white → light-on-light, ~1.1:1. (High-contrast is fine:
 * it keeps black ink on the light neutrals.) Fix: remap the three neutrals to
 * dark elevations in BOTH dark blocks (the prefers-color-scheme media query and
 * the forced html[data-theme="dark"]).
 *
 * Static CSS source-text checks (suite convention).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

const NEUTRALS = ["--n-25", "--n-50", "--n-100"];
const LIGHT_VALUES = { "--n-25": "#fbf9f4", "--n-50": "#f1eee6", "--n-100": "#e6e2d8" };

test("the forced dark theme remaps the warm-neutral surface tokens to dark elevations", () => {
  const m = CSS.match(/html\[data-theme="dark"\]\s*\{[^}]*\}/);
  assert.ok(m, "html[data-theme=\"dark\"] block must exist");
  const dark = m[0];
  for (const tok of NEUTRALS) {
    assert.match(dark, new RegExp(tok + ":"), "dark block must define " + tok);
    // must NOT keep the light-mode value (that's the readability bug)
    assert.doesNotMatch(dark, new RegExp(tok + ":\\s*" + LIGHT_VALUES[tok]),
      tok + " must be remapped away from its light value in dark mode");
  }
});

test("both dark blocks (media query + forced) remap each neutral", () => {
  // :root defines each once; each of the two dark blocks adds one more → >= 3.
  for (const tok of NEUTRALS) {
    const n = (CSS.match(new RegExp(tok + ":", "g")) || []).length;
    assert.ok(n >= 3, tok + " must be defined in :root + both dark blocks (got " + n + ")");
  }
});

test("the affected Module B panels still paint with the neutral tokens (so the remap reaches them)", () => {
  assert.match(CSS, /\.spikes-strip\s*\{[^}]*background:\s*var\(--n-100\)/,
    ".spikes-strip must paint with var(--n-100)");
  assert.match(CSS, /\.recap-table th\s*\{[^}]*background:\s*var\(--n-100\)/,
    ".recap-table th must paint with var(--n-100)");
  assert.match(CSS, /\.recap-table tbody tr:nth-child\(even\)\s*\{[^}]*background:\s*var\(--n-25\)/,
    ".recap-table even rows must paint with var(--n-25)");
});
