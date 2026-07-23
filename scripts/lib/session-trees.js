"use strict";
/* Enumerate every session in the database, across BOTH session trees.
 *
 * Sessions live in two places:
 *   sessions/<code>                        the default (non-org) tree
 *   orgs/<slug>/sessions/<sessionId>       one parallel tree per partner org
 *
 * orgs.js shipped with a full parallel rules tree and /o/{slug}/ routing, but
 * all three retention jobs (cleanup-stale-sessions, backup-sessions,
 * pseudonymise-export) were hard-scoped to db.ref("sessions"). Org-scoped
 * sessions were therefore never purged, never backed up and never
 * pseudonymised — a live GDPR Art. 5(1)(e) storage-limitation gap, found by the
 * 2026-07-23 Phase-4e legal fact-check (gap 2). This module is the single place
 * that knows where sessions live, so a future third tree only needs adding here.
 *
 * `sessionLocations` is PURE (no firebase-admin) so it can be unit-tested; the
 * scripts do their own I/O and hand it the two subtree values.
 */

/**
 * Flatten both trees into one list of session locations.
 *
 * @param {object} sessionsVal value of `sessions` (may be null/undefined)
 * @param {object} orgsVal     value of `orgs` (may be null/undefined)
 * @returns {Array<{key:string, code:string, orgSlug:string|null, path:string,
 *                  adminSecretPath:string, data:object}>}
 *   `key` is unique across trees and is what exports should be keyed by — two
 *   orgs can legitimately use the same session code, so keying an export by the
 *   bare code would silently overwrite one with the other.
 */
function sessionLocations(sessionsVal, orgsVal) {
  const out = [];

  for (const code of Object.keys(sessionsVal || {})) {
    out.push({
      key: code,
      code: code,
      orgSlug: null,
      path: "sessions/" + code,
      adminSecretPath: "adminSecrets/" + code,
      data: sessionsVal[code]
    });
  }

  for (const slug of Object.keys(orgsVal || {})) {
    const org = orgsVal[slug];
    const sessions = (org && org.sessions) || {};
    for (const code of Object.keys(sessions)) {
      out.push({
        key: "orgs/" + slug + "/" + code,
        code: code,
        orgSlug: slug,
        path: "orgs/" + slug + "/sessions/" + code,
        adminSecretPath: "adminSecrets/orgs/" + slug + "/" + code,
        data: sessions[code]
      });
    }
  }

  return out;
}

/**
 * Read both trees and return their locations. Kept separate from the pure
 * function above so tests never need firebase-admin.
 * @param {object} db a firebase-admin database() handle
 */
async function readSessionLocations(db) {
  const [sessionsSnap, orgsSnap] = await Promise.all([
    db.ref("sessions").once("value"),
    db.ref("orgs").once("value")
  ]);
  return sessionLocations(sessionsSnap.val(), orgsSnap.val());
}

/**
 * A log-safe label for a location. Session join-codes must never reach a
 * world-readable Actions log (see CLEANUP_QUIET), but the ORG SLUG is not a
 * secret and is the useful part when diagnosing which tree a row came from.
 */
function safeLabel(loc, quiet) {
  if (!quiet) return loc.key;
  return loc.orgSlug ? "orgs/" + loc.orgSlug + "/<redacted>" : "<redacted>";
}

module.exports = { sessionLocations, readSessionLocations, safeLabel };
