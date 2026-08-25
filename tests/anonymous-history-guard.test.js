"use strict";
/* Anonymous joiners must not get a `users/<uid>/history` record — issue #347.
 *
 * WHAT WENT WRONG, because the shape of it is the reason this test exists.
 * `pushSessionToHistory()` guarded on `!currentUser` alone. That reads as
 * "only for signed-in users", and the call site said so outright — "silent
 * no-op for anonymous joiners". But `handleAuthStateChange` does
 * `currentUser = user || null`, and an anonymous user IS a user, so the guard
 * admitted everyone. The platform signs every visitor in anonymously at
 * startup, so in practice it admitted all of them.
 *
 * Nothing surfaced it. Every READ path was already correctly gated, so the
 * records were written and never shown to the person they described: the data
 * export checks `!currentUser.isAnonymous`, and `paintUserChip` hides the
 * account chip for anonymous users so the dialog that lists history cannot even
 * be opened. A behavioural test would have had to assert on the DATABASE to
 * catch it — asserting on the UI would have passed, because the UI was right.
 *
 * These are source-level assertions for that reason: what must hold is that the
 * write is gated, and no rendering check can observe that.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "script.js"),
  "utf8"
);

/** Body of a named function declaration, by brace matching. */
function bodyOf(name) {
  const start = SRC.indexOf("function " + name + "(");
  assert.notStrictEqual(start, -1, name + "() must exist");
  let depth = 0, i = SRC.indexOf("{", start);
  const from = i;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  assert.ok(i < SRC.length, name + "() braces must balance");
  return SRC.slice(from, i + 1);
}

test("pushSessionToHistory refuses anonymous users before touching the database", () => {
  const body = bodyOf("pushSessionToHistory");
  assert.match(body, /currentUser\.isAnonymous/,
    "the guard must test isAnonymous — !currentUser alone is TRUE for anonymous " +
    "users, which is exactly how this shipped");

  const write = body.indexOf("db.ref(");
  assert.notStrictEqual(write, -1, "the function must still write for real users");

  // The isAnonymous check and the return must be the SAME statement.
  //
  // Checking "is there a return somewhere between the two" looks equivalent and
  // is much weaker: the function has other early returns (!db, !code), so a
  // mutant that merely LOGS on isAnonymous and falls through still matched.
  // Mutation-testing caught that — the wide version reported a clean pass on
  // code that wrote the record for every anonymous joiner. Same trap as the
  // App Check consent-gate test.
  const firstIf = body.indexOf("if (");
  assert.notStrictEqual(firstIf, -1, "the function must open with a guard");
  const stmt = body.slice(firstIf, body.indexOf(";", firstIf) + 1);
  assert.match(stmt, /currentUser.isAnonymous/,
    "isAnonymous must be part of the guard condition itself, not a separate " +
    "branch that falls through to the write");
  assert.match(stmt, /return;/,
    "that same guard statement must return");
  assert.ok(firstIf < write, "the guard must precede the db write");
});

test("the write path is the ONLY thing that changed — reads stay gated", () => {
  // These were already correct, and the fix must not have disturbed them.
  // If a future change relaxes one, anonymous history becomes visible as well
  // as stored, which is a different and worse bug.
  assert.match(SRC, /if \(currentUser && !currentUser\.isAnonymous\) \{/,
    "the data export must keep excluding anonymous users from profile/history");
  const chip = bodyOf("paintUserChip");
  assert.match(chip, /!currentUser \|\| currentUser\.isAnonymous/,
    "paintUserChip must keep hiding the account chip for anonymous users — it " +
    "is what makes the history dialog unreachable for them");
});

test("the call-site comment matches what the code does", () => {
  // The original comment claimed a no-op for anonymous joiners while the code
  // did the opposite. A comment that lies is worse than no comment: it stops
  // the next reader from checking.
  const i = SRC.indexOf("pushSessionToHistory(sessionNum);");
  assert.notStrictEqual(i, -1, "the join flow must still log history");
  const preamble = SRC.slice(Math.max(0, i - 400), i);
  assert.match(preamble, /no-op for anonymous joiners/,
    "the call site should still describe the intent");
  assert.match(preamble, /#347/,
    "and should point at the issue, so the next reader knows it was verified " +
    "rather than assumed");
});

test("the reasoning survives next to the code, not only in git", () => {
  // The rationale lives in the block comment BEFORE the declaration, so read
  // from there — bodyOf() starts at the opening brace and would miss it. (The
  // first version of this test did exactly that and failed on a correct file.)
  const decl = SRC.indexOf("function pushSessionToHistory(");
  assert.notStrictEqual(decl, -1);
  const preamble = SRC.slice(Math.max(0, decl - 1600), decl);
  assert.match(preamble, /#347/, "the issue reference must stay with the guard");
  assert.match(preamble, /no retention job touches/,
    "the reason this mattered — users/ is unpurged — must be stated, or the " +
    "guard reads as a stylistic tidy-up and gets removed");
});
