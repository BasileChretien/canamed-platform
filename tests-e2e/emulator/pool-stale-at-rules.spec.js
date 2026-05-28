/* tests-e2e/emulator/pool-stale-at-rules.spec.js
 *
 * Regression test for the start-session PERMISSION_DENIED bug.
 *
 * The pool/$clientId .validate enforces an `at` freshness window
 * (at >= now - 120000 — joined within 2 minutes). Because RTDB re-validates
 * the WHOLE parent object when any child is written, the facilitator's
 * "assign room" write (pool/$clientId/room, done by Start) re-checked the
 * participant's ORIGINAL join timestamp. Any session where participants
 * waited >2 min before Start was therefore un-startable, failing with
 * PERMISSION_DENIED — and retrying only aged `at` further.
 *
 * The fix gates the freshness window behind "at is actually being written":
 *   (data.child('at').val() == newData.child('at').val() || <fresh window>)
 * so assigning a room (which doesn't touch `at`) passes regardless of age,
 * while join/heartbeat (which DO set `at`) still require a recent timestamp.
 *
 * This test proves BOTH halves against the real emulator rules:
 *   1. FIX — a room can be assigned to a participant whose join is >2 min
 *      stale (this is exactly what failed before; it must now be ALLOWED).
 *   2. PRESERVED — writing a NEW pool entry with a stale `at` is still
 *      DENIED, so the anti-abuse intent of the window is intact.
 */

// @ts-check
const { test, expect, PROJECT } = require("./fixtures.js");

const EMU_DB = "http://127.0.0.1:9000";
const NS = PROJECT + "-default-rtdb";

/* Wait for the app's anonymous sign-in so writes carry an auth.uid. */
async function waitForUid(page) {
  await page.waitForFunction(() => {
    try { return !!(window.firebase && firebase.auth && firebase.auth().currentUser); }
    catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* Write through the REAL rules; resolves "ALLOWED" or the denial code. */
function tryWrite(page, path, value) {
  return page.evaluate(async ({ p, v }) => {
    try { await firebase.database().ref(p).set(v); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, { p: path, v: value });
}

/* Seed data bypassing security rules via the emulator admin REST (the
   literal `owner` token grants admin access in the RTDB emulator). Lets us
   create a genuinely >2-min-stale pool entry, which the client rules — by
   design — refuse to write directly. */
function adminPut(page, path, value) {
  return page.evaluate(async ({ url, v }) => {
    const r = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v)
    });
    return r.status;
  }, { url: `${EMU_DB}/${path}.json?ns=${NS}&access_token=owner`, v: value });
}

/* Admin-bypass read (the room read is otherwise membership-gated; this test
   client seeded the entry directly and never joined as a member). */
function adminGet(page, path) {
  return page.evaluate(async (url) => {
    const r = await fetch(url);
    return r.ok ? await r.json() : ("HTTP " + r.status);
  }, `${EMU_DB}/${path}.json?ns=${NS}&access_token=owner`);
}

test("rules: a room can be assigned to a participant whose join is >2 min stale", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  expect(uid).toBeTruthy();

  const code = "stale-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const cid = "c_" + Math.floor(Math.random() * 1e9);
  const staleAt = Date.now() - 3 * 60 * 1000; // 3 minutes ago — well outside the 2-min window

  // Seed a pool entry whose `at` is 3 min old (admin REST, rules bypassed —
  // the client rules would refuse this exact write, which is the point).
  const seed = await adminPut(page, `sessions/${code}/pool/${cid}`, {
    name: "Bob", university: "Caen", year: 7, english: "C2", at: staleAt
  });
  expect(seed, "admin seed of stale pool entry").toBeGreaterThanOrEqual(200);
  expect(seed).toBeLessThan(300);

  // THE FIX: assign the room as a normal authed client. The room write does
  // not touch `at`, so the gated validate passes via data.at == newData.at —
  // even though `at` is 3 min stale. Under the old rule this was DENIED.
  const assign = await tryWrite(page, `sessions/${code}/pool/${cid}/room`, "Room 1");
  expect(assign, "assign room to a stale-join participant").toBe("ALLOWED");

  // Confirm it actually landed (admin read — client read is membership-gated).
  const room = await adminGet(page, `sessions/${code}/pool/${cid}/room`);
  expect(room).toBe("Room 1");
});

test("rules: a NEW pool entry with a stale `at` is still rejected (freshness preserved)", async ({ page }) => {
  await page.goto("/");
  await waitForUid(page);

  const code = "fresh-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const cid = "c_" + Math.floor(Math.random() * 1e9);
  const staleAt = Date.now() - 3 * 60 * 1000;

  // A brand-new join carrying a backdated `at` (data.at is null, so it can't
  // match newData.at) must still hit the freshness window → DENIED.
  const join = await tryWrite(page, `sessions/${code}/pool/${cid}`, {
    name: "Mallory", university: "Caen", year: 3, english: "B1", at: staleAt
  });
  expect(join).not.toBe("ALLOWED");
  expect(String(join)).toMatch(/permission_denied|denied/i);

  // And a fresh `at` on the same join IS allowed (sanity: we didn't break join).
  const freshJoin = await tryWrite(page, `sessions/${code}/pool/${cid}`, {
    name: "Mallory", university: "Caen", year: 3, english: "B1", at: Date.now()
  });
  expect(freshJoin).toBe("ALLOWED");
});
