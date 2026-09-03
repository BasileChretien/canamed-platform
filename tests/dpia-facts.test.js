/* tests/dpia-facts.test.js
 *
 * A DPIA's JUDGEMENTS cannot be tested — whether consent is freely given, or
 * whether residual risk warrants Art. 36 consultation, are not derivable from
 * code, and `legal/dpia.md` says so itself. Its FACTS can be, and those are what
 * go stale: the document asserts things about the rules and the client that were
 * true on 2026-09-03, and nothing else in this repository would notice if they
 * stopped being true.
 *
 * The most valuable one is inverted on purpose. Risk **B1** says the room gate
 * is self-assertable. That is a defect, so the day someone fixes it this test
 * FAILS — forcing the DPIA to be updated by the same change that reduces the
 * risk. A DPIA still describing a fixed defect overstates risk, which sounds
 * harmless and is not: it is the same credibility problem as understating it,
 * and it is how a document stops being read.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

const dpia = read(PLATFORM, "legal", "dpia.md");
const rules = JSON.parse(read(PLATFORM, "database.rules.json")).rules;
const flat = (s) => s.replace(/\s+/g, " ");

test("the DPIA covers everything Art. 35(7) requires", () => {
  /* Anti-vacuity for every other test here: they all read this file, so an
     empty or renamed one would make the suite pass by checking nothing. */
  for (const [limb, needle] of [
    ["(a) systematic description", "Systematic description of the processing"],
    ["(b) necessity and proportionality", "Necessity and proportionality"],
    ["(c) risks to rights and freedoms", "Risks to the rights and freedoms"],
    ["(d) measures", "Measures already in place"],
    ["Art. 35(2) DPO advice", "Art. 35(2)"],
    ["Art. 35(9) data-subject views", "Art. 35(9)"],
    ["Art. 36 determination", "Art. 36"],
  ]) {
    assert.ok(dpia.includes(needle),
      `the DPIA has no ${limb} section — Art. 35(7) lists it as a minimum`);
  }
});

test("it does not claim to be finished", () => {
  /* The specific failure mode for this kind of document: a draft that loses its
     banner and starts being cited as a completed assessment. */
  assert.match(dpia, /NOT A COMPLETED DPIA/,
    "the draft banner is gone. A DPIA without DPO advice (Art. 35(2)) and " +
    "without data-subject views (Art. 35(9)) must not read as finished.");
  assert.ok(dpia.includes("[CONTROLLER — ART. 36 DETERMINATION: ____ ]"),
    "the Art. 36 determination has been filled in or removed — if a decision " +
    "was actually taken, record who took it and when rather than deleting the slot");
});

test("B1 — the DPIA and the rules agree on whether the room gate is self-assertable", () => {
  /* THE LOCKSTEP THAT MATTERS. Fixing the gate must update the DPIA. */
  const write = String(
    rules.sessions.$sessionId.rooms.$roomId.uidMembers.$uid[".write"] || "");
  /* Self-assertable means: nothing in the predicate checks that the claimant was
     actually ASSIGNED to this room. The decided fix (2026-08-03) binds the claim
     to the participant's own pool entry, so a reference to pool or clientMapping
     is what "fixed" looks like. */
  const bound = /pool|clientMapping/.test(write);
  const dpiaSaysUnfixed = flat(dpia).includes("has not been implemented");

  if (bound) {
    assert.fail(
      "The room gate is now bound to the pool assignment — risk B1 has been " +
      "FIXED. Update legal/dpia.md: B1's severity, the residual-risk table in " +
      "§8, and the Art. 36 recommendation in §9 all rest on it being open, and " +
      "a DPIA that overstates risk loses credibility exactly like one that " +
      "understates it. Then delete this branch of the test.");
  }
  assert.ok(dpiaSaysUnfixed,
    "the rules still let a participant self-claim any room, but the DPIA no " +
    "longer says so. Do not soften B1 without changing the rule.");
});

test("A1 — the DPIA and the client agree that the workshop consent gates joining", () => {
  /* §4's whole argument is that the checkbox is a HARD GATE. If joining stops
     depending on it, the freely-given problem changes shape and the section
     needs rewriting rather than quietly surviving. */
  const src = read(PLATFORM, "script.js");
  const gated = /consent-workshop/.test(src);
  assert.ok(gated,
    "the workshop consent checkbox is gone from script.js. DPIA §4 and risk A1 " +
    "are built on it gating the Join button — re-check both.");
  assert.ok(flat(dpia).includes("hard gate on the Join button"),
    "DPIA §4 no longer describes the consent checkbox as a hard gate");
});

test("the DPIA's transparency risks match the items still marked BLOCKING", () => {
  /* E1/E2/F1 cite L7, L1 and L10. If those close, the risk section is stale. */
  const dpa = flat(read(PLATFORM, "legal", "dpa-draft.md"));
  for (const item of ["L1", "L7", "L10"]) {
    const stillBlocking = new RegExp(`\\*\\*${item} — BLOCKING`).test(dpa);
    assert.ok(stillBlocking,
      `Annex VI ${item} is no longer marked BLOCKING, but the DPIA still lists ` +
      `the corresponding risk as open. Update legal/dpia.md §5 and §8.`);
  }
});

test("Annex VI L11 records that the DPIA now exists", () => {
  const dpa = flat(read(PLATFORM, "legal", "dpa-draft.md"));
  assert.ok(dpa.includes("legal/dpia.md"),
    "L11 says there is no DPIA while legal/dpia.md exists — the stale-label " +
    "failure the STATUS-CLAIM RULE exists to prevent");
});
