/* tests/modB-observer-checklist.test.js
 *
 * Lock-in for the Module B observer SPIKES checklist (2026-05-20).
 * Roleplay review flagged that the observer had no structured tool. The
 * #observer-checklist <details> gives them a 6-step SPIKES tick-list +
 * two note fields, persisted per-tab (sessionStorage) — a private
 * scratchpad with no Firebase write path.
 *
 * Static assertions over index.html / i18n.js / script.js (CRLF-aware).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX  = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const I18N   = require("./_i18n_source.js").readI18nSource();
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

const OBS_KEYS = [
  "modB.obs.title", "modB.obs.hint",
  "modB.obs.s", "modB.obs.p", "modB.obs.i", "modB.obs.k", "modB.obs.e", "modB.obs.s2",
  "modB.obs.win-label", "modB.obs.win-ph", "modB.obs.hard-label", "modB.obs.hard-ph"
];

test("index.html: #observer-checklist is a <details> with 6 SPIKES checkboxes + 2 notes", () => {
  assert.match(INDEX, /<details[^>]*id="observer-checklist"/,
    "observer-checklist must be a <details>");
  for (const step of ["s", "p", "i", "k", "e", "s2"]) {
    const re = new RegExp('data-obs="' + step + '"');
    assert.match(INDEX, re, "missing SPIKES checkbox data-obs=" + step);
  }
  assert.match(INDEX, /id="observer-note-win"/, "missing the 'what worked' note field");
  assert.match(INDEX, /id="observer-note-hard"/, "missing the 'what was hard' note field");
});

test("i18n.js: each observer key is present in all three language blocks", () => {
  for (const key of OBS_KEYS) {
    // Count occurrences of the quoted key; expect exactly 3 (en/fr/ja).
    const matches = I18N.split('"' + key + '"').length - 1;
    assert.strictEqual(matches, 3,
      "i18n key '" + key + "' must appear in en/fr/ja (got " + matches + ")");
  }
});

test("script.js: initObserverChecklist is defined, invoked, and persists per-tab", () => {
  assert.match(SCRIPT, /function initObserverChecklist\s*\(/,
    "initObserverChecklist must be defined");
  assert.match(SCRIPT, /\binitObserverChecklist\s*\(\s*\)\s*;/,
    "initObserverChecklist must be invoked at startup");
  const fnStart = SCRIPT.indexOf("function initObserverChecklist");
  const fnSlice = SCRIPT.slice(fnStart, fnStart + 1600);
  assert.match(fnSlice, /canamed_obs_spikes/,
    "checklist must key its state under canamed_obs_spikes");
  assert.match(fnSlice, /sessionStorage\.(getItem|setItem)/,
    "checklist state must persist to sessionStorage (per-tab, no Firebase)");
  // Must NOT write the observer pad to the database (it's a private scratchpad).
  assert.doesNotMatch(fnSlice, /db\.ref|firebase|sPath\(/,
    "observer pad must stay local — no Firebase write path");
});
