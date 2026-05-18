# CaNaMED Session 3 PBL Platform — Architecture

**Last Updated:** 2026-05-16

The CaNaMED platform is a collaborative medical-education hub for multi-partner workshops. One URL, one session code, runs a whole session across 2+ partner universities. Participants join with a code, are auto-balanced into Franco-Japanese mixed rooms, and work through a structured 4-stage clinical case in real time, with facilitators monitoring and advancing progress via a dashboard.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (Vanilla JS, no build step)                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  index.html (106 KB)                                               │
│  ├── Firebase SDK (initialised by script.js)                       │
│  ├── script.js (4913 lines: UI state machine, lifecycle)           │
│  ├── lib.js (pure functions: crypto, validation, URL safety)       │
│  ├── localdb.js (localStorage-backed Firebase mock for testing)    │
│  ├── i18n.js (en/fr/ja translations + live-switch)                │
│  ├── telemetry.js (session event tracking)                        │
│  ├── case-content.js (clinical case definitions + scoring rules)  │
│  ├── platform-config.js (deployment config: cohorts, branding)    │
│  ├── firebase-config.js (Firebase credentials & App Check key)    │
│  └── qrcode.js (QR code generation for join URLs)                 │
│                                                                     │
│  Flows:                                                             │
│  - Splash: code entry → Google signin (optional) → profile setup  │
│  - Participant: enter pool → auto-assigned room → stage-gated     │
│  - Admin: create session → dashboard → per-room control           │
│  - Super-admin: set session password (one-time per session)       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ (Firebase API)
┌─────────────────────────────────────────────────────────────────────┐
│ Backend: Firebase Realtime Database (or LocalDB in test mode)       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Authentication:                                                    │
│  ├── Anonymous auth (initial, no login required)                   │
│  ├── Google auth (optional, signs-in user)                        │
│  └── App Check (reCAPTCHA v3) prevents automated abuse            │
│                                                                     │
│  Data Model (Firebase RTDB paths):                                 │
│  ├── users/{uid}/profile → name, university, year, english        │
│  ├── users/{uid}/history → joined sessions (code, timestamp)      │
│  └── sessions/{sessionCode}/                                      │
│      ├── adminPasswordHash → PBKDF2v2 hash (immutable)            │
│      ├── created, started, closed → lifecycle (immutable)         │
│      ├── workshopLabel, scenarioId, scenarioCustomJson            │
│      ├── teamsLink, questionnaireLink → admin-set links           │
│      ├── pool/{clientId} → waiting room (name, univ, year, eng)   │
│      ├── rooms/{roomName}/                                        │
│      │   ├── stage → 0..3 (admin-only write)                      │
│      │   ├── stageAt → timestamp of current stage                 │
│      │   ├── teamName → group's chosen name                       │
│      │   ├── callForHelp → {by, at, msg, ack} facilitator alert  │
│      │   ├── presence/{clientId} → active participants            │
│      │   ├── typing/{clientId} → module key being edited          │
│      │   ├── moduleA/revealed/{itemId} → {by, at} findings log   │
│      │   ├── answers/{moduleA,B}/{entryId} → text, by, at        │
│      │   ├── votes/{decisionId}/ballots/{clientId} → choice      │
│      │   ├── votes/{decisionId}/committed → locked-in answer      │
│      │   └── score/                                               │
│      │       ├── auto/{eventId} → {points, at}                    │
│      │       ├── penalties/{eventId} → {points, at}               │
│      │       └── manual/{pushId} → {points, tag, by, at}          │
│      └── roomCount, teamsLink (immutable after start)             │
│                                                                     │
│  Database Rules: database.rules.json                               │
│  ├── Authenticates all reads/writes (auth != null)                │
│  ├── Immutabilizes: password, created, closed, scenario at setup  │
│  ├── Restricts stage writes to authenticated admins               │
│  ├── Validates all writes (length, type, format)                  │
│  └── Bans closed sessions (no writes after closeSession())        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Flows

### 1. Participant Join and Room Assignment

1. User opens URL, lands on splash (code input + Google signin link)
2. Enters session code (e.g. `ABC-DEF`), name, university, year, English level
3. joinParticipant() writes to `sessions/{code}/pool/{clientId}`
4. User sits in waiting room, watching live participant count
5. Admin chooses room count and presses "Start session"
6. assignRooms() scans pool, balanced by: Franco-Japanese mix (priority), year spread, English spread
7. Each person is assigned a room name (`room: "Room A"`, etc.) via pool write
8. User exits waiting room, enters their assigned room view

**Key invariant:** Participants cannot pick rooms; the algorithm prevents demographic cliff-edges in discussions.

### 2. Stage Progression (Per-Room)

Each room follows a 4-stage sequence. Only facilitators advance it.

| Stage | Content | Participant Action |
|-------|---------|-------------------|
| 0 | Welcome + video | Watch & read |
| 1 | Module A (Chronic Pain case) | Reveal findings, vote, answer Qs |
| 2 | Module B (Breaking Bad News roleplay) | Role-play on Teams, answer Qs |
| 3 | Wrap-up | Debrief, questionnaire links |

Participant can press **Back** to re-read prior stages; **Next** returns to room's current stage. Admin can jump rooms forward or backward individually, or **Advance all rooms** at once.

### 3. Admin Dashboard and Facilitator Monitoring

- Admin creates session → sets password (via super-admin if first time)
- Dashboard shows all rooms at once: stage, head-count, call alerts
- Click **Open room** → see exact participant view + side panel of all rooms
- From room view: advance/back that room's stage, switch to another room, see live findings/answers
- **Call a facilitator** button on participant screen → red badge on admin's room card
- Opening a room auto-clears its call alert

### 4. Scoring (Cooperative, Per-Cohort)

Three ways to earn points:
- **Milestones**: revealing findings in the right order (+points when unlocked)
- **Concept families**: keywords in written answers matched against SCORING[family].keywords
- **Facilitator points**: admin awards manually (max 50 per entry)

Two ways to lose points:
- **Penalties**: wrong clinical choice (opioid before assessment, intimate exam unjustified, unnecessary scans)
- Each penalty triggers a calm amber toast explaining why

Room's total never drops below zero. All rooms' points sum into their cohort's score.

## File Index

| File | Role | ~Lines | What It Does |
|------|------|--------|-------------|
| **index.html** | Entry point | 3,000 | DOM structure, script order, CSP + security headers in meta, i18n annotations |
| **script.js** | Main engine | 4,913 | UI state machine: splash, lobby, room view, admin dashboard, scoring, lifecycle |
| **lib.js** | Pure utilities | ~400 | safeHref, sanitizeCode, sanitizeResume, password hashing (PBKDF2), session-code generation, score math, i18n helpers |
| **localdb.js** | Test backend | ~150 | localStorage-backed Firebase mock (no external deps), syncs across browser tabs |
| **i18n.js** | Translations | ~900 | en/fr/ja strings, live language switch (localStorage), renderer for [data-i18n] nodes |
| **telemetry.js** | Event tracking | ~500 | Session timestamps, participant joins, stage changes, score events — JSON export for research |
| **case-content.js** | Clinical content | ~2,500 | CASE (history/exam/labs structure), SCORING (concept families), PENALTIES (wrong-choice rules), DECISIONS (voting Qs), SCENARIOS registry |
| **platform-config.js** | Deployment config | ~50 | CANAMED_CONFIG: workshop name, cohort definitions (Caen/Nagoya or custom) |
| **firebase-config.js** | Infrastructure config | ~90 | CANAMED_FIREBASE (credentials), CANAMED_RECAPTCHA_SITE_KEY, CANAMED_PERF_MONITORING flag |
| **qrcode.js** | QR code gen | ~900 | Generates QR code SVG for join URL (displayed in admin console) |
| **database.rules.json** | RTDB security | ~190 | Firebase security rules: auth checks, immutability constraints, validation regexes |
| **firebase.json** | Hosting config | ~40 | CSP headers, HSTS, X-Frame-Options, caching policy, database rules path |
| **RUNBOOK.md** | Operations | ~400 | Day-to-day: pre-workshop checklist, session cleanup, credential rotation, failure modes |

## Key Invariants

1. **Session code is the unit of isolation.** All data lives under `sessions/{code}/`. Different sessions are 100% isolated.

2. **Admin password is immutable once set.** Database rule `.write: "auth != null && !data.exists()"` prevents admins from changing it mid-session. (Super-admin can set it once via the super-admin key before anyone joins.)

3. **Stage is admin-only writable.** Only someone who knows the session password can call `db.ref("sessions/{code}/rooms/{room}/stage").set(newStage)`.

4. **Closed sessions are read-only.** Database rule `.write: "... && !root.child('sessions').child($sessionId).child('closed').exists()"` bans all writes once a session is closed. closeSession() is final.

5. **Presence is participant-scoped.** presence/{clientId} is written by that client; onDisconnect().remove() cleans up on page-close, mirroring Firebase semantics.

6. **Answers are immutable once written.** answers/{moduleA,B}/{entryId} has no "edit after write" rule—only delete-and-re-add. (Code allows editing for UX; database just sees delete + insert.)

## Authentication & Authorization

- **Anonymous auth (required):** Every participant auto-authenticates anonymously on page load (no password, no email). Enables database reads/writes tied to that UID.
- **Google auth (optional):** Sign-in link on splash. First sign-in routes to profile setup; subsequent sign-ins auto-fill the join form.
- **App Check (reCAPTCHA v3):** Verifies every request is from a real browser on THIS domain. Free tier (10k assessments/month). Prevents automated attacks even if someone acquires an anonymous-auth token.
- **Super-admin key:** One hardcoded key in firebase-config.js. Holder can set session passwords without knowing the password (used at facilitator setup only, not by participants).

## i18n & Localization

- **Supported languages:** English (canonical), French, Japanese
- **Case content:** CASE/SCORING/PENALTIES/DECISIONS fields wrap user-facing strings as `{ en: "...", fr: "...", ja: "..." }` (legacy plain strings still supported)
- **UI strings:** i18n.js loads from `window.TRANSLATIONS[lang]` (defined inline in i18n.js); [data-i18n] nodes are rendered on page load and when user switches language
- **Live switch:** User picks language in splash; choice saved to localStorage; all [data-i18n] nodes re-rendered instantly

## Where to Start

### I want to understand the participant join flow
1. Read `script.js` lines ~980–1099: `joinParticipant()` and `_joinParticipantAfterAuth()`
2. Read `lib.js` lines ~70–94: `sanitizeResume()` and `sanitizeCode()`
3. Read `database.rules.json` lines ~75–86: pool validation schema

### I want to add a new stage or case content
1. Edit `case-content.js`: add CASE item, update DECISIONS/SCORING/PENALTIES
2. Bump STAGE_COUNT in `script.js` if needed (default 4: Welcome, Module A, Module B, Wrap-up)
3. Add i18n strings to `i18n.js` for new UI text
4. Test locally: `npm run test:local` (starts LocalDB mode, no Firebase)

### I want to change the scoring rules
1. Edit SCORING, PENALTIES, DECISIONS in `case-content.js`
2. Edit SCORE_AUTO, SCORE_MICRO_BULLETS, familyHits() in `script.js`
3. Read `telemetry.js` scoreEventMeta() to understand event capture
4. Run `npm test` (unit tests in tests/lib.test.js cover password hashing, code validation, score math)

### I want to secure the deployment
1. Read `security-model.md` for App Check, reCAPTCHA, CSP, PBKDF2 setup
2. Check `firebase-config.js`: CANAMED_SUPERADMIN_KEY should be null in public deployments
3. Review `database.rules.json` (tight `.read`/`.write` guards, immutability constraints)
4. Monitor Firebase Console → App Check dashboard for reCAPTCHA quota

### I want to understand the test suite
1. Read `test-strategy.md` for the three tiers (unit / rules / E2E)
2. Unit tests: `npm test` → runs tests/*.test.js (lib, i18n, telemetry, rules)
3. E2E tests: `npm run test:e2e` → runs tests-e2e/*.spec.js (splash, join, admin dashboard)
4. Local mode: `localdb.js` provides a localStorage mock of Firebase for offline testing

## External Dependencies

- **Firebase Realtime Database:** Multi-user state, persistence, real-time sync
- **Firebase Authentication:** Anonymous + Google signin
- **Firebase App Check:** reCAPTCHA v3 attestation (free tier)
- **Firebase Performance Monitoring:** Optional—collects page-load metrics (disabled by default)
- **Google reCAPTCHA v3:** Bot detection (free, 10k/month, no billing required)
- **Google Sign-In SDK:** OAuth 2.0 provider for optional profile signin

## Known Limitations

1. **No offline mode.** If a participant loses internet mid-session, they cannot re-join their room with the same client state. Page reload lands them back in the waiting room (if session is still running).

2. **LocalDB syncs tabs, not devices.** The test backend (localdb.js) uses localStorage and the storage event, so N tabs of the SAME browser see the same data. Different devices need Firebase Realtime Database.

3. **Super-admin key is public in source.** If firebase-config.js is served (e.g. on GitHub Pages), anyone can read CANAMED_SUPERADMIN_KEY. For private super-admin actions, set the password via Firebase Console instead, or run the platform from a local (unpublished) copy.

4. **Answers cannot be edited after submission to the database.** Code UI allows editing for UX, but the database only sees: delete old entry + insert new entry as separate transactions. Histories are lost.

5. **Room-balancing algorithm is greedy.** assignRooms() fills rooms one by one to maximize Franco-Japanese mix, but it does not globally optimize (e.g. if a later arrival would rebalance all rooms better). Good-enough for 20–60 people per session.

## Related Documentation

- `script-js-map.md` — Function-by-function reference (4900+ lines organized by concern)
- `data-model.md` — Firebase RTDB schema with read/write authorities and validators
- `security-model.md` — App Check, reCAPTCHA, CSP, PBKDF2, secret management
- `test-strategy.md` — Unit / rules / E2E test tiers, how to run locally, CI workflows
- `../README.md` — Day-to-day operations, pre-workshop checklist, session cleanup
- `../RUNBOOK.md` — Common failures, troubleshooting, credential rotation
