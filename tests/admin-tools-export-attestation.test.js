/* tests/admin-tools-export-attestation.test.js
 *
 * admin-tools.js round 2 (2026-05-22): the SAP-aligned research export and the
 * per-participant attestation generator. Static source-text checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");

test("admin-tools.js still parses with the new tools", () => {
  assert.doesNotThrow(() => new Function(TOOLS));
});

test("participantRows derives per-cid contributions + university from the live data", () => {
  assert.match(TOOLS, /function participantRows\(\)/, "participantRows must exist");
  const fn = TOOLS.slice(TOOLS.indexOf("function participantRows"),
    TOOLS.indexOf("function participantRows") + 1400);
  assert.match(fn, /presence/, "must read presence for the participant set");
  assert.match(fn, /\.cid/, "contributions are keyed by clientId");
  assert.match(fn, /uniByCid/, "must recover university from answer entries");
  assert.match(fn, /contributed/, "must flag whether the participant contributed");
});

test("research export is pseudonymous, SAP-aligned JSON for the R pipeline", () => {
  assert.match(TOOLS, /function generateResearchExport\(\)/, "the export fn must exist");
  const fn = TOOLS.slice(TOOLS.indexOf("function generateResearchExport"),
    TOOLS.indexOf("function generateAttestations"));
  assert.match(fn, /pseudonymous: true/, "the bundle must declare pseudonymity");
  assert.doesNotMatch(fn, /name:/, "the exported participant rows must NOT carry names");
  assert.match(fn, /participants:.*decisions:.*rooms:|participants: participants/s,
    "must bundle participants + decisions + rooms");
  assert.match(fn, /jsonlite::fromJSON/, "must document the R read path");
  assert.match(fn, /application\/json/, "must download as JSON");
});

test("attestations are named, printable, page-broken certificates", () => {
  assert.match(TOOLS, /function generateAttestations\(\)/, "the attestation fn must exist");
  const fn = TOOLS.slice(TOOLS.indexOf("function generateAttestations"),
    TOOLS.indexOf("// Expose on window"));
  assert.match(fn, /page-break-after:always/, "each certificate must page-break for printing");
  assert.match(fn, /CANAMED_COMPETENCY_MAP\.competencies/, "must list the competencies practiced");
  assert.match(fn, /window\.print\(\)/, "must offer Print / Save as PDF");
  assert.match(fn, /cert-name/, "must render the participant's name on the certificate");
});

test("both tools are exposed + wired to lazy admin buttons", () => {
  assert.match(TOOLS, /window\.generateResearchExport = generateResearchExport/, "research export exposed");
  assert.match(TOOLS, /window\.generateAttestations = generateAttestations/, "attestations exposed");
  assert.match(HTML, /id="admin-research-btn"/, "research button exists");
  assert.match(HTML, /id="admin-attest-btn"/, "attestation button exists");
  assert.match(SCRIPT, /runAdminTool\("generateResearchExport"\)/, "research button wired");
  assert.match(SCRIPT, /runAdminTool\("generateAttestations"\)/, "attestation button wired");
});

test("the new button labels ship in en / fr / ja", () => {
  for (const key of ["impact.research", "impact.attest"]) {
    const n = (I18N.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length;
    assert.ok(n >= 3, key + " must be defined in en, fr and ja (got " + n + ")");
  }
});
