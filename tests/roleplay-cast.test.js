/* tests/roleplay-cast.test.js
 *
 * S1c-1 of the section model: a Roleplay section's CAST is data.
 *
 * Before this, the cast was hardcoded in three places at once — the four
 * `.role-chip` buttons in index.html, ASSIGN_ROLE_DECK and REPLAY_ROLE_ORDER —
 * so every roleplay on the platform was necessarily physician / patient /
 * family / observer with Mrs Tanaka's briefs. A facilitator authoring their own
 * roleplay had nothing to change. It is now one list read from the active
 * section, defaulting to today's four.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8") +
  /* S3a — the roleplay content renderers were extracted to the room-only
     section-content.js chunk to reclaim splash bytes. These assertions are
     about the CODE, not about which file carries it. */
  fs.readFileSync(path.join(P, "section-content.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");

/* Slice the cast resolver out and run it — real behaviour, not a source regex. */
function cast(win) {
  const start = SCRIPT.indexOf("const ROLEPLAY_DEFAULT_ROLES");
  assert.ok(start > -1, "the default cast must exist");
  /* S3a — the block moved to section-content.js, which is APPENDED to the
     script.js source above; SECTION_TYPE_FOR_MODULE sits earlier in script.js,
     so it can no longer serve as the end marker. */
  const end = SCRIPT.indexOf("const ROLEPLAY_PANEL_IDS", start);
  assert.ok(end > start, "the cast block must be followed by the panel block");
  const src = SCRIPT.slice(start, end) +
    "\nreturn { ROLEPLAY_DEFAULT_ROLES, roleplayRoles, roleplayRoleIds, roleplayRole };";
  // eslint-disable-next-line no-new-func
  return new Function("window", src)(win || {});
}

test("with no declaration, the cast is today's four roles in today's order", () => {
  assert.deepEqual(cast({}).roleplayRoleIds(),
    ["physician", "patient", "family", "observer"]);
});

test("the default roles keep resolving through their existing i18n keys", () => {
  const r = cast({}).roleplayRole("family");
  assert.equal(r.nameKey, "modB.role.family.name");
  assert.equal(r.briefKey, "modB.role.family.brief");
});

test("a section may declare its own cast — any size, any names", () => {
  const c = cast({ CURRENT_SECTION_ROLEPLAY: { roles: [
    { id: "pharmacist", name: "Community pharmacist", brief: "You dispensed it." },
    { id: "prescriber", name: "Prescriber" },
    { id: "observer" }
  ] } });
  assert.deepEqual(c.roleplayRoleIds(), ["pharmacist", "prescriber", "observer"]);
  assert.equal(c.roleplayRole("pharmacist").brief, "You dispensed it.");
  /* An id that matches a default inherits that default's i18n keys, so a
     section can rename one role without restating the shipped translations. */
  assert.equal(c.roleplayRole("observer").nameKey, "modB.role.observer.name");
  assert.equal(c.roleplayRole("prescriber").nameKey, null);
});

test("malformed role ids are dropped — they become DOM attrs and RTDB keys", () => {
  const c = cast({ CURRENT_SECTION_ROLEPLAY: { roles: [
    { id: "nurse" },
    { id: "Has Spaces" }, { id: "UPPER" }, { id: "" }, { id: "x".repeat(40) },
    { id: "nurse" },                       // duplicate would break the deck
    { id: "relative" }
  ] } });
  assert.deepEqual(c.roleplayRoleIds(), ["nurse", "relative"]);
});

test("a declaration with nothing usable falls back rather than leaving no cast", () => {
  const c = cast({ CURRENT_SECTION_ROLEPLAY: { roles: [{ id: "Nope!" }] } });
  assert.deepEqual(c.roleplayRoleIds(),
    ["physician", "patient", "family", "observer"],
    "a roleplay with an empty cast would be unrunnable");
  assert.deepEqual(cast({ CURRENT_SECTION_ROLEPLAY: {} }).roleplayRoleIds(),
    ["physician", "patient", "family", "observer"]);
});

test("the random-assign deck and the swap rotation both read the cast", () => {
  /* S3a — the cast/phase code moved to the room-only section-content.js
     chunk, whose load failure is deliberately swallowed, so script.js
     calls it through a guarded accessor that falls back to the shipped
     defaults rather than throwing. */
  assert.match(SCRIPT, /function assignRoleDeck\(\)[\s\S]*?roleplayRoleIds\(\)/);
  assert.match(SCRIPT, /function replayRoleOrder\(\)[\s\S]*?roleplayRoleIds\(\)/);
  assert.match(SCRIPT, /ROLEPLAY_FALLBACK_ROLE_IDS/,
    "absence of the chunk must degrade to the shipped four, not throw");
  assert.ok(!/const ASSIGN_ROLE_DECK = \[/.test(SCRIPT),
    "the hardcoded deck must be gone");
  assert.ok(!/const REPLAY_ROLE_ORDER = \[/.test(SCRIPT),
    "the hardcoded rotation must be gone");
});

test("extra participants spill into the LAST declared role, not a literal observer", () => {
  const i = SCRIPT.indexOf("function _roleDeckFor(");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\n}", i));
  assert.match(fn, /const spare = cast\[cast\.length - 1\]/,
    "an authored cast may not have a role called 'observer'");
});

test("applyScenario always reassigns the roleplay block, including to null", () => {
  const i = SCRIPT.indexOf("window.CURRENT_SECTION_ROLEPLAY =");
  assert.ok(i > -1, "applyScenario must publish the section's roleplay content");
  const line = SCRIPT.slice(i, SCRIPT.indexOf("\n", i));
  assert.match(line, /: null;/,
    "a scenario without a roleplay block must NOT inherit the previous one's cast");
});

test("chips are rebuilt without innerHTML, and left alone when unchanged", () => {
  const i = SCRIPT.indexOf("function renderRoleChips(");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nfunction initRolePicker", i));
  assert.ok(!/innerHTML/.test(fn), "a role name is facilitator-authored text");
  assert.match(fn, /createElement\("button"\)/);
  assert.match(fn, /if \(current\.join\(","\) === cast\.map\(r => r\.id\)\.join\(","\)\) return;/,
    "the built-in chips (and their i18n attributes) must be left untouched");
  assert.match(fn, /picker\._wired = false;[\s\S]*initRolePicker\(\)/,
    "the picker wires its listeners once — it must be re-armed over new chips");
});

test("the shipped chip row still carries the four built-in roles", () => {
  ["physician", "patient", "family", "observer"].forEach(r => {
    assert.ok(HTML.indexOf('data-role="' + r + '"') > -1,
      r + " must remain in the shell markup (the default cast renders no-op)");
  });
});
