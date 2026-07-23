/* tests/chart-section-reveal.test.js
 *
 * Regression guard for the UX-overload "smoother" fix (2026-06-01): expanding
 * a Module A chart <details> section now eases its content in (fade + slide)
 * instead of snapping the layout — it was the only un-eased interaction in an
 * otherwise mature motion system. Reduced-motion disables it.
 *
 * Static assertions against style.css.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "style.css"),
  "utf8") +
  // room-only rules moved to the lazily-loaded room.css (perf reclaim)
  fs.readFileSync(
    path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "room.css"),
    "utf8");

test("opening a chart section eases its content in", () => {
  assert.match(
    CSS,
    /\.chart-section\[open\] > \*:not\(summary\):not\(\.chart-section-h\)\s*\{[^}]*animation:\s*chart-section-reveal/,
    "open chart-section content must animate with chart-section-reveal");
  assert.match(CSS, /@keyframes chart-section-reveal\s*\{/, "the reveal keyframe must exist");
});

test("the chart-section reveal honours prefers-reduced-motion", () => {
  // a reduced-motion block must disable the chart-section reveal animation
  assert.match(
    CSS,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.chart-section\[open\][^}]*animation:\s*none/s,
    "reduced-motion must disable the chart-section reveal");
});
