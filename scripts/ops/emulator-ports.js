#!/usr/bin/env node
/* scripts/ops/emulator-ports.js — who is holding the emulator ports, and free them
 *
 * WHY THIS EXISTS. Neither emulator-backed entry point reliably released its
 * ports on exit (observed 2026-08-05: three consecutive runs each left a
 * `java.exe` listening on :9000 and a firebase CLI on :9099 after exiting 0):
 *
 *   - `npm run test:e2e:rules` shells out to `firebase emulators:exec`, which
 *     signals its child on completion. On Windows the RTDB emulator is a Java
 *     GRANDCHILD reached through npx → node → java, and it survives the signal.
 *   - `scripts/sim/sim-with-emulator.js` does taskkill /F /T on the process it
 *     spawned, which is better, but still only reaches the tree it owns.
 *
 * The leftovers are not harmless. A stale listener on :9000/:9099 makes the
 * NEXT run's readiness probe succeed instantly against the WRONG emulator —
 * one carrying whatever rules the previous run built — so the suite either
 * falls back to LocalDB (validating nothing, see scripts/sim/report-mode.js)
 * or hangs and times out in a way that reads as an environment fault rather
 * than a stale process. Both failure modes have cost real debugging time here.
 *
 * DELIBERATELY TWO VERBS, not one. `check` never kills anything; `free` does,
 * and only when asked. Auto-killing on every run would silently take out a
 * facilitator's intentional `npm run emulator` session, so a run that finds a
 * squatter reports it — with the PID, the image name and the exact command to
 * clear it — and stops.
 *
 * Usage:
 *   node scripts/ops/emulator-ports.js check          # exit 1 if any is held
 *   node scripts/ops/emulator-ports.js free           # kill the listeners
 *   node scripts/ops/emulator-ports.js check 9000 8765
 *
 * Ports default to the RTDB + Auth emulators (9000, 9099). Override with
 * SIM_DB_PORT / SIM_AUTH_PORT, or pass them as arguments.
 */
"use strict";

const { execFileSync } = require("child_process");

const IS_WIN = process.platform === "win32";

/* PIDs LISTENING on `port`. Established/TIME_WAIT connections are ignored on
   purpose — only a listener actually blocks a rebind, and killing the owner of
   an outbound connection that happens to use the number would be wrong.
 *
 * FAILS CLOSED. An earlier draft caught every error and returned [], which
 * meant "netstat/lsof is missing" was indistinguishable from "the port is
 * free" — so on a machine without the tool the preflight would wave a stale
 * emulator straight through, which is the exact failure this module exists to
 * prevent. The ONLY silent-empty case is lsof's documented exit 1 for "no
 * process matched"; everything else throws. */
function listeningPids(port) {
  const p = String(parseInt(port, 10));
  try {
    if (IS_WIN) {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
        if (m && m[2] === p && m[3] !== "0") pids.add(m[3]);
      }
      return [...pids];
    }
    const out = execFileSync("lsof", ["-nP", "-iTCP:" + p, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\s+/).filter(Boolean);
  } catch (e) {
    /* lsof exits 1 with no output when nothing is listening. That is a real
       "no listeners" answer, not a failure. */
    if (!IS_WIN && e && e.status === 1) return [];
    const tool = IS_WIN ? "netstat" : "lsof";
    const why = (e && e.code === "ENOENT")
      ? tool + " is not on PATH"
      : String((e && e.message) || e);
    throw new Error(
      "cannot determine who is listening on :" + p + " (" + why + "). " +
      "Refusing to report the port as free — a stale emulator would then be " +
      "waved through and the run would validate the wrong rules.");
  }
}

/* Best-effort image name for a PID, so the report says WHAT is squatting
   ("java.exe") rather than only a number. Never throws. */
function imageName(pid) {
  try {
    if (IS_WIN) {
      const out = execFileSync("tasklist", ["/FI", "PID eq " + pid, "/NH", "/FO", "CSV"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = /^"([^"]+)"/.exec(out.trim());
      return m ? m[1] : "?";
    }
    const out = execFileSync("ps", ["-p", String(pid), "-o", "comm="],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || "?";
  } catch (e) {
    return "?";
  }
}

/* [{ port, pid, image }] for every listener across `ports`. */
function survey(ports) {
  const rows = [];
  for (const port of ports) {
    for (const pid of listeningPids(port)) {
      rows.push({ port: parseInt(port, 10), pid, image: imageName(pid) });
    }
  }
  return rows;
}

/* Terminate the listeners on `ports`. Returns the rows it acted on.
 *
 * On Windows this is a process-TREE kill (`taskkill /F /T`): the RTDB emulator
 * is a Java grandchild of the firebase CLI, which is why signalling the parent
 * is what leaves the orphan in the first place. On POSIX it is a SIGKILL to the
 * LISTENER PID ONLY — not its tree. That asymmetry is deliberate rather than an
 * oversight: killing a process group here would reach siblings we never
 * identified, and the listener is the thing holding the port.
 *
 * opts.onlyPids — restrict to a set of PIDs whose ownership the caller has
 * established. AUTOMATIC callers must pass it (see run-rules-e2e.js): a
 * preflight proves the port state at one instant, and between then and the
 * sweep an unrelated process could bind the port, so an unrestricted sweep
 * would kill a stranger by port number alone. The explicit `emulator:free`
 * verb passes nothing — there the operator is the authority. */
function free(ports, opts) {
  const onlyPids = opts && opts.onlyPids
    ? new Set([...opts.onlyPids].map(String))
    : null;
  let rows = survey(ports);
  if (onlyPids) {
    for (const row of rows) {
      if (!onlyPids.has(String(row.pid))) row.skipped = "ownership not established";
    }
  }
  /* One process can hold BOTH emulator ports, so the same PID can appear
     twice. Killing it once and then again makes the second call report ESRCH
     (or a taskkill failure) and the CLI exit non-zero having actually released
     every listener. Group first, kill once, share the outcome. */
  const byPid = new Map();
  for (const row of rows) {
    if (row.skipped) continue;
    if (!byPid.has(String(row.pid))) byPid.set(String(row.pid), []);
    byPid.get(String(row.pid)).push(row);
  }
  for (const [pid, group] of byPid) {
    let error = null;
    try {
      if (IS_WIN) {
        execFileSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" });
      } else {
        process.kill(parseInt(pid, 10), "SIGKILL");
      }
    } catch (e) {
      error = String((e && e.message) || e);
    }
    if (error) for (const row of group) row.error = error;
  }
  return rows.filter((r) => !r.skipped);
}

function describe(rows) {
  return rows.map((r) => "  :" + r.port + " held by PID " + r.pid +
    " (" + r.image + ")" + (r.error ? " — kill FAILED: " + r.error : "")).join("\n");
}

function clearCommand(rows) {
  const pids = [...new Set(rows.map((r) => r.pid))];
  return IS_WIN
    ? pids.map((p) => "taskkill /F /T /PID " + p).join("  &&  ")
    : "kill -9 " + pids.join(" ");
}

const DEFAULT_PORTS = [
  parseInt(process.env.SIM_DB_PORT || "9000", 10),
  parseInt(process.env.SIM_AUTH_PORT || "9099", 10)
];

module.exports = { listeningPids, imageName, survey, free, describe, clearCommand, DEFAULT_PORTS };

/* ── CLI ──────────────────────────────────────────────────────────── */
if (require.main === module) {
  const [verb, ...rest] = process.argv.slice(2);
  const ports = rest.length ? rest.map((n) => parseInt(n, 10)).filter(Boolean) : DEFAULT_PORTS;

  if (verb === "free") {
    const killed = free(ports);
    if (!killed.length) {
      console.log("emulator-ports: nothing listening on " + ports.join(", ") + ".");
    } else {
      console.log("emulator-ports: freed " + killed.length + " listener(s):\n" + describe(killed));
    }
    process.exit(killed.some((r) => r.error) ? 1 : 0);
  }

  if (verb === "check" || verb === undefined) {
    const held = survey(ports);
    if (!held.length) {
      console.log("emulator-ports: " + ports.join(", ") + " are free.");
      process.exit(0);
    }
    console.error(
      "emulator-ports: FATAL — the emulator ports are already in use:\n" +
      describe(held) + "\n\n" +
      "A stale listener makes the next run's readiness probe succeed against\n" +
      "the WRONG emulator, so the suite either validates nothing or times out\n" +
      "in a way that reads as an environment fault. Clear it and re-run:\n\n" +
      "  node scripts/ops/emulator-ports.js free\n" +
      "or, directly:\n  " + clearCommand(held) + "\n\n" +
      "If this is an emulator you started on purpose (`npm run emulator`),\n" +
      "stop it first — the suite must own its own instance.");
    process.exit(1);
  }

  console.error("usage: node scripts/ops/emulator-ports.js <check|free> [port...]");
  process.exit(2);
}
