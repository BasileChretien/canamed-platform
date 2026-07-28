/* tests/archive-export-v2.test.js
 *
 * S4 — the research export, v2.
 *
 * Two things are pinned here:
 *
 * 1. THE BREAK THIS FIXES. Since S2b-2 the room's state lives at
 *    rooms/$roomId/sections/$slot. The v1 export still read `answers.moduleA`
 *    and `moduleA.hypotheses` — nodes nothing writes any more — so it had begun
 *    silently exporting EMPTIES for new sessions. That is the worst possible
 *    failure for a research artefact: it looks like a session where nobody said
 *    anything.
 *
 * 2. THE CONVERTER. Decision 6 chose a clean break plus a one-off converter for
 *    archived v1 files, rather than a compatibility branch living in the export
 *    forever. These tests are the only proof of the mapping before it is
 *    pointed at real archived PII.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const { convertArchive } = require("../scripts/convert-archive-v2.js");

/* ── the live export ──────────────────────────────────────────────────────── */

test("the export reads the PER-SLOT nodes, not the retired module ones", () => {
  const i = SCRIPT.indexOf("function _sessionArchiveData(anon)");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nfunction _sessionArchiveToCSV", i));
  assert.match(fn, /data\.sections \|\| \{\}/,
    "room state has lived at rooms/$roomId/sections/$slot since S2b-2");
  assert.match(fn, /data\.answers && data\.answers\.sections/);
  assert.ok(!/answers\.moduleA|moduleA\.hypotheses|mapEntries\("moduleA"\)/.test(fn),
    "reading the retired nodes exports empties, which reads as a silent session");
});

test("the export is driven by the MANIFEST, so a silent slot still appears", () => {
  /* A slot that ran and produced nothing must be distinguishable from a slot
     that never ran at all. */
  const i = SCRIPT.indexOf("function _sessionArchiveData(anon)");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nfunction _sessionArchiveToCSV", i));
  assert.match(fn, /manifest\.forEach\(m => \{/);
  assert.ok(!/Object\.keys\(roomSections\)\.forEach/.test(fn),
    "iterating the keys that exist would drop empty slots");
});

test("every CSV row carries its slot and the section that ran there", () => {
  const i = SCRIPT.indexOf("function _sessionArchiveToCSV(archive)");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\n}", SCRIPT.indexOf("Leading BOM", i)));
  assert.match(fn, /"slot", "sectionId", "sectionType"/,
    '"the PBL answers" is meaningless when a session ran two PBL sections');
  assert.ok(!/"moduleA"|"moduleB"/.test(fn), "the module columns are retired");
});

test("the export declares its version", () => {
  assert.match(SCRIPT, /const ARCHIVE_EXPORT_VERSION = 2;/);
  assert.match(SCRIPT, /exportVersion: ARCHIVE_EXPORT_VERSION/);
});

/* ── the converter ────────────────────────────────────────────────────────── */

const V1 = {
  session: "42",
  exportedAt: "2026-07-01T10:00:00.000Z",
  pseudonymised: true,
  rooms: [{
    room: "Room 1", stageReached: "Wrap-up", score: 12,
    hypotheses: [{ by: "Student A", university: "Caen", text: "mechanical" }],
    answers: {
      moduleA: [{ by: "Student A", university: "Caen", bulletKey: "plan", text: "taper" }],
      moduleB: [{ by: "Student B", university: "Nagoya", bulletKey: "", text: "SPIKES" }]
    }
  }]
};

test("a v1 archive converts to the per-slot shape", () => {
  const v2 = convertArchive(V1);
  assert.equal(v2.exportVersion, 2);
  assert.equal(v2.convertedFrom, 1);
  assert.deepEqual(v2.sections.map(s => [s.slot, s.type]), [[1, "pbl"], [2, "roleplay"]]);
  const rm = v2.rooms[0];
  assert.equal(rm.sections["1"].answers[0].text, "taper");
  assert.equal(rm.sections["2"].answers[0].text, "SPIKES");
  assert.equal(rm.sections["1"].hypotheses[0].text, "mechanical",
    "only Module A ever had hypotheses, so they belong to slot 1");
  assert.equal(rm.sections["2"].hypotheses.length, 0);
});

test("sectionId is NULL, not guessed — a v1 file never recorded the case", () => {
  /* The null is meaningful: it says "pre-section session, case unknown", which
     is what a later analysis needs to know. Inventing an id would be worse than
     admitting ignorance. */
  convertArchive(V1).sections.forEach(s => assert.equal(s.sectionId, null));
});

test("PII passes through untouched — the converter must not re-pseudonymise", () => {
  const v2 = convertArchive(V1);
  assert.equal(v2.pseudonymised, true, "the flag must survive");
  assert.equal(v2.rooms[0].sections["1"].answers[0].by, "Student A",
    "already-aliased names must not be re-aliased into different ones");
});

test("a single-module v1 session does NOT gain a phantom empty section", () => {
  const oneModule = {
    session: "7", rooms: [{
      room: "Room 1", stageReached: "Wrap-up", score: 0, hypotheses: [],
      answers: { moduleA: [{ by: "X", university: "", bulletKey: "", text: "a" }], moduleB: [] }
    }]
  };
  const v2 = convertArchive(oneModule);
  assert.deepEqual(v2.sections.map(s => s.slot), [1]);
  assert.deepEqual(Object.keys(v2.rooms[0].sections), ["1"]);
});

test("an empty session converts to an empty manifest, not a crash", () => {
  const v2 = convertArchive({ session: "9", rooms: [] });
  assert.deepEqual(v2.sections, []);
  assert.deepEqual(v2.rooms, []);
});

test("conversion is idempotent — re-running it cannot double-wrap", () => {
  const once = convertArchive(V1);
  assert.strictEqual(convertArchive(once), once, "already-v2 input is returned as-is");
});

test("a malformed input fails loudly rather than emitting a broken archive", () => {
  assert.throws(() => convertArchive(null), TypeError);
  assert.throws(() => convertArchive("nope"), TypeError);
});
