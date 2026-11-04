# Operational status and reminders

> Moved verbatim from `CLAUDE.md` on 2026-11-04 (its lines 218–1290), so that
> it is read when needed instead of loading into every session. It holds what needs an operator (Console, billing, deploys) and the live state of each service.
> The **STATUS-CLAIM RULE** in `CLAUDE.md` applies to every status label here:
> verify against the code or live system before relaying one, and update the
> label in the same commit as the work that changes it. Where the text says
> "below" or "above", the section may now be in `docs/STATUS.md`,
> `docs/security-follow-ups.md` or `docs/scenario-characters.md`.

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
| ~~`sendQueuedMail`~~ | **REMOVED from source 2026-09-24** — the platform does not send email (Basile sends the `revisit.html` link to students himself). The queue rule, `enqueueMail()` and the nodemailer/sanitize-html deps went with it. A stale copy is still DEPLOYED; delete it with `firebase functions:delete sendQueuedMail --region europe-west1` (a later `firebase deploy --only functions` otherwise stops to ask). Don't reintroduce email without asking. |
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
  ⚠️ **SUPERSEDED — the gate has been ARMED since 2026-09-02**, once backups
  resumed on Scaleway (`CLEANUP_REQUIRE_BACKUP` comes from a repo variable and
  defaults to `"1"`). Re-verified 2026-10-07 from the previous night's run log:
  `Backup gate: OK — last successful backup 0.0d ago`.
  **What a BLOCKED gate stops was wrong until 2026-10-07.** The script's
  comment said "the gate stops SESSION purges only"; the code called
  `process.exit(3)` before BOTH passes, so a stale backup would also have
  stopped the hfPatient metrics pruning — which no backup covers. Latent only:
  every scheduled run since arming reported `OK`. The pass order now lives in
  `scripts/lib/cleanup-passes.js` (`runCleanupPasses`): blocked → skip the
  session pass, still prune metrics, still exit 3 (3 says the purge was
  refused, not that nothing else failed — a blocked run with metrics errors
  also exits 3; read the Summary line).
  **Why no test caught it:** the ordering lived in a `main()` nothing could
  load, so it had text checks only, and one of them REQUIRED `process.exit(3)`
  within 600 chars of `if (gate.block)` — it pinned the bug's shape, was green
  on the defect and would have gone red on the fix. Its sibling ("the gate runs
  BEFORE any deletion") compared two `indexOf()` positions and would have
  passed VACUOUSLY on the fixed script (`-1 <` anything). The real script is
  now RUN in a child process with firebase-admin swapped for an in-memory
  database (`tests/fixtures/fake-firebase-admin-preload.js`); assert on the
  complete write list, not on the text — a respelled early return
  (`const { block } = gate; if (block) return;`) sails through every text
  check and fails there.
  `Verify:` `node --test tests/cleanup-passes.test.js`.

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
   ⚠️ **Step 3 is ALREADY DONE and no longer depends on Blaze** (checked
   2026-10-07): both schedules have been live since 2026-09-01, writing to
   Scaleway rather than GCS (#363), and the gate has been armed since
   2026-09-02. Restoring Blaze is now steps 1–2 only; do not "re-enable" either.

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

### Anonymous-account retention (issue #347) — SCHEDULED + ARMED with PIS v12 (2026-10); confirm a live run before quoting it

`signInAnonymously()` gives every visitor an Auth account before any consent
surface, and nothing ever removed one: retention was indefinite, by absence of
any mechanism (auto-delete is an Identity Platform feature this project lacks).
The job is `.github/workflows/cleanup-anonymous-accounts.yml` →
`scripts/cleanup-anonymous-accounts.js`. It runs nightly at 04:37 UTC and
**DELETES on schedule**; a manual dispatch is a dry run unless `confirm` is
ticked. It was scheduled in the same change that issued PIS v12, after one dry
run against production on 2026-10-07 (run 37576812113, nothing deleted): 338
accounts — 336 anonymous, 2 signed-in — of which 185 idle past the window; the
mask honoured; every anonymous account dated; 119 database paths would go.

- **What it removes.** An anonymous account idle ≥ 90 days that no LIVE session
  names (member or creator) and no allowlist names (`facilitatorGate/allow`,
  `moderators`), together with its `users/<uid>` node. Records go first, the
  account second; a failed write means no account is deleted that run.
  The live-session check is what makes "90 days" honest: a session closed on
  day 89 lives 30 more, so the real bound is ~120 days after last use.
- **What it deliberately does NOT remove.** `scenarios/<uid>`: the client only
  saves a scenario for a signed-in user, so one under an "anonymous" uid is
  treated as evidence AGAINST anonymity and spares the account.
  `reports/scenarios/<shareId>/<uid>`: a moderation report may concern content
  that is still published and unreviewed — deleting evidence on a timer is a
  product decision nobody has taken. Both stay under DPA Annex VI G8.
- **Two older gaps closed in the same pass.** (a) `users/<uid>/history` written
  for every anonymous joiner before #348 is removed for accounts that still
  exist. (b) The proxy's rate-limit counters (`rateLimits/{uid,session}/…`) are
  swept once past the TTL the proxy asks for — **nothing swept them before**,
  although `proxy/src/stores.js` said `cleanup-stale-sessions.js` did.
- **Positive evidence at every step; anything that cannot be shown is kept.**
  The first version failed OPEN twice and an independent review caught both
  before merge — do not relax these without re-reading why:
  1. *anonymous* = the account's own record lists no provider, AND the listing
     as a whole contains signed-in accounts (else the provider field is missing
     and every account looks anonymous → run refused), AND the database holds
     no `profile` / `scenarios` for that uid;
  2. *idle* = a READABLE last-refresh date that is old. A date that is absent
     or present-but-garbled is "unknown", never "old" — a returning
     participant's sign-in date never moves, so the refresh date is the only
     sign they are still here;
  3. *still so at the last moment* = every candidate is fetched again
     (`accounts:lookup`) immediately before the writes, and dropped if it
     signed in or came back since the listing.

  Orphans (a uid with records and no account) are counted and left alone unless
  `sweep_orphans` is ticked, behind a tripwire; record keys are read BEFORE the
  account listing so a new sign-up can never look like one.
- **Two phases, and neither can stop the other.** The counter sweep runs FIRST
  and is written before the account listing is requested, because the notice
  promises the counters gone in about three days and that must not hang on the
  account half (which can refuse). Participants can write under their own
  `rateLimits` node, so it is read per id, shallow, and a failure is counted
  (exit 1) rather than thrown. Exit 3 therefore means "the ACCOUNT half
  refused", not "nothing happened" — the log still carries a `Rate limits:` line.
  **And the sweep has a time budget, for its reads AND its writes:** it is one
  read per counter id and one delete path per stale bucket, and a participant
  can mint both — ids, and any number of bucket NAMES under their own (a name
  the sweep does not recognise counts as stale). Unbounded, either outlasts the
  job's 15 minutes: the run is cancelled, every night, and a cancelled run
  mails nobody. So the whole sweep gets 5 minutes (`SWEEP_BUDGET_MS`; reads may
  use the first 60%): no read and no update starts after its share, ids with
  few stale buckets are written first so that it is the flood that waits, what
  was left is counted (`OUT OF TIME, N counter(s) not read` / `N stale
  bucket(s) not deleted`, exit 1), and the next day starts elsewhere in the
  list. The first version bounded the reads only; a review showed one id with
  a million bucket names walking straight past it. What is NOT bounded the
  same way: the account half reads two nodes per live session.
- **The account half refuses if the listing has NO signed-in account** (two
  exist today). Deliberate, but if both ever go, every nightly run exits 3 and
  no anonymous account is removed until someone intervenes.
- **`CONSENT_NOTICE_VERSION` (script.js) is the TENTH notice-version surface.**
  It is stamped on every consent record and decides whether a resuming
  participant is asked again. It sat at `PIS-v3-2026-07` from v3 to v11, so
  consent records from July–October 2026 all say v3 and nobody resuming was
  re-asked. `tests/pis-version-lockstep.test.js` now ties it to the notice —
  bump it with every PIS version.
- **No e-mail address reaches the runner.** The Admin SDK's `listUsers()`
  returns whole records, so the listing goes over REST with a `fields` mask
  and then VERIFIES it: one unrequested key aborts the run. The check can only
  detect a transfer, not undo it, so the listing starts with a ONE-account
  canary — an ignored mask exposes one record, not a thousand.
- ⚠️ **THE CRON, THE ARMED `ANON_CONFIRM` AND THE NOTICE ARE ONE THING.** A
  nightly run sends account identifiers and session member uids to a US runner;
  `privacy.html` says so, and states the period, since PIS v12 (§4, §6–8, §16,
  §17, EN/FR/JA). Comment out the cron or flip the schedule back to a dry run
  and §8 promises a deletion nothing performs; change the window and it states
  the wrong number. `tests/anonymous-identifier-notice.test.js` holds the three
  together and fails on any one moving alone.
- ⚠️ **STILL OPEN, and not code:** the lawful basis for an identifier created
  before any consent (notice §3 rests on consent) — DPA Annex VI G13, for the
  controller / DPO; how long an unactioned moderation report is kept; and the
  operator's acceptance of the GitHub transfer (R9) was given for narrower
  content than this job sends.
- ⚠️ **NOTHING MONITORS THAT IT RUNS (DPA G11).** A failed run mails the repo
  owner; a workflow that never starts — disabled, secret revoked — does not,
  and §8 of the notice would then be false with no signal. The `Verify:` below
  is the only check and it is manual.
- **Two emulator divergences, both measured.** The Auth emulator ignores
  `fields` (so it serves as the positive control for the mask check), and it
  answers a deleted account's refresh with `INVALID_REFRESH_TOKEN` where Google
  documents `USER_NOT_FOUND`. Recovery is therefore proven for the NEXT PAGE
  LOAD only (the SDK clears a stored user whose reload fails); a tab left open
  across the deletion is not reachable on the emulator.

`Verify:` `gh run list --workflow=cleanup-anonymous-accounts.yml --limit 3`
shows `schedule` runs succeeding, and the newest one's log has an `Auth:` line.
That line is printed only by a LIVE run — a log that ends at `Paths: … would
delete` was a dry run, and a schedule producing those means the job has been
disarmed while the notice still promises deletion. Then
`curl -s https://canamed-69785.web.app/privacy.html | grep -c "PIS v12"` > 0.

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

### Erasure requests that outlive their session (2026-10-07) — ⚠️ THE STRICT RULE IS OFF UNTIL AN OPERATOR RUNS THE BACKFILL

A participant records withdrawal plus an erasure request at
`withdrawals/<code>/<uid>` (org: `withdrawals/orgs/<slug>/<code>/<uid>`). Four
things were wrong once the session was purged; all four are fixed in code. The
full account, with what each fix does NOT close, is DPA Annex VI G12 item 2 —
read that before describing any of this as done.

- **The purge leaves a marker**, `purgedSessions/<code>` = time of the purge
  (Admin-only node; a code and a date) — only for a session that had a
  `created` or `closed` timestamp. It is the only thing in the database that
  tells a purged session from a code that never was one.
- **ONCE THE BACKFILL HAS RUN, the rule accepts a withdrawal only if the
  session's `created` record exists, or the code has a marker**, in both
  trees. That requirement sits behind a switch,
  `ops/purgedMarkersBackfilledAt` (`PURGED_MARKERS_BACKFILLED_PATH` in
  `scripts/lib/session-trees.js`), which a confirmed run of
  `scripts/backfill-purged-markers.js` writes in the same update as the
  markers and nothing else writes. **Absent — production's state after the
  merge — a withdrawal is accepted for any code, as before, and the spoofable
  monitor is still spoofable.** `ops/` has no entry in the rules, so no client
  can read or set it; a rule that opened any of `ops/` would hand over the
  switch. Whatever the switch says, `at` must be within
  24 h behind / 5 s ahead of the server clock — a window that sits on the
  RECORD (`$uid` `.validate`), so a write to one field is judged against it
  too. Before, any signed-in visitor could file a request for any code, and
  one write with `at: 1` turned the daily monitor red on its next run. (The old
  rule also allowed NO clock lead, `at <= now`, alone in the file: a device a
  little fast was refused its withdrawal. A unit test fails if the text
  `.val() <= now` appears anywhere in the rules with no tolerance after it —
  that is ALL it checks. It does not see a timestamp with no upper bound at
  all — `created/at` and `closed/at` had none when this was written (#438
  adds one); an earlier wording here claimed it covered "any timestamp
  rule".)
- **The purge keeps an erasure request nobody has answered**, with no time
  limit. It used to delete the whole branch with the session: measured on the
  real schedule (purge 03:17, monitor 04:11), a request made from about the
  session's last day onward never turned the monitor red at all.
- **The nightly job sweeps answered and request-less records of purged
  sessions** — a third pass of `runCleanupPasses()`, which a blocked backup
  gate does not stop. Only under a marker, never because a session is merely
  absent from a listing (a `research:false` record under a live session is
  what keeps that participant out of the export).
- **`scripts/erase-participant.js` answers a request for a purged session**:
  `--uid` required, and it refuses to write without `--research-copy-checked`.
  It writes nothing for a session with no marker (exit 3); `--dismiss` removes
  such a request, or one under a live session the person left nothing in.
  **The marker decides, whatever is in the database**: under a marker a
  request is answered and never dismissed, even when the code is in use again.
  Procedure: `ARCHITECTURE/OPERATOR_POLICY.md` §4.1.
- **`--reason` is a closed list** (`ERASURE_REASONS` in `scripts/lib/suppression.js`):
  it is written into `erasures/`, which is never deleted and which two daily
  jobs read in full, so it must never be something an operator typed — that
  could be a name. Older records are not rewritten; the monitor prints how
  many carry typed text. Do not add a free-text field to that ledger.

⚠️ **ACTION REQUIRED, not done, cannot be done in code — and until it is done
the rule above is OFF.** Sessions purged before this change have no marker;
they are rebuilt from the nightly snapshots, and the same confirmed run turns
the strict rule on:

```bash
node scripts/backfill-purged-markers.js --file <snapshot.json> [--file …]
BACKFILL_CONFIRM=1 node scripts/backfill-purged-markers.js --file <snapshot.json>
```

- **Local only, by hand; there is no workflow, on purpose** — the snapshots
  are identified data and must not reach a hosted runner. It needs every
  `backups/canamed-backup-YYYY-MM-DD.json` the Scaleway bucket still holds,
  and `GOOGLE_APPLICATION_CREDENTIALS_JSON` (default credentials alone stop
  it: the session listing wants a credential object).
- **Confirming it is a decision about participants, and nobody has taken it
  yet.** A session purged before the oldest snapshot given gets no marker —
  and the archive holds 90 days at most, less while it is younger (it moved
  to Scaleway on 2026-09-01; the dry run prints the oldest date) — and from then on
  its participants are refused for good ("please try again", which cannot
  work). The dry run says so and names the oldest snapshot. Do not record
  that as signed off until an operator has confirmed a run.
- **Nothing breaks while it has not been run**, which is why this change
  could merge without it. What does not work until then:
  `erase-participant.js --dismiss` refuses (it reads the switch), and a
  request for a session purged before the markers existed can be neither
  answered nor dismissed.
- Idempotent: it never overwrites a marker or the switch's date. It refuses
  (exit 2, nothing written) a file that is not the backup's — a key that is
  not a session location, or a `sessionCount` that does not match — and a
  switch that exists but is not a number.
- **Every sentence that states the session-or-marker rule must say it waits
  for the backfill.** When the switch was added, four sentences in the legal
  drafts and five comments went on stating the rule as in force; three of the
  four sat ABOVE the paragraph that said otherwise, which scoped itself to
  "nothing below". `tests/withdrawal-switch-docs.test.js` now fails on such a
  statement in `legal/dpa-draft.md` or `legal/record-of-processing.md`. It
  knows a handful of phrasings, not the meaning: write new ones with the
  switch in them.

`Verify:` not checkable from the repo. An operator's dry run printing
`Strict withdrawal rule: already ON` is the evidence that it was run; a fresh
database (and the emulator suite's default state) has it off.

**What the independent review of this change found, each of which would have
shipped — the lessons are general:**

1. **"Exists" is not "was created".** The first rule tested
   `sessions/<code>.exists()`. `sessions/<any code>/members/<own uid>` is
   writable by any signed-in visitor, so one extra write made any code "exist"
   — the same objection that had been used, in the same paragraph, to reject
   `users/<uid>/history/<code>` as the evidence. **Before a rule leans on a
   node, list who can write anything underneath it.**
2. **And `created` is only as strong as the facilitator gate.** Creating a
   session is open to any signed-in visitor while `facilitatorGate/enforce` is
   off. So this is NOT a boundary against a visitor who creates a session and
   files a request in it; it removes arbitrary codes, back-dating, and requests
   nothing can close. Do not describe it as more.
3. **`orgs` is a reserved key.** Outside `sessions/`, every per-session tree
   keeps organisation sessions under a literal `orgs` child, so a default-tree
   session CODED `orgs` has the roots of every organisation's data as its
   paths — and the purge deletes a session's paths. One anonymous write under
   `sessions/orgs/` did that (latent: no org sessions in production; older than
   this change). Now: a `.validate` on the session node in both trees, the
   enumerators skip the key, `locationFor()` throws. **A new per-session tree
   with an `orgs/` branch inherits this for free only because of those three.**
4. **`--uid` without `--session` is the person, everywhere** — every live
   session and, when it finds them in one, the whole `users/<uid>` record. The
   first operator text gave that command for answering one request. The tool
   prints `SCOPE` and rejects unknown arguments (a mistyped `--session` used
   to be ignored).
5. **A ledger that is never deleted needs to say WHICH request a record
   answers.** "Answered" first matched a record of any age, so a second
   request after an erasure was closed on arrival and deleted by the purge.
   The fix compared dates — and that compared the operator's clock with the
   participant's device, which the rule accepts a day slow, so a second
   request could still read as answered. **Never order two events by
   timestamps from two machines.** The record now carries the `at` of the
   request it answers (`requestAt`) and is matched on that.
6. **A `.validate` on a field does not run when its sibling is written.** The
   date window sat on `at`; writing `erasure: true` alone onto a 40-day-old
   bare withdrawal produced a request that was overdue the moment it became
   visible. A constraint that must hold for the record belongs on the record.
   (`tests-e2e/emulator/pool-stale-at-rules.spec.js` had already recorded the
   mechanism on another node.)
7. **A purged code can be occupied again, by anyone.** The tool looked for the
   marker only when the session was absent; one membership row under the code
   made the request unanswerable and `--dismiss` available, and the monitor
   advised it. Decide on the durable fact (the Admin-only marker), never on
   "is something there now".
8. **Two jobs that must agree need one definition, not two copies.** The purge
   marks only a session with a timestamp; the backfill marked every key in a
   snapshot, and so handed a visitor's made-up code the marker the purge had
   refused it. Both now call `hadSessionTimestamp` / `bodyWasSession`
   (`scripts/lib/session-trees.js`). Every backfill fixture had used an empty
   body, so the tests had the mistake built in — **a fixture simpler than the
   data it stands for can only confirm the simple case.**
9. **…and the same definition has to be applied to BOTH sides of a
   comparison** (review round 2). The backfill tested the snapshot's body and
   took "still in the database" from the key listing — so item 7 was back for
   every session purged before the deploy: a visitor's row under the code, no
   marker, `--dismiss`. It now reads `created/at`, `closed/at` and
   `creatorUid` of what is there and asks whether it is THAT session
   (`isSameSession`). The fixture had the mistake built in again: the "still
   here" session was in the snapshot with a different `created` than in the
   database. **Before the backfill has run once, "no purge marker" does not
   mean "never purged"** — the tool says the first, and nothing under a live
   code should be dismissed until then.
10. **A validation added to a writer is a new way for the reader's input to
    kill it** (review round 2, a regression from item 5's fix).
    `buildRecord()` demanded a whole, non-negative `requestAt`; the rule asks
    a request's `at` only to be a number, so `at: Date.now() + 0.5` made a
    request the tool died on — unanswerable, undismissable, and a `--uid` run
    aborted before erasing the person's other sessions. **When a value is
    copied from data somebody else may write, the copier must accept
    everything the rules do** — and everything they did before they were
    tightened. The unit test pinned the throw; what was missing was a test
    that RUNS THE TOOL on a request the rules accept.

**Listing sessions over REST: an array is a listing too.** `shallowKeysOf()`
threw on anything but an object, and RTDB renders a node keyed 0, 1, 2… as an
array. A session code is chosen by whoever writes under it, so if a
`?shallow=true` listing comes back that way, one visitor write stopped the
purge, the monitor and the backfill. Both shapes are now read, and the
emulator suite prints which one the EMULATOR returns ("a listing of integer
keys"). **Measured on the emulator, 2026-10-07: a shallow listing of integer
keys is an OBJECT** (one key, three keys, and with a gap), while the same node
read whole is an array — so on the emulator the old reader would not have
thrown. Production's REST API was not asked; the array branch stays as cover
for it.

⚠️ **Still open, and not this change's to settle** (all in the DPA paragraph):
the marker's lifetime is five years by a constant
(`CLEANUP_RETENTION_PURGED_MARKER_DAYS`) the Controller has not confirmed; "You
are excluded from the research dataset" is made true for a purged session by
the operator's `--research-copy-checked` and by nothing the tool can verify; a
certificate published for a purged session cannot be found from a uid;
`privacy.html` §6 lists what the daily jobs read of withdrawal and erasure
records since PIS v12 (#429), but not the two yes/no fields a record for a
purged session now holds, nor the five-year purge marker; for a session still in
the database the tool deletes the whole `users/<uid>` even with `--session`;
**a session purged before the oldest snapshot the backfill is given can never
get a marker, so once the strict rule is on its participants are refused in
the product for good and told to "try again"** — a decision that is taken
when an operator confirms the backfill, and that nobody has taken yet;
a device clock more than 5 s fast was refused its withdrawal until the client
began sending the server's time (2026-10-08 — the `created.at` entry under
"Round-3 — TRACKED hardening"; a browser on an older shell still is); and
**a session whose
`created/at` or `closed/at` was dated in the future was never purged** — found
by running the purge, and corrected by a SEPARATE change (#438:
`scripts/lib/session-retention.js` plus a bound on both dates in the rules).
If that file is not in this checkout, it is still open. Nothing here depends
on which: the tests that put a future-dated `created` under a purged code
assert only what holds either way.

**Three traps met on the way:**
1. **The ops scripts can be RUN in a test.** `tests/fixtures/run-ops-script.js`
   starts a real script in a child process against an in-memory database whose
   writes are applied and whose clock is fixed, so one job's output can be fed
   to the next (purge, then monitor; tool, then the real restore). The fake
   keeps the event loop alive like a real connection, so a path that forgets
   `process.exit()` times out — that is how `erase-participant.js` was found to
   hang after every successful live erasure, and running the real
   `restore-sessions.js` is how it was found to restore an organisation's
   session to `orgs/orgs/sessions/…`.
2. **Do not type a backslash into a Bash heredoc that writes JavaScript.** A
   `\b` meant for a regex arrived as a backspace byte in a test file, and a
   `\n` inside a string literal as a real line break. Use the Write/Edit tools
   for anything containing a backslash, and scan changed files for control
   bytes before committing.
3. **The emulator rules suite cannot be run by two sessions at once.**
   `run-rules-e2e.js` frees whatever it saw on :9000/:9099 during its own run,
   which under overlap is the OTHER session's emulator. If the hub falls back
   from port 4400 to 4401, another emulator is alive: stop, do not retry.

`Verify:` `node --test tests/purged-session-marker.test.js
tests/withdrawal-retention.test.js tests/erase-purged-session.test.js
tests/reserved-session-key.test.js tests/withdrawal.test.js
tests/data-rights.test.js tests/cleanup-passes.test.js`, and on the emulator
`npm run test:e2e:rules -- -g "session"`. Whether the backfill has been run is
NOT checkable from the repo: an operator's dry run printing `to mark: 0` and
`Strict withdrawal rule: already ON` is the evidence.

**In the emulator suite the switch is GLOBAL state**, and every spec shares one
database. A test that leaves `ops/purgedMarkersBackfilledAt` set turns the
strict rule on for every test after it — including the account-dialog case
that withdraws from a purged session with no marker, which is production's
state. Only two blocks in `rules-smoke.spec.js` touch it; each puts it back in
a hook or a `finally`. A new test that needs the strict rule goes inside the
`describe` that sets it.

