"use strict";
/* tests/session-retention.test.js
 *
 * A session dated in the future must not outlive its retention window.
 *
 * THE DEFECT (found 2026-10-07 by running the purge, not by reading it).
 * cleanup-stale-sessions.js decides per session from `closed/at` (purge 30 days
 * after) or `created/at` (purge 90 days after). Both are written by the client,
 * and the rules asked of each only that it be a number. A date years ahead was
 * therefore "within retention" until that date: the real script, run against an
 * in-memory database, kept a session created with `created.at = now + 10 years`
 * and kept it again five years later. `created` is written by whoever creates
 * the session, so the 30/90-day limits the privacy notice publishes could be set
 * aside for a session by its own creator.
 *
 * TWO FIXES, AND THE SECOND IS THE ONE THAT CLOSES IT.
 *   rules   both dates are now bounded to the server clock. That stops a NEW
 *           session being dated ahead. It does nothing for one already in the
 *           database, and this suite cannot show it works at all — only the
 *           emulator runs a rule (tests-e2e/emulator/session-date-bounds.spec.js).
 *   purge   a date later than now cannot be true, so a session carrying one is
 *           due. scripts/lib/session-retention.js.
 *
 * Four sections, cheapest first:
 *   1. the verdict, as a pure function with an injected clock;
 *   2. THE REAL SCRIPT in a child process — the only section that executes
 *      main(), and a correct function proves nothing about whether main() calls
 *      it (cleanup-passes.test.js has the long version of that argument);
 *   3. the rules, structurally, and their lockstep with the purge;
 *   4. the DPA's account of the defect.
 *
 * Every "purged" below sits beside a "kept" on the same inputs. A test that only
 * showed the future-dated session being purged would pass just as well against a
 * job that purged everything.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  sessionRetentionVerdict, FUTURE_DATE_TOLERANCE_MS, MS_PER_DAY
} = require("../scripts/lib/session-retention");

const ROOT = path.join(__dirname, "..");
/* LF whatever the checkout: this repository is cloned with autocrlf on Windows,
   and `.` in a regex never matches a carriage return. */
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").split("\r\n").join("\n");

const DAY = MS_PER_DAY;
const HOUR = 60 * 60 * 1000;
const YEAR = 365 * DAY;
const NOW = Date.UTC(2026, 9, 7, 3, 17, 0);   // the nightly run. No Date.now() in this file.

const verdict = (createdAt, closedAt, now = NOW) =>
  sessionRetentionVerdict({ createdAt, closedAt, now, closedDays: 30, openDays: 90 });

/* ── 1. the verdict ────────────────────────────────────────────────────── */

test("a session CREATED ten years ahead is due — tonight, and again five years on", () => {
  const at = NOW + 10 * YEAR;

  const tonight = verdict(at, null);
  assert.strictEqual(tonight.purge, true,
    "this is the defect: `at < cutoff` is false for a future date, so it read as within retention");
  assert.strictEqual(tonight.futureDated, true);
  assert.match(tonight.reason, /^created date is 3650 days in the FUTURE/);

  const later = verdict(at, null, NOW + 5 * YEAR);
  assert.strictEqual(later.purge, true, "five years later the date is still ahead — still due");
  assert.match(later.reason, /^created date is 1825 days in the FUTURE/);
});

test("a session CLOSED ten years ahead is due, however old or new its creation date", () => {
  for (const createdAt of [NOW - 200 * DAY, NOW - DAY, NOW + 10 * YEAR, null]) {
    const v = verdict(createdAt, NOW + 10 * YEAR);
    assert.strictEqual(v.purge, true, "createdAt=" + createdAt);
    assert.strictEqual(v.futureDated, true);
    assert.match(v.reason, /^closed date is 3650 days in the FUTURE/,
      "`closed/at` decides when it is present — and here it is the date that is impossible");
  }
});

test("the control: honest dates on both sides of each window are decided exactly as before", () => {
  /* Same function, same clock. Without these, the two tests above would pass
     against a verdict that purged everything. */
  const cases = [
    [NOW - DAY, null, false, "open, created 1d ago (within retention)"],
    [NOW - 89 * DAY, null, false, "open, created 89d ago (within retention)"],
    [NOW - 91 * DAY, null, true, "abandoned, created 91d ago (> 90d)"],
    [NOW - 100 * DAY, NOW - 29 * DAY, false, "closed 29d ago (within retention)"],
    [NOW - 100 * DAY, NOW - 31 * DAY, true, "closed 31d ago (> 30d)"],
    /* Closing restarts the clock: 200 days old, closed yesterday, kept. */
    [NOW - 200 * DAY, NOW - DAY, false, "closed 1d ago (within retention)"],
    /* And `closed/at` decides even when `created/at` is the impossible one: an
       honest close is a date that can be trusted, so the session is kept its
       30 days and not flagged. */
    [NOW + 10 * YEAR, NOW - DAY, false, "closed 1d ago (within retention)"],
    [NOW + 10 * YEAR, NOW - 31 * DAY, true, "closed 31d ago (> 30d)"],
    [null, null, true, "no timestamps — likely pre-schema or corrupted"],
    [undefined, undefined, true, "no timestamps — likely pre-schema or corrupted"]
  ];
  for (const [createdAt, closedAt, purge, reason] of cases) {
    assert.deepStrictEqual(verdict(createdAt, closedAt), { purge, reason, futureDated: false },
      `created=${createdAt} closed=${closedAt}`);
  }
});

test("the windows are the ones passed in, on both dates", () => {
  const short = (createdAt, closedAt) =>
    sessionRetentionVerdict({ createdAt, closedAt, now: NOW, closedDays: 7, openDays: 10 });
  assert.deepStrictEqual(short(NOW - 50 * DAY, NOW - 8 * DAY),
    { purge: true, futureDated: false, reason: "closed 8d ago (> 7d)" });
  assert.strictEqual(short(NOW - 50 * DAY, NOW - 6 * DAY).purge, false);
  assert.deepStrictEqual(short(NOW - 11 * DAY, null),
    { purge: true, futureDated: false, reason: "abandoned, created 11d ago (> 10d)" });
  assert.strictEqual(short(NOW - 9 * DAY, null).purge, false);
  /* Under the defaults the same four are all kept — so it is the argument, not
     the dates, that made the difference. */
  for (const [c, x] of [[NOW - 50 * DAY, NOW - 8 * DAY], [NOW - 11 * DAY, null]]) {
    assert.strictEqual(verdict(c, x).purge, false);
  }
});

test("a device clock that is merely FAST does not get a live session deleted", () => {
  /* The dates are Date.now() on the creator's device. A session made at 03:10
     by a laptop ten minutes fast is "in the future" at a 03:17 run; one made
     by a laptop set to the right wall time in the wrong zone is hours ahead.
     Treating either as due would delete a session that is minutes old. */
  for (const ahead of [5000, 10 * 60 * 1000, 3 * HOUR, 14 * HOUR, FUTURE_DATE_TOLERANCE_MS]) {
    const open = verdict(NOW + ahead, null);
    assert.deepStrictEqual(
      [open.purge, open.futureDated, open.reason],
      [false, false, "open, created 0d ago (within retention)"],
      `created ${ahead} ms ahead must be kept, and must not read "-0d ago" or "-1d ago"`);
    const closed = verdict(NOW - 10 * DAY, NOW + ahead);
    assert.deepStrictEqual([closed.purge, closed.futureDated], [false, false],
      `closed ${ahead} ms ahead must be kept`);
  }
});

test("the tolerance is a boundary, not a vagueness: one millisecond past it is due", () => {
  assert.strictEqual(verdict(NOW + FUTURE_DATE_TOLERANCE_MS, null).purge, false);
  assert.strictEqual(verdict(NOW + FUTURE_DATE_TOLERANCE_MS + 1, null).purge, true);
  assert.strictEqual(verdict(NOW - DAY, NOW + FUTURE_DATE_TOLERANCE_MS).purge, false);
  assert.strictEqual(verdict(NOW - DAY, NOW + FUTURE_DATE_TOLERANCE_MS + 1).purge, true);
  /* And what the tolerance costs, stated as a number: the most a date inside it
     can buy is the tolerance itself, on a 30- or 90-day window. */
  assert.ok(FUTURE_DATE_TOLERANCE_MS <= DAY,
    "a tolerance over a day is no longer small beside a 30-day limit enforced nightly");
});

test("a date in the PAST, however absurd, only brings the purge forward", () => {
  for (const at of [0, -1, 1, -8.64e15, NOW - 1000 * YEAR]) {
    assert.strictEqual(verdict(at, null).purge, true, "created=" + at);
    assert.strictEqual(verdict(NOW - DAY, at).purge, true, "closed=" + at);
    assert.strictEqual(verdict(at, null).futureDated, false);
  }
});

test("no number a client can store makes the verdict throw — a throw KEEPS the session", () => {
  /* The script counts a throw as an error and moves on, so the session
     survives the night. A date large enough to break the arithmetic or the
     wording would hand the hole straight back. Number.MAX_VALUE is valid JSON. */
  for (const at of [Number.MAX_VALUE, 1e300, Number.MAX_SAFE_INTEGER, 8.64e15 + 1, NOW + 101 * YEAR]) {
    const created = verdict(at, null);
    assert.deepStrictEqual([created.purge, created.futureDated], [true, true], "created=" + at);
    assert.match(created.reason, /^created date is more than 100 years in the FUTURE/);
    const closed = verdict(NOW - DAY, at);
    assert.deepStrictEqual([closed.purge, closed.futureDated], [true, true], "closed=" + at);
    assert.match(closed.reason, /^closed date is more than 100 years in the FUTURE/);
  }
  assert.match(verdict(NOW + DAY + HOUR, null).reason, /^created date is 1 day in the FUTURE/);
});

test("a value that is not a usable number is treated as absent, never as 'within retention'", () => {
  /* NaN is the one that matters: `typeof NaN` is "number" and every comparison
     against it is false, which is "kept for ever". */
  for (const junk of [NaN, Infinity, -Infinity, "1790000000000", true, {}, [], null, undefined]) {
    assert.deepStrictEqual(verdict(junk, junk),
      { purge: true, futureDated: false, reason: "no timestamps — likely pre-schema or corrupted" },
      "both dates = " + String(junk));
    /* An unusable `closed/at` falls through to `created/at`, as it always did. */
    assert.strictEqual(verdict(NOW - DAY, junk).reason, "open, created 1d ago (within retention)");
    assert.strictEqual(verdict(NOW + 10 * YEAR, junk).futureDated, true);
  }
});

test("an unusable clock or window is REFUSED — it must not quietly keep every session", () => {
  /* NaN compares false with everything, so a defaulted or missing `now` would
     report a clean run in which nothing was ever due. */
  const base = { createdAt: NOW - 200 * DAY, closedAt: null, now: NOW, closedDays: 30, openDays: 90 };
  for (const bad of [{ now: undefined }, { now: NaN }, { now: 0 }, { now: "x" }, { now: Infinity },
    { closedDays: NaN }, { closedDays: 0 }, { closedDays: -1 }, { openDays: undefined }, { openDays: "90" }]) {
    assert.throws(() => sessionRetentionVerdict(Object.assign({}, base, bad)), TypeError,
      JSON.stringify(bad) + " must throw");
  }
  assert.throws(() => sessionRetentionVerdict(), TypeError, "no options at all");
  assert.strictEqual(sessionRetentionVerdict(base).purge, true, "the control: the same call, usable");
});

/* ── 2. THE REAL SCRIPT, in a child process ────────────────────────────
 * `node -r tests/fixtures/fake-firebase-admin-preload.js scripts/cleanup-stale-sessions.js`
 * with the clock pinned, against one database run twice: on the night, and five
 * years later. Assertions are on the writes the script attempted.
 *
 * Run against the script as it was before this fix, FUTCREAT, FUTCLOSE and
 * ORGFUT01 are absent from both lists: kept tonight, kept in 2031. */

const SCRIPT_PATH = path.join(ROOT, "scripts", "cleanup-stale-sessions.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-firebase-admin-preload.js");
const HANG_TIMEOUT_MS = 20000;

const TREE = {
  sessions: {
    FUTCREAT: { created: { by: "x", at: NOW + 10 * YEAR } },
    /* 200 days old and never due, because its close date is ten years off. */
    FUTCLOSE: { created: { by: "x", at: NOW - 200 * DAY }, closed: { by: "x", at: NOW + 10 * YEAR } },
    /* Honest, fast clock: three hours ahead. Must survive the night. */
    SKEWFAST: { created: { by: "x", at: NOW + 3 * HOUR } },
    LIVE0001: { created: { by: "x", at: NOW - DAY } },
    EXPIRED1: { created: { by: "x", at: NOW - 100 * DAY }, closed: { by: "x", at: NOW - 40 * DAY } },
    /* Ahead of tonight's run, ordinary on the later one: the verdict has to
       follow the clock, not the session. */
    LATER001: { created: { by: "x", at: NOW + 5 * YEAR - DAY } }
  },
  orgs: { acme: { sessions: { ORGFUT01: { created: { by: "x", at: NOW + 10 * YEAR } } } } }
};
const CODES = /FUTCREAT|FUTCLOSE|SKEWFAST|LIVE0001|EXPIRED1|LATER001|ORGFUT01/;

function childEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) if (/^(CLEANUP_|FAKE_DB_)/.test(k)) delete env[k];
  return Object.assign(env, extra);
}

function runScript(now, flags, sessionsTree = TREE) {
  /* A backup taken twelve hours before WHICHEVER night this is, so the armed
     gate is open and the session pass really runs. */
  const tree = Object.assign({}, sessionsTree, {
    ops: { lastBackup: { at: now - DAY / 2, sessions: 7, uri: "s3://fake" } }
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-retention-"));
  const outFile = path.join(dir, "writes.json");
  try {
    const r = spawnSync(process.execPath, ["-r", PRELOAD, SCRIPT_PATH], {
      encoding: "utf8",
      timeout: HANG_TIMEOUT_MS,
      env: childEnv(Object.assign({
        FAKE_DB_TREE: JSON.stringify(tree),
        FAKE_DB_WRITES_OUT: outFile,
        FAKE_DB_NOW: String(now),
        FIREBASE_DATABASE_URL: "https://fake-db.invalid",
        CLEANUP_REQUIRE_BACKUP: "1",
        CLEANUP_BACKUP_MAX_AGE_DAYS: "2"
      }, flags))
    });
    const log = "\n--- stdout ---\n" + r.stdout + "\n--- stderr ---\n" + r.stderr;
    assert.ok(!r.error && r.status !== null, "the script did not end by itself." + log);
    const writes = JSON.parse(fs.readFileSync(outFile, "utf8")).writes;
    /* Each purge is one root-level update whose keys are the session and its
       out-of-cascade siblings; the session itself is the key shaped like one. */
    const purged = writes.filter((w) => w.op === "update" && w.path === "")
      .map((w) => w.keys.filter((k) => /^(sessions\/[^/]+|orgs\/[^/]+\/sessions\/[^/]+)$/.test(k)))
      .flat();
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, log, writes, purged };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LIVE = { CLEANUP_CONFIRM: "1" };
const LIVE_QUIET = { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1" };   // what the cron sets

test("REAL SCRIPT, tonight: the future-dated sessions are purged in BOTH trees, the live ones kept", () => {
  const r = runScript(NOW, LIVE);
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.purged, [
    "sessions/FUTCREAT", "sessions/FUTCLOSE", "sessions/EXPIRED1", "sessions/LATER001",
    "orgs/acme/sessions/ORGFUT01"
  ], "the four future-dated sessions and the genuinely expired one — and NOT SKEWFAST " +
     "(three hours ahead: a fast clock) or LIVE0001 (a day old)." + r.log);
  assert.match(r.stdout, /Summary: 2 kept, 5 purged, 0 errors\./);
  assert.match(r.stdout, /PURGE {4}FUTCREAT {2}created date is 3650 days in the FUTURE/);
  assert.match(r.stdout, /PURGE {4}FUTCLOSE {2}closed date is 3650 days in the FUTURE/);
  assert.match(r.stdout, /KEEP {5}SKEWFAST {2}open, created 0d ago \(within retention\)/);
});

test("REAL SCRIPT, the same database five years later: still purged — it used to be kept again", () => {
  const r = runScript(NOW + 5 * YEAR, LIVE);
  assert.strictEqual(r.status, 0, r.log);
  for (const p of ["sessions/FUTCREAT", "sessions/FUTCLOSE", "orgs/acme/sessions/ORGFUT01"]) {
    assert.ok(r.purged.includes(p), p + " is still five years ahead of this run and must be due." + r.log);
  }
  assert.match(r.stdout, /PURGE {4}FUTCREAT {2}created date is 1825 days in the FUTURE/);
  /* The control for THIS run: a session created the day before it is kept, so
     "everything was purged" is not what passed the loop above. Tonight's run
     purged the same session for being five years ahead. */
  assert.ok(!r.purged.includes("sessions/LATER001"), "created yesterday on this clock: kept." + r.log);
  assert.match(r.stdout, /KEEP {5}LATER001 {2}open, created 1d ago \(within retention\)/);
  assert.match(r.stdout, /Dated in the future: 3 session\(s\) /);
});

test("REAL SCRIPT, CLEANUP_QUIET=1: a count is printed, and no session code reaches the log", () => {
  /* The scheduled job's logs are world-readable. The per-session reason is the
     only place the cause is written, and QUIET drops those lines whole — so the
     count line is the one trace left, and it must name nothing. */
  const r = runScript(NOW, LIVE_QUIET);
  assert.strictEqual(r.status, 0, r.log);
  assert.strictEqual(r.purged.length, 5, "QUIET changes what is printed, never what is purged." + r.log);
  assert.match(r.stdout,
    /Dated in the future: 4 session\(s\) carried a created or closed date more than 24h ahead of this run\. No session can have one, so each was treated as due and purged /);
  assert.ok(!CODES.test(r.stdout + r.stderr), "a session code reached the log." + r.log);
  assert.ok(!/acme/.test(r.stdout + r.stderr), "an organisation slug reached the log." + r.log);
});

test("REAL SCRIPT, dry run: the count says what WOULD happen, and nothing is written", () => {
  /* The first evidence an operator gets before the first live run: how many
     sessions already in the database carry an impossible date. */
  const r = runScript(NOW, { CLEANUP_QUIET: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, [], "a dry run writes nothing at all." + r.log);
  assert.match(r.stdout, /Dated in the future: 4 session\(s\) .* treated as due and would be purged /);
  assert.match(r.stdout, /Summary: 2 kept, 5 would-purge, 0 errors\./);
});

test("REAL SCRIPT: with no future-dated session the count line is absent — it is not boilerplate", () => {
  const r = runScript(NOW, LIVE_QUIET, {
    sessions: { LIVE0001: TREE.sessions.LIVE0001, EXPIRED1: TREE.sessions.EXPIRED1 }
  });
  assert.strictEqual(r.status, 0, r.log);
  assert.match(r.stdout, /Summary: 1 kept, 1 purged, 0 errors\./);
  assert.ok(!/Dated in the future/.test(r.stdout), r.log);
});

test("REAL SCRIPT: the windows are the ones the workflow passes — 7 and 10 days are not quietly 30 and 90", () => {
  /* The cutoff arithmetic moved out of the script when the verdict did, so the
     script now has to HAND the windows over. Every other run in this file uses
     the defaults, and a verdict that ignored its arguments and used 30 and 90
     would pass all of them. An operator dispatching the workflow with a
     shorter window would then get the published one, silently. */
  const tree = {
    sessions: {
      CLOSED08: { created: { by: "x", at: NOW - 50 * DAY }, closed: { by: "x", at: NOW - 8 * DAY } },
      CLOSED06: { created: { by: "x", at: NOW - 50 * DAY }, closed: { by: "x", at: NOW - 6 * DAY } },
      OPEN0011: { created: { by: "x", at: NOW - 11 * DAY } },
      OPEN0009: { created: { by: "x", at: NOW - 9 * DAY } }
    }
  };
  const short = runScript(NOW, Object.assign({
    CLEANUP_RETENTION_CLOSED_DAYS: "7", CLEANUP_RETENTION_OPEN_DAYS: "10"
  }, LIVE), tree);
  assert.strictEqual(short.status, 0, short.log);
  assert.deepStrictEqual(short.purged, ["sessions/CLOSED08", "sessions/OPEN0011"], short.log);
  assert.match(short.stdout, /PURGE {4}CLOSED08 {2}closed 8d ago \(> 7d\)/);
  assert.match(short.stdout, /PURGE {4}OPEN0011 {2}abandoned, created 11d ago \(> 10d\)/);

  /* The control: the same database under the published windows keeps all four. */
  const published = runScript(NOW, LIVE, tree);
  assert.strictEqual(published.status, 0, published.log);
  assert.deepStrictEqual(published.purged, [], published.log);
  assert.match(published.stdout, /Summary: 4 kept, 0 purged, 0 errors\./);
});

test("the fixture's fixed clock is real: an unusable FAKE_DB_NOW is refused, not ignored", () => {
  /* Anti-vacuity for every run above. If the preload silently fell back to the
     real clock, the "five years later" run would be tonight's run again. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-retention-"));
  try {
    const run = (value) => spawnSync(process.execPath,
      ["-r", PRELOAD, "-e", "process.stdout.write(String(Date.now())); process.exit(0)"], {
        encoding: "utf8", timeout: HANG_TIMEOUT_MS,
        env: childEnv({ FAKE_DB_WRITES_OUT: path.join(dir, "w.json"), FAKE_DB_NOW: value })
      });
    assert.strictEqual(run(String(NOW + 5 * YEAR)).stdout, String(NOW + 5 * YEAR));
    for (const bad of ["soon", "-5", "1.5", "0"]) {
      const r = run(bad);
      assert.notStrictEqual(r.status, 0, "FAKE_DB_NOW=" + bad + " must fail the run");
      assert.match(r.stderr, /FAKE_DB_NOW must be epoch milliseconds/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("wiring: the script decides through sessionRetentionVerdict and compares no date itself", () => {
  /* A fast backstop with a precise message. NOT the guarantee — the child
     process above is. Comments are stripped because they describe the old code. */
  const src = read("scripts", "cleanup-stale-sessions.js");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /require\("\.\/lib\/session-retention"\)/);
  assert.match(code, /sessionRetentionVerdict\(\{\s*createdAt, closedAt, now, closedDays: CLOSED_DAYS, openDays: OPEN_DAYS\s*\}\)/);
  assert.ok(!/(closedAt|createdAt)\s*[<>]/.test(code),
    "cleanup-stale-sessions.js compares a session date itself again. That comparison " +
    "is how a future date came to read as 'within retention'; it belongs in " +
    "lib/session-retention.js, where it is tested.");
});

/* ── 3. the rules, and their lockstep with the purge ───────────────────
 * Structural only: nothing in this suite evaluates a rule. That the bound
 * actually DENIES is shown on the emulator, where every denial is paired with
 * an allow of the same payload (session-date-bounds.spec.js). */

const RULES = JSON.parse(read("docs", "Third_session", "PBL_platform", "database.rules.json")).rules;
const SESSION = RULES.sessions.$sessionId;
const ORG = RULES.orgs.$orgSlug.sessions.$sessionId;
const DATED = [
  ["sessions/$sessionId/created", SESSION.created],
  ["sessions/$sessionId/closed", SESSION.closed],
  ["orgs/$orgSlug/sessions/$sessionId/created", ORG.created],
  ["orgs/$orgSlug/sessions/$sessionId/closed", ORG.closed]
];

/* How far ahead of, and behind, the server clock a rule lets `at` be. */
function atWindow(validate, where) {
  const ahead = /newData\.child\('at'\)\.val\(\) <= now \+ (\d+)/.exec(validate);
  const behind = /newData\.child\('at'\)\.val\(\) >= now - (\d+)/.exec(validate);
  assert.ok(ahead, where + ": `at` has no upper bound against the server clock. Without one a " +
    "client can date the node years ahead — the defect this file is about.");
  assert.ok(behind, where + ": `at` has no lower bound against the server clock.");
  return { aheadMs: Number(ahead[1]), behindMs: Number(behind[1]) };
}

test("rules: `created` and `closed` are bounded to the server clock, in both trees", () => {
  for (const [where, node] of DATED) {
    const v = node[".validate"];
    assert.match(v, /newData\.hasChildren\(\['by','at'\]\)/, where + " lost its required fields");
    assert.match(v, /newData\.child\('at'\)\.isNumber\(\)/, where);
    atWindow(v, where);
  }
});

test("rules: both are still WRITE-ONCE — without that, the bound buys nothing", () => {
  /* A date held near now is only a retention clock if it cannot be written
     again. Re-dating a session every 89 days would keep it for ever
     with every single write passing the bound. */
  for (const [where, node] of DATED) {
    assert.match(node[".write"], /!data\.exists\(\)/,
      where + " must stay write-once, or its date can be refreshed indefinitely");
    for (const child of Object.keys(node)) {
      assert.ok(child === ".read" || child === ".write" || child === ".validate",
        where + " grew a child rule (" + child + "). A `.write` there could let the date " +
        "be rewritten past the write-once guard on the node.");
    }
  }
  /* And from ABOVE: an RTDB write grant cascades and cannot be revoked lower
     down, so a `.write` on any ancestor would let the node be replaced whatever
     its own rule says. Every level down to the session must grant nothing. */
  const ANCESTORS = [
    ["the root", RULES], ["sessions", RULES.sessions], ["sessions/$sessionId", SESSION],
    ["orgs", RULES.orgs], ["orgs/$orgSlug", RULES.orgs.$orgSlug],
    ["orgs/$orgSlug/sessions", RULES.orgs.$orgSlug.sessions],
    ["orgs/$orgSlug/sessions/$sessionId", ORG]
  ];
  for (const [where, node] of ANCESTORS) {
    const w = node[".write"];
    assert.ok(w === undefined || w === false || w === "false",
      where + " has a `.write` rule (" + JSON.stringify(w) + "). It cascades to `created` " +
      "and `closed`, and a session's dates could then be rewritten.");
  }
});

test("rules: the organisation tree carries the same validators, character for character", () => {
  /* Neither validator names its own tree, so the two copies can be identical —
     and a bound added to one tree alone leaves the hole open one namespace over. */
  assert.strictEqual(ORG.created[".validate"], SESSION.created[".validate"]);
  assert.strictEqual(ORG.closed[".validate"], SESSION.closed[".validate"]);
});

test("lockstep: a device that can JOIN a session can create and close one", () => {
  /* The dates are the device's own clock. `members/<uid>/at` is written from
     the same clock seconds after a session is created — a facilitator's device
     has to pass it to read its own session — so it is the yardstick: the new
     bounds must never be the tighter of the two, or this change would stop a
     device from creating a session it could have run. */
  for (const [tree, members] of [["sessions", SESSION.members.$uid], ["orgs", ORG.members.$uid]]) {
    const join = atWindow(members[".validate"], tree + " members/$uid");
    for (const [where, node] of DATED.filter(([w]) => w.startsWith(tree))) {
      const w = atWindow(node[".validate"], where);
      assert.ok(w.aheadMs >= join.aheadMs,
        `${where} allows a clock ${w.aheadMs} ms fast; joining allows ${join.aheadMs} ms`);
      assert.ok(w.behindMs >= join.behindMs,
        `${where} allows a clock ${w.behindMs} ms slow; joining allows ${join.behindMs} ms`);
    }
  }
});

test("rules: the window admits a device set to the wrong time zone, on both sides", () => {
  /* The client sends the DEVICE clock, so the window is a statement about which
     facilitators can create and close a session at all. A laptop carried
     between France and Japan and corrected by hand — the right wall time in
     the wrong zone — is seven or eight hours off, in whichever direction it
     travelled. The window first shipped at five seconds ahead and two hours
     behind, which refused that laptop in three flows that worked before: create
     here and run elsewhere, close from "Sessions you created", and the
     end-of-class close by a facilitator who was already a member. The refusals
     left a dateless partial session, or a real one that stayed open behind a
     message about the connection. Both of those values fail here. */
  const NINE_HOURS = 9 * HOUR;
  for (const [where, node] of DATED) {
    const w = atWindow(node[".validate"], where);
    assert.ok(w.aheadMs >= NINE_HOURS,
      `${where} refuses a clock more than ${w.aheadMs} ms FAST. A device eight hours ahead ` +
      "must still be able to create and close a session.");
    assert.ok(w.behindMs >= NINE_HOURS,
      `${where} refuses a clock more than ${w.behindMs} ms SLOW. A device eight hours behind ` +
      "must still be able to create and close a session.");
    /* And the other side of the same bound: it is still a retention clock. A
       date may not be back-dated by more than a day, which is what stops a
       clock that is DAYS slow from closing a session straight into its purge. */
    assert.ok(w.behindMs <= DAY, `${where} lets a date be ${w.behindMs} ms in the past`);
  }
});

test("lockstep: the purge never calls 'impossible' a date the rules accept — with room to spare", () => {
  /* If the rules let a date be N ms ahead and the purge's tolerance were no
     larger, a session created honestly a moment before the nightly run could
     be deleted by it. Strictly larger, and by a real margin: the rule is
     evaluated on the database server's clock and the purge on a CI runner's,
     and the two are not the same clock. */
  for (const [where, node] of DATED) {
    const { aheadMs } = atWindow(node[".validate"], where);
    assert.ok(FUTURE_DATE_TOLERANCE_MS - aheadMs >= HOUR,
      `${where} accepts a date ${aheadMs} ms ahead, and the purge treats anything over ` +
      `${FUTURE_DATE_TOLERANCE_MS} ms ahead as due. The purge's tolerance must exceed the ` +
      "rules' allowance by at least an hour.");
  }
});

test("lockstep: the purge tolerance is small beside both windows the notice publishes", () => {
  /* Read from the script, like retention-notice-consistency.test.js does, so a
     shortened window cannot leave the tolerance as a large fraction of it. */
  const src = read("scripts", "cleanup-stale-sessions.js");
  for (const name of ["CLEANUP_RETENTION_CLOSED_DAYS", "CLEANUP_RETENTION_OPEN_DAYS"]) {
    const m = new RegExp("retentionDays\\(\"" + name + "\",\\s*(\\d+)\\)").exec(src);
    assert.ok(m, "could not read the " + name + " default out of cleanup-stale-sessions.js");
    assert.ok(FUTURE_DATE_TOLERANCE_MS * 20 <= Number(m[1]) * DAY,
      `the tolerance is more than a twentieth of the ${m[1]}-day window`);
  }
});

/* ── 4. the DPA's account of it ────────────────────────────────────────
 * Annex VI is hand-maintained and has drifted in both directions before. This
 * defect was first written up, as OPEN, on a branch that had not merged when
 * the fix did; when that text reaches main it describes something no longer
 * true. A status claim that survives its own fix is a defect in this pack. */

test("DPA Annex VI records the fix, and nowhere says the defect is still open", () => {
  const dpa = read("docs", "Third_session", "PBL_platform", "legal", "dpa-draft.md");
  const flat = dpa.replace(/\s+/g, " ");
  /* assert.ok, not assert.match: a failed match prints its subject, and the
     subject here is the whole 270 kB agreement. */
  assert.ok(/session dated in the future was never purged/i.test(flat),
    "Annex VI (G12) must record that a future-dated session was never purged, and that it is fixed");
  assert.ok(/tests\/session-retention\.test\.js/.test(flat),
    "the record must point at the test that runs the purge, not just assert the fix");
  assert.ok(!/session dated in the future is never purged/i.test(flat),
    "Annex VI says, in the present tense, that a session dated in the future IS never purged. " +
    "That was fixed on 2026-10-07 (rules + purge — see scripts/lib/session-retention.js). " +
    "Reword the paragraph as history and point it at the fix.");
  assert.ok(!/Not fixed here: it is the session-creation rule/i.test(flat),
    "Annex VI still carries the 'Not fixed here' note for the future-dated session. It is fixed.");
});
