/* Unit tests for LocalDB's Firebase DataSnapshot compat surface —
 * specifically snapshot.forEach(child), added because script.js's
 * listMyScenarios / listSharedScenarios (and scenario-author-cloud.js's
 * openLoadFromCloud) iterate `snap.forEach(child => ...)` and LOCAL mode
 * previously threw "snap.forEach is not a function", silently emptying
 * the shared-scenarios picker.
 *
 * Compat contract under test (mirrors the real RTDB compat SDK):
 *   - snapshots are { key, val(), forEach(cb) };
 *   - forEach visits children as nested snapshots in Firebase key order
 *     (non-negative-integer keys first, numeric ascending, then the rest
 *     lexicographically);
 *   - a truthy return from cb stops iteration and forEach returns true;
 *   - leaves (scalars / null) have no children → no-op, returns false.
 */

const test = require("node:test");
const assert = require("node:assert");

// localdb.js talks to localStorage inside try/catch; give it a real
// in-memory shim so writes actually persist within the test process.
global.localStorage = {
  _s: Object.create(null),
  getItem(k) { return k in this._s ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; }
};

const { LocalDB, LOCALDB_KEY } =
  require("../docs/Third_session/PBL_platform/localdb.js");

function freshDb() {
  global.localStorage.removeItem(LOCALDB_KEY);
  return new LocalDB();
}

test("once() snapshot exposes key, val() and forEach over children", async () => {
  const db = freshDb();
  await db.ref("sharedScenarios/u1_s1").set({ ownerUid: "u1", scenarioId: "s1", meta: { name: "A" } });
  await db.ref("sharedScenarios/u2_s2").set({ ownerUid: "u2", scenarioId: "s2", meta: { name: "B" } });

  const snap = await db.ref("sharedScenarios").once("value");
  assert.strictEqual(snap.key, "sharedScenarios");
  assert.strictEqual(typeof snap.forEach, "function");

  const out = [];
  const stopped = snap.forEach((child) => {
    out.push({ shareId: child.key, ownerUid: (child.val() || {}).ownerUid });
  });
  assert.strictEqual(stopped, false, "full iteration returns false");
  assert.deepStrictEqual(out, [
    { shareId: "u1_s1", ownerUid: "u1" },
    { shareId: "u2_s2", ownerUid: "u2" }
  ]);
});

test("forEach stops early on a truthy callback return and returns true", async () => {
  const db = freshDb();
  await db.ref("list").set({ a: 1, b: 2, c: 3 });

  const seen = [];
  const stopped = (await db.ref("list").once("value")).forEach((child) => {
    seen.push(child.key);
    return seen.length >= 2; // truthy → stop, mirrors Firebase semantics
  });
  assert.strictEqual(stopped, true);
  assert.deepStrictEqual(seen, ["a", "b"]);
});

test("forEach orders keys like Firebase: integer keys numeric-first, then strings", async () => {
  const db = freshDb();
  await db.ref("mixed").set({ b: 1, "10": 2, a: 3, "2": 4 });

  const keys = [];
  (await db.ref("mixed").once("value")).forEach((c) => { keys.push(c.key); });
  assert.deepStrictEqual(keys, ["2", "10", "a", "b"]);
});

test("forEach on a leaf or missing node is a no-op returning false", async () => {
  const db = freshDb();
  await db.ref("leaf").set("scalar");

  let calls = 0;
  const cb = () => { calls++; };
  assert.strictEqual((await db.ref("leaf").once("value")).forEach(cb), false);
  assert.strictEqual((await db.ref("nope").once("value")).forEach(cb), false);
  assert.strictEqual(calls, 0);
});

test("child snapshots handed to forEach support forEach themselves", async () => {
  const db = freshDb();
  await db.ref("outer").set({ inner: { x: 1, y: 2 } });

  const innerKeys = [];
  (await db.ref("outer").once("value")).forEach((child) => {
    assert.strictEqual(child.key, "inner");
    child.forEach((grand) => { innerKeys.push(grand.key + "=" + grand.val()); });
  });
  assert.deepStrictEqual(innerKeys, ["x=1", "y=2"]);
});

test("on('value') snapshots — initial call and change notifications — support forEach", async () => {
  const db = freshDb();
  await db.ref("watched/a").set(1);

  const snaps = [];
  db.ref("watched").on("value", (s) => snaps.push(s));
  await db.ref("watched/b").set(2);

  assert.ok(snaps.length >= 2, "initial call + notify after write");
  for (const s of snaps) {
    assert.strictEqual(typeof s.forEach, "function");
    assert.strictEqual(s.key, "watched");
  }
  const lastKeys = [];
  snaps[snaps.length - 1].forEach((c) => { lastKeys.push(c.key); });
  assert.deepStrictEqual(lastKeys, ["a", "b"]);
});

test("transaction() result snapshot supports forEach", async () => {
  const db = freshDb();
  const res = await db.ref("tx").transaction(() => ({ k1: "v1", k2: "v2" }));
  assert.strictEqual(res.committed, true);

  const keys = [];
  res.snapshot.forEach((c) => { keys.push(c.key); });
  assert.deepStrictEqual(keys, ["k1", "k2"]);
});

test("root snapshot has key null", async () => {
  const db = freshDb();
  await db.ref("top").set(1);
  const snap = await db.ref("/").once("value");
  assert.strictEqual(snap.key, null);
});

test("listSharedScenarios iteration pattern yields picker entries", async () => {
  // Replicates the exact loop from script.js listSharedScenarios(),
  // which previously threw in LOCAL mode.
  const db = freshDb();
  await db.ref("sharedScenarios/owner1_scnA").set({
    ownerUid: "owner1", scenarioId: "scnA", ownerName: "Dr. A", meta: { name: "Shared A" }
  });
  await db.ref("sharedScenarios/owner2_scnB").set({
    ownerUid: "owner2", scenarioId: "scnB", ownerName: "", meta: { name: "Shared B" }
  });

  const snap = await db.ref("sharedScenarios").once("value");
  const out = [];
  snap.forEach((child) => {
    if (out.length >= 200) return true;
    const v = child.val() || {};
    out.push({
      shareId: child.key,
      ownerUid: v.ownerUid || "",
      scenarioId: v.scenarioId || "",
      ownerName: v.ownerName || "",
      meta: v.meta || {}
    });
  });
  assert.deepStrictEqual(out.map((e) => e.shareId), ["owner1_scnA", "owner2_scnB"]);
  assert.deepStrictEqual(out[0].meta, { name: "Shared A" });
  assert.strictEqual(out[1].ownerName, "");
});
