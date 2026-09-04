/* tests/session-code-entropy.test.js
 *
 * Annex VI G3 — the session code is the effective access control on a session's
 * metadata and its entire authored scenario, so the DPA states its strength as a
 * number. This test derives that number FROM `generateSessionCode()` and fails
 * if the DPA's figure stops matching.
 *
 * WHY. This pack has already had to correct one entropy claim that drifted:
 * "R2's entropy claim corrected from ~80 to ≤50 bits" (v0.2 changelog). A
 * strength figure in a legal document is exactly the kind of assertion nobody
 * re-derives, and changing an alphabet is exactly the kind of edit nobody
 * connects to a legal document. This links them.
 *
 * It does NOT assert the design is adequate — that is the open decision recorded
 * at G3. It asserts only that the number written down is the number the code
 * produces.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const libSrc = fs.readFileSync(path.join(PLATFORM, "lib.js"), "utf8");
const dpa = fs.readFileSync(path.join(PLATFORM, "legal", "dpa-draft.md"), "utf8");

/** The alphabet and length, read out of the generator itself. */
function generatorFacts() {
  const fn = libSrc.slice(libSrc.indexOf("function generateSessionCode"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  const alpha = body.match(/const alphabet = "([^"]+)"/);
  const len = body.match(/chars\.length < (\d+)/);
  assert.ok(alpha, "could not find the alphabet in generateSessionCode()");
  assert.ok(len, "could not find the code length in generateSessionCode()");
  return { alphabet: alpha[1], length: Number(len[1]) };
}

test("the generator's alphabet is unambiguous and uniformly sampled", () => {
  const { alphabet, length } = generatorFacts();
  assert.strictEqual(new Set(alphabet).size, alphabet.length,
    "the alphabet contains a duplicate, which skews the distribution");
  for (const c of "ilo01") {
    assert.ok(!alphabet.includes(c),
      `'${c}' is ambiguous when a code is read aloud or written down`);
  }
  assert.ok(length >= 6, `code length fell to ${length}`);

  /* Rejection sampling, not a bare modulo: without the cutoff the low symbols
     of the alphabet would be more likely than the high ones, and the real
     strength would be below the figure this test then certifies. */
  const fn = libSrc.slice(libSrc.indexOf("function generateSessionCode"));
  assert.match(fn.slice(0, 600), /cutoff/,
    "generateSessionCode no longer rejection-samples, so the keyspace is no " +
    "longer uniform and the entropy figure below overstates it");
  assert.match(fn.slice(0, 600), /crypto\.getRandomValues/,
    "generateSessionCode no longer uses a CSPRNG");
});

test("the DPA states the keyspace this generator actually produces", () => {
  const { alphabet, length } = generatorFacts();
  const keyspace = Math.pow(alphabet.length, length);
  const bits = Math.log2(keyspace);

  const grouped = keyspace.toLocaleString("en-US");   // e.g. 887,503,681
  assert.ok(dpa.includes(grouped),
    `the DPA does not state the real keyspace ${grouped} ` +
    `(${alphabet.length} symbols ^ ${length} chars). Annex VI G3 quotes a ` +
    `number; if the generator changed, the legal text must change with it.`);

  const stated = dpa.match(/~(\d+\.\d)\s*bits/);
  assert.ok(stated, "the DPA no longer states a bit-strength for the code");
  assert.ok(Math.abs(Number(stated[1]) - bits) < 0.1,
    `the DPA says ~${stated[1]} bits; the generator yields ${bits.toFixed(2)}`);
});

test("the alphabet string is quoted verbatim in the DPA", () => {
  /* So a reader can check the derivation without opening lib.js. */
  const { alphabet } = generatorFacts();
  assert.ok(dpa.includes(alphabet),
    "Annex VI G3 no longer quotes the generator's alphabet verbatim");
});
