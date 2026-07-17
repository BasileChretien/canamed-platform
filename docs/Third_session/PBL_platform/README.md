# CaNaMED Session 3 Platform

The single hub for the whole Session 3 workshop. One URL, no links to chase: it
holds every block of the session, the instructions for each module, the interactive
Module A clinical case, and a built-in collaborative document for each module's
answers.

> **Running the platform day-to-day?** See [`RUNBOOK.md`](RUNBOOK.md) — the
> short, action-oriented companion to this README. It covers initial deploy,
> pre-workshop checklists, common failures, credential rotation, and the
> stale-session cleanup workflow.

## Sessions are numbered

Everyone first enters a **session number** (e.g. `3`, `4`, …). All data for that
session lives under `sessions/{number}/`, isolated from every other session — its own
password, its own rooms, its own answers. The same deployed URL therefore runs every
future CaNaMED session; you just hand out the number. The super admin can set (and
pre-provision) a password for **any** session number.

## Roles

| Role | How you get it | What you see |
|------|----------------|--------------|
| **Participant** | Session number + name + university + year + English level | A waiting room, then their assigned room's session view |
| **Admin** | Session number + the session password | Chooses the number of rooms, starts the session, then a dashboard of every room with per-room stage control and a "download all answers" button |
| **Super admin** | The super-admin key (in `firebase-config.js`) | The admin dashboard **plus** a panel to set / change the password for any session number |

The session password is what admins use; only the super admin can set it. Set the
super-admin key in `firebase-config.js`.

## Joining and room assignment

Participants do **not** pick a room. They enter their name, university, year of study
and English level, and land in a **waiting room**. The admin chooses **how many rooms**
and presses **Start session** — the platform then balances everyone across the rooms so
each room is **Franco-Japanese mixed** (the priority), with year and English level
spread out too. Students who **arrive after the start** are automatically balanced into
the room that best preserves that mix.

## The session runs in stages — per room

| Stage | Content |
|-------|---------|
| 0 — Welcome | Session structure; the opening student presentation runs |
| 1 — Module A | Chronic Pain: the interactive clinical case (Mr Lefebvre, low-back pain) |
| 2 — Module B | Breaking Bad News: the cross-cultural roleplay (instructions on screen) |
| 3 — Wrap-up | Debrief and questionnaire reminders |

Each **room** has its own stage. From the **admin dashboard** the admin sees every
room's current stage and who is in it, and advances each room individually with
**← Back / Advance →** (or **Advance all rooms** at once).

**Participants can only move forward when a facilitator does.** A student can press
**Back** to re-read an earlier stage on their own screen, and **Next** to return — but
Next never goes past the room's current stage. Only a facilitator opens the next stage.

## Calling a facilitator, and monitoring the rooms

Each room has a **Call a facilitator** button. When a room presses it, every admin sees
a red **🔔 calling for a facilitator** badge on that room in the dashboard.

Any admin can click **Open room** to enter it — they then see **exactly what the
students in that room see** (the live stages, the interactive case, the findings, the
group answers, who's present), with a **room-switching side panel** listing every
room (stage, head-count, call alerts). From the room view a facilitator advances *that
room's* stage with Back / Advance, jumps to another room from the side panel, or
returns to the full dashboard. **Opening a room automatically clears its call alert**
(a facilitator has arrived). The facilitator is not added to the room's presence — they
are monitoring, not occupying a seat.

## Using it alongside Teams

The platform does **not** try to control Teams. Teams breakout rooms are managed
inside Teams and don't expose per-room links to automate from outside, so deep
integration would be fragile. Instead:

- The admin can paste **one Teams meeting link** into the dashboard; participants
  then get a **Join the Teams call** button. Teams handles the video and its own
  breakout rooms.
- Use the platform's **room assignment as the source of truth** — it balances the
  Franco-Japanese mix for you — and mirror those groups when you set up the Teams
  breakout rooms.
- The platform is what makes running it across Teams rooms easy: instead of a
  facilitator hopping between breakout rooms to check progress, the dashboard shows **every
  room at once** and surfaces **who needs help**.

## Module A — the interactive case

In Stage 1 the group decides what to **ask**, **examine** and **investigate**; each
result is revealed on request and added to a shared **Findings log** tagged with
**who revealed it**. Completing the **clinical synthesis / red-flag review** unlocks
the **discussion prompts** and a France/Japan **country-compare** card.

## Points — earning and losing them

Points are **cooperative**: every room's score adds into one shared cohort goal.
Teams earn points three ways — **milestones** (working the case up in the right
order), **concept families** (key ideas recognised in their written answers), and
**facilitator points** (capped, awarded by hand from the dashboard).

Teams also **lose** points for a wrong clinical choice — across **all three** parts
of the workup. The case ships poor options the team can actually pick:

- **History** — promising the opioid before any assessment; suggesting the pain is
  "in your head."
- **Examination** — performing an intimate rectal exam with no indication; a
  scattergun cardio-respiratory exam.
- **Investigations** — MRI, plain X-ray, blood tests or a lumbar CT scan, none of
  which are indicated.

A wrong pick triggers a **penalty**: a calm amber toast pops with the exact reason
*why* the points were lost, the "how your team earns points" panel grows a
**"Points lost — why"** section, and the wrap-up recap lists each mistake as a
"worth remembering" lesson. A team's total can never drop below zero. Penalties
(which items, the size, and the explanations) are defined in the `PENALTIES` list
in `case-content.js`, so a different case ships its own wrong-choice rules.

## Stage 1 layout — tabbed right panel

The right column of the Module A stage is a **tab bar** that switches between
**Findings**, **Team decisions**, **Discussion**, **Group answers** and
**Reference** (historical context, guidelines, recap table). The bar stays sticky
at the top of the column, badges show what is new in each section, and a small
attention dot appears on a tab when something updates while the team is looking
at a different tab. One click per section — no long scroll to reach the answers
box or the recap table.

## Team decisions — voting together

Each module has a small number of **"very important questions"** that the room
answers as a team, Kahoot-style. Every student taps their choice; a **live tally
bar** shows how the room is leaning and small coloured dots show who voted for what.
Once enough of the room has voted, anyone can press **"Lock in the team's answer"** —
the option with the most votes is committed (a tie is refused: the room is told to
talk it through and vote again). A correct lock-in earns points; a wrong one costs
points — and either way the card shows *why*, turning the vote into a teaching
moment. The decisions (prompt, options, which is correct, points, penalty, and the
explanations) live in the `DECISIONS` list in `case-content.js`. Module B's decision
carries no penalty by design — that module is kept low-stakes.

## Optional Google accounts &amp; profiles

Signing in is **optional** — the code-only join still works exactly as before.
For students who want their details remembered:

- A *"Sign in with Google to save your profile &amp; history →"* link sits next to
  the code input on the splash. One click opens Google's account chooser.
- First sign-in routes the user through a small **profile setup** step (name,
  university, year, English level — same fields the lobby asks for).
- Subsequent visits automatically pre-fill the lobby join form from the
  profile. A header chip shows the user's name + initials; clicking it opens
  a **My account** dialog with editable profile, the list of sessions they
  have joined, *Sign out* and *Delete account &amp; profile data*.
- Deleting the account removes `users/{uid}` (profile + history) and the
  Firebase auth user. Contributions in past sessions stay in those sessions'
  records but are no longer linked to the user's identity.
- The privacy notice on the splash explains the trade-off; the platform
  remains usable without an account.

### Enabling sign-in providers (one-time, Firebase Console)

The platform ships UI for **Google** sign-in. Microsoft and Apple are
supported by the engine (`signInWithProvider("microsoft" | "apple")`) but
the visible buttons are not on the splash — Microsoft needs an Azure App
Registration the project owner may not have access to, and Apple needs a
paid Apple Developer Program account. To re-enable either, add the
relevant button back to `index.html` (its handler is already wired).

**Google** (fastest — 60 seconds, no external accounts needed):

1. Firebase Console → **Authentication** → **Get started** (if first time)
2. **Sign-in method** tab → **Add new provider** → **Google** → Enable
3. Set the *Support email* (your own works fine) → Save
4. **Authentication → Settings → Authorized domains** — confirm
   `canamed-69785.web.app` and `canamed-69785.firebaseapp.com` are listed
   (Firebase adds them by default; add any custom domain you point at the
   project later)

### Data model for accounts

```
users/{uid}/profile               { name, university, year, english, createdAt, updatedAt }
users/{uid}/history/{sessionCode} { code, workshopName, scenarioName, joinedAt }
```

Rules restrict read and write to `auth.uid == $uid` — every user can only
touch their own subtree, never anyone else's. The rest of the database (the
`sessions/{code}/*` tree the workshop writes into) is unchanged and stays
joinable without an account.

## Ending a session — the facilitator's "save everything" button

A facilitator can **end the session** from the admin dashboard:

- **"End session & download archive"** button (next to "Download all group answers")
- Confirms once, then **downloads a single JSON file** named
  `canamed-{code}-{timestamp}.json` containing the entire
  `sessions/{code}/*` subtree — every group's answers, votes, revealed
  findings, scores, contributions, presence, callForHelp, decisions
- Writes `sessions/{code}/closed = { by, at }` to the database
- Participants immediately see a sticky green banner: *"Session closed by the
  facilitator — thank you for taking part. Your team's work has been saved."*
- Clicking the button again re-downloads the archive (no second confirmation)
  — useful for emailing the file to a collaborator after the workshop

The archive is a faithful copy of the live data so it can be re-loaded into
any analysis pipeline. The `adminPasswordHash` is stripped from the archive
(it has no research value).

## Auto-deploy on main

`.github/workflows/firebase-deploy.yml` ships hosting (and, best-effort,
database rules) for a commit on `main` once it passes the gate below — in
practice, most merges. It is not an unconditional guarantee that the live site
matches `main`: a red or never-run E2E deploys nothing, and a commit that main
has already moved past is skipped rather than shipped (see below). There is no
path filter, so a commit touching nothing under `docs/Third_session/PBL_platform/`
still redeploys byte-identical content — a harmless no-op that keeps the live
site in step with `main`. The service account credentials live as a GitHub secret
(`FIREBASE_SERVICE_ACCOUNT_CANAMED_69785`); the workflow is concurrency-guarded
so a flurry of pushes coalesces into one deploy.

**It does not trigger on `push`.** It triggers on `workflow_run` — when the
**E2E tests** workflow *concludes* on `main` — and then verifies that every
required check on that commit passed before deploying. E2E is the slowest
required suite (~15 min), so waiting for it to finish is what makes the
verification cheap; the older push-triggered design polled for those checks on a
15-min budget and lost the race on essentially every merge. Two consequences
worth knowing:

- **Deploys start ~15 min after a merge**, not immediately. That is the E2E
  runtime, and was already the true wait before — the deploy just used to spend
  it burning a runner.
- **If E2E is red, the deploy run is created but skips** (grey, not red). Fix
  the failure or re-run the E2E jobs; a green E2E re-run fires the deploy
  automatically, with no manual re-run of the deploy needed.
- **Only main's tip ships.** The workflow refuses to deploy a commit that main
  has moved past, so re-running an *old* E2E run cannot roll the live site back
  — it skips with a "Deploy skipped (superseded)" warning. That is expected, not
  a failure.
- **If E2E never *runs* at all** (workflow disabled, Actions outage/billing
  lockout), no deploy run appears and nothing goes red — main silently stops
  reaching the live site. Verify with
  `curl -s https://canamed-69785.web.app/sw.js | grep SHELL_VERSION`.

Manual `firebase deploy` from a developer machine continues to work — this just
keeps the live site in sync with `main` automatically. **Database rules** are
deployed on a best-effort basis: the step is `continue-on-error`, so if the
service account lacks the Firebase Realtime Database Admin role the rules step
warns and hosting still ships. Push rules manually with
`firebase deploy --only database` if that warning appears.

## Scenarios — the content of each session

The clinical content (case + scoring + penalties + team decisions) is **not
baked into the engine**. It lives in `case-content.js` as a **scenarios
registry** (`window.CANAMED_SCENARIOS`), each entry a fully self-contained
content pack. When a facilitator creates a session, the splash offers:

- **Built-in scenarios** — currently *"Chronic Pain & the Opioid Request"*
  (the low-back-pain case + breaking-bad-news roleplay). New built-ins are
  added by adding a key to `CANAMED_SCENARIOS`.
- **Create new content (advanced)** — pastes a JSON object describing the
  case, scoring, penalties and decisions. A *"Load template"* button starts
  from the current built-in so the facilitator edits rather than writes from
  zero. The custom JSON is validated and stored on the session as
  `sessions/{code}/scenarioCustomJson` (max 32 KB).

The choice is stored on the session itself (`scenarioId` or
`scenarioCustomJson`), and the engine reads it on join and swaps the global
content. Every participant entering that code automatically gets the same
content — the "Today's content: *scenario name*" line on the lobby tells them
what they will work on before they join.

## The CANAMED splash — and how facilitators create a session

The **main page** of the deployed URL is the **CANAMED** splash — a deliberately
generic, partnership-neutral landing card. There are two paths from here:

- **Participants** type the **session code** their facilitator handed out and
  land in the partnership-branded lobby for *that* session.
- **Facilitators** click *"I'm a facilitator — create a session →"*, enter
  their name, an optional workshop label and a session password, and the
  platform **generates a short code** (e.g. `ABC-DEF`) to share with the room.
  The same screen offers a one-click *"Open admin dashboard"* — the facilitator
  is logged in as that session's admin straight away, using the password they
  just set. The session lives at `sessions/{code}/...` in the database (the
  code IS the session id), and is protected by the password they set during
  creation.

The code each participant types **becomes their unlocked session for that
device** — a small *"Session ABC-DEF"* badge appears on the lobby so it is
obvious which session they are in, and the unlock survives reloads. The
existing super-admin panel and the per-session admin login still work
unchanged — they now operate on codes instead of numeric session ids.

> There is **no platform-wide code to set in `platform-config.js` any more**.
> Sessions are created from inside the app; the deployment ships only its
> partnership-specific branding (workshop name, cohorts, colours).

## Running CaNaMED for other universities

CaNaMED is **not hard-coded to France and Japan**. The partnership registry —
**who is taking part and what each partnership is called** — lives in
**`orgs.js`**, the single source of truth for multi-tenant deployments. One
CaNaMED deployment can host several partnerships at once, each picked from the
URL path `/o/{slug}/` (e.g. `canamed.web.app/o/caen-nagoya/`). The default org
keeps the legacy root URL (`canamed.web.app/`) for back-compat.

To add a new partnership, append an entry to the `CANAMED_ORGS` object in
`orgs.js`:

```js
"lyon-tokyo": {
  name: "Lyon × Tokyo",
  cohorts: [
    { id: "Lyon",  label: "Université Claude Bernard Lyon 1", short: "Lyon",  country: "France", color: "#7c3aed" },
    { id: "Tokyo", label: "University of Tokyo",              short: "Tokyo", country: "Japan",  color: "#0ea5e9" }
  ],
  primary: "#7c3aed",
  accent:  "#0ea5e9",
  privacyEmail: "privacy@example.fr"
}
```

The slug (`lyon-tokyo`) must be lowercase alphanumeric with hyphens — it becomes
the URL prefix and the database namespace (`orgs/lyon-tokyo/sessions/...`).
**Two or more** cohorts are supported per org: the room balancing, the lobby's
university dropdown and the "every partner contributed" exchange scoring all
adapt to however many cohorts you list. Each cohort's `id` is the value stored
against every student and answer, so keep it stable once a session has started.

`platform-config.js` is the **deployment-wide default fallback** (workshop name,
tagline, default cohort list) — kept for back-compat with single-tenant
installations. When an org slug resolves via `orgs.js`, that org's branding
overrides `platform-config.js`.

The content layers stay deliberately separate: **`orgs.js`** (the partnership
registry), **`platform-config.js`** (deployment-wide defaults),
**`case-content.js`** (the clinical case and its scoring), and
**`firebase-config.js`** (the live credentials). The engine in `script.js`
reads all four and contains nothing partnership- or case-specific.

## Saving the answers — built-in collaborative document

Each module has a **Group answers** box. It is:

- **editable in the same window by anyone** in the room,
- **real-time collaborative** — everyone sees edits as they happen,
- **auto-saved** to Firebase (no Google/Microsoft sign-in, no iframe issues),
- **downloadable by the admin** — the dashboard's *Download all group answers* button
  exports every room's Module A and Module B answers as a single text file.

This is why the platform does **not** embed Google Docs or Office: an embedded
third-party editor cannot reliably be edited inside an iframe and needs sign-in.
A built-in field backed by Firebase meets every requirement directly.

(Two people typing in the *same* box at the *same instant* is last-write-wins —
fine when a group has one scribe; Module A and Module B have separate boxes so the
collision surface is small.)

## Two modes

| Mode | When | Sync |
|------|------|------|
| **Local test** | No Firebase config (default) | A built-in backend that persists to `localStorage` and **syncs across tabs of the same browser**. Lets you test the whole session — rooms, presence, admin dashboard, collaborative answers — with no account. |
| **Shared** | A Firebase config is provided | Different groups open the **same URL from any device**, pick a **room**, an admin runs it from the dashboard — all live. |

The platform picks the mode automatically from `firebase-config.js`.

## Testing it completely — local test mode, no account needed

Serve the folder (`python -m http.server` from here) and open the address — using a
served URL rather than `file://` makes cross-tab sync reliable. Then open several
browser tabs on that URL:

1. **Tab 1 — super admin.** Enter a **session number** (e.g. `3`), open *"Super admin:
   set / change the password"*, enter the super-admin key **`test`** (the default in
   local test mode), choose a session password, and open the dashboard. You'll see the
   pre-start panel. (The super-admin panel can also pre-provision other session numbers.)
2. **Tabs 2-4 — participants.** Enter the **same session number**, a name, and a
   university / year / English level, then join. Each lands in the **waiting room** and
   appears in Tab 1's waiting list.
3. **Back in Tab 1**, choose the **number of rooms** and press **Start session** —
   every participant tab is placed into a balanced room automatically.
4. In the participant tabs, work the Module A case and add colour-coded answers —
   presence and contributions show across tabs. Open one more tab as a participant
   *after* starting to see a **late arrival auto-balanced** into a room.
5. **Back in Tab 1**, watch the dashboard update live, advance each room with
   *Advance →*, and use *Download all group answers*.
6. (Optional) **Tab 5 — admin**, joining with just the session password, gets the
   same dashboard without the password-changing card.

Everything you'd do on the real day works here; it just stays within one browser.

## Enabling shared mode (free — no server, no credit card)

Shared mode uses **Firebase Realtime Database** on the **Spark plan** — free, no
credit card, no server you manage. ~5 minutes:

1. <https://console.firebase.google.com> → sign in with a Google account.
2. **Add project** → name it → (Analytics optional) → **Create project**.
3. **Build → Realtime Database → Create Database** → pick a location. You can start
   in test mode to try it, **but before the workshop deploy the security rules** (see
   *Securing the database* below) — test mode means anyone with the database URL can
   read every student's name and answers, or overwrite any data.
4. **Project settings → General → Your apps** → web icon (`</>`) → register an app →
   copy the `firebaseConfig` object.
5. In `firebase-config.js`: paste it into `window.CANAMED_FIREBASE = { ... };`
   (include `databaseURL`). Leave `window.CANAMED_SUPERADMIN_KEY` as `null` for a
   public deployment (see *Securing the database*); set it to a long random string
   only if you are running from a local, unpublished copy of the file.
6. Reload — the lobby should show **"Shared mode"** and the admin section.

### Securing the database

The app has **no real user authentication** (there is no server). The protections
that matter are the Realtime Database security rules:

1. In the Firebase console: **Build → Realtime Database → Rules**, paste the contents
   of [`database.rules.json`](database.rules.json), and **Publish**. These rules
   type- and length-validate every field, bound stage values to 0–3, and deny writes
   to any path not in the schema.
2. For a public (GitHub Pages) deployment, keep `CANAMED_SUPERADMIN_KEY = null` in the
   served `firebase-config.js` — anything in that file is readable in page source.
   Set the session password using the in-app super-admin panel from a **local,
   unpublished copy** of the file that has the key set, or set
   `sessions/{N}/adminPasswordHash` from the Firebase console.
3. For a higher-security deployment, change `adminPasswordHash` in the rules to
   `".write": false` and set passwords only from the Firebase console. This disables
   the in-app password panel but makes the password hash tamper-proof.
4. **After the workshop**, purge the session: use the super-admin **Purge this
   session's data** button, or delete `sessions/{N}` from the console.

What the rules **cannot** do without real auth: distinguish an admin from a
participant server-side (the stage node must stay writable by all clients), or stop
one participant overwriting another's presence entry. The blast radius is limited to
a single session of a classroom tool — acceptable for this use, but do not store
anything sensitive beyond first names and short answers.

### Enabling App Check (optional, recommended for any public deployment)

Firebase Realtime Database security rules ensure that *authenticated* clients
can only do permitted things, but they cannot tell whether the client is the
real CaNaMED web page or a script someone wrote that happens to also call
`signInAnonymously()`. App Check closes that gap: every database request must
be accompanied by a fresh reCAPTCHA attestation that **a real browser actually
loaded this site**. Without it, a determined abuser can still rack up free-tier
quota by hammering the Realtime Database with valid-but-illegitimate requests.

The platform uses **reCAPTCHA Classic v3** (free up to 10,000 assessments per
month, no credit card required) rather than reCAPTCHA Enterprise — Enterprise
would force the project onto the Blaze billing plan, and v3 gives the same
score-based bot detection for this threat model.

**One-time setup:**

1. **Firebase Console → App Check → Apps**: register the web app and pick
   **reCAPTCHA** as the provider (the non-Enterprise option).
2. **https://www.google.com/recaptcha/admin/create** → register a new site:
   - **Label**: `CaNaMED Platform`
   - **Type**: **Score based (v3)**
   - **Domain**: `canamed-69785.web.app` (plus any custom domain)
   - Submit. Copy the **site key** (public, starts with `6L…`) and the
     **secret key** (private — never commit, never paste anywhere except the
     Firebase Console form in step 4).
3. Edit `firebase-config.js` and set:
   ```js
   window.CANAMED_RECAPTCHA_SITE_KEY = "6L…";  // the site key, public
   ```
4. **Firebase Console → App Check → CANAMED APP → reCAPTCHA**: paste the
   **secret key** into the "reCAPTCHA secret key" field → **Save**. (This is
   the only place the secret key lives outside the Google Cloud key store.)
5. Push to `main`. The workflow re-deploys hosting; reload the live site and
   confirm `[CaNaMED] App Check is OFF` is NO LONGER printed to the DevTools
   console.
6. **Firebase Console → App Check → APIs → Realtime Database**: leave at
   **Unenforced** for at least 24 h while you watch the "Requests" metric.
   Once you see ≥99 % of traffic coming through verified clients, flip it to
   **Enforced**. Requests without a valid attestation will then be rejected.

**Backout:** to roll back, set `CANAMED_RECAPTCHA_SITE_KEY = null` and flip
the enforcement back to Unenforced — clients will return to the rules-only
protection level. No data is lost.

### Setting the session password

In the lobby, open **"Super admin: set / change the password"**, enter the
super-admin key and a new session password, and open the dashboard. From then on,
admins join with just the session password. The super admin can also change the
password later from the dashboard.

### Publishing the shared URL (GitHub Pages — also free)

1. Push this repository to GitHub.
2. Repository **Settings → Pages** → deploy from a branch, pointing at this folder.
3. Share the URL with every group; each picks a different room. The admin opens the
   same URL and uses the admin section of the lobby.

Note: on GitHub Pages, `firebase-config.js` is readable in page source. Keep
`CANAMED_SUPERADMIN_KEY = null` there and **deploy `database.rules.json` before the
workshop** (see *Securing the database*) — the rules, not the config file, are what
protect the data.

## Compliance checklist before the next live research workshop

The platform itself is technically robust, but a **research workshop** that
collects data from medical students (GDPR + APPI + Declaration of Helsinki
territory) needs more than working code. Two parallel audits (a web-security
audit and a law-and-ethics audit) ran in spring 2026; what follows is the
**operator's checklist** of off-platform work that must be done before the
next live session. The platform code already supports each item — the only
gaps are documents, approvals and Firebase-Console settings.

> Status legend: ✅ done by code · ⚠ partially done · 🟥 operator action
> required before next live session.

### Consent + transparency

- ✅ **Two-checkbox consent on the join form** — workshop participation
  (required) is separated from research-data re-use (optional, no impact on
  grade or participation). Persisted to `pool/{cid}/consent` with a
  versioned notice string and timestamp.
- ✅ **Layered privacy notice** — short summary in the lobby with a link to
  the full [`privacy.html`](privacy.html) covering every GDPR Art. 13 + APPI
  Art. 17/21/27(5)/28 disclosure item.
- 🟥 **Fill in the placeholders in `privacy.html`**: controller addresses,
  PI names, DPO email, contact mailbox (e.g. `canamed-ethics@unicaen.fr`),
  Caen + Nagoya ethics-committee approval numbers + dates. Search the file
  for `placeholder` to find them all.

### Approvals + agreements

- 🟥 **Caen ethics-committee approval** (CER UNICAEN or CER UCN) before next
  data-collecting session. Include the platform's competitive scoring +
  live leaderboard + cross-cultural roleplay (Module B) in the protocol.
- 🟥 **Nagoya University bioethics-review-committee approval / opinion**.
  Required by Nagoya's research-ethics framework; the Caen approval does
  not substitute.
- 🟥 **Joint-controller agreement** (GDPR Art. 26) between Caen and Nagoya,
  naming Caen as the EU-rights single point of contact and Nagoya as the
  Japanese-side co-controller / joint user. Signed by both PIs.
- 🟥 **Accept the Firebase Data Processing Addendum**: Firebase Console →
  Project Settings → Privacy & Security → Data processing terms → Accept.
  Migrate the project off a personal Google account onto an institutional
  Google account/billing if at all possible.
- 🟥 **Records of Processing Activities** (GDPR Art. 30) — a one-page doc
  per controller listing purposes, categories, recipients, transfers,
  retention, security measures.
- 🟥 **DPIA** (GDPR Art. 35) — the combination of special-category content
  + research re-use + cross-border transfer + power-imbalance is enough to
  recommend one. CNIL's PIA tool is free; a 4-page DPIA is fine.

### Security posture (round 1 of platform audit completed)

- ✅ Admin-password hash uses PBKDF2-SHA256 (100,000 iterations), salted by
  session code, with constant-time comparison. Legacy SHA-256 hashes still
  accepted for transition.
- ✅ Session codes generated with `crypto.getRandomValues` (not
  `Math.random`).
- ✅ `clientId` is now a per-tab `sessionStorage` value (no longer shared
  across tabs of the same browser; not retained on a shared lab machine).
- ✅ Database rules: privileged session fields are write-once; admin-only
  fields require the session to be initialised; writes refuse once
  `closed` is set; URL fields enforce `https://…` only.
- ✅ HTTP security headers: full CSP with `frame-ancestors`, plus
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- ✅ CI deploys both hosting AND database rules (no more "rules-fix sits
  on main but never reaches production"). Service account needs Realtime
  Database Admin role granted in IAM.
- ⚠ The `sessions/{code}/.read: true` rule still lets anyone with the code
  read the full session. **Tightening this requires Firebase Anonymous
  Auth + a binding from `clientId` to `auth.uid`** — a multi-day refactor
  documented as the next major round.
- ⚠ **Firebase App Check** SDK is wired in (round 3); activation requires
  a one-time operator step — see [Enabling App Check](#enabling-app-check-optional-recommended-for-any-public-deployment).
  Until enabled, the deployment is protected by rules + anonymous auth only.
- 🟥 **Enable "Email enumeration protection"** in Firebase Console →
  Authentication → Settings.

### Operations / retention / breach response

- ✅ Retention rules are documented in `privacy.html` (live data ≤ 7 days,
  identified archive ≤ 30 days, pseudonymised research data ≤ 5 years
  post-publication). The `.github/workflows/cleanup-stale-sessions.yml`
  scheduled workflow now enforces the 30-day-post-close and
  90-day-abandoned-open limits automatically (daily at 03:17 UTC). The
  pseudonymised export lifecycle still lives in the R analysis pipeline
  and outputs/, separate from the live database.
- ✅ "Pseudonymise names in export" admin checkbox is correctly labelled
  (was "Anonymise"; that was misleading because free-text bodies can
  re-identify their author).
- 🟥 **One-page Incident-Response plan** that satisfies GDPR Art. 33–34
  (72-hour notification to CNIL + affected subjects) and APPI Art. 26
  (preliminary report to PPC in 3–5 days, final in 30 days). Save it next
  to the protocol so a future incident is reportable on time.
- 🟥 **Stable contact email** for data-subject rights (something like
  `canamed-ethics@unicaen.fr`), monitored by the DPO or the PI — not a
  facilitator's personal address. Acknowledge requests within 5 working
  days; respond within 30 days.

### Ethics: in-session changes already shipped

- ✅ **"Your grade is not affected"** banner is shown on every Welcome
  stage so students see it before deciding whether to engage with the
  competitive scoring.
- ✅ **Team-vote per-voter dots removed**. The bars + counts still show
  how the room is leaning; only the current viewer sees a small "Your
  vote" indicator next to the option they chose. Other students cannot
  identify who voted for what.
- ⚠ The live leaderboard (cohort goal + ranking) still shows per-room
  ranks. The ethics audit recommends cohort-aggregated only during the
  session, per-room ranks revealed only at debrief. Considered, not yet
  implemented.
- ⚠ Module B has a "you can move into the observer role at any time"
  safety note inline. A pre-roleplay opt-in pre-screen + a named on-call
  faculty contact (per country) is the recommended next step.

### Documentation pointers

- The four security-audit reports + the three law/ethics audits were
  written into one consolidated report and shipped as PR #16
  ("Security: post-audit hardening (round 1)") and PR #?? ("Privacy +
  ethics: post-audit hardening"). See the commit history for the exact
  changes.

## Data handling

This tool collects personal data (first name/nickname, university, year of study,
self-assessed English level) and free-text answers attributed by name, from students
in France (GDPR applies) and Japan (APPI applies). Whoever deploys it is the **data
controller** and is responsible for:

- **Notice & consent** — the lobby shows a "How your data is used" notice; make sure
  it names your actual lab/contact and matches what you tell students verbally.
- **Storage** — data sits on Google Firebase servers (pick a region in step 3) and in
  each browser's `localStorage`. The participant **Leave** button clears their local
  identifying keys.
- **Retention** — there is no automatic deletion. **Purge each session after the
  workshop** (super-admin *Purge this session's data* button, or delete `sessions/{N}`
  from the console). Decide a retention limit and stick to it.
- **Sharing** — when exporting group answers for teaching or research, tick
  **Anonymise names in export** so opinions are not attributed to identifiable
  students.

### Firebase data model (shared mode)

All keys are namespaced per session number `N`:

```
sessions/{N}/created                    { by, at }  set when a facilitator creates the session
sessions/{N}/closed                     { by, at }  set when an admin ends the session
sessions/{N}/workshopLabel              optional friendly label set during creation
sessions/{N}/scenarioId                 which built-in scenario to load (e.g. "chronic-pain-opioids")
sessions/{N}/scenarioCustomJson         a custom scenario as JSON (mutually exclusive with scenarioId)
sessions/{N}/adminPasswordHash          salted SHA-256 of the session password
sessions/{N}/started                    whether the admin has started the session
sessions/{N}/roomCount                  how many rooms the admin chose
sessions/{N}/teamsLink                  optional Teams meeting link for the session
sessions/{N}/questionnaireLink          optional end-of-session questionnaire link
sessions/{N}/rooms/{room}/typing/{cid}  who is currently typing (kept off presence)
sessions/{N}/pool/{clientId}            { name, university, year, english, at, room }
                                          the waiting pool + each person's assigned room
sessions/{N}/rooms/{room}/stage         that room's stage (0-3)
sessions/{N}/rooms/{room}/presence/{cid} { name, at }  (auto-removed on disconnect)
sessions/{N}/rooms/{room}/callForHelp   { by, at }  set when the room calls a facilitator
sessions/{N}/rooms/{room}/moduleA/revealed/{id}  { by, at }   who revealed each case item
sessions/{N}/rooms/{room}/answers/moduleA        collaborative Module A answers (entries)
sessions/{N}/rooms/{room}/answers/moduleB        collaborative Module B answers (entries)
sessions/{N}/rooms/{room}/score/auto/{id}        { points, at }  milestone & concept points earned
sessions/{N}/rooms/{room}/score/penalties/{id}   { points, at }  points lost for a wrong choice
sessions/{N}/rooms/{room}/score/manual/{id}      { points, tag, by, at }  facilitator-awarded points
sessions/{N}/rooms/{room}/votes/{id}/ballots/{cid}  { choice, at }  each student's team-decision vote
sessions/{N}/rooms/{room}/votes/{id}/committed      { choice, at }  the answer the team locked in
```

The password is stored only as a salted SHA-256 hash (the session number is the
salt) — the plaintext is never sent to the database. This is hardened against
trivial offline cracking, but with no server it is still client-side: treat the
session password as a low-stakes shared secret, not an account credential.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Lobby, the four participant stages, the admin dashboard |
| `style.css` | Styling |
| `script.js` | Roles, stage logic, interactive case, presence, collaborative answers, dashboard — partnership- and case-agnostic |
| `orgs.js` | **Per-partnership** (multi-tenant): the registry of partnerships, their cohorts, branding colours and privacy contact e-mails. Source of truth for `/o/{slug}/` URLs |
| `platform-config.js` | **Per-deployment** (single-tenant default): workshop name, tagline, fallback cohort list. Overridden by `orgs.js` when an org slug is in the URL |
| `case-content.js` | **Per-session**: the Module A clinical case, the scoring families, the `PENALTIES` list and the `DECISIONS` (team votes) |
| `firebase-config.js` | Your Firebase config + super-admin key (or `null` for local test mode) |
| `database.rules.json` | Firebase Realtime Database security rules — deploy before the workshop |
| `README.md` | This file |

To change the Module A case, edit the `CASE` object in `case-content.js` &mdash; it is a
separate file precisely so the clinical content can be edited without touching the app
logic in `script.js`.
