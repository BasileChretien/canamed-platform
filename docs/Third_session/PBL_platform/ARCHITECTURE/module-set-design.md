# Module set — selectable modules per session

**Status:** planned 2026-07-24. Phase M0 in progress. Supersedes decision 8 of
[scenario-characters-design.md](scenario-characters-design.md) ("Fixed Module A +
B skeleton"), which deliberately deferred this.

## The requirement

1. **Module A and Module B must be selectable independently** — run A without B,
   or B without A.
2. **Several modules must be implementable in the same session, as the
   facilitator wants** — so the module set is a per-session choice, and adding a
   module C later must be additive, not a rewrite.

## Decisions (ratified 2026-07-24)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Source of truth = BOTH.** The scenario *declares* the modules it contains; the facilitator *narrows* to a subset at session-create. Effective set = `intersection(scenario.modules, session.modules)`. | A breaking-bad-news scenario genuinely only contains Module B (content-determined), but the same scenario should be runnable A-only one week and A+B the next (facilitator-determined). |
| 2 | **Target = a general N-module engine**, not a special-case A/B toggle. | Explicit user instruction. The stage plumbing already generalises (see below), so the incremental cost over a 2-module toggle is concentrated in the DOM + phase engines. |
| 3 | **Module ids are opaque strings.** | Already the de-facto model: DB rules never constrain `decisions[].module`; `answersDeleted.module` is a length-bounded free string (`database.rules.json:392`); `characters[].module` is already an **array**. Only `scenario-author.js` validate/import narrow it to `A\|B`. |
| 4 | **Archive / research exports stay BACK-COMPATIBLE.** New generic per-module output is *added*; the existing `moduleA`/`moduleB` columns and object keys keep emitting for scenarios that have those modules. | These are published research-data contracts tied to a live study (SAP / IRB). A breaking change would invalidate an in-flight analysis pipeline. Version the export rather than reshape it. |
| 5 | **No user-visible behaviour change until M1.** M0 is a pure refactor + bug fix. | De-risks a large refactor: every later phase builds on a centralised seam that is already proven green. |

## Why this is tractable: the seam already exists

`stageFlow()` / `snapStageToFlow()` / `adjacentStage()` (`script.js:542-553` →
`branched-render.js:430-454`) already produce **variable-length sessions**:
branched scenarios return `[0, 1, 3]`, skipping Module B entirely, with correct
"Stage 2 of 3" numbering, stepper, and advance-rolls-past behaviour.

Two further accidents of the current design help:

- `SCORING["module" + mod]` (`script.js:9165`, `9330`) and
  `el("decisions-" + mod)` (`9722`) are **string-built lookups** — they
  generalise for free once `mod` comes from a list rather than a literal.
- `branched-author.js:118-119` already writes a **placeholder**
  `moduleBName: en("Reflection")` purely to satisfy the two-module schema —
  direct evidence the fixed pair is being worked around, not used.

## Known blockers (the real cost)

1. **Stage index ≠ module identity.** `stageLabel()` hardcodes `i === 1` → A,
   `i === 2` → B (`script.js:519-520`). Also `STAGE_LABELS`, `STAGE_MINUTES`,
   `STAGE_NOW`, `TOUR_STAGE`, and `stage.label.N` across **9 locale files**.
2. ~~**Two divergent intra-module progress engines** — Module A uses
   `promptCursor` + `phaseGateOpen()` + `revealModARightCol()` +
   `#mobile-rcol-tabbar`; Module B uses `modBPhase` + `MODB_PHASES` +
   `MODB_PHASE_SECTIONS`. Unrelated implementations of the same idea. Merging
   them is the single biggest chunk and the prerequisite for a 3rd module.~~
   **⚠️ THIS BLOCKER WAS MIS-SCOPED — corrected 2026-07-24 after a code survey.**
   Two of the five named pieces were **dead code**: `promptCursor`/`promptReplies`
   no-op (`renderPrompts()` early-returns; `#prompts-card` had been deleted from
   `index.html`), as do `exchangeCursor`/`exchangeReplies`. `#mobile-rcol-tabbar`
   is a *mirror* of the canonical tabs, not an engine. And the two surviving
   pieces are **NOT the same idea**:
   - Module A gates on **derived evidence** (`history≥1 && exam≥1` →
     Decide tab; `hypotheses≥1` → Debate tab). That is the PBL 7-jump ordering —
     it cannot be skipped and cannot be forged, because it is computed.
     Visibility is per-participant and **stickily monotonic**.
   - Module B is an **ungated wall-clock timetable**: an ordinal 0..5 index any
     participant may jump freely (the minute budgets live in the markup), because
     "the scene has been played" is not derivable from any observable. Visibility
     *is* the shared state.
   A merged engine would have to be simultaneously client-sticky-monotonic and
   server-authoritative-bidirectional — contradictory storage models. Worse,
   reifying Module A's derived gate into a writable index would **silently delete
   the pedagogy the platform exists to teach**, and every DOM test would still
   pass. `tests/modA-rcol-reveal.test.js` (which greps `revealModARightCol` for
   `phaseGateOpen()`) is therefore a **design contract, not a source-regex smell** —
   do not "clean it up".
   **So: do NOT merge them.** See the revised M3a/M3b below.
   Also de-risking, and previously unnoticed: **no export reads any progress
   state** (`promptCursor`, `promptReplies`, `moduleB/phase`, `exchangeCursor`,
   `exchangeReplies` appear in no export, no `functions/`, no `student-pdf.js`),
   so decision 4's SAP/IRB export contract is **not in play** for M3 at all.
3. **Static DOM.** `#stage-1` + `#stage-2` are ~1200 hand-authored lines of
   `index.html` (1402-2679) with per-module ids (`modA-*`, `modB-*`,
   `decisions-A/B`).
4. **DB rules duplication.** `rooms/$roomId/module{A,B}` and
   `answers/module{A,B}` exist in BOTH the `sessions/` and `orgs/` trees
   (`database.rules.json:301-388` / `830-917`), and `stage` is bounded
   `<= 3` (`239`, `761`).

## Phases

Each phase is one reviewable PR. Emulator (`npm run test:e2e:rules`) is the only
real validation for rules changes; per-viewport Playwright for any UI change.

### M0 — Foundation (no behaviour change) ← IN PROGRESS
- **Fix 4 call sites that bypass `stageFlow()`** and use raw `STAGE_COUNT`:
  admin sidebar per-room ←/→ (`script.js:6304/6309`), "Advance all rooms"
  (`4493-4494/4506`), student Back/Next disable (`7928-7929/7942`), debrief time
  legend (`6223`). **These are a live bug today**: a facilitator can park a
  *branched* room on the skipped stage 2, a dead stage.
- Introduce the central resolver — `moduleSet()`, `moduleForStage()`,
  `stageForModule()` — returning today's answer exactly (`["A","B"]` standard,
  `[]` branched), and route the hardcoded derivations through it:
  `stageLabel()`'s `i===1`/`i===2`, `renderObjectives()`'s
  `viewStage === 2 ? "B" : "A"` (`9321`), `celebrateEvents()`'s
  `roomStage === 2` (`9241`).
- Tests: existing suites stay green + new tests pinning the resolver and the
  no-dead-stage guarantee.

### M1 — Scenario declares its modules; single-module sessions work ← DONE
- Scenario body may declare `modules: ["A"]`; it needs **no author UI and no
  schema work** because Phase 1's passthrough bag already round-trips unknown
  top-level keys. Undeclared scenarios are **inferred**, so there is no
  migration: **naming a module is what switches it on.**
- Inference is **name-first**, falling back to scoring families only when no
  module is named. That ordering matters: `applyScenario()` resets
  `CURRENT_SCENARIO_MODULE_*_NAME` for every scenario but only overwrites
  `window.SCORING` when the new scenario *has* a `scoring` key — so a
  name-blind rule would let a previous scenario's leftover `scoring.moduleB`
  resurrect Module B in an A-only session.
- `stageFlow()` is now Welcome + one stage per enabled module + Wrap-up
  (A-only → `[0,1,3]`, B-only → `[0,2,3]`). script.js publishes
  `CANAMED_MODULE_STAGES` via `refreshModuleStages()`; the lazy
  `branched-render.js` consumes it (falling back to `[1,2]` on an older cached
  shell). Branched keeps its own `[0,1,LAST]`.
- Author `validate()` now requires **at least one** module rather than both, and
  rejects a decision belonging to a module the scenario does not run (it would
  render into a stage the session never visits).
- **Blocker found and fixed:** the author could not save a single-module scenario
  at all. `scenarioJsonToState()` seeds one BLANK scoring row per module so the
  form always renders an editable line, and `toScenarioJson()` emitted it — so
  the unused module's blank row failed validate with "missing an id", and an
  empty family round-tripped as `[{blank}]` instead of `[]`. Blank rows are now
  dropped on output (`notBlankScoringRow`; note `points` is NOT a blankness
  signal — `emptyScoringRow()` defaults it to 5).
- Wrap-up and the take-home booklet are set-driven: both previously leaked the
  absent module's content (the wrap-up printed an empty block under a hardcoded
  "Module B - Breaking Bad News" heading, and the booklet's fixed selector pulled
  unvisited stage-2 template cards — the stage-2 DOM still exists, it is merely
  never shown).

### M2 — Facilitator narrows at session-create ← DONE
- Write-once `sessions/$sessionId/modules` declared in **both** trees, modelled
  on `scenarioId`. Stored as a **CSV string** (`"A"`, `"A,B"`) — the id regex is
  generic (`[A-Za-z0-9_-]{1,16}` segments, bounded to 64 chars), so a future
  module C needs **no rules change**. Chosen write-once (`!data.exists()`) so a
  session's shape cannot shift under participants mid-flight; to change it, make
  another session.
- `moduleSet()` is now `intersection(scenarioModuleSet(), sessionNarrowing)`.
  An intersection that would be EMPTY (stale selection, or a scenario swapped
  under it) is **ignored** rather than producing an unrunnable session.
- `loadSessionScenario()` reads `modules` alongside the scenario fields and calls
  `setSessionModules()` **before** any `applyScenario()` — that calls
  `refreshModuleStages()`, so publishing the narrowing later would let the
  session's first `stageFlow()` briefly offer a stage it does not run.
- `createSession(..., modules)` writes the CSV, and only when the pick is a
  **strict subset** — an unnarrowed session writes no `modules` field at all and
  is byte-identical to M1.
- Create-form picker reuses the existing `.splash-role-toggle` / `.splash-role-opt`
  classes (**no CSS change**) and plain English (the UI is English-canonical, so
  no i18n key + `LOCALE_VERSION` churn). Both boxes ticked by default. It needs
  no per-scenario lookup: the selection is intersected with the scenario's own
  set, so unticking a module the scenario lacks is harmless.

### M3 — REVISED (see the correction in blocker 2). Do NOT merge the engines.

**M3a — remove the dormant subsystems.**
- **Rules half: DONE 2026-07-24.** Dropped four participant-writable nodes that
  existed for state nothing rendered or exported —
  `moduleA/{promptCursor,promptReplies}` and
  `moduleB/{exchangeCursor,exchangeReplies}` — from **both** trees. Confirmed with
  the SAP owner first that no analysis reads those paths. Removing a rule denies
  future writes only; existing data is untouched and still reachable via the admin
  SDK and the GCS backups. Emulator-proven: the four paths are now DENIED while
  `moduleA/revealed`, `moduleA/hypotheses` and `moduleB/phase` still write.
- **Client half: STILL TO DO.** ~350 lines of already-no-op code in `script.js`:
  `renderPrompts`, `_advancePromptCursor`, `_onPromptReplyInput`,
  `_flushPromptReply`, `updateDiscussionTabLock`, `promptsWere*`, the
  `refPrompt*` wiring, `renderModBExchange`, `_onModBExchangeReplyInput`,
  `_flushModBExchangeReply`, `setModBExchangeCursor`, the `refModBExchange*`
  listeners, the four dead locals in `revealModARightCol` (`modAAnswers`,
  `hasPromptReply`, `hasModAVote`, `moduleASettled` — computed, never read), and
  the five no-op `setPhaseStepperState("stage-1", …)` calls (`#stage-1` has no
  `.phase-stepper`; either delete the calls or restore a stage-1 stepper, but do
  not leave both). Needs a shell bump. `tests/mobile-bottom-tabbar.test.js` pins
  `updateDiscussionTabLock` → update it alongside.

**M3b — thin adapter, NOT a merged engine.**
- Generalise `applyModBPhaseVisibility` → `applyPhaseVisibility(stageId,
  sections, phaseKey)`; move `MODB_PHASE_SECTIONS` into a `MODULE_PROGRESS`
  registry keyed off `MODULE_REGISTRY`; generalise the nav wiring in
  `initModBPhaseNav`. Keep `applyModBPhaseVisibility` / `setModBPhase` /
  `renderModBPhase` / `initModBPhaseNav` as **name-preserving wrappers** so the
  ~11 specs that drive them stay green.
- Module A registers with `advance: null` and **keeps `revealModARightCol` as its
  own visibility function** — its sticky per-tab reveal must not be forced into
  B's selector table.
- Explicitly OUT of scope: any change to `phaseGateOpen()`,
  `revealModARightCol()`'s gate expressions, `moduleA/revealed`,
  `moduleA/hypotheses`, or any export path.
- Only two assertions break, both source-text greps:
  `tests/stage-ui-fixes.test.js` (the `.columns.modB-columns` body check and the
  `MODB_PHASE_SECTIONS = [` literal). No rules change; shell bump yes.
- Effort: ~2 PRs, low / low-medium risk. **M3 is not the big chunk — M4 is**
  (1200 lines of hand-authored stage DOM + `STAGE_COUNT = 4` + `stage <= 3`).
- Do **not** introduce a `$moduleId` rules wildcard for M3: it buys nothing for
  A+B, and because named keys shadow wildcards in RTDB you would keep the
  duplication anyway. When module C lands, add a literal `moduleC` block
  (~8 lines × 2 trees) — tighter and reversible. Revisit at module D.

### M4 — Templated stage DOM + generic rules + versioned exports
- Generate a stage shell per module (blocker 3).
- Rules: `$moduleId` wildcard for `rooms/$roomId/modules/$moduleId` +
  `answers/$moduleId` in both trees; lift the `stage <= 3` bound.
- Exports: add generic per-module output, keeping the A/B columns (decision 4).

### M5 — Add a real third module
- The proof the engine generalised, plus the author-UI repeater and dropping the
  `decisions[].module` `A|B` whitelist (`scenario-author.js:1166`, and the
  import coercion at `1388`).

## Test debt to expect

~40 files pin the two-module assumption. The ones that must change earliest:
`tests/r3-blockers.test.js:376-388` (source-regex on `..._B_NAME` +
`stageLabel`), `tests/scenario-author-startfrom.test.js:95`
(`skel.moduleBName.en`), `tests/rules.test.js:667-688`
(`for (const mod of ["moduleA","moduleB"])`), `tests/global-stage-stepper.test.js:37-38`
(asserts `STAGE_COUNT` segments — **already stale**, it contradicts the shipped
`stageFlow()` behaviour), and the stage-2 CSS/DOM assertions in
`tests/stage-ui-fixes.test.js`.
