/* tests/dpa-export-lockstep.test.js
 *
 * Keeps four statements about the central pseudonymised research export in
 * lockstep — three about whether it runs, one about who answers for it:
 *
 *   1. `.github/workflows/pseudonymise-export.yml` — the `on:` block. THE TRUTH.
 *   2. The `# SCHEDULE-STATE:` marker sitting directly above it.
 *   3. Clause 2.6 of `legal/dpa-draft.md`, whose GDPR Art. 28(10) analysis turns
 *      on whether the operator runs a central export over every facilitator's
 *      sessions.
 *   4. `legal/record-of-processing.md` — which of the two records (Art. 30(2),
 *      on a Controller's behalf, or Art. 30(1), the operator's own) the activity
 *      is filed under. Clause 2.6's election decides that, and the two must not
 *      drift apart. See the block above that test.
 *
 * WHY THIS EXISTS, precisely. On 2026-08-31 the schedule was commented out (its
 * GCS destination had become unwritable) and a long header comment was written
 * explaining that. On 2026-09-01, #363 migrated the destination to Scaleway and
 * UNCOMMENTED the schedule — without touching the comment. For a day the file
 * asserted its own inverse: "⚠ SCHEDULE DISABLED 2026-08-31" printed directly
 * above a live `schedule:` block.
 *
 * That is not a cosmetic defect. On 2026-09-02 a reader trusting the comment
 * over the YAML drafted a DPA clause recording that the central export had
 * stopped and that the Art. 28(10) exposure had lapsed — when it runs nightly,
 * producing a real-name -> pseudonym linkage table. A legal instrument was one
 * review away from resting on a stale code comment. The correction made the
 * finding LARGER, which is the direction stale status claims usually hide.
 *
 * The test derives the state from the YAML and requires the other two to agree.
 * It is deliberately symmetric: disabling the schedule again fails just as
 * loudly until the prose follows, because "stopped" going stale is the exact
 * failure that happened.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const WF = ".github/workflows/pseudonymise-export.yml";
const DPA = "docs/Third_session/PBL_platform/legal/dpa-draft.md";
const ROPA = "docs/Third_session/PBL_platform/legal/record-of-processing.md";

/* Both files are hand-wrapped prose. A literal regex over raw text fails the
   moment an editor re-flows a line, which is a false failure on correct
   content — the whitespace bug already found in the notice guards. Flatten. */
const flat = (s) => s.replace(/\s+/g, " ");

/* The `on:` block: from the `on:` key to the first line at column 0 after it. */
function onBlock(yml) {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.notStrictEqual(start, -1, `${WF}: no top-level 'on:' block found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const block = onBlock(read(WF));

/* A cron line that is NOT commented out. */
const scheduleLive = block
  .split(/\r?\n/)
  .some((l) => /^\s*-\s*cron:/.test(l) && !/^\s*#/.test(l));

test("anti-vacuity: the `on:` block still mentions cron at all", () => {
  /* Without this, deleting the schedule entirely (rather than commenting it)
     would make `scheduleLive` false forever and every assertion below would
     pass by describing a job that no longer exists. */
  assert.ok(
    /cron:/.test(block),
    `${WF}: the 'on:' block mentions no cron in any form. If the scheduled ` +
      `export was removed on purpose, delete this test in the same commit and ` +
      `rewrite clause 2.6 of the DPA — do not leave it silently green.`
  );
});

/* A designated marker, not prose. The first version of this test matched the
   words "SCHEDULE DISABLED" anywhere in the block — and failed on the corrected
   header, because the corrected header NARRATES the old claim in order to
   explain it. A guard that cannot survive being described is the wrong guard. */
test("the workflow's SCHEDULE-STATE marker agrees with its own schedule", () => {
  const markers = block.match(/^\s*#\s*SCHEDULE-STATE:\s*(\S+)/gm) || [];
  assert.strictEqual(
    markers.length,
    1,
    `${WF}: expected exactly one '# SCHEDULE-STATE: <live|disabled>' line in ` +
      `the 'on:' block, found ${markers.length}. It is the one place a reader ` +
      `— or this test — can learn the state without parsing YAML.`
  );
  const declared = markers[0].split(":")[1].trim().toLowerCase();
  assert.ok(
    declared === "live" || declared === "disabled",
    `${WF}: SCHEDULE-STATE is "${declared}"; permitted values are exactly ` +
      `"live" and "disabled".`
  );
  assert.strictEqual(
    declared,
    scheduleLive ? "live" : "disabled",
    `${WF}: SCHEDULE-STATE says "${declared}" while the 'on:' block is ` +
      `actually ${scheduleLive ? "scheduled" : "not scheduled"}. This is the ` +
      `exact 2026-09-01 defect — the schedule was changed and the header was ` +
      `not. Change both in the same commit.`
  );
});

test("DPA clause 2.6 agrees with the workflow", () => {
  const dpa = flat(read(DPA));
  const LIVE_CLAIM = "the exposure in (a) is LIVE";
  const STOPPED_CLAIM = "The central export is **not running**";

  if (scheduleLive) {
    assert.ok(
      dpa.includes(LIVE_CLAIM),
      `${DPA}: the export runs on a live schedule, but clause 2.6 does not ` +
        `record it. Expected the phrase "${LIVE_CLAIM}". The Art. 28(10) ` +
        `election in 2.6 turns on this fact.`
    );
    assert.ok(
      !dpa.includes(flat(STOPPED_CLAIM)),
      `${DPA}: clause 2.6 still claims the central export is not running, ` +
        `while ${WF} schedules it nightly. That understates the Art. 28(10) ` +
        `exposure in a document intended for counsel.`
    );
  } else {
    assert.ok(
      dpa.includes(flat(STOPPED_CLAIM)),
      `${DPA}: the export schedule is disabled, but clause 2.6 does not say ` +
        `so. Expected "${STOPPED_CLAIM}". Note that stopping the job is NOT ` +
        `the Art. 28(10) election — 2.6 must still record that the election ` +
        `is owed, and part (b) essential means is unaffected either way.`
    );
    assert.ok(
      !dpa.includes(LIVE_CLAIM),
      `${DPA}: clause 2.6 says the exposure is live while ${WF} has no ` +
        `active schedule. Overstating it is a smaller error than the reverse, ` +
        `but it is still a false statement in a legal draft.`
    );
  }
});

/* ---------------------------------------------------------------------------
 * The Art. 28(10) election (DPA clause 2.6, made 2026-09-02).
 *
 * Electing option 1 — the operator is an INDEPENDENT CONTROLLER for the central
 * research export — has a filing consequence that is easy to forget and
 * embarrassing to be caught by: the activity stops belonging in the Art. 30(2)
 * record (processing on behalf of a controller) and starts belonging in an
 * Art. 30(1) one. An activity sitting in both records, or in neither, is the
 * exact defect a register exists to prevent, and no reader would notice.
 * ------------------------------------------------------------------------- */

const OPTION_1_ELECTED = "✅ ELECTED 2026-09-02: OPTION 1";

test("the Art. 28(10) election and the two processing records agree", () => {
  const dpa = flat(read(DPA));
  const ropa = read(ROPA);

  /* Anti-vacuity: if the register is renamed or its Art. 30(2) section
     restructured, every assertion below would pass by matching nothing. */
  assert.ok(
    /##\s*2\.\s*Categories of processing carried out on behalf of each Controller/.test(
      ropa
    ),
    `${ROPA}: the Art. 30(2) section heading is gone. If the register was ` +
      `restructured, update this test in the same commit — silently green here ` +
      `means nothing is checking where the export is filed.`
  );

  if (!dpa.includes(flat(OPTION_1_ELECTED))) {
    /* Option 2 (or a counsel alternative) — the export must NOT be filed as the
       operator's own controllership, because it would no longer be one. */
    assert.ok(
      !/##\s*2A\./.test(ropa),
      `${ROPA}: it carries an Art. 30(1) record for the export while ${DPA} no ` +
        `longer elects option 1. Whoever changed the election must move the ` +
        `activity back into the Art. 30(2) record in the same commit.`
    );
    return;
  }

  assert.ok(
    /##\s*2A\./.test(ropa) && /A1 — Central pseudonymised research export/.test(ropa),
    `${ROPA}: DPA clause 2.6 elects option 1 — the operator is an independent ` +
      `controller for the research export — but the register has no §2A ` +
      `Art. 30(1) entry for it. An election with no record is not made.`
  );
  assert.ok(
    !/\|\s*P5\s*\|\s*\*\*Pseudonymised research export\*\*/.test(ropa),
    `${ROPA}: the export is still listed as an ACTIVE row in the Art. 30(2) ` +
      `record (§2) while also being the operator's own controllership. It must ` +
      `appear in exactly one of the two records — see §2A.`
  );
});
