/* tests/cert-verification.test.js
 *
 * Certificate verification (2026-05-28): each certificate carries a unique,
 * deterministic verification ID (CNM-XXXXX-XXXXX) derived from (session,
 * participant) and a QR of it. The SAME id is recomputed in the facilitator's
 * research export + attestation list, which act as the registry a cert can be
 * checked against. This pins:
 *   - canamedCertId() is deterministic, well-formed, stable and distinct;
 *   - the certificate builder embeds the id + a QR when an id is supplied
 *     (and neither when it isn't);
 *   - the student flow and the facilitator export derive the id from the same
 *     (session | clientId) seed, so they agree.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const pure = require(path.join(P, "pure-utils.js"));
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const STUDENT_PDF = fs.readFileSync(path.join(P, "student-pdf.js"), "utf8");
const ADMIN = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");

const ID_RE = /^CNM-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/; // Crockford base32, no I/L/O/U

test("canamedCertId is deterministic, well-formed, stable and distinct", () => {
  const a = pure.canamedCertId("ABC-DEF|client-123");
  const b = pure.canamedCertId("ABC-DEF|client-123");
  const c = pure.canamedCertId("ABC-DEF|client-999");
  const d = pure.canamedCertId("XYZ-123|client-123");
  assert.match(a, ID_RE, "id must match CNM-XXXXX-XXXXX (Crockford base32)");
  assert.equal(a, b, "same seed → same id (so cert + registry agree)");
  assert.notEqual(a, c, "different participant → different id");
  assert.notEqual(a, d, "different session → different id");
});

test("canamedCertId is collision-light across many participants in a session", () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(pure.canamedCertId("S1|client-" + i));
  assert.equal(ids.size, 500, "500 distinct seeds should give 500 distinct ids");
});

test("the student cert flow seeds the id on (session | clientId)", () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf("function downloadCertificatePdf"),
                          SCRIPT.indexOf("function downloadCertificatePdf") + 1600);
  assert.match(fn, /certId:/, "the cert data must carry certId");
  assert.match(fn, /canamedCertId\(\s*\(sessionNum[^)]*\)\s*\+\s*"\|"\s*\+\s*\(clientId/,
    "id must be seeded on sessionNum | clientId");
});

test("the facilitator export + attestations recompute the id from the same seed", () => {
  // CSV participant rows include a certId column, seeded session | cid.
  assert.match(ADMIN, /"session", "participant", "certId"/, "CSV header must include certId");
  assert.match(ADMIN, /canamedCertId\(\s*\(\(typeof sessionNum[^)]*\)[^)]*\)\s*\+\s*"\|"\s*\+\s*cid\s*\)/,
    "export id must be seeded session | cid (matches the student's clientId seed)");
  // Attestations print the id on each named card.
  assert.match(ADMIN, /Verification ID:/, "attestation cards must show the verification id");
});

test("the certificate builder embeds the id + a QR only when an id is supplied", () => {
  const fn = STUDENT_PDF.slice(STUDENT_PDF.indexOf("function buildCertificateDocDefinition"),
                               STUDENT_PDF.indexOf("function _safe"));
  assert.match(fn, /var certId = _str\(data\.certId/, "builder must read data.certId");
  // QR encodes the verify URL when one is supplied (public verification flow),
  // and the bare id otherwise (facilitator-only path).
  assert.match(fn, /qr:\s*\(\s*verifyUrl\s*\|\|\s*certId\s*\)/,
    "QR must encode verifyUrl when present, else the bare id");
  assert.match(fn, /Verification ID/, "builder must label the id");
  // Guarded so a cert with no id renders neither the QR nor the id line.
  assert.match(fn, /certId\s*\?\s*\{[\s\S]*qr:/, "QR must be gated on certId presence");
});
