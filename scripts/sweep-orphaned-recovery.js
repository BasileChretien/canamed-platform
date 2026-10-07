#!/usr/bin/env node
/* Delete recovery records whose session no longer exists.
 *
 * A ONE-OFF, for a backlog the nightly purge cannot reach. Until 2026-10-08
 * scripts/cleanup-stale-sessions.js deleted a session and left its recovery
 * code at `recovery/sessions/<code>` (or `recovery/orgs/<slug>/sessions/<id>`).
 * It deletes the code with the session now, but it finds its work by walking
 * sessions, and those sessions are gone. scripts/lib/recovery-orphans.js has
 * the reasoning and the one ordering rule that keeps this safe.
 *
 * What a leftover record is, and why it is worth a sweep rather than a shrug:
 *   - a retained record that a session with that code existed, with no
 *     retention period (GDPR Art. 5(1)(e));
 *   - write-once, so a later session that draws the same code cannot store its
 *     own recovery code and its creation stops half-way;
 *   - a secret that still opens the password reset at that session code, for
 *     whoever kept it.
 * The last two were measured: tests-e2e/emulator/recovery-purge.spec.js.
 *
 * DRY-RUN BY DEFAULT. It reads KEYS ONLY (never a recovery code, never a
 * session body) and prints COUNTS ONLY — there is no verbose mode, because a
 * session code must not reach a world-readable Actions log and the operator
 * has no use for one here.
 *
 * Env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS      path to the service-account JSON
 *   FIREBASE_DATABASE_URL               the RTDB URL (with region suffix)
 *   RECOVERY_SWEEP_CONFIRM              "1" to actually delete (otherwise report)
 *   RECOVERY_SWEEP_ALLOW_NO_SESSIONS    "1" to proceed when the database lists
 *                                       NO session at all — see below
 *
 * Exit codes:
 *   0  clean: nothing to do, a dry run, or everything found was deleted
 *   1  a batch could not be deleted (the rest were; run it again)
 *   2  refused to delete, or could not start (auth, unreachable, a read that
 *      did not return a key list)
 */

"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { makeRestShallowReader } = require("./lib/session-trees");
const { findOrphanedRecovery, deleteRecoveryRecords } = require("./lib/recovery-orphans");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.RECOVERY_SWEEP_CONFIRM === "1";
const ALLOW_NO_SESSIONS = process.env.RECOVERY_SWEEP_ALLOW_NO_SESSIONS === "1";

async function main() {
  // initializeApp picks up GOOGLE_APPLICATION_CREDENTIALS automatically
  const app = initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("--- CaNaMED orphaned recovery-record sweep ---");
  console.log(`Database:    ${DB_URL}`);
  console.log(`Mode:        ${CONFIRM ? "LIVE — deletions WILL happen" : "DRY-RUN"}`);
  console.log("Reads:       keys only — no recovery code and no session body leaves the database");
  console.log("");

  const found = await findOrphanedRecovery(makeRestShallowReader({ app, databaseURL: DB_URL }));

  console.log(`Sessions in the database:   ${found.liveSessions}`);
  console.log(`Recovery records:           ${found.records}`);
  console.log(`  with a session (kept):    ${found.kept}`);
  console.log(`  with no session:          ${found.orphans.length} ` +
    `(${found.orphansDefault} default, ${found.orphansOrg} org-scoped)`);
  console.log("");

  if (found.orphans.length === 0) {
    console.log("Summary: nothing to sweep.");
    process.exit(0);
  }

  /* AN EMPTY SESSION LIST MAKES EVERY RECORD LOOK ORPHANED — including the
   * record of every session that is in fact alive, if the list is empty because
   * something is wrong (the wrong database, a tree that moved) rather than
   * because there are no sessions. Losing a live session's record is silent and
   * permanent: its facilitator can no longer reset a forgotten password. So
   * "no sessions at all" stops the run, in dry-run as well, and has to be
   * asserted by the person running it. */
  if (found.liveSessions === 0 && !ALLOW_NO_SESSIONS) {
    console.error("REFUSED: the database lists no session at all, so every recovery " +
      "record looks orphaned. If that is really the state of the database, run " +
      "again with RECOVERY_SWEEP_ALLOW_NO_SESSIONS=1. Nothing was deleted.");
    process.exit(2);
  }

  if (!CONFIRM) {
    console.log(`Summary: ${found.orphans.length} would be deleted. ` +
      "Set RECOVERY_SWEEP_CONFIRM=1 to delete them.");
    process.exit(0);
  }

  const { deleted, failedBatches } = await deleteRecoveryRecords(db, found.orphans, {
    // The error CODE only: a firebase-admin message can embed the path, and
    // the path is a session code.
    onError: (e, size) => console.error(`ERROR    a batch of ${size} was not deleted: ` +
      (e && e.code ? e.code : "error"))
  });

  console.log(`Summary: ${deleted} deleted, ${found.orphans.length - deleted} left` +
    (failedBatches ? ` (${failedBatches} batch(es) failed — run again).` : "."));
  /* Explicit, and the last statement: firebase-admin holds the event loop
   * open, so returning would hang the job until its timeout. */
  process.exit(failedBatches ? 1 : 0);
}

main().catch((e) => {
  /* Safe to print: every path this script READS is a tree or an org slug
   * ("recovery/orgs/<slug>/sessions"), never a session code. The one call
   * whose error could name a code is the update, and that is caught above. */
  console.error("FATAL: " + ((e && e.code) || (e && e.message) || "error"));
  process.exit(2);
});
