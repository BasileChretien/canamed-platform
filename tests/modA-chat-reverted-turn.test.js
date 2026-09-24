/* tests/modA-chat-reverted-turn.test.js
 *
 * Two Module A chat defects found by the review of #413 (2026-09-24):
 *
 *   1. A REFUSED turn rendered twice and never left. The RTDB web SDK applies a
 *      write locally first and reverts it when the rules refuse it — the chat's
 *      update() and then its fallback set() each raised child_added followed by
 *      child_removed (probed against the emulator; see
 *      tests/localdb-child-removed.test.js). The chat rendered on child_added and
 *      had no child_removed handler, so a reply refused after "End session"
 *      showed twice. It now tags every bubble with its turn key and removes the
 *      bubble (and the replay-cache entry) on child_removed.
 *
 *   2. A score chip landed in the WRONG section. _showScoreFeedback ran at settle
 *      time against _threadEl(res.character || activeId), i.e. the thread of the
 *      section on screen THEN — and of whoever is active then, not who was asked.
 *      It now draws the chip only when the student is still on the asked section,
 *      in the asked character's thread; the toast still reports the points.
 *
 * Behaviour per device: tests-e2e/modA-chat-wait.spec.js ("a turn the store
 * takes back…", "points scored while the student is on another section…").
 * The wiring — including the idempotency invariant (a listener attached in
 * modALLMInit() must be detached in destroy()) — is pinned here.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const INIT = fs.readFileSync(path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "modA-llm-init.js"), "utf8");
const fnOf = (name, len) => {
  const at = INIT.indexOf("function " + name + "(");
  assert.ok(at > 0, name + " must exist");
  return INIT.slice(at, at + (len || 1500));
};

test("child_removed is subscribed next to child_added, and detached in destroy() (idempotency invariant)", () => {
  assert.match(INIT, /refs\.chat\.on\("child_added", _onChatChild\);\s*refs\.chat\.on\("child_removed", _onChatRemoved\);/);
  assert.match(fnOf("destroy", 1600), /refs\.chat\.off\("child_removed", _onChatRemoved\);/,
    "a re-init without this would stack removal handlers, like the 2026-06-22 double-render");
});

test("every rendered turn carries its key — live and on a section rebuild", () => {
  assert.match(fnOf("_renderTurn", 700), /return bub;/, "_renderTurn hands back the bubble so it can be tagged");
  assert.match(fnOf("_onChatChild", 1600), /t\.__key = snap\.key;/, "the replay cache remembers the key");
  assert.match(fnOf("_onChatChild", 1600), /_tagTurn\(_renderTurn\(/);
  assert.match(fnOf("_rebuildForSlot", 1200), /_tagTurn\(_renderTurn\(_threadEl\(who\), t\.role, t\.content\), t\.__key\)/);
});

test("a removed turn leaves the screen AND the replay cache", () => {
  const f = fnOf("_onChatRemoved", 1200);
  assert.match(f, /turns\.splice\(i, 1\)/, "else a section rebuild would bring it back");
  assert.match(f, /getAttribute\("data-turn-key"\) === key/,
    "matched by attribute value, not by a selector built from the key");
  assert.match(f, /removeChild\(/);
});

test("the score chip is drawn only on the asked section, in the asked character's thread", () => {
  const f = fnOf("_onSubmit", 3400);
  assert.match(f, /var askedSlot = activeSlotId;/, "the section is captured at submit");
  assert.match(f,
    /_showScoreFeedback\(res, activeSlotId === askedSlot \? _threadEl\(\(res && res\.character\) \|\| askedId\) : null\);/,
    "on another section there is no right thread to draw in — the toast alone reports the points");
  assert.doesNotMatch(f, /_showScoreFeedback\(res, _threadEl\(\(res && res\.character\) \|\| activeId\)\)/,
    "the old call drew into whatever section and character were on screen at settle");
});
