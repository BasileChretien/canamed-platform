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
 *                  adminSecretPath:string, roomChatPath:string,
 *                  certIdsPath:string, rosterPath:string, data:object}>}
 *   `key` is unique across trees and is what exports should be keyed by — two
 *   orgs can legitimately use the same session code, so keying an export by the
 *   bare code would silently overwrite one with the other.
 */
function locationFor(orgSlug, code) {
  /* THE SINGLE SOURCE OF THE PURGE TARGETS. cleanup-stale-sessions derives
   * every path it DELETES from this object, so the two enumerators below must
   * not each build their own copy — a divergence here deletes the wrong node
   * or silently misses one. Hence one builder, two callers, and a test that
   * asserts they agree. */
  if (orgSlug === null) {
    return {
      key: code,
      code: code,
      orgSlug: null,
      path: "sessions/" + code,
      adminSecretPath: "adminSecrets/" + code,
      roomChatPath: "roomChat/" + code,
      certIdsPath: "certIds/" + code,
      // rosters/ mirrors the session path exactly — the client writes
      // "rosters/" + sPath(uid), and sPath is _sessionPrefix(org) + code, so
      // this is that same prefix with the uid left off.
      rosterPath: "rosters/sessions/" + code
    };
  }
  return {
    key: "orgs/" + orgSlug + "/" + code,
    code: code,
    orgSlug: orgSlug,
    path: "orgs/" + orgSlug + "/sessions/" + code,
    adminSecretPath: "adminSecrets/orgs/" + orgSlug + "/" + code,
    roomChatPath: "roomChat/orgs/" + orgSlug + "/" + code,
    certIdsPath: "certIds/orgs/" + orgSlug + "/" + code,
    rosterPath: "rosters/orgs/" + orgSlug + "/sessions/" + code
  };
}

function sessionLocations(sessionsVal, orgsVal) {
  const out = [];

  for (const code of Object.keys(sessionsVal || {})) {
    out.push(Object.assign(locationFor(null, code), { data: sessionsVal[code] }));
  }

  for (const slug of Object.keys(orgsVal || {})) {
    const org = orgsVal[slug];
    const sessions = (org && org.sessions) || {};
    for (const code of Object.keys(sessions)) {
      out.push(Object.assign(locationFor(slug, code), { data: sessions[code] }));
    }
  }

  return out;
}

/**
 * The same list, built from KEYS ALONE — no session bodies anywhere.
 *
 * Returned objects deliberately carry NO `data` property (not `data: null`):
 * a caller that needs bodies should fail obviously rather than quietly write
 * nulls into a backup. `metadataOnly: true` marks them for the same reason.
 *
 * @param {string[]} sessionCodes keys under `sessions`
 * @param {Object<string,string[]>} orgSessionCodes slug -> keys under
 *   `orgs/<slug>/sessions`
 */
function sessionLocationsFromKeys(sessionCodes, orgSessionCodes) {
  const out = [];
  for (const code of sessionCodes || []) {
    out.push(Object.assign(locationFor(null, code), { metadataOnly: true }));
  }
  for (const slug of Object.keys(orgSessionCodes || {})) {
    for (const code of orgSessionCodes[slug] || []) {
      out.push(Object.assign(locationFor(slug, code), { metadataOnly: true }));
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
 * Turn one RTDB `?shallow=true` response body into a key list.
 *
 * ⚠️ THE FAILURE MODE THAT MATTERS IS AN EMPTY LIST, NOT AN EXCEPTION. This
 * feeds the retention purge: if a broken read returns `[]`, the job reports
 * "0 sessions", exits 0, and looks perfectly healthy while nothing is ever
 * deleted again — a storage-limitation breach that is invisible in the logs.
 * So anything that is not a genuine empty node THROWS. `null` is the one
 * legitimate empty: that is what RTDB returns for a path with no children.
 */
function shallowKeysOf(body, path) {
  if (body === null || body === undefined) return [];
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new Error(
      "shallow read of '" + path + "' returned " + typeof body +
      ", expected an object of keys or null. Refusing to treat this as an " +
      "empty tree — see the note above shallowKeysOf()."
    );
  }
  return Object.keys(body);
}

/**
 * Enumerate both trees WITHOUT reading a single session body.
 *
 * Why this exists: cleanup-stale-sessions needs `created/at` and `closed/at`
 * per session and nothing else — its own per-session read says so in a comment
 * — but it got its list from readSessionLocations(), which deep-reads all of
 * `sessions` and `orgs`. Every participant name, answer and chat turn was
 * therefore copied onto a GitHub Actions runner in the United States, daily,
 * and thrown away unused. Art. 5(1)(c). The bodies are still available to the
 * jobs that genuinely need them (backup, pseudonymised export).
 *
 * The Node Admin SDK cannot project children, and `once("value")` is always
 * deep, so this goes over the RTDB REST API, whose `?shallow=true` is exactly
 * the documented way to list keys without values.
 *
 * @param {object} opts
 * @param {string} opts.databaseURL   e.g. https://x-default-rtdb.europe-west1.firebasedatabase.app
 * @param {object} [opts.app]         firebase-admin app, for its credential
 * @param {function} [opts.fetchShallow] injectable `(path) => Promise<body>`, for tests
 */
async function readSessionLocationsShallow(opts) {
  const fetchShallow = (opts && opts.fetchShallow) || makeRestShallowReader(opts || {});

  const codes = shallowKeysOf(await fetchShallow("sessions"), "sessions");
  const slugs = shallowKeysOf(await fetchShallow("orgs"), "orgs");

  /* One extra request per org, because org sessions are a level deeper. There
   * is one org in production and it maps back to the default tree, so this is
   * a loop over ~0-1 items — but it is written as a loop because the rules
   * tree permits more. */
  const orgSessionCodes = {};
  for (const slug of slugs) {
    const p = "orgs/" + slug + "/sessions";
    orgSessionCodes[slug] = shallowKeysOf(await fetchShallow(p), p);
  }

  return sessionLocationsFromKeys(codes, orgSessionCodes);
}

/**
 * Default REST reader. Uses the admin credential's OAuth token in an
 * Authorization header — NOT the `?access_token=` query parameter RTDB also
 * accepts, so the credential never lands in a URL that something might log.
 */
function makeRestShallowReader(opts) {
  const base = String(opts.databaseURL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) {
    throw new Error("readSessionLocationsShallow needs an https databaseURL, got: " + base);
  }
  const cred = opts.app && opts.app.options && opts.app.options.credential;
  if (!cred || typeof cred.getAccessToken !== "function") {
    throw new Error(
      "readSessionLocationsShallow needs an admin app whose credential exposes " +
      "getAccessToken(). Pass { app } from initializeApp(), or supply " +
      "{ fetchShallow } directly."
    );
  }

  return async function fetchShallow(path) {
    const { access_token: token } = await cred.getAccessToken();
    const res = await fetch(base + "/" + path + ".json?shallow=true", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) {
      /* Never degrade to "no sessions" — see shallowKeysOf. The status alone
       * is logged; a REST error body can echo the path, which carries the
       * session code, and these logs are world-readable. */
      throw new Error("shallow read of '" + path + "' failed: HTTP " + res.status);
    }
    return res.json();
  };
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

module.exports = {
  sessionLocations,
  sessionLocationsFromKeys,
  readSessionLocations,
  readSessionLocationsShallow,
  shallowKeysOf,
  safeLabel
};
