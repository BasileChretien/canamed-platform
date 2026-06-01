/* tests/stage1-progress-hierarchy.test.js
 *
 * Regression guard for the UX-overload fix (2026-06-01) that de-duplicates
 * the two competing progress strips at the top of Stage 1 (the phase
 * stepper + the per-bullet checklist) and gives the consultation note the
 * single focal heading.
 *
 * Pins that the changes are SCOPED to #stage-1 (so the shared .card /
 * .vignette / phase-stepper styles used on other stages + the
 * scenario-author surface are not globally restyled). Static CSS assertions.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "style.css"),
  "utf8");

test("the per-bullet checklist is de-emphasised under #stage-1 (secondary to the phase stepper)", () => {
  assert.match(CSS, /#stage-1 \.modA-bullet-progress\s*\{[^}]*font-size/,
    "the Stage-1 bullet-progress strip should be visually secondary");
});

test("the consultation note carries the single focal heading under #stage-1", () => {
  assert.match(CSS, /#stage-1 \.consultation-note-title\s*\{[^}]*font-size/,
    "the consultation-note title should be the focal heading on Stage 1");
});

test("the progress + heading hierarchy tweaks are SCOPED to #stage-1 (no global restyle)", () => {
  // each added rule must be #stage-1-prefixed — guards against a future edit
  // dropping the scope and restyling .card / .vignette / phase-stepper or the
  // consultation-note title everywhere (incl. the scenario-author surface).
  assert.match(CSS, /#stage-1 \.phase-stepper\s*\{\s*margin-bottom:\s*6px/,
    "the phase-stepper margin tweak must be scoped to #stage-1");
  assert.match(CSS, /#stage-1 \.consultation-note-title\s*\{\s*font-size:\s*1\.18rem/,
    "the focal-heading bump must be scoped to #stage-1");
  // and we must NOT have introduced a bare global .card h3 / .vignette h2 resize
  assert.doesNotMatch(CSS, /\n\.card h3\s*\{\s*font-size:\s*1\.18rem/,
    "must not globally resize .card h3");
});
