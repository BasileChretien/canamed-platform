#!/usr/bin/env node
/* Purge stale CaNaMED sessions from the live Realtime Database.
 *
 * GDPR Art. 5(1)(e) "storage limitation" + APPI Art. 21 require that
 * personal data isn't kept longer than needed for the purpose it was
 * collected. The privacy policy commits us to:
 *   - identified live + archive data    ≤ 30 days after session close
 *   - abandoned sessions (never closed) ≤ 90 days after creation
 * Both dates are written by the CLIENT. One that lies in the future is not
 * "within retention until then": it cannot be true, and the session is due at
 * once (2026-10-07 — see scripts/lib/session-retention.js for what was measured).
 * (Pseudonymised research data is exported to outputs/ before this runs
 * and lives elsewhere — see scripts/02_script_analysis_session2.R.)
 *
 * This script enforces the schedule. Runs daily via a scheduled GitHub
 * Actions workflow against the production database using the same
 * service-account credentials that ship deploys. Dry-run by default;
 * set CLEANUP_CONFIRM=1 to actually delete.
 *
 * Env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON file (set by GH Actions)
 *   FIREBASE_DATABASE_URL           the RTDB URL (with region suffix)
 *   CLEANUP_RETENTION_CLOSED_DAYS   default 30 — purge after this many days post-close
 *   CLEANUP_RETENTION_OPEN_DAYS     default 90 — purge abandoned sessions after this many days
 *   CLEANUP_RETENTION_METRICS_DAYS  default 30 — purge hfPatient metrics rows older than this
 *   CLEANUP_RETENTION_PURGED_MARKER_DAYS  default 1825 — drop a purge marker
 *                                   (purgedSessions/<code>) once it is this old
 *                                   and no withdrawal record is left under it
 *   CLEANUP_CONFIRM                 set to "1" to actually delete (otherwise just log)
 *   CLEANUP_QUIET                   set to "1" to suppress the per-session lines and
 *                                   emit only the summary. REQUIRED when the workflow
 *                                   runs on a PUBLIC repo, whose Actions logs are
 *                                   world-readable: a per-session line prints the
 *                                   session join-code, and codes of not-yet-expired
 *                                   ("KEEP") sessions could still be live/joinable.
 *
 * ALSO purges the hfPatient metrics tree (added 2026-08-12). Those rows hang off
 * no session, so the session walk never saw them and they accumulated from the
 * LLM pilot's launch onward. They are not anonymous: each carries the Firebase
 * Auth uid as a field (`events`) or as the KEY (`usage/<uid>`,
 * `dailyUid/<uid>`), which is pseudonymous personal data under GDPR Recital 30.
 * `global/<day>` is a bare per-day count with no identifier and is KEPT — it is
 * the cost history behind the $1 budget alert. See scripts/lib/metrics-retention.js.
 *
 * Covers BOTH session trees — `sessions/<code>` and
 * `orgs/<slug>/sessions/<id>` (see scripts/lib/session-trees.js). Org-scoped
 * sessions were invisible to this job until 2026-07-23 and so were never
 * purged. Purging a session also removes its `adminSecrets/...` entry, which
 * lives outside the session subtree and nothing else cleans up. The same goes
 * for every other per-session tree outside the cascade (recovery code, chat,
 * roster, …): tests/purge-tree-coverage.test.js derives that list from
 * database.rules.json and fails when one is declared there and not purged here.
 *
 * TWO THINGS A PURGE DELIBERATELY LEAVES (2026-10-07):
 *   - an erasure request nobody has answered yet (`withdrawals/<code>/<uid>`
 *     with `erasure: true` and no matching record under `erasures/`). It used
 *     to go with the session, unanswered. See lib/withdrawal-retention.js.
 *   - a marker, `purgedSessions/<code>` = the time of the purge: the only
 *     thing left that shows the session existed. A code and a date.
 *
 * Output:
 *   one line per session in the report — KEEP / PURGE / DRY-RUN (unless CLEANUP_QUIET).
 *   "nothing to purge" is success. Exit codes:
 *     0  both passes ran clean
 *     1  a session or a metrics node could not be read or deleted
 *     2  refused to start (bad retention window), or an uncaught failure
 *        (auth fail, DB unreachable)
 *     3  the backup gate blocked the SESSION purge — the metrics pass still ran
 */

"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const {
  readSessionLocations,
  readSessionLocationsShallow,
  hadSessionTimestamp,
  safeLabel
} = require("./lib/session-trees");
const { legacyResetFlagPath } = require("./lib/reset-flag");
const { pruneHfPatientMetrics } = require("./lib/metrics-retention");
const { sessionRetentionVerdict, FUTURE_DATE_TOLERANCE_MS } = require("./lib/session-retention");
const { parseRetentionDays } = require("./lib/retention-window");
const { readBackupMarker, backupGateReport } = require("./lib/backup-marker");
const { runCleanupPasses } = require("./lib/cleanup-passes");
const { answeredIndex, flattenErasures } = require("./lib/data-rights");
const {
  holdsErasureRequest,
  planPurgedSessionWithdrawals,
  sweepPurgedSessionRecords
} = require("./lib/withdrawal-retention");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
/* Retention windows come from free-form workflow_dispatch string inputs, and
   they are the ONLY thing standing between this job and the whole database.
   parseInt() is far too forgiving for that:
     "-1"  → a cutoff in the FUTURE, so every current row satisfies
             `at < cutoff` and the job deletes live data;
     "abc" → NaN, every comparison is false, and retention silently stops
             happening — the exact failure this job exists to prevent.
   Neither is recoverable and neither announces itself, so a bad window aborts
   the run instead of being guessed at. Applied to all three windows: the
   session ones carry the same trap, and there "-1" would purge every session
   in both trees. Flagged by CodeRabbit on #314. */
function retentionDays(name, fallback) {
  const r = parseRetentionDays(process.env[name], fallback);
  if (!r.ok) {
    console.error(`FATAL: ${name}=${r.error}. Refusing to run: a negative window ` +
      "puts the cutoff in the future and deletes live data, and a non-numeric one " +
      "disables retention silently.");
    process.exit(2);
  }
  return r.value;
}

const CLOSED_DAYS = retentionDays("CLEANUP_RETENTION_CLOSED_DAYS", 30);
const OPEN_DAYS = retentionDays("CLEANUP_RETENTION_OPEN_DAYS", 90);
/* The hfPatient metrics are not tied to a session lifecycle, so they need their
   own window. 30d matches the "identified data ≤ 30 days" commitment the
   privacy policy already makes — these rows are pseudonymous rather than
   identified, so the same window is conservative, not lax. */
const METRICS_DAYS = retentionDays("CLEANUP_RETENTION_METRICS_DAYS", 30);
/* How long a purge marker (purgedSessions/<code>) is kept once nothing is left
   under it. FIVE YEARS, and the reasoning is the marker's job, not a habit:
   once the marker backfill has been run, the rules accept a withdrawal for a
   purged session only while its marker exists (before that they accept one
   for any code), and a withdrawal can still have an object for as long as the
   research dataset and the certificate registry may hold the participant —
   both up to five years in the participant notice. A shorter window would
   turn the account dialog's "Withdraw" on an old session into an error. The
   marker is a session code and a date; it names nobody.
   ⚠️ A retention period nonetheless: recorded as the Controller's to confirm
   in DPA Annex VI, G12. */
const MARKER_DAYS = retentionDays("CLEANUP_RETENTION_PURGED_MARKER_DAYS", 5 * 365);
const CONFIRM = process.env.CLEANUP_CONFIRM === "1";
const QUIET = process.env.CLEANUP_QUIET === "1";

/* ── THE BACKUP INTERLOCK (2026-08-31) ────────────────────────────────────
 * OPT-IN, and defaulting OFF is a deliberate decision, not an oversight.
 *
 * The hazard it addresses is real: this job runs on RTDB (free tier) while
 * backup-sessions writes to GCS (needs billing). When the billing account
 * closed on 2026-08-27 the backup job failed daily and THIS job kept
 * succeeding, so a session ageing past its window would have been deleted
 * with no archive and no warning anywhere.
 *
 * But arming it unconditionally would be worse than the hazard. Deletion is
 * the LEGAL duty (GDPR storage limitation, and the 30/90-day windows this
 * platform publishes); the backup is disaster recovery. With no Blaze plan
 * there is no GCS at all, so an always-armed gate would block deletion
 * permanently — trading a missing archive for a permanent retention breach.
 *
 * Hence: armed only when backups are actually expected to work. Disarmed, it
 * still prints its state on every run, so "purging without an archive" can
 * never be mistaken for "purging with one". See scripts/lib/backup-marker.js.
 *
 * NB the gate stops SESSION purges only. Metrics pruning has its own clock
 * and is not covered by the session backup, so blocking it here would create
 * a second retention gap while trying to prevent a data-loss one.
 *
 * ⚠ That paragraph was FALSE until 2026-10-07. A blocked gate exited on the
 * spot, before BOTH passes, so the metrics pruning it promises to leave alone
 * was skipped too. main() no longer acts on the verdict at all: it hands it to
 * runCleanupPasses() (scripts/lib/cleanup-passes.js), which skips the session
 * pass, still runs the metrics pass, and returns exit code 3. The ordering is
 * run, not grepped, in tests/cleanup-passes.test.js.
 *
 * The same holds for the third pass, sweepWithdrawals(): the withdrawal
 * records and markers of sessions that are already purged are in no backup
 * either, so a blocked gate does not stop it. */
const REQUIRE_BACKUP = process.env.CLEANUP_REQUIRE_BACKUP === "1";
const BACKUP_MAX_AGE_DAYS = retentionDays("CLEANUP_BACKUP_MAX_AGE_DAYS", 2);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const metricsCutoff = Date.now() - METRICS_DAYS * MS_PER_DAY;
const markerCutoff = Date.now() - MARKER_DAYS * MS_PER_DAY;

/* Prune the hfPatient metrics tree. The rules and the deletion orchestration
   live in scripts/lib/metrics-retention.js so they can be driven against a fake
   db in tests (see tests/metrics-retention.test.js); that file also documents
   what expires and why `global/<day>` does not.

   Reads each node whole and filters in memory rather than using
   orderByChild("at").endAt(cutoff): the query form needs an `.indexOn`, and
   `metrics/` deliberately has NO rules entry (so root `.read:false` applies and
   no client can touch it). At workshop scale — 30 students x ~10 turns per
   session — a month of rows is thousands, not millions, and after the first run
   the window keeps it bounded. Revisit if this ever serves continuous traffic. */
async function pruneMetrics(db) {
  return pruneHfPatientMetrics(db, { cutoffMs: metricsCutoff, confirm: CONFIRM });
}

/* Which erasure requests have been answered — the `erasures` ledger. Shared by
   the session pass and the withdrawal sweep, read at most ONCE per run, and
   only when one of them actually holds an erasure request to decide on: a
   session being purged with one under it, or a purged session still carrying
   one (which, for a request that is being kept, is every night until it is
   answered). If it cannot be read, nothing can be shown to be answered —
   every request is then kept, the purge itself still happens, and the pass
   that asked reports one error: an unreadable ledger is also a restore that
   would refuse to run. */
let ledger;                           // undefined = not read yet; null = unreadable
let ledgerErrors = 0;
async function answeredRequests(db) {
  if (ledger !== undefined) return ledger;
  try {
    const snap = await db.ref("erasures").once("value");
    ledger = answeredIndex(flattenErasures(snap.val()));
  } catch (e) {
    ledger = null;
    ledgerErrors = 1;
    console.error("ERROR    could not read the erasure ledger: " +
      (QUIET ? (e && e.code ? e.code : "error") : (e && e.message)) +
      " — every erasure request is being kept.");
  }
  return ledger;
}
/* Charged once, to whichever pass hit it. */
function takeLedgerErrors() {
  const n = ledgerErrors;
  ledgerErrors = 0;
  return n;
}

/* The third pass: withdrawal records of sessions purged on an EARLIER night —
   a request the purge kept, once it has been answered, and anything written
   since (the rules accept a withdrawal for a purged session). Nothing else
   ever deletes them. Only under a purge marker; see lib/withdrawal-retention.js.

   NOT governed by the backup gate, for the reason the metrics pass is not: the
   session backup holds none of this, and these records belong to sessions that
   are already gone. A session purged tonight is still in `locations`, so it is
   skipped here and picked up tomorrow — the purge has just decided its records. */
async function sweepWithdrawals(db, locations) {
  const sweep = await sweepPurgedSessionRecords(db, {
    liveLocationKeys: locations.map((l) => l.key),
    answered: () => answeredRequests(db),
    markerCutoffMs: markerCutoff,
    confirm: CONFIRM,
    onError: (e) => console.error("ERROR    withdrawal records of purged sessions: " +
      (QUIET ? (e && e.code ? e.code : "error") : (e && e.message)))
  });
  console.log("");
  console.log(`Withdrawal records of purged sessions: ${CONFIRM ? "purged" : "would-purge"} ` +
    `${sweep.answered} answered request(s), ` +
    `${sweep.noRequest} with no erasure request; ${sweep.open} unanswered request(s) kept.`);
  console.log(`Purge markers: ${sweep.markers} held, ${sweep.markersExpired} ` +
    `${CONFIRM ? "expired" : "would-expire"}.`);
  return {
    changes: sweep.answered + sweep.noRequest + sweep.markersExpired,
    errors: sweep.errors + takeLedgerErrors()
  };
}

async function main() {
  // initializeApp picks up GOOGLE_APPLICATION_CREDENTIALS automatically
  const app = initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("--- CaNaMED session cleanup ---");
  console.log(`Database:    ${DB_URL}`);
  console.log(`Retention:   closed ≤ ${CLOSED_DAYS}d, abandoned-open ≤ ${OPEN_DAYS}d, ` +
    `hfPatient metrics ≤ ${METRICS_DAYS}d`);
  console.log(`Mode:        ${CONFIRM ? "LIVE — deletions WILL happen" : "DRY-RUN"}`);
  console.log("");

  /* BOTH trees: sessions/<code> and orgs/<slug>/sessions/<id>. Org sessions
   * were previously invisible to this job and so were never purged.
   *
   * ENUMERATED BY KEY ONLY. This job reads `created/at` and `closed/at` per
   * session and nothing else — the per-session read below has said so in a
   * comment for a long time — but it used to get its list from
   * readSessionLocations(), which deep-reads all of `sessions` and `orgs`.
   * So the whole identified database, names and free-text chat included, was
   * copied onto a GitHub Actions runner in the United States every night and
   * discarded unused. The comment below was accurate about its own two reads
   * and completely undone by the line above it. Art. 5(1)(c).
   *
   * CLEANUP_DEEP_ENUM=1 restores the old behaviour. It exists because this is
   * a legally load-bearing job that cannot be exercised end-to-end outside
   * production: if the shallow path ever misbehaves, an operator can revert
   * without a deploy. It is NOT a fallback — nothing selects it automatically,
   * because a silent fallback would hide exactly the breakage worth seeing. */
  const deepEnum = process.env.CLEANUP_DEEP_ENUM === "1";
  console.log(`Enumeration: ${deepEnum
    ? "DEEP (CLEANUP_DEEP_ENUM=1) — reads every session body"
    : "shallow — keys only, no session bodies leave the database"}`);
  const locations = deepEnum
    ? await readSessionLocations(db)
    : await readSessionLocationsShallow({ app, databaseURL: DB_URL });
  const orgCount = locations.filter(l => l.orgSlug).length;
  console.log(`Found ${locations.length} sessions (${locations.length - orgCount} default, ${orgCount} org-scoped).`);

  /* Read the marker rather than the bucket — see backup-marker.js for why
   * probing GCS to decide whether GCS is healthy fails in the exact state
   * this guards against. A read failure is treated as NO marker: the gate
   * must fail closed when armed, never open. */
  let marker = null;
  try {
    marker = await readBackupMarker(db);
  } catch (e) {
    console.warn(`Could not read the backup marker: ${QUIET ? "(redacted)" : e.message}`);
  }
  const gate = backupGateReport({
    armed: REQUIRE_BACKUP,
    marker,
    maxAgeDays: BACKUP_MAX_AGE_DAYS
  });
  console.log(gate.line);
  console.log("");

  /* The verdict is HANDED OVER, never acted on here. Branching on it in main()
   * is how a blocked gate came to skip the metrics pass as well as the session
   * one — see the note above REQUIRE_BACKUP. Nothing has been deleted at this
   * point, and nothing between here and the hand-off may end the run. */
  const outcome = await runCleanupPasses({
    gate,
    purgeSessions: () => purgeSessions(db, locations),
    pruneMetrics: () => pruneMetrics(db),
    sweepWithdrawals: () => sweepWithdrawals(db, locations),
    confirm: CONFIRM,
    metricsDays: METRICS_DAYS,
    sessionCount: locations.length
  });
  /* Explicit, and the last statement: firebase-admin holds the event loop
   * open, so returning would hang the job until its timeout. 3 is distinct
   * from 1 (errors) and 2 (fatal/misconfig), so the workflow log and any
   * future alerting can tell "refused on purpose" from "broke". What 3 does
   * NOT say is that nothing else went wrong: a blocked run whose metrics pass
   * also failed still exits 3, with the failures in the Summary count. */
  process.exit(outcome.exitCode);
}

/* The session pass. runCleanupPasses() skips it WHOLE when the backup gate
   blocks, so it must stay the only place a session is deleted from. */
async function purgeSessions(db, locations) {
  /* One clock for the whole pass, so two sessions with the same dates cannot
     get different verdicts because the loop took a while to reach the second. */
  const now = Date.now();
  let futureDated = 0;
  let kept = 0, purged = 0, errors = 0;
  let requestsKept = 0;
  /* One path per session that is KEPT, each set to null — see the write after
     the loop. */
  const legacyResetFlags = {};

  /* Something under `sessions/orgs`. That key is the organisation subtree's
     name in every tree outside `sessions/`, so the enumerator builds no
     location for it (lib/session-trees.js) and nothing here will touch it or
     its would-be siblings. It is not a session; the rules refuse to create it;
     so its presence is somebody trying, or data from before the rule. Either
     way it wants a person, which is why the run is marked failed. */
  if (locations.reservedSkipped) {
    errors++;
    console.error("ERROR    a node sits under the reserved key `orgs` in sessions/. It is " +
      "not a session and was NOT purged; none of the organisation trees were touched. " +
      "Look at it, then remove sessions/orgs by hand.");
  }

  for (const loc of locations) {
    const label = safeLabel(loc, QUIET);
    try {
      // Fetch only the lifecycle markers, not the whole session tree
      const [createdSnap, closedSnap] = await Promise.all([
        db.ref(`${loc.path}/created/at`).once("value"),
        db.ref(`${loc.path}/closed/at`).once("value")
      ]);
      const createdAt = createdSnap.val();
      const closedAt = closedSnap.val();

      /* The decision is NOT made here. Both dates are whatever a client wrote,
         and until 2026-10-07 this block compared them with a cutoff and never
         asked whether they could be true — so a session dated in the future
         was "within retention" until that date, and its creator could keep it
         for as long as they liked. lib/session-retention.js decides, and
         treats a date later than now as due. Its reason carries ages only;
         the session code is added, or not, on the line below. */
      const decision = sessionRetentionVerdict({
        createdAt, closedAt, now, closedDays: CLOSED_DAYS, openDays: OPEN_DAYS
      });
      const verdict = decision.purge ? "PURGE" : "KEEP";
      const reason = decision.reason;
      if (decision.futureDated) futureDated++;

      const tag = (verdict === "PURGE")
        ? (CONFIRM ? "PURGE   " : "DRY-RUN ")
        : "KEEP    ";
      if (!QUIET) console.log(`${tag} ${loc.key}  ${reason}`);

      if (verdict === "PURGE" && CONFIRM) {
        /* ONE ATOMIC MULTI-PATH UPDATE, not five sequential removes.
         *
         * The session subtree and its four out-of-cascade siblings used to be
         * deleted one after another, with `sessions/<code>` going FIRST. That
         * ordering is unrecoverable if any later delete fails: the session is
         * already gone, so the next run's enumeration — which walks `sessions`
         * and `orgs` — cannot rediscover it, and the surviving sibling is
         * orphaned permanently with nothing left pointing at it. The roster is
         * the worst one to strand, because it holds names and emails.
         *
         * An RTDB update() with null values applies every path or none, so a
         * failure leaves the session in place and the NEXT run retries the
         * whole set. Paths are absolute from the root, which is why they are
         * passed as one object rather than as refs.
         *
         * NB this does not reach rosters orphaned BEFORE 2026-08-21, when
         * nothing deleted them at all — their sessions are already gone, so no
         * enumeration can find them. That backfill is an operator task; this
         * change only stops the population growing. */
        const purge = {};
        purge[loc.path] = null;
        // The session's admin secret lives OUTSIDE its subtree, so removing the
        // session left adminSecrets/<code> (the real PBKDF2 hash + proof
        // writes) behind forever — nothing else purges it.
        purge[loc.adminSecretPath] = null;
        // The recovery code (recovery/<session path>): the secret the reset
        // rule compares against when a facilitator has forgotten the admin
        // password. Written at creation OUTSIDE the session subtree, and from
        // 2026-05-25, when it was introduced, until the fix of 2026-10-07
        // nothing deleted it — no script referenced the tree at all. Unlike
        // the other leftovers it is not inert. The node is write-once, so a
        // session that later draws the same code has its own recovery write
        // refused and its creation stops half-way; and the old code goes on
        // satisfying the reset rule at that session code, for whoever wrote it
        // down. Both measured: tests-e2e/emulator/recovery-purge.spec.js. It
        // goes in the same update as the hash it resets.
        //
        // NB records orphaned BEFORE this line existed are out of reach from
        // here — their sessions are gone, and this loop walks sessions. That
        // backlog is scripts/sweep-orphaned-recovery.js, a one-off.
        purge[loc.recoveryPath] = null;
        // Same story for the Module A chat: it was moved out of the session
        // read-cascade into the top-level roomChat/ tree (RTDB .read cascades
        // and cannot be revoked deeper, so a room-scoped rule under the session
        // restricted nothing). It is the most sensitive free text we hold, so
        // it must not outlive its session. A no-op on deployments that predate
        // the move.
        purge[loc.roomChatPath] = null;
        // The chat's author index (roomChatAuthors/<code>), added so a
        // participant's turns can be erased individually. Same clock as the
        // chat it indexes — leaving it behind would keep a map of who said
        // what after the words themselves were deleted, which is the worse
        // half to retain.
        purge[loc.roomChatAuthorsPath] = null;
        // ⚠️ Withdrawal records (withdrawals/<code>/<uid>) — ALL BUT ONE KIND.
        // A record keeps a participant out of the research export, and the
        // export only ever reads LIVE sessions, so once the session is gone
        // that protects nothing and the record is just a retained fact about
        // a person: it goes. But a record with `erasure: true` is also a
        // REQUEST with a legal time limit, and until 2026-10-07 this line
        // deleted the whole branch — so a request nobody had answered was
        // removed with its session, usually before the monitor's 30 days were
        // up and always without an erasure record. An unanswered request now
        // STAYS, where the monitor keeps counting it; everything else goes as
        // before. See lib/withdrawal-retention.js for the measured cases.
        //
        // The branch is read here, inside the try: if it cannot be read the
        // session is not purged tonight (the update is all-or-nothing) rather
        // than purged blind. NB `erasures/` itself is never deleted from — it
        // must OUTLIVE the snapshots it suppresses.
        const byUid = (await db.ref(loc.withdrawalsPath).once("value")).val();
        const records = planPurgedSessionWithdrawals(
          byUid, loc.key, holdsErasureRequest(byUid) ? await answeredRequests(db) : new Map());
        for (const uid of records.deleteUids) purge[`${loc.withdrawalsPath}/${uid}`] = null;
        // Certificate-id map (certIds/<code>): another out-of-cascade top-level
        // tree, so it needs the same explicit purge or it orphans a map of
        // published cert ids after its session is gone. A no-op on deployments
        // predating certIds.
        purge[loc.certIdsPath] = null;
        // Participant roster (rosters/<session path>/<uid>): name, email and
        // university, i.e. the most directly identifying data we hold — and
        // until 2026-08-21 NOTHING deleted it. No script referenced rosters at
        // all, so every participant name ever captured outlived its session
        // indefinitely (Annex VI item G5, GDPR Art. 5(1)(e)).
        //
        // It belongs on the SESSION clock, not the certificate clock: a
        // certificate is verified by hashing the name the VERIFIER types
        // (verify.js calls credentialNameHash(name, cred.session)), so nothing
        // in verification reads the roster. Keeping it for the sake of the
        // certificate would retain names for five years for no functional
        // reason.
        purge[loc.rosterPath] = null;
        // The one thing this update WRITES: a marker that the session existed
        // and when it was purged (purgedSessions/<code> = epoch ms). A code and
        // a date — no participant, no content. Once the session is gone,
        // nothing else in the database tells a purged session from a code that
        // never was, and three things need to: the rule that lets someone
        // withdraw from a session after it has been purged, the erasure tool
        // (which must not write a permanent suppression record for a session
        // that never existed), and sweepWithdrawals() (which deletes a
        // withdrawal record only where a marker shows its session was purged).
        // In the SAME update as the deletions, so there is never a purged
        // session without one. See purgedMarkers() in lib/session-trees.js.
        //
        // ONLY FOR A SESSION THAT HAD A TIMESTAMP. A node with neither
        // `created/at` nor `closed/at` is purged defensively above, but it is
        // not evidence of a session: any signed-in visitor can write
        // `sessions/<any code>/members/<own uid>` without the session ever
        // having been created. A marker for that would be this job certifying
        // a made-up code.
        if (hadSessionTimestamp(createdAt, closedAt)) {
          purge[loc.purgedMarkerPath] = Date.now();
        }

        await db.ref().update(purge);
        requestsKept += records.keptUids.length;
      }
      if (verdict === "PURGE") purged++;
      else {
        kept++;
        legacyResetFlags[legacyResetFlagPath(loc)] = null;
      }
    } catch (e) {
      errors++;
      // In QUIET mode (public-repo logs are world-readable) avoid printing the
      // raw e.message too: some firebase-admin errors embed the node path,
      // which includes the session code. Use the error code only.
      console.error(`ERROR    ${label}  ${QUIET ? (e && e.code ? e.code : "error") : (e && e.message)}`);
    }
  }
  /* A COUNT, never which. With CLEANUP_QUIET=1 the per-session lines are not
     printed at all, so this is the only trace the scheduled job leaves that it
     purged something for an impossible date rather than for its age — and the
     only thing a dry run can show an operator before the first live one. Not
     an error: the session is dealt with, and a red run every night that
     somebody creates one would be an alert anyone could switch on. */
  if (futureDated > 0) {
    console.log("");
    console.log(`Dated in the future: ${futureDated} session(s) carried a created or closed date ` +
      `more than ${FUTURE_DATE_TOLERANCE_MS / (60 * 60 * 1000)}h ahead of this run. No session can ` +
      `have one, so each was treated as due and ${CONFIRM ? "purged" : "would be purged"} ` +
      "(counted in the summary below).");
  }

  /* LEFTOVER RESET FLAGS — deleted BLIND, and that is the design.
   *
   * Until the flag moved to the unreadable adminSecrets tree, opening a
   * password reset wrote the session's RECOVERY CODE, in clear, to a node
   * inside the session — one every member of the session can read — and
   * removed it a moment later (lib/reset-flag.js has the whole story). A
   * removal that failed left the code lying there. The rules no longer let
   * any client write that node, so whatever is in it is a leftover BY
   * DEFINITION, and no date is needed to decide: a null is written to that
   * path for every session this run kept (a purged one has lost its whole
   * subtree already).
   *
   * A run the backup gate refuses does not get here — the whole session pass
   * is skipped — so it clears nothing; the next run that is let through does.
   *
   * NOTHING IS READ. The participant notice says what the scheduled jobs read
   * per session — the identifiers, and the two dates that decide when it is
   * deleted — and a third value read here would make that sentence incomplete
   * (tests/ops-transfer-notice.test.js derives its obligations from what these
   * scripts read). So the count below is of paths WRITTEN, one per kept
   * session. How many held a flag is not known, and is not meant to be.
   *
   * Its OWN update, after the loop, so that a failure here cannot stop or undo
   * a purge. A dry run writes nothing. A null for a path that does not exist is
   * a no-op the database accepts. */
  const legacyPaths = Object.keys(legacyResetFlags);
  if (legacyPaths.length > 0) {
    let cleared = false;
    if (CONFIRM) {
      try {
        await db.ref().update(legacyResetFlags);
        cleared = true;
      } catch (e) {
        errors++;
        // The code only: the message can embed a path, and the path is a session code.
        console.error("ERROR    leftover reset flags were not cleared: " + (e && e.code ? e.code : "error"));
      }
    }
    if (cleared || !CONFIRM) {
      console.log("");
      console.log(`Leftover reset flags: ${CONFIRM ? "cleared" : "would clear"} ${legacyPaths.length} ` +
        "path(s), one per session kept — written blind, nothing read.");
    }
  }

  if (requestsKept > 0) {
    /* A count, never whose. These are now the data-rights monitor's to chase. */
    console.log("");
    console.log(`Erasure requests kept past their session: ${requestsKept} ` +
      "(unanswered — see scripts/data-rights-monitor.js).");
  }

  return { kept, purged, errors: errors + takeLedgerErrors() };
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
