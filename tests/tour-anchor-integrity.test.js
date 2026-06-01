/* tests/tour-anchor-integrity.test.js
 *
 * Regression guard for the UX-overload fix (2026-06-01).
 *
 * The first-run student tour was anchoring three steps to Module-A-only
 * UI that the Welcome stage does not show — and two of those ids no longer
 * existed in index.html at all:
 *
 *   - `findings-log`         → removed 2026-05-18 (0 occurrences in index.html)
 *   - `answers-list-moduleA` → never an id (only -plan/-differ/-disagree/
 *                              -takehome/-_unsorted suffixed inputs exist)
 *   - `rcol-p-decisions`     → exists, but inside the still-hidden #stage-1
 *
 * The result: a first-time student (worst case, an L2-English reader) was
 * taught a "Findings log" that isn't there. These tests pin the invariant
 * so the whole class of "tour step points at deleted/absent UI" cannot
 * silently come back:
 *
 *   1. EVERY non-null tour anchor (across all step sets) resolves to an id
 *      that actually exists in index.html.
 *   2. The two dead ids appear in NO step anchor.
 *   3. The Welcome-stage `student` set does not reference Module-A-only UI.
 *   4. tour.js carries the defensive render() auto-skip guard so a FUTURE
 *      element removal degrades to a silent skip rather than a ghost bubble.
 *
 * Static assertions — no DOM needed, matching the repo's test style.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const TOUR_SRC = fs.readFileSync(path.join(PLATFORM, "tour.js"), "utf8");

// tour.js is a UMD module; under Node (no `self`/`window`) it sets
// module.exports = exp, which exposes _STEPS for inspection.
const CanamedTour = require(path.join(PLATFORM, "tour.js"));
const STEPS = CanamedTour._STEPS;

// All element ids declared in index.html (double-quoted id="...").
const ID_SET = new Set(
  [...INDEX.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
);

// Ids the UX-overload fix removed from any tour anchor: they do not exist
// in index.html and must never be re-introduced as an anchor.
const DEAD_ANCHOR_IDS = ["findings-log", "answers-list-moduleA"];

test("tour _STEPS is exposed and has the expected sets", () => {
  assert.ok(STEPS && typeof STEPS === "object", "tour.js must export _STEPS");
  for (const set of ["create", "admin", "student", "studentModA"]) {
    assert.ok(Array.isArray(STEPS[set]), `STEPS.${set} must be an array`);
  }
});

test("every non-null tour anchor resolves to a real id in index.html", () => {
  const broken = [];
  for (const [set, steps] of Object.entries(STEPS)) {
    steps.forEach((step, i) => {
      if (step.anchor == null) return; // centred intro/outro bubble — OK
      if (!ID_SET.has(step.anchor)) {
        broken.push(`${set}[${i}] -> #${step.anchor}`);
      }
    });
  }
  assert.deepStrictEqual(
    broken,
    [],
    "tour steps anchored to ids that do not exist in index.html:\n" + broken.join("\n")
  );
});

test("the removed dead ids appear in NO tour anchor", () => {
  for (const dead of DEAD_ANCHOR_IDS) {
    for (const [set, steps] of Object.entries(STEPS)) {
      steps.forEach((step, i) => {
        assert.notStrictEqual(
          step.anchor,
          dead,
          `${set}[${i}] still anchors the removed id #${dead}`
        );
      });
    }
    // also confirm the id really is gone from index.html (defends the premise)
    assert.ok(
      !ID_SET.has(dead),
      `#${dead} should not exist in index.html (the tour was pointing at deleted UI)`
    );
  }
});

test("the Welcome-stage student tour does not reference Module-A-only UI", () => {
  // The student tour fires on stage 0 (Welcome). #rcol-p-decisions lives
  // inside the hidden #stage-1 (Module A) — orienting students to it here
  // showed a centred ghost bubble. Module A onboarding is the studentModA
  // tour's job (it fires on stage 1 where the anchor is live).
  const studentAnchors = STEPS.student.map((s) => s.anchor);
  assert.ok(
    !studentAnchors.includes("rcol-p-decisions"),
    "the Welcome student tour must not anchor #rcol-p-decisions (Module-A-only)"
  );
  // The kept steps are the Welcome-relevant ones.
  assert.deepStrictEqual(
    studentAnchors,
    [null, "team-name-input", "call-prof-btn", "global-lang-switcher"],
    "student tour should orient to: intro, team name, call-a-facilitator, language"
  );
});

test("studentModA tour still covers the Module A chart (anchors live on stage 1)", () => {
  const modAAnchors = STEPS.studentModA.map((s) => s.anchor).filter(Boolean);
  // These ids exist in index.html (inside #stage-1) and carry the Module A
  // walkthrough the Welcome tour no longer attempts.
  for (const id of modAAnchors) {
    assert.ok(ID_SET.has(id), `studentModA anchor #${id} must exist in index.html`);
  }
  assert.ok(
    modAAnchors.includes("chart-section-history"),
    "studentModA must still walk the case chart"
  );
});

test("tour.js carries the defensive auto-skip guard for missing anchors", () => {
  // Source-level pin: render() must skip a step whose anchor id is absent
  // from the DOM, so a future element removal degrades to a skip, not a
  // ghost bubble. (DOM behaviour itself is exercised by Playwright.)
  assert.match(
    TOUR_SRC,
    /step\.anchor\s*&&[\s\S]*?!document\.getElementById\(step\.anchor\)/,
    "render() must guard on a missing getElementById(step.anchor)"
  );
  assert.match(
    TOUR_SRC,
    /active\.dir/,
    "the auto-skip must travel in the user's current direction (active.dir)"
  );
});
