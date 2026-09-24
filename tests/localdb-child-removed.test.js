/* tests/localdb-child-removed.test.js
 *
 * LocalDB `child_removed` semantics (2026-09-24). The Module A chat now
 * listens for child_removed so a turn the store TAKES BACK leaves the screen.
 * In production that is how a rules-refused write ends: the RTDB web SDK
 * applies the write locally first (child_added) and reverts it when the server
 * refuses (child_removed). Probed against the emulator on 2026-09-24 with the
 * chat's own write pattern — update() refused, then the fallback set()
 * refused — and the listener saw:
 *
 *   added:mail, removed:mail, added:mail, removed:mail
 *
 * LocalDB used to model only "value" and "child_added", and child_added's
 * `seen` set only ever grew, so a child removed and re-added under the same
 * key never re-fired. These tests pin the Firebase behaviour LOCAL mode (and
 * so every chat e2e) now reproduces:
 *
 *   - child_removed fires once per removed child, with that child's last value
 *   - subscribing does NOT fire it for children that exist
 *   - writes that remove nothing never invoke it
 *   - removing a whole list fires it per child
 *   - a child removed then re-added under the SAME key fires child_added again
 *   - off() detaches it like any other subscription
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

test("child_removed fires once per removed child, with its last value", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ role: "user", content: "q" });
  await db.ref("r/chat/k2").set({ role: "assistant", content: "a" });
  const removed = [];
  db.ref("r/chat").on("child_removed", (snap) => removed.push([snap.key, snap.val()]));
  await db.ref("r/chat/k2").remove();
  assert.deepStrictEqual(removed, [["k2", { role: "assistant", content: "a" }]]);
  await db.ref("r/chat/k2").remove();          // already gone — nothing more
  assert.strictEqual(removed.length, 1);
});

test("subscribing does not fire child_removed for existing children", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ content: "q" });
  let calls = 0;
  db.ref("r/chat").on("child_removed", () => { calls++; });
  assert.strictEqual(calls, 0);
});

test("writes that remove nothing never invoke child_removed", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ content: "q" });
  let calls = 0;
  db.ref("r/chat").on("child_removed", () => { calls++; });
  await db.ref("r/chat/k2").set({ content: "new child" });
  await db.ref("r/chat/k1").set({ content: "edited" });
  await db.ref("elsewhere/x").set(1);
  assert.strictEqual(calls, 0);
});

test("removing the whole list fires child_removed per child", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ content: "q" });
  await db.ref("r/chat/k2").set({ content: "a" });
  const keys = [];
  db.ref("r/chat").on("child_removed", (snap) => keys.push(snap.key));
  await db.ref("r/chat").remove();
  assert.deepStrictEqual(keys.sort(), ["k1", "k2"]);
});

test("a child removed then re-added under the same key fires child_added again (the refused-write revert, twice)", async () => {
  const db = freshDB();
  const ev = [];
  const ref = db.ref("r/chat");
  ref.on("child_added", (snap) => ev.push("added:" + snap.key));
  ref.on("child_removed", (snap) => ev.push("removed:" + snap.key));
  for (let i = 0; i < 2; i++) {
    await db.ref("r/chat/k1").set({ content: "refused" });
    await db.ref("r/chat/k1").remove();
  }
  assert.deepStrictEqual(ev, ["added:k1", "removed:k1", "added:k1", "removed:k1"],
    "the sequence the emulator produced for a refused update() then a refused set()");
});

test("off() detaches child_removed subscriptions", async () => {
  const db = freshDB();
  await db.ref("r/chat/k1").set({ content: "q" });
  const ref = db.ref("r/chat");
  let calls = 0;
  ref.on("child_removed", () => { calls++; });
  ref.off();
  await db.ref("r/chat/k1").remove();
  assert.strictEqual(calls, 0);
});
