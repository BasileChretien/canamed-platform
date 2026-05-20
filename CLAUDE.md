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
Console (a human with project access), surfaced 2026-05-20:

1. **Firebase App Check → Enforce mode (HIGH).** App Check (reCAPTCHA v3) is
   wired client-side but enforcement is set in the Console. Until the
   Realtime Database product is switched from *Monitor* to *Enforce*, a
   stolen anonymous-auth token still reaches the DB without attestation.
   - Console → App Check → app `canamed-69785` → confirm site key matches
     `CANAMED_RECAPTCHA_SITE_KEY` in `firebase-config.js` → click **Enforce**
     next to Realtime Database. Record the date here once done.

2. **Restrict the API key (HIGH).** The Firebase web API key is necessarily
   public in the served HTML, but it should be locked down:
   - GCP Console → Credentials → the browser key → Application restrictions =
     HTTP referrers (`canamed.web.app`, `*.firebaseapp.com`); API
     restrictions = only the Firebase services actually used.

3. **Re-enable retention cron schedules (private CANAMED repo).** The 4 PII
   workflows on `BasileChretien/CANAMED` (backup-sessions, cleanup-stale-
   sessions, cost-monitor, pseudonymise-export) have their `schedule:` blocks
   commented out (Actions free-tier cap). `workflow_dispatch:` still works, so
   GDPR/APPI retention + backups are being honoured **manually** — do not let
   the manual cadence slip more than a few days. Uncomment the `schedule:`
   blocks once the monthly Actions minute pool resets or billing is raised.

## Known security follow-ups (code, tracked)
- `votes/ballots` is keyed by `stableId`, not `clientId`, so the clientMapping
  ownership guard (FINDING-01) does not cover it — needs a parallel stableId
  binding.
- Server-side admin-password verification (FINDING-07): `adminPasswordHash`
  is readable by any authenticated user (hash oracle). The architecturally
  correct fix is a Cloud Function that compares server-side and returns a
  short-lived token — needs the Blaze plan.
- `pool/$clientId/room` is intentionally writable by any authenticated user
  (admin room-assignment + self-assign); residual room-griefing is accepted
  until a cryptographic admin identity exists.
