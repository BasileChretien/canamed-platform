/* tests/recovery-code.test.js
 *
 * Unit tests for lib.generateRecoveryCode() — the D21 per-session recovery
 * secret. The recovery code is the security boundary for resetting a
 * forgotten admin password (it gates _superadminReset in the RTDB rules,
 * which gates the adminPasswordHash overwrite), so its shape, charset,
 * length and non-determinism are pinned here.
 *
 * crypto.getRandomValues is provided by Node's global webcrypto (Node 20+),
 * which lib.js's generateRecoveryCode relies on — same as generateSessionCode.
 */

const test = require("node:test");
const assert = require("node:assert");

const lib = require("../docs/Third_session/PBL_platform/lib.js");

// The unambiguous 31-char alphabet shared with generateSessionCode (no
// i/l/o/0/1). Recovery codes are 12 chars formatted xxxx-xxxx-xxxx.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const FORMAT = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/;

test("generateRecoveryCode: exported from lib", () => {
  assert.strictEqual(typeof lib.generateRecoveryCode, "function",
    "lib must export generateRecoveryCode()");
});

test("generateRecoveryCode: matches the xxxx-xxxx-xxxx format + charset", () => {
  for (let i = 0; i < 200; i++) {
    const code = lib.generateRecoveryCode();
    assert.match(code, FORMAT,
      "recovery code must be 3 groups of 4 chars from the unambiguous alphabet, joined by dashes: " + code);
  }
});

test("generateRecoveryCode: total length is 14 (12 chars + 2 dashes), within the 8..60 rule bound", () => {
  const code = lib.generateRecoveryCode();
  assert.strictEqual(code.length, 14, "formatted recovery code must be 14 chars long");
  // The RTDB rule (.validate) requires code length >= 8 && <= 60.
  assert.ok(code.length >= 8 && code.length <= 60,
    "recovery code length must satisfy the rule's 8..60 bound");
});

test("generateRecoveryCode: every character is in the unambiguous alphabet (no dashes counted)", () => {
  const code = lib.generateRecoveryCode().replace(/-/g, "");
  assert.strictEqual(code.length, 12, "the code carries 12 alphabet chars");
  for (const ch of code) {
    assert.ok(ALPHABET.indexOf(ch) >= 0,
      "char '" + ch + "' is outside the unambiguous alphabet");
  }
  // explicitly reject the visually-ambiguous chars the alphabet drops
  assert.doesNotMatch(code, /[ilo01]/,
    "recovery code must not contain visually ambiguous characters i/l/o/0/1");
});

test("generateRecoveryCode: is non-deterministic across calls", () => {
  const seen = new Set();
  const N = 500;
  for (let i = 0; i < N; i++) seen.add(lib.generateRecoveryCode());
  // With ~59.5 bits of entropy, 500 draws colliding is astronomically
  // unlikely; require all distinct. A constant/low-entropy generator would
  // fail here.
  assert.strictEqual(seen.size, N,
    "expected " + N + " distinct codes (got " + seen.size + ") — generator is not random enough");
});

test("generateRecoveryCode: documented entropy is >= ~59 bits", () => {
  // 31^12 possible codes. log2(31^12) = 12 * log2(31) ≈ 59.45 bits.
  const bits = 12 * Math.log2(ALPHABET.length);
  assert.ok(bits >= 59 && bits < 61,
    "recovery code entropy should be ~59.5 bits (12 chars over a 31-char alphabet); got " + bits.toFixed(2));
});

test("generateRecoveryCode: distinct from generateSessionCode shape", () => {
  // A session code is 3+3 (abc-def); a recovery code is 4+4+4. They must not
  // be confusable — the recovery code is a secret, the session code is read
  // aloud to a room.
  const rec = lib.generateRecoveryCode();
  const sess = lib.generateSessionCode();
  assert.notStrictEqual(rec.length, sess.length,
    "recovery code (14) and session code (7) must differ in length");
});
