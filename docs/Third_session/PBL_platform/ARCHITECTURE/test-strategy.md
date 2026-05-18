# Test Strategy

**Last Updated:** 2026-05-16
**Test Directories:** `tests/` (unit), `tests-e2e/` (E2E)
**CI Workflows:** `.github/workflows/test.yml`, `.github/workflows/e2e.yml`

The platform uses a three-tier testing strategy: fast unit tests on every commit, security-sensitive database rules validation, and E2E tests covering critical user flows.

## Test Pyramid

```
        ⬤ E2E (5 tests, ~2 min)
       ┌─┼─┐
      ⬤ ⬚ ⬚  Rules Validation (60+ rules, <10 sec)
     ┌─┼─┬─┼─┐
    ⬚ ⬚ ⬚ ⬚ ⬚  Unit Tests (150+ assertions, <5 sec)
```

## Tier 1: Unit Tests (Fastest, Most Coverage)

**Purpose:** Test pure functions in lib.js, i18n.js, telemetry.js (no DOM, no Firebase, no async I/O).

**Location:** `tests/`

### tests/lib.test.js

**Focus:** Password hashing, session-code generation, sanitization, score math, i18n helpers.

**Coverage:**

| Function | Test Cases |
|----------|-----------|
| hashPassword() | Hash generation, v1/v2 format, iteration count |
| verifyPassword() | Correct password, wrong password, v1/v2 compatibility |
| sanitizeCode() | Trim, lowercase, strip special chars, max 20 chars |
| sanitizeResume() | Clamp fields, validate university, consent structure |
| entriesSorted() | Sort by timestamp, handle missing times |
| normalizeForScore() | Accent stripping, whitespace collapse, lowercase |
| tc() | Fallback en/fr/ja, plain string pass-through |
| safeHref() | Valid https:// URLs, reject javascript://, reject malformed |

**Run:**

```bash
npm test
```

**Output:**

```
tests/lib.test.js
✓ Password hashing: v1 legacy
✓ Password hashing: v2 current
✓ Password verify: correct match
✓ Password verify: wrong password fails
  ... (150+ assertions total)
```

**CI:** Required to pass before merge (set up in .github/workflows/test.yml).

### tests/i18n.test.js

**Focus:** Translation fallback, language selection, missing translations.

**Coverage:**

| Test | Purpose |
|------|---------|
| tc() with plain string | Backward compat with legacy plain strings |
| tc() with en/fr/ja object | Pick correct language, fallback to en if missing |
| tc() with missing language | Fallback to first non-empty |
| tc() with null | Return empty string |

**Run:**

```bash
npm test
```

### tests/telemetry.test.js

**Focus:** Session event serialization, timestamp capture, score event structure.

**Coverage:**

| Test | Purpose |
|------|---------|
| scoreEventMeta() parsing | Extract path, points, type from event object |
| penaltyMeta() lookup | Match penalty by item ID, return deduction + explanation |
| decisionMeta() lookup | Match decision by ID, return correct choice + points |
| Event JSON export | Serialize events to JSON, valid structure |

**Run:**

```bash
npm test
```

### tests/rules.test.js

**Focus:** Validate database.rules.json syntax and logical consistency.

**Coverage:**

| Test | Purpose |
|------|---------|
| Rules JSON parse | Valid JSON, no syntax errors |
| Path hierarchy | All paths follow expected structure (sessions/{id}/rooms/...) |
| Auth guards | All read/write rules require auth != null or specific conditions |
| Immutability constraints | Password, created, closed have `.write: "!data.exists()"` |

**Run:**

```bash
npm test
```

**Notes:** This test does NOT verify rule logic at scale (Tier 2 does that with Firebase rules test tools). It only checks syntax and basic consistency.

## Tier 2: Firebase Database Rules Validation (Medium Speed)

**Purpose:** Test database.rules.json against real/mock Firebase to catch permission bugs, validation failures, and state-machine violations.

**Status:** Currently minimal (see Limitations, below).

**How Rules Are Tested:**

The Playwright E2E tests implicitly test rules by attempting operations and checking if they succeed/fail:

```javascript
// tests-e2e/create-and-admin.spec.js
test('admin can create session', async ({ page }) => {
  // 1. Join as facilitator
  // 2. Create session with password
  // 3. Check adminPasswordHash was written (rules allowed it)
  // 4. Attempt to change password (should fail)
});
```

**Desired Future Improvements:**

1. Firebase Rules Simulator (Firebase Emulator Suite) to test rules in isolation
2. Per-rule unit tests (e.g., "stage write fails if not admin")
3. State-machine tests (e.g., "cannot set roomCount after started=true")

**Run (Future):**

```bash
npx firebase emulators:exec "npm run test:rules"
```

## Tier 3: E2E Tests (Slowest, Most Realistic)

**Purpose:** Test full user flows end-to-end: splash → join → room → stage progression → scoring → admin dashboard.

**Location:** `tests-e2e/`

**Test Framework:** Playwright (@playwright/test)

**Environment:**

- Runs against a **local static server** (scripts/serve-platform.js) serving docs/Third_session/PBL_platform/
- **LocalDB mode:** CANAMED_FIREBASE forced to null via page.addInitScript() → no Firebase calls, hermetic
- **Headless by default:** HEADED=1 to watch browser interactively
- **Single worker:** fullyParallel: false (LocalDB syncs tabs, not workers)

### tests-e2e/splash.spec.js

**Tests:**

| Test | Coverage |
|------|----------|
| Splash renders | Page loads, splash title visible, lang buttons present |
| Language switch | Switch en → fr → ja, [data-i18n] nodes re-rendered |
| Code input validation | Trim, lowercase, reject invalid chars |
| Deep-link join | URL params (code, name) pre-fill form |

**Run:**

```bash
npm run test:e2e
```

**Expected Output:**

```
splash
  ✓ renders splash with language buttons
  ✓ switches language to French
  ✓ validates session code
  ✓ deep-link join from URL params
```

### tests-e2e/create-and-admin.spec.js

**Tests:**

| Test | Coverage |
|------|----------|
| Create session | Set password, choose room count, pick scenario |
| Admin login | Enter password, access dashboard |
| Set Teams link | Admin pastes Teams URL, participants see button |
| Set questionnaire link | Admin pastes Qualtrics link |
| Password immutability | Cannot change password after creation |

**Run:**

```bash
npm run test:e2e -- create-and-admin
```

**Expected Output:**

```
create-and-admin
  ✓ facilitator creates session with password
  ✓ admin logs in with password
  ✓ admin sets Teams link
  ✓ admin sets questionnaire link
  ✓ password is immutable after creation
```

### tests-e2e/stage-progression.spec.js

**Tests:**

| Test | Coverage |
|------|----------|
| Participants join pool | Multiple users enter code, land in waiting room |
| Room assignment | Admin starts session, participants auto-assigned to rooms |
| Stage progression | Admin advances room from stage 0 → 1 → 2 → 3 |
| Participant navigation | Participant can Back/Next within current stage, cannot go past room stage |
| Late arrival | User joins after start, lands in room at current stage (not stage 0) |

**Run:**

```bash
npm run test:e2e -- stage-progression
```

**Expected Output:**

```
stage-progression
  ✓ participants enter waiting room
  ✓ admin starts session and assigns rooms
  ✓ stage advances to Module A
  ✓ participant cannot navigate past room stage
  ✓ late arrival joins at current stage
```

### tests-e2e/advance-and-close.spec.js

**Tests:**

| Test | Coverage |
|------|----------|
| Module A: reveal findings | Click Ask/Examine/Investigate, item revealed with timestamp |
| Module A: team decisions | Vote on prompt, tally updates live, lock-in award points |
| Module A: answers | Add answer, appears in room, shows contributor name |
| Module B: type answers | Typing indicator shows "person is typing..." |
| Module B: scoring | Answer matches concept family, points awarded |
| Call for facilitator | Click button, admin sees red badge, opening room clears alert |
| Close session | Admin closes, no more writes allowed, wrap-up renders |
| Download data | Admin downloads all answers, JSON structure valid |

**Run:**

```bash
npm run test:e2e -- advance-and-close
```

**Expected Output:**

```
advance-and-close
  ✓ reveal findings in module A
  ✓ vote and lock team decision
  ✓ add and edit answers
  ✓ typing indicator works
  ✓ scoring detects concept families
  ✓ call for facilitator alerts admin
  ✓ session closed prevents writes
  ✓ admin downloads all answers
```

### fixtures.js (Test Helpers)

**Purpose:** Reusable test utilities (no copy-paste).

**Functions:**

| Function | Purpose |
|----------|---------|
| Page Setup | Open platform, initialize LocalDB, set language |
| Session Creation | Create session with random code, return password |
| Participant Join | Enter code, name, university, year, english, click Join |
| Admin Login | Enter admin password, access dashboard |
| Room Navigation | Admin opens room, switches rooms, returns to dashboard |
| Wait Helpers | Wait for stage to change, element to appear, etc. |

**Example Usage:**

```javascript
const { page } = await createPage();
const { code, password } = await createSession(page, "Test Session", 3);
const { clientId } = await joinParticipant(page, code, "Alice", "Caen", 3, "B2");
```

## Running Tests Locally

### Prerequisites

```bash
npm install
npx playwright install --with-deps chromium
```

### Unit Tests (Fast, Run First)

```bash
npm test
```

Output: ~30 tests, all pass in <5 sec.

### E2E Tests (Slow, Run After Unit)

```bash
npm run test:e2e
```

- Auto-starts local server (scripts/serve-platform.js) on port 8765
- Runs all tests/*.spec.js
- Auto-stops server after suite completes
- Output: Playwright report in playwright-report/ (open in browser)

**To watch a test interactively:**

```bash
HEADED=1 npm run test:e2e -- splash.spec.js
```

Browser opens; test runs step-by-step; DevTools available. Useful for debugging.

**To run a single test:**

```bash
npm run test:e2e -- splash.spec.js -g "language switch"
```

Runs only tests matching "language switch".

**To debug a failing test:**

```bash
npm run test:e2e -- splash.spec.js --debug
```

Playwright Inspector opens; step through test line-by-line.

## Continuous Integration

### Unit Tests (Every Commit)

**Workflow:** `.github/workflows/test.yml`

**Runs on:** Ubuntu, Node 20

**Steps:**

1. Syntax check: `node --check` every .js file
2. JSON validation: Parse firebase-config.js, firebase.json, database.rules.json
3. Run `npm test`

**Fails if:**
- Any .js file has syntax errors
- JSON is invalid
- Any unit test fails

**Time:** ~30 sec

**Required to Pass:** Yes (branch protection rule)

### E2E Tests (Pull Requests + Main)

**Workflow:** `.github/workflows/e2e.yml`

**Runs on:** Ubuntu, Node 20, Chromium

**Steps:**

1. Install npm deps
2. Cache Playwright browsers
3. Run `npm run test:e2e`
4. On failure: upload playwright-report/ artifact (14-day retention)

**Parallelization:**

- Single worker (fullyParallel: false) because LocalDB syncs within same browser context, not across workers
- If needed: split tests into fixtures (separate LocalDB instances per fixture)

**Time:** ~2 min

**Required to Pass:** Once branch protection picks it up (currently manual, will be automated)

## Test Coverage Goals

| Category | Current | Target |
|----------|---------|--------|
| Unit (lib.js, i18n.js, telemetry.js) | 95%+ | 95%+ |
| E2E critical flows | 60% | 80%+ |
| Database rules validation | 30% | 80%+ |
| Overall | ~70% | 85%+ |

**Gaps:**

- Admin score-awarding (tested manually, needs E2E)
- Multi-room interactions (tested separately, not E2E)
- Network failure recovery (not tested; would need Firebase Emulator)
- Accessibility (not tested; would need axe-core)

## LocalDB Test Backend

### Architecture

```
┌─────────────────────────────────────────┐
│ Playwright Test (Node.js, main thread)  │
├─────────────────────────────────────────┤
│  page.addInitScript() sets              │
│  window.CANAMED_FIREBASE = null         │
│  ↓                                      │
│ ┌──────────────────────────────────────┐
│ │ Browser (Chromium)                   │
│ ├──────────────────────────────────────┤
│ │ script.js detects FIREBASE is null   │
│ │ → new LocalDB()                      │
│ │   ├── localStorage (canamed_localdb) │
│ │   └── storage event listener         │
│ │ → Users auth anonymously (mocked)    │
│ │ → Reads/writes go to localStorage    │
│ └──────────────────────────────────────┘
│  ↑                                      │
│  page.locator('selector').click() etc  │
│  (Playwright waits for state changes)   │
└─────────────────────────────────────────┘
```

### How LocalDB Syncs Across Tabs

```javascript
// In localdb.js, lines 51-53
window.addEventListener("storage", (e) => {
  if (e.key === LOCALDB_KEY) this._notifyAll();
});
```

**Flow:**

1. Tab A writes to localStorage.setItem("canamed_localdb_v1", data)
2. Browser fires storage event on ALL OTHER TABS (not Tab A itself)
3. Each tab's LocalDB._notifyAll() re-reads localStorage
4. All listeners fire with fresh data
5. UI re-renders

**In Tests:**

```javascript
// Playwright context has fullyParallel: false
// → tests run sequentially, one at a time
// → LocalDB instance is per-page
// → Each page() can have multiple tabs (via page.context().pages())

const page1 = context.newPage(); // Participant 1
const page2 = context.newPage(); // Participant 2
// Both pages share localStorage (browser context scope)
// When page1 writes, page2 sees the storage event
```

## Debugging Tests

### View Playwright Report

```bash
npx playwright show-report
```

Opens interactive report (traces, screenshots, videos).

### See Trace of Failing Test

```bash
# Tests save traces on failure (playwright.config.js, line 41)
# Extract trace from playwright-report/
# In report: click test → click "trace" tab
```

### Re-run Single Failed Test with Debug

```bash
npm run test:e2e -- advance-and-close.spec.js -g "module A" --debug
```

Inspector opens; you can:
- Step through test code
- Inspect page state (DOM, localStorage)
- Hover over assertions to see failures

### Check LocalDB Contents in Test

```javascript
const localdb = await page.evaluate(() => {
  return JSON.parse(localStorage.getItem("canamed_localdb_v1"));
});
console.log(localdb); // Pretty-print the in-memory DB
```

### Mock Time in Tests

```javascript
// Playwright can tick time (useful for timeout tests)
await page.clock.install();
await page.clock.tick(5000); // Advance 5 sec
```

Not used yet; would be useful for testing late-arrival (stage-advance timeout).

## Continuous Improvement

### Metrics to Track

- Test execution time (target: unit <5 sec, E2E <2 min)
- Test pass rate (target: 100% on main)
- Code coverage (target: 85%+)
- Flakiness (target: 0% flaky tests)

### Known Flaky Tests

None reported so far (LocalDB is deterministic, no network).

### Future Test Additions

1. **Performance tests:** Measure page load time, rendering time
2. **Accessibility tests:** Run axe-core on each stage
3. **Localization tests:** Verify all [data-i18n] nodes are translated
4. **Firebase rules emulator tests:** Separate test suite using Firebase Emulator
5. **Mobile E2E tests:** Add webkit, firefox devices to Playwright config
6. **Stress tests:** 100+ users in one session, measure DB performance

## Related Docs

- `README.md` → "Running Locally" for dev setup
- `script-js-map.md` → Function reference (what's tested)
- `data-model.md` → Database schema (what rules protect)
