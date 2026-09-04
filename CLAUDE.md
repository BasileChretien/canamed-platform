# cnm-pp — CaNaMED PBL platform

Franco-Japanese medical-education roleplay/PBL platform (Université de Caen
Normandie × Nagoya University). Static SPA (HTML/CSS/vanilla JS) on Firebase
Hosting + Realtime Database + anonymous Auth + App Check (reCAPTCHA v3).

## Commands
- `npm run test` — unit tests (`node --test tests/*.test.js`).
- `npm run emulator` — Firebase RTDB+Auth emulator (needs Java on PATH).
- `npm run sim:emulator` — headless cross-tab persona sim against the emulator
  (`scripts/sim/sim-with-emulator.js`). If 9000/9099 are already taken it now
  **exits during preflight** naming the listener, rather than starting against
  a stale emulator; `npm run emulator:ports` names the squatter and `npm run
  emulator:free` clears it. Should a run start and then fall back to LocalDB,
  the report says so — it states the backend it ACTUALLY got instead of
  claiming LOCAL unconditionally (`scripts/sim/report-mode.js`).
- `npm run test:e2e:rules` — the emulator-backed Playwright rules suite. Goes
  through `scripts/ops/run-rules-e2e.js`, which preflights the ports and sweeps
  any emulator `emulators:exec` failed to reap. Together with `sim:emulator`
  these are the two ways `database.rules.json` is actually exercised; the LOCAL
  Playwright suite never touches it.
- `npx playwright test` — E2E suite (`tests-e2e/`), runs in LOCAL mode
  (hermetic, no real Firebase). Projects: chromium/firefox/webkit + perf +
  a11y + mobile-iphone/ipad/android.
  - Pass an explicit `PORT=` (e.g. `PORT=8771`): the default 8765 is
    AnkiConnect's port on this machine, and `reuseExistingServer` then latches
    onto Anki so every test fails on the splash.
  - **The three WebKit-family projects — `webkit`, `mobile-iphone`,
    `mobile-ipad` — hang at `--workers=2`. Run each with `--workers=1`.**
    (Corrected 2026-08-05: the earlier advice to single out only iPad was
    insufficient; all three hang.)

## Layout
- Platform: `docs/Third_session/PBL_platform/` (`index.html`, `script.js`,
  `style.css`, `case-content.js`, `glossary.js`, `i18n.js`, `tour.js`,
  `database.rules.json`, `firebase.json`).
- Tests: `tests/` (unit), `tests-e2e/` (Playwright).

## Standing instructions
- **Per-device tests for every UI change.** When touching the platform UI,
  add Playwright coverage for mobile-iphone, mobile-ipad, mobile-android, and
  desktop viewports. (Established 2026-05-18.)
- **In the emulator e2e suite, a second PAGE is not a second USER.** (Established
  2026-08-05, after `rules-smoke.spec.js`'s create→join→advance test was written
  off as flake three times by two sessions — including on unmodified `main`.)
  `context.newPage()` shares storage with the first page, so a "participant" tab
  reuses the facilitator's persisted **anonymous session** *and* its
  `localStorage`. That single artefact produced two unrelated-looking
  intermittent failures:
  **(a)** the participant carried the CREATOR's uid, so the admin-only
  `rooms/$roomId/stage` was writable from participant code — a vestigial
  `refStage.set(0)` in `startRoom()` (legal before Phase 4a / PR #223 made the
  node admin-only, never removed after) then RACED the facilitator's Advance and
  rolled the room back a stage. Tell-tale end state: `stageAt` and the `stage`
  event both record `from:0 → to:1` while `stage` itself sits at **0**, with no
  writer left to correct it. Measured margin between the two writes: **180 ms**.
  **(b)** the lobby's `canamed_name` prefill restored the FACILITATOR's name over
  the student's *after* the test typed it, so the join never reached `#waiting`.
  Use `browser.newContext()` for any second participant — the FINDING-01 test
  already did, deliberately — and **assert the two uids differ**, or the test
  quietly covers half of what it claims.
  Fixed: the participant no longer writes `stage` at all (guard:
  `tests/room-stage-single-writer.test.js`, which pins the single-writer
  invariant in the client *and* the rules).
- **Assert the DB value, then the DOM — never the DOM alone** in the emulator
  suite. `dbReadAsOwner()` (`tests-e2e/emulator/fixtures.js`) reads a node with
  the emulator's owner bypass, so a failure distinguishes "the write was
  rejected" from "it landed and was overwritten" from "it arrived and never
  rendered". All three used to surface as the same `expected Stage 2, got
  "Stage 1 of 3"`, which is precisely why the bug above read as flake. The
  bypass is for OBSERVATION only — the writes under test still go through the
  real rules; never settle an allow/deny verdict with it.
- **A conditional around an assertion is a green test that tests nothing.** The
  same test guarded its only advance assertion with `if (await adv().count())`,
  so a run where the dashboard had not yet rendered its room rows passed without
  exercising the advance at all.
- E2E runs in LOCAL mode, so it does **not** exercise the Firebase rules. The
  emulator-backed sim is the real validation for `database.rules.json`
  changes — run it locally before merging rules changes.
- **Re-verify a PR before repeating any "it's green" claim.** (Established
  2026-07-30, after a near-miss.) A PR's contents DRIFT: keep committing to its
  branch and the status you checked an hour ago describes a different
  changeset. Before recommending a merge — or repeating an earlier readiness
  claim — re-run `gh pr view <n> --json commits,statusCheckRollup,mergeStateStatus`
  and read the commit LIST, not just the checks. What happened: #263 was
  reported green and "ready to merge" while it was only the JSON-removal work;
  five cutover commits were then pushed to the same branch, and acting on the
  stale claim would have shipped a knowingly-broken branched path. The fix was
  to split the finished commits onto a fresh branch off `main` (#264) and
  retitle the original **WIP — DO NOT MERGE**. Same discipline as the
  STATUS-CLAIM RULE below, applied to PRs instead of docs.
- **A failed `gh pr merge` is NOT evidence the merge failed.** (Established
  2026-08-06 on #292.) This repo is worked through several worktrees, and `main`
  is usually checked out in one of them. `gh pr merge` merges on GitHub FIRST,
  then tries to update the local checkout — and that second half dies with
  `fatal: 'main' is already used by worktree at C:/R_git/canamed-platform-<x>`.
  The command exits non-zero having already merged. Two consequences:
  1. **Never retry on the error text.** Check the actual state first —
     `gh pr view <n> --json state,mergeCommit,mergedAt`. Retrying blind is how a
     merged PR gets re-merged or a fresh branch gets cut from a stale base.
  2. **`--delete-branch` silently does not run**, because it is part of the same
     local half. Delete it yourself: `git push origin --delete <branch>`, and
     confirm with `git ls-remote --heads origin <branch>` (empty = gone).
- **After ANY rebase, re-read the shell version against `origin/main` — not in
  place.** (Established 2026-08-06 on #292; the mechanism was already known, this
  is the second sighting.) Bump to vN, rebase onto a `main` that also bumped to
  vN, and git resolves your identical hunk as already-upstream and DROPS it. The
  markers still all read vN and `shell-csp-vendoring.spec.js` still passes —
  it only checks the three agree — so you are left with a modified `script.js`
  and NO version increment. That is undeployable-but-green: returning browsers
  keep serving the cached vN bundle, without the change. An EMPTY diff below,
  after a rebase that touched shell files, means your bump was absorbed —
  re-bump to vN+1. Then verify what actually SHIPPED against the live site, not
  the deploy's exit code (`grep SHELL_VERSION` alone only prints whatever is
  live; assert the value you expect, or it will "pass" on the stale one):

  ```bash
  git fetch origin
  P=docs/Third_session/PBL_platform
  git diff --stat origin/main...HEAD -- $P/sw.js $P/script-loader.js $P/index.html
  expected=v141   # the version THIS change ships
  curl --fail --silent --show-error https://canamed-69785.web.app/sw.js \
    | grep -F "canamed-shell-$expected"
  ```

  The paths are NOT at the repo root — everything served lives under
  `docs/Third_session/PBL_platform/`. A root-relative pathspec silently matches
  nothing, and an empty diff is exactly this check's failure signal, so getting
  it wrong reports the bug on every run.
  **Now partly GUARDED (2026-08-07):** `tests/shell-version-bump.test.js` (unit
  suite) diffs the branch against its merge base with `origin/main` and FAILS if
  any file the cache-version machinery addresses changed while `SHELL_VERSION`
  did not — the absorbed-bump state above is exactly that state. It derives the
  watched set from the enforcing sources (sw.js `SHELL_ASSETS`, every
  `v("…")` / `loadScript("/…")` in script-loader.js, every `?v=` in index.html,
  reader-dict.js's dictionaries) rather than a hand-copied list, and puts
  `LOCALE_VERSION` × `locales/*.js` under the same contract. It SKIPS when there
  is no merge base, so it is a backstop, not a replacement for the manual check
  above — and `.github/workflows/test.yml` must keep `fetch-depth: 0` or it
  skips in CI silently (a companion test asserts exactly that).
  It watches DELETIONS too — the watched set is the UNION of the derivation
  at the merge base and at HEAD, because deleting an asset also removes it
  from the manifest, and a working-tree-only derivation then cannot see it.
  And the version must move **FORWARD**, not merely differ: sw.js's
  `activate` drops every cache whose name `!== SHELL_VERSION`, so a
  re-install is triggered by the name CHANGING — a client that never saw
  v143 sees no change at all across v142 → v143 → v142 and keeps serving its
  stale v142 cache forever. Never reuse a number; a revert bumps FORWARD,
  carrying the reverted content.
- **Deleting a long-lived UI control is an AUDIT, not a deletion.** (Established
  2026-07-30, removing the create form's Scenario select.) Such a control
  accumulates side effects nobody has catalogued, so the question is not "what
  does it do" but "what STOPS happening when it is gone". That one select was
  also setting `body`/`stage` `data-format`, triggering the lazy `branched.css`
  load, standing in for the `format`/`finalStep`/`documents` that
  `applySectionContent()` never published, hosting the moderation **Report**
  button (a safety feature — PRs #227/#228), and supplying a DEFAULT selection:
  it was never empty, so merely requiring a pick broke 24 e2e specs. Each
  surfaced as a separate failing assertion AFTER removal; none was findable by
  reading the call sites. Before deleting one, grep for its id across `*.js`,
  `*.html`, `tour.js` anchors and every spec; the globals it assigns; and any
  feature whose UI hangs off its value. Expect the test suite, not the code, to
  find the remainder.

## Operational reminders — ACTION REQUIRED (cannot be done in code)

### ⛔ THE PROJECT IS BACK ON THE SPARK (FREE) PLAN — billing closed 2026-08-27

**Read this before trusting ANY status below that involves Cloud Functions or
Cloud Storage.** The Blaze trial ended and was deliberately not renewed (user
decision, 2026-08-31: "I did not want to pay anything"). The billing account
for `canamed-69785` is in state `closed`. Everything that needs billing is
therefore not merely broken but **unfixable in code**:

| surface | state |
| --- | --- |
| `hfPatient` (Module A LLM patient) | **DOWN.** 500 from the Google front end, no application logs at all — the container is never started. Last invocation logged 2026-08-27T00:16:12Z. |
| `sendQueuedMail` | same class — a v2 function on Cloud Run. Facilitator mail cannot send. |
| `backup-sessions` → ~~GCS~~ **Scaleway** | ✅ **LIVE AGAIN since 2026-09-01** — destination moved to Scaleway Object Storage (`fr-par`), schedule re-enabled, first archive verified. It was disabled 2026-08-27 → 09-01 after `ApiError: The billing account for the owning project is disabled in state closed`. |
| `pseudonymise-export` → ~~GCS~~ **Scaleway** | ✅ **LIVE AGAIN since 2026-09-01**, same migration, same commit (#363). |
| Hosting, RTDB, Auth, App Check | **unaffected** — all free tier. The site serves normally, which is exactly why this went unnoticed. |

How it surfaced: five identical *Synthetic uptime probe* failure emails. The
probe reported `hfPatient status=503`, which is true and almost useless — the
cause was written verbatim in the logs of two OTHER failing jobs. Diagnosing a
red probe means reading every failing workflow, not just the one that mailed.

**What changed in the repo (2026-08-31):**
- The probe's `hfPatient` check is **gated off** (`PROBE_EXPECT_FUNCTIONS`,
  default off) and prints an explicit `[SKIP]` line. It is not deleted —
  `buildChecks()` still returns it, so its shape stays under test.
- `backup-sessions.yml` + `pseudonymise-export.yml` schedules are commented
  out; `workflow_dispatch` kept. This stops ~4 failure emails a day about a
  condition no code change can fix — the alert-fatigue state item 3 below
  already warns about.
  ⚠️ **SUPERSEDED 2026-09-01 — both schedules are LIVE again**, writing to
  Scaleway instead of GCS (#363). The bullet is kept because the *reasoning*
  still applies to any job that cannot pass; it is no longer a description of
  these two. **`pseudonymise-export.yml`'s own header went stale in exactly
  this way** — #363 uncommented the `schedule:` and left a
  "disabled" paragraph above it, so the file asserted its own inverse for a
  day and a DPA clause was drafted from the comment rather than the YAML.
  Fixed 2026-09-02 with a machine-readable `# SCHEDULE-STATE:` marker and
  `tests/dpa-export-lockstep.test.js`, which fails if the marker, the
  schedule and DPA clause 2.6 disagree.
- A **backup↔purge interlock** was added (`scripts/lib/backup-marker.js`),
  because `cleanup-stale-sessions` runs on RTDB and kept succeeding — and
  deleting — while backups failed. It is **disarmed** today on purpose: with no
  GCS, arming it would block deletion forever and turn a missing-archive
  problem into a standing retention breach. Deletion is the legal duty; the
  backup is disaster recovery.

### ✅ THE LLM PATIENT IS LIVE AGAIN (2026-09-01) — Scaleway fr-par + Llama-3.3-70B

Verified end to end from a REAL room on the live site: coherent in-character
replies in ~8 s (EN) and ~6 s (JA), `provider: "ovhcloud"` echoed back, and a
novel unscripted question answered — which no canned stub could do.

⚠️ **THE MODEL CHANGED: `Qwen/Qwen3.5-9B` → `meta-llama/Llama-3.3-70B-Instruct`.**
Qwen3.5-9B is a HYBRID-REASONING model and OVHcloud — the EEA-pinned provider —
**rejects `chat_template_kwargs` (HTTP 400)**, the only field that switches
reasoning off. Qwen's in-prompt `/no_think` did not suppress it either. Left
reasoning, it spent its entire token budget thinking and returned an empty
reply: ~28 s per turn, and every room saw the stub patient. Llama-3.3-70B is
the only NON-reasoning instruct model OVHcloud serves, so it is the single
choice satisfying both "no reasoning" and EEA residency.
⚠️ **The model is NAMED in the DPA (Annex III) and the privacy-notice draft** —
those still say Qwen3.5-9B and must be corrected before either is published.
Its Japanese is unofficial (Meta lists 8 languages, not JA) but tested natural.

⚠️ **TWO TRAPS THAT COST HOURS, both worth knowing before touching this again:**
1. **Scaleway's Settings save has a SECOND confirmation dialog.** Clicking
   "Save function settings" opens a "Save settings" modal that must ALSO be
   confirmed. Until that is clicked NOTHING is applied — the form keeps
   showing your edits, so it looks saved. Several "changed the model, still
   broken" conclusions were drawn from runs that had silently re-tested the
   ORIGINAL model. Verify a settings change by RELOADING the page, or by an
   observable behaviour change, never by the form's own contents.
2. **A plausible in-character reply is NOT proof the model answered.** The stub
   is scenario-aware, so it sounds like the patient too. Ask something
   unscripted ("if your pain were a colour…") or read the `provider` field.

`Verify:` a call now returns `upstreamStatus` on HF failure — the field that
made this diagnosable at all, since Scaleway's log tab needs Cockpit
provisioned and the handler deliberately never forwards the provider body.

### The LLM patient runs on a SELF-HOSTED PROXY now (2026-08-31)

Rather than restore billing, Module A's chat was moved off Cloud Functions.
`proxy/` is the same handler on Web-standard APIs (fetch + WebCrypto), so it
runs on Cloudflare Workers, Scaleway Functions, Deno Deploy or Vercel.

- **It is a PORT, not a rewrite.** The pure logic is IMPORTED from
  `functions/lib/hf-helpers.js`, never copied, so the server-authoritative
  prompt guard, the HF_URL allowlist and the `roomOf` comparison cannot drift
  between the two deployments. `tests/llm-proxy.test.js` fails if the proxy
  re-declares any of them.
- **What is NOT preserved: App Check.** A raw fetch cannot mint the token and a
  non-Google host cannot verify one, so the client requires an explicit
  `acknowledgeUnsafe: true`. It costs nothing today (App Check is in Monitor
  and reCAPTCHA is consent-gated off since v148, so no client mints a token at
  all), but it must stay a conscious choice.
- **No service-account key is used, deliberately.** The membership check reads
  `roomOf/<uid>` over RTDB REST with the CALLER'S OWN token. Putting a Google
  service-account key on a third-party host would be a full-database
  credential — far more dangerous than the HF token it protects. The value
  still comes from the DATABASE, so a client cannot assert its way into
  another room.
- **The rate-limit store is RTDB, and REQUIRED.** Scaleway's free tier has no
  KV and its Serverless SQL Database has no free tier at all (~€0.10/month even
  when idle), so the counters live in RTDB — already EEA, already in the DPA,
  free. With no store bound the proxy refuses to serve rather than run
  unmetered.
  **The counters are written with the CALLER'S OWN token, so the RULES are the
  security**: `rateLimits` is INCREMENT-ONLY (a write must be exactly
  `data + 1`). A participant can inflate their own counter — self-harm — but
  cannot reset it. That predicate also makes the increment ATOMIC: a concurrent
  writer's stale `N+1` is rejected and retried, where an eventually-consistent
  KV would silently lose it. Covered structurally
  (`tests/rules.test.js`) and functionally against the real emulator
  (`tests-e2e/emulator/rules-smoke.spec.js`, three cases, each with an ALLOW
  leg).
- ⚠️ **THE GLOBAL DAILY CAP IS NOT ENFORCED IN CODE ANY MORE — it moved to the
  Hugging Face account's SPEND LIMIT.** Not an omission: a cross-user counter
  written with the caller's own token is forgeable UPWARD by any participant,
  who could push it past the cap and disable the chat platform-wide for the
  rest of the day — a cost control turned into a one-caller denial of service.
  A counter only the proxy could write would need a Google service-account key
  on a third-party host, which the design refuses. **Setting the HF spend limit
  is therefore a REQUIRED deploy step**, not optional hardening; the per-uid
  limits bound one participant to 200 turns/day and nothing else bounds the
  rest. `Verify:` `grep -n "GLOBAL_DAILY_CAP" proxy/src/handler.js` returns
  only the comment explaining the move.
- ⚠️ **ENABLING IT IS TWO EDITS.** `CANAMED_LLM_PROXY` in firebase-config.js
  AND the origin in index.html's CSP `connect-src`. Miss the second and the
  browser blocks every request while the room silently gets the stub patient.
  `tests/llm-proxy-config.test.js` fails the build when they disagree.
- ✅ **DATA RESIDENCY — SETTLED: the host is Scaleway `fr-par` (Paris).**
  `proxy/scaleway/` is the deploy target; `proxy/cloudflare/` is kept for
  local development and ships DISABLED. A free Cloudflare Worker cannot be
  pinned to the EU (Regional Services / the Data Localization Suite is an
  Enterprise add-on), which would have broken the EEA commitment recorded in
  `functions/index.js` and `modA-llm-init.js` and assumed by the CER dossier.
  Scaleway is French, `fr-par` is Paris, and the free tier is 1M requests +
  400k GB-s/month. It puts the relay in the same country as the pinned
  inference provider (OVHcloud, Gravelines).
  ⚠️ Scaleway still requires a card + identity verification to open an account,
  even for free-tier use.
- ⚠️ **SCALEWAY IS A NEW SUB-PROCESSOR and the paperwork is NOT done.** Drafted
  but unsigned/unpublished: `legal/dpa-draft.md` Annex III row #7 and the
  data-flow step in `legal/facilitator-privacy-notice-template.md`. The
  PUBLISHED notice (12 surfaces, 8 languages) still names Firebase + Hugging
  Face only, and must not be shipped naming Scaleway until the DPA exists.
  The same pass corrected a now-stale claim in the DPA: Annex III row #1 said
  the language-model proxy runs in Google `europe-west1`, which stopped being
  true on 2026-08-27.
  `Verify:` `proxy/README.md` carries the deploy steps and the three
  post-deploy checks; the recorded `provider` field on a live reply is the
  only end-to-end proof the EU inference pin took effect.

⚠️ **RESTORING BLAZE IS A THREE-PART CHANGE, all in one commit** — miss one and
you get a silently half-restored system:
1. re-attach billing, then `firebase deploy --only functions` (read the
   git-ignored `functions/.env` trap under the scenario-characters section
   FIRST — a stale `.env` 404s every chat call and degrades to the stub);
2. set `PROBE_EXPECT_FUNCTIONS=1` in `synthetic-uptime.yml`;
3. uncomment both GCS schedules **and** flip `CLEANUP_REQUIRE_BACKUP` to `"1"`.

`Verify:` `node scripts/synthetic-uptime-check.js` prints `[SKIP] hfPatient`
while on Spark; `PROBE_EXPECT_FUNCTIONS=1 node scripts/synthetic-uptime-check.js`
must then FAIL on `hfPatient` (positive control — confirmed both directions
2026-08-31). A tokenless POST to the callable returning Google's HTML *500
Server Error* page — rather than the handler's own `auth required` — is the
signal that functions are unprovisioned.

⚠️ **This also removes the App Check enforcement signal for `hfPatient`.** Items
1 and 4 below both lean on that tokenless POST as the ONLY CLI-verifiable check
(`functions/.env` is git-ignored). It costs nothing while the function cannot
start — an undeployable function enforces nothing — but it is uncheckable
again until Blaze returns. The **RTDB** canary in item 1 is unaffected and
still runs every tick.

### Round-3 security follow-ups

These are the Round-3 security follow-ups that require the Firebase / GCP
Console (a human with project access), surfaced 2026-05-20. Items 2, 3, 4, 5
are complete (see each). **✅ NO ACTION OUTSTANDING — verified in the Console
2026-07-31.** This banner previously said item 1 (switch RTDB App Check from
*Enforce* back to *Monitor*) was still owed, which contradicted item 1's own
body saying it was reverted on 2026-05-30. The contradiction is resolved:
Firebase Console → App Check → APIs shows **Realtime Database: Monitoring**, so
the revert was performed and this banner was the stale half. Also observed on
that page, and worth keeping: RTDB is running at **~5% verified / 95% unverified
requests**, so re-enabling *Enforce* today would reject the great majority of
traffic — independent evidence for staying on Monitor, on top of the
reCAPTCHA-hang reasoning in item 1.

**Re-confirmed 2026-08-12 without Console access**, using the checks each item
now carries: the RTDB canary returned `null http=200` with the paired root read
still `401 Permission denied`, and a tokenless POST to `hfPatient` returned the
handler's own `auth required`. Both surfaces are therefore still non-enforcing.
A live end-to-end run the same day passed while App Check was 403-ing and
self-throttled, so no token minted at all. Scope that honestly: it shows the
flows it exercised — anonymous sign-in, `sessionStatus()`, session create/start,
room writes, the Module A chat, session close — do not currently depend on
attestation. It is evidence about those flows, not a proof that no operation
anywhere does, and it does not by itself predict what fraction of clients
*Enforce* would break. The ~5% verified figure above is the basis for that
estimate; the two together are why Monitor stays.

> ⚠️ **STATUS-CLAIM RULE — read before reporting any item here as done /
> outstanding / dormant.** These hand-maintained labels CAN go stale: an
> operator may finish a Console/deploy step without updating this file (that
> is exactly what happened with items 4 & 5, caught 2026-05-30 only because
> the user contradicted the doc). So:
> 1. **Verify before you relay.** Never report an item's status from this file
>    alone. Confirm the real state from the code or live system first — each
>    item below carries a `Verify:` hint for this. If a label contradicts
>    reality, trust reality and fix the label in the same turn.
> 2. **Sync on completion.** Whenever you do (or learn of) work that resolves
>    an item, flip its status here in the **same commit**. A stale "ACTION
>    REQUIRED" on already-done work is itself a defect to fix.
> 3. This applies to **every** status assertion in this file (operational
>    reminders, "Known security follow-ups", inline ✅/DONE notes), not just
>    this section.

0. **⚠️ reCAPTCHA IS NOW CONSENT-GATED CLIENT-SIDE (2026-08-21, shell v148) —
   read this BEFORE touching App Check enforcement.** `initAppCheck()` returns
   unless an affirmative opt-in is recorded, and **no UI records one**, so
   reCAPTCHA is not loaded at all. That is the intended state: reCAPTCHA v3
   profiles every visitor (IP, mouse movement, keystroke timing, device signals,
   persistent cookies) and ePrivacy Art. 5(3) needs PRIOR consent for it —
   legitimate interest does not substitute, and CNIL has fined on exactly this
   (Cityscoot €125k, NS Cards France €105k). It used to run at Firebase init, on
   page load, for every visitor; the platform’s only consent block is in the
   LOBBY, reached later and only by people who join a session, and the privacy
   notice never mentioned reCAPTCHA at all.
   Gating cost nothing because App Check is in *Monitor* (canary re-verified the
   same day), so the token bought no access control. The one loss is App Check’s
   verified/unverified metrics.
   **⚠️ CONSEQUENCE FOR ITEM 1 BELOW:** with no client activation, NO client
   mints a token, so switching RTDB to *Enforce* would now reject **100%** of
   traffic rather than ~95%. Order of operations: build a consent affordance
   (call `grantAppCheckConsent()`) → confirm tokens mint → only then enforce.
   The synthetic uptime probe still runs the canary every tick, so enabling
   Enforce turns a scheduled run red.
   `Verify:` `node --test tests/appcheck-consent-gate.test.js` (7 tests,
   mutation-verified) and `grep -n "appCheckConsentGranted"
   docs/Third_session/PBL_platform/script.js`.

1. **Firebase App Check → Monitor (NOT Enforce) for RTDB — REVERTED
   2026-05-30 after an availability incident (HIGH).** App Check (reCAPTCHA
   v3) is wired client-side; enforcement is a Console setting.
   - ✅ Done 2026-05-23 — RTDB switched *Monitor* → *Enforce* (unattested
     tokens rejected at the DB).
   - ⚠️ **Reverted to *Monitor* 2026-05-30.** Enforce mode made reCAPTCHA a
     single point of failure for the *entire* database: when
     `grecaptcha.execute()` intermittently **hangs** (diagnosed live
     2026-05-30 — network to Google was fine; reCAPTCHA-internal hang), App
     Check can't mint a token, and under Enforce the RTDB rejects **all**
     access (realtime *and* REST), so every client hangs on "Checking…" then
     "Couldn't reach the session server". Symptom chain:
     `grecaptcha.execute()` hang → no App Check token → Enforce blocks DB →
     `sessionStatus()` read never resolves. For a **supervised classroom**
     (facilitator present; threat model = free-tier quota abuse via stolen
     anon tokens), availability outweighs that marginal protection, and the
     DB **rules** (auth!=null, ownership guards, unreadable `adminSecrets/`)
     remain the real security boundary — so RTDB was switched back to
     *Monitor* (SDK still sends tokens; DB observes, does not reject). The
     client-side timeout/retry fix (script.js `_clearStickyLongPollFlag` +
     `SESSION_STATUS_TIMEOUT_MS`, shipped 2026-05-30) makes the failure
     *graceful* but cannot create access while a mandatory token can't mint —
     hence the Console revert.
   - **Re-enable Enforce only after** reCAPTCHA reliability is understood
     (check reCAPTCHA admin console error rate/volume for the site key +
     Firebase App Check metrics); consider reCAPTCHA Enterprise or a longer
     App-Check token TTL / proactive refresh before re-enforcing.
   - `Verify:` **there IS a CLI signal — this is no longer Console-only
     (2026-08-07).** `credentials/$certId` is public-read by design, so an
     unauthenticated, App-Check-**tokenless** read of a non-existent id must
     return exactly `200 null`. ENFORCED rejects unattested requests at the API
     layer BEFORE rules run, so a 200 proves App Check is **NOT ENFORCING**:

     ```bash
     curl -s -w ' http=%{http_code}\n' 'https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app/credentials/appcheck-canary-not-a-real-cert-id.json'
     # null http=200        <- not enforcing (expected)
     ```

     ✅ **Re-verified 2026-08-12.** Canary `null http=200`; paired root read
     `{"error":"Permission denied"} http=401`. Both as specified, so RTDB is
     still not enforcing and the rules still deny what they should.
     Independently, the whole live test that day ran with App Check **failing**:
     the SDK logged a 403 and self-throttled for 24 h, so no token could mint —
     yet anonymous sign-in, `sessionStatus()`, session creation, room writes and
     the chat all worked. That exercises the **authenticated realtime SDK** path
     (reads *and* writes), which the public-REST canary does not touch and which
     is what actually broke in the 2026-05-30 incident.

     ⚠️ It proves exactly that and **no more**. App Check has three states —
     OFF, UNENFORCED (the Console labels it *Monitor*) and ENFORCED — and a
     tokenless read succeeds under **both** OFF and UNENFORCED, so this cannot
     tell those two apart. The Firebase Console (App Check → APIs → Realtime
     Database → *Monitored*) remains the authority on **which** non-enforcing
     state is live; the CLI check covers the transition that has actually hurt.

     Pair it with a root read, which the rules must still deny
     (`{"error":"Permission denied"} http=401`): together they show unattested
     access *reaches* the rules AND the rules then deny what they should. The
     synthetic uptime probe runs both every tick, so enabling enforcement turns
     a scheduled run red instead of silently changing a setting nobody can see
     — though an App Check enforcement change can take **up to ~15 minutes to
     propagate**, so the red run appears on the first tick after Firebase
     applies it, not the moment the Console is clicked. **This banner went
     stale for two months precisely because "Console-only" made it uncheckable
     by anyone without Console access** — the failure the STATUS-CLAIM RULE
     above exists to prevent. The `hfPatient` function's
     App Check was **also reverted to Monitor (`APP_CHECK_ENFORCE=false`)
     2026-06-03** (see item 4) — after the chat fell back to the stub on every
     message because Enforce rejected every call when no reCAPTCHA token minted.

2. **Restrict the API key (HIGH).** The Firebase web API key is necessarily
   public in the served HTML, but it should be locked down:
   - GCP Console → Credentials → the browser key → Application restrictions =
     HTTP referrers (`canamed-69785.web.app`, `*.firebaseapp.com`); API
     restrictions = only the Firebase services actually used.
   - ✅ **Done 2026-05-23** — browser key locked to HTTP referrers and scoped
     to only the Firebase services in use.
   - NB (corrected 2026-06-02): the **live platform URL is
     `https://canamed-69785.web.app`** (the project's default Hosting site) —
     NOT `canamed.web.app`, which 404s. The referrer allowlist must therefore
     include `canamed-69785.web.app` (the site works, so the real Console
     allowlist already does; this doc previously read `canamed.web.app`).
   - `Verify:` GCP Console → APIs & Services → Credentials → browser key shows
     HTTP-referrer + API restrictions (Console-only — no code signal).

3. **PII retention workflows — partly restored in this repo, two still
   blocked.** The 4 PII workflows originally lived on the private
   `BasileChretien/CANAMED` repo. **Correction (2026-05-29):** that repo's
   GitHub Actions are not merely at a free-tier minute cap — they are blocked
   by an **account billing-payment failure** ("the job was not started because
   recent account payments have failed or your spending limit needs to be
   increased"). This blocks **scheduled *and* `workflow_dispatch`** runs, so
   the earlier assumption that retention was "being honoured manually" was
   **false** — backup/cleanup/pseudonymise/cost-monitor had not run since
   ~2026-05-18 (≈11-day GDPR/APPI storage-limitation gap + no fresh backups).
   - ✅ **Durable fix (2026-05-29):** the two **no-artifact** jobs were ported
     to this public repo, whose Actions are healthy, off the broken-billing
     dependency — `.github/workflows/cleanup-stale-sessions.yml` (daily 03:17
     UTC, `CLEANUP_QUIET=1` so world-readable logs never print session codes)
     and `.github/workflows/cost-monitor.yml` (daily 02:13 UTC). The PII
     scripts and the `FIREBASE_SERVICE_ACCOUNT_CANAMED_69785` secret were
     already present here. **Leave the private repo's copies disabled** — do
     not re-enable them and double-run.
   - ⚠️ **That "disabled" was WRONG until 2026-08-17 — they were never disabled,
     and had been failing daily ever since.** Caught only because the operator
     asked about a CI failure email that turned out not to be this repo at all.
     In `BasileChretien/CANAMED` all four (`Backup sessions`, `Cleanup stale
     sessions`, `Cost monitor`, `Pseudonymised export`) were still `active` with
     live `schedule:` blocks, firing every day and failing in ~2 s with zero
     steps run: *"The job was not started because recent account payments have
     failed or your spending limit needs to be increased."* (That repo's `Unit
     tests` and `E2E tests` HAD been disabled, which is probably why the whole
     set was assumed to be.) **Now actually disabled** — all four set to
     `disabled_manually` via `gh workflow disable "<name>" --repo
     BasileChretien/CANAMED` on 2026-08-17.
     - No data was ever at risk: the public repo's copies are the live ones and
       are green. The cost was **four failure emails a day from jobs believed
       retired** — pure alert fatigue, which is exactly the condition under
       which a real failure gets ignored.
     - The private repo's `firebase-deploy.yml` is *named* "(DISABLED — see
       public repo)" while its workflow state is still `active` — that one is
       genuinely harmless: its `push:` trigger is commented out, leaving only
       `workflow_dispatch:`, so it cannot fire on its own. Left as-is.
     - `Verify:` `gh workflow list --repo BasileChretien/CANAMED --all` shows
       those four as `disabled_manually`. This is a CROSS-REPO claim — it cannot
       be checked from this repo's files, so re-verify it rather than trusting
       this line (that is what went stale last time).
   - ✅ **`backup-sessions` + `pseudonymise-export` — LIVE via private GCS
     (2026-05-30).** These produce artefacts containing identified PII (full
     `/sessions` dump; a pseudonym→name linkage table), so they must **not**
     upload GitHub artifacts on a public repo (world-downloadable). Instead
     the scripts gained a GCS-upload path (`scripts/lib/gcs-archive.js`,
     gated by `BACKUP_GCS_BUCKET` / `EXPORT_GCS_BUCKET` + a `*_REQUIRE_GCS`
     fail-loud flag), and `.github/workflows/backup-sessions.yml` +
     `pseudonymise-export.yml` run them here writing to a **private** bucket
     (job logs carry no PII). Setup completed 2026-05-30: private bucket
     `gs://canamed-pii-archive` (`europe-west1`, uniform access +
     public-access-prevention); SA
     `firebase-adminsdk-fbsvc@canamed-69785.iam.gserviceaccount.com` granted
     `roles/storage.objectAdmin` on it; lifecycle rules `backups/` +
     `pseudonymised/` = 90 d, `linkage/` = 14 d; `PII_ARCHIVE_BUCKET` repo
     variable set; both workflows dispatched green (objects verified in the
     bucket) and their daily `schedule:` blocks enabled (02:47 / 03:47 UTC).
     Re-provisioning steps live in the `backup-sessions.yml` header and
     `scripts/ops/setup-pii-bucket.sh`.
   - ⚠️ **SECOND retention gap: 2026-07-31 → 2026-08-04 (5 days) — cause
     removed 2026-08-17.** All four workflows failed on all five of those
     days, so there was no `/sessions` backup, no stale-session purge and no
     pseudonymised export in that window (a GDPR/APPI storage-limitation gap,
     the second after the ≈11-day billing-blocked one above). **Nothing in
     this repo changed** — verified by diffing the last-passing against the
     first-failing commit. All four installed with
     `npm i --no-save --no-audit --no-fund firebase-admin@13`, a *floating*
     install that pinned nothing and re-resolved the whole transitive tree on
     every run. `@firebase/database-compat` 2.1.5 (published 2026-07-30 18:29
     UTC, hours before the first failure) shipped a
     `dist/index.standalone.js` — the bundle firebase-admin loads — that
     `require()`s `@firebase/app`, which 2.1.5 declares only as a **peer**
     dependency, so npm never installed it: every run died on
     `Cannot find module '@firebase/app'`. The jobs self-healed on 2026-08-05
     purely because upstream reverted the bundle in 2.1.6 (published
     2026-08-04 22:43 UTC) — we had no control over the recovery.
     **Fix:** `firebase-admin` is now a real `devDependency` and all four
     workflows install with `npm ci`, so the lockfile pins the whole tree by
     integrity hash and an upstream regression arrives as a Dependabot PR
     that CI can reject instead of as a silent nightly outage. NB the same
     lesson had already been applied to the *test* workflows in #286
     (2026-08-05, mid-incident) — it just never reached these four.
   - ⚠️ **"that CI can reject" was an OVERCLAIM when written; true only since
     2026-08-17.** Making the dependency visible to Dependabot worked, but
     **no CI job required firebase-admin** — these four scripts run solely on
     their nightly cron, so a breaking bump would go fully green on the PR and
     fail at 03:00. Dependabot proved it inside a day: **#320** (firebase-admin
     13.10.0 → **14.2.0**) removes the namespaced accessors — measured against
     14.2.0, `admin.database` and `admin.storage` are both `undefined`, and
     `admin.initializeApp` is the only survivor — so `const db =
     admin.database()` is a TypeError on the first line of real work in all
     four scripts (and in `functions/index.js`, 4 more call sites).
     Now genuinely covered by **`tests/firebase-admin-api-surface.test.js`**,
     which derives the firebase-admin entry points the scripts import and
     asserts the installed package exports them. A root-directory `ignore` for
     firebase-admin majors was added to `dependabot.yml` as well, but **the
     test is the safety net; the ignore is only convenience.**
   - ✅ **Modular-API migration DONE (2026-08-17).** `scripts/` (5 call sites)
     and `functions/index.js` (4) now import `getDatabase` / `getStorage` from
     `firebase-admin/database` / `firebase-admin/storage` instead of the
     namespaced `admin.database()` / `admin.storage()`.
     **The key finding that shaped it: v13.10.0 ALREADY exposes the modular
     API**, identically to v14 — so the migration needed no version bump and
     was fully verifiable on the version already in production. Proven by
     running the same migrated code against real installs of both (each
     returns a working `Database` / `Storage` handle) and by loading
     `functions/index.js` under each. That turns a risky big-bang into two
     small steps, and the code is now version-agnostic across the boundary.
     The guard test was rewritten to match (it tracked `admin.*` before) —
     note its anti-vacuity sentinel is hardcoded ON PURPOSE and does **not**
     follow the scripts automatically, contrary to what its first header
     claimed; update it in the same change that moves off these entry points.
   - ✅ **firebase-admin is ON v14.2.0 (2026-08-17)** — root and
     `functions/package.json`, both lockfiles, with both `dependabot.yml`
     ignores lifted in the same change. Verified rather than assumed: a clean
     `npm ci` in `functions/` resolves admin 14.2.0 alongside firebase-functions
     7.3.2 with **no ERESOLVE** (the old stated blocker), `index.js` loads on
     v14 via the same check Functions CI runs, and
     `tests/firebase-admin-api-surface.test.js` — which **failed** on v14
     before the migration, naming every call site — now **passes** on it. That
     inversion is the whole payoff of the modular migration.
   - ⚠️ **An `ignore:` is not a pause button — it CLOSES the open PR.** This
     file previously said "#320 is deliberately left OPEN as the marker for
     that bump". That was **false within hours of being written**: the root
     firebase-admin ignore added in #324 made Dependabot close #320 at
     2026-08-17 04:51 UTC — *"Looks like firebase-admin is no longer being
     updated by Dependabot, so this is no longer needed."* The bump was
     therefore done by hand rather than by merging #320. **If you want a
     tracking marker for a held dependency, use an issue, not the bot's PR**,
     and expect any `ignore:` you add to retire matching PRs immediately.
     - Related stale label fixed in the same pass: the functions-directory
       ignore said v14 "is NOT installable — npm ci fails ERESOLVE" because
       firebase-functions peered `^11 || ^12 || ^13`. firebase-functions is
       **7.3.2** now and peers `^11.10.0 || ^12.0.0 || ^13.0.0 || ^14.0.0`, so
       that precondition is **met** — the blocker moved from the peer range to
       the code.
   - ⚠️ **"all 4 active" stopped being true 2026-08-31 — and is TRUE AGAIN
     since 2026-09-01.** `backup-sessions` and `pseudonymise-export` wrote to
     GCS, which needs billing; the Blaze trial closed 2026-08-27 and both
     failed daily until their schedules were commented out. **#363 then moved
     both to Scaleway Object Storage (`fr-par`) and re-enabled both
     schedules**, so the expectation is once again **all 4 scheduled** — do
     not restore billing on the belief that two are waiting on it. (This
     paragraph read "2 scheduled / 2 dispatch-only" until 2026-09-02: a
     one-day-old status claim that was already false, which is why the rule
     above says verify before relaying.) The `npm ci` and lockfile halves of
     the check below are unaffected and still apply.
   - `Verify:` `gh workflow list` shows **all four** active;
     `.github/workflows/*.yml` have live
     (uncommented) `schedule:` blocks — and note the archive now lives on
     **Scaleway, not GCS**, so `gcloud storage ls gs://canamed-pii-archive/`
     no longer proves anything (it will fail on closed billing whatever the
     jobs did). Check the objects with an S3 client against
     `https://s3.fr-par.scw.cloud`, or read a run's log, which prints the
     destination URI it wrote;
     `grep -EL '^[[:space:]]*run:[[:space:]]*npm ci([[:space:]]|$)' .github/workflows/{backup-sessions,cleanup-stale-sessions,cost-monitor,pseudonymise-export}.yml`
     prints nothing (any file listed there has drifted back to a floating
     install) and `grep -c firebase-admin package-lock.json` > 0. The pattern
     must anchor to the executable `run:` line: a plain `grep -L "npm ci"`
     is satisfied by the *comments* in these files, which mention `npm ci`
     by name — so it stays silent even on a file whose install step has
     fully reverted (verified). Judge it by its OUTPUT, not its exit status;
     `grep -L` does not return a usable exit code here.

5. **Email/Password sign-in provider — DONE.** The splash account view offers
   Google **and** email/password sign-in (added 2026-05-29 as the foundation
   for facilitator-owned scenarios). Code wiring lives in
   [script.js](docs/Third_session/PBL_platform/script.js)
   (`createUserWithEmailAndPassword` / `signInWithEmailAndPassword`, with the
   anonymous-uid linking flow mirroring the Google path so participants who
   later create an account keep their `users/{uid}/history`).
   - ✅ **Done 2026-05-30** — the Firebase Console **Email/Password** provider
     is enabled (Authentication → Sign-in method); Google + email/password
     both work in production.
   - `Verify:` code wiring — `grep -c signInWithEmailAndPassword
     docs/Third_session/PBL_platform/script.js` > 0. Provider toggle is
     Console-only; functional check = create an account with email/password on
     the live splash and confirm no `auth/operation-not-allowed` error.

4. **Module A LLM-patient pilot (2026-05-28) — ⛔ DOWN SINCE 2026-08-27, and
   NOT fixable in code.**
   > **⛔ CURRENT STATE (2026-08-31): the billing account is closed, so
   > `hfPatient` cannot start at all** — a tokenless POST returns Google's
   > generic HTML *500 Server Error*, and there are NO application logs after
   > 2026-08-27T00:16:12Z. Everything below about deploys, App Check
   > enforcement and `.env` describes a function that currently does not run;
   > it becomes relevant again only once Blaze is restored. See the Spark-plan
   > banner at the top of this section.
   >
   > **The student-visible effect is the dangerous part.** The bridge treats
   > any failure as "backend unavailable" and falls back to the **stub
   > patient**, which answers a DIFFERENT question than the one asked — so it
   > reads as an incoherent patient, not as an outage. Module A's chat is the
   > DEFAULT history-taking interface for every session (`?llm=0` is the only
   > opt-out), so this affects every room. Same failure mode as the 9-day
   > `uidMembers` outage below; this time the cause is billing, not code.
   >
   > ⚠️ **The `MODA_LLM_ENABLED=false` panic button below CANNOT be used** — it
   > takes effect via `firebase deploy --only functions`, and deploying
   > functions itself requires billing. The only lever available on Spark is
   > client-side: `modALLMFlagOn()` in script-loader.js and `_flagOn()` in
   > modA-llm-init.js, both currently `return true`. Flipping those to default
   > OFF would give students the legacy click-button workup instead of an
   > incoherent stub — a student-facing product decision, deliberately NOT
   > taken here, and it needs a PWA shell bump.

   <details><summary>Pre-2026-08-27 history, valid again once Blaze returns</summary>

   **Module A LLM-patient pilot (2026-05-28) — ✅ ACTIVATED 2026-05-30;
   ⚠️ was SILENTLY BROKEN 2026-08-03 → 2026-08-12, fixed in code, NEEDS A
   FUNCTIONS DEPLOY.**
   > **Outage (found by a live test 2026-08-12).** `#268` (2026-08-03) replaced
   > the per-room `uidMembers` marker with the session-level `roomOf/<uid>`
   > claim and migrated the client + the DB rules, but **not**
   > `functions/index.js`. `_verifyMembership()` kept reading a node nothing
   > writes any more, so hfPatient returned `permission-denied` on **every**
   > turn and the bridge degraded **every room** to the stub patient — which
   > answers a *different* question than the one asked, so it reads as an
   > incoherent patient rather than an outage. Nine days, green CI, unnoticed:
   > the bridge treats any error as "backend unavailable" by design.
   > **Fixed** by pointing `_verifyMembership` at `roomOf` (via
   > `hf-helpers.roomClaimPath` / `roomClaimMatches`) — **inert until
   > `firebase deploy --only functions` runs.** Guarded by
   > `tests/hf-membership-lockstep.test.js` (client↔function node lockstep +
   > "no rule/function may read `uidMembers`"), the mirror of the DB-rule guard
   > in `tests/rules.test.js` that this call site slipped past.
   > `Verify:` from a room in the browser console,
   > `firebase.app().functions('europe-west1').httpsCallable('hfPatient')({roomCode, roomId, lang:'en', messages:[{role:'user',content:'hi'}]})`
   > must NOT return `permission-denied: not a member of the claimed room`.
   > (Call it WITHOUT the region and you hit us-central1 and get a misleading
   > CORS/403 — the function lives in `europe-west1`.)

   The free-text chat with the scenario's patient (via HF Inference Providers,
   proxied by the `hfPatient` Firebase Cloud Function) is live. All activation steps
   are complete: **(a)** privacy notice updated (HF disclosed as sub-processor;
   in-product `modA.chat.disclosure` banner shown); **(b)** Blaze enabled with
   a $1 budget alert (volumes stay inside the Cloud Functions free tier);
   **(c)** `HF_TOKEN` set in Secret Manager + `functions/.env` with
   `MODA_LLM_ENABLED=true`, `HF_PROVIDER=ovhcloud`, `HF_MODEL=Qwen/Qwen3.5-9B`,
   `HF_MODEL_JA=Qwen/Qwen3.5-9B`
   > ⚠️ **DO NOT REUSE THAT MODEL IF BLAZE IS EVER RESTORED.** Proven on the
   > live proxy 2026-09-01: `Qwen/Qwen3.5-9B` does not work on `ovhcloud`. It
   > is a hybrid-reasoning model, OVHcloud rejects `chat_template_kwargs`
   > (HTTP 400) — the only field that switches reasoning off — and `/no_think`
   > does not suppress it either, so it burns its whole token budget thinking
   > and returns an empty reply. The Cloud Function's `.env.example` and
   > `functions/index.js` still name it because that function cannot deploy at
   > all right now; they are historical, not a recommendation. Use
   > `meta-llama/Llama-3.3-70B-Instruct`, as `proxy/` does.
   — **`HF_PROVIDER` is a DATA-RESIDENCY control,
   not a tuning knob** (2026-08-20): unpinned, the HF router picks a provider per
   request, so the recipient of the free-text chat varies turn to turn and cannot
   be named in the DPA; `ovhcloud` serves from Gravelines, FRANCE. **Careful with
   the claim:** this fixes the ONWARD leg only — the request still goes through
   the Hugging Face ROUTER, a separate recipient whose processing location and
   executed contract are not established, so the pin does NOT by itself make the
   chat intra-EEA. What it removes is the varying, unnameable recipient. The
   model must be one the pinned provider serves
   or every call 404s and the chat degrades **silently** to the stub — the same
   failure mode as the 9-day `uidMembers` outage. Verify with
   `curl -s 'https://huggingface.co/api/models/<org>/<model>?expand[]=inferenceProviderMapping'`.
   Qwen3.5-9B covers both languages (201 languages), replacing the old EN→Llama /
   JA→Qwen split, neither of which is served by any EEA-pinnable provider. It is a
   HYBRID-REASONING model, so replies are double-guarded against `<think>` leakage
   (request flag + `hf-helpers.stripReasoning`);
   **(d)** `firebase-functions-compat.js` added to
   [index.html](docs/Third_session/PBL_platform/index.html) after the
   app-check compat script, with its integrity hash; **(e)** deployed
   (`firebase deploy --only functions,database,hosting`). The bridge now wires
   `firebase.functions().httpsCallable("hfPatient")` at startRoom() instead of
   the local stub.
   - `Verify:` `grep -c firebase-functions-compat
     docs/Third_session/PBL_platform/index.html` > 0 (active SDK tag, not
     commented out); `firebase functions:list` shows `hfPatient`;
     `MODA_LLM_ENABLED=true` in `functions/.env`. Tag present but function
     absent (or vice-versa) ⇒ the label is wrong.
   - **Panic button:** edit `functions/.env` and flip
     `MODA_LLM_ENABLED=false`, then `firebase deploy --only functions`.
     Returns `{state:"disabled"}` within ~30s; all clients seamlessly
     fall back to the local stub patient.
   - **~~Pilot gate~~ → DEFAULT-ON (2026-06-02).** The chat is now Module A's
     standard history-taking interface for **every** session — no `?llm=1`
     needed (user request: "I want to keep only the solution with the LLM"). The
     only opt-out is `?llm=0` (sticky via `localStorage.canamedModALLM="0"`),
     which restores the legacy click-button workup for a facilitator demo/debug.
     Gate logic lives in `modALLMFlagOn()` (script-loader.js) and `_flagOn()`
     (modA-llm-init.js), both defaulting to true. The server-side
     `MODA_LLM_ENABLED` flag + the bridge's stub fallback remain the real
     kill-switch for the HF backend (see Panic button above).
     `Verify:` `grep -A6 "function modALLMFlagOn" docs/.../script-loader.js`
     ends with `return true`.
   - **App Check on hfPatient — ⚠️ still NOT ENFORCING
     (`APP_CHECK_ENFORCE=false`). RE-VERIFIED ON A FRESH DEPLOY 2026-08-12.**
     Deliberately *not* worded "Monitor": for a callable, enforcement is the
     code-level `enforceAppCheck` option, and the probe below distinguishes
     ENFORCED from not-enforcing but cannot tell *Monitor* from *Off* — so
     claiming either would assert more than the evidence supports, and would
     contradict this bullet's own caveat further down.
     The function was redeployed that day (the `roomOf`
     fix, #311), so every deploy-timestamp argument in the bullet below is now
     about a **superseded revision** — read this one instead. The deploy came
     from a checkout whose `functions/.env` has `APP_CHECK_ENFORCE=false`, and
     a live probe confirms it end-to-end:

     ```bash
     curl -s -X POST -H 'Content-Type: application/json' -d '{"data":{}}' https://europe-west1-canamed-69785.cloudfunctions.net/hfPatient
     # {"error":{"message":"auth required","status":"UNAUTHENTICATED"}}  <- handler reached
     ```

     That message is the **handler's own**, so the request got past the App
     Check layer: not enforcing (a rejection there never reaches the handler).
     Stronger still, the same day an *authenticated* call succeeded end-to-end
     while the browser's App Check was returning 403 and self-throttled for
     24 h — no token could mint at all, and the call still worked.
     ⚠️ Like the RTDB canary in item 1, this separates ENFORCED from
     not-enforcing; it cannot tell OFF from *Monitor*. The Console stays the
     authority on which of those two is live.

     Original revert **2026-06-03** (`APP_CHECK_ENFORCE=false`, redeployed):
     the chat fell back to the stub patient on *every* message — the same
     reCAPTCHA-can't-mint-a-token failure as the RTDB revert (item 1). The
     room-membership check (`_verifyMembership`: `roomCode`/`roomId` →
     `roomOf/<uid>.room`, `uidMembers` until 2026-08-12 — see the outage note
     above) remains the security boundary; re-enable (`true` + redeploy) only
     once reCAPTCHA reliability is understood. History below (enforcement was
     ON 2026-05-28 → 2026-06-03).
   - **App Check on hfPatient — was ✅ DONE & DEPLOYED (verified 2026-05-30).**
     `firebase functions:list` shows `hfPatient` live (v2 callable); its last
     deploy (`gcloud functions describe` updateTime `2026-05-28T11:38:37Z`)
     postdates the `functions/.env` change that set `APP_CHECK_ENFORCE=true`
     (mtime 20:36 JST = 11:36 UTC, ~2 min earlier) with no deploy since — so
     the live function carries the enforcement flag. The
     function enforces App Check via `enforceAppCheck: APP_CHECK_ENFORCE`
     ([functions/index.js](docs/Third_session/PBL_platform/functions/index.js)),
     and all enabling config is in place: a real reCAPTCHA v3 site key is set
     in [firebase-config.js](docs/Third_session/PBL_platform/firebase-config.js)
     (`CANAMED_RECAPTCHA_SITE_KEY`), client `initAppCheck()` activates the
     provider, and `functions/.env` has `APP_CHECK_ENFORCE=true` (the
     `.env.canamed-69785` override does not unset it). The `PROMPT_VERSION`
     redeploy marker references the `APP_CHECK_ENFORCE` param, indicating the
     deploy carrying it was made (same deploy that activated the pilot).
   - `Verify:` `grep APP_CHECK_ENFORCE docs/Third_session/PBL_platform/functions/.env`
     = `false` (since 2026-06-03); `grep CANAMED_RECAPTCHA_SITE_KEY
     .../firebase-config.js` is a real key (not empty/placeholder). Live-deploy
     confirmation is CLI-only: a tokenless POST to the `hfPatient` callable now
     returns `{"error":{"message":"auth required","status":"UNAUTHENTICATED"}}`
     (handler reached → App Check NOT enforcing). If instead it were rejected by
     the App-Check layer, Enforce would still be on. `.env` is git-ignored, so
     this label cannot be auto-checked from the repo alone.

   </details>

## Scenario characters (facilitator-authored scenarios)

Design record: [ARCHITECTURE/scenario-characters-design.md](docs/Third_session/PBL_platform/ARCHITECTURE/scenario-characters-design.md).

- **Personas live in the scenario, not in code.** Each scenario declares
  `characters: [{ id, role, name, persona, … }]` (case-content.js `CHARACTERS*`).
  `applyScenario()` publishes them at `window.CURRENT_SCENARIO_CHARACTERS`;
  `modA-llm-prompts.js` builds the system prompt from whichever character is
  being interviewed. Exactly one character per scenario carries `role:"patient"`.
  A scenario declaring none falls back to a generic patient — it must never
  inherit the previous scenario's cast.
- **Multi-character switchboard — SHIPPED 2026-09-04 (shell v165).** A
  section declaring several Module A characters gets one chip per character
  above the chat; each character is its own thread on screen AND at the model
  (one persona per call). Persisted turns carry an optional validated
  `character` field on the existing `roomChat/…/$turnId` node (both rule
  trees); **a turn with no field is the index patient's** — that is what keeps
  every pre-existing transcript readable, so never make the field required.
  Facts route by `who`, and an item with no `who` now belongs to the index
  patient ONLY (it used to reach every character). Scoring families may carry
  `askOf: "<characterId>"|[…]`. Single-character sections are unchanged.
  ⚠️ Still owed before the six-section Mayumi session can run: the chat store
  is NOT per-slot — two PBL sections share one `roomChat` transcript. See
  "Slice 2 as shipped" in the design record.
- **⚠ `hfPatient` needs `firebase deploy --only functions` to pick this up.**
  `SERVER_GUARD` was generalised from "simulated patient" to "simulated
  character", and the reply-prefix stripper is now driven by the character's
  name. `PROMPT_VERSION` is `modA-llm@2.5` (bumped 2026-08-20 by the EU
  data-residency pin — see the `HF_PROVIDER` note in item 4 above).

- **✅ DEPLOYED 2026-08-21 — the queue behind this deploy is now empty.** Both the
  scenario-characters `SERVER_GUARD` change and the EU provider pin are live
  (`firebase deploy --only functions`, hfPatient + sendQueuedMail updated in
  `europe-west1`).
  **⚠️ THE TRAP THAT ALMOST MADE THIS A SILENT OUTAGE, for whoever deploys next:**
  `functions/.env` is git-ignored, so NO test and NO CI check can see it — and its
  values OVERRIDE the code defaults. It still named the OLD models
  (`meta-llama/Llama-3.1-8B-Instruct` / `Qwen/Qwen2.5-7B-Instruct`) and had no
  `HF_PROVIDER` at all. Deploying as-is would have combined the old models with
  the new default provider — `meta-llama/Llama-3.1-8B-Instruct:ovhcloud`, which
  OVHcloud does not serve — so every call would have 404d and the chat would have
  degraded **silently** to the stub patient. `tests/hf-model-doc-lockstep.test.js`
  cannot catch this: it reads `.env.example`, not `.env`. **Whenever HF_MODEL,
  HF_MODEL_JA or HF_PROVIDER changes in code, open the real `functions/.env` and
  reconcile it by hand before deploying.** Also: non-interactive deploy refuses to
  run without an explicit `HF_GLOBAL_DAILY_CAP`, now pinned in `.env` to the same
  4000 the code defaults to.
  **STILL OWED — the end-to-end check (needs a real room, cannot be done from the
  CLI).** The provider pin, the `Qwen/Qwen3.5-9B` switch and the `<think>`
  stripping are **deployed**; what is not yet evidenced is that they behave as
  intended against the live endpoint. Qwen3.5-9B replaced BOTH previous models
  and no automated check covers how it talks.
  `Verify:` send one EN and one JA turn from a real room and read
  `metrics/hfPatient/events` — `promptVersion` must be `modA-llm@2.5` and the
  recorded `provider` must be `ovhcloud`. The function stores the
  `x-inference-provider` response header, so that field is the only end-to-end
  proof that the pin took effect; a stub-patient reply instead means the model
  is not served by the pinned provider.
  `Verify:` `grep PROMPT_VERSION docs/.../functions/index.js` and compare with
  the `promptVersion` field on recent `metrics/hfPatient/events` entries.
- Six i18n strings interpolate `{patientName}` (`modA.chart.title`,
  `modA.chart.team-click-warning`, `modA.chat.disclosure`,
  `modA.chat.placeholder`, `modA.chat.thinking`, `modA.coach.read-case`).
  `modA.chat.disclosure` reaches an `innerHTML` sink, so it is DOMPurify-
  sanitised in `modA-llm-init.js` — the name is scenario-authored, i.e. untrusted.

## Known security follow-ups (code, tracked)
- **Self-serve soft-launch gate `facilitatorGate` (Phase 4c, opt-in, INERT by
  default).** A top-level admin-only node (`.read:false`, `.write:false` — set
  only via the Console/admin-SDK) that can restrict who may create sessions.
  The gate guards **every first-write session-bootstrap field** — not just
  `created` (gating only `created` was bypassable: a user could bootstrap a
  session via the ownership path `creatorUid`, the password-proof path
  `adminPasswordHash` + the real `adminSecrets/<code>/hash`, OR the **recovery**
  path — seed a `recovery/…/<code>` code on a hashless session → `_superadminReset`
  → set the hash via the recovery branch — none of which need `created`). So the
  predicate `facilitatorGate/enforce != true || facilitatorGate/allow/<auth.uid>
  == true` now sits on the first-write of `created`, `creatorUid`,
  `adminPasswordHash` (initial-set), `adminSecrets` hash (initial-set), **and the
  `recovery/…/<sessionId>` code write** — in **both** the `sessions/$id` and
  `orgs/$slug/sessions/$id` trees (**10 rules**). The recovery-code write is
  itself a bootstrap field (written once at creation, before any hash), so gating
  it closes the recovery-bootstrap bypass. The `_superadminReset` write and the
  hash rules' `_superadminReset` **recovery branch** stay deliberately ungated —
  they act on already-established sessions (whose recovery code was written by
  their allowlisted creator) and must keep working under enforcement. **Default
  (node absent) → `enforce.val()` is null → creation unchanged** for every
  existing facilitator; nothing is gated until an operator flips it on. To
  soft-launch to a vetted allowlist: set `facilitatorGate/enforce = true` and
  `facilitatorGate/allow/<uid> = true` for each approved uid; to open back up,
  delete the node (or set `enforce=false`). This mirrors the App-Check
  Monitor→Enforce posture (reversible, opt-in). Client-side "not approved"
  messaging is a deferred follow-up (needs `script.js` + a PWA bump); until then
  a non-allowlisted create surfaces a generic permission-denied. Covered by
  `tests/rules.test.js` (structural: admin-only + opt-in shape on all 8
  establishment writes + recovery branch survives) and
  `tests-e2e/emulator/rules-smoke.spec.js` (functional: open by default,
  allowlisted uid creates, non-allowlisted uid denied on `created`/`creatorUid`/
  `adminPasswordHash`/`adminSecrets` hash/**recovery code** in **both** trees, and
  an established session's `_superadminReset`→hash-overwrite recovery chain still
  succeeds under enforcement).
- **Shared-library moderation primitive (Phase 4d, rules — client wiring PENDING).**
  Three top-level nodes support reporting + takedown of `sharedScenarios` without
  hard-deleting: (1) `moderators/$uid` — admin-only allowlist (`.read:false`,
  `.write:false`; set via Console/admin-SDK; rules reference it via `root.child`).
  (2) `reports/scenarios/$shareId/$reporterUid` — write-OWN (`$reporterUid ==
  auth.uid`) + write-ONCE (`!data.exists()`) + must target an EXISTING scenario
  (`sharedScenarios/$shareId.exists()`, bounds the queue — no fabricated-id
  storage pollution) + `.read:false` + `$other:false` sentinel; moderators review
  reports out-of-band via the admin SDK. (3)
  `moderation/removed/$shareId` — a tombstone writable ONLY by a moderator
  (`moderators/<uid> == true`), `.read:auth!=null` so clients can filter. It lives
  OUTSIDE `sharedScenarios` on purpose, so a scenario owner re-publishing their
  scenario cannot clear a takedown. Tested: `tests/rules.test.js` (structural) +
  `tests-e2e/emulator/rules-smoke.spec.js` (functional: report write-own/once,
  peer/other-uid denied, unknown-key denied, non-moderator tombstone denied,
  moderator tombstone allowed). **✅ CLIENT WIRING DONE (2026-07-23, shell v95):**
  `listSharedScenarios()` reads `moderation/removed` alongside the list and drops
  tombstoned entries (degrades to "nothing removed" if that read fails), so a
  takedown actually removes a scenario from the picker; and a "Report this
  scenario" button (`#splash-report-scenario`) appears only when the selection is
  `__ref:shared:` — someone ELSE's scenario — confirms via `canamedConfirm`, then
  writes `reports/scenarios/<shareId>/<uid>` via `reportSharedScenario()`.
  Reporting needs auth (anonymous suffices); with none it says "sign in" instead
  of faking a Reported state — which is why the LOCAL e2e (no `auth` in LOCAL
  mode) asserts the guard, while the WRITE is covered by the emulator test.
  Coverage: `tests-e2e/moderation-ui.spec.js` on desktop + 3 mobile viewports.
  The DOMPurify half of Phase 4d was already DONE + audited clean (every authored
  string reaches the DOM via textContent/esc/DOMPurify — see the selfserve memory).
  ~~⚠️ This landed with the perf budget at 336.9 / 337 KB gz — the room-only CSS
  lazy-split now BLOCKS the next UI change.~~ **RESOLVED 2026-07-23:** that
  reclaim is DONE — 384 room-only rules (58.9 KB raw) moved into a lazily
  `<link>`ed `room.css` (`CanamedLoader.ensureRoomStyles()`, same pattern as
  admin.css/branched.css), taking the splash budget **337 → 325 KB gz**. The cap
  stayed 337 at the time, so that was ~12 KB of banked headroom, not a licence to
  grow. **⚠️ SUPERSEDED — the cap is now 320** (`FIRST_PARTY_BYTES_LIMIT_KB`,
  `tests-e2e/perf.spec.js`): it rose 337 → 345 → 348 across the section-model
  work, FELL to 316 when #285 lazy-split the facilitator dashboard out of
  `script.js`, and rose 316 -> 320 on 2026-08-19 for the Module A triage slice
  — a bump taken AFTER lazy-splitting that feature (321.3 -> 316.5 KB gz), not
  instead of it; each step is logged in that file's header. (This paragraph said
  348 until 2026-08-05 — exactly the drift it warns about, and in the more
  dangerous direction: a stale HIGH cap reads as headroom that does not exist.)
  Quote the CONSTANT, never this paragraph — a reviewer citing the stale 337
  raised a spurious budget-exceeded finding on PR #271 while the check was green.
  `Verify:` `grep FIRST_PARTY_BYTES_LIMIT_KB tests-e2e/perf.spec.js`. See the
  dated entry in `tests-e2e/perf.spec.js` for the triple guard used to make the
  split safe, and `tests-e2e/room-css-lazy.spec.js` for the contract that keeps
  room.css off the splash. **Note for CSS work:** room styles now live in
  `room.css`, so a unit test asserting a room rule must read style.css + room.css
  (that is why ~11 test files concatenate both).
- ~~`votes/ballots` is keyed by `stableId`, not `clientId`, so the clientMapping
  ownership guard (FINDING-01) does not cover it — needs a parallel stableId
  binding.~~ **Fixed:** added `stableIdMapping/$stableId → auth.uid` (write-once,
  mirrors `clientMapping`) under both `/sessions` and `/orgs`; the
  `votes/ballots/$clientId` write rule now requires ownership via either
  mapping (with a tolerant first-write branch). Client binds it in the join
  chain (`claimStableIdMapping`). Covered by `tests/rules.test.js` (structural)
  and `tests-e2e/emulator/rules-smoke.spec.js` (functional: peer overwrite
  denied, owner write + own-key first-write allowed).
- ~~Server-side admin-password verification (FINDING-07): `adminPasswordHash`
  is readable by any authenticated user (hash oracle).~~ **Fixed (free, no
  Blaze):** the real PBKDF2 hash now lives in the top-level `adminSecrets/<code>`
  tree, which has no `.read` rule (root is `.read:false`) so it is unreadable
  by every client — closing the offline oracle even for session members. Login
  verifies by a **proof-write**: the client writes its candidate hash to
  `adminSecrets/<code>/proof/<uid>` and the rule allows it only when the
  candidate equals the stored hash (compared server-side; hash never sent to a
  client). A non-secret random marker stays at `sessions/<code>/adminPasswordHash`
  so the existence-based admin-gated rules keep working. Active in `shared` mode
  for BOTH the default `sessions/` tree and org-scoped sessions
  (`adminSecrets/orgs/<slug>/<sessionId>`, added 2026-05-30); LOCAL keeps
  read-verify (no rules). See `verifyAdminPassword`,
  `useAdminSecrets`, the create/recovery flows, and `tests/rules.test.js` +
  `tests-e2e/emulator/rules-smoke.spec.js` (FINDING-07).
  - **The pre-adminSecrets fallback is still load-bearing. Do NOT remove it on a
    calendar date.** `verifyAdminPassword()` keeps a `legacyVerify()` path for
    "an older session that predates adminSecrets", and that legacy shape
    (`adminPasswordHash` present, `adminSecrets/<code>/hash` ABSENT) is exactly
    what made the null-equality admin-gate bypass exploitable (#297) — so a
    legacy session being reachable is what made that a real fix rather than
    defensive tidying.
    adminSecrets shipped **2026-05-24** (`ee9fc22`), so no session created after
    that can be legacy. But the retention arithmetic is NOT simply
    creation + 90 days, and a first pass at this got it wrong by 30 days.
    `scripts/cleanup-stale-sessions.js` branches on `closed/at` FIRST:
      - closed  → purge at `closed/at + CLEANUP_RETENTION_CLOSED_DAYS` (30)
      - else    → purge at `created/at + CLEANUP_RETENTION_OPEN_DAYS` (90)
    **Closing a session RESTARTS the clock.** A legacy session that stays open
    is gone by 2026-08-22, but one CLOSED just before that survives another 30
    days — a worst case of **2026-09-21**. And that still assumes the daily
    cleanup ran; it is a `continue-on-error`-style best effort, not a guarantee.
    `Verify:` recompute from `ee9fc22`'s date and BOTH retention constants, and
    read the branch order in `cleanup-stale-sessions.js` — the closed branch
    ignores `created/at` entirely. Do NOT query production data for this.
    **Removal condition — a state, not a date.** Remove `legacyVerify()` and its
    create/recovery branches only once it is established that no session exists
    with `adminPasswordHash` set and `adminSecrets/<code>/hash` absent (an
    operator-side check, e.g. during a scheduled cleanup run). 2026-09-21 is the
    earliest that is *possible*, not the day it becomes true. Removing it while
    one such session lives locks a real facilitator out of it.
- ~~`pool/$clientId/room` is intentionally writable by any authenticated user
  (admin room-assignment + self-assign); residual room-griefing is accepted
  until a cryptographic admin identity exists.~~ **CLOSED — Phase 4a (2026-07-22).**
  `pool/$clientId/room` is now restricted to SELF-assign (the client owns its
  `clientMapping`) OR ADMIN-assign (creator `creatorUid == auth.uid` or a fresh
  password-proof at `adminSecrets/<code>/proof/<uid>`), in both the `sessions/`
  and `orgs/` trees. Same Phase-4a pass bound 19 other admin-write nodes
  (`started`, `roomCount`, `summary`, `mail`, `score/manual`, `_adminPresence`,
  the three links, org `audit`) to that same identity predicate. Validated by
  `tests-e2e/emulator/rules-smoke.spec.js` ("admin-write nodes + pool/room are
  creator/proof-bound (Phase 4a)") + structural asserts in
  `tests/round3-clientmapping.test.js`.
  - **`rooms/$roomId/stage` + `stageAt` — now ALSO identity-bound** (completed in
    the same PR #223). `setRoomStage` was changed from an RTDB `.transaction()`
    to a read-then-`set()`: a transaction does a client-side rule pre-check
    against the local cache, and the identity predicate references the unreadable
    `adminSecrets/proof` node, so a transaction-based advance was rejected
    client-side; a `.set()` is server-evaluated (full data). PWA shell bumped
    v93→v94; LOCAL-e2e `advance-and-close.spec.js` confirms Advance still
    propagates. The from-guard survives as a best-effort read-then-set check.
  - **Stale-proof hardening (PR #223 review):** all admin predicates check
    `adminSecrets/<code>/proof/<uid>.val() == …/hash.val()` (proof equals the
    CURRENT hash), not `.exists()` — so a proof written against an old password
    auto-invalidates when `_superadminReset` rotates the hash. Fixed on the
    `closed` rule too (it previously used `.exists()`).
- Module A `scoring/awarded/<famId>` is client-writable (write-once, bounded
  points, requires uidMembers membership). A teammate with dev tools can
  still pre-award their own room — accepted because this is collaborative
  pedagogy, not assessment. The 2026-05-28 review noted that the per-room
  `uidMembers` gate closes the cross-room griefing path that existed when
  the chat first landed; only same-room self-awarding remains. Server-side
  scoring would require returning `awards: [...]` from `hfPatient` and
  writing them via admin SDK — deferred. **Revisit when:** Module A scoring
  ever becomes graded / assessment (stakes appear) — then move scoring
  server-side. Until then accepted: Module A is formative, so the incentive
  to self-award is near-zero.

### 2026-05-30 multi-agent security review — outcomes

**Fixed (committed + tested):**
- **Pseudonymisation leaks (P0)** — the research export left real names in the
  "pseudonymised" file (free-text LLM chat, facilitator `by` fields, duplicate
  display names) + an unscrubbed `university` quasi-identifier. Rewritten as
  the pure, unit-tested `scripts/lib/pseudonymise.js` (drops chat + facilitator
  transient fields, redacts unknown names, collision-safe, buckets university).
  Also `cleanup-stale-sessions.js` redacts `e.message` in `CLEANUP_QUIET` mode.
- **Per-room write gating (P1)** — added the `uidMembers` gate to
  `score/auto`, `score/penalties`, `moduleA/hypotheses`, `moduleA/promptReplies`,
  `moduleB/exchangeReplies`, `votes/committed` (sessions + orgs) so a member of
  one room can't tamper with another's. Validated by the emulator suite (new
  cross-room denial test) + the cross-tab sim.
- **Client/auth (P3)** — scenario-author sign-up now enforces the main app's
  8-char + 3-class password policy (was 6); removed the unused `html:` innerHTML
  footgun in scenario-author `el()`; `showOrgNotFoundSplash` escapes `> " '`;
  `authErrorMessage` no longer surfaces raw SDK messages.
- **hfPatient (P2) — ⚠ REQUIRES `firebase deploy --only functions` to activate:**
  server now prepends an authoritative system guard the client can't override
  (stops persona replacement / prompt extraction); `HF_URL` locked to
  huggingface.co (no token exfil to arbitrary hosts); HF error body no longer
  forwarded to the client; `lang` allowlisted. PROMPT_VERSION bumped to 2.2.

### 2026-07-23 Phase-4e legal fact-check — FOUR COMPLIANCE GAPS — ✅ ALL FOUR FIXED (re-verified 2026-08-19)

> **STATUS (re-verified against the code 2026-08-19):** all four gaps below are
> CLOSED. Gaps 2 and 3 were corrected in place earlier (2026-07-29 / 2026-07-31);
> gaps 1 and 4 stayed labelled OPEN here long after their fixes had landed, and
> that stale labelling is what this entry corrects. Trust each gap's own
> `Verify:` line, not this banner.
>
> ⚠️ **One sub-claim is still OPEN** — a certificate is still minted *and published*
> on the download click with no separate prompt. See the "Also" paragraph after
> gap 4. That, not these four, is the remaining blocker on the consent/DPA text.

Drafting the facilitator-as-controller legal pack forced every privacy claim to be
checked against the code. Four were wrong in the CODE, not the prose — the legal
text could not be made truthful until they were fixed. The gap text below is kept
as the historical record of what was wrong.
1. ~~**Research export ignores consent entirely (HIGHEST).**~~ **✅ FIXED — label was
   stale, corrected 2026-08-19.** The gap was real when written; the research export
   now gates on consent. `pseudonymise-export.js` imports `sessionHasConsent` /
   `hasResearchConsent` from `scripts/lib/pseudonymise.js`, filters to
   `consentedCodes`, and reports how many sessions and participants were excluded;
   the gate comment names this gap by number.
   **Scope note (do not over-read the fix):** `backup-sessions.js` is deliberately
   NOT consent-gated. It is operational disaster recovery — it archives a snapshot
   before the retention purge so a database bug or malicious wipe stays recoverable —
   which is a different lawful basis from research reuse; gating it on consent would
   defeat the backup. The consent text may therefore say research *reuse* is
   optional, but must not imply that no copy of the data exists.
   `Verify:` `grep -c -i consent scripts/pseudonymise-export.js` > 0 (15 on
   2026-08-19) and `grep -n "RESEARCH CONSENT gate" scripts/pseudonymise-export.js`
   hits; `grep -c -i consent scripts/backup-sessions.js` = 0 **by design**.
2. ~~**Org-scoped sessions have ZERO retention coverage.**~~ **✅ FIXED — label was stale,
   corrected 2026-07-29.** The gap was real when written (all three retention jobs were
   hard-scoped to `db.ref("sessions")`), but has since been closed: all three now walk
   BOTH trees via the shared `scripts/lib/session-trees.js` helper
   (`readSessionLocations`), and `cleanup-stale-sessions.js` also purges the session's
   `adminSecrets/…` entry, which lives outside the session subtree. `Verify:`
   `grep -c orgs scripts/{cleanup-stale-sessions,backup-sessions,pseudonymise-export}.js`
   = 2/2/2 (was 0/0/0), and all three appear in
   `grep -ln session-trees scripts/*.js`.
3. ~~**`moduleA/chat` is NOT room-private — UNDECIDED.**~~ **✅ FIXED — label
   corrected 2026-07-31 after checking the code.** The decision recorded below as
   open was in fact taken, and it was option (b): the chat moved OUT of the
   `sessions/$sessionId` read-cascade into a top-level `roomChat/$sessionId/$roomId`
   tree whose own `.read` is granted per ROOM (plus the facilitator, for debrief),
   mirroring `adminSecretPath()`. `Verify:` `rules.roomChat` exists in
   `database.rules.json` and `rooms/$roomId/moduleA/chat` no longer does;
   `roomChatPath()` is in script.js; the emulator suite carries "roomChat is
   room-private — a session member in another room cannot read it (gap 3)".
   The analysis below is KEPT because its reasoning still governs every future
   node (RTDB `.read` cascades and cannot be revoked at a deeper path, so a
   deeper `.read` is additive only) — but the gap itself is closed, and the
   consent text may now rely on the chat being room-private.

   <details><summary>Original entry, superseded</summary>

   **`moduleA/chat` is NOT room-private — UNDECIDED, do NOT treat as accepted.**
   RTDB `.read` **cascades and cannot be revoked at a deeper path**.
   `database.rules.json:93` grants `.read` on the whole `sessions/$sessionId`
   subtree to any session member, so the room-scoped rule on
   `rooms/$roomId/moduleA/chat` (~line 309, requiring `uidMembers/$uid`) is
   **additive only** — it restricts nothing. **A participant's free-text chat with
   the LLM character is readable by EVERY member of the session, not just their
   room.** (This corrects a claim previously filed under "Accepted by design" that
   read "Only `moduleA/chat` is per-room read-gated" — that claim was FALSE; the
   draft consent text had been built on it.) Verified directly against the rules.
   **Open decision, pending product + legal sign-off:** either (a) accept it and
   say so honestly in the privacy notice + in-product disclosure, or (b) actually
   restrict it, which needs the chat moved OUT of the `sessions/$sessionId`
   read-cascade (e.g. a sibling top-level `roomChat/$sessionId/$roomId` tree with
   its own `.read`) — a deeper `.read` alone can never fix this. Only after that
   decision is made may this move to an "accepted" or "fixed" heading.

   </details>

4. ~~**`canamed_stable_id` survives sign-out**~~ **✅ FIXED — label was stale,
   corrected 2026-08-19.** `accountSignOut()` now drops the persisted stableId
   instead of clearing nothing: the comment "The signed-in uid was persisted as the
   stableId; drop it so the next…" sits immediately above a `resetStableId()` call,
   so a signed-out account's uid no longer lingers as a linkage key. (The old line
   reference "script.js ~14342" was stale too — `accountSignOut()` is ~12328 today.)
   `Verify:` `grep -A22 "function accountSignOut" docs/Third_session/PBL_platform/script.js | grep -c resetStableId` = 1.
Also — ⚠️ **STILL OPEN (re-checked 2026-08-19):** a certificate is minted *and
published* on the download click, with no separate prompt. `resolveCertId` now lives
in [takehome.js](docs/Third_session/PBL_platform/takehome.js) (~130 — moved there by
the lazy split, no longer script.js), and the same click that builds the take-home
also writes the (name-hash, session) record to `credentials/<certId>`. Clicking
"download" is an opt-in to *receiving* a certificate, but not an informed opt-in to
*publishing* a verifiable record — so "getting a certificate is optional" still
cannot be stated without qualification. **This is the one Phase-4e item still
genuinely open.** `Verify:` `grep -n "credentials/"
docs/Third_session/PBL_platform/takehome.js` shows the `.set(payload)` publish
reached from the download flow with no consent check between.
Drafts (with these gaps flagged) live in `docs/Third_session/PBL_platform/legal/`.

**A FIFTH gap, found 2026-07-29 while preparing the CER Unicaen dossier — ✅ FIXED
(shell v113→v114).** The Art. 13 notice promised live session data was "purged within
7 days" while the deployed job keeps closed sessions **30** days and abandoned ones **90**
(`CLEANUP_RETENTION_CLOSED_DAYS` / `_OPEN_DAYS`, pinned to the same values by
`.github/workflows/cleanup-stale-sessions.yml`). Resolved by **correcting the notice to
30/90**, not by tightening the job: 30/90 is proportionate to the facilitator debrief
window, tightening to 7 d would have purged sessions still in use (a never-closed session
would die after a week), and `cleanup-stale-sessions.js`'s own header already documented
30/90 as the intended policy — the 7-day text was the stale outlier. Twelve published
surfaces were corrected: `privacy.html` §8 (EN/FR/JA), `lobby.privacy.p3` in `i18n.js`,
all seven `locales/*.js`, and the hardcoded fallback `<p>` in `index.html`.
- **Same pass fixed a second, worse drift in that sentence:** `de/es/ko/pt/zh` and the
  `index.html` fallback described the research dataset as **pseudonymised**, while
  `privacy.html`, the EN canonical, `fr`/`ja` and the CER dossier all declare it stored
  **linked to the participant (identifiable)** for up to 5 y. Those participants' consent
  rested on a false premise. (`lobby.consent-research` saying analysis/publication happens
  in pseudonymised form is a *different, accurate* claim — deliberately left alone.)
- **Regression guard:** `tests/retention-notice-consistency.test.js` parses the enforced
  days out of the script + workflow and asserts all 12 published surfaces state them,
  claim no 7-day purge, and never say "pseudonymised". Nothing linked those two sources
  before, which is why they diverged unnoticed for months. `Verify:` `node --test
  tests/retention-notice-consistency.test.js`.
- `LOCALE_VERSION` (i18n.js) bumped v8→v9 alongside the shell bump — it is a **separate
  counter**, and without it returning browsers keep serving the cached 7-day locale chunk.

**Accepted by design (no change — documented decisions):**
- Full room-subtree readability to any session member, **for structured
  per-room work** (scores, hypotheses, votes, prompt replies): intentional
  classroom visibility (facilitator/observer). ⚠️ **Scope note:** this bullet
  covers the structured nodes ONLY. The free-text `moduleA/chat` rides the same
  cascade but is **NOT accepted** — it is an open decision, see gap 3 above.
  A line previously here claiming "Only `moduleA/chat` is per-room read-gated"
  was false and has been removed.
- `sharedScenarios` readable by any authenticated user: that is the opt-in
  facilitator sharing feature working as intended.
- `credentials/$certId` public read by exact id (no `auth`): required by the
  unauthenticated certificate-verification page. **Published cert IDs are now
  crypto-random + persisted** per participant (`randomCredentialId()` →
  `certIds/<code>/<clientId>`, write-once, owner-only, OUTSIDE the sessions/
  read-cascade), so neither an outsider (no enumeration) nor a **classmate** can
  derive a peer's id. This closed the fifth Phase-4e gap (**FIXED 2026-07-24**):
  the old published id was the *deterministic* `canamedCertId(session|clientId)`,
  recomputable by any session member from the pool keys — it now survives ONLY as
  an offline fallback, never as a published id. Migration: existing deterministic
  certs stay valid (no backfill); new ones are random.
  ⚠️ **What the record actually carries — corrected 2026-08-19.** This said "only
  a name **hash** + session label", which UNDERSTATED it, and the same wrong
  claim appeared under "Round-3 — re-confirmed ACCEPTED" below. `takehome.js`
  writes **five** fields: `nameHash`, `session`, `sessionLabel`, `at`,
  `retentionUntil`. The one that matters is `session` — it is `sessionNum`, the
  **session CODE**, not a label. So a public, unauthenticated read by exact id
  discloses the session code, and this repo treats that code as semi-sensitive
  elsewhere (`cleanup-stale-sessions.yml` sets `CLEANUP_QUIET=1` precisely so
  world-readable CI logs never print session codes). Bounded, not alarming: cert
  ids are crypto-random since #239 so nothing is enumerable, and you must already
  hold an id — which certificates are meant to be shareable with. But it is more
  than the two fields claimed, and the consent/DPA text must not repeat the
  narrower wording. **Open question for the pilot:** whether `session` needs to
  be in the public payload at all — the verification page may only need the
  label, in which case the fix is to stop publishing the code rather than to
  document that we do. (Found by CodeRabbit on #236, against a CLAUDE.md hunk
  that PR no longer carries; the wrong text was here on main.)
  `Verify:` `grep -n certIdPath docs/Third_session/PBL_platform/script.js` > 0;
  the `certIds/$id` case in `tests-e2e/emulator/rules-smoke.spec.js` proves
  owner-write-once + PEER-DENIED; and
  `sed -n '/const payload = {/,/};/p' docs/Third_session/PBL_platform/takehome.js`
  lists the fields actually published — compare it against any claim made here.
- `poll/$clientId` uses the same tolerant first-write `clientMapping` branch as
  `pool`/`presence`/`typing`: in the brief window before the join chain commits
  the mapping, a peer could spoof another participant's qualitative poll answer
  (`hardest`/`feeling`). Same accepted class as the room-griefing residual; the
  window is narrow (the claim runs before the poll UI is reachable). **Note for
  research:** poll data feeds the research export — if poll integrity ever
  matters for analysis, bind it to `clientMapping` ownership like `votes/ballots`.

**Also fixed (2026-05-30, second pass):**
- **Org-scoped adminSecrets (D1)** — org sessions stored the real
  `adminPasswordHash` at an `auth!=null`-readable path (hash oracle). The
  `adminSecrets` proof-write scheme now covers org sessions too: real hash at
  the unreadable `adminSecrets/orgs/<slug>/<sessionId>/hash`, a non-secret
  marker at the readable org `adminPasswordHash`. `useAdminSecrets()` is now
  true for any shared-mode deployment; `adminSecretPath()` namespaces per org
  (default org path unchanged). Emulator-tested (hash unreadable, proof-write
  verifies, write-once).
- **sendQueuedMail HTML (D2)** — `job.html` now sanitised with `sanitize-html`
  + a tight allowlist before nodemailer. Shipped + deployed 2026-05-30.

**Round-2 review (2026-05-30) — fixes to the round-1 fixes:**
- Pseudonymiser: null-prototype maps (a participant named `__proto__`/`toString`
  no longer collides with a built-in) + bare-string array-element scrubbing.
- hfPatient: the `j.error` branch no longer forwards the provider body to the
  client; pure helpers extracted to `functions/lib/hf-helpers.js` and unit-tested
  (`tests/hf-helpers.test.js` — HF_URL allowlist, system-guard collapse, lang).
  `mailto` removed from the email sanitiser. Redeployed.
- `signUpWithEmail` backstop now enforces the full `scorePassword().ok` policy
  (was a stale 6-char check).
- `verify.js` bounds DB display fields + guards the date parse; `telemetry.js`
  logs `pathname` only (no query-string identifiers); `sw.js` `skipWaiting`
  requires `event.source`.
- Org rule parity: `moduleA/hypotheses`, `promptCursor`, `promptReplies` and a
  `moduleB` block (`phase`, `exchangeCursor`, `exchangeReplies`) added to the
  org tree with the `uidMembers` gate (were absent ⇒ fail-closed; now at parity
  with `sessions/`). Emulator-tested (own-room allowed, cross-room denied).

**Round-3 review (2026-05-30) — fixed:**
- **Recovery-race (HIGH)**: the admin-hash overwrite rules allowed any authed
  user to write during a fresh `_superadminReset` window. Now the reset records
  its initiator's uid (`== auth.uid`) and all four hash-overwrite rules
  (sessions+orgs × adminPasswordHash + adminSecrets/hash) require the writer to
  match. Emulator-tested (race-guard: distinct uid denied).
- **Supply-chain**: nodemailer ^6 → ^8.0.10 (vuln line); Dependabot now watches
  `functions/`; explicit `permissions: contents: read` on test/e2e/rules-e2e/
  synthetic-uptime workflows.
- **scenario-author.js**: removed the `Function()` eval (code-exec sink) → JSON
  only; removed the dead `html:` branch in `el()`.
- `credentials/$certId.retentionUntil` now capped (`<= now + ~5y`) so a client
  can't set retention indefinitely and defeat GDPR cleanup.

### ✅ THE ROOM GATE IS BOUND — fixed 2026-09-03 (found 2026-08-03)

**Fixed.** The self-write branch of `sessions/$id/roomOf/$uid` now requires the
`cid` in the claim to map to the claimant (`clientMapping/<cid> == auth.uid`)
**and** the room claimed to equal that clientId's own pool assignment
(`pool/<cid>/room == room`), in both trees. Proven functionally in
`tests-e2e/emulator/rules-smoke.spec.js` ("a participant cannot claim a room they
were not assigned to (B1)"), with an ALLOW leg so a denial cannot be explained by
an unwritable node, and pinned structurally by `tests/dpia-facts.test.js`.

⚠️ **THE ORIGINAL FINDING NAMED THE WRONG NODE, and the real one was worse.**
Everything below is about `uidMembers`. That node turned out to be **vestigial** —
the client stopped writing it in #268 and it appeared exactly twice in the whole
rules file, both times as its own declaration, gating nothing. The load-bearing
claim is **`roomOf`**, which is what `roomChat`'s `.read` and `.write` are
expressed in terms of, and it was self-assertable in the same way. **Fixing the
node the finding named would have changed nothing.** `uidMembers` has been
removed outright; the legacy-data handling in
`scripts/lib/{erasure,pseudonymise}.js` stays, because old sessions still contain
what it held.

⚠️ **The client had to change too, for the reason PR #223 records.** The claim
was a `.transaction()`, which runs the rule CLIENT-SIDE against the local cache;
the new predicate reads `clientMapping` and `pool`, so a transaction would be
pre-rejected in the browser whenever those were not yet cached. It is now a
read-then-`set()`, evaluated on the server. Write-once is unaffected — the rule's
`!data.exists()` is what enforced it all along.

*The original finding, kept because its reasoning still governs every future
per-room rule:*

### (historical) THE ROOM GATE WAS SELF-ASSERTABLE — every `uidMembers` rule was a speed bump, not a boundary (found 2026-08-03)

**Do not describe any per-room rule as "room-private" or "cross-room tampering is
denied" until this is fixed.** `rooms/$roomId/uidMembers/$uid` has
`.write: auth != null && auth.uid == $uid && !data.exists() && !closed` — a
participant CLAIMS their own membership, and **nothing checks they were actually
assigned to that room**. So any authenticated user who knows a session code can
self-claim any room and then act as a member of it.

Reproduced against the real emulator (with `scripts/sim/build-emulator-rules.js`
run first — see the trap below):

| step | result |
| --- | --- |
| cross-room `answers/moduleA` write BEFORE self-claim | `PERMISSION_DENIED` |
| self-claim `rooms/Room 2/uidMembers/<uid>` | **ALLOWED** |
| same cross-room write AFTER the claim | **ALLOWED** |
| cross-room `answersDeleted` write after the claim | **ALLOWED** |
| `roomChat` WRITE to another room after the claim | `PERMISSION_DENIED` (extra guard) |
| **`roomChat` READ of another room after the claim** | **ALLOWED** |

**Scope — everything gated this way since 2026-05-28/30**, not just the newest
nodes: `moduleA/hypotheses`, `scoring/awarded`, `scoring/auto`, `penalties`,
`votes/committed`, `promptReplies`, `exchangeReplies`, `answers/moduleA|B|Branched`
(#266), `answersDeleted` (#267) — **and the `roomChat` READ gate**, which is the
Phase-4e gap-3 fix. A session member can read another room's LLM conversation.
That contradicts any "the chat is room-private" claim in the privacy notice.

**#266 and #267 are still worth having** — they stop the *un-claimed* cross-room
write and seal the entry schema — but neither "closes" the hole, and their
original descriptions overstated it.

**DECIDED FIX (user, 2026-08-03): bind the claim to the pool assignment.** A
`uidMembers` claim must MATCH the claimant's own pool entry —
`pool/<clientId>/room == $roomId` with `clientMapping/<clientId> == auth.uid` —
so the claim becomes verifiable instead of asserted. This keeps the self-assign
join flow (`pool/$clientId/room` is deliberately self-assignable, Phase 4a) while
removing the free-for-all. Needs its own PR: it touches the room-entry path of
EVERY session, the ordering matters (the pool assignment must land before the
claim, or entry breaks), and it wants a full emulator run.

**⚠️ EMULATOR TRAP that made the first probe meaningless:** the emulator runs the
GENERATED `database.rules.emulator.json`, not `database.rules.json`. `npm run
test:e2e:rules` rebuilds it first; invoking `firebase emulators:exec` directly
does NOT, so it silently tests whatever was generated last — possibly another
branch's rules. Always run `node scripts/sim/build-emulator-rules.js` before a
hand-rolled emulator run, and assert the gate is present in the GENERATED file
before trusting a result.

### ⚠️ A DENIAL IS NOT EVIDENCE OF A GATE — the emulator's regex parser drops backslashes (found 2026-08-06)

**Never let an emulator test rest on a denial alone.** Pair every denial with an
ALLOW of the *same payload* by an authorised identity — otherwise the test cannot
tell "the gate held" from "nothing could ever be written here".

How this bit: `build-emulator-rules.js` rewrote `\s` (which the emulator rejects
at rules-LOAD time, `Illegal regular expression, 'whitespacechar' not found`) to
`\t\n\r` followed by a literal ASCII space — the trailing space is part of the
replacement, and is spelled out here because inside a code span it is invisible
(and trips markdownlint MD038), which is not a good property for a note whose
whole subject is which characters a class contains.
That LOADS, so it looked fine for months. But **the emulator's regex
parser does not honour backslash escapes inside a character class — it drops the
backslash.** Probed directly:

| regex | value | result |
| --- | --- | --- |
| `/^[^\t]+$/` | `"ttt"` | **deny** — the LETTER t is excluded |
| `/^[^\t]+$/` | `"a<TAB>b"` | **ALLOW** — a real TAB is not |
| `/^[^\x09]+$/` | `"v@example.test"` | deny — `\x` is likewise x, 0, 9 |

So `[^@\t\n\r ]` meant "not @, t, n, r, space": it banned t/n/r from every email
address and admitted real tabs and newlines. `sessions/$id/mail/$mailId` became
unsatisfiable under the emulator, so the open-relay security test passed on a
denial that had nothing to do with the admin gate — **it would have passed with
the gate deleted.** `sendQueuedMail` does no authorisation of its own, so that
rule is the only gate on the relay. The three `*Link` validators (six more `\s`
sites) were equally un-exercisable and had never been asserted on at all.

Fixed: whole-CLASS substitutions probed against a live emulator (`[^@\s]` →
`[!-?A-~]`, `[^\s]` → `[!-~]` — printable-ASCII ranges, the only forms that both
load and are honoured), plus `assertEmulatorSafe()`, which now FAILS the build on
any surviving backslash escape rather than mistranslating the next one. The
emulator variant is deliberately **strictly tighter** than production, so an
emulator ALLOW is sound evidence about production while a denial on a *non-ASCII*
payload is not — keep emulator test payloads ASCII. `sim-with-emulator.js` had a
second inline copy of the transform; it now delegates.
`Verify:` `node --test tests/emulator-rules-transform.test.js`, and in the
emulator suite "mail queue is admin-gated" + "the three session links are
admin-gated" — both now carry ALLOW legs as positive controls.

### 2026-08-05 — an org session was driven end to end for the FIRST time

Everything about the `orgs/` subtree had been verified by inspection and by unit
tests on path *derivation*; no test had ever loaded an org URL, because none
could. `scripts/serve-platform.js` had no `/o/**` route (`/o/caen-nagoya/` →
404), and `orgs.js` registers exactly ONE org — `caen-nagoya` — which IS
`CANAMED_DEFAULT_ORG`, so `canamedSessionPrefix()` maps it back to the legacy
`sessions/` prefix and **no shipped client can produce an `orgs/…` path at all.**
`tests-e2e/org-session-e2e.spec.js` now drives a real two-section session at
`/o/e2e-org/` (a test-only tenant injected by an augmenting `CANAMED_ORGS`
accessor — orgs.js stays production config).

**What the run PROVED (LOCAL mode, so paths only — never rule behaviour):**
org routing holds. Every write landed under
`orgs/e2e-org/sessions/<code>/…`, `sessions/<code>` read back `null`, and the
raw LocalDB store's top-level `sessions` key set was empty. Both sections
routed to their own `answers/sections/<slot>`, and the take-home the student
downloads carried both back.

**⚠️ `/o/<slug>/` WAS BROKEN IN PRODUCTION — asset resolution, not data.
FIXED IN CODE 2026-08-06 (shell v142); ✅ CONFIRMED LIVE 2026-08-12 (see STATUS
below — and read the `Verify:` note there before concluding it is broken).**
index.html had no `<base>` and referenced every asset relatively, while
firebase.json rewrites `/o/**` → `/index.html`. Measured against the live
deploy 2026-08-05:

| request | result |
| --- | --- |
| `GET /theme-init.js` | 200 `text/javascript`, 1 579 B |
| `GET /o/caen-nagoya/theme-init.js` | 200 **`text/html`, 221 781 B** (index.html) |

So every script/stylesheet/font/manifest an org page asked for came back as the
HTML shell, which `X-Content-Type-Options: nosniff` then refuses to execute.
`navigator.serviceWorker.register("sw.js")` failed the same way. An org URL
loaded a dead page.

**The fix (root-absolute asset URLs, chosen over a Hosting capture rule):**
every `src`/`href` in index.html, the `v()` helper in script-loader.js (which
addresses ~30 LAZY chunks the shell never mentions — the half most likely to be
missed), `ensurePdfmake()`'s two un-versioned vendored bundles, the SW
registration (`/sw.js` + explicit `{scope:"/"}`), `i18n.js`'s locale chunks and
its `localizedHref()`, and `reader-dict.js`'s dictionaries. `<base href="/">`
was rejected: it would break the ~32 same-document `#ic-*` SVG `<use>` refs and
the `href="#"` skip link. **`scripts/serve-platform.js` lost its org-asset
prefix-stripping crutch in the same change** — it made the dev server kinder
than Hosting and masked the defect; it now resolves real-file-then-rewrite,
exactly like Hosting.

✅ **STATUS — CONFIRMED FIXED IN PRODUCTION 2026-08-12** (checked against the
live site at shell v143). The defect is a Hosting-rewrite behaviour, so nothing
local can prove it; the check below was run against the live deploy and passes.

⚠️ **The `Verify:` first recorded here could NEVER have passed — it would have
reported this as broken forever, on a site that works.** It read
`curl -sI …/o/caen-nagoya/theme-init.js` expecting `text/javascript`. That
expectation belongs to the Hosting **capture-rule** fix — the one explicitly
REJECTED two paragraphs up. firebase.json still rewrites `/o/**` →
`/index.html` with no asset exclusion, so that URL returns index.html as
`text/html` **by design**, identically before and after the fix. What the
root-absolute fix changes is that nothing ever *requests* that URL: the page at
`/o/<slug>/` asks for `/theme-init.js`, which is a real file. So a `text/html`
there is NOT a regression signal — **do not re-open this on that reading.**
(General lesson, and the reason this is spelled out rather than quietly
swapped: a `Verify:` that cannot pass is worse than none. A missing check
leaves you uncertain; a false one manufactures a bug report about healthy code,
and costs whoever chases it. When writing one, confirm it distinguishes the
fixed state from the broken state — run it against BOTH if you can.)

`Verify:` check the URLs the org page actually emits, which is what the fix
changed:

```bash
# 1. the org page must EMIT root-absolute URLs — that is what the fix changed.
curl -s https://canamed-69785.web.app/o/caen-nagoya/ | grep -o 'src="/theme-init\.js?v=v[0-9]*"'
# src="/theme-init.js?v=v143"   <- LEADING SLASH = fixed (broken state: src="theme-init.js?v=…")

# 2. and the URL it emits must really serve JS. Assert the STATUS as well as the
#    type: a non-200 carrying a JS content type would otherwise pass, which is
#    the same class of defect this whole section is about. GET, not HEAD (-I),
#    because GET is what the browser issues.
curl -sS -w '\n%{http_code} %{content_type}\n' https://canamed-69785.web.app/theme-init.js | tail -1
# 200 text/javascript; charset=utf-8      <- must be BOTH 200 and javascript
```

Do **not** rewrite that second one as the more obvious
`curl -o /dev/null -w '%{http_code} %{content_type}\n' …`: Git Bash here ships
**mingw64 curl** (a Windows binary), which cannot write to the MSYS `/dev/null`
path and exits **23** `client returned ERROR on write` *after* printing the
correct answer. It looks like a failed check on a healthy site — this section's
own failure mode, one layer down. Discarding the body via `-o` is what breaks;
appending the status line to it and taking `tail -1` needs no discard.
Discrimination confirmed on all three cases: `/theme-init.js` → `200
text/javascript` (pass); `/o/caen-nagoya/theme-init.js` → `200 text/html`
(fail, the rewrite); a missing asset → `404 text/html` (fail).

Measured 2026-08-12: `/o/caen-nagoya/` serves HTML byte-identical to
`/index.html` (same md5), carrying `/theme-init.js?v=v143`, `/tokens.css?v=v143`,
`/script-loader.js?v=v143` and `register("/sw.js", { scope: "/" })` — every one
root-absolute. Also `curl -s https://canamed-69785.web.app/sw.js | grep
canamed-shell-v` should show `v142` or later, confirming the shell carrying the
fix is live (v143 as of this check).
Regression cover: `tests-e2e/org-session-e2e.spec.js` asserts on the real
network responses at `/o/e2e-org/` — separately for the static shell and for a
LAZY chunk, because the first passing proves nothing about the second.

**Two NEW rule-parity gaps, found by diffing the two rule subtrees. Neither was
observed — LOCAL mode models no rules — so these are static findings:**
- ~~**`rosters` org branch is mis-nested by one level.**~~ **✅ NOT TRUE ANY MORE —
  label was stale, corrected 2026-08-21.** The rule tree now reads
  `rosters/orgs/$orgSlug/sessions/$sessionId/$uid`, which matches the client
  path (`"rosters/" + sPath(uid)`, i.e. `_sessionPrefix(org) + code + "/" + uid`)
  exactly. Both branches — `rosters/sessions/$sessionId` and the org one — are
  present. The finding was real when written; it was fixed at some point without
  this line being updated, which is precisely what the STATUS-CLAIM RULE exists
  to catch.
  `Verify:` this is now **pinned by a test**, not by prose —
  `tests/session-trees.test.js` "the rosters rule tree covers both derived roster
  paths" asserts both branches exist in `database.rules.json`, and two sibling
  assertions pin the derived `rosterPath` values. A regression fails the unit
  suite instead of silently fail-closing org rosters again.
- ~~**`audit` is org-only — the DEFAULT tree has no rule for it.**~~
  **✅ NO LONGER TRUE — label was stale, corrected 2026-09-04.** `audit` is
  declared under **both** `sessions/$sessionId` and
  `orgs/$orgSlug/sessions/$sessionId`, each admin-gated by the same
  creator-or-proof predicate as the rest of the Phase-4a nodes. So
  `logAdminAction()`'s write works in the default tree too, and the "has never
  worked on the default org" claim is wrong. The finding was real when written;
  it was fixed at some point without this line being updated — the same failure
  the STATUS-CLAIM RULE exists to catch, and the second sighting after
  `rosters`.
  `Verify:` `python -c "import json;r=json.load(open('docs/Third_session/PBL_platform/database.rules.json'))['rules'];print('audit' in r['sessions']['$sessionId'], 'audit' in r['orgs']['$orgSlug']['sessions']['$sessionId'])"`
  prints `True True`. Now also covered structurally by
  `tests/rule-tree-parity.test.js`, which asserts the two subtrees have
  IDENTICAL key sets — so this particular claim cannot go stale again in either
  direction.

**Round-3 — TRACKED hardening (defense-in-depth, not active exploits):**
- ~~**`answers/moduleA` + `answers/moduleB` are the weakest participant-writable
  nodes left**~~ **✅ FIXED 2026-07-31.** Their `$entryId .write` was only
  `auth != null && !closed` — no `uidMembers` room gate, no `$other` sentinel —
  so any authenticated user who knew a session code could write/overwrite an
  answer in ANY room, with undeclared fields, while every other per-room
  participant node was already gated. Both are now **cloned from their own
  tree's `moduleBranched` block** (the M4d node that shipped hardened), in the
  `sessions/` and `orgs/` trees alike, so all three modules are byte-identical
  by construction rather than by careful re-typing.
  **The ordering trap was real and is now covered:** the client writes
  `university` and `bulletKey`, which the old `.validate` did not declare, so
  sealing with `$other:false` before declaring them would have rejected
  legitimate answers — the node would have looked hardened while silently
  breaking every session. A unit test asserts every client-written field is
  declared; the emulator test writes the REAL `addAnswer()` payload, and also
  covers the two paths the branched test never exercised — the `edits`
  append-log and the child-only `text` overwrite that inline editing performs
  (a seal validating only whole entries would pass every other test and still
  break editing). `Verify:` `tests/rules.test.js` "answers/moduleA+B match
  moduleBranched exactly" (both trees) + the emulator's
  "answers/moduleA|moduleB is room-gated and schema-sealed" cases.
- **`$other:{".validate":false}` sentinels** on participant-writable per-room
  nodes (chat/$turnId, score/auto+penalties/$eventId, scoring/awarded/$familyId,
  hypotheses/$entryId, promptReplies+exchangeReplies/$cid, callForHelp,
  uidMembers/$uid, members/$uid, events/$pushId, votes/$voteId/committed, +org
  mirrors) — blocks unknown-key/oversized-field injection. NB: this needs each
  node restructured to NAMED child rules first (a bare `$other` would reject the
  valid keys, which are checked in the parent `.validate`), so it's a focused
  change, not a one-liner.
- ~~**Org parity (remaining)**~~ — **✅ CLOSED 2026-09-04 (PR #384).**
  `poll/$clientId`, `rooms/$roomId/answerReplies` and `rooms/$roomId/observers`
  were the last three `sessions/`-only nodes; they are now mirrored into the org
  tree. **CLONED, not retyped** — each is a pure re-prefix of its session
  original, and a test asserts exactly that, so editing one copy alone fails.
  Proven by INVERSION on the emulator: the new case
  ("poll, answerReplies and observers work in the org tree (G9 parity)") FAILS
  against the rules without the change and passes with it. That is why it leads
  with ALLOW legs — the defect was that nothing could be written, so a
  denial-only test would have passed equally well before and after.
  **This gap was found by hand three times (2026-05-30, 2026-08-05, 2026-09-03)
  and each pass found a DIFFERENT set of nodes**, because nothing linked the two
  trees between audits. It is now enforced rather than re-audited:
  `tests/rule-tree-parity.test.js` requires identical key sets at both levels,
  requires the three clones to stay pure re-prefixes, and fails if any org rule
  still addresses `root.child('sessions')` — a mis-copied prefix would fail
  **OPEN**, which is worse than the missing rule it replaced. A deliberate
  asymmetry must be declared in its `ASYMMETRIC` map with a reason.
  ⚠️ **The mirror faithfully reproduces one weakness:** `answerReplies` has NO
  ownership gate in EITHER tree (`auth != null && !closed`). The emulator case
  asserts a peer CAN write one, so the real contract is recorded rather than
  implied. Hardening belongs to the `$other`-sentinel item and must happen in
  both trees at once — not smuggled into a parity change.
  `Verify:` `node --test tests/rule-tree-parity.test.js`.
- `summary.at` / `created.at` lack an upper timestamp bound (admin-only writes;
  low value); `answers/.../edits/$editId` has no explicit owner check (possible
  collaborative-edit by design — decide + document).

**Round-3 — re-confirmed ACCEPTED (no change):**
- `credentials/$certId` public read: the verification page needs it; the parent
  collection is `.read:false` (no listing) and published cert IDs are now
  crypto-random + persisted (see the "Accepted by design" note above; the
  deterministic-id gap was **FIXED 2026-07-24**), so it's a genuine
  "know-the-ID-to-read-it" feature — not an enumerable oracle, and no longer
  classmate-recomputable for new certs. ⚠️ It exposes **five** fields, not two —
  `nameHash`, `session` (the session CODE), `sessionLabel`, `at`,
  `retentionUntil`. See the corrected note under "Accepted by design" above;
  this bullet carried the same understatement until 2026-08-19.
- `sessions/<code>/adminPasswordHash` `.read:auth!=null`: the value is a
  non-secret random marker (real hash is in the unreadable `adminSecrets/`);
  cross-session read leaks only "this session has admin configured".
- `sharedScenarios` readable by any authed user (opt-in facilitator sharing);
  `ownerName` is capped at 80 chars — confirm the facilitator consent flow
  discloses that a display name may be visible to participants.

**Round-4 review (2026-05-30) — verification pass on R3 + two residuals fixed:**
- The R3 recovery-race fix was confirmed **correct + complete** (uid binding on
  all 4 hash rules, code-gate intact, no forge path; supply-chain, eval removal,
  retentionUntil all re-verified). Two residuals found and fixed:
  - **Initial-set race (MEDIUM)**: the `!data.exists()` branch of the four hash
    rules wasn't uid-bound — an attacker could race the create-flow gap to set
    the admin hash first. Now guarded by `creatorUid == auth.uid` (creatorUid is
    written before the hash). Emulator-tested.
  - **`currentUser` null self-DoS (LOW)** in the reset write sites — guarded.
- Added tests: initial-set creatorUid-bound race; forged-uid (`uid != auth.uid`)
  denial at `_superadminReset`. Remaining open item is the *documented*
  defense-in-depth set above (`$other` sentinels, remaining org parity).
