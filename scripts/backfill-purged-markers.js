#!/usr/bin/env node
/* Give sessions that were purged BEFORE the purge wrote markers the marker
 * they would have had. Run by hand, once; not scheduled.
 *
 * WHY. Since 2026-10-07 the rule on `withdrawals/<code>/<uid>` accepts a record
 * only for a session that is in the database or that carries a purge marker
 * (`purgedSessions/<code>`, written by scripts/cleanup-stale-sessions.js in
 * the update that deletes the session). Every session purged before that date
 * has no marker, so a participant returning to withdraw from one — the route
 * the account dialog's history row exists for — would be refused, for a
 * session they really took part in.
 *
 * WHERE THE EVIDENCE COMES FROM. The nightly snapshots. A session a snapshot
 * holds and the database does not was purged, and nothing a participant can
 * write is involved in establishing that. The snapshots reach back 90 days,
 * which is also exactly as long as a suppression record for that session can
 * matter (it exists so a restore leaves the participant out). A session purged
 * longer ago than that gets no marker: no copy this platform could restore
 * still holds it, and a request about it is for the human contact.
 *
 * ⚠️ RUN IT BEFORE THE RULE IS DEPLOYED, or in the same hour. Between the
 * deploy and this run, withdrawals for already-purged sessions are refused.
 *
 * WHAT IT WRITES. `purgedSessions/<code>` (or `purgedSessions/orgs/<slug>/
 * <code>`) = the date of the LAST snapshot holding the session, epoch ms. That
 * is when the session was last known to exist — at most a night before it was
 * purged — and deliberately not "now". It never overwrites a marker and never
 * marks a session that is in the database.
 *
 * DRY RUN BY DEFAULT — set BACKFILL_CONFIRM=1 to write.
 *
 * USAGE (the files are the payloads scripts/backup-sessions.js writes)
 *   node scripts/backfill-purged-markers.js --file backup-A.json --file backup-B.json
 *   node scripts/backfill-purged-markers.js --file backup-A.json --list
 *   BACKFILL_CONFIRM=1 node scripts/backfill-purged-markers.js --file backup-A.json
 *
 * It prints counts. `--list` also prints the session codes — do not use it
 * anywhere a log is kept: a code is not something to publish.
 */

"use strict";

const fs = require("fs");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const {
  readSessionLocationsShallow, locationForKey, purgedMarkers,
} = require("./lib/session-trees");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.BACKFILL_CONFIRM === "1";

function parseArgs(argv) {
  const out = { files: [], list: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") out.files.push(argv[++i]);
    else if (argv[i] === "--list") out.list = true;
  }
  return out;
}

function initAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  return raw
    ? initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DB_URL })
    : initializeApp({ databaseURL: DB_URL });
}

/* A key the database could not hold, or that is not shaped like a location,
   is not a session: it came from a file, and a file can contain anything. */
function isLocationKey(key) {
  if (typeof key !== "string" || key === "") return false;
  const parts = key.split("/");
  if (!(parts.length === 1 || (parts.length === 3 && parts[0] === "orgs"))) return false;
  if (parts.some((p) => p === "" || /[.#$\[\]]/.test(p))) return false;
  return locationForKey(key).key === key;
}

/**
 * Read every snapshot file, or refuse the whole run. No marker is written from
 * a "good" file when another one could not be vouched for: a half-read set
 * dates markers by the wrong snapshot.
 *
 * @returns {{lastSeen: Object<string, number>, malformed: number}}
 */
function readSnapshots(files, now) {
  const lastSeen = {};
  let malformed = 0;
  for (const file of files) {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`cannot read ${file} as JSON`);
    }
    const sessions = payload && payload.sessions;
    if (sessions === null || typeof sessions !== "object" || Array.isArray(sessions)) {
      throw new Error(`${file} has no \`sessions\` object. This reads the payload ` +
        "scripts/backup-sessions.js writes, not a raw database export.");
    }
    const takenAt = Date.parse(payload.backupTakenAt);
    if (!Number.isFinite(takenAt) || takenAt > now) {
      throw new Error(`${file} carries no usable \`backupTakenAt\`. A marker is ` +
        "dated by the snapshot that shows the session; without a date in the " +
        "past there is nothing to date it by.");
    }
    for (const key of Object.keys(sessions)) {
      if (!isLocationKey(key)) { malformed++; continue; }
      if (!(key in lastSeen) || takenAt > lastSeen[key]) lastSeen[key] = takenAt;
    }
  }
  return { lastSeen, malformed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files.length || args.files.some((f) => !f)) {
    console.error("FATAL: give at least one --file <snapshot.json>.");
    return 2;
  }

  let snapshots;
  try {
    snapshots = readSnapshots(args.files, Date.now());
  } catch (e) {
    console.error("FATAL: " + e.message);
    console.error("Nothing was written.");
    return 2;
  }

  const app = initAdmin();
  const db = getDatabase();
  console.log(`Database: ${DB_URL}`);
  console.log(`Mode:     ${CONFIRM ? "LIVE — will write" : "DRY RUN (set BACKFILL_CONFIRM=1 to write)"}`);
  console.log("");

  /* KEYS ONLY for the sessions that exist — the same enumerator the purge
     uses. A failed listing throws: read as "no sessions", it would mark every
     live session in the snapshot as purged. */
  const live = new Set(
    (await readSessionLocationsShallow({ app, databaseURL: DB_URL })).map((loc) => loc.key));
  const markersSnap = await db.ref("purgedSessions").get();
  const marked = purgedMarkers(markersSnap.exists() ? markersSnap.val() : {});

  const updates = {};
  const toMark = [];
  let stillLive = 0, alreadyMarked = 0;
  for (const key of Object.keys(snapshots.lastSeen).sort()) {
    if (live.has(key)) { stillLive++; continue; }
    if (Object.prototype.hasOwnProperty.call(marked, key)) { alreadyMarked++; continue; }
    updates[locationForKey(key).purgedMarkerPath] = snapshots.lastSeen[key];
    toMark.push(key);
  }

  console.log(`Snapshot files read:          ${args.files.length}`);
  console.log(`Sessions named in them:       ${Object.keys(snapshots.lastSeen).length}`);
  console.log(`  still in the database:      ${stillLive}`);
  console.log(`  already marked:             ${alreadyMarked}`);
  console.log(`  to mark:                    ${toMark.length}`);
  if (snapshots.malformed) {
    console.log(`  not a session location:     ${snapshots.malformed} (skipped)`);
  }
  if (args.list) for (const key of toMark) console.log(`    ${key}`);
  console.log("");

  if (!toMark.length) {
    console.log("Nothing to mark.");
    return 0;
  }
  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with BACKFILL_CONFIRM=1.");
    return 0;
  }
  await db.ref().update(updates);
  console.log(`MARKED ${toMark.length} purged session(s).`);
  return 0;
}

/* Explicit exit: firebase-admin keeps the event loop alive, so returning would
   leave the process hanging. */
main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error("FATAL: " + (e && e.message)); process.exit(1); });
