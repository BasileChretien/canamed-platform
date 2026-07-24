/* tests/cert-verification.test.js
 *
 * Certificate verification: each certificate carries a unique verification ID
 * (CNM-XXXXX-XXXXX). Originally this was a DETERMINISTIC hash of (session,
 * clientId) — but both inputs are readable by any session member (the pool keys
 * ARE the clientIds), so a classmate could recompute a peer's id and read their
 * credentials/<id> record. The published id is now CRYPTO-RANDOM and persisted
 * per participant at certIds/<code>/<clientId> (write-once, owner-only, outside
 * the sessions/ read-cascade); the facilitator export/attestations read it from
 * the admin-preloaded window._certIdByCid map. This pins:
 *   - canamedCertId() (the deterministic hash) is still well-formed/stable — it
 *     survives ONLY as the offline fallback, never as a published id;
 *   - the certificate builder embeds the id when one is supplied (and not else);
 *   - the student flow mints + persists a random id and publishes credentials
 *     under it, and the facilitator export sources the id from the preloaded map
 *     — so cert, registry and export agree WITHOUT a guessable join key.
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

test("the student cert flow mints a random id and persists it (not a guessable hash)", () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf("function downloadCertificatePdf"),
                          SCRIPT.indexOf("function downloadCertificatePdf") + 5000);
  assert.match(fn, /certId:/, "the cert data must carry certId");
  // The PUBLISHED id is crypto-random, persisted write-once under certIdPath so a
  // re-download reuses it — NOT the deterministic canamedCertId (which any
  // classmate could recompute from the pool keys to read a peer's credential).
  assert.match(fn, /randomCredentialId\(\)/, "the published id must be minted with randomCredentialId()");
  assert.match(fn, /certIdPath\(\s*sessionNum\s*,\s*clientId\s*\)/,
    "the id must be persisted per participant at certIdPath(sessionNum, clientId)");
  assert.match(fn, /credentials\/"\s*\+\s*certId/,
    "the credential record must be keyed by the minted id");
  assert.doesNotMatch(fn, /credentials\/"\s*\+\s*detId/,
    "detId (deterministic) must not be published as a credential id anymore");
});

test("the facilitator export sources the cert id from the preloaded map (not a recomputed hash)", () => {
  // The certId CSV column stays (pinned), but its VALUE now comes from the
  // admin-preloaded window._certIdByCid map — the id is random + persisted, so
  // the facilitator can't recompute it the way the old deterministic hash allowed.
  assert.match(ADMIN, /"session", "participant", "certId"/, "CSV header must include certId");
  assert.match(ADMIN, /_certIdByCid\s*&&\s*window\._certIdByCid\[cid\]/,
    "export id must be read from the admin-preloaded certIds map");
  assert.doesNotMatch(ADMIN, /canamedCertId\(/,
    "admin export must not recompute the (guessable) deterministic id anymore");
  // Attestations print the id on each named card (sourced from the same rows).
  assert.match(ADMIN, /Verification ID:/, "attestation cards must show the verification id");
});

test("the certificate embeds the verification id, with the QR hidden (2026-06-16, PI request)", () => {
  const fn = STUDENT_PDF.slice(STUDENT_PDF.indexOf("function buildCertificateDocDefinition"),
                               STUDENT_PDF.indexOf("function _safe"));
  assert.match(fn, /var certId = _str\(data\.certId/, "builder must read data.certId");
  // The QR was hidden at PI request (the baked-in verify URL would rot on a host
  // migration). The printed Verification ID is the verification surface now; no
  // qr node should be emitted. The verifyUrl + verify.html plumbing is left
  // intact so the QR can be restored by re-adding a { qr: ... } node here.
  assert.doesNotMatch(fn, /\{\s*qr:/, "the certificate QR node must be hidden (no { qr: ... } node)");
  // The id label is localized (EN "Verification ID" / FR / JA) via the STR table.
  assert.match(fn, /L\.certVerifyId/, "builder must label the id (localized)");
  // Guarded so a cert with no id renders no id block at all.
  assert.match(fn, /certId\s*\?\s*\{[\s\S]*L\.certVerifyId/, "the id block must be gated on certId presence");
});

test("_verifyUrl encodes the short /v?id= path (keeps the QR sparse)", () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf("function _verifyUrl"),
                          SCRIPT.indexOf("function _verifyUrl") + 700);
  assert.match(fn, /"\/v\?id="/, "verify URL must use the short /v?id= rewrite path");
  assert.doesNotMatch(fn, /verify\.html\?id=/, "verify URL must not bake in the long verify.html filename");
});

test("firebase.json rewrites /v to verify.html (so the short URL resolves)", () => {
  const fj = JSON.parse(fs.readFileSync(path.join(P, "firebase.json"), "utf8"));
  const rewrites = (fj.hosting && fj.hosting.rewrites) || [];
  const v = rewrites.find((r) => r.source === "/v");
  assert.ok(v, "a /v rewrite must exist");
  assert.equal(v.destination, "/verify.html", "/v must rewrite to verify.html");
});
