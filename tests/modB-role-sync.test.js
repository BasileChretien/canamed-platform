/* tests/modB-role-sync.test.js
 *
 * Lock-in for the Module B role-pick sync (roleplay review 2026-05-20):
 * the role picker was local-only, so two students could both "claim
 * physician" invisibly. Each student now publishes their own choice
 * (keyed by clientId, protected by the same clientMapping ownership rule
 * as presence/typing); everyone sees the live picks and a double-pick is
 * surfaced for social resolution.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const RULES  = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const INDEX  = fs.readFileSync(path.join(P, "index.html"), "utf8");
const I18N   = require("./_i18n_source.js").readI18nSource();

const sessRoom = RULES.rules.sessions["$sessionId"].rooms["$roomId"];
const orgRoom  = RULES.rules.orgs["$orgSlug"].sessions["$sessionId"].rooms["$roomId"];

test("rules: /sessions roleChoices/$clientId carries the clientMapping ownership guard", () => {
  const node = sessRoom.roleChoices && sessRoom.roleChoices["$clientId"];
  assert.ok(node, "sessions tree must declare rooms/$roomId/roleChoices/$clientId");
  const w = node[".write"];
  assert.match(w, /clientMapping'\)\.child\(\$clientId\)/,
    "roleChoices write must be gated by the clientMapping ownership check");
  assert.match(w, /closed'\)\.exists\(\)/, "roleChoices write must be refused on closed sessions");
  assert.match(node[".validate"], /child\('role'\)\.isString\(\)/,
    "roleChoices must validate a string role");
});

test("rules: /orgs roleChoices mirrors the /sessions guard", () => {
  const node = orgRoom.roleChoices && orgRoom.roleChoices["$clientId"];
  assert.ok(node, "orgs tree must declare roleChoices/$clientId");
  assert.match(node[".write"], /clientMapping'\)\.child\(\$clientId\)/);
});

test("script.js: role pick is published + rendered live, and torn down per-room", () => {
  assert.match(SCRIPT, /refRoleChoices\s*=\s*db\.ref\(base\s*\+\s*"\/roleChoices"\)/,
    "startRoom must wire refRoleChoices");
  assert.match(SCRIPT, /if \(refRoleChoices\) refRoleChoices\.off\(\)/,
    "teardownRoom must detach refRoleChoices");
  assert.match(SCRIPT, /refRoleChoices\.child\(clientId\)\.set\(\{/,
    "picking a role must publish the choice keyed by clientId");
  assert.match(SCRIPT, /function renderRoleChoices\(/,
    "renderRoleChoices must exist");
  // names rendered via textContent, never innerHTML (no injection via name)
  const fn = SCRIPT.slice(SCRIPT.indexOf("function renderRoleChoices"),
    SCRIPT.indexOf("function renderRoleChoices") + 1400);
  assert.match(fn, /\.textContent\s*=/, "claimant names must be set via textContent");
  assert.doesNotMatch(fn, /\.innerHTML/, "renderRoleChoices must not use innerHTML");
});

test("index.html: a double-pick clash note exists in the role picker", () => {
  assert.match(INDEX, /id="role-clash-note"[^>]*data-i18n="modB.role.clash"/,
    "the clash note must exist with the i18n key");
});

test("i18n: modB.role.clash is present in en/fr/ja", () => {
  const n = I18N.split('"modB.role.clash"').length - 1;
  assert.strictEqual(n, 3, "modB.role.clash must appear in all three language blocks (got " + n + ")");
});
