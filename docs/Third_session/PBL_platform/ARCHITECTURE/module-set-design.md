# Module set — selectable modules per session

**Status: COMPLETE for what was asked.** M0–M3b **shipped & merged** (PRs #241–#245,
PR #247 stepper tidy-up, #248 M3b; live through shell v108). The requirement is
delivered as of M2 (#243): Modules A and B are independently selectable and
facilitator-narrowed. A **third module type already exists and is live** — the
**branched** format (see the "third module type ALREADY EXISTS" section below),
so M5's "add a real third module" was moot. M4/M5 as written remain **unbuilt and
are only relevant if branched must become MIXABLE with A/B in one session** — a
product decision that was NOT requested. Supersedes decision 8 of
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

### M0 — Foundation (no behaviour change) ← DONE (PR #241, shell v102→v103)
> Shipped exactly as planned below, plus a **6th** bypass site found during
> implementation (the dashboard-row Back/Advance, not just the sidebar). The
> resolver landed as `moduleSet()`/`moduleAtStage()`/`stageForModule()`/
> `moduleNameTrio()`.
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
- **Client half: DONE (M3a part 2, shell v105→v106).** Removed ~350 lines of
  already-no-op code from `script.js`: `renderPrompts` + helpers, the two prompt
  `.on` wiring blocks, `renderModBExchange` + helpers + the exchange nav wiring in
  `initModBPhaseNav`, all four refs and their assign/`.on`/`.off`, the three
  `_test_set*` hooks, and the four computed-never-read locals in
  `revealModARightCol`. Also removed the collateral dead "auto-open Group answers
  once the discussion is done" flow (it required `promptsWereDone`, permanently
  false, so it never fired) — the Debate & answers tab reveals purely on the
  hypothesis gate via `revealModARightCol()`. Three unguarded live call sites were
  the real hazard (`renderCase`→`renderPrompts`, `initModBPhaseNav`→
  `renderModBExchange`, and the `promptsWereDone` read in `renderDecisions`); all
  three handled. script.js shrank ~4 KB gz. 984 unit + room-flow e2e (desktop + 3
  mobile) green; the two `modA-vote-flow` tests pinning the removed routing were
  dropped, and `investigations-anytime` / `modA-investigations-synthesis-split`
  now assert the gate drives the reveal via `revealModARightCol()` (not the
  removed `renderPrompts`).
- **Stage-1 stepper tidy-up: DONE (shell v106→v107).** Removed the 6 no-op
  `setPhaseStepperState("stage-1", …)` calls from `updateModANextStep()` and the
  dead `#stage-1 .phase-stepper` CSS rule (`room.css`). Chose *remove*, not
  restore: Module A's progress is a derived hypothesis gate, not linear phases, so
  a stepper never fit its model. `setPhaseStepperState` itself stays — Module B's
  `renderModBPhase` still calls it for the live `#stage-2` stepper.
  `tests/stage1-progress-hierarchy.test.js` flipped from asserting the rule EXISTS
  to asserting it stays GONE (its no-global-restyle guard is unchanged). 984 unit
  + Module A coach/reveal e2e green.

**M3b — thin adapter, NOT a merged engine. ← DONE (shell v107→v108).**
- Extracted `applyPhaseVisibility(stageId, sections, phaseKey, columnsSel,
  expandedIn)` and `renderModulePhase(cfg, phaseIndex)` as shared plumbing, and
  moved Module B's phase config (`phases`, `sections`, columns-collapse, nav ids)
  into a `MODULE_PROGRESS.B` registry entry that **references** the existing
  `MODB_PHASES`/`MODB_PHASE_SECTIONS` (one source of truth, no copy).
  `applyModBPhaseVisibility` and `renderModBPhase` are now **name-preserving
  wrappers** — the ~11 callers/specs that drive them are untouched and green.
- `setModBPhase` / `initModBPhaseNav` were **left module-B-specific on purpose**:
  nav wiring is inherently coupled to the module's own set-phase + DB ref
  (`refModBPhase`), so a future module supplies its own tiny nav wiring rather
  than forcing a generic DB-write path with one consumer. Honest boundary.
- **Module A is DELIBERATELY absent from `MODULE_PROGRESS`** — its progress is a
  derived hypothesis gate (`revealModARightCol`), not an ordinal phase list, and
  a unit test now guards against a future edit "helpfully" registering it.
- Behaviour-preserving: 984 unit (the one predicted `stage-ui-fixes.test.js`
  columns-collapse assertion moved to the new location; +3 M3b seam tests) +
  Module B phase e2e (`modb-phase-flow`, `stage-ui-fixes`, `modab-role-sections`,
  `module-b-collapsible`) desktop + 3 mobile green. No rules/DOM/export change.
- **Honest note on value:** this seam buys nothing user-facing; its only future
  consumer is a phase-based module C. Built because the plan called for it and it
  is low-risk + behaviour-preserving. If module C is a phase-based module it can
  now declare its phases as data; if it needs a *different* mechanic, this seam
  costs nothing to ignore.
- When module C lands, add a literal `moduleC` rules block (~8 lines × 2 trees) —
  do **not** introduce a `$moduleId` wildcard (named keys shadow wildcards in
  RTDB, so you'd keep the duplication anyway). Revisit the wildcard at module D.

### The third module type ALREADY EXISTS — the branched format (clarified 2026-07-26)

The user pointed out that a third module type is not hypothetical: the **branched
scenario** is developed and **live** (`ward-escalation-branched`, registered via
`branched-seed.js`; the `branched-render/runtime/seed` engine is precached in the
shell; shipped through v108). So M4/M5 below were framed on a false premise —
there is nothing to "add".

**What branched IS today:** a whole-*session* format (`format:"branched"`), NOT a
per-stage module. `MODULE_REGISTRY` is `[A→1, B→2]`; branched is absent.
`moduleSet()` returns `[]` for it (script.js:558/581), `standardStageFlow()`
special-cases it to `[0,1,LAST]` (script.js:677), and its content renders on
**stage 1** (Module A's stage) with the PBL chrome hidden via
`body[data-format="branched"]` CSS. So a session is *either* A/B *or* branched —
they are mutually exclusive because branched reuses A's stage.

**⇒ The initiative is COMPLETE for what was asked.** Three module types exist and
ship (A, B, branched); A and B are independently selectable + facilitator-narrowed
(M0–M2, live). The requirement — "Modules A and B selectable one without the
other, several modules per session as the facilitator wants" — is delivered.

### M4 / M5 — branched as a MIXABLE module (REQUESTED 2026-07-27; approach = COMPOSITION)

Goal: run branched **in the same session as A/B** (Module A → a branched case →
Module B). **Chosen approach = COMPOSITION (survey Option C):** a mixed session
REFERENCES a standalone branched scenario by id for its branched stage; the
branched engine (`branched-render/runtime/validate`) and the branched scenario
schema + authoring stay **untouched**. The new work is session/stage plumbing, not
schema. Rejected: inline-namespaced graph (Option A) and shared `decisions[]`
(Option B) — both entangle the branched node shape with A/B decision validation.

**Verified facts driving the plan (2026-07-27 survey):**
- Branched reuses **stage 1** and hides ALL PBL chrome via **`body[data-format=
  "branched"]`** CSS (`branched.css`). Most rules are already `#stage-1`/`.stage`
  scoped — only two are genuinely global: the `#mobile-rcol-tabbar` hide (but
  `updateMobileTabbar()` ALSO gates that on `#stage-1` visibility) and the
  `#branched-final-host` show/hide.
- `renderDecisions()` hard-loops `["A","B"]` into `#decisions-A`/`#decisions-B`;
  every branched node is tagged `module:"A"` so it lands in `#decisions-A`. The
  branched engine renders INTO existing containers (`#decisions-A`,
  `#branched-final-host`) — it builds no stage DOM. So a branched stage is ~tens
  of lines of shell, not ~1200.
- `STAGE_COUNT = 4` (const); `MODULE_REGISTRY = [A→1, B→2]` (fixed indices);
  `stage <= 3` validate bound in BOTH rule trees; `stage.label.N` in i18n.js + 7
  `locales/*`. Branched uses NO module-scoped RTDB node — it rides room-level
  `votes/$voteId` + `score/*`, and writes its final deliverable/rationale to
  `answers/moduleA` (would collide with real Module A in a mix → needs its own
  `answers/moduleBranched`).
- The branched sub-scenario runs from its own scenario context
  (`window.DECISIONS`, `CURRENT_SCENARIO_FORMAT`, `CURRENT_SCENARIO_FINAL_STEP`),
  which the single-scenario engine assumes globally — the hard part of M4 is
  giving the branched STAGE its own scenario context without swapping the outer
  A/B scenario's globals.

**Staged plan (each a reviewable, verified PR):**
- **M4a — épuré CSS body→stage re-scope ← DONE (PR #251, shell v108→v109).** Set
  `data-format` on the `.stage` elements (not just `body`), re-scope the
  stage-content épuré rules in `branched.css` from `body[data-format]` to
  `.stage[data-format]` / `#stage-1[data-format]`, keep the two genuinely-global
  rules (mobile-tabbar, final-host) body-scoped for now. Standalone branched is
  byte-identical (body AND stages both get the attr); this lays the stage-level
  hook so a future mixed session can be épuré on ONLY the branched stage. Survey's
  #1 risk, isolated + done first. Verified by the branched e2e (unchanged) + a new
  stage-attr assertion.
- **M4b — the 5-stage model ← DONE (shell v109→v110).** `STAGE_COUNT` 4 → 5:
  branched became a real `MODULE_REGISTRY` entry at **stage 3**, and **wrap-up
  moved 3 → 4**. Chose a fixed 5th index over a fully dynamic stage count because
  the flow must stay **monotonic** — `snapStageToFlow()` walks the flow array
  assuming ascending order, so an out-of-order module→stage map would break nav.
  (Consequence: a mixed session runs A → B → branched → wrap-up. Interleaving
  branched *between* A and B would need per-session stage assignment, i.e. the
  fully dynamic model — deliberately not built.)
  - The renumber was **nearly free**: `script.js` never hardcodes the wrap-up
    index (every site derives `STAGE_COUNT - 1`) and no CSS referenced
    `#stage-3`, so it was 1 id in `index.html` + the positional arrays.
  - Extended `STAGE_LABELS` / `STAGE_MINUTES` / `STAGE_NOW`, added
    `stage.label.3` (decision case) + moved wrap-up to `.4` across `i18n.js`
    **and all 7 locales**, bumped `LOCALE_VERSION` v7 → v8.
  - Added the minimal `#stage-3` branched shell (a decisions container +
    final-host, `data-format="branched"` stamped statically) — **tens of lines**,
    not the ~1200 of A/B chrome, because branched has no chrome by design.
  - **Bug caught:** `branched-render.js` hardcoded `LAST_STAGE = 3`, which the
    renumber would have silently desynced from the shell. It now DERIVES it from
    a published `window.CANAMED_LAST_STAGE` — one source of truth.
  - Rules: `stage <= 3` → `<= 4` in **both** trees; emulator-proven (26 pass).
  - **Lands INERT:** stage 3 only enters the flow when a scenario *declares* the
    branched module, and branched is never name- or scoring-inferred. An A/B
    session runs `[0,1,2,4]`, skipping it — same seam-first pattern as M0.
- **M4c — composition schema + reference resolution.** A mixed scenario declares
  `modules:[…"branched"…]` + a `branchedRef` (a standalone branched scenario id);
  resolve+load that sub-scenario and give the branched stage its own scenario
  context (DECISIONS/final-step) without clobbering the outer A/B globals. Render
  the referenced tree on the branched stage via the existing branched engine.
- **M4d — rules.** Literal `answers/moduleBranched` block × 2 trees (+ any
  module-scoped branched state), emulator-proven. (Room-level votes/score already
  work as long as node ids are unique.)
- **M5 — author.** Let a scenario declare a branched module by REFERENCING a
  standalone branched scenario (a picker of branched scenarios), not by inlining
  a graph — so the A|B decision whitelist (`scenario-author.js` validate/import)
  need not change for the graph shape; it only needs to accept "branched" in the
  module list. Rework the pinned tests below.

**Riskiest part (survey):** the body→stage CSS re-scope — presentation-only, so
every DOM/unit test can pass while the layout silently breaks. Verify VISUALLY
(screenshots) on desktop + mobile, both a standalone branched session and (once
M4c lands) a mixed one. Runner-up: the per-stage scenario context in M4c.

## Test debt to expect

~40 files pin the two-module assumption. The ones that must change earliest:
`tests/r3-blockers.test.js:376-388` (source-regex on `..._B_NAME` +
`stageLabel`), `tests/scenario-author-startfrom.test.js:95`
(`skel.moduleBName.en`), `tests/rules.test.js:667-688`
(`for (const mod of ["moduleA","moduleB"])`), `tests/global-stage-stepper.test.js:37-38`
(asserts `STAGE_COUNT` segments — **already stale**, it contradicts the shipped
`stageFlow()` behaviour), and the stage-2 CSS/DOM assertions in
`tests/stage-ui-fixes.test.js`.
