#!/usr/bin/env node
/* Purge stale CaNaMED sessions from the live Realtime Database.
 *
 * GDPR Art. 5(1)(e) "storage limitation" + APPI Art. 21 require that
 * personal data isn't kept longer than needed for the purpose it was
 * collected. The privacy policy commits us to:
 *   - identified live + archive data    ≤ 30 days after session close
 *   - abandoned sessions (never closed) ≤ 90 days after creation
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
 * lives outside the session subtree and nothing else cleans up.
 *
 * Output:
 *   one line per session in the report — KEEP / PURGE / DRY-RUN (unless CLEANUP_QUIET).
 *   exits non-zero only on infrastructure errors (auth fail, DB unreachable);
 *   "nothing to purge" is success.
 */

"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const {
  readSessionLocations,
  readSessionLocationsShallow,
  safeLabel
} = require("./lib/session-trees");
const { pruneHfPatientMetrics } = require("./lib/metrics-retention");
const { parseRetentionDays } = require("./lib/retention-window");
const { readBackupMarker, backupGateReport } = require("./lib/backup-marker");

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
 * a second retention gap while trying to prevent a data-loss one. */
const REQUIRE_BACKUP = process.env.CLEANUP_REQUIRE_BACKUP === "1";
const BACKUP_MAX_AGE_DAYS = retentionDays("CLEANUP_BACKUP_MAX_AGE_DAYS", 2);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const closedCutoff = Date.now() - CLOSED_DAYS * MS_PER_DAY;
const openCutoff = Date.now() - OPEN_DAYS * MS_PER_DAY;
const metricsCutoff = Date.now() - METRICS_DAYS * MS_PER_DAY;

function fmtAge(ms) {
  const d = Math.round((Date.now() - ms) / MS_PER_DAY);
  return `${d}d ago`;
}

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
  if (gate.block) {
    /* Exit 3, distinct from 1 (per-session errors) and 2 (fatal/misconfig), so
     * the workflow log and any future alerting can tell "refused on purpose"
     * from "broke". Nothing has been deleted at this point. */
    console.error("BLOCKED: no sessions were purged.");
    process.exit(3);
  }
  console.log("");

  let kept = 0, purged = 0, errors = 0;
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

      // Sessions written before /created existed have no createdAt — treat
      // them as ancient and let the open-retention path purge them.
      let verdict = "KEEP";
      let reason = "";
      if (typeof closedAt === "number") {
        if (closedAt < closedCutoff) {
          verdict = "PURGE";
          reason = `closed ${fmtAge(closedAt)} (> ${CLOSED_DAYS}d)`;
        } else {
          reason = `closed ${fmtAge(closedAt)} (within retention)`;
        }
      } else if (typeof createdAt === "number") {
        if (createdAt < openCutoff) {
          verdict = "PURGE";
          reason = `abandoned, created ${fmtAge(createdAt)} (> ${OPEN_DAYS}d)`;
        } else {
          reason = `open, created ${fmtAge(createdAt)} (within retention)`;
        }
      } else {
        // No timestamps at all → very old or malformed → purge defensively
        verdict = "PURGE";
        reason = "no timestamps — likely pre-schema or corrupted";
      }

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
        // ⚠️ Withdrawal records (withdrawals/<code>/<uid>). These were added
        // on 2026-09-03 for GDPR Art. 7(3) and NOTHING purged them — a
        // retention gap introduced by that change and caught here. They
        // exist to keep a participant out of the research export, and the
        // export only ever reads LIVE sessions, so once the session is gone
        // the record protects nothing and is just a retained fact about a
        // person. NB this is the opposite of the `erasures/` suppression
        // records, which must OUTLIVE the snapshots they suppress and are
        // deliberately not purged here.
        purge[loc.withdrawalsPath] = null;
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

        await db.ref().update(purge);
      }
      if (verdict === "PURGE") purged++;
      else kept++;
    } catch (e) {
      errors++;
      // In QUIET mode (public-repo logs are world-readable) avoid printing the
      // raw e.message too: some firebase-admin errors embed the node path,
      // which includes the session code. Use the error code only.
      console.error(`ERROR    ${label}  ${QUIET ? (e && e.code ? e.code : "error") : (e && e.message)}`);
    }
  }

  // hfPatient metrics: uid-keyed rows with no session to hang retention off, so
  // they are pruned on their own clock rather than with the session that
  // produced them. Runs even when the session pass had errors — an unrelated
  // session failure must not silently skip a retention obligation.
  const m = await pruneMetrics(db);
  errors += m.errors;
  const verb = CONFIRM ? "purged" : "would-purge";
  console.log("");
  console.log(`Metrics (hfPatient, > ${METRICS_DAYS}d): ${verb} ` +
    `${m.events} events, ${m.usage} uid buckets, ${m.sessionUsage} session buckets, ` +
    `${m.dailyDays} daily counters, ${m.dailyUids} spent uid nodes. ` +
    "global/<day> aggregates kept (no identifier).");

  console.log("");
  console.log(`Summary: ${kept} kept, ${purged} ${CONFIRM ? "purged" : "would-purge"}, ${errors} errors.`);
  if (!CONFIRM && (purged > 0 || m.events + m.usage + m.sessionUsage + m.dailyDays + m.dailyUids > 0)) {
    console.log("(Set CLEANUP_CONFIRM=1 in the workflow env to actually delete.)");
  }
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
