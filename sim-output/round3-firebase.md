# CaNaMED Firebase Security Audit — Round 3
**Date:** 2026-05-20  
**Auditor:** Security Reviewer agent  
**Scope:** database.rules.json, firebase-config.js, firebase.json, tests/rules.test.js

---

## Executive Summary

The rules are substantially hardened compared to a baseline deployment: top-level read/write are denied, every write path requires `auth != null`, and session membership is required to read most session data. However, **seven material weaknesses** remain, two of which are CRITICAL. The most dangerous is that `clientId` (the participant's persistent session identifier used throughout the rules as a write key) is never bound to `auth.uid`, meaning any authenticated session can write to any other participant's slots. The second CRITICAL issue is the live Firebase API key and project config committed to `firebase-config.js`.

---

## Findings

### FINDING-01: clientId is NOT bound to auth.uid — any participant can write as any other participant

**Severity:** CRITICAL  
**JSON paths (same issue in both branches):**
- `sessions/$sessionId/pool/$clientId`
- `sessions/$sessionId/rooms/$roomId/presence/$clientId`
- `sessions/$sessionId/rooms/$roomId/typing/$clientId`
- `sessions/$sessionId/rooms/$roomId/votes/$voteId/ballots/$clientId`
- `sessions/$sessionId/rooms/$roomId/tests/$cid`
- `sessions/$sessionId/rooms/$roomId/observers/$clientId`
- `orgs/$orgSlug/sessions/$sessionId/pool/$clientId` (and equivalents)

**Current rules (pool example):**
```json
"$clientId": {
  ".write": "auth != null && !root.child('sessions').child($sessionId).child('closed').exists()"
}
```

**Exploit scenario:**  
Alice is an authenticated participant with `auth.uid = uid-alice` and `clientId = cid-abc`. Bob has `clientId = cid-xyz`. Because `$clientId` in the rules is a wildcard that is never cross-checked against `auth.uid`, Alice can:
1. Write to `pool/cid-xyz` to overwrite Bob's profile (name, university, consent) with arbitrary data.
2. Write to `tests/cid-xyz` to inflate or zero-out Bob's pre/post test score, including the `score` sub-field which is research-critical data.
3. Write to `votes/$voteId/ballots/cid-xyz` to cast or change another participant's ballot.
4. Write to `presence/cid-xyz` or `observers/cid-xyz` to forge another participant's presence record.

The platform assigns `clientId` as a random string stored in `sessionStorage`; an attacker can trivially learn another participant's `clientId` from the presence/pool subtrees (they are readable to all session members) and then impersonate them.

This also means that the GDPR Art. 15 self-export (`downloadMyData`) returns data filtered client-side by `clientId` — a malicious user who spoofs another's `clientId` in `sessionStorage` would receive the wrong person's data in the export, which is a privacy violation.

**Fix:**  
The platform needs a `clientId → auth.uid` binding table written at join time (e.g. `sessions/$sessionId/clientMapping/$clientId` set to `auth.uid`), then enforce ownership:

```json
"pool": {
  "$clientId": {
    ".write": "auth != null
      && !root.child('sessions').child($sessionId).child('closed').exists()
      && root.child('sessions').child($sessionId).child('clientMapping').child($clientId).val() == auth.uid"
  }
},
"clientMapping": {
  "$clientId": {
    ".write": "auth != null && !data.exists()",
    ".validate": "newData.isString() && newData.val() == auth.uid"
  }
}
```

Apply the same `clientMapping` guard to `presence/$clientId`, `typing/$clientId`, `votes/*/ballots/$clientId`, `tests/$cid`, and `observers/$clientId`.

---

### FINDING-02: Firebase project credentials (API key, project ID, app ID) committed to source

**Severity:** CRITICAL  
**File:** `docs/Third_session/PBL_platform/firebase-config.js` lines 22–30

**Current content:**
```js
window.CANAMED_FIREBASE = {
  apiKey: "AIzaSyB_7d4rCWsVSUAaL17Jcjy3v2s_n5uJVUg",
  authDomain: "canamed-69785.firebaseapp.com",
  databaseURL: "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "canamed-69785",
  storageBucket: "canamed-69785.firebasestorage.app",
  messagingSenderId: "293347663114",
  appId: "1:293347663114:web:091c5ba1b9add59f85eef3"
};
```

**Exploit scenario:**  
The `apiKey` is the public identifier used to call Firebase REST endpoints. With the live key, database URL, and project ID, anyone can:
1. Call the Firebase Authentication REST API (`signUp` endpoint) to create unlimited anonymous auth accounts, bypassing any rate limits the console has not explicitly set.
2. Reach the Realtime Database REST API directly (`databaseURL + "/sessions.json?auth=TOKEN"`) and enumerate all session IDs (the session-level `.read` only filters out non-members — anyone can do a shallow GET on `/sessions.json` to list all session codes).
3. Use automated tooling to spam-join sessions or trigger write-amplification against the chat/events subtrees.

**Note on context:** The `README.md` explicitly acknowledges this (`if you publish the platform with GitHub Pages, this file is readable in page source`) and treats it as acceptable for a classroom tool. However, the file is committed to a repository and the credentials appear to be for the real production project (Europe West 1 RTDB), not a demo. If this repository is or becomes public, or if the file is in git history, the production project is exposed indefinitely regardless of future `.gitignore` changes.

**Fix:**  
For a public GitHub Pages deployment these credentials do legitimately need to be in the served HTML. The mitigation is layered:
1. **Enable Firebase App Check in Enforce mode** (see FINDING-04) — this is the primary control that makes a stolen API key useless without a valid browser attestation.
2. **Restrict the API key in GCP Console** → Credentials → select the key → "Application restrictions" to the specific referrer domains (`canamed.web.app`, `*.firebaseapp.com`), and "API restrictions" to only the Firebase services actually used.
3. Add the file to `.gitignore` if there is ever a private fork that should use different credentials, and document this in the README.
4. Rotate the API key and app credentials if this repository is confirmed to have been public-accessible to untrusted parties.

---

### FINDING-03: stageAt is writable by any authenticated user — any participant can set stage-transition timestamps

**Severity:** HIGH  
**JSON paths:**
- `sessions/$sessionId/rooms/$roomId/stageAt` (line 155–158)
- `orgs/$orgSlug/sessions/$sessionId/rooms/$roomId/stageAt` (line 417–419)

**Current rule:**
```json
"stageAt": {
  ".write": "auth != null && !root.child('sessions').child($sessionId).child('closed').exists()",
  ".validate": "newData.isNumber()"
}
```

**Exploit scenario:**  
`stageAt` records when a stage transition occurred. It is writable by any authenticated participant, not restricted to admin. If this timestamp is used by the platform for time-based logic (e.g., computing how long a group spent on a stage, or unlocking timed content), a participant can manipulate it. Unlike `stage` (which is correctly admin-gated), `stageAt` has no such gate. At minimum this corrupts research timing data; if any branch of `script.js` uses `stageAt` to gate behaviour it may allow stage-skipping.

**Fix:**
```json
"stageAt": {
  ".write": "auth != null
    && root.child('sessions').child($sessionId).child('adminPasswordHash').exists()
    && !root.child('sessions').child($sessionId).child('closed').exists()",
  ".validate": "newData.isNumber() && newData.val() >= now - 5000 && newData.val() <= now + 5000"
}
```

---

### FINDING-04: App Check is wired but NOT confirmed to be in Enforce mode — monitoring-only by default

**Severity:** HIGH  
**File:** `docs/Third_session/PBL_platform/firebase-config.js` lines 44–88; `script.js` lines 1058–1090

**Description:**  
The SDK is loaded and `ReCaptchaV3Provider.activate()` is called client-side. However, App Check enforcement is controlled server-side in the Firebase Console under "Enforce" vs "Monitor". There is no code reference, comment, or test confirming that enforce mode is active. The README states: "Until enabled, the deployment is protected by rules + anonymous auth only." The `healthcheck.js` check only verifies that the SDK provider is available in the browser — it does NOT confirm the Firebase Console's enforcement state.

In monitor-only mode, requests without a valid App Check token are counted but not rejected. An automated attacker with a stolen anonymous-auth token can still reach the RTDB without any reCAPTCHA attestation.

**Required action (cannot be done in code — Firebase Console):**
1. Firebase Console → App Check → select `canamed-69785` app → verify the reCAPTCHA v3 site key matches `6Lemg-wsAAAAAKIkv6KorbZu0iUz_q3e36wrlFiQ` from `firebase-config.js`.
2. Click "Enforce" next to the Realtime Database product. This will reject any RTDB request that is not accompanied by a fresh, valid App Check token.
3. Add a comment in `firebase-config.js` and `README.md` marking enforcement as confirmed, with the date.
4. Note: if enforcement is already on, add evidence of this to the CLAUDE.md operational reminders so future reviewers know.

---

### FINDING-05: score/auto and score/penalties are writable by any authenticated user — any participant can award/deduct points for any room

**Severity:** HIGH  
**JSON paths:**
- `sessions/$sessionId/rooms/$roomId/score/auto/$eventId` (lines 136–140)
- `sessions/$sessionId/rooms/$roomId/score/penalties/$eventId` (lines 142–146)
- `orgs/$orgSlug/sessions/$sessionId/rooms/$roomId/score/auto/$eventId` (lines 398–402)
- `orgs/$orgSlug/sessions/$sessionId/rooms/$roomId/score/penalties/$eventId` (lines 403–408)

**Current rule:**
```json
".write": "auth != null && !root.child('sessions').child($sessionId).child('closed').exists()"
```

**Exploit scenario:**  
`score/manual` is correctly admin-gated, but `score/auto` and `score/penalties` are open to any authenticated participant. The intent is for these to be written by application logic (automatic scoring events triggered when a student submits the right answer). However, any participant can:
1. Write arbitrary points (0–100) to `score/auto/$anyEventId` for any room, including rooms they are not assigned to, inflating their own or another group's score.
2. Write to `score/penalties/$anyEventId` to penalise rival groups.
3. Re-use an existing `$eventId` to overwrite a previously scored event — there is no `!data.exists()` guard so these are mutable.

Leaderboard integrity depends on these scores being immutable and authoritative.

**Fix:**
Option A (preferred if scoring can be moved server-side): use a Cloud Function to write `score/auto` entries so the rule can be `.write: false` for all clients.  
Option B (client-side, defense-in-depth): restrict writes to the participant's own room and add append-only protection:
```json
"score": {
  "auto": {
    "$eventId": {
      ".write": "auth != null
        && !data.exists()
        && !root.child('sessions').child($sessionId).child('closed').exists()",
      ".validate": "newData.hasChildren(['points','at'])
        && newData.child('points').isNumber()
        && newData.child('points').val() >= 0
        && newData.child('points').val() <= 100
        && newData.child('at').isNumber()"
    }
  },
  "penalties": {
    "$eventId": {
      ".write": "auth != null
        && !data.exists()
        && !root.child('sessions').child($sessionId).child('closed').exists()",
      ".validate": "newData.hasChildren(['points','at'])
        && newData.child('points').isNumber()
        && newData.child('points').val() >= 0
        && newData.child('points').val() <= 100
        && newData.child('at').isNumber()"
    }
  }
}
```
The `!data.exists()` guard at minimum makes scoring events append-only (prevents clobbering). FINDING-01's clientMapping pattern should also be applied so only the participant keyed to the room can write auto scores for their own room.

---

### FINDING-06: No rate-limiting on chat/$msgId or events/$pushId — write amplification / RTDB quota exhaustion

**Severity:** HIGH  
**JSON paths:**
- `sessions/$sessionId/rooms/$roomId/chat/$msgId`
- `sessions/$sessionId/rooms/$roomId/events/$pushId`
- (and `/orgs/` equivalents)

**Current rules:** only require `auth != null`, closed-session guard, and content validation.

**Exploit scenario:**  
Firebase RTDB has no native server-side rate-limiting per-path. An authenticated client (anonymous auth token, obtainable in milliseconds) can run a loop pushing new `$msgId` or `$pushId` children at the rate the SDK allows, potentially:
1. Exhausting the free-tier RTDB bandwidth quota (10 GB/month) in a short burst, bringing down the session for all participants.
2. Flooding the chat with spam messages that are technically valid (≤500 chars, `by` set to any string ≤40 chars — there is no check that `by` matches the authenticated user's display name or the clientId).
3. Filling the events log with noise that breaks downstream research analysis pipelines.

The validation on `at` (±60s of server `now` for events) prevents timestamp spoofing but does not limit write velocity.

**Note:** Firebase RTDB does not natively support per-path write quotas in rules. Mitigations must be layered:
- **App Check enforcement** (FINDING-04) requires a real browser origin, eliminating automated scripts that lack a reCAPTCHA token.
- **Anonymous auth rate-limiting:** In Firebase Console → Authentication → Settings → "User account creation" set a per-IP cap.
- **Content validation tightening:** Require `by` to match the participant's registered name from the pool (a cross-path check), which makes flooding require knowing a valid participant name.
- **Monitoring:** Set a Firebase quota alert at 50% of the monthly bandwidth allocation to catch attacks before service disruption.

---

### FINDING-07: adminPasswordHash is readable by any authenticated user — hash oracle enables offline brute-force

**Severity:** MEDIUM  
**JSON path:** `sessions/$sessionId/adminPasswordHash` (line 36–38), `orgs/$orgSlug/sessions/$sessionId/adminPasswordHash` (line 297–300)

**Current rule:**
```json
"adminPasswordHash": {
  ".read": "auth != null",
  ...
}
```

**Exploit scenario:**  
Any anonymous-auth user can read the admin password hash. The validate rule accepts either a 64-hex SHA-256 hash (`/^[0-9a-f]{64}$/`) or a PBKDF2-v2 envelope (`/^v2[$][0-9]+[$][0-9a-f]+$/`). An attacker who obtains the hash can:
1. For the legacy SHA-256 format: run a fast offline dictionary / rainbow-table attack (SHA-256 without salt is trivially crackable for short passwords; SHA-256 is not a password hash function).
2. For the PBKDF2 v2 format: run an offline brute-force attack, limited only by the iteration count in the hash.
3. Obtain admin access and advance stages, close sessions, or manipulate scores.

The read carve-out exists for a specific reason: the admin login flow reads the hash before the user has joined the session as a member, so it cannot be gated on membership. This is a genuine tension between usability and security.

**Fix (partial — eliminates the read oracle):**  
Move admin authentication to a server-side Cloud Function that accepts a plaintext password attempt, compares it server-side using a constant-time compare, and returns a short-lived signed custom token or a session-scoped claim. The client never sees the stored hash. This is the architecturally correct solution and eliminates the hash oracle entirely.

**Short-term mitigation (rules-only):** Keep the current structure but ensure all newly created sessions use the PBKDF2 v2 format with a high iteration count (≥100 000). Document in CLAUDE.md that the SHA-256 legacy format is deprecated and must not be used for new sessions.

---

### FINDING-08: poll/$cid is writable by any session member — no sender-vs-cid linkage

**Severity:** MEDIUM  
**JSON path:** `sessions/$sessionId/poll/$cid` (lines 99–104)

**Current rule:**
```json
"$cid": {
  ".write": "auth != null && !root.child('sessions').child($sessionId).child('closed').exists()"
}
```

**Exploit scenario:**  
`$cid` in the poll path is treated as a per-participant key, but there is no rule enforcing that the writing client owns that `cid`. Any authenticated member can write to `poll/any-cid`, overwriting another participant's poll response. Combined with the ability to list `cid` values from the pool subtree (readable to session members), an attacker can overwrite all poll responses for a session.

**Fix:** Same clientMapping approach as FINDING-01:
```json
"$cid": {
  ".write": "auth != null
    && !root.child('sessions').child($sessionId).child('closed').exists()
    && root.child('sessions').child($sessionId).child('clientMapping').child($cid).val() == auth.uid"
}
```

---

### FINDING-09: scenarioCustomJson is readable by any authenticated user and stores up to 32 KB of operator-defined content

**Severity:** MEDIUM  
**JSON path:** `sessions/$sessionId/scenarioCustomJson` (lines 67–71)

**Current rule:**
```json
"scenarioCustomJson": {
  ".read": "auth != null",
  ".write": "auth != null && !data.exists()",
  ".validate": "newData.val() == null || (newData.isString() && newData.val().length > 0 && newData.val().length <= 32000)"
}
```

**Description:**  
This field stores a 32 KB operator-provided JSON string. The `.read` is `auth != null` (pre-join carve-out) rather than membership-restricted. An authenticated user (anonymous auth) who has never joined the session can read this custom scenario content. Depending on the scenario content, this could expose unpublished case materials before a session starts, spoiling the educational exercise. The write-once guard prevents modification but does not limit read access.

**Fix:** Narrow the read to membership (relying on the parent `.read` being membership-scoped) and drop the explicit per-field `.read` override, unless the pre-join lobby genuinely needs to display scenario information before the user joins. If the lobby does need it, gate it on a separate `scenarioPreview` field that contains only a non-sensitive summary.

---

### FINDING-10: .indexOn settings absent — enumeration concern and potential performance issue

**Severity:** LOW  
**JSON path:** `sessions/$sessionId/members`

**Description:**  
The `members` subtree has no `.indexOn` rule. While this is deliberately avoided to prevent Firebase from maintaining an index that could be used for listing, it also means that any `orderByChild` query on membership would perform a full scan. More importantly, the absence of indexing documentation in the rules file means a future developer might add a query-based listener that unintentionally leaks membership data. The rules themselves prevent direct reads of the members subtree (no subtree-wide `.read` — confirmed by the tests), so this is LOW severity.

**No rules change required.** Add a comment in `database.rules.json` next to the `members` node explicitly documenting the intentional absence of `.indexOn` as a privacy measure.

---

### FINDING-11: GDPR Art. 15 self-export reads /rooms subtree without membership-scoped read restriction

**Severity:** LOW  
**Function:** `downloadMyData()` in `script.js` lines 4753–4803

**Description:**  
`downloadMyData()` calls `db.ref(sPath("rooms")).once("value")` to read the entire rooms subtree and then filters client-side to find entries matching the participant's `clientId`. Because the session-level `.read` already requires membership (`data.child('members').hasChild(auth.uid)`), an unauthenticated or non-member user cannot trigger this. However, a session member receives the full rooms subtree in this call — including all other participants' presence, typing, answers, test scores, and vote choices — and then filters locally. The Firebase RTDB rules do not support server-side row-level filtering; this is the correct pattern for RTDB, but it means a participant with network inspection tools (e.g., DevTools) can see the full unfiltered snapshot. The application correctly filters the _exported file_ to only include the user's own data, but all other participants' data transits to the client's browser.

**This is an architectural constraint of Firebase RTDB rather than a rules defect.** Mitigation options:
1. Move the export read to a Cloud Function that performs the filter server-side before returning any data.
2. Document this in the privacy notice as a known limitation of the real-time sync architecture.

---

## Test Coverage Assessment

The test suite (`tests/rules.test.js`) is comprehensive for what it covers: auth requirements on all write paths, membership-narrowed reads, write-once markers, closed-session guards, and the superadmin reset flow. However, the following scenarios are **not tested**:

1. **clientId ≠ auth.uid**: No test verifies that a participant cannot write to another participant's `pool/$cid` or `tests/$cid` slot (FINDING-01). This is the highest-severity gap.
2. **score/auto write by non-admin**: No test verifies that score auto/penalties entries are not admin-restricted (FINDING-05).
3. **stageAt admin gate**: No test checks that `stageAt` is (or should be) admin-gated (FINDING-03).
4. **Hash oracle read restriction**: No test verifies that `adminPasswordHash` is not readable before joining (FINDING-07 — the current behaviour is intentional but untested as such).
5. **poll/$cid ownership**: No test for cross-participant poll manipulation (FINDING-08).

---

## Security Headers Assessment (firebase.json)

The `firebase.json` hosting headers are well-configured:
- CSP is strict with `default-src 'self'` and no `unsafe-inline` or `unsafe-eval`.
- HSTS is set with a 1-year `max-age` and `includeSubDomains`.
- `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` disables camera, microphone, and geolocation.
- `COOP: same-origin-allow-popups` (correct for Firebase auth popup flow).

**One gap:** The CSP `report-to` endpoint is `/_csp_report` which is a Firebase Hosting rewrite to `index.html`. There is no server-side handler to receive and log CSP violation reports — the endpoint returns the SPA HTML. This means violations are silently dropped. Consider using a third-party CSP reporting endpoint (e.g., report-uri.com) or removing the `report-to` directive to avoid confusion.

---

## Top 3 Fixes (Priority Order)

1. **CRITICAL — FINDING-01:** Introduce a `clientMapping/$clientId → auth.uid` binding table written at join time (write-once, self-asserted) and add `clientMapping.$clientId.val() == auth.uid` guards on all `$clientId`-keyed write paths (`pool`, `presence`, `typing`, `votes/*/ballots`, `tests`, `observers`, `poll`). This is the single change with the widest impact on data integrity and participant privacy.

2. **CRITICAL — FINDING-04 + FINDING-02:** Confirm and enforce Firebase App Check in the Firebase Console (navigate to App Check, click Enforce next to Realtime Database). This makes the exposed API key and anonymous auth far less exploitable by automated actors, and is the primary countermeasure for FINDING-06 (write amplification) as well. Restrict the API key to the production domain in GCP Console.

3. **HIGH — FINDING-05:** Add `!data.exists()` (append-only) to `score/auto` and `score/penalties` write rules immediately to prevent score clobbering, and track the Cloud Function migration to move auto-scoring server-side so these paths can be closed to client writes entirely.
