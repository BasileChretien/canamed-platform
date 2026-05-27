/* tests/modA-milestone-spoiler.test.js
 *
 * The Module A milestone celebration toasts fire for EVERY teammate when the
 * synced room score changes — and re-fire on resync after a phone unlock or
 * tab refocus. So their `did` text must celebrate the PROCESS STEP, never the
 * clinical OUTCOME: a passive teammate must not get the answer handed to them.
 *
 * Dry-run 2026-05-27: a facilitator's locked phone unlocked to a toast saying
 * the team had "found the diagnosis". This guard stops outcome-announcing copy
 * from creeping back into the synced SCORE_AUTO milestones.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "script.js"),
  "utf8"
);

// Pull a single SCORE_AUTO entry's object-literal text by key (entries have no
// nested braces, so a non-greedy {...} match is exact).
function autoEntry(key) {
  const m = new RegExp(key + ":\\s*\\{[^}]*\\}").exec(SRC);
  assert.ok(m, "SCORE_AUTO." + key + " milestone must exist");
  return m[0];
}

const SPOILER = /found the diagnos|working diagnosis|reached a diagnosis/i;

test("the synthesis milestone toast celebrates the step, not the diagnosis", () => {
  const entry = autoEntry("synthesis");
  assert.ok(!SPOILER.test(entry),
    "synthesis milestone `did` must not announce a diagnosis/outcome (it fires for passive teammates): " + entry);
  assert.match(entry, /synthesis/i, "synthesis milestone should still name the synthesis step");
});

test("the diagnostic-restraint milestone toast does not announce a diagnosis", () => {
  const entry = autoEntry("restraint");
  assert.ok(!SPOILER.test(entry),
    "restraint milestone `did` must not announce a diagnosis/outcome: " + entry);
});
