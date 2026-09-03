#!/usr/bin/env node
/* Restore /sessions from a nightly archive, applying every erasure that has
 * happened since the snapshot was taken.
 *
 * TWO REASONS THIS EXISTS, and the second is the one that made it urgent.
 *
 * 1. A backup nobody has ever restored from is a hypothesis, not a backup.
 *    `scripts/backup-sessions.js` has been writing nightly objects since
 *    2026-05-30 and nothing has ever read one back.
 *
 * 2. Erasure. `scripts/erase-participant.js` deletes a participant from the
 *    live tree, but up to 90 snapshots still hold them
 *    (`scripts/ops/pii-bucket-lifecycle.json`). The notice tells participants
 *    those copies are never selectively restored and expire on their own cycle
 *    (PIS v10). Before this script that was a promise with NOTHING TO ATTACH A
 *    MECHANISM TO — there was no restore path, so there was also no place to
 *    enforce the promise. Now there is exactly one, and it applies the
 *    suppression list before it writes a byte.
 *
 * IT REFUSES TO RUN rather than restore without suppression. A restore that
 * silently skips the list would resurrect erased people, which is worse than no
 * restore at all: the erasure has already been reported as done to the person
 * who asked for it.
 *
 * DRY RUN BY DEFAULT — set RESTORE_CONFIRM=1 to write.
 *
 * USAGE
 *   node scripts/restore-sessions.js --file backup-2026-09-01.json
 *   node scripts/restore-sessions.js --file b.json --session <locationKey>
 *   RESTORE_CONFIRM=1 node scripts/restore-sessions.js --file b.json
 */

"use strict";

const fs = require("fs");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const { applySuppression } = require("./lib/suppression");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.RESTORE_CONFIRM === "1";

function parseArgs(argv) {
  const out = { file: null, session: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") out.file = argv[++i];
    else if (argv[i] === "--session") out.session = argv[++i];
  }
  return out;
}

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DB_URL });
  else initializeApp({ databaseURL: DB_URL });
}

/** Flatten `erasures/<pushId>.records[]` into one list. */
function collectRecords(node) {
  const out = [];
  for (const id of Object.keys(node || {})) {
    const entry = node[id];
    if (!entry || typeof entry !== "object") continue;
    for (const rec of entry.records || []) out.push(rec);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("FATAL: --file <archive.json> is required.");
    process.exit(2);
  }

  const payload = JSON.parse(fs.readFileSync(args.file, "utf8"));
  if (!payload || typeof payload.sessions !== "object" || payload.sessions === null) {
    console.error("FATAL: that file has no `sessions` object. This script reads " +
                  "the payload scripts/backup-sessions.js writes, not a raw " +
                  "database export.");
    process.exit(2);
  }

  initAdmin();
  const db = getDatabase();

  console.log(`Archive:  ${args.file} (taken ${payload.backupTakenAt || "unknown"})`);
  console.log(`Database: ${DB_URL}`);
  console.log(`Mode:     ${CONFIRM ? "LIVE — will write" : "DRY RUN (set RESTORE_CONFIRM=1 to write)"}`);
  console.log("");

  /* Read the suppression list BEFORE anything else, and abort if it cannot be
     read. An unreadable list is indistinguishable from an empty one, and
     guessing "empty" here restores people who asked to be erased. */
  let records;
  try {
    const snap = await db.ref("erasures").get();
    records = collectRecords(snap.exists() ? snap.val() : {});
  } catch (e) {
    console.error("FATAL: could not read the suppression list at `erasures` — " +
                  (e && e.message));
    console.error("Refusing to restore. An unreadable list looks exactly like an " +
                  "empty one, and restoring on that assumption would resurrect " +
                  "participants whose erasure has already been reported as done.");
    process.exit(3);
  }

  console.log(`Suppression list: ${records.length} record(s).`);
  const { payload: clean, applied, skipped } = applySuppression(payload, records);

  const removed = applied.reduce((n, a) => n + a.removed, 0);
  console.log(`Applied to this archive: ${applied.length} record(s), ${removed} path(s) removed.`);
  for (const a of applied) {
    console.log(`  ${a.locationKey}: ${a.removed} path(s) — uid=${a.identity.uid || "-"}`);
  }
  if (skipped.length) {
    console.log(`Not applicable to this archive: ${skipped.length} record(s) ` +
                "(their session is not in this snapshot).");
  }
  if (records.length && !applied.length) {
    console.log("NOTE: the list is non-empty but nothing in it matched this " +
                "snapshot. That is expected for a snapshot older than every " +
                "erasure — but check it, because it is also what a wrong " +
                "location key looks like.");
  }
  console.log("");

  const keys = Object.keys(clean.sessions)
    .filter((k) => !args.session || k === args.session);
  if (!keys.length) {
    console.log("No sessions selected. Nothing to restore.");
    process.exit(0);
  }

  console.log(`Would restore ${keys.length} session(s):`);
  for (const k of keys) console.log(`  ${k}`);
  console.log("");

  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with RESTORE_CONFIRM=1.");
    process.exit(0);
  }

  /* The location key IS the path minus the tree prefix; rebuild it the same way
     session-trees does rather than parsing the key, so a restore cannot invent
     a path shape the rest of the system does not use. */
  const updates = {};
  for (const k of keys) {
    const isOrg = k.includes("/");
    const path = isOrg
      ? `orgs/${k.split("/")[0]}/sessions/${k.split("/").slice(1).join("/")}`
      : `sessions/${k}`;
    updates[path] = clean.sessions[k];
  }
  await db.ref().update(updates);
  console.log(`RESTORED ${keys.length} session(s), with ${removed} erased path(s) withheld.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FATAL: " + (e && e.message)); process.exit(1); });
