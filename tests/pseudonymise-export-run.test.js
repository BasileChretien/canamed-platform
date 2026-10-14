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
const { PARTIES, INCLUDED, EXCLUDED, consentScopeSession, consentScopeWithdrawals } =
  require("./fixtures/consent-scope-session");

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
  assert.ok(/a record that names a person is kept only when it can be shown to be an included/.test(note),
    "the note must say who is in the file: only what can be shown to be an included participant's");
  assert.ok(/a clientMapping row binds it to an account/.test(note),
    "the note must say that a row counts only when bound to an account");
  assert.ok(/an included participant can lose such\s+records to a namesake/.test(note),
    "the note must say what failing closed on a shared name costs");
  assert.ok(/any signed-in visitor holding the session code who binds a row of their own under her display name removes them/.test(note),
    "the note must say that the shared-name rule is a lever any visitor can pull, not only a coincidence");
  assert.ok(/EXCEPTION: the name-only records \(events, reveals, triage choices, calls for help\) of a participant who is not included and is bound to no account are kept as an included namesake's, if one exists/.test(note),
    "the note must state the exception to the removal rule: an unbound decliner's name-only records " +
    "are exported as an included namesake's (tests/pseudonymise-consent-scope.test.js pins it)");
  assert.ok(/is not detected/.test(note),
    "the note must say that a record written in somebody else's name is not caught");
  assert.ok(/version 2 or earlier is NOT erased of participants who declined/.test(note),
    "the note must say that earlier files still hold what decliners wrote");
  assert.ok(!/CONTAINS ONLY PARTICIPANTS WHO GAVE RESEARCH CONSENT/i.test(note));
});

test("what a declining participant wrote is NOT in the file (transform version 3)", () => {
  /* Until version 3 this test was called "what a declining participant wrote
     IS in the file — recorded, not endorsed", and asserted the answer below
     came out as { by: "REDACTED-NAME", cid: "c2", university: "Univ-2", text:
     "written by the decliner" }. legal/dpa-draft.md Annex VI G1 and R10 change
     with it. */
  const tree = { sessions: { ABC234: closedSession() } };
  tree.sessions.ABC234.rooms["Room 1"].answers.moduleA.a2 =
    { by: "Ben Sato", cid: "c2", university: "Nagoya", text: "written by the decliner", at: 31 };
  const { pseudo } = runExport(tree);
  assert.ok(!pseudo.includes("written by the decliner"));
  const answers = JSON.parse(pseudo).sessions.ABC234.rooms["Room 1"].answers.moduleA;
  assert.deepStrictEqual(Object.keys(answers), ["a1"]);
});

test("a multi-section session, as the database returns it (slots as ARRAYS), holds only the included participants", () => {
  /* The job reads with `.val()`, which returns integer-keyed nodes — section
     slots — as arrays. The first version of the filter judged nothing inside
     one, and the in-memory database here had only ever been handed plain
     objects. Here it holds the arrays, and returns them as `.val()` would. */
  const { asRtdbWould } = require("./fixtures/rtdb-shape");
  const sess = consentScopeSession();
  const room = sess.rooms["Room 1"];
  room.sections[2] = JSON.parse(JSON.stringify(room.sections[1]));
  room.answers.sections[2] = JSON.parse(JSON.stringify(room.answers.sections[1]));
  const shaped = asRtdbWould(sess);
  assert.ok(Array.isArray(shaped.rooms["Room 1"].sections), "fixture is broken");
  const tree = { sessions: { ABC234: shaped }, withdrawals: { ABC234: consentScopeWithdrawals() } };
  const { run, pseudo } = runExport(tree);
  assert.strictEqual(run.code, 0, run.out);
  for (const key of EXCLUDED) {
    assert.ok(!pseudo.includes(PARTIES[key].token), PARTIES[key].what + " (" + key + ") is in the file");
  }
  const r = JSON.parse(pseudo).sessions.ABC234.rooms["Room 1"];
  for (const slot of [1, 2]) {
    assert.strictEqual(r.answers.sections[slot]["sans-ANN7"].text, "section answer by ANN7");
    assert.strictEqual(r.sections[slot].triage["tri-ANN7"].reason, "triage reason by ANN7");
  }
});

test("the stock-client session: the job's file holds only the included participants, and its log counts the rest", () => {
  /* tests/fixtures/consent-scope-session.js: eight identities writing what the
     stock client writes, one of whom withdrew after the session (the record is
     in withdrawals/<code>, outside the session, as the client writes it). */
  const tree = { sessions: { ABC234: consentScopeSession() },
                 withdrawals: { ABC234: consentScopeWithdrawals() } };
  const database = JSON.stringify(tree);
  const { run, pseudo, linkage } = runExport(tree);
  assert.strictEqual(run.code, 0, run.out);
  assert.deepStrictEqual(run.writes, [], "the export must never write to the database");
  for (const key of EXCLUDED) {
    const T = PARTIES[key].token;
    assert.ok(database.includes(T), "fixture is broken: nothing of " + key + " is in it");
    assert.ok(!pseudo.includes(T), PARTIES[key].what + " (" + key + ") is in the pseudonymised file");
  }
  for (const key of INCLUDED) assert.ok(pseudo.includes(PARTIES[key].token), key + " is missing");
  assert.deepStrictEqual(JSON.parse(linkage).linkage.ABC234,
    { "Ann Dupont": "Student-A", "Dana Kato": "Student-B" },
    "the linkage table holds the two included participants and nobody else");
  for (const line of [
    /Withdrawn \(Art\. 7\(3\)\): 1 record\(s\); 1 pool row\(s\) marked withdrawn; 0 record\(s\) reached no pool row/,
    /participants included: +2$/m,
    /excluded, no research consent \(or withdrawn\): +4$/m,
    /excluded, consent recorded but no clientMapping row: +1$/m,
    /rows keyed by an identity not included: +36$/m,
    /ballots not shown to be an included one's: +6$/m,
    /records whose cid is not included: +37$/m,
    /a by naming nobody included: +0$/m,
    /name-only records, name not included: +17$/m,
    /name also held by someone not included: +6$/m,
    /team names \(free text, no author\): +1$/m
  ]) {
    assert.match(run.out.replace(/\r\n/g, "\n"), line, "the log does not count what the fixture holds");
  }
  assert.ok(!/ABC234|Ann Dupont|cid-|uid-/.test(run.out),
    "the job's log is world-readable: it must hold counts only");
});

test("a withdrawal that matches no clientMapping row is counted as changing nothing", () => {
  const tree = { sessions: { ABC234: closedSession() },
                 withdrawals: { ABC234: { NoRowForThisAccountUid00001: { research: false, at: 5 } } } };
  const { run } = runExport(tree);
  assert.strictEqual(run.code, 0, run.out);
  assert.match(run.out, /Withdrawn \(Art\. 7\(3\)\): 1 record\(s\); 0 pool row\(s\) marked withdrawn; 1 record\(s\) reached no pool row/);
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
