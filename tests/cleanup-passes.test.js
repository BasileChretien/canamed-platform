"use strict";
/* tests/cleanup-passes.test.js
 *
 * A blocked backup gate must stop the SESSION purge — and nothing else.
 *
 * cleanup-stale-sessions.js said so in its own comment: "the gate stops SESSION
 * purges only. Metrics pruning has its own clock and is not covered by the
 * session backup, so blocking it here would create a second retention gap
 * while trying to prevent a data-loss one." The code did the opposite. A
 * blocked gate called process.exit(3) before the session loop AND before the
 * metrics pass, so with the gate armed (it has been since 2026-09-02) a stale
 * or missing backup marker would have stopped ALL retention until someone
 * repaired the backup job.
 *
 * WHY NOTHING CAUGHT IT. The ordering lived in a main() that cannot be loaded
 * without firebase-admin, so it was covered by text checks only — and the text
 * checks pinned the SHAPE OF THE BUG: backup-purge-interlock.test.js required
 * `process.exit(3)` within 600 characters of `if (gate.block)`, which is
 * exactly "exit on the spot". They were green on the defect and would have
 * gone red on the fix.
 *
 * So the ordering now lives in scripts/lib/cleanup-passes.js with both passes
 * injected, and is RUN here rather than grepped — three ways, from the cheapest
 * to the one that actually settles it:
 *
 *   1. runCleanupPasses() with stand-in passes: the ordering and exit codes.
 *   2. The same with the REAL gate verdict and the REAL metrics pruner.
 *   3. THE REAL SCRIPT, in a child process, with firebase-admin swapped for an
 *      in-memory database. This is the only one that executes main(), and
 *      main() is where the defect was.
 *
 * A last section of text checks on main() is kept as a fast backstop. It is
 * NOT the guarantee, and says why.
 *
 * Every refusal below is paired with a run that is ALLOWED, on the same
 * inputs. A blocked-gate test alone could not tell "the gate skipped the
 * session pass" from "nothing ever calls the session pass".
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  runCleanupPasses, EXIT_OK, EXIT_ERRORS, EXIT_BLOCKED
} = require("../scripts/lib/cleanup-passes");
const { backupGateReport } = require("../scripts/lib/backup-marker");
const { pruneHfPatientMetrics } = require("../scripts/lib/metrics-retention");

const BLOCKED = { block: true, line: "Backup gate: BLOCKED — test" };
const OPEN = { block: false, line: "Backup gate: OK — test" };
const NO_METRICS = { events: 0, usage: 0, sessionUsage: 0, dailyDays: 0, dailyUids: 0, errors: 0 };
const NO_SWEEP = { changes: 0, errors: 0 };

/* One recorded run. `calls` is the ORDER the passes actually ran in, which is
   the whole subject of this file, so it is recorded rather than inferred from
   the output. */
async function run(over = {}) {
  const calls = [], out = [], err = [];
  const result = await runCleanupPasses({
    gate: over.gate || OPEN,
    purgeSessions: async () => {
      calls.push("sessions");
      return over.sessions || { kept: 4, purged: 1, errors: 0 };
    },
    pruneMetrics: async () => {
      calls.push("metrics");
      return Object.assign({}, NO_METRICS, over.metrics);
    },
    sweepWithdrawals: async () => {
      calls.push("withdrawals");
      return Object.assign({}, NO_SWEEP, over.withdrawals);
    },
    confirm: over.confirm !== false,
    metricsDays: 30,
    sessionCount: 5,
    log: (l) => out.push(l),
    logError: (l) => err.push(l)
  });
  return { result, calls, out: out.join("\n"), err: err.join("\n") };
}

/* ── the defect ────────────────────────────────────────────────────────── */

test("BLOCKED: the session pass never runs, the metrics pass still does, and the run exits 3", async () => {
  const r = await run({ gate: BLOCKED, metrics: { events: 2, usage: 1 } });

  assert.deepStrictEqual(r.calls, ["metrics", "withdrawals"],
    "a blocked gate must skip the session pass and STILL prune the metrics tree — " +
    "the metrics rows are in no archive, so there is nothing for the gate to protect, " +
    "and skipping them is a second retention gap. The same goes for the withdrawal " +
    "records of sessions that are already gone");
  assert.strictEqual(r.result.exitCode, EXIT_BLOCKED);
  assert.match(r.out, /Metrics \(hfPatient, > 30d\): purged 2 events, 1 uid buckets, /,
    "the metrics summary must still be printed on a blocked run");
  assert.match(r.err, /^BLOCKED: no sessions were purged\./);
});

test("NOT blocked: sessions first, then metrics, exit 0 — the control for the test above", async () => {
  /* Same inputs, gate open. Without this, the blocked test would pass just as
     well if nothing ever called the session pass at all. */
  const r = await run({ gate: OPEN, metrics: { events: 2, usage: 1 } });

  assert.deepStrictEqual(r.calls, ["sessions", "metrics", "withdrawals"]);
  assert.strictEqual(r.result.exitCode, EXIT_OK);
  assert.match(r.out, /Summary: 4 kept, 1 purged, 0 errors\./);
  assert.strictEqual(r.err, "", "an unblocked run says nothing on stderr");
});

test("BLOCKED: the summary says blocked — it must not read as a clean run on an empty database", async () => {
  const r = await run({ gate: BLOCKED });
  assert.match(r.out,
    /Summary: session purge BLOCKED by the backup gate — 5 sessions left untouched, 0 errors\./);
  assert.ok(!/0 kept, 0 purged/.test(r.out),
    "no session was examined; \"0 kept, 0 purged\" is what an EMPTY database prints");
  assert.strictEqual(r.result.blocked, true);
});

test("BLOCKED + a metrics error still exits 3, and the error is counted rather than swallowed", async () => {
  /* A deliberate choice, with a cost worth stating: when both happen the exit
     code reports ONLY the refusal. 3 therefore means "the session purge was
     refused", not "and nothing else went wrong" — the breakage is carried by
     the ERROR lines and by the count asserted below, so that count must not
     be dropped on this path. */
  const r = await run({ gate: BLOCKED, metrics: { errors: 2 } });
  assert.strictEqual(r.result.exitCode, EXIT_BLOCKED, "a blocked run exits 3 whatever else happened");
  assert.strictEqual(r.result.errors, 2);
  assert.match(r.out, /left untouched, 2 errors\./,
    "the exit code does not say the metrics pass failed, so the Summary line has to");
});

/* ── the rest of the contract the script used to carry inline ──────────── */

test("an error in EITHER pass exits 1, and a session error does not skip the metrics pass", async () => {
  const sessionErr = await run({ sessions: { kept: 3, purged: 0, errors: 2 } });
  assert.deepStrictEqual(sessionErr.calls, ["sessions", "metrics", "withdrawals"],
    "an unrelated session failure must not silently skip a retention obligation");
  assert.strictEqual(sessionErr.result.exitCode, EXIT_ERRORS);

  const metricsErr = await run({ metrics: { errors: 1 } });
  assert.strictEqual(metricsErr.result.exitCode, EXIT_ERRORS);

  const both = await run({ sessions: { kept: 3, purged: 0, errors: 2 }, metrics: { errors: 1 } });
  assert.strictEqual(both.result.errors, 3, "errors from both passes are summed");
  assert.match(both.out, /Summary: 3 kept, 0 purged, 3 errors\./);
});

test("the three outcomes have three different exit codes, none of them the script's own 2", () => {
  /* 2 is taken: cleanup-stale-sessions.js exits 2 on a bad retention window and
     from main().catch. Pinned as literals because the workflow log and any
     alerting read the NUMBER, not the constant's name. */
  assert.deepStrictEqual([EXIT_OK, EXIT_ERRORS, EXIT_BLOCKED], [0, 1, 3]);
});

test("dry-run: says would-purge, and points at CLEANUP_CONFIRM only when there is something to purge", async () => {
  const hint = /Set CLEANUP_CONFIRM=1/;

  const pending = await run({ confirm: false });
  assert.match(pending.out, /Summary: 4 kept, 1 would-purge, 0 errors\./);
  assert.match(pending.out, /would-purge 0 events/);
  assert.match(pending.out, hint);

  const nothing = await run({ confirm: false, sessions: { kept: 5, purged: 0, errors: 0 } });
  assert.ok(!hint.test(nothing.out), "nothing to purge, so nothing to confirm");

  const metricsOnly = await run({
    confirm: false, sessions: { kept: 5, purged: 0, errors: 0 }, metrics: { dailyUids: 1 }
  });
  assert.match(metricsOnly.out, hint, "expired metrics alone are worth confirming");

  const live = await run({ confirm: true });
  assert.ok(!hint.test(live.out), "a live run has already deleted — no hint");
});

/* ── inputs are checked before anything is deleted ─────────────────────── */

test("a gate with no usable verdict throws BEFORE either pass — undefined must not read as 'not blocked'", async () => {
  /* `undefined` is falsy, so a plain `if (gate.block)` fails OPEN on a
     malformed verdict and purges with no archive check at all. */
  for (const gate of [undefined, null, {}, { block: undefined }, { block: "false" }, { block: 0 }, { block: 1 }]) {
    const calls = [];
    await assert.rejects(
      runCleanupPasses({
        gate,
        purgeSessions: async () => { calls.push("sessions"); return { kept: 0, purged: 0, errors: 0 }; },
        pruneMetrics: async () => { calls.push("metrics"); return NO_METRICS; },
        sweepWithdrawals: async () => { calls.push("withdrawals"); return NO_SWEEP; }
      }),
      /backupGateReport\(\) verdict/,
      "gate=" + JSON.stringify(gate) + " must be refused"
    );
    assert.deepStrictEqual(calls, [], "gate=" + JSON.stringify(gate) + " ran a pass before failing");
  }
  await assert.rejects(runCleanupPasses(), /backupGateReport\(\) verdict/,
    "no options at all is a TypeError with the same message, not a crash on `undefined.gate`");
});

test("a missing pass is refused before the others delete anything", async () => {
  /* Otherwise a forgotten metrics pass is discovered only after the sessions
     are already gone — one irreversible step too late. Each of the three is
     left out in turn: a pass that is optional is a pass that can silently stop
     running. */
  const passes = {
    purgeSessions: "sessions", pruneMetrics: "metrics", sweepWithdrawals: "withdrawals"
  };
  for (const missing of Object.keys(passes)) {
    const calls = [];
    const opts = { gate: OPEN };
    for (const name of Object.keys(passes)) {
      if (name === missing) continue;
      opts[name] = async () => {
        calls.push(passes[name]);
        return Object.assign({ kept: 0, purged: 1 }, NO_METRICS, NO_SWEEP);
      };
    }
    await assert.rejects(runCleanupPasses(opts), /must all be functions/, missing + " was optional");
    assert.deepStrictEqual(calls, [], "a pass ran although " + missing + " was missing");
  }
});

/* ── the third pass: withdrawal records of sessions already purged ─────── */

test("BLOCKED: the withdrawal sweep still runs, after the metrics, and its errors are counted", async () => {
  /* It deletes nothing the session backup holds — these are records of
     sessions that are already gone — so a stale backup is no reason to stop
     it, exactly as for the metrics. */
  const r = await run({ gate: BLOCKED, withdrawals: { changes: 2, errors: 1 } });
  assert.deepStrictEqual(r.calls, ["metrics", "withdrawals"]);
  assert.strictEqual(r.result.exitCode, EXIT_BLOCKED);
  assert.strictEqual(r.result.errors, 1);
  assert.match(r.out, /left untouched, 1 errors[.]/);
  assert.match(r.err, /So does the sweep of withdrawal records/);
});

test("an error in the withdrawal sweep alone exits 1, and the earlier passes still ran", async () => {
  const r = await run({ withdrawals: { errors: 1 } });
  assert.deepStrictEqual(r.calls, ["sessions", "metrics", "withdrawals"]);
  assert.strictEqual(r.result.exitCode, EXIT_ERRORS);
  assert.match(r.out, /Summary: 4 kept, 1 purged, 1 errors[.]/);
});

test("dry-run: pending withdrawal records alone are worth confirming", async () => {
  const hint = /Set CLEANUP_CONFIRM=1/;
  const quiet = await run({ confirm: false, sessions: { kept: 5, purged: 0, errors: 0 } });
  assert.ok(!hint.test(quiet.out), "control: nothing pending, no hint");
  const pending = await run({
    confirm: false, sessions: { kept: 5, purged: 0, errors: 0 }, withdrawals: { changes: 1 }
  });
  assert.match(pending.out, hint);
});

/* ── the real gate and the real pruner, against one fake database ───────
 * The tests above inject stand-ins for both passes. This pair uses the REAL
 * backupGateReport() verdict and the REAL pruneHfPatientMetrics(), so it pins
 * the contract between the three modules — in particular that the object
 * backupGateReport() returns is one runCleanupPasses() accepts.
 *
 * The SESSION pass is still a stand-in here: "no session path is written"
 * follows from it not being called. The real purgeSessions() only runs in the
 * child-process tests further down. */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 7, 3, 17, 0);   // fixed clock: no Date.now() here
const CUTOFF = NOW - 30 * DAY;

function fakeDb() {
  const tree = {
    "metrics/hfPatient/events": {
      old: { uid: "u1", at: CUTOFF - DAY },
      fresh: { uid: "u2", at: CUTOFF + DAY }
    }
  };
  const writes = [];
  return {
    writes,
    ref(p) {
      return {
        async once() { return { val: () => (p in tree ? tree[p] : null) }; },
        async update(obj) { writes.push({ path: p || "<root>", keys: Object.keys(obj) }); }
      };
    }
  };
}

/* What the script's session pass does to the database: ONE root-level
   multi-path update with null values (see `db.ref().update(purge)` there). */
const purgeOneSession = (db) => async () => {
  await db.ref().update({ "sessions/ABC": null, "adminSecrets/ABC": null });
  return { kept: 0, purged: 1, errors: 0 };
};

async function endToEnd(marker) {
  const db = fakeDb();
  const gate = backupGateReport({ armed: true, marker, now: NOW, maxAgeDays: 2 });
  const result = await runCleanupPasses({
    gate,
    purgeSessions: purgeOneSession(db),
    pruneMetrics: () => pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: true }),
    sweepWithdrawals: async () => NO_SWEEP,
    confirm: true, metricsDays: 30, sessionCount: 1,
    log: () => {}, logError: () => {}
  });
  return { gate, result, writes: db.writes };
}

test("armed gate, NO backup marker: expired metrics are deleted and no session path is written", async () => {
  const r = await endToEnd(null);
  assert.strictEqual(r.gate.block, true, "precondition: an armed gate with no marker blocks");
  assert.deepStrictEqual(r.writes, [{ path: "metrics/hfPatient/events", keys: ["old"] }],
    "exactly one write: the expired metrics row. Nothing at the root, nothing under sessions/");
  assert.strictEqual(r.result.exitCode, 3);
});

test("armed gate, FRESH backup marker: the session is purged too — same database, the control", async () => {
  const r = await endToEnd({ at: NOW - DAY });
  assert.strictEqual(r.gate.block, false, "precondition: a one-day-old backup is fresh");
  assert.deepStrictEqual(r.writes, [
    { path: "<root>", keys: ["sessions/ABC", "adminSecrets/ABC"] },
    { path: "metrics/hfPatient/events", keys: ["old"] }
  ]);
  assert.strictEqual(r.result.exitCode, 0);
});

/* ── THE REAL SCRIPT, in a child process ───────────────────────────────
 * Everything above proves runCleanupPasses() orders the passes correctly. It
 * proves nothing about whether the SCRIPT uses it — and the defect was a few
 * lines of main() acting before the passes. So main() itself is run here:
 * `node -r tests/fixtures/fake-firebase-admin-preload.js <the real script>`,
 * with the production flags (live, quiet, gate armed), against a database
 * holding one expired session, one live session, and metrics on both sides of
 * the 30-day window.
 *
 * The assertions are on the COMPLETE list of writes the script attempted, not
 * on its text. That is what makes them spelling-proof: an early return, a
 * `process.exitCode = 3`, or a session delete added in some third function all
 * change the exit code or the write list, however they are written.
 *
 * Run against the script as it was before this fix, the blocked cases fail
 * with an EMPTY write list: exit 3, and not one metrics row pruned. */

const ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "cleanup-stale-sessions.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-firebase-admin-preload.js");

/* The fake keeps the event loop alive the way a real RTDB connection does, so
   a script that returns without process.exit() hangs and is killed here. */
const HANG_TIMEOUT_MS = 20000;

function childEnv(extra) {
  const env = Object.assign({}, process.env);
  // Hermetic: a CLEANUP_* or FAKE_DB_* variable in the developer's shell must
  // not change what this run does.
  for (const k of Object.keys(env)) if (/^(CLEANUP_|FAKE_DB_)/.test(k)) delete env[k];
  return Object.assign(env, extra);
}

function runScript(opts) {
  const now = Date.now();
  const tree = {
    sessions: {
      EXPIRED1: { created: { at: now - 100 * DAY }, closed: { at: now - 40 * DAY } },
      LIVE0001: { created: { at: now - 1 * DAY } }
    },
    metrics: {
      hfPatient: {
        events: { eOld: { uid: "u1", at: now - 45 * DAY }, eNew: { uid: "u2", at: now - DAY } },
        usage: { uOld: { lastAt: now - 45 * DAY }, uNew: { lastAt: now - DAY } }
      }
    },
    ops: opts.markerAgeDays === undefined
      ? {}
      : { lastBackup: { at: now - opts.markerAgeDays * DAY, sessions: 2, uri: "s3://fake" } }
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-run-"));
  const outFile = path.join(dir, "writes.json");
  try {
    const r = spawnSync(process.execPath, ["-r", PRELOAD, SCRIPT_PATH], {
      encoding: "utf8",
      timeout: HANG_TIMEOUT_MS,
      env: childEnv({
        FAKE_DB_TREE: JSON.stringify(tree),
        FAKE_DB_WRITES_OUT: outFile,
        FAKE_DB_THROW_ON: opts.throwOn || "",
        FIREBASE_DATABASE_URL: "https://fake-db.invalid",
        // What .github/workflows/cleanup-stale-sessions.yml sets on the cron.
        CLEANUP_CONFIRM: "1",
        CLEANUP_QUIET: "1",
        CLEANUP_REQUIRE_BACKUP: "1",
        CLEANUP_BACKUP_MAX_AGE_DAYS: "2"
      })
    });
    const log = "\n--- stdout ---\n" + r.stdout + "\n--- stderr ---\n" + r.stderr;
    assert.ok(!r.error && r.status !== null,
      "the script did not end by itself and was killed after " + HANG_TIMEOUT_MS + " ms — " +
      "a path through main() returns without process.exit()." + log);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, log,
      writes: JSON.parse(fs.readFileSync(outFile, "utf8")).writes };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const METRICS_WRITES = [
  { op: "update", path: "metrics/hfPatient/events", keys: ["eOld"] },
  { op: "update", path: "metrics/hfPatient/usage", keys: ["uOld"] }
];

const BLOCKED_CASES = [
  ["no backup marker at all", {}],
  ["a backup marker 9 days old", { markerAgeDays: 9 }],
  /* The gate must fail CLOSED when it cannot read the marker — and failing
     closed must not take the metrics pass down with it either. */
  ["a marker read that throws", { markerAgeDays: 0.5, throwOn: "ops/lastBackup" }]
];

for (const [name, opts] of BLOCKED_CASES) {
  test("REAL SCRIPT, gate blocked by " + name + ": metrics pruned, no session touched, exit 3", () => {
    const r = runScript(opts);
    assert.strictEqual(r.status, 3, "a blocked run exits 3." + r.log);
    assert.deepStrictEqual(r.writes, METRICS_WRITES,
      "a blocked run writes the two expired metrics rows and NOTHING else — an empty " +
      "list is the original defect (metrics skipped); anything extra is a delete the " +
      "gate did not stop." + r.log);
    assert.match(r.stdout, /Backup gate: BLOCKED — /);
    assert.match(r.stdout, /Metrics \(hfPatient, > 30d\): purged 1 events, 1 uid buckets, /,
      "the metrics summary must still be printed");
    assert.match(r.stdout,
      /Summary: session purge BLOCKED by the backup gate — 2 sessions left untouched, 0 errors\./);
    assert.match(r.stderr, /BLOCKED: no sessions were purged\./);
  });
}

test("REAL SCRIPT, fresh backup: the expired session IS purged, then the metrics — the control", () => {
  /* Same database, same flags, backup 12 hours old. Without this the blocked
     cases could not tell "the gate stopped the purge" from "this harness never
     reaches the purge". It is also the only test that executes the script's
     real purgeSessions(). */
  const r = runScript({ markerAgeDays: 0.5 });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, [
    { op: "update", path: "", keys: [
      "adminSecrets/EXPIRED1", "certIds/EXPIRED1", "purgedSessions/EXPIRED1",
      "recovery/sessions/EXPIRED1", "roomChat/EXPIRED1", "roomChatAuthors/EXPIRED1",
      "rosters/sessions/EXPIRED1", "sessions/EXPIRED1"
    ] },
    { op: "update", path: "", keys: ["sessions/LIVE0001/_superadminReset"] }
  ].concat(METRICS_WRITES),
    "one atomic root update for the expired session and its out-of-cascade " +
    "siblings; then ONE more, a null at the old reset-flag node of the session that " +
    "was KEPT (a leftover there holds a recovery code in clear — written blind, in " +
    "its own update, after the purge; tests/reset-flag-unreadable.test.js); then " +
    "the metrics. Nothing else of the live session is touched. Three things changed " +
    "on 2026-10-07 and all are deliberate: the update WRITES the purge marker " +
    "(purgedSessions/<code>); it no longer deletes withdrawals/<code> whole — " +
    "each record is decided on its own, and this session has none " +
    "(tests/withdrawal-retention.test.js has the ones that do); and it deletes " +
    "the recovery code, the one sibling nothing deleted before. Whether this list " +
    "is COMPLETE is not decided here — tests/purge-tree-coverage.test.js derives " +
    "it from database.rules.json." + r.log);
  assert.match(r.stdout, /Backup gate: OK — /);
  assert.match(r.stdout, /Summary: 1 kept, 1 purged, 0 errors\./);
  assert.ok(!/EXPIRED1|LIVE0001/.test(r.stdout + r.stderr),
    "CLEANUP_QUIET=1: a session code must never reach the (world-readable) log." + r.log);
});

test("the fake really does hold the event loop open — so a hang cannot pass as a clean exit", () => {
  /* Anti-vacuity for the hang check in runScript(). A script that does nothing
     and never calls process.exit() must NOT end by itself under the preload;
     if it did, "the script exited" above would prove nothing about whether the
     real one calls process.exit(). */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-run-"));
  try {
    const r = spawnSync(process.execPath, ["-r", PRELOAD, "-e", "/* falls off the end */"], {
      encoding: "utf8",
      timeout: 2000,
      env: childEnv({ FAKE_DB_WRITES_OUT: path.join(dir, "writes.json") })
    });
    assert.strictEqual(r.status, null, "the child ended by itself: " + r.stdout + r.stderr);
    assert.strictEqual(r.error && r.error.code, "ETIMEDOUT");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ── wiring: text checks on main(), kept as a fast backstop ────────────
 * These pin the shape that makes the defect impossible and give a precise
 * message when it is broken. They are NOT the guarantee — the child-process
 * tests above are. A text check only catches a regression written the way it
 * expects: `const { block } = gate; if (block) return;` reads the verdict
 * without ever spelling "gate.block", and passes every assertion below. */

const SCRIPT = fs.readFileSync(SCRIPT_PATH, "utf8")
  .split("\r\n").join("\n");
/* Code only. The script's comments DESCRIBE the old behaviour — they name
   process.exit(3) and gate.block — so an unstripped search would fail on
   correct code. Whole-line `//` comments only: a bare `//.*$` would also eat
   the tail of every "https://…" string. */
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The body of a top-level function: from its declaration to the first closing
   brace in column 0. */
function body(name) {
  const start = CODE.indexOf("async function " + name + "(");
  assert.notStrictEqual(start, -1, "cleanup-stale-sessions.js has no top-level " + name + "()");
  const end = CODE.indexOf("\n}\n", start);
  assert.notStrictEqual(end, -1, "could not find the end of " + name + "()");
  return CODE.slice(start, end);
}

test("wiring: main() hands the gate's verdict and BOTH passes to runCleanupPasses", () => {
  assert.match(SCRIPT, /require\("\.\/lib\/cleanup-passes"\)/);
  const main = body("main");
  const at = main.indexOf("await runCleanupPasses({");
  assert.notStrictEqual(at, -1, "main() must run the passes through runCleanupPasses()");
  const args = main.slice(at, main.indexOf("});", at));
  assert.match(args, /^\s*gate,$/m, "the verdict backupGateReport() returned, not a copy");
  assert.match(args, /purgeSessions: \(\) => purgeSessions\(db, locations\)/);
  assert.match(args, /pruneMetrics: \(\) => pruneMetrics\(db\)/,
    "declaring the metrics helper is not enough — it must be handed over to be run");
  assert.match(args, /sweepWithdrawals: [(][)] => sweepWithdrawals[(]db, locations[)]/,
    "the withdrawal sweep must be handed over too, or it never runs");
  assert.match(args, /confirm: CONFIRM/, "the passes' wording must follow the real mode");
});

test("wiring: the script never acts on the verdict itself, and cannot exit before the passes", () => {
  /* THE SHAPE OF THE BUG: `if (gate.block) { …; process.exit(3); }` in main(),
     ahead of both passes. */
  assert.ok(!/gate\.block/.test(CODE),
    "cleanup-stale-sessions.js reads gate.block again. Deciding what a blocked gate " +
    "skips belongs to runCleanupPasses(), where it is tested; a branch here is how " +
    "the metrics pass got skipped.");
  assert.ok(!/process\.exit\(3\)/.test(CODE),
    "exit code 3 is returned by runCleanupPasses(); a literal exit(3) here is an " +
    "early exit that bypasses the metrics pass");

  const main = body("main");
  const gateAt = main.indexOf("backupGateReport(");
  const handoff = main.indexOf("await runCleanupPasses(");
  assert.ok(gateAt > 0 && handoff > gateAt, "the gate must be evaluated before the passes run");
  assert.ok(!/process\.exit\(/.test(main.slice(gateAt, handoff)),
    "nothing may end the run between the gate's verdict and the hand-off");
});

test("wiring: main() ends by exiting with the code the passes returned", () => {
  /* Its LAST statement — which is also the one thing ops-scripts-terminate
     cannot check for itself: that the terminal path, not just some early
     branch, calls process.exit(). */
  const main = body("main");
  assert.match(main, /const outcome = await runCleanupPasses\(\{/);
  assert.match(main, /process\.exit\(outcome\.exitCode\);\s*$/,
    "main() must finish on process.exit(outcome.exitCode) — firebase-admin holds the " +
    "event loop open, and any other code would discard the 0/1/3 distinction");
});

test("wiring: a session can only be deleted from inside the gated pass", () => {
  assert.ok(!/\.(update|remove|set)\(/.test(body("main")),
    "main() must not write to the database — a delete here runs whatever the gate says");
  assert.ok(body("purgeSessions").includes("db.ref().update(purge)"),
    "the session delete must live in purgeSessions(), the pass a blocked gate skips");
  /* One definition + one call each, the call being the callback asserted
     above. A second call site would be a pass the gate does not govern. */
  for (const fn of ["purgeSessions", "pruneMetrics", "sweepWithdrawals"]) {
    assert.strictEqual(CODE.split(fn + "(").length - 1, 2,
      fn + "() must be called exactly once — from the runCleanupPasses() hand-off");
  }
});
