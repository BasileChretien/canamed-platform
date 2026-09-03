#!/usr/bin/env node
/* Erase one participant, on request (GDPR Art. 17 / Art. 7(3), APPI Art. 35(5)).
 *
 * Closes the live-database half of Annex VI G12. Before this, withdrawing
 * consent deleted nothing and there was no route to erase a participant at all
 * — clause 10.1 promised Art. 28(3)(g) deletion the system could not perform.
 *
 * DRY RUN BY DEFAULT. Set ERASE_CONFIRM=1 to write. The first live run on any
 * database is an irreversible deletion of a real person's work, so it is not
 * something a mistyped identifier should be able to do.
 *
 * WHAT IT REACHES
 *   sessions/<code>/...            both trees, via lib/session-trees
 *   orgs/<slug>/sessions/<code>/…
 *   rosters/...                    name, e-mail, university
 *   certIds/...                    and the credentials/<certId> records they name
 *   users/<uid>                    profile + history
 *   erasures/<id>                  the suppression record written for the archive
 *
 * WHAT IT CANNOT REACH, and says so on every run rather than in a footnote:
 *   roomChat/…   turns carry role/content/at and NO author, so one
 *                participant's chat cannot be separated from their roommates'.
 *                Erasing it means erasing the whole room's conversation, which
 *                is other people's data. Reported as UNERASABLE; deciding what
 *                to do is a human call, and the schema is the thing to fix.
 *   the nightly archive — snapshots are not rewritten. A suppression record is
 *                written instead so a restore cannot bring the participant
 *                back, and the snapshots expire on their own cycle. This is the
 *                "put beyond use" position the notice describes at PIS v10.
 *                See scripts/lib/suppression.js for why not (a).
 *
 * USAGE
 *   node scripts/erase-participant.js --uid <uid>
 *   node scripts/erase-participant.js --client-id <cid> --session <locationKey>
 *   node scripts/erase-participant.js --stable-id <sid>
 *   ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid>
 */

"use strict";

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const { readSessionLocations } = require("./lib/session-trees");
const { resolveIdentity, planSessionErasure } = require("./lib/erasure");
const { buildRecord } = require("./lib/suppression");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.ERASE_CONFIRM === "1";

function parseArgs(argv) {
  const out = { uid: null, clientId: null, stableId: null, session: null, reason: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--uid") out.uid = next();
    else if (a === "--client-id") out.clientId = next();
    else if (a === "--stable-id") out.stableId = next();
    else if (a === "--session") out.session = next();
    else if (a === "--reason") out.reason = next();
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
    console.error(
      "FATAL: give at least one of --uid / --client-id / --stable-id.\n" +
      "Refusing to run without an identifier: a run that matches nobody would " +
      "report a clean erasure and do nothing, which is the worst possible " +
      "outcome for a request someone is relying on.");
    process.exit(2);
  }

  initAdmin();
  const db = getDatabase();

  console.log(`Database: ${DB_URL}`);
  console.log(`Mode:     ${CONFIRM ? "LIVE — will delete" : "DRY RUN (set ERASE_CONFIRM=1 to write)"}`);
  console.log("");

  const locations = await readSessionLocations(db);
  const updates = {};
  const report = [];
  let totalPaths = 0;
  const allAmbiguous = [];
  let identityForRecord = null;
  const suppressed = [];

  for (const loc of locations) {
    if (args.session && loc.key !== args.session) continue;
    const identity = resolveIdentity(loc.data, args);
    if (!identity.uid && !identity.clientIds.length && !identity.stableIds.length) continue;

    const plan = planSessionErasure(loc.data, identity);
    if (!plan.deletes.length && !plan.ambiguous.length) continue;

    for (const rel of plan.deletes) updates[`${loc.path}/${rel}`] = null;
    totalPaths += plan.deletes.length;
    allAmbiguous.push(...plan.ambiguous.map((a) => ({ ...a, session: loc.key })));
    report.push({ session: loc.key, identity, count: plan.deletes.length });
    if (!identityForRecord && identity.uid) identityForRecord = identity;
    suppressed.push({ locationKey: loc.key, identity });
  }

  if (!report.length) {
    console.log("No matching participant found in any session. Nothing to erase.");
    console.log("If that is unexpected, check the identifier — this tool never " +
                "matches on a display name.");
    process.exit(0);
  }

  /* Identity-keyed nodes outside the session subtrees. */
  const uid = (identityForRecord && identityForRecord.uid) || args.uid || null;
  const outside = [];
  if (uid) {
    for (const loc of locations) {
      if (args.session && loc.key !== args.session) continue;
      outside.push(`${loc.rosterPath}/${uid}`);
    }
    outside.push(`users/${uid}`);
  }
  /* certIds/<session>/<cid> holds the published certificate id, and
     credentials/<certId> is the world-readable record it names. Deleting the
     pointer without the record would leave the record standing and
     unreachable — still public to anyone holding the id, and now impossible to
     find again in order to delete. So read the value before deleting the key. */
  for (const entry of suppressed) {
    const loc = locations.find((l) => l.key === entry.locationKey);
    if (!loc || !loc.certIdsPath) continue;
    for (const cid of entry.identity.clientIds) {
      outside.push(`${loc.certIdsPath}/${cid}`);
      const snap = await db.ref(`${loc.certIdsPath}/${cid}`).get();
      const certId = snap.exists() ? snap.val() : null;
      if (typeof certId === "string" && certId) outside.push(`credentials/${certId}`);
    }
  }
  for (const p of outside) updates[p] = null;

  console.log("PLAN");
  for (const r of report) {
    console.log(`  ${r.session}: ${r.count} path(s) — uid=${r.identity.uid || "-"} ` +
                `cids=[${r.identity.clientIds.join(",")}] sids=[${r.identity.stableIds.join(",")}]`);
  }
  console.log(`  outside sessions: ${outside.length} path(s) (rosters, certIds, users)`);
  console.log(`  TOTAL: ${totalPaths + outside.length} path(s)`);
  console.log("");

  if (allAmbiguous.length) {
    console.log(`AMBIGUOUS — ${allAmbiguous.length} entry(ies) NOT deleted:`);
    for (const a of allAmbiguous) console.log(`  ${a.session}/${a.path}  (${a.reason})`);
    console.log("  These are attributed by display name with no id beside them. " +
                "Deleting them could destroy a namesake's work, so they are left " +
                "for a human to decide.");
    console.log("");
  }

  console.log("UNERASABLE — reported on every run, not a footnote:");
  console.log("  roomChat/…  the simulated-patient conversation. Turns carry no " +
              "author (role/content/at), so this participant's messages cannot be " +
              "separated from their roommates'. Erasing them means erasing other " +
              "people's data. The fix is a schema change, not a flag here.");
  console.log("");

  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with ERASE_CONFIRM=1 to apply.");
    process.exit(0);
  }

  const at = new Date().toISOString();
  const records = suppressed.map((s) =>
    buildRecord({ locationKey: s.locationKey, identity: s.identity, at,
                  reason: args.reason || "erasure request" }));

  /* The suppression record is written FIRST and in the same multi-path update
     as the deletions. If it were written afterwards and the process died in
     between, the participant would be gone from the live tree and still
     restorable from 90 nights of archive with nothing recording that they
     should not be — the one ordering that turns a partial failure into a
     silent breach. */
  const recRef = db.ref("erasures").push();
  updates[`erasures/${recRef.key}`] = { at, records };

  await db.ref().update(updates);
  console.log(`ERASED. ${Object.keys(updates).length - 1} path(s) deleted.`);
  console.log(`Suppression record: erasures/${recRef.key} (${records.length} session(s)).`);
  console.log("The nightly snapshots are NOT rewritten; scripts/restore-sessions.js " +
              "applies this record so a restore cannot bring the participant back.");
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error("FATAL: " + (e && e.message)); process.exitCode = 1; });
