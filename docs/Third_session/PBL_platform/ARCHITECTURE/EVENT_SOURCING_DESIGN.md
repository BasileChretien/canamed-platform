# Event Sourcing Design

**Last Updated:** 2026-05-16
**Status:** Design only — no implementation in this PR.
**Scope:** CaNaMED PBL Platform (`docs/Third_session/PBL_platform/`)
**Related:** [data-model.md](data-model.md), [security-model.md](security-model.md),
[ACCESSIBILITY_AUDIT.md](ACCESSIBILITY_AUDIT.md)

This document proposes an **append-only event log** to live alongside
(not replace) the existing mutable per-room state in Firebase
Realtime Database. Implementation will land in a follow-up PR; this
file is the agreed contract between operator and engineering before
any rules change.

The two-line summary: today, every score adjustment and every reveal
is written in-place under `sessions/{code}/rooms/{r}/score/...` and
`...moduleA/revealed/...`. Researchers can read the final state but
have **no history of how it got there**. We want a second subtree,
`/events/`, that captures every state-changing action as an immutable
record — so the live UI keeps its fast mutable view, and the
research pipeline gets a true replay log.

---

## 1. Motivation

### 1.1 Research replay and reproducibility

The current schema lets us prove **what** a room scored. It cannot
prove **how** the score evolved minute by minute. For the research
write-up, four questions are unanswerable today without the live
session having been screen-recorded:

- *In what order did Caen vs Nagoya students reveal the red-flag
  exam findings?* (data-model.md §revealed records only the final
  set + the name of the first revealer.)
- *Did the team's score-per-minute curve plateau at the discussion
  stage?* (score subtree is overwritten — only the running total is
  observable, not the trajectory.)
- *How often does a manual award by the facilitator immediately
  precede a team's confidence spike?* (manual awards are stored, but
  ordered only by `pushId`, which is timestamp-based but
  monotonicity-not-guaranteed across rooms.)
- *Which decisions get re-voted before lock-in?* (vote.cast events
  are clobbered by vote.lockin in-place; only the final tally
  survives.)

An event log answers all four directly.

### 1.2 Facilitator debrief insight

During the debrief, a facilitator scrolling through "Stage 2 of
Room 3" sees a single number for the room's score. With an event
log we can render a **timeline view**: "11:42 — exam:knee revealed
by Akari (+5), 11:43 — vote cast for biopsy by Léa, 11:44 — Léa
unlocked the synthesis, +10 milestone". This makes the debrief
genuinely diagnostic rather than retrospective.

### 1.3 Audit completeness

[security-model.md](security-model.md) already mandates an
append-only admin audit log
(`sessions/{code}/admin_audit/{pushId}`). The events subtree
generalises the same idea to participant-side actions: every state
change becomes a citable record with a *who*, a *when*, and a
*payload*. Combined with the admin audit, the pair gives an
end-to-end story of every session.

### 1.4 Future ML on decision-making

If we publish a paper that says "Franco-Japanese teams discuss for
6 minutes before voting, vs 4 minutes for monocultural teams", we
need the timing data. Today we cannot extract it. With an event
log, that's a single SQL-style query against the exported
events.json.

We are **not** committing to building this ML now. The point of
the event log is to **preserve the option**: once the data is
captured, the analysis is unblocked later. The cost of NOT
capturing today is that every workshop that runs without it
contributes nothing to the eventual dataset.

---

## 2. Current state (for reference)

Today's mutable subtree, abridged from
[data-model.md](data-model.md):

```
sessions/{code}/rooms/{roomName}/
  ├── stage           : number 0..N
  ├── stageAt         : number (timestamp)
  ├── presence/{cid}  : { name, lastSeen }
  ├── moduleA/
  │   ├── revealed/{itemId} : { by, at }      # write-once
  │   └── answers/{prompt}  : { text, by, at } # write-once-then-edit
  ├── decisions/{dId}/
  │   ├── locked       : number | null
  │   └── votes/{cid}  : { choice, at }
  ├── score/
  │   ├── auto/{eventId}      : { points, reason, at }   # appended
  │   ├── manual/{pushId}     : { points, reason, by, at } # appended
  │   └── penalties/{eventId} : { points, reason, at }
  ├── callForHelp     : { by, at, msg, ack? } | null
  └── teamName        : string
```

Three observations matter for the event design:

1. **score/auto, score/manual, score/penalties are already
   append-only** (per `database.rules.json` `!data.exists()` rule).
   The events log can reuse exactly the same write rule pattern.
2. **revealed is write-once-per-item**, not append-only — the value
   is the first reveal record forever. To reconstruct *order across
   items*, you need an event per reveal in addition.
3. **votes are mutable** (a user can change their vote until
   lock-in). Today, only the final vote survives. The event log is
   where every cast gets captured.

---

## 3. Proposed schema

### 3.1 Path

```
sessions/{code}/rooms/{roomName}/events/{pushId}
```

`{pushId}` is a Firebase `push()` key (timestamp-prefixed, lexically
sortable). One event per write. No nesting.

### 3.2 Envelope

Every event shares a small, fixed-shape envelope:

```json
{
  "kind":    "<event kind, see §3.3>",
  "by":      "<participant name OR 'admin:<name>' OR 'system'>",
  "at":      <server timestamp, number>,
  "payload": { ... event-specific, <= 1 KB }
}
```

- `kind` is a closed enum (see §3.3). Unknown kinds are rejected by
  the rules.
- `by` is the participant's *displayed name* (matches the existing
  pattern in score/auto.reason, revealed.by, votes.cast). For admin
  actions, prefix with `admin:` so the replay tool can colour-code.
  For platform-emitted events (e.g. a milestone unlock fired by
  the scoring engine), use the literal `"system"`.
- `at` is a number, validated against `now` ± 5 minutes (the
  freshness rule already in `database.rules.json`; see
  security-model.md). This is the *only* place client clock skew is
  trusted; replays use this field as the canonical timeline.
- `payload` is a `kind`-specific object capped at ~1 KB. The cap is
  enforced by a `newData.toString().length < 4096` validation rule
  (the same pattern the message field on `callForHelp` already
  uses; the 4 KB ceiling absorbs the JSON envelope overhead).

### 3.3 Event kinds

| kind            | when written                                       | payload sketch |
|-----------------|----------------------------------------------------|----------------|
| `reveal`        | A participant reveals an item (history/exam/labs)  | `{ itemId, group, key?: bool }` |
| `answer`        | A group answer is submitted or edited              | `{ prompt, charCount, action: "create" \| "edit" }` |
| `vote.cast`     | A participant casts/changes their vote             | `{ decisionId, choice }` |
| `vote.lockin`   | The room locks a decision                          | `{ decisionId, finalChoice, voteCount }` |
| `score.auto`    | The scoring engine awards points                   | `{ points, reason, eventKey }` |
| `score.manual`  | A facilitator manually awards/deducts points       | `{ points, reason }` |
| `penalty`       | An automatic penalty fires                         | `{ points, reason, eventKey }` |
| `stage`         | The room advances/regresses stage                  | `{ from, to }` |
| `presence.in`   | A participant joins the room                       | `{ cid, name }` |
| `presence.out`  | A participant leaves the room                      | `{ cid, name, reason: "leave" \| "timeout" }` |
| `help`          | A participant calls for a facilitator              | `{ msg?: string }` |

The list is closed under the rules. Adding a new kind requires a
rules update (and a docs PR). This is intentional: a closed
vocabulary makes the replay tool tractable.

### 3.4 What is NOT captured

- **Free-text answer bodies.** The `answer` event records `prompt`
  + `charCount` + `action`, not the text itself. The text already
  lives in `moduleA/answers/{prompt}.text` (read by the existing
  archive export). Duplicating it here would double the special-
  category data footprint with no replay benefit. The replay tool
  joins the event timestamp against the answer subtree if it needs
  the body.
- **Typing-indicator state.** Per-keystroke writes would blow the
  storage budget (see §8). Typing is observed via presence only.
- **PII beyond `by` (the display name)** — no university, no year,
  no English level. Those are already in `pool/{cid}` if the
  research pipeline needs them.

---

## 4. Write strategy

### 4.1 Dual-write during migration

For every state change that today writes to the mutable subtree,
script.js will *also* write a matching `events/{pushId}` record.
The two writes are issued as a single `firebase.update({...multi-
path})` call so they succeed or fail atomically. The mutable write
remains the source of truth for live rendering; the event write
is the source of truth for replay.

Concretely (pseudo-code for `reveal()`):

```js
const update = {};
update[`rooms/${myRoom}/moduleA/revealed/${itemId}`] = { by: myName, at: serverTs };
update[`rooms/${myRoom}/events/${pushId}`] = {
  kind: "reveal",
  by: myName,
  at: serverTs,
  payload: { itemId, group, key: !!isKey }
};
sessionRef.update(update);
```

### 4.2 Why dual-write, not events-only

We considered making events the only source and projecting the
mutable state from them at read time. Rejected because:

- Live rendering reads many small fields (`stage`, `score.auto`,
  `presence`) hundreds of times per session. Projecting on every
  read would mean either (a) running a Cloud Function on every
  event write to maintain projections, or (b) reading the entire
  events log on every client render. (a) requires Blaze plan +
  more moving parts; (b) explodes bandwidth.
- The current code already trusts the mutable subtree. Touching
  every read path in script.js is a large refactor with broad
  regression surface.

Dual-write keeps the live path identical and adds the event log
alongside. Once we have months of dual-write data and a working
replay tool, we can revisit whether the mutable subtree can be
deprecated (see §7 Phase 4).

### 4.3 Atomicity and partial-write recovery

`firebase.update()` is atomic per call. Two failure modes still
exist:

- **Network drop mid-update.** The mutable write fails *and* the
  event write fails — no inconsistency.
- **Client crash between two separate update calls** (e.g. score
  award then stage advance in different code paths). The event log
  may have N events and the mutable state may have N-1
  applications. This is acceptable because the replay tool treats
  the event log as authoritative; the mutable state is a
  performance cache that may lag by a few events during a crash.

The audit log already lives with the same assumption (see
security-model.md §admin_audit). We accept the same trade-off here.

---

## 5. Read strategy

### 5.1 Live UI

**Unchanged.** The room view, scoreboard, leaderboard, presence
bar, dashboard — all continue to read from the mutable subtree.
No client code that exists today gets rewritten. The `events/`
subtree is **never** read by `script.js`.

### 5.2 Researchers

Researchers read the events subtree via the **existing archive
export** mechanism (see §7 Phase 2): when a facilitator clicks
"End session & download archive", the events for each room are
included in the archive JSON under `rooms.{r}.events`. Researchers
work from the downloaded archive, not from the live database.

This means researchers never need direct database access, and the
security model in `database.rules.json` does not need a new "read
for researchers" rule — the existing admin-only archive read is
sufficient. (See security-model.md §archive-read.)

### 5.3 Replay tool (separate PR)

A small Node.js script under `scripts/replay-events.js` will:

1. Read `rooms.{r}.events` from an archive JSON.
2. Apply events in `at`-order to an in-memory state object.
3. Emit the final state for each room.
4. Compare against the archive's `rooms.{r}.score` / `revealed` /
   `decisions` subtree.

A passing diff is the property test: "events fully reconstruct
mutable state". If it ever fails on real data, we have either a
dual-write bug or a clock-skew issue worth investigating.

---

## 6. Rules

The events subtree extends `database.rules.json` along the same
lines as `admin_audit`:

```jsonc
"events": {
  "$pushId": {
    ".read": "<same authority as the rest of the room read scope>",
    ".write": "
      !data.exists() &&
      newData.child('at').isNumber() &&
      newData.child('at').val() <= now + 300000 &&
      newData.child('at').val() >= now - 300000 &&
      newData.child('kind').isString() &&
      newData.child('kind').val().matches(/^(reveal|answer|vote\\.cast|vote\\.lockin|score\\.auto|score\\.manual|penalty|stage|presence\\.in|presence\\.out|help)$/) &&
      newData.child('by').isString() &&
      newData.child('by').val().length >= 1 &&
      newData.child('by').val().length <= 60 &&
      newData.toString().length < 4096
    ",
    ".validate": "..."
  }
}
```

Rule highlights:

- **Append-only**: `!data.exists()` — once written, the event
  record cannot be modified or deleted by anyone, ever. Same
  pattern as the existing admin_audit log.
- **Freshness-bounded**: `at` must be within ±5 minutes of server
  `now`. Same pattern as the existing call-help / score writes;
  blocks back-dating attacks.
- **Bounded size**: 4 KB per event, hard cap.
- **Closed `kind` enum**: typo / unknown kind rejected at the
  rules layer, not in client code.
- **Read scope**: identical to the parent room. No new privilege.

The `tests/rules.test.js` suite will gain matching assertions:
"events append-only", "events freshness window", "events kind
must be in the enum", "events size cap".

---

## 7. Migration plan

### Phase 1 — ship the events subtree + rules

- New rules block under `rooms/$roomName/events`.
- New `tests/rules.test.js` assertions.
- `script.js` extended to dual-write at every state-change site
  (10–12 sites; one per kind in §3.3).
- Feature flag `CANAMED_EVENT_LOG` (boolean global, default `true`
  in production, `false` in local-mode E2E) so we can disable
  dual-writing if a regression shows up.
- No UI change. Live rendering identical.

**Acceptance**: a workshop runs end-to-end; the events subtree
contains a record for every state change observed in the mutable
subtree; replay-events.js can reconstruct the final state with
zero diff.

### Phase 2 — extend the closed-session archive

- `closeSession()` (the existing "End session & download archive"
  flow) starts reading `rooms.{r}.events` and writes it into the
  archive JSON.
- Archive size grows by ~500 KB per session (see §8). Stays well
  under the existing facilitator-download budget.
- Documentation updated in OPERATOR_QUICK_START.md so the
  facilitator knows the archive now contains the full event log.

### Phase 3 — replay tool (separate PR)

- `scripts/replay-events.js` — pure Node, no Firebase dependency,
  reads an archive JSON from a path argument.
- Reconstructs final state and diffs against the archive's mutable
  subtree. Exit code 0 = clean replay; non-zero = drift report.
- Optionally produces a per-minute scoring chart (Markdown table)
  for the debrief.
- Wired into CI as a smoke test against a small fixture archive.

### Phase 4 — long-term: deprecate the mutable subtree?

Only after Phase 3 has run cleanly on at least 6 months of
real workshops *and* the replay tool has been used in at least
one published analysis. Likely outcome: keep the mutable
subtree as a performance cache forever, but treat events as
the source of truth for any historical query. No firm
commitment.

---

## 8. Risks

### 8.1 Storage growth

A workshop has, very roughly:

- 20 participants × 8 reveals = 160 reveal events
- 6 group answers × 2 edits = 12 answer events
- 4 decisions × 20 votes × 1.5 changes = 120 vote.cast events
- 4 decisions × 1 lock-in = 4 vote.lockin events
- ~40 score.auto + ~10 score.manual + ~5 penalty = ~55 score events
- 6 stage transitions
- 20 presence.in + 20 presence.out = 40 presence events
- 0–3 help events

Total: **~400 events / session**, well within the 500-event
estimate. At ~1 KB per event (envelope + payload + push key
overhead), that's **~400 KB per session**.

Firebase Realtime Database Spark (free) tier:
- Storage cap: 1 GB
- Daily download cap: 10 GB

At 400 KB / session and pruning after the 7-day retention window
(see [privacy.html §8](../privacy.html)), the dual-write stays
well under the free tier even at 100 sessions/week.

Blaze pay-as-you-go pricing (~$5/GB stored, ~$1/GB downloaded):
at 100 sessions/month × 400 KB × 12 months = 480 MB cumulative
storage → **well under $1/month**.

The accessibility & ops cost case is the same as the existing
admin audit log (sec/admin-audit-log, PR #72) — incremental.

### 8.2 CSP / rules limits

`database.rules.json` has a ~256 KB total-file ceiling. Today the
file is ~7 KB. Adding the events block adds ~1 KB. Headroom is
not a concern.

### 8.3 Replay drift

If a state-change site in script.js writes to the mutable subtree
but forgets to write the matching event, replay drifts. Detection:
the replay tool's CI smoke test (Phase 3) catches drift at PR
time. The mitigation is mechanical — every state-change site goes
through a `recordEvent(kind, payload)` helper added in Phase 1.

### 8.4 Privacy footprint

The event payloads are deliberately scrubbed of free text (§3.4).
Even so, the audit footprint grows: each event is a citable record
of "person X did Y at time T". This is already true of the
existing mutable subtree (reveal.by, score.manual.by). The events
add *granularity*, not new categories of data. The privacy notice
[privacy.html §4 + §8](../privacy.html) already covers the
retention model for "votes, scores, contributions". No notice
update is required for Phase 1; the retention windows match.

---

## 9. Open questions

### 9.1 Clock skew

`at` is a client timestamp validated against server `now` ± 5
minutes. Two participants writing nearly-simultaneous events from
clocks 30 seconds apart will appear out of true order in the
replay. For the four research questions in §1.1 this is
tolerable; for finer-grained analysis we'd need
`firebase.database.ServerValue.TIMESTAMP`, which Realtime
Database can synthesise but at the cost of a slightly more
complex validation rule. **Recommendation**: ship with client
`at` in Phase 1; switch to server-timestamp in a Phase 1.5 if
field analysis shows skew > 10 seconds in real data.

### 9.2 Replay ordering of concurrent writes

Two participants in the same room writing simultaneously can
generate two events with identical `at` values. The replay tool
sorts by `(at, pushId)` so the secondary sort key breaks ties
deterministically — but the *real* order of action in the room
remains a coin flip. This is a fundamental limit of distributed
writes; no schema can fix it. Document it in the replay tool's
output.

### 9.3 Partial event coverage during transition

Sessions started before Phase 1 dual-writing rolls out will have
**no events**, only the mutable subtree. The replay tool needs
to detect this and refuse to replay (or, in degraded mode, treat
the mutable state as the entire timeline collapsed at session-
end time). **Decision needed**: which mode? Recommendation:
refuse, with a clear "no events found — this session predates
event logging" error.

### 9.4 Event log on participant Leave

When a participant presses Leave, their `presence` entry is
removed. Should we also write a `presence.out` event? Yes — but
the rules write happens BEFORE the auth context is torn down, so
ordering matters. Mark as a Phase 1 implementation detail.

### 9.5 Should facilitator-initiated actions be tagged

`score.manual` is always by an admin. Should the rules require
`by` to start with `admin:` for that kind? Probably yes —
catches honest UI bugs. Document as a TODO for the rules block.

---

## 10. Decision needed from operator

Before Phase 1 work begins, the operator needs to confirm:

1. **Cost ceiling is acceptable.**
   - Spark (free) plan: zero new cost; storage stays well under
     the 1 GB cap even at 100 sessions/week with the 7-day
     retention purge.
   - Blaze plan: under $1/month for the foreseeable scale; under
     $10/month would cover an order-of-magnitude growth.
   - No change to the cost story for any plan.

2. **No new privacy notice required for Phase 1.**
   The event payloads are scrubbed of free text and contain
   only data already covered by the existing notice (display
   name, vote choice, reveal id, score delta, stage number).
   §13 of privacy.html (Security) already references the
   admin audit log; we'd add a one-line mention of the event
   log under the same section in Phase 2, alongside the
   archive change. **Operator confirmation requested**: is a
   one-line addition to §13 acceptable, or do we want a full
   notice-version bump (PIS v1 → PIS v2) that re-prompts
   participants for consent? Recommendation: one-line update,
   no re-consent — the new fields are derivative of the
   existing fields, not a new category.

3. **Phase 1 ship target.**
   Dual-write code + rules + tests is roughly 1 day of
   engineering. The replay tool (Phase 3) is another day.
   Phase 2 (archive extension) is a few hours. Total: ~2.5
   engineering days, in three separate PRs that can ship over
   2–3 weeks.

4. **Go / no-go on this design.**
   No code in this PR — the next step is operator approval of
   the schema in §3 and the rules sketch in §6, after which
   Phase 1 work starts on a new branch.

---

## 11. Out of scope (deliberate)

- **A replay UI in the platform itself.** The replay tool is a
  Node script for researchers; we are not adding a
  facilitator-facing "playback" button.
- **Storage of free-text answer bodies in the event log.** Bodies
  stay in the existing answer subtree; the event log records the
  metadata (prompt, charCount, edit-vs-create) only.
- **Cross-session event aggregation.** Each session's events live
  under that session's path; there is no cross-session query
  endpoint. Aggregation happens offline against downloaded
  archives.
- **Real-time analytics dashboards on the events log.** The mutable
  subtree continues to power the live admin dashboard. Events are
  for after-the-fact research, not live ops.

---

## 12. Summary

A new append-only `events/{pushId}` subtree, dual-written
alongside the existing mutable state, captures every state-change
as an immutable record with a who / when / payload. The live UI
is unchanged; researchers gain a replayable timeline; cost stays
under $1/month at projected scale.

**Next action**: operator review and sign-off on §3 (schema) and
§6 (rules sketch). Implementation lands in a follow-up PR per the
phased plan in §7.
