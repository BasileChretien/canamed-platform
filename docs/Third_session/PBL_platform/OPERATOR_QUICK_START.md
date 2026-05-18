# CaNaMED Operator Quick Start

A one-page guide for facilitators. Goal: from cold start to running a live
session in about five minutes.

If something is going wrong, jump to
[`OPERATOR_INCIDENT_RUNBOOK.md`](OPERATOR_INCIDENT_RUNBOOK.md) instead.

---

## Before the session (do this ~30 minutes ahead)

You need:

- **A modern browser** on a laptop you can leave open for the whole session
  (Chrome, Firefox, Edge or Safari — all current versions are fine).
- **The platform URL** for your deployment (e.g.
  `https://canamed-69785.web.app`). Bookmark it.
- **A second device or window** to play the participant role for the
  five-second sanity check.
- **A way to share a short code** with the room: read it aloud, write it on
  the board, or display the QR code the platform generates.

Suggested 30-minute warm-up:

1. Open the platform URL on your facilitator laptop.
2. Open the **Health check** page (link at the bottom of the splash, or
   `healthcheck.html` directly). All six rows should turn green. If any are
   red, go to the runbook before continuing.
3. From the splash, create a throwaway test session (see §1 below), join it
   from your phone as a "participant", confirm you appear in the waiting
   list, then close the test session.

You are now ready.

---

## 1. Create a session

From the splash page (the landing card with the CANAMED logo):

1. Click **"I'm a facilitator — create a session"**.
2. Fill in:
   - **Your name** (so participants know who is running the session).
   - **Workshop label** (optional, e.g. "Caen × Nagoya, May 2026"). Shown
     on the lobby and on the exported archive — useful for filing.
   - **Session password** — pick something short you can re-type. You will
     need it to re-open the admin dashboard if you reload the page. Treat
     it as a low-stakes shared secret, not an account credential.
   - **Scenario**: pick a built-in (e.g. *Chronic Pain & the Opioid
     Request*) or paste a custom scenario JSON. If unsure, pick the
     built-in.
3. Click **Create**. The platform shows a short code like `ABC-DEF` and a
   QR code.
4. Click **"Open admin dashboard"**. You are now the admin for that
   session.

```
+-------------------------------------------+
|  CANAMED                                  |
|                                           |
|  Your session code:                       |
|                                           |
|      A B C - D E F                        |
|                                           |
|  [ QR code image ]                        |
|                                           |
|  [ Copy join link ]   [ Open dashboard ]  |
+-------------------------------------------+
```

---

## 2. Share the code with the room

Three ways, pick whatever the room can see:

- **Read it aloud.** Codes are case-insensitive (`abc-def` works the same
  as `ABC-DEF`), so spelling is forgiving.
- **Show the QR code.** Display the admin screen on the projector and let
  students scan with their phone camera. The QR encodes the join URL with
  the code pre-filled.
- **Copy the join link.** The dashboard has a *"Copy join link"* button
  that copies a URL of the form `…/?session=ABC-DEF`. Drop this into your
  chat (Teams, Slack, email).

Students land on a lobby with:

- the workshop label,
- the scenario name,
- their name + university + year + English-level form,
- two consent checkboxes (participation = required; research re-use =
  optional, no impact on grade),
- a **Join** button.

After joining, each student sits in a waiting room. You see their name
appear live in the dashboard's pool list.

---

## 3. Watch the dashboard

The admin dashboard is your home base for the whole session. It shows:

- **The pool** — everyone who has joined but is not yet in a room.
- **The rooms** — one card per room, showing its current stage, head
  count, and any pending help-call alert (a red bell badge).
- **Score per room and per cohort.**
- **Action buttons:** *Open room*, *Advance →*, *← Back*, *Award points*.

When you have ~most of the expected students in the pool, choose the
**number of rooms** (the platform suggests one room per ~5 students) and
press **Start session**. The platform balances everyone across rooms by:

1. Franco–Japanese (or whichever cohorts you defined) mix, *priority*.
2. Year-of-study spread.
3. English-level spread.

Each room then shows up as a card on the dashboard.

```
+------------------+ +------------------+ +------------------+
|  Room A          | |  Room B          | |  Room C          |
|  Stage 1 / 3     | |  Stage 1 / 3     | |  Stage 1 / 3     |
|  6 students      | |  5 students      | |  6 students      |
|  Score: 12 pts   | |  Score:  8 pts   | |  Score: 14 pts   |
|  [Open] [Adv ->] | |  [Open] [Adv ->] | |  [Open] [Adv ->] |
+------------------+ +------------------+ +------------------+
```

A red bell badge on a card means that room has pressed **Call a
facilitator**. Click *Open room* to enter — the alert clears
automatically and you see the exact view those students see, plus a side
panel listing every other room so you can hop without going back to the
dashboard.

---

## 4. Advance the session

Each room moves through four stages (Welcome → Module A → Module B →
Wrap-up). Stages move forward only when you say so.

- **Advance one room:** *Advance →* on that room's card (or the *Advance*
  button inside the room view).
- **Send everyone forward at once:** *Advance all rooms* at the top of
  the dashboard.
- **Send a room back a stage:** *← Back* on that room's card. Useful if
  the room wasn't ready, or if you want to revisit something at debrief.

Students cannot move past the stage you've set; they can only re-read
prior stages on their own screens.

---

## 5. Close and download the archive

When the session is over:

1. From the admin dashboard, click **"End session & download archive"**.
2. Confirm.
3. A file named `canamed-{code}-{timestamp}.json` downloads to your usual
   downloads folder. It contains every group's answers, votes, revealed
   findings, scores, contributions, presence, help-calls, and decisions.
4. Students immediately see a green *"Session closed — your team's work
   has been saved"* banner.

Clicking the same button again re-downloads the archive (no second
confirmation) — useful if you need to email it to a collaborator after
the workshop.

Keep the archive in a safe place. The live database copy is purged after
7 days (and after 30 days for closed sessions) by the automatic cleanup
workflow; the JSON file is the long-lived record.

---

## Common gotchas

- **Codes are case-insensitive.** `abc-def`, `ABC-DEF` and `Abc-Def` all
  unlock the same session. The dash is also optional in practice: the
  platform sanitises before matching.
- **Refreshing the page is safe for students.** They reconnect to the
  same room automatically, as long as the session is still open.
- **Refreshing the page is safe for you too,** *if* you remember the
  session password. The dashboard will re-prompt for it.
- **Late arrival?** Tell them to enter the same code — the platform
  auto-assigns them to the smallest room to preserve balance. If you
  want them in a specific room instead, open the dashboard, click that
  room's card, and use the *"Move participant here"* action on their
  name in the pool side panel.
- **Help-call alerts spamming the dashboard?** There's a *Mute alerts*
  checkbox at the top of the dashboard — the badges still appear on the
  cards, but the sound + toast notifications go quiet.
- **Stale data on the dashboard / phantom rooms after editing things?**
  Clear `localStorage` (DevTools → Application → Local Storage → Clear)
  and reload. See the incident runbook for the exact key list.
- **Mid-session, the page asks for your password again.** That's normal
  after a long idle. The hash is checked locally; no network call.
- **Don't close the session by accident.** Closing is final — the
  database refuses all writes from then on. Re-creating the session is
  fine but participants need the new code.

---

## What to do if something breaks

See [`OPERATOR_INCIDENT_RUNBOOK.md`](OPERATOR_INCIDENT_RUNBOOK.md). The
runbook has a quick-reference table at the top mapping a symptom you can
see in front of you to a first-line fix you can apply in under a minute.
