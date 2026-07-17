/* tests/ux-overload-quickwins.test.js
 *
 * Regression guards for the UX-overload "quick wins" (2026-06-01). These
 * reduce the amount of information competing for a student's attention at
 * the top of the Module A work screen, and respect reduced-motion.
 *
 *   - Leaderboard: ships CLOSED (no `open` attr) and renderStage() only
 *     auto-opens it at Wrap-up — never at Welcome (empty board) or during
 *     Module A/B (where it competed with the clinical task).
 *   - Stage-1 callouts: the "work as equals" (.everyone-talks) and "every
 *     click is a team decision" (.chart-team-warning) notes are demoted to
 *     muted hint text (no fill, no border-left) so only the next-step coach
 *     remains a focal callout in the first viewport.
 *   - Reduced-motion: programmatic smooth scrollIntoView calls go through
 *     reducedMotion() so vestibular-sensitive students aren't thrown.
 *
 * Static assertions, matching the repo's test style.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

function ruleBody(selector) {
  // first { ... } block following the exact selector
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = CSS.match(re);
  assert.ok(m, "expected a CSS rule for " + selector);
  return m[1];
}

/* ---------------------- leaderboard ---------------------- */

test("leaderboard ships CLOSED (no open attribute on #leaderboard-card)", () => {
  const tag = INDEX.match(/<details\b[^>]*id="leaderboard-card"[^>]*>/);
  assert.ok(tag, "#leaderboard-card <details> must exist");
  assert.doesNotMatch(tag[0], /\bopen\b/,
    "the leaderboard must not be open by default (was dominating Welcome + Module A)");
});

test("renderStage never auto-opens the leaderboard (manual disclosure only)", () => {
  // User request 2026-06-02: the leaderboard must open ONLY when the student
  // clicks its triangle — renderStage must not force `.open` on it on ANY stage
  // (the previous Wrap-up auto-open read as the page opening it by itself).
  assert.doesNotMatch(SCRIPT, /lb\.open\s*=\s*true/,
    "renderStage must not auto-open the leaderboard on any stage");
});

/* ---------------------- Stage-1 callouts demoted ---------------------- */

test(".everyone-talks stays fully demoted (class retired — no CSS at all)", () => {
  // 2026-07-17 (editorial-illustrations slice): the markup node was removed in
  // a later UX pass and the leftover CSS was dead weight against the perf
  // budget. Full absence is the strongest form of the original demotion —
  // guard that the loud callout never comes back.
  assert.doesNotMatch(CSS, /\.everyone-talks\b/, ".everyone-talks must stay retired");
});

test(".chart-team-warning stays fully demoted (class retired — no CSS at all)", () => {
  assert.doesNotMatch(CSS, /\.chart-team-warning\b/, ".chart-team-warning must stay retired");
});

test("the next-step coach is preserved as the single focal callout", () => {
  // it stays a real bordered/filled callout — the ONE thing the eye lands on
  const body = ruleBody(".next-step-coach");
  assert.match(body, /border|background/,
    ".next-step-coach should remain a visible callout (the single focal instruction)");
});

/* ---------------------- reduced-motion scrolls ---------------------- */

test("all programmatic smooth scrollIntoView calls respect reducedMotion()", () => {
  // no unguarded smooth scrollIntoView should remain
  assert.doesNotMatch(SCRIPT, /scrollIntoView\(\{\s*behavior:\s*"smooth"/,
    "smooth scrollIntoView must be gated by reducedMotion()");
  // and the guarded form must be present (we guarded 3 sites)
  const guarded = [...SCRIPT.matchAll(/scrollIntoView\(\{\s*behavior:\s*reducedMotion\(\)\s*\?\s*"auto"\s*:\s*"smooth"/g)];
  assert.ok(guarded.length >= 3,
    "expected at least 3 reducedMotion-guarded scrollIntoView calls, found " + guarded.length);
});
