/* tests/dpia-facts.test.js
 *
 * A DPIA's JUDGEMENTS cannot be tested — whether consent is freely given, or
 * whether residual risk warrants Art. 36 consultation, are not derivable from
 * code, and `legal/dpia.md` says so itself. Its FACTS can be, and those are what
 * go stale: the document asserts things about the rules and the client that were
 * true on 2026-09-03, and nothing else in this repository would notice if they
 * stopped being true.
 *
 * The B1 check was written INVERTED — it asserted the room gate was still
 * self-assertable, so the day someone fixed it the test would fail and force
 * the DPIA to be updated by the same change. That worked: the fix landed on
 * 2026-09-03 and could not land quietly. It now guards the other direction —
 * the binding must not be removed and the DPIA must not drift back to
 * describing an open risk. A DPIA that overstates risk loses credibility
 * exactly like one that understates it, and that is how a document stops being
 * read.
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

test("B1 — the room claim is bound to the pool assignment, and the DPIA says so", () => {
  /* INVERTED ONCE ALREADY, AND THAT IS THE POINT. Until 2026-09-03 this test
     asserted the gate was still self-assertable and FAILED the moment someone
     fixed it — so the fix could not land without updating the DPIA. It did
     exactly that. Now it guards the other direction: the binding must not be
     removed, and the DPIA must not drift back to describing an open risk.

     ⚠️ It also watches the RIGHT node now. The DPIA originally named
     `uidMembers`, which was vestigial and gated nothing; the load-bearing claim
     is `roomOf`, which is what roomChat's .read is expressed in terms of. */
  const write = String(rules.sessions.$sessionId.roomOf.$uid[".write"] || "");
  const orgWrite = String(
    rules.orgs.$orgSlug.sessions.$sessionId.roomOf.$uid[".write"] || "");

  for (const [label, w] of [["default", write], ["orgs", orgWrite]]) {
    assert.match(w, /clientMapping/,
      `${label}: the roomOf self-claim no longer checks the clientId belongs to ` +
      `the claimant — a participant can claim a room through somebody else's id`);
    assert.match(w, /child\('pool'\)/,
      `${label}: the roomOf self-claim no longer checks the pool assignment, so ` +
      `it is self-assertable again and DPIA risk B1 has reopened`);
    assert.match(w, /!data\.exists\(\)/,
      `${label}: the claim is no longer write-once`);
  }

  assert.ok(!JSON.stringify(rules).includes("uidMembers"),
    "the vestigial uidMembers node is back. Nothing writes or gates on it; a " +
    "self-assertable node that looks like a membership check is worse than none.");

  assert.ok(flat(dpia).includes("B1. ✅ FIXED 2026-09-03"),
    "the rules bind the claim but the DPIA still reports B1 as open. A DPIA " +
    "that overstates risk loses credibility exactly like one that understates it.");
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
