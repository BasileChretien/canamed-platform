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
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // 32 chars, mirrors pure-utils

test("randomCredentialId is well-formed and crypto-random (no bulk collisions)", () => {
  /* On the collision assertion below: it draws K=2000 from N=2^50 (ten 5-bit
   * groups over a 32-char alphabet), so by the birthday bound
   *
   *     P(>=1 collision) = 1 - exp(-K(K-1)/2N) = 1.8e-9   (~1 run in 563M)
   *
   * which is why "all distinct" is a safe assertion HERE. It was NOT safe for
   * generateSessionCode, whose 31^6 keyspace made the identical construction
   * fire once per ~1,777 runs and turn CI red on an unrelated PR (#307). Do not
   * copy this shape to a smaller keyspace without redoing that arithmetic.
   *
   * More to the point, distinctness is the WEAK property. It is nearly blind to
   * the defect that would actually matter: a keyspace collapse. Slicing 4-bit
   * groups instead of 5 would cut the keyspace 1024-fold to 2^40 and halve the
   * reachable alphabet, and this test would STILL pass (lambda rises only to
   * 1.8e-6). The published cert id is what stops a classmate deriving a peer's
   * credential (#239), so the two tests below pin the bit-level construction
   * deterministically instead of sampling for it. */
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = pure.randomCredentialId();
    assert.match(id, ID_RE, "id must be CNM-XXXXX-XXXXX with Crockford alphabet");
    ids.add(id);
  }
  assert.equal(ids.size, 2000, "2000 random ids should all be distinct");
});

/* `globalThis.crypto` in Node is an accessor with a GETTER AND NO SETTER, so a
 * plain `global.crypto = stub` is silently ignored and the code under test keeps
 * using real randomness — the tests below would then assert nothing. It IS
 * configurable, so defineProperty is the way in; the original descriptor is
 * restored either way. (Same technique as tests/lib.test.js.) */
function withStubbedCrypto(getRandomValues, body) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues }, configurable: true, writable: true
  });
  assert.strictEqual(
    crypto.getRandomValues, getRandomValues,
    "the crypto stub did not take effect — globalThis.crypto is a getter-only " +
      "accessor, so plain assignment is silently ignored"
  );
  try {
    return body();
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
}

// Pack a bit-string into the Uint8Array the generator asks for.
function fillFromBits(buf, bits) {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(bits.slice(i * 8, i * 8 + 8).padEnd(8, "0"), 2);
  }
  return buf;
}

test("randomCredentialId reads its bits from crypto.getRandomValues", () => {
  // A Math.random() re-implementation would pass the format and distinctness
  // assertions above while making every published cert id predictable from
  // PRNG state — the exact property #239 introduced this function to get. So
  // assert the crypto bytes are CONSUMED and that they REACH the output.
  for (const [byte, expected] of [[0x00, "CNM-00000-00000"], [0xff, "CNM-ZZZZZ-ZZZZZ"]]) {
    let calls = 0;
    const id = withStubbedCrypto(
      (buf) => { calls++; buf.fill(byte); return buf; },
      pure.randomCredentialId
    );
    assert.ok(calls > 0, "crypto.getRandomValues was never called — the id is not crypto-random");
    assert.strictEqual(
      id, expected,
      "with every random byte = 0x" + byte.toString(16) + " the id must be " +
        expected + "; got " + id + ", so the random bytes are not what reaches the output"
    );
  }
});

test("randomCredentialId slices FIVE bits per character, so all 32 are reachable", () => {
  // The whole alphabet must be addressable, and the slice width is the thing
  // that decides it: at 4 bits only 16 of the 32 characters can ever appear and
  // the keyspace drops from 2^50 to 2^40. Feed a bit pattern that repeats one
  // 5-bit value and require that value's character in all ten slots — done for
  // every value, this pins the 5-bit -> Crockford map exactly.
  const seen = new Set();
  for (let v = 0; v < 32; v++) {
    const bits = v.toString(2).padStart(5, "0").repeat(12);   // 60 bits; 50 are used
    const id = withStubbedCrypto(
      (buf) => fillFromBits(buf, bits),
      pure.randomCredentialId
    );
    const expected = "CNM-" + CROCK[v].repeat(5) + "-" + CROCK[v].repeat(5);
    assert.strictEqual(
      id, expected,
      "a repeating 5-bit group " + v + " must render as " + expected + "; got " + id
    );
    seen.add(CROCK[v]);
  }
  assert.strictEqual(seen.size, 32,
    "all 32 Crockford characters must be reachable — fewer means a truncated slice");
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
