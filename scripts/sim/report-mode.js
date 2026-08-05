"use strict";
/* scripts/sim/report-mode.js — what the sim report is allowed to CLAIM
 *
 * The cross-tab persona sim writes a markdown report, and that report is the
 * artefact a reviewer reads to decide whether a change was validated against
 * the real Firebase rules. Until 2026-08-05 its header hardcoded
 *
 *     **Mode:** LOCAL (LocalDB, no real Firebase).
 *     **Cohort:** 2 facilitators + 8 students (4 per room, Caen × Nagoya).
 *
 * on EVERY run. Both lines were false in the two ways that matter:
 *
 *   1. The cohort had grown to 4 facilitators + 24 students across 6 rooms
 *      (and is overridable per run via SIM_STUDENTS / SIM_ROOM_COUNT), so the
 *      report understated the scale of every scaled run by 3x.
 *   2. The mode line could not tell an EMULATOR run from a LocalDB one. That
 *      is the dangerous half: `npm run sim:emulator` exists precisely because
 *      LOCAL mode does NOT exercise database.rules.json, and a run that asked
 *      for the emulator but silently fell back to LocalDB produced a report
 *      indistinguishable from one that really did enforce the rules.
 *
 * CLAUDE.md carries a STATUS-CLAIM RULE for exactly this failure — never
 * report a status from a hand-maintained label; verify it from the live
 * system. So these strings are now DERIVED, and derived from what the browser
 * actually did rather than from what the launcher intended:
 *
 *   - `observedMode` is the app's own `MODE` const, read out of a real sim tab
 *     with page.evaluate. It is "shared" only when sharedAvailable() found a
 *     usable Firebase config; it is "local" when the app fell back to LocalDB.
 *   - `emulatorPinned` is whether window.CANAMED_EMULATOR was present in that
 *     same tab — i.e. the tab was actually wired to the local emulator, not
 *     merely launched by a wrapper that meant to.
 *   - `requestedEmulator` is the INTENT (SIM_EMULATOR_MODE=1). It is used only
 *     to make a mismatch LOUD; it never decides the label on its own.
 *
 * Pure functions, no I/O, so tests/sim-report-mode.test.js can pin every
 * outcome — including the fallback one, which is the whole point and which a
 * live sim run would only surface by accident.
 */

/* Human-readable backend description for the report header.
 *
 * probe: {
 *   requestedEmulator: boolean,   // SIM_EMULATOR_MODE === "1"
 *   observedMode: "shared"|"local"|null,   // the app's MODE, read from a tab
 *   emulatorPinned: boolean,      // window.CANAMED_EMULATOR was present
 *   host: string, dbPort: number|string,
 *   probeError: string|null       // the probe itself failed
 * }
 *
 * Returns { backend, label, rulesExercised, warning }.
 *   backend        — one of "emulator" | "firebase" | "local" |
 *                    "local-fallback" | "unknown"
 *   label          — the string that goes after "**Mode:** "
 *   rulesExercised — whether database.rules.json was in force for this run.
 *                    `null` when we could not tell; NEVER `true` on a guess.
 *   warning        — a sentence to surface prominently, or null.
 */
function describeBackend(probe) {
  const p = probe || {};
  const where = String(p.host || "127.0.0.1") + ":" + String(p.dbPort || 9000);

  if (p.probeError || (p.observedMode !== "shared" && p.observedMode !== "local")) {
    return {
      backend: "unknown",
      label: "UNKNOWN — the backend probe did not run" +
        (p.probeError ? " (" + p.probeError + ")" : "") +
        ", so this report cannot say whether database.rules.json was enforced.",
      rulesExercised: null,
      warning: "The backend could not be determined. Treat every claim in " +
        "this report about rule enforcement as unverified."
    };
  }

  if (p.observedMode === "shared") {
    if (p.emulatorPinned) {
      return {
        backend: "emulator",
        label: "EMULATOR — real Firebase RTDB at " + where +
          "; database.rules.json IS enforced.",
        rulesExercised: true,
        warning: null
      };
    }
    return {
      backend: "firebase",
      label: "SHARED — a real Firebase project (NOT the local emulator). " +
        "Rules are enforced, but this run wrote to a live database.",
      rulesExercised: true,
      warning: "This run was NOT against the emulator. Check which project " +
        "it wrote to before trusting or reusing its data."
    };
  }

  // observedMode === "local"
  if (p.requestedEmulator) {
    return {
      backend: "local-fallback",
      label: "LOCAL (LocalDB) — ⚠ THE EMULATOR WAS REQUESTED BUT NOT USED. " +
        "The tabs fell back to LocalDB, so database.rules.json was NOT " +
        "exercised by this run.",
      rulesExercised: false,
      warning: "SIM_EMULATOR_MODE=1 was set but the app ran on LocalDB. " +
        "This run proves nothing about the database rules — check for a " +
        "stale emulator on " + where + " and re-run."
    };
  }
  return {
    backend: "local",
    label: "LOCAL (LocalDB, no real Firebase) — database.rules.json is NOT " +
      "exercised by this run.",
    rulesExercised: false,
    warning: null
  };
}

/* Cohort description, derived from the actual persona lists and room knob.
 *
 * cohort: { facilitators: number, students: number, rooms: number,
 *           universities: string[] }
 */
function describeCohort(cohort) {
  const c = cohort || {};
  const facs = Math.max(0, parseInt(c.facilitators, 10) || 0);
  const studs = Math.max(0, parseInt(c.students, 10) || 0);
  const rooms = Math.max(0, parseInt(c.rooms, 10) || 0);
  const unis = (Array.isArray(c.universities) ? c.universities : [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);

  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const parts = [plural(facs, "facilitator") + " + " + plural(studs, "student")];

  if (rooms > 0) {
    /* Exact only when it divides; otherwise say ~ rather than imply a tidy
       split the run did not have. */
    const per = studs / rooms;
    const perTxt = Number.isInteger(per) ? String(per) : "~" + (Math.round(per * 10) / 10);
    parts.push("(" + perTxt + " per room across " + plural(rooms, "room") +
      (unis.length ? ", " + uniqueJoin(unis) : "") + ")");
  } else if (unis.length) {
    parts.push("(" + uniqueJoin(unis) + ")");
  }
  return parts.join(" ") + ".";
}

/* "Caen", "Nagoya", "Caen" → "Caen × Nagoya" — order-preserving, deduped. */
function uniqueJoin(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out.join(" × ");
}

module.exports = { describeBackend, describeCohort };
