#!/usr/bin/env node
/* Firebase Spark-plan cost / quota monitor.
 *
 * Reads /sessions via the existing service-account credential, estimates
 * the platform's usage against the Spark plan's hard caps, and exits
 * non-zero if any cap is above 80%. The GitHub workflow that calls this
 * is scheduled daily; a failure pushes an email to the operator.
 *
 * What we can measure on Spark (no billing API access):
 *   - Realtime Database STORAGE: deep-read /sessions, serialise, measure bytes
 *   - Session COUNT: a proxy for active state
 *   - Recent activity: sessions whose `created.at` is within the last 24h
 *
 * What we CANNOT measure on Spark:
 *   - Live concurrent connections (only viewable in Firebase Console)
 *   - Bandwidth used in the current month (only in Console)
 *   - Hosting transfer (only in Console)
 *
 * For the un-measurable items we just log the caps so the operator
 * remembers what to watch in the Firebase Console.
 *
 * Env vars (same as backup-sessions.js):
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON file
 *   FIREBASE_DATABASE_URL           the RTDB URL
 *
 * Exit codes:
 *   0 — all measurable usage under 80% of caps
 *   1 — at least one cap above 80% (warning)
 *   2 — infrastructure failure (auth, network)
 */

"use strict";

const admin = require("firebase-admin");

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

async function main() {
  admin.initializeApp({ databaseURL: DB_URL });
  const db = admin.database();

  console.log("--- CaNaMED Spark-plan cost monitor ---");
  console.log("Database: " + DB_URL);
  console.log("Run time: " + new Date().toISOString());
  console.log("");

  // Deep-read /sessions to measure storage footprint
  const snap = await db.ref("sessions").once("value");
  const sessions = snap.val() || {};
  const codes = Object.keys(sessions);

  const json = JSON.stringify(sessions);
  const bytes = Buffer.byteLength(json, "utf8");
  const gb = bytes / (1024 * 1024 * 1024);
  const pctStorage = gb / SPARK_CAPS.rtdb_storage_gb;

  console.log("Sessions in /sessions: " + codes.length);
  console.log("Approx /sessions size: " + (bytes / 1024).toFixed(1) + " KB  (" +
    (pctStorage * 100).toFixed(2) + "% of 1 GB Spark cap)");

  // Recent activity (last 24h) — proxy for inbound write load
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let createdRecently = 0;
  let closedRecently = 0;
  for (const code of codes) {
    const s = sessions[code] || {};
    if (s.created && typeof s.created.at === "number" && s.created.at >= oneDayAgo) createdRecently++;
    if (s.closed && typeof s.closed.at === "number" && s.closed.at >= oneDayAgo) closedRecently++;
  }
  console.log("Sessions created (last 24h): " + createdRecently);
  console.log("Sessions closed (last 24h):  " + closedRecently);

  // Open sessions (proxy for currently-attached connections — a closed
  // session typically has no live tabs)
  const openCount = codes.filter(c => !sessions[c].closed).length;
  console.log("Open (not-closed) sessions:  " + openCount + "  (each session ≈ 0-30 connections; Spark cap = 100)");

  console.log("");
  console.log("--- Spark caps not directly measurable from the public API ---");
  console.log("- RTDB egress: " + SPARK_CAPS.rtdb_egress_gb_month + " GB/month — check Firebase Console > Realtime Database > Usage");
  console.log("- Hosting transfer: " + SPARK_CAPS.hosting_transfer_gb_month + " GB/month — check Firebase Console > Hosting > Usage");
  console.log("- Simultaneous DB connections: " + SPARK_CAPS.rtdb_simultaneous_conn + " — check Realtime Database > Usage > Connections");
  console.log("");

  // Warn if storage > 80% of cap
  if (pctStorage > WARN_THRESHOLD) {
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
