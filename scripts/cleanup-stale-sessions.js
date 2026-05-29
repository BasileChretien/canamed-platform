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
 *   CLEANUP_CONFIRM                 set to "1" to actually delete (otherwise just log)
 *   CLEANUP_QUIET                   set to "1" to suppress the per-session lines and
 *                                   emit only the summary. REQUIRED when the workflow
 *                                   runs on a PUBLIC repo, whose Actions logs are
 *                                   world-readable: a per-session line prints the
 *                                   session join-code, and codes of not-yet-expired
 *                                   ("KEEP") sessions could still be live/joinable.
 *
 * Output:
 *   one line per session in the report — KEEP / PURGE / DRY-RUN (unless CLEANUP_QUIET).
 *   exits non-zero only on infrastructure errors (auth fail, DB unreachable);
 *   "nothing to purge" is success.
 */

"use strict";

const admin = require("firebase-admin");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CLOSED_DAYS = parseInt(process.env.CLEANUP_RETENTION_CLOSED_DAYS || "30", 10);
const OPEN_DAYS = parseInt(process.env.CLEANUP_RETENTION_OPEN_DAYS || "90", 10);
const CONFIRM = process.env.CLEANUP_CONFIRM === "1";
const QUIET = process.env.CLEANUP_QUIET === "1";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const closedCutoff = Date.now() - CLOSED_DAYS * MS_PER_DAY;
const openCutoff = Date.now() - OPEN_DAYS * MS_PER_DAY;

function fmtAge(ms) {
  const d = Math.round((Date.now() - ms) / MS_PER_DAY);
  return `${d}d ago`;
}

async function main() {
  // initializeApp picks up GOOGLE_APPLICATION_CREDENTIALS automatically
  admin.initializeApp({ databaseURL: DB_URL });
  const db = admin.database();

  console.log("--- CaNaMED session cleanup ---");
  console.log(`Database:    ${DB_URL}`);
  console.log(`Retention:   closed ≤ ${CLOSED_DAYS}d, abandoned-open ≤ ${OPEN_DAYS}d`);
  console.log(`Mode:        ${CONFIRM ? "LIVE — deletions WILL happen" : "DRY-RUN"}`);
  console.log("");

  // Shallow read of /sessions gives us just the keys, not the full subtree.
  const sessionsRef = db.ref("sessions");
  const shallow = await sessionsRef.once("value");
  const all = shallow.val() || {};
  const codes = Object.keys(all);
  console.log(`Found ${codes.length} sessions.`);

  let kept = 0, purged = 0, errors = 0;
  for (const code of codes) {
    try {
      // Fetch only the lifecycle markers, not the whole session tree
      const [createdSnap, closedSnap] = await Promise.all([
        db.ref(`sessions/${code}/created/at`).once("value"),
        db.ref(`sessions/${code}/closed/at`).once("value")
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
      if (!QUIET) console.log(`${tag} ${code}  ${reason}`);

      if (verdict === "PURGE" && CONFIRM) {
        await db.ref(`sessions/${code}`).remove();
      }
      if (verdict === "PURGE") purged++;
      else kept++;
    } catch (e) {
      errors++;
      console.error(`ERROR    ${QUIET ? "<redacted>" : code}  ${e.message}`);
    }
  }

  console.log("");
  console.log(`Summary: ${kept} kept, ${purged} ${CONFIRM ? "purged" : "would-purge"}, ${errors} errors.`);
  if (!CONFIRM && purged > 0) {
    console.log("(Set CLEANUP_CONFIRM=1 in the workflow env to actually delete.)");
  }
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
