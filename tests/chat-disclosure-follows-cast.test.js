/* tests/chat-disclosure-follows-cast.test.js
 *
 * The Module A chat's beta disclosure interpolates {patientName} at render
 * time. It was built ONCE in _mountChatUI(), so after a section change it kept
 * naming the first section's patient — seen live on the six-section Mayumi
 * session (2026-09-08): "A language model voices Mr Lefebvre" under a chat
 * addressed to Mayumi. The placeholder and the "thinking" line already
 * followed the cast; the disclosure now does too, via _renderDisclosure(),
 * called from _renderCast() on every cast change. Functional cover:
 * tests-e2e/modA-switchboard.spec.js (step 6, four viewports).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const INIT = fs.readFileSync(path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "modA-llm-init.js"), "utf8");

test("the disclosure is rendered by one function, used at mount AND on every cast change", () => {
  assert.match(INIT, /^  function _renderDisclosure\(notice\) \{/m);
  const mount = INIT.slice(INIT.indexOf("function _mountChatUI("), INIT.indexOf("function _mountChatUI(") + 600);
  assert.match(mount, /_renderDisclosure\(notice\);/, "mount renders through it");
  const cast = INIT.slice(INIT.indexOf("function _renderCast()"), INIT.indexOf("function _renderCast()") + 400);
  assert.match(cast, /_renderDisclosure\(panel\.querySelector\("\.moda-chat-disclosure"\)\);/, "a cast change re-renders it");
  assert.strictEqual((INIT.match(/_t\("modA\.chat\.disclosure"/g) || []).length, 1, "the string is looked up in exactly one place");
});

test("the disclosure still goes through DOMPurify, never raw innerHTML", () => {
  const fn = INIT.slice(INIT.indexOf("function _renderDisclosure("), INIT.indexOf("function _mountChatUI("));
  assert.match(fn, /window\.DOMPurify\.sanitize\(disclosure/);
  assert.match(fn, /notice\.textContent = disclosure\.replace\(\/<\[\^>\]\*>\/g, ""\);/, "no DOMPurify -> text only");
  assert.ok(!/notice\.innerHTML = disclosure/.test(fn));
});
