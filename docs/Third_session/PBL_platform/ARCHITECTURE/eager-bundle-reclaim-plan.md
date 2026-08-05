# Eager-bundle reclaim — the plan for splitting the room/admin engine out of `script.js`

**Status: SLICES 1 AND 2 DONE (2026-08-04, 2026-08-05). SLICE 3 IS NOT
SCHEDULED — still owed, deliberately not next (user decision 2026-08-05); see
its section for why and for what a future attempt must not assume.**
Written 2026-07-31, immediately after the S7 cutover shipped (#263); slice 1
executed 2026-08-04, slice 2 on 2026-08-05. The splash budget **passes at
312.88 / 316 KB gz** locally (311.46 on CI, which normalises CRLF to LF).
This document exists so the reclaim the perf
budget header has recorded as owed since **2026-06-28** can be executed
deliberately rather than improvised under pressure the next time the cap bites.

> **Slice 2 result (2026-08-05) — `script-admin.js`.** The facilitator
> DASHBOARD engine — 61 functions and 20 top-level bindings, 2645 lines —
> moved out of the eager `script.js` into a lazy chunk loaded by
> `CanamedLoader.ensureAdminApp()` from `_enterAdminAppLazy()`, the single shim
> both admin routes (`joinAdmin`, `joinSuperAdmin`) now pass through.
> `script.js` **218.5 → 185.0 KB gz**; splash first-party **346.98 → 312.88**,
> cap **347 → 316**. That is **34.0 KB in one move**, ~13 KB more than §4's
> indicative ~21 KB. (Measured CRLF on a Windows working tree, against `main`;
> CI normalises to LF and reads ~1.4 KB lower — 345.41 → 311.46.)
>
> **The cap is 316, not the 312.88-rounded-up 313, and that is a deliberate
> break with the previous three entries.** Every earlier reclaim set the cap to
> the local measurement rounded up. Doing that here would have left 0.12 KB of
> local headroom — i.e. it would have recreated, 34 KB lower down, the exact
> zero-headroom budget this slice was commissioned to fix, on the same day two
> PRs had to trim comment PROSE to land. A budget with no room to move stops
> being a guardrail and becomes a tax on every later PR. 347 → 316 still hands
> back **31 of the 34 KB**; the ~3 KB left is WORKING MARGIN, not an allowance —
> enough for a feature's incidental growth, nowhere near enough for a new eager
> asset. **If you find yourself editing this cap upward, you owe a reclaim or an
> argument, not a rounding.**
>
> **§4's call-site price was 29; the real number was 6.** Not because the table
> was wrong, but because it prices a slice *before* you know its closure. Moving
> the whole transitive cluster turns almost every predicted guard into an
> INTERNAL edge: of the ~29, all but six ended up chunk→chunk. The six that
> remained are `enterAdminApp` + `startAdmin` in each of the two routes (folded
> into one shim), `setRoomStage` ×2 in `initStageNav`, and `backToDashboard` in
> `initLeave`. **Read the call-site column as an upper bound, not a forecast.**
>
> **The plan's own entry-point list contained two non-members**, and reading
> call sites (as §4 insists, not line ranges) is what caught them:
> `renderLeaderboard` is called by `startRoom` / `renderScore` /
> `renderButtons` / `buildDecision` — a ROOM renderer the dashboard also uses —
> and `closeMySession` hangs off `renderMySessions`, i.e. the splash's "My
> sessions" list, a different surface behind a different click. Both were left
> eager. So were `getTheme`/`setTheme`, `logEvent`, `roomSlotBuckets`,
> `_debriefT`, `_debriefBucket`, `renderStudentDebrief`, `renderClosedState`,
> `downloadMyData`, `showLateBanner` and `stageNow`, all genuinely shared.
>
> **What the move actually cost was the TEST surface, exactly as §6 predicted.**
> 14 unit files that read `script.js` as text had to be repointed at the
> concatenation of both files, and four e2e specs reached moved globals straight
> from the splash and had to load the chunk explicitly (the convention
> `sim-recommendations.spec.js` already uses for `ensureRoomStyles`). One of
> those four — `mixed-session-e2e.spec.js` — would have **silently skipped**
> (`if (archive === null) test.skip(...)`), so it was changed to assert instead.
> `tests/edge-cases.test.js`'s R2-01 assertions had to be INVERTED: they pinned
> "the loader must not reference script-admin.js", which was correct while it
> was an empty placeholder and is the opposite of correct now.
>
> **One trap worth recording for slice 3:** a `page.route()` abort cannot
> simulate a missing chunk while the service worker is registered — sw.js is
> cache-first and a SW-issued fetch is not intercepted, so the "chunk fails"
> test passed vacuously until it was given `test.use({ serviceWorkers:
> "block" })`.

> **Slice 1 result (2026-08-04) — `takehome.js`.** The wrap-up take-home block
> (`buildRoomTakeawayMarkdown` + `downloadMyRoomAnswers`, `_mdEsc`,
> `_caseItemById`, `downloadCertificatePdf` + `_verifyUrl`, and the five booklet
> functions) moved out of the eager `script.js` into a lazy chunk loaded by
> `CanamedLoader.ensureTakeHome()` from `initEndPoll()`'s three click handlers.
> `script.js` 225.2 → 218.9 KB gz; splash first-party **352.4 → 346.3** local
> (350.8 → 344.8 LF), cap **353 → 347**. `_mountSurveyForm` and `downloadMyData`
> were left in place, and neither for a byte reason: `_mountSurveyForm` is called
> from `renderSurvey()`, a RENDER path (including its facilitator-preview
> branch), not from behind a click — so moving it means making a currently
> synchronous call site async; and `downloadMyData` is wired in the WAITING room
> at join time (the Art. 15 self-export button), nowhere near wrap-up, so it
> needs its own choke point rather than riding `initEndPoll()`. Both remain
> movable; they just are not the same one-click shape, and folding them into the
> rehearsal slice would have widened its blast radius for ~1 KB.
>
> **§4's premise held, and one recorded obstacle turned out to be false.** The
> perf header's 2026-08-04 entry had rejected this same split because the block
> "reads eleven `script.js` top-level bindings … none of which is on `window`, so
> moving it means inventing a context object and rewiring five unit tests". That
> inference was wrong, and §5.2 below already said why: a CLASSIC script shares
> the global script scope, so a top-level `let` in `script.js` is visible in the
> chunk under its bare name. No context object was invented; the five unit tests
> were **repointed** at `takehome.js` rather than rewritten. If a future slice
> hits the same "it reads module-scope state" objection, check §5.2 first — the
> objection is only real for state held inside a *closure*, not at top level.

Read this before touching `script.js` with a split in mind. In particular read
**§2 (what was measured)** and **§3 (why the obvious method does not work here)** —
§3 records a dead end so nobody spends an afternoon rediscovering it.

---

## 1. What is owed, and why

`perf.spec.js`'s header has carried the same debt through six entries since
2026-06-28: *"lazy-split the in-room (Module B + branched) logic + room-only CSS
out of the eager script.js/style.css."* The CSS half was paid on 2026-07-23
(`room.css`). The JS half was not, and every entry since has restated it while
the cap crept 330 → 333 → 337 → 345 → 348.

The S7 cutover paid a *different* debt (the create-form section picker →
`section-picker.js`, 2026-07-31), which bought back 5.6 KB gz and is what makes
the budget pass today. **That reclaim was spent on the cutover; this one is
still outstanding.** The ~3 KB of headroom now sitting under the cap is
headroom, not an allowance.

## 2. What was measured (2026-07-31, against `main` @ `33c0795`)

`script.js` is **721 KB raw / 219.6 KB gz**, 528 functions.

Empirical V8 coverage (Playwright `page.coverage.startJSCoverage`), driving the
real splash and then the create form:

| Metric | Value |
| --- | --- |
| Functions that ever execute | **56 of 528** |
| Bytes never executed | **543 KB of 721 KB raw (75.4%)** |
| gzip of the never-executed text | ~155.8 KB (indicative only — gz is not additive) |

So roughly three quarters of the eager bundle is code a facilitator on the
splash never runs. That is the *ceiling*, not the reclaim — see §4.

**Reproduce it** with a throwaway spec that wraps `page.coverage`, takes the
outermost range per function, merges overlapping/nested cold intervals (they
nest — summing raw ranges yields a nonsense 100%), and slices the source. Do
not trust a byte-percentage that is not de-overlapped.

## 3. The method that does NOT work here — static call-graph analysis

**Do not try to derive slice boundaries from a static call graph. It was tried
on 2026-07-31 and it fails on this codebase.** Both variants fail, in opposite
directions:

- **Loose edges** (any identifier token matching a known function name) report
  that the admin closure *contains* the whole room engine — 99.9 KB gz movable,
  room a strict subset of admin. Attractive and completely wrong: the edges are
  produced by names appearing in unrelated contexts.
- **Tight edges** (`name(` call syntax only) report that `enterAdminApp` reaches
  **nothing** — not `renderDashboard`, not `openRoomAsAdmin`. Also wrong.

The two are wrong for *different* reasons, which is why neither can be patched
into the other:

- The **loose** variant produces FALSE POSITIVES. Its edges are "this token
  appears somewhere in that function body", so a name mentioned in a string, a
  property access, or an unrelated local binding manufactures an edge. Closures
  then inflate until everything reaches everything.
- The **tight** variant produces FALSE NEGATIVES, and *that* is the
  listener-driven part: **this app defers almost every real edge through a
  callback.** `enterAdminApp` does not call `renderDashboard`; it registers a
  Firebase `.on("value")` handler that eventually does, and the dashboard's own
  controls are wired with `addEventListener` closures. A `name(` scan sees the
  registration, never the invocation.

Tightening the loose variant walks it toward the tight one's blindness; loosening
the tight one walks it back into noise. The information needed simply is not in
the syntax.

A static analysis that disagrees with itself by 100 KB is not a basis for
moving security-adjacent code. **Use coverage (§2) to find cold clusters, and
use call-site counts (§4) to price the move.**

## 4. The real constraint is REFERENCES, not execution

Cold ≠ movable. A function can be never-executed on the splash and still have
to be *defined* eagerly, because something eagerly registered mentions it. The
work in a split is not moving the definitions — it is that **every eager
reference to a moved name must become a guarded / lazy call.**

That, not byte count, is what prices each slice:

| Candidate slice | Entry points | Eager call sites to guard | Indicative size |
| --- | --- | --- | --- |
| **Take-out** (`downloadMyData`, `downloadMyRoomAnswers`, `downloadCertificatePdf`, `_mountSurveyForm`) | 4 | **2** | ~11 KB gz |
| **Admin** (`enterAdminApp`, `startAdmin`, `renderDashboard`, `renderPrestart`, `renderLeaderboard`, `generateImpactReport`, `closeMySession`, `joinSuperAdmin`, `openRoomAsAdmin`) | 9 | **29** | ~21 KB gz |
| **Room** (`startRoom`, `renderStage`, `buildButtons`, `renderButtons`, `buildDecision`, `renderDecisions`, `checkScoreEvents`, `renderStudentDebrief`) | 8 | **28** | ~16 KB gz |

The size columns are from name-pattern grouping and are indicative; the
call-site counts are exact and are the number that matters.

## 5. The pattern that works (proven three times)

`room.css` (2026-07-23), `admin.css`, and `section-picker.js` (2026-07-31) all
used the same shape. Follow it:

1. **One surface behind one click.** Split on a UI boundary a user must cross,
   not on a code-tidiness boundary.
2. **Move the block VERBATIM into a classic script** — not an IIFE module. Its
   top-level `function` / `let` declarations then stay global exactly as they
   were, so existing call sites *and the e2e specs that drive globals through
   `page.evaluate`* keep working with no rewrite to `window.*`. Rewriting to
   `window.*` is how you turn a byte reclaim into a week of new failure modes.
   (`section-picker.js` carries a header explaining this; copy the reasoning.)
3. **One choke point loads it.** `splashShowView("create")` loads the picker —
   the single function every route into that view passes through, so the
   button, a deep link and "Create another" are covered by one call site
   instead of three that drift.
4. **`typeof`-guard every eager reference**, and make the guard's failure mode a
   real message, not a `ReferenceError` out of a submit handler.
5. **Fetch in parallel, never chained** behind a big dependency. Chaining the
   5 KB picker behind the 200 KB case-content bundle was measurably worse.

## 6. Proposed slice order

**Slice 1 — Take-out (exports / certificate PDF / survey mount). ✅ DONE
2026-08-04 as `takehome.js` (the survey mount and `downloadMyData` were left
behind — see the status note at the top for why).**
2 eager call sites, leaf-ish, already adjacent to lazy `student-pdf.js` and
`pdfmake`. Every entry is behind an explicit download/submit click. This is the
rehearsal: it proves the loader wiring and the test strategy at low blast
radius. **Do this one first even though it is the smallest.**
`Verify:` `ls docs/Third_session/PBL_platform/takehome.js`; `grep -c
ensureTakeHome docs/Third_session/PBL_platform/script-loader.js` > 0; `node
--test tests/takehome-lazy-split.test.js`.

**Slice 2 — Admin dashboard. ✅ DONE 2026-08-05 as `script-admin.js`** (see the
status note at the top for what it actually cost and what was left behind).
Largest single win and the closest analogue to the picker split: a whole surface
behind `#splash-go-admin`, with `admin.css` and `admin-tools.js` already lazy
siblings. ~~29 guards~~ — **6 in the event**, see the status note. The prediction
"risk is the test surface, not the code" was exactly right: no production code
needed rewriting, while 14 unit files and 4 e2e specs did.
`Verify:` `ls docs/Third_session/PBL_platform/script-admin.js`; `grep -c
ensureAdminApp docs/Third_session/PBL_platform/script-loader.js` > 0; `node
--test tests/admin-lazy-split.test.js`; `npx playwright test
tests-e2e/admin-lazy.spec.js`.
**Not done: the emulator run.** This slice moves no rule-touching logic — the
dashboard writes the same admin-gated nodes from the same functions, only from a
different file — and the emulator ports were in use by another agent at the
time. Run `npm run test:e2e:rules` before relying on this slice in a rules-
adjacent change.

**Slice 3 — Room engine. ⛔ NOT SCHEDULED (user decision, 2026-08-05). Still
owed; deliberately not next.** Slices 1 and 2 banked 40 KB between them
(353 → 313) and the budget passes with no UI work blocked, so both of this
plan's own stopping rules apply: §6's *"Stop after any slice that gets the
budget where it needs to be. There is no prize for moving all three"* and §8's
*"If the budget is passing and no UI work is blocked, leave it."* The trigger to
revisit is unchanged and is stated in §8 — a PR that needs headroom and cannot
get it any other way. **Do not read the rest of this section as a queued task;
read it as the brief for whoever eventually pulls that trigger.**

28 guards but the highest coupling: stage rendering, decisions, scoring and the
branched engine interlock, and `applySectionContent()` / `refreshActiveSlotState()`
sit on the hot path between them. Do this last, and only if slices 1–2 have not
already bought enough headroom. **Note the admin/room entanglement:** the admin
"Open room" control enters the room engine, so slice 3 must not assume slice 2
made the room unreachable. **Concretely, after slice 2:** `openRoomAsAdmin` →
`enterRoom` → `startRoom` → `renderStage`, and `closeSession` →
`renderClosedState` → `renderStudentDebrief`, are now chunk → eager edges. They
need no guard today (script.js has fully evaluated before `script-admin.js`
loads), but when the room engine moves they become chunk → chunk and the LOAD
ORDER starts to matter — `script-admin.js` can be resident while
`script-room.js` is not.

**⇒ Slices 1 and 2 have bought 40 KB between them (353 → 313), and slice 3 is
NOT scheduled (see the heading above). Per §8, the trigger to start it is a PR
that needs headroom and cannot get it any other way. That is not today.**

Stop after any slice that gets the budget where it needs to be. There is no
prize for moving all three.

## 7. Non-negotiables for every slice

- **Shell version.** Changing ANY precached shell asset requires the bump — not
  just a lazy chunk. That includes `index.html`, `script.js`, `style.css`,
  `sw.js` itself, and every chunk loaded through `script-loader.js`. All three
  `SHELL_VERSION` markers move in lockstep: `sw.js` (`canamed-shell-vNNN`),
  `script-loader.js` (`SHELL_VERSION = "vNNN"`), and every `?v=vNNN` in
  `index.html`. `tests-e2e/shell-csp-vendoring.spec.js` only checks the three
  markers AGREE with each other — it cannot tell that a *changed* asset needed a
  new number — so a PR that edits a chunk without bumping passes CI and ships
  undeployable, with clients serving the cached old file.
- **`LOCALE_VERSION` is a SEPARATE counter** (`i18n.js`, currently `v13`),
  independent of `SHELL_VERSION`, that cache-busts the `locales/*.js` chunks
  only. Bump it when a locale file changes. A split that touches no locale text
  does not need it — but note that both counters have been bumped independently
  on both sides of a merge before, so after any rebase/merge diff BOTH against
  BOTH parents, not just against `main`.
- **Register the chunk in three places** or it is silently wrong:
  `sw.js` precache list, `perf.spec.js` `LAZY_CHUNKS` (unregistered, an
  idle-prefetched chunk still counts against the budget), and — if it has specs —
  the three mobile `testMatch` allowlists in `playwright.config.js`.
- **A unit test asserting the eager file keeps NO copy.** Tests that read the
  concatenation of both files cannot tell them apart, so without this a future
  edit can restore an eager copy while every other assertion still passes.
- **A duplicate-declaration guard.** The chunk shares global scope; a `let`
  declared in both files is a redeclaration `SyntaxError` that surfaces only
  when the chunk evaluates, taking the whole surface down at once.
- **Per-device Playwright coverage** for anything with UI, per the standing rule.
- **Ask what the eager init was incidentally FETCHING.** Removing the eager
  picker init also removed the `ensureCaseContent()` call its not-loaded-yet
  branch happened to make, which moved `CASE` later and broke four specs that
  had implicitly relied on it for months. Before deleting an eager call, list
  its side effects, not just its rendering.

## 8. When NOT to do this

If the budget is passing and no UI work is blocked, leave it. This is a large
refactor of the code that runs a live classroom session; its failure modes
(a room that cannot render, a dashboard that cannot advance a stage) are worse
than a few KB. The trigger to start is a PR that needs headroom and cannot get
it any other way — at which point Slice 1 is a day's work and buys ~11 KB.
