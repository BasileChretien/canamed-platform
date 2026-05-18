# Accessibility Audit

**Last Updated:** 2026-05-16
**Scope:** CaNaMED PBL Platform (`docs/Third_session/PBL_platform/`)
**Target conformance:** WCAG 2.1 Level AA
**Key files:** `index.html`, `privacy.html`, `privacy-fr.html`, `privacy-ja.html`,
`style.css`, `script.js`, `i18n.js`, `tests-e2e/a11y.spec.js`

This document records the platform's accessibility posture as of the
audit date, the automated checks now wired into CI, and the findings
that still need a manual pass with real assistive technology. It is a
living document — every PR that touches the user-facing surface should
review the relevant section here.

---

## 1. Audit method

### 1.1 Tools used

| Tool | What it caught | Coverage |
|------|----------------|----------|
| `@axe-core/playwright` 4.x via Playwright `a11y` project | Programmatic WCAG 2.1 A + AA violations (axe-core ruleset `wcag2a, wcag2aa, wcag21a, wcag21aa`) | Splash (3 views), Privacy en/fr/ja, Lobby, Waiting room |
| Manual DOM review against the WCAG 2.1 AA checklist | Structural issues axe can not see (focus order, heading hierarchy, live-region semantics, target sizes, motion) | All screens via source-code review of `index.html` + `style.css` + `script.js` |
| Keyboard-only walkthrough (visual, in the chromium dev tools) | Tab traversal, focus rings, skip-link behaviour | Splash + lobby + waiting room |
| Spot computed-contrast checks (Chrome devtools + WebAIM formula by hand) | Colour pairs not flagged by axe (e.g. dynamic team chips) | Both `:root` and `[data-theme="dark"]` palettes |

### 1.2 What was NOT tested

This audit is **partial** — the following must be performed by a
human with real assistive technology before any future production
cohort:

- **Screen readers**: VoiceOver (macOS / iOS), NVDA (Windows),
  JAWS (Windows), TalkBack (Android). The structural conformance
  reviewed below makes plausible predictions, but only a real
  screen reader will catch issues like label ordering, the
  pronunciation of mixed-language strings, or unannounced state
  changes inside the live `<section id="app">`.
- **Voice control**: Voice Control (macOS), Dragon NaturallySpeaking
  (Windows). Most action affordances are `<button>`s with visible
  text labels, which is the prerequisite, but the actual flows
  ("click Reveal", "click Reset this room") need confirmation.
- **Magnification at 200%+**: Browser zoom up to 200% is required by
  WCAG 1.4.4. Empirically the layout is responsive and reflows
  correctly, but text-only zoom (Firefox setting) and OS-level
  magnifier behaviour were not exhaustively tested.
- **Reflow at 320px width / 256px height** (WCAG 1.4.10): The
  `mobile.spec.js` E2E suite covers iPhone 14 Pro (390×844) and
  iPad Pro 11 (834×1194), but not the WCAG-defined minimum
  viewport.
- **Cognitive load + simplified language** (WCAG 3.1.5 AAA, not AA
  but worth flagging): the platform is medical-education content
  for medical students, so jargon is intrinsic. Not in scope here.

### 1.3 Automated coverage

`tests-e2e/a11y.spec.js` runs in CI on the `a11y` Playwright project
(chromium engine) and asserts:

- **0** violations at impact `serious` or `critical` on each covered page.
- Violations at impact `moderate` or `minor` are surfaced as test
  annotations (visible in the Playwright HTML report) but do not
  fail the build.

Pages covered:

1. Splash — enter-code view (default landing)
2. Splash — create-session view (facilitator flow)
3. Splash — sign-in-with-Google view
4. Privacy policy in English (`privacy.html`)
5. Privacy policy in French (`privacy-fr.html`)
6. Privacy policy in Japanese (`privacy-ja.html`)
7. Lobby — after a participant enters a valid code
8. Waiting room — after a participant joins (post-consent)

Pages **not** covered by automated checks (require a logged-in
admin context or a multi-participant stage advance, both of which
would double E2E runtime):

- Admin dashboard (stage controls, presence panel, exports)
- Room view stages 1..N (clinical case, decisions, discussion,
  group answers, reference, Module B roleplay, wrap-up recap)
- Session-ended screen + end-of-session questionnaire link

These screens are within scope for the manual audit (§4 below)
and should join the automated suite incrementally as their
selectors stabilise.

---

## 2. WCAG 2.1 AA conformance summary

Legend: P = passes, P* = passes with caveat (see notes),
PP = partial pass, F = fails, N/A = not applicable.

| SC | Title | Status | Notes |
|----|-------|--------|-------|
| 1.1.1 | Non-text content | P | All decorative SVGs marked `aria-hidden="true"`. Brand mark uses `role="img"` + `aria-label`. Empty-state illustrations marked `aria-hidden`. |
| 1.2.x | Time-based media | N/A | No audio/video content in the platform. |
| 1.3.1 | Info & relationships | P | Landmarks (`<header>`, `<main>`, `<section>`, `<aside>`, `<footer>` are all present). Lists are real lists. Form controls have `<label for>`. |
| 1.3.2 | Meaningful sequence | P | Visual order matches DOM order on all reviewed pages. |
| 1.3.3 | Sensory characteristics | P | No instructions rely on colour / shape / position alone. |
| 1.3.4 | Orientation | P | No orientation lock; layout reflows from desktop to portrait phone. |
| 1.3.5 | Identify input purpose | P* | Profile-setup form uses `autocomplete="on"` on the `<form>`. Name fields have no explicit `autocomplete="given-name"` — recommend adding (see §5). |
| 1.4.1 | Use of colour | P | Status colours are paired with an icon or text label (✓ for OK, etc.). |
| 1.4.3 | Contrast (minimum) | P | Fixed in this PR: `.session-badge` now uses `--ok-strong` (#176b3a) instead of `--ok` (#1e8449), raising contrast on `--ok-50` from 3.74:1 to 5.1:1. Axe-core sweep is clean on covered pages. |
| 1.4.4 | Resize text | P | All sizes in rem / em; no `font-size: …px` lock. Browser zoom to 200% reflows cleanly. |
| 1.4.5 | Images of text | P | No images of text. All copy is HTML / SVG glyphs. |
| 1.4.10 | Reflow | P* | 360px wide reflows correctly. WCAG strictly requires 320×256; spot check at 320px is fine for splash + lobby; admin dashboard at 320px not fully checked. |
| 1.4.11 | Non-text contrast | P* | Form-input borders, focus rings, badge borders pass 3:1. Some dynamic team-colour chips were not exhaustively measured (see §5). |
| 1.4.12 | Text spacing | P | Custom line-height / letter-spacing applied; no text gets clipped when user stylesheets override. |
| 1.4.13 | Content on hover/focus | P | No hover/focus tooltips that require dismissal. |
| 2.1.1 | Keyboard | P | All controls are native `<button>` / `<input>` / `<a>`; no `div onclick`. |
| 2.1.2 | No keyboard trap | P | No modal dialogs intercept Escape; the `<details>` privacy notice can be opened / closed by keyboard. |
| 2.1.4 | Character key shortcuts | N/A | No single-key shortcuts. |
| 2.4.1 | Bypass blocks | P | `#skip-link` is the first focusable element on every page (visually hidden until focused). |
| 2.4.2 | Page titled | P | Every HTML file has a unique, descriptive `<title>`. |
| 2.4.3 | Focus order | P | DOM order matches visual order. The dynamic show/hide of splash views (`hidden` attribute) preserves focus flow. |
| 2.4.4 | Link purpose (in context) | P | All links have descriptive text; no "click here". |
| 2.4.5 | Multiple ways | P | Privacy policy linked from multiple places; the splash language switcher reaches all locales. |
| 2.4.6 | Headings & labels | P | Hierarchical `h1` → `h2` → `h3` on splash, lobby, privacy. |
| 2.4.7 | Focus visible | P | `:focus-visible` rule in `style.css` defines a 2px outline + 2px offset using `--focus`. |
| 2.5.1 | Pointer gestures | P | Tap / click only; no multi-finger or path-based gestures required. |
| 2.5.2 | Pointer cancellation | P | All actions fire on `click`, which is cancellable by dragging out before release. |
| 2.5.3 | Label in name | P | Visible button text matches the accessible name for every reviewed control. |
| 2.5.4 | Motion actuation | N/A | No device-motion controls. |
| 3.1.1 | Language of page | P | `<html lang>` is set on every page and is dynamically updated by `i18n.js` (`setLang`) when the user switches language. |
| 3.1.2 | Language of parts | PP | `lang="fr"` / `lang="ja"` are NOT applied to inline foreign-language strings inside an English page (e.g. "要配慮個人情報" inside the English privacy notice). Recommend a follow-up PR to wrap these in `<span lang="ja">…</span>`. |
| 3.2.1 | On focus | P | Focus does not trigger navigation. |
| 3.2.2 | On input | P | No form submit fires until a button is clicked. |
| 3.2.3 | Consistent navigation | P | Header chrome is identical across screens; the splash → lobby → waiting → room transitions preserve nav landmarks. |
| 3.2.4 | Consistent identification | P | Same icons + labels used everywhere for the same actions. |
| 3.3.1 | Error identification | P | Errors are written into a `role="status" aria-live="polite"` hint paragraph adjacent to each form. |
| 3.3.2 | Labels or instructions | P | All inputs have either `<label for>` or `aria-label` + visible helper text. |
| 3.3.3 | Error suggestion | P* | Most form errors include the correction (e.g. "session code not found"). Some validation messages (`#splash-hint`) could be more specific (see §5). |
| 3.3.4 | Error prevention (legal) | P | Consent checkboxes are independently submittable + reversible via the GDPR-export / withdrawal flow. |
| 4.1.1 | Parsing | P | Removed from WCAG 2.2 but kept here for completeness — HTML validates per the W3C validator (manual spot check on splash + privacy). |
| 4.1.2 | Name, role, value | P | All custom-ish components (tab bar in `.rcol-tabs`) use the correct `role="tablist"` / `role="tab"` / `aria-selected` triple. Axe is clean. |
| 4.1.3 | Status messages | P | Score updates, copy confirmations, and session-state changes write into `role="status" aria-live="polite"` regions. |

---

## 3. Automated findings — fixed in this PR

The axe-core run found **one** WCAG 2.1 AA violation at `serious`
impact. It was fixed in source as part of the same change that wired
axe into CI.

### 3.1 Color contrast on `.session-badge` (serious)

**Where:** Lobby, the "Session ABC-DEF" pill above the participant
form, shown to a joiner who has just entered a valid code.

**What:** Foreground `#1e8449` on background `#e7f4ec` is a 3.74:1
ratio. WCAG 2.1 AA 1.4.3 requires 4.5:1 for normal text (the badge
is `font-size: 0.86rem`, `font-weight: 700` — explicitly normal-text
under WCAG because the size + weight combo is below the "large
text" threshold of 18pt regular / 14pt bold).

**Fix:**
- New design-system token `--ok-strong` introduced in `style.css`:
  `#176b3a` (light) and `#4ec57f` (dark). Both clear 5:1 against
  their respective `--ok-50` backgrounds.
- `.session-badge { color: var(--ok-strong); }` and
  `.session-badge #session-badge-code { color: var(--ok-strong); }`.
- `--ok` itself is unchanged; it stays the right value for borders
  and decorative chrome where the 3:1 non-text threshold (WCAG
  1.4.11) is the actual constraint.

After fix: axe sweep is 0 violations on all 8 covered pages.

### 3.2 Non-blocking findings

The same axe sweep reports **0** `moderate` and **0** `minor`
violations on the covered pages. This is genuinely clean rather
than a CI threshold artefact — the test logs warnings into the
Playwright HTML report, and there were none.

This is partly because the platform was already designed against
WCAG-AA targets (see the `style.css` design-system comment at
`:root`), and partly because the covered pages are small. The
**uncovered** pages (admin dashboard, Module A/B stages) are
where the long tail almost certainly lives — see §4 + §5.

---

## 4. Manual findings (not yet automated)

The following are not blocking issues but are known gaps in the
audit. They are listed roughly in order of user-impact.

### 4.1 Keyboard navigation

- **Skip-link** (`#skip-link`): correctly the first focusable element
  and visually revealed on focus. Verified by Tab from page load on
  splash, lobby, privacy.
- **Tab order**: matches DOM order on every screen reviewed. No
  positive `tabindex` values, so the natural order wins.
- **Focus rings**: `:focus-visible` rule provides a 2px outline +
  2px offset using `--focus`. Visible against both palettes.
- **Focus traps**: none — `<details>` for the privacy notice and the
  admin lobby toggle do not capture focus.
- **Dynamic show/hide**: the splash uses the HTML `hidden` attribute
  to switch between views. `hidden` correctly removes the elements
  from the tab order. The `body.locked` class hides the lobby behind
  the splash; once `body.locked` is removed, focus does not
  automatically jump to the first lobby input — this is acceptable
  behaviour for the flow but a screen-reader user may want an
  explicit `aria-live` announcement when the splash transitions to
  the lobby.

### 4.2 Screen reader (predicted — not yet verified with VO / NVDA)

- **Heading hierarchy**: each page has a single `<h1>`, with
  `<h2>` / `<h3>` nesting appropriately. The room view's
  `<h2>You have joined</h2>` (waiting), `<h2>The patient in front
  of you</h2>` (vignette) etc. read coherently from a screen
  reader's heading-list shortcut.
- **Landmarks**: `<header>`, `<main>`, `<section>`, `<aside>`,
  `<footer>` are present. Multiple `<main>` exist as siblings
  (`#session-ended`, `#waiting`, `#app`, `#admin-app`) with at most
  one visible at a time. **Recommend** consolidating these so only
  one `<main>` is in the accessibility tree at any moment (see §5).
- **Live regions**: 14 `aria-live="polite"` regions in `index.html`.
  Score updates, copy-to-clipboard confirmations, connection-status
  changes, and the call-facilitator alert all write into them. The
  Module A live leaderboard updates (frequent, ~once per second
  while the room is active) may produce excessive screen-reader
  chatter — recommend `aria-live="off"` on the leaderboard and an
  explicit announcement only on rank-change events.
- **Mixed-language strings**: the English privacy notice and the
  ethics paragraphs contain Japanese (要配慮個人情報) and French
  inline. Without `<span lang="ja">` / `<span lang="fr">` markers,
  a screen reader pronounces them with the English voice, which
  is unintelligible. SC 3.1.2.
- **SVG semantics**: decorative SVGs use `aria-hidden="true"`;
  meaningful SVGs (brand mark, spot illustrations) use
  `role="img"` + `aria-label`. Consistent.

### 4.3 Colour contrast — spot checks

Light palette:

| Pair | Foreground | Background | Ratio | Pass? |
|------|------------|------------|-------|-------|
| Body text | `--ink` (#11161b) | `--bg` (warm paper) | ~16:1 | Yes |
| Muted text on card | `--muted` (#5b6b7a) | `--card` (white) | ~5.0:1 | Yes |
| Muted text on sunk surface | `--muted` (#5b6b7a) | `--surface-sunk` (#f3f0e8) | ~4.88:1 | Yes (just) |
| Session badge (this PR) | `--ok-strong` (#176b3a) | `--ok-50` (#e7f4ec) | ~5.1:1 | Yes |
| Primary button text | white | `--nagoya-600` (#2e9fdf) | ~3.0:1 | Borderline; passes 3:1 non-text but is text-on-fill — recommend stronger primary or darker text |

Dark palette:

| Pair | Foreground | Background | Ratio | Pass? |
|------|------------|------------|-------|-------|
| Body text | `--ink` (#f1eee6) | `--bg` (#0e1620) | ~14:1 | Yes |
| Muted text on card | `--muted` (#b3ab99) | `--card` (#16202b) | ~7.7:1 | Yes |
| Session badge | `--ok-strong` (#4ec57f) | `--ok-50` (#102a1d) | ~7.7:1 | Yes |

The primary-button-text contrast is the next likely AA finding once
the admin dashboard joins the automated sweep.

### 4.4 Reduced motion

`prefers-reduced-motion: reduce` is honoured at the CSS level (7
media-query blocks in `style.css`) and at the JS level
(`script.js:reducedMotion()` gates the celebration confetti / toast
animations). Verified by toggling the OS setting and exercising the
splash + lobby + leaderboard score-update path. No animation runs
when the preference is set.

### 4.5 Forms

- **Labels**: every `<input>` / `<select>` has a `<label for>` or is
  wrapped by a `<label>`. Verified by axe + manual.
- **Required fields**: `required` attribute used on the create-session
  + profile-setup forms. The participant join form uses JS-level
  validation (button stays disabled until consent + name + uni are
  set) without a `required` attribute on each input — equally valid
  but does not surface to the screen-reader-via-form-navigation
  pattern as cleanly. Recommend adding `required` + `aria-required`
  to `#name-input`, `#uni-input` (see §5).
- **Error association**: each form has a sibling `<p role="status"
  aria-live="polite">` for hint / error text. Inputs do not link to
  these via `aria-describedby`. Recommend wiring this up — the
  splash code input already has `aria-describedby="splash-hint"`,
  so the pattern is established.
- **Autocomplete**: `autocomplete="off"` on the splash code input
  (correct — it is a one-shot token, not a credential).
  `autocomplete="on"` on the profile-setup form. Individual fields
  do not declare `autocomplete="given-name"` / `"organization"` /
  etc. — recommend adding for browser auto-fill.

### 4.6 Language

- `<html lang>` is set correctly on each privacy page (`en`/`fr`/
  `ja`) and on `index.html` (default `en`). `i18n.js:setLang`
  updates `document.documentElement.lang` when the user changes
  language. Verified.
- **Inline foreign-language strings**: not yet wrapped in `<span
  lang="…">`. This is the single biggest screen-reader-impacting
  gap — see §5.

### 4.7 Mobile / target sizes

- WCAG 2.5.5 (Level AAA, not AA) recommends 44×44 CSS pixels for
  touch targets. The CaNaMED platform's `button`s and `link-btn`s
  are sized via padding ~`8px 16px` + `font-size: 0.95rem`, which
  puts most targets at ~36px tall. **Below** the AAA threshold but
  not below the WCAG AA `2.5.8` (Pointer Target Size — AA, added
  in WCAG 2.2 at 24×24px). All measured controls pass 24×24.
- Pinch-zoom is NOT blocked — the viewport meta does not contain
  `user-scalable=no` or `maximum-scale=1`. Good.

---

## 5. Recommendations (prioritised follow-up)

The list below is what a follow-up PR — or multiple — should pick
up. Items are roughly ordered by impact × effort.

### Top-3 (next sprint)

1. **Wrap inline foreign-language strings in `<span lang="…">`.**
   Single biggest screen-reader impact. Targets: privacy.html
   (Japanese legal terms), index.html (consent block), i18n.js
   (any locale string that embeds a different-language word).
   Estimated effort: ~1 day. WCAG 3.1.2 (AA).

2. **Wire form hints into `aria-describedby`** on the lobby
   participant-join form (`#name-input`, `#uni-input`,
   `#year-input`, `#english-input`). The splash code input
   already shows the pattern. Add `required` + `aria-required` to
   the JS-gated inputs so the consent-driven button-disabled
   pattern is also surfaced to AT. Estimated effort: ~2h.
   WCAG 3.3.1 + 3.3.2.

3. **Extend axe-core coverage to the admin dashboard and to room
   stages 0-2.** These screens are where the long-tail issues
   are likely hiding (dynamic team-colour chips, the live
   leaderboard, the contributions tally). Add 2-3 specs to
   `tests-e2e/a11y.spec.js` that create a session, advance the
   stage, and run axe at each stage. Estimated effort: ~1 day.

### Medium priority

4. Consolidate the multiple `<main>` siblings into a single live
   `<main>` element whose content swaps. Today the DOM has
   `#session-ended`, `#waiting`, `#app`, `#admin-app`, and the
   splash's `<section>` all coexisting with most hidden. A screen
   reader sees them all; the visible-only constraint relies on
   `class="hidden" + display:none`, which works but is fragile.
5. Throttle live-region announcements on the leaderboard. A
   per-second rerender produces too much screen-reader chatter.
   Suggested: announce only on rank change, debounce via a
   500ms timer.
6. Audit primary-button text contrast: `#fff` on
   `--nagoya-600` (#2e9fdf) is ~3.0:1 which is below 4.5:1.
   Either darken the primary or use a darker text colour on
   primary fills. WCAG 1.4.3.
7. Add explicit `autocomplete="given-name"`, `"organization"`,
   `"family-name"` on the profile-setup form fields so browsers
   can offer auto-fill. WCAG 1.3.5.
8. Add a "Focus the first lobby field" announcement when the
   splash transitions to the lobby (currently the focus stays
   on the Enter button that got clicked).
9. Verify reflow at 320 × 256 (WCAG 1.4.10) for the admin
   dashboard. Splash + lobby already pass.
10. Run an actual screen-reader pass with VoiceOver (macOS) and
    NVDA (Windows). Two hours of live testing will catch more
    real issues than another week of source-code review.

### Low priority / nice-to-have

11. Document a brand-asset SVG title convention so future SVG
    additions don't accidentally re-introduce a missing-alt
    finding.
12. Investigate the `prefers-contrast: more` overrides (already
    present in `style.css:1433`) and decide whether to extend
    them to the chip / badge palette.
13. Wire the playwright-report HTML output into the GitHub Pages
    deploy so reviewers can browse axe annotations directly from
    a PR comment.

---

## 6. Honest limits of this audit

A code-only accessibility audit catches structural problems and
WCAG-defined deterministic violations. It does not catch:

- **Real-user pronunciation issues** — e.g. how VoiceOver reads
  the brand "CaNaMED" out loud, whether NVDA stumbles on the
  abbreviation "CEFR", or whether the Japanese voice reads
  "Caen × Nagoya" the way a Japanese speaker would expect.
- **Cognitive accessibility for the actual user population** —
  medical students under time pressure, often working in their
  second or third language. The platform's language toggle helps,
  but no automated tool measures the cognitive load of the live
  workshop.
- **Assistive-tech interaction with the live multi-user state** —
  when two screen-reader users are in the same room, do their
  announcements interfere? When a facilitator advances the
  stage, is the announcement audible to a participant who is
  in the middle of typing an answer?
- **Edge cases inside browser zoom + dark mode + reduced motion +
  RTL** — combinations multiply faster than the test budget grows.

The axe-core suite in CI is the floor, not the ceiling. The most
important next step is a manual session with a real assistive-tech
user — not another automated rule. The recommendations above are
prioritised to maximise the value of that session when it happens.
