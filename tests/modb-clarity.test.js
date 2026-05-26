/* tests/modb-clarity.test.js
 *
 * Dry-run feedback (2026-05-26): drop the "an observer reads these out aloud"
 * script, and clarify the Module B ground-rules step (its purpose / when it
 * applies). Static source-text checks across en/fr/ja + the inline coach copy.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("the 'observer reads aloud' script is gone from the ground rule + coach copy", () => {
  assert.doesNotMatch(I18N, /reads this aloud/i, "EN ground rule must drop 'an observer reads this aloud'");
  assert.doesNotMatch(I18N, /reads them aloud/i, "EN coach copy must drop 'the observer reads them aloud'");
  assert.doesNotMatch(I18N, /à voix haute par un·e observateur/i, "FR must drop the read-aloud script");
  assert.doesNotMatch(I18N, /観察者が声に出して読み/, "JA must drop the read-aloud script");
  assert.doesNotMatch(SCRIPT, /The observer reads them aloud/i,
    "the inline Module B coach fallback must drop the read-aloud script");
});

test("the ground rule now states which step it applies to (purpose/timing)", () => {
  // EN key still present and now scoped to the Phase 3 discussion.
  assert.match(I18N, /Ground rule for this discussion \(Phase 3\)/,
    "the EN ground rule must say it is for the Phase 3 discussion");
  // key still defined in all three languages
  const n = I18N.split('"stage.modB.phase3.ground-rule"').length - 1;
  assert.strictEqual(n, 3, "stage.modB.phase3.ground-rule must stay in en/fr/ja (got " + n + ")");
});
