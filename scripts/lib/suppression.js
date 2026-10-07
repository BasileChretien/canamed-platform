/* scripts/lib/suppression.js
 *
 * The bridge between an erasure and the nightly archive.
 *
 * WHY THIS EXISTS AT ALL. Deleting a participant from the live database does
 * not reach the up-to 90 nightly snapshots that already hold them
 * (`scripts/ops/pii-bucket-lifecycle.json`, DPA clause 2.8(b), Annex VI G12).
 * There are two defensible answers to that, and only one is affordable:
 *
 *   (a) rewrite every archived object on each erasure. Downloads and re-uploads
 *       up to 90 objects, and CREATES 90 fresh copies of everything else in the
 *       process — new writes of other people's data as the price of erasing one
 *       person's.
 *   (b) leave the snapshots to expire on their ordinary cycle, and guarantee
 *       the erased data can never come back out of them. This is the "put
 *       beyond use" position, and it is what the notice now describes to
 *       participants (PIS v10).
 *
 * (b) is chosen — but it is only worth anything if RESTORING is the one thing
 * that could bring the data back, and restoring honours the list. Before this
 * module there was no restore path at all, so "never selectively restored" was
 * a promise with no mechanism behind it and nothing to attach one to. That is
 * why `scripts/restore-sessions.js` exists in the same change, and why it
 * refuses to run when the list cannot be read.
 *
 * The suppression list is NOT a second copy of the person's data. A record
 * holds identifiers and the session it applies to — never a name, an e-mail or
 * any content. Keeping the erased values in order to know what to suppress
 * would defeat the erasure.
 */

"use strict";

const { resolveIdentity, planSessionErasure, applyPlan } = require("./erasure");

/* WHY A RECORD WAS WRITTEN — a closed list, code -> the text that is stored.
 *
 * The header says a record holds identifiers only. `reason` was the exception
 * nobody had looked at: the tool stored whatever followed --reason, and an
 * operator answering a request by e-mail could as easily type "J. Dupont
 * asked on the phone" as "Art. 17 request". The ledger is never deleted or
 * rewritten, and two scheduled jobs read all of it every day on a hosted
 * runner; the participant notice describes what they read as the session's
 * identifier, the person's technical identifiers, a date and what was asked.
 * A free-text field cannot be promised to be only that. A fixed list can.
 *
 * To add a reason, add it here: it is then accepted by the tool, written by
 * buildRecord(), and recognised by the monitor's count of older free text. */
const ERASURE_REASONS = Object.freeze({
  "erasure-request": "erasure request",
  "art17": "Art. 17 request",
  "art7-3": "Art. 7(3) withdrawal",
  "appi35": "APPI Art. 35(5) request",
  "controller": "controller instruction",
});
const DEFAULT_REASON = ERASURE_REASONS["erasure-request"];

/**
 * The stored text for a reason given as a code ("art17") or as that text
 * itself ("Art. 17 request"), case-insensitively. Nothing given -> the default.
 * Anything else -> null: the caller refuses, it does not guess.
 */
function canonicalReason(given) {
  if (given === undefined || given === null) return DEFAULT_REASON;
  if (typeof given !== "string") return null;
  const wanted = given.trim().toLowerCase();
  for (const code of Object.keys(ERASURE_REASONS)) {
    if (wanted === code || wanted === ERASURE_REASONS[code].toLowerCase()) return ERASURE_REASONS[code];
  }
  return null;
}

/** Is this stored text one of the listed reasons? (For counting what is not.) */
function isListedReason(text) {
  return Object.values(ERASURE_REASONS).includes(text);
}

/** "code (text), code (text), …" — for a refusal that has to say what is accepted. */
function describeReasons() {
  return Object.keys(ERASURE_REASONS).map((code) => `${code} ("${ERASURE_REASONS[code]}")`).join(", ");
}

/**
 * Build a suppression record. Identifiers only — see the header.
 *
 * @param {object} args
 * @param {string} args.locationKey the session location this applies to
 * @param {object} args.identity from resolveIdentity()
 * @param {string} args.at ISO timestamp, passed in (this module has no clock,
 *   so a caller cannot get a different plan by running it at a different time)
 * @param {string} [args.reason] a code or text from ERASURE_REASONS; anything
 *   else throws
 * @param {boolean} [args.sessionPurged] the session was no longer in the
 *   database when this was written. Nothing was deleted from the live tree —
 *   the purge had already done that for everyone — and the record carries the
 *   uid alone: clientIds are resolved inside a session, and there was none to
 *   resolve them in. That is enough: applySuppression() re-resolves them
 *   against each snapshot it is applied to.
 * @param {boolean} [args.researchCopyChecked] with `sessionPurged`: the
 *   operator stated that the participant is not in the research copy. The
 *   record cannot show that it is true, only that it was said.
 */
function buildRecord({ locationKey, identity, at, reason, sessionPurged, researchCopyChecked }) {
  if (!locationKey) throw new Error("suppression record needs a locationKey");
  if (!at) throw new Error("suppression record needs an explicit `at`");
  const ids = identity || {};
  if (!ids.uid && !(ids.clientIds || []).length && !(ids.stableIds || []).length) {
    throw new Error(
      "suppression record needs at least one identifier — a record that " +
      "identifies nobody would silently suppress nothing on restore");
  }
  if (sessionPurged && !ids.uid) {
    throw new Error(
      "a suppression record for a purged session needs the uid — there is no " +
      "session to resolve a clientId against, and the request it answers is " +
      "keyed by uid");
  }
  const why = canonicalReason(reason);
  if (why === null) {
    throw new Error("a suppression record's reason comes from a fixed list — " +
      describeReasons() + " — and never from free text: the ledger is kept " +
      "for ever and read by scheduled jobs");
  }
  const record = {
    locationKey,
    uid: ids.uid || null,
    clientIds: [...(ids.clientIds || [])].sort(),
    stableIds: [...(ids.stableIds || [])].sort(),
    at,
    reason: why,
  };
  /* Added only when true, so an ordinary record keeps exactly the shape it
     has always had. */
  if (sessionPurged) {
    record.sessionPurged = true;
    if (researchCopyChecked) record.researchCopyChecked = true;
  }
  return record;
}

/**
 * Apply every suppression record to a backup payload.
 *
 * The payload shape is the one `scripts/backup-sessions.js` writes:
 *   { backupTakenAt, databaseUrl, sessionCount, orgSessionCount, sessions: {} }
 * keyed by LOCATION KEY, not by session code — two orgs may use the same code.
 *
 * @returns {{payload: object, applied: object[], skipped: object[]}}
 *   `applied` records what each suppression actually removed, so a restore can
 *   report it rather than assert it. `skipped` are records whose session is not
 *   in this snapshot — expected and harmless (a snapshot predating the session,
 *   or a different location), reported so a run that suppressed NOTHING is
 *   visibly different from one that had nothing to suppress.
 */
function applySuppression(payload, records) {
  const src = payload && typeof payload === "object" ? payload : {};
  const out = JSON.parse(JSON.stringify(src));
  const sessions = out.sessions && typeof out.sessions === "object" ? out.sessions : {};
  const applied = [];
  const skipped = [];

  for (const rec of records || []) {
    const key = rec && rec.locationKey;
    if (!key || !Object.prototype.hasOwnProperty.call(sessions, key)) {
      skipped.push({ record: rec, why: "session not present in this snapshot" });
      continue;
    }
    /* Re-resolve against the SNAPSHOT, not against the record alone. A snapshot
       can hold clientIds the participant had at the time and that the record
       never saw — for instance one created after the erasure record was written
       but before the snapshot, or one whose mapping row had not yet landed when
       the erasure ran. Seeding from the record and re-resolving catches those;
       trusting the record's list alone would leave them in the restored tree. */
    const seeds = [
      rec.uid ? { uid: rec.uid } : null,
      ...(rec.clientIds || []).map((clientId) => ({ clientId })),
      ...(rec.stableIds || []).map((stableId) => ({ stableId })),
    ].filter(Boolean);

    const merged = { uid: rec.uid || null, clientIds: new Set(rec.clientIds || []),
                     stableIds: new Set(rec.stableIds || []) };
    for (const seed of seeds) {
      const found = resolveIdentity(sessions[key], seed);
      if (found.uid && !merged.uid) merged.uid = found.uid;
      found.clientIds.forEach((c) => merged.clientIds.add(c));
      found.stableIds.forEach((s) => merged.stableIds.add(s));
    }

    const identity = {
      uid: merged.uid,
      clientIds: [...merged.clientIds].sort(),
      stableIds: [...merged.stableIds].sort(),
    };
    const plan = planSessionErasure(sessions[key], identity);
    sessions[key] = applyPlan(sessions[key], plan);
    applied.push({
      locationKey: key,
      identity,
      removed: plan.deletes.length,
      paths: plan.deletes,
      ambiguous: plan.ambiguous,
    });
  }

  out.sessions = sessions;
  return { payload: out, applied, skipped };
}

module.exports = {
  buildRecord, applySuppression,
  ERASURE_REASONS, canonicalReason, isListedReason, describeReasons,
};
