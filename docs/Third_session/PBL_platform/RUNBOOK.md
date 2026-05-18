# CaNaMED Platform — Operator Runbook

The short, action-oriented companion to `README.md`. README explains *what
the platform is*; this file is the step-by-step for *running* it across
its full lifecycle: bringing up a new deployment, prepping for a live
workshop, recovering from common failures, and rotating credentials.

If you've just inherited an existing deployment, the **"Inherited a live
deployment"** section at the bottom is the fastest read.

---

## 0. Cheat sheet

| Symptom or task | Section |
|---|---|
| Deploy is on fire, site shows white screen | §4 Diagnose |
| `firebase deploy --only database` fails with "permission denied" | §3 Manual rules fallback |
| GitHub workflow's database step warns "service account lacks RTDB Admin" | §3 Grant SA the RTDB Admin role |
| New facilitator can't sign in with Google | §2.4 Authorised domains |
| App is up but the connection badge says "Reconnecting…" forever | §4.2 SDK transport debugging |
| Bring up a fresh deployment for a new partnership | §1 Initial deploy |
| Rotate the super-admin key | §5 Credential rotation |
| Audit which sessions are about to be auto-purged | §6 Retention cleanup |
| Turn App Check on | README → Enabling App Check |
| Turn Performance Monitoring on | §7 Perf monitoring |

---

## 1. Initial deploy (from scratch)

For a brand-new Firebase project, follow this exact order. Each step
takes ≤5 min; the whole thing is ~30 min end-to-end.

### 1.1. Firebase project

1. https://console.firebase.google.com → **Add project**. Pick the
   institutional Google account if you have one; a personal account
   works too but transfers later are messy.
2. Region selection: **europe-west1** (Belgium, EU) is the
   recommended default for the Franco-Japanese partnership — keeps data
   inside the EU for GDPR purposes and is close enough to both Caen and
   Nagoya for acceptable latency. Other regions: see Firebase docs.
3. **Disable** Google Analytics for Firebase unless you actually need
   it. We don't — Performance Monitoring (§7) covers what's useful
   without the privacy footprint.

### 1.2. Hosting

1. **Build → Hosting → Get started**.
2. Skip the CLI walkthrough — the workflow in
   `.github/workflows/firebase-deploy.yml` already handles deploys.

### 1.3. Realtime Database

1. **Build → Realtime Database → Create database**.
2. Same region as the Firebase project (europe-west1).
3. Start in **locked mode** — we'll deploy the real rules next.
4. Note the database URL (something like
   `https://<project>-default-rtdb.europe-west1.firebasedatabase.app`)
   and paste it into `firebase-config.js` → `databaseURL`.

### 1.4. Authentication providers

1. **Build → Authentication → Get started**.
2. **Sign-in method tab**:
   - **Anonymous**: ENABLE. *Required* — the round-2 hardened rules
     refuse every write without `auth != null`, and anonymous is what
     gets every tab a token without forcing a Google sign-in.
   - **Google**: ENABLE. Set the support email to whoever runs the
     deployment.
   - Apple, Microsoft, Email/Password: ignore unless you specifically
     need them — they're not used by the platform code today.
3. **Settings tab → Authorized domains**: add your hosting domain
   (e.g. `canamed-69785.web.app`) AND any custom domain. **Google
   sign-in fails on unauthorised domains** with a cryptic error.

### 1.5. Service-account credentials for CI

1. **Project settings → Service accounts → Generate new private key**.
   Download the JSON.
2. In GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT_<PROJECT_ID_UNDERSCORED>` — e.g.
     `FIREBASE_SERVICE_ACCOUNT_CANAMED_69785`.
   - Value: paste the entire JSON content (including the curly braces).
3. **Grant the service account the right IAM roles.** Open
   https://console.cloud.google.com/iam-admin/iam, find the service
   account (`github-action-<N>@<project>.iam.gserviceaccount.com`), and
   verify it has **at minimum**:
   - `Firebase Hosting Admin` (deploys hosting)
   - `Firebase Authentication Admin` (typically auto-granted)
   - **`Firebase Realtime Database Admin`** ← without this, the
     workflow's database-rules step will warn-and-skip on every run,
     and your rule changes never reach production.

### 1.6. First deploy

1. Edit `firebase-config.js` with the new project's web config.
2. Edit `.firebaserc` (if you have one) or the workflow's `--project`
   flag to match the new project ID.
3. Push to `main`. The workflow runs hosting + database in one shot.

---

## 2. Pre-workshop checklist (per live session)

Run through this the day before a live session. ~15 min.

### 2.1. The deployment is healthy

- [ ] Open https://<project>.web.app/ in an incognito window. Splash
      renders, connection badge shows **Connected** within 5 s.
- [ ] DevTools console: no errors during page load. ONE info hint is
      OK (the App Check "OFF" hint).

### 2.2. Anonymous auth is working

- [ ] In DevTools: `firebase.auth().currentUser.isAnonymous === true`
      (after page load). If this is false / errors, anonymous sign-in is
      disabled in the Firebase Console — re-enable it (§1.4).

### 2.3. A test session round-trips

- [ ] "I'm a facilitator → create a session", note the code (e.g.
      `7A8-K3M`).
- [ ] Second incognito tab → enter the code → fill the lobby → land
      in the waiting room.
- [ ] First tab: "Open admin dashboard" → Start session.
- [ ] Both tabs land in their rooms. Walk through stage transitions.
- [ ] First tab → "End session & download archive". Confirm the JSON
      file downloads and the closed banner appears in the second tab.

### 2.4. Authorised domains include the URL students will use

- [ ] If using a custom domain or a fresh `*.web.app` URL, check
      **Firebase Console → Authentication → Settings → Authorized
      domains** lists it. Otherwise Google sign-in fails for facilitators.

### 2.5. Past test data is purged

- [ ] If the stale-session cleanup workflow has been running, this is
      automatic. Otherwise: **Firebase Console → Realtime Database →
      Data → `sessions/`** → delete any obviously test-only sessions.

---

## 3. Manual database-rules deploy (fallback)

When the workflow's database-rules step warns
"service account lacks Firebase Realtime Database Admin" — either grant
the role (§1.5) for automation, OR do this once for an urgent rule fix:

```bash
# from the repo root
cd docs/Third_session/PBL_platform
firebase deploy --only database --project <project-id>
```

The CLI will prompt for a Google login the first time. The account
needs **Firebase Realtime Database Admin** (or full Editor / Owner) on
the project. Output should end with `✔ Deploy complete!`.

If you see "Failed to get instance details", the logged-in account
doesn't have the role — see §1.5.

---

## 4. Common failures

### 4.1. White-screen / no UI

Cause: a script.js syntax error or a missing static asset. Hard error.

1. DevTools → Console. The exception will name the line.
2. Roll back: `git revert <last-deploy-commit> && git push`. The
   workflow re-deploys on push.

### 4.2. SDK transport stuck on "Reconnecting…"

Witnessed twice in production. Symptoms: connection badge red, every DB
read hangs forever, REST calls work directly via curl.

Cause: **stale SDK state in browser storage** (an older anonymous-auth
token or an IndexedDB shard) that the SDK refuses to refresh from.

Fix (per-tab; doesn't affect other users):
1. DevTools → Application → Storage → "Clear site data" → reload.
2. The new anonymous auth + reconnection works on the fresh state.

Server-side checks (just to rule them out):
- Firebase Status page (status.firebase.google.com) — any incidents on
  Realtime Database in your region?
- Realtime Database → Usage → Connections — under 100/100 for Spark?
- A plain `curl
  "https://<project>-default-rtdb.europe-west1.firebasedatabase.app/.json?shallow=true"`
  → should return `{"error":"Permission denied"}` with **HTTP 401**.
  If it returns 503, the instance itself is down.

### 4.3. Anonymous sign-in fails

Symptom: connection badge shows "Auth disabled" (header). DevTools
prints `auth/operation-not-allowed`.

Cause: anonymous auth was turned off in Firebase Console.

Fix: §1.4.

### 4.4. Google sign-in fails with "auth/unauthorized-domain"

Symptom: facilitator's "Continue with Google" popup throws.

Cause: the domain isn't in the authorised-domains list.

Fix: §2.4.

### 4.5. CI workflow's "Deploy hosting" step fails

Common causes, in order of likelihood:
1. Service account JSON in `FIREBASE_SERVICE_ACCOUNT_<...>` secret is
   malformed or expired — regenerate (§1.5).
2. `firebase.json` has a syntax error — the unit tests workflow's
   syntax-check step catches this on PR, so it shouldn't reach main.
3. Hosting Admin role missing from the service account — §1.5.

### 4.6. Rule changes don't take effect after merge

If the workflow's database step shows a warning ("rules NOT deployed")
or you see old behaviour after a merge that includes a rules change:
1. The service account is probably missing `Firebase Realtime Database
   Admin` — grant it (§1.5).
2. While waiting, deploy manually (§3).

---

## 5. Credential rotation

### 5.1. Super-admin key

The super-admin key is what unlocks the "set the session password"
panel. If a facilitator who knows the key leaves the team, rotate.

1. Pick a new random string (≥24 chars).
2. Edit `firebase-config.js` → `window.CANAMED_SUPERADMIN_KEY = "..."`.
   **Important**: this file is public-source on the deploy. If you need
   real secrecy, leave the key `null` in the deployed file and use a
   local-only unpublished copy of `firebase-config.js` to set session
   passwords directly.
3. Push.

### 5.2. Service-account JSON

If the service-account key may have been exposed:
1. Firebase Console → Project settings → Service accounts → **delete**
   the old key.
2. **Generate new private key** → download.
3. GitHub repo → Settings → Secrets → update
   `FIREBASE_SERVICE_ACCOUNT_<...>` with the new JSON.
4. Trigger a workflow_dispatch run of the deploy workflow to verify.

### 5.3. Session admin passwords

A facilitator forgot their session password:
1. Open the session in the lobby.
2. Use the **super-admin set/change password** panel (needs the
   super-admin key from §5.1).

---

## 6. Retention cleanup

The `Cleanup stale sessions` GitHub Actions workflow runs daily at
03:17 UTC. It enforces the privacy policy's retention schedule
automatically.

### 6.1. Preview what would be purged

**Actions → Cleanup stale sessions → Run workflow** → leave "confirm"
at `false`. The run prints a KEEP / PURGE list per session without
deleting anything.

### 6.2. Adjust retention windows

Same dialog: edit `retention_closed_days` (default 30) or
`retention_open_days` (default 90). Don't reduce these below what the
privacy policy commits to — that's a privacy-doc edit first.

### 6.3. Disable temporarily

**Actions → Cleanup stale sessions → ⋯ → Disable workflow**.
Previously-purged sessions stay gone but nothing further is deleted.
Re-enable when ready.

---

## 7. Performance Monitoring

Off by default. Turn it on for the live workshop you want to measure:

1. Edit `firebase-config.js` → `window.CANAMED_PERF_MONITORING = true`.
2. Push to main; the workflow redeploys hosting.
3. Wait ≥24 h after the next live session for data to populate.
4. **Firebase Console → Performance** → "first_contentful_paint",
   "page_load", or per-network-request traces. Aggregate-only;
   timing-only; no participant data.

To turn it back off: set the flag back to `false` and redeploy.

---

## 8. Inherited a live deployment

If someone just handed you the keys:

1. Verify access:
   - https://console.firebase.google.com/project/<project-id> opens
     without "permission denied".
   - https://console.cloud.google.com/iam-admin/iam?project=<project-id>
     shows your account as Owner / Editor.
2. Read `firebase-config.js` to confirm the project ID + database URL.
3. Run the pre-workshop checklist (§2) end-to-end.
4. Skim the audit-status section near the bottom of `README.md` —
   it's the running list of "what's hardened, what's pending".
5. Open `docs/Third_session/PBL_platform/privacy.html` and check the
   six operator-specific placeholders are filled (controller addresses,
   IRB numbers, DPO email, retention period). If they're still
   placeholders, fill them before the next live session.

---

## 9. Advanced — authoring a new scenario (no developer required)

A medical educator who does NOT want to touch JavaScript can build a new
content pack (CASE + SCORING + PENALTIES + DECISIONS) using the standalone
authoring tool:

1. Open `docs/Third_session/PBL_platform/scenario-author.html` in a browser
   (no server needed — works offline via `file://`, or visit
   `/scenario-author.html` on the live deployment).
2. Fill in the form: each user-facing string has an English / French /
   Japanese triplet; English is the canonical fallback when fr/ja are blank.
3. Use **Validate** to check ids are unique, the synthesis prerequisites
   resolve, and every penalty `item` points to a real history/exam/labs row.
4. Use **Copy JSON snippet** to copy a
   `window.CANAMED_SCENARIOS["your-id"] = { ... }` block. Paste it inside
   the `window.CANAMED_SCENARIOS = { ... }` object near the bottom of
   `case-content.js`, then commit + deploy.
5. Round-trip works: an existing scenario can be pasted into **Load JSON**
   and edited in the form, then re-exported.

The tool is fully offline (no Firebase, no network calls). It is intended
for content editors; engine semantics (matcher behaviour, the synthesis
gate, the points panel) are documented inline in `case-content.js`.
