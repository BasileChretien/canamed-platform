/* scripts/ops/process-lineage.js — which processes did THIS run start?
 *
 * WHY THIS EXISTS. The emulator-backed entry points (run-rules-e2e.js,
 * sim/sim-with-emulator.js) free the emulator ports when they finish, because
 * the RTDB emulator is a Java grandchild that outlives its parents on Windows.
 * To decide what they might kill they used to record every PID they SAW
 * listening on those ports while their own child was running, and called that
 * ownership. It is not: the ports are fixed (9000/9099) and shared by every
 * checkout on the machine, so what a run sees there can be another run's
 * emulator. On 2026-10-07 two sessions ran the rules suite at overlapping
 * times; each lost the race for :9000 to the other, "observed" the other's
 * java.exe on it, and killed it in its own sweep — a live emulator, mid-suite,
 * reported as "emulators:exec left 1 listener(s) behind; freed them".
 *
 * Ownership is LINEAGE. A process is this run's when it descends from the
 * child this run spawned, and that is the only thing this module will say
 * "ours" about.
 *
 * THE RULES, each of which is here because the obvious version is wrong:
 *
 *   - Lineage is established WHILE THE CHILD IS ALIVE, never afterwards. The
 *     survivor the sweep is for is, by the time the sweep runs, an orphan: on
 *     Windows its ParentProcessId names a process that no longer exists, and
 *     on POSIX it has been re-parented to init. Walked at sweep time, the
 *     chain is broken for the very process that most needs identifying. So
 *     the callers poll during the run and the verdicts are remembered.
 *   - A link is believed only when the whole chain is alive in ONE snapshot.
 *     Windows never updates ParentProcessId, so it can name a PID that has
 *     since been handed to an unrelated process. A "parent" younger than its
 *     child is therefore not its parent, and the chain stops there — as it
 *     does at any process whose creation time could not be read, since the
 *     check cannot then be made.
 *   - The root must be OUR child in that same snapshot (its parent is this
 *     process). Once the child has gone its PID can be reused too.
 *   - A remembered verdict names a process, not a number: it carries the
 *     creation time, and the sweep re-reads it before killing. A PID that now
 *     belongs to something else is not ours any more.
 *   - Whatever cannot be shown is NOT ours. No table, no chain, an unreadable
 *     creation time, a listener first seen after the child died — all of these
 *     end in "unproven", which the callers report with the command to clear it
 *     by hand and never kill. The failure this trades for is the old one, a
 *     leftover emulator on the port, and the next run's preflight names that.
 *
 * `emulator-ports.js free` (the operator's explicit verb) does not use this:
 * there the operator is the authority.
 */
"use strict";

const { execFileSync } = require("child_process");

const IS_WIN = process.platform === "win32";
const BORN_UNKNOWN = "0";
const SNAPSHOT_TIMEOUT_MS = 30000;
/* Snapshots spent on one PID without an answer before it is left "unproven".
   A snapshot is not cheap on Windows (see below); a PID that keeps eluding it
   must not turn the poll into a busy loop for the length of the suite. */
const MAX_LOOKUPS = 3;

/* One line per process: "<pid> <ppid> <creation time>".
 *
 * Windows: Get-CimInstance, because `wmic` is no longer installed by default
 * (absent on the machine this was written on). The creation time is printed
 * as a FILETIME integer: locale-free, exact, and comparable. A process the
 * provider reports none for prints 0 (BORN_UNKNOWN), and nothing is ever
 * concluded through such a row.
 *
 * MEASURED, because the obvious optimisation is a pessimisation. For ~900
 * processes this takes 1.5 s on an idle machine (0.6 s of it PowerShell
 * starting) and 5–15 s on one at 97% CPU, which is what a machine running
 * several sessions' suites looks like. Asking for just the PIDs of interest
 * and walking up (`-Filter 'ProcessId = n'`, one hop at a time) is SLOWER:
 * each keyed lookup costs about as much as the whole enumeration — 19 s for an
 * 8-hop chain against 5 s for the full table, same machine, same minute. So
 * the whole table is read, the three columns are named so the provider skips
 * CommandLine and the rest, and the callers take as few snapshots as they can:
 * one per new listener, and one at the sweep only when something needs it. */
const WIN_QUERY =
  "Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate " +
  "FROM Win32_Process' | ForEach-Object { $born = 0; " +
  "if ($_.CreationDate) { $born = $_.CreationDate.ToFileTimeUtc() }; " +
  "'{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $born }";
/* POSIX: one -o per column — `-o pid=,ppid=` reads as a column TITLE on BSD
   ps (macOS). lstart identifies a process (sameBirth) and dates it against the
   run (bornMs); it is NOT used to order a child against its parent: POSIX
   re-parents an orphan, so a ppid there never names a dead process and the
   younger-parent check below has nothing to catch. */
const POSIX_PS = ["-A", "-o", "pid=", "-o", "ppid=", "-o", "lstart="];

/* Map of pid → { pid, ppid, born }, all strings. */
function parseProcessTable(text) {
  const table = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (m) table.set(m[1], { pid: m[1], ppid: m[2], born: m[3] });
  }
  return table;
}

/* A snapshot of every process on the machine. THROWS when it cannot be had —
   the callers turn that into "unproven", and must never read it as "nothing
   descends from us" or "everything does". */
function processTable() {
  let out;
  try {
    out = IS_WIN
      ? execFileSync("powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", WIN_QUERY],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true, timeout: SNAPSHOT_TIMEOUT_MS })
      : execFileSync("ps", POSIX_PS,
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
            timeout: SNAPSHOT_TIMEOUT_MS,
            env: Object.assign({}, process.env, { LC_ALL: "C" }) });
  } catch (e) {
    const tool = IS_WIN ? "powershell.exe" : "ps";
    const why = (e && e.code === "ENOENT")
      ? tool + " is not on PATH"
      : String((e && e.message) || e).split("\n")[0];
    throw new Error("cannot read the process table (" + why + ")");
  }
  const table = parseProcessTable(out);
  /* A table that does not list the process reading it is not a table. Without
     this an empty or garbled answer would make every listener "not ours". */
  if (!table.has(String(process.pid))) {
    throw new Error("cannot read the process table (it does not list this " +
      "process — the output was not what was asked for)");
  }
  return table;
}

/* True when `a` was created strictly before `b` — and false whenever that
   cannot be said (an unknown or non-numeric creation time). */
function olderThan(a, b) {
  const numeric = /^[1-9]\d*$/;
  return numeric.test(a.born) && numeric.test(b.born) &&
    BigInt(a.born) < BigInt(b.born);
}

/* Is `parent` really the process that spawned `cur`?
 *
 * No parent: the chain is broken. A parent younger than its child: the PID was
 * reused, and that process never spawned this one. A creation time that could
 * not be read, at either end: the age check cannot be made, so the link proves
 * nothing — and "cannot be shown" never rounds up to "ours". */
function believableLink(cur, parent) {
  return !!parent && cur.born !== BORN_UNKNOWN && parent.born !== BORN_UNKNOWN &&
    !olderThan(cur, parent);
}

/* Where does the chain of parents from `pid` lead, in this one `table`?
 *
 *   "yes"      to `rootPid`, unbroken — or `pid` is the root itself;
 *   "no"       somewhere else: it stops at a dead parent, or at a PID that has
 *              been reused (a "parent" younger than its child);
 *   "unknown"  it stops at a creation time that could not be read, where the
 *              reused-PID check cannot be made. NOT an answer in either
 *              direction — "cannot be shown to be ours" is a different thing
 *              from "shown not to be", and the sim refuses to run on the
 *              second.
 */
function descent(table, pid, rootPid) {
  const root = String(rootPid);
  const seen = new Set();
  let cur = table.get(String(pid));
  while (cur && !seen.has(cur.pid)) {          // PID 0 is its own parent on Windows
    if (cur.pid === root) return "yes";
    seen.add(cur.pid);
    const parent = table.get(cur.ppid);
    if (!parent) return "no";
    if (cur.born === BORN_UNKNOWN || parent.born === BORN_UNKNOWN) return "unknown";
    if (olderThan(cur, parent)) return "no";
    cur = parent;
  }
  return "no";
}

/* Does `pid` descend from `rootPid` (or is it the root), by an unbroken chain
   of processes all present in `table`? Only a shown "yes" is one. */
function descendsFrom(table, pid, rootPid) {
  return descent(table, pid, rootPid) === "yes";
}

/* Are two creation times, read at different moments, the same process's?
 *
 * A FILETIME is exact: one tick apart is another process. lstart is not —
 * procps before 4.0 (Ubuntu 22.04, RHEL 8/9) derives it from "now minus
 * uptime" on every call, so one process can read a second later the next time
 * `ps` runs. Compared as text, our own leftover would then look like a
 * stranger and be left on the port. A PID is not reused within a second on any
 * POSIX system, so a second of tolerance costs nothing there. */
const LSTART_JITTER_MS = 1000;
function sameBirth(a, b) {
  if (a === BORN_UNKNOWN || b === BORN_UNKNOWN) return false;
  if (a === b) return true;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  const ta = Date.parse(a), tb = Date.parse(b);
  return !Number.isNaN(ta) && !Number.isNaN(tb) && Math.abs(ta - tb) <= LSTART_JITTER_MS;
}

/* Creation time as ms since the Unix epoch, or null. A FILETIME counts 100 ns
   ticks from 1601; lstart ("Wed Oct  7 12:34:56 2026", C locale) is local time
   to the second. BORN_UNKNOWN is null, explicitly: Date.parse("0") is the year
   2000, which would make a process nothing is known about "older than the
   run". */
const FILETIME_TO_UNIX_MS = 11644473600000n;
function bornMs(proc) {
  if (proc.born === BORN_UNKNOWN) return null;
  if (/^[1-9]\d*$/.test(proc.born)) {
    return Number(BigInt(proc.born) / 10000n - FILETIME_TO_UNIX_MS);
  }
  const t = Date.parse(proc.born);
  return Number.isNaN(t) ? null : t;
}

/* A process is "older than the run" only by a margin its clock cannot produce
 * by itself. Two clocks are compared — ours, read before the spawn, and the
 * kernel's, stamped on the process — so there is always some.
 *
 *   lstart (POSIX)     whole seconds, and it can jitter by one: 2 s.
 *   FILETIME (Windows) exact, but stamped at the kernel's tick (up to ~16 ms
 *                      behind) while Date.now() is interpolated: 250 ms.
 *
 * The POSIX margin was first applied to both. On Windows that made a real
 * other-run listener "unproven" whenever the process it hangs off was less
 * than 2 s older than our child — which is the tight race, i.e. the incident
 * this module exists for. It surfaced as an intermittent failure of the
 * real-process test under a loaded suite, not as anything killed. */
const BORN_SLACK_LSTART_MS = 2000;
const BORN_SLACK_EXACT_MS = 250;
const bornSlackMs = (proc) =>
  /^[1-9]\d*$/.test(proc.born) ? BORN_SLACK_EXACT_MS : BORN_SLACK_LSTART_MS;

/* Can `pid` be shown NOT to come from a child spawned at `spawnedAtMs`?
 *
 * This is for the sweep, when the child is gone and descendsFrom() can no
 * longer answer. It never makes anything kill-eligible — it only lets the
 * report say "another run's" instead of "could not be shown".
 *
 * A process created before the child was spawned cannot descend from it. And
 * where parent links are never rewritten (Windows: opts.followParents), the
 * same holds for anything hanging, by an unbroken live chain, off such a
 * process: had it descended from our child, the chain would have had to pass
 * THROUGH the child before reaching anything older — and the child is dead, so
 * the chain would have stopped there. On POSIX an orphan is re-parented to
 * init, which is older than everything, so only the process itself is judged.
 *
 * "The child is dead" is an assumption about the caller, so it is not relied
 * on: a walk that REACHES the child (opts.root) stops there and answers no.
 * Otherwise it would carry on to the runner — which is older than its own
 * child — and our own unobserved listener would be reported as another run's. */
function predatesSpawn(table, pid, spawnedAtMs, opts) {
  const followParents = opts && "followParents" in opts ? opts.followParents : IS_WIN;
  const root = opts && opts.root !== undefined ? String(opts.root) : null;
  const seen = new Set();
  let cur = table.get(String(pid));
  while (cur && !seen.has(cur.pid)) {
    if (cur.pid === root) return false;
    const t = bornMs(cur);
    if (t !== null && t < spawnedAtMs - bornSlackMs(cur)) return true;
    if (!followParents) return false;
    seen.add(cur.pid);
    const parent = table.get(cur.ppid);
    if (!believableLink(cur, parent)) return false;
    cur = parent;
  }
  return false;
}

/* Follow one spawned child for the length of a run.
 *
 *   observe(pids)    — call while the child is alive, with the PIDs currently
 *                      listening on the run's ports. Takes a snapshot only
 *                      when one of them has no verdict yet.
 *   verdict(pid)     — "ours" | "not-ours" | null. null is NO verdict: never
 *                      examined, or examined and nothing could be shown. Only
 *                      observe() says "ours"; "not-ours" can also come from
 *                      the sweep's age rule (partition).
 *   partition(rows)  — call from the sweep, AFTER the child has exited, with
 *                      the surviving [{ port, pid, … }] rows:
 *                        mine      shown to descend from the child, and still
 *                                  the same process — the only kill-eligible set
 *                        notMine   shown NOT to: examined during the run and
 *                                  found outside the child's tree, or older
 *                                  than the child (predatesSpawn)
 *                        unproven  alive, and nothing can be shown either way
 *                        gone      no longer running by the time we looked
 *                        why       the reasons, if any are known, that the
 *                                  unproven ones could not be looked up
 *
 * opts.spawnedAt — Date.now() taken just BEFORE the child was spawned.
 * opts.snapshot / selfPid / followParents exist for the tests.
 */
function track(rootPid, opts) {
  const root = String(rootPid);
  const self = String((opts && opts.selfPid) || process.pid);
  const snapshot = (opts && opts.snapshot) || processTable;
  const spawnedAt = opts && typeof opts.spawnedAt === "number" ? opts.spawnedAt : null;
  const walk = { root };
  if (opts && "followParents" in opts) walk.followParents = opts.followParents;
  const ours = new Map();        // pid → born
  const notOurs = new Map();     // pid → born
  const lookups = new Map();     // pid → snapshots that gave no answer
  const failures = new Map();    // pid → why its last lookup could not be made
  let lastProblem = null;

  function read() {
    try {
      const table = snapshot();
      lastProblem = null;
      return table;
    } catch (e) {
      lastProblem = String((e && e.message) || e);
      return null;
    }
  }
  const miss = (pid) => lookups.set(pid, (lookups.get(pid) || 0) + 1);

  function observe(pids) {
    const pending = [...new Set([...pids].map(String))].filter((pid) =>
      !ours.has(pid) && !notOurs.has(pid) && (lookups.get(pid) || 0) < MAX_LOOKUPS);
    if (!pending.length) return;
    const table = read();
    if (!table) {
      for (const pid of pending) { miss(pid); failures.set(pid, lastProblem); }
      return;
    }
    const child = table.get(root);
    /* The child has gone (or its PID is someone else's now). Nothing can be
       shown from here on, in either direction — and the lookup still counts,
       or a caller polling twice a second would buy a snapshot each time. */
    if (!child || child.ppid !== self) { pending.forEach(miss); return; }
    for (const pid of pending) {
      const proc = table.get(pid);
      if (!proc || proc.born === BORN_UNKNOWN) { miss(pid); continue; }
      const led = descent(table, pid, root);
      if (led === "unknown") { miss(pid); continue; }
      (led === "yes" ? ours : notOurs).set(pid, proc.born);
      failures.delete(pid);
    }
  }

  function verdict(pid) {
    if (ours.has(String(pid))) return "ours";
    if (notOurs.has(String(pid))) return "not-ours";
    return null;
  }

  function partition(rows) {
    const out = { mine: [], notMine: [], unproven: [], gone: [], why: [] };
    /* A survivor already known not to be ours needs no second look — and in
       the lost race for the ports that is every survivor, so the report is
       not held up by another snapshot. */
    const table = rows.some((r) => !notOurs.has(String(r.pid))) ? read() : null;
    const why = new Set();
    for (const row of rows) {
      const pid = String(row.pid);
      const proc = table && table.get(pid);
      if (notOurs.has(pid)) out.notMine.push(row);
      /* Listed a moment ago and absent from a table that was read: it died in
         between (a tree-kill still landing). Not a survivor, so not a report. */
      else if (table && !proc) out.gone.push(row);
      else if (proc && ours.has(pid) && sameBirth(ours.get(pid), proc.born)) out.mine.push(row);
      else if (proc && spawnedAt !== null && predatesSpawn(table, pid, spawnedAt, walk)) {
        out.notMine.push(row);
        notOurs.set(pid, proc.born);   // settled: a later sweep need not look again
      } else {
        out.unproven.push(row);
        /* The table just read fine, so "it could not be read" is not this
           read's news — but it may be why the lookups DURING the run all
           failed, and that is the reason this listener has no verdict. */
        if (!table) why.add(lastProblem);
        else if (failures.has(pid)) why.add(failures.get(pid));
      }
    }
    out.why = [...why];
    return out;
  }

  return { observe, verdict, partition };
}

module.exports = {
  parseProcessTable, processTable, descendsFrom, predatesSpawn, track, BORN_UNKNOWN
};
