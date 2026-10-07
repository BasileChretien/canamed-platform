#!/usr/bin/env node
/* Delete recovery records whose session no longer exists.
 *
 * A ONE-OFF, for a backlog the nightly purge cannot reach. Until the fix of
 * 2026-10-07, scripts/cleanup-stale-sessions.js deleted a session and left
 * its recovery code at `recovery/sessions/<code>` (or
 * `recovery/orgs/<slug>/sessions/<id>`). It deletes the code with the session
 * now, but it finds its work by walking sessions, and those sessions are
 * gone. scripts/lib/recovery-orphans.js has the reasoning and the one ordering
 * rule that keeps this safe.
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
 *   RECOVERY_SWEEP_ALLOW_EMPTY_DEFAULT_TREE
 *                                       "1" to proceed when the DEFAULT tree
 *                                       holds recovery records and lists no
 *                                       session — see below
 *   RECOVERY_SWEEP_ALLOW_EMPTY_ORG_TREES
 *                                       "1" to proceed when an ORG tree does.
 *                                       Separate on purpose: neither waives
 *                                       the other.
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
const {
  makeSweepReader, findOrphanedRecovery, deleteRecoveryRecords,
  describeBatchError, describeFatal
} = require("./lib/recovery-orphans");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.RECOVERY_SWEEP_CONFIRM === "1";
const ALLOW_EMPTY_DEFAULT = process.env.RECOVERY_SWEEP_ALLOW_EMPTY_DEFAULT_TREE === "1";
const ALLOW_EMPTY_ORGS = process.env.RECOVERY_SWEEP_ALLOW_EMPTY_ORG_TREES === "1";

async function main() {
  // initializeApp picks up GOOGLE_APPLICATION_CREDENTIALS automatically
  const app = initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("--- CaNaMED orphaned recovery-record sweep ---");
  console.log(`Database:    ${DB_URL}`);
  console.log(`Mode:        ${CONFIRM ? "LIVE — deletions WILL happen" : "DRY-RUN"}`);
  console.log("Reads:       keys only — no recovery code and no session body leaves the database");
  console.log("");

  const found = await findOrphanedRecovery(makeSweepReader({ app, databaseURL: DB_URL }));

  const emptyTrees = (found.emptyDefaultTree ? 1 : 0) + found.emptyOrgTrees;
  console.log(`Sessions in the database:   ${found.liveSessions}`);
  console.log(`Recovery records:           ${found.records}`);
  console.log(`  with a session (kept):    ${found.kept}`);
  console.log(`  with no session:          ${found.orphans.length} ` +
    `(${found.orphansDefault} default, ${found.orphansOrg} org-scoped)`);
  console.log(`Trees with records and NO session: ${emptyTrees} ` +
    `(default tree: ${found.emptyDefaultTree ? "yes" : "no"}; org trees: ${found.emptyOrgTrees})`);
  console.log("");

  if (found.orphans.length === 0) {
    console.log("Summary: nothing to sweep.");
    process.exit(0);
  }

  /* A TREE THAT LISTS NO SESSION MAKES EVERY RECORD IN IT LOOK ORPHANED —
   * including the record of every session that is in fact alive, if the list
   * is empty because something is wrong (the wrong database, a tree that moved)
   * rather than because there are no sessions. Losing a live session's record
   * is silent and permanent: its facilitator can no longer reset a forgotten
   * password. So an empty tree that still holds records stops the run, in
   * dry-run as well, and has to be asserted by the person running it.
   *
   * PER TREE, and that is the point. Counted over the whole database, one node
   * under any org — which a signed-in visitor can create — says "there are
   * sessions" for a default tree that listed none, and every default-tree
   * record is deleted without a word.
   *
   * AND ONE OVERRIDE PER KIND OF TREE, for the mirror reason. An org tree with
   * records and no session is ordinary (every session of that org has been
   * purged) and can also be made by a visitor: one record under a new slug in
   * recovery/orgs/. With a single switch, giving it for that org tree would
   * waive the default tree's guard in the same run — the guard would be off in
   * exactly the run where somebody had interfered. */
  const needDefault = found.emptyDefaultTree && !ALLOW_EMPTY_DEFAULT;
  const needOrgs = found.emptyOrgTrees > 0 && !ALLOW_EMPTY_ORGS;
  if (needDefault || needOrgs) {
    const blocked = (needDefault ? 1 : 0) + (needOrgs ? found.emptyOrgTrees : 0);
    const flags = [
      needDefault ? "RECOVERY_SWEEP_ALLOW_EMPTY_DEFAULT_TREE=1" : null,
      needOrgs ? "RECOVERY_SWEEP_ALLOW_EMPTY_ORG_TREES=1" : null
    ].filter(Boolean).join(" and ");
    console.error(`REFUSED: ${blocked} tree(s) hold recovery records and list no ` +
      "session at all, so every record in them looks orphaned. That is also what " +
      "the wrong database looks like. If it is the true state, run again with " +
      flags + ". Nothing was deleted.");
    process.exit(2);
  }

  if (!CONFIRM) {
    console.log(`Summary: ${found.orphans.length} would be deleted. ` +
      "Set RECOVERY_SWEEP_CONFIRM=1 to delete them.");
    process.exit(0);
  }

  const { deleted, failedBatches } = await deleteRecoveryRecords(db, found.orphans, {
    onError: (e, size) => console.error(describeBatchError(e, size))
  });

  console.log(`Summary: ${deleted} deleted, ${found.orphans.length - deleted} left` +
    (failedBatches ? ` (${failedBatches} batch(es) failed — run again).` : "."));
  /* Explicit, and the last statement: firebase-admin holds the event loop
   * open, so returning would hang the job until its timeout. */
  process.exit(failedBatches ? 1 : 0);
}

main().catch((e) => {
  /* The code or the name, never the message — see describeFatal(). To read the
   * whole error, run this locally, where the log is yours. */
  console.error(describeFatal(e));
  process.exit(2);
});
