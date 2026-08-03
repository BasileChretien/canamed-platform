# Eager-bundle reclaim — the plan for splitting the room/admin engine out of `script.js`

**Status: PLAN ONLY. No code has moved.** Written 2026-07-31, immediately after the
S7 cutover shipped (#263). Nothing here is urgent: the splash budget currently
**passes at 345 / 348 KB gz**. This document exists so the reclaim the perf
budget header has recorded as owed since **2026-06-28** can be executed
deliberately rather than improvised under pressure the next time the cap bites.

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

Both are wrong for the same structural reason: **this app is listener-driven.**
`enterAdminApp` does not call `renderDashboard`; it registers a Firebase
`.on("value")` handler that eventually does, and the dashboard's own controls
are wired with `addEventListener` closures. Neither edge kind models that.

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

**Slice 1 — Take-out (exports / certificate PDF / survey mount).**
2 eager call sites, leaf-ish, already adjacent to lazy `student-pdf.js` and
`pdfmake`. Every entry is behind an explicit download/submit click. This is the
rehearsal: it proves the loader wiring and the test strategy at low blast
radius. **Do this one first even though it is the smallest.**

**Slice 2 — Admin dashboard.**
Largest single win and the closest analogue to the picker split: a whole surface
behind `#splash-go-admin`, with `admin.css` and `admin-tools.js` already lazy
siblings. 29 guards. Risk is the test surface, not the code — dozens of specs
drive the dashboard, so budget a full per-viewport sweep plus the emulator run
(the dashboard writes admin-gated nodes, and LOCAL e2e does not exercise rules).

**Slice 3 — Room engine.**
28 guards but the highest coupling: stage rendering, decisions, scoring and the
branched engine interlock, and `applySectionContent()` / `refreshActiveSlotState()`
sit on the hot path between them. Do this last, and only if slices 1–2 have not
already bought enough headroom. **Note the admin/room entanglement:** the admin
"Open room" control enters the room engine, so slice 3 must not assume slice 2
made the room unreachable.

Stop after any slice that gets the budget where it needs to be. There is no
prize for moving all three.

## 7. Non-negotiables for every slice

- **Shell version + `LOCALE_VERSION`.** A new or changed lazy chunk REQUIRES the
  shell bump (`sw.js`, `script-loader.js`, `index.html ?v=`, all three in
  lockstep). The vendoring spec only checks the three markers AGREE, so a PR
  that edits a lazy chunk without bumping passes CI and ships undeployable
  (clients keep the cached old chunk).
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
