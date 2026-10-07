/* tests/withdrawal-switch-docs.test.js
 *
 * The legal drafts must not say the session-or-marker rule is in force.
 *
 * It is not, after a merge: the rule on `withdrawals/…` requires a session or
 * a purge marker only once `ops/purgedMarkersBackfilledAt` exists, and an
 * operator's confirmed run of scripts/backfill-purged-markers.js is the one
 * thing that writes it. Until then a withdrawal is accepted for any code, as
 * it was before.
 *
 * When that switch was added, four sentences in these two files went on
 * stating the rule as if it applied — "the write is refused", "only while its
 * marker exists" — and three of them sat ABOVE the paragraph that said
 * otherwise, which scoped itself to "nothing below" (review of the switch,
 * the one blocking finding). A clause drafted from them would have told
 * participants and the Controller that a made-up code is refused in
 * production. Nothing linked the sentences to the switch.
 *
 * WHAT THIS IS, AND IS NOT. It is not a reader of prose. It knows a handful of
 * phrasings these files use for the strict rule, and requires that any block
 * using one also names the backfill. A new sentence that states the rule in
 * other words is not caught — write it with the switch in it. If the phrasings
 * change, the floor at the bottom fails rather than the check going blind.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const LEGAL = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "legal");
/* Normalised at the read: this checkout is CRLF on Windows. */
const read = (name) => fs.readFileSync(path.join(LEGAL, name), "utf8").split("\r\n").join("\n");

/* A block is what a reader takes in as one statement: a paragraph, one list
   item with its continuation lines, or one table row. */
function blocks(text) {
  const out = [];
  let current = [];
  const flush = () => { if (current.length) out.push(current.join(" ").replace(/\s+/g, " ").trim()); current = []; };
  for (const line of text.split("\n")) {
    if (line.trim() === "") { flush(); continue; }
    if (/^\s*[-*] /.test(line) || /^\s*\|/.test(line) || /^#+ /.test(line)) flush();
    current.push(line);
  }
  flush();
  return out;
}

/* The phrasings these files use for "a withdrawal needs a session or a marker". */
const STRICT_RULE = [
  /only while its marker exists/,
  /provided the purge left/,
  /accepts? a withdrawal only/,
  /the write is refused/i,
  /can no longer be made under a code/,
];
const statesTheRule = (block) => STRICT_RULE.some((re) => re.test(block));
const NAMES_THE_SWITCH = /backfill/i;

for (const file of ["dpa-draft.md", "record-of-processing.md"]) {
  test(`${file}: wherever the session-or-marker rule is stated, the backfill it waits for is named`, () => {
    const unqualified = blocks(read(file)).filter((b) => statesTheRule(b) && !NAMES_THE_SWITCH.test(b));
    assert.deepStrictEqual(unqualified.map((b) => b.slice(0, 110) + "…"), [],
      "these statements say a withdrawal needs a session or a purge marker, and do " +
      "not say that this applies only once the marker backfill has been run. After " +
      "a merge the rule is OFF: say what is true then, and what becomes true after.");
  });
}

test("the DPA's list of what is open begins with the rule being off", () => {
  /* Position is part of the meaning: the paragraph that says the rule is off
     used to come after three statements of the rule, and said "nothing below". */
  const dpa = read("dpa-draft.md");
  const head = "**What is NOT true, and is open:**";
  assert.strictEqual(dpa.split(head).length - 1, 1, "the open list's heading moved or was duplicated");
  const first = dpa.slice(dpa.indexOf(head) + head.length).split("\n").find((line) => line.trim() !== "");
  assert.match(first, /^\s*- \*\*THE SESSION-OR-MARKER RULE IS OFF/,
    "the first open point must be that the rule is off until the backfill is run");
  const flat = dpa.replace(/\s+/g, " ");
  assert.ok(!/nothing below about/i.test(flat),
    "the paragraph scopes itself to what is BELOW it; statements of the rule sit above it too");
});

test("the phrasings this file watches for are still the ones in use", () => {
  /* Anti-vacuity. If the drafts are reworded so that none of the phrasings
     above occurs, the first two tests pass on nothing. */
  for (const file of ["dpa-draft.md", "record-of-processing.md"]) {
    const found = blocks(read(file)).filter(statesTheRule).length;
    assert.ok(found >= 1,
      `${file} no longer states the rule in any phrasing this test knows (${found} found). ` +
      "Update STRICT_RULE to the wording now in use.");
  }
});
