/* tests/sim-report-mode.test.js
 *
 * The sim's markdown report is the artefact a reviewer reads to decide whether
 * a change was validated against the real Firebase rules. Until 2026-08-05 its
 * header hardcoded "**Mode:** LOCAL (LocalDB, no real Firebase)." and
 * "**Cohort:** 2 facilitators + 8 students" on EVERY run — so it could not
 * distinguish
 *
 *   (a) a LocalDB run, which exercises no database rule at all, from
 *   (b) an emulator run, which enforces database.rules.json, from
 *   (c) an emulator run that SILENTLY FELL BACK to LocalDB — the documented
 *       failure when a stale emulator squats :9000/:9099.
 *
 * (c) is the one that matters: it produces a green report that looks exactly
 * like (b) while proving nothing. CLAUDE.md's STATUS-CLAIM RULE exists for
 * this class of defect — a hand-maintained label asserting a status nobody
 * re-derived.
 *
 * scripts/sim/report-mode.js derives both lines instead, from what the browser
 * actually did. These tests pin each outcome, most importantly (c), which a
 * live sim run would only ever surface by accident.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { describeBackend, describeCohort } =
  require("../scripts/sim/report-mode.js");

const SIM = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "sim", "simulate-session.js"), "utf8");

/* ── the backend claim ─────────────────────────────────────────────── */

test("a real emulator run says so, and claims rules ARE enforced", () => {
  const d = describeBackend({
    requestedEmulator: true, observedMode: "shared", emulatorPinned: true,
    host: "127.0.0.1", dbPort: 9000, probeError: null
  });
  assert.strictEqual(d.backend, "emulator");
  assert.strictEqual(d.rulesExercised, true);
  assert.match(d.label, /EMULATOR/);
  assert.match(d.label, /127\.0\.0\.1:9000/);
  assert.match(d.label, /database\.rules\.json IS enforced/);
  assert.strictEqual(d.warning, null);
});

test("a plain LocalDB run says rules are NOT exercised", () => {
  const d = describeBackend({
    requestedEmulator: false, observedMode: "local", emulatorPinned: false,
    host: "127.0.0.1", dbPort: 9000, probeError: null
  });
  assert.strictEqual(d.backend, "local");
  assert.strictEqual(d.rulesExercised, false);
  assert.match(d.label, /LOCAL \(LocalDB, no real Firebase\)/);
  assert.match(d.label, /NOT\s+exercised/);
  assert.strictEqual(d.warning, null);
});

test("THE CASE THAT MATTERS: emulator requested but LocalDB actually used", () => {
  /* The stale-emulator fallback. The old hardcoded header rendered this
     identically to a real emulator run; now it must be loud, must NOT claim
     rules were exercised, and must name the port to go and clear. */
  const d = describeBackend({
    requestedEmulator: true, observedMode: "local", emulatorPinned: false,
    host: "127.0.0.1", dbPort: 9000, probeError: null
  });
  assert.strictEqual(d.backend, "local-fallback");
  assert.strictEqual(d.rulesExercised, false,
    "a fallback run must never be reported as having exercised the rules");
  assert.match(d.label, /REQUESTED BUT NOT USED/);
  assert.ok(d.warning, "the fallback must raise a warning, not pass quietly");
  assert.match(d.warning, /127\.0\.0\.1:9000/,
    "the warning must name the port whose stale emulator caused this");
});

test("emulator requested and MODE is shared but nothing was pinned ⇒ not the emulator", () => {
  const d = describeBackend({
    requestedEmulator: false, observedMode: "shared", emulatorPinned: false,
    host: "127.0.0.1", dbPort: 9000, probeError: null
  });
  assert.strictEqual(d.backend, "firebase");
  assert.strictEqual(d.rulesExercised, true);
  assert.match(d.label, /NOT the local emulator/);
  assert.ok(d.warning, "writing to a live project must be flagged");
});

test("a failed probe reports UNKNOWN — never a guess in either direction", () => {
  for (const probe of [
    { requestedEmulator: true, observedMode: null, emulatorPinned: false,
      probeError: "Execution context was destroyed" },
    { requestedEmulator: true, observedMode: undefined, emulatorPinned: true,
      probeError: null },
    { requestedEmulator: false, observedMode: "somethingElse", probeError: null },
    undefined
  ]) {
    const d = describeBackend(probe);
    assert.strictEqual(d.backend, "unknown", JSON.stringify(probe));
    assert.strictEqual(d.rulesExercised, null,
      "an unknown backend must be null, not false — false is itself a claim");
    assert.ok(d.warning);
  }
});

test("the probe error text is surfaced, so a broken probe is diagnosable", () => {
  const d = describeBackend({
    requestedEmulator: true, observedMode: null,
    probeError: "Execution context was destroyed"
  });
  assert.match(d.label, /Execution context was destroyed/);
});

/* ── the cohort claim ──────────────────────────────────────────────── */

test("the cohort line is derived from the real counts, not a fixed string", () => {
  assert.strictEqual(
    describeCohort({ facilitators: 4, students: 24, rooms: 6,
      universities: ["Caen", "Nagoya", "Caen", "Nagoya"] }),
    "4 facilitators + 24 students (4 per room across 6 rooms, Caen × Nagoya).");
});

test("an uneven split says ~, rather than implying a tidy one", () => {
  const s = describeCohort({ facilitators: 2, students: 10, rooms: 3,
    universities: ["Caen"] });
  assert.match(s, /~3\.3 per room across 3 rooms/);
  assert.match(s, /Caen\)/);
});

test("singulars read correctly and duplicate universities collapse", () => {
  assert.strictEqual(
    describeCohort({ facilitators: 1, students: 1, rooms: 1,
      universities: ["Caen", "Caen"] }),
    "1 facilitator + 1 student (1 per room across 1 room, Caen).");
});

test("degenerate input does not throw or emit NaN", () => {
  for (const c of [undefined, {}, { facilitators: 2, students: 4, rooms: 0 },
                   { facilitators: "x", students: null, rooms: -3,
                     universities: "not-an-array" }]) {
    const s = describeCohort(c);
    assert.doesNotMatch(s, /NaN|undefined|Infinity/, JSON.stringify(c));
  }
});

/* ── the wiring (a pure helper nothing calls proves nothing) ───────── */

test("simulate-session.js no longer hardcodes either claim", () => {
  assert.doesNotMatch(SIM, /\*\*Mode:\*\* LOCAL \(LocalDB, no real Firebase\)/,
    "the hardcoded Mode line must be gone, not merely shadowed");
  assert.doesNotMatch(SIM, /\*\*Cohort:\*\* 2 facilitators \+ 8 students/,
    "the hardcoded Cohort line must be gone");
});

test("the report header is built from describeBackend/describeCohort", () => {
  assert.match(SIM, /require\("\.\/report-mode\.js"\)/);
  assert.match(SIM, /"\*\*Mode:\*\* " \+ backend\.label/);
  assert.match(SIM, /"\*\*Cohort:\*\* " \+ describeCohort\(/);
  assert.match(SIM, /Database rules exercised/,
    "the report must state explicitly whether rules were in force");
});

test("the probe runs against a real tab, and before the flow can fail", () => {
  /* Derived from window/MODE in the page — not from the env var, which is
     only the launcher's intent and is exactly what could not detect the
     fallback. And called right after the first goto, so a run that dies in
     createSession still reports its backend rather than defaulting. */
  assert.match(SIM, /typeof MODE !== "undefined" \? MODE : null/);
  assert.match(SIM, /emu: !!window\.CANAMED_EMULATOR/);
  const goto = SIM.indexOf('await pageF1.goto(BASE_URL + "/")');
  const probe = SIM.indexOf("await probeBackend(pageF1)");
  const create = SIM.indexOf('locator("#splash-go-create")');
  assert.ok(goto > 0 && probe > goto && probe < create,
    "probeBackend must run after the first goto and before the create flow");
});

test("backendProbe reads the emulator host/port the launcher actually set", () => {
  assert.match(SIM, /requestedEmulator: process\.env\.SIM_EMULATOR_MODE === "1"/);
  assert.match(SIM, /host: process\.env\.SIM_EMULATOR_HOST \|\| "127\.0\.0\.1"/);
  assert.match(SIM, /dbPort: parseInt\(process\.env\.SIM_DB_PORT \|\| "9000", 10\)/);
});
