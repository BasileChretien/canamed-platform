/* tests/mobile-bottom-tabbar.test.js
 *
 * UX-overload Phase-2 item #1: a mobile-only sticky bottom tab bar that
 * mirrors the Module A right-column tabs (Decide together | Debate | Our
 * final answers) so the primary nav is within thumb reach on a phone.
 *
 * The hard constraint that shaped the design (documented in the markup): a
 * naive position:fixed bar INSIDE the right column does NOT pin to the
 * viewport, because #app and #stage-1 carry the stage-transition transform,
 * which makes them the containing block for any fixed descendant — so the bar
 * lands at the stage bottom, ~4700px down, not at the screen bottom. The fix
 * is a BODY-LEVEL <nav> (outside those transformed ancestors) that mirrors the
 * canonical tabs and proxies taps to switchRcolTab().
 *
 * These static assertions pin: the bar is body-level (after </footer>), it
 * reuses the existing rcol.tab.* i18n keys (no new copy), it carries 44px
 * touch targets + safe-area inset, it is display:none on desktop and
 * fixed-to-bottom only at <=720px, and the JS wiring (sync from the real tabs,
 * keyboard-hide, Module-A-only visibility) is present.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

// Slice a top-level function declaration's source (from `function name(` up to
// the next top-level `\nfunction ` declaration). Good enough to assert which
// helper a function calls without a full JS parser.
function fnBody(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) return "";
  const after = JS.indexOf("\nfunction ", start + 1);
  return JS.slice(start, after < 0 ? undefined : after);
}

test("the bottom tab bar exists and is hidden by default", () => {
  assert.match(
    INDEX,
    /<nav\b[^>]*id="mobile-rcol-tabbar"[^>]*>/,
    "expected a <nav id=\"mobile-rcol-tabbar\">"
  );
  const navTag = INDEX.match(/<nav\b[^>]*id="mobile-rcol-tabbar"[\s\S]*?>/)[0];
  assert.match(navTag, /\bhidden\b/, "the bar must start hidden (JS reveals it in Module A)");
  assert.match(navTag, /aria-label="[^"]+"/, "the nav landmark must carry an aria-label");
});

test("the bar is BODY-LEVEL (after </footer>, outside the transformed #app)", () => {
  // This is the whole point: the bar must NOT be inside #app / #stage-1, whose
  // stage-transition transform would capture a position:fixed descendant.
  const footerClose = INDEX.lastIndexOf("</footer>");
  const navAt = INDEX.indexOf('id="mobile-rcol-tabbar"');
  assert.ok(footerClose > 0, "footer close not found");
  assert.ok(navAt > footerClose, "the bar must be placed after </footer> (a body-level sibling)");
  // and it must be after the #app <main> closes
  const appClose = INDEX.indexOf("</main>", INDEX.indexOf('<main id="app"'));
  assert.ok(navAt > appClose, "the bar must live outside <main id=\"app\">");
});

test("the bar mirrors the 2 Module A tabs and REUSES the existing i18n keys", () => {
  const nav = INDEX.match(/<nav\b[^>]*id="mobile-rcol-tabbar"[\s\S]*?<\/nav>/)[0];
  const mtabs = [...nav.matchAll(/<button\b[^>]*class="mtab\b[^"]*"[\s\S]*?data-tab="([^"]+)"/g)]
    .map((m) => m[1]);
  assert.deepEqual(
    mtabs.sort(),
    ["answers", "decisions"],
    "the bar must mirror decisions / answers (Debate merged in 2026-06-23)"
  );
  // No NEW copy: each label reuses the canonical rcol.tab.* key.
  for (const key of ["rcol.tab.decisions", "rcol.tab.answers"]) {
    assert.ok(
      nav.includes('data-i18n="' + key + '"'),
      "the bar must reuse the existing i18n key " + key + " (no new copy)"
    );
  }
  // a mirrored badge per tab
  for (const tab of ["decisions", "answers"]) {
    assert.ok(nav.includes('id="mtab-badge-' + tab + '"'), "missing badge mirror for " + tab);
  }
});

test("CSS: hidden on desktop, fixed-to-bottom only at <=720px", () => {
  // Base rule: never shown unless the media query opts in.
  assert.match(
    CSS,
    /\.mobile-rcol-tabbar\s*\{\s*display:\s*none/,
    "the bar must be display:none by default (desktop never shows it)"
  );
  // The fixed positioning must be scoped to the mobile breakpoint and to the
  // :not([hidden]) state (so [hidden] always wins).
  const mq = CSS.match(/@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\n\}/g) || [];
  const block = mq.find((b) => b.includes(".mobile-rcol-tabbar"));
  assert.ok(block, "expected a <=720px block styling .mobile-rcol-tabbar");
  assert.match(block, /\.mobile-rcol-tabbar:not\(\[hidden\]\)\s*\{[\s\S]*?position:\s*fixed/,
    "the bar must be position:fixed only when shown, inside the mobile breakpoint");
  assert.match(block, /bottom:\s*0/, "the bar must pin to the viewport bottom");
});

test("CSS: 44px touch targets + safe-area inset", () => {
  assert.match(CSS, /\.mtab\s*\{[\s\S]*?min-height:\s*44px/,
    "each tap target must be >= 44px tall (WCAG 2.5.5)");
  assert.match(CSS, /env\(safe-area-inset-bottom/,
    "the bar must clear the iOS home indicator via safe-area-inset-bottom");
});

test("JS: the mirror is wired and synced from the canonical tabs", () => {
  assert.ok(JS.includes("function initMobileTabbar("), "initMobileTabbar must exist");
  assert.ok(JS.includes("function updateMobileTabbar("), "updateMobileTabbar must exist");

  // taps proxy to switchRcolTab
  const init = fnBody("initMobileTabbar");
  assert.match(init, /addEventListener\("click"[\s\S]*?switchRcolTab/,
    "a bar tap must proxy to switchRcolTab");

  // the canonical tab state-change paths refresh the mirror
  assert.match(fnBody("switchRcolTab"), /updateMobileTabbar\(\)/,
    "switchRcolTab must sync the mirror");
  assert.match(fnBody("setTabBadge"), /updateMobileTabbar\(\)/,
    "setTabBadge must sync the mirror (counts / ✓ / 🔓)");
  assert.match(fnBody("updateDiscussionTabLock"), /updateMobileTabbar\(\)/,
    "the discussion-lock toggle must sync the mirror");
  assert.match(fnBody("renderStage"), /updateMobileTabbar\(\)/,
    "renderStage must show/hide the bar with the on-screen stage");

  // wired on room entry
  assert.match(fnBody("wireRoomUI"), /initMobileTabbar\(\)/,
    "wireRoomUI must wire the bar");
});

test("JS: keyboard-hide + Module-A-only visibility", () => {
  // hide while a text field is focused (never float over the keyboard)
  assert.ok(JS.includes('addEventListener("focusin"'), "must track focusin");
  assert.ok(JS.includes('addEventListener("focusout"'), "must track focusout");

  const upd = fnBody("updateMobileTabbar");
  assert.match(upd, /_mTabbarTyping/, "visibility must account for the typing state");
  // visibility gates on the DOM stage, not the viewStage variable, so it works
  // under the _test_ harness that surfaces stage-1 by toggling .hidden.
  assert.match(upd, /getElementById\("stage-1"\)/, "must gate on stage-1 presence");
  assert.match(upd, /getElementById\("app"\)/, "must gate on the room (#app) being shown");
});
