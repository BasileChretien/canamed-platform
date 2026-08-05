"use strict";
/* tests/admin-tools-research-consent.test.js
 *
 * The facilitator's research_*.csv exports had NO consent check: a student who
 * declined research use still left the platform by name in
 * research_participants.csv, and their free text in research_freetext.csv.
 * PR #232 gated the server-side export; this is the parallel client-side path.
 *
 * These tests EXECUTE the real functions (sliced out of admin-tools.js and run
 * in a vm sandbox with fake engine globals) rather than grepping for the gate.
 * That matters here: the first version of this fix filtered _participantIndex()
 * but left the detail-file callers doing `pid || ""`, so non-consenting
 * participants' free text was still exported — merely unattributed. A
 * source-text test would have passed. This one fails.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
/* The exports resolve room addresses through the shared per-slot helpers that
   live in script.js (roomSlotBuckets / roomEntries). Run the REAL ones in the
   sandbox rather than stubbing them: a stub would let the exports keep reading
   an address nothing writes and still pass. */
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.notStrictEqual(start, -1, "could not find function " + name);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces in " + name);
}

const YES = { workshop: true, research: true, version: "PIS-v2-2026-05", at: 5 };
const NO = { workshop: true, research: false, version: "PIS-v2-2026-05", at: 5 };

/* c1 consented, c2 declined, c3 has no consent record at all (a row written
   before the field existed). Only c1 may appear in any research artefact. */
function sandbox() {
  const s = {
    pool: {
      c1: { name: "Yes-Person", consent: YES },
      c2: { name: "No-Person", consent: NO },
      c3: { name: "Legacy-Person" }
    },
    /* S6 shape: a room's work lives PER SLOT. Written this way on purpose —
       with the old module-literal fixture these tests kept passing against
       exports that read an address no live session writes. */
    allRooms: {
      "Room 1": {
        presence: {
          c1: { name: "Yes-Person" },
          c2: { name: "No-Person" },
          c3: { name: "Legacy-Person" }
        },
        answers: {
          sections: {
            1: {
              a1: { cid: "c1", text: "consented text" },
              a2: { cid: "c2", text: "declined text" },
              a3: { cid: "c3", text: "legacy text" }
            }
          }
        },
        sections: {
          1: {
            hypotheses: {
              h1: { cid: "c1", text: "consented hypothesis" },
              h2: { cid: "c2", text: "declined hypothesis" }
            },
            revealed: {
              item1: { by: "Yes-Person", at: 1 },
              item2: { by: "No-Person", at: 2 }
            }
          }
        },
        votes: {
          d1: { committed: { choice: 1 }, ballots: { c1: { choice: 1 }, c2: { choice: 2 } } }
        }
      }
    },
    DECISIONS: [{ id: "d1", module: "A", options: [{ correct: false }, { correct: true }] }],
    _sess: () => "S1",
    activeRooms: () => ["Room 1"],
    /* One PBL section at slot 1 — what roomSlotBuckets() walks. */
    sectionSlots: () => [{ position: 1, stage: 1, type: "pbl", sectionId: "s" }],
    LEGACY_SLOT_KEY: { pbl: "moduleA", roleplay: "moduleB", branched: "moduleBranched" }
  };
  vm.createContext(s);
  vm.runInContext(
    extractFn(SCRIPT, "roomSlotBuckets") + "\n" +
    extractFn(SCRIPT, "roomEntries") + "\n" +
    extractFn(TOOLS, "_hasResearchConsent") + "\n" +
    extractFn(TOOLS, "_tallyByCid") + "\n" +
    extractFn(TOOLS, "_participantIndex") + "\n" +
    extractFn(TOOLS, "_revealRows") + "\n" +
    extractFn(TOOLS, "_voteRows") + "\n" +
    extractFn(TOOLS, "_freetextRows") + "\n",
    s
  );
  return s;
}

test("_hasResearchConsent is fail-closed", () => {
  const s = sandbox();
  const has = cid => vm.runInContext(`_hasResearchConsent(${JSON.stringify(cid)})`, s);
  assert.strictEqual(has("c1"), true, "explicit consent counts");
  assert.strictEqual(has("c2"), false, "an explicit decline does not");
  assert.strictEqual(has("c3"), false, "a missing consent record is NOT agreement");
  assert.strictEqual(has("nobody"), false, "an unknown cid is not consent");
});

test("the participant index assigns a pid only to consenting participants", () => {
  const s = sandbox();
  const idx = vm.runInContext("_participantIndex()", s);
  const byCid = idx.pidByRoomCid["Room 1"];
  assert.deepStrictEqual(Object.keys(byCid), ["c1"], "only the consenting cid gets a pid");
  assert.strictEqual(byCid.c1, "P1", "numbering starts at P1 with no gap for the skipped rows");
});

test("free text from a non-consenting participant is NOT exported at all", () => {
  const s = sandbox();
  const rows = vm.runInContext("_freetextRows(_participantIndex())", s);
  const blob = JSON.stringify(rows);
  assert.ok(!/declined text/.test(blob), "a decliner's answer must not be exported");
  assert.ok(!/legacy text/.test(blob), "a no-record participant's answer must not be exported");
  assert.ok(!/declined hypothesis/.test(blob), "a decliner's hypothesis must not be exported");
  assert.ok(/consented text/.test(blob), "the consenting participant is still exported");
  assert.ok(/consented hypothesis/.test(blob));
  // The specific regression: emitting the row with participant:"" would still
  // export the words, just unattributed. Every row must carry a real pid.
  for (const r of rows) {
    assert.ok(r.participant && r.participant !== "",
      "no research row may be emitted with a blank participant: " + JSON.stringify(r));
  }
});

test("ballots and reveals from a non-consenting participant are not exported", () => {
  const s = sandbox();
  const votes = vm.runInContext("_voteRows(_participantIndex())", s);
  assert.strictEqual(votes.length, 1, "only the consenting participant's ballot survives");
  assert.strictEqual(votes[0].participant, "P1");

  const reveals = vm.runInContext("_revealRows(_participantIndex())", s);
  assert.strictEqual(reveals.length, 1, "only the consenting participant's reveal survives");
  assert.strictEqual(reveals[0].participant, "P1");
  for (const r of votes.concat(reveals)) {
    assert.ok(r.participant && r.participant !== "", "no blank-participant rows");
  }
});

/* ── The address the export reads ─────────────────────────────────────────────
 * Separate from consent, but it belongs on this harness because this is the one
 * place the research exports are EXECUTED. Every row above comes from the
 * per-slot fixture, so a reader that went back to answers/moduleA would return
 * nothing and the consent assertions would pass vacuously ("the decliner's text
 * is absent" is trivially true of an empty file). Assert the consenting
 * participant's words ARE there, tagged with the slot that produced them.
 */
test("free-text rows come from the per-slot address and carry their slot", () => {
  const s = sandbox();
  const rows = vm.runInContext("_freetextRows(_participantIndex())", s);
  const answer = rows.find(r => r.text === "consented text");
  assert.ok(answer, "the per-slot answer must reach the export at all");
  assert.strictEqual(answer.type, "slot1-answer",
    "the row names the SLOT — 'moduleA' cannot identify which of two PBL sections");
  assert.ok(rows.some(r => r.text === "consented hypothesis" && r.type === "hypothesis"));
});

test("the pid numbering cannot desync between the summary and detail files", () => {
  // If researchCsvParticipantRows() and _participantIndex() disagreed about who
  // to skip, P3's free text would be attributed to a different P3 — an
  // invisible corruption, worse than the leak. Both must apply the same gate.
  const rowsFn = extractFn(TOOLS, "researchCsvParticipantRows");
  const idxFn = extractFn(TOOLS, "_participantIndex");
  for (const [label, fn] of [["researchCsvParticipantRows", rowsFn], ["_participantIndex", idxFn]]) {
    assert.match(fn, /_hasResearchConsent\(cid\)/,
      label + " must apply the research-consent gate");
    assert.match(fn, /if \(!_hasResearchConsent\(cid\)\) return;\s*\r?\n\s*pid\+\+/,
      label + " must skip BEFORE incrementing pid, so numbering stays contiguous");
  }
});
