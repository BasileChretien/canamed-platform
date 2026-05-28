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
Console (a human with project access), surfaced 2026-05-20. **Items 1 & 2
were completed 2026-05-23; item 3 (retention cron) is the only one still
outstanding.**

1. **Firebase App Check → Enforce mode (HIGH).** App Check (reCAPTCHA v3) is
   wired client-side but enforcement is set in the Console. Until the
   Realtime Database product is switched from *Monitor* to *Enforce*, a
   stolen anonymous-auth token still reaches the DB without attestation.
   - Console → App Check → app `canamed-69785` → confirm site key matches
     `CANAMED_RECAPTCHA_SITE_KEY` in `firebase-config.js` → click **Enforce**
     next to Realtime Database.
   - ✅ **Done 2026-05-23** — Realtime Database switched from *Monitor* to
     *Enforce*; unattested tokens are now rejected at the DB.

2. **Restrict the API key (HIGH).** The Firebase web API key is necessarily
   public in the served HTML, but it should be locked down:
   - GCP Console → Credentials → the browser key → Application restrictions =
     HTTP referrers (`canamed.web.app`, `*.firebaseapp.com`); API
     restrictions = only the Firebase services actually used.
   - ✅ **Done 2026-05-23** — browser key locked to HTTP referrers and scoped
     to only the Firebase services in use.

3. **Re-enable retention cron schedules (private CANAMED repo).** The 4 PII
   workflows on `BasileChretien/CANAMED` (backup-sessions, cleanup-stale-
   sessions, cost-monitor, pseudonymise-export) have their `schedule:` blocks
   commented out (Actions free-tier cap). `workflow_dispatch:` still works, so
   GDPR/APPI retention + backups are being honoured **manually** — do not let
   the manual cadence slip more than a few days. Uncomment the `schedule:`
   blocks once the monthly Actions minute pool resets or billing is raised.

4. **Module A LLM-patient pilot (2026-05-28) — DORMANT until operator activates.**
   The free-text chat with Mr Lefebvre (via HF Inference Providers, proxied
   by a Firebase Cloud Function) is fully wired in code but stays in stub
   mode (canned answers from `case-content.js`) until **every** step below
   is done. Mid-state activation is intentionally impossible: code refuses
   to call HF without the flag, function returns `{state:"disabled"}` without
   the config flip, browser stays in stub mode without the SDK script tag.
   - **a. Privacy notice update (PIS v2 → v3)** — disclose Hugging Face as a
     sub-processor (US/EU), transient processing, no PII; re-consent banner
     on next session join. The in-product `modA.chat.disclosure` banner is
     already legally adequate (names HF, region, "do not type personal
     info") but the formal PIS doc must match.
   - **b. Enable Blaze** + set a **$1 budget alert** in GCP Console →
     Billing → Budgets & alerts. Workshop volumes stay deep inside the
     Cloud Functions free tier (~300 turns vs 2M/mo allowance) — Blaze is
     required for Cloud Functions, not for any real spend.
   - **c. Set HF token + model + flag:**
     ```bash
     firebase functions:config:set \
       moda.llm="true" \
       hf.token="hf_xxxxxxxxxxxxxxxxxxxxx" \
       hf.model="mistralai/Mistral-7B-Instruct-v0.3" \
       hf.modelJa="Qwen/Qwen2.5-7B-Instruct"
     ```
     The lang-aware `_hfModel()` routes JA traffic to Qwen — Mistral-7B's
     Japanese is too weak for in-character roleplay.
   - **d. Add `firebase-functions-compat.js` to `index.html`** — exactly
     after `firebase-app-check-compat.js`, with the precomputed integrity
     hash. The SDK script is NOT eagerly loaded today because adding an
     unverified script would lower the platform's security floor; the
     operator opts in by editing index.html when ready:
     ```html
     <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"
             integrity="sha384-dl8gTN2pDiuvgHrzW5Zb1btHv3Y2g2RAGe+oZPnyV8yqolnsEg/TBN/fKf97tmac"
             crossorigin="anonymous"></script>
     ```
     Without this tag, the bridge stays in stub mode even with the function
     deployed.
   - **e. Deploy:**
     ```bash
     cd docs/Third_session/PBL_platform/functions && npm install && cd ..
     firebase deploy --only functions,database,hosting
     ```
   - **Panic button:**
     `firebase functions:config:set moda.llm="false" && firebase deploy --only functions`
     returns `{state:"disabled"}` within ~30s; all clients seamlessly fall
     back to the local stub patient.
   - **Pilot gate:** the chat UI itself stays hidden unless a user passes
     `?llm=1` in the URL or sets `localStorage.canamedModALLM=1`. The
     facilitator controls who sees it during the pilot window.

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
  so the existence-based admin-gated rules keep working. Gated to the live
  `sessions/` deployment in `shared` mode (LOCAL keeps read-verify; org-scoped
  sessions deferred — no live org deployments). See `verifyAdminPassword`,
  `useAdminSecrets`, the create/recovery flows, and `tests/rules.test.js` +
  `tests-e2e/emulator/rules-smoke.spec.js` (FINDING-07).
- `pool/$clientId/room` is intentionally writable by any authenticated user
  (admin room-assignment + self-assign); residual room-griefing is accepted
  until a cryptographic admin identity exists.
- Module A `scoring/awarded/<famId>` is client-writable (write-once, bounded
  points, requires uidMembers membership). A teammate with dev tools can
  still pre-award their own room — accepted because this is collaborative
  pedagogy, not assessment. The 2026-05-28 review noted that the per-room
  `uidMembers` gate closes the cross-room griefing path that existed when
  the chat first landed; only same-room self-awarding remains. Server-side
  scoring would require returning `awards: [...]` from `hfPatient` and
  writing them via admin SDK — deferred.
