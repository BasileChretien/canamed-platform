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
   - `Verify:` `gh workflow list` shows all 4 (cleanup, cost-monitor, backup,
     pseudonymise-export) **active**; `.github/workflows/*.yml` have live
     (uncommented) `schedule:` blocks; `gcloud storage ls gs://canamed-pii-archive/`
     lists recent objects under `backups/`, `pseudonymised/`, `linkage/`.

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

4. **Module A LLM-patient pilot (2026-05-28) — ✅ ACTIVATED 2026-05-30.**
   The free-text chat with the scenario's patient (via HF Inference Providers,
   proxied by the `hfPatient` Firebase Cloud Function) is live. All activation steps
   are complete: **(a)** privacy notice updated (HF disclosed as sub-processor;
   in-product `modA.chat.disclosure` banner shown); **(b)** Blaze enabled with
   a $1 budget alert (volumes stay inside the Cloud Functions free tier);
   **(c)** `HF_TOKEN` set in Secret Manager + `functions/.env` with
   `MODA_LLM_ENABLED=true`, `HF_MODEL=mistralai/Mistral-7B-Instruct-v0.3`,
   `HF_MODEL_JA=Qwen/Qwen2.5-7B-Instruct` (lang-aware `_hfModel()` routes JA
   to Qwen); **(d)** `firebase-functions-compat.js` added to
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
   - **App Check on hfPatient — ⚠️ REVERTED to Monitor 2026-06-03
     (`APP_CHECK_ENFORCE=false`, redeployed).** The chat fell back to the stub
     patient on *every* message; a tokenless probe of the live function now
     returns the handler's own `auth required` (not an App-Check rejection),
     confirming Enforce was the gate — same reCAPTCHA-can't-mint-a-token failure
     as the RTDB revert (item 1). The room-membership check (`_verifyMembership`:
     `roomCode`/`roomId` → `uidMembers`) remains the security boundary; re-enable
     (`true` + redeploy) only once reCAPTCHA reliability is understood. History
     below (enforcement was ON 2026-05-28 → 2026-06-03).
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

## Scenario characters (facilitator-authored scenarios)

Design record: [ARCHITECTURE/scenario-characters-design.md](docs/Third_session/PBL_platform/ARCHITECTURE/scenario-characters-design.md).

- **Personas live in the scenario, not in code.** Each scenario declares
  `characters: [{ id, role, name, persona, … }]` (case-content.js `CHARACTERS*`).
  `applyScenario()` publishes them at `window.CURRENT_SCENARIO_CHARACTERS`;
  `modA-llm-prompts.js` builds the system prompt from whichever character is
  being interviewed. Exactly one character per scenario carries `role:"patient"`.
  A scenario declaring none falls back to a generic patient — it must never
  inherit the previous scenario's cast.
- **⚠ `hfPatient` needs `firebase deploy --only functions` to pick this up.**
  `SERVER_GUARD` was generalised from "simulated patient" to "simulated
  character", and the reply-prefix stripper is now driven by the character's
  name. `PROMPT_VERSION` is `modA-llm@2.4`.
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
  grow. **⚠️ SUPERSEDED — the cap is now 316** (`FIRST_PARTY_BYTES_LIMIT_KB`,
  `tests-e2e/perf.spec.js`): it rose 337 → 345 → 348 across the section-model
  work, then FELL to 316 when #285 lazy-split the facilitator dashboard out of
  `script.js`; each step is logged in that file's header. (This paragraph said
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

### 2026-07-23 Phase-4e legal fact-check — FOUR COMPLIANCE GAPS FOUND (all verified)

Drafting the facilitator-as-controller legal pack forced every privacy claim to be
checked against the code. Four are wrong in the CODE, not the prose — the legal text
cannot be made truthful until these are fixed. **Fix these before publishing any
consent/DPA text.**
1. **Research export ignores consent entirely (HIGHEST).** `scripts/pseudonymise-export.js`
   and `scripts/backup-sessions.js` walk the whole `/sessions` tree unfiltered; there is
   no consent flag anywhere (`grep -rn consent scripts/` finds only the simulator). So
   "using your work for research is optional" CANNOT be stated truthfully today. Needs a
   consent field + the exports honouring it.
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

4. **`canamed_stable_id` survives sign-out** holding the signed-out account's uid:
   `accountSignOut()` (script.js ~14342) clears nothing, while the comment at
   script.js ~1300 claims "signOut() removes it". Stale comment, real linkage risk.
Also: certificates are minted on download click (`resolveCertId`) with no prompt, so
"getting a certificate is optional" is likewise not true yet.
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
  certs stay valid (no backfill); new ones are random. The record carries only a
  name **hash** + session label. `Verify:` `grep -n certIdPath
  docs/Third_session/PBL_platform/script.js` > 0; the `certIds/$id` case in
  `tests-e2e/emulator/rules-smoke.spec.js` proves owner-write-once + PEER-DENIED.
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

### ⚠️ THE ROOM GATE IS SELF-ASSERTABLE — every `uidMembers` rule is a speed bump, not a boundary (found 2026-08-03)

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
FIXED IN CODE 2026-08-06 (shell v142); NOT YET CONFIRMED ON THE LIVE SITE.**
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

⚠️ **STATUS — the code is fixed and locally proven; PRODUCTION IS UNVERIFIED
until this is deployed.** The whole defect is a Hosting-rewrite behaviour, and
nothing local can prove Firebase Hosting's response. After the deploy lands,
run the `Verify:` below and only then may this be called fixed in production.
`Verify:` `curl -sI https://canamed-69785.web.app/o/caen-nagoya/theme-init.js | grep -i content-type`
must report `text/javascript` (it reported `text/html` before the fix). Also
`curl -s https://canamed-69785.web.app/sw.js | grep canamed-shell-v` should show
`v142` or later, confirming the shell carrying the fix is actually live.
Regression cover: `tests-e2e/org-session-e2e.spec.js` asserts on the real
network responses at `/o/e2e-org/` — separately for the static shell and for a
LAZY chunk, because the first passing proves nothing about the second.

**Two NEW rule-parity gaps, found by diffing the two rule subtrees. Neither was
observed — LOCAL mode models no rules — so these are static findings:**
- **`rosters` org branch is mis-nested by one level.** The client writes
  `"rosters/" + sPath(uid)` → `rosters/orgs/<slug>/sessions/<code>/<uid>`, but
  the rule sits at `rosters/**sessions**/orgs/$orgSlug/sessions/$sessionId/$uid`.
  `rosters` declares no `orgs` child and no wildcard, so the participant email
  capture **and** the facilitator roster export are fail-closed for every org
  session — silently, because both call sites `.catch()` and continue.
  `tests/facilitator-email-roster.test.js` checks the client path and the rule
  tree separately and so cannot see the mismatch.
- **`audit` is org-only — the DEFAULT tree has no rule for it.**
  `logAdminAction()` writes `sPath("audit")` for both trees, but `audit` is
  declared only under `orgs/$orgSlug/sessions/$sessionId`, and
  `sessions/$sessionId` has no `.write` to cascade and no `$other`. So the
  facilitator audit log has never worked on the default org (best-effort write,
  warning only).

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
- **Org parity (remaining)**: `poll/$clientId`, `rooms/$roomId/answerReplies`,
  `rooms/$roomId/observers` are still `sessions/`-only (fail-closed in org —
  denied, not a hole). Mirror into the org tree before any org go-live.
  ✅ **Re-verified 2026-08-05** by diffing the two rule subtrees mechanically —
  those three, and only those three, are `sessions/`-only. The same diff turned
  up **two gaps in the OTHER direction, both new** (see the 2026-08-05 org
  section below): `audit` exists ONLY under `orgs/`, and `rosters`'s org branch
  is mis-nested. `Verify:` diff the key sets of `rules.sessions.$sessionId` and
  `rules.orgs.$orgSlug.sessions.$sessionId` in `database.rules.json`.
- `summary.at` / `created.at` lack an upper timestamp bound (admin-only writes;
  low value); `answers/.../edits/$editId` has no explicit owner check (possible
  collaborative-edit by design — decide + document).

**Round-3 — re-confirmed ACCEPTED (no change):**
- `credentials/$certId` public read: the verification page needs it; the parent
  collection is `.read:false` (no listing) and published cert IDs are now
  crypto-random + persisted (see the "Accepted by design" note above; the
  deterministic-id gap was **FIXED 2026-07-24**), so it's a genuine
  "know-the-ID-to-read-it" feature — not an enumerable oracle, and no longer
  classmate-recomputable for new certs. Only a name **hash** + session label are
  exposed.
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
