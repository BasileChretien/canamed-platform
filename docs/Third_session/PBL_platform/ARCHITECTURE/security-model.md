# Security Model

**Last Updated:** 2026-05-16
**Key Files:** `firebase-config.js`, `database.rules.json`, `index.html` (CSP meta), `firebase.json` (CSP headers), `lib.js` (hashing), `localdb.js` (test mode)

The platform uses layered, defense-in-depth security to protect participant data and prevent abuse. Each layer is independent so a breach of one does not compromise the others.

## Layer 1: App Check (reCAPTCHA v3)

**Purpose:** Verify every request comes from a real browser on THIS domain (prevent automated attacks, token theft).

**Implementation:**

```javascript
// firebase-config.js
window.CANAMED_RECAPTCHA_SITE_KEY = "6Lemg-wsAAAAAKIkv6KorbZu0iUz_q3e36wrlFiQ";
// Secret key stored in Firebase Console (not in source)
```

**Flow:**

1. On page load, Firebase SDK requests reCAPTCHA token from Google
2. Every Realtime Database call includes token in request header
3. Firebase verifies token with Google's reCAPTCHA backend
4. If token is invalid, request is rejected (even if auth is valid)

**Strengths:**

- Free tier: 10,000 assessments/month at no cost (no Cloud billing needed)
- Transparent: no CAPTCHA UI (v3 is invisible scoring)
- Defeats token theft: attacker with a valid Firebase auth token still cannot talk to the DB without a fresh reCAPTCHA attestation
- Domain-locked: reCAPTCHA only grants tokens for this domain (set in https://www.google.com/recaptcha/admin)

**Weaknesses:**

- No CAPTCHA UI: aggressive bots may still be incorrectly scored as human (rare; Google keeps false-negative rate low)
- Regional: if Google's reCAPTCHA service is blocked in a student's country, they cannot join (fallback: disable App Check in firebase-config.js and rely on other layers)
- Quota: if session exceeds 10k joins/month, switch to reCAPTCHA Enterprise (paid) or disable

**Setup:**

1. https://www.google.com/recaptcha/admin → register this domain
2. Copy SITE KEY (public) to window.CANAMED_RECAPTCHA_SITE_KEY in firebase-config.js
3. Copy SECRET KEY (private) to Firebase Console → App Check → reCAPTCHA secret key
4. Test: open platform in browser; check Firebase Console → App Check dashboard for incoming attestations

**Status:** Enabled by default (set in firebase-config.js). To disable: change value to null (platform still works, but attackers with stolen tokens can abuse DB).

## Layer 2: Anonymous Authentication + Database Rules

**Purpose:** Require every user to be authenticated; database rules enforce read/write permissions.

**Authentication:**

- **Anonymous auth (automatic):** Every visitor is automatically signed in anonymously on page load via Firebase Auth SDK
  - No password, no email—just a UID
  - Persistent: survives page reload (tied to browser)
  - Necessary: database rules require `auth != null` for all reads/writes
  
- **Google auth (optional):** Users can sign in with Google account
  - Used for profile persistence (name, university, year, English level saved across sessions)
  - Not required: session participation works with anonymous auth alone
  - First sign-in routes to profile setup; subsequent sign-ins auto-fill join form

**Database Rules (database.rules.json):**

**Root:**
```
.read: false
.write: false
```
All denied by default; paths open selectively.

**User reads:**
```
users/{uid}/profile: .read: "auth != null && auth.uid == $uid"
→ You can read your own profile, no one else's
```

**Session reads:**
```
sessions/{$sessionId}/*: .read: "auth != null"
→ Anyone authenticated can read session data (needed to show stage, presence, etc.)
```

**Admin writes:**
```
stage: .write: "auth != null && 
  root.child('sessions').child($sessionId).child('adminPasswordHash').exists() && 
  !root.child('sessions').child($sessionId).child('closed').exists()"
→ Only someone who set a password can write stage (implicit: they know the password)
```

**Post-close lock:**
```
pool, answers, moduleA, votes, score: .write: "... && 
  !root.child('sessions').child($sessionId).child('closed').exists()"
→ Once session is closed, all writes are banned (immutable archive)
```

**Strengths:**

- Fine-grained: rules are path-specific, not all-or-nothing
- Immutability constraints: password, created, closed can only be written once (`.write: "!data.exists()"`)
- Validation: all writes are checked for type, length, format (e.g., URLs must match https regex)
- Transparent: rules are public source code in database.rules.json (users can audit them)

**Weaknesses:**

- Rules are NOT encrypted: anyone can read the .json file
- Rules are NOT input sanitization: they validate format but don't prevent XSS if data is rendered unsafely (HTML escaping in script.js prevents this)
- Rules cannot access external systems (e.g., cannot call a password-strength API)

## Layer 3: Password Hashing (PBKDF2v2)

**Purpose:** Admin password is hashed (not stored in plaintext) so Firebase personnel or database backups don't reveal it.

**Implementation:**

```javascript
// lib.js, lines ~200–230
function hashPassword(password, iterations = 100000, version = 2)
```

**Algorithm:** PBKDF2-SHA256 with 100,000 iterations (as of v2)

**Format:**

```
v2$100000$<salt_hex>
```

- v2: algorithm version (allows v1→v2 upgrade path)
- 100000: iteration count
- salt_hex: 32-char hex-encoded random salt (generates fresh salt per password)

**Flow:**

1. Facilitator enters password on splash ("Create session")
2. hashPassword(password) is called (in browser, client-side)
3. Hash is written to database as adminPasswordHash
4. Plaintext is NOT sent to the server
5. On admin login, user enters password again
6. Browser hashes it, compares with stored hash (constant-time compare)
7. Match = login; mismatch = "password incorrect" toast

**Strengths:**

- Client-side hashing: plaintext never leaves the browser
- Salted: each password has a unique salt, defeating rainbow tables
- Iterative: 100,000 rounds makes brute-force slow (e.g., 10 billion guesses at 1ms/guess = 116 days)
- Versioned: can bump iteration count in v3 without invalidating v2 hashes
- Transparent: hash function is pure JS in lib.js (auditable)

**Weaknesses:**

- Client-side hashing is not ideal for production: browser JavaScript is slow (2–5 sec to hash one password)
- No server-side server-side pepper: attacker with DB dump can brute-force hashes (but 100k iterations + salt slow this down)
- XSS vulnerability could expose plaintext before hashing (mitigated by CSP, below)

**Testing:**

```bash
npm test  # Runs lib.test.js which includes password hashing tests
```

## Layer 4: Content Security Policy (CSP)

**Purpose:** Prevent inline script injection, XSS, and clickjacking.

**Delivery:**

- **HTTP headers (production):** firebase.json specifies CSP headers (strongest)
- **Meta tag fallback (offline):** index.html includes CSP meta tag (weaker, but better than nothing if headers are stripped)

**Headers (firebase.json, lines 27):**

```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' 
    https://www.gstatic.com 
    https://apis.google.com 
    https://www.google.com/recaptcha/ 
    https://www.recaptcha.net/recaptcha/;
  connect-src 'self' 
    https://*.firebaseio.com wss://*.firebaseio.com 
    https://*.firebasedatabase.app wss://*.firebasedatabase.app 
    https://*.googleapis.com 
    https://accounts.google.com 
    https://content-firebaseappcheck.googleapis.com 
    https://www.google.com/recaptcha/ 
    https://www.recaptcha.net/recaptcha/;
  frame-src https://canamed-69785.firebaseapp.com 
    https://accounts.google.com 
    https://www.google.com/recaptcha/ 
    https://www.recaptcha.net/recaptcha/;
  frame-ancestors 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: 
    https://www.googleusercontent.com 
    https://lh3.googleusercontent.com;
  object-src 'none';
  base-uri 'self';
  form-action 'none'
```

**Directives:**

| Directive | Policy | Effect |
|-----------|--------|--------|
| default-src | 'self' | Only load resources from this domain by default |
| script-src | 'self' + Firebase + Google + reCAPTCHA | Only Firebase SDK, Google auth, reCAPTCHA scripts allowed (no inline <script>) |
| connect-src | 'self' + Firebase + Google + reCAPTCHA | Only these origins for fetch/WebSocket (DB calls, auth, token attestation) |
| frame-src | Firebase, Google, reCAPTCHA | Only these can be framed (for auth popups, reCAPTCHA widget) |
| frame-ancestors | 'self' | Platform can only be framed by itself (prevents clickjacking from attacker domains) |
| style-src | 'self' + 'unsafe-inline' | Inline CSS allowed (for theming, splash colors) but no external stylesheets |
| img-src | 'self' + data: + Google CDN | Images from this domain, embedded data: URIs, Google profile pictures |
| object-src | 'none' | No Flash, Silverlight, or Java (disable legacy plugins) |
| form-action | 'none' | No form submissions (all data flows via Firebase, not HTTP POST) |

**Enforcement:**

- Browser blocks any violation (console warning + request blocked)
- No fallback: a blocked script does not load
- Refresh required: CSP does not auto-unblock if header is fixed

**Strengths:**

- Prevents inline <script> injection (attacker cannot inject `<script>alert(1)</script>`)
- Domain-locked: attacker cannot fetch malicious scripts from attacker.com
- No form submission: prevents CSRF (form-action 'none')
- Transparent: policy is public (auditable in browser DevTools)

**Weaknesses:**

- style-src 'unsafe-inline' is weak (attacker can inject <style> to exfiltrate data via CSS selectors, though impractical for text data)
- Reports not enabled: CSP violations are not logged to a server (check browser console manually)
- Inline script fallback in meta tag is weaker (browsers may ignore certain directives in meta CSP)

**Testing:**

1. Open DevTools Console
2. Inject malicious script: `<script>alert('XSS')</script>` in HTML editor
3. Check console for "Refused to execute inline script..." message
4. Script should NOT execute

## Layer 5: HTTPS + HSTS + Other Headers

**Purpose:** Encrypt in-flight data, prevent downgrade attacks, prevent framing.

**Headers (firebase.json):**

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
→ Browser must use HTTPS for 1 year; upgrade any http:// to https://

X-Frame-Options: SAMEORIGIN
→ Platform can only be framed by this domain (prevents clickjacking)

X-Content-Type-Options: nosniff
→ Browser must respect Content-Type header (prevents MIME-type confusion attacks)

Referrer-Policy: strict-origin-when-cross-origin
→ When linking to external sites, only send the origin (not full URL path)

Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
→ Disable camera, mic, geolocation, FLoC (user privacy)

Cross-Origin-Opener-Policy: same-origin-allow-popups
→ Isolate window.opener access for Google auth popup
```

**Strengths:**

- HSTS preloading: once visited, browser locks to HTTPS (even if attacker intercepts DNS)
- Prevents framing: X-Frame-Options + CSP frame-ancestors prevent clickjacking
- MIME-type safety: browser respects Content-Type (no confusion attacks)
- Privacy: referrer policy, permissions policy, COOP all opt-out of tracking

**Weaknesses:**

- First-visit vulnerability: attacker can MITM before HSTS kicks in (add domain to HSTS preload list for 1st-visit protection)
- Certificates: if CA is compromised, HTTPS is broken (mitigated by HTTPS certificate pinning, not implemented here)

## Layer 6: Input Validation

**Purpose:** Catch malformed input before writing to database.

**Locations:**

1. **lib.js (pure functions):**
   - `sanitizeCode(raw)`: normalize session code (lowercase, [a-z0-9_-], max 20 chars)
   - `sanitizeResume(r)`: clamp all localStorage fields to safe values
   - `normalizeForScore(s)`: accent-strip + whitespace-collapse for scoring (forgiving to 2nd-language answers)
   - `safeHref(url)`: validate Teams/questionnaire links are https:// only

2. **database.rules.json (validation layer):**
   - All string fields have length limits (e.g., name <= 40 chars)
   - All URLs must match /^https:\/\/[^\s]+$/ (regex check for https)
   - All numbers have min/max (e.g., year 1–7, stage 0–3)
   - Type checks (isString, isNumber, isBoolean)

3. **script.js (UI layer):**
   - Form inputs clamped (maxlength in HTML)
   - HTML escaping: answer text, participant names, etc. are set via textContent (not innerHTML)

**Strengths:**

- Multi-layer: input validated at UI, database, and rules level
- Consistent: lib.js is tested (npm test covers sanitizeCode, sanitizeResume, etc.)
- Graceful: invalid input is rejected with user-friendly error message

**Weaknesses:**

- Client-side: all validation can be bypassed via DevTools
- Database rules allow a wide range of input (e.g., any string <= 40 chars for name)

## Layer 7: Secrets Management

**Sensitive Data:**

| Secret | Storage | Visibility | Risk |
|--------|---------|------------|------|
| Firebase API Key | firebase-config.js | PUBLIC (in page source) | Low: API key is public for web apps; restricted to Firebase database only |
| reCAPTCHA Site Key | firebase-config.js | PUBLIC | Low: site key is meant to be public |
| reCAPTCHA Secret Key | Firebase Console | PRIVATE (admin only) | High: never commit to source; breach = anyone can fake reCAPTCHA tokens |
| Super-admin key | firebase-config.js | PUBLIC (if using GitHub Pages) | High: holder can set session passwords; disable in production |
| Admin password | database.rules.json (hash) | PUBLIC (hash only) | Low: hash is salted + iterated; brute-force is slow |
| Participant data | Firebase RTDB | Protected by auth + App Check | Medium: encrypted in transit (HTTPS); at-rest encryption depends on Google Cloud |

**Best Practices:**

1. **reCAPTCHA Secret Key:**
   - NEVER commit to source (use Firebase Console instead)
   - Rotate if compromised (generate new key pair in https://www.google.com/recaptcha/admin)

2. **Super-admin Key:**
   - Keep it null in public deployments (default)
   - If using a super-admin key, keep it in a local, unpublished copy of firebase-config.js
   - Rotate before every session (change CANAMED_SUPERADMIN_KEY in local copy, set password via Firebase Console, then reset to null)

3. **Firebase Credentials:**
   - API keys are public for web apps (expected)
   - Restrict to Realtime Database (not Cloud Storage, not Cloud Functions)
   - Set rules (database.rules.json) to enforce auth + App Check

4. **Participant Data:**
   - Encrypted in transit (HTTPS + CSP)
   - At-rest encryption: provided by Google Cloud (outside scope of this platform)
   - Deletion: use "Download My Data" feature to export before closing session

## Layer 8: Test Mode (LocalDB)

**Purpose:** Allow offline testing without Firebase Realtime Database.

**Implementation:**

- **firebase-config.js:** If CANAMED_FIREBASE is null, platform switches to LocalDB mode
- **localdb.js:** A 150-line localStorage-backed Firebase Realtime Database mock
- **Sync model:** storage event fires on OTHER tabs when one tab writes; LocalDB calls _notifyAll() for its own listeners
- **onDisconnect:** Handlers fire on beforeunload (mimics Firebase semantics)

**Testing Flow:**

1. Leave CANAMED_FIREBASE as null (default in firebase-config.js)
2. Open platform: automatically uses LocalDB (no Firebase calls)
3. Open multiple tabs: they see the same data (storage event syncs)
4. Close a tab: that tab's presence is cleaned up (onDisconnect)

**Test Suite:**

```bash
npm test              # Unit tests (lib.js, i18n.js, telemetry.js, rules validation)
npm run test:e2e      # E2E tests (Playwright, LocalDB mode, full UI flows)
npm run test:local    # Same as test:e2e, uses local static server
```

**Strengths:**

- No Firebase credentials needed
- Hermetic: each test run starts fresh
- Fast: localStorage is synchronous (no network latency)
- Auditable: localdb.js is pure JavaScript, no external dependencies

**Weaknesses:**

- Not production: localStorage has a 5–10 MB limit (enough for one session, not an archive)
- Single-device only: multiple devices cannot sync (need real Firebase for multi-device)
- No persistence across browser restart: localStorage is cleared if cache is deleted

## Known Limitations & TODO

1. **No HTTPS certificate pinning:** If a CA is compromised, MITM becomes possible (mitigated by HSTS preloading)

2. **Client-side password hashing is slow:** 2–5 sec to hash a password in the browser (alternative: server-side hashing via Firebase Functions, not implemented)

3. **Admin password is not rate-limited:** Attacker can make unlimited login attempts (alternative: implement exponential backoff or Firebase Security Rules to lock after N failures)

4. **Session codes are short (20 chars):** Low entropy against brute-force guessing (mitigated by App Check + DB rules requiring auth)

5. **No audit logging:** Session actions are not logged to a server-side audit table (alternative: Firebase Cloud Functions to write events to a separate collection)

6. **Consent versioning is simple:** consent.version is a string that must match globally (alternative: per-user consent versioning with opt-in to new versions)

7. **Super-admin key is hardcoded:** No key rotation mechanism (alternative: move to Firebase Cloud Functions with service-account auth)

## Security Checklist (Pre-Deployment)

- [ ] CANAMED_FIREBASE is set to production credentials (not test mode)
- [ ] CANAMED_SUPERADMIN_KEY is null (or stored in a private local copy only)
- [ ] CANAMED_RECAPTCHA_SITE_KEY is set; SECRET KEY is in Firebase Console (not in source)
- [ ] database.rules.json is deployed (firebase deploy --only database)
- [ ] firebase.json CSP headers are deployed (firebase deploy --only hosting)
- [ ] HTTPS is enforced (check Firebase Hosting settings)
- [ ] HSTS preloading is enabled (submit domain at https://hstspreload.org/)
- [ ] Consent language is correct and versioned (privacy.html + consent.version in code)
- [ ] Session codes are generated fresh (not hardcoded)
- [ ] Test mode (LocalDB) is not used in production (CANAMED_FIREBASE must not be null)

## Related Docs

- `README.md` → "Enabling App Check" step-by-step
- `data-model.md` → Database rule details
- `script-js-map.md` → Which functions handle auth, password, consent
