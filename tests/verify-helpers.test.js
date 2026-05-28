/* tests/verify-helpers.test.js — PIS v2 §18 public verification primitives.
 *
 * Pins the three new pure-utils helpers that the verify flow depends on:
 *   - randomCredentialId()    — unguessable, well-formed, no collisions in bulk;
 *   - normalizeName()         — same person types the same way (NFC + casefold);
 *   - credentialNameHash()    — deterministic SHA-256 hex of normalised name|session.
 * If any of these drift, certificates issued before vs after the drift won't
 * verify against each other.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const pure = require(path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "pure-utils.js"));

const ID_RE = /^CNM-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

test("randomCredentialId is well-formed and crypto-random (no bulk collisions)", () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = pure.randomCredentialId();
    assert.match(id, ID_RE, "id must be CNM-XXXXX-XXXXX with Crockford alphabet");
    ids.add(id);
  }
  assert.equal(ids.size, 2000, "2000 random ids should all be distinct");
});

test("normalizeName: NFC + collapse whitespace + casefold", () => {
  assert.equal(pure.normalizeName("  Akari   TANAKA "), "akari tanaka");
  assert.equal(pure.normalizeName("Basile Chrétien"), "basile chrétien");
  // Decomposed (é = e + ́) → composed (é) so the same person typing either way verifies.
  assert.equal(pure.normalizeName("Basile Chrétien"), pure.normalizeName("Basile Chrétien"));
  assert.equal(pure.normalizeName(null), "");
  assert.equal(pure.normalizeName(undefined), "");
});

test("credentialNameHash is SHA-256 hex of (normalised name | session) and is deterministic", async () => {
  const a = await pure.credentialNameHash("Akari Tanaka", "ABC-DEF");
  const b = await pure.credentialNameHash("akari   tanaka", "ABC-DEF");          // whitespace + case
  const c = await pure.credentialNameHash("Akari Tanaka", "OTHER-SESSION");      // different session
  const d = await pure.credentialNameHash("Akari Tanakaa", "ABC-DEF");           // different name
  assert.match(a, /^[0-9a-f]{64}$/, "hash must be 64-hex (SHA-256)");
  assert.equal(a, b, "normalisation must make whitespace + case typos verify equal");
  assert.notEqual(a, c, "session is part of the input → different sessions → different hash");
  assert.notEqual(a, d, "different name → different hash");
});

test("credentialNameHash handles unicode normalisation correctly", async () => {
  const composed   = await pure.credentialNameHash("Chrétien",    "S");
  const decomposed = await pure.credentialNameHash("Chrétien", "S");
  assert.equal(composed, decomposed,
    "NFC-normalised input must agree across composed/decomposed Unicode");
});
