# Known security follow-ups

> Moved verbatim from `CLAUDE.md` on 2026-11-04 (its lines 1430–3324), so that
> it is read when needed instead of loading into every session. It holds open and closed security findings, with how to verify each.
> The **STATUS-CLAIM RULE** in `CLAUDE.md` applies to every status label here:
> verify against the code or live system before relaying one, and update the
> label in the same commit as the work that changes it. Where the text says
> "below" or "above", the section may now be in `docs/STATUS.md`,
> `docs/security-follow-ups.md` or `docs/scenario-characters.md`.

## Known security follow-ups (code, tracked)
- **A session's recovery code is purged with it (2026-10-07) — ⛔ the backlog
  sweep has only been DRY-RUN (34 records to delete); #447 makes a password
  reset need a password to reset, IN THE RULES (live only once a deploy has
  released them); and the takeover route through the reset — the recovery
  code readable by every session member while a reset was in progress — is
  CLOSED IN CODE by #451, ⛔ live only once its rules AND its
  shell have shipped, with one deliberate residual (its entry is the last
  sub-bullet below).**
  `createSession()` writes `recovery/sessions/<code>` (org:
  `recovery/orgs/<slug>/sessions/<id>` — the ROSTER's shape, not adminSecrets')
  and from 2026-05-25 until the fix of 2026-10-07 nothing deleted it: the purge
  named six out-of-cascade siblings and this was not one. It is now
  `recoveryPath` in `locationFor()` and part of the purge's atomic update.
  - **Why that list kept being one short.** adminSecrets, roomChat, certIds,
    rosters, withdrawals and now recovery were each added after someone
    noticed, and each time the test pinned the list AS IT THEN WAS.
    `tests/purge-tree-coverage.test.js` DERIVES the per-session trees from
    `database.rules.json`, runs the real purge, and fails on one declared there
    and not deleted. Every wildcard name outside the session trees has to be
    classified in that file — an unknown one fails, so a tree keyed by `$sid`
    cannot slip past on spelling — and so does every top-level tree in which
    it finds no session key (an admin-only tree with no child rules has no
    wildcard to follow, and may be keyed by session all the same). A node has
    to be deleted WHOLE unless it is listed there as decided per record. What
    it cannot see: a tree with no rules entry at all (`ops/`, `metrics/`,
    `erasures/`). Two nodes are acknowledged there with their
    reasons: `rateLimits/session/$code` (the bucket's clock) and
    `users/$uid/history/$code` (the account's).
  - **What a leftover did — measured on the emulator, not inferred**
    (`tests-e2e/emulator/recovery-purge.spec.js`). (a) The node is write-once,
    so the real client drawing that code gets `permission_denied` on its
    recovery write, shows "Could not create the session — check your connection
    and try again", and leaves `created` + `creatorUid` and no hash behind.
    (b) The old code still satisfied `_superadminReset` at that session code.
    (a) is rare by chance — leftovers / 887 503 681 (31^6) per create.
  - **⛔ The backlog.** Records left before the fix have no session to be found
    through. `scripts/sweep-orphaned-recovery.js` (dispatch-only workflow
    `sweep-orphaned-recovery.yml`; dry-run unless `confirm`; keys only; counts
    only) removes every recovery record that has no session. It reads the
    recovery lists BEFORE the session lists — the other order condemns a
    session created mid-sweep — and refuses when a tree that holds records
    lists no session. That is counted PER TREE (the default tree, each org):
    over the whole database, one junk node under any org, which a signed-in
    visitor can create, vouched for a default tree that listed nothing (found
    in review). The override is TWO boxes — `allow_empty_default_tree` and
    `allow_empty_org_trees` — and neither waives the other: an org tree in that
    state is ordinary, and a visitor can also make one, so the box for it must
    not switch off the default tree's guard (also found in review).
    **The sweep encodes its REST paths itself** (`makeSweepReader`), because the
    slug under `recovery/orgs/` is validated by no rule. ⚠️ NOT inside the
    shared reader in `session-trees.js`: the anonymous-account job hands that
    reader paths it has ALREADY encoded, and for one commit on this branch the
    reader encoded them again — `My%2520Code` for the key `My Code`, a null,
    and "no members to protect" in a job that deletes nightly. Encoding twice
    is a different node, not a no-op; each caller encodes once.
    **DRY-RUN ONLY so far.** Run 37665330573 (2026-10-07, on main at b8133a0):
    6 sessions, 40 recovery records, 6 with a session, **34 with none** (all in
    the default tree), no empty tree. Nothing was deleted; the confirmed run
    is the operator's, and until it happens those 34 records each still block
    their session code. `Verify:`
    `gh run list --workflow sweep-orphaned-recovery.yml` lists the runs; for the
    confirmed one, `gh run view <id> --log | grep -E "Mode: +LIVE|Summary:"`
    prints `Mode:        LIVE — deletions WILL happen` and
    `Summary: <n> deleted, 0 left.` A dry run after it ends in
    `Summary: nothing to sweep.`
  - **✅ CLOSED IN THE RULES BY #447 — a reset needs a password, and a
    recovery code is its creator's to write. Two predicates, both trees.
    ⛔ LIVE ONLY ONCE A DEPLOY HAS RELEASED THE RULES [released: ____ ] — they
    ship in a `continue-on-error` step, see `Verify:`. #447 left four things
    open. The first, a takeover route, has its own fix (#451) and its own entry
    directly below this one; THREE stay open and are listed here.** Before
    #447 the reset flag (then `sessions/<code>/_superadminReset`) asked only
    for a
    matching `recovery/…/code` and a session that was not closed, and the
    recovery node could be written by any signed-in user wherever there was no
    node and no password (plus the allowlist, while `facilitatorGate` is
    enforced). The hash rules' reset branch has no `data.exists()`, so a reset
    could also set a FIRST hash — round the creator binding on that rule.
    **Measured on the emulator before the change, identically in both trees**
    (`tests-e2e/emulator/reset-needs-a-password.spec.js`; its tables carry the
    BEFORE column, and it is that run, not a recollection):
    - *no password, somebody else's old recovery record* — the half-created
      session a code collision leaves: the holder of the old code opened the
      reset and set the first hash; the creator's own first-hash write was
      then refused.
    - *no password, no recovery record, a `creatorUid`* — exactly a session
      restored by `restore-sessions.js` (the archive is the session body only:
      marker stripped, no `adminSecrets`, no `recovery`): a stranger wrote a
      code of their own, opened the reset, set the first hash. Refused only
      where the session was closed.
    - *a recovery record with no session at all, under an enforced
      `facilitatorGate`*: a user off the allowlist opened the reset and set a
      hash there (`created` stayed gated).
    **(a)** the reset flag's write requires the session's
    `adminPasswordHash` to exist — a reset needs something to reset. (The flag
    has since moved — next entry — and the requirement moved with it.)
    **(b)** the recovery write requires `!creatorUid.exists() || creatorUid ==
    auth.uid`, the binding the hash rules' first write already had.
    **(a) ALONE IS NOT ENOUGH — measured, not argued.** With the rules carrying
    (a) and not (b), the stranger still PLANTED a code on the restored session
    (allowed), was refused the reset while there was no password, and reset it
    as soon as the creator had set one. (b) is what stops the plant. (b) came
    out of the independent review of #443; my first proposal was (a) alone.
    **No client change.** Both reset call sites read the marker and issue a
    reset only when it exists; `createSession()` writes the recovery code in
    the same batch as `creatorUid`, so it lands before it (none yet) or after
    it (the writer's own). `tests/reset-needs-a-password.test.js` pins both,
    and the exact shape of the rules, and that the org rules are the default
    ones re-prefixed.
    **⚠️ STILL OPEN — three, each pinned as OPEN in the spec, not implied
    closed.** (The fourth — the recovery code being readable by every member
    while a reset was in progress — is the next entry.)
    - **No `creatorUid`** (a hand-made node, or a session older than the
      field): the hash rule opens its first password to anyone, so (b) adds
      nothing there.
    - **A stale recovery record still resets the session at its code** once
      that session has a password. No rule can tell a stale record from a
      fresh one; the purge and the sweep remove them — which is why the 34 the
      dry run found matter.
    - **A restored session has no password and no recovery record.** By the
      rules only its creator can give it one again (measured) — the same
      account, or for an anonymous creator the same browser. The stock client
      does offer it: the "set or recover the password" panel on the admin join
      works without a super-admin key, and with no marker it takes the
      first-write branch (read from `joinSuperAdmin()`; the rule verdicts are
      measured, that UI path was not driven). It writes NO recovery record, so
      a session re-keyed that way has no recovery code. A facilitator who is
      not that account —
      another device, or someone who only knew the password — cannot, and
      needs the operator and the Admin SDK. The recovery code they wrote down
      works again only if its record is still in the database: the archive
      does not hold it, and the purge deletes it with the session.
      (This line used to say the old code "is dead in any case". Not so: a
      session restored while its record still stands gets its old code back as
      soon as it has a password.)
    `Verify:` `node --test tests/reset-needs-a-password.test.js`; and on the
    emulator, the three cases of `reset-needs-a-password.spec.js`
    (`PORT=8771 npm run test:e2e:rules -- reset-needs-a-password`). Those test
    the REPO. For the live system, on the first NON-SKIPPED Deploy run whose
    commit contains the merge (a skipped run has no log, and a run on an
    earlier commit prints the same string for the rules it shipped):
    `gh run view <deploy run> --log | grep -F 'released successfully'` — the
    only string that means the rules shipped (the step is `continue-on-error`,
    and `Database rules deployed` is echoed by every run, success or not).
    Until that has been seen, production still has the old rules and all of
    the BEFORE column.
    ⚠️ #443 had already removed one accidental mitigation of all this: a
    session purged BY MISTAKE and then restored used to come back beside its
    old recovery record, which blocked the stranger's write. (b) now blocks it
    on purpose.
  - **✅ CLOSED IN CODE BY #451 — THE RECOVERY CODE WAS READABLE BY EVERY SESSION
    MEMBER WHILE A RESET WAS IN PROGRESS (found by the independent review of
    #447). ⛔ LIVE ONLY ONCE BOTH HALVES HAVE SHIPPED — the rules AND the
    shell [rules released: ____ · shell: v___ ]. ⚠️ ONE RESIDUAL, DELIBERATE:
    a code that leaked before then stays valid while its session is open.**
    A reset is opened by writing a flag that carries the session's recovery
    code IN CLEAR — the rule compares it. The flag used to be
    `sessions/<code>/_superadminReset`. That node had no `.read` of its own,
    so it inherited the session's, which any member has, and membership is
    self-claimed (`members/<own uid>`). So anyone signed in who knew a session
    code joined, listened on that node, and was handed the code the next time
    a facilitator used "forgot password"; from then on, while the session was
    open, they could open a reset themselves, overwrite the hash and write
    their own proof — which is all the creator-or-proof predicates ask for.
    The record is write-once, so a code that has leaked cannot be replaced.
    **Measured on the emulator before the change, identically in both trees**
    (`tests-e2e/emulator/reset-flag-unreadable.spec.js`; its table carries the
    BEFORE column, from a run of the then-current client against #447's
    rules): the watcher's listener received the real recovery code from the
    REAL client's reset panel, and a flag in the old node naming a user
    opened the hash for that user. One more thing was measured by the
    throwaway probe that preceded the spec, the same day and under the same
    rules, and is not in that column: a user who had not even joined deleted
    the facilitator's flag, and the facilitator's hash write was then refused.
    (The spec now shows the reverse on the new node: a stranger can neither
    delete nor overwrite another user's flag.)
    **No predicate could fix it** — a read that cascades cannot be revoked at
    a deeper path, so nothing under `sessions/` would do. What changed:
    - **Rules.** The flag is `adminSecrets/<code>/reset/<uid>` (org:
      `adminSecrets/orgs/<slug>/<id>/reset/<uid>`) — a tree with no `.read`
      anywhere — and holds `{ requestedAt, code }` only: the facilitator's
      display name and the `uid` field are gone, the uid is the KEY. Every
      write to it, a delete included, must be by that uid, so nobody can
      remove or replace another user's flag. The four hash rules read
      `reset/<auth.uid>`: only the user who opened a reset can use it (the R3
      recovery-race binding, now structural rather than a field to compare).
      The old node accepts a delete and nothing else, and no rule reads it.
    - **Client.** Both call sites: `joinSuperAdmin()` in script.js and the
      change-password handler in the lazy script-admin.js. No UI change.
    - **Ops, for a flag that a failed removal left in the OLD node** (it holds
      a code): the backup strips it, the restore withholds it (an archive
      taken earlier may hold one for its 90 days), and the purge writes a null
      there for every session it keeps. BLIND, in an update of its own after
      the purge: the PURGE may read, per session, the identifiers and the two
      dates and nothing else (`tests/ops-transfer-notice.test.js`; the backup
      and the export are disclosed full copies, a different matter), so it
      does not look first — `tests/reset-flag-unreadable.test.js` RECORDS its
      reads and fails on a third. Its log line counts paths written, not
      leftovers found. A dry run writes nothing; a run the backup gate refuses
      clears nothing. The facilitator's own archive download
      (script-admin.js) strips it too — it stripped only the password marker.
      The backup, the restore and the purge take the node's name from
      `scripts/lib/reset-flag.js`, whose header also says WHEN ALL THIS CAN BE
      REMOVED: the purge's null and the backup's strip once a let-through
      purge run after the rules release has logged `cleared`; the restore's
      withholding 90 days after this change reached main, when the last
      archive taken before it has expired. A state to check, not a date to
      wait for.
    **⚠️ NOT CLOSED, by decision and not by oversight (user, 2026-10-08): no
    rotation.** A code somebody obtained before both halves were live resets
    that session for as long as it is open — a reset does not issue a new
    code, and the record is still write-once. Closing the session stops any
    NEW reset being opened (measured: refused); one opened in the seconds
    before the close keeps its 30 s, because the hash rules look at the flag
    and not at `closed` — as they always have. The exposure empties on
    the retention clock: it is over once every session that existed before the
    RULES were released has been purged — a state, not a date. (Not "before
    the deploy": a session created after the site is published and before the
    rules step succeeds can still have its code exposed by a browser on the
    old shell.)
    **⚠️ TWO HALVES. A BROWSER THAT HAS ONE OF THEM IS REFUSED RATHER THAN
    LEAKING — BUT ONLY THE RULES RELEASE ENDS NEW EXPOSURE**
    (the two mixed states measured as raw writes — cells 3 and 4 of the
    spec's table; the third bullet is `main` as it was):
    - *new rules, a browser still on the old shell* — it writes the code to
      the old node, is DENIED, and nothing is stored or delivered to a
      listener. The panel then says "That recovery code doesn't match this
      session", which is false and is the only message it has. **If a
      facilitator reports that a correct recovery code is refused just after
      this ships, have them reload twice before anything else** (runbook §10,
      rewritten in the same change — it still said a super-admin key was
      required and described an audit trail that never existed).
    - *new shell, old rules* (the gap between Hosting and the rules release,
      or a rules step that failed — it is `continue-on-error`): the old rules
      declare nothing at `adminSecrets/<code>/reset`, so the write is denied.
    - *old shell, old rules* — NOT refused. A browser still on its cached
      shell, in that same gap, completes its reset through the old node and
      hands the code to a listener exactly as before. The new shell stops
      nothing for such a browser, and every deploy passes through this state
      (Hosting first). "Either half alone refuses" was true per browser and
      false per deployment (found in review): do not date the exposure as
      ended from the Hosting deploy — only from `released successfully`.
    `Verify:` `node --test tests/reset-flag-unreadable.test.js`; on the
    emulator `PORT=8771 npm run test:e2e:rules -- reset-flag-unreadable` (four
    cases: both trees, the real client's reset panel, and the purge's update
    sent by the real Admin SDK). Those test the REPO. For the LIVE system,
    three separate things: **rules** — on the first non-skipped Deploy run
    whose commit contains the merge,
    `gh run view <deploy run> --log | grep -F 'released successfully'`;
    **client** — `curl -s https://canamed-69785.web.app/script.js | grep -c
    _superadminReset` prints **0** (`script.js` no longer names the old node —
    `lib.js` and `script-admin.js` still do, to strip it from archives, so do
    not extend the check to them; on 2026-10-08, before this shipped, it
    printed 4 — judge it by the
    number, `grep -c` exits 1 on a zero); **purge** — the first nightly run
    after the merge logs `Leftover reset flags: cleared <n> path(s)`
    (`gh run view <cleanup run> --log | grep -F 'Leftover reset flags'`).
- **Self-serve soft-launch gate `facilitatorGate` (Phase 4c, opt-in, INERT by
  default).** A top-level admin-only node (`.read:false`, `.write:false` — set
  only via the Console/admin-SDK) that can restrict who may create sessions.
  The gate guards **every first-write session-bootstrap field** — not just
  `created` (gating only `created` was bypassable: a user could bootstrap a
  session via the ownership path `creatorUid`, the password-proof path
  `adminPasswordHash` + the real `adminSecrets/<code>/hash`, OR the **recovery**
  path — seed a `recovery/…/<code>` code on a hashless session → `_superadminReset`
  → set the hash via the recovery branch — none of which need `created`). So the
  predicate `facilitatorGate/enforce != true || facilitatorGate/allow/<auth.uid>
  == true` now sits on the first-write of `created`, `creatorUid`,
  `adminPasswordHash` (initial-set), `adminSecrets` hash (initial-set), **and the
  `recovery/…/<sessionId>` code write** — in **both** the `sessions/$id` and
  `orgs/$slug/sessions/$id` trees (**10 rules**; 16 since 2026-10-08, when
  `controller`, `workshopLabel` and `sections` took the recovery record's rule —
  see "A session's configuration is its creator's to write" below). The recovery-code write is
  itself a bootstrap field (written once at creation, before any hash), so gating
  it closes the recovery-bootstrap bypass. The reset flag's write (now
  `adminSecrets/…/reset/<uid>`; it was `_superadminReset` under the session)
  and the hash rules' **recovery branch** stay deliberately ungated —
  they act on already-established sessions (whose recovery code was written by
  their allowlisted creator) and must keep working under enforcement.
  (Until #447 "already-established" was the INTENT and not what the rules
  enforced: the reset also ran on a session with no password and on a code with
  no session. It now requires the session to have a password — see the
  recovery bullet above.) **Default
  (node absent) → `enforce.val()` is null → creation unchanged** for every
  existing facilitator; nothing is gated until an operator flips it on. To
  soft-launch to a vetted allowlist: set `facilitatorGate/enforce = true` and
  `facilitatorGate/allow/<uid> = true` for each approved uid; to open back up,
  delete the node (or set `enforce=false`). This mirrors the App-Check
  Monitor→Enforce posture (reversible, opt-in). Client-side "not approved"
  messaging is a deferred follow-up (needs `script.js` + a PWA bump); until then
  a non-allowlisted create surfaces a generic permission-denied. Covered by
  `tests/rules.test.js` (structural: admin-only + opt-in shape on all 8
  establishment writes + recovery branch survives) and
  `tests-e2e/emulator/rules-smoke.spec.js` (functional: open by default,
  allowlisted uid creates, non-allowlisted uid denied on `created`/`creatorUid`/
  `adminPasswordHash`/`adminSecrets` hash/**recovery code** in **both** trees, and
  an established session's reset-flag→hash-overwrite recovery chain still
  succeeds under enforcement).
- **Shared-library moderation primitive (Phase 4d, rules — client wiring PENDING).**
  Three top-level nodes support reporting + takedown of `sharedScenarios` without
  hard-deleting: (1) `moderators/$uid` — admin-only allowlist (`.read:false`,
  `.write:false`; set via Console/admin-SDK; rules reference it via `root.child`).
  (2) `reports/scenarios/$shareId/$reporterUid` — write-OWN (`$reporterUid ==
  auth.uid`) + write-ONCE (`!data.exists()`) + must target an EXISTING scenario
  (`sharedScenarios/$shareId.exists()`, bounds the queue — no fabricated-id
  storage pollution) + `.read:false` + `$other:false` sentinel; moderators review
  reports out-of-band via the admin SDK. (3)
  `moderation/removed/$shareId` — a tombstone writable ONLY by a moderator
  (`moderators/<uid> == true`), `.read:auth!=null` so clients can filter. It lives
  OUTSIDE `sharedScenarios` on purpose, so a scenario owner re-publishing their
  scenario cannot clear a takedown. Tested: `tests/rules.test.js` (structural) +
  `tests-e2e/emulator/rules-smoke.spec.js` (functional: report write-own/once,
  peer/other-uid denied, unknown-key denied, non-moderator tombstone denied,
  moderator tombstone allowed). **✅ CLIENT WIRING DONE (2026-07-23, shell v95):**
  `listSharedScenarios()` reads `moderation/removed` alongside the list and drops
  tombstoned entries (degrades to "nothing removed" if that read fails), so a
  takedown actually removes a scenario from the picker; and a "Report this
  scenario" button (`#splash-report-scenario`) appears only when the selection is
  `__ref:shared:` — someone ELSE's scenario — confirms via `canamedConfirm`, then
  writes `reports/scenarios/<shareId>/<uid>` via `reportSharedScenario()`.
  Reporting needs auth (anonymous suffices); with none it says "sign in" instead
  of faking a Reported state — which is why the LOCAL e2e (no `auth` in LOCAL
  mode) asserts the guard, while the WRITE is covered by the emulator test.
  Coverage: `tests-e2e/moderation-ui.spec.js` on desktop + 3 mobile viewports.
  The DOMPurify half of Phase 4d was already DONE + audited clean (every authored
  string reaches the DOM via textContent/esc/DOMPurify — see the selfserve memory).
  ~~⚠️ This landed with the perf budget at 336.9 / 337 KB gz — the room-only CSS
  lazy-split now BLOCKS the next UI change.~~ **RESOLVED 2026-07-23:** that
  reclaim is DONE — 384 room-only rules (58.9 KB raw) moved into a lazily
  `<link>`ed `room.css` (`CanamedLoader.ensureRoomStyles()`, same pattern as
  admin.css/branched.css), taking the splash budget **337 → 325 KB gz**. The cap
  stayed 337 at the time, so that was ~12 KB of banked headroom, not a licence to
  grow. **⚠️ SUPERSEDED — the cap is now 326** (`FIRST_PARTY_BYTES_LIMIT_KB`,
  `tests-e2e/perf.spec.js`): it rose 337 → 345 → 348 across the section-model
  work, FELL to 316 when #285 lazy-split the facilitator dashboard out of
  `script.js`, and rose 316 -> 320 on 2026-08-19 for the Module A triage slice
  — a bump taken AFTER lazy-splitting that feature (321.3 -> 316.5 KB gz), not
  instead of it; then 320 -> 324 (2026-09-03, withdrawal control) and 324 -> 327
  (2026-09-07, per-section rendering fix) — two consecutive bumps without a
  reclaim — then **the reclaim landed in the same PR (#396, 2026-09-08):**
  `downloadMyData()` moved into the lazy `data-rights.js` (−1.8 KB gz, 324.4 →
  322.6) and the cap came back to **326**, spending the reclaim on margin
  (~3.4 KB) rather than on a lower number. The measurement is CRLF-robust since
  2026-09-07, so a Windows checkout reads the CI figure. Each step is logged in
  that file's header. (This paragraph said
  348 until 2026-08-05 — exactly the drift it warns about, and in the more
  dangerous direction: a stale HIGH cap reads as headroom that does not exist.)
  Quote the CONSTANT, never this paragraph — a reviewer citing the stale 337
  raised a spurious budget-exceeded finding on PR #271 while the check was green.
  `Verify:` `grep FIRST_PARTY_BYTES_LIMIT_KB tests-e2e/perf.spec.js`. See the
  dated entry in `tests-e2e/perf.spec.js` for the triple guard used to make the
  split safe, and `tests-e2e/room-css-lazy.spec.js` for the contract that keeps
  room.css off the splash. **Note for CSS work:** room styles now live in
  `room.css`, so a unit test asserting a room rule must read style.css + room.css
  (that is why ~11 test files concatenate both).
- ~~`votes/ballots` is keyed by `stableId`, not `clientId`, so the clientMapping
  ownership guard (FINDING-01) does not cover it — needs a parallel stableId
  binding.~~ **Fixed:** added `stableIdMapping/$stableId → auth.uid` (write-once,
  mirrors `clientMapping`) under both `/sessions` and `/orgs`; the
  `votes/ballots/$clientId` write rule now requires ownership via either
  mapping (with a tolerant first-write branch). Client binds it in the join
  chain (`claimStableIdMapping`). Covered by `tests/rules.test.js` (structural)
  and `tests-e2e/emulator/rules-smoke.spec.js` (functional: peer overwrite
  denied, owner write + own-key first-write allowed).
- ~~Server-side admin-password verification (FINDING-07): `adminPasswordHash`
  is readable by any authenticated user (hash oracle).~~ **Fixed (free, no
  Blaze):** the real PBKDF2 hash now lives in the top-level `adminSecrets/<code>`
  tree, which has no `.read` rule (root is `.read:false`) so it is unreadable
  by every client — closing the offline oracle even for session members. Login
  verifies by a **proof-write**: the client writes its candidate hash to
  `adminSecrets/<code>/proof/<uid>` and the rule allows it only when the
  candidate equals the stored hash (compared server-side; hash never sent to a
  client). A non-secret random marker stays at `sessions/<code>/adminPasswordHash`
  so the existence-based admin-gated rules keep working. Active in `shared` mode
  for BOTH the default `sessions/` tree and org-scoped sessions
  (`adminSecrets/orgs/<slug>/<sessionId>`, added 2026-05-30); LOCAL keeps
  read-verify (no rules). See `verifyAdminPassword`,
  `useAdminSecrets`, the create/recovery flows, and `tests/rules.test.js` +
  `tests-e2e/emulator/rules-smoke.spec.js` (FINDING-07).
  - **The pre-adminSecrets fallback is still load-bearing. Do NOT remove it on a
    calendar date.** `verifyAdminPassword()` keeps a `legacyVerify()` path for
    "an older session that predates adminSecrets", and that legacy shape
    (`adminPasswordHash` present, `adminSecrets/<code>/hash` ABSENT) is exactly
    what made the null-equality admin-gate bypass exploitable (#297) — so a
    legacy session being reachable is what made that a real fix rather than
    defensive tidying.
    adminSecrets shipped **2026-05-24** (`ee9fc22`), so no session created after
    that can be legacy. But the retention arithmetic is NOT simply
    creation + 90 days, and a first pass at this got it wrong by 30 days.
    `scripts/cleanup-stale-sessions.js` branches on `closed/at` FIRST:
      - closed  → purge at `closed/at + CLEANUP_RETENTION_CLOSED_DAYS` (30)
      - else    → purge at `created/at + CLEANUP_RETENTION_OPEN_DAYS` (90)
    **Closing a session RESTARTS the clock.** A legacy session that stays open
    is gone by 2026-08-22, but one CLOSED just before that survives another 30
    days — a worst case of **2026-09-21**. And that still assumes the daily
    cleanup ran; it is a `continue-on-error`-style best effort, not a guarantee.
    `Verify:` recompute from `ee9fc22`'s date and BOTH retention constants, and
    read the branch order in `cleanup-stale-sessions.js` — the closed branch
    ignores `created/at` entirely. Do NOT query production data for this.
    **Removal condition — a state, not a date.** Remove `legacyVerify()` and its
    create/recovery branches only once it is established that no session exists
    with `adminPasswordHash` set and `adminSecrets/<code>/hash` absent (an
    operator-side check, e.g. during a scheduled cleanup run). 2026-09-21 is the
    earliest that is *possible*, not the day it becomes true. Removing it while
    one such session lives locks a real facilitator out of it.
- ~~`pool/$clientId/room` is intentionally writable by any authenticated user
  (admin room-assignment + self-assign); residual room-griefing is accepted
  until a cryptographic admin identity exists.~~ **CLOSED — Phase 4a (2026-07-22).**
  `pool/$clientId/room` is now restricted to SELF-assign (the client owns its
  `clientMapping`) OR ADMIN-assign (creator `creatorUid == auth.uid` or a fresh
  password-proof at `adminSecrets/<code>/proof/<uid>`), in both the `sessions/`
  and `orgs/` trees. Same Phase-4a pass bound 19 other admin-write nodes
  (`started`, `roomCount`, `summary`, `mail`, `score/manual`, `_adminPresence`,
  the three links, org `audit`) to that same identity predicate. Validated by
  `tests-e2e/emulator/rules-smoke.spec.js` ("admin-write nodes + pool/room are
  creator/proof-bound (Phase 4a)") + structural asserts in
  `tests/round3-clientmapping.test.js`.
  - **`rooms/$roomId/stage` + `stageAt` — now ALSO identity-bound** (completed in
    the same PR #223). `setRoomStage` was changed from an RTDB `.transaction()`
    to a read-then-`set()`: a transaction does a client-side rule pre-check
    against the local cache, and the identity predicate references the unreadable
    `adminSecrets/proof` node, so a transaction-based advance was rejected
    client-side; a `.set()` is server-evaluated (full data). PWA shell bumped
    v93→v94; LOCAL-e2e `advance-and-close.spec.js` confirms Advance still
    propagates. The from-guard survives as a best-effort read-then-set check.
  - **Stale-proof hardening (PR #223 review):** all admin predicates check
    `adminSecrets/<code>/proof/<uid>.val() == …/hash.val()` (proof equals the
    CURRENT hash), not `.exists()` — so a proof written against an old password
    auto-invalidates when a password reset rotates the hash. Fixed on the
    `closed` rule too (it previously used `.exists()`).
- Module A `scoring/awarded/<famId>` is client-writable (write-once, bounded
  points, requires uidMembers membership). A teammate with dev tools can
  still pre-award their own room — accepted because this is collaborative
  pedagogy, not assessment. The 2026-05-28 review noted that the per-room
  `uidMembers` gate closes the cross-room griefing path that existed when
  the chat first landed; only same-room self-awarding remains. Server-side
  scoring would require returning `awards: [...]` from `hfPatient` and
  writing them via admin SDK — deferred. **Revisit when:** Module A scoring
  ever becomes graded / assessment (stakes appear) — then move scoring
  server-side. Until then accepted: Module A is formative, so the incentive
  to self-award is near-zero.

### A session's configuration is its creator's to write (2026-10-08) — fixed in the rules; confirm the deploy before calling it live

Eight nodes under `sessions/$sessionId` (and the org mirror) are written once,
when a session is created: `controller`, `workshopLabel`, `scenarioId`,
`sections`, `sectionBodies/$slot`, `modules`, `scenarioCustomJson`,
`scenarioRef`. The rule on each was `auth != null && !data.exists()` — once, by
ANYONE signed in, at any time. Whatever the creator left unset belonged to the
first visitor who knew the code, and write-once then stopped the creator from
undoing it.

- **What the create form leaves unset** (run, not read): it always writes
  `controller` and `sections`, and `workshopLabel` only when one is typed. So
  on a session created by the current form `scenarioId`, `modules`,
  `scenarioCustomJson` and `scenarioRef` were open, and the label when blank.
  A session created by a shell from before 2026-09-03 has no `controller`; one
  from before the section picker (end of July 2026) has no `sections`.
- **What a stranger's write did — measured on the emulator on 2026-10-08**,
  real create form, a second browser CONTEXT that knew only the code, a
  participant already in the room at the PBL stage. (The probes are not in the
  repository; the committed spec holds the denials.)

  | written by the stranger | participant who reloads, or joins after |
  | --- | --- |
  | `modules` | nothing — the section pick takes precedence |
  | `scenarioId` (another built-in) | nothing visible; the other case's cast is ambient until a section is on screen |
  | `scenarioCustomJson` with `format:"branched"` | the PBL stage loses its left column, vignette and patient chat |
  | `scenarioCustomJson` with a malformed `case` | page error; left on Welcome while the room is on stage 1 |
  | `scenarioRef` to a scenario the stranger shared | as `scenarioCustomJson` — and the stranger can keep editing it |
  | `controller`, session with none | join screen: "‹string›, the data controller for this session, collects…" |
  | `sections` + `sectionBodies/1`, session with no pick | join screen announces the stranger's section; the stage flow becomes that one section |

  A participant who did NOT reload saw nothing in any of them: the
  configuration is read once, at load. And AT THE PBL STAGE of a session that
  has a pick, the model's persona stayed the section's own — the stranger's
  `characters` were not in the prompt (the request was captured). That was not
  measured at Welcome or Wrap-up, where the ambient cast is what the chat
  holds (the hazard recorded under "Scenario characters").
- **The rules now — two of them, both trees.** All eight: once, and only while
  the session has no password.
  - `controller`, `workshopLabel`, `sections` — **the recovery record's rule,
    word for word**: `!adminPasswordHash.exists() && (!creatorUid.exists() ||
    creatorUid == auth.uid) && <creation gate>`. The creator; or, while the
    session has no creator yet, whoever may create one.
  - `scenarioId`, `modules`, `scenarioCustomJson`, `scenarioRef`,
    `sectionBodies/$slot` — `creatorUid == auth.uid &&
    !adminPasswordHash.exists()`. The creator and nobody else.
- ⚠️ **Why two, and why script.js was NOT changed.** `createSession()` issues
  `created`, `recovery`, `creatorUid` and the form's configuration in ONE
  `Promise.all`. A rule requiring the claim to have LANDED first holds only if
  the database applies one client's writes in the order it issued them. That
  is almost certainly so, and the emulator bears it out — but it cannot be
  shown on production before the rules are live, they deploy at once, and a
  wrong guess is every facilitator unable to create a session (the #438
  lesson: list what a REFUSAL does). So the three fields that ride the batch
  do not depend on it. The other five can be creator-only with no such bet:
  the only caller passes null for four of them, and the authored bodies are
  chained after the batch has been acknowledged.
  `tests/session-config-creator-bound.test.js` pins both facts. **Bring a
  scenario back into the create batch and that test fails** — give the field
  the in-batch rule, or chain it; do not delete the assertion.
- **What a session with NO creator gets — decided, not left over.** No creator
  and no password is a code nobody has claimed: the three in-batch fields are
  the first writer's (that is what creating a session is, and the creation
  gate applies), the five others are refused to everybody until somebody holds
  the claim. No creator but a password — the shape from before `creatorUid`
  (2026-05-27) — is closed to everyone while the password marker stands. (A
  holder of that session's recovery code could remove the marker through the
  reset branch, and the code would then be anyone's to claim. Read from the
  rules; no such session should have outlived the 90-day purge.)
- **No password-proof branch, unlike the Phase 4a nodes.** Those are written
  while a session runs; these are written before it has a password, when no
  proof can exist. Nothing in the product writes them later, and
  `ARCHITECTURE/data-model.md` describes them as "not changeable by admin
  mid-session". One exception, and it is the creator's: whoever holds the
  recovery code can remove the password marker through the reset branch
  (`.validate` does not run on a delete), which reopens the window for the
  creator alone. Read from the rules, not run.
- **Why nothing caught it.** Three unit tests compared the rule with the exact
  string `auth != null && !data.exists()` — green on the defect, red on the
  fix. And every hardening pass since Phase 4a worked from a list of nodes
  somebody had thought of; "write-once" read as "safe". The unit test now
  DERIVES the list: it parses each `.write` (and the `.validate` beside it)
  into its `&&` / `||` structure and asks whether there is a way through that
  never mentions `auth.uid`. **16 writes per tree have one** (23 until
  2026-10-14, when the seven room writes were given a writer — next section),
  each listed in that file's `OPEN` map with its reason:
  - 5 that are creating a session (`created`, `adminPasswordHash`'s first
    write, and the three in-batch fields);
  - 10 that are open for a client id nobody has claimed yet (`pool`, `poll`,
    `presence`, `typing`, `ballots`, `observers`, `roleChoices`, `tests` ×2,
    `survey`) — the tolerant first-write branch. ⚠️ **What is on record as
    accepted is narrower than what the rules allow** (found in the review of
    this change). "Accepted by design" and DPA R3 describe a brief window
    before the join chain commits the mapping. But an id the writer INVENTS
    is never claimed, so these stay open for as long as the session does, to
    anyone signed in who has the code — and the eight under `rooms/` name no
    room, so in any room: a pool entry with a consent record, a ballot the
    client counts, `tests` and `survey` rows the research export reads. Read
    from the rules, not run. Nobody has decided to accept THAT; DPA G14
    item 5 puts the question to the controller;
  - `_superadminReset`, which accepts a DELETE from anyone signed in and
    nothing else. Harmless since the reset flag moved (#451): no rule reads
    this node any more and no client writes it, so all there is to delete is
    a leftover from before the move. Until that change's rules are released,
    a delete there still cancels a reset in progress.

  It answers "does every way through name the writer", not "is the tie
  enough": a first version matched ties by regex and counted the ten
  client-id nodes as bound (found in review).
- **Found by that derivation, and closed by a separate change (2026-10-14):**
  seven room writes named nobody at all — `teamName`, `roleplayRound`,
  `callForHelp`, `sections/$slot/revealed/$itemId`, `moduleA/revealed/$itemId`,
  `events/$pushId` and `answerReplies/…`. What a visitor's write to each did,
  the rule they now carry and what it does not do are the next section. (This
  bullet used to say the `roomOf` gate their neighbours have was the fix. It
  was not: the facilitator writes six of them with no claim on the room.)
- ⚠️ **What the fix does not do.**
  (a) It does not repair a session that already carries a stranger's value,
  and nothing can tell one from the creator's — these nodes record no author.
  Production was not queried. The purge bounds it: 30 days after closing, 90
  after creation.
  (b) **Seeding an unclaimed code is narrowed, not closed.** On a code with no
  creator and no password, a visitor can still write `controller`,
  `workshopLabel` or `sections`. A facilitator whose creation then draws that
  code is refused at their own write of the same field and sees "Could not
  create the session"; a field their client does NOT write — a blank label,
  or the controller from a shell older than 2026-09-03 — would be carried
  into the session. The odds are the number of seeded codes over 31^6
  (887,503,681), and the nightly purge removes a session with no dates. The
  five content fields cannot be seeded at all.
  (c) A session restored by `restore-sessions.js` comes back with its
  `creatorUid` and without its password, so its original creator can write
  its unset configuration again until it is re-keyed. Nobody else can.
  (d) The session body goes to the nightly backup whole, and the research
  export passes all eight through as written — except `ownerUid` inside
  `scenarioRef`, which the transform removes from version 2 (run on the
  transform, not on the job) — so a value written before the fix travels
  with its session.
- **Four older emulator tests wrote `modules` / `sections` / `sectionBodies`
  on a code nobody had claimed.** They now claim it first. A rules test that
  seeds a session by hand must write `creatorUid` before the five creator-only
  nodes, and every one of the eight before the password.

`Verify:` `node --test tests/session-config-creator-bound.test.js`, and on the
emulator `PORT=8791 npm run test:e2e:rules -- session-config-creator-bound`.
Those test the REPOSITORY. For the live rules: the deploy step is best-effort,
so read its log — `gh run view <deploy run> --log | grep -F 'released
successfully'` — and do not take a green Deploy as proof.

### A room's seven open writes are the room's and the facilitator's (measured 2026-10-08, fixed 2026-10-14) — in the rules; confirm the deploy before calling it live

Seven writes under `rooms/$roomId` (and the org mirror) named nobody:
`teamName`, `roleplayRound`, `callForHelp`,
`sections/$slot/revealed/$itemId`, `moduleA/revealed/$itemId`,
`events/$pushId`, `answerReplies/$entryId/$replyId`. Each `.write` was
`auth != null && !closed` (plus append-only on `events`, plus the
one-call-at-a-time clause on `callForHelp`). Sign-in is automatic and
anonymous, so the writer could be anyone who knew a session code — joined or
not. Found by the derivation in `tests/session-config-creator-bound.test.js`
(#452), which listed them as open and left them open.

- **What a stranger's write did — measured on the emulator on 2026-10-08.**
  The real client in every seat; the stranger a further browser CONTEXT that
  never entered the code (no `members` entry, no client id, no `roomOf`,
  before or after). The probes are not in the repository; the committed spec
  holds the denials.

  | written by the stranger | what followed |
  | --- | --- |
  | `revealed` — the MRI | a participant's OWN client wrote the 12-point penalty within a tenth of a second (and 4 points for a first test). The stranger then deleted the reveal: the penalty stayed, and no member can remove one. The default case has 16 such items |
  | `callForHelp` | on the dashboard, with the stranger's 200 characters and a badge in the tab title. The thirty-second limit did not apply (delete, then call again). **A real call from the room was cancelled**: the dashboard went from calling to nothing, the room's button back to "Call a facilitator" |
  | `roleplayRound` | every participant's client rotated its own role (physician → patient), showed "You've swapped seats", and rewrote its own `roleChoices`; set back to 1 and raised again, it rotated again |
  | `answerReplies` | a reply forged under a participant's name; a real one rewritten; a real one deleted; a 200,000-character `cid` accepted |
  | `teamName` | on the room's score chip and team-name field, and on the dashboard row |
  | `events` | displayed nowhere; an entry signed as the facilitator stays with the session. Append-only held: it could not be rewritten or removed |
  | `moduleA/revealed` | the dashboard's "findings 0/31" became 1/31 for a room that had found nothing. Participants saw nothing. No client writes this address any more; the dashboard and the exports read it for a room with no slot state |

  All seven go to the nightly backup with the session, and the pseudonymised
  export keeps them: a `by` is replaced by the pseudonym of whichever
  participant the string NAMES, so a forged entry is attributed to that
  participant; `text`, `msg`, `payload` and the team name pass as written
  (read from `scripts/lib/pseudonymise.js`; not run).
- **The rule now — one clause appended to each of the seven, both trees.**
  Six of them: `&& (roomOf/<auth.uid>/room == $roomId || (<the Phase 4a
  facilitator predicate>))`. **`callForHelp` asks for less:**
  `&& (roomOf/<auth.uid>.exists() || (<the same predicate>))` — a claim on
  ANY room of the session. Nothing each rule had was taken away. `script.js`
  was not changed.
  ⚠️ **Why the call for help is different — a decision, taken on 2026-10-14
  after the merge gate's review blocked the first version** (relayed to the
  session that wrote this by the coordinating session, as Basile's). With a
  claim on THIS room required, a participant the product had put in another
  room (Leave, then join again — below) lost the one control that still
  worked for them: a regression against the rules as they were. **The price,
  accepted and pinned on the emulator: somebody who has JOINED the session can
  raise or cancel a call in another room.** A visitor who has joined nothing
  still cannot. Do not "tidy" `callForHelp` back to the room claim without
  reading the last test of the spec.
- ⚠️ **Why not "the room condition their neighbours have".** That was the
  likely fix, and it would have broken the facilitator. Run before the rule
  was written:
  - `events` — every stage change from the dashboard logs one in the room it
    moves (`setRoomStage()` → `logEvent()`), by a facilitator with no claim;
  - `callForHelp` — "Resolve call" inside a room is a delete;
  - `teamName`, `answerReplies`, `revealed`, `roleplayRound` — a facilitator
    who opens a room gets "the exact student view", and none of those
    controls checks `isRoomAdmin`. All four landed for the creator; the three
    that were tried (not the round) landed for a co-facilitator.

  And a facilitator DOES hold a claim — on the FIRST room it opens
  (`startRoom()` claims for whoever enters; the claim rule's own facilitator
  branch lets it through), and never another. So the room condition alone
  would have meant: works in the first room visited, refused in every other
  — and of these controls only Save name reports a failed write (see the
  refusal table below; the handlers are the same for a facilitator).
  `tests/room-writes-room-bound.test.js` pins each of those client facts. **Add
  an `isRoomAdmin` guard to one of the four and its rule may lose the second
  half; narrow the rule first and that test says what breaks.**
- **`reveal()` is a transaction, and it commits under this rule — measured.**
  This file records two rules that could not be written by transaction once
  they read a node the client does not hold (#223 on `stage`; the room
  claim). The rule on `revealed` now reads the room claim, or a proof no
  client can read at all. On the emulator, through the real client: a
  participant's click committed, and so did a co-facilitator's whose ONLY
  title in that room was the proof (it had opened the other room first).
  Scope of that statement: this node, compat SDK 12.17.1, the emulator. The
  two older cases were not re-run.
- **What a REFUSAL does.** The only participant refused is one who is in a
  room view with no claim on that room — the claim failed, or the pool and
  the claim disagree. They are already refused answers, hypotheses, votes and
  the chat. When the claim WRITE fails they are told "We could not confirm
  your place in this room"; when a claim exists and names another room,
  nothing is attempted and nothing is said.
  ⚠️ **There is a way into that state through the product — found by the
  independent review, then measured (twice out of two).** Press Leave, join
  again in the same browser: `leaveAndReload()` keeps the anonymous account,
  and its write-once claim with it, while the room is chosen afresh by
  `bestRoomFor()` — on a tie, the first by name. A participant who left
  "Room 2" came back in "Room 1" holding a claim on "Room 2". There, BEFORE
  this change: the answer was refused, the box kept its text, and a toast
  said "+3 — First answer written"; the call for help and the reveal landed.
  AFTER, in the first version of this change: those two were refused as
  well — the review's blocking finding. AFTER, as merged: the reveal is
  refused (with the team name, the replies and the round); **the call for
  help lands**, because it asks for a claim on any room (run: the spec's last
  test, which drove Leave, the rejoin and the button — and, since the
  placement was repaired, reaches the same state through the claim rule's
  facilitator branch) — though the `help` entry the
  button also writes to that room's event log is refused, since `events`
  still asks for a claim on the room itself (read from `initCallProf()` and
  the rule; not run). The repair of the placement
  itself is in the client and came after this change: see "One room per
  participant" below. A browser still on an older shell keeps the old
  placement until it updates, which is one reason the any-room call stays.
  The six controls, measured by removing a participant's claim (owner bypass)
  and using them:

  | control | what the participant is left with |
  | --- | --- |
  | a workup button | the answer in a toast (it fires before the write); no finding logged; a console error |
  | Save name | "Could not save the team name — check your connection and try again." |
  | Call a facilitator | the button says "called", then goes back; no message |
  | the "ready to move on" call | **"Facilitator called ✓" — and nothing was written.** That toast does not wait for the write |
  | agree / disagree | the reply appears and vanishes; no message |
  | Swap roles | refused, and that participant's client rotates its OWN role twice (once optimistically, once in the catch path) while the room stays where it was |

  None of this is new code: it is what each control does on ANY failed write,
  a dropped connection included. The two call rows now apply only to a
  participant with NO claim in the session at all (the claim write failed);
  one whose claim names another room keeps the button. ⚠️ So "no participant
  loses the call for help" is NOT what this change can say: one with no claim
  at all is still refused it, where on the rules as they were the call
  landed. No route through the product into that state has been shown — the
  one that was shown, Leave-and-rejoin, leaves a claim — and the client tells
  that participant their place could not be confirmed. If a route is found,
  it is a regression of the kind the review blocked. Not changed here — it
  is a client change (shell bump, and the eager budget has under 1 KB).
- ⚠️ **What it does not do.**
  (a) **It is not a boundary against somebody who has the code.** Joining is
  three writes (`clientMapping`, `pool`, `roomOf`) and asks for nothing else.
  Measured: refused before; allowed in the room joined; refused in the other;
  and present in the facilitator's waiting list. Everything in the first table
  can still be done by such a person — in ONE room, as a participant who is
  on the facilitator's list WHEN THEY JOIN; and, having joined, they can raise
  or cancel a call for help in ANY room (the decision above). "Listed" does
  not last: the claim needs a pool entry only at the moment it is written, the
  entry's owner may then delete it (`leaveAndReload()` does), and the
  write-once claim remains — an account no longer on the dashboard's list,
  still holding everything above. Read from the two rules, not run; the
  claim itself still records the account and the client id, and the
  facilitator can read it. The spec has a test whose only purpose is to
  record the first half of this.
  (b) **No ownership inside a room.** A roommate can still rewrite or delete
  another's reply (the G9 emulator case now records that instead of the
  missing gate), take back a reveal, cancel a call, rename the team.
  (c) **Four of the seven are not sealed.** `teamName` must be a string and
  `roleplayRound` a number, so neither can carry anything else, and
  `callForHelp` is sealed since 2026-10-15 (`by`, `at`, `ack`, `msg`; next
  item); the other four have no `$other`, so extra children are accepted,
  and `answerReplies`' `cid` has no length bound. The tracked `$other` item,
  in both trees at once. (This said "no `$other` on any of the seven" until
  the review counted, then "five" until `callForHelp` was sealed.)
  (d) It does not repair a session that already carries a stranger's value,
  and nothing tells one from the room's — `by` is free text. Production was
  not queried. The purge bounds it: 30 days after closing, 90 after creation.
  (e) The ten writes open for an unclaimed client id are untouched.
- ⚠️ **Four older defects met on the way — measured the same day, NOT fixed
  here.** Each is a change of its own (each has had one since — see each). The fourth is the Leave-and-rejoin
  misplacement above: it left a participant in a room where none of their
  work was saved, whatever this change did — fixed in the client since
  ("One room per participant" below). **The first two are fixed by the
  follow-up change (2026-10-14, `tests/call-for-help-ack.test.js`) — in the
  repository; the acknowledgement works in production only once a deploy has
  released the rules (`released successfully` in the Deploy log), the removal
  once the shell carrying it is live.**
  1. **The facilitator's acknowledgement of a call was refused** — since the
     first commit (2026-05-18). `openRoomAsAdmin()` re-sends the call with
     `ack: true` and its original `at`; the one-call-at-a-time clause refused
     it (`at` had not moved by thirty seconds), whole or as the `ack` child,
     for the creator and a co-facilitator alike; past a minute — the usual
     case — the validator refused its date too. The room never saw
     "A facilitator is coming ✓". **Fixed in the RULES only**, both trees: the
     clause has a fifth way through, the facilitator's (the Phase 4a
     predicate) writing `ack == true` onto the call that stands with `at` and
     `by` unchanged and `msg` unchanged or gone; the validator takes an older
     date on any ACKNOWLEDGED record that keeps `at`, `by` and `msg` (or
     drops `msg`) — that shape, not that writer. Both edits
     only ADD a way through, and the
     rule accepts the payload the deployed client already sends, so no
     browser needs a new shell for it. **New to students:** the acknowledged
     state, and "tap to call again" from it. Still open, pinned as such: a
     participant can make a call read as acknowledged by re-dating it after
     thirty seconds — and, under the any-room claim, so can one of another
     room, who can also cancel it. **Closed since (2026-10-15), in the
     rules:** the fix first left the acknowledged record open — past the
     minute, a claim holder could rewrite its `msg` and keep the date, and
     add children of any name and size, and the participant's data download
     copies the whole record into `helpCallsByMe`. The validator's exception
     now asks for `msg` unchanged or gone, and the record is sealed (`by`,
     `at`, `ack`, `msg`; `$other` false). Live only once a deploy has
     released the rules (`released successfully`). `Verify:` `node --test
     tests/call-for-help-ack.test.js`; on the emulator `PORT=8791 npm run
     test:e2e:rules -- call-for-help-ack` (section 1b fails on the rules
     before the seal, in both trees).
  2. **"Reset this room's case" deleted nothing** — since the first commit. A
     facilitator-only `remove()` of the whole `revealed` list, which no rule
     grants; silent. **REMOVED, by decision (2026-10-14), not repaired:** a
     reset of the findings alone would leave the score, penalties, rule-outs
     and chat awards they caused, a full reset is a feature of its own, and
     either deletes a room's research record mid-session. No `.write` was
     added at the list. Its two strings went from i18n.js and fr/ja
     (`LOCALE_VERSION` bumped). `Verify:` `node --test
     tests/call-for-help-ack.test.js`; on the emulator `PORT=8791 npm run
     test:e2e:rules -- call-for-help-ack` (three tests; the product test waits
     out the minute, so it takes about two).
  3. ~~**A dashboard stops updating once its facilitator has opened a room and
     come back.**~~ **✅ FIXED IN CODE 2026-10-14** — it reaches a browser
     when that browser loads the shell carrying it (the version is assigned
     at merge: read `SHELL_VERSION` in `sw.js`). `teardownRoom()` called
     `refLeaderboard.off()`, and that ref is the SAME location as the
     dashboard's `refRooms` — `off()` with no arguments drops every listener
     there, whichever Reference attached it. Measured: after one visit the
     database held a second finding and a new call for help, and the dashboard
     showed neither; the facilitator's own Advance moved the database and not
     the row. A room switch from the sidebar froze the sidebar the same way.
     Both lines were in this repository's first commit (2026-05-18), and
     nothing ever re-subscribed. `teardownRoom()` now detaches the
     leaderboard's own callback (`off("value", onLeaderboard)`).
     **Why the LOCAL suite never saw it:** LocalDB's `off()` removed only the
     callbacks attached through the Reference it was called on, so in LOCAL
     mode the dashboard's listener survived — a LOCAL spec of this exact flow
     was green on the defect. LocalDB's `off()` now acts on the location as
     Firebase's does (`tests/localdb-off-location.test.js`); with it, the
     LOCAL spec fails on the old `script.js`. A test double that is MORE
     FORGIVING than the SDK hides this whole class of bug from every LOCAL
     spec on every device.
     The "read the dashboard BEFORE the facilitator opens a room" ordering in
     emulator specs is no longer needed.
     `Verify:` `PORT=8791 npm run test:e2e:rules -- dashboard-after-room-visit`
     and `PORT=8771 npx playwright test tests-e2e/dashboard-after-room-visit.spec.js`
     (on the device projects; the WebKit ones with `--workers=1`).
     ⚠️ The emulator twin is `…-sdk.spec.js` ON PURPOSE: the mobile projects'
     `testMatch` in `playwright.config.js` matches a basename in ANY
     directory, so an emulator spec sharing a LOCAL spec's name would run in
     LOCAL mode there.
- **A call pressed before the room claim landed was refused** (found
  2026-10-14, a consequence of this change). `startRoom()` issues the claim
  as the room appears — a read, then a write — and "Call a facilitator" is
  live before the write reaches the server; pressed in that moment, the call
  and its `help` event were refused and the button went back, silently.
  **Fixed in the client:** the button's participant writes (call, re-call,
  cancel, the advance CTAs' call, the `help` event) wait for
  `roomClaimSettled`, which `startRoom()` settles on every outcome of the
  claim and after 10 s regardless. Reproduced, not inferred: the emulator
  spec holds the claim's WebSocket frame in transit (`page.routeWebSocket`)
  and asserts the hold happened; red before the fix, green after.
  **A workup reveal and the team name raced it the same way** — measured the
  same way, red before (a reveal wrote nothing after its toast had shown the
  answer; "Save name" said "Could not save the team name"). `reveal()` (which
  the LLM chat's unlocks also call) and the team-name save now wait too;
  "Save name" shows "Saving…" while it waits. **Waiting moves WHEN a write
  happens, so it must not move WHERE** (found by #464's review, then red on
  the emulator): `refRevealed` follows the stage, and a reveal clicked in
  section 1 landed in section 2's list when the room moved on during the
  wait. The reveal now captures its list and room at the click and drops the
  write after a move to another room; the team name drops it too. Any new
  `_afterClaim` caller must capture its target before waiting.
  ⚠️ **Not fixed:** the other room writes a participant can make in that
  first moment — a reply to an answer, the roleplay round — need a claim on
  the room too and presumably race it the same way. Not measured.
  `Verify:` `node --test tests/call-before-claim.test.js`; `PORT=8791 npm run
  test:e2e:rules -- call-before-claim` (three tests: call, reveal, team name).
- **Why nothing caught it.** As in #452: every hardening pass worked from a
  list somebody had thought of. Two tests pinned the open shape —
  `tests/rules.test.js` required the `events` rule NOT to contain
  `adminPasswordHash`, and the G9 emulator case asserted that a peer who had
  joined nothing COULD write a reply (it said so, and said to update it). The
  `OPEN` map in `tests/session-config-creator-bound.test.js` is down from 23
  writes per tree to 16.
- **The room subtree is now held to parity as a whole.**
  `tests/rule-tree-parity.test.js` used to re-prefix three nodes. A session
  has two addresses — its subtree and its `adminSecrets` branch — and with
  both mapped EVERY room-level node is a pure re-prefix of its original. That
  is asserted, with a check that no org rule reads the default tree's secret.

`Verify:` `node --test tests/room-writes-room-bound.test.js
tests/rule-tree-parity.test.js tests/session-config-creator-bound.test.js`,
and on the emulator `PORT=8791 npm run test:e2e:rules -- room-writes-room-bound`
(five tests. Run against the rules as they were, the first four fail at
their first denial; run against the first version of this change, the fifth
fails where the misplaced participant's call must land). Those test the
REPOSITORY. For the live rules: the deploy step is
best-effort, so read its log — `gh run view <deploy run> --log | grep -F
'released successfully'` — and do not take a green Deploy as proof.

### 2026-05-30 multi-agent security review — outcomes

**Fixed (committed + tested):**
- **Pseudonymisation leaks (P0)** — the research export left real names in the
  "pseudonymised" file (free-text LLM chat, facilitator `by` fields, duplicate
  display names) + an unscrubbed `university` quasi-identifier. Rewritten as
  the pure, unit-tested `scripts/lib/pseudonymise.js` (drops chat + facilitator
  transient fields, redacts unknown names, collision-safe, buckets university).
  Also `cleanup-stale-sessions.js` redacts `e.message` in `CLEANUP_QUIET` mode.
  - ⚠️ **"Closed" was wrong: the export still carried REAL NAMES, account uids
    and (where a session had any) e-mail addresses — ✅ fixed in the transform
    2026-10-08 (version 2); ⛔ the files already written are NOT changed; and
    two things it still exports are decisions nobody has taken.** Found by
    RUNNING the transform and then the real export job — nothing had ever read
    the file the job writes.
    - **(a) Names, inside a string — the big one, and the 2026-05-30 review
      missed it.** `logEvent()` writes a room event as
      `{kind, by, at, payload: JSON.stringify({by: myName, university, len…})}`
      for every answer, edit, deletion and hypothesis, and for a manual score
      with the FACILITATOR's name. The walker rewrote the `by` beside it and
      never opened the string: `"by":"Student-A"` next to
      `"payload":"{\"by\":\"Ann Dupont\",…}"`. Every contributor's real name
      and university, **decliners included**, in every export since the first.
    - **(b) Auth uids outside the two mapping tables:** `creatorUid` (the
      facilitator), `scenarioRef.ownerUid` (the scenario's author; few sessions
      — the client stopped writing `scenarioRef` on 2026-07-31) and the key of
      every `roomOf/<uid>` entry (a participant's, with their clientId inside:
      the join `clientMapping` was dropped to withhold, the other way round).
      `roomOf` entered the rules 2026-08-03 (#268), after `UID_KEYED` was
      written; the erasure planner listed it (`BY_UID`), the pseudonymiser
      did not.
    - **(c) A node the rules no longer declare:** `sessions/<code>/mail/<id>`
      `{to, subject, text}`, the queue of the mail function removed
      2026-09-24. A rule being deleted does not delete what it guarded.
    - **Fix (`TRANSFORM_VERSION = 2`):** a `payload` is parsed, scrubbed by the
      same walk, re-serialised — and REMOVED if it is not what a client
      writes: over 500 chars (the client's own cut), not JSON, or JSON that is
      not an object (an array is not one). ⚠️ The first version parsed any
      length and let `walk()` throw: `events/$pushId` validates its own
      `payload` to 500 chars and nothing else, so a visitor with the code
      could write `z: { payload: "[[[[…" }` nested thousands deep, and the
      RangeError stopped the export of EVERY session, nightly (found in
      review 2026-10-14, run, fixed before it shipped). **Opening a string
      gives a walker depth the database never could (RTDB stops at 32
      levels): bound it, and never let it throw past the session.**
      ONLY `payload` is opened: `scenarioCustomJson` / `sectionBodies` are JSON
      strings too and their `name` keys are the case's characters.
      `creatorUid`, `ownerUid`, `roomOf` dropped; `mail` dropped at the ROOT
      only (a content id may be called "mail"). `roomOf` is dropped, NOT
      rekeyed like `members`: two students on one browser are two pool rows
      under ONE uid, `roomOf` is written once per uid, and rekeying put one
      student's pseudonym on the other's row — the first version of this fix
      did exactly that. `pool/<cid>/room` already says who was in which room.
      The walk now also continues beneath a rekeyed `members`.
    - **The file says which transform wrote it** (`transformVersion`; absent =
      version 1). **Never date this boundary by the calendar:** the job runs
      nightly on whatever `main` holds, so the day a fix is written, the day
      it merges and the day a file is first written by it are three days. The
      first draft of the note said "exports written before 2026-10-08" while
      the PR was still open at that day's run time.
    - **Why no test caught any of it, and what the new ones cannot see.**
      (1) Nothing RAN the job: `tests/pseudonymise-export-run.test.js` now
      does, against the in-memory database, and reads the file. (2) Every
      fixture filled `payload` with nothing or with a marker. **Fill a field
      with what the CLIENT writes there** — my own "run every field" pass put
      an opaque marker in `payload`, filed it under free text and reported the
      job clean; an independent reviewer reading `script.js` found the names.
      (3) `tests/pseudonymise.test.js` pinned the uid list AS IT THEN WAS.
      `tests/pseudonymise-uid-coverage.test.js` now DERIVES uid positions from
      the rules (a `$uid` key or any wildcard compared with `auth.uid`, a
      value compared with `auth.uid`, a field named `uid` / `…Uid`) and runs
      the function on each. It NARROWS the gap: it cannot see a field no rule
      names, a node that has left the rules, a uid under a name that says
      nothing, or a name inside a string — (a) and (c) are exactly those.
    - ⛔ **The stored exports are untouched, they hold names, and that is not
      code.** Run list: 37 successful runs to Scaleway (2026-09-02 → 10-07;
      the newest held 4 sessions, 5 participants), 85 to the Google bucket
      (2026-05-30 → 08-26). Whether the Scaleway bucket really has the 90-day
      lifecycle rule, and whether the Google bucket still exists, is NOT
      established from the repo. Deleting, rewriting or leaving them, and
      whether this is to be assessed as a breach, is the operator's decision
      as controller of the export — DPA Annex VI **R10** item 1. No tool
      rewrites a stored export.
    - ✅ **in code (`TRANSFORM_VERSION = 3`); ⛔ in no stored file until the
      first one that says `transformVersion: 3`. The export is an INCLUSION
      filter now (`scripts/lib/research-inclusion.js`).** Until version 3 a
      participant who DECLINED was not erased: what they wrote into shared
      lists went out under `REDACTED-NAME` with their `cid`; rows and records
      under an identity with NO pool row went out as written; one invented
      consenting pool row made a session exportable; and a withdrawal with no
      `clientMapping` row changed nothing yet was logged as applied (all run
      on version 2). Now a participant is INCLUDED only when the row records
      consent AND `clientMapping/<cid>` binds it AND they have not withdrawn,
      and a record naming a person is kept only when it can be SHOWN to be an
      included one's — by its container's key, its `cid`, the clientId in
      roleAssign's `by` (assignRolesRandomly writes `by: clientId`, not a
      name), or a display name held by nobody else whose pool row is bound to
      an account, nor by the facilitator (events, reveals, triage, call for
      help). The rest is removed and counted in the job's log. **Exception:**
      the name-only records (events, reveals, triage choices, calls for help)
      of a participant who is not included and is bound to no account are kept
      as an included namesake's, if one exists — the price of not letting an
      unbound row, which anyone holding the session code can write, remove an
      included participant's records (pinned as present behaviour by "an
      UNBOUND decliner's name-only records go out as an included namesake's").
      **Costs, each pinned by a test and put to the controller in
      G1:** a namesake who declined costs an included participant her
      name-only records — and that is a LEVER: any signed-in visitor holding
      the code who binds a pool row of their own under her display name
      removes them. Only BOUND rows count as namesakes; the first version
      counted every pool row, so one unbound `pool/x = {name: <hers>}` (the
      tolerant first-write branch — anyone with the code) did it for free
      (found in review) — and not counting them is what makes the exception
      above; G1 (a) puts the two prices side by side for the controller; the facilitator's events/replies/reveals go (cannot be
      told from forgeries) while `audit`/`score/manual`/`created`/`closed`
      stay; `teamName` goes (free text, no author); a reveal by someone not
      included disappears from the room's revealed set. **NOT closed:** a
      record written under an included participant's name or `cid` by somebody
      else (the rules bind neither); an included participant's reply to a
      removed entry stays. `tests/pseudonymise-consent-coverage.test.js`
      DERIVES from the rules every identity-keyed container and every record
      with `by`/`cid` and runs the function on each — add a new one to the
      lists in research-inclusion.js or that test goes red. The stock-client
      fixture is `tests/fixtures/consent-scope-session.js`; fill a new record
      kind there with what the CLIENT writes. ⚠️ **An integer-keyed node comes
      back from `.val()` as an ARRAY** — section slots (`$slot` is `[1-9]`),
      legacy reply lists, any `poll/0`. The first version of the filter
      descended into plain objects only, so in every multi-section session a
      decliner's section answers, hypotheses, reveals, triage and role
      assignments went out untouched — and every fixture, the coverage test and
      the fake admin used plain objects, so nothing caught it (review).
      Containers are now `isMap` (object OR array); the coverage test runs
      every case in both shapes (`tests/fixtures/rtdb-shape.js`). **Any walker
      over `.val()` output must take an array as an object keyed by its
      indices.** Same family, closed before version 2 shipped: a decliner's
      ballot was removed only via `stableIdMapping`; it now also goes by the
      `stableId` in their own pool row. ⚠️ **Two wrong versions of that fix
      were caught in review, both run:** (1) the row's stableId was added to
      the keys deleted at EVERY depth — `pool/<cid>/stableId` is validated
      by no rule, so `"rooms"` or a consenting participant's clientId took
      that tree with it; (2) the row was believed only when the table did not
      tie the stableId to another account — and the table is first-come, so
      a decliner's ballot stayed. Now: stableIds are removed UNDER `ballots`
      ONLY (the one node the client keys by stableId), and the row is
      believed unconditionally; the cost — a declining row naming another's
      stableId removes ALL of that participant's ballots, every vote in every
      room — is pinned by a test. **A key deleted at
      every depth must come from a source nobody else can write.** Fixed in
      version 3: a consent-less pool row keyed `rooms` removed the whole rooms
      tree (run on version 2). A clientId is now removed only from containers
      keyed by clientId; only account UIDs are still deleted at every depth,
      because a `clientMapping` value must equal the writer's `auth.uid`.
    - ⚠️ **`stableId` is still exported as written — do NOT describe this
      export as free of cross-session identifiers, and do NOT repeat that the
      join needs it.** For a signed-in participant it IS the auth uid. I first
      wrote that rewriting it "breaks the pre ↔ post ↔ questionnaire join";
      the review showed that is false: `tests/<cid>/{pre,post}` and
      `survey/<cid>` are in ONE session, so a stand-in per distinct stableId
      per session keeps them all (prototyped on the output: one signed-in
      participant, two tabs → one stand-in everywhere, no uid left). The only
      join it would break is the PLANNED one to an external questionnaire via
      a printed code (`study_protocol_SAP.md` §9, unticked in §15) that the
      client does not show. Not changed: it is the study's join key, so it is
      Basile's call (R8, R10 item 3). The coverage test lists every place it
      is carried so the list cannot grow unnoticed.
    - **Fixed in a separate change (2026-10-15): the dashboard's "Pseudonymise
      names in export"** (`pseudonymiseTree()` in `lib.js`) had the SAME name
      leak in event payloads and removed no uid at all (run). It now does
      what version 2 does about names and uids: payloads opened (≤ 500
      chars, a JSON object, else removed), a `by` / `name` that is no
      participant's → `REDACTED-NAME` (`system` and `Admin` kept),
      `creatorUid` / `ownerUid` / `roomOf` / both mapping tables dropped at
      any depth, root `mail` dropped, `members` / `uidMembers` rekeyed by
      pseudonym (a `roleAssign` `by` is a clientId, and kept). NOT done,
      deliberately: a consent filter (it is the facilitator's own archive),
      `university` buckets, `stableId`, and free text — `controller` and
      `workshopLabel` often carry the facilitator's name. Live
      with the shell that carries it. `Verify:` `node --test tests/lib.test.js`.
    - **Also seen, not changed:** `members` is keyed by a uid's LAST pool
      row's pseudonym while names keep the FIRST, so one account behind two
      rows with one name is `Student-A` in the pool and `Student-B` in
      `members` (run). Free text that passes is longer than DPA R7 listed; R7
      now has the measured list, the three links included.
    - `Verify:` `node --test tests/pseudonymise.test.js
      tests/pseudonymise-uid-coverage.test.js
      tests/pseudonymise-export-run.test.js`. That tests the REPO. The live
      job checks out `main` when it runs:
      `gh run list --workflow pseudonymise-export.yml --limit 1 --json headSha,conclusion,createdAt`
      — `headSha` at or after the merge commit means that run's file is
      version 2. The file itself is the authority: `"transformVersion": 2`
      near its top.
- **Per-room write gating (P1)** — added the `uidMembers` gate to
  `score/auto`, `score/penalties`, `moduleA/hypotheses`, `moduleA/promptReplies`,
  `moduleB/exchangeReplies`, `votes/committed` (sessions + orgs) so a member of
  one room can't tamper with another's. Validated by the emulator suite (new
  cross-room denial test) + the cross-tab sim.
- **Client/auth (P3)** — scenario-author sign-up now enforces the main app's
  8-char + 3-class password policy (was 6); removed the unused `html:` innerHTML
  footgun in scenario-author `el()`; `showOrgNotFoundSplash` escapes `> " '`;
  `authErrorMessage` no longer surfaces raw SDK messages.
- **hfPatient (P2) — ⚠ REQUIRES `firebase deploy --only functions` to activate:**
  server now prepends an authoritative system guard the client can't override
  (stops persona replacement / prompt extraction); `HF_URL` locked to
  huggingface.co (no token exfil to arbitrary hosts); HF error body no longer
  forwarded to the client; `lang` allowlisted. PROMPT_VERSION bumped to 2.2.

### 2026-07-23 Phase-4e legal fact-check — FOUR COMPLIANCE GAPS — ✅ ALL FOUR FIXED (re-verified 2026-08-19)

> **STATUS (re-verified against the code 2026-08-19):** all four gaps below are
> CLOSED. Gaps 2 and 3 were corrected in place earlier (2026-07-29 / 2026-07-31);
> gaps 1 and 4 stayed labelled OPEN here long after their fixes had landed, and
> that stale labelling is what this entry corrects. Trust each gap's own
> `Verify:` line, not this banner.
>
> ⚠️ **One sub-claim is still OPEN** — a certificate is still minted *and published*
> on the download click with no separate prompt. See the "Also" paragraph after
> gap 4. That, not these four, is the remaining blocker on the consent/DPA text.

Drafting the facilitator-as-controller legal pack forced every privacy claim to be
checked against the code. Four were wrong in the CODE, not the prose — the legal
text could not be made truthful until they were fixed. The gap text below is kept
as the historical record of what was wrong.
1. ~~**Research export ignores consent entirely (HIGHEST).**~~ **✅ FIXED — label was
   stale, corrected 2026-08-19.** The gap was real when written; the research export
   now gates on consent. `pseudonymise-export.js` imports `sessionHasConsent` /
   `hasResearchConsent` from `scripts/lib/pseudonymise.js`, filters to
   `consentedCodes`, and reports how many sessions and participants were excluded;
   the gate comment names this gap by number.
   **Scope note (do not over-read the fix):** `backup-sessions.js` is deliberately
   NOT consent-gated. It is operational disaster recovery — it archives a snapshot
   before the retention purge so a database bug or malicious wipe stays recoverable —
   which is a different lawful basis from research reuse; gating it on consent would
   defeat the backup. The consent text may therefore say research *reuse* is
   optional, but must not imply that no copy of the data exists.
   `Verify:` `grep -c -i consent scripts/pseudonymise-export.js` > 0 (15 on
   2026-08-19) and `grep -n "RESEARCH CONSENT gate" scripts/pseudonymise-export.js`
   hits; `grep -c -i consent scripts/backup-sessions.js` = 0 **by design**.
2. ~~**Org-scoped sessions have ZERO retention coverage.**~~ **✅ FIXED — label was stale,
   corrected 2026-07-29.** The gap was real when written (all three retention jobs were
   hard-scoped to `db.ref("sessions")`), but has since been closed: all three now walk
   BOTH trees via the shared `scripts/lib/session-trees.js` helper
   (`readSessionLocations`), and `cleanup-stale-sessions.js` also purges the session's
   `adminSecrets/…` entry, which lives outside the session subtree. `Verify:`
   `grep -c orgs scripts/{cleanup-stale-sessions,backup-sessions,pseudonymise-export}.js`
   = 2/2/2 (was 0/0/0), and all three appear in
   `grep -ln session-trees scripts/*.js`.
3. ~~**`moduleA/chat` is NOT room-private — UNDECIDED.**~~ **✅ FIXED — label
   corrected 2026-07-31 after checking the code.** The decision recorded below as
   open was in fact taken, and it was option (b): the chat moved OUT of the
   `sessions/$sessionId` read-cascade into a top-level `roomChat/$sessionId/$roomId`
   tree whose own `.read` is granted per ROOM (plus the facilitator, for debrief),
   mirroring `adminSecretPath()`. `Verify:` `rules.roomChat` exists in
   `database.rules.json` and `rooms/$roomId/moduleA/chat` no longer does;
   `roomChatPath()` is in script.js; the emulator suite carries "roomChat is
   room-private — a session member in another room cannot read it (gap 3)".
   The analysis below is KEPT because its reasoning still governs every future
   node (RTDB `.read` cascades and cannot be revoked at a deeper path, so a
   deeper `.read` is additive only) — but the gap itself is closed, and the
   consent text may now rely on the chat being room-private.

   <details><summary>Original entry, superseded</summary>

   **`moduleA/chat` is NOT room-private — UNDECIDED, do NOT treat as accepted.**
   RTDB `.read` **cascades and cannot be revoked at a deeper path**.
   `database.rules.json:93` grants `.read` on the whole `sessions/$sessionId`
   subtree to any session member, so the room-scoped rule on
   `rooms/$roomId/moduleA/chat` (~line 309, requiring `uidMembers/$uid`) is
   **additive only** — it restricts nothing. **A participant's free-text chat with
   the LLM character is readable by EVERY member of the session, not just their
   room.** (This corrects a claim previously filed under "Accepted by design" that
   read "Only `moduleA/chat` is per-room read-gated" — that claim was FALSE; the
   draft consent text had been built on it.) Verified directly against the rules.
   **Open decision, pending product + legal sign-off:** either (a) accept it and
   say so honestly in the privacy notice + in-product disclosure, or (b) actually
   restrict it, which needs the chat moved OUT of the `sessions/$sessionId`
   read-cascade (e.g. a sibling top-level `roomChat/$sessionId/$roomId` tree with
   its own `.read`) — a deeper `.read` alone can never fix this. Only after that
   decision is made may this move to an "accepted" or "fixed" heading.

   </details>

4. ~~**`canamed_stable_id` survives sign-out**~~ **✅ FIXED — label was stale,
   corrected 2026-08-19.** `accountSignOut()` now drops the persisted stableId
   instead of clearing nothing: the comment "The signed-in uid was persisted as the
   stableId; drop it so the next…" sits immediately above a `resetStableId()` call,
   so a signed-out account's uid no longer lingers as a linkage key. (The old line
   reference "script.js ~14342" was stale too — `accountSignOut()` is ~12328 today.)
   `Verify:` `grep -A22 "function accountSignOut" docs/Third_session/PBL_platform/script.js | grep -c resetStableId` = 1.
Also — ⚠️ **STILL OPEN (re-checked 2026-08-19):** a certificate is minted *and
published* on the download click, with no separate prompt. `resolveCertId` now lives
in [takehome.js](docs/Third_session/PBL_platform/takehome.js) (~130 — moved there by
the lazy split, no longer script.js), and the same click that builds the take-home
also writes the (name-hash, session) record to `credentials/<certId>`. Clicking
"download" is an opt-in to *receiving* a certificate, but not an informed opt-in to
*publishing* a verifiable record — so "getting a certificate is optional" still
cannot be stated without qualification. **This is the one Phase-4e item still
genuinely open.** `Verify:` `grep -n "credentials/"
docs/Third_session/PBL_platform/takehome.js` shows the `.set(payload)` publish
reached from the download flow with no consent check between.
Drafts (with these gaps flagged) live in `docs/Third_session/PBL_platform/legal/`.

**A FIFTH gap, found 2026-07-29 while preparing the CER Unicaen dossier — ✅ FIXED
(shell v113→v114).** The Art. 13 notice promised live session data was "purged within
7 days" while the deployed job keeps closed sessions **30** days and abandoned ones **90**
(`CLEANUP_RETENTION_CLOSED_DAYS` / `_OPEN_DAYS`, pinned to the same values by
`.github/workflows/cleanup-stale-sessions.yml`). Resolved by **correcting the notice to
30/90**, not by tightening the job: 30/90 is proportionate to the facilitator debrief
window, tightening to 7 d would have purged sessions still in use (a never-closed session
would die after a week), and `cleanup-stale-sessions.js`'s own header already documented
30/90 as the intended policy — the 7-day text was the stale outlier. Twelve published
surfaces were corrected: `privacy.html` §8 (EN/FR/JA), `lobby.privacy.p3` in `i18n.js`,
all seven `locales/*.js`, and the hardcoded fallback `<p>` in `index.html`.
- **Same pass fixed a second, worse drift in that sentence:** `de/es/ko/pt/zh` and the
  `index.html` fallback described the research dataset as **pseudonymised**, while
  `privacy.html`, the EN canonical, `fr`/`ja` and the CER dossier all declare it stored
  **linked to the participant (identifiable)** for up to 5 y. Those participants' consent
  rested on a false premise. (`lobby.consent-research` saying analysis/publication happens
  in pseudonymised form is a *different, accurate* claim — deliberately left alone.)
- **Regression guard:** `tests/retention-notice-consistency.test.js` parses the enforced
  days out of the script + workflow and asserts all 12 published surfaces state them,
  claim no 7-day purge, and never say "pseudonymised". Nothing linked those two sources
  before, which is why they diverged unnoticed for months. `Verify:` `node --test
  tests/retention-notice-consistency.test.js`.
- `LOCALE_VERSION` (i18n.js) bumped v8→v9 alongside the shell bump — it is a **separate
  counter**, and without it returning browsers keep serving the cached 7-day locale chunk.

**Accepted by design (no change — documented decisions):**
- Full room-subtree readability to any session member, **for structured
  per-room work** (scores, hypotheses, votes, prompt replies): intentional
  classroom visibility (facilitator/observer). ⚠️ **Scope note:** this bullet
  covers the structured nodes ONLY. The free-text `moduleA/chat` rides the same
  cascade but is **NOT accepted** — it is an open decision, see gap 3 above.
  A line previously here claiming "Only `moduleA/chat` is per-room read-gated"
  was false and has been removed.
- `sharedScenarios` readable by any authenticated user: that is the opt-in
  facilitator sharing feature working as intended.
- `credentials/$certId` public read by exact id (no `auth`): required by the
  unauthenticated certificate-verification page. **Published cert IDs are now
  crypto-random + persisted** per participant (`randomCredentialId()` →
  `certIds/<code>/<clientId>`, write-once, owner-only, OUTSIDE the sessions/
  read-cascade), so neither an outsider (no enumeration) nor a **classmate** can
  derive a peer's id. This closed the fifth Phase-4e gap (**FIXED 2026-07-24**):
  the old published id was the *deterministic* `canamedCertId(session|clientId)`,
  recomputable by any session member from the pool keys — it now survives ONLY as
  an offline fallback, never as a published id. Migration: existing deterministic
  certs stay valid (no backfill); new ones are random.
  ⚠️ **What the record actually carries — corrected 2026-08-19.** This said "only
  a name **hash** + session label", which UNDERSTATED it, and the same wrong
  claim appeared under "Round-3 — re-confirmed ACCEPTED" below. `takehome.js`
  writes **five** fields: `nameHash`, `session`, `sessionLabel`, `at`,
  `retentionUntil`. The one that matters is `session` — it is `sessionNum`, the
  **session CODE**, not a label. So a public, unauthenticated read by exact id
  discloses the session code, and this repo treats that code as semi-sensitive
  elsewhere (`cleanup-stale-sessions.yml` sets `CLEANUP_QUIET=1` precisely so
  world-readable CI logs never print session codes). Bounded, not alarming: cert
  ids are crypto-random since #239 so nothing is enumerable, and you must already
  hold an id — which certificates are meant to be shareable with. But it is more
  than the two fields claimed, and the consent/DPA text must not repeat the
  narrower wording. **Open question for the pilot:** whether `session` needs to
  be in the public payload at all — the verification page may only need the
  label, in which case the fix is to stop publishing the code rather than to
  document that we do. (Found by CodeRabbit on #236, against a CLAUDE.md hunk
  that PR no longer carries; the wrong text was here on main.)
  `Verify:` `grep -n certIdPath docs/Third_session/PBL_platform/script.js` > 0;
  the `certIds/$id` case in `tests-e2e/emulator/rules-smoke.spec.js` proves
  owner-write-once + PEER-DENIED; and
  `sed -n '/const payload = {/,/};/p' docs/Third_session/PBL_platform/takehome.js`
  lists the fields actually published — compare it against any claim made here.
- `poll/$clientId` uses the same tolerant first-write `clientMapping` branch as
  `pool`/`presence`/`typing`: in the brief window before the join chain commits
  the mapping, a peer could spoof another participant's qualitative poll answer
  (`hardest`/`feeling`). Same accepted class as the room-griefing residual; the
  window is narrow (the claim runs before the poll UI is reachable). **Note for
  research:** poll data feeds the research export — if poll integrity ever
  matters for analysis, bind it to `clientMapping` ownership like `votes/ballots`.

**Also fixed (2026-05-30, second pass):**
- **Org-scoped adminSecrets (D1)** — org sessions stored the real
  `adminPasswordHash` at an `auth!=null`-readable path (hash oracle). The
  `adminSecrets` proof-write scheme now covers org sessions too: real hash at
  the unreadable `adminSecrets/orgs/<slug>/<sessionId>/hash`, a non-secret
  marker at the readable org `adminPasswordHash`. `useAdminSecrets()` is now
  true for any shared-mode deployment; `adminSecretPath()` namespaces per org
  (default org path unchanged). Emulator-tested (hash unreadable, proof-write
  verifies, write-once).
- **sendQueuedMail HTML (D2)** — `job.html` now sanitised with `sanitize-html`
  + a tight allowlist before nodemailer. Shipped + deployed 2026-05-30.

**Round-2 review (2026-05-30) — fixes to the round-1 fixes:**
- Pseudonymiser: null-prototype maps (a participant named `__proto__`/`toString`
  no longer collides with a built-in) + bare-string array-element scrubbing.
- hfPatient: the `j.error` branch no longer forwards the provider body to the
  client; pure helpers extracted to `functions/lib/hf-helpers.js` and unit-tested
  (`tests/hf-helpers.test.js` — HF_URL allowlist, system-guard collapse, lang).
  `mailto` removed from the email sanitiser. Redeployed.
- `signUpWithEmail` backstop now enforces the full `scorePassword().ok` policy
  (was a stale 6-char check).
- `verify.js` bounds DB display fields + guards the date parse; `telemetry.js`
  logs `pathname` only (no query-string identifiers); `sw.js` `skipWaiting`
  requires `event.source`.
- Org rule parity: `moduleA/hypotheses`, `promptCursor`, `promptReplies` and a
  `moduleB` block (`phase`, `exchangeCursor`, `exchangeReplies`) added to the
  org tree with the `uidMembers` gate (were absent ⇒ fail-closed; now at parity
  with `sessions/`). Emulator-tested (own-room allowed, cross-room denied).

**Round-3 review (2026-05-30) — fixed:**
- **Recovery-race (HIGH)**: the admin-hash overwrite rules allowed any authed
  user to write during a fresh `_superadminReset` window. Now the reset records
  its initiator's uid (`== auth.uid`) and all four hash-overwrite rules
  (sessions+orgs × adminPasswordHash + adminSecrets/hash) require the writer to
  match. Emulator-tested (race-guard: distinct uid denied).
- **Supply-chain**: nodemailer ^6 → ^8.0.10 (vuln line); Dependabot now watches
  `functions/`; explicit `permissions: contents: read` on test/e2e/rules-e2e/
  synthetic-uptime workflows.
- **scenario-author.js**: removed the `Function()` eval (code-exec sink) → JSON
  only; removed the dead `html:` branch in `el()`.
- `credentials/$certId.retentionUntil` now capped (`<= now + ~5y`) so a client
  can't set retention indefinitely and defeat GDPR cleanup.

### One room per participant: placement follows the claim (2026-10-14) — fixed in the client; live only once its shell has shipped

`roomOf/<uid>` is written once, on the first room entry, and the rules refuse
a participant's room writes in every other room. The account it names is the
BROWSER's: anonymous Auth persists (`Persistence.LOCAL`) across Leave, tab
close and restart, and every tab of a profile shares it. The client could
nevertheless show a participant a room their claim does not name, and said
nothing. Two routes, both run on the emulator with the real client:

- **Leave, then join again in the same browser.** The claim survives; the
  room was chosen afresh by `bestRoomFor()`. Simulated with the real
  `assignRooms()`/`bestRoomFor()` over 4–6 rooms of about four (60 % Caen):
  about **one leaver in five** lands elsewhere — ~14 % ties broken by room
  name, ~5–6 % a room with fewer of their own university. Not the rare tie
  it was taken for.
- **Two students on one laptop, one tab each** — the case the `clientId`
  comment says is supported. One account, one claim: the start placed the
  tabs in different rooms, the first to enter claimed, and the second tab's
  student could write nothing (told "please reload", which changes nothing —
  or, with the other timing, nothing at all).

There, answers stayed in their box while toasts said "+10", "+20", "+3 —
First answer written": a score transaction applied LOCALLY fires the score
listener before the server refuses it.

**Now:** `maybeSelfAssign()` places an account that holds a claim in the
claimed room (`readRoomClaim()`/`claimedRoom()`); `startRoom()` moves a
participant shown another room — the two-tab race — and says "You are in
{room}: this browser already has your place there in this session."; score
writes go through `scoreTx()` (`applyLocally = false`), as do the triage and
chat ones. **And, decided by Basile 2026-10-14:** a join whose name differs
from the name on the tab's existing pool row takes a fresh client id
(`ownClientId()`). The tab keeps its id across Leave (it is in
sessionStorage), and that id keys the row holding a participant's name and
the consent record their answers are read against — so the next student on a
shared browser used to REWRITE the previous student's row. They now keep the
browser's room (balancing is bypassed — the price of that decision) and get a
row of their own; the same name, case and spacing aside, keeps the row.

**Measured and NOT changed — each its own decision:**
- **Leave does not take a participant off the list.** `leaveAndReload()`
  calls `refMyPool.remove()` while `joined` is still true, and the pool
  listener's safety net re-writes the row at once (same `room`, fresh `at`) —
  seen on the emulator in a room and in LOCAL mode in the waiting room, where
  the facilitator still lists the leaver. Making the remove stick would also
  drop the consent record a leaver's answers are read against; that is the
  export's decision, not a placement fix.
- `leaveAndReload()` (and `switchSession` / `forgetSavedSession`) clear a
  LEGACY localStorage `canamed_client`; the id lives in sessionStorage, so
  "clear everything identifying" does not clear it. `ownClientId()` covers
  the consequence that mattered.
- **The lobby can wipe the university.** `setUnlockedSession()` shows the
  lobby before `loadSessionScenario()` resolves, and `initLobby()` then
  rebuilds `#uni-input` — a choice made in between is lost and the join stops
  at "Select your university". Seen in a test; a person on a slow network can
  hit it. Specs wait for `#session-badge`, which is set after the rebuild.
- An answer the server refuses keeps its text and says nothing.
- A browser on an older shell keeps the old placement until it updates —
  one reason `callForHelp` keeps asking for a claim on ANY room.

`Verify:` `node --test tests/rejoin-room-claim.test.js`;
`PORT=8771 npx playwright test tests-e2e/leave-rejoin-own-row.spec.js`
(every device project; the WebKit three with `--workers=1`); on the emulator
`PORT=8791 npm run test:e2e:rules -- rejoin-room-claim room-writes-room-bound`.
Run against main's client before this change, all ten emulator cases and the
LOCAL case fail at their first placement, row or toast assertion. Live: the
shell version that carries it must be the one `sw.js` serves.

### ✅ THE ROOM GATE IS BOUND — fixed 2026-09-03 (found 2026-08-03)

**Fixed.** The self-write branch of `sessions/$id/roomOf/$uid` now requires the
`cid` in the claim to map to the claimant (`clientMapping/<cid> == auth.uid`)
**and** the room claimed to equal that clientId's own pool assignment
(`pool/<cid>/room == room`), in both trees. Proven functionally in
`tests-e2e/emulator/rules-smoke.spec.js` ("a participant cannot claim a room they
were not assigned to (B1)"), with an ALLOW leg so a denial cannot be explained by
an unwritable node, and pinned structurally by `tests/dpia-facts.test.js`.

⚠️ **THE ORIGINAL FINDING NAMED THE WRONG NODE, and the real one was worse.**
Everything below is about `uidMembers`. That node turned out to be **vestigial** —
the client stopped writing it in #268 and it appeared exactly twice in the whole
rules file, both times as its own declaration, gating nothing. The load-bearing
claim is **`roomOf`**, which is what `roomChat`'s `.read` and `.write` are
expressed in terms of, and it was self-assertable in the same way. **Fixing the
node the finding named would have changed nothing.** `uidMembers` has been
removed outright; the legacy-data handling in
`scripts/lib/{erasure,pseudonymise}.js` stays, because old sessions still contain
what it held.

⚠️ **The client had to change too, for the reason PR #223 records.** The claim
was a `.transaction()`, which runs the rule CLIENT-SIDE against the local cache;
the new predicate reads `clientMapping` and `pool`, so a transaction would be
pre-rejected in the browser whenever those were not yet cached. It is now a
read-then-`set()`, evaluated on the server. Write-once is unaffected — the rule's
`!data.exists()` is what enforced it all along.

*The original finding, kept because its reasoning still governs every future
per-room rule:*

### (historical) THE ROOM GATE WAS SELF-ASSERTABLE — every `uidMembers` rule was a speed bump, not a boundary (found 2026-08-03)

**Do not describe any per-room rule as "room-private" or "cross-room tampering is
denied" until this is fixed.** `rooms/$roomId/uidMembers/$uid` has
`.write: auth != null && auth.uid == $uid && !data.exists() && !closed` — a
participant CLAIMS their own membership, and **nothing checks they were actually
assigned to that room**. So any authenticated user who knows a session code can
self-claim any room and then act as a member of it.

Reproduced against the real emulator (with `scripts/sim/build-emulator-rules.js`
run first — see the trap below):

| step | result |
| --- | --- |
| cross-room `answers/moduleA` write BEFORE self-claim | `PERMISSION_DENIED` |
| self-claim `rooms/Room 2/uidMembers/<uid>` | **ALLOWED** |
| same cross-room write AFTER the claim | **ALLOWED** |
| cross-room `answersDeleted` write after the claim | **ALLOWED** |
| `roomChat` WRITE to another room after the claim | `PERMISSION_DENIED` (extra guard) |
| **`roomChat` READ of another room after the claim** | **ALLOWED** |

**Scope — everything gated this way since 2026-05-28/30**, not just the newest
nodes: `moduleA/hypotheses`, `scoring/awarded`, `scoring/auto`, `penalties`,
`votes/committed`, `promptReplies`, `exchangeReplies`, `answers/moduleA|B|Branched`
(#266), `answersDeleted` (#267) — **and the `roomChat` READ gate**, which is the
Phase-4e gap-3 fix. A session member can read another room's LLM conversation.
That contradicts any "the chat is room-private" claim in the privacy notice.

**#266 and #267 are still worth having** — they stop the *un-claimed* cross-room
write and seal the entry schema — but neither "closes" the hole, and their
original descriptions overstated it.

**DECIDED FIX (user, 2026-08-03): bind the claim to the pool assignment.** A
`uidMembers` claim must MATCH the claimant's own pool entry —
`pool/<clientId>/room == $roomId` with `clientMapping/<clientId> == auth.uid` —
so the claim becomes verifiable instead of asserted. This keeps the self-assign
join flow (`pool/$clientId/room` is deliberately self-assignable, Phase 4a) while
removing the free-for-all. Needs its own PR: it touches the room-entry path of
EVERY session, the ordering matters (the pool assignment must land before the
claim, or entry breaks), and it wants a full emulator run.

**⚠️ EMULATOR TRAP that made the first probe meaningless:** the emulator runs the
GENERATED `database.rules.emulator.json`, not `database.rules.json`. `npm run
test:e2e:rules` rebuilds it first; invoking `firebase emulators:exec` directly
does NOT, so it silently tests whatever was generated last — possibly another
branch's rules. Always run `node scripts/sim/build-emulator-rules.js` before a
hand-rolled emulator run, and assert the gate is present in the GENERATED file
before trusting a result.

### ⚠️ A DENIAL IS NOT EVIDENCE OF A GATE — the emulator's regex parser drops backslashes (found 2026-08-06)

**Never let an emulator test rest on a denial alone.** Pair every denial with an
ALLOW of the *same payload* by an authorised identity — otherwise the test cannot
tell "the gate held" from "nothing could ever be written here".

How this bit: `build-emulator-rules.js` rewrote `\s` (which the emulator rejects
at rules-LOAD time, `Illegal regular expression, 'whitespacechar' not found`) to
`\t\n\r` followed by a literal ASCII space — the trailing space is part of the
replacement, and is spelled out here because inside a code span it is invisible
(and trips markdownlint MD038), which is not a good property for a note whose
whole subject is which characters a class contains.
That LOADS, so it looked fine for months. But **the emulator's regex
parser does not honour backslash escapes inside a character class — it drops the
backslash.** Probed directly:

| regex | value | result |
| --- | --- | --- |
| `/^[^\t]+$/` | `"ttt"` | **deny** — the LETTER t is excluded |
| `/^[^\t]+$/` | `"a<TAB>b"` | **ALLOW** — a real TAB is not |
| `/^[^\x09]+$/` | `"v@example.test"` | deny — `\x` is likewise x, 0, 9 |

So `[^@\t\n\r ]` meant "not @, t, n, r, space": it banned t/n/r from every email
address and admitted real tabs and newlines. `sessions/$id/mail/$mailId` became
unsatisfiable under the emulator, so the open-relay security test passed on a
denial that had nothing to do with the admin gate — **it would have passed with
the gate deleted.** `sendQueuedMail` does no authorisation of its own, so that
rule is the only gate on the relay. The three `*Link` validators (six more `\s`
sites) were equally un-exercisable and had never been asserted on at all.

Fixed: whole-CLASS substitutions probed against a live emulator (`[^@\s]` →
`[!-?A-~]`, `[^\s]` → `[!-~]` — printable-ASCII ranges, the only forms that both
load and are honoured), plus `assertEmulatorSafe()`, which now FAILS the build on
any surviving backslash escape rather than mistranslating the next one. The
emulator variant is deliberately **strictly tighter** than production, so an
emulator ALLOW is sound evidence about production while a denial on a *non-ASCII*
payload is not — keep emulator test payloads ASCII. `sim-with-emulator.js` had a
second inline copy of the transform; it now delegates.
`Verify:` `node --test tests/emulator-rules-transform.test.js`, and in the
emulator suite "mail queue is admin-gated" + "the three session links are
admin-gated" — both now carry ALLOW legs as positive controls.

### 2026-08-05 — an org session was driven end to end for the FIRST time

Everything about the `orgs/` subtree had been verified by inspection and by unit
tests on path *derivation*; no test had ever loaded an org URL, because none
could. `scripts/serve-platform.js` had no `/o/**` route (`/o/caen-nagoya/` →
404), and `orgs.js` registers exactly ONE org — `caen-nagoya` — which IS
`CANAMED_DEFAULT_ORG`, so `canamedSessionPrefix()` maps it back to the legacy
`sessions/` prefix and **no shipped client can produce an `orgs/…` path at all.**
`tests-e2e/org-session-e2e.spec.js` now drives a real two-section session at
`/o/e2e-org/` (a test-only tenant injected by an augmenting `CANAMED_ORGS`
accessor — orgs.js stays production config).

**What the run PROVED (LOCAL mode, so paths only — never rule behaviour):**
org routing holds. Every write landed under
`orgs/e2e-org/sessions/<code>/…`, `sessions/<code>` read back `null`, and the
raw LocalDB store's top-level `sessions` key set was empty. Both sections
routed to their own `answers/sections/<slot>`, and the take-home the student
downloads carried both back.

**⚠️ `/o/<slug>/` WAS BROKEN IN PRODUCTION — asset resolution, not data.
FIXED IN CODE 2026-08-06 (shell v142); ✅ CONFIRMED LIVE 2026-08-12 (see STATUS
below — and read the `Verify:` note there before concluding it is broken).**
index.html had no `<base>` and referenced every asset relatively, while
firebase.json rewrites `/o/**` → `/index.html`. Measured against the live
deploy 2026-08-05:

| request | result |
| --- | --- |
| `GET /theme-init.js` | 200 `text/javascript`, 1 579 B |
| `GET /o/caen-nagoya/theme-init.js` | 200 **`text/html`, 221 781 B** (index.html) |

So every script/stylesheet/font/manifest an org page asked for came back as the
HTML shell, which `X-Content-Type-Options: nosniff` then refuses to execute.
`navigator.serviceWorker.register("sw.js")` failed the same way. An org URL
loaded a dead page.

**The fix (root-absolute asset URLs, chosen over a Hosting capture rule):**
every `src`/`href` in index.html, the `v()` helper in script-loader.js (which
addresses ~30 LAZY chunks the shell never mentions — the half most likely to be
missed), `ensurePdfmake()`'s two un-versioned vendored bundles, the SW
registration (`/sw.js` + explicit `{scope:"/"}`), `i18n.js`'s locale chunks and
its `localizedHref()`, and `reader-dict.js`'s dictionaries. `<base href="/">`
was rejected: it would break the ~32 same-document `#ic-*` SVG `<use>` refs and
the `href="#"` skip link. **`scripts/serve-platform.js` lost its org-asset
prefix-stripping crutch in the same change** — it made the dev server kinder
than Hosting and masked the defect; it now resolves real-file-then-rewrite,
exactly like Hosting.

✅ **STATUS — CONFIRMED FIXED IN PRODUCTION 2026-08-12** (checked against the
live site at shell v143). The defect is a Hosting-rewrite behaviour, so nothing
local can prove it; the check below was run against the live deploy and passes.

⚠️ **The `Verify:` first recorded here could NEVER have passed — it would have
reported this as broken forever, on a site that works.** It read
`curl -sI …/o/caen-nagoya/theme-init.js` expecting `text/javascript`. That
expectation belongs to the Hosting **capture-rule** fix — the one explicitly
REJECTED two paragraphs up. firebase.json still rewrites `/o/**` →
`/index.html` with no asset exclusion, so that URL returns index.html as
`text/html` **by design**, identically before and after the fix. What the
root-absolute fix changes is that nothing ever *requests* that URL: the page at
`/o/<slug>/` asks for `/theme-init.js`, which is a real file. So a `text/html`
there is NOT a regression signal — **do not re-open this on that reading.**
(General lesson, and the reason this is spelled out rather than quietly
swapped: a `Verify:` that cannot pass is worse than none. A missing check
leaves you uncertain; a false one manufactures a bug report about healthy code,
and costs whoever chases it. When writing one, confirm it distinguishes the
fixed state from the broken state — run it against BOTH if you can.)

`Verify:` check the URLs the org page actually emits, which is what the fix
changed:

```bash
# 1. the org page must EMIT root-absolute URLs — that is what the fix changed.
curl -s https://canamed-69785.web.app/o/caen-nagoya/ | grep -o 'src="/theme-init\.js?v=v[0-9]*"'
# src="/theme-init.js?v=v143"   <- LEADING SLASH = fixed (broken state: src="theme-init.js?v=…")

# 2. and the URL it emits must really serve JS. Assert the STATUS as well as the
#    type: a non-200 carrying a JS content type would otherwise pass, which is
#    the same class of defect this whole section is about. GET, not HEAD (-I),
#    because GET is what the browser issues.
curl -sS -w '\n%{http_code} %{content_type}\n' https://canamed-69785.web.app/theme-init.js | tail -1
# 200 text/javascript; charset=utf-8      <- must be BOTH 200 and javascript
```

Do **not** rewrite that second one as the more obvious
`curl -o /dev/null -w '%{http_code} %{content_type}\n' …`: Git Bash here ships
**mingw64 curl** (a Windows binary), which cannot write to the MSYS `/dev/null`
path and exits **23** `client returned ERROR on write` *after* printing the
correct answer. It looks like a failed check on a healthy site — this section's
own failure mode, one layer down. Discarding the body via `-o` is what breaks;
appending the status line to it and taking `tail -1` needs no discard.
Discrimination confirmed on all three cases: `/theme-init.js` → `200
text/javascript` (pass); `/o/caen-nagoya/theme-init.js` → `200 text/html`
(fail, the rewrite); a missing asset → `404 text/html` (fail).

Measured 2026-08-12: `/o/caen-nagoya/` serves HTML byte-identical to
`/index.html` (same md5), carrying `/theme-init.js?v=v143`, `/tokens.css?v=v143`,
`/script-loader.js?v=v143` and `register("/sw.js", { scope: "/" })` — every one
root-absolute. Also `curl -s https://canamed-69785.web.app/sw.js | grep
canamed-shell-v` should show `v142` or later, confirming the shell carrying the
fix is live (v143 as of this check).
Regression cover: `tests-e2e/org-session-e2e.spec.js` asserts on the real
network responses at `/o/e2e-org/` — separately for the static shell and for a
LAZY chunk, because the first passing proves nothing about the second.

**Two NEW rule-parity gaps, found by diffing the two rule subtrees. Neither was
observed — LOCAL mode models no rules — so these are static findings:**
- ~~**`rosters` org branch is mis-nested by one level.**~~ **✅ NOT TRUE ANY MORE —
  label was stale, corrected 2026-08-21.** The rule tree now reads
  `rosters/orgs/$orgSlug/sessions/$sessionId/$uid`, which matches the client
  path (`"rosters/" + sPath(uid)`, i.e. `_sessionPrefix(org) + code + "/" + uid`)
  exactly. Both branches — `rosters/sessions/$sessionId` and the org one — are
  present. The finding was real when written; it was fixed at some point without
  this line being updated, which is precisely what the STATUS-CLAIM RULE exists
  to catch.
  `Verify:` this is now **pinned by a test**, not by prose —
  `tests/session-trees.test.js` "the rosters rule tree covers both derived roster
  paths" asserts both branches exist in `database.rules.json`, and two sibling
  assertions pin the derived `rosterPath` values. A regression fails the unit
  suite instead of silently fail-closing org rosters again.
- ~~**`audit` is org-only — the DEFAULT tree has no rule for it.**~~
  **✅ NO LONGER TRUE — label was stale, corrected 2026-09-04.** `audit` is
  declared under **both** `sessions/$sessionId` and
  `orgs/$orgSlug/sessions/$sessionId`, each admin-gated by the same
  creator-or-proof predicate as the rest of the Phase-4a nodes. So
  `logAdminAction()`'s write works in the default tree too, and the "has never
  worked on the default org" claim is wrong. The finding was real when written;
  it was fixed at some point without this line being updated — the same failure
  the STATUS-CLAIM RULE exists to catch, and the second sighting after
  `rosters`.
  `Verify:` `python -c "import json;r=json.load(open('docs/Third_session/PBL_platform/database.rules.json'))['rules'];print('audit' in r['sessions']['$sessionId'], 'audit' in r['orgs']['$orgSlug']['sessions']['$sessionId'])"`
  prints `True True`. Now also covered structurally by
  `tests/rule-tree-parity.test.js`, which asserts the two subtrees have
  IDENTICAL key sets — so this particular claim cannot go stale again in either
  direction.

**Round-3 — TRACKED hardening (defense-in-depth, not active exploits):**
- ~~**`answers/moduleA` + `answers/moduleB` are the weakest participant-writable
  nodes left**~~ **✅ FIXED 2026-07-31.** Their `$entryId .write` was only
  `auth != null && !closed` — no `uidMembers` room gate, no `$other` sentinel —
  so any authenticated user who knew a session code could write/overwrite an
  answer in ANY room, with undeclared fields, while every other per-room
  participant node was already gated. Both are now **cloned from their own
  tree's `moduleBranched` block** (the M4d node that shipped hardened), in the
  `sessions/` and `orgs/` trees alike, so all three modules are byte-identical
  by construction rather than by careful re-typing.
  **The ordering trap was real and is now covered:** the client writes
  `university` and `bulletKey`, which the old `.validate` did not declare, so
  sealing with `$other:false` before declaring them would have rejected
  legitimate answers — the node would have looked hardened while silently
  breaking every session. A unit test asserts every client-written field is
  declared; the emulator test writes the REAL `addAnswer()` payload, and also
  covers the two paths the branched test never exercised — the `edits`
  append-log and the child-only `text` overwrite that inline editing performs
  (a seal validating only whole entries would pass every other test and still
  break editing). `Verify:` `tests/rules.test.js` "answers/moduleA+B match
  moduleBranched exactly" (both trees) + the emulator's
  "answers/moduleA|moduleB is room-gated and schema-sealed" cases.
- **`$other:{".validate":false}` sentinels** on participant-writable per-room
  nodes (chat/$turnId, score/auto+penalties/$eventId, scoring/awarded/$familyId,
  hypotheses/$entryId, promptReplies+exchangeReplies/$cid, callForHelp,
  uidMembers/$uid, members/$uid, events/$pushId, votes/$voteId/committed, +org
  mirrors) — blocks unknown-key/oversized-field injection. NB: this needs each
  node restructured to NAMED child rules first (a bare `$other` would reject the
  valid keys, which are checked in the parent `.validate`), so it's a focused
  change, not a one-liner.
- ~~**Org parity (remaining)**~~ — **✅ CLOSED 2026-09-04 (PR #384).**
  `poll/$clientId`, `rooms/$roomId/answerReplies` and `rooms/$roomId/observers`
  were the last three `sessions/`-only nodes; they are now mirrored into the org
  tree. **CLONED, not retyped** — each is a pure re-prefix of its session
  original, and a test asserts exactly that, so editing one copy alone fails.
  Proven by INVERSION on the emulator: the new case
  ("poll, answerReplies and observers work in the org tree (G9 parity)") FAILS
  against the rules without the change and passes with it. That is why it leads
  with ALLOW legs — the defect was that nothing could be written, so a
  denial-only test would have passed equally well before and after.
  **This gap was found by hand three times (2026-05-30, 2026-08-05, 2026-09-03)
  and each pass found a DIFFERENT set of nodes**, because nothing linked the two
  trees between audits. It is now enforced rather than re-audited:
  `tests/rule-tree-parity.test.js` requires identical key sets at both levels,
  requires the three clones to stay pure re-prefixes, and fails if any org rule
  still addresses `root.child('sessions')` — a mis-copied prefix would fail
  **OPEN**, which is worse than the missing rule it replaced. A deliberate
  asymmetry must be declared in its `ASYMMETRIC` map with a reason.
  ⚠️ ~~**The mirror faithfully reproduces one weakness:** `answerReplies` has NO
  ownership gate in EITHER tree (`auth != null && !closed`). The emulator case
  asserts a peer CAN write one~~ **HALF CLOSED 2026-10-14, in the rules — confirm
  the deploy before calling it live.** That sentence ran two things together.
  The node had no gate at ALL: the "peer" the emulator case allowed had joined
  nothing. It now requires a participant of that room or the session's
  facilitator, in both trees ("A room's seven open writes" above), and the
  case asserts the outsider is refused. What it still lacks is OWNERSHIP: once
  in the room, a participant can rewrite or delete another's reply — the case
  now records THAT, with the same instruction to update it rather than delete
  it. Hardening belongs to the `$other`-sentinel item and must happen in both
  trees at once.
  `Verify:` `node --test tests/rule-tree-parity.test.js`, which since the same
  date holds EVERY room-level node to a pure re-prefix (the session subtree
  and its `adminSecrets` branch), not three.
- ~~`summary.at` / `created.at` lack an upper timestamp bound (admin-only writes;
  low value)~~ **WRONG ON BOTH COUNTS for `created.at` — ✅ FIXED IN CODE
  2026-10-07 (PR #438), together with `closed.at`. "In code" is the claim: the
  purge half is live from the first scheduled run after merge, the rules half
  only once the best-effort database deploy has actually run — check both
  before saying it is live (`Verify:` below).** `created` is not admin-only (any signed-in
  visitor writes it while `facilitatorGate/enforce` is off), and it was not low
  value: `created/at` and `closed/at` are the two numbers the nightly purge
  decides from, so a session dated in the future was "within retention" until
  that date. Measured by RUNNING the purge — kept with `created.at = now + 10
  years`, and kept again five years later. Nobody had asked what READS the
  date; a bound on a timestamp is worth exactly what depends on it.
  - **Rules:** both `at`s are now `<= now + 43200000 && >= now - 43200000`
    (twelve hours either side), both trees. **Twelve hours, not the 5 s every
    other timestamp gets, and that is deliberate** — it first went up as
    +5 s / −2 h and an independent review blocked it. The client sends
    `Date.now()`, so the window decides which facilitators can create and close
    a session AT ALL, and a laptop carried between France and Japan and
    corrected by hand is 7–8 h off. A tight window bought nothing: the purge
    takes any date up to 24 h ahead at face value anyway. Keep it strictly
    BELOW the purge's tolerance (a test requires an hour's margin — the rule
    runs on the database's clock, the purge on a CI runner's).
  - **⚠️ WHAT A REFUSED DATE DOES, for whoever narrows the window again.** With
    +5 s / −2 h, three flows that work on `main` failed for a skewed device:
    create here and run elsewhere; "Sessions you created → Close"; and the
    end-of-class close by a facilitator **who was already a member** —
    membership is per uid and persistent, and `started`, `stage` and the proof
    carry no date, so such a facilitator ran the whole session and was refused
    only at the close. (An earlier version of this entry said "no device that
    could run a session is newly refused". That was wrong for exactly that
    case.) The product handles a refusal badly: *create* — only the dated
    write is refused, the rest of the batch lands, leaving a dateless partial
    session (purged at the next run; its `recovery/` node by nothing);
    *close* — "Sessions you created" says to check the connection, the
    dashboard alert says to run `firebase deploy --only database` after
    downloading the archive again, and the session STAYS OPEN: participants
    never see it end, it takes the 90-day path, and it never reaches the
    research export, which takes closed sessions only. All of that now needs a
    clock more than 12 h wrong — **and, since the client fix below, a browser
    still running a shell from before it.** If a facilitator reports "can't
    create a session" or "can't close", have them reload first, then check
    their clock.
  - **✅ THE CLIENT NOW SENDS THE SERVER'S TIME — fixed in code 2026-10-08,
    for EVERY date it stores, not only these two.** "In code" is the claim: it
    reaches a browser when that browser loads the shell carrying it (the
    version is assigned at merge — read `SHELL_VERSION` in `sw.js`, not this
    line), and a browser on an older shell sends its device clock exactly as
    before. **That is why the ±12 h window stays. Do not narrow it on the
    strength of this change.**
    - **The defect was much wider than create and close.** The rules compare
      a client-supplied date with `now` 185 times; 92 of those allow five
      seconds of lead and no more, most with a floor as well (2 min for
      `members` and `pool`, 30 min for an answer, ±5 s for `stageAt`). The
      client sent `Date.now()`. So a participant whose laptop was a minute
      fast could not JOIN: `members` and `pool` were refused, the waiting
      screen showed anyway, and a `permission_denied` in the console was the
      only trace. Answers, votes, chat turns, stage timers and withdrawals
      went the same way. Reproduced on the emulator before any code changed,
      with the page's clock moved: at ±1 h `created` landed an hour wrong; at
      ±13 h the create form and "Sessions you created → Close" both failed.
    - **How.** `serverNow()` in `lib.js` is `Date.now()` plus the offset the
      SDK publishes at `.info/serverTimeOffset` (subscribed in `dbInit()`,
      shared mode only; the scenario editor is a separate page and keeps its
      own, subscribed by its first save and NOT at page load — touching the
      database is what opens the realtime connection, and an editor tab left
      open would hold one of the plan's simultaneous connections for
      nothing). A NUMBER, deliberately not `ServerValue.TIMESTAMP`: the
      placeholder is an object until the server replaces it, LocalDB would
      store that object as the date, and some sixty sites read back, sort by
      or subtract what they wrote. The placeholder stays where it already was
      (the password-reset flag, R3-D1). A stored date is also COMPARED on the
      server's clock now — minutes on a stage, the "facilitator may be
      offline" banner, whether a chat reply is new. And the certificate PDF
      prints that clock's day. On the FIRST download that is the day its
      published record carries and `verify.html` shows; the record is
      write-once, so a later download prints its own day and the record
      keeps the first — as before this change, which fixed the clock and
      not which day.
    - **To fake a device clock in a test, replace `Date` itself**, not
      `Date.now()`: the SDK measures its offset with `new Date().getTime()`,
      so overriding `Date.now()` alone builds a device that cannot exist — the
      page sees a wrong clock, the SDK an honest one, and every write is
      refused for a reason no real device has. And a callback passed to
      `.on("value")` runs SYNCHRONOUSLY when the value is cached, before the
      handle `.on()` returns can be assigned: the first version of the control
      test hung on exactly that, and read as "the SDK is broken on a slow
      clock".
    - **Offset not known = device clock.** It arrives with the connection
      handshake, before any read can resolve, and every flow that stores a
      date reads first (the code probe, the uniqueness check, the head-count
      before a close). That is an observation about today's flows, not
      something a test enforces: a write composed before any read is dated by
      the device. A device whose clock is CHANGED mid-session keeps the old
      offset until its socket reconnects.
    - **Every lazy chunk that dates a write carries a one-line fallback**
      (`if (typeof serverNow !== "function") window.serverNow = …`). After a
      deploy, a page already past the splash is not reloaded, and it asks for
      its lazy chunks from the network: NEW chunk, OLD `lib.js`. Without the
      line, the dashboard on such a page could not close the session and the
      chat would not start. **Any new global a lazy chunk takes from the
      eager shell needs the same thought** — `sw.js` matches cache entries
      with `ignoreSearch: false`, so a precached chunk is never what answers
      a `?v=` request.
    - **The helper is in `lib.js`, not `pure-utils.js`**, because
      `pure-utils.js` is also the verify page's and carries that page's own
      version marker: touching it forces a second bump. For the same reason
      `minsSince()` there was left alone and now has no caller in the app;
      the dashboard uses `minsSinceStored()`.
    - **The two close messages** no longer blame the connection, or tell a
      facilitator to run `firebase deploy`, when the SERVER refused the write
      (`code === "PERMISSION_DENIED"`); they say it refused and what to do.
      **A refusal has more than one cause, so the list checks before it
      speaks:** a session ended from elsewhere since the list was drawn is
      refused too (`closed` is write-once), and is reported as already
      closed and pruned — the first version told its facilitator to open it
      with the password and end it from the dashboard.
    - **Still open — proposed on the PR, not done:** a refused `created` still
      leaves a partial session, because the create batch issues its writes
      together. Awaiting `created` before the rest would stop that; it changes
      the ordering every session creation passes through. The create form's
      own message belongs with it: it still says "check your connection" for
      any failure, a rules refusal included. And the dashboard still
      downloads the archive again on every retry of a failed close.
    - `Verify:` `node --test tests/server-time.test.js` — the helper; an
      INVENTORY of the device-clock reads left in the client, so a new one
      fails until someone says what it is for; and the dated fields, derived
      from the rules. **The inventory is a TEXT check, and sees what is
      spelled:** `Date.now`, and any `new Date` with no argument that is not
      formatted on the spot. Its first version listed the ways of turning a
      Date into a number instead, and a review put `(new Date()).getTime()`,
      `new Date() - 0` and `Date.parse(new Date())` into `createSession()`
      with the suite still green. It flags the source now, not the
      conversion. A clock reached through something that does not spell it —
      an alias beyond the plainest, a helper in another file, a Date object
      handed in — still gets past, and always will. For the fields it
      exercises, the emulator spec is what holds: there the date is read
      back from the database. `tests-e2e/emulator/device-clock.spec.js`
      — the real client with its clock ±1 h and ±13 h creates, joins,
      advances, writes and closes, every refusal paired with an allow. Those
      test the REPO. Live: set a device's clock an hour ahead, join a session
      and read `pool/<clientId>/at`. Not done here — it needs a session.
  - **Purge (the half that closes it — a rule cannot reach a session already in
    the database):** `scripts/lib/session-retention.js` treats a date more than
    24 h ahead as impossible and the session as due. The tolerance is a day on
    purpose: with a small one, a session created shortly before the run by a
    laptop with a fast or wrong-zone clock would be deleted. The job prints
    `Dated in the future: N session(s)` — a count, in QUIET mode too.
    ⚠️ "03:17 UTC" is the CRON, not when it runs: the six scheduled runs before
    2026-10-07 started between 09:10 and 10:28 UTC. After a morning merge the
    first live purge can be within the hour.
  - `Verify:` `node --test tests/session-retention.test.js` (runs the real
    script on two dates five years apart; holds the tolerance above the rules'
    allowance and the window wide enough for a wrong time zone) and
    `tests-e2e/emulator/session-date-bounds.spec.js` (every denial paired with
    an allow; a device eight hours off creates and closes; so does the real
    client). Those test the REPO. For the live system:
    - rules: `gh run view <deploy run> --log | grep -F 'released successfully'`.
      NOT `grep 'Database rules deployed|NOT deployed'`, which this entry first
      gave: the workflow echoes its own script, so both strings are in the log
      of EVERY run, success or failure. Tried on a real run.
    - purge: the first scheduled `cleanup-stale-sessions` log after merge. A
      `Dated in the future: N` line means sessions already carried such a date.
      Its absence means none did ONLY if the `Backup gate:` line says OK — a
      BLOCKED gate skips the session pass whole, dry run included, and the
      line is then absent whatever the database holds. The count before merge
      is on PR #438 (a dry run of the branch); the live database was not
      otherwise queried.
  - **Still unbounded, and NOT read by any deletion job today:** `summary.at`,
    `pool/$cid/consent/at`, `users/$uid/history/$code/joinedAt`. Bound one
    before a retention job starts reading it, not after. (The client dates all
    three from the server's clock since 2026-10-08; the RULES still accept any
    number, and it is the rules a retention job would be relying on.)
- `answers/.../edits/$editId` has no explicit owner check (possible
  collaborative-edit by design — decide + document).

**Round-3 — re-confirmed ACCEPTED (no change):**
- `credentials/$certId` public read: the verification page needs it; the parent
  collection is `.read:false` (no listing) and published cert IDs are now
  crypto-random + persisted (see the "Accepted by design" note above; the
  deterministic-id gap was **FIXED 2026-07-24**), so it's a genuine
  "know-the-ID-to-read-it" feature — not an enumerable oracle, and no longer
  classmate-recomputable for new certs. ⚠️ It exposes **five** fields, not two —
  `nameHash`, `session` (the session CODE), `sessionLabel`, `at`,
  `retentionUntil`. See the corrected note under "Accepted by design" above;
  this bullet carried the same understatement until 2026-08-19.
- `sessions/<code>/adminPasswordHash` `.read:auth!=null`: the value is a
  non-secret random marker (real hash is in the unreadable `adminSecrets/`);
  cross-session read leaks only "this session has admin configured".
- `sharedScenarios` readable by any authed user (opt-in facilitator sharing);
  `ownerName` is capped at 80 chars — confirm the facilitator consent flow
  discloses that a display name may be visible to participants.

**Round-4 review (2026-05-30) — verification pass on R3 + two residuals fixed:**
- The R3 recovery-race fix was confirmed **correct + complete** (uid binding on
  all 4 hash rules, code-gate intact, no forge path; supply-chain, eval removal,
  retentionUntil all re-verified). ⚠️ **"Code-gate intact, no forge path" did
  not hold, and the reviews of that day did not see why:** the gate compares a code the
  client has to PRESENT, and until 2026-10 it presented it in a node every
  member of the session could read. Nobody needed to forge a code they could
  read. See "THE RECOVERY CODE WAS READABLE BY EVERY SESSION MEMBER" under
  Known security follow-ups. Two residuals found and fixed:
  - **Initial-set race (MEDIUM)**: the `!data.exists()` branch of the four hash
    rules wasn't uid-bound — an attacker could race the create-flow gap to set
    the admin hash first. Now guarded by `creatorUid == auth.uid` (creatorUid is
    written before the hash). Emulator-tested.
  - **`currentUser` null self-DoS (LOW)** in the reset write sites — guarded.
- Added tests: initial-set creatorUid-bound race; forged-uid (`uid != auth.uid`)
  denial at `_superadminReset`. Remaining open item is the *documented*
  defense-in-depth set above (`$other` sentinels, remaining org parity).
