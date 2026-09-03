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
  pendingErasures, planRectification, RECTIFIABLE, ROSTER_FIELDS, DEADLINE_DAYS,
} = require("../scripts/lib/data-rights");
const { resolveIdentity } = require("../scripts/lib/erasure");

const DAY = 86400000;
const NOW = 1780000000000;
const ago = (d) => NOW - d * DAY;

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
    w, [{ locationKey: "ABC", uid: "uidA" }], NOW);
  assert.strictEqual(handled, 1);
  assert.strictEqual(pending.length, 0);
  assert.strictEqual(overdue.length, 0, "a handled request must not fail the job");
});

test("an erasure in ANOTHER session does not close this request", () => {
  /* Matching on uid alone would mark every future request handled the moment a
     person was erased once — the failure mode that turns a monitor into a
     rubber stamp. */
  const { pending } = pendingErasures(
    { ABC: { uidA: { erasure: true, at: ago(40) } } },
    [{ locationKey: "OTHER", uid: "uidA" }], NOW);
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

test("the monitor fails on an overdue request and is otherwise silent", () => {
  const src = read("scripts/data-rights-monitor.js");
  assert.match(src, /process\.exit\(1\)/, "nothing makes the job go red");
  assert.match(src, /process\.exit\(0\)/, "the clean path never exits");
  assert.match(src, /Art\. 12\(3\)/);
});

test("the monitor prints no uid and no session code — its logs are public", () => {
  /* Same reasoning as CLEANUP_QUIET=1. Knowing a request is late is what an
     operator needs from CI; knowing whose it is comes from the database. */
  const src = read("scripts/data-rights-monitor.js");
  const logs = [...src.matchAll(/console\.(log|error)\(([\s\S]*?)\);/g)]
    .map((m) => m[2]).join("\n");
  assert.ok(!/\$\{?p\.uid|\bp\.uid\b|locationKey\b/.test(logs),
    "the monitor prints a uid or a session code into a world-readable log");
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
