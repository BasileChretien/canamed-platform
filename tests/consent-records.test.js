/* tests/consent-records.test.js
 *
 * Two ways a participant's recorded consent was being rewritten without the
 * participant doing anything that meant it.
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
 *    The first half of this file runs that round trip on the code that does
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
 *    The second half drives the real function against a database that records
 *    every write.
 *
 * What a sandbox cannot show is the browser: that the box really comes back
 * ticked, that the pool entry really is rewritten, that the dialog's button
 * really reaches this function. That is tests-e2e/consent-records.spec.js.
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

/* One browser tab: its own boxes and page state, over a localStorage that
   outlives it. `load()` is what a page load does up to the resumed join. */
function openTab(storage) {
  const nodes = Object.create(null);
  const sandbox = {
    el: (id) => nodes[id] || (nodes[id] = { value: "", checked: false, disabled: false }),
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); }
    },
    /* script.js wraps lib.js's function with the deployment's cohort list. */
    sanitizeResume: (r) => lib.sanitizeResume(r, ["Caen", "Nagoya"]),
    CONSENT_NOTICE_VERSION: NOTICE,
    RESUME_KEY: "canamed_resume",
    sessionNum: "abc-def", myName: "Aiko", myUniversity: "Nagoya",
    myYear: 3, myEnglish: "B2",
    myConsent: null, resumeData: null,
    joins: 0,
    Date, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn(SCRIPT, "saveResume") + "\n" +
    extractFn(SCRIPT, "autoResume") + "\n" +
    "function joinParticipant() {\n" + joinConsentSource() + "\njoins++;\n}\n",
    sandbox);
  return {
    sandbox,
    tick(boxes) {
      sandbox.el("consent-workshop").checked = boxes.a;
      sandbox.el("consent-research").checked = boxes.b;
      sandbox.el("consent-transcript").checked = boxes.c;
    },
    box: (id) => sandbox.el(id).checked,
    /* The participant presses Join; the join saves the resume data. */
    join() { vm.runInContext("joinParticipant(); saveResume(null);", sandbox); },
    /* A page load: read the saved data back, then resume. */
    load() { vm.runInContext(readBackSource() + "autoResume();", sandbox); },
    /* What the pool entry is written with. */
    record: () => (sandbox.myConsent ? plain(sandbox.myConsent) : null)
  };
}

/* Join with the given boxes, then reload `times` times. Each reload is a new
   tab state over the same localStorage, and saves again after it rejoins —
   exactly as _joinParticipantWireUp() does. */
function joinThenReload(boxes, times) {
  const storage = {};
  const first = openTab(storage);
  first.tick(boxes);
  first.join();
  let tab = first;
  for (let i = 0; i < (times || 1); i++) {
    tab = openTab(storage);
    tab.load();
    if (tab.sandbox.joins) vm.runInContext("saveResume(null);", tab.sandbox);
  }
  return { first, tab, storage };
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
  const writes = [];
  const db = {
    ref: (p) => ({
      set: (value) => {
        writes.push({ path: p, value: plain(value) });
        return (o.refuse && o.refuse.test(p))
          ? Promise.reject(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }))
          : Promise.resolve();
      }
    })
  };
  const sandbox = {
    db, window: {}, DEFAULT_ORG: "caen-nagoya", currentOrg: o.org,
    sessionNum: o.inSession, clientId: "c0ffee0000000001",
    Date, Promise, Error
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ["_sessionPrefix", "oPath", "sPath", "withdrawalPath", "withdrawResearchConsent"]
      .map((n) => extractFn(SCRIPT, n)).join("\n"),
    sandbox);
  return {
    writes,
    paths: () => writes.map((w) => w.path),
    withdraw: (code, uid, opts) => sandbox.withdrawResearchConsent(code, uid, opts)
  };
}

const UID = "uidParticipant";
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
     and withdrawal is exercised precisely then. The withdrawals record is what
     the research export reads; the pool write is a courtesy. */
  const w = withdrawalWorld({ inSession: "aaa-111", refuse: MIRROR });
  await w.withdraw("aaa-111", UID);
  assert.strictEqual(w.paths().length, 2);
});

test("a refused withdrawal record IS a failure, and nothing is mirrored after it", async () => {
  const w = withdrawalWorld({ inSession: "aaa-111", refuse: /^withdrawals\// });
  await assert.rejects(() => w.withdraw("aaa-111", UID), /denied/);
  assert.deepStrictEqual(w.paths(), ["withdrawals/aaa-111/" + UID]);
});
