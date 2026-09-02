/* tests/archive-retention-horizon.test.js
 *
 * The nightly backup outlives the retention purge, and the DPA now states by how
 * much. This test derives those numbers rather than trusting the prose.
 *
 * THE ARITHMETIC. `cleanup-stale-sessions.js` purges a closed session at
 * closure + CLEANUP_RETENTION_CLOSED_DAYS (30) and a never-closed one at
 * creation + CLEANUP_RETENTION_OPEN_DAYS (90). But the last nightly snapshot
 * containing that session is taken the night before it is purged, and archive
 * objects live for the `backups/` age in the bucket lifecycle (90 days). So the
 * last identified copy disappears at roughly:
 *
 *     closed sessions   closure  + 30 + 90 = 120 days
 *     open sessions     creation + 90 + 90 = 180 days
 *
 * Those two figures are stated in DPA clause 2.8(b) and in the second limb of
 * Annex VI G12, and they are the basis of a disclosure defect recorded there —
 * the published notice promises 30/90 and says nothing about the archive. If
 * either constant moves and the prose does not, the DPA understates or
 * overstates a retention period in a document written for counsel. Hence a test.
 *
 * ⚠️ WHAT THIS TEST CANNOT SEE, stated because a guard that overclaims is worse
 * than none. `scripts/ops/pii-bucket-lifecycle.json` is a GCS lifecycle document
 * and `setup-pii-bucket.sh` applies it with `gcloud`. The live archive moved to
 * SCALEWAY object storage on 2026-09-01, and its lifecycle rules were set
 * through Scaleway, outside this repository. So this file is now the repo's
 * RECORD OF INTENT, not the thing that provisions the bucket. This test holds
 * the DPA and that record in lockstep; it CANNOT confirm the live bucket agrees.
 * Verifying that is an operator action against the Scaleway console, and if the
 * two ever diverge, the live bucket wins and both this file and the DPA are
 * wrong.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const LIFECYCLE = "scripts/ops/pii-bucket-lifecycle.json";
const CLEANUP = "scripts/cleanup-stale-sessions.js";
const DPA = "docs/Third_session/PBL_platform/legal/dpa-draft.md";

const flat = (s) => s.replace(/\s+/g, " ");

/* Age in days for the lifecycle rule covering a given object prefix. */
function lifecycleAge(prefix) {
  const doc = JSON.parse(read(LIFECYCLE));
  const rules = doc.rule || doc.rules || [];
  const hit = rules.find((r) =>
    (r.condition?.matchesPrefix || []).includes(prefix)
  );
  assert.ok(
    hit,
    `${LIFECYCLE}: no lifecycle rule matches the "${prefix}" prefix. If the ` +
      `archive layout changed, DPA clause 2.8(b) and Annex VI G12 both quote ` +
      `figures derived from it and must change too.`
  );
  assert.strictEqual(
    hit.action?.type,
    "Delete",
    `${LIFECYCLE}: the "${prefix}" rule is not a Delete action, so nothing ` +
      `bounds how long those objects live. The retention arithmetic in the DPA ` +
      `assumes deletion.`
  );
  return hit.condition.age;
}

/* The purge windows, read from the enforcing script's own defaults. */
function purgeDays(name) {
  const src = read(CLEANUP);
  const m =
    src.match(new RegExp(`retentionDays\\(\\s*"${name}"\\s*,\\s*(\\d+)`)) ||
    src.match(new RegExp(`process\\.env\\.${name}\\s*\\|\\|\\s*"(\\d+)"`));
  assert.ok(
    m,
    `${CLEANUP}: could not read the default for ${name}. This test derives the ` +
      `DPA's retention arithmetic from it; do not leave it unparsed.`
  );
  return Number(m[1]);
}

test("the archive lifetime and purge windows are still what the DPA assumes", () => {
  const archive = lifecycleAge("backups/");
  const linkage = lifecycleAge("linkage/");

  /* Anti-vacuity: nonsense values would make every sum below meaningless. */
  assert.ok(
    archive > 0 && linkage > 0,
    `${LIFECYCLE}: non-positive retention age (backups ${archive}, linkage ` +
      `${linkage}).`
  );
  assert.ok(
    linkage < archive,
    `${LIFECYCLE}: the linkage table (${linkage} d) is meant to be the ` +
      `shortest-lived object in the bucket, shorter than the archive ` +
      `(${archive} d) — it is the re-identification key.`
  );

  const dpa = flat(read(DPA));
  assert.ok(
    dpa.includes(`objects live **${archive} days**`) ||
      dpa.includes(`live **${archive} days**`),
    `${DPA}: the lifecycle record says archive objects live ${archive} days, ` +
      `but clause 2.8(b) / G12 do not state that figure.`
  );
});

test("the DPA states the erasure horizon its own inputs produce", () => {
  const archive = lifecycleAge("backups/");
  const closedHorizon = purgeDays("CLEANUP_RETENTION_CLOSED_DAYS") + archive;
  const openHorizon = purgeDays("CLEANUP_RETENTION_OPEN_DAYS") + archive;

  const dpa = flat(read(DPA));

  assert.ok(
    dpa.includes(`closure + ${closedHorizon} days`),
    `${DPA}: a closed session's last identified copy survives to closure + ` +
      `${closedHorizon} days (purge window + ${archive} d archive), but the ` +
      `draft does not state that figure. Clause 2.8(b) and Annex VI G12's ` +
      `second limb both quote it, and the disclosure defect recorded there ` +
      `rests on it being right.`
  );
  assert.ok(
    dpa.includes(`creation + ${openHorizon} days`),
    `${DPA}: a never-closed session's last identified copy survives to ` +
      `creation + ${openHorizon} days, which the draft does not state.`
  );

  /* The whole point of the finding: the horizon must EXCEED the published
     purge promise. If a change ever made them equal, the disclosure defect
     would be gone and the prose describing it would be wrong the other way. */
  assert.ok(
    closedHorizon > purgeDays("CLEANUP_RETENTION_CLOSED_DAYS"),
    `The archive no longer outlives the purge, so the G12 second limb and ` +
      `clause 2.8(b) now describe a defect that does not exist. Rewrite them ` +
      `rather than leaving a legal draft asserting a resolved problem.`
  );
});
