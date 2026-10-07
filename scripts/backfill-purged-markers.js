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
 * holds, and that is not in the database any more, was purged. The snapshots
 * reach back 90 days, which is also exactly as long as a suppression record
 * for that session can matter (it exists so a restore leaves the participant
 * out). A session purged longer ago than that gets no marker: no copy this
 * platform could restore still holds it, and a request about it is for the
 * human contact.
 *
 * WHAT COUNTS AS A SESSION IN A SNAPSHOT. Only a node with a `created/at` or a
 * `closed/at` — the purge's own criterion (session-trees.js,
 * `bodyWasSession`). A snapshot is a copy of everything under `sessions/`,
 * and that includes what a visitor can write: any signed-in visitor may put
 * their own membership row under a code nobody ever created. Such a node is
 * in the snapshot, the purge removes it WITHOUT leaving a marker, and this
 * script must not then hand it one. (Until 2026-10-07 it marked every key it
 * found.) Nothing here makes a visitor's writes impossible: creating a session
 * is one write, open to any signed-in visitor while the facilitator gate is
 * off — and a session a visitor created is a session, which the purge marks
 * too. The criterion is the purge's, not a boundary.
 *
 * WHAT COUNTS AS "STILL IN THE DATABASE". Not a key in the listing. The same
 * visitor write, or a new session under a code that became free, puts
 * something under a purged session's code — and a session that is purged, with
 * something else under its code, must still get its marker: without one the
 * erasure tool treats a request about it as one about a live session, finds
 * nothing of the person's there, and lets it be dismissed. So for every code
 * that is both in a snapshot and in the database this reads three values of
 * what is there now — `created/at`, `closed/at`, `creatorUid`; two dates and an
 * account identifier, no session content — and counts the session as still
 * there only if it is THAT session (session-trees.js, `isSameSession`). If it
 * cannot read them, it stops and writes nothing.
 *
 * ⚠️ RUN IT BEFORE THE RULE IS DEPLOYED, or in the same hour. Between the
 * deploy and this run, withdrawals for already-purged sessions are refused.
 *
 * WHAT IT WRITES. `purgedSessions/<code>` (or `purgedSessions/orgs/<slug>/
 * <code>`) = the date of the LAST snapshot holding the session that is gone,
 * epoch ms. That is when it was last known to exist — at most a night before
 * it was purged — and deliberately not "now". It never overwrites a marker,
 * never marks a session that is itself still in the database, and never
 * touches what is under a code.
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
  sessionIdentity, isSameSession,
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
  /* A bare `orgs` is the organisation subtree's own name, never a session. */
  if (typeof key !== "string" || key === "" || key === "orgs") return false;
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
 * `seen` holds a key only if some snapshot shows it AS A SESSION, with one
 * entry per snapshot that does: which session it was (its identity) and when
 * that snapshot was taken. A code can have held more than one session over
 * the snapshots' 90 days, and a marker is dated by the last snapshot showing
 * a session that is gone — not by a later one showing what replaced it.
 * `named` is every well-formed key, session or not, so the run can say how
 * many it left unmarked and why.
 *
 * @returns {{seen: Object<string, Array<{identity: object, takenAt: number}>>,
 *            named: Set<string>, malformed: number}}
 */
function readSnapshots(files, now) {
  const seen = {};
  const named = new Set();
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
    /* A snapshot of ANOTHER database names sessions this one never held, and a
       marker here is a standing permission to record a request about one. The
       backup payload says which database it is of; it must be this one. */
    if (payload.databaseUrl !== DB_URL) {
      throw new Error(`${file} is a snapshot of ${payload.databaseUrl ? "another database" : "no stated database"}, ` +
        "not of the one this run is pointed at (FIREBASE_DATABASE_URL). Markers are " +
        "only made from a snapshot of the database they are written to.");
    }
    const takenAt = Date.parse(payload.backupTakenAt);
    if (!Number.isFinite(takenAt) || takenAt > now) {
      throw new Error(`${file} carries no usable \`backupTakenAt\`. A marker is ` +
        "dated by the snapshot that shows the session; without a date in the " +
        "past there is nothing to date it by.");
    }
    for (const key of Object.keys(sessions)) {
      if (!isLocationKey(key)) { malformed++; continue; }
      named.add(key);
      const identity = sessionIdentity(sessions[key]);
      if (!identity) continue;                       // never a session: the purge's test
      if (!Object.prototype.hasOwnProperty.call(seen, key)) seen[key] = [];
      seen[key].push({ identity, takenAt });
    }
  }
  return { seen, named, malformed };
}

/**
 * The three values that say WHICH session is under a code in the database
 * now. Two dates and an account identifier; no session content. A failed read
 * throws — "could not look" must never be taken for "nothing there", which
 * would mark a live session as purged, nor for "the same session", which
 * would leave a purged one without its marker.
 */
async function liveIdentity(db, key) {
  const base = locationForKey(key).path;
  const read = async (rel) => {
    const snap = await db.ref(`${base}/${rel}`).get();
    return snap.exists() ? snap.val() : null;
  };
  return {
    createdAt: await read("created/at"),
    closedAt: await read("closed/at"),
    creatorUid: await read("creatorUid"),
  };
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
  let stillLive = 0, alreadyMarked = 0, inUseAgain = 0;
  for (const key of Object.keys(snapshots.seen).sort()) {
    if (Object.prototype.hasOwnProperty.call(marked, key)) { alreadyMarked++; continue; }
    /* GONE = the sessions the snapshots show under this code that are not what
       the database holds there now. A key in the listing settles nothing: it
       may be a visitor's row, or another session altogether. */
    let gone = snapshots.seen[key];
    if (live.has(key)) {
      const now = await liveIdentity(db, key);
      gone = gone.filter((s) => !isSameSession(s.identity, now));
      if (!gone.length) { stillLive++; continue; }
      inUseAgain++;
    }
    updates[locationForKey(key).purgedMarkerPath] = Math.max(...gone.map((s) => s.takenAt));
    toMark.push(key);
  }

  console.log(`Snapshot files read:          ${args.files.length}`);
  const sessionCount = Object.keys(snapshots.seen).length;
  console.log(`Sessions held in them:        ${sessionCount}`);
  console.log(`  still in the database:      ${stillLive}`);
  console.log(`  already marked:             ${alreadyMarked}`);
  console.log(`  to mark:                    ${toMark.length}`);
  if (inUseAgain) {
    console.log(`    of which the code is in use again, by something else: ${inUseAgain}`);
  }
  /* Said, not swallowed: an operator who expected a marker for one of these
     should learn here that it was left out, and why. */
  const noTimestamp = snapshots.named.size - sessionCount;
  if (noTimestamp) {
    console.log(`Nodes with no timestamp, never a session: ${noTimestamp} (not marked)`);
  }
  if (snapshots.malformed) {
    console.log(`Keys that are not a session location:     ${snapshots.malformed} (skipped)`);
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
