/* tests/admin-tools-accreditation.test.js
 *
 * Lazy admin-tools.js chunk + the accreditation-evidence report (2026-05-22).
 * admin-tools.js holds the facilitator/decision-maker artifacts off the splash
 * critical path (lazy-loaded on dashboard open). First tool: a competency-map
 * → accreditation evidence report (per-competency activity + outcome), built
 * for an HCERES/JACME dossier.
 *
 * Static source-text checks + a node --check is run separately in CI's
 * "node --test" job via the e2e load. Here we assert structure/wiring.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const LOADER = fs.readFileSync(path.join(P, "script-loader.js"), "utf8");
const PERF = fs.readFileSync(path.join(P, "..", "..", "..", "tests-e2e", "perf.spec.js"), "utf8");
const SW = fs.readFileSync(path.join(P, "sw.js"), "utf8");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");

test("admin-tools.js is syntactically valid (parses with new Function)", () => {
  // Strip nothing — the file is a classic script; it must at least parse.
  assert.doesNotThrow(() => new Function(TOOLS), "admin-tools.js must parse");
});

test("CANAMED_COMPETENCY_MAP maps competencies to frameworks + evidence", () => {
  assert.match(TOOLS, /var CANAMED_COMPETENCY_MAP = \{/, "the competency map must be defined");
  assert.match(TOOLS, /competencies:\s*\[/, "must list competencies");
  for (const field of ["id:", "label:", "framework:", "localCode:", "evidencedBy:"]) {
    assert.match(TOOLS, new RegExp(field), "each competency must carry " + field);
  }
  // SPIKES breaking-bad-news + a localCode slot for the national framework.
  assert.match(TOOLS, /SPIKES/, "breaking-bad-news must map to SPIKES");
  assert.match(TOOLS, /dec_prognosis/, "must reference real decision ids for evidence");
});

test("generateAccreditationReport builds a printable, escaped report keyed on outcomes", () => {
  assert.match(TOOLS, /function generateAccreditationReport\(\)/, "the report fn must exist");
  assert.match(TOOLS, /committed.*correct|correct.*committed/s,
    "must score committed decisions against the correct option");
  assert.match(TOOLS, /window\.print\(\)/, "must offer Print / Save as PDF");
  assert.match(TOOLS, /Accreditation/i, "must be titled for accreditation");
  assert.match(TOOLS, /window\.generateAccreditationReport = generateAccreditationReport/,
    "must be exposed on window for the admin button");
  // Pseudonymity posture stated.
  assert.match(TOOLS, /aggregate \+ pseudonymous/i, "must declare aggregate + pseudonymous");
});

test("the chunk is lazy-loaded and wired to the admin button", () => {
  assert.match(LOADER, /function ensureAdminTools\(\)\s*\{\s*return loadScript\(v\("admin-tools\.js"\)\)/,
    "loader must expose ensureAdminTools");
  assert.match(LOADER, /ensureAdminTools/, "ensureAdminTools must be in the public API");
  assert.match(HTML, /id="admin-accred-btn"/, "the accreditation button must exist");
  assert.match(SCRIPT, /function runAdminTool\(fnName\)/, "runAdminTool lazy-invoke helper must exist");
  assert.match(SCRIPT, /ensureAdminTools\(\)\.then\(call\)/, "runAdminTool must lazy-load then invoke");
  assert.match(SCRIPT, /runAdminTool\("generateAccreditationReport"\)/, "the button must call the report");
});

test("admin-tools.js is excluded from the splash budget + precached for offline", () => {
  assert.match(PERF, /"admin-tools\.js"/, "perf LAZY_CHUNKS must exclude admin-tools.js from the budget");
  assert.match(SW, /"\/admin-tools\.js"/, "sw.js must precache admin-tools.js for offline");
});

test("the accreditation button label ships in en / fr / ja", () => {
  const n = (I18N.match(/"impact\.accred":/g) || []).length;
  assert.ok(n >= 3, "impact.accred must be defined in en, fr and ja (got " + n + ")");
});
