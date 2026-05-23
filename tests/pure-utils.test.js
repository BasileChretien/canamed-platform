/* tests/pure-utils.test.js
 *
 * Unit tests for the pure helpers extracted from script.js into
 * pure-utils.js. Before the extraction these lived inside the 11k-line
 * script.js and had no unit coverage (only indirect E2E). Pulling them
 * into a require()-able module lets us pin their behaviour directly.
 */

const test = require("node:test");
const assert = require("node:assert");
const P = require("../docs/Third_session/PBL_platform/pure-utils.js");

test("pure-utils: module exposes the expected helpers", () => {
  for (const k of ["COLORS", "hashStr", "colorFor", "roomNames", "minsSince", "reducedMotion"]) {
    assert.ok(k in P, "pure-utils must export " + k);
  }
});

test("hashStr: deterministic, differs by input, lowercase hex", () => {
  assert.strictEqual(P.hashStr("Alice"), P.hashStr("Alice"));
  assert.notStrictEqual(P.hashStr("Alice"), P.hashStr("Bob"));
  assert.match(P.hashStr("Akari Tayuinosho"), /^[0-9a-f]+$/);
  // seed changes the hash
  assert.notStrictEqual(P.hashStr("x", 0), P.hashStr("x", 1));
});

test("colorFor: stable per name, a palette member, grey fallback for empty", () => {
  const c = P.colorFor("Akari");
  assert.strictEqual(c, P.colorFor("Akari"), "memoised + stable across calls");
  assert.ok(P.COLORS.includes(c), "must resolve to a palette colour");
  assert.strictEqual(P.colorFor(""), "#6b7785", "empty name → grey fallback");
  assert.strictEqual(P.colorFor(null), "#6b7785", "null name → grey fallback");
});

test("roomNames: builds Room 1..count, empty for 0", () => {
  assert.deepStrictEqual(P.roomNames(0), []);
  assert.deepStrictEqual(P.roomNames(1), ["Room 1"]);
  assert.deepStrictEqual(P.roomNames(4), ["Room 1", "Room 2", "Room 3", "Room 4"]);
});

test("minsSince: null for falsy, whole minutes otherwise", () => {
  assert.strictEqual(P.minsSince(0), null);
  assert.strictEqual(P.minsSince(null), null);
  assert.strictEqual(P.minsSince(undefined), null);
  assert.strictEqual(P.minsSince(Date.now() - 5 * 60000), 5);
});

test("reducedMotion: false when matchMedia is unavailable (Node)", () => {
  assert.strictEqual(P.reducedMotion(), false);
});
