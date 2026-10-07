# Operator Policy: Security disclosure, Blaze plan migration, and ops contacts

This document captures the platform's operator-level policies that need a
human decision rather than a code change. It's the place a new operator
(faculty, ops engineer) reads to understand the live-service posture.

---

## 1. Responsible disclosure / coordinated vulnerability disclosure

The CaNaMED platform handles student PII (names, university, year, English
level, free-text answers about clinically sensitive topics under GDPR Art. 9
and APPI Art. 2(3)). Security researchers who find a vulnerability are
asked to follow this disclosure protocol:

### Scope (in)

- The Firebase Hosting deployment at `canamed-69785.web.app`
- The Realtime Database rules at `docs/Third_session/PBL_platform/database.rules.json`
- The auth + session lifecycle at `docs/Third_session/PBL_platform/script.js`
- The CSP / hosting headers in `docs/Third_session/PBL_platform/firebase.json`

### Scope (out)

- Issues only reproducible on the local dev server (`scripts/serve-platform.js`)
- DoS / volumetric attacks
- Findings in third-party services (Firebase, Google reCAPTCHA) — report
  those to the vendor

### Reporting

Email a single message to **`canamed-security@unicaen.fr`** (operator
deliverable — to be confirmed and provisioned before publishing this
notice). PGP key fingerprint placeholder: `[to be added]`. Please include:

- A short description of the vulnerability
- Steps to reproduce
- Impact assessment
- Your preferred attribution (or anonymous)

### Response targets

- **Acknowledge** within 5 working days
- **First triage + severity rating** within 10 working days
- **Resolution or mitigation plan** within 90 days for High/Critical, 180
  for Medium

We commit to public credit (CVE if applicable, line in the release notes)
unless the reporter prefers to stay anonymous. No legal action will be
taken against good-faith research that respects scope and avoids
exfiltrating real-user data.

### Safe-harbour conditions

- Stop at the first evidence of access — do not pivot or persist
- Do not exfiltrate user data beyond the minimum needed to demonstrate
  the issue
- Do not interact with workshops in progress (visible via active session
  codes on the dashboard)
- Notify us at the first opportunity

---

## 2. Firebase Spark vs Blaze plan migration

The platform runs on the **Spark (free) plan** today. This has hard caps
that are fine for single-session use but will be exceeded at scale:

| Resource | Spark cap | Notes |
|----------|-----------|-------|
| Realtime Database simultaneous connections | 100 | one tab = one connection; a 30-student session uses ~32 |
| Realtime Database storage | 1 GB | session data is small (~1 MB / session) |
| Realtime Database egress | 10 GB / month | the throttle most likely to bite during heavy debrief downloads |
| Hosting transfer | 10 GB / month | static assets gzipped are ~50 KB total |
| Hosting build storage | 1 GB | well under |
| Cloud Functions | — not available — | Spark plan does not include Functions |

### What we'd unlock on Blaze

1. **Cloud Functions** — needed to:
   - Accept CSP violation reports at `/_csp_report` (currently 404)
   - Run pseudonymised export jobs on a schedule (today the facilitator
     downloads the archive manually)
   - Send help-call notifications via Pub/Sub for facilitators on a
     different device
   - Implement per-IP rate limiting beyond what Realtime Database rules
     can do

2. **Higher connection cap** — Blaze removes the 100-simultaneous limit;
   pay-as-you-go after ~200,000 connection-minutes/month. A 30-student
   session for 3 hours = 30 × 180 = 5400 connection-minutes — well within
   the free Blaze allowance, but no longer capped.

3. **Better observability** — Cloud Logging, Cloud Monitoring, alerts on
   budget overrun.

### Cost estimate

For 5 workshops of ~30 students × 3 hours each per month:

- Database connections: free (under 200K minute-allowance)
- Database storage: free (under 5 GB)
- Database egress: ~ $0.50 (under 5 GB)
- Hosting transfer: free (under 10 GB)
- Cloud Functions: ~ $0.10 (well under 2M invocation free tier)

**Estimated monthly cost: under $5.** A $10/month budget alert in Cloud
Console gives substantial headroom.

### Risk: runaway cost

Set a **budget alert at $5/month** and a **hard budget cap at $25/month**
in Cloud Billing. If the cap is hit, Cloud Functions are paused — the
static site keeps serving but reports/jobs stop. Set up the alert on the
billing account before flipping to Blaze.

### Migration steps (operator deliverable)

1. Add a billing account to the Firebase project (Firebase console →
   Settings → Usage and Billing → Modify Plan → Blaze)
2. Set the $5 budget alert + $25 hard cap
3. Deploy Cloud Functions for `/_csp_report` (separate PR)
4. Enable Cloud Monitoring + create an alert policy for "Function invocations
   per minute > 100" (catches abuse)
5. Document the rollback path: Blaze can be downgraded back to Spark
   but Functions will be deleted

---

## 3. Operator contacts

| Role | Contact | Responsibility |
|------|---------|----------------|
| Data Protection Officer (Caen) | `[to be added]` | GDPR data-subject requests, breach notifications |
| Joint controller PI (Caen) | `[to be added]` | Study-level decisions, ethics committee liaison |
| Joint controller PI (Nagoya) | `[to be added]` | APPI compliance, Japanese ethics committee |
| Platform engineering lead | `[to be added]` | Code reviews, deployment authorization, on-call |
| Security disclosure | `canamed-security@unicaen.fr` | Vulnerability reports (per §1) |
| Bug reports (non-security) | `canamed-bugs@unicaen.fr` | Operational bugs, see in-app "Report a bug" |

(All addresses are operator deliverables — confirm before publishing.)

---

## 4. Erasure requests (GDPR Art. 17 / Art. 7(3), APPI Art. 35(5))

Erasing a participant is an **operator action**. The product has a withdrawal
button (the waiting screen, and each row of the account's session history), but
it only **records** the request — under `withdrawals/` — and the daily monitor
in §6 watches the clock. Nothing is deleted until you run the tool below
(Annex VI **G12**).

```bash
# 1. ALWAYS look first. Dry run is the default; nothing is written.
#    A request made in the product is about ONE session: name it.
node scripts/erase-participant.js --uid <uid> --session <code>
```

For an organisation's session the key is `orgs/<slug>/<code>`.

⚠️ **Leave `--session` out and the run is the person, everywhere.** It erases
them from every session in the database and answers every open request they
have for a purged session (§4.1). That is the right run for "erase me from the
platform" and the wrong one for a request about one session — which is why
both commands in this section carry `--session`. (Until 2026-10-07 step 2
below did not, so copying steps 1 and 2 ran the everywhere run.)

**The account record.** Whenever the tool finds the person in a session that is
in the database, it deletes `users/<uid>` whole — profile and the history of
every session — with or without `--session`. When it finds them in none (every
session of theirs has been purged), the account record stays, apart from the
history rows of the purged sessions it answers. The plan lists the paths; read
them rather than this paragraph.

Read the whole report before confirming. It prints three things:

- **PLAN** — every path that will be deleted, per session.
- **AMBIGUOUS** — entries attributed by display name with no id beside them.
  These are **not** deleted. Two students with the same name in one cohort is
  ordinary, so confirm identity by hand before touching them.
- **UNERASABLE** — `roomChat`. Turns carry no author, so this participant's
  conversation with the simulated patient cannot be separated from their
  roommates'. Erasing it means erasing other people's data.

```bash
# 2. Then, and only then — the SAME scope as the run you just read:
ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid> --session <code> --reason "Art. 17 request"
```

The run writes a **suppression record** at `erasures/`. ⚠️ **Do not delete
that record.** The nightly snapshots are not rewritten — they expire on their
own 90-day cycle — and the record is the only thing stopping a restore from
bringing the participant back. It must outlive the last snapshot that contains
them, which is up to 90 days after the erasure.

⚠️ **`--reason` is one of a fixed list, never a note.** It is written into that
record, which is kept for ever and read every day by the scheduled jobs. Give a
code or the text it stands for; anything else is refused before the tool reads
or writes:

| code | stored as |
| --- | --- |
| `erasure-request` (the default) | erasure request |
| `art17` | Art. 17 request |
| `art7-3` | Art. 7(3) withdrawal |
| `appi35` | APPI Art. 35(5) request |
| `controller` | controller instruction |

Who asked, how, and anything else about the request belong in your own
register, not on the command line. (The reason given with `--dismiss`, §4.1, is
only printed and may say what you like.)

`scripts/restore-sessions.js` applies the list before writing, and refuses to
run if it cannot read it. Restore is likewise dry-run by default
(`RESTORE_CONFIRM=1` to write).

**Tell the requester what actually happened**, including the parts that did not:
the live platform is cleared immediately; backup copies are put beyond use and
expire within 90 days; and if their room used the simulated-patient chat, that
conversation cannot be separated out.

### 4.1 When the session has already been purged

Sessions are purged 30 days after closing and 90 after creation, so a request
that arrives later names a session the tool cannot walk. The purge leaves a
**marker** for each session it removes (`purgedSessions/<code>`), and the
request itself is kept until it is answered.

```bash
# Dry run. --uid is required: a purged session cannot be addressed any other way.
# --session keeps the run to the ONE session the request is about.
node scripts/erase-participant.js --uid <uid> --session <code>
```

⚠️ **`--uid` without `--session` means the person, everywhere**: every purged
session they have an open request for, **and every session still in the
database — and, if it finds them in one, their whole account record**
(`users/<uid>`), whether or not they asked about those (§4, "The account
record"). That is the right run for "erase me from the platform" and
the wrong one for a request about one session. The tool prints a `SCOPE` line
at the top of its plan when it is about to do the first; an argument it does
not recognise stops it, so a mistyped `--session` cannot turn into that run.
For an organisation's session the key is `orgs/<slug>/<code>`.

The report lists the purged session(s) the person has an open request for, and
what the tool **cannot reach**. Read that list; it is your work:

- **The research copy.** The nightly export reads only sessions that are in
  the database. If the participant had consented, they are in the exports made
  before the purge and in anything built from them, and nothing automatic will
  take them out. Remove them, or establish that they were never in it.
- **Their certificate**, if one was published. It is public for up to five
  years and cannot be found from a uid once the session is gone. Ask the
  participant for the certificate id and delete `credentials/<id>` by hand.

```bash
# Only after that. The flag is your statement that the research copy is dealt with.
ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid> --session <code> \
    --research-copy-checked --reason "Art. 17 request"
```

This writes the suppression record (so a restore leaves them out of the
snapshots that still hold the session) and removes that session's row from
their history. The tool refuses to write without the flag. It cannot check what
the flag asserts — the record shows only that you said so.

The record reaches what the session's own tables join to the account. If the
participant had a browser that dropped out mid-join, its row is joined to
nothing; if you know that browser's id, add `--client-id <id>` and it goes into
the record too.

**Exit code 3 means the tool found a request it could not act on.** It says
which of these it is:

- **"no purge marker"** — nothing in the database shows the session existed,
  and the tool writes nothing for it.

  - It *was* a session, purged before the purge wrote markers (2026-10-07):
    download the nightly snapshots and rebuild the markers, then run the tool
    again. The snapshots must be of this database; the script refuses others.

    ```bash
    node scripts/backfill-purged-markers.js --file <snapshot.json> [--file …]
    ```

    ```bash
    BACKFILL_CONFIRM=1 node scripts/backfill-purged-markers.js --file <snapshot.json>
    ```

  - The snapshots do not hold it. Either it never was a session, or it was
    purged more than 90 days ago — in which case no copy this platform could
    restore still holds it, and the request can only concern the research copy
    and a certificate: deal with those by hand, tell the requester, and then
    remove the request. Removing it is not an erasure and leaves **no trace in
    the database** — write the decision and the reason in your own register.

    ```bash
    ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid> \
        --session <code> --dismiss --reason "<why>"
    ```

- **"a session that IS in the database, in which this person has nothing to
  erase"** — they were already erased and asked again, or they never took part.
  The same `--dismiss` command closes it; the tool checks again that nothing of
  theirs is in the session and refuses if anything is.

  ⚠️ What the tool knows here is that the code carries **no purge marker** —
  not that the session was never purged. A session purged before the purge
  wrote markers (2026-10-07) has none until the backfill above has been run,
  and what sits under its code today may be a visitor's row or another
  session. So **`--dismiss` refuses to run at all until the backfill has been
  run once** (it reads the switch the backfill sets, below); after it, a
  session the snapshots hold that is not the one in the database has its
  marker, and this heading means what it says.

`--dismiss` also removes that session's row from the person's history, and is
refused for a session that carries a purge marker: that session existed, so the
request is answered, not dismissed.

⚠️ **The marker decides, whatever is in the database.** Anyone signed in can
put a node back under a purged session's code — their own membership row is
enough — and a facilitator can reuse a code. Neither un-purges the session that
was purged: it is still in the snapshots, and the request is still answered
with the command above. The tool and the monitor say "its code is in the
database again" when they see this; it changes nothing you do. (Until the
review of 2026-10-07 the tool treated such a code as a live session, found
nothing of the person's in it, and offered `--dismiss` — which closed a real
request unanswered.)

#### The backfill is also the switch — read this before confirming one

Until the backfill has been run with `BACKFILL_CONFIRM=1`, the rule that makes
a withdrawal name a real session is **off**: a withdrawal or erasure request is
accepted for any code, as it always was, and nothing in this section's
"exit code 3" list can be dismissed. A confirmed run writes the markers and, in
the same update, `ops/purgedMarkersBackfilledAt`, which turns the rule **on**.
Nothing else writes that node, no client can read or change it, and nothing
turns the rule off again short of deleting it by hand.

That makes confirming a decision about participants, and it is yours:

- A session purged **before the oldest snapshot you give the script** is in
  none of the files and gets no marker. From then on its participants are
  refused — "Could not record your withdrawal — please try again, or contact
  the facilitator" — and trying again cannot work.
- Snapshots are kept 90 days, so a session purged more than 90 days before the
  run can never be marked. Every day you wait, one more day of such sessions
  passes out of reach.

So: download **every** snapshot the archive still holds
(`backups/canamed-backup-YYYY-MM-DD.json` in the Scaleway bucket), and read the
dry run. It prints the dates the snapshots span, how many sessions it will
mark, and what turning the rule on means.

```bash
# Needs the service-account JSON in GOOGLE_APPLICATION_CREDENTIALS_JSON —
# default credentials alone are refused (the session listing wants a key).
node scripts/backfill-purged-markers.js --file <a.json> --file <b.json>
```

```bash
BACKFILL_CONFIRM=1 node scripts/backfill-purged-markers.js --file <a.json> --file <b.json>
```

Then run the first command again: it must print `to mark: 0` and
`Strict withdrawal rule: already ON`. Running it later with newer snapshots
only adds markers. The snapshot files are identified personal data: delete
them from your machine when you are done. There is no workflow for this on
purpose — the snapshots must not be downloaded onto a hosted runner.

**The backfill marks only what was a session**: a node that had a `created` or
a `closed` timestamp in some snapshot, the same test the purge applies. A
snapshot also holds whatever visitors wrote under made-up codes; the script
counts those ("no timestamp, never a session") and leaves them unmarked.

**"Still in the database" means that session, not that key.** For a code that
is both in a snapshot and in the database, the script reads what is there now
(`created/at`, `closed/at`, `creatorUid`) and leaves the session unmarked only
if it is the same one. A visitor's row, a `created` with another date, or a
new session by another account under the code all mean the snapshot's session
is gone, and it is marked; the run reports how many ("the code is in use
again, by something else"). The limit: a snapshot session with no
`creatorUid` is told apart by its `created` date alone, which somebody who
read it while the session existed could copy.

## 5. Rectification requests (GDPR Art. 16, APPI Art. 34)

```bash
node scripts/rectify-participant.js --uid <uid> --set name="Correct Name"
RECTIFY_CONFIRM=1 node scripts/rectify-participant.js --uid <uid> --set name="Correct Name"
```

Correctable fields are `name`, `university`, `year`, `english` — the values a
participant typed about themselves. **Answers are deliberately not correctable**:
Art. 16 is about factual accuracy, and rewriting someone's clinical reasoning
after the fact falsifies the record rather than correcting it.

The tool writes the pool entry and the roster together, so the two cannot end up
disagreeing. ⚠️ It will not CREATE a roster row — if a mistyped uid matches
nobody it does nothing, rather than inventing a participant with a name in it.

⚠️ **Tell the requester the archive is not rewritten.** Snapshots taken before
the correction still hold the old value and expire on their own 90-day cycle;
they are never used except to restore after an incident.

## 6. The data-rights deadline monitor

`Data-rights monitor` runs daily and **fails only when an erasure request has
passed the GDPR Art. 12(3) one-month limit**. A red run there is a real legal
deadline missed, not a flaky job — treat it as the highest-priority alert this
repository produces, and clear it by running the erasure tool in §4.

It warns in the log from day 21, so there is time to act before a breach. Its
output carries counts and ages only — **never a uid or a session code**, because
these logs are world-readable. Read the open requests from `withdrawals/` in the
database.

A request **survives the purge of its session** and stays in this monitor until
it is answered; there is no date on which it lapses. The failure message says
how many of the late requests name a purged session (§4.1) and how many name a
session with no purge marker (§4.1, exit code 3). A request counts as answered
only by the erasure record written for it: the record carries the request's own
date (`requestAt`) and is matched on that, not on which is later — so someone
who asks again after being erased has a new request. (A record written before
2026-10-07 has no such stamp and answers any request dated at or before it.)
Once a request for a purged session is answered, the nightly cleanup removes
the withdrawal record — unless something is in the database under that
session's code again, in which case the record stays, answered, until that is
gone. The record under `erasures/` stays in every case, and must.

If the monitor's own last line is `FATAL: the request queue could not be read`,
that is the job failing (exit code 2), not a deadline: it prints an error code
and no path, because its log is public.

## 7. Document version

**v1 · 2026-05** — initial publication.

Subsequent versions tracked here with a change-log entry per material edit.
