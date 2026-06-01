/* tests/waiting-status-i18n.test.js
 *
 * Regression guard for the UX/i18n fix (2026-06-01): the waiting-room status
 * line was hardcoded English even though waiting.status-* keys already shipped
 * in en/fr/ja — so French/Japanese participants saw English on the waiting
 * screen. updateWaitingStatus() now uses the keys, and the canamed:langchange
 * handler re-calls it so a mid-wait language switch updates the line.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

global.window = undefined;
global.self = undefined;
const i18n = require(path.join(PLATFORM, "i18n.js"));
const T = i18n._T;

test("updateWaitingStatus uses the i18n keys, not hardcoded English", () => {
  const at = SCRIPT.indexOf("function updateWaitingStatus");
  assert.ok(at !== -1, "updateWaitingStatus must exist");
  const block = SCRIPT.slice(at, at + 700);
  assert.match(block, /tFallback\("waiting\.status-starting"/,
    "the 'starting' message must come from i18n");
  assert.match(block, /tFallback\("waiting\.status-not-started"/,
    "the 'waiting' message must come from i18n");
  // the old hardcoded English string must be gone from the function body
  assert.doesNotMatch(block, /textContent = started\s*\n?\s*\?\s*"The session has started/,
    "the status must no longer be a hardcoded English ternary");
});

test("the placement-failed error message is localised", () => {
  assert.match(SCRIPT, /tFallback\("waiting\.status-place-failed"/,
    "the placement-failed error must use an i18n key");
});

test("the language-switch handler re-renders the waiting status", () => {
  assert.match(SCRIPT, /callIfFn\("updateWaitingStatus"\)/,
    "canamed:langchange must re-call updateWaitingStatus");
});

test("waiting status keys exist in en/fr/ja with distinct translations", () => {
  const keys = ["waiting.status-not-started", "waiting.status-starting", "waiting.status-place-failed"];
  for (const k of keys) {
    for (const lang of ["en", "fr", "ja"]) {
      assert.ok(typeof T[lang][k] === "string" && T[lang][k].length > 0,
        `${lang}.${k} must be a non-empty string`);
    }
    assert.notStrictEqual(T.fr[k], T.en[k], `${k} fr must differ from en`);
    assert.notStrictEqual(T.ja[k], T.en[k], `${k} ja must differ from en`);
  }
});
