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
 * WHICH TRANSFORM WROTE A FILE is in the file: `transformVersion`
 * (scripts/lib/pseudonymise.js, TRANSFORM_VERSION). A file WITHOUT that field
 * was written by version 1, and carries what version 1 let through:
 *   - the real display name and university of everyone who contributed —
 *     participants who had declined research use included — and the
 *     facilitator's name, inside the JSON string of each room event's `payload`;
 *   - the facilitator's Firebase auth uid (`creatorUid`), the scenario
 *     author's where a scenario reference was set (`scenarioRef.ownerUid`),
 *     and a participant's as the key of each `roomOf` entry (sessions created
 *     from 2026-08-03 on);
 *   - e-mail addresses, where a session still held the queue of the mail
 *     function removed on 2026-09-24.
 * A file written by version 1 or 2 also carries what a participant who
 * declined wrote into the room's shared lists (answers, edits, replies,
 * hypotheses, deleted answers, events, reveals, triage choices), and rows and
 * records under identities with no pool entry. Version 3 keeps only what can
 * be shown to be an included participant's (scripts/lib/research-inclusion.js),
 * with one exception: the name-only records (events, reveals, triage choices,
 * calls for help) of a participant who is not included and is bound to no
 * account are kept as an included namesake's, if one exists — the price of not
 * letting an unbound row, which anyone holding the session code can write,
 * remove an included participant's records.
 * Do not date this by the calendar: the job runs once a night on whatever
 * `main` holds, so the first file written by a version is the first one that
 * says so. A fix to the transform does not rewrite a stored file; what is done
 * about the files already written is the decision of the controller of this
 * export (legal/dpa-draft.md, Annex VI R10).
 * `stableId` is NOT removed by any version: see the transform's header.
 * The `note` in the payload states all of this for whoever opens the file.
 *
 * tests/pseudonymise-export-run.test.js RUNS this script against an in-memory
 * database and reads the file it writes.
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

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const fs = require("fs");
const path = require("path");
const { chooseDestination, uploadArchive, describeDestination } = require("./lib/archive");
const { pseudonymiseSession, sessionHasConsent, isIncluded,
        applyWithdrawals, TRANSFORM_VERSION } = require("./lib/pseudonymise");
const { readSessionLocations } = require("./lib/session-trees");

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
  /* The guard asks "is there ANY archive destination", not "is the GCS
   * bucket set". Checking GCS alone would refuse to run a perfectly good
   * S3-backed run — which is the configuration this job now uses. */
  if (REQUIRE_GCS && !chooseDestination({ gcsBucket: GCS_BUCKET })) {
    console.error(
      "FATAL: EXPORT_REQUIRE_GCS=1 but no archive destination is configured.\n" +
      "       Set BACKUP_S3_BUCKET (+ SCW_ACCESS_KEY / SCW_SECRET_KEY) for\n" +
      "       Scaleway Object Storage, or PII_ARCHIVE_BUCKET for a private\n" +
      "       GCS bucket if billing is ever restored.\n" +
      "       Refusing to run an export whose only copy would vanish with the runner."
    );
    process.exit(2);
  }

  initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("--- CaNaMED daily pseudonymised export ---");
  console.log("Database:  " + DB_URL);
  console.log("Out dir:   " + OUT_DIR);
  console.log("GCS:       " + (GCS_BUCKET ? `gs://${GCS_BUCKET}/` : "(none — local artifact mode)"));
  console.log("Run time:  " + new Date().toISOString());
  console.log("");

  // BOTH trees: sessions/<code> and orgs/<slug>/sessions/<id>. Org-scoped
  // sessions were never pseudonymised at all until 2026-07-23. Keyed by
  // location key, not bare code — two orgs may reuse the same session code.
  const locations = await readSessionLocations(db);
  const sessions = {};
  /* WITHDRAWALS ARE APPLIED BEFORE ANYTHING ELSE LOOKS AT CONSENT.
     A participant who withdraws (GDPR Art. 7(3)) writes withdrawals/<code>/<uid>,
     which stays writable after the session closes — pool/<cid>/consent does not,
     so on a closed session the pool flag CANNOT have been updated and the
     withdrawals node is the only truthful record. Folding it into the pool flag
     here means the consent gate below, sessionHasConsent() and
     pseudonymiseSession() all honour it without any of them knowing this node
     exists. A parallel code path that had to be remembered is exactly how this
     export came to ignore consent altogether (Annex VI G1). */
  const withdrawals = { records: 0, rowsWithdrawn: 0, unmatched: 0 };
  for (const loc of locations) {
    let recs = {};
    try {
      const snap = await db.ref(loc.withdrawalsPath).get();
      recs = snap.exists() ? (snap.val() || {}) : {};
    } catch (e) {
      /* Fail CLOSED. An unreadable withdrawals node is indistinguishable from
         an empty one, and guessing "empty" exports people who asked to be left
         out — the one error this gate exists to prevent. */
      console.error("FATAL: could not read " + loc.withdrawalsPath + " — " +
                    (e && e.message));
      console.error("Refusing to export: an unreadable withdrawal list looks " +
                    "exactly like nobody having withdrawn.");
      process.exit(4);
    }
    /* Counted by what each record CHANGED. A record whose uid no clientMapping
       row ties to a pool row changed nothing, and was once counted as applied. */
    sessions[loc.key] = applyWithdrawals(loc.data, recs, withdrawals);
  }
  const codes = Object.keys(sessions);
  const orgCount = locations.filter(l => l.orgSlug).length;

  // Only export CLOSED sessions (active ones could still receive writes
  // post-export, leaving the export stale)
  const closedCodes = codes.filter(c => sessions[c] && sessions[c].closed);
  const openCount = codes.length - closedCodes.length;
  console.log("Sessions total:       " + codes.length + " (" + orgCount + " org-scoped)");
  console.log("Closed (exportable):  " + closedCodes.length);
  console.log("Open (skipped):       " + openCount);

  // RESEARCH CONSENT gate (Phase-4e compliance gap 1). Participants tick an
  // optional research box in the lobby; joining is not conditional on it. Since
  // transform version 3 the export is an INCLUSION filter
  // (scripts/lib/research-inclusion.js): a participant is included when their
  // pool row records research consent AND a clientMapping row binds it to an
  // account; a record that names a person is kept only when it can be shown
  // to be an included participant's. A session with nobody included is skipped
  // outright rather than exported as a participant-free husk.
  // The counts below are the whole log: no code, name or identifier, because
  // the log of a public repository's workflow is world-readable.
  const consentedCodes = closedCodes.filter(c => sessionHasConsent(sessions[c]));
  const noConsentCount = closedCodes.length - consentedCodes.length;
  console.log("Withdrawn (Art. 7(3)): " + withdrawals.records + " record(s); " +
              withdrawals.rowsWithdrawn + " pool row(s) marked withdrawn; " +
              withdrawals.unmatched + " record(s) reached no pool row through clientMapping" +
              " (such a record changed nothing: a row of that person's is left out only" +
              " if it is bound to no account)");

  let participantsIn = 0;
  let participantsOut = 0;
  for (const code of closedCodes) {
    const pool = (sessions[code] && sessions[code].pool) || {};
    for (const cid of Object.keys(pool)) {
      if (isIncluded(sessions[code], cid)) participantsIn++; else participantsOut++;
    }
  }
  console.log("Sessions w/ consent:  " + consentedCodes.length);
  console.log("Sessions skipped (no participant included): " + noConsentCount);
  console.log("Participants included (consent, bound to an account): " + participantsIn);
  console.log("Participants excluded (closed sessions):              " + participantsOut);

  const linkage = {};
  const pseudonymised = {};
  const removed = {};
  for (const code of consentedCodes) {
    pseudonymised[code] = pseudonymiseSession(sessions[code], code, linkage, removed);
  }
  const n = (k) => removed[k] || 0;
  console.log("In the exported sessions:");
  console.log("  participants included:                              " + n("participantsIncluded"));
  console.log("  excluded, no research consent (or withdrawn):       " + n("participantsNoConsent"));
  console.log("  excluded, consent recorded but no clientMapping row: " + n("participantsUnbound"));
  console.log("  removed, rows keyed by an identity not included:    " + n("keyedRows"));
  console.log("  removed, ballots not shown to be an included one's: " + n("ballots"));
  console.log("  removed, records whose cid is not included:         " + n("cidNotIncluded"));
  console.log("  removed, records with a cid and a by naming nobody included: " + n("byNamesNobodyIncluded"));
  console.log("  removed, name-only records, name not included:      " + n("nameNotIncluded"));
  console.log("  removed, name-only records, name also held by someone not included: " + n("nameShared"));
  console.log("  removed, team names (free text, no author):         " + n("teamNames"));

  const pseudoPayload = {
    exportTakenAt: new Date().toISOString(),
    databaseUrl: DB_URL,
    sessionCount: consentedCodes.length,
    transformVersion: TRANSFORM_VERSION,
    sessions: pseudonymised,
    note: "Pseudonymised export, written by transform version " + TRANSFORM_VERSION +
      " (the transformVersion field; scripts/lib/pseudonymise.js). " +
      "WHO IS IN IT: a participant is INCLUDED when their pool row records " +
      "consent.research === true, a clientMapping row binds it to an account, and they " +
      "have not withdrawn. Sessions with nobody included are omitted. In the others, a " +
      "record that names a person is kept only when it can be shown to be an included " +
      "participant's: a row keyed by their clientId (pool, poll, tests, survey, presence, " +
      "role choices, role assignments); a ballot keyed by their clientId, by the stableId " +
      "their row records or by one the mapping table ties to their account, and by no " +
      "stableId a row that is not included records; an answer, edit, deleted answer, " +
      "hypothesis or reply whose cid is theirs and in which no name belongs to nobody " +
      "included; a role assignment whose assigner clientId is theirs; an event, reveal, " +
      "triage choice or call for help whose every name is held by an included participant " +
      "and by nobody else whose pool row is bound to an account, nor by the facilitator. " +
      "Everything else attributable to a person " +
      "is removed: what a participant who declined, withdrew or is bound to no account " +
      "wrote, with one exception (below); what an identity with no included pool row " +
      "wrote; and a name-only record " +
      "whose name an included participant shares with somebody who is not included but " +
      "whose pool row is bound to an account (so an included participant can lose such " +
      "records to a namesake — and any signed-in visitor holding the session code who " +
      "binds a row of their own under her display name removes them; a row bound to no " +
      "account does not count). EXCEPTION: the name-only records (events, reveals, " +
      "triage choices, calls for help) of a participant who is not included and is bound " +
      "to no account are kept as an included namesake's, if one exists — the price of " +
      "not letting an unbound row, which anyone holding the session code can write, " +
      "remove an included participant's records. A room's team name " +
      "is removed (free text, no author recorded); its stage, scores and committed votes " +
      "stay. The facilitator's own records (created, closed, audit, manual scores, " +
      "configuration) stay, name redacted; their entries in shared lists do not. A record " +
      "is its writer's word: one written in an included participant's name or clientId " +
      "by somebody else is not detected; and a reply an included participant wrote to a " +
      "removed answer stays, under that answer's id. A file written by version 2 or " +
      "earlier is NOT erased of participants who declined: it holds what they wrote into " +
      "shared lists, under REDACTED-NAME with their clientId, and rows under identities " +
      "with no pool entry. " +
      "NAMES: participant names -> Student-A/B/... per session, in name/by fields and " +
      "inside the JSON payload of room events; names that are not a consenting " +
      "participant's (facilitators, participants who declined) -> REDACTED-NAME; " +
      "university bucketed to Univ-N; the LLM chat is dropped. A name typed inside " +
      "free text is not caught, and free text other than the chat is exported as written. " +
      "ACCOUNT IDENTIFIERS: the clientMapping and stableIdMapping tables, creatorUid, " +
      "scenarioRef.ownerUid, roomOf and any legacy mail queue are dropped; the account " +
      "uids keying members are replaced by the pseudonyms. " +
      "NOT FREE OF CROSS-SESSION IDENTIFIERS: stableId, the study's join key, is kept " +
      "as written (in pool, tests, survey, poll, and as the key of each ballot). For a " +
      "participant who was signed in it is their Firebase account identifier, the same " +
      "in every session; for an anonymous one it is a random value kept in the browser, " +
      "carried into the next session unless they left through Leave or changed session. " +
      "EARLIER FILES: a file with no transformVersion field was written by version 1 " +
      "and also carries real names and universities inside event payloads " +
      "(rooms/*/events/*/payload), creatorUid, scenarioRef.ownerUid, account uids as " +
      "the keys of roomOf, and any mail queue with its e-mail addresses. " +
      "The linkage table is a separate artefact with shorter retention (see workflow)."
  };
  const linkagePayload = {
    exportTakenAt: new Date().toISOString(),
    databaseUrl: DB_URL,
    sessionCount: consentedCodes.length,
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

  const dest = chooseDestination({ gcsBucket: GCS_BUCKET });
  console.log("Archive destination: " + describeDestination(dest));

  if (dest) {
    const pseudoUri = await uploadArchive(dest, {
      localPath: pseudoPath,
      destination: GCS_PSEUDO_PREFIX + "/canamed-pseudonymised-" + isoDate() + ".json"
    });
    console.log("Uploaded to " + pseudoUri);
    const linkageUri = await uploadArchive(dest, {
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
