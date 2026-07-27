/* tests/stage-now-deduped.test.js
 *
 * UX de-clutter (2026-06-01). The always-on "do this now" header line
 * (STAGE_NOW) used to repeat the whole module flow for Module A and Module B —
 * "Work the case up: ask, examine, investigate — then debate…" / "Run the
 * breaking-bad-news roleplay…" — duplicating the localized, state-aware
 * next-step coach that already owns "what to do now" inside each module.
 *
 * Every MODULE slot is blank; Welcome (0) and Wrap-up (last) keep their line
 * (there is no coach on those stages). renderStage() already renders
 * STAGE_NOW[v] || "".
 *
 * M4b added a 5th stage — the branched decision case at index 3, moving wrap-up
 * to 4 — so the shape is now [Welcome, "", "", "", Wrap-up]: three blank module
 * slots (A, B, branched).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

test("STAGE_NOW blanks every module slot and keeps Welcome + Wrap-up", () => {
  // Shape: [ <non-empty Welcome>, "", "", "", <non-empty Wrap-up> ]
  // (comments between entries are tolerated — one annotates the branched slot).
  const C = "(?:\\s*//[^\\n]*)?";   // optional trailing line comment
  const re = new RegExp(
    'const STAGE_NOW = \\[\\s*"[^"]+",' + C +
    '\\s*"",' + C + '\\s*"",' + C + '\\s*"",' + C +
    '\\s*"[^"]+",?' + C + '\\s*\\];'
  );
  assert.match(SCRIPT, re,
    "STAGE_NOW[1] (Module A), [2] (Module B) and [3] (branched) must be empty " +
    "strings, with non-empty Welcome [0] and Wrap-up [4] lines");
});

test("the old duplicated Module A / Module B STAGE_NOW lines are gone", () => {
  assert.doesNotMatch(SCRIPT, /Work the case up: ask, examine, investigate/,
    "the Module A STAGE_NOW flow line must be removed (the coach owns it)");
  assert.doesNotMatch(SCRIPT, /Run the breaking-bad-news roleplay in your group/,
    "the Module B STAGE_NOW flow line must be removed (the coach owns it)");
});
