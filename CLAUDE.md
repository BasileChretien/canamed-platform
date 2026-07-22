# cnm-pp — CaNaMED PBL platform

Franco-Japanese medical-education roleplay/PBL platform (Université de Caen
Normandie × Nagoya University). Static SPA (HTML/CSS/vanilla JS) on Firebase
Hosting + Realtime Database + anonymous Auth + App Check (reCAPTCHA v3).

## Commands
- `npm run test` — unit tests (`node --test tests/*.test.js`).
- `npm run emulator` — Firebase RTDB+Auth emulator (needs Java on PATH).
- `npm run sim:emulator` — headless cross-tab persona sim against the emulator
  (`scripts/sim/sim-with-emulator.js`). Kill stale emulators first if ports
  9000/9099 are taken, or it silently falls back to LocalDB.
- `npx playwright test` — E2E suite (`tests-e2e/`), runs in LOCAL mode
  (hermetic, no real Firebase). Projects: chromium/firefox/webkit + perf +
  a11y + mobile-iphone/ipad/android.

## Layout
- Platform: `docs/Third_session/PBL_platform/` (`index.html`, `script.js`,
  `style.css`, `case-content.js`, `glossary.js`, `i18n.js`, `tour.js`,
  `database.rules.json`, `firebase.json`).
- Tests: `tests/` (unit), `tests-e2e/` (Playwright).

## Standing instructions
- **Per-device tests for every UI change.** When touching the platform UI,
  add Playwright coverage for mobile-iphone, mobile-ipad, mobile-android, and
  desktop viewports. (Established 2026-05-18.)
- E2E runs in LOCAL mode, so it does **not** exercise the Firebase rules. The
  emulator-backed sim is the real validation for `database.rules.json`
  changes — run it locally before merging rules changes.

## Operational reminders — ACTION REQUIRED (cannot be done in code)

These are the Round-3 security follow-ups that require the Firebase / GCP
Console (a human with project access), surfaced 2026-05-20. Items 2, 3, 4, 5
are complete (see each). **⚠️ One action OUTSTANDING (2026-05-30):** item 1 —
switch RTDB App Check from *Enforce* back to *Monitor* in the Console, after
Enforce mode was found to cause intermittent total lockouts (reCAPTCHA
`grecaptcha.execute()` hangs → no App Check token → Enforce blocks the whole
DB). Until that Console toggle is flipped, clients still hit "Checking…" →
"Couldn't reach the session server" whenever reCAPTCHA hiccups. See item 1.

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
   - `Verify:` Firebase Console → App Check → APIs → Realtime Database shows
     *Monitored* (Console-only — no code signal). The `hfPatient` function's
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

**Accepted by design (no change — documented decisions):**
- Full room-subtree readability to any session member: intentional classroom
  visibility (facilitator/observer). Only `moduleA/chat` is per-room read-gated.
- `sharedScenarios` readable by any authenticated user: that is the opt-in
  facilitator sharing feature working as intended.
- `credentials/$certId` public read by exact id (no `auth`): required by the
  unauthenticated certificate-verification page; cert IDs are crypto-random
  high-entropy (no enumeration) and carry only a name **hash** + session label.
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

**Round-3 — TRACKED hardening (defense-in-depth, not active exploits):**
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
- `summary.at` / `created.at` lack an upper timestamp bound (admin-only writes;
  low value); `answers/.../edits/$editId` has no explicit owner check (possible
  collaborative-edit by design — decide + document).

**Round-3 — re-confirmed ACCEPTED (no change):**
- `credentials/$certId` public read: the verification page needs it; the parent
  collection is `.read:false` (no listing) and cert IDs are crypto-random
  high-entropy, so it's a "know-the-ID-to-read-it" feature, not an enumerable
  oracle. Only a name **hash** + session label are exposed.
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
