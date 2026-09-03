#!/usr/bin/env node
/* Correct a participant's details on request (GDPR Art. 16, APPI Art. 34).
 *
 * The third limb of Annex VI G12: "there is no post-session rectification".
 * That was literally true — every participant-writable path under a session is
 * `!closed`-guarded, so once a session ended nobody, participant or operator,
 * could fix a misspelt name. The data stayed wrong permanently and flowed into
 * the research export and the roster that way.
 *
 * WHY THIS IS AN OPERATOR TOOL AND WITHDRAWAL IS A BUTTON. Art. 7(3) makes an
 * explicit demand about EFFORT — withdrawal must be as easy as consent was —
 * and that forced the in-product control in #376. Art. 16 makes no equivalent
 * demand: it requires the correction to happen "without undue delay", not that
 * the data subject perform it themselves. A tool plus a monitored channel meets
 * it, and it avoids giving a client the power to rewrite identity fields on a
 * closed session, which is a far larger surface than it sounds.
 *
 * DRY RUN BY DEFAULT. RECTIFY_CONFIRM=1 to write.
 *
 * USAGE
 *   node scripts/rectify-participant.js --uid <uid> --set name="Correct Name"
 *   node scripts/rectify-participant.js --client-id <cid> --set university="Caen" \
 *     --session <locationKey>
 */

"use strict";

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const { readSessionLocations } = require("./lib/session-trees");
const { resolveIdentity } = require("./lib/erasure");
const { planRectification, RECTIFIABLE } = require("./lib/data-rights");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.RECTIFY_CONFIRM === "1";

function parseArgs(argv) {
  const out = { uid: null, clientId: null, stableId: null, session: null, fields: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--uid") out.uid = next();
    else if (a === "--client-id") out.clientId = next();
    else if (a === "--stable-id") out.stableId = next();
    else if (a === "--session") out.session = next();
    else if (a === "--set") {
      const pair = next() || "";
      const eq = pair.indexOf("=");
      if (eq > 0) out.fields[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return out;
}

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DB_URL });
  else initializeApp({ databaseURL: DB_URL });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.uid && !args.clientId && !args.stableId) {
    console.error("FATAL: give one of --uid / --client-id / --stable-id.");
    process.exit(2);
  }
  if (!Object.keys(args.fields).length) {
    console.error("FATAL: give at least one --set field=value. Correctable " +
      "fields: " + RECTIFIABLE.join(", ") + ".");
    process.exit(2);
  }
  for (const k of Object.keys(args.fields)) {
    if (!RECTIFIABLE.includes(k)) {
      console.error(`FATAL: "${k}" is not correctable. Allowed: ` +
        RECTIFIABLE.join(", ") + ".");
      console.error("Answers are deliberately not correctable — Art. 16 is " +
        "about factual accuracy, and rewriting somebody's clinical reasoning " +
        "after the fact would falsify the record rather than correct it.");
      process.exit(2);
    }
    if (typeof args.fields[k] !== "string" || !args.fields[k].length) {
      console.error(`FATAL: --set ${k}= has an empty value. Use ` +
        "scripts/erase-participant.js to remove data, not a blank correction.");
      process.exit(2);
    }
  }

  initAdmin();
  const db = getDatabase();

  console.log(`Database: ${DB_URL}`);
  console.log(`Mode:     ${CONFIRM ? "LIVE — will write" : "DRY RUN (set RECTIFY_CONFIRM=1)"}`);
  console.log("");

  const locations = await readSessionLocations(db);
  const updates = {};
  let touched = 0;

  for (const loc of locations) {
    if (args.session && loc.key !== args.session) continue;
    const identity = resolveIdentity(loc.data, args);
    if (!identity.uid && !identity.clientIds.length) continue;

    /* The roster is read so the planner can refuse to CREATE a row. Without it
       a mistyped uid would invent a participant, with a name in it, while
       purporting to correct one. */
    const rosterSnap = await db.ref(loc.rosterPath).get();
    const rosterNode = rosterSnap.exists() ? (rosterSnap.val() || {}) : {};
    const { updates: plan } = planRectification(
      loc.data, identity, args.fields, loc.rosterPath, rosterNode);
    const keys = Object.keys(plan);
    if (!keys.length) continue;

    for (const rel of keys) {
      /* planRectification returns roster paths absolute and pool paths marked
         `session:` — the session prefix differs per tree and only the caller
         knows it. */
      const path = rel.startsWith("session:")
        ? `${loc.path}/${rel.slice("session:".length)}`
        : rel;
      updates[path] = plan[rel];
    }
    console.log(`  ${loc.key}: ${keys.length} field write(s) — uid=${identity.uid || "-"}`);
    touched++;
  }

  if (!touched) {
    console.log("No matching participant found. Nothing to correct.");
    process.exit(0);
  }

  console.log("");
  console.log(`TOTAL: ${Object.keys(updates).length} path(s) across ${touched} session(s).`);
  console.log("");
  console.log("⚠️ The nightly archive is NOT rewritten. Snapshots taken before " +
    "this correction still hold the old value and expire on their own cycle; " +
    "they are never used except to restore after an incident. Say so if the " +
    "requester asks whether every copy is now correct.");
  console.log("");

  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with RECTIFY_CONFIRM=1.");
    process.exit(0);
  }
  await db.ref().update(updates);
  console.log(`CORRECTED ${Object.keys(updates).length} path(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL: " + (e && e.message));
  process.exit(1);
});
