/* tests/chat-closed-session.test.js
 *
 * Found live 2026-09-09 ("the chatbot is not working: it says thinking but no
 * reply is written"): once a session is ENDED (`closed` exists) the rules
 * refuse every roomChat write, but the chat kept accepting questions. The
 * question was relayed to the model, the reply came back, and neither was ever
 * rendered — the transcript is DB-driven, both writes were denied, the status
 * cleared, the input stayed open, and the only trace was an SDK warning in the
 * console. Reproduced on the live site by ending a session and typing in it.
 *
 * Contract pinned here:
 *   1. script.js publishes the closed state (flag + event) from renderClosedState,
 *      for admins too — their room view cannot write turns either.
 *   2. The chat locks and SAYS so when the session is closed — at mount if the
 *      flag is already set, and on the event if it arrives later — and refuses a
 *      submit while closed.
 *   3. A refused turn write surfaces a status line instead of vanishing.
 *   4. The strings exist in EN and in the two locales that carry the chat chrome.
 * Functional cover: tests-e2e/modA-chat-closed.spec.js (LOCAL mode, 4 viewports).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(P, f), "utf8");
const SCRIPT = read("script.js");
const INIT = read("modA-llm-init.js");
const I18N = read("i18n.js");

function fnOf(src, name, len) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at > 0, name + " must exist");
  return src.slice(at, at + (len || 2500));
}

test("renderClosedState publishes the closed state — flag first, then the event, before the admin early-return", () => {
  const f = fnOf(SCRIPT, "renderClosedState", 2000);
  const flag = f.indexOf("window.CANAMED_SESSION_CLOSED = isClosed;");
  const evt = f.indexOf('new CustomEvent("canamed:sessionclosed"');
  const adminReturn = f.indexOf("if (isAdminLike) {");
  assert.ok(flag > 0 && evt > flag, "flag before event, so a listener can read it");
  assert.ok(adminReturn > evt, "published BEFORE the admin early-return — the admin's room view cannot write turns either");
});

test("the chat locks on the closed flag at mount and on the event, and refuses a submit while closed", () => {
  const f = fnOf(INIT, "_applyClosedState", 900);
  assert.match(f, /if \(!window\.CANAMED_SESSION_CLOSED\) return;/);
  assert.match(f, /inputEl\.disabled = true;/);
  assert.match(f, /sendEl\.disabled = true;/);
  assert.match(f, /_setStatus\(statusEl, msg, "warn"\);/);
  assert.match(f, /"modA\.chat\.closed"/);
  assert.match(INIT, /window\.addEventListener\("canamed:sessionclosed", _applyClosedState\);\s*_applyClosedState\(\);/,
    "listen for a later close AND apply once now — the chat may mount after the flag was set");
  assert.match(INIT, /window\.removeEventListener\("canamed:sessionclosed", _applyClosedState\)/, "destroy() unhooks it");
  const submit = fnOf(INIT, "_onSubmit", 400);
  assert.match(submit, /if \(window\.CANAMED_SESSION_CLOSED\) \{ _applyClosedState\(\); return; \}/,
    "a submit while closed must not reach the model");
});

test("a refused turn write surfaces a status line instead of vanishing", () => {
  const at = INIT.indexOf("persistTurn: function (role, content, characterId, slot) {");
  assert.ok(at > 0);
  const f = INIT.slice(at, at + 2600);
  assert.match(f, /p\["catch"\]\(function \(\) \{\s*_setStatus\(statusEl, _t\("modA\.chat\.save-failed"/,
    "the fallback set's rejection must reach the status line");
});

test("the two strings exist in EN and in fr/ja (the locales that carry the chat chrome)", () => {
  for (const k of ['"modA.chat.closed"', '"modA.chat.save-failed"']) {
    assert.ok(I18N.includes(k), k + " in i18n.js");
    assert.ok(read("locales/fr.js").includes(k), k + " in fr");
    assert.ok(read("locales/ja.js").includes(k), k + " in ja");
  }
});
