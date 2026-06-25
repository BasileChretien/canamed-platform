# script.js Codemap

**Last Updated:** 2026-05-16
**Total Lines:** 4,913
**Entry Point:** index.html loads it deferred, after lib.js, localdb.js, i18n.js, platform-config.js, firebase-config.js, telemetry.js, script-loader.js. `case-content.js`, `qrcode.js`, `tour.js` are NOT in the initial HTML — they are lazy-loaded by `script-loader.js` on demand (and pre-warmed via `requestIdleCallback` after the splash paints). See `script-loader.js` for the loading contract.

## Bundle layout (post bundle-split, perf/bundle-audit)

| Chunk                | When loaded                                   | Status |
|----------------------|-----------------------------------------------|--------|
| `script.js`          | deferred on splash                            | Active (still holds room + admin runtimes; migration deferred) |
| `pure-utils.js`      | deferred on splash (after `lib.js`)           | Active — pure helpers extracted from `script.js` (`hashStr`, `colorFor`/`COLORS`, `roomNames`, `minsSince`, `reducedMotion`); browser globals + `require()`-able. Seed for further pure-helper extraction. Unit-tested in `tests/pure-utils.test.js`. |
| `script-loader.js`   | deferred on splash                            | Active — exposes `window.CanamedLoader.ensure*()` |
| `case-content.js`    | lazy via `ensureCaseContent()` / idle prefetch| Out of splash bundle |
| `qrcode.js`          | lazy via `ensureQrcode()` on QR paint         | Out of splash bundle |
| `tour.js`            | lazy via `ensureTour()` / idle prefetch       | Out of splash bundle |
| `scenario-author.js` | lazy via `ensureScenarioAuthor()`             | Out of splash bundle (always was) |

> Removed in R2-01 (SIMULATION_ROUND2.md): `script-room.js` + `script-admin.js`
> were empty placeholder chunks paired with `ensureRoomRuntime()` /
> `ensureAdminRuntime()`. The intended migration of room/admin runtime out
> of `script.js` never landed because the shared mutable state (`pool`,
> `allRooms`, `roomStage`, …) made the extraction invasive. The placeholders
> + their loader entries were removed because they added a redundant HTTP
> round-trip per join with zero benefit. Re-introduce them in lockstep with
> the actual extraction PR when it lands.

The main state machine of the CaNaMED platform. Contains 4,900+ lines of UI lifecycle, event handlers, Firebase listeners, and rendering. Functions organized below by concern; no bodies shown (read source for details).

## Globals & Config

| Item | Lines | Purpose |
|------|-------|---------|
| CFG | 33 | window.CANAMED_CONFIG (partnership, cohorts, branding) from platform-config.js |
| COHORTS | 34-40 | Array of { id, label, short, country, color } for universities |
| COHORT_IDS, COHORT_TOKENS | 40-51 | Indexed cohort names for scoring "cross-cohort difference" |
| SYNTH_ID, SYNTH_PREREQS, ITEM_IDS | 62-75 | Module A: SYNTH_ID (labs:0) is the model-synthesis item — NOT rendered as a button (2026-06-02); its write-up ships in the stage-4 take-home export. SYNTH_PREREQS = the red-flag screen (scoring only). Progression gate is phaseGateOpen() (≥1 hypothesis) |
| STAGE_COUNT, STAGE_LABELS, COLORS | 132-160 | 4 stages, English fallback labels, room colors |
| SCORE_AUTO, SCORE_MICRO_BULLETS | 170-231 | Point tables for milestones and micro-level scoring |
| db, sessionNum, userId, clientId | Module-level | Firebase ref (or LocalDB), session code, auth UID, temp browser session ID |
| roomName, asAdmin | Module-level | Current room being viewed, whether viewer is admin |

## Auth & Session Lifecycle

### Database & Firebase Init

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| dbInit() | 722–774 | (init) | Create db ref (Firebase SDK or LocalDB), set up anonymous/Google auth, listen to auth state |
| initAppCheck() | 667–706 | dbInit() | Configure Firebase App Check with reCAPTCHA v3 |
| handleAuthStateChange() | 4571–4628 | Firebase auth listener | Route logged-in users through profile-setup or profile-restore; set global userId |
| ensureSignedIn() | 4541–4570 | loadSessionScenario(), other async flows | Trigger anonymous auth if not already signed in |

### Google Sign-In & Profile

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| signInWithProvider() | 4487–4540 | account dialog, splash buttons | Initiate Google OAuth, handle sign-in result |
| loadProfile() | 4629–4634 | handleAuthStateChange() | Load user's saved profile (name, univ, year, english) from Firebase |
| saveProfile() | 4635–4645 | profileSetupSubmit(), account dialog | Write profile updates to users/{uid}/profile |
| handleAuthStateChange() | 4571–4628 | Auth state listener | Route: if first sign-in, show profile setup; else restore profile to form |
| profileSetupSubmit() | 4711–4728 | profile-setup form submit | Validate & save new profile, then route to session-join or next step |
| applyProfileToJoinForm() | 4729–4744 | After profile loaded | Auto-fill join form (name, univ, year, english) from saved profile |
| pushSessionToHistory() | 4646–4658 | After participant joins | Write session code to users/{uid}/history/{code} (for "recent sessions" list) |
| loadHistoryForDialog() | 4769–4802 | Account dialog open | Load and render user's session history (recent codes they've joined) |

### Resume & Last Workshop (LocalStorage Persistence)

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| saveLastWorkshop() | 3930–3948 | After create session | Save label, scenario, room count, links to localStorage for next create |
| loadLastWorkshop() | 3949–3952 | Entry/splash init | Load prior session template from localStorage |
| clearLastWorkshop() | 3953–3961 | Account logout | Clear saved template |
| saveResume() | 588–666 | After joining room, stage change | Save room, stage, pool data to localStorage for page-reload recovery |

## Entry & Splash

### Initial Page Load & Routing

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| initEntry() | 4009–4041 | Page load (from HTML script runner) | Bootstrap: set up event listeners, check localStorage for resume, show splash or lobby |
| tryConsumeDeepLink() | 3902–3929 | initEntry() | Check URL params (code, name, etc.) for deep-link join attempt |
| wireSplash() | 4042–4315 | initEntry() | Attach event listeners to all splash views (enter, create, account) |
| splashShowView() | 3962–3978 | Splash buttons | Switch visible splash view (enter code, create session, sign-in, profile setup) |

### Session Code / Create Flow

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| readSession() | 960–979 | Code-input form | Read & validate session code from input field |
| readName() | 948–959 | Join forms | Read & validate participant name from input field |
| sanitizeCode() (from lib.js) | lib.js ~57–61 | readSession() | Normalize code: lowercase, trim, [a-z0-9_-] only, max 20 chars |
| sessionExists() | 3779–3787 | Splash code-enter submit | Check if a session code already exists (or is available to create) |
| createSession() | 4381–4417 | Splash create-form submit | Create new session: set password hash, scenario, room count, links |
| loadScenarioTemplate() | 4354–4380 | Scenario picker change | Load SCENARIOS[id] from case-content.js and preview |
| populateScenarioPicker() | 4316–4337 | Entry/splash | List all available scenarios (built-in + any custom) in dropdown |
| onScenarioChange() | 4338–4353 | Scenario picker | Re-render case preview when user switches scenario |
| validateScenarioJson() | 4418–4458 | Create-form scenario upload | Parse & validate custom scenario JSON |
| splashHintErr(), splashHintOk() | 4459–4466 | Form validation | Show/clear error or success message below form field |

## Participant Join & Waiting Room

### Join Flow

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| joinParticipant() | 980–1044 | Join-form submit | Trigger auth, then write to pool, record consent, handle room-assignment |
| _joinParticipantAfterAuth() | 1045–1098 | After anonymous auth | Write pool entry, load session scenario, check if room already assigned or start waiting |
| setUnlockedSession() | 3788–3800 | After join | Mark session code as "unlocked" in localStorage (for resume flow) |
| enterUnlockedSession() | 3801–3813 | Resume from localStorage | Restore participant to their room if session still running |
| autoResume() | 3823–3864 | Page reload/resume | Attempt to restore room from localStorage; show "Late arrival" banner if stage has advanced |

### Waiting Room

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| updateWaitingStatus() | 1099–1103 | Presence listener | Update live count of people in waiting room |
| renderWaitingList() | 1104–1113 | Status changed | Render chip list of waiting-room participants |
| maybeSelfAssign() | 1256–1288 | Pool change listener (auto-called) | Check if user has been assigned a room, exit waiting room if yes |
| startSession() | 1888–1931 | Admin "Start session" button | Trigger assignRooms(), write room assignments, set started=true |
| assignRooms() | 515–539 | startSession() | Core algorithm: balance participants across rooms by Franco-Japanese mix, year, English |
| bestRoomFor() | 540–557 | assignRooms() | Greedy: find best room for one person given current assignments |
| renderTeamsButtons() | 1114–1121 | Stage 0 or 2 render | Show "Join the Teams call" button if teamsLink set |
| renderQuizButton() | 1122–1146 | Stage 0 render | Show pre-session questionnaire link if preQuestionnaireLink set |
| renderPreQuizButton() | 1147–1162 | Stage 3 render | Show post-session questionnaire link if questionnaireLink set |

## Admin Dashboard & Session Management

### Admin Entry

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| joinAdmin() | 1536–1578 | Admin password submit | Validate password, authenticate as admin, enter dashboard |
| joinSuperAdmin() | 1579–1615 | Super-admin key submit | Authenticate as super-admin, unlock password-setter panel |
| enterAdminApp() | 1616–1775 | After admin auth | Render dashboard, set up stage-control listeners, room-list listeners |

### Dashboard & Stage Control

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| renderDashboard() | 2049–2159 | Admin view render | Build room cards (stage, head-count, call-alert badges), points panel, sidebar |
| renderPrestart() | 1868–1887 | Stage control, before start | Show "Choose room count" form, "Start session" button |
| startSession() | 1888–1931 | Admin "Start session" button | Assign rooms, set started=true, enable stage controls |
| setRoomStage() | 1932–1950 | Admin stage buttons (←/→) | Write new stage to DB, broadcast to all participants in that room |
| renderSidebar() | 2200–2244 | Dashboard render | List all rooms: stage, count, call-alert status; click to open |
| openRoomAsAdmin() | 2245–2253 | Sidebar room click | Switch to room view, clear call-alert, show room-side panel |
| backToDashboard() | 2254–2276 | Room view "Back" button | Return to dashboard view |
| buildPointsPanel() | 2160–2184 | Dashboard render | Render total points, breakdown by auto/penalty/manual, award-manual button |
| awardManual() | 2185–2189 | Admin manual-award form | Write manual points entry to score/manual |
| undoLastManual() | 2190–2199 | Admin undo button | Remove last manual-points entry |

### Call Alerts

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| initCallProf() | 2687–2700 | Room view setup | Set up listener for callForHelp updates |
| renderCallProf() | 2701–2725 | Call-alert changed | Render "Call a facilitator" button, show call badge + message |
| checkCallAlerts() | 1789–1805 | Dashboard render | Check which rooms have active call alerts |
| helpCallChime() | 1971–1995 | Call alert received | Play audio chime, trigger OS notification (with muting option) |
| maybeAlertHelpCall() | 2038–2048 | After checkCallAlerts() | Show/hide call alert on room card |
| isHelpAlertsMuted(), setHelpAlertsMuted() | 2028–2037 | Admin settings | Mute/unmute audio/notification on call alerts |

### Session Cleanup

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| closeSession() | 2277–2377 | Admin "Close session" button | Mark session closed in DB (blocks further writes), render wrap-up, offer downloads |
| renderClosedState() | 2503–2546 | After session closed | Show download buttons, completion timestamp, thank-you message |
| downloadAllAnswers() | 2547–2596 | Admin "Download all answers" | Export answers, scores, presence as JSON/CSV (by room & module) |
| downloadMyData() | 2378–2467 | Participant GDPR self-export | Export participant's own data (profile, answers, consent, scores) as JSON |
| downloadFullArchive() | 2468–2502 | Admin "Download full archive" | ZIP all data (answers, scores, presence, transcripts) for long-term research storage |

## Room View & Stage Progression

### Room Rendering

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| enterRoom() | 1356–1397 | Pool assigned or admin opens | Fetch room data, set up listeners, render stage view |
| wireRoomUI() | 1289–1309 | Room entered | Attach event listeners for all room interactions |
| teardownRoom() | 1398–1420 | Room exit | Unsubscribe from all listeners, clear local room state |
| startRoom() | 1421–1535 | Room entered, every stage | Render stage (0=Welcome, 1=ModuleA, 2=ModuleB, 3=Wrap-up) |
| renderStage() | 2619–2674 | startRoom() | Dispatch to stage-specific renderer based on current stage |
| initStageNav() | 2675–2686 | Room view | Set up "Back / Next" buttons (gated by room's current stage) |

### Stage Content Rendering

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| renderCase() | 2890–2898 | Stage 1 (Module A) | Render the interactive chronic-pain case (left column) |
| renderButtons() | 2753–2793 | Module A render | Render "Ask / Examine / Investigate" button groups |
| reveal() | 2746–2752 | Button click | Reveal finding when user asks/examines/investigates; write to moduleA/revealed |
| renderFindings() | 2794–2822 | Findings tab | Render log of revealed findings with timestamps & who revealed them |
| keyRevealed() | 2823–2826 | Findings changed | Legacy: whether SYNTH_ID was revealed. SYNTH_ID is no longer rendered as a button (2026-06-02) so this is effectively always false; progression is gated by phaseGateOpen() (≥1 hypothesis) |
| prereqsMet() | 2743–2745 | Synthesis check | Check if all SYNTH_PREREQS have been revealed |
| renderPrompts() | 2827–2853 | Discussion tab | Render clinical discussion prompts (unlocked after ≥1 working hypothesis — phaseGateOpen) |
| renderLeaderboard() | 3423–3509 | Wrap-up stage | Render per-cohort leaderboard, final scores, "worth remembering" lessons |
| renderTeamRecap() | 1163–1221 | Waiting / wrap-up | Render recap of team decisions, penalties, lessons learned |
| renderWrapupSummary() | 1222–1255 | Wrap-up stage | Render final messages, cohort-comparison, next-steps links |

### Right-Column Tabs (Stage 1)

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| initRightColumnTabs() | 1310–1326 | Module A setup | Create tab bar: Findings, Decisions, Discussion, Answers, Reference |
| switchRcolTab() | 1327–1343 | Tab button click | Switch active tab; update badges; scroll to new tab content |
| nudgeRcolTab() | 1344–1348 | New content in hidden tab | Highlight tab if something changed while user was on another tab |
| setTabBadge() | 1349–1355 | Content changed | Show/update notification badge on tab (e.g. "1 new answer") |
| focusHeading() | 3725–3730 | Tab switch | Scroll to and focus main heading of new tab (a11y) |

## Scoring & Penalties

### Score Calculation

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| checkScoreEvents() | 2899–3006 | Every render or DB listener | Scan pool + modules for new reveals/votes/answers; emit score events (auto/penalties) |
| scoreEventMeta() | 277–309 | checkScoreEvents() | Extract metadata from a score event (milestone, concept family, penalty) |
| penaltyMeta() | 235–260 | checkScoreEvents() (penalty path) | Look up penalty details: which item, point deduction, explanation |
| scorePenaltyTotal() | 310–316 | Dashboard render | Sum all penalties for a room (used for display) |
| familyHits() | 317–331 | Answer scoring | Match answer text against a concept family's keywords (forgiving: normalize, accent-strip) |
| SCORE_AUTO, SCORE_MICRO_BULLETS | 170–231 | (lookups) | Point tables: { path, points } for milestones; { keyword, points } for families |

### Events & Notifications

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| celebrateEvents() | 3007–3038 | After checkScoreEvents() | Play sounds, show toasts, animate point bursts when positive score events happen |
| penaltyToast() | 3039–3052 | After checkScoreEvents() (penalty path) | Show calm amber toast explaining why points were lost |
| renderScore() | 3053–3086 | Dashboard or room render | Show current total points for the room/cohort |
| countUp() | 429–443 | Point animation | Animate number ticking up from 0 to final value (cosmetic) |

## Decisions (Team Voting)

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| renderDecisions() | 3248–3287 | Stage 1 render | Render all "very important question" voting cards |
| buildDecision() | 3288–3422 | Decision card render | Build one voting card: prompt, options, tally bar, commit button |
| castVote() | 3186–3196 | Option button click | Cast participant's vote for a decision, write to votes/{id}/ballots/{clientId} |
| commitDecision() | 3197–3226 | "Lock in" button click | Lock the option with most votes, check if correct, emit score event |
| announceDecision() | 3227–3241 | After committed | Show result toast (correct/wrong), explain why |
| votablePresentCount() | 3242–3247 | Commit check | Count how many room members have voted (need quorum to lock in) |
| decisionMeta() | 261–276 | Decision result lookup | Get decision details: correct choice, points, explanation |

## Answers (Collaborative Text)

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| initAnswers() | 3702–3724 | Room view setup | Set up listeners for moduleA/answers, moduleB/answers, typing |
| renderAnswerHints() | 3553–3569 | Answers tab render | Show section headers (e.g. "This question is new since you last logged in") |
| renderAnswers() | 3570–3619 | Answers tab render | Render list of answer entries, edit/delete buttons |
| renderTyping() | 3688–3701 | Typing listener | Show "Alice is typing..." status for each active typer |
| addAnswer() | 3620–3635 | "Add answer" button | Prompt for text, write new entry to answers/{moduleA,B}/{entryId} |
| editAnswer() | 3636–3676 | "Edit" button | Modify text of existing answer; in code it's delete-old + insert-new |
| deleteAnswer() | 3677–3683 | "Delete" button | Remove answer from DB (calls .remove()) |
| setTyping() | 3684–3687 | Textarea input listener | Write/remove typing/{clientId} indicator as user types |

## Presence & Team State

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| renderPresence() | 3532–3552 | Room render | List active participants in room, show their names |
| initTeamName() | 3510–3522 | Room entered | Set up listener for roomName; allow room to set its own team name |
| initReset() | 3523–3531 | Admin view | Show "Reset session" button (admin-only, dangerous) |

## Language & Theming

### i18n Integration

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| wireLanguageSwitcher() | 804–815 | Entry | Attach language-button listeners; restore language from localStorage |
| _curLang() | 232–234 | i18n integrations | Get current language tag from window.getLang() (defined in i18n.js) |
| applyBranding() | 816–858 | Page load | Set page title, header mark colors, cohort-specific CSS classes |

### Utilities

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| el() | 349 | Everywhere | Shorthand: document.getElementById(id) |
| flashSaved() | 351–358 | Form submit success | Show brief "Saved" message, auto-hide |
| makeChip() | 359–370 | Cohort rendering | Create colored badge with name (e.g. "Caen", "Nagoya") |
| colorFor() | 344–348 | Presence rendering | Hash a person's name to a consistent color |
| hashStr() | 332–343 | Utilities | Simple hash function (not cryptographic, used for color assignment) |
| reducedMotion() | 371–376 | Animation gates | Check prefers-reduced-motion media query |
| burst() | 377–406 | Point celebration | Animate particle burst effect (respects reducedMotion) |
| playCue() | 407–428 | Score events, help alerts | Play success/penalty/chime sound (respects muting) |
| toast() | 444–475 | Notifications | Show bottom-right toast message (kind: success/warn/error/info) |
| sharedAvailable(), sharedExpectedButBroken() | 476–514 | DB availability check | Test Firebase connectivity; show warning if DB unavailable but expected |
| minsSince() | 1951–1954 | Elapsed time | Minutes since a timestamp |
| roomProgress() | 1955–1970 | Dashboard render | Progress label for a room (e.g. "Stage 1, 5 min in") |

## Page Lifecycle & Teardown

### Entry & Exit

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| wireSkipLink() | 775–803 | Entry | Wire WCAG skip-link (a11y: keyboard users skip header to main) |
| leaveAndReload() | 3741–3761 | Leave-room button | Unsubscribe, clear state, go back to splash |
| initLeave() | 3762–3778 | Room setup | Attach "Leave room" button listener |
| initSoundToggle() | 919–947 | Entry | Wire mute/unmute button for audio cues |
| showLateBanner() | 2597–2618 | Room render (late arrival) | Show banner if stage has advanced while user was loading |

### QR & Deep Links

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| buildJoinUrl() | 3865–3870 | Admin console | Generate full URL with code & optional name params |
| paintJoinQr() | 3871–3901 | Admin console | Render QR code SVG from buildJoinUrl() |
| tryConsumeDeepLink() | 3902–3929 | Entry | Parse URL params (code, name, etc.) for direct-join attempt |

### Beep/Chime

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| beep() | 1776–1788 | Help-alert chime | Play short beep sound (call-for-help notification) |

## Session Scenario & Case Loading

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| loadSessionScenario() | 108–130 | Before room render | Load scenario from DB (set at session creation), apply CASE/SCORING/DECISIONS/PENALTIES |
| applyScenario() | 81–103 | Scenario load | Swap global CASE/SCORING/PENALTIES/DECISIONS objects |
| rebuildCaseDerived() | 66–75 | applyScenario() | Rebuild ITEM_IDS from new CASE structure |
| itemById() | 76 | Finding/button lookup | Get case item by "group:index" ID (e.g. "history:1") |
| stageLabel() | 140–149 | UI rendering | Get translated stage label. R3-G2: stages 1 & 2 prefer `CURRENT_SCENARIO_META.{moduleAName,moduleBName}` (per-scenario, via `tc()`) over the static i18n `stage.label.1/2` keys, so antibiotic-stewardship etc. render the correct module names instead of the chronic-pain placeholders. Falls back to i18n key, then English. |
| roomNames() | 153–169 | Room assignment | Generate room names from count (e.g. "Room A", "Room B") |
| cohortColor() | 52–55 | Theming | Look up color for a cohort ID |

## Error & State Handling

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| authErrorMessage() | 4467–4486 | Firebase errors | Translate Firebase auth error codes to user-friendly messages |
| subscribeClosedListener() | 3814–3822 | Entry | Listen for session closed event; show wrap-up if it happens |

## Account & Profile Dialog

| Function | Lines | Calls | Purpose |
|----------|-------|-------|---------|
| openAccountDialog() | 4745–4760 | Header chip click | Show account modal (profile, history, sign-out, delete) |
| closeAccountDialog() | 4761–4768 | Dialog close button | Hide modal |
| paintUserChip() | 4678–4710 | Header render | Show signed-in user name or "Sign in" link |
| accountSaveBtn() | 4803–4821 | Profile edit in modal | Update profile from modal form |
| accountSignOut() | 4822–4829 | "Sign out" button | Firebase sign-out, clear global userId, reset UI |
| accountDelete() | 4830–4872 | "Delete account" button | Delete profile + history from DB, sign out |
| wireAccountUI() | 4873+ | Entry | Attach all account dialog listeners |

## Related Codemaps

- `data-model.md` — Database schema (paths, read/write authorities, validators)
- `security-model.md` — Auth, App Check, CSP, hashing
- `test-strategy.md` — Unit/E2E test coverage for these functions
