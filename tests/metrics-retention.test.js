"use strict";
/* tests/metrics-retention.test.js
 *
 * The hfPatient metrics tree had NO retention: the cleanup job walked sessions
 * only, and these rows hang off no session, so everything written since the LLM
 * pilot launched (2026-05-30) accumulated for ever. They are not anonymous —
 * each carries the Firebase Auth uid as a field (`events`) or as the KEY
 * (`usage/<uid>`, `dailyUid/<uid>`), which is pseudonymous personal data under
 * GDPR Recital 30. Found 2026-08-12 while correcting the functions README,
 * which had claimed "No PII logged".
 *
 * These are the DELETION rules, so the tests lean on the two directions that
 * actually hurt: keeping something past its window (the gap being closed), and
 * deleting something inside it (destroying live rate-limit state or the cost
 * history). Both are asserted explicitly, in both directions.
 */

const test = require("node:test");
const assert = require("node:assert");
const {
  expiredEventKeys, expiredBucketKeys, expiredDailyPaths, dayKey
} = require("../scripts/lib/metrics-retention");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);   // fixed clock: no Date.now() here
const CUTOFF = NOW - 30 * DAY;
const OLD = CUTOFF - DAY;        // safely expired
const FRESH = CUTOFF + DAY;      // safely inside the window

test("events: expire by `at`, keep everything inside the window", () => {
  const events = {
    e1: { uid: "u1", at: OLD, lang: "en" },
    e2: { uid: "u2", at: FRESH, lang: "fr" },
    e3: { uid: "u3", at: NOW, lang: "ja" }
  };
  assert.deepStrictEqual(expiredEventKeys(events, CUTOFF), ["e1"]);
});

test("events: a row with no usable `at` expires rather than living for ever", () => {
  /* The safe direction for a retention job: an un-timestamped row cannot be
     shown to be within retention, and the opposite default would let one
     malformed write outlive the policy permanently. */
  const events = {
    a: { uid: "u", at: null }, b: { uid: "u" }, c: { uid: "u", at: "2026-01-01" }, d: null,
    keep: { uid: "u", at: FRESH }
  };
  assert.deepStrictEqual(expiredEventKeys(events, CUTOFF).sort(), ["a", "b", "c", "d"]);
});

test("events: empty / missing / malformed trees are a no-op, not a crash", () => {
  for (const v of [null, undefined, {}, "nope", 42, []]) {
    assert.deepStrictEqual(expiredEventKeys(v, CUTOFF), []);
  }
});

test("buckets: the KEY is the uid, so an expired bucket goes whole", () => {
  const usage = {
    uidOld: { count: 3, windowStart: OLD, lastAt: OLD },
    uidFresh: { count: 1, windowStart: FRESH, lastAt: FRESH }
  };
  assert.deepStrictEqual(expiredBucketKeys(usage, CUTOFF), ["uidOld"]);
});

test("buckets: falls back to windowStart when lastAt predates that field", () => {
  // lastAt was added after windowStart; without the fallback an older row would
  // read as un-expirable and never be collected.
  const usage = {
    legacyOld: { count: 2, windowStart: OLD },
    legacyFresh: { count: 2, windowStart: FRESH },
    junk: "not-an-object"
  };
  assert.deepStrictEqual(expiredBucketKeys(usage, CUTOFF).sort(), ["junk", "legacyOld"]);
});

test("buckets: a LIVE rate-limit window is never deleted", () => {
  /* Deleting a bucket resets someone's hourly allowance, so an over-eager rule
     here quietly hands out a fresh 40 turns — a cost control, not just tidiness. */
  const usage = { active: { count: 39, windowStart: NOW - 60 * 1000, lastAt: NOW - 60 * 1000 } };
  assert.deepStrictEqual(expiredBucketKeys(usage, CUTOFF), []);
});

test("dailyUid: expires per day, and removes a uid whose every day is gone", () => {
  const oldDay = String(dayKey(OLD));
  const freshDay = String(dayKey(FRESH));
  const daily = {
    spent: { [oldDay]: 5 },                    // nothing left → drop the uid node
    mixed: { [oldDay]: 2, [freshDay]: 7 },     // drop only the old day
    current: { [freshDay]: 1 }                 // untouched
  };
  const out = expiredDailyPaths(daily, CUTOFF);
  assert.deepStrictEqual(out.emptyUids, ["spent"]);
  assert.deepStrictEqual(out.dayPaths, ["mixed/" + oldDay]);
});

test("dailyUid: an emptied uid node is not left behind as a record of who used it", () => {
  /* Pruning the days but keeping `dailyUid/<uid>: {}` would leave one empty
     node per participant for ever — still a uid-keyed list of who used the
     chat, which is the exact thing the retention window exists to drop. */
  const out = expiredDailyPaths({ u1: { [String(dayKey(OLD))]: 1 } }, CUTOFF);
  assert.deepStrictEqual(out.emptyUids, ["u1"]);
  assert.deepStrictEqual(out.dayPaths, []);
});

test("dailyUid: malformed day keys and uid nodes expire", () => {
  const out = expiredDailyPaths({ bad: "not-an-object", weird: { "not-a-day": 3 } }, CUTOFF);
  assert.ok(out.emptyUids.includes("bad"));
  assert.ok(out.emptyUids.includes("weird"), "a uid whose every key is junk has nothing worth keeping");
});

test("dailyUid: empty / missing trees are a no-op", () => {
  for (const v of [null, undefined, {}, "x"]) {
    assert.deepStrictEqual(expiredDailyPaths(v, CUTOFF), { dayPaths: [], emptyUids: [] });
  }
});

test("the day key matches the one the function writes with", () => {
  /* expiredDailyPaths compares against dayKey(cutoff); if this drifted from the
     writer's key format the comparison would be nonsense and either delete
     everything or nothing. Imported from hf-helpers for exactly that reason. */
  const { dayKey: fnDayKey } =
    require("../docs/Third_session/PBL_platform/functions/lib/hf-helpers");
  assert.strictEqual(dayKey, fnDayKey, "must be the SAME function, not a copy");
  assert.strictEqual(dayKey(Date.UTC(2026, 0, 5, 12, 0, 0)), 20260105);
});

test("boundary: exactly at the cutoff is kept, one ms before expires", () => {
  assert.deepStrictEqual(expiredEventKeys({ k: { at: CUTOFF } }, CUTOFF), []);
  assert.deepStrictEqual(expiredEventKeys({ k: { at: CUTOFF - 1 } }, CUTOFF), ["k"]);
});

/* ── The README promises this is ENFORCED; pin that to the wiring ─────────
 * The security section states a 30-day window "enforced daily by
 * cleanup-stale-sessions". That sentence is a claim about code in three other
 * files, and this repo has just spent a day fixing doc claims that had quietly
 * stopped being true. */

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const SCRIPT = fs.readFileSync(path.join(ROOT, "scripts", "cleanup-stale-sessions.js"), "utf8");
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "cleanup-stale-sessions.yml"), "utf8");
const FN_README = fs.readFileSync(
  path.join(ROOT, "docs", "Third_session", "PBL_platform", "functions", "README.md"), "utf8");

const LIB = fs.readFileSync(path.join(ROOT, "scripts", "lib", "metrics-retention.js"), "utf8");

test("wiring: the cleanup script actually prunes the metrics tree", () => {
  assert.match(SCRIPT, /require\("\.\/lib\/metrics-retention"\)/,
    "the script must use the retention rules");
  assert.match(SCRIPT, /await pruneMetrics\(db\)/,
    "declaring the helper is not enough — main() must call it");
  assert.match(SCRIPT, /pruneHfPatientMetrics\(db, \{ cutoffMs: metricsCutoff, confirm: CONFIRM \}\)/,
    "the script must pass its own cutoff and confirm flag, not defaults");
  for (const node of ["events", "usage", "sessionUsage", "dailyUid"]) {
    assert.ok(LIB.includes(`"${node}"`), `the pruner must cover ${node}`);
  }
});

test("wiring: the workflow passes the retention window", () => {
  assert.match(WORKFLOW, /CLEANUP_RETENTION_METRICS_DAYS:/,
    "the scheduled run must set the window, or it silently uses the default");
  assert.match(WORKFLOW, /retention_metrics_days/,
    "the manual dispatch must expose it too, for a dry-run preview");
});

test("wiring: the window the README promises is the window the script defaults to", () => {
  const m = SCRIPT.match(/retentionDays\("CLEANUP_RETENTION_METRICS_DAYS",\s*(\d+)\)/);
  assert.ok(m, "the script must define a default metrics window");
  const readmeDays = FN_README.match(/\*Retention:\*\s*\*\*(\d+)\s*days\*\*/);
  assert.ok(readmeDays, "the README must state the retention window");
  assert.strictEqual(readmeDays[1], m[1],
    "the README promises a different window than the job enforces");
});

test("wiring: metrics pruning never logs a key", () => {
  /* These nodes are keyed by Firebase Auth uid and the Actions logs on this
     PUBLIC repo are world-readable. CLEANUP_QUIET exists because session CODES
     are sensitive; a uid identifies a PERSON, so there is no verbose mode to
     opt into here — counts only, and errors by code, never e.message (which can
     embed the node path, and therefore the uid). */
  const start = LIB.indexOf("async function pruneHfPatientMetrics");
  assert.notStrictEqual(start, -1, "the pruner must exist");
  const body = LIB.slice(start, LIB.indexOf("\nmodule.exports", start));
  assert.ok(!/e\.message/.test(body),
    "the pruner must not log e.message — it can embed a uid-bearing path");
  assert.match(body, /e && e\.code/, "errors must be reported by code");
  assert.ok(!/\$\{uid\}|\+ uid|, uid\)/.test(body),
    "no log line may interpolate a uid");
});

test("wiring: global/<day> is deliberately NOT pruned", () => {
  // Asserting an ABSENCE, so it is easy to break by accident later: the value
  // of this test is that deleting the cost history needs a deliberate edit here.
  const start = LIB.indexOf("async function pruneHfPatientMetrics");
  const body = LIB.slice(start, LIB.indexOf("\nmodule.exports", start));
  assert.ok(!/"global"/.test(body),
    "global/<day> is an identifier-free aggregate and the cost history — keep it");
});

/* ── The deletion itself, against a fake db ───────────────────────────────
 * The pure rules decide WHAT expires; this is what actually gets written. A
 * wrong path here is the expensive kind of bug — an `update()` aimed one level
 * too high would null the whole metrics tree, and nothing in the pure tests
 * would notice. */

const { pruneHfPatientMetrics } = require("../scripts/lib/metrics-retention");

function fakeDb(tree, opts = {}) {
  const reads = [], updates = [];
  return {
    reads, updates,
    ref(p) {
      const rel = p.replace("metrics/hfPatient/", "");
      return {
        async once() {
          reads.push(rel);
          if (opts.throwOn === rel) { const e = new Error("boom"); e.code = "PERMISSION_DENIED"; throw e; }
          return { val: () => (rel in tree ? tree[rel] : null) };
        },
        async update(obj) { updates.push({ path: rel, obj }); }
      };
    }
  };
}

const OLD_DAY = String(dayKey(OLD)), FRESH_DAY = String(dayKey(FRESH));
const TREE = () => ({
  events: { e1: { uid: "u1", at: OLD }, e2: { uid: "u2", at: FRESH } },
  usage: { uidOld: { lastAt: OLD }, uidNew: { lastAt: FRESH } },
  sessionUsage: { codeOld: { lastAt: OLD } },
  dailyUid: { spent: { [OLD_DAY]: 1 }, mixed: { [OLD_DAY]: 1, [FRESH_DAY]: 2 } },
  global: { [OLD_DAY]: 999 }
});

test("prune: dry-run counts everything and writes NOTHING", async () => {
  const db = fakeDb(TREE());
  const n = await pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: false });
  assert.deepStrictEqual(db.updates, [], "a dry run must not delete");
  assert.strictEqual(n.events, 1);
  assert.strictEqual(n.usage, 1);
  assert.strictEqual(n.sessionUsage, 1);
  assert.strictEqual(n.dailyDays, 1);
  assert.strictEqual(n.dailyUids, 1);
  assert.strictEqual(n.errors, 0);
});

test("prune: confirm deletes exactly the expired keys, by null-update", async () => {
  const db = fakeDb(TREE());
  await pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: true });
  const byPath = Object.fromEntries(db.updates.map(u => [u.path, u.obj]));
  assert.deepStrictEqual(byPath.events, { e1: null }, "only the expired event");
  assert.deepStrictEqual(byPath.usage, { uidOld: null }, "the live bucket survives");
  assert.deepStrictEqual(byPath.sessionUsage, { codeOld: null });
  // the spent uid node goes whole; the mixed uid loses only its expired day
  assert.deepStrictEqual(byPath.dailyUid, { ["mixed/" + OLD_DAY]: null, spent: null });
});

test("prune: never reads or writes global/<day>", async () => {
  const db = fakeDb(TREE());
  await pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: true });
  assert.ok(!db.reads.includes("global"), "the cost history must not even be read");
  assert.ok(!db.updates.some(u => u.path === "global"));
});

test("prune: a failing section does not abort the rest", async () => {
  /* One unreadable node must not silently skip the other three — a retention
     obligation that stops at the first error is a retention gap. */
  const db = fakeDb(TREE(), { throwOn: "events" });
  const logs = [];
  const n = await pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: true, log: m => logs.push(m) });
  assert.strictEqual(n.errors, 1);
  assert.strictEqual(n.events, 0, "the failed section counts nothing");
  assert.strictEqual(n.usage, 1, "later sections still ran");
  assert.strictEqual(n.dailyUids, 1);
  assert.ok(logs.join(" ").includes("PERMISSION_DENIED"), "the error CODE is reported");
});

test("prune: nothing is logged that could identify a person", async () => {
  const db = fakeDb(TREE(), { throwOn: "usage" });
  const logs = [];
  await pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: true, log: m => logs.push(m) });
  const all = logs.join(" ");
  for (const id of ["uidOld", "uidNew", "spent", "mixed", "codeOld", "u1", "u2"]) {
    assert.ok(!all.includes(id), `log leaked the identifier "${id}" into world-readable output`);
  }
});

test("prune: an empty tree is a clean no-op", async () => {
  const db = fakeDb({});
  const n = await pruneHfPatientMetrics(db, { cutoffMs: CUTOFF, confirm: true });
  assert.deepStrictEqual(db.updates, []);
  assert.strictEqual(n.errors, 0);
  assert.strictEqual(n.events + n.usage + n.sessionUsage + n.dailyDays + n.dailyUids, 0);
});

/* ── Malformed day keys must EXPIRE, not survive ──────────────────────────
 * parseInt() failed in the direction that keeps data: "20261301" (month 13)
 * parses larger than any real cutoff and "20260812junk" parses to a recent day,
 * so both would outlive the window for ever — contradicting the
 * malformed-expires rule the rest of the file follows. CodeRabbit, #314. */

test("dailyUid: an out-of-range month/day key expires instead of living for ever", () => {
  const daily = {
    u: {
      "20261301": 1,        // month 13
      "20260832": 1,        // day 32
      "20260230": 1,        // 30 February — Date would roll this over
      "20260812junk": 1,    // numeric prefix, junk suffix
      "2026081": 1,         // too short
      "202608123": 1        // too long
    }
  };
  const out = expiredDailyPaths(daily, CUTOFF);
  assert.deepStrictEqual(out.emptyUids, ["u"],
    "every key is malformed, so nothing is worth keeping and the uid node goes");
});

test("dailyUid: a malformed key is dropped even when a valid recent day survives", () => {
  const daily = { u: { "20261301": 1, [FRESH_DAY]: 2 } };
  const out = expiredDailyPaths(daily, CUTOFF);
  assert.deepStrictEqual(out.dayPaths, ["u/20261301"], "the impossible date is deleted");
  assert.deepStrictEqual(out.emptyUids, [], "the valid recent day keeps the uid node alive");
});

test("dailyUid: real leap-day and month-end keys are NOT mistaken for malformed", () => {
  // 2028 is a leap year; deleting a legitimate key would destroy live rate-limit state.
  const daily = { u: { "20280229": 1, "20280131": 1, "20280430": 1 } };
  const out = expiredDailyPaths(daily, CUTOFF);
  assert.deepStrictEqual(out, { dayPaths: [], emptyUids: [] });
  // ...and 2026 is NOT a leap year, so 29 Feb 2026 is impossible and must go.
  const bad = expiredDailyPaths({ u: { "20260229": 1 } }, CUTOFF);
  assert.deepStrictEqual(bad.emptyUids, ["u"]);
});

/* ── The retention window itself is validated before anything is deleted ── */

test("the script validates the retention windows before computing a cutoff", () => {
  /* A free-form workflow input reaching parseInt() is the worst input path in
     this repo: "-1" puts the cutoff in the FUTURE, so `at < cutoff` is true for
     every live row and the job deletes current data; "abc" gives NaN, every
     comparison is false, and retention silently stops. Both are unrecoverable
     and neither announces itself. */
  assert.match(SCRIPT, /function retentionDays\(/, "windows must go through a validator");
  assert.ok(!/parseInt\(process\.env\.CLEANUP_RETENTION/.test(SCRIPT),
    "no retention window may be read with bare parseInt()");
  for (const v of ["CLEANUP_RETENTION_CLOSED_DAYS", "CLEANUP_RETENTION_OPEN_DAYS",
                   "CLEANUP_RETENTION_METRICS_DAYS"]) {
    assert.ok(SCRIPT.includes(`retentionDays("${v}"`),
      `${v} must be validated — "-1" there deletes live data`);
  }
  assert.match(SCRIPT, /parseRetentionDays\(process\.env\[name\], fallback\)/,
    "validation must go through the tested parser, not a local copy of the rule");
  assert.match(SCRIPT, /process\.exit\(2\)/,
    "a bad window must abort the run, not be guessed at");
});

/* ── The window parser itself, exercised rather than grepped ──────────────── */

const { parseRetentionDays } = require("../scripts/lib/retention-window");

test("retention window: a negative value is REJECTED, not turned into a future cutoff", () => {
  /* The catastrophic case. Date.now() - (-1 * DAY) is in the FUTURE, so every
     live row satisfies `at < cutoff`. On CLEANUP_RETENTION_CLOSED_DAYS that
     purges every session in both trees. */
  for (const bad of ["-1", "-30", "0"]) {
    const r = parseRetentionDays(bad, 30);
    assert.strictEqual(r.ok, false, `${bad} must be rejected`);
    assert.match(r.error, /positive whole number/);
  }
});

test("retention window: a non-numeric value is REJECTED, not silently NaN", () => {
  // NaN makes every comparison false, so nothing purges and the run looks clean.
  for (const bad of ["abc", "30d", "1e400", "NaN", "Infinity", "0x1f", " "]) {
    assert.strictEqual(parseRetentionDays(bad, 30).ok, false, `${bad} must be rejected`);
  }
});

test("retention window: a fractional value is REJECTED, not truncated", () => {
  // parseInt("30.5") silently gives 30 — a different policy than was asked for.
  for (const bad of ["30.5", "0.5", "29.999"]) {
    assert.strictEqual(parseRetentionDays(bad, 30).ok, false, `${bad} must be rejected`);
  }
});

test("retention window: unset falls back, valid values pass through", () => {
  for (const empty of [undefined, null, ""]) {
    assert.deepStrictEqual(parseRetentionDays(empty, 30), { ok: true, value: 30 });
  }
  assert.deepStrictEqual(parseRetentionDays("1", 30), { ok: true, value: 1 });
  assert.deepStrictEqual(parseRetentionDays("90", 30), { ok: true, value: 90 });
  assert.deepStrictEqual(parseRetentionDays("3650", 30), { ok: true, value: 3650 });
  assert.deepStrictEqual(parseRetentionDays(45, 30), { ok: true, value: 45 }, "numbers too");
});

test("retention window: the rejected value never reaches a cutoff computation", () => {
  // Belt and braces: prove the shape the caller relies on, so a future refactor
  // cannot return {ok:false, value:<something>} and have the caller use it.
  const r = parseRetentionDays("-1", 30);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.value, undefined, "a rejected window must carry no usable value");
});
