/* tests/attention-budget.test.js
 *
 * Regression guard for the UX-overload "attention budget" fix (2026-06-01).
 * The Module A right-column "something new" dot (.rcol-tab.has-attention)
 * pulsed FOREVER, reading as anxiety and competing for attention
 * indefinitely. It now pulses a few times and settles to a static dot
 * (still visible — the cue persists — but no longer in perpetual motion).
 *
 * Static assertion against style.css.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "style.css"),
  "utf8");

test("the attention dot pulse settles (finite iterations), not infinite", () => {
  const m = CSS.match(/\.rcol-tab\.has-attention::after\s*\{[^}]*\}/);
  assert.ok(m, "the .rcol-tab.has-attention::after rule must exist");
  const rule = m[0];
  assert.match(rule, /animation:\s*rcol-pulse/, "the dot must still use the rcol-pulse animation");
  assert.doesNotMatch(rule, /\binfinite\b/,
    "the attention dot must not pulse forever (attention budget)");
  // a finite iteration count must be present
  assert.match(rule, /rcol-pulse[^;]*\s\d+\s*;/,
    "the pulse must specify a finite iteration count so it settles to a static dot");
});
