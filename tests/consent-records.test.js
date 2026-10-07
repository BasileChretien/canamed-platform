/* tests/consent-records.test.js
 *
 * Three ways a participant's recorded consent was being rewritten without the
 * participant doing anything that meant it. The third was found by the review
 * of the fix for the first two, in the same flow.
 *
 * 1. A RELOAD CLEARED THE THIRD BOX.
 *    The lobby has three consent boxes; the third (`transcript`) records
 *    consent to the Teams transcript and recording being kept. A reload
 *    mid-session resumes seamlessly: the page reads the saved join data back
 *    from localStorage, ticks the boxes from it, and joins again — and that
 *    second join writes a consent record over the participant's pool entry.
 *    lib.js's sanitizeResume() stands between localStorage and that join, and
 *    it rebuilt the consent as { workshop, research, version, at }. The third
 *    answer was not in the list, so the box came back unticked and the
 *    participant who had said yes was recorded as transcript:false.
 *
 *    The first part of this file runs that round trip on the code that does
 *    it: the statements joinParticipant() reads the boxes with and the record
 *    it builds, saveResume(), the module-level read-back, the real
 *    sanitizeResume() and autoResume() — each taken from the source, so the
 *    test follows the code rather than a copy of it. sanitizeResume() on its
 *    own is pinned in tests/lib.test.js.
 *
 * 2. WITHDRAWING FROM ONE SESSION SWITCHED RESEARCH CONSENT OFF IN ANOTHER.
 *    withdrawResearchConsent(code, uid) records the withdrawal for session
 *    `code` and then mirrors it into the participant's pool entry. The mirror
 *    was addressed with sPath(), which names the session the page is IN, not
 *    the session withdrawn from. The account dialog lists every past session
 *    with its own "Withdraw consent" button, so someone sitting in open
 *    session B who withdrew from last month's session A had research consent
 *    set to false in B — and the research export then dropped them from a
 *    session they never withdrew from. With no session open the path
 *    collapsed to sessions/pool/<clientId>/…, which only the database rules
 *    stopped.
 *
 *    The second part drives the real function against a database that records
 *    every write.
 *
 * 3. A RELOAD AFTER A WITHDRAWAL RECORDED RESEARCH CONSENT AGAIN.
 *    A withdrawal made inside the session set the pool entry's
 *    consent/research to false and left two other copies of the answer at
 *    true: the in-memory record (`myConsent`) and the saved join data. The
 *    next reload ticked the research box from the saved copy, rejoined, and
 *    wrote research:true over the pool entry, dated after the withdrawal.
 *
 *    That flag is not a courtesy. The server-side export applies the
 *    withdrawals/ records over it, but the facilitator's in-browser research
 *    CSV (admin-tools.js, _hasResearchConsent) reads consent.research in the
 *    pool entry and nothing else, and the rules let nobody but the participant
 *    read their withdrawals/ record. A withdrawn participant was back in that
 *    file after one reload.
 *
 *    The third part puts the withdrawal and the reload in ONE tab state, so
 *    the function and the resume path share the record they really share.
 *
 *    NOT COVERED, by the fix or by these tests: a second device signed in as
 *    the same person. It keeps its own saved answer and writes it again on its
 *    next reload. Closing that needs the rejoin to read the participant's own
 *    withdrawals/ record first, which is a separate change.
 *
 * What a sandbox cannot show is the browser: that the box really comes back
 * ticked, that the pool entry really is rewritten, that the buttons really
 * reach this function. That is tests-e2e/consent-records.spec.js.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
/* LF-normalised at the read: this checkout may be CRLF (core.autocrlf), and
   the patterns below walk whole statements. */
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8").replace(/\r\n/g, "\n");
const lib = require("../docs/Third_session/PBL_platform/lib.js");

/* Slice one top-level `function name(...) { ... }` out of the source by
   brace-matching from its declaration. */
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

/* Values that cross out of a vm context carry that context's prototypes, which
   deepStrictEqual compares. Everything asserted on here is plain data. */
const plain = (v) => JSON.parse(JSON.stringify(v));

// ============================================================ 1. the reload

const NOTICE = (SCRIPT.match(/const CONSENT_NOTICE_VERSION = "([^"]+)";/) || [])[1];

/* What joinParticipant() does with the three boxes: the statements that read
   them, and the record it pins to `myConsent` — the object both pool writes
   send as `consent`. Lifted out of the function because the rest of it needs a
   whole page. */
function joinConsentSource() {
  const join = extractFn(SCRIPT, "joinParticipant");
  const reads = ["cWorkshop", "cResearch", "cTranscript", "cVerification"].map((n) => {
    const m = join.match(new RegExp("const " + n + " = [^;]+;"));
    assert.ok(m, "joinParticipant() no longer declares " + n);
    return m[0];
  });
  const record = join.match(/myConsent = \{[^}]+\};/);
  assert.ok(record, "joinParticipant() no longer builds myConsent as one literal");
  return reads.join("\n") + "\n" + record[0];
}

/* The line that reads the saved join data back when the page loads. */
function readBackSource() {
  const m = SCRIPT.match(/try \{ resumeData = sanitizeResume\([^\n]+\n/);
  assert.ok(m, "script.js no longer reads resumeData back through sanitizeResume");
  return m[0];
}

/* What a rejoin saves back: _joinParticipantWireUp() keeps the room the saved
   data named, and saves with it. */
function resaveSource() {
  const wire = extractFn(SCRIPT, "_joinParticipantWireUp");
  const room = wire.match(/const resumeRoom = [^;]+;/);
  assert.ok(room, "_joinParticipantWireUp() no longer derives resumeRoom");
  assert.match(wire, /saveResume\(resumeRoom\);/);
  return "{ " + room[0] + " saveResume(resumeRoom); }";
}

/* A database that records every write. `refuse` is a pattern of paths whose
   write is rejected. */
function recordingDb(refuse) {
  const writes = [];
  const db = {
    ref: (p) => ({
      set: (value) => {
        writes.push({ path: p, value: plain(value) });
        return (refuse && refuse.test(p))
          ? Promise.reject(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }))
          : Promise.resolve();
      }
    })
  };
  return { db, writes };
}

/* withdrawResearchConsent() and the path helpers it addresses the database
   with — the real ones. */
const WITHDRAWAL_SOURCE =
  ["_sessionPrefix", "oPath", "sPath", "withdrawalPath", "withdrawResearchConsent"]
    .map((n) => extractFn(SCRIPT, n)).join("\n");

const UID = "uidParticipant";
const CLIENT = "c0ffee0000000001";

/* One browser tab: its own boxes and page state, over a localStorage that
   outlives it. `load()` is what a page load does up to the resumed join.
     refuse:       a pattern of database paths whose write is rejected
     brokenStore:  make every localStorage call throw (Safari private mode) */
function openTab(storage, o) {
  o = o || {};
  const nodes = Object.create(null);
  const { db, writes } = recordingDb(o.refuse);
  const broken = () => { throw new Error("storage is unavailable"); };
  const sandbox = {
    el: (id) => nodes[id] || (nodes[id] = { value: "", checked: false, disabled: false }),
    localStorage: o.brokenStore ? { getItem: broken, setItem: broken } : {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); }
    },
    /* script.js wraps lib.js's function with the deployment's cohort list. */
    sanitizeResume: (r) => lib.sanitizeResume(r, ["Caen", "Nagoya"]),
    CONSENT_NOTICE_VERSION: NOTICE,
    RESUME_KEY: "canamed_resume",
    sessionNum: "abc-def", myName: "Aiko", myUniversity: "Nagoya",
    myYear: 3, myEnglish: "B2",
    /* myRoom stays null on purpose: after a resumed join and before the room
       is entered, the page does not know its room yet although the saved data
       does. A re-save built from page state would drop it. */
    myConsent: null, myRoom: null, resumeData: null,
    joins: 0,
    db, clientId: CLIENT, window: {}, DEFAULT_ORG: "caen-nagoya", currentOrg: "caen-nagoya"
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn(SCRIPT, "saveResume") + "\n" +
    extractFn(SCRIPT, "autoResume") + "\n" +
    "function joinParticipant() {\n" + joinConsentSource() + "\njoins++;\n}\n" +
    WITHDRAWAL_SOURCE + "\n",
    sandbox);
  return {
    sandbox, writes,
    tick(boxes) {
      sandbox.el("consent-workshop").checked = boxes.a;
      sandbox.el("consent-research").checked = boxes.b;
      sandbox.el("consent-transcript").checked = boxes.c;
    },
    box: (id) => sandbox.el(id).checked,
    /* The participant presses Join; the join saves the resume data. Passing a
       room is the later save enterRoom() makes once they are placed. */
    join(room) {
      sandbox.__room = room || null;
      vm.runInContext("joinParticipant(); saveResume(__room);", sandbox);
    },
    /* A page load: read the saved data back, then resume. */
    load() { vm.runInContext(readBackSource() + "autoResume();", sandbox); },
    /* What a rejoin saves for the next load. */
    resave() { vm.runInContext(resaveSource(), sandbox); },
    /* The participant withdraws and confirms. */
    withdraw: (code) => sandbox.withdrawResearchConsent(code, UID, { alsoRequestErasure: true }),
    /* What the pool entry is written with. */
    record: () => (sandbox.myConsent ? plain(sandbox.myConsent) : null)
  };
}

/* The saved join data, as stored. */
const saved = (storage) => JSON.parse(storage.canamed_resume);

/* Reload `times` times. Each reload is a new tab state over the same
   localStorage, and saves again after it rejoins — as _joinParticipantWireUp()
   does. Returns the last tab. */
function reload(storage, times) {
  let tab = null;
  for (let i = 0; i < (times || 1); i++) {
    tab = openTab(storage);
    tab.load();
    if (tab.sandbox.joins) tab.resave();
  }
  return tab;
}

/* Join with the given boxes, then reload. */
function joinThenReload(boxes, times) {
  const storage = {};
  const first = openTab(storage);
  first.tick(boxes);
  first.join();
  return { first, tab: reload(storage, times), storage };
}

test("the pieces of the round trip are the ones the page runs", () => {
  /* If any of these stops matching, the tests below would be driving an empty
     harness. Each helper asserts for itself; this states the set. */
  assert.ok(NOTICE, "CONSENT_NOTICE_VERSION is no longer a string constant");
  assert.match(joinConsentSource(), /transcript: cTranscript/);
  assert.match(joinConsentSource(), /el\("consent-transcript"\)/);
  assert.match(readBackSource(), /localStorage\.getItem\(RESUME_KEY\)/);
  assert.match(extractFn(SCRIPT, "saveResume"), /consent: myConsent/);
  /* Both pool writes send the record this file follows. */
  assert.strictEqual(
    extractFn(SCRIPT, "_joinParticipantWireUp").split("consent: myConsent").length - 1, 2);
});

test("a participant who ticked the transcript box is still recorded as true after a reload", () => {
  const { first, tab } = joinThenReload({ a: true, b: false, c: true });
  assert.strictEqual(first.record().transcript, true, "the first join did not record it");

  assert.strictEqual(tab.sandbox.joins, 1, "the reload did not resume the session");
  assert.strictEqual(tab.box("consent-transcript"), true,
    "the box came back unticked, so the resumed join reads it as a refusal");
  assert.strictEqual(tab.record().transcript, true,
    "the record written over the pool entry says the participant refused");
  // The other two answers were never affected, and must not start to be.
  assert.strictEqual(tab.record().workshop, true);
  assert.strictEqual(tab.record().research, false);
});

test("it survives every later reload too, not only the first", () => {
  /* The resumed join saves the resume data again. A fix that restored the
     answer once and then saved it back without the field would pass a
     single-reload test and lose it on the next one. */
  const { tab } = joinThenReload({ a: true, b: true, c: true }, 3);
  assert.strictEqual(tab.sandbox.joins, 1);
  assert.deepStrictEqual(
    [tab.record().workshop, tab.record().research, tab.record().transcript],
    [true, true, true]);
});

test("a participant who left the transcript box unticked is not recorded as true by a reload", () => {
  const { tab } = joinThenReload({ a: true, b: true, c: false }, 2);
  assert.strictEqual(tab.sandbox.joins, 1);
  assert.strictEqual(tab.box("consent-transcript"), false);
  assert.strictEqual(tab.record().transcript, false);
  assert.strictEqual(tab.record().research, true);
});

test("what the resumed join saves back for the NEXT reload still carries the answer", () => {
  const { storage } = joinThenReload({ a: true, b: false, c: true });
  assert.strictEqual(JSON.parse(storage.canamed_resume).consent.transcript, true);
});

/* Saved join data as an older build, or someone with dev tools, left it. */
function loadStored(consent) {
  const storage = {
    canamed_resume: JSON.stringify({
      sessionNum: "abc-def", name: "Aiko", university: "Nagoya", year: 3,
      english: "B2", room: null, consent
    })
  };
  const tab = openTab(storage);
  tab.load();
  return tab;
}

test("a saved consent with no transcript answer still resumes, and is not turned into a yes", () => {
  const tab = loadStored({ workshop: true, research: true, version: NOTICE, at: 1700000000000 });
  assert.strictEqual(tab.sandbox.joins, 1, "a consent saved before the third box no longer resumes");
  assert.strictEqual(tab.box("consent-transcript"), false);
  assert.notStrictEqual(tab.record().transcript, true);
  assert.strictEqual(tab.record().research, true);
});

test("a saved transcript answer that is not a boolean is not acted on at all", () => {
  /* localStorage is writable by anyone at the keyboard. The page must not
     rejoin on — and so write to the database — a consent record built from a
     value it cannot read. The participant is shown the lobby and asked. */
  for (const bad of ["true", 1, null, {}, []]) {
    const tab = loadStored({
      workshop: true, research: true, transcript: bad, version: NOTICE, at: 1700000000000
    });
    const what = "transcript " + JSON.stringify(bad);
    assert.strictEqual(tab.sandbox.joins, 0, what + ": the page rejoined on it");
    assert.strictEqual(tab.box("consent-transcript"), false, what + ": the box was ticked");
    assert.strictEqual(tab.box("consent-workshop"), false, what);
    assert.strictEqual(tab.record(), null, what);
  }
});

// ======================================================== 2. the withdrawal

/* The real function and the real path helpers, over a database that records
   every write.
     inSession: the session the page is in ("" at the splash)
     org:       the deployment's org slug (default: the legacy sessions/ tree)
     refuse:    a pattern of paths whose write is rejected */
function withdrawalWorld(o) {
  o = Object.assign({ inSession: "", org: "caen-nagoya", refuse: null }, o || {});
  const { db, writes } = recordingDb(o.refuse);
  const sandbox = {
    db, window: {}, DEFAULT_ORG: "caen-nagoya", currentOrg: o.org,
    sessionNum: o.inSession, clientId: CLIENT,
    /* A page that is in the session (or in none) and has not joined: no
       consent in memory, nothing saved. Part 3 covers the joined page. */
    myConsent: null, RESUME_KEY: "canamed_resume",
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(WITHDRAWAL_SOURCE, sandbox);
  return {
    writes,
    paths: () => writes.map((w) => w.path),
    withdraw: (code, uid, opts) => sandbox.withdrawResearchConsent(code, uid, opts)
  };
}

const MIRROR = /\/pool\//;

test("withdrawing from an earlier session leaves the open session's pool entry alone", async () => {
  const w = withdrawalWorld({ inSession: "bbb-222" });
  await w.withdraw("aaa-111", UID, { alsoRequestErasure: true });

  assert.deepStrictEqual(w.paths(), ["withdrawals/aaa-111/" + UID],
    "something besides session A's withdrawal record was written");
  assert.strictEqual(w.paths().filter((p) => p.indexOf("bbb-222") !== -1).length, 0,
    "the open session B was written to by a withdrawal from session A");
});

test("only the very same session counts as the one the page is in", async () => {
  /* Session codes are database path segments: a different case or a longer or
     shorter code is a different session, and its withdrawal must not reach
     this one's pool. */
  for (const other of ["BBB-222", "bbb-22", "bbb-2222", "xbbb-222", "pool"]) {
    const w = withdrawalWorld({ inSession: "bbb-222" });
    await w.withdraw(other, UID);
    assert.deepStrictEqual(w.paths(), ["withdrawals/" + other + "/" + UID], other);
  }
});

test("with no session open, the withdrawal record is the only write", async () => {
  const w = withdrawalWorld({ inSession: "" });
  await w.withdraw("aaa-111", UID, { alsoRequestErasure: true });

  assert.deepStrictEqual(w.paths(), ["withdrawals/aaa-111/" + UID]);
  /* What used to go out: sessions/ + "" + /pool/<clientId>/consent/research —
     a write into a "session" named pool. */
  assert.strictEqual(w.paths().filter((p) => MIRROR.test(p)).length, 0);
});

test("withdrawing from the session the page is in still switches research off in its pool entry", async () => {
  /* The control for the three tests above: they would all pass if the mirror
     write had simply been deleted. It must still happen for the one session it
     was always meant for. */
  const w = withdrawalWorld({ inSession: "aaa-111" });
  await w.withdraw("aaa-111", UID);

  assert.deepStrictEqual(w.writes.map((x) => [x.path, x.value === false ? false : "record"]), [
    ["withdrawals/aaa-111/" + UID, "record"],
    ["sessions/aaa-111/pool/c0ffee0000000001/consent/research", false]
  ]);
});

test("the same holds in an org-scoped deployment", async () => {
  const other = withdrawalWorld({ inSession: "bbb-222", org: "partner" });
  await other.withdraw("aaa-111", UID);
  assert.deepStrictEqual(other.paths(), ["withdrawals/orgs/partner/aaa-111/" + UID]);

  const same = withdrawalWorld({ inSession: "aaa-111", org: "partner" });
  await same.withdraw("aaa-111", UID);
  assert.deepStrictEqual(same.paths(), [
    "withdrawals/orgs/partner/aaa-111/" + UID,
    "orgs/partner/sessions/aaa-111/pool/c0ffee0000000001/consent/research"
  ]);
});

test("the withdrawal record itself is written exactly as before", async () => {
  const before = Date.now();
  const plainAsk = withdrawalWorld({ inSession: "bbb-222" });
  await plainAsk.withdraw("aaa-111", UID);
  const rec = plainAsk.writes[0].value;
  assert.deepStrictEqual(Object.keys(rec).sort(), ["at", "research"]);
  assert.strictEqual(rec.research, false);
  assert.ok(rec.at >= before && rec.at <= Date.now(), "at is not the time of the withdrawal");

  const withErasure = withdrawalWorld({ inSession: "bbb-222" });
  await withErasure.withdraw("aaa-111", UID, { alsoRequestErasure: true });
  assert.deepStrictEqual(Object.keys(withErasure.writes[0].value).sort(),
    ["at", "erasure", "research"]);
  assert.strictEqual(withErasure.writes[0].value.erasure, true);

  // No code or no user: nothing is written, and the caller is told.
  for (const [code, uid] of [["", UID], ["aaa-111", ""], [null, UID], ["aaa-111", null]]) {
    const w = withdrawalWorld({ inSession: "aaa-111" });
    await assert.rejects(() => w.withdraw(code, uid), /not ready/);
    assert.deepStrictEqual(w.writes, []);
  }
});

test("a refused pool write does not fail the withdrawal", async () => {
  /* On a closed session the rules refuse every write under sessions/<code>,
     and withdrawal is exercised precisely then. The withdrawal IS the
     withdrawals/ record, so a refused pool write must not turn a recorded
     withdrawal into an error. That is not because the pool flag is
     unimportant — on an open session it is the only thing the facilitator's
     research CSV reads (part 3) — but because on a closed one nothing can
     write it. */
  const w = withdrawalWorld({ inSession: "aaa-111", refuse: MIRROR });
  await w.withdraw("aaa-111", UID);
  assert.strictEqual(w.paths().length, 2);
});

test("a refused withdrawal record IS a failure, and nothing is mirrored after it", async () => {
  const w = withdrawalWorld({ inSession: "aaa-111", refuse: /^withdrawals\// });
  await assert.rejects(() => w.withdraw("aaa-111", UID), /denied/);
  assert.deepStrictEqual(w.paths(), ["withdrawals/aaa-111/" + UID]);
});

// =========================================== 3. a reload after a withdrawal

const HERE = "abc-def";              // the session every openTab() is in
const ALL = { a: true, b: true, c: true };
const POOL_FLAG = "sessions/" + HERE + "/pool/" + CLIENT + "/consent/research";

/* One participant: every box ticked, joined, and placed in a room. */
function joinedTab(storage, o) {
  const tab = openTab(storage, o);
  tab.tick(ALL);
  tab.join("Room 2");
  return tab;
}

test("why the pool flag matters: the facilitator's research CSV reads it and nothing else", () => {
  /* The premise of this part, held to the source. If the in-browser CSV ever
     consults withdrawals/, the reasoning in the header needs revisiting — and
     under today's rules it cannot: only the participant may read that node. */
  const ADMIN = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
  assert.match(extractFn(ADMIN, "_hasResearchConsent"), /p\.consent\.research === true/);
  assert.doesNotMatch(ADMIN, /withdrawals\/|withdrawalPath/);
  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
  assert.strictEqual(rules.withdrawals.$sessionId.$uid[".read"],
    "auth != null && auth.uid == $uid");
});

test("after a withdrawal made inside the session, a reload rejoins with research off", async () => {
  const storage = {};
  const tab = joinedTab(storage);
  assert.strictEqual(tab.record().research, true, "the join did not record research consent");
  assert.strictEqual(saved(storage).consent.research, true);

  await tab.withdraw(HERE);
  assert.deepStrictEqual(tab.writes.map((w) => w.path),
    ["withdrawals/" + HERE + "/" + UID, POOL_FLAG]);

  /* The page that withdrew: its own record is what the safety-net pool write
     and every later save send. */
  assert.strictEqual(tab.record().research, false,
    "the page still holds research:true, and re-asserts it with its next pool write");
  /* The saved join data: what the next page load ticks the boxes from. */
  assert.strictEqual(saved(storage).consent.research, false,
    "the saved join data still says research:true, so a reload ticks the box again");

  const next = reload(storage);
  assert.strictEqual(next.sandbox.joins, 1, "the reload did not resume the session");
  assert.strictEqual(next.box("consent-research"), false,
    "the research box came back ticked after a withdrawal");
  assert.strictEqual(next.record().research, false,
    "the reload recorded research consent again, after the participant withdrew it");

  const later = reload(storage, 3);
  assert.strictEqual(later.sandbox.joins, 1);
  assert.strictEqual(later.record().research, false, "it came back on a later reload");
  assert.strictEqual(saved(storage).consent.research, false);
});

test("a participant who did not withdraw still has research on after the same reloads", () => {
  /* The control: the test above would pass if a reload simply never restored
     the research answer. */
  const storage = {};
  joinedTab(storage);
  const next = reload(storage);
  assert.strictEqual(next.sandbox.joins, 1);
  assert.strictEqual(next.box("consent-research"), true);
  assert.strictEqual(next.record().research, true);
  assert.strictEqual(reload(storage, 3).record().research, true);
  assert.strictEqual(saved(storage).consent.research, true);
});

test("the withdrawal lowers the research answer and nothing else that is saved", async () => {
  const storage = {};
  const tab = joinedTab(storage);
  const before = saved(storage);
  const consentBefore = tab.record();

  await tab.withdraw(HERE);

  /* The room above all: the page's own `myRoom` is null here (as it is between
     a resumed join and entering the room), so a re-save built from page state
     would send the participant back to the waiting room on their next reload. */
  assert.strictEqual(saved(storage).room, "Room 2", "the saved room was lost");
  const expected = Object.assign({}, before,
    { consent: Object.assign({}, before.consent, { research: false }) });
  assert.deepStrictEqual(saved(storage), expected);
  // `transcript` and `workshop` are separate answers and were not withdrawn.
  assert.deepStrictEqual(tab.record(), Object.assign({}, consentBefore, { research: false }));
  assert.strictEqual(tab.record().transcript, true);
  assert.strictEqual(tab.record().workshop, true);

  const next = reload(storage);
  assert.deepStrictEqual(
    [next.record().workshop, next.record().research, next.record().transcript],
    [true, false, true]);
  assert.strictEqual(saved(storage).room, "Room 2", "the reload did not keep the room either");
});

test("a withdrawal from ANOTHER session lowers nothing in this one", async () => {
  /* Defect 2 again, for the two new copies: only a withdrawal from the session
     the page is in may touch what this page holds and has saved. */
  const storage = {};
  const tab = joinedTab(storage);
  const before = storage.canamed_resume;

  await tab.withdraw("old-111");

  assert.deepStrictEqual(tab.writes.map((w) => w.path), ["withdrawals/old-111/" + UID]);
  assert.strictEqual(tab.record().research, true);
  assert.strictEqual(storage.canamed_resume, before, "the saved join data was rewritten");
  assert.strictEqual(reload(storage).record().research, true);
});

test("saved join data for a DIFFERENT session is left alone", async () => {
  /* The browser's saved data may name another session than the one the page is
     in (a deep link to B over a saved A). Withdrawing from B must not edit A's
     saved answers. */
  const storage = {
    canamed_resume: JSON.stringify({
      sessionNum: "other-999", name: "Aiko", university: "Nagoya", year: 3, english: "B2",
      room: "Room 1",
      consent: { workshop: true, research: true, transcript: true, version: NOTICE, at: 5 }
    })
  };
  const before = storage.canamed_resume;
  const tab = openTab(storage);
  await tab.withdraw(HERE);
  assert.strictEqual(storage.canamed_resume, before);
});

test("a withdrawal made before this page has joined still lowers what a reload would restore", async () => {
  /* The page is in the session (code entered) but holds no consent of its own:
     a facilitator's view, or the lobby. Join data saved by an earlier visit is
     still what the next resume reads. It must be lowered in place — a re-save
     from this page's empty state would wipe the name and the room with it. */
  const storage = {};
  joinedTab(storage);
  const before = saved(storage);

  const tab = openTab(storage);            // a fresh page: myConsent is null
  assert.strictEqual(tab.record(), null);
  await tab.withdraw(HERE);

  assert.strictEqual(tab.record(), null, "a consent record was invented for a page that never joined");
  assert.deepStrictEqual(saved(storage), Object.assign({}, before,
    { consent: Object.assign({}, before.consent, { research: false }) }));
  const next = reload(storage);
  assert.strictEqual(next.sandbox.joins, 1);
  assert.strictEqual(next.record().research, false);
});

test("with nothing saved and nothing joined, a withdrawal saves nothing", async () => {
  const storage = {};
  const tab = openTab(storage);
  await tab.withdraw(HERE);
  assert.deepStrictEqual(Object.keys(storage), [], "join data was created by a withdrawal");
  assert.strictEqual(tab.record(), null);
});

test("a withdrawal confirmed before the join has saved anything is carried by the join's own save", async () => {
  /* The waiting screen and its button appear as soon as Join is pressed; the
     pool write and the save follow once sign-in settles. A fast withdrawal
     lands in between: there is a consent in memory and nothing saved yet. */
  const storage = {};
  const tab = openTab(storage);
  tab.tick(ALL);
  vm.runInContext("joinParticipant();", tab.sandbox);       // joined, not yet saved
  await tab.withdraw(HERE);
  assert.strictEqual(tab.record().research, false);
  assert.deepStrictEqual(Object.keys(storage), []);

  tab.resave();                                             // the join's own save
  assert.strictEqual(saved(storage).consent.research, false);
  assert.strictEqual(reload(storage).record().research, false);
});

test("being placed in a room after withdrawing does not save research consent back", async () => {
  /* Withdraw on the waiting screen; the facilitator then starts the session.
     enterRoom() saves the join data again, from the page's own record — which
     is why lowering the saved copy alone is not enough. */
  assert.match(SCRIPT, /if \(!asAdmin\) saveResume\(roomName\);/,
    "enterRoom() no longer saves the join data; this test models that save");
  const storage = {};
  const tab = openTab(storage);
  tab.tick(ALL);
  tab.join(null);                                           // waiting room, no room yet
  await tab.withdraw(HERE);
  assert.strictEqual(saved(storage).consent.research, false);

  tab.sandbox.__room = "Room 3";
  vm.runInContext("saveResume(__room);", tab.sandbox);      // enterRoom()'s save
  assert.strictEqual(saved(storage).consent.research, false,
    "entering the room saved research:true over the withdrawal");
  assert.strictEqual(saved(storage).room, "Room 3");
  assert.strictEqual(reload(storage).record().research, false);
});

test("a withdrawal that could not be recorded lowers nothing", async () => {
  /* The participant is told it failed and asked to try again. Their consent
     has not been withdrawn, so no copy of it may say that it has. */
  const storage = {};
  const tab = joinedTab(storage, { refuse: /^withdrawals\// });
  const before = storage.canamed_resume;
  await assert.rejects(() => tab.withdraw(HERE), /denied/);
  assert.strictEqual(tab.record().research, true);
  assert.strictEqual(storage.canamed_resume, before);
});

test("a refused pool write (closed session) still lowers what a reload would restore", async () => {
  const storage = {};
  const tab = joinedTab(storage, { refuse: /\/pool\// });
  await tab.withdraw(HERE);
  assert.strictEqual(tab.record().research, false);
  assert.strictEqual(saved(storage).consent.research, false);
});

test("unreadable or unavailable saved data does not stop the withdrawal", async () => {
  /* The withdrawal is recorded first and the pool flag must still be lowered
     whatever state the browser's storage is in. */
  for (const junk of ["{not json", "null", "42", "\"text\"", "[]", "{}", "{\"sessionNum\":\"abc-def\"}"]) {
    const storage = { canamed_resume: junk };
    const tab = openTab(storage);
    await tab.withdraw(HERE);
    assert.deepStrictEqual(tab.writes.map((w) => w.path),
      ["withdrawals/" + HERE + "/" + UID, POOL_FLAG], "saved data: " + junk);
    assert.strictEqual(storage.canamed_resume, junk, "saved data was rewritten: " + junk);
  }

  // localStorage throwing on every call (Safari private mode, storage disabled).
  const tab = openTab({}, { brokenStore: true });
  tab.tick(ALL);
  vm.runInContext("joinParticipant();", tab.sandbox);
  await tab.withdraw(HERE);
  assert.deepStrictEqual(tab.writes.map((w) => w.path),
    ["withdrawals/" + HERE + "/" + UID, POOL_FLAG]);
  assert.strictEqual(tab.record().research, false, "the page's own record was not lowered");
});
