/* tests/stage-now-deduped.test.js
 *
 * UX de-clutter (2026-06-01). The always-on "do this now" header line
 * (STAGE_NOW) used to repeat the whole module flow for Module A and Module B —
 * "Work the case up: ask, examine, investigate — then debate…" / "Run the
 * breaking-bad-news roleplay…" — duplicating the localized, state-aware
 * next-step coach that already owns "what to do now" inside each module.
 *
 * Every SECTION stage is blank; Welcome and Wrap-up keep their line (there is
 * no coach on those two). renderStage() renders stageNow(viewStage).
 *
 * S1b replaced the index-keyed array with a role-keyed map + stageNow(): a
 * section can now sit at any stage number, so "index 1 is Module A" stopped
 * being true. The invariant is unchanged and is now expressed directly —
 * stageNow() returns "" for everything that is not an end.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

test("STAGE_NOW blanks every module slot and keeps Welcome + Wrap-up", () => {
  const i = SCRIPT.indexOf("const STAGE_NOW_BY_ROLE");
  assert.ok(i > 0, "the role-keyed now-line map must exist");
  const map = SCRIPT.slice(i, SCRIPT.indexOf("};", i));
  assert.match(map, /welcome:\s*"[^"]+"/, "Welcome keeps its line");
  assert.match(map, /wrapup:\s*"[^"]+"/, "Wrap-up keeps its line");
  assert.equal((map.match(/"/g) || []).length / 2, 2,
    "ONLY the two ends may carry a line — a section stage must stay blank so " +
    "the in-module coach remains the single source of 'what to do now'");

  const j = SCRIPT.indexOf("function stageNow(");
  const fn = SCRIPT.slice(j, SCRIPT.indexOf("\n}", j));
  assert.match(fn, /return "";/,
    "stageNow() must return an empty line for every section stage");
});

test("the old duplicated Module A / Module B STAGE_NOW lines are gone", () => {
  assert.doesNotMatch(SCRIPT, /Work the case up: ask, examine, investigate/,
    "the Module A STAGE_NOW flow line must be removed (the coach owns it)");
  assert.doesNotMatch(SCRIPT, /Run the breaking-bad-news roleplay in your group/,
    "the Module B STAGE_NOW flow line must be removed (the coach owns it)");
});
