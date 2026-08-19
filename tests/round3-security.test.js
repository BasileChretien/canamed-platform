/* tests/round3-security.test.js
 *
 * Lock-in tests for the Round-3 security-specialist-agent fixes
 * (see sim-output/round3-{owasp,firebase,supplychain,privacy}.md).
 *
 * Scope: targeted, low-risk hardening — full remediation of the agents'
 * harder findings (server-side admin auth, clientMapping migration,
 * DOMPurify) is tracked as follow-up work and not closed here.
 *
 *   S1  /sessions/$sessionId/rooms/$roomId/score/auto/$eventId becomes
 *       write-once (!data.exists()). Closes the score-clobber path
 *       flagged by the Firebase-rules agent (FINDING-05).
 *
 *   S2  Same lock on score/penalties/$eventId.
 *
 *   S3  Same locks on the /orgs/$orgSlug/sessions/... mirror paths.
 *
 *   S4  CSP no longer references the silently-404 /_csp_report endpoint
 *       (supply-chain agent finding 2).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const RULES = JSON.parse(
  fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8"));
const FIREBASE_JSON_RAW = fs.readFileSync(
  path.join(PLATFORM, "firebase.json"), "utf8");
const FIREBASE = JSON.parse(FIREBASE_JSON_RAW);

// Helpers
function scoreAutoLegacy() {
  return RULES.rules.sessions["$sessionId"].rooms["$roomId"]
    .score.auto["$eventId"];
}
function scorePenaltiesLegacy() {
  return RULES.rules.sessions["$sessionId"].rooms["$roomId"]
    .score.penalties["$eventId"];
}
function scoreAutoOrgs() {
  return RULES.rules.orgs["$orgSlug"].sessions["$sessionId"].rooms["$roomId"]
    .score.auto["$eventId"];
}
function scorePenaltiesOrgs() {
  return RULES.rules.orgs["$orgSlug"].sessions["$sessionId"].rooms["$roomId"]
    .score.penalties["$eventId"];
}

// ------------------------------------------------------------------
// S1, S2 — legacy /sessions score paths are write-once
// ------------------------------------------------------------------
/* Hosting serves the platform directory itself (`"public": "."`), so ANY file
 * committed under docs/Third_session/PBL_platform/ is published unless
 * firebase.json ignores it. Verified against production 2026-08-19:
 * /RUNBOOK.md, /OPERATOR_INCIDENT_RUNBOOK.md and /ARCHITECTURE/data-model.md
 * all return 200 text/markdown; only README.md (ignored) 404s.
 *
 * That is tolerable for docs already public in this repo. It is NOT tolerable
 * for legal/, which holds UNREVIEWED drafts with unfilled bracketed slots — a
 * DPA, a participant consent form and a facilitator privacy notice. The risk is
 * not secrecy (the repo is public); it is that an unreviewed draft served from
 * the PLATFORM'S OWN DOMAIN reads as the operative legal document, and is
 * indexable as one. A draft consent form at canamed-69785.web.app/legal/ is a
 * different claim from the same file in a git tree.
 *
 * Guarding it because the fix is one line of config that nothing else enforces,
 * and the directory it protects does not exist on main yet (it arrives with
 * PR #236) — so a silent drop would go unnoticed until the drafts were live. */
test("firebase.json keeps the legal drafts OFF the public site", () => {
  const ignore = FIREBASE.hosting.ignore || [];
  assert.ok(ignore.includes("legal/**"),
    'hosting.ignore must contain "legal/**" — Hosting serves "." so legal/ ' +
    "would otherwise be published at /legal/<draft>.md on the next deploy");
});

test("Round3-S1: /sessions/.../score/auto/$eventId is write-once (!data.exists)", () => {
  const w = scoreAutoLegacy()[".write"];
  assert.ok(w.includes("!data.exists()"),
    "auto-score write must require !data.exists() to prevent clobber: " + w);
  // Must still require auth + open session.
  assert.ok(w.includes("auth != null"),
    "auto-score write must require auth: " + w);
  assert.ok(w.includes("!root.child('sessions').child($sessionId).child('closed').exists()"),
    "auto-score write must be refused on closed sessions: " + w);
});

test("Round3-S2: /sessions/.../score/penalties/$eventId is write-once (!data.exists)", () => {
  const w = scorePenaltiesLegacy()[".write"];
  assert.ok(w.includes("!data.exists()"),
    "penalty write must require !data.exists() to prevent clobber: " + w);
});

// ------------------------------------------------------------------
// S3 — orgs mirror paths
// ------------------------------------------------------------------
test("Round3-S3: /orgs/.../score/auto/$eventId is write-once", () => {
  const w = scoreAutoOrgs()[".write"];
  assert.ok(w.includes("!data.exists()"),
    "orgs auto-score write must require !data.exists(): " + w);
});

test("Round3-S3: /orgs/.../score/penalties/$eventId is write-once", () => {
  const w = scorePenaltiesOrgs()[".write"];
  assert.ok(w.includes("!data.exists()"),
    "orgs penalty write must require !data.exists(): " + w);
});

// ------------------------------------------------------------------
// S4 — CSP no longer references the 404 report endpoint
// ------------------------------------------------------------------
test("Round3-S4: CSP no longer references /_csp_report (silent 404)", () => {
  assert.doesNotMatch(FIREBASE_JSON_RAW, /_csp_report/,
    "firebase.json must not configure the dead /_csp_report endpoint");
  // The CSP itself must not carry a `report-to` or `report-uri` directive
  // pointing at the dead endpoint.
  const headers = FIREBASE.hosting.headers
    .flatMap(h => h.headers || [])
    .filter(h => h.key === "Content-Security-Policy");
  assert.ok(headers.length >= 1, "CSP header must still be present");
  const csp = headers[0].value;
  assert.doesNotMatch(csp, /report-to\s+csp-endpoint/,
    "CSP must not reference the removed csp-endpoint reporting group");
});
test("Round3-S4: core security headers retained", () => {
  // Sanity check: removing the report-to plumbing must NOT have
  // collateral-damaged the other security headers.
  const headers = FIREBASE.hosting.headers
    .flatMap(h => h.headers || []);
  const keys = headers.map(h => h.key);
  for (const required of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "Permissions-Policy"
  ]) {
    assert.ok(keys.includes(required),
      "header " + required + " must still be set in firebase.json");
  }
});
