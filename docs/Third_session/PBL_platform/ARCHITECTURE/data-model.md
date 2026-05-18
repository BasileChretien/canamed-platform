# Firebase Realtime Database Schema

**Last Updated:** 2026-05-16
**Authoritative Source:** `database.rules.json` (lines 1–185)

The CaNaMED platform stores all session state in Firebase Realtime Database (or localStorage in test mode via localdb.js). This doc describes the path hierarchy, data types, read/write authorities, and validation rules.

## Root-Level Rules

```
.read: false
.write: false
```

All reads and writes are denied by default; specific paths open up selectively (see below).

## User Profiles & History

### users/{uid}/profile

**Read/Write Authority:**
- `.read: "auth != null && auth.uid == $uid"` — users can read their own profile only
- `.write: "auth != null && auth.uid == $uid"` — users can write their own profile only

**Schema:**
```json
{
  "name": "string, 1–40 chars, required",
  "university": "string, 0–40 chars",
  "year": "number, 1–7",
  "english": "string, 2–4 chars (e.g. 'B2')",
  "updatedAt": "number (timestamp ms)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.child('name').isString() && 
  newData.child('name').val().length > 0 && 
  newData.child('name').val().length <= 40 && 
  newData.child('university').isString() && 
  newData.child('university').val().length <= 40 && 
  newData.child('year').isNumber() && 
  newData.child('english').isString() && 
  newData.child('english').val().length <= 4 && 
  newData.child('updatedAt').isNumber()
)"
```

**Notes:**
- null delete allowed (cascade deletion of whole profile)
- Set via saveProfile() in script.js after Google signin or profile edit
- Survives across sessions (used to auto-fill join forms)

### users/{uid}/history/{code}

**Read/Write Authority:**
- `.read: "auth != null && auth.uid == $uid"` — user can read own history
- `.write: "auth != null && auth.uid == $uid"` — user can add/remove from own history

**Schema:**
```json
{
  "code": "string, 1–30 chars (session code)",
  "joinedAt": "number (timestamp ms)",
  "workshopName": "string, 0–80 chars (optional)",
  "scenarioName": "string, 0–80 chars (optional)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.child('code').isString() && 
  newData.child('code').val().length <= 30 && 
  newData.child('joinedAt').isNumber() && 
  (!newData.hasChild('workshopName') || 
    (newData.child('workshopName').isString() && 
     newData.child('workshopName').val().length <= 80)) && 
  (!newData.hasChild('scenarioName') || 
    (newData.child('scenarioName').isString() && 
     newData.child('scenarioName').val().length <= 80))
)"
```

**Notes:**
- Optional workshopName/scenarioName fields (appear only if user was in a named workshop)
- Written by pushSessionToHistory() after participant joins
- Used for "recent sessions" dropdown in account dialog
- Helps users re-join a session without re-typing the code

## Sessions

Top-level session isolation: all session data lives under `sessions/{sessionCode}/`.

### sessions/{sessionCode}/adminPasswordHash

**Read/Write Authority:**
- `.read: "auth != null"` — any authenticated user can read (needed to verify password)
- `.write: "auth != null && !data.exists()"` — write ONLY if not already set (immutable)

**Schema:**
```
"string"
Matches: /^[0-9a-f]{64}$/ (legacy PBKDF2v1, hex-encoded)
       OR /^v2\$[0-9]+\$[0-9a-f]+$/ (PBKDF2v2, algorithm versioned)
```

**Notes:**
- Immutable once set: admin cannot change password mid-session
- Super-admin can set it once per session (via super-admin key in firebase-config.js)
- Verified via hashPassword() + constant-time compare in lib.js
- v1 vs v2 versioning allows algorithm upgrade path

### sessions/{sessionCode}/created

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !data.exists()"` — immutable, write-once at creation

**Schema:**
```json
{
  "by": "string, 1–40 chars (facilitator name who created)",
  "at": "number (timestamp ms)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['by', 'at']) && 
  newData.child('by').isString() && 
  newData.child('by').val().length > 0 && 
  newData.child('by').val().length <= 40 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- Set by createSession() in script.js
- Records who created the session and when
- Immutable for audit trail

### sessions/{sessionCode}/workshopLabel, scenarioId, scenarioCustomJson

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !data.exists()"` — immutable at creation

**Schema:**

**workshopLabel:**
```
"string, 0–80 chars (e.g., 'CaNaMED Session 3 - Caen Site')"
```

**scenarioId:**
```
"string, 1–60 chars, matches /^[a-z0-9_-]+$/
(e.g., 'chronic-pain-v1', 'breaking-bad-news')"
```

**scenarioCustomJson:**
```
"string, 1–32000 chars (JSON-encoded CASE/SCORING/PENALTIES/DECISIONS)"
```

**Notes:**
- Immutable: set at session creation, not changeable by admin mid-session
- scenarioCustomJson is a stringified JSON object (validated by validateScenarioJson() in script.js before write)
- Both can be null (use defaults from case-content.js)

### sessions/{sessionCode}/started, closed

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && root.child('sessions').child($sessionId).child('adminPasswordHash').exists() && !root.child('sessions').child($sessionId).child('closed').exists()"`
  (Only admin, and only if session not yet closed)

**Schema:**

**started:**
```
boolean (true when admin clicks "Start session", false not present)
```

**closed:**
```json
{
  "by": "string, 1–40 chars (admin name)",
  "at": "number (timestamp ms)"
}
```
OR null (not present).

**Validation:**

**started:**
```
.validate: "newData.isBoolean()"
```

**closed:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['by', 'at']) && 
  newData.child('by').isString() && 
  newData.child('by').val().length > 0 && 
  newData.child('by').val().length <= 40 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- started=true triggers room assignment (if not already done)
- Once closed exists, no more writes allowed to the entire session (gated at the root of all write rules)
- closeSession() sets this; immutable once set

### sessions/{sessionCode}/roomCount, teamsLink, questionnaireLink, preQuestionnaireLink

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && root.child('sessions').child($sessionCode).child('adminPasswordHash').exists() && !root.child('sessions').child($sessionCode).child('closed').exists()"`
- roomCount additionally requires: `&& root.child('sessions').child($sessionCode).child('started').val() != true` (immutable once started)

**Schema:**

**roomCount:**
```
number, 1–20
```

**teamsLink, questionnaireLink, preQuestionnaireLink:**
```
"string, 0–500 chars
Empty string allowed (means no link set).
If non-empty, must match /^https:\/\/[^\s]+$/ (https URL only)"
```

**Validation:**

**roomCount:**
```
.validate: "newData.isNumber() && 
  newData.val() >= 1 && 
  newData.val() <= 20"
```

**teamsLink, etc:**
```
.validate: "newData.isString() && newData.val().length <= 500 && 
  (newData.val() == '' || newData.val().matches(/^https:[/][/][^\s]+$/))"
```

**Notes:**
- roomCount set before start, immutable after
- teamsLink passed to <button> href; sanitizeHref() (lib.js) double-checks it's https
- All links are admin-writable (can paste from Teams meeting or Qualtrics survey)

## Pool (Waiting Room)

### sessions/{sessionCode}/pool/{clientId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists()"`
  (Any authenticated user, but not after session closed)

**Schema:**
```json
{
  "name": "string, 1–40 chars (participant name)",
  "university": "string, 0–40 chars (cohort ID or label)",
  "year": "number, 1–7 (year of study)",
  "english": "string, 2–4 chars (CEFR level: A2, B1, B2, C1, C2)",
  "at": "number (timestamp ms, when joined)",
  "room": "string, 0–30 chars (assigned room name, optional)",
  "consent": {
    "workshop": "boolean (consented to workshop participation)",
    "research": "boolean (consented to research data use)",
    "version": "string, 0–40 chars (consent form version)",
    "at": "number (timestamp ms, when consented)"
  }
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['name', 'university', 'year', 'english', 'at']) && 
  newData.child('name').isString() && 
  newData.child('name').val().length > 0 && 
  newData.child('name').val().length <= 40 && 
  newData.child('university').isString() && 
  newData.child('university').val().length <= 40 && 
  newData.child('year').isNumber() && 
  newData.child('english').isString() && 
  newData.child('english').val().length <= 4 && 
  newData.child('at').isNumber()
)"

room: ".validate: newData.val() == null || 
  (newData.isString() && newData.val().length <= 30)"

consent: ".validate: newData.val() == null || (
  newData.hasChildren(['workshop', 'research', 'version', 'at']) && 
  newData.child('workshop').isBoolean() && 
  newData.child('research').isBoolean() && 
  newData.child('version').isString() && 
  newData.child('version').val().length <= 40 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- clientId is a temporary browser-scoped ID (set in script.js on page load)
- room field is written by assignRooms() after admin starts the session
- consent is written by joinParticipant() before pool write (records GDPR consent)
- Deleted when user leaves or session is archived
- clientId != userId (userId is Firebase auth UID; clientId is ephemeral per browser tab)

## Rooms

### sessions/{sessionCode}/rooms/{roomName}/stage

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && root.child('sessions').child($sessionCode).child('adminPasswordHash').exists() && !root.child('sessions').child($sessionCode).child('closed').exists()"`
  (Only admin)

**Schema:**
```
number, 0–3
0 = Welcome
1 = Module A (Chronic Pain)
2 = Module B (Breaking Bad News)
3 = Wrap-up
```

**Validation:**
```
.validate: "newData.isNumber() && 
  newData.val() >= 0 && 
  newData.val() <= 3"
```

**Notes:**
- Set by setRoomStage() (script.js) when admin presses Back/Forward buttons
- Broadcast to all participants in that room (they re-render on change)
- Only admin can write; participants can only read

### sessions/{sessionCode}/rooms/{roomName}/stageAt

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists()"`

**Schema:**
```
number (timestamp ms when current stage was entered)
```

**Notes:**
- Written automatically when stage changes (used for late-arrival detection)

### sessions/{sessionCode}/rooms/{roomName}/teamName

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists()"`

**Schema:**
```
"string, 1–40 chars (e.g., 'Pain Warriors', 'The Diagnosticians')"
OR null (not set yet)
```

**Notes:**
- Participants can choose a team name via initTeamName() (script.js)
- Displayed on team cards and in presence list

### sessions/{sessionCode}/rooms/{roomName}/callForHelp

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists()"`

**Schema:**
```json
{
  "by": "string, 0–40 chars (name of person requesting help)",
  "at": "number (timestamp ms)",
  "msg": "string, 0–200 chars (optional message)",
  "ack": "boolean (true if admin has acknowledged)"
}
```
OR null (no call active).

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['by', 'at']) && 
  newData.child('by').isString() && 
  newData.child('by').val().length <= 40 && 
  newData.child('at').isNumber()
)"

msg: ".validate: newData.val() == null || 
  (newData.isString() && newData.val().length <= 200)"

ack: ".validate: newData.val() == null || newData.isBoolean()"
```

**Notes:**
- Written by renderCallProf() when user clicks "Call a facilitator"
- Admin sees red badge on room card
- Opening room in admin view clears the alert (visual feedback that facilitator arrived)

### sessions/{sessionCode}/rooms/{roomName}/presence/{clientId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists()"`

**Schema:**
```json
{
  "name": "string, 1–40 chars (participant name)",
  "at": "number (timestamp ms, last heartbeat)"
}
```
OR null (user left room).

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['name', 'at']) && 
  newData.child('name').isString() && 
  newData.child('name').val().length <= 40 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- Written by each participant on room entry (enterRoom, script.js)
- onDisconnect().remove() cleans up on page close (Firebase/LocalDB semantics)
- Rendered in renderPresence() to show "who's in this room right now"
- Admins are NOT added to presence (they are monitoring, not occupying a seat)

### sessions/{sessionCode}/rooms/{roomName}/typing/{clientId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```
"string, 0–20 chars (module key being typed: 'moduleA', 'moduleB')"
OR null (not typing)
```

**Validation:**
```
.validate: "newData.val() == null || 
  (newData.isString() && newData.val().length <= 20)"
```

**Notes:**
- Written by setTyping() when user focuses textarea
- Cleared when user leaves the textarea
- Rendered in renderTyping() ("Alice is typing...")

## Module A - Clinical Case

### sessions/{sessionCode}/rooms/{roomName}/moduleA/revealed/{itemId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```json
{
  "by": "string, 1–40 chars (name of person who revealed)",
  "at": "number (timestamp ms)"
}
```
OR null (item not revealed).

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['by', 'at']) && 
  newData.child('by').isString() && 
  newData.child('by').val().length <= 40 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- itemId format: "history:0", "exam:2", "labs:1" (from case-content.js)
- Written when user clicks "Ask", "Examine", or "Investigate" button
- Triggers score check (e.g., milestone unlock)
- Immutable once written; setting to null deletes it (not intended for normal use)

## Answers (Text Responses)

### sessions/{sessionCode}/rooms/{roomName}/answers/moduleA/{entryId}
### sessions/{sessionCode}/rooms/{roomName}/answers/moduleB/{entryId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```json
{
  "text": "string, 1–1000 chars (answer text)",
  "by": "string, 1–40 chars (name of person who answered)",
  "cid": "string (clientId of person who answered)",
  "at": "number (timestamp ms)",
  "university": "string, 0–40 chars (optional, cohort label)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.child('text').isString() && 
  newData.child('text').val().length > 0 && 
  newData.child('text').val().length <= 1000 && 
  newData.child('by').isString() && 
  newData.child('by').val().length <= 40 && 
  newData.child('cid').isString() && 
  newData.child('at').isNumber() && 
  (!newData.hasChild('university') || 
    (newData.child('university').isString() && 
     newData.child('university').val().length <= 40))
)"
```

**Notes:**
- entryId is auto-generated (child().push() creates random key)
- Triggers score check (concept family match in SCORING)
- Code allows editing (delete old + insert new transaction)
- university field is optional, stores cohort for answer-origin tracking in exports

## Votes (Team Decisions)

### sessions/{sessionCode}/rooms/{roomName}/votes/{voteId}/ballots/{clientId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```json
{
  "choice": "number, 0–9 (option index)",
  "at": "number (timestamp ms)"
}
```
OR null (user changed their vote or retracted).

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['choice', 'at']) && 
  newData.child('choice').isNumber() && 
  newData.child('choice').val() >= 0 && 
  newData.child('choice').val() <= 9 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- voteId is a decision ID (from case-content.js DECISIONS list)
- Each person casts one vote per decision (overwrites if they change their mind)
- Tally bar shows live vote distribution
- Rendered in renderDecisions() → buildDecision()

### sessions/{sessionCode}/rooms/{roomName}/votes/{voteId}/committed

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```json
{
  "choice": "number, 0–9 (winning option index)",
  "at": "number (timestamp ms, when locked in)"
}
```
OR null (not yet locked in).

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['choice', 'at']) && 
  newData.child('choice').isNumber() && 
  newData.child('choice').val() >= 0 && 
  newData.child('choice').val() <= 9 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- Set by commitDecision() after room votes
- Triggers score check (decision is correct/wrong?)
- Immutable: once committed, cannot be changed
- Shows result card with explanation and points

## Scoring

### sessions/{sessionCode}/rooms/{roomName}/score/auto/{eventId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```json
{
  "points": "number, 0–100",
  "at": "number (timestamp ms)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['points', 'at']) && 
  newData.child('points').isNumber() && 
  newData.child('points').val() >= 0 && 
  newData.child('points').val() <= 100 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- eventId is auto-generated (timestamps, etc. in checkScoreEvents)
- Automatic scoring: milestones, concept family matches
- One entry per event (e.g., "reveal labs:0" = 5 points)

### sessions/{sessionCode}/rooms/{roomName}/score/penalties/{eventId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && !root.child('sessions').child($sessionCode).child('closed').exists)"`

**Schema:**
```json
{
  "points": "number, 0–100 (deduction, stored as positive)",
  "at": "number (timestamp ms)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['points', 'at']) && 
  newData.child('points').isNumber() && 
  newData.child('points').val() >= 0 && 
  newData.child('points').val() <= 100 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- Written when participant makes wrong clinical choice (e.g. unnecessary MRI)
- Deduction amounts defined in case-content.js PENALTIES list
- Room total never drops below 0

### sessions/{sessionCode}/rooms/{roomName}/score/manual/{pushId}

**Read/Write Authority:**
- `.read: "auth != null"`
- `.write: "auth != null && root.child('sessions').child($sessionCode).child('adminPasswordHash').exists() && !root.child('sessions').child($sessionCode).child('closed').exists()"`
  (Admin only)

**Schema:**
```json
{
  "points": "number, 0–50 (max 50 per manual award)",
  "tag": "string, 0–60 chars (description, e.g., 'Great teamwork')",
  "by": "string, 1–40 chars (admin name who awarded)",
  "at": "number (timestamp ms)"
}
```

**Validation:**
```
.validate: "newData.val() == null || (
  newData.hasChildren(['points', 'tag', 'by', 'at']) && 
  newData.child('points').isNumber() && 
  newData.child('points').val() >= 0 && 
  newData.child('points').val() <= 50 && 
  newData.child('tag').isString() && 
  newData.child('tag').val().length <= 60 && 
  newData.child('by').isString() && 
  newData.child('by').val().length <= 40 && 
  newData.child('at').isNumber()
)"
```

**Notes:**
- Admin-only scoring: facilitator can award bonus points for exceptional teamwork, insights, etc.
- Max 50 per award (to prevent admin inflation)
- Displayed in dashboard "Points" panel with tag (e.g. "10 points for: Excellent diagnosis reasoning")
- Undoable via undoLastManual()

## Summary of Key Constraints

| Constraint | Enforced At | Notes |
|------------|------------|-------|
| Session isolation | All rules scoped to $sessionCode | No cross-session leakage |
| Auth required | `.read`/`.write` guards | No anonymous access at DB level; anonymous Firebase auth used instead |
| Admin-only writes | Stage, manual scores, links | Only authenticated admin (who knows password) can set these |
| Immutability | `.write: "!data.exists()"` for password, created, closed, scenario | Once set, cannot change—enforce via one-time writes |
| No writes post-close | Every `.write` rule checks `!... .child('closed').exists()` | Session is archival once closed; no further data mutation |
| No empty text fields | `length > 0` validators | Prevent empty answers, empty pool names |
| URL validation | Regex checks for https:// | Prevent javascript:, data:, mailto: injection |
| Cohort validation | University field clamped in lib.js | Prevent arbitrary university injection in answers |

## Related Docs

- `security-model.md` — How rules interact with App Check, auth, PBKDF2
- `script-js-map.md` — Which functions read/write each path
- `README.md` — Data flow diagrams, participant join flow
