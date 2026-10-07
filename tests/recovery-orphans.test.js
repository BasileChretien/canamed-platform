"use strict";
/* tests/recovery-orphans.test.js
 *
 * The one-off sweep for recovery records whose session is gone
 * (scripts/sweep-orphaned-recovery.js, scripts/lib/recovery-orphans.js).
 *
 * The purge deletes a recovery record WITH its session since 2026-10-08; the
 * records it left before that have no session to be found through, so the sweep
 * starts from the records instead. That direction is what makes it dangerous:
 * anything that makes a LIVE session look absent turns its record into an
 * "orphan", and deleting that one is silent and permanent — the facilitator can
 * no longer reset a forgotten password. So most of this file is about what the
 * sweep must NOT delete:
 *
 *   - a record whose session exists, in either tree;
 *   - a record whose code is live in the OTHER tree only (same code, two trees);
 *   - anything at all when the session list is empty, unless told to;
 *   - anything at all when a list cannot be read as a list;
 *   - a session created while the sweep is reading (the order of the reads).
 *
 * Three levels, as in tests/cleanup-passes.test.js: the pure plan, the reads
 * against an injected reader, then THE REAL SCRIPT in a child process against
 * an in-memory database, asserting on the complete list of writes it attempted.
 * Every refusal is paired with a run that is allowed on the same database.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  BATCH_SIZE, readRecoveryKeys, planRecoverySweep, findOrphanedRecovery,
  deleteRecoveryRecords, batches
} = require("../scripts/lib/recovery-orphans");
const { sessionLocationsFromKeys } = require("../scripts/lib/session-trees");

const ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "sweep-orphaned-recovery.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-firebase-admin-preload.js");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "sweep-orphaned-recovery.yml");

/* ── the plan ────────────────────────────────────────────────────────── */

test("a record with no session is an orphan; a record with one is kept — both trees", () => {
  const live = sessionLocationsFromKeys(["liv-aaa"], { partner: ["liv-bbb"] });
  const plan = planRecoverySweep(
    { codes: ["liv-aaa", "old-aaa"], orgCodes: { partner: ["liv-bbb", "old-bbb"], gone: ["old-ccc"] } },
    live
  );
  assert.deepStrictEqual(plan.orphans.sort(), [
    "recovery/orgs/gone/sessions/old-ccc",
    "recovery/orgs/partner/sessions/old-bbb",
    "recovery/sessions/old-aaa"
  ]);
  assert.strictEqual(plan.records, 5);
  assert.strictEqual(plan.kept, 2);
  assert.strictEqual(plan.orphansDefault, 1);
  assert.strictEqual(plan.orphansOrg, 2);
});

test("the same code in two trees is two records — being live in one does not keep the other", () => {
  /* And the reverse, which is the dangerous direction: a code that is live in
     the ORG tree must not be judged by the default tree's list. */
  const liveInDefault = planRecoverySweep(
    { codes: ["abc-234"], orgCodes: { partner: ["abc-234"] } },
    sessionLocationsFromKeys(["abc-234"], {})
  );
  assert.deepStrictEqual(liveInDefault.orphans, ["recovery/orgs/partner/sessions/abc-234"]);

  const liveInOrg = planRecoverySweep(
    { codes: ["abc-234"], orgCodes: { partner: ["abc-234"] } },
    sessionLocationsFromKeys([], { partner: ["abc-234"] })
  );
  assert.deepStrictEqual(liveInOrg.orphans, ["recovery/sessions/abc-234"]);
});

test("nothing recorded, nothing to sweep", () => {
  const plan = planRecoverySweep({ codes: [], orgCodes: {} }, sessionLocationsFromKeys(["a"], {}));
  assert.deepStrictEqual(plan, { records: 0, kept: 0, orphans: [], orphansDefault: 0, orphansOrg: 0 });
});

test("batches() covers every path once, in order", () => {
  const list = Array.from({ length: 11 }, (_, i) => "p" + i);
  const parts = batches(list, 4);
  assert.deepStrictEqual(parts.map((p) => p.length), [4, 4, 3]);
  assert.deepStrictEqual(parts.flat(), list);
  assert.deepStrictEqual(batches([], 4), []);
});

test("a batch that fails is counted and skipped — the batches after it still run", async () => {
  /* Each batch is its own all-or-nothing update, so one refusal must not strand
     the rest; and the caller is handed the ERROR, not a message built here,
     because only the caller knows what its log may show. */
  const paths = Array.from({ length: 7 }, (_, i) => "recovery/sessions/p" + i);
  const updates = [], errors = [];
  const db = {
    ref(p) {
      assert.strictEqual(p, undefined, "deletes go through ONE root-level update per batch");
      return {
        async update(obj) {
          updates.push(Object.keys(obj));
          assert.ok(Object.values(obj).every((v) => v === null), "a sweep only ever writes null");
          if (updates.length === 2) throw Object.assign(new Error("boom at recovery/sessions/p3"), { code: "PERMISSION_DENIED" });
        }
      };
    }
  };
  const r = await deleteRecoveryRecords(db, paths, {
    batchSize: 3, onError: (e, size) => errors.push([e.code, size])
  });
  assert.deepStrictEqual(updates.map((u) => u.length), [3, 3, 1]);
  assert.deepStrictEqual(r, { deleted: 4, failedBatches: 1 });
  assert.deepStrictEqual(errors, [["PERMISSION_DENIED", 3]]);
});

/* ── the reads ───────────────────────────────────────────────────────── */

/* A reader over a plain tree that answers the way `?shallow=true` does — keys
   mapped to true, never a value — and records what it was asked for. */
function shallowReader(tree, asked) {
  return async (p) => {
    asked.push(p);
    const node = p.split("/").reduce(
      (n, k) => (n && typeof n === "object" && k in n ? n[k] : null), tree);
    return node && typeof node === "object"
      ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : null;
  };
}

const TREE = {
  sessions: { "liv-aaa": { created: { at: 1 } } },
  orgs: { partner: { sessions: { "liv-bbb": { created: { at: 2 } } } } },
  recovery: {
    sessions: { "liv-aaa": { code: "SECRET-LIVE-A" }, "old-aaa": { code: "SECRET-OLD-A" } },
    orgs: { partner: { sessions: { "liv-bbb": { code: "SECRET-LIVE-B" }, "old-bbb": { code: "SECRET-OLD-B" } } } }
  }
};

test("the recovery keys are read in both trees, and no path that holds a code is ever requested", async () => {
  const asked = [];
  const keys = await readRecoveryKeys(shallowReader(TREE, asked));
  assert.deepStrictEqual(keys, {
    codes: ["liv-aaa", "old-aaa"],
    orgCodes: { partner: ["liv-bbb", "old-bbb"] }
  });
  assert.deepStrictEqual(asked,
    ["recovery/sessions", "recovery/orgs", "recovery/orgs/partner/sessions"],
    "three LISTS. A read of recovery/sessions/<code> would return the secret itself.");
});

test("ORDER: every recovery list is read before any session list", async () => {
  /* The safety of the whole sweep. A session created between the two reads is
     unknown to whichever list is older: read sessions first and its record is
     in the (newer) recovery list with no session beside it — an "orphan" that
     is one second old and very much alive. */
  const asked = [];
  const found = await findOrphanedRecovery(shallowReader(TREE, asked));
  const firstSessionRead = asked.findIndex((p) => !p.startsWith("recovery/"));
  const lastRecoveryRead = asked.map((p) => p.startsWith("recovery/")).lastIndexOf(true);
  assert.ok(firstSessionRead > 0, "the session trees were never read: " + asked.join(", "));
  assert.ok(lastRecoveryRead < firstSessionRead,
    "a session list was read before the recovery lists were complete: " + asked.join(", "));

  assert.deepStrictEqual(found.orphans.sort(),
    ["recovery/orgs/partner/sessions/old-bbb", "recovery/sessions/old-aaa"]);
  assert.strictEqual(found.liveSessions, 2);
});

test("ORDER, demonstrated: a session created mid-sweep survives recovery-first and would not survive sessions-first", async () => {
  /* The database CHANGES between the two phases: a session is created at the
     moment the reads switch from one kind of list to the other — WHICHEVER
     kind came first, so this does not assume the order it is testing. */
  const before = { sessions: {}, orgs: {}, recovery: { sessions: {}, orgs: {} } };
  before.sessions["liv-aaa"] = { created: { at: 1 } };
  before.recovery.sessions["liv-aaa"] = { code: "x" };
  const create = (tree) => {
    tree.sessions["new-zzz"] = { created: { at: 9 } };
    tree.recovery.sessions["new-zzz"] = { code: "y" };
  };
  const clone = () => JSON.parse(JSON.stringify(before));

  // The function as shipped.
  const t1 = clone();
  let firstKind = null, created = false;
  const real = shallowReader(t1, []);
  const found = await findOrphanedRecovery(async (p) => {
    const kind = p.startsWith("recovery/") ? "recovery" : "sessions";
    if (firstKind === null) firstKind = kind;
    if (kind !== firstKind && !created) { created = true; create(t1); }
    return real(p);
  });
  assert.strictEqual(created, true, "the reads never changed kind, so nothing was created mid-sweep");
  assert.deepStrictEqual(found.orphans, [],
    "a session created between the two phases had its record judged an orphan");

  // The other order, by hand: sessions listed, THEN the session appears, THEN recovery listed.
  const t2 = clone();
  const live = sessionLocationsFromKeys(Object.keys(t2.sessions), {});
  create(t2);
  const wrong = planRecoverySweep(await readRecoveryKeys(shallowReader(t2, [])), live);
  assert.deepStrictEqual(wrong.orphans, ["recovery/sessions/new-zzz"],
    "control: sessions-first DOES condemn the new session's record — if this stops " +
    "being true the ordering test above is no longer testing anything");
});

test("a list that is not a list stops the sweep — it is never read as 'no sessions'", async () => {
  /* shallowKeysOf() throws on anything that is not an object of keys or null.
     Here that matters in the DANGEROUS direction: sessions read as empty makes
     every record an orphan. */
  for (const bad of ["sessions", "orgs", "recovery/sessions", "recovery/orgs"]) {
    const real = shallowReader(TREE, []);
    await assert.rejects(
      findOrphanedRecovery(async (p) => (p === bad ? "Permission denied" : real(p))),
      /Refusing to treat this as an empty tree/,
      "a string body for '" + bad + "' must throw");
  }
});

/* ── THE REAL SCRIPT, in a child process ─────────────────────────────── */

const HANG_TIMEOUT_MS = 20000;

function runSweep(tree, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-sweep-"));
  const outFile = path.join(dir, "writes.json");
  const env = Object.assign({}, process.env);
  // Hermetic: nothing in the developer's shell may arm a delete.
  for (const k of Object.keys(env)) if (/^(RECOVERY_SWEEP_|FAKE_DB_)/.test(k)) delete env[k];
  try {
    const r = spawnSync(process.execPath, ["-r", PRELOAD, SCRIPT_PATH], {
      encoding: "utf8",
      timeout: HANG_TIMEOUT_MS,
      env: Object.assign(env, {
        FAKE_DB_TREE: JSON.stringify(tree),
        FAKE_DB_WRITES_OUT: outFile,
        FIREBASE_DATABASE_URL: "https://fake-db.invalid"
      }, extraEnv)
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

const ORPHANS = ["recovery/orgs/partner/sessions/old-bbb", "recovery/sessions/old-aaa"];
const CODES = ["liv-aaa", "old-aaa", "liv-bbb", "old-bbb"];
const SECRETS = ["SECRET-LIVE-A", "SECRET-OLD-A", "SECRET-LIVE-B", "SECRET-OLD-B"];

function assertNothingSensitive(r) {
  const out = r.stdout + r.stderr;
  for (const s of CODES.concat(SECRETS)) {
    assert.ok(!out.includes(s),
      "'" + s + "' reached the output. The sweep prints counts only: these logs are " +
      "world-readable." + r.log);
  }
}

test("REAL SCRIPT, default mode: a DRY RUN — it reports the two orphans and writes nothing", () => {
  const r = runSweep(TREE, {});
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, [], "a dry run must not write." + r.log);
  assert.match(r.stdout, /Mode:\s+DRY-RUN/);
  assert.match(r.stdout, /Recovery records:\s+4/);
  assert.match(r.stdout, /with a session \(kept\):\s+2/);
  assert.match(r.stdout, /with no session:\s+2 \(1 default, 1 org-scoped\)/);
  assert.match(r.stdout, /Summary: 2 would be deleted\. Set RECOVERY_SWEEP_CONFIRM=1/);
  assertNothingSensitive(r);
});

test("REAL SCRIPT, confirmed: ONE root update deleting exactly the orphans — the control for the dry run", () => {
  /* Same database. Without this the dry-run test could not tell "it held back"
     from "this harness never reaches the delete". */
  const r = runSweep(TREE, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, [{ op: "update", path: "", keys: ORPHANS }],
    "exactly the two records with no session. The two live sessions' records, and " +
    "everything outside recovery/, are untouched." + r.log);
  assert.match(r.stdout, /Summary: 2 deleted, 0 left\./);
  assertNothingSensitive(r);
});

test("REAL SCRIPT: anything but \"1\" is a dry run", () => {
  for (const v of ["true", "yes", "0", " 1", ""]) {
    const r = runSweep(TREE, { RECOVERY_SWEEP_CONFIRM: v });
    assert.deepStrictEqual(r.writes, [], "RECOVERY_SWEEP_CONFIRM=" + JSON.stringify(v) + " deleted." + r.log);
  }
});

test("REAL SCRIPT: nothing orphaned — no write, exit 0", () => {
  const tidy = JSON.parse(JSON.stringify(TREE));
  delete tidy.recovery.sessions["old-aaa"];
  delete tidy.recovery.orgs.partner.sessions["old-bbb"];
  const r = runSweep(tidy, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, []);
  assert.match(r.stdout, /Summary: nothing to sweep\./);
});

test("REAL SCRIPT: NO session listed at all — refused, exit 2, nothing deleted, even when confirmed", () => {
  /* The state in which every record looks orphaned. It is also what a wrong
     database URL, or a tree that moved, looks like. */
  const empty = { recovery: TREE.recovery };
  const r = runSweep(empty, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 2, r.log);
  assert.deepStrictEqual(r.writes, [], "a refused run must not write." + r.log);
  assert.match(r.stderr, /REFUSED: the database lists no session at all/);
  assertNothingSensitive(r);

  // …and the same database, with the operator saying so: all four go.
  const allowed = runSweep(empty, {
    RECOVERY_SWEEP_CONFIRM: "1", RECOVERY_SWEEP_ALLOW_NO_SESSIONS: "1"
  });
  assert.strictEqual(allowed.status, 0, allowed.log);
  assert.strictEqual(allowed.writes.length, 1);
  assert.strictEqual(allowed.writes[0].keys.length, 4);
});

test("REAL SCRIPT: cannot start — exit 2, nothing written, and it still ends by itself", () => {
  /* The REST reader refuses a non-https URL before making a request, which
     reaches main().catch() exactly as an auth failure or an unreadable list
     does (the list case is driven directly, above). */
  const r = runSweep(TREE, {
    RECOVERY_SWEEP_CONFIRM: "1", FIREBASE_DATABASE_URL: "http://plain.invalid"
  });
  assert.strictEqual(r.status, 2, r.log);
  assert.deepStrictEqual(r.writes, []);
  assert.match(r.stderr, /^FATAL: /m);
  assertNothingSensitive(r);
});

test("REAL SCRIPT: more orphans than one batch — several updates, every path once", () => {
  const n = BATCH_SIZE + 7;
  const big = { sessions: { "liv-aaa": { created: { at: 1 } } }, recovery: { sessions: { "liv-aaa": { code: "k" } } } };
  for (let i = 0; i < n; i++) big.recovery.sessions["old-" + i] = { code: "c" + i };
  const r = runSweep(big, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes.map((w) => w.keys.length), [BATCH_SIZE, 7]);
  const all = r.writes.flatMap((w) => w.keys);
  assert.strictEqual(new Set(all).size, n, "a path was deleted twice or missed");
  assert.ok(!all.includes("recovery/sessions/liv-aaa"), "the live record was swept");
  assert.match(r.stdout, new RegExp("Summary: " + n + " deleted, 0 left\\."));
});

/* ── the workflow ────────────────────────────────────────────────────── */

const yml = fs.readFileSync(WORKFLOW, "utf8").split("\r\n").join("\n");
/* Comments describe what the job must NOT do, in the words it must not use. */
const ymlCode = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("workflow: dispatch only — a one-off never grows a schedule unnoticed", () => {
  assert.match(ymlCode, /^\s*workflow_dispatch:/m);
  assert.ok(!/^\s*schedule:/m.test(ymlCode) && !/^\s*-\s*cron:/m.test(ymlCode),
    "the sweep has a cron. A scheduled job that lists session codes on a runner is " +
    "a nightly transfer, and the notice describes the scheduled jobs by name " +
    "(tests/ops-transfer-notice.test.js) — that is a decision, not a tidy-up.");
  assert.ok(!/^\s*(push|pull_request):/m.test(ymlCode), "it must not run on a push");
});

test("workflow: deleting takes a ticked box, and the box starts empty", () => {
  const confirm = ymlCode.slice(ymlCode.indexOf("confirm:"));
  assert.match(confirm.slice(0, 200), /type: boolean[\s\S]*default: false/);
  assert.match(ymlCode,
    /RECOVERY_SWEEP_CONFIRM: \$\{\{ github\.event\.inputs\.confirm == 'true' && '1' \|\| '0' \}\}/,
    "the flag must come from the box and nowhere else — a literal \"1\" here deletes on every dispatch");
  assert.match(ymlCode,
    /RECOVERY_SWEEP_ALLOW_NO_SESSIONS: \$\{\{ github\.event\.inputs\.allow_no_sessions == 'true' && '1' \|\| '0' \}\}/);
  assert.match(ymlCode, /run: node scripts\/sweep-orphaned-recovery\.js/);
});

test("workflow: installs from the lockfile and asks for nothing but read access", () => {
  assert.match(ymlCode, /^\s*run:\s*npm ci(\s|$)/m,
    "a floating install is how four retention jobs failed for five nights (2026-07-31)");
  assert.match(ymlCode, /permissions:\s*\n\s*contents: read/);
  assert.match(ymlCode, /cancel-in-progress: false/, "never kill a run mid-delete");
});
