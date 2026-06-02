/* tests/modA-text-consolidation.test.js
 *
 * UX de-clutter (2026-06-01). Module A stacked several overlapping texts at the
 * top of the case:
 *   - modA.vignette.hint    ("Decide what to ask, examine and investigate … unlocks
 *                             the discussion prompts") — duplicated the coach +
 *                             the investigations-locked hint;
 *   - modA.vignette.everyone ("Work as equals — every voice…") — duplicated
 *                             modA.discussion.compare-rule, pinned in the
 *                             Discussion panel exactly when relevant;
 *   - modA.chart.subtitle + modA.chart.team-click-warning — two near-identical
 *                             "shared chart / every click is a team decision"
 *                             lines repeating the same verb-list.
 *
 * The two vignette hints are removed; subtitle + team-click-warning are merged
 * into one line. These guards stop the duplication creeping back.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const I18N = fs.readFileSync(path.join(PLATFORM, "i18n.js"), "utf8");

test("the retired Module A vignette hints are gone from the markup", () => {
  assert.doesNotMatch(INDEX, /data-i18n="modA\.vignette\.hint"/,
    "modA.vignette.hint paragraph must be removed from index.html");
  assert.doesNotMatch(INDEX, /data-i18n="modA\.vignette\.everyone"/,
    "modA.vignette.everyone paragraph must be removed from index.html");
});

test("the separate chart subtitle paragraph is gone (merged into the team line)", () => {
  assert.doesNotMatch(INDEX, /data-i18n="modA\.chart\.subtitle"/,
    "modA.chart.subtitle paragraph must be removed from index.html");
});

test("the single merged chart team-line survives and carries both ideas", () => {
  assert.match(INDEX, /data-i18n="modA\.chart\.team-click-warning"/,
    "the merged team line must still be present under the chart header");
  // EN canonical now carries the 'shared chart' framing AND the discuss-first rule.
  const m = I18N.match(/"modA\.chart\.team-click-warning":\s*"([^"]*(?:\\.[^"]*)*)"/);
  assert.ok(m, "modA.chart.team-click-warning must exist in i18n.js");
  assert.match(m[1], /shared chart/i, "merged line must keep the 'shared chart' framing");
  assert.match(m[1], /Discuss first/i, "merged line must keep the 'discuss first' rule");
});

test("the retired i18n keys are removed from the EN canonical", () => {
  assert.doesNotMatch(I18N, /"modA\.vignette\.hint":/,
    "modA.vignette.hint must be removed from i18n.js");
  assert.doesNotMatch(I18N, /"modA\.vignette\.everyone":/,
    "modA.vignette.everyone must be removed from i18n.js");
  assert.doesNotMatch(I18N, /"modA\.chart\.subtitle":/,
    "modA.chart.subtitle must be removed from i18n.js");
});
