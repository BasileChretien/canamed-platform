#!/usr/bin/env node
/* Give sessions that were purged BEFORE the purge wrote markers the marker
 * they would have had. Run by hand, once; not scheduled.
 *
 * WHY. The rule on `withdrawals/<code>/<uid>` can require that the record name
 * a session that is in the database or that carries a purge marker
 * (`purgedSessions/<code>`, written by scripts/cleanup-stale-sessions.js in
 * the update that deletes the session). Every session purged before the purge
 * wrote markers (2026-10-07) has none, so a participant returning to withdraw
 * from one — the route the account dialog's history row exists for — would be
 * refused, for a session they really took part in.
 *
 * ⚠️ THIS SCRIPT IS ALSO THE SWITCH. That requirement is OFF until this script
 * has been run with BACKFILL_CONFIRM=1: the rule applies it only once
 * `ops/purgedMarkersBackfilledAt` exists, and a confirmed run writes that node
 * in the same update as the markers (session-trees.js,
 * `PURGED_MARKERS_BACKFILLED_PATH`). Until then a withdrawal is accepted for
 * any code, as it was before, and `erase-participant.js --dismiss` refuses to
 * run. So confirming a run is a decision about participants, not only about
 * markers, and it is the operator's:
 *   - a session purged before the OLDEST snapshot you give it gets no marker,
 *     and its participants are refused from then on — for good, unless a
 *     later run is given a snapshot that still holds it;
 *   - the snapshots are kept 90 days, so a session purged more than 90 days
 *     before the run can never be marked.
 * The dry run prints the oldest snapshot's date. Give it every snapshot the
 * archive still holds. Nothing turns the requirement off again short of
 * deleting that node by hand.
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
 * WHEN. Any time after the rules that read the switch are deployed; nothing
 * breaks while it has not been run. Sooner is better only because the
 * snapshots age out: each day of waiting is a day's worth of long-purged
 * sessions that can no longer be marked.
 *
 * WHAT IT WRITES. `purgedSessions/<code>` (or `purgedSessions/orgs/<slug>/
 * <code>`) = the date of the LAST snapshot holding the session that is gone,
 * epoch ms. That is when it was last known to exist — at most a night before
 * it was purged — and deliberately not "now". It never overwrites a marker,
 * never marks a session that is itself still in the database, and never
 * touches what is under a code. And, once, `ops/purgedMarkersBackfilledAt` =
 * the time of the run (see above): written on the first confirmed run, with
 * the markers or alone if there is nothing to mark, and never rewritten.
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
  sessionIdentity, isSameSession, PURGED_MARKERS_BACKFILLED_PATH,
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
 *            named: Set<string>, malformed: number, oldest: number, newest: number}}
 *   `oldest` / `newest`: when the first and the last of the snapshots were
 *   taken. A session purged before the oldest is in none of them.
 */
function readSnapshots(files, now) {
  const seen = {};
  const named = new Set();
  let malformed = 0;
  let oldest = Infinity, newest = -Infinity;
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
    oldest = Math.min(oldest, takenAt);
    newest = Math.max(newest, takenAt);
    for (const key of Object.keys(sessions)) {
      if (!isLocationKey(key)) { malformed++; continue; }
      named.add(key);
      const identity = sessionIdentity(sessions[key]);
      if (!identity) continue;                       // never a session: the purge's test
      if (!Object.prototype.hasOwnProperty.call(seen, key)) seen[key] = [];
      seen[key].push({ identity, takenAt });
    }
  }
  return { seen, named, malformed, oldest, newest };
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
  /* THE SWITCH. A failed read throws: taken for "off", this run would write a
     new date over the one that says when the refusals began; taken for "on",
     it would never turn the rule on. */
  const switchSnap = await db.ref(PURGED_MARKERS_BACKFILLED_PATH).get();
  const alreadyOn = switchSnap.exists();

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
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  console.log(`Snapshots span:               ${day(snapshots.oldest)} … ${day(snapshots.newest)}`);
  console.log("");

  /* The switch goes in the SAME update as the markers, and only if it is not
     already there: its date is when the refusals began. */
  const turnsOn = !alreadyOn;
  if (turnsOn) updates[PURGED_MARKERS_BACKFILLED_PATH] = Date.now();

  if (alreadyOn) {
    console.log(`Strict withdrawal rule:       already ON, since ${new Date(Number(switchSnap.val())).toISOString()} (left as it is)`);
  } else {
    console.log(`Strict withdrawal rule:       ${CONFIRM ? "ON, as of this run" : "OFF — this run, confirmed, turns it ON"}`);
    console.log("  ON means: a withdrawal or erasure request is accepted only for a " +
                "session that is in the database or carries a purge marker. A " +
                `session purged before ${day(snapshots.oldest)}, the oldest snapshot given ` +
                "here, is in none of these files and gets no marker: its " +
                "participants are refused from then on, with \"Could not record " +
                "your withdrawal\", unless a later run is given a snapshot that " +
                "holds it. Give this every snapshot the archive still has. " +
                "Confirming is your decision that this is acceptable; nothing " +
                "but deleting " + PURGED_MARKERS_BACKFILLED_PATH + " by hand turns it off again.");
  }
  console.log("");

  if (!toMark.length && !turnsOn) {
    console.log("Nothing to mark.");
    return 0;
  }
  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with BACKFILL_CONFIRM=1.");
    return 0;
  }
  await db.ref().update(updates);
  if (toMark.length) console.log(`MARKED ${toMark.length} purged session(s).`);
  else console.log("Nothing to mark.");
  if (turnsOn) console.log("The strict withdrawal rule is ON.");
  return 0;
}

/* Explicit exit: firebase-admin keeps the event loop alive, so returning would
   leave the process hanging. */
main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error("FATAL: " + (e && e.message)); process.exit(1); });
