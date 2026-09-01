#!/usr/bin/env node
/* Firebase Spark-plan cost / quota monitor.
 *
 * Reads /sessions via the existing service-account credential, estimates
 * the platform's usage against the Spark plan's hard caps, and exits
 * non-zero if any cap is above 80%. The GitHub workflow that calls this
 * is scheduled daily; a failure pushes an email to the operator.
 *
 * What we measure, WITHOUT reading a single session body (2026-09-01):
 *   - Session COUNT: enumerated by key over RTDB REST `?shallow=true`
 *   - Recent activity + open sessions: `created/at` and `closed/at` per
 *     session, and nothing else
 *
 * What we CANNOT measure on Spark:
 *   - Live concurrent connections (only viewable in Firebase Console)
 *   - Bandwidth used in the current month (only in Console)
 *   - Hosting transfer (only in Console)
 *   - RTDB STORAGE BYTES, as of 2026-09-01 — see below
 *
 * ⚠️ WHY STORAGE IS NO LONGER MEASURED BY DEFAULT. Serialised size cannot be
 * obtained without transferring the data: RTDB exposes no size API, so the only
 * way to weigh the tree is to read all of it. This job runs on GitHub Actions in
 * the United States, so measuring it meant copying every participant name,
 * answer and free-text chat turn onto a US runner, daily, to produce one
 * number. That number was 32.3 KB against a 1 GB cap — 0.003%, four orders of
 * magnitude from the threshold it guards, and retention already bounds growth
 * at 90 days. The measurement cost far more than it bought (GDPR Art. 5(1)(c)).
 *
 * It is not deleted: COST_MONITOR_MEASURE_SIZE=1 performs the deep read for an
 * operator who wants the number. The daily run instead applies a content-free
 * tripwire on session COUNT (COST_MONITOR_MAX_SESSIONS), which is the same
 * early warning one cap removed, and reports storage the way this script
 * already reports the other three caps it cannot see: go and look in the
 * Console.
 *
 * For the un-measurable items we just log the caps so the operator
 * remembers what to watch in the Firebase Console.
 *
 * Env vars (same as backup-sessions.js):
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON file
 *   FIREBASE_DATABASE_URL           the RTDB URL
 *   COST_MONITOR_MEASURE_SIZE       "1" to deep-read and weigh /sessions
 *   COST_MONITOR_MAX_SESSIONS       count tripwire (default 5000)
 *
 * Exit codes:
 *   0 — all measurable usage under 80% of caps
 *   1 — at least one cap above 80% (warning)
 *   2 — infrastructure failure (auth, network)
 */

"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { readSessionLocationsShallow, readSessionLocations } = require("./lib/session-trees");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";

// Spark plan caps (as of 2026; check Firebase pricing page periodically)
const SPARK_CAPS = {
  rtdb_storage_gb: 1,           // hard cap
  rtdb_simultaneous_conn: 100,  // not directly measurable here
  rtdb_egress_gb_month: 10,     // not directly measurable here
  hosting_transfer_gb_month: 10,// not directly measurable here
  hosting_storage_gb: 1         // not directly measurable here
};

const WARN_THRESHOLD = 0.80;    // 80% of any cap triggers exit 1

const MEASURE_SIZE = process.env.COST_MONITOR_MEASURE_SIZE === "1";

/* Content-free stand-in for the storage alarm. The arithmetic, so the number is
 * arguable rather than magic: /sessions measured 32.3 KB across 4 sessions on
 * 2026-08-31, i.e. ~8 KB each, so 80% of the 1 GB cap is on the order of 100,000
 * sessions. A tripwire at 5,000 fires around 40 MB — roughly 4% of the cap and
 * a thousand times current usage. It is meant to catch runaway growth or a
 * retention job that has quietly stopped, not to approximate the cap. */
const MAX_SESSIONS = Number.parseInt(process.env.COST_MONITOR_MAX_SESSIONS || "5000", 10);

/* Two timestamps per session, in bounded batches. Sequentially this would be
 * 2N round trips; the purge gets away with that because it is already looping
 * per session, but here it is the whole job. 25 at a time keeps the RTDB
 * connection count well inside the Spark cap this script exists to watch. */
async function lifecycleMarkers(db, locations) {
  const out = [];
  const SIZE = 25;
  for (let i = 0; i < locations.length; i += SIZE) {
    const batch = locations.slice(i, i + SIZE);
    const rows = await Promise.all(batch.map(async (loc) => {
      const [createdSnap, closedSnap] = await Promise.all([
        db.ref(`${loc.path}/created/at`).once("value"),
        db.ref(`${loc.path}/closed/at`).once("value")
      ]);
      return { createdAt: createdSnap.val(), closedAt: closedSnap.val() };
    }));
    out.push(...rows);
  }
  return out;
}

async function main() {
  const app = initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("--- CaNaMED Spark-plan cost monitor ---");
  console.log("Database: " + DB_URL);
  console.log("Run time: " + new Date().toISOString());
  console.log("");

  /* Enumerate by key. Also covers the ORG tree, which this script silently
   * ignored until 2026-09-01 — it read `sessions` only, so every org-scoped
   * session was missing from the count and from the open-session alarm. */
  console.log("Enumeration: " + (MEASURE_SIZE
    ? "DEEP (COST_MONITOR_MEASURE_SIZE=1) — reads every session body"
    : "shallow — keys only, no session bodies leave the database"));
  const locations = MEASURE_SIZE
    ? await readSessionLocations(db)
    : await readSessionLocationsShallow({ app, databaseURL: DB_URL });
  const orgCount = locations.filter(l => l.orgSlug).length;

  let pctStorage = null;
  if (MEASURE_SIZE) {
    const bytes = Buffer.byteLength(
      JSON.stringify(Object.fromEntries(locations.map(l => [l.key, l.data]))), "utf8");
    pctStorage = bytes / (1024 * 1024 * 1024) / SPARK_CAPS.rtdb_storage_gb;
    console.log("Approx sessions size:  " + (bytes / 1024).toFixed(1) + " KB  (" +
      (pctStorage * 100).toFixed(2) + "% of 1 GB Spark cap)");
  }

  console.log("Sessions total:        " + locations.length +
    "  (" + (locations.length - orgCount) + " default, " + orgCount + " org-scoped)");

  /* `closed/at`, not the `closed` node: that node also carries `by`, the
   * facilitator's name. Reading the child keeps this job's exposure to two
   * numbers per session. It also matches how the purge decides the same
   * question, so the two cannot disagree about what "closed" means. */
  const markers = await lifecycleMarkers(db, locations);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let createdRecently = 0;
  let closedRecently = 0;
  for (const m of markers) {
    if (typeof m.createdAt === "number" && m.createdAt >= oneDayAgo) createdRecently++;
    if (typeof m.closedAt === "number" && m.closedAt >= oneDayAgo) closedRecently++;
  }
  console.log("Sessions created (last 24h): " + createdRecently);
  console.log("Sessions closed (last 24h):  " + closedRecently);

  const openCount = markers.filter(m => typeof m.closedAt !== "number").length;
  console.log("Open (not-closed) sessions:  " + openCount + "  (each session ≈ 0-30 connections; Spark cap = 100)");

  console.log("");
  console.log("--- Spark caps not directly measurable from the public API ---");
  console.log("- RTDB egress: " + SPARK_CAPS.rtdb_egress_gb_month + " GB/month — check Firebase Console > Realtime Database > Usage");
  console.log("- Hosting transfer: " + SPARK_CAPS.hosting_transfer_gb_month + " GB/month — check Firebase Console > Hosting > Usage");
  console.log("- Simultaneous DB connections: " + SPARK_CAPS.rtdb_simultaneous_conn + " — check Realtime Database > Usage > Connections");
  if (!MEASURE_SIZE) {
    console.log("- RTDB storage: " + SPARK_CAPS.rtdb_storage_gb +
      " GB — check Realtime Database > Usage > Storage. Not weighed here: sizing " +
      "the tree means reading it, and this job runs outside the EEA. Run with " +
      "COST_MONITOR_MEASURE_SIZE=1 for a one-off figure. Session count below is " +
      "the standing tripwire.");
  }
  console.log("");

  /* Content-free storage tripwire, in place of the byte measurement. */
  if (!MEASURE_SIZE && locations.length > MAX_SESSIONS) {
    console.error("WARN: " + locations.length + " sessions (tripwire " + MAX_SESSIONS +
      "). Storage is not weighed here — check Realtime Database > Usage > Storage, " +
      "and check that the retention purge is still running.");
    process.exit(1);
  }

  // Warn if storage > 80% of cap
  if (pctStorage !== null && pctStorage > WARN_THRESHOLD) {
    console.error("WARN: RTDB storage at " + (pctStorage * 100).toFixed(1) + "% of Spark cap. Cleanup or upgrade.");
    process.exit(1);
  }
  // Warn if too many open sessions (>= 80 = 80% of 100-connection cap if every session has 1 connection;
  // in practice each session has multiple, so this is a soft warning)
  if (openCount >= SPARK_CAPS.rtdb_simultaneous_conn * WARN_THRESHOLD) {
    console.error("WARN: " + openCount + " open sessions. Spark caps at " + SPARK_CAPS.rtdb_simultaneous_conn +
      " simultaneous connections; if any session has multiple tabs you may be exceeding the cap. Verify in Console.");
    process.exit(1);
  }
  console.log("OK — all measurable usage below " + (WARN_THRESHOLD * 100) + "% of Spark caps.");
  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(2);
});
