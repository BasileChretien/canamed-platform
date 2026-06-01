#!/usr/bin/env node
/* Daily pseudonymised export of /sessions for research use.
 *
 * Pairs with backup-sessions.js: BACKUP keeps the identified copy under
 * artefact retention; this one produces a PSEUDONYMISED export plus a
 * linkage table, both as separate artefacts. The two artefacts have
 * different retention policies in the workflow so researchers can take
 * the pseudonymised file long-term and the linkage table is destroyed
 * earlier (matching the 6-month linkage-destruction commitment in the
 * privacy policy).
 *
 * The pseudonymisation transform lives in scripts/lib/pseudonymise.js (pure,
 * unit-tested). It: maps participant display names to Student-A/B/... codes
 * (collision-safe), REDACTS unknown names in name/by fields (e.g. facilitators,
 * who are never in the pool), DROPS free-text LLM chat turns + facilitator
 * transient fields (`_adminPresence`, `_superadminReset`) + the admin hash, and
 * BUCKETS the `university` quasi-identifier to Univ-N. See that file's header
 * for the full de-identification guarantees (hardened after the 2026-05-30
 * security review). Linkage table { sessionCode: { realName: pseudoCode } } is
 * written separately so researchers operate only on the pseudonymised export.
 *
 * Closed sessions only (active sessions could still receive writes that
 * would not be pseudonymised). Use the in-memory copy; don't mutate the
 * live database — researchers consume the export, not the DB.
 *
 * Env vars (same as backup-sessions.js):
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON file
 *   FIREBASE_DATABASE_URL           the RTDB URL
 *   EXPORT_OUT_DIR                  where to write outputs
 *   EXPORT_GCS_BUCKET               if set, upload BOTH files to this private
 *                                   GCS bucket (no gs:// prefix), so the job
 *                                   can run from the public repo without
 *                                   exposing PII via world-downloadable
 *                                   artifacts
 *   EXPORT_GCS_PSEUDO_PREFIX        bucket prefix for the pseudonymised file
 *                                   (default "pseudonymised") — give it a
 *                                   long (~90d) lifecycle rule
 *   EXPORT_GCS_LINKAGE_PREFIX       bucket prefix for the linkage table
 *                                   (default "linkage") — give it a SHORT
 *                                   (~14d) lifecycle rule; it re-identifies
 *                                   participants and must be destroyed early
 *   EXPORT_REQUIRE_GCS              set to "1" to FAIL when EXPORT_GCS_BUCKET
 *                                   is empty — used by the public-repo
 *                                   workflow so a misconfigured bucket gives a
 *                                   loud red run instead of an export that
 *                                   silently vanishes with the runner
 *
 * Outputs:
 *   $EXPORT_OUT_DIR/canamed-pseudonymised-YYYY-MM-DD.json
 *   $EXPORT_OUT_DIR/canamed-linkage-YYYY-MM-DD.json
 *
 * Exit codes:
 *   0 — success
 *   2 — infrastructure failure / misconfiguration
 */

"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { uploadToGcs } = require("./lib/gcs-archive");
const { pseudonymiseSession } = require("./lib/pseudonymise");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";

const OUT_DIR = process.env.EXPORT_OUT_DIR || process.env.RUNNER_TEMP || ".";

const GCS_BUCKET = process.env.EXPORT_GCS_BUCKET || "";
const GCS_PSEUDO_PREFIX = (process.env.EXPORT_GCS_PSEUDO_PREFIX || "pseudonymised").replace(/\/+$/, "");
const GCS_LINKAGE_PREFIX = (process.env.EXPORT_GCS_LINKAGE_PREFIX || "linkage").replace(/\/+$/, "");
const REQUIRE_GCS = process.env.EXPORT_REQUIRE_GCS === "1";

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  if (REQUIRE_GCS && !GCS_BUCKET) {
    console.error(
      "FATAL: EXPORT_REQUIRE_GCS=1 but EXPORT_GCS_BUCKET is empty.\n" +
      "       Set the PII_ARCHIVE_BUCKET repo variable to a PRIVATE GCS bucket.\n" +
      "       Refusing to run an export whose only copy would vanish with the runner."
    );
    process.exit(2);
  }

  admin.initializeApp({ databaseURL: DB_URL });
  const db = admin.database();

  console.log("--- CaNaMED daily pseudonymised export ---");
  console.log("Database:  " + DB_URL);
  console.log("Out dir:   " + OUT_DIR);
  console.log("GCS:       " + (GCS_BUCKET ? `gs://${GCS_BUCKET}/` : "(none — local artifact mode)"));
  console.log("Run time:  " + new Date().toISOString());
  console.log("");

  const snap = await db.ref("sessions").once("value");
  const sessions = snap.val() || {};
  const codes = Object.keys(sessions);

  // Only export CLOSED sessions (active ones could still receive writes
  // post-export, leaving the export stale)
  const closedCodes = codes.filter(c => sessions[c] && sessions[c].closed);
  const openCount = codes.length - closedCodes.length;
  console.log("Sessions total:       " + codes.length);
  console.log("Closed (exportable):  " + closedCodes.length);
  console.log("Open (skipped):       " + openCount);

  const linkage = {};
  const pseudonymised = {};
  for (const code of closedCodes) {
    pseudonymised[code] = pseudonymiseSession(sessions[code], code, linkage);
  }

  const pseudoPayload = {
    exportTakenAt: new Date().toISOString(),
    databaseUrl: DB_URL,
    sessionCount: closedCodes.length,
    sessions: pseudonymised,
    note: "Pseudonymised export. Participant names -> Student-A/B/... per session; " +
      "unknown names (facilitators) redacted; free-text LLM chat dropped; university " +
      "bucketed to Univ-N. See scripts/lib/pseudonymise.js for guarantees. Linkage " +
      "table is in a separate artefact with shorter retention (see workflow)."
  };
  const linkagePayload = {
    exportTakenAt: new Date().toISOString(),
    databaseUrl: DB_URL,
    sessionCount: closedCodes.length,
    linkage: linkage,
    note: "Real-name -> pseudonym mapping. SHORT-RETENTION. Used only to re-identify a participant " +
      "on request (e.g. GDPR Art. 17 erasure)."
  };

  const pseudoPath = path.join(OUT_DIR, "canamed-pseudonymised-" + isoDate() + ".json");
  const linkagePath = path.join(OUT_DIR, "canamed-linkage-" + isoDate() + ".json");

  fs.writeFileSync(pseudoPath, JSON.stringify(pseudoPayload, null, 2), "utf8");
  fs.writeFileSync(linkagePath, JSON.stringify(linkagePayload, null, 2), "utf8");

  const pseudoKb = (fs.statSync(pseudoPath).size / 1024).toFixed(1);
  const linkageKb = (fs.statSync(linkagePath).size / 1024).toFixed(1);
  console.log("Wrote " + pseudoPath + " (" + pseudoKb + " KB)");
  console.log("Wrote " + linkagePath + " (" + linkageKb + " KB)");

  if (GCS_BUCKET) {
    const pseudoUri = await uploadToGcs({
      bucket: GCS_BUCKET,
      localPath: pseudoPath,
      destination: GCS_PSEUDO_PREFIX + "/canamed-pseudonymised-" + isoDate() + ".json"
    });
    console.log("Uploaded to " + pseudoUri);
    const linkageUri = await uploadToGcs({
      bucket: GCS_BUCKET,
      localPath: linkagePath,
      destination: GCS_LINKAGE_PREFIX + "/canamed-linkage-" + isoDate() + ".json"
    });
    console.log("Uploaded to " + linkageUri);
  }

  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(2);
});
