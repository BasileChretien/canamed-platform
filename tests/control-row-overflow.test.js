/* tests/control-row-overflow.test.js
 *
 * UX-overload Phase-3 item #5: control-row clarity. On narrow viewports
 * "Call a facilitator" becomes the primary action and the secondary room
 * actions (Teams / observe / leave) collapse behind a "More" disclosure,
 * cutting the control-row clutter.
 *
 * The hard constraint: .stage-controls is SHARED by the participant AND admin
 * room views, so the change is scoped to a .stage-controls--participant
 * modifier and an overflow <details> that ONLY the participant row carries.
 * On desktop that <details> is display:contents, so the buttons flow inline
 * exactly as before.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
const EN = fs.readFileSync(path.join(PLATFORM, "i18n.js"), "utf8");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

// The participant control row (the one carrying #call-prof-btn).
const partRow = INDEX.match(/<div class="stage-controls stage-controls--participant">[\s\S]*?<\/div>\s*<\/div>/);

test("the participant control row is scoped with a modifier class", () => {
  assert.match(INDEX, /class="stage-controls stage-controls--participant"/,
    "the participant row must carry .stage-controls--participant");
  // there must still be a PLAIN .stage-controls (the admin row) that is NOT
  // the participant one — i.e. the modifier is not applied globally
  assert.match(INDEX, /class="stage-controls">/,
    "the admin row must keep a plain .stage-controls (unscoped, untouched)");
});

test("Call a facilitator stays in the row; Teams/leave move to an overflow", () => {
  assert.ok(partRow, "participant stage-controls block not found");
  const row = partRow[0];
  // #call-prof-btn is a direct primary control (NOT inside the overflow menu)
  const overflowStart = row.indexOf('class="stage-overflow"');
  const callAt = row.indexOf('id="call-prof-btn"');
  assert.ok(callAt > 0, "#call-prof-btn must be present");
  assert.ok(overflowStart > 0, "the .stage-overflow <details> must exist");
  assert.ok(callAt < overflowStart, "#call-prof-btn must stay ahead of (outside) the overflow");
  // the secondary actions live inside the overflow menu. ("I'm just observing"
  // / #observer-btn was removed 2026-06-02 — Teams + Leave remain.)
  const menu = row.match(/<div[^>]*class="stage-overflow-menu"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(menu, ".stage-overflow-menu must exist");
  for (const id of ["teams-btn", "leave-btn"]) {
    assert.ok(menu[0].includes('id="' + id + '"'), id + " must be inside the overflow menu");
  }
  assert.ok(!menu[0].includes('id="observer-btn"'),
    "the removed observer-btn must NOT reappear in the overflow menu");
  assert.ok(!menu[0].includes('id="call-prof-btn"'), "Call must NOT be in the overflow");
});

test("the admin stage-controls is untouched (no participant scoping / overflow)", () => {
  // isolate the admin row: the stage-controls that contains the admin buttons
  const adminRow = INDEX.match(/<div class="stage-controls">[\s\S]*?admin-download-btn[\s\S]*?<\/div>/);
  assert.ok(adminRow, "admin stage-controls not found");
  assert.ok(!adminRow[0].includes("stage-controls--participant"), "admin row must not be scoped as participant");
  assert.ok(!adminRow[0].includes("stage-overflow"), "admin row must not gain an overflow");
});

test("desktop keeps the buttons inline (display:contents); narrow collapses them", () => {
  // desktop: the overflow wrapper is display:contents + the toggle hidden
  assert.match(CSS, /\.stage-controls--participant\s+\.stage-overflow\s*\{\s*display:\s*contents/,
    "desktop must keep the overflow inline via display:contents");
  assert.match(CSS, /\.stage-controls--participant\s+\.stage-overflow-toggle\s*\{\s*display:\s*none/,
    "desktop must hide the More toggle");
  // narrow: a max-width:720px block that makes Call full-width + a real menu
  const mq = (CSS.match(/@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\n\}/g) || [])
    .find((b) => b.includes("stage-controls--participant"));
  assert.ok(mq, "a <=720px block must restyle the participant control row");
  assert.match(mq, /#call-prof-btn\s*\{[\s\S]*?flex:\s*1 1 100%/, "Call must go full-width primary on narrow");
  assert.match(mq, /\.stage-overflow-toggle\s*\{[\s\S]*?min-height:\s*44px/, "the More toggle must be a 44px target");
});

test("the More label ships an EN key (fr/ja parity enforced by i18n.test)", () => {
  assert.match(INDEX, /data-i18n="room\.more"/, "the More toggle must be localized");
  assert.match(EN, /"room\.more":\s*"More"/, "room.more EN string must exist");
});

test("the toggle is a real disclosure button (valid HTML, not a nested control)", () => {
  assert.ok(partRow, "participant stage-controls block not found");
  const row = partRow[0];
  // A <button> with the disclosure ARIA pattern — NOT a <details>/<summary>
  // (a closed <details> hides its content even when display:contents on
  // WebKit/Android, which would break the desktop inline layout).
  assert.match(row, /<button[^>]*class="stage-overflow-toggle"[^>]*aria-expanded="false"/,
    "the toggle must be a button with aria-expanded");
  assert.match(row, /aria-controls="stage-overflow-menu"/, "the toggle must point at its menu");
  // It must not be a <details>/<summary> (a closed <details> hides its content
  // even when display:contents on WebKit/Android). Check the live markup with
  // HTML comments stripped, so the explanatory comment mentioning <details>
  // doesn't trip the guard.
  const markup = row.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!markup.includes("<details") && !markup.includes("<summary"),
    "must not use <details>/<summary> (cross-engine display:contents hazard)");
});

test("initStageOverflow toggles the menu, is wired, and is keyboard-dismissible", () => {
  assert.ok(JS.includes("function initStageOverflow("), "initStageOverflow must exist");
  assert.match(fnBody("wireRoomUI"), /initStageOverflow\(\)/, "wireRoomUI must wire it");
  const fn = fnBody("initStageOverflow");
  assert.match(fn, /classList\.toggle\("is-open"/, "must toggle .is-open on the wrapper");
  assert.match(fn, /aria-expanded/, "must keep aria-expanded in sync");
  assert.match(fn, /"Escape"/, "must close on Escape");
  assert.match(fn, /!wrap\.contains\(/, "must close on outside click");
});
