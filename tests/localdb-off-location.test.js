/* tests/localdb-off-location.test.js
 *
 * LocalDB `off()` acts on the LOCATION, as Firebase's does (2026-10-14).
 *
 * In the Firebase SDK a listener is registered against a location, not against
 * the Reference object it was attached through, so:
 *   - off() with no arguments removes EVERY callback at that location,
 *     whichever Reference registered it;
 *   - off(event) removes every callback for that event there;
 *   - off(event, cb) removes that callback's first registration there.
 *
 * LocalDB used to remove only the callbacks attached through the Reference
 * that off() was called on. That difference hid a defect from the whole LOCAL
 * suite: teardownRoom() called `refLeaderboard.off()` on `rooms`, the location
 * the facilitator's dashboard listens on (refRooms, script-admin.js). In shared
 * mode that removed the dashboard's listener, and the dashboard stopped
 * updating after the facilitator had opened a room and come back; in LOCAL
 * mode the dashboard's listener survived, so every LOCAL spec stayed green on
 * the defect (measured 2026-10-14). The emulator spec
 * tests-e2e/emulator/dashboard-after-room-visit-sdk.spec.js is the SDK-backed
 * guard; these tests pin the LocalDB half, so the LOCAL specs can see the same
 * class of bug on every device.
 */
const { test } = require("node:test");
const assert = require("node:assert");

function freshLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}
global.localStorage = freshLocalStorage();

const { LocalDB } = require("../docs/Third_session/PBL_platform/localdb.js");

function freshDB() {
  global.localStorage = freshLocalStorage();
  return new LocalDB();
}

/* Calls after the initial delivery: what a write makes each listener see. */
function counter() {
  const c = { n: 0 };
  c.cb = () => { c.n++; };
  return c;
}

test("off() with no arguments removes the callbacks another Reference attached at the same location", async () => {
  const db = freshDB();
  const dashboard = counter();
  db.ref("s/rooms").on("value", dashboard.cb);        // refRooms
  const leaderboard = db.ref("s/rooms");              // refLeaderboard, a second Reference
  leaderboard.off();
  dashboard.n = 0;
  await db.ref("s/rooms/Room 1/stage").set(1);
  assert.strictEqual(dashboard.n, 0, "Firebase removes every callback at the location, not only this Reference's");
});

test("off(event, cb) leaves the other callbacks at the location — the dashboard keeps its listener", async () => {
  const db = freshDB();
  const dashboard = counter();
  const leaderboard = counter();
  db.ref("s/rooms").on("value", dashboard.cb);
  const lbRef = db.ref("s/rooms");
  lbRef.on("value", leaderboard.cb);
  lbRef.off("value", leaderboard.cb);
  dashboard.n = 0; leaderboard.n = 0;
  await db.ref("s/rooms/Room 1/callForHelp").set({ by: "x", at: 1 });
  assert.strictEqual(leaderboard.n, 0, "the detached callback is gone");
  assert.strictEqual(dashboard.n, 1, "the other one still hears the write");
});

test("off(event, cb) through another Reference to the same location removes it", async () => {
  const db = freshDB();
  const c = counter();
  db.ref("s/rooms").on("value", c.cb);
  db.ref("s/rooms").off("value", c.cb);
  c.n = 0;
  await db.ref("s/rooms/Room 1/stage").set(2);
  assert.strictEqual(c.n, 0);
});

test("off() leaves the callbacks at other locations, above and below", async () => {
  const db = freshDB();
  const parent = counter();
  const child = counter();
  db.ref("s").on("value", parent.cb);
  db.ref("s/rooms/Room 1").on("value", child.cb);
  db.ref("s/rooms").on("value", () => {});
  db.ref("s/rooms").off();
  parent.n = 0; child.n = 0;
  await db.ref("s/rooms/Room 1/stage").set(1);
  assert.strictEqual(parent.n, 1, "the parent's listener stays");
  assert.strictEqual(child.n, 1, "the child's listener stays");
});

test("off(event, cb) for one event leaves the other events at the location", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ content: "q" });
  const chat = db.ref("r/chat");
  const added = counter();
  const removed = counter();
  chat.on("child_added", added.cb);
  chat.on("child_removed", removed.cb);
  chat.off("child_added", added.cb);
  added.n = 0;
  await db.ref("r/chat/k1").remove();
  await db.ref("r/chat/k2").set({ content: "a" });
  assert.strictEqual(removed.n, 1, "child_removed is still attached");
  assert.strictEqual(added.n, 0, "child_added is not");
});

test("off(event) removes every callback for that event, and only that event", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ content: "q" });
  const a = counter(), b = counter(), removed = counter();
  db.ref("r/chat").on("value", a.cb);
  db.ref("r/chat").on("value", b.cb);
  db.ref("r/chat").on("child_removed", removed.cb);
  db.ref("r/chat").off("value");
  a.n = 0; b.n = 0;
  await db.ref("r/chat/k1").remove();
  assert.strictEqual(a.n + b.n, 0, "no value callback left");
  assert.strictEqual(removed.n, 1, "the child_removed callback stays");
});

test("a callback attached twice needs two off(event, cb) calls, as in Firebase", async () => {
  const db = freshDB();
  const c = counter();
  const ref = db.ref("s/x");
  ref.on("value", c.cb);
  ref.on("value", c.cb);
  ref.off("value", c.cb);
  c.n = 0;
  await db.ref("s/x").set(1);
  assert.strictEqual(c.n, 1, "one registration is left");
  ref.off("value", c.cb);
  c.n = 0;
  await db.ref("s/x").set(2);
  assert.strictEqual(c.n, 0, "and the second call removes it");
});
