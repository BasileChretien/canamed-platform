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

### S1b — slots become positional
`STAGE_COUNT` becomes dynamic (`flow = [0, …slots, last]`); a slot's stage is
its **position**, so a roleplay picked first runs on stage 1. `stageLabel()`
becomes "Section k — title"; i18n `stage.label.N` collapses to one pattern key
across `i18n.js` + 7 locales (`LOCALE_VERSION` bump); `STAGE_MINUTES` /
`STAGE_NOW` / `TOUR_STAGE` become slot-aware. Rules: `stage` bounded by a max
slot count instead of `<= 4`.

### S1c — Roleplay content becomes data (decision 9)
Extract the roleplay chrome out of `index.html` (`#stage-2`, ~726 lines) into
per-section data: role briefs (public + private), the SPIKES/framework steps,
useful sentences, historical context and guidelines. The 3 built-in roleplays
must be re-expressed as data with **no visible change** (screenshot-verified),
and the `data-i18n` keys they use today move from the shell into section
content across `i18n.js` + 7 locales. This is the prerequisite for a Roleplay
skeleton that is genuinely "empty but ready to fill".

**Same audit is owed for PBL.** The stage-1 reference panels (`#refA-panel-
history`, `#refA-panel-guidelines`, `index.html:1525/1575`) are static too —
chronic-pain-flavoured text shown regardless of the active case. They belong in
section data for the same reason.

### S2 — Per-slot DB paths
`rooms/$roomId/section/$slot/…` and `answers/section/$slot` replace the
module-literal nodes in both trees; decision/vote ids namespaced per slot.
Emulator-proven per node, including cross-room and cross-slot denial.

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
