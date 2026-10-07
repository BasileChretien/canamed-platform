/* tests/data-rights.test.js
 *
 * The two limbs of Annex VI G12 that erasure itself did not cover: whether a
 * request is ACTED ON in time (GDPR Art. 12(3)) and RECTIFICATION (Art. 16).
 *
 * The monitor's whole value is that it goes red exactly once — when a legal
 * deadline has passed — so the tests are mostly about the boundary and about
 * NOT crying wolf. A monitor that fires early is one people learn to ignore,
 * and this repository has twice lost a real failure that way.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  pendingErasures, erasureQueue, flattenErasures, planRectification,
  RECTIFIABLE, ROSTER_FIELDS, DEADLINE_DAYS,
} = require("../scripts/lib/data-rights");
const { resolveIdentity } = require("../scripts/lib/erasure");
const {
  sessionLocations, withdrawalLocations, readSessionLocationsShallow,
} = require("../scripts/lib/session-trees");

const DAY = 86400000;
const NOW = 1780000000000;
const ago = (d) => NOW - d * DAY;
/* An erasure record answers a request only if it is dated at or after it, so
   the fixtures date theirs: "answered just now". */
const ANSWERED_AT = new Date(NOW).toISOString();

// ------------------------------------------------------------ the deadline

test("a fresh erasure request is open but not overdue", () => {
  const { pending, overdue } = pendingErasures(
    { ABC: { uidA: { research: false, erasure: true, at: ago(3) } } }, [], NOW);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].ageDays, 3);
  assert.strictEqual(overdue.length, 0);
});

test("the deadline boundary is exact — day 29 is fine, day 30 is late", () => {
  /* Art. 12(3) is "within one month". Off by one here means either a spurious
     red run or a missed obligation, so it is pinned rather than assumed. */
  const at29 = pendingErasures(
    { ABC: { u: { erasure: true, at: ago(29) } } }, [], NOW);
  assert.strictEqual(at29.overdue.length, 0, "day 29 must not be overdue");
  const at30 = pendingErasures(
    { ABC: { u: { erasure: true, at: ago(30) } } }, [], NOW);
  assert.strictEqual(at30.overdue.length, 1, "day 30 must be overdue");
  assert.strictEqual(DEADLINE_DAYS, 30);
});

test("an UNDATED request is treated as overdue, not as fresh", () => {
  /* The rules require `at`, so a missing one means something wrote outside
     them. "We do not know when this arrived" must not read as "it just
     arrived" — that would hide the oldest requests, which are the ones most
     likely to already be in breach. */
  const { overdue } = pendingErasures(
    { ABC: { u: { erasure: true } } }, [], NOW);
  assert.strictEqual(overdue.length, 1);
  assert.strictEqual(overdue[0].ageDays, null);
});

test("a request already erased is counted as handled, not as open", () => {
  const w = { ABC: { uidA: { erasure: true, at: ago(40) } } };
  const { pending, overdue, handled } = pendingErasures(
    w, [{ locationKey: "ABC", uid: "uidA", at: ANSWERED_AT }], NOW);
  assert.strictEqual(handled, 1);
  assert.strictEqual(pending.length, 0);
  assert.strictEqual(overdue.length, 0, "a handled request must not fail the job");
});

test("an erasure record answers only a request made BEFORE it", () => {
  /* Matching on (session, person) for all time meant a second request was
     closed the moment it arrived: someone erased from a session who came back
     to it on the same account, did new work and asked again was "handled" by
     the record of the first erasure — the monitor never showed the request,
     and the purge (which deletes what the monitor calls answered) removed it.
     The ledger is never deleted, so that record is there for ever. */
  const dated = (d) => new Date(ago(d)).toISOString();
  const first = { ABC: { u: { erasure: true, at: ago(40) } } };
  const record = [{ locationKey: "ABC", uid: "u", at: dated(30) }];
  assert.strictEqual(pendingErasures(first, record, NOW).handled, 1,
    "a record written after the request answers it");

  const again = { ABC: { u: { erasure: true, at: ago(5) } } };
  const r = pendingErasures(again, record, NOW);
  assert.deepStrictEqual([r.handled, r.pending.length], [0, 1],
    "a request made after the last erasure is a new request");

  // ...and answering it again closes it again.
  const twice = record.concat([{ locationKey: "ABC", uid: "u", at: dated(1) }]);
  assert.strictEqual(pendingErasures(again, twice, NOW).handled, 1);
  // The order the ledger is read in must not matter.
  assert.strictEqual(pendingErasures(again, twice.slice().reverse(), NOW).handled, 1);
});

test("a record with no readable date answers nothing that has one", () => {
  /* It cannot be shown to come after the request. Every record the tool writes
     is dated, so this is about data something else wrote — and the safe reading
     of that is "still open", where a person will look at it. */
  const w = { ABC: { u: { erasure: true, at: ago(40) } } };
  for (const at of [undefined, null, "", "last tuesday", 12]) {
    const r = pendingErasures(w, [{ locationKey: "ABC", uid: "u", at }], NOW);
    assert.strictEqual(r.pending.length, 1, "at=" + JSON.stringify(at));
  }
  /* An UNDATED request is the one thing any record answers: nothing could ever
     be shown to post-date it, and it must stay closable. */
  const undated = pendingErasures({ ABC: { u: { erasure: true } } },
    [{ locationKey: "ABC", uid: "u" }], NOW);
  assert.deepStrictEqual([undated.handled, undated.pending.length], [1, 0]);
});

test("the ledger is flattened with each entry's date on its records", () => {
  /* `erasures/<id> = { at, records }`. The tool dates every record too, but a
     record that lacks one takes its entry's — the run it was written in. */
  const flat = flattenErasures({
    e1: { at: "2026-10-01T00:00:00.000Z", records: [
      { locationKey: "A", uid: "u1" },
      { locationKey: "B", uid: "u2", at: "2026-09-01T00:00:00.000Z" },
    ] },
    e2: { at: "2026-10-02T00:00:00.000Z", records: { 0: { locationKey: "C", uid: "u3" } } },
    e3: "debris", e4: { records: null }, e5: null,
  });
  assert.deepStrictEqual(flat, [
    { at: "2026-10-01T00:00:00.000Z", locationKey: "A", uid: "u1" },
    { locationKey: "B", uid: "u2", at: "2026-09-01T00:00:00.000Z" },
    { at: "2026-10-02T00:00:00.000Z", locationKey: "C", uid: "u3" },
  ]);
  for (const junk of [null, undefined, "x", 7, []]) assert.deepStrictEqual(flattenErasures(junk), []);
});

test("an erasure in ANOTHER session does not close this request", () => {
  /* Matching on uid alone would mark every future request handled the moment a
     person was erased once — the failure mode that turns a monitor into a
     rubber stamp. */
  const { pending } = pendingErasures(
    { ABC: { uidA: { erasure: true, at: ago(40) } } },
    [{ locationKey: "OTHER", uid: "uidA", at: ANSWERED_AT }], NOW);
  assert.strictEqual(pending.length, 1);
});

test("a plain withdrawal without an erasure ask is NOT an open request", () => {
  /* A bare withdrawal takes full effect the moment it is written — the export
     honours it. Listing those as outstanding would bury the real ones. */
  const { pending } = pendingErasures(
    { ABC: { u: { research: false, at: ago(90) } } }, [], NOW);
  assert.deepStrictEqual(pending, []);
});

test("the oldest request is reported first", () => {
  const { pending } = pendingErasures({
    ABC: { u1: { erasure: true, at: ago(2) }, u2: { erasure: true, at: ago(20) } },
  }, [], NOW);
  assert.deepStrictEqual(pending.map((p) => p.ageDays), [20, 2]);
});

test("empty and malformed inputs produce no false alarms", () => {
  for (const w of [null, undefined, {}, { ABC: null }, { ABC: "x" },
                   { ABC: { u: null } }, { ABC: { u: 7 } }]) {
    const r = pendingErasures(w, null, NOW);
    assert.deepStrictEqual(r.pending, []);
    assert.deepStrictEqual(r.overdue, []);
  }
});

// -------------------------------------------------------------- Art. 16

const session = () => ({
  clientMapping: { c1: "uA", c2: "uA", c3: "uB" },
  pool: {
    c1: { name: "Mispelt Name", university: "Caen", year: 4 },
    c2: { name: "Mispelt Name", university: "Caen", year: 4 },
    c3: { name: "Someone Else", university: "Nagoya", year: 5 },
  },
});

test("a correction reaches every clientId the person holds, and the roster", () => {
  const s = session();
  const id = resolveIdentity(s, { uid: "uA" });
  const { updates } = planRectification(s, id, { name: "Correct Name" },
    "rosters/sessions/ABC", { uA: { name: "Mispelt Name" } });
  assert.deepStrictEqual(Object.keys(updates).sort(), [
    "rosters/sessions/ABC/uA/name",
    "session:pool/c1/name",
    "session:pool/c2/name",
  ]);
  assert.ok(!Object.keys(updates).some((k) => k.includes("c3")),
    "somebody else's name was rewritten");
});

test("a field the ROSTER does not hold is corrected in the pool only", () => {
  /* The roster's rule seals unknown keys with `$other: {".validate": false}`,
     and the Admin SDK bypasses rules — so writing `year` there would SUCCEED
     and leave a field the schema forbids, which no client could ever write or
     validate. The two field lists exist for exactly this. */
  const s = session();
  const id = resolveIdentity(s, { uid: "uA" });
  const { updates } = planRectification(s, id, { year: 5 },
    "rosters/sessions/ABC", { uA: { name: "Mispelt Name" } });
  assert.deepStrictEqual(Object.keys(updates).sort(),
    ["session:pool/c1/year", "session:pool/c2/year"]);
  assert.ok(!ROSTER_FIELDS.includes("year"));
});

test("fields outside the allowed set are refused, not silently applied", () => {
  const s = session();
  const id = resolveIdentity(s, { uid: "uA" });
  const { updates, skipped } = planRectification(
    s, id, { consent: "yes", answers: "rewritten" },
    "rosters/sessions/ABC", { uA: {} });
  assert.deepStrictEqual(updates, {});
  assert.deepStrictEqual(skipped.sort(), ["answers", "consent"]);
});

test("answers are deliberately NOT rectifiable", () => {
  /* Art. 16 is about factual accuracy. Rewriting somebody's clinical reasoning
     after the fact falsifies the record rather than correcting it — and the
     research dataset is built from exactly those answers. */
  for (const f of ["answers", "hypotheses", "moduleA", "consent", "uid"]) {
    assert.ok(!RECTIFIABLE.includes(f), `${f} must not be correctable`);
  }
});

test("a participant not in this session yields no writes", () => {
  /* resolveIdentity echoes back whatever uid it was handed, so a typo produces
     an identity with no clientIds. Before the roster row was required to
     already exist, this CREATED a roster entry — inventing a participant, with
     a name in it, while purporting to correct one. */
  const s = session();
  const { updates } = planRectification(s, resolveIdentity(s, { uid: "uNOBODY" }),
    { name: "X" }, "rosters/sessions/ABC", { uA: {}, uB: {} });
  assert.deepStrictEqual(updates, {});
});

test("the roster is never CREATED, only updated", () => {
  /* Belt and braces on the same hazard: even a real participant gets no roster
     write when they have no roster row, because writing one would be adding
     data rather than fixing it. */
  const s = session();
  const id = resolveIdentity(s, { uid: "uA" });
  const { updates } = planRectification(s, id, { name: "N" },
    "rosters/sessions/ABC", {});
  assert.ok(!Object.keys(updates).some((k) => k.startsWith("rosters/")),
    "a roster row was created for a participant who had none");
  assert.ok(Object.keys(updates).length > 0, "the pool should still be corrected");
});

// ---------------------------------------------------------------- wiring

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* The monitor itself, RUN against a stand-in database — not read for strings.
   It was covered by greps for `process.exit(1)` and for what its log lines
   interpolate, and both stayed green while it could not see a request at all:
   the defect was in which paths it reads, which no grep of its output code
   looks at. */
const { run: runMonitor } = require("../scripts/data-rights-monitor");

/* The two read calls the scripts make: `.get()` (exists/val) and
   `.once("value")` (val). Every path read is recorded. */
function fakeDb(tree) {
  const reads = [];
  const at = (p) => p.split("/").reduce(
    (node, key) => (node !== null && typeof node === "object" && key in node ? node[key] : null), tree);
  const snap = (p) => { const v = at(p); return { exists: () => v !== null, val: () => v }; };
  return {
    reads,
    ref: (p) => ({
      get: async () => { reads.push(p); return snap(p); },
      once: async () => { reads.push(p); return snap(p); },
    }),
  };
}

/* What RTDB's REST `?shallow=true` returns for a path: its child KEYS, each
   mapped to `true`, and nothing below them — or null for an empty path. */
function shallowOf(tree, shallowReads) {
  return async (p) => {
    shallowReads.push(p);
    const node = p.split("/").reduce(
      (n, key) => (n !== null && typeof n === "object" && key in n ? n[key] : null), tree);
    if (node === null || typeof node !== "object") return null;
    return Object.fromEntries(Object.keys(node).map((k) => [k, true]));
  };
}

async function monitor(tree, opts) {
  const lines = [];
  const db = fakeDb(tree);
  const shallowReads = [];
  const code = await runMonitor(db, Object.assign({
    now: NOW, deadlineDays: 30, warnDays: 21,
    /* The REAL keys-only enumerator, over a stand-in for the REST call. */
    liveLocations: () => readSessionLocationsShallow({ fetchShallow: shallowOf(tree, shallowReads) }),
    out: (l) => lines.push(String(l)), err: (l) => lines.push(String(l)),
  }, opts));
  return { code, text: lines.join("\n"), reads: db.reads, shallowReads };
}

const request = (days) => ({ research: false, erasure: true, at: ago(days) });

test("the monitor exits 1 on an overdue request and 0 otherwise", async () => {
  const sessions = { "LIVE-1": { created: { at: ago(50) } } };
  const late = await monitor({ sessions, withdrawals: { "LIVE-1": { uidA: request(40) } } });
  assert.strictEqual(late.code, 1, "nothing makes the job go red");
  assert.match(late.text, /Art\. 12\(3\)/);

  const fresh = await monitor({ sessions, withdrawals: { "LIVE-1": { uidA: request(3) } } });
  assert.strictEqual(fresh.code, 0, "an open request inside the limit must not fail the job");
  const none = await monitor({ sessions });
  assert.strictEqual(none.code, 0);
  const done = await monitor({
    sessions, withdrawals: { "LIVE-1": { uidA: request(40) } },
    erasures: { e1: { at: ANSWERED_AT, records: [{ locationKey: "LIVE-1", uid: "uidA" }] } },
  });
  assert.strictEqual(done.code, 0, "a request already erased must not fail the job");
});

test("a request whose session is NO LONGER IN THE DATABASE is still counted — open, then overdue", async () => {
  /* The case the front-page "Account" route makes ordinary: someone comes back
     after their session was purged (30 days after closing, 90 after creation)
     and withdraws from the row in their history. The rules accept the write
     for a session the purge left a marker for (and, when this test was
     written, for any code at all), and the page says the deletion request is
     recorded.

     The monitor read `withdrawals/<code>` only for sessions it found under
     `sessions/` and `orgs/`. So this request was never open, never due and
     never overdue: the job stayed green for ever and nobody was prompted. */
  const sessions = { "LIVE-1": { created: { at: ago(50) } } };

  // Control first: the same request on a live session IS seen.
  const control = await monitor({ sessions, withdrawals: { "LIVE-1": { uidA: request(40) } } });
  assert.strictEqual(control.code, 1);

  const open = await monitor({ sessions, withdrawals: { "GONE-1": { uidB: request(3) } } });
  assert.match(open.text, /Erasure requests open:\s+1\b/,
    "a request for a purged session must be counted as open");
  assert.strictEqual(open.code, 0, "three days old is not late");

  const late = await monitor({ sessions, withdrawals: { "GONE-1": { uidB: request(40) } } });
  assert.strictEqual(late.code, 1,
    "a 40-day-old erasure request must fail the job whether or not its session still exists");

  // Both at once: two obligations, not one.
  const both = await monitor({
    sessions,
    withdrawals: { "LIVE-1": { uidA: request(40) }, "GONE-1": { uidB: request(40) } },
  });
  assert.match(both.text, /FAIL: 2 erasure request\(s\)/);

  // The org tree has the same hole, one level deeper.
  const org = await monitor({
    sessions, withdrawals: { orgs: { "uni-x": { "GONE-2": { uidC: request(40) } } } },
  });
  assert.strictEqual(org.code, 1, "an org-scoped request for a purged session must be counted too");

  // And it closes the same way: an erasure record for that person and session.
  const closed = await monitor({
    sessions, withdrawals: { "GONE-1": { uidB: request(40) } },
    erasures: { e1: { at: ANSWERED_AT, records: [{ locationKey: "GONE-1", uid: "uidB" }] } },
  });
  assert.strictEqual(closed.code, 0);
  assert.match(closed.text, /Erasure requests done:\s+1\b/);
});

test("the monitor never reads a session body — it lists session KEYS and nothing under them", async () => {
  /* It runs every day on a GitHub-hosted runner in the United States, and the
     privacy notice says the daily jobs "do not read your session content"
     (privacy.html, section 6). From the day it was added it called
     readSessionLocations(), which reads `sessions` and `orgs` WHOLE — every
     name, answer and chat-adjacent record — to use three things: a key, a path
     and a count. The purge job had the same habit until it was given a
     keys-only enumerator; the monitor was never moved to it.

     So this watches what the monitor ASKS FOR. The stand-in database records
     every deep read; the keys-only reads go through a separate stand-in. */
  const tree = {
    sessions: { "LIVE-1": { pool: { c1: { name: "A Real Name" } }, created: { at: ago(50) } } },
    orgs: { "uni-x": { sessions: { "LIVE-2": { pool: { c2: { name: "Another Name" } } } } } },
    withdrawals: {
      "LIVE-1": { uidA: request(3) }, "GONE-1": { uidB: request(3) },
      orgs: { "uni-x": { "LIVE-2": { uidC: request(3) } } },
    },
  };
  const r = await monitor(tree);

  assert.deepStrictEqual([...r.reads].sort(), ["erasures", "purgedSessions", "withdrawals"],
    "the only trees read whole are the request queue, the erasure ledger and " +
    "the purge markers (a session code and a date each)");
  assert.ok(!r.reads.some((p) => p === "sessions" || p === "orgs" ||
                                  p.startsWith("sessions/") || p.startsWith("orgs/")),
    "the monitor read session bodies");
  assert.deepStrictEqual([...r.shallowReads].sort(), ["orgs", "orgs/uni-x/sessions", "sessions"],
    "live sessions are listed by key, in both trees");

  // ...and it still knows which sessions exist, from the keys alone.
  assert.match(r.text, /Sessions in database:\s+2\b/);
  assert.match(r.text, /Erasure requests open:\s+3\b/);
  assert.match(r.text, /session not in the database:\s+1\b/i);
});

test("the monitor refuses to run without a way to list live sessions", async () => {
  /* No quiet fallback to the deep read: that is the read being removed, and a
     fallback nobody selected would bring it back unseen. */
  const db = fakeDb({ sessions: {} });
  await assert.rejects(
    () => runMonitor(db, { now: NOW, deadlineDays: 30, warnDays: 21, out() {}, err() {} }),
    /liveLocations/);
  assert.deepStrictEqual(db.reads, [], "it must stop before reading anything");
});

test("a failed listing of live sessions stops the monitor", async () => {
  /* An empty list would label every open request "session not in the
     database" — wrong, and it would look like a finding. */
  await assert.rejects(
    () => monitor({ sessions: {}, withdrawals: { "LIVE-1": { u: request(3) } } },
      { liveLocations: async () => { throw new Error("shallow read of 'sessions' failed: HTTP 401"); } }),
    /HTTP 401/);
});

test("the monitor says which open requests name a session that is not in the database", async () => {
  /* The operator needs to know, because the three kinds are answered three
     ways. A session in the database: run the tool. A session the purge removed:
     the tool answers it too, but only by uid and only with the operator's word
     on the research copy. A session nothing shows ever existed: the tool writes
     nothing, and the way out is the marker backfill or a dismissal. A failure
     message that just says "run the tool" sends the operator to a run that
     refuses, or one that reports nothing to erase. */
  const sessions = { "LIVE-1": { created: { at: ago(50) } } };
  const r = await monitor({
    sessions,
    purgedSessions: { "PURGED-1": ago(35) },
    withdrawals: {
      "LIVE-1": { uidA: request(40) }, "PURGED-1": { uidB: request(40) },
      "NO-TRACE": { uidC: request(40) }, "GONE-2": { uidD: request(5) },
    },
  });
  assert.strictEqual(r.code, 1);
  assert.match(r.text, /session not in the database:\s+3\b/i);
  assert.match(r.text, /erase-participant\.js/);
  assert.match(r.text, /1 of them name a session that has been purged/i);
  assert.match(r.text, /--research-copy-checked/);
  assert.match(r.text, /1 of them name a session that is not in the database and has no purge marker/i,
    "only the OVERDUE untraced request is in the failure message; the 5-day-old one is not late");
  assert.match(r.text, /backfill-purged-markers\.js/);
  assert.match(r.text, /--dismiss/);

  // Each caveat appears only when it applies.
  const allLive = await monitor({ sessions, withdrawals: { "LIVE-1": { uidA: request(40) } } });
  assert.strictEqual(allLive.code, 1);
  assert.doesNotMatch(allLive.text, /research-copy-checked|purge marker|backfill/,
    "the purged-session caveats are noise when every late request has its session");
  /* What it must always say: a request is about ONE session, and the tool run
     with --uid alone erases the person everywhere and deletes their account
     record. And how a request the tool finds nothing for is closed. */
  assert.match(allLive.text, /--uid AND --session/);
  assert.match(allLive.text, /every session/i);
  assert.match(allLive.text, /Nothing to erase[^]*--dismiss/);
  const purgedOnly = await monitor({
    sessions, purgedSessions: { "PURGED-1": ago(35) }, withdrawals: { "PURGED-1": { uidB: request(40) } },
  });
  assert.match(purgedOnly.text, /--research-copy-checked/);
  assert.doesNotMatch(purgedOnly.text, /--dismiss|backfill/);
});

test("the monitor prints no uid and no session code — its logs are public", async () => {
  /* Same reasoning as CLEANUP_QUIET=1. Knowing a request is late is what an
     operator needs from CI; knowing whose it is comes from the database.
     Checked on what it PRINTS, for requests of every kind it reports. */
  const r = await monitor({
    sessions: { "SECRET-LIVE": { created: { at: ago(50) } } },
    orgs: { "uni-x": { sessions: { "SECRET-ORG": {} } } },
    withdrawals: {
      "SECRET-LIVE": { uidSecretA: request(40) },
      "SECRET-GONE": { uidSecretB: request(25) },
      orgs: { "uni-x": { "SECRET-ORG": { uidSecretC: request(2) }, "SECRET-ORG-GONE": { uidSecretD: request(40) } } },
    },
  });
  assert.strictEqual(r.code, 1);
  assert.match(r.text, /Erasure requests open:\s+4\b/, "positive control: all four were reported");
  assert.doesNotMatch(r.text, /SECRET|uidSecret/,
    "the monitor prints a uid or a session code into a world-readable log");
});

test("a withdrawals tree it cannot make sense of raises no false alarm and hides nothing", async () => {
  for (const withdrawals of [null, {}, "x", { orgs: null }, { orgs: "x" }, { orgs: { "uni-x": null } },
                             { "ABC": "x" }, { "ABC": { u: null } }, { orgs: { "uni-x": { "ABC": 7 } } }]) {
    const r = await monitor({ sessions: {}, withdrawals });
    assert.strictEqual(r.code, 0, "malformed input must not fail the job: " + JSON.stringify(withdrawals));
    assert.match(r.text, /Erasure requests open:\s+0\b/);
  }
  // ...and a real request beside the debris is still seen.
  const r = await monitor({ sessions: {}, withdrawals: { orgs: "x", "ABC": "x", "GONE-1": { u: request(40) } } });
  assert.strictEqual(r.code, 1);
});

test("an unreadable withdrawals tree stops the monitor instead of reading as 'no requests'", async () => {
  const db = fakeDb({ sessions: {} });
  const ref = db.ref;
  db.ref = (p) => (p === "withdrawals"
    ? { get: async () => { throw new Error("permission denied"); } }
    : ref(p));
  await assert.rejects(
    () => runMonitor(db, { now: NOW, deadlineDays: 30, warnDays: 21, out() {}, err() {},
                           liveLocations: async () => [] }),
    /permission denied/,
    "a failed read must not degrade to an empty queue and a green run");
});

test("the withdrawals tree is regrouped under the keys the purge and the erasure ledger use", () => {
  /* The request queue is keyed by location, and an erasure closes a request
     only when its record carries the SAME key. So the regrouping must agree
     with session-trees' own `key` and `withdrawalsPath` — checked by building
     a tree at exactly the paths the purge would delete, for both trees. */
  const locations = sessionLocations(
    { "ABC-123": {} }, { "uni-x": { sessions: { "XYZ-789": {} } } });
  assert.strictEqual(locations.length, 2);
  const tree = {};
  for (const loc of locations) {
    const parts = loc.withdrawalsPath.split("/");
    assert.strictEqual(parts.shift(), "withdrawals");
    let node = tree;
    for (const part of parts) node = (node[part] = node[part] || {});
    node.uidA = { research: false, erasure: true, at: ago(1) };
  }
  const grouped = withdrawalLocations(tree);
  assert.deepStrictEqual(Object.keys(grouped).sort(), locations.map((l) => l.key).sort());
  for (const loc of locations) {
    assert.deepStrictEqual(Object.keys(grouped[loc.key]), ["uidA"]);
  }

  /* ...and a location that is NOT a live session regroups the same way, which
     is the whole point: the keys do not come from the sessions. */
  const orphan = withdrawalLocations({ "GONE-1": { u: {} }, orgs: { "uni-x": { "GONE-2": { u: {} } } } });
  assert.deepStrictEqual(Object.keys(orphan).sort(), ["GONE-1", "orgs/uni-x/GONE-2"]);
});

test("erasureQueue marks which open requests have no session, without changing the count", () => {
  const withdrawals = {
    "LIVE-1": { a: { erasure: true, at: ago(40) } },
    "GONE-1": { b: { erasure: true, at: ago(10) }, c: { research: false, at: ago(10) } },
  };
  const q = erasureQueue({
    withdrawals, erasureRecords: [], liveLocationKeys: ["LIVE-1"], now: NOW, deadlineDays: 30,
  });
  assert.deepStrictEqual(q.pending.map((p) => [p.locationKey, p.uid, p.sessionInDatabase, p.overdue]),
    [["LIVE-1", "a", true, true], ["GONE-1", "b", false, false]]);
  assert.deepStrictEqual(q.sessionGone.map((p) => p.uid), ["b"]);
  assert.deepStrictEqual(q.overdue.map((p) => p.uid), ["a"]);
  // A bare withdrawal (no erasure ask) is not a request, with or without a session.
  assert.ok(!q.pending.some((p) => p.uid === "c"));
  // The same answer as the function it wraps, for the same map.
  const direct = pendingErasures(withdrawalLocations(withdrawals), [], NOW, 30);
  assert.strictEqual(q.pending.length, direct.pending.length);
  assert.strictEqual(q.handled, direct.handled);
});

test("the queue tells a PURGED session from one nothing shows ever existed", () => {
  /* "Not in the database" used to cover both, and the monitor could not tell
     a participant's request from a record written for a made-up code. The
     purge now leaves a marker (purgedSessions/<code>), and the rules accept a
     withdrawal only for a session that exists or has one — so a record with
     neither was written before that rule, or its session was purged before
     the purge wrote markers. Those are the ones a human has to look at. */
  const q = erasureQueue({
    withdrawals: {
      "LIVE-1": { a: { erasure: true, at: ago(3) } },
      "PURGED-1": { b: { erasure: true, at: ago(3) } },
      "NO-TRACE": { c: { erasure: true, at: ago(3) } },
      orgs: { "uni-x": { "PURGED-2": { d: { erasure: true, at: ago(3) } } } },
    },
    erasureRecords: [],
    liveLocationKeys: ["LIVE-1"],
    purgedLocationKeys: ["PURGED-1", "orgs/uni-x/PURGED-2"],
    now: NOW, deadlineDays: 30,
  });
  const state = Object.fromEntries(q.pending.map((p) => [p.uid, [p.sessionInDatabase, p.sessionPurged]]));
  assert.deepStrictEqual(state, {
    a: [true, false], b: [false, true], c: [false, false], d: [false, true],
  });
  assert.deepStrictEqual(q.sessionGone.map((p) => p.uid).sort(), ["b", "c", "d"]);
  assert.deepStrictEqual(q.noMarker.map((p) => p.uid), ["c"]);

  /* A session that is back in the database (a restore, or a reused code) is
     LIVE, whatever marker an earlier purge left: the live path can act on it. */
  const back = erasureQueue({
    withdrawals: { "BACK-1": { a: { erasure: true, at: ago(3) } } }, erasureRecords: [],
    liveLocationKeys: ["BACK-1"], purgedLocationKeys: ["BACK-1"], now: NOW,
  });
  assert.deepStrictEqual([back.pending[0].sessionInDatabase, back.pending[0].sessionPurged], [true, false]);

  // Callers that pass no marker list get the old answer, not a crash.
  const old = erasureQueue({
    withdrawals: { "GONE-1": { a: { erasure: true, at: ago(3) } } }, erasureRecords: [],
    liveLocationKeys: [], now: NOW,
  });
  assert.strictEqual(old.pending[0].sessionPurged, false);
  assert.strictEqual(old.noMarker.length, 1);
});

test("the monitor reads the purge markers and says how many open requests have none", async () => {
  const sessions = { "LIVE-1": { created: { at: ago(50) } } };
  const r = await monitor({
    sessions,
    purgedSessions: { "PURGED-1": ago(20), orgs: { "uni-x": { "PURGED-2": ago(20) } } },
    withdrawals: {
      "LIVE-1": { a: request(3) }, "PURGED-1": { b: request(3) }, "NO-TRACE": { c: request(3) },
      orgs: { "uni-x": { "PURGED-2": { d: request(3) } } },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.reads.includes("purgedSessions"), "the monitor never read the markers");
  assert.match(r.text, /Erasure requests open:\s+4\b/);
  assert.match(r.text, /session not in the database:\s+3\b/i);
  assert.match(r.text, /no purge marker:\s+1\b/i);

  // No such line when every gone session has its marker: it would be noise.
  const clean = await monitor({
    sessions, purgedSessions: { "PURGED-1": ago(20) },
    withdrawals: { "PURGED-1": { b: request(3) } },
  });
  assert.match(clean.text, /session not in the database:\s+1\b/i);
  assert.doesNotMatch(clean.text, /no purge marker/i);

  // An unreadable marker tree stops the job: read as "no markers", every
  // purged session's request would be reported as a record with no trace.
  const db = fakeDb({ sessions: {} });
  const ref = db.ref;
  db.ref = (p) => (p === "purgedSessions"
    ? { get: async () => { throw new Error("permission denied"); } }
    : ref(p));
  await assert.rejects(
    () => runMonitor(db, { now: NOW, deadlineDays: 30, warnDays: 21, out() {}, err() {},
                           liveLocations: async () => [] }),
    /permission denied/);
});

test("no script is stored with a raw control byte in it", () => {
  /* scripts/lib/data-rights.js joined its Set keys with a NUL written as a
     string literal, and the literal was saved as the byte itself. Git treats a
     file containing a NUL as binary, so from the day that file was added until
     2026-10-07 no change to it could be read in a pull request — including the
     code that decides whether an erasure request is late. Nothing failed: the
     byte is valid JavaScript. */
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + "/" + entry.name;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.(js|cjs|mjs|json|sh)$/.test(entry.name)) continue;
      const bytes = fs.readFileSync(path.join(ROOT, rel));
      const at = bytes.findIndex((c) => c < 9 || (c > 13 && c < 32) || c === 127);
      if (at !== -1) offenders.push(rel + " (byte 0x" + bytes[at].toString(16) + " at offset " + at + ")");
    }
  };
  walk("scripts");
  assert.deepStrictEqual(offenders, [],
    "build the character (String.fromCharCode) instead of typing it");
});

test("the monitor counts ledger records whose reason is not from the fixed list, and prints none of them", async () => {
  /* Until 2026-10-07 the erasure tool stored whatever the operator typed after
     --reason. The ledger is never deleted or rewritten, so any such text is
     still there and is still read by this job every day. Nobody can say from
     the repository how many there are; the job that reads them can, as a
     number. */
  const sessions = { "LIVE-1": { created: { at: ago(50) } } };
  const r = await monitor({
    sessions,
    erasures: {
      e1: { at: ANSWERED_AT, records: [
        { locationKey: "A", uid: "u1", reason: "erasure request" },
        { locationKey: "B", uid: "u2", reason: "Art. 17 request" },
        { locationKey: "C", uid: "u3", reason: "SecretName asked by phone" },
      ] },
      e2: { at: ANSWERED_AT, records: [
        { locationKey: "D", uid: "u4", reason: "see mail from secret@example.test" },
        { locationKey: "E", uid: "u5" },                       // no reason at all: nothing typed
      ] },
    },
  });
  assert.strictEqual(r.code, 0, "old free text is not a missed deadline");
  assert.match(r.text, /reason outside the fixed list:\s+2\b/i);
  assert.doesNotMatch(r.text, /SecretName|secret@example/, "the monitor printed the text it was counting");

  const clean = await monitor({
    sessions, erasures: { e1: { at: ANSWERED_AT, records: [{ locationKey: "A", uid: "u1", reason: "Art. 17 request" }] } },
  });
  assert.doesNotMatch(clean.text, /fixed list/i, "nothing to report, so nothing printed");
});

test("when the monitor cannot read, its last line names an error code and no path", () => {
  /* It printed e.message. A failed listing quotes the path it was listing —
     "shallow read of 'orgs/<slug>/sessions' failed" — and an Admin read error
     can quote any path at all; this log is public. The real script is run
     here, with each of its reads failing in turn. */
  const { runOpsScript } = require("./fixtures/run-ops-script");
  const tree = {
    sessions: { "SECRETCODE-1": { created: { at: ago(3) } } },
    orgs: { "secret-slug": { sessions: { "SECRETCODE-2": {} } } },
    withdrawals: { "SECRETCODE-1": { uidSecret: request(3) } },
  };
  const ok = runOpsScript("data-rights-monitor.js", { tree, now: NOW });
  assert.strictEqual(ok.code, 0, "positive control: it runs clean when it can read:\n" + ok.out);
  for (const throwOn of ["sessions", "orgs/secret-slug/sessions", "withdrawals", "erasures", "purgedSessions"]) {
    const r = runOpsScript("data-rights-monitor.js", { tree, now: NOW, throwOn });
    assert.strictEqual(r.code, 2, throwOn + ": a failed read must fail the job, apart from 'late'");
    assert.match(r.out, /FATAL/);
    assert.match(r.out, /HTTP_401|PERMISSION_DENIED/, throwOn + ": the code is what an operator can act on");
    assert.doesNotMatch(r.out, /secret-slug|SECRETCODE|uidSecret|fake read failure/,
      throwOn + ": the failure printed a path or a message that quotes one");
  }
});

test("the monitor is scheduled, and after the nightly purge and export", () => {
  const wf = read(".github/workflows/data-rights-monitor.yml");
  const cron = wf.match(/^\s*- cron: "(\d+) (\d+)/m);
  assert.ok(cron, "no live cron — the queue would go unread again, which is " +
    "the whole defect this closes");
  const minutes = Number(cron[2]) * 60 + Number(cron[1]);
  assert.ok(minutes > 3 * 60 + 47,
    "the monitor runs before the nightly export finishes, so a request erased " +
    "overnight would still report as open for another day");
  assert.match(wf, /npm ci/, "a floating install broke every ops job for five days");
});
