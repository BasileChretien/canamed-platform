/* tests/side-chat-removed.test.js
 *
 * The per-room "side-chat" tab was removed (2026-05-27): it was unused and
 * non-functional in practice. This guard stops it silently reappearing —
 * the tab/panel DOM and its i18n keys must stay gone.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("side-chat DOM (tab + panel + input) is gone from index.html", () => {
  assert.ok(!INDEX.includes('data-tab="chat"'), "the side-chat tab button must be removed");
  assert.ok(!INDEX.includes('id="rcol-p-chat"'), "the side-chat panel must be removed");
  assert.ok(!INDEX.includes('id="chat-list"'), "the chat message list must be removed");
  assert.ok(!INDEX.includes('id="chat-input"'), "the chat input must be removed");
  assert.ok(!INDEX.includes('id="chat-send"'), "the chat send button must be removed");
});

test("side-chat i18n keys are gone (en/fr/ja)", () => {
  assert.ok(!/"rcol\.chat\./.test(I18N), "no rcol.chat.* keys should remain");
  assert.ok(!/"rcol\.tab\.chat"/.test(I18N), "the rcol.tab.chat label must be removed");
});
