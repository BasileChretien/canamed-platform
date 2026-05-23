/* tests-e2e/emulator/answer-history.spec.js
 *
 * Point 4 (research integrity): editing an answer used to overwrite `text`
 * in place, losing the wording history. editAnswer now snapshots the
 * superseded text into an append-only `edits/$editId` log under the entry.
 *
 * Exercises the REAL database.rules.json via the emulator:
 *   - a participant can create an answer entry and append an edit snapshot
 *   - the snapshot shape is bounded by .validate (an over-long body is
 *     rejected even though the collaborative entry write rule cascades)
 *   - the snapshot is readable back by a session member
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");

async function waitForUid(page) {
  await page.waitForFunction(() => {
    try { return !!(window.firebase && firebase.auth && firebase.auth().currentUser); }
    catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

function tryWrite(page, path, value) {
  return page.evaluate(async ({ p, v }) => {
    try { await firebase.database().ref(p).set(v); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, { p: path, v: value });
}

test("rules: answer edit history is appended + bounded (point 4)", async ({ page }) => {
  const code = "ans-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const entry = `sessions/${code}/rooms/Room 1/answers/moduleA/e1`;

  await page.goto("/");
  const uid = await waitForUid(page);

  // Join as a member so the membership-gated session .read lets us read back.
  expect(await tryWrite(page, `sessions/${code}/members/${uid}`, { at: Date.now() }))
    .toBe("ALLOWED");

  // Create the answer, then append a snapshot of the superseded text.
  expect(await tryWrite(page, entry, { text: "v0", by: "A", cid: "c1", at: Date.now() }))
    .toBe("ALLOWED");
  expect(await tryWrite(page, `${entry}/edits/ed1`, { text: "v0", by: "A", at: Date.now() }))
    .toBe("ALLOWED");

  // Overwrite the live text in place — the current value still moves forward.
  expect(await tryWrite(page, `${entry}/text`, "v1")).toBe("ALLOWED");

  // The .validate cap holds even though write authority cascades from the
  // (collaborative) entry rule: an over-long snapshot body is rejected.
  const tooLong = await tryWrite(page, `${entry}/edits/ed2`,
    { text: "x".repeat(1001), by: "A", at: Date.now() });
  expect(tooLong).not.toBe("ALLOWED");
  expect(String(tooLong)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);

  // The superseded version is recoverable by a member.
  const recovered = await page.evaluate(async (p) => {
    const snap = await firebase.database().ref(p + "/edits/ed1/text").get();
    return snap.val();
  }, entry);
  expect(recovered).toBe("v0");
});
