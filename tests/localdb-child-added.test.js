/* tests/localdb-child-added.test.js
 *
 * LocalDB `child_added` semantics (2026-07-21). The Module A patient chat
 * subscribes with ref.on("child_added", cb) and renders ONE bubble per turn
 * snapshot ({role, content, at}). LocalDB used to treat every event name as
 * a whole-path "value" listener, so in LOCAL mode the chat callback received
 * the entire turn MAP (no .role at the top level) and never rendered a
 * bubble — on every viewport. These tests pin the Firebase-compat behaviour
 * the chat needs:
 *
 *   - child_added fires once per NEW child, with a snapshot of that child
 *   - subscribing replays the children that already exist (in key order)
 *   - a child_added callback is never invoked for a non-child write
 *   - "value" listeners keep their existing whole-path behaviour
 *   - off() detaches child_added subscriptions like any other
 */
const { test } = require("node:test");
const assert = require("node:assert");

// localdb.js touches `localStorage` bare — give Node a minimal in-memory one
// BEFORE requiring the module (its methods resolve the global at call time).
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

test("child_added fires once per pushed child with a single-child snapshot", async () => {
  const db = freshDB();
  const seen = [];
  db.ref("sessions/abc/rooms/Room 1/moduleA/chat").on("child_added", (snap) => {
    seen.push(snap.val());
  });
  assert.strictEqual(seen.length, 0, "no children yet — no callbacks");

  const chat = db.ref("sessions/abc/rooms/Room 1/moduleA/chat");
  await chat.push({ role: "user", content: "Where does it hurt?", at: 1 });
  await chat.push({ role: "assistant", content: "My lower back.", at: 2 });

  assert.strictEqual(seen.length, 2, "one callback per pushed turn");
  assert.deepStrictEqual(
    seen.map((t) => t && t.role),
    ["user", "assistant"],
    "each snapshot is the SINGLE turn, not the whole chat map"
  );
  assert.strictEqual(seen[0].content, "Where does it hurt?");
});

test("subscribing replays existing children in key order", async () => {
  const db = freshDB();
  const chat = db.ref("s/chat");
  await chat.child("-a1").set({ role: "user", content: "q1" });
  await chat.child("-b2").set({ role: "assistant", content: "r1" });

  const seen = [];
  db.ref("s/chat").on("child_added", (snap) => seen.push(snap.val().content));
  assert.deepStrictEqual(seen, ["q1", "r1"], "existing turns replay on subscribe");

  await chat.push({ role: "user", content: "q2" });
  assert.deepStrictEqual(seen, ["q1", "r1", "q2"], "later pushes still fire");
});

test("a child_added callback ignores writes elsewhere in the tree", async () => {
  const db = freshDB();
  const seen = [];
  db.ref("s/chat").on("child_added", (snap) => seen.push(snap.val()));
  await db.ref("s/score/auto/x").set({ points: 4 });
  assert.strictEqual(seen.length, 0, "unrelated write must not fire chat child_added");
});

test("re-setting an existing child does not re-fire child_added", async () => {
  const db = freshDB();
  const chat = db.ref("s/chat");
  const seen = [];
  chat.on("child_added", (snap) => seen.push(snap.val().content));
  await chat.child("-k1").set({ role: "user", content: "v1" });
  await chat.child("-k1").set({ role: "user", content: "v2" });
  assert.deepStrictEqual(seen, ["v1"], "an updated child is not a NEW child");
});

test("snapshot exposes .key like the Firebase compat API", async () => {
  const db = freshDB();
  const chat = db.ref("s/chat");
  const keys = [];
  chat.on("child_added", (snap) => keys.push(snap.key));
  await chat.child("-kA").set({ role: "user", content: "x" });
  assert.deepStrictEqual(keys, ["-kA"]);
});

test("value listeners keep whole-path semantics", async () => {
  const db = freshDB();
  const vals = [];
  db.ref("s/chat").on("value", (snap) => vals.push(snap.val()));
  assert.strictEqual(vals.length, 1, "value fires immediately on subscribe");
  assert.strictEqual(vals[0], null);
  await db.ref("s/chat").push({ role: "user", content: "q" });
  const last = vals[vals.length - 1];
  const kids = Object.keys(last || {});
  assert.strictEqual(kids.length, 1, "value listener still sees the whole map");
  assert.strictEqual(last[kids[0]].role, "user");
});

test("a re-entrant push from inside a child_added callback neither drops nor duplicates", async () => {
  // The subtlest part of _deliver: `seen` is marked BEFORE the callback runs,
  // so a callback that writes (re-entrant _write → nested _notifyAll) must
  // not re-deliver the child being handled, and the child it pushes must
  // arrive exactly once.
  const db = freshDB();
  const chat = db.ref("s/chat");
  const seen = [];
  chat.on("child_added", (snap) => {
    const t = snap.val();
    seen.push(t.content);
    if (t.content === "q1") chat.child("-reply").set({ role: "assistant", content: "r1" });
  });
  await chat.child("-q").set({ role: "user", content: "q1" });
  assert.deepStrictEqual(seen.sort(), ["q1", "r1"], "each turn delivered exactly once");
});

test("off() detaches child_added subscriptions", async () => {
  const db = freshDB();
  const chat = db.ref("s/chat");
  const seen = [];
  chat.on("child_added", (snap) => seen.push(snap.val()));
  chat.off();
  await db.ref("s/chat").push({ role: "user", content: "q" });
  assert.strictEqual(seen.length, 0, "no callback after off()");
});
