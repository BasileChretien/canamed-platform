"use strict";
/* Unit tests for the research-export pseudonymisation transform.
 * Guards the de-identification fixes from the 2026-05-30 security review. */

const test = require("node:test");
const assert = require("node:assert");
const {
  pseudonymiseSession,
  pseudoCode,
  normName,
  REDACTED_NAME
} = require("../scripts/lib/pseudonymise");

// A representative closed session covering every field the review flagged.
function sampleSession() {
  return {
    closed: { at: 1000 },
    adminPasswordHash: "deadbeef-secret",
    created: { by: "Dr Facilitator", at: 1 },                 // facilitator name (not in pool)
    _adminPresence: { by: "Dr Facilitator", at: 2 },          // facilitator transient
    _superadminReset: { by: "Dr Facilitator", code: "ZZZ9", requestedAt: 3 },
    pool: {
      c1: { name: "Alice", university: "Caen", at: 10 },
      c2: { name: "Bob", university: "Nagoya", at: 20 },
      c3: { name: "Alice", university: "Caen", at: 30 }       // DUPLICATE display name
    },
    rooms: {
      r1: {
        uidMembers: { uidA: true },
        answers: {
          a1: { by: "Alice", university: "Caen", text: "differential is X" },
          a2: { by: "Bob", text: "I agree" }
        },
        score: {
          manual: { m1: { by: "Dr Facilitator", points: 5 } } // facilitator awarder
        },
        moduleA: {
          scoring: { awarded: { fam1: { points: 2 } } },
          chat: {                                              // FREE-TEXT — must be dropped
            t1: { role: "user", content: "Hi, I'm Alice, my question is...", at: 11 },
            t2: { role: "assistant", content: "I am Mr Lefebvre...", at: 12 }
          }
        }
      }
    }
  };
}

test("participant names in pool/name and by-fields become Student-A/B by join order", () => {
  const linkage = {};
  const out = pseudonymiseSession(sampleSession(), "S1", linkage);
  assert.strictEqual(out.pool.c1.name, "Student-A"); // Alice joined first
  assert.strictEqual(out.pool.c2.name, "Student-B"); // Bob second
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
  assert.strictEqual(out.rooms.r1.answers.a2.by, "Student-B");
  assert.strictEqual(linkage.S1.Alice, "Student-A");
  assert.strictEqual(linkage.S1.Bob, "Student-B");
});

test("duplicate display names are still fully mapped — no plaintext survivor", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  // The third participant also named "Alice" must NOT keep the plaintext name.
  assert.strictEqual(out.pool.c3.name, "Student-A");
  const blob = JSON.stringify(out);
  assert.ok(!/Alice/.test(blob), "no occurrence of the real name 'Alice' may remain");
  assert.ok(!/Bob/.test(blob), "no occurrence of the real name 'Bob' may remain");
});

test("facilitator names (not in pool) are redacted everywhere, never passed through", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.strictEqual(out.created.by, REDACTED_NAME);
  assert.strictEqual(out.rooms.r1.score.manual.m1.by, REDACTED_NAME);
  const blob = JSON.stringify(out);
  assert.ok(!/Facilitator/.test(blob), "facilitator real name must not survive");
});

test("facilitator transient subtrees and the admin hash are dropped", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.ok(!("adminPasswordHash" in out));
  assert.ok(!("_adminPresence" in out));
  assert.ok(!("_superadminReset" in out));
  const blob = JSON.stringify(out);
  assert.ok(!/ZZZ9/.test(blob), "recovery code must not survive");
});

test("free-text LLM chat turns are dropped entirely", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.ok(!("chat" in out.rooms.r1.moduleA), "chat subtree must be removed");
  const blob = JSON.stringify(out);
  assert.ok(!/my question is/.test(blob), "free-text content must not survive");
  // Non-free-text scoring under moduleA must be preserved.
  assert.strictEqual(out.rooms.r1.moduleA.scoring.awarded.fam1.points, 2);
});

test("university is bucketed to Univ-N consistently within the session", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  const caen = out.pool.c1.university;
  const nagoya = out.pool.c2.university;
  assert.match(caen, /^Univ-\d+$/);
  assert.match(nagoya, /^Univ-\d+$/);
  assert.notStrictEqual(caen, nagoya);                 // distinct universities -> distinct codes
  assert.strictEqual(out.pool.c3.university, caen);    // same university -> same code
  assert.strictEqual(out.rooms.r1.answers.a1.university, caen); // consistent in answer objects too
  const blob = JSON.stringify(out);
  assert.ok(!/Caen/.test(blob) && !/Nagoya/.test(blob), "raw university names must not survive");
});

test("non-name fields are left intact", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.strictEqual(out.rooms.r1.answers.a1.text, "differential is X");
  assert.strictEqual(out.rooms.r1.score.manual.m1.points, 5);
  assert.strictEqual(out.closed.at, 1000);
  assert.strictEqual(out.created.at, 1);               // timestamp kept, only `by` redacted
});

test("name matching is whitespace/NFC tolerant", () => {
  const sess = {
    pool: { c1: { name: "Alice", at: 1 } },
    rooms: { r1: { answers: { a1: { by: "  Alice  " } } } }   // padded variant
  };
  const out = pseudonymiseSession(sess, "S1", {});
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
});

test("input is not mutated (deep copy)", () => {
  const sess = sampleSession();
  const before = JSON.stringify(sess);
  pseudonymiseSession(sess, "S1", {});
  assert.strictEqual(JSON.stringify(sess), before, "source session must be unchanged");
});

test("pseudoCode rolls over past 26 participants", () => {
  assert.strictEqual(pseudoCode(0), "Student-A");
  assert.strictEqual(pseudoCode(25), "Student-Z");
  assert.strictEqual(pseudoCode(26), "Student-AA");
  assert.strictEqual(pseudoCode(27), "Student-AB");
});

test("normName trims and NFC-normalises, passes non-strings through", () => {
  assert.strictEqual(normName("  x "), "x");
  assert.strictEqual(normName(5), 5);
  assert.strictEqual(normName(null), null);
});

test("participants named like Object built-ins are pseudonymised, not dropped", () => {
  const sess = {
    pool: {
      c1: { name: "__proto__", at: 1 },
      c2: { name: "toString", at: 2 },
      c3: { name: "constructor", at: 3 }
    },
    rooms: { r1: { answers: {
      a1: { by: "__proto__" }, a2: { by: "toString" }, a3: { by: "constructor" }
    } } }
  };
  const linkage = {};
  const out = pseudonymiseSession(sess, "S1", linkage);
  assert.strictEqual(out.pool.c1.name, "Student-A");
  assert.strictEqual(out.pool.c2.name, "Student-B");
  assert.strictEqual(out.pool.c3.name, "Student-C");
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
  assert.strictEqual(out.rooms.r1.answers.a2.by, "Student-B");
  assert.strictEqual(out.rooms.r1.answers.a3.by, "Student-C");
  // No real value should be a non-string (function/object) leftover.
  for (const a of Object.values(out.rooms.r1.answers)) {
    assert.strictEqual(typeof a.by, "string");
  }
  // Linkage round-trips through JSON with the literal "__proto__" key intact.
  const round = JSON.parse(JSON.stringify(linkage));
  assert.strictEqual(round.S1["__proto__"], "Student-A");
});

test("participant names appearing as bare array elements are scrubbed", () => {
  const sess = {
    pool: { c1: { name: "Alice", at: 1 } },
    rooms: { r1: { tags: ["Alice", "keep-me", "Alice"] } }
  };
  const out = pseudonymiseSession(sess, "S1", {});
  assert.deepStrictEqual(out.rooms.r1.tags, ["Student-A", "keep-me", "Student-A"]);
  assert.ok(!/Alice/.test(JSON.stringify(out)), "no real name may survive in arrays");
});

test("a session with no pool redacts every name/by and does not crash", () => {
  const sess = {
    created: { by: "Dr Fac", at: 1 },
    rooms: { r1: { answers: { a1: { by: "Whoever", text: "keep" } } } }
  };
  const out = pseudonymiseSession(sess, "S1", {});
  assert.strictEqual(out.created.by, REDACTED_NAME);
  assert.strictEqual(out.rooms.r1.answers.a1.by, REDACTED_NAME);
  assert.strictEqual(out.rooms.r1.answers.a1.text, "keep");
});
