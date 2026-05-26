/* tests/modb-private-role-objective.test.js
 *
 * Dry-run finding (2026-05-26): Module B's role chips printed each role's
 * FULL brief publicly on every chip. That leaks the patient's hidden stance
 * ("deep down, do you want to know everything?") and the family's secret
 * request to the physician before the scene even starts — destroying the
 * roleplay. Fix: chips show only the role NAME; the selected role's objective
 * is revealed in a PRIVATE panel, only on the device of the student who picked
 * it. The brief i18n keys are reused (no new copy to translate, just a new
 * panel-label key). Static source-text checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("role chips no longer print the role brief publicly", () => {
  assert.doesNotMatch(INDEX, /role-chip-brief/,
    "the public role chips must not carry the brief span any more — it leaks hidden stances");
  // The secret instructions must not be sitting in the static chip markup.
  assert.doesNotMatch(INDEX, /deep down, do you want to know everything/i,
    "the patient's hidden stance must not be printed in the static chip markup");
  assert.doesNotMatch(INDEX, /quietly take the physician aside/i,
    "the family's secret request must not be printed in the static chip markup");
});

test("each role chip still shows the role NAME", () => {
  ["physician", "patient", "family", "observer"].forEach(role => {
    const re = new RegExp('class="role-chip-name" data-i18n="modB\\.role\\.' + role + '\\.name"');
    assert.match(INDEX, re, role + " chip must still show its name");
  });
});

test("a private objective panel exists, is a polite live region, and is hidden by default", () => {
  const m = INDEX.match(/<[^>]*id="modB-role-objective"[^>]*>/);
  assert.ok(m, "a #modB-role-objective panel must exist");
  const tag = m[0];
  assert.match(tag, /aria-live="polite"/, "the objective panel must be a polite live region");
  assert.match(tag, /\bhidden\b/, "the objective panel must start hidden (shown only once a role is picked)");
  // The label that frames it as private.
  assert.match(INDEX, /data-i18n="modB\.role\.objective-label"/,
    "the panel must carry a private-brief label bound to i18n");
  // A text element whose brief the helper fills in.
  assert.match(INDEX, /id="modB-role-objective-text"/,
    "the panel must have a text node the helper populates from the brief key");
});

test("the private-brief label ships in en/fr/ja", () => {
  const n = I18N.split('"modB.role.objective-label"').length - 1;
  assert.strictEqual(n, 3, "modB.role.objective-label must ship in en/fr/ja (got " + n + ")");
});

test("a showRoleObjective helper reuses the brief i18n keys", () => {
  assert.match(SCRIPT, /function showRoleObjective\s*\(/,
    "a showRoleObjective(role) helper must exist");
  const start = SCRIPT.indexOf("function showRoleObjective");
  const fn = SCRIPT.slice(start, start + 1200);
  // Reuse the existing brief keys rather than inventing new copy.
  assert.match(fn, /"modB\.role\." \+ role \+ "\.brief"/,
    "the helper must bind the panel to the role's existing .brief key");
  // Translate via the sanitised applyI18n path (briefs carry <strong>/<em>).
  assert.match(fn, /applyI18n/,
    "the helper must re-translate the panel via applyI18n (sanitised innerHTML)");
  assert.match(fn, /data-i18n-html/,
    "the panel text must be flagged data-i18n-html so emphasis survives");
});

test("select / deselect / restore / swap all drive the private objective panel", () => {
  const start = SCRIPT.indexOf("function initRolePicker");
  const fn = SCRIPT.slice(start, start + 4000);
  // select shows the picked role's objective
  const sel = fn.slice(fn.indexOf("const select = chip =>"), fn.indexOf("const deselect"));
  assert.match(sel, /showRoleObjective\(chip\.dataset\.role\)/,
    "select() must reveal the picked role's objective");
  // deselect hides it
  const dz = fn.slice(fn.indexOf("const deselect = chip =>"), fn.indexOf("chips.forEach(chip =>"));
  assert.match(dz, /showRoleObjective\(null\)/, "deselect() must hide the objective panel");
  // restore-from-localStorage on init reveals the saved role's objective
  assert.match(fn, /showRoleObjective\(saved\)/,
    "init must reveal the restored role's objective");
  // role swap (replay) updates the panel to the new role
  const swapStart = SCRIPT.indexOf("function applyRoleSwap");
  const swapFn = SCRIPT.slice(swapStart, swapStart + 1200);
  assert.match(swapFn, /showRoleObjective\(next\)/,
    "applyRoleSwap() must update the objective panel to the rotated role");
});
