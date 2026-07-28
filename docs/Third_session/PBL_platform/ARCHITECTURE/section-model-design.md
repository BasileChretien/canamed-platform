# Section model — a session is an ordered list of independently-picked sections

**Status: PLANNED (2026-07-27). Supersedes the session-shape half of
[module-set-design.md](module-set-design.md).** That initiative delivered
*narrowing* — a session runs a subset of the modules **of one scenario**. This
one deletes the scenario as the unit of selection: a session becomes
**opening + an ordered list of N sections chosen from a flat library + wrap-up**,
where each section may come from a different clinical case.

## The requirement (user, 2026-07-27)

> We have created 4 different sessions, each with different material, each split
> in at least 2 different parts. Each part must be considered independent, and
> selectable as is in order to create a new session. Thus the "Scenario (the
> clinical case for this workshop)" must disappear, and be replaced by a
> **section picker**.

And second:

> At the moment I am the only one able to create new modules. I want any
> facilitator to be able to create his own. He must be able to use the skeleton
> present in [the PBL, the roleplay, and the branched case] — they must be called
> something like **"PBL"**, **"Roleplay"**, **"Branched Scenario"** and be empty
> but ready to fill (for the PBL there must be a way to write the prompt to play
> the patient, etc.). In the future I will add other skeletons from other modules
> I develop — but only me.

So: **skeleton *types* stay code-owned (mine); section *instances* become
facilitator-owned.**

## Ratified decisions (2026-07-27)

| # | Question | Decision |
|---|----------|----------|
| 1 | How free is the pick? | **Any number of sections, any order.** Two PBL sections in one session is legal. Stage indices become per-session, not per-module-type. |
| 2 | How deep does "Scenario" die? | **Split the library into standalone sections.** The 3 built-in cases become 3 PBL + 3 Roleplay sections; the branched case becomes 1 Branched section. "Scenario" disappears from picker, author and cloud library. |
| 3 | Tests | **Each section owns its own pre/post-test items**, concatenated in slot order for the session. |
| 4 | Cross-case mixing | **Intended.** One session may hold two different patients. Stage 0 lists one blurb + objectives block per section. |
| 5 | Authored sections | **Same picker as built-ins** (My + Shared), and an authored **Branched** section must be composable into a mixed session — lifting today's built-ins-only resolver limit. |
| 6 | Research export | **Export v2 (clean break) + a converter** that re-emits archived sessions in the v2 shape, so the whole dataset is uniform. |
| 7 | Cutover | **Hard cutover.** The `scenarioId` path is removed; archived sessions are reachable through the export, not re-playable in the app. |
| 8 | Student-facing labels | **Position + title** — "Section 2 — Painless jaundice workup". The type (PBL / Roleplay / Branched) is facilitator-facing only, shown in the picker. |

Decision 6+7 together are the reason this is a re-architecture rather than an
increment: they remove the obligation to keep `moduleA`/`moduleB` alive, which
is what makes per-slot paths tractable at all.

Two further decisions, taken after the code survey below surfaced their cost:

| # | Question | Decision |
|---|----------|----------|
| 9 | The Roleplay chrome is hardcoded HTML, so a Roleplay skeleton has nothing to fill. | **Extract it all into section data** — role briefs, SPIKES steps, useful sentences, historical context and guidelines become per-section content. Adds phase **S1c**. |
| 10 | Splitting the tests per section leaves the jaundice PBL section with ~0 items. | **Ship the split with the honest distribution, and draft the missing PBL items as a clearly-marked proposal** for medical review — never auto-merged into the live tests. |
| 11 | Must an authored roleplay fill all four reference panels + an observer checklist? | **Every panel is OPTIONAL** — an authored roleplay shows only what it fills, and an unfilled panel disappears rather than rendering blank. The observer checklist picks from a **shipped framework library** (SPIKES, Calgary–Cambridge, Pause/Explore/Explain/Realign) with a custom option. The library is code-owned, like the skeleton types. |
| 12 | Can an authored roleplay change the six fixed phases? | **Yes — it declares its own phase list** (names + minutes), and which cards appear in which phase is part of that declaration. This is the consumer M3b's phase-visibility seam was built for. |
| 13 | `revisit.html` lets participants re-open a past session. | **New shape only.** Honour the hard cutover: revisit resolves sessions created after the change, and older revisit links stop working. Accepted user-visible loss, chosen over a permanent compatibility branch. |
| 14 | What happens to facilitators' existing whole-scenario cloud saves? | **Auto-split on load**, using the same derivation S0 applies to the built-ins; saving writes them back as separate sections. No migration script, no second shape in the library. |

## What exists today (verified 2026-07-27, not from memory)

- `window.CANAMED_SCENARIOS` (`case-content.js:3994`) holds **3** standard
  scenarios, each bundling `moduleAName` + `moduleBName`, one `case`, one
  `characters`, one `scoring` (with `.moduleA`/`.moduleB` families), `penalties`,
  `decisions` (each tagged `module:"A"|"B"`), `synthId`/`synthPrereqs`, and
  **one** `preTest` + `postTest` for the whole scenario. `branched-seed.js`
  merges in the 4th, `ward-escalation-branched` (`format:"branched"`).
- `STAGE_COUNT = 5` is a **const** (`script.js:542`); `MODULE_REGISTRY` is a
  fixed `[A→1, B→2, branched→3]` (`script.js:567`); wrap-up is `STAGE_COUNT-1`.
- Stage DOM is **static and per-module-type**: `#stage-1` is ~570 hand-authored
  lines of PBL chrome (`index.html:1427-1997`), `#stage-2` ~726 lines of roleplay
  chrome (`1998-2723`), `#stage-3` a thin branched host (`2724`). Ids are
  module-literal (`modA-*`, `decisions-A`, `answer-input-moduleA-*`).
- DB paths are module-literal in **both** rule trees: `rooms/$roomId/moduleA`,
  `moduleB`, `answers/moduleA`, `moduleB`, `moduleBranched`; `stage` is bounded
  `<= 4`.
- The create form already has a module tick-row (`splash-create-mod-<id>`,
  `script.js:13061`) writing a write-once `sessions/$id/modules` CSV — **the
  right shape, wrong granularity**: it narrows within one scenario.
- `composeBranchedModule()` (`script.js:685`) already does the hard part of
  cross-referencing: deep-copy a referenced case's nodes, namespace their ids
  (`br_…`), rewrite `unlockWhen.afterDecision` edges in lockstep, append to the
  outer `DECISIONS`. **The section model is that mechanism, generalised to every
  section type and to N slots.**

## The real cost (three blockers)

1. ~~**Stage DOM is static and singular.** N sections in any order means the PBL
   and Roleplay chrome must become `<template>`s cloned per slot, with every id
   namespaced per slot (`#s2-modA-…`) and every `el("modA-…")` lookup
   slot-scoped. This is the single largest chunk and cannot be avoided by
   decision 1.~~
   **⚠️ MIS-SCOPED — corrected 2026-07-27 while implementing S1a.** N slots do
   **not** need N copies of the markup, because **exactly one stage is visible
   at a time**: `renderStage()` hides every stage but the viewed one. So the
   markup is a **view the active slot borrows**, not a per-slot instance.
   `#stage-1` stops meaning "stage number 1" and starts meaning "the PBL view";
   `#stage-2` "the roleplay view"; `#stage-3` "the branched view". Two PBL
   sections in one session reuse the PBL view and re-render against their own
   slot's data. Three consequences:
   - The ~1200-line templating job **disappears**; S1a was ~60 lines + a
     resolver.
   - **Zero CSS churn** — every `#stage-1 …` / `#stage-2 …` rule in `room.css`,
     `style.css` and `branched.css` already reads as a per-type selector, which
     is why they keep working unchanged.
   - The real work moves to **S2**: switching slots must re-render and re-bind
     to a different slot's DB paths, so per-slot storage is the load-bearing
     piece, not the DOM. Budget the effort there.
2. **Every module-scoped DB path becomes slot-scoped**, in both rule trees, with
   an emulator proof per node. Vote ids and decision ids must be namespaced per
   slot (two PBL sections in one session would otherwise collide on
   `votes/$voteId`), exactly as `composeBranchedModule()` already does for `br_`.
3. **Pre/post-test items are per-scenario, not per-section.** Splitting them is
   *content* work (a judgement call on which item belongs to the workup vs the
   conversation), not mechanical. Flagged for review — see "Open judgement
   calls".

Two things make it tractable: the `moduleSet()`/`stageFlow()`/`moduleAtStage()`
seam from M0 already centralises stage↔module resolution, and decision 7 means
no back-compat shim has to survive alongside the new path.

## Phases

Each phase is one reviewable PR with per-viewport Playwright coverage, and the
emulator suite for any rules change.

### S0 — Section registry (inert; no behaviour change)
Derive `window.CANAMED_SECTIONS` from the existing content: 3 PBL + 3 Roleplay
+ 1 Branched, each `{ id, type, name, summary, objectives, content…, preTest,
postTest }`. The runtime still runs the old scenario path; the registry is
unread. Includes the pre/post-test split (judgement call flagged below).

### S1a — the slot seam (no behaviour change) ← DONE (shell v112→v113)
`sectionSlots()` / `slotAtStage()` / `stageViewId()` / `allStageViewIds()`
introduced in `script.js`, and `renderStage()` routed through them: it now shows
the **view** the current stage resolves to instead of the like-numbered node.
Every function returns exactly today's answer (a slot sits at its module's fixed
stage), so this is a seam in the M0 sense — the behaviour flip is S1b.
- The **fallback is load-bearing**: a standalone branched scenario has an empty
  `moduleSet()` yet renders on stage 1, so an unmapped stage must still resolve
  to its like-numbered node. Losing that blanks the whole session; test-pinned.
- 9 new unit tests (1056 total green) + 19 chromium and 34 mobile E2E
  (`stage-progression`, `branched-format`, `branched-playthrough`,
  `stage-ui-fixes`) green with no spec changes — the point being that a seam
  which needed test edits would not be a seam.

### S1b — slots become positional ← DONE (locale v8→v9)
The behaviour flip. A slot's stage IS its position, so **pick order is running
order**: a roleplay picked first runs on stage 1 and shows the roleplay view
there.
- **The flow is now CONTIGUOUS.** `standardStageFlow()` returns
  `[0, …positions, last]`. Before S1b an A-only session ran `[0,1,4]` with two
  dead stages; a B-only one ran `[0,2,4]`.
- **`STAGE_COUNT` is no longer the stage count** — it survives only as the
  physical cap (`MAX_SECTION_SLOTS + 2`, i.e. the largest index the DB rules
  accept). Per-session counts come from `stageCount()` / `lastStage()`, and
  `window.CANAMED_LAST_STAGE` is republished by `refreshModuleStages()` so the
  lazy `branched-render.js` cannot desync from the shell.
- **Every index-keyed table became role/type-keyed**: `STAGE_LABELS`,
  `STAGE_MINUTES_BY_ROLE` + `stageMinutes()`, `STAGE_NOW_BY_ROLE` +
  `stageNow()`, and `TOUR_STAGE.studentModA` (now the first PBL slot, wherever
  it landed — a session opening with a roleplay would otherwise have dismissed
  the Module A tour the moment it started).
- **Labels**: `stageLabel()` renders `"Section k — <title>"` from one i18n
  pattern (`stage.label.section`) across `i18n.js` + 7 locales;
  `stage.label.welcome` / `.wrapup` replace the index lookup for the two ends.
  The old `stage.label.1/2/3` keys are gone; `.0`/`.4` stay only as a fallback
  for a cached older bundle. `LOCALE_VERSION` v8 → v9.
  - **Trap this closed:** the wrap-up used to be `"stage.label." + i`. With a
    per-session index a 2-section session's wrap-up is stage 3, which would
    have fetched the *"Decision case"* label.
  - **Second trap, same cause:** the wrap-up MARKUP is `#stage-4` while it now
    sits at stage 3, so `stageViewId()` resolves the ends by role. Resolving
    `"stage-" + n` would have shown the branched view as the wrap-up.
- **Standalone branched** gets a synthetic slot (`type:"branched"`,
  `view:"stage-1"`, `standalone:true`) instead of relying on S1a's like-numbered
  fallback: the flow now has to know the session has exactly one section. It
  still borrows the **PBL view**, because the branched engine's standalone
  render targets (`#decisions-A`, `#branched-final-host`) live there.
- **Rules**: `stage <= 4` → `<= 9` in both trees (`MAX_SECTION_SLOTS` = 8).
  Keep the two in lockstep.
- Verified: 1060 unit green (20 specs updated — the predicted test debt, all of
  it pinning the fixed module→stage map) + a new browser spec
  (`section-stage-labels.spec.js`) proving the labels, the contiguous flow, the
  reordering and the wrap-up view on chromium/firefox/webkit + all 3 mobile
  viewports, plus the existing stage/branched/module-B suites green unchanged.

**⚠️ Operational note for S1b.** Contiguous numbering changes what a stored
`roomStage` MEANS for a session created before the deploy. `snapStageToFlow()`
absorbs most of it (a stale wrap-up index snaps to the new wrap-up), but a
**B-only** session mid-flight would read its old stage 2 as the new wrap-up.
Acceptable under decision 7 (hard cutover), and B-only sessions shipped only
weeks ago — but do not deploy S1b in the middle of a live workshop.

### S1c — Roleplay content becomes data (decision 9)
Extract the roleplay chrome out of `index.html` (`#stage-2`, ~726 lines) into
per-section data. Sliced, because it is content extraction across three
independent subsystems and each needs its own no-visible-change proof:

**S1c-1 — the CAST ← DONE (shell v113→v114).**
The roles were hardcoded in **three places at once** — the four `.role-chip`
buttons in `index.html`, `ASSIGN_ROLE_DECK` and `REPLAY_ROLE_ORDER` — so every
roleplay on the platform was necessarily physician / patient / family /
observer with Mrs Tanaka's briefs. The cast is now ONE list
(`roleplayRoles()`) read from `CURRENT_SECTION_ROLEPLAY`, defaulting to today's
four **including their existing i18n keys**, so the built-ins are unchanged.
- `assignRoleDeck()` and `replayRoleOrder()` replace the two literal arrays;
  the random-assign spill now goes to the **last declared role** rather than a
  literal `"observer"` (an authored cast need not have one).
- `renderRoleChips()` rebuilds the chip row from the cast and **no-ops when it
  matches the markup**, so the shipped chips keep their hand-authored i18n
  attributes. It re-arms `initRolePicker()`, whose listeners are wired once over
  the chips that existed at the time — without that an authored cast renders
  but does not respond.
- Role ids are validated (`^[a-z][a-z0-9_-]{0,23}$`, deduped): they become DOM
  `data-role` values and RTDB keys. A declaration that resolves to nothing
  usable falls back to the default rather than leaving a roleplay with no cast.
- `applyScenario()` reassigns the block **including to null** — the same
  staleness trap `scenarioModuleSet()` documents for module names.
- An authored brief goes in as `textContent`, not via the sanitised-innerHTML
  i18n path: it is facilitator input, not a shipped string.
- 10 new unit + 3 browser tests; 1070 unit + 351 chromium E2E green.

**S1c-2 — the reference panels ← DONE (shell v114→v115).**
`refB-panel-{history,guidelines,recap,useful}` were static case-specific prose
shown to every roleplay, so a facilitator's own roleplay still displayed
France/Japan disclosure history. They are now OPTIONAL section data
(decision 11): a section fills what it wants and an unfilled panel disappears
**button and all** — a toolbar button that opens an empty region is worse than
an absent one.
- Built-ins are safe **by construction**: a section that declares no `panels`
  key at all leaves the shipped markup untouched (`if (!panels) return`), the
  same no-op discipline as `renderRoleChips()`. Declaring `panels` opts INTO
  full control.
- Content shape, all fields optional:
  `{ label, paragraphs: [...], bullets: [...] }`; trios are resolved through
  `tc()` so an authored section may still be multilingual.
- Text-only by construction (`createElement` + `textContent`) — panel prose is
  facilitator input. E2E-pinned with an injection payload.
- 5 unit + 3 browser tests; 1075 unit / 585 chromium+mobile E2E green.
**S1c-3a — the observation framework ← DONE (shell v115→v116).** The observer's
tick-list was six hardcoded SPIKES `<li>`, so an antibiotic-negotiation roleplay
handed its observer a breaking-bad-news checklist. It now comes from a shipped
LIBRARY (decision 11) — `OBSERVATION_FRAMEWORKS`: SPIKES, Calgary–Cambridge,
Pause/Explore/Explain/Realign — picked by id, with a custom `{label, steps}`
escape hatch. Library is code-owned, instances facilitator-owned, the same rule
as the skeleton types.
- SPIKES keeps its existing `modB.obs.*` i18n keys; the two added frameworks
  ship English-only per the English-canonical policy.
- Declaring nothing → no-op, shipped markup untouched. An unknown id or a
  custom framework with no usable step degrades to the shipped list rather than
  emptying the checklist.
- Custom step ids are validated because they key the observer's private
  `sessionStorage` scratchpad — a malformed one would tick but never persist.
- `renderObserverChecklist()` re-arms `initObserverChecklist()`, which binds its
  change listeners once over the boxes that existed then. Browser-pinned: an
  authored checklist still saves what the observer ticks.
- 8 unit + 3 browser tests; 1083 unit / 591 chromium+mobile E2E green.

**S1c-3b — authored phases ← DONE (shell v116→v117).** `MODB_PHASES` was a
six-entry literal, the minute budgets lived in the markup and the stepper was
six hand-authored `<li>`, so every roleplay ran the breaking-bad-news
timetable. Decision 12: the phase list is section data, and WHICH CARDS a phase
shows is part of the declaration — **the consumer M3b's phase-visibility seam
was built for and never had.**
- A phase names its cards by **key, not CSS selector** (`ROLEPLAY_CARDS`):
  a raw selector from a facilitator can be malformed (`querySelectorAll`
  throws) or reach chrome it has no business touching, and a key is something
  the S5 author UI can offer as a tick box.
- `modBProgressCfg()` resolves the config per section and returns
  `MODULE_PROGRESS.B` untouched when nothing is declared. All three consumers
  route through it — including the `Math.min(…phases.length - 1)` clamp, which
  against a literal six would have stranded the last phase of a longer list.
- **Every known card gets a `sections` entry, even one no phase shows.** An
  omitted card is never touched by `applyPhaseVisibility` and would sit
  permanently visible; an empty `phases` array is what "the author did not
  include this" has to mean.
- Phase ids are validated: they are written to `rooms/$room/moduleB/phase` and
  read back as DOM `data-phase` values.
- **Third instance of the re-arm bug** — and the one that nearly shipped:
  `initModBPhaseNav()` guards on a `_wired` **property** of the stepper node
  (not a dataset flag) and binds one listener **per chip, by index**. Clearing
  the wrong flag leaves an authored stepper rendering perfectly and completely
  untappable. Test-pinned in both layers.
- 8 unit + 5 browser tests; 1091 unit / 601 chromium+mobile E2E green.
**S1c-3c — vignette + title ← DONE (shell v117→v118). S1c IS COMPLETE.**
The last hardcoded case-specific block on the roleplay stage: an `<h2>` reading
"Module B — Breaking Bad News: A Cross-Cultural Roleplay" (carrying the very
"Module B" wording decision 8 retired) and a situation paragraph naming
Mr/Mrs Tanaka-Martin, both shown to every roleplay. `vignette` takes a string
or an array of paragraphs so the situation can be read out in beats.
- **An authored title must REMOVE the `data-i18n` binding, not just overwrite
  the text** — `applyI18n()` runs on every language switch and would otherwise
  put the shipped heading straight back over the authored one. Browser-pinned
  by re-running `applyI18n` after the override.
- Only the prose is replaced; the editorial SVG spot is shell decoration and
  belongs to the layout, not the section.
- 6 unit + 3 browser tests; 1097 unit / 859 chromium+mobile E2E green.

**⇒ A Roleplay section is now fully authorable**: cast, briefs, four reference
panels, observation framework, phase timetable, title and vignette. That is the
prerequisite decision 9 named for a Roleplay skeleton that is genuinely "empty
but ready to fill" (S5).

**Same audit is owed for PBL.** The stage-1 reference panels (`#refA-panel-
history`, `#refA-panel-guidelines`, `index.html:1525/1575`) are static too —
chronic-pain-flavoured text shown regardless of the active case. They belong in
section data for the same reason.

**Same audit is owed for PBL.** The stage-1 reference panels (`#refA-panel-
history`, `#refA-panel-guidelines`, `index.html:1525/1575`) are static too —
chronic-pain-flavoured text shown regardless of the active case. They belong in
section data for the same reason.

### S1c-fix — two rules that still policed the BUILT-IN shape ← DONE
Making content authorable moved validation boundaries the DB rules were still
enforcing against the shipped roleplay. **Both were live defects in S1c**, and
neither could be caught by the LOCAL-mode E2E suite, which does not exercise
rules at all:
1. `moduleB/roleAssign/assignments/$cid` validated against the literal four role
   ids (`physician|patient|family|observer`). An authored cast's random-assign
   wrote fine client-side and was **rejected by the database**. Now validated
   against the same id GRAMMAR the client enforces.
2. `moduleB/phase` was bounded `<= 5` — the built-in six-phase timetable's
   length — so phase 7 of an authored 8-phase roleplay was **unwritable**. Now a
   generous sanity cap (`<= 19`), not the shipped timetable's length.

Both fixed in **both** rule trees and emulator-proven (28 pass). **Lesson for
S2 and S5: every rule that enumerates a built-in value is a latent bug the
moment that value becomes authorable.** Worth grepping the rules for literal
enums before the next extraction.

### S2 — Per-slot DB paths

**S2a — the rules land INERT ← DONE.** `rooms/$roomId/sections/$slot/…` and
`answers/sections/$slot` added to **both** trees; nothing writes them yet, so
this is additive-only (118 insertions, 0 deletions) and cannot affect a live
session.
- **Slot children are CLONED from each tree's own `moduleA`/`moduleB`**, so
  validation is identical by construction rather than by careful re-typing:
  `revealed`, `scoring/awarded`, `hypotheses` (PBL-shaped) + `phase`,
  `roleAssign` (roleplay-shaped). A slot node carries the union because a slot's
  TYPE is a property of the section, not of the path.
- `$slot` is guarded `^[1-9]$` (`MAX_SECTION_SLOTS` = 8, stage 0 being Welcome)
  and closed with an `$other` sentinel, per the R3 hardening pattern.
- Emulator-proven (**31 pass**): two PBL slots keep independent boards, a
  roleplay slot carries its phase, out-of-range and non-numeric slot keys are
  refused, unknown slot children are refused, and per-slot answers inherit the
  same bounds as `answers/moduleA`.
- **The formatting trap:** re-dumping the rules JSON from a parsed object
  reflowed hand-tuned one-liners across the whole file (194±63 lines of churn in
  a security-critical file). Insert surgically as text instead — the diff must
  be reviewable as pure addition.
- ⚠️ Note for whoever runs the emulator: kill orphaned `java.exe` on 9000/9099
  first ("Could not start Database Emulator, port taken"), and the cross-tab
  stage-advance test can flake on a 15 s timeout under load — re-run before
  believing it.

**S2b — move the client onto them (TODO).** Read/write paths, decision and vote
id namespacing per slot (two PBL sections must not collide on `votes/$voteId`),
then retire the module-literal nodes in S6.

### S3 — The section picker at session-create
The Scenario `<select>` is replaced by an add/reorder list. The session stores
an ordered, write-once `sections` list. Pre/post-tests concatenate in slot
order; stage 0 renders one blurb + objectives block per section.

### S4 — Export v2 + converter
Per-slot `sections` manifest and per-slot columns; a one-off script re-emits
archived sessions in the v2 shape.

### S5 — Author: three skeletons, single-section authoring
Skeleton picker offers **PBL**, **Roleplay**, **Branched Scenario**, each empty
but complete. A PBL skeleton must expose: the **LLM patient persona prompt** +
case vignette, history/exam/investigation items with scoring + penalties, group
decision/vote cards, and per-section pre/post-test items + objectives. Cloud
library saves sections (not scenarios); authored sections appear in the picker
alongside built-ins; an authored Branched section resolves at runtime (lifting
the built-ins-only limit).

### S6 — Hard cutover cleanup
Remove the `scenarioId` create path, the `modules` CSV narrowing, `moduleA/B`
naming and the now-dead rules nodes.

## Open judgement calls (flagged for the user, not blocking)

1. **Pre/post-test split.** Each existing test is one flat list per scenario
   (e.g. `PRETEST_CHRONIC_PAIN`, `case-content.js:2670`). Items are topically
   separable — a red-flag/imaging item is clearly PBL, a disclosure/consent item
   clearly Roleplay — so S0 tags them by content and the split is offered for
   medical review rather than guessed silently at runtime.
2. **The four original combinations stop being one-click.** Decision 2 chose the
   plain split, not the split-with-presets variant, so re-running "session 1"
   means ticking its two sections. Say the word and S3 adds presets.
3. **Two sections of the same type in one session share nothing.** Two PBL
   sections mean two separate scoring boards and two separate LLM patients. That
   is the honest reading of decision 1; the alternative (a merged leaderboard) is
   a product decision, not a technical one.
