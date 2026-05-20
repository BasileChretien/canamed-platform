/* tests/round2-a11y-settings-focus.test.js
 *
 * Lock-in for the Round-2 a11y review item: the global settings popup
 * had no focus management (it never moved focus into the panel on open
 * nor restored focus to the cog on close). The setOpen() helper now:
 *   - moves focus into the panel (theme <select> / Close button) on open
 *   - restores focus to the cog on a deliberate close (Esc / Close button),
 *     but NOT on a click-outside close (so it doesn't steal focus).
 *
 * Static assertions on script.js (focus behaviour is wired in the
 * settings block; the suite has no DOM to exercise it at runtime).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SCRIPT = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "script.js"),
  "utf8");

// Isolate the settings-widget wiring block so we don't match focus()
// calls elsewhere in the 9k-line file.
function settingsBlock() {
  const start = SCRIPT.indexOf("global-settings-panel");
  assert.ok(start > -1, "settings panel wiring must exist in script.js");
  // ~120 lines is plenty to cover setOpen + the close handlers.
  return SCRIPT.slice(start, start + 4000);
}

test("settings: setOpen takes a restoreFocus argument", () => {
  assert.match(settingsBlock(), /setOpen\s*=\s*\(\s*open\s*,\s*restoreFocus\s*\)/,
    "setOpen must accept (open, restoreFocus)");
});

test("settings: opening moves focus into the panel", () => {
  const b = settingsBlock();
  assert.match(b, /focusTarget\b/, "setOpen must compute a focusTarget on open");
  assert.match(b, /focusTarget\.focus\s*\(\s*\)/,
    "setOpen must call focusTarget.focus() when opening");
});

test("settings: deliberate close restores focus to the cog", () => {
  const b = settingsBlock();
  assert.match(b, /settingsBtn\.focus\s*\(\s*\)/,
    "setOpen must restore focus to settingsBtn when restoreFocus is true");
  // Esc + Close button pass restoreFocus=true; click-outside passes false.
  assert.match(b, /Escape[\s\S]{0,80}setOpen\(false,\s*true\)/,
    "Esc must close with focus restore");
  assert.match(b, /setOpen\(false,\s*false\)/,
    "click-outside must close WITHOUT stealing focus back");
});
