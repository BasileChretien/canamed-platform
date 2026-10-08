/* tests/pseudonymise-export-run.test.js
 *
 * scripts/pseudonymise-export.js is RUN here, in a child process against an
 * in-memory database, and the FILE it writes is read back.
 *
 * tests/pseudonymise.test.js exercises the transform as a function. That is not
 * the same claim as "the nightly job's file holds no name": the job chooses
 * which sessions go in, applies withdrawals, wraps the result in a payload with
 * a note that describes it, and writes two files — one of which is SUPPOSED to
 * hold real names. Until 2026-10-08 nothing ran the job, so nothing had ever
 * looked at what it wrote.
 *
 * The session below is shaped by what the client writes, not by what the rules
 * declare: the event payload is the JSON string logEvent() produces, with the
 * actor's display name inside it. A fixture that puts an opaque marker there
 * passes on a transform that leaks every participant's name — which is how the
 * first version of this change was reported as complete.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runOpsScript } = require("./fixtures/run-ops-script");
const { TRANSFORM_VERSION } = require("../scripts/lib/pseudonymise");

const NOW = Date.UTC(2026, 9, 8, 4, 0, 0);
const YES = { workshop: true, research: true, version: "PIS-v12", at: 5 };
const NO = { workshop: true, research: false, version: "PIS-v12", at: 5 };

const FACILITATOR_UID = "FacilitatorAuthUid0000000001";
const AUTHOR_UID = "ScenarioAuthorAuthUid0000002";
const ANN_UID = "AnnAuthUid000000000000000003";
const BEN_UID = "BenAuthUid000000000000000004";

/* Everything in this list is somebody's identity and must not be in the
   pseudonymised file. Each is asserted to be in the DATABASE first. */
const MUST_NOT_APPEAR = [
  ["the consenting participant's name", "Ann Dupont"],
  ["the declining participant's name", "Ben Sato"],
  ["the facilitator's name", "Dr Claire Facilitator"],
  ["a real university", "Nagoya"],
  ["the facilitator's account uid", FACILITATOR_UID],
  ["the scenario author's account uid", AUTHOR_UID],
  ["the consenting participant's account uid", ANN_UID],
  ["the declining participant's account uid", BEN_UID],
  ["an e-mail address", "ann.dupont@example.org"]
];

function event(kind, by, payload) {
  return { kind, by, at: NOW - 3000, payload: JSON.stringify(payload) };
}

function closedSession() {
  return {
    created: { by: "Dr Claire Facilitator", at: NOW - 86400000 },
    closed: { by: "Dr Claire Facilitator", at: NOW - 3600000 },
    creatorUid: FACILITATOR_UID,
    scenarioRef: { ownerUid: AUTHOR_UID, scenarioId: "chest-pain", source: "shared" },
    members: { [FACILITATOR_UID]: { at: 1 }, [ANN_UID]: { at: 2 }, [BEN_UID]: { at: 3 } },
    roomOf: { [ANN_UID]: { room: "Room 1", cid: "c1" }, [BEN_UID]: { room: "Room 1", cid: "c2" } },
    clientMapping: { c1: ANN_UID, c2: BEN_UID },
    mail: { m1: { to: "ann.dupont@example.org", subject: "Your link", text: "Dear Ann Dupont", at: 9 } },
    pool: {
      c1: { name: "Ann Dupont", university: "Caen", at: 10, room: "Room 1", consent: YES },
      c2: { name: "Ben Sato", university: "Nagoya", at: 20, room: "Room 1", consent: NO }
    },
    rooms: {
      "Room 1": {
        answers: { moduleA: {
          a1: { by: "Ann Dupont", cid: "c1", university: "Caen", text: "differential is X", at: 30 }
        } },
        events: {
          e1: event("answer.moduleA", "Ann Dupont", { by: "Ann Dupont", university: "Caen", len: 17, bulletKey: "" }),
          e2: event("hypothesis", "Ben Sato", { by: "Ben Sato", university: "Nagoya", len: 9 }),
          e3: event("score.manual", "Dr Claire Facilitator", { tag: "t", points: 5, by: "Dr Claire Facilitator" })
        }
      }
    }
  };
}

function runExport(tree) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-export-"));
  try {
    const run = runOpsScript("pseudonymise-export.js", {
      tree, now: NOW,
      /* No archive destination: the job then writes its two files and stops,
         which is all this test reads. Every variable that could name one is
         blanked so a developer's shell cannot turn this into an upload. */
      env: { EXPORT_OUT_DIR: outDir, EXPORT_GCS_BUCKET: "", EXPORT_REQUIRE_GCS: "",
             BACKUP_S3_BUCKET: "", SCW_ACCESS_KEY: "", SCW_SECRET_KEY: "" }
    });
    const files = fs.readdirSync(outDir);
    const read = (prefix) => {
      const name = files.find((f) => f.startsWith(prefix));
      return name ? fs.readFileSync(path.join(outDir, name), "utf8") : null;
    };
    return { run, files, pseudo: read("canamed-pseudonymised-"), linkage: read("canamed-linkage-") };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

test("the job runs, uploads nowhere, and writes its two files", () => {
  const { run, files, pseudo, linkage } = runExport({ sessions: { ABC234: closedSession() } });
  assert.strictEqual(run.code, 0, run.out);
  assert.ok(/Archive destination: +\(?none/i.test(run.out) || !/Uploaded to/.test(run.out),
    "this test must not upload anything:\n" + run.out);
  assert.strictEqual(files.length, 2, "expected the export and the linkage table: " + files.join(", "));
  assert.ok(pseudo && linkage);
  assert.deepStrictEqual(run.writes, [], "the export must never write to the database");
});

test("the pseudonymised FILE holds nobody's name, account or e-mail address", () => {
  const tree = { sessions: { ABC234: closedSession() } };
  const database = JSON.stringify(tree);
  const { pseudo } = runExport(tree);
  for (const [what, value] of MUST_NOT_APPEAR) {
    assert.ok(database.includes(value), "fixture is broken: the database does not hold " + what);
    assert.ok(!pseudo.includes(value), what + " (" + value + ") is in the pseudonymised file");
  }
});

test("the file still holds the session's research content", () => {
  const { pseudo } = runExport({ sessions: { ABC234: closedSession() } });
  const session = JSON.parse(pseudo).sessions.ABC234;
  assert.strictEqual(session.pool.c1.name, "Student-A");
  assert.strictEqual(session.pool.c1.room, "Room 1");
  assert.ok(!("c2" in session.pool), "a participant who declined has no pool row in the export");
  assert.strictEqual(session.rooms["Room 1"].answers.moduleA.a1.text, "differential is X");
  assert.deepStrictEqual(JSON.parse(session.rooms["Room 1"].events.e1.payload),
    { by: "Student-A", university: "Univ-1", len: 17, bulletKey: "" });
  assert.deepStrictEqual(session.scenarioRef, { scenarioId: "chest-pain", source: "shared" });
});

test("the file says which transform wrote it — a date could not", () => {
  /* The job runs once a night on whatever `main` holds. The day a fix is
     written, the day it merges and the day a file is first written by it are
     three different days, so "files before <date>" misfiles at least one. */
  const { pseudo } = runExport({ sessions: { ABC234: closedSession() } });
  const payload = JSON.parse(pseudo);
  assert.strictEqual(payload.transformVersion, TRANSFORM_VERSION);
  assert.ok(Number.isInteger(TRANSFORM_VERSION) && TRANSFORM_VERSION >= 2);
  assert.ok(payload.note.includes("transformVersion"),
    "the note must tell a reader how to recognise a file written by an earlier transform");
});

test("the note does not promise what the file does not deliver", () => {
  const { pseudo } = runExport({ sessions: { ABC234: closedSession() } });
  const note = JSON.parse(pseudo).note;
  assert.ok(!/no cross-session linkage/i.test(note),
    "stableId is exported as written; the note must not say sessions cannot be linked");
  assert.ok(/stableId/.test(note), "the note must name the identifier the file keeps");
  assert.ok(/is NOT erased from the file/.test(note) && /is still here, with the name redacted/.test(note),
    "the note must say that what a declining participant WROTE in the shared lists stays");
  assert.ok(!/CONTAINS ONLY PARTICIPANTS WHO GAVE RESEARCH CONSENT/i.test(note),
    "the old opening line is false: a decliner's answers are in the file");
});

test("what a declining participant wrote IS in the file — recorded, not endorsed", () => {
  /* The note above says so; this shows it. Their pool row and every node keyed
     by their identifiers are gone, and what they wrote into a shared list is
     still there under REDACTED-NAME, with their per-tab clientId. Whether that
     is what "you may decline research use" should mean is not this job's to
     decide — legal/dpa-draft.md, Annex VI G1 and R10. If this test goes red
     because the contribution is gone, that decision was taken: update both. */
  const tree = { sessions: { ABC234: closedSession() } };
  tree.sessions.ABC234.rooms["Room 1"].answers.moduleA.a2 =
    { by: "Ben Sato", cid: "c2", university: "Nagoya", text: "written by the decliner", at: 31 };
  const { pseudo } = runExport(tree);
  const a2 = JSON.parse(pseudo).sessions.ABC234.rooms["Room 1"].answers.moduleA.a2;
  assert.deepStrictEqual(a2,
    { by: "REDACTED-NAME", cid: "c2", university: "Univ-2", text: "written by the decliner", at: 31 });
});

test("the linkage table is where the real name lives — and only the consenting one", () => {
  const { linkage } = runExport({ sessions: { ABC234: closedSession() } });
  const table = JSON.parse(linkage).linkage.ABC234;
  assert.deepStrictEqual(table, { "Ann Dupont": "Student-A" });
});

test("an open session, and one where nobody consented, are not exported at all", () => {
  const open = closedSession();
  delete open.closed;
  const nobody = closedSession();
  nobody.pool.c1.consent = NO;
  const { pseudo } = runExport({ sessions: { ABC234: closedSession(), OPEN22: open, NONE22: nobody } });
  assert.deepStrictEqual(Object.keys(JSON.parse(pseudo).sessions), ["ABC234"]);
});
