/* tests/facilitator-kit-compliance.test.js
 *
 * Self-service facilitator kit + compliance/accessibility statement (2026-05-22):
 * two static pages (facilitator-guide.html, compliance.html) so any faculty can
 * run a session and the DPO/accreditation can find the conformance statement,
 * discoverable from the admin chrome and precached for offline. Static checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const COMPLIANCE = fs.readFileSync(path.join(P, "compliance.html"), "utf8");
const GUIDE = fs.readFileSync(path.join(P, "facilitator-guide.html"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SW = fs.readFileSync(path.join(P, "sw.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("compliance.html is a complete page covering accessibility, data protection, security", () => {
  assert.match(COMPLIANCE, /<!doctype html>/i, "must be a full HTML document");
  assert.match(COMPLIANCE, /<title>[^<]*Compliance/i, "must be titled");
  for (const section of ["Accessibility", "Data protection", "Security"]) {
    assert.match(COMPLIANCE, new RegExp("<h2[^>]*>\\s*" + section, "i"), "must cover " + section);
  }
  // The standards a DPO / accreditor looks for.
  for (const term of ["WCAG", "GDPR", "APPI", "RGAA", "axe-core", "pseudonym", "DOMPurify", "App Check"]) {
    assert.match(COMPLIANCE, new RegExp(term, "i"), "must mention " + term);
  }
  assert.match(COMPLIANCE, /href="privacy\.html"/, "must link the privacy notice");
});

test("facilitator-guide.html is a printable 5-step quick-start", () => {
  assert.match(GUIDE, /<!doctype html>/i, "must be a full HTML document");
  // CSP-compliant: external stylesheet + a data-print button wired by docs-page.js
  // (no inline <style> / onclick — production CSP is style-src/script-src 'self').
  assert.match(GUIDE, /<link rel="stylesheet" href="docs-page\.css">/, "must use the external stylesheet");
  assert.match(GUIDE, /data-print/, "must offer a (CSP-safe) Print button");
  assert.doesNotMatch(GUIDE, /<style>/, "must not use an inline <style> block (blocked by prod CSP)");
  assert.doesNotMatch(GUIDE, /onclick=/, "must not use inline onclick (blocked by prod CSP)");
  assert.match(GUIDE, /src="docs-page\.js"/, "must load the print-wiring script");
  const steps = (GUIDE.match(/<li>/g) || []).length;
  assert.ok(steps >= 5, "must have a multi-step structure (got " + steps + " <li>)");
  // Mentions the core flow + the reports it produces.
  for (const term of ["session code", "SPIKES", "Advance all", "End session",
                      "Impact report", "Accreditation", "Attestations", "Program overview"]) {
    assert.match(GUIDE, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      "the guide must reference " + term);
  }
  assert.match(GUIDE, /href="compliance\.html"/, "must link the compliance statement");
});

test("both pages are discoverable from the admin chrome + precached for offline", () => {
  assert.match(HTML, /href="facilitator-guide\.html"/, "admin chrome must link the facilitator guide");
  assert.match(HTML, /href="compliance\.html"/, "admin chrome must link the compliance statement");
  assert.match(SW, /"\/facilitator-guide\.html"/, "sw.js must precache the facilitator guide");
  assert.match(SW, /"\/compliance\.html"/, "sw.js must precache the compliance statement");
});

test("the doc-link labels ship in en / fr / ja", () => {
  for (const key of ["impact.guide", "impact.compliance"]) {
    const n = (I18N.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length;
    assert.ok(n >= 3, key + " must be defined in en, fr and ja (got " + n + ")");
  }
});
