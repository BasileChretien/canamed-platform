/* tests/modb-role-unselect.test.js
 *
 * Dry-run feedback (2026-05-26): "allow un-selecting a role" in Module B. The
 * role picker is a radiogroup that only ever SET a role; you could never clear
 * it. Re-tapping the role you already hold now clears it (back to no role) and
 * retracts the live pick from the room. Static source-text checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

function rolePickerFn() {
  const start = SCRIPT.indexOf("function initRolePicker");
  assert.ok(start >= 0, "initRolePicker must exist");
  return SCRIPT.slice(start, start + 4000);
}

test("re-tapping the held role clears it (toggle), keyboard stays select-only", () => {
  const fn = rolePickerFn();
  assert.match(fn, /const deselect = chip =>/, "a deselect routine must exist");
  // click toggles: deselect when already checked, else select
  assert.match(fn, /getAttribute\("aria-checked"\) === "true"\) deselect\(chip\)/,
    "click must clear the role when it is already selected");
  assert.match(fn, /else select\(chip\)/, "click otherwise selects");
});

test("deselect retracts the live pick + clears local state", () => {
  const fn = rolePickerFn();
  const dz = fn.slice(fn.indexOf("const deselect"), fn.indexOf("const deselect") + 420);
  assert.match(dz, /aria-checked", "false"/, "must unset aria-checked");
  assert.match(dz, /localStorage\.removeItem\(STORAGE_KEY\)/, "must clear the saved role");
  assert.match(dz, /refRoleChoices\.child\(clientId\)\.remove\(\)/,
    "must retract the live pick so the room no longer shows you in it");
});

test("a discoverable hint tells students they can clear their role", () => {
  assert.match(INDEX, /class="role-deselect-hint"[^>]*data-i18n="modB\.role\.deselect-hint"/,
    "the picker must show a deselect hint bound to i18n");
  const n = I18N.split('"modB.role.deselect-hint"').length - 1;
  assert.strictEqual(n, 3, "modB.role.deselect-hint must ship in en/fr/ja (got " + n + ")");
});
