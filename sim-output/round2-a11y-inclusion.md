# CaNaMED PBL platform — Accessibility & Inclusion Review (WCAG 2.2 AA)

Scope: `C:/cnm-pp/docs/Third_session/PBL_platform/` — `index.html` (2810 LOC),
`style.css` (6162 LOC), `script.js` (9916 LOC; live-region / keyboard slices),
`tour.js` (464 LOC).
Cohort: Franco-Japanese, mostly non-English-native, mixed English confidence,
mobile + desktop, projector-shared admin screens.

Severity codes used below:
**[BLOCKER]** = WCAG-AA failure or workshop-blocking · **[HIGH]** = real
exclusion risk for the target cohort · **[NIT]** = polish.

---

## 1. Keyboard navigation

What works
- Skip-link is correctly implemented as the first focusable element
  (`index.html:58`, styled `style.css:115–134`), with a strong visible focus
  ring that overlays the header — meets WCAG 2.4.1 (Bypass Blocks).
- A surface-independent focus ring is declared globally
  (`style.css:2134–2142`, `outline: 3px solid var(--focus); outline-offset: 2px;`)
  and high-contrast theme has its own ring (`style.css:5228`). This is the
  single biggest a11y win in the codebase.
- Right-column tablist supports ArrowLeft/Right and roving focus
  (`script.js:2375–2384`).
- Module B `.role-chip` radiogroup has ArrowLeft/Right keyboard nav
  (`script.js:7388–7395`) and the wrapper carries `role="radiogroup"`
  (`index.html:1914`).
- Confirm modal moves focus to the confirm button on open and restores focus
  to the prior element on close (`script.js:544–549`, 564–571). The
  `<dialog>` polyfill stack handles nesting correctly.
- Tour key handler ignores Enter when focus is in an input/textarea/select
  (`tour.js:396–407`) — prevents accidental form submit.

Issues

- **[BLOCKER] Tour overlay has no focus trap.** `tour.js:347–378` builds a
  `role="dialog"` root but deliberately sets `aria-modal="false"` and never
  constrains Tab. With body scroll preserved and the splash form still in
  the tab order behind the overlay, a keyboard-only user can Tab off the
  bubble into the dimmed splash inputs they cannot see clearly, type into
  them, and accidentally submit the create-session form (Enter is blocked
  by the tour handler, but Space on a button still fires). Also: when the
  tour dismisses, focus is dropped on `<body>` rather than restored to the
  element that triggered the tour. Fix: gate Tab inside the bubble while
  the tour is open, OR set `aria-modal="true"` and use `inert` on
  `#splash` / `main` while active. Also stash the activeElement on
  `start()` and restore on `dismiss()`.

- **[HIGH] Settings panel is `role="dialog"` but is not modal and has no
  focus management.** `index.html:107–131` declares the cog panel a
  dialog; `script.js:1299–1335` toggles `hidden` and `aria-expanded` but
  never moves focus into the panel on open, never traps Tab inside, and
  never restores focus to the cog on Esc/Close. For a screen-reader user
  the panel might as well not exist. Fix: either drop `role="dialog"`
  (treat as a disclosure/menu, which it really is) OR move focus to the
  first interactive element on open and restore on close. Adding
  `role="menu"` + `aria-labelledby` would be the lighter fix.

- **[HIGH] Tour overlay click anywhere = "advance".** `tour.js:357–362`
  treats an overlay click as Next. For a low-vision user using a magnifier
  or a student with motor variability, a stray tap on the overlay silently
  skips a step. The Skip button is the documented exit; the overlay
  should NOT also act as Next. Recommend: overlay click only dismisses on
  the last step (or does nothing) — Skip + the X-style Skip button remain
  the explicit dismiss paths.

- **[HIGH] Chart `<details>` sections collapse with no Stage-1
  keyboard-friendly summary of state.** `index.html:1265, 1279, 1306,
  1339` (`.chart-section`) are good `<details>` patterns and keyboard-
  open by default. However, when locked (Investigations gate), the
  `.is-locked` visual fade has no `aria-disabled` on the `<summary>`, so
  a keyboard user can still expand it, find disabled buttons inside, but
  no programmatic announcement explains why. Add `aria-disabled="true"`
  on summary when locked AND wire the `#investigations-locked-hint` via
  `aria-describedby` on each disabled button inside.

- **[NIT] Discussion tab `is-locked` rendering.** `index.html:1388–1396`
  uses `is-locked` class. `script.js:6002` sets `aria-disabled`. Good.
  But the tab is still tab-focusable and clickable — only a visual lock.
  Confirm `switchRcolTab()` no-ops when locked (a screen-reader user
  hearing "Debate, locked, finish synthesis to unlock" should not also be
  able to "open" an empty panel).

---

## 2. ARIA & live regions

What works
- `#stage-indicator`, `#stage-now`, `#stage-wait` are all polite live
  regions (`index.html:936, 961–962`), so a stage advance from the
  facilitator is announced.
- Toast notifications re-arm `aria-live` on `requestAnimationFrame` to
  defeat SR coalescing (`script.js:794–798`) — a real, thought-through fix.
- Leaderboard live region is `aria-live="off"` (`index.html:998`)
  deliberately — correct, since it re-renders every second.
- The score chip + room-score-chip have polite announcements.
- `data-i18n-attr="aria-label"` pattern keeps `aria-label`s localized on
  every language switch.

Issues

- **[BLOCKER] Missing `#a11y-stage-announce` element.** `script.js:5438`
  reads `el("a11y-stage-announce")` to announce facilitator-call state
  transitions ("Facilitator called", "A facilitator is on the way",
  "cleared"). **There is no element with this id anywhere in
  `index.html`.** The `if (announcer)` guard then makes the failure
  silent. Net effect: screen-reader users who press "Call a facilitator"
  get no spoken confirmation that the call landed or was acknowledged.
  Fix: add `<div id="a11y-stage-announce" class="sr-only" aria-live="polite" aria-atomic="true"></div>`
  near the other live regions in `<main id="app">` (around `index.html:932`).

- **[HIGH] `aria-live="polite"` on `#chat-list` will spam SR users.**
  `index.html:1637`. Every incoming side-chat message gets read out;
  for an active chat this is noisy. Switch to `role="log" aria-live="polite" aria-atomic="false"` and
  ensure only NEW `<li>`s are added (not the whole list re-rendered).
  Verify the current renderChat() append-only behaviour in script.js.

- **[HIGH] `role="dialog" aria-modal="false"` on the tour root is
  contradictory.** `tour.js:351–353`. Either it's a dialog (modal,
  trapped) or it's a non-modal overlay (use `role="region"
  aria-label="onboarding tour"`). Pick one. Current state misleads AT.

- **[HIGH] `.consultation-note <article>` has no accessible name tying
  it to the patient.** `index.html:1193`. The `<h3>` inside is
  data-i18n driven and includes the patient name, but the `<article>`
  itself doesn't carry `aria-labelledby` pointing to that heading.
  Screen-readers will not announce "consultation note, M. Lefebvre"
  when the user enters the region via landmark navigation. Add
  `aria-labelledby="consultation-note-title"` (and give the h3 that id).

- **[NIT] `.role-chip` uses `role="radio"` on `<button>` elements**
  (`index.html:1915–1944`). This is OK per ARIA, but most ATs handle
  `role="radio"` on `<input type="radio">` more reliably. Bigger issue:
  `aria-checked="false"` for all radios at first paint means the
  radiogroup is announced as having no selection — fine — but the
  arrow-key handler in `script.js:7388` moves focus without updating
  `aria-checked` (only `click` does), violating the WAI-ARIA radio
  group pattern that says arrow should move AND select. Decide
  whether this is a "manual" radiogroup (then add `aria-activedescendant`
  or accept current behavior) or fix to auto-select on arrow.

- **[NIT] Side-chat input has both `placeholder` and `aria-label`** —
  good. But `chat-list` is `aria-label="Side-chat messages"` while
  the messages inside have no per-author structure. A screen-reader
  reads "Alice: hello world" only if the messages are rendered as
  `<li><strong>Alice</strong>: hello world</li>`. Verify the
  rendering in script.js (not inspected here).

---

## 3. Color contrast (theme tokens)

Spot checks against WCAG 2.2 AA (4.5:1 normal text, 3:1 UI / large text).

Light theme (default)
- `--muted: #5b6b7a` on `--bg: #f6f4ef` ≈ **4.72:1**. Passes AA for body
  but fails 7:1 AAA, and **fails AA when used on `--card: #ffffff` at
  very small sizes** if any `.hint`/`.empty`/`.lobby-hint` drops below
  16px. `.lobby-hint` is `font-size: 0.86rem` (`style.css:427`), and
  `.role-chip-brief` is `0.84rem` (`style.css:894`); on a 14px base
  that's ~12px text — small-text AA is the same 4.5:1 threshold, so
  these PASS by a hair, but they're below visual comfort for B1/B2 EFL
  readers. Recommend bumping `--muted` to `#4d5b6a` for ~5.6:1 and
  more comfortable scanning. **[HIGH]**
- `--caen-ink: #7a5d12` on white ≈ 6.4:1 — fine.
- `--caen-line: #b45309` on white ≈ 4.55:1 — passes AA by a whisker;
  fine for borders/UI (3:1) but should not be used for small text.
  Verify no `.score-chip` body text uses `--caen-ink` on light
  `#fbf3df` (style.css:2168–2174 → `color: var(--caen-ink)` on
  `--caen-50: #fbf3df`) — that combination is ~5.0:1. OK.
- `--ok` (#1e8449) on `--ok-50` (#e7f4ec) ≈ 4.16:1 — the developer
  already caught this and added `--ok-strong: #176b3a` (note in
  `style.css:58, 2651–2652`). Good. **Verify every consumer of `--ok`
  on `--ok-50`** in style.css uses the strong variant; a grep for
  `color: var(--ok)` flagged a few candidates worth auditing.
  **[HIGH]**
- Focus ring `--focus: #11161b` (near-black) on `--primary: #1763a6`
  (button bg) ≈ 9.8:1 — strong. ✓
- High-contrast theme (`style.css:5152–5217`) uses black-on-white with
  `--primary: #0033a0` (7:1+ on white). ✓

Dark-mode spot check
- Tokens are overridden in `@media (prefers-color-scheme: dark)`
  (`style.css:4894+`) and the same `--ok-strong` discipline applies.
  Did not exhaustively verify — recommend running axe-core or
  Lighthouse on light+dark+high-contrast as a CI gate. **[NIT]**

Decorative
- `--caen-500: #e08a1e` is commented "decorative only" (`style.css:25`)
  — usage confined to dots/art on white passes 3:1. Confirm no text
  uses this token.

---

## 4. Motion / reduced-motion

What works
- `prefers-reduced-motion: reduce` is honored in 6+ rules across
  `style.css:2589, 3036, 3126, 3688, 3818, 4334, 4413, 5627, 5729`.
- The rule is comprehensive: kills transitions, infinite loops, confetti,
  pop/spring animations; keeps a 140ms cross-fade so view changes still
  feel intentional ("finished, not dead" comment, line 2590).
- JS-side: `reducedMotion()` helper (`script.js:698–700`) gates the
  `burst()` confetti and `playCue()` audio. ✓
- Tour respects reduced-motion (`style.css:5627`). ✓

Issues
- **[NIT] `.conn-badge.conn-lost` shake animation** (`style.css:2124`,
  0.4s shake) is NOT overridden in the reduced-motion block. A
  connection-lost shake on a vestibular-sensitive user is exactly the
  kind of micro-movement to suppress. Add to the reduced-motion list.
- **[NIT] `breathe` keyframe** (style.css:2122) — already a low-amplitude
  opacity loop, but it loops infinitely. The reduced-motion block kills
  `.stage-wait:not(:empty)` and `.call-btn.pending` animations; verify
  every consumer of `breathe` is in that list.

---

## 5. Text scaling / zoom-to-200%

Concerns
- **[HIGH] Sticky right column with `max-height: calc(100vh - 80px); overflow-y: auto`**
  (`style.css:262–277`). At 200% browser zoom on a 768px-tall laptop,
  the right column's effective viewport drops to ~304px before
  scrollbars. With four tabs (Decide/Debate/Answers/Side-chat) plus
  the room's group-answer form (4 bullets × label + ul + input), the
  inner scroll is nested inside the page scroll — a known pinch-point
  for screen-magnifier users. Add `min-height: 0` for safety and
  consider disabling the sticky column above zoom ≥ 200% via a
  `(min-resolution: 192dpi)` proxy or just `@media (max-height: 720px)`
  break. Or simpler: drop `sticky` and let the page scroll naturally
  above 200% zoom.
- **[NIT] Phase stepper** (`index.html:1089–1112`) is an `<ol>` row; at
  200% on iPhone SE width (375px CSS px → effective 187px) it will wrap
  weirdly. Verify in DevTools. The `.phase-step-time` chips inside
  each step add density.
- **[NIT] Recap tables** (`index.html:1745`, 2114) use fixed-cell tables;
  at 200% zoom they may horizontally scroll. That's acceptable, but the
  outer container is missing `overflow-x: auto` on a wrapper —
  on iOS Safari this causes whole-page horizontal scroll, which the
  rest of the layout doesn't expect. Wrap tables in `<div
  class="table-scroll" style="overflow-x:auto">`.
- The 1rem text floor + 70ch prose cap (`style.css:168–171`) are good
  zoom-friendly defaults.

---

## 6. Screen-reader experience — SPIKES roleplay & consultation note

SPIKES roleplay (Module B, `index.html:1812–2240`)
- Two `<svg role="img" aria-label="...">` vignettes have meaningful alt
  text — good (`index.html:1863, 590`).
- The SPIKES strip (`index.html:1950–1958`) is a `<div>` with bold S/P/I/K/E/S
  letters and `data-i18n-html`. A screen-reader will read it as one long
  run-on sentence: "SPIKES Setting Perception (what do they already
  understand?) Invitation..." — comprehensible but dense. **[NIT]**
  Consider marking it up as a `<dl>` (Setting / what it means) so screen
  readers announce "definition list, 6 items, Setting…" — and add
  `aria-label="SPIKES framework"`.
- Role chips' radiogroup: see issues in §2 above. **[HIGH]**
- "Useful sentences" (`index.html:1960–1965`) is a single `<div>` with a
  bold strong + interpolated `&middot;`-separated phrases. The bullets
  are visual only — to a screen-reader this is one long sentence. Mark
  up as `<ul>` for proper enumeration.
- The 6 Phase-3 discussion prompts (`index.html:2000–2025`) ARE in an
  `<ol class="discussion-q-list">` — good. The `<strong>` headlines
  let SR users skim by heading-like landmarks (though they're not real
  headings — consider adding `<h4>` inside each `<li>` for landmark nav).

Consultation note (Module A, `index.html:1193–1357`)
- Wrapped in `<article class="consultation-note">` but **no accessible
  name** linking the article to its `<h3>` title — see §2 BLOCKER above.
  **[HIGH]**
- All chart sections are `<details>` with `<summary>` containing an
  icon SVG + visible text — keyboard- and SR-friendly out of the box.
- The "chart-team-warning" (`index.html:1221`) uses `data-i18n-html` so
  the `<strong>` inside is preserved across translations. ✓
- Per-bullet progress (`index.html:1119–1129`) is a `<ul>` with
  `aria-label="Group-answer progress"` — good — but check that the
  "done" / "not-done" state for each `<li>` is announced (likely via a
  visually-hidden text span injected by renderAnswers; if it's only a
  CSS class change, SR users won't perceive progress). **[HIGH]**
  Need to inspect render code.
- The Investigations lock hint (`index.html:1347–1350`) is hidden until
  needed but uses `aria-live` nowhere — when it transitions from hidden
  to visible after a wrong click, SR users won't be told.

---

## 7. Language attributes & direction

- **[BLOCKER for FR/JA] Inline foreign-language phrases lack `lang=`.**
  `index.html:2` declares `<html lang="en">`. The JS `setLang()` does
  swap `document.documentElement.lang` (`i18n.js:3267, 3370`) — good.
  BUT: even in English-mode, the page interleaves French and Japanese
  phrases without `lang` annotations:
  - `要配慮個人情報` (`index.html:720`)
  - `mayaku` italicised (`index.html:1675`)
  - `loi Kouchner` (`index.html:2038, 2076`)
  - `Annoncer une mauvaise nouvelle` (`index.html:2080`)
  - `日本語` / French language labels (`index.html:75, 192` — these are
    inside an `<option>` and are typically OK without `lang=` since
    they're language NAMES, but adding `lang="ja"` to the JP option's
    value is best-practice).

  Screen-readers attempt to pronounce these with the English voice,
  producing garbled output ("yo-hai-rio koh-jin jou-hou"). Fix: wrap
  each foreign phrase in `<span lang="ja">要配慮個人情報</span>`,
  `<em lang="fr">loi Kouchner</em>`, etc. **[BLOCKER for the JP-native
  cohort]** — the JP students typing on iOS VoiceOver will hit this on
  the lobby consent block, before they even join the session.

- Direction: All content is LTR; no `dir=` is needed. ✓ (no Arabic/Hebrew
  in the 8 supported languages.)

- Language switcher: native `<select>` is the most accessible control
  for an 8-language list. `aria-label="Language"` on the wrapper
  (`index.html:67–68, 185`) is good. ✓

---

## 8. Low-English / cognitive load / inclusion

What works
- Plain-language anti-coercion grade-note in the lobby and on every
  Welcome stage (`index.html:702–708, 1012–1018`). Excellent — addresses
  the curricular power imbalance.
- "Write in any language" hint in answer fields (`index.html:1542–1543`,
  2178–2179) explicitly invites FR/JA — exactly the kind of permission
  a B1 EFL student needs.
- CEFR self-assessment with verbal descriptors (`index.html:773–784`) +
  a "B2 selected" sensible default.
- Observer ("I'm just observing") affordance (`index.html:951–957`) —
  inclusive escape hatch with explanatory tooltip; reduces social
  pressure on anxious/low-confidence students.
- Side-chat (`index.html:1408–1413, 1627–1647`) — private clarifying
  channel that doesn't pollute the public group-answers.
- Phase stepper + per-bullet progress + next-step coach
  (`index.html:1089, 1119, 1134`) — three layers of "where am I, what
  do I do next" affordance. Strong cognitive scaffolding.
- 70ch prose cap (`style.css:168`) — long lines are notoriously hard
  for second-language readers; this is correct.
- Versioned consent in plain language with separable boxes
  (`index.html:792–817`).

Gaps
- **[HIGH] No glossary surface.** The platform has a `glossary.js`
  module (file present in the directory listing) but `index.html`
  has no visible "glossary" affordance. For terms like *cauda equina*,
  *mayaku*, *biopsychosocial*, *SHARE model*, *loi Kouchner*, a B1
  student needs a single click to see a definition without leaving the
  case. Add a small "📖 Glossary" button next to the lang switcher,
  OR auto-mark glossary terms in the case prose with a dotted underline
  and `<abbr title="...">` (works keyboard + SR + hover). The
  Reference cards (`index.html:1657–1808`) are too heavy for a
  mid-case lookup.
- **[HIGH] Reading load on Welcome / first 2 cards.** The lobby has the
  grade-note + a 6-paragraph privacy `<details>` + 2 consent boxes
  before "Join". For an A2/B1 student that's ~600 English words before
  they can act. The privacy `<details open>` (`index.html:709`) means
  it's open by default — collapse it to `<details>` (closed) and let
  motivated users open it. The grade-note is the one thing that MUST
  stay visible.
- **[NIT] Tour bubbles use `position:fixed` with viewport-relative
  coordinates** (`tour.js:174–250`). At 200% zoom or on iPhone SE width
  (375px) the layout engine falls back to centre, which is correct.
  Verify on actual devices.
- **[NIT] Predictable patterns.** Tab + Enter, ESC to dismiss, the
  same answer-add input pattern across every bullet — this is good.
  Keep it. Don't add a 6th interaction model without a strong reason.
- **[NIT] Emoji-as-icons.** 👥 🗳️ 💬 📝 💭 📋 🔒 etc. appear throughout
  (`index.html:1135, 1242, 1384, 1391` and many more). Most have
  `aria-hidden="true"` siblings, but some are inline text decoration
  that screen-readers will pronounce as "people emoji ballot box emoji
  speech balloon emoji". Audit every emoji: either wrap in
  `<span aria-hidden="true">` or use `role="img" aria-label="people"`
  consistently. For the JP cohort, some emojis carry different
  cultural connotations (the 🙏 hands gesture especially) — keep using
  the geometric/object ones, avoid faces and gestures.

---

## 9. Top 5 concrete fixes (prioritized)

### Fix 1 — Add the missing stage-announce live region (BLOCKER, 2-line fix)
`index.html` ~line 932 (inside `<main id="app">`), add:
```html
<div id="a11y-stage-announce" class="sr-only"
     aria-live="polite" aria-atomic="true"></div>
```
Reason: `script.js:5438` already writes to this id but it doesn't
exist, silently dropping every "Facilitator called / on the way /
cleared" announcement for SR users. Smallest possible code change for
the biggest SR-experience win. Consider also wiring `announce(msg)`
to this region for stage transitions in `renderStage()`.

### Fix 2 — Tour focus-trap + focus restore (BLOCKER)
`tour.js:347–430`. Two-part change:
1. In `start()`, capture `const opener = document.activeElement;` and
   stash on `active.opener`.
2. In `dismiss()`, before nulling `active`, do
   `if (active.opener && active.opener.focus) try { active.opener.focus(); } catch (_) {}`.
3. Add a `keydown` Tab interceptor that constrains focus to the
   bubble's interactive descendants while the tour is active. OR
   simpler: set `aria-modal="true"`, add the `inert` attribute to
   `#splash`, `main`, `header`, `#admin-app` on `start()` and remove
   on `dismiss()`. (Mind the polyfill — current browsers all support
   `inert` as of 2023+.)

Reason: keyboard users can currently Tab off the tour into invisible
form fields. Also, dropping focus on body after dismiss is a known SR
pain point — the next Tab lands unpredictably.

### Fix 3 — Wrap foreign-language phrases in `<span lang="…">` (BLOCKER for JP cohort)
Targets (with proposed inline change):
- `index.html:720` — `<strong lang="ja">要配慮個人情報</strong>`
- `index.html:1675` — `<em lang="ja">mayaku</em>`
- `index.html:2038, 2076` — `<em lang="fr">loi Kouchner</em>`
- `index.html:2080` — `<em lang="fr">Annoncer une mauvaise nouvelle</em>`
- `index.html:75, 192` and the global switcher `<option>`s — add
  `lang="ja"` to JP options, `lang="fr"` to FR options, etc.
- Audit i18n.js translation strings: when translating English copy
  INTO French/Japanese, the English residue ("CaNaMED", "PBL",
  "SPIKES") that survives translation should also get `lang="en"`.

Reason: JP students on VoiceOver and FR students on NVDA currently
hear English-voice mispronunciations of their own language on the
consent screen. WCAG 3.1.2.

### Fix 4 — Audit `aria-live` consumers; fix chat-list and tour role (HIGH)
- `index.html:1637` — replace `aria-live="polite"` on `#chat-list`
  with `role="log" aria-live="polite" aria-atomic="false"`. Ensure
  renderChat appends individual `<li>`s rather than reflowing the
  whole list.
- `tour.js:351–353` — pick a stance: either `aria-modal="true"` (and
  add the focus trap from Fix 2) OR drop `role="dialog"` and use
  `role="region" aria-label="onboarding tour"`. Document the choice.
- Investigate every `aria-live` instance in style/script for over-
  noisiness (`#leaderboard` is already `off` — correct; `#stage-now`
  is polite and re-renders on every stage advance — correct).

### Fix 5 — Bump `--muted` & re-audit `--ok` consumers; document contrast (HIGH)
- `style.css:42` — change `--n-500: #5b6b7a` to `#4d5b6a` to raise all
  `.hint`/`.empty`/`.lobby-hint` text from ~4.7:1 to ~5.6:1 against
  `--bg`. No layout impact, removes the worst small-text edge case.
- `style.css` — grep for every `color: var(--ok)` rule and convert
  to `--ok-strong` where the background is `--ok-50`. The dev already
  caught this once (line 58, 2651) — do a full sweep.
- Add a CI gate: run axe-core / Pa11y against the three rendered
  variants (light + dark + high-contrast) on the three main views
  (lobby, room/Module A, room/Module B) — catches regressions when
  new components are added.

---

## Honourable mentions

Things this codebase does noticeably better than typical SaaS:
- Skip-link wired and styled correctly.
- Reduced-motion AND prefers-contrast both supported, not just the
  former. High-contrast theme is a real palette, not just `filter`.
- 8-language switcher with native `<select>` (not a custom combobox),
  visible from every post-splash screen.
- Anti-coercion language in plain English at decision points.
- Versioned, separable consent.
- `--note-*` tokens for the consultation-note surface, themed per
  light/dark/HC so the warm-paper effect doesn't strand white text on
  cream in dark mode (`style.css:69–74` + override blocks).
- Toast aria-live re-arm trick (`script.js:794–798`) — most apps don't
  bother and SR users miss every second toast.
- Plain-language data-rights export button next to the waiting room
  (`index.html:923–927`).

---

*End of report.*
