/* tests/github-dpf-currency.test.js
 *
 * The GitHub transfer (Annex III row #5) rests on Art. 45 ADEQUACY: GitHub, Inc.
 * is an active participant in the EU–US Data Privacy Framework, so transfers to
 * it are covered by the Commission's decision of 10 July 2023 and need no SCCs.
 *
 * THAT BASIS HAS AN EXPIRY DATE, AND NOTHING IN THE CODE WOULD NOTICE. A
 * certification that lapses does not break a build, fail a job or change a byte
 * of output — the nightly jobs keep transferring, and the published notice keeps
 * telling participants the transfer is covered. It is precisely the shape of
 * claim this repo has repeatedly let go stale, except that here the stale
 * version is a lawfulness statement rather than a status label.
 *
 * So the deadline is encoded as a failing test. This file is MEANT to fail one
 * day: ~90 days before the recorded recertification date, which is lead time to
 * re-check the register and either extend the date or change the basis. A red
 * test here is a prompt, not a defect — see the failure message.
 *
 * Verified 2026-09-01 against the U.S. Department of Commerce register
 * (dataprivacyframework.gov): EU–U.S. DPF Active, UK Extension Active,
 * Swiss–U.S. Active, all Non-HR Data; original certification 2017-01-26; next
 * certification due 2027-08-03. The published scope names "GitHub Free and
 * Subscription Users Data", which is the point that had been in doubt.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");


/* Collapse whitespace before matching. privacy.html is hand-wrapped source, so a
   phrase like "Data Privacy Framework" can be split across a line break and an
   indent — a literal multi-word regex then fails on correct content, and, worse,
   a deletion could hide behind a re-wrap. Every match in this file runs against
   the normalised text for that reason. */
const flat = (t) => String(t).replace(/\s+/g, " ");

const dpa = flat(read(PLATFORM, "legal", "dpa-draft.md"));
const privacyHtml = read(PLATFORM, "privacy.html");

/* Days of warning before the certification lapses. Long enough to re-check the
   register, get a decision, and ship a notice change through the usual review —
   this repo's notice changes touch three languages and a shell bump. */
const LEAD_DAYS = 90;

function recordedRecertificationDate() {
  const m = dpa.match(/next certification\s+due\s+(\d{4})-(\d{2})-(\d{2})/i);
  assert.ok(
    m,
    "Annex III row #5 no longer records a 'next certification due YYYY-MM-DD' " +
      "date for GitHub's DPF participation. That date is what makes the adequacy " +
      "basis checkable; do not remove it without replacing the basis."
  );
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
}

test("Annex III row #5 records GitHub's DPF participation as the transfer basis", () => {
  assert.match(dpa, /EU–U\.S\. Data Privacy Framework|EU-U\.S\. Data Privacy Framework/,
    "row #5 must name the framework the transfer relies on");
  assert.match(dpa, /Non-HR Data/,
    "record the covered data category — DPF certifications are scoped, and ours " +
      "is non-HR data");
  assert.ok(!/Transfer mechanism UNRESOLVED/.test(dpa),
    "row #5 still says the mechanism is unresolved while this file asserts DPF; " +
      "one of the two is out of date");
});

test("the GitHub DPF certification is not close to lapsing", () => {
  const { iso, ms } = recordedRecertificationDate();
  const daysLeft = Math.floor((ms - Date.now()) / 86400000);

  assert.ok(
    daysLeft > LEAD_DAYS,
    "\n" +
      "GitHub's recorded DPF recertification date (" + iso + ") is " +
      (daysLeft < 0 ? Math.abs(daysLeft) + " days PAST" : daysLeft + " days away") + ".\n\n" +
      "THIS IS A PROMPT, NOT A BUG. The GitHub Actions transfer in Annex III row #5 " +
      "relies on that certification being current. Nothing else in this repo would " +
      "notice it lapsing: the nightly jobs would keep transferring and privacy.html " +
      "would keep telling participants the transfer is covered.\n\n" +
      "Do this:\n" +
      "  1. Re-check dataprivacyframework.gov for GitHub, Inc. — status must be " +
      "Active for the EU-U.S. DPF, covering Non-HR Data.\n" +
      "  2. If still active, update the date in Annex III row #5 and the year stated " +
      "in privacy.html section 7 (all three languages).\n" +
      "  3. If NOT active, the transfer has lost its Art. 45 basis. Stop relying on " +
      "adequacy: either move the jobs to an EEA runner, obtain a Customer Agreement " +
      "so GitHub's DPA and its SCCs attach, or stop the transfer.\n"
  );
});

test("the notice and the DPA agree on the basis, and neither claims SCCs for this row", () => {
  /* The inverse of the guard this replaces. That one fired while the mechanism
     was unresolved, to stop the notice getting ahead of the analysis. Now the
     analysis has landed, the risk flips: the notice must not keep describing a
     safeguard that is no longer the one relied on. */
  const en = privacyHtml.slice(
    privacyHtml.indexOf('<section data-priv-lang="en"'),
    privacyHtml.indexOf('<section data-priv-lang="fr"')
  );
  const transfers = flat(en.slice(en.indexOf("<h2>7."), en.indexOf("<h2>8.")));

  assert.match(transfers, /Data Privacy Framework/,
    "privacy.html section 7 no longer names the framework the GitHub transfer relies on");
  assert.ok(!/has not yet been confirmed|are completing that check/.test(transfers),
    "section 7 still says the safeguard check is outstanding; it was completed on " +
      "2026-09-01 and the answer is recorded in Annex III row #5");

  const { iso } = recordedRecertificationDate();
  const year = iso.slice(0, 4);
  assert.ok(transfers.includes(year),
    "section 7 should state the recertification year (" + year + ") that Annex III " +
      "records, so the two cannot drift apart");
});

test("the Art. 28 processor gap is recorded, and not confused with the transfer basis", () => {
  /* The two obligations are independent, and conflating them is exactly the
     mistake this row made before: adequacy answers WHERE the data may go, not
     WHETHER there is a processor contract governing it. Free-plan use has the
     first and not the second. If someone later reads "transfer resolved" as
     "row #5 is clean", this test is what says otherwise. */
  assert.match(dpa, /ART\.\s*28\(3\)\s*PROCESSOR CONTRACT IS STILL MISSING/i,
    "Annex III row #5 must keep recording that the Art. 28 contract is absent for " +
      "free-plan use, separately from the transfer basis being resolved");
  assert.match(dpa, /adequacy does not\s+supply it/i,
    "state explicitly that adequacy does not substitute for Art. 28 — that is the " +
      "conflation being guarded against");
});
