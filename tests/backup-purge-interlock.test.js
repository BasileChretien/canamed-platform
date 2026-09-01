/* backup-purge-interlock.test.js
 *
 * Pins the handshake between backup-sessions and cleanup-stale-sessions.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS. The bug this guards against is not
 * "the gate fails to block". It is the far quieter one that actually
 * happened: the purge job succeeding, and reporting success, while the
 * backup job had been failing for days. So the tests below care as much
 * about what gets SAID on a disarmed run as about what gets blocked on an
 * armed one — a silent disarmed gate is indistinguishable from a working
 * one, and that indistinguishability IS the defect.
 *
 * Every case is driven through the pure helpers with an injected clock, so
 * none of this needs an emulator or a billing account.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  BACKUP_MARKER_PATH,
  assessBackupFreshness,
  backupGateReport
} = require("../scripts/lib/backup-marker");

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0); // 2026-08-31T12:00:00Z
const DAY = 24 * 60 * 60 * 1000;

const fresh = (opts) => Object.assign({ marker: { at: NOW - 1 * DAY }, now: NOW, maxAgeDays: 2 }, opts);

/* ── freshness ─────────────────────────────────────────────────────────── */

test("a recent marker is fresh", () => {
  const r = assessBackupFreshness(fresh());
  assert.equal(r.fresh, true);
  assert.ok(r.reason.includes("1.0d"), `reason should quote the age, got: ${r.reason}`);
});

test("a marker older than the window is stale", () => {
  const r = assessBackupFreshness(fresh({ marker: { at: NOW - 5 * DAY } }));
  assert.equal(r.fresh, false);
  assert.ok(/5\.0d ago/.test(r.reason), r.reason);
});

test("a missing marker is stale, not an exception", () => {
  for (const m of [null, undefined]) {
    const r = assessBackupFreshness(fresh({ marker: m }));
    assert.equal(r.fresh, false, `marker=${m}`);
    assert.ok(/has ever been written/.test(r.reason), r.reason);
  }
});

test("a malformed marker is stale", () => {
  // The shapes a hand-edit or a partial write actually produces.
  for (const m of [{}, { at: null }, { at: "yesterday" }, { at: NaN }, { at: Infinity }]) {
    const r = assessBackupFreshness(fresh({ marker: m }));
    assert.equal(r.fresh, false, `marker=${JSON.stringify(m)}`);
  }
});

test("a FUTURE-dated marker is stale — it must not read as fresher than fresh", () => {
  /* Without the explicit sign check a future `at` yields a negative age,
   * which passes `ageDays > maxAgeDays` and disarms the gate permanently.
   * Clock skew and hand-edited nodes both produce this. */
  const r = assessBackupFreshness(fresh({ marker: { at: NOW + 3 * DAY } }));
  assert.equal(r.fresh, false);
  assert.ok(/FUTURE/.test(r.reason), r.reason);
});

test("an out-of-RANGE but finite timestamp is malformed, not a crash", () => {
  /* Number.isFinite(Number.MAX_VALUE) is true, but new Date(MAX_VALUE) is an
   * Invalid Date and toISOString() on it throws RangeError. Since such a value
   * is also "in the future", it reached the branch that formats the date — so
   * backupGateReport() THREW instead of returning its blocking result, turning
   * a deliberate refusal into an uncaught crash. Caught by CodeRabbit on #349
   * and reproduced before fixing. */
  for (const at of [Number.MAX_VALUE, -Number.MAX_VALUE, 8.64e15 + 1]) {
    const r = assessBackupFreshness(fresh({ marker: { at } }));
    assert.equal(r.fresh, false, `at=${at}`);
    // and the gate must still be able to speak
    const g = backupGateReport(fresh({ armed: true, marker: { at } }));
    assert.equal(g.block, true, `at=${at} must block, not throw`);
    assert.ok(typeof g.line === "string" && g.line.length > 0);
  }
});

test("the boundary is inclusive — exactly maxAgeDays old still counts as fresh", () => {
  assert.equal(assessBackupFreshness(fresh({ marker: { at: NOW - 2 * DAY } })).fresh, true);
  assert.equal(
    assessBackupFreshness(fresh({ marker: { at: NOW - 2 * DAY - 1000 } })).fresh, false,
    "a second past the window must flip it"
  );
});

/* ── the gate ──────────────────────────────────────────────────────────── */

test("ARMED + stale backup blocks the purge", () => {
  const g = backupGateReport(fresh({ armed: true, marker: { at: NOW - 9 * DAY } }));
  assert.equal(g.block, true);
  assert.ok(/BLOCKED/.test(g.line), g.line);
  assert.ok(/CLEANUP_REQUIRE_BACKUP=0/.test(g.line),
    "a blocking message must name the deliberate override, or an operator's only exit is to delete the check");
});

test("ARMED + fresh backup allows the purge", () => {
  const g = backupGateReport(fresh({ armed: true }));
  assert.equal(g.block, false);
  assert.ok(/OK/.test(g.line), g.line);
});

test("DISARMED never blocks — even with no backup at all", () => {
  /* This is the GDPR half. With no Blaze plan there is no GCS and no marker
   * will ever be written; if that state could block deletion, the platform
   * would retain personal data past its published 30/90-day windows forever.
   * Deletion is the legal duty, the archive is disaster recovery. */
  const g = backupGateReport(fresh({ armed: false, marker: null }));
  assert.equal(g.block, false);
});

test("DISARMED with no archive SAYS SO — the whole point", () => {
  /* The 2026-08-27 incident was invisible because the purge job's output
   * looked identical whether or not a backup existed. A disarmed gate that
   * printed nothing would rebuild exactly that blind spot. */
  const g = backupGateReport(fresh({ armed: false, marker: null }));
  assert.ok(/WITHOUT a verified archive/.test(g.line), g.line);
  assert.ok(/DISARMED/.test(g.line), g.line);
});

test("DISARMED with a fresh archive reads differently from DISARMED without one", () => {
  const withArchive = backupGateReport(fresh({ armed: false })).line;
  const without = backupGateReport(fresh({ armed: false, marker: null })).line;
  assert.notEqual(withArchive, without,
    "the two states must be distinguishable in the log, or the gate reports nothing useful");
  assert.ok(!/WITHOUT a verified archive/.test(withArchive), withArchive);
});

test("`armed` is strict — only the boolean true arms the gate", () => {
  /* CLEANUP_REQUIRE_BACKUP arrives as a STRING from the workflow env. If a
   * truthy "0" or "false" could arm this, the gate would switch on by
   * accident and block deletion. The caller compares === "1"; this pins the
   * library half. */
  for (const v of ["1", "true", 1, {}, "0", "false", 0, "", null, undefined]) {
    const g = backupGateReport(fresh({ armed: v, marker: null }));
    assert.equal(g.block, false, `armed=${JSON.stringify(v)} must not block via coercion`);
  }
  assert.equal(backupGateReport(fresh({ armed: true, marker: null })).block, true);
});

/* ── wiring (the half a pure test cannot see) ──────────────────────────── */

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("both jobs address the SAME marker path, via the shared constant", () => {
  /* Two string literals that drifted apart would leave the gate reading a
   * node nothing writes — silently permanent-stale when armed, which is the
   * hfPatient/uidMembers lockstep bug in a new place. */
  assert.equal(BACKUP_MARKER_PATH, "ops/lastBackup");
  for (const f of ["scripts/backup-sessions.js", "scripts/cleanup-stale-sessions.js"]) {
    const src = read(f);
    assert.ok(/require\(".\/lib\/backup-marker"\)/.test(src), `${f} does not import backup-marker`);
    assert.ok(!/["']ops\/lastBackup["']/.test(src),
      `${f} hardcodes the marker path instead of importing the constant`);
  }
});

test("the marker is written only AFTER a successful upload", () => {
  /* Ordering is the entire security property: a marker written before the
   * upload records an attempt, and an attempt must never authorise a purge. */
  const src = read("scripts/backup-sessions.js").split("\r\n").join("\n");
  const upload = src.indexOf("await uploadArchive(");
  // "await writeBackupMarker(", not the bare name: more precise than matching
  // the import, and it additionally fails if a future edit drops the `await`
  // (an un-awaited marker write can lose the race with process.exit(0)).
  const mark = src.indexOf("await writeBackupMarker(");
  assert.ok(upload > 0, "no uploadArchive call found");
  assert.ok(mark > 0, "no writeBackupMarker call found");
  assert.ok(mark > upload, "writeBackupMarker must come after the awaited uploadArchive");
  // and inside the `if (dest)` branch — the no-archive path leaves nothing
  // durable and must not vouch for an archive. (Was `if (GCS_BUCKET)` until
  // 2026-09-01, when the provider choice moved behind chooseDestination() so
  // that backups could resume on Scaleway object storage after GCS became
  // unwritable on the Spark plan.)
  const branch = src.slice(src.indexOf("if (dest)"), src.indexOf("process.exit(0)"));
  assert.ok(branch.includes("writeBackupMarker("),
    "the marker write escaped the GCS_BUCKET branch");
});

test("the purge job fails CLOSED if the marker read throws", () => {
  const src = read("scripts/cleanup-stale-sessions.js").split("\r\n").join("\n");
  const block = src.slice(src.indexOf("let marker = null;"), src.indexOf("if (gate.block)"));
  assert.ok(/catch\s*\(e\)/.test(block), "the marker read is not wrapped in try/catch");
  assert.ok(!/marker\s*=\s*\{/.test(block),
    "a failed read must leave marker null (treated as no backup), never synthesise one");
});

test("a blocked purge exits 3 — distinguishable from 1 (errors) and 2 (fatal)", () => {
  const src = read("scripts/cleanup-stale-sessions.js").split("\r\n").join("\n");
  const gateBlock = src.slice(src.indexOf("if (gate.block)"), src.indexOf("if (gate.block)") + 600);
  assert.ok(/process\.exit\(3\)/.test(gateBlock),
    "refused-on-purpose must not share an exit code with broke");
});

test("the gate runs BEFORE any deletion", () => {
  const src = read("scripts/cleanup-stale-sessions.js").split("\r\n").join("\n");
  assert.ok(src.indexOf("if (gate.block)") < src.indexOf('verdict === "PURGE" && CONFIRM'),
    "the interlock must be evaluated before the purge loop, or it guards nothing");
});
