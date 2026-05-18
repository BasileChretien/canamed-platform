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
 * Pseudonymisation strategy (deterministic per session):
 *   - For each room, sort participants by `at` (join order) and assign
 *     codes Student-A, Student-B, Student-C... — stable across runs
 *   - Replace every occurrence of the participant's name in:
 *       /pool/{cid}/name
 *       /rooms/{room}/answers/{*}/by
 *       /rooms/{room}/votes/{*}/ballots/{cid} (no name, just choice — no-op)
 *       /rooms/{room}/score/manual/{*}/by
 *       /rooms/{room}/calls/{*}/by, etc.
 *   - Linkage table: { sessionCode: { realName: pseudoCode } } — written
 *     separately so researchers operate only on the pseudonymised export
 *
 * Closed sessions only (active sessions could still receive writes that
 * would not be pseudonymised). Use the in-memory copy; don't mutate the
 * live database — researchers consume the export, not the DB.
 *
 * Env vars (same as backup-sessions.js):
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON file
 *   FIREBASE_DATABASE_URL           the RTDB URL
 *   EXPORT_OUT_DIR                  where to write outputs
 *
 * Outputs:
 *   $EXPORT_OUT_DIR/canamed-pseudonymised-YYYY-MM-DD.json
 *   $EXPORT_OUT_DIR/canamed-linkage-YYYY-MM-DD.json
 *
 * Exit codes:
 *   0 — success
 *   2 — infrastructure failure
 */

"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";

const OUT_DIR = process.env.EXPORT_OUT_DIR || process.env.RUNNER_TEMP || ".";

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

// 26 letters then double letters AA, AB, ... so we don't run out
function pseudoCode(i) {
  if (i < 26) return "Student-" + String.fromCharCode(65 + i);
  const a = Math.floor(i / 26) - 1;
  const b = i % 26;
  return "Student-" + String.fromCharCode(65 + a) + String.fromCharCode(65 + b);
}

function pseudonymiseSession(sess, sessionCode, linkage) {
  if (!sess || typeof sess !== "object") return sess;
  // Build name -> pseudo map for this session
  const pool = sess.pool || {};
  const cids = Object.keys(pool).sort((a, b) => {
    const ta = (pool[a] && pool[a].at) || 0;
    const tb = (pool[b] && pool[b].at) || 0;
    return ta - tb;
  });
  const nameToPseudo = {};
  cids.forEach((cid, i) => {
    const name = pool[cid] && pool[cid].name;
    if (typeof name === "string" && name.length > 0 && !nameToPseudo[name]) {
      nameToPseudo[name] = pseudoCode(i);
    }
  });
  linkage[sessionCode] = nameToPseudo;

  // Deep-walk and replace any field whose value matches a real name
  const out = JSON.parse(JSON.stringify(sess));
  // Strip the password hash too
  if (out.adminPasswordHash) delete out.adminPasswordHash;

  function replaceInValue(v) {
    if (typeof v === "string" && nameToPseudo[v]) return nameToPseudo[v];
    return v;
  }
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = replaceInValue(node[i]);
        if (typeof node[i] === "object") walk(node[i]);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      // The `name` field is the canonical real-name location; rewrite.
      // Also `by` fields throughout (answers, scores, calls, etc.) are real names.
      if (k === "name" || k === "by") {
        node[k] = replaceInValue(node[k]);
      } else {
        node[k] = replaceInValue(node[k]);
      }
      if (typeof node[k] === "object") walk(node[k]);
    }
  }
  walk(out);
  return out;
}

async function main() {
  admin.initializeApp({ databaseURL: DB_URL });
  const db = admin.database();

  console.log("--- CaNaMED daily pseudonymised export ---");
  console.log("Database:  " + DB_URL);
  console.log("Out dir:   " + OUT_DIR);
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
    note: "Pseudonymised export. Real names replaced by Student-A/B/... codes per session. " +
      "Linkage table is in a separate artefact with shorter retention (see workflow)."
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

  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(2);
});
