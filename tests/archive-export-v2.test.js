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
/* The FACILITATOR DASHBOARD block moved OUT of script.js into the lazy
   script-admin.js (perf reclaim 2026-08-05 — slice 2 of
   ARCHITECTURE/eager-bundle-reclaim-plan.md). Read BOTH, for the same reason
   ~11 test files concatenate style.css + room.css after the room.css split:
   reading script.js alone would silently stop seeing the dashboard code. */
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(P, "script-admin.js"), "utf8");
/* The take-home and the research CSVs are snapshot readers too, and both live
   in lazy chunks of their own — they were the readers this guard did not name,
   and both had drifted onto the retired module-literal address. */
const TAKEHOME = fs.readFileSync(path.join(P, "takehome.js"), "utf8");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const { convertArchive } = require("../scripts/convert-archive-v2.js");

/* ── the live export ──────────────────────────────────────────────────────── */

/* One function's source, bounded by the next function at the SAME indent — the
   lazy chunks nest their functions inside an IIFE, so a top-level `\nfunction `
   boundary would swallow the rest of the file and make every assertion below
   vacuous. */
function fnSource(src, name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i > -1, name + " must exist");
  const lineStart = src.lastIndexOf("\n", i) + 1;
  const indent = src.slice(lineStart, i);
  const next = src.indexOf("\n" + indent + "function ", i + 1);
  return src.slice(i, next > -1 ? next : src.length);
}
/* CODE only. The negative assertion below looks for a retired address, and
   these functions now carry comments that NAME the retired address to explain
   why they moved off it — the guard would otherwise fire on its own tombstone. */
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("EVERY snapshot reader resolves addresses through ONE helper", () => {
  /* The guard that actually matters. THREE times in this initiative a path move
     fixed one reader and silently zeroed another — the export's hypotheses, the
     export's answers, and the dashboard's "findings N/M", which had been
     reporting 0 for every room since S2b-2. Funnelling every snapshot reader
     through roomSlotBuckets()/roomEntries() gives the next move one place to
     change.
     ⚠️ A FOURTH, FIFTH and SIXTH round of exactly that was found on 2026-08-05,
     in readers this list did not name: the student's take-home (both "My
     responses" and "Group answers" printed their empty placeholder), the
     dashboard's participation funnel + impact KPIs, and all three research
     CSVs. They are named here now — a reader missing from this list is a reader
     nothing protects. */
  const READERS = [
    [SCRIPT, "_sessionArchiveData"], [SCRIPT, "roomProgress"], [SCRIPT, "roomParticipation"],
    [SCRIPT, "downloadMyData"],
    [SCRIPT, "_debriefFunnelSection"], [SCRIPT, "_impactMetrics"],
    [TAKEHOME, "buildRoomTakeawayMarkdown"],
    [TOOLS, "_tallyByCid"], [TOOLS, "_revealRows"], [TOOLS, "_freetextRows"]
  ];
  READERS.forEach(([src, name]) => {
    const fn = codeOnly(fnSource(src, name));
    assert.match(fn, /room(SlotBuckets|Entries)\(/,
      name + " must resolve through the helper");
    assert.ok(!/\bdata\.moduleA\b|answers\.moduleA|answers\.moduleB|\["moduleA", "moduleB"\]/.test(fn),
      name + " must not reach a module-literal node directly");
  });
});

test("the helper reads ANSWERS from EITHER address, per-slot first", () => {
  /* ⚠️ The invariant a FIXTURE CANNOT PROVE: a reader must read where the CLIENT
     WRITES. S2b-2 moved room state to sections/$slot but left ANSWERS on the
     module-literal nodes, so reading only the new address returned empty
     answers — indistinguishable from a session in which nobody wrote anything.
     Both addresses stay live until the answers migration lands. */
  const i = SCRIPT.indexOf("function roomSlotBuckets(data)");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nfunction ", i + 1));
  assert.match(fn, /answers\.sections \|\| \{\}/, "prefer the per-slot node");
  assert.match(fn, /LEGACY_SLOT_KEY/, "fall back to the module node");

  /* And the client must still WRITE one of those two addresses. */
  assert.ok(/db\.ref\(base \+ "\/answers\/module[AB]"\)/.test(SCRIPT) ||
            /answers\/sections/.test(SCRIPT),
    "if this fails, every reader is pointed at an address nothing writes");
});

test("the helper is driven by the SLOT LIST, so a silent slot still appears", () => {
  /* A slot that ran and produced nothing must stay distinguishable from one
     that never ran: the buckets come from sectionSlots(), not from whichever
     keys happen to exist in the snapshot. */
  const i = SCRIPT.indexOf("function roomSlotBuckets(data)");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nfunction ", i + 1));
  assert.match(fn, /sectionSlots\(\)\.map/);
  assert.ok(!/Object\.keys\(sections\)\.forEach/.test(fn),
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

test("a malformed room or answer shape is REJECTED, not silently dropped", () => {
  /* The converter runs over PII that may have no other copy. Coercing an
     unreadable shape to [] would emit a valid-LOOKING archive with the data
     missing — the one failure mode worse than crashing. */
  assert.throws(() => convertArchive({ session: "x", rooms: "nope" }), TypeError);
  assert.throws(() => convertArchive({ session: "x", rooms: [null] }), TypeError);
  assert.throws(() => convertArchive({ session: "x", rooms: [{ answers: 7 }] }), TypeError);
  assert.throws(() => convertArchive({ session: "x", rooms: [{ hypotheses: {} }] }), TypeError);
  assert.throws(() => convertArchive({
    session: "x", rooms: [{ answers: { moduleA: { not: "an array" } } }]
  }), TypeError);
  /* A well-formed archive with fields simply absent is still fine. */
  assert.doesNotThrow(() => convertArchive({ session: "x", rooms: [{ room: "R1" }] }));
});
