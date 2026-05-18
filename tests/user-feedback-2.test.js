/* tests/user-feedback-2.test.js
 *
 * Source-level regression tests for the six bugs reported by the
 * operator after Round 3 live session use:
 *
 *   Bug 1 — team name displayed vertically on phone
 *   Bug 2 — findings results should appear under the question on mobile
 *   Bug 3 — language switcher only translates titles, not dynamic content
 *   Bug 4 — readability in dark + high-contrast modes
 *   Bug 5 — student onboarding tour (first-time room entry)
 *   Bug 6 — participant settings (theme picker + restart tour)
 *
 * Why source-level: the platform's full multi-tab room flow is exercised
 * by the Playwright E2E suite; spinning up Chromium for every micro-fix
 * is slow and noisy. These unit tests pin the load-bearing literals into
 * the source so a future refactor that drops them goes red here within
 * 400 ms. The acceptance behaviour (the bubble appears, the team name
 * fits on a 320 px viewport, the lang switch re-renders the case Q&A)
 * is covered by the matching E2E tests.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "docs", "Third_session", "PBL_platform");
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Read once — these files are small enough that re-reads cost nothing
// but caching keeps the test runtime predictable.
const styleCss = readFile("style.css");
const scriptJs = readFile("script.js");
const indexHtml = readFile("index.html");
const tourJs = readFile("tour.js");

global.window = undefined;
global.self = undefined;
const i18n = require("../docs/Third_session/PBL_platform/i18n.js");
const T = i18n._T;

/* ===================== Bug 1 — team name horizontal ===================== */

test("Bug 1 (CSS): .lb-name uses break-word, not anywhere — prevents per-grapheme vertical stack on narrow phones", () => {
  // The fix specifically changes `overflow-wrap: anywhere` to
  // `overflow-wrap: break-word` on the leaderboard team name. With
  // `anywhere`, a flex item with `min-width: 0` parent will shrink to a
  // 1-char column on phones (because soft-wrap points participate in
  // min-content sizing). `break-word` does the same wrapping work for
  // unsegmentable strings WITHOUT collapsing min-content to one
  // grapheme, so emoji + word still render horizontally.
  const lbName = styleCss.match(/\.lb-name\s*\{[^}]*\}/);
  assert.ok(lbName, ".lb-name rule must be present in style.css");
  assert.match(lbName[0], /overflow-wrap:\s*break-word/,
    ".lb-name must use overflow-wrap: break-word");
  assert.doesNotMatch(lbName[0], /overflow-wrap:\s*anywhere/,
    ".lb-name must NOT use overflow-wrap: anywhere");
  assert.match(lbName[0], /min-width:\s*0/,
    ".lb-name must set min-width: 0 so the flex child can shrink");
});

test("Bug 1 (CSS): the overflow-safety helper no longer applies overflow-wrap: anywhere to team-name surfaces", () => {
  // The old rule covered .answer-text, .chip, .sidebar-room-name,
  // #findings-log .a, .dash-people via a single `overflow-wrap:
  // anywhere`. Anywhere is fine for answer text (long URLs etc.) but
  // dangerous for short team-name strings inside a tight flex column.
  // The fix removes .sidebar-room-name from the shared `anywhere` rule
  // and gives it its own block on break-word.
  // 1. The shared overflow-safety helper must no longer include
  //    .sidebar-room-name (i.e. it should be removed from the list).
  const sharedHelper = styleCss.match(
    /\.answer-text,\s*\.chip[^{]*\{[^}]*overflow-wrap:\s*[^;]+;/);
  assert.ok(sharedHelper, "the shared overflow-wrap helper must still exist");
  assert.doesNotMatch(sharedHelper[0], /\.sidebar-room-name/,
    ".sidebar-room-name must NOT share `overflow-wrap: anywhere` with answer text");
  // 2. SOME .sidebar-room-name block must apply break-word.
  const blocks = styleCss.match(/\.sidebar-room-name\s*\{[^}]*\}/g) || [];
  const hasBreakWord = blocks.some(b => /overflow-wrap:\s*break-word/.test(b));
  assert.ok(hasBreakWord,
    ".sidebar-room-name must have a block setting overflow-wrap: break-word");
});

/* ===================== Bug 2 — findings under question on mobile ===================== */

test("Bug 2 (CSS): .req-inline-reveal exists and is visible on all viewports", () => {
  // The inline reveal lives DIRECTLY under each finding button — on
  // every viewport. Originally mobile-only (the right-column log was
  // assumed to be the canonical surface on desktop), but per the
  // 2026-05-18 specialist panel even desktop students lose the action-
  // result connection when the log is in a separate column, so the
  // inline reveal was promoted to all viewports.
  assert.match(styleCss, /\.req-inline-reveal\s*\{/,
    ".req-inline-reveal class must be defined");
  // Pin that the rule sets display:block at the top level (no
  // surrounding @media), so the inline reveal renders on every
  // viewport — the action/result spatial coupling matters everywhere.
  // We assert by extracting the rule block and confirming display:block
  // appears in it.
  const m = styleCss.match(/\.req-inline-reveal\s*\{([^}]+)\}/);
  assert.ok(m, ".req-inline-reveal must have a top-level rule block");
  assert.match(m[1], /display:\s*block/,
    ".req-inline-reveal top-level rule must include display:block (universal visibility)");
});

test("Bug 2 (JS): renderButtons populates .req-inline-reveal directly after each revealed button", () => {
  // The fix lives in renderButtons (script.js). Pin both load-bearing
  // pieces so a future refactor can't silently drop them:
  //   - a div with class req-inline-reveal is created/maintained
  //   - it is inserted via insertAdjacentElement("afterend", ...) so
  //     the DOM ordering is button → reveal (the visual adjacency the
  //     fix promises)
  assert.match(scriptJs, /req-inline-reveal/,
    "renderButtons must reference the req-inline-reveal class");
  assert.match(scriptJs, /insertAdjacentElement\("afterend",\s*inline\)/,
    "renderButtons must insert the reveal directly after the button");
  // The answer is read from the case content via tc() — used to be
  // set directly on inline.textContent, now lives inside a child
  // .req-inline-answer span (so the .req-inline-by author byline can
  // be styled separately). Either assertion catches the regression.
  assert.match(scriptJs, /tc\(item\.a,\s*lang\)/,
    "the reveal must render the localised case answer (tc + item.a)");
  assert.match(scriptJs, /className\s*=\s*"req-inline-answer"/,
    "the reveal must wrap the answer text in a .req-inline-answer span so the author byline can sit next to it");
});

/* ===================== Bug 3 — live language re-render ===================== */

test("Bug 3 (JS): canamed:langchange listener re-renders every dynamic-content panel", () => {
  // applyI18n() handles every node carrying data-i18n. Dynamic content
  // built by renderFindings / renderDecisions / renderPrompts /
  // renderObjectives etc. reads tc(value, lang) at build time and
  // never re-renders. The fix is a single listener wired in
  // wireLanguageSwitcher that calls each render helper after a switch.
  assert.match(scriptJs,
    /document\.addEventListener\("canamed:langchange",\s*\(\)\s*=>\s*\{/,
    "a global canamed:langchange listener must be wired");

  const wanted = [
    "buildButtons", "renderButtons", "renderFindings", "renderPrompts",
    "renderDecisions", "renderObjectives", "renderLeaderboard",
    "renderScore", "renderStage", "renderContrib"
  ];
  for (const fn of wanted) {
    assert.match(scriptJs, new RegExp('callIfFn\\("' + fn + '"\\)'),
      "the lang-change listener must call " + fn);
  }
  // renderAnswers needs both module keys
  assert.match(scriptJs, /fn\("moduleA"\);\s*fn\("moduleB"\)/,
    "the lang-change listener must re-render answers for both Module A and B");
});

test("Bug 3 (JS): listener wires exactly once (idempotency guard)", () => {
  // wireLanguageSwitcher is called on every applyBranding() which can
  // run multiple times (lobby init, admin init). Without an
  // idempotency guard the same listener stacks N times and re-renders
  // run N times on each language switch.
  assert.match(scriptJs, /_canamedLangchangeRerenderWired/,
    "the listener must be guarded so it only wires once per document");
});

/* ===================== Bug 4 — readability in dark + HC modes ===================== */

test("Bug 4 (CSS): .stage-wait colour follows the theme token, not a hardcoded light-mode hex", () => {
  // The old rule pinned `color: #5a4519` which is invisible on the
  // dark-mode caen-50 (#2a2114). Switching to var(--caen-ink) keeps
  // light-mode contrast and remaps cleanly under dark / HC.
  const stageWait = styleCss.match(/\.stage-wait:not\(:empty\)\s*\{[^}]*\}/);
  assert.ok(stageWait, ".stage-wait:not(:empty) rule must be present");
  assert.match(stageWait[0], /color:\s*var\(--caen-ink\)/,
    ".stage-wait must use the theme token, not a hardcoded hex");
  assert.doesNotMatch(stageWait[0], /color:\s*#5a4519/,
    ".stage-wait must no longer hardcode #5a4519");
});

test("Bug 4 (CSS): the high-contrast theme block remaps every key token used by participant chrome", () => {
  // Spot-check that the existing HC theme block still defines the
  // tokens we depend on (ink/bg/caen-50/caen-ink). If a future
  // refactor strips one, the .stage-wait fix above breaks silently.
  const hcRule = styleCss.match(/html\[data-theme="high-contrast"\]\s*\{[^}]*\}/);
  assert.ok(hcRule, "high-contrast theme block must exist");
  for (const tok of ["--ink", "--bg", "--card", "--caen-ink", "--caen-50"]) {
    assert.match(hcRule[0], new RegExp(tok + ":"),
      "high-contrast block must define " + tok);
  }
});

/* ===================== Bug 5 — student onboarding tour ===================== */

test("Bug 5 (tour.js): a 'student' tour set is registered alongside 'create' and 'admin'", () => {
  // The tour module exposes _STEPS for inspection. We can't require
  // tour.js easily under Node (it uses self/window globally), so we
  // assert against the source instead.
  assert.match(tourJs, /student:\s*\[/,
    "tour.js must define a 'student' step set");
  // Each step needs an anchor + title/body keys; pin a few load-bearing
  // ones to catch silent removals.
  assert.match(tourJs, /tour\.student\.1\.title/);
  assert.match(tourJs, /tour\.student\.7\.title/);
  // The student tour must use a separate localStorage key so it's
  // independent from create / admin done-state.
  assert.match(tourJs, /canamed_tour_student_done/,
    "student tour must persist its done-state under its own key");
});

test("Bug 5 (script.js): enterRoom triggers the student tour for participants only", () => {
  // The tour must fire for real participants — never for admins
  // (asAdmin path). The fix is gated by `!asAdmin` + isDone("student").
  assert.match(scriptJs,
    /CanamedTour\.start\("student"\)|CanamedTour\.isDone\("student"\)/,
    "script.js must reference the student tour");
  // enterRoom must skip the tour for admins viewing a room as admin.
  // Pin the negation in the surrounding context.
  const studentStart = scriptJs.match(
    /if\s*\(\s*!asAdmin\s*&&\s*window\.CanamedTour\s*&&\s*!window\.CanamedTour\.isDone\("student"\)\s*\)/);
  assert.ok(studentStart,
    "the student tour must be gated by !asAdmin (admins have their own tour)");
});

test("Bug 5 (i18n): the student tour copy ships in en / fr / ja minimum", () => {
  for (const k of ["tour.student.1.title", "tour.student.1.body",
                   "tour.student.6.title", "tour.student.7.body"]) {
    assert.ok(T.en[k] && T.en[k].length > 0, "en missing " + k);
    assert.ok(T.fr[k] && T.fr[k].length > 0, "fr missing " + k);
    assert.ok(T.ja[k] && T.ja[k].length > 0, "ja missing " + k);
  }
});

/* ===================== Bug 6 — participant settings widget ===================== */

test("Bug 6 (HTML): settings cog button + panel exist in the global header", () => {
  // The settings widget is fixed-position next to the global language
  // switcher. Both pieces must exist for the participant to find it.
  assert.match(indexHtml, /id="global-settings-btn"/,
    "settings cog button must exist");
  assert.match(indexHtml, /id="global-settings-panel"/,
    "settings panel must exist");
  assert.match(indexHtml, /id="global-theme-select"/,
    "theme picker inside the settings panel must exist");
  // The button uses an SVG cog (no emoji per coding guidelines)
  assert.match(indexHtml, /global-settings-btn[^>]*>[\s\S]*?<svg/,
    "the cog must be rendered as an inline SVG, not an emoji");
  // High-contrast must be one of the picker options.
  const themeSel = indexHtml.match(/id="global-theme-select"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(themeSel, "global-theme-select must contain options");
  assert.match(themeSel[1], /value="high-contrast"/,
    "the participant theme picker must offer high-contrast");
  assert.match(themeSel[1], /value="auto"/);
  assert.match(themeSel[1], /value="light"/);
  assert.match(themeSel[1], /value="dark"/);
});

test("Bug 6 (CSS): settings widget is hidden behind body.locked (same as global lang switcher)", () => {
  // Body.locked is set while the splash is the visible top-level
  // surface. The settings cog must follow the same hide rule so it
  // doesn't appear over the splash gate.
  assert.match(styleCss, /body\.locked\s+\.global-settings\s*\{\s*display:\s*none/,
    "body.locked must hide .global-settings");
});

test("Bug 6 (JS): setTheme accepts 'high-contrast' as a first-class mode", () => {
  // setTheme used to whitelist only ["dark","light","auto"]; the fix
  // adds "high-contrast" so participants can opt in via the picker
  // (theme-init.js and the CSS block already accept it).
  assert.match(scriptJs, /mode\s*!==\s*"high-contrast"/,
    "setTheme must whitelist 'high-contrast'");
  assert.match(scriptJs,
    /v\s*===\s*"high-contrast"/,
    "getTheme must accept 'high-contrast' as a persisted value");
});

test("Bug 6 (JS): setTheme keeps every theme picker in the page in sync", () => {
  // Two pickers exist (admin-theme-select, global-theme-select).
  // Without a sync, a user who switches via the admin picker sees the
  // global picker out of date and vice-versa.
  assert.match(scriptJs, /admin-theme-select/);
  assert.match(scriptJs, /global-theme-select/);
});

test("Bug 6 (JS): settings widget wires open/close + restart-tour", () => {
  assert.match(scriptJs, /global-settings-btn/,
    "the cog click must be wired");
  assert.match(scriptJs, /global-settings-restart-tour/,
    "the restart-tour link must be wired");
  // Restart-tour clears the three tour-done markers so the appropriate
  // one fires next time.
  assert.match(scriptJs, /canamed_tour_student_done/,
    "restart-tour must clear the student tour marker");
});

test("Bug 6 (i18n): the settings widget strings ship in en / fr / ja minimum", () => {
  for (const k of ["settings.btn", "settings.title",
                   "settings.restart-tour", "settings.close"]) {
    assert.ok(T.en[k] && T.en[k].length > 0, "en missing " + k);
    assert.ok(T.fr[k] && T.fr[k].length > 0, "fr missing " + k);
    assert.ok(T.ja[k] && T.ja[k].length > 0, "ja missing " + k);
  }
});
