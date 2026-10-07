/* tests/consent-records.test.js
 *
 * Four ways a participant's recorded consent was being rewritten without the
 * participant doing anything that meant it. The third and the fourth were
 * found by the two review rounds of the fix for the first two, in the same
 * flow.
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
 * 3. A RELOAD AFTER A WITHDRAWAL RECORDED RESEARCH CONSENT AGAIN.
 *    A withdrawal made inside the session set the pool entry's
 *    consent/research to false and left other copies of the answer at true:
 *    the in-memory record (`myConsent`) and the saved join data. The next
 *    reload ticked the research box from the saved copy, rejoined, and wrote
 *    research:true over the pool entry, dated after the withdrawal.
 *
 *    That flag is not a courtesy. The server-side export applies the
 *    withdrawals/ records over it, but the facilitator's in-browser research
 *    CSV (admin-tools.js, _hasResearchConsent) reads consent.research in the
 *    pool entry and nothing else, and the rules let nobody but the participant
 *    read their withdrawals/ record. A withdrawn participant was back in that
 *    file after one reload.
 *
 * 4. THE SAME, WHEN THE WITHDRAWAL WAS MADE FROM SOMEWHERE ELSE.
 *    The fix for (3) lowered the saved copy only when the page was IN the
 *    session withdrawn from. But the account dialog is the route for
 *    withdrawing from a session one is NOT in: from the front page, or from
 *    another session's lobby, the withdrawal was recorded and the join data
 *    this browser had saved for that session still said true. Coming back to
 *    the session recorded research:true again. There is also a third copy the
 *    fix for (3) never lowered: `resumeData`, parsed once when the page loads,
 *    which is what autoResume() actually reads — so the page that had just
 *    shown "Withdrawn" re-recorded consent on entering the session, without
 *    even a reload.
 *
 * HOW THIS FILE TESTS IT. Every test runs one or more PAGES over one
 * browser's storage. A page is the code script.js runs, taken from the source
 * so the test follows the code rather than a copy of it: the module-level
 * read-back of the saved data, autoResume(), the statements joinParticipant()
 * reads the form with and the record it builds, saveResume() and the two
 * places it is called from, the real sanitizeResume(), and the real
 * withdrawResearchConsent() over a database that records every write. A page
 * starts where a browser starts — on the front page, in no session — and
 * enters a session as the app does. (4) was missed because an earlier version
 * of this harness could only build pages that were already in the session.
 *
 * NOT COVERED, by the fixes or by these tests. The consent record is rebuilt
 * from what ONE BROWSER TAB remembers, and these fixes lower what that tab
 * can reach:
 *   - a second device signed in as the same person keeps its own saved answer
 *     and writes it again on its next reload;
 *   - a second tab open in the same session keeps its own pool entry at true,
 *     and can save `true` back over the lowered copy (every tab saves its own
 *     in-memory answer to the one shared key), so the tab that withdrew is not
 *     safe from it either;
 *   - after a withdrawal made while the page is not in the session, that
 *     session's pool entry is not written at all — it stays as it was until
 *     this browser rejoins.
 * Closing these needs the join to read the participant's own withdrawals/
 * record, which is a separate change.
 *
 * What a sandbox cannot show is the browser: that the box really comes back
 * ticked, that the pool entry really is rewritten, that the buttons really
 * reach this function. That is tests-e2e/consent-records.spec.js.
 * sanitizeResume() on its own is pinned in tests/lib.test.js.
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

// ============================================================= the harness

const NOTICE = (SCRIPT.match(/const CONSENT_NOTICE_VERSION = "([^"]+)";/) || [])[1];

/* What joinParticipant() takes from the join form: the statements that read
   the three boxes and the four profile fields, and the record it pins to
   `myConsent` — the object both pool writes send as `consent`. Lifted out of
   the function because the rest of it needs a whole page. */
function joinSource() {
  const join = extractFn(SCRIPT, "joinParticipant");
  const one = (re, what) => {
    const m = join.match(re);
    assert.ok(m, "joinParticipant() no longer " + what);
    return m[0];
  };
  return ["cWorkshop", "cResearch", "cTranscript", "cVerification"]
    .map((n) => one(new RegExp("const " + n + " = [^;]+;"), "declares " + n))
    .concat(["myName", "myUniversity", "myYear", "myEnglish"]
      .map((n) => one(new RegExp(n + " = [^;]+;"), "sets " + n)))
    .concat(one(/myConsent = \{[^}]+\};/, "builds myConsent as one literal"))
    .join("\n");
}

/* The line that reads the saved join data back when the page loads. */
function readBackSource() {
  const m = SCRIPT.match(/try \{ resumeData = sanitizeResume\([^\n]+\n/);
  assert.ok(m, "script.js no longer reads resumeData back through sanitizeResume");
  return m[0];
}

/* What every join saves, first or resumed: _joinParticipantWireUp() keeps the
   room the saved data named, and saves with it. */
function wireUpSaveSource() {
  const wire = extractFn(SCRIPT, "_joinParticipantWireUp");
  const room = wire.match(/const resumeRoom = [^;]+;/);
  assert.ok(room, "_joinParticipantWireUp() no longer derives resumeRoom");
  assert.match(wire, /saveResume\(resumeRoom\);/);
  return "{ " + room[0] + " saveResume(resumeRoom); }";
}

/* Everything a page runs, as one program. */
const PAGE_SOURCE =
  ["saveResume", "autoResume", "_sessionPrefix", "oPath", "sPath", "withdrawalPath",
    "withdrawResearchConsent"].map((n) => extractFn(SCRIPT, n)).join("\n") +
  "\nfunction joinParticipant() {\n" + joinSource() + "\njoins++;\n}\n";

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

const HERE = "abc-def";       // the session the participant is in, or was in
const OTHER = "other-999";    // some other session
const UID = "uidParticipant";
const CLIENT = "c0ffee0000000001";
const ALL = { a: true, b: true, c: true };

/* One page load in one browser tab, over a localStorage that outlives it.
     inSession:    where the page is once loaded — "" for the front page (no
                   session), or the code of a session it has entered
     org:          the deployment's org slug (default: the legacy sessions/ tree)
     refuse:       a pattern of database paths whose write is rejected
     brokenStore:  every localStorage call throws (Safari private mode)
   Entering a session is what enterUnlockedSession() does: set the session,
   then let autoResume() rejoin if the saved data is for it. */
function openPage(storage, o) {
  o = Object.assign({ inSession: "", org: "caen-nagoya", refuse: null, brokenStore: false }, o || {});
  const nodes = Object.create(null);
  const { db, writes } = recordingDb(o.refuse);
  const broken = () => { throw new Error("storage is unavailable"); };
  const el = (id) => nodes[id] || (nodes[id] = { value: "", checked: false, disabled: false });
  const sandbox = {
    el,
    readName: () => el("name-input").value || null,
    localStorage: o.brokenStore ? { getItem: broken, setItem: broken } : {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); }
    },
    /* script.js wraps lib.js's function with the deployment's cohort list. */
    sanitizeResume: (r) => lib.sanitizeResume(r, ["Caen", "Nagoya"]),
    CONSENT_NOTICE_VERSION: NOTICE,
    RESUME_KEY: "canamed_resume",
    /* As a freshly loaded page has them: in no session, nobody joined. */
    sessionNum: "", myName: null, myUniversity: null, myYear: null, myEnglish: null,
    myConsent: null, myRoom: null, resumeData: null,
    joins: 0, room: null,
    db, clientId: CLIENT, window: {}, DEFAULT_ORG: "caen-nagoya", currentOrg: o.org
  };
  vm.createContext(sandbox);
  vm.runInContext(PAGE_SOURCE, sandbox);
  vm.runInContext(readBackSource(), sandbox);     // module level: runs at page load
  const run = (code) => vm.runInContext(code, sandbox);
  const page = {
    sandbox, writes,
    paths: () => writes.map((w) => w.path),
    box: (id) => el(id).checked,
    /* The session code is entered (typed, linked, or restored at load). */
    enter(code) {
      const before = sandbox.joins;
      sandbox.sessionNum = code;
      run("autoResume();");
      if (sandbox.joins > before) page.finishJoin();
      return page;
    },
    /* The participant fills the form and presses Join. Nothing is saved until
       sign-in settles and the join is wired up — finishJoin(). */
    press(boxes) {
      el("name-input").value = "Aiko";
      el("uni-input").value = "Nagoya";
      el("year-input").value = "3";
      el("english-input").value = "B2";
      el("consent-workshop").checked = boxes.a;
      el("consent-research").checked = boxes.b;
      el("consent-transcript").checked = boxes.c;
      run("joinParticipant();");
      return page;
    },
    finishJoin() { run(wireUpSaveSource()); return page; },
    join(boxes) { return page.press(boxes).finishJoin(); },
    /* The facilitator starts the session: enterRoom() notes the room and saves. */
    place(room) {
      sandbox.room = room;
      run("myRoom = room; saveResume(room);");
      return page;
    },
    /* The participant withdraws and confirms (runWithdrawalFlow's call). */
    withdraw: (code) => sandbox.withdrawResearchConsent(code, UID, { alsoRequestErasure: true }),
    /* The function itself, with whatever arguments. */
    call: (code, uid, opts) => sandbox.withdrawResearchConsent(code, uid, opts),
    /* What the pool entry is written with. */
    record: () => (sandbox.myConsent ? plain(sandbox.myConsent) : null)
  };
  if (o.inSession) page.enter(o.inSession);
  return page;
}

/* The saved join data, as stored. */
const saved = (storage) => JSON.parse(storage.canamed_resume);

/* Reload `times` times and land back in HERE each time, as a browser that
   holds the session code does. Returns the last page. */
function reload(storage, times) {
  let page = null;
  for (let i = 0; i < (times || 1); i++) page = openPage(storage, { inSession: HERE });
  return page;
}

/* Join HERE with the given boxes, then reload. */
function joinThenReload(boxes, times) {
  const storage = {};
  const first = openPage(storage, { inSession: HERE }).join(boxes);
  return { first, tab: reload(storage, times), storage };
}

/* One participant: every box ticked, joined HERE, and placed in a room. */
function joinedPage(storage, o) {
  return openPage(storage, Object.assign({ inSession: HERE }, o)).join(ALL).place("Room 2");
}

test("the pieces of the harness are the ones the page runs", () => {
  /* If any of these stops matching, the tests below would be driving an empty
     harness. Each helper asserts for itself; this states the set. */
  assert.ok(NOTICE, "CONSENT_NOTICE_VERSION is no longer a string constant");
  assert.match(joinSource(), /transcript: cTranscript/);
  assert.match(joinSource(), /el\("consent-transcript"\)/);
  assert.match(joinSource(), /myName = readName\(/);
  assert.match(readBackSource(), /localStorage\.getItem\(RESUME_KEY\)/);
  assert.match(extractFn(SCRIPT, "saveResume"), /consent: myConsent/);
  /* Both pool writes send the record this file follows. */
  assert.strictEqual(
    extractFn(SCRIPT, "_joinParticipantWireUp").split("consent: myConsent").length - 1, 2);
  /* The two saves the harness models, and the call that enters a session. */
  assert.match(SCRIPT, /if \(!asAdmin\) saveResume\(roomName\);/,
    "enterRoom() no longer saves the join data; place() models that save");
  assert.match(extractFn(SCRIPT, "enterUnlockedSession"), /autoResume\(\);/,
    "entering a session no longer runs autoResume(); enter() models that");
  /* A page really starts where openPage() starts it. */
  const fresh = openPage({});
  assert.strictEqual(fresh.sandbox.sessionNum, "");
  assert.strictEqual(fresh.record(), null);
  assert.strictEqual(fresh.sandbox.joins, 0);
});

// ============================================================ 1. the reload

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
  const { tab } = joinThenReload(ALL, 3);
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
  assert.strictEqual(saved(storage).consent.transcript, true);
});

test("the reload brings back who joined, and where, with the answers", () => {
  /* The harness check for everything below: name, university, year, level and
     room travel the same road as the consent, so a page that rejoins is the
     same participant in the same room. */
  const storage = {};
  joinedPage(storage);
  const next = reload(storage);
  assert.deepStrictEqual(
    plain([next.sandbox.myName, next.sandbox.myUniversity, next.sandbox.myYear, next.sandbox.myEnglish]),
    ["Aiko", "Nagoya", 3, "B2"]);
  assert.strictEqual(saved(storage).room, "Room 2");
  assert.strictEqual(next.sandbox.myRoom, null,
    "a resumed page knows its room only once it has entered it");
});

/* Saved join data as an older build, or someone with dev tools, left it. */
const storedWith = (consent, extra) => JSON.stringify(Object.assign({
  sessionNum: HERE, name: "Aiko", university: "Nagoya", year: 3, english: "B2",
  room: "Room 2", consent
}, extra));

test("a saved consent with no transcript answer still resumes, and is not turned into a yes", () => {
  const tab = openPage(
    { canamed_resume: storedWith({ workshop: true, research: true, version: NOTICE, at: 1700000000000 }) },
    { inSession: HERE });
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
    const tab = openPage({
      canamed_resume: storedWith({
        workshop: true, research: true, transcript: bad, version: NOTICE, at: 1700000000000
      })
    }, { inSession: HERE });
    const what = "transcript " + JSON.stringify(bad);
    assert.strictEqual(tab.sandbox.joins, 0, what + ": the page rejoined on it");
    assert.strictEqual(tab.box("consent-transcript"), false, what + ": the box was ticked");
    assert.strictEqual(tab.box("consent-workshop"), false, what);
    assert.strictEqual(tab.record(), null, what);
  }
});

// ============================= 2. a withdrawal reaches only its own session

const MIRROR = /\/pool\//;

/* A page that has entered `inSession` (or none) and has not joined, in a
   browser with nothing saved. */
const lobby = (o) => openPage({}, o);

test("withdrawing from an earlier session leaves the open session's pool entry alone", async () => {
  const w = lobby({ inSession: "bbb-222" });
  await w.call("aaa-111", UID, { alsoRequestErasure: true });

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
    const w = lobby({ inSession: "bbb-222" });
    await w.call(other, UID);
    assert.deepStrictEqual(w.paths(), ["withdrawals/" + other + "/" + UID], other);
  }
});

test("with no session open, the withdrawal record is the only write", async () => {
  const w = lobby({ inSession: "" });
  await w.call("aaa-111", UID, { alsoRequestErasure: true });

  assert.deepStrictEqual(w.paths(), ["withdrawals/aaa-111/" + UID]);
  /* What used to go out: sessions/ + "" + /pool/<clientId>/consent/research —
     a write into a "session" named pool. */
  assert.strictEqual(w.paths().filter((p) => MIRROR.test(p)).length, 0);
});

test("withdrawing from the session the page is in still switches research off in its pool entry", async () => {
  /* The control for the three tests above: they would all pass if the mirror
     write had simply been deleted. It must still happen for the one session it
     was always meant for. */
  const w = lobby({ inSession: "aaa-111" });
  await w.call("aaa-111", UID);

  assert.deepStrictEqual(w.writes.map((x) => [x.path, x.value === false ? false : "record"]), [
    ["withdrawals/aaa-111/" + UID, "record"],
    ["sessions/aaa-111/pool/" + CLIENT + "/consent/research", false]
  ]);
});

test("the same holds in an org-scoped deployment", async () => {
  const other = lobby({ inSession: "bbb-222", org: "partner" });
  await other.call("aaa-111", UID);
  assert.deepStrictEqual(other.paths(), ["withdrawals/orgs/partner/aaa-111/" + UID]);

  const same = lobby({ inSession: "aaa-111", org: "partner" });
  await same.call("aaa-111", UID);
  assert.deepStrictEqual(same.paths(), [
    "withdrawals/orgs/partner/aaa-111/" + UID,
    "orgs/partner/sessions/aaa-111/pool/" + CLIENT + "/consent/research"
  ]);
});

test("the withdrawal record itself is written exactly as before", async () => {
  const before = Date.now();
  const plainAsk = lobby({ inSession: "bbb-222" });
  await plainAsk.call("aaa-111", UID);
  const rec = plainAsk.writes[0].value;
  assert.deepStrictEqual(Object.keys(rec).sort(), ["at", "research"]);
  assert.strictEqual(rec.research, false);
  assert.ok(rec.at >= before && rec.at <= Date.now(), "at is not the time of the withdrawal");

  const withErasure = lobby({ inSession: "bbb-222" });
  await withErasure.call("aaa-111", UID, { alsoRequestErasure: true });
  assert.deepStrictEqual(Object.keys(withErasure.writes[0].value).sort(),
    ["at", "erasure", "research"]);
  assert.strictEqual(withErasure.writes[0].value.erasure, true);

  // No code or no user: nothing is written, and the caller is told.
  for (const [code, uid] of [["", UID], ["aaa-111", ""], [null, UID], ["aaa-111", null]]) {
    const w = lobby({ inSession: "aaa-111" });
    await assert.rejects(() => w.call(code, uid), /not ready/);
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
  const w = lobby({ inSession: "aaa-111", refuse: MIRROR });
  await w.call("aaa-111", UID);
  assert.strictEqual(w.paths().length, 2);
});

test("a refused withdrawal record IS a failure, and nothing is mirrored after it", async () => {
  const w = lobby({ inSession: "aaa-111", refuse: /^withdrawals\// });
  await assert.rejects(() => w.call("aaa-111", UID), /denied/);
  assert.deepStrictEqual(w.paths(), ["withdrawals/aaa-111/" + UID]);
});

// ================== 3. a reload after a withdrawal made inside the session

const POOL_FLAG = "sessions/" + HERE + "/pool/" + CLIENT + "/consent/research";
const IN_SESSION_WRITES = ["withdrawals/" + HERE + "/" + UID, POOL_FLAG];

/* `before`, with the research answer lowered and nothing else changed. */
const lowered = (before) => Object.assign({}, before,
  { consent: Object.assign({}, before.consent, { research: false }) });

test("why the pool flag matters: the facilitator's research CSV reads it and nothing else", () => {
  /* The premise of parts 3 and 4, held to the source. If the in-browser CSV
     ever consults withdrawals/, the reasoning in the header needs revisiting —
     and under today's rules it cannot: only the participant may read that
     node. */
  const ADMIN = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
  assert.match(extractFn(ADMIN, "_hasResearchConsent"), /p\.consent\.research === true/);
  assert.doesNotMatch(ADMIN, /withdrawals\/|withdrawalPath/);
  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
  assert.strictEqual(rules.withdrawals.$sessionId.$uid[".read"],
    "auth != null && auth.uid == $uid");
});

test("after a withdrawal made inside the session, a reload rejoins with research off", async () => {
  const storage = {};
  const tab = joinedPage(storage);
  assert.strictEqual(tab.record().research, true, "the join did not record research consent");
  assert.strictEqual(saved(storage).consent.research, true);

  await tab.withdraw(HERE);
  assert.deepStrictEqual(tab.paths(), IN_SESSION_WRITES);

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
  joinedPage(storage);
  const next = reload(storage);
  assert.strictEqual(next.sandbox.joins, 1);
  assert.strictEqual(next.box("consent-research"), true);
  assert.strictEqual(next.record().research, true);
  assert.strictEqual(reload(storage, 3).record().research, true);
  assert.strictEqual(saved(storage).consent.research, true);
});

test("the withdrawal lowers the research answer and nothing else that is saved", async () => {
  const storage = {};
  joinedPage(storage);
  /* Withdraw from a page that has RESUMED and not yet been placed: it does not
     know its room (`myRoom` is null) although the saved data names one. A
     re-save built from page state would send the participant back to the
     waiting room on their next reload. */
  const tab = reload(storage);
  assert.strictEqual(tab.sandbox.myRoom, null);
  const before = saved(storage);
  const consentBefore = tab.record();

  await tab.withdraw(HERE);

  assert.strictEqual(saved(storage).room, "Room 2", "the saved room was lost");
  assert.deepStrictEqual(saved(storage), lowered(before));
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
  /* Defect 2 again, for the other copies: a withdrawal from some other session
     may not touch what this page holds and has saved for this one. */
  const storage = {};
  const tab = joinedPage(storage);
  const before = storage.canamed_resume;

  await tab.withdraw("old-111");

  assert.deepStrictEqual(tab.paths(), ["withdrawals/old-111/" + UID]);
  assert.strictEqual(tab.record().research, true);
  assert.strictEqual(storage.canamed_resume, before, "the saved join data was rewritten");
  assert.strictEqual(reload(storage).record().research, true);
});

test("saved join data for a DIFFERENT session is left alone by a withdrawal from this one", async () => {
  /* The browser's saved data may name another session than the one the page is
     in (a link to B over a saved A). Withdrawing from B must not edit A's
     saved answers, nor the copy of them the page parsed when it loaded. */
  const stored = storedWith(
    { workshop: true, research: true, transcript: true, version: NOTICE, at: 5 },
    { sessionNum: OTHER });
  const storage = { canamed_resume: stored };
  const tab = openPage(storage, { inSession: HERE });
  assert.strictEqual(tab.sandbox.joins, 0, "another session's join data was resumed into this one");

  await tab.withdraw(HERE);

  assert.deepStrictEqual(tab.paths(), IN_SESSION_WRITES);
  assert.strictEqual(storage.canamed_resume, stored, "the other session's saved data was rewritten");
  assert.strictEqual(openPage(storage, { inSession: OTHER }).record().research, true);
  assert.strictEqual(tab.enter(OTHER).record().research, true,
    "the copy parsed at load was lowered for a session that was not withdrawn from");
});

test("in the lobby with an auto-resume that was declined, a withdrawal invents no consent", async () => {
  /* The page is in the session but holds no consent of its own: the saved
     data is from an older notice version, so autoResume() left the boxes
     unticked and waited. The withdrawal still lowers the saved copy — it is
     this session's — and leaves the page with nothing to re-assert. */
  const stored = storedWith(
    { workshop: true, research: true, transcript: true, version: "PIS-older", at: 5 });
  const storage = { canamed_resume: stored };
  const tab = openPage(storage, { inSession: HERE });
  assert.strictEqual(tab.sandbox.joins, 0, "an older notice version was resumed");

  await tab.withdraw(HERE);

  assert.deepStrictEqual(tab.paths(), IN_SESSION_WRITES);
  assert.strictEqual(tab.record(), null, "a consent record was invented for a page that never joined");
  assert.deepStrictEqual(saved(storage), lowered(JSON.parse(stored)));
  assert.strictEqual(reload(storage).sandbox.joins, 0, "lowering it made it resumable");
});

test("with nothing saved and nothing joined, a withdrawal saves nothing", async () => {
  const storage = {};
  const tab = openPage(storage, { inSession: HERE });
  await tab.withdraw(HERE);
  assert.deepStrictEqual(Object.keys(storage), [], "join data was created by a withdrawal");
  assert.strictEqual(tab.record(), null);
});

test("a withdrawal confirmed before the join has saved anything is carried by the join's own save", async () => {
  /* The waiting screen and its button appear as soon as Join is pressed; the
     pool write and the save follow once sign-in settles. A fast withdrawal
     lands in between: there is a consent in memory and nothing saved yet. */
  const storage = {};
  const tab = openPage(storage, { inSession: HERE }).press(ALL);   // joined, not yet saved
  await tab.withdraw(HERE);
  assert.strictEqual(tab.record().research, false);
  assert.deepStrictEqual(Object.keys(storage), []);

  tab.finishJoin();                                                // the join's own save
  assert.strictEqual(saved(storage).consent.research, false);
  assert.strictEqual(reload(storage).record().research, false);
});

test("being placed in a room after withdrawing does not save research consent back", async () => {
  /* Withdraw on the waiting screen; the facilitator then starts the session.
     enterRoom() saves the join data again, from the page's own record — which
     is why lowering the saved copy alone is not enough. */
  const storage = {};
  const tab = openPage(storage, { inSession: HERE }).join(ALL);    // waiting room, no room yet
  await tab.withdraw(HERE);
  assert.strictEqual(saved(storage).consent.research, false);

  tab.place("Room 3");
  assert.strictEqual(saved(storage).consent.research, false,
    "entering the room saved research:true over the withdrawal");
  assert.strictEqual(saved(storage).room, "Room 3");
  assert.strictEqual(reload(storage).record().research, false);
});

test("a withdrawal that could not be recorded lowers nothing", async () => {
  /* The participant is told it failed and asked to try again. Their consent
     has not been withdrawn, so no copy of it may say that it has — neither
     the page's own, nor the saved one, nor the one parsed at load. */
  for (const where of [HERE, "", OTHER]) {
    const from = "from " + JSON.stringify(where);
    const storage = {};
    joinedPage(storage);
    const tab = openPage(storage, { inSession: where, refuse: /^withdrawals\// });
    const before = storage.canamed_resume;       // after this page's own resumed join, if any

    await assert.rejects(() => tab.withdraw(HERE), /denied/);

    assert.strictEqual(storage.canamed_resume, before, from + ": the saved copy was lowered");
    assert.strictEqual(plain(tab.sandbox.resumeData).consent.research, true,
      from + ": the copy parsed at load was lowered");
    // The page that asked, once it is in the session (it already is, from HERE).
    const samePage = where === HERE ? tab : tab.enter(HERE);
    assert.strictEqual(samePage.record().research, true, from + ": the page's own record was lowered");
    assert.strictEqual(reload(storage).record().research, true, from);
  }
});

test("a refused pool write (closed session) still lowers what a reload would restore", async () => {
  const storage = {};
  const tab = joinedPage(storage, { refuse: /\/pool\// });
  await tab.withdraw(HERE);
  assert.strictEqual(tab.record().research, false);
  assert.strictEqual(saved(storage).consent.research, false);
});

test("unreadable or unavailable saved data does not stop the withdrawal", async () => {
  /* The withdrawal is recorded first and the pool flag must still be lowered
     whatever state the browser's storage is in. Nothing here is join data the
     page would act on, so none of it may be rewritten. */
  for (const junk of ["{not json", "null", "42", "\"text\"", "[]", "{}",
    "{\"sessionNum\":\"" + HERE + "\"}"]) {
    const storage = { canamed_resume: junk };
    const tab = openPage(storage, { inSession: HERE });
    await tab.withdraw(HERE);
    assert.deepStrictEqual(tab.paths(), IN_SESSION_WRITES, "saved data: " + junk);
    assert.strictEqual(storage.canamed_resume, junk, "saved data was rewritten: " + junk);
  }

  // localStorage throwing on every call (Safari private mode, storage disabled).
  const tab = openPage({}, { inSession: HERE, brokenStore: true }).press(ALL);
  await tab.withdraw(HERE);
  assert.deepStrictEqual(tab.paths(), IN_SESSION_WRITES);
  assert.strictEqual(tab.record().research, false, "the page's own record was not lowered");
});

test("a saved consent the page refuses is never edited into one it accepts", async () => {
  /* The edit sets one field. Applied to a block that sanitizeResume() refuses
     because of that very field — research missing, or not a boolean — it would
     repair the block, and the next load would rejoin on its other two answers
     without asking. Applied to something that is not a consent at all, it
     would store an invented one. So the edit is for a block the page would act
     on, and nothing else, wherever the withdrawal is made from. */
  const good = { workshop: true, research: true, transcript: true, version: NOTICE, at: 5 };
  const without = (k) => { const c = Object.assign({}, good); delete c[k]; return c; };
  const refused = [
    ["research missing", storedWith(without("research"))],
    ["research not a boolean", storedWith(Object.assign({}, good, { research: "yes" }))],
    ["research null", storedWith(Object.assign({}, good, { research: null }))],
    ["workshop missing", storedWith(without("workshop"))],
    ["workshop not a boolean", storedWith(Object.assign({}, good, { workshop: 1 }))],
    ["version missing", storedWith(without("version"))],
    ["at missing", storedWith(without("at"))],
    ["transcript not a boolean", storedWith(Object.assign({}, good, { transcript: "yes" }))],
    ["consent a string", storedWith("yes")],
    ["consent a number", storedWith(1)],
    ["consent an array", storedWith([true])],
    ["consent empty", storedWith({})],
    ["consent null", storedWith(null)],
    ["no name, so nothing is ever resumed", storedWith(good, { name: "" })]
  ];
  for (const [what, stored] of refused) {
    for (const where of [HERE, "", OTHER]) {
      const label = what + ", withdrawn from " + JSON.stringify(where);
      const storage = { canamed_resume: stored };
      const tab = openPage(storage, { inSession: where });
      assert.strictEqual(tab.sandbox.joins, 0, label + ": the block was accepted to begin with");

      await tab.withdraw(HERE);

      assert.strictEqual(storage.canamed_resume, stored, label + ": the saved data was rewritten");
      const next = reload(storage);
      assert.strictEqual(next.sandbox.joins, 0, label + ": the next load rejoined on it");
      assert.strictEqual(next.record(), null, label);
    }
  }
});

// ============ 4. a withdrawal made while the page is NOT in that session

/* The browser holds join data for HERE with research ticked — saved by a real
   join — and a new page load ends up somewhere else. */
function savedThenElsewhere(where) {
  const storage = {};
  joinedPage(storage);
  const before = saved(storage);
  assert.strictEqual(before.consent.research, true);
  const page = openPage(storage, { inSession: where });
  /* The page is where it should be, has not joined anything, and has read the
     saved data: this is the state the account dialog is opened in. */
  assert.strictEqual(page.sandbox.sessionNum, where);
  assert.strictEqual(page.sandbox.joins, 0);
  assert.strictEqual(page.record(), null);
  assert.strictEqual(plain(page.sandbox.resumeData).consent.research, true);
  return { storage, before, page };
}

for (const [where, label] of [["", "the front page"], [OTHER, "another session's lobby"]]) {
  test("withdrawn from " + label + ": the saved copy for that session says false", async () => {
    const { storage, before, page } = savedThenElsewhere(where);
    await page.withdraw(HERE);

    /* Not in HERE, so its pool entry is not this page's to write (part 2). */
    assert.deepStrictEqual(page.paths(), ["withdrawals/" + HERE + "/" + UID]);
    assert.strictEqual(saved(storage).consent.research, false,
      "the join data saved for the session withdrawn from still says research:true");
    assert.deepStrictEqual(saved(storage), lowered(before), "something else in it changed");
    assert.strictEqual(page.record(), null, "a consent record was invented for a page that never joined");
  });

  test("withdrawn from " + label + ": the same page then entering the session joins with research off", async () => {
    /* No reload in between. autoResume() reads `resumeData`, the copy parsed
       when the page loaded — lowering storage alone does not reach it. */
    const { page } = savedThenElsewhere(where);
    await page.withdraw(HERE);

    page.enter(HERE);
    assert.strictEqual(page.sandbox.joins, 1, "entering the session did not resume it");
    assert.strictEqual(page.box("consent-research"), false,
      "the research box was ticked from the copy parsed at page load");
    assert.deepStrictEqual(
      [page.record().workshop, page.record().research, page.record().transcript],
      [true, false, true]);
  });

  test("withdrawn from " + label + ": a fresh load into the session joins with research off", async () => {
    const { storage, page } = savedThenElsewhere(where);
    await page.withdraw(HERE);

    const next = reload(storage);
    assert.strictEqual(next.sandbox.joins, 1, "the load did not resume the session");
    assert.strictEqual(next.box("consent-research"), false);
    assert.deepStrictEqual(
      [next.record().workshop, next.record().research, next.record().transcript],
      [true, false, true]);
    assert.strictEqual(saved(storage).room, "Room 2");
    assert.strictEqual(reload(storage, 2).record().research, false, "it came back on a later load");
  });
}

test("control: with no withdrawal, coming back to the session from elsewhere joins with research on", () => {
  /* The six tests above would pass if entering a session from the front page
     never restored the research answer at all. */
  for (const where of ["", OTHER]) {
    const { storage, page } = savedThenElsewhere(where);
    page.enter(HERE);
    assert.strictEqual(page.sandbox.joins, 1, "from " + JSON.stringify(where));
    assert.strictEqual(page.record().research, true, "from " + JSON.stringify(where));
    assert.strictEqual(reload(storage).record().research, true);
  }
});

test("from elsewhere, a withdrawal for one session leaves what is saved for another alone", async () => {
  /* The saved data is HERE's. Withdrawing from a different past session, from
     the front page, must leave both the saved copy and the parsed one as they
     are: coming back to HERE still joins with research on. */
  for (const where of ["", OTHER]) {
    const { storage, page } = savedThenElsewhere(where);
    const before = storage.canamed_resume;

    await page.withdraw("old-111");

    assert.deepStrictEqual(page.paths(), ["withdrawals/old-111/" + UID]);
    assert.strictEqual(storage.canamed_resume, before, "the saved join data was rewritten");
    assert.strictEqual(page.enter(HERE).record().research, true,
      "the copy parsed at load was lowered for a session that was not withdrawn from");
  }
});

test("from elsewhere, the session a saved copy is for is the one the page would resume it into", async () => {
  /* sanitizeResume() cleans the saved session code before autoResume()
     compares it, so "is this saved copy for the session withdrawn from" has to
     be asked of the cleaned code — the one a resume would act on. */
  const stored = storedWith(
    { workshop: true, research: true, transcript: true, version: NOTICE, at: 5 },
    { sessionNum: "abc def!" });                    // resumes into "abcdef"
  for (const [code, expectLowered] of [["abcdef", true], [HERE, false]]) {
    const storage = { canamed_resume: stored };
    const page = openPage(storage);
    assert.strictEqual(page.sandbox.resumeData.sessionNum, "abcdef");
    await page.withdraw(code);
    assert.strictEqual(saved(storage).consent.research, !expectLowered, "withdrawn from " + code);
    assert.strictEqual(page.enter("abcdef").record().research, !expectLowered,
      "withdrawn from " + code);
  }
});
