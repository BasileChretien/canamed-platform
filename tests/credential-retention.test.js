"use strict";
/* Tests for certificate-record retention (Annex VI item G6).
 *
 * This is the decision layer of a job that PERMANENTLY DELETES public
 * certificate records, so the tests are weighted towards what must NOT be
 * deleted. An over-eager retention job destroys the very records a participant
 * was promised would remain verifiable, and there is no undo.
 */

const test = require("node:test");
const assert = require("node:assert");
const {
  credentialVerdict, partitionCredentials, pruneExpiredCredentials
} = require("../scripts/lib/credential-retention");

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;          // fixed: Date.now() must not leak in
const FIVE_Y = 1826 * DAY;

const rec = (o) => Object.assign({ nameHash: "a".repeat(64), session: "ABC12" }, o);

/* ---- retentionUntil is authoritative ---------------------------------- */

test("retentionUntil in the past expires; in the future it does not", () => {
  assert.strictEqual(
    credentialVerdict(rec({ retentionUntil: NOW - 1 }), NOW, FIVE_Y).expired, true);
  assert.strictEqual(
    credentialVerdict(rec({ retentionUntil: NOW + 1 }), NOW, FIVE_Y).expired, false);
  // Boundary: due exactly now IS expired (<=), so a record cannot sit forever
  // one millisecond short of its own deadline.
  assert.strictEqual(
    credentialVerdict(rec({ retentionUntil: NOW }), NOW, FIVE_Y).expired, true);
});

test("retentionUntil WINS over `at` — the fallback must not override it", () => {
  // Written 10 years ago (long past the fallback window) but explicitly retained
  // for another year. It must survive: retentionUntil is what the participant
  // was told and what the rules capped.
  const v = credentialVerdict(
    rec({ at: NOW - 3650 * DAY, retentionUntil: NOW + 365 * DAY }), NOW, FIVE_Y);
  assert.strictEqual(v.expired, false);
  assert.strictEqual(v.basis, "retentionUntil");
});

/* ---- the `at` fallback ------------------------------------------------- */

test("no retentionUntil falls back to at + window", () => {
  const old = credentialVerdict(rec({ at: NOW - (1826 + 1) * DAY }), NOW, FIVE_Y);
  assert.strictEqual(old.expired, true);
  assert.strictEqual(old.basis, "at");

  const young = credentialVerdict(rec({ at: NOW - 10 * DAY }), NOW, FIVE_Y);
  assert.strictEqual(young.expired, false);
  assert.strictEqual(young.basis, "at");
});

/* ---- everything below is about NOT deleting ---------------------------- */

test("an undated record is NEVER expired, however it is malformed", () => {
  // The dangerous alternative is treating a missing date as infinitely old,
  // which deletes precisely the records we understand least. The rules do not
  // require retentionUntil, so these can legitimately exist.
  for (const r of [
    rec({}),
    rec({ at: null, retentionUntil: null }),
    rec({ at: "1760000000000" }),            // string, not number
    rec({ retentionUntil: "soon" }),
    rec({ at: 0, retentionUntil: 0 }),
    rec({ at: -5 }),
    rec({ at: NaN }),
    rec({ at: Infinity }),
    rec({ retentionUntil: {} }),
    rec({ retentionUntil: [] })
  ]) {
    const v = credentialVerdict(r, NOW, FIVE_Y);
    assert.strictEqual(v.expired, false, "must keep: " + JSON.stringify(r));
    assert.strictEqual(v.basis, "none");
  }
});

test("a non-record value is never expired", () => {
  for (const r of [null, undefined, "string", 42, true, []]) {
    // [] is an object but has no usable dates, so it lands in the same place.
    assert.strictEqual(credentialVerdict(r, NOW, FIVE_Y).expired, false, String(r));
  }
});

test("partition reports undated separately, and counts as a subset of kept", () => {
  const all = {
    "CNM-AAAAA-AAAAA": rec({ retentionUntil: NOW - DAY }),      // expired
    "CNM-BBBBB-BBBBB": rec({ retentionUntil: NOW + DAY }),      // kept
    "CNM-CCCCC-CCCCC": rec({ at: NOW - 3000 * DAY }),           // expired via fallback
    "CNM-DDDDD-DDDDD": rec({}),                                 // undated -> kept
    "CNM-EEEEE-EEEEE": rec({ at: "nope" })                      // undated -> kept
  };
  const p = partitionCredentials(all, NOW, FIVE_Y);
  assert.deepStrictEqual(p.expired.sort(), ["CNM-AAAAA-AAAAA", "CNM-CCCCC-CCCCC"]);
  assert.strictEqual(p.kept.length, 3);
  assert.deepStrictEqual(p.undated.sort(), ["CNM-DDDDD-DDDDD", "CNM-EEEEE-EEEEE"]);
  for (const id of p.undated) assert.ok(p.kept.includes(id), "undated must also be kept");
});

test("an empty or absent credentials tree is a no-op, not a crash", () => {
  for (const v of [null, undefined, {}]) {
    const p = partitionCredentials(v, NOW, FIVE_Y);
    assert.deepStrictEqual(p, { expired: [], kept: [], undated: [] });
  }
});

/* ---- the I/O layer, against a fake db --------------------------------- */

function fakeDb(credentials) {
  const removed = [];
  return {
    removed,
    ref(path) {
      return {
        once: async () => ({ val: () => (path === "credentials" ? credentials : null) }),
        remove: async () => { removed.push(path); }
      };
    }
  };
}

test("DRY-RUN deletes nothing but still reports what would go", async () => {
  const db = fakeDb({
    "CNM-AAAAA-AAAAA": rec({ retentionUntil: NOW - DAY }),
    "CNM-BBBBB-BBBBB": rec({ retentionUntil: NOW + DAY })
  });
  const res = await pruneExpiredCredentials(db, { nowMs: NOW, fallbackMs: FIVE_Y, confirm: false });
  assert.deepStrictEqual(db.removed, [], "dry-run must not touch the database");
  assert.strictEqual(res.expired, 1);
  assert.strictEqual(res.deleted, 0);
  assert.strictEqual(res.kept, 1);
});

test("CONFIRM deletes exactly the expired ids, by full path", async () => {
  const db = fakeDb({
    "CNM-AAAAA-AAAAA": rec({ retentionUntil: NOW - DAY }),
    "CNM-BBBBB-BBBBB": rec({ retentionUntil: NOW + DAY }),
    "CNM-CCCCC-CCCCC": rec({})                                  // undated: survives
  });
  const res = await pruneExpiredCredentials(db, { nowMs: NOW, fallbackMs: FIVE_Y, confirm: true });
  assert.deepStrictEqual(db.removed, ["credentials/CNM-AAAAA-AAAAA"]);
  assert.strictEqual(res.deleted, 1);
  assert.strictEqual(res.undated, 1);
});

test("a failing delete is counted, and does not abort the remaining ones", async () => {
  const removed = [];
  const db = {
    ref(path) {
      return {
        once: async () => ({
          val: () => ({
            "CNM-AAAAA-AAAAA": rec({ retentionUntil: NOW - DAY }),
            "CNM-BBBBB-BBBBB": rec({ retentionUntil: NOW - DAY })
          })
        }),
        remove: async () => {
          if (path.endsWith("CNM-AAAAA-AAAAA")) throw new Error("permission denied");
          removed.push(path);
        }
      };
    }
  };
  const res = await pruneExpiredCredentials(db, { nowMs: NOW, fallbackMs: FIVE_Y, confirm: true });
  assert.strictEqual(res.errors, 1);
  assert.strictEqual(res.deleted, 1);
  assert.deepStrictEqual(removed, ["credentials/CNM-BBBBB-BBBBB"],
    "the second deletion must still run after the first fails");
});
