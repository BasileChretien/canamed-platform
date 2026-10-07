/* tests/process-lineage.test.js
 *
 * scripts/ops/process-lineage.js answers one question — "did THIS run start
 * that process?" — and the emulator sweeps kill on its answer. Until
 * 2026-10-07 they killed on a different one ("was it seen on our ports while we
 * ran?"), and a session's live emulator was killed by another session's sweep.
 * tests/emulator-sweep-lineage.test.js reproduces that with real processes;
 * this file pins the reasoning underneath it, where each wrong shortcut can be
 * shown on a table small enough to read.
 *
 * The direction every case here is checked in: "ours" must be EARNED. Anything
 * that cannot be shown — a broken chain, a reused PID, a table that would not
 * load — has to come out as not-killable.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");

const lineage = require("../scripts/ops/process-lineage.js");

/* A process table from rows of [pid, ppid, born]. `born` is a FILETIME-like
   integer unless a test is about something else: bigger = created later. */
const table = (rows) => new Map(rows.map(([pid, ppid, born]) =>
  [String(pid), { pid: String(pid), ppid: String(ppid), born: String(born) }]));

/* The tree the runner really has on Windows:
     100 runner (this process) → 200 cmd.exe (the spawned child, the ROOT)
       → 210 node (firebase CLI, holds :9099) → 220 java (holds :9000)
   and, beside it, another session's run doing the same thing:
     900 its runner → 910 cmd → 920 node → 930 java                            */
const SELF = 100, ROOT = 200;
const TWO_RUNS = [
  [1, 0, 10],
  [SELF, 1, 1000], [ROOT, SELF, 1100], [210, ROOT, 1200], [220, 210, 1300],
  [900, 1, 900], [910, 900, 950], [920, 910, 1150], [930, 920, 1250]
];
const tracker = (rows, opts) => lineage.track(ROOT, Object.assign(
  { selfPid: SELF, snapshot: () => table(typeof rows === "function" ? rows() : rows) }, opts));

/* ── reading the table ─────────────────────────────────────────────── */

test("the Windows and POSIX row formats both parse; anything else is ignored", () => {
  const win = lineage.parseProcessTable(
    "0 0 0\r\n4 0 0\r\n51624 49200 134358439931629220\r\n\r\nnot a row\r\n");
  assert.deepStrictEqual(win.get("51624"),
    { pid: "51624", ppid: "49200", born: "134358439931629220" });
  assert.strictEqual(win.get("4").born, lineage.BORN_UNKNOWN,
    "System has no creation time; that must stay distinguishable from a real one");
  assert.strictEqual(win.size, 3);

  const posix = lineage.parseProcessTable(
    "    1     0 Tue Oct  6 09:00:00 2026\n 4242  4100 Wed Oct  7 12:34:56 2026\n");
  assert.deepStrictEqual(posix.get("4242"),
    { pid: "4242", ppid: "4100", born: "Wed Oct  7 12:34:56 2026" });
});

test("the real table lists this process under its real parent, and finds a real child", async () => {
  /* The one test that reads the machine: everything else reasons over tables
     shaped like this one, so it had better be the shape the OS gives us. */
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"],
    { stdio: "ignore", windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const real = lineage.processTable();
    const me = real.get(String(process.pid));
    assert.ok(me, "this process must be in its own process table");
    assert.strictEqual(me.ppid, String(process.ppid));
    assert.notStrictEqual(me.born, lineage.BORN_UNKNOWN, "and have a creation time");
    assert.ok(lineage.descendsFrom(real, child.pid, process.pid),
      "a process this one just spawned must be found to descend from it");
    assert.ok(!lineage.descendsFrom(real, process.pid, child.pid),
      "and not the other way round");
  } finally {
    child.kill();
  }
});

/* ── descent ───────────────────────────────────────────────────────── */

test("descent is an unbroken chain to the root — child, grandchild, the root itself", () => {
  const t = table(TWO_RUNS);
  assert.ok(lineage.descendsFrom(t, 210, ROOT));
  assert.ok(lineage.descendsFrom(t, 220, ROOT), "java is a GRANDchild on Windows");
  assert.ok(lineage.descendsFrom(t, ROOT, ROOT),
    "on POSIX there is no shell: the spawned child IS the CLI holding :9099");
  assert.ok(!lineage.descendsFrom(t, 930, ROOT), "the other run's java is not ours");
  assert.ok(!lineage.descendsFrom(t, SELF, ROOT), "an ancestor is not a descendant");
  assert.ok(!lineage.descendsFrom(t, 31337, ROOT), "nor is a PID that is not there");
});

test("a chain with a dead link is NOT descent, whatever lies beyond the gap", () => {
  /* 220's parent 210 has exited. Windows keeps the dead PID in ParentProcessId;
     nothing links 220 to the root any more, and guessing across the gap is how
     a stranger gets adopted. */
  const t = table(TWO_RUNS.filter(([pid]) => pid !== 210));
  assert.ok(!lineage.descendsFrom(t, 220, ROOT));
});

test("a 'parent' younger than its child is a reused PID, not a parent", () => {
  /* 930's real parent (PID 920) died; Windows never rewrites ParentProcessId,
     and PID 920 has since been handed to a process in OUR tree. Read naively,
     the other session's java now hangs off our child. */
  const t = table([
    [SELF, 1, 1000], [ROOT, SELF, 1100],
    [920, ROOT, 1400],            // ours, created AFTER 930
    [930, 920, 1250]              // theirs, older than its supposed parent
  ]);
  assert.ok(lineage.descendsFrom(t, 920, ROOT), "fixture: 920 really is ours");
  assert.ok(!lineage.descendsFrom(t, 930, ROOT),
    "930 predates the process that now holds its parent's PID");
});

test("the walk terminates on a self-parented PID", () => {
  // The idle process is its own parent on Windows.
  assert.ok(!lineage.descendsFrom(table([[0, 0, 0], [8, 0, 500]]), 8, ROOT));
});

/* ── observing during the run ──────────────────────────────────────── */

test("SEEING a process on the port does not make it ours — only descent does", () => {
  /* The defect, in one line: both javas were listening on :9000-and-friends,
     both were handed to the tracker, and only one of them is this run's. */
  const t = tracker(TWO_RUNS);
  t.observe([220, 930]);
  assert.strictEqual(t.verdict(220), "ours");
  assert.strictEqual(t.verdict(930), "not-ours");
  assert.strictEqual(t.verdict(210), null, "never examined is not a verdict either way");
});

test("nothing is concluded once the child has gone, or is no longer OUR child", () => {
  const gone = tracker(TWO_RUNS.filter(([pid]) => pid !== ROOT));
  gone.observe([220, 930]);
  assert.strictEqual(gone.verdict(220), null);
  assert.strictEqual(gone.verdict(930), null,
    "with the child dead, 'does not descend from it' proves nothing: our own " +
    "orphan looks exactly the same");

  /* PID 200 exists, but its parent is not this process: the number was reused.
     Whatever hangs off it is somebody else's tree. */
  const reused = tracker(TWO_RUNS.map(([pid, ppid, born]) =>
    pid === ROOT ? [pid, 900, born] : [pid, ppid, born]));
  reused.observe([220]);
  assert.strictEqual(reused.verdict(220), null);
});

test("a table that cannot be read yields no verdict, says why, and is not retried for ever", () => {
  let calls = 0;
  const t = lineage.track(ROOT, {
    selfPid: SELF,
    snapshot: () => { calls++; throw new Error("cannot read the process table (boom)"); }
  });
  for (let i = 0; i < 10; i++) t.observe([220]);
  assert.strictEqual(t.verdict(220), null);
  assert.match(t.problem(), /cannot read the process table \(boom\)/);
  assert.ok(calls >= 1 && calls <= 3,
    "a snapshot is 1.5 s of PowerShell at best; a PID that cannot be resolved " +
    "must not cost one every poll for the length of the suite (took " + calls + ")");
});

test("a snapshot is taken only when there is something new to decide", () => {
  let calls = 0;
  const t = lineage.track(ROOT,
    { selfPid: SELF, snapshot: () => { calls++; return table(TWO_RUNS); } });
  t.observe([]);
  assert.strictEqual(calls, 0, "nothing listening: nothing to look up");
  t.observe([220, 210]);
  t.observe([220, 210]);
  t.observe([210]);
  assert.strictEqual(calls, 1, "a settled verdict is not looked up again");
  t.observe([930]);
  assert.strictEqual(calls, 2);
});

test("a process with no readable creation time is never taken as ours", () => {
  /* The sweep re-identifies a process by its creation time before killing it.
     One that has none could not be told from whatever reuses its PID. */
  const t = tracker(TWO_RUNS.map(([pid, ppid, born]) =>
    pid === 220 ? [pid, ppid, lineage.BORN_UNKNOWN] : [pid, ppid, born]));
  t.observe([220]);
  assert.strictEqual(t.verdict(220), null);
});

/* ── the sweep, after the child has exited ─────────────────────────── */

const row = (port, pid) => ({ port, pid: String(pid), image: "x" });
/* What is left once the run's own tree has collapsed: our java, orphaned. */
const AFTER_EXIT = TWO_RUNS.filter(([pid]) => pid !== ROOT && pid !== 210);

test("the sweep may kill a survivor only if it was shown to be ours AND is still that process", () => {
  let rows = TWO_RUNS;
  const t = tracker(() => rows);
  t.observe([220, 930]);

  rows = AFTER_EXIT;
  const sorted = t.partition([row(9000, 220), row(9099, 930)]);
  assert.deepStrictEqual(sorted.mine, [row(9000, 220)],
    "our orphaned java: unreachable by lineage NOW, which is why it was " +
    "settled while its chain was alive");
  assert.deepStrictEqual(sorted.notMine, [row(9099, 930)]);
  assert.deepStrictEqual(sorted.unproven, []);
});

test("a PID that was ours and now names a different process is NOT killed", () => {
  let rows = TWO_RUNS;
  const t = tracker(() => rows);
  t.observe([220]);
  /* Our java exited; its PID went to something created later, which is now
     listening on the port — another run's emulator, say. */
  rows = AFTER_EXIT.map(([pid, ppid, born]) => pid === 220 ? [220, 920, 5000] : [pid, ppid, born]);
  const sorted = t.partition([row(9000, 220)]);
  assert.deepStrictEqual(sorted.mine, [],
    "same number, different process: the verdict was about the old one");
  assert.deepStrictEqual(sorted.unproven, [row(9000, 220)]);
});

test("a survivor nobody looked at during the run is unproven — reported, never killed", () => {
  const t = tracker(AFTER_EXIT);            // no observe(): the child died first
  const sorted = t.partition([row(9000, 220)]);
  assert.deepStrictEqual(sorted.mine, []);
  assert.deepStrictEqual(sorted.unproven, [row(9000, 220)],
    "it may well be ours. It cannot be SHOWN to be, and that is the rule.");
});

test("if the table cannot be read at the sweep, nothing is ours", () => {
  let fail = false;
  const t = lineage.track(ROOT, { selfPid: SELF, snapshot: () => {
    if (fail) throw new Error("cannot read the process table (gone)");
    return table(TWO_RUNS);
  } });
  t.observe([220]);
  assert.strictEqual(t.verdict(220), "ours");
  fail = true;
  const sorted = t.partition([row(9000, 220)]);
  assert.deepStrictEqual(sorted.mine, [],
    "the verdict is remembered, but the process could not be re-identified");
  assert.deepStrictEqual(sorted.unproven, [row(9000, 220)]);
  assert.match(t.problem(), /gone/);
});

test("a listener that died before the sweep could look is not reported as a survivor", () => {
  let rows = TWO_RUNS;
  const t = tracker(() => rows);
  t.observe([220]);
  rows = AFTER_EXIT.filter(([pid]) => pid !== 220);   // the tree-kill got it after all
  const sorted = t.partition([row(9000, 220)]);
  assert.deepStrictEqual(sorted.gone, [row(9000, 220)]);
  assert.deepStrictEqual([sorted.mine, sorted.notMine, sorted.unproven], [[], [], []]);
});

test("survivors already known not to be ours cost no second snapshot", () => {
  /* The lost race for the ports: the child failed fast and the only thing on
     :9000 is the other run's java. The report must not wait on PowerShell. */
  let calls = 0;
  const t = lineage.track(ROOT,
    { selfPid: SELF, snapshot: () => { calls++; return table(TWO_RUNS); } });
  t.observe([930]);
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(t.partition([row(9000, 930)]).notMine, [row(9000, 930)]);
  assert.strictEqual(calls, 1);
});

/* ── "older than this run" — for the report, never for the kill ────── */

/* FILETIME for a moment `ms` after an arbitrary instant T0. */
const T0_MS = Date.UTC(2026, 9, 7, 12, 0, 0);
const filetime = (ms) => String((BigInt(T0_MS + ms) + 11644473600000n) * 10000n);

test("a process created before the child was spawned is shown NOT to be ours", () => {
  /* The child died before anyone could look (a CLI that fails on "port taken"
     does so within seconds), so descent can no longer be checked. Age still
     can: what existed before our child cannot have been started by it. */
  const rows = [
    [SELF, 1, filetime(-60000)],
    [930, 920, filetime(-30000)],          // their java: half a minute older than our spawn
    [220, 210, filetime(+4000)]            // ours, orphaned, never observed
  ];
  const t = tracker(rows, { spawnedAt: T0_MS, followParents: false });
  const sorted = t.partition([row(9000, 930), row(9099, 220)]);
  assert.deepStrictEqual(sorted.notMine, [row(9000, 930)]);
  assert.deepStrictEqual(sorted.unproven, [row(9099, 220)],
    "younger than the spawn proves nothing, in either direction");
  assert.deepStrictEqual(sorted.mine, [], "and age NEVER makes anything killable");
});

test("where parent links are never rewritten, hanging off an older live process counts too", () => {
  /* The realistic race on Windows: their java was created AFTER our spawn —
     that is what losing the race by a second looks like — but it hangs, by a
     live chain, off their CLI, which is older than our child. Had it been
     ours, that chain would have had to pass through our (dead) child first. */
  const rows = [
    [SELF, 1, filetime(-60000)],
    [920, 910, filetime(-5000)],           // their CLI, alive, older than our spawn
    [930, 920, filetime(+1000)]            // their java, younger than our spawn
  ];
  const windows = tracker(rows, { spawnedAt: T0_MS, followParents: true });
  assert.deepStrictEqual(windows.partition([row(9000, 930)]).notMine, [row(9000, 930)]);

  /* On POSIX the same reading would be WRONG: an orphan of ours is re-parented
     to init, which is older than everything. Only its own age may be used. */
  const posix = tracker(rows, { spawnedAt: T0_MS, followParents: false });
  assert.deepStrictEqual(posix.partition([row(9000, 930)]).unproven, [row(9000, 930)]);
});

test("an orphan younger than the spawn stays unproven even when parents are followed", () => {
  /* Our own leftover, never observed: its parent is dead, so the chain stops
     at once and reaches nothing older. It must not be called another run's. */
  const rows = [[SELF, 1, filetime(-60000)], [220, 210, filetime(+4000)]];
  const t = tracker(rows, { spawnedAt: T0_MS, followParents: true });
  assert.deepStrictEqual(t.partition([row(9000, 220)]).unproven, [row(9000, 220)]);
});

test("POSIX creation times (lstart) are read for age as well", () => {
  const rows = [
    [SELF, 1, "Wed Oct  7 09:00:00 2026"],
    [930, 1, "Wed Oct  7 09:30:00 2026"]
  ];
  const spawnedAt = Date.parse("Wed Oct  7 10:00:00 2026");
  const t = tracker(rows, { spawnedAt, followParents: false });
  assert.deepStrictEqual(t.partition([row(9000, 930)]).notMine, [row(9000, 930)]);
});
