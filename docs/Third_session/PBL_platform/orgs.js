/* ===========================================================================
 * CaNaMED orgs registry  -  multi-tenant partnership directory.
 *
 * One CaNaMED deployment can host SEVERAL university partnerships at once.
 * Each partnership ("org") is selected from the URL: `/o/{orgSlug}/` picks
 * the org, and the engine reads its branding + cohort list from this file.
 *
 *   canamed.web.app/                  -> default org (caen-nagoya), legacy schema
 *   canamed.web.app/o/caen-nagoya/    -> same org, explicit
 *   canamed.web.app/o/lyon-tokyo/     -> a different partnership
 *
 * To add a partnership: append an entry below. The slug must be lowercase
 * alphanumeric with hyphens (matches the URL pattern `/o/{slug}/`). All data
 * for a non-default org is namespaced under `orgs/{slug}/sessions/{code}/...`
 * in the Realtime Database (the default org keeps the legacy `sessions/...`
 * schema for back-compat).
 *
 * Required fields per org:
 *   - name:         display name (header, splash, browser title)
 *   - cohorts:      array of {id, label?, short?, country?, color?} pairs.
 *                   Two-cohort minimum, matches platform-config.js shape.
 *   - primary:      CSS colour for primary buttons / links (--primary)
 *   - accent:       CSS colour for accents / highlights (--accent)
 *   - privacyEmail: data-subject contact e-mail shown on the privacy page
 *
 * This file must load BEFORE platform-config.js and script.js (see the
 * <script> order in index.html).
 * =========================================================================== */
(function (root) {
"use strict";

root.CANAMED_DEFAULT_ORG = "caen-nagoya";

root.CANAMED_ORGS = {
  "caen-nagoya": {
    name: "Caen × Nagoya",
    cohorts: [
      {
        id: "Caen",
        label: "Université de Caen Normandie (France)",
        short: "Caen",
        country: "France",
        color: "#b45309"
      },
      {
        id: "Nagoya",
        label: "Nagoya University (Japan)",
        short: "Nagoya",
        country: "Japan",
        color: "#1763a6"
      }
    ],
    primary: "#1763a6",
    accent: "#e08a1e",
    privacyEmail: "canamed-ethics@unicaen.fr"
  }
  /* Add additional partnerships here. Example:
   *
   * "lyon-tokyo": {
   *   name: "Lyon × Tokyo",
   *   cohorts: [
   *     { id: "Lyon",  label: "Université Claude Bernard Lyon 1", short: "Lyon",  country: "France", color: "#7c3aed" },
   *     { id: "Tokyo", label: "University of Tokyo",                    short: "Tokyo", country: "Japan",  color: "#0ea5e9" }
   *   ],
   *   primary: "#7c3aed",
   *   accent:  "#0ea5e9",
   *   privacyEmail: "privacy@example.fr"
   * }
   */
};

/* ----------------------------------------------------------------------------
 * Helpers — pure functions, safe to call from any script that loads AFTER
 * orgs.js. Centralised here so script.js, theme-init.js and tests can all
 * agree on slug parsing + lookup semantics.
 * -------------------------------------------------------------------------- */

/* Parse the org slug from a URL pathname. Returns null when the pathname
 * doesn't carry an /o/{slug}/ prefix (caller falls back to the default org). */
function canamedParseOrgFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  // Match /o/{slug} where slug is lowercase alphanumeric + hyphens. The
  // closing slash is optional so `/o/foo` and `/o/foo/` both work.
  const m = pathname.match(/^\/o\/([a-z0-9-]+)(?:\/|$)/);
  return m ? m[1] : null;
}

/* Resolve a slug to its registered org config, or null if unknown. Useful
 * for the "org not found" splash error and for tests. */
function canamedResolveOrg(slug) {
  if (!slug || typeof slug !== "string") return null;
  const orgs = root.CANAMED_ORGS || {};
  return Object.prototype.hasOwnProperty.call(orgs, slug) ? orgs[slug] : null;
}

/* Build the storage prefix for an org's session subtree. The default org
 * keeps the legacy /sessions/{code}/ schema for back-compat; every other org
 * is namespaced under /orgs/{slug}/sessions/{code}/. */
function canamedSessionPrefix(slug) {
  const def = root.CANAMED_DEFAULT_ORG || "caen-nagoya";
  if (!slug || slug === def) return "sessions/";
  return "orgs/" + slug + "/sessions/";
}

root.canamedParseOrgFromPath = canamedParseOrgFromPath;
root.canamedResolveOrg = canamedResolveOrg;
root.canamedSessionPrefix = canamedSessionPrefix;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CANAMED_DEFAULT_ORG: root.CANAMED_DEFAULT_ORG,
    CANAMED_ORGS: root.CANAMED_ORGS,
    canamedParseOrgFromPath: canamedParseOrgFromPath,
    canamedResolveOrg: canamedResolveOrg,
    canamedSessionPrefix: canamedSessionPrefix
  };
}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
