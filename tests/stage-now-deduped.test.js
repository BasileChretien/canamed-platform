/* tests/stage-now-deduped.test.js
 *
 * UX de-clutter (2026-06-01). The always-on "do this now" header line
 * (STAGE_NOW) used to repeat the whole module flow for Module A and Module B —
 * "Work the case up: ask, examine, investigate — then debate…" / "Run the
 * breaking-bad-news roleplay…" — duplicating the localized, state-aware
 * next-step coach that already owns "what to do now" inside each module.
 *
 * The two module slots are now blank; Welcome (0) and Wrap-up (3) keep their
 * line (there is no coach on those stages). renderStage() already renders
 * STAGE_NOW[v] || "".
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

test("STAGE_NOW blanks the two module slots and keeps Welcome + Wrap-up", () => {
  // Shape: [ <non-empty Welcome>, "", "", <non-empty Wrap-up> ]
  assert.match(
    SCRIPT,
    /const STAGE_NOW = \[\s*"[^"]+",\s*"",\s*"",\s*"[^"]+"\s*\];/,
    "STAGE_NOW[1] (Module A) and [2] (Module B) must be empty strings, " +
    "with non-empty Welcome [0] and Wrap-up [3] lines"
  );
});

test("the old duplicated Module A / Module B STAGE_NOW lines are gone", () => {
  assert.doesNotMatch(SCRIPT, /Work the case up: ask, examine, investigate/,
    "the Module A STAGE_NOW flow line must be removed (the coach owns it)");
  assert.doesNotMatch(SCRIPT, /Run the breaking-bad-news roleplay in your group/,
    "the Module B STAGE_NOW flow line must be removed (the coach owns it)");
});
