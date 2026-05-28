/* tests-e2e/emulator/rules-smoke.spec.js
 *
 * Smoke test against the REAL Firebase emulators (RTDB + Auth), exercising
 * database.rules.json end-to-end — the gap the LOCAL-mode suite can't cover.
 *
 * This is the test that would have caught the clientMapping regression
 * (PR #30) before merge: the participant join writes members/$uid +
 * clientMapping/$clientId + pool/$clientId, all gated by the real rules.
 *
 * Two checks:
 *   1. POSITIVE — a facilitator creates a session, a participant joins, the
 *      admin sees the head-count, and an Advance propagates. Every step is a
 *      real rules-gated read/write; if a rule breaks the flow, this fails.
 *   2. NEGATIVE — a write to a path the rules deny (the locked-down root)
 *      is rejected with PERMISSION_DENIED. Proves the emulator is actually
 *      enforcing the rules (guards against a rule accidentally opened to
 *      `true`, or the emulator running rule-less).
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");

// Auto-accept the in-page confirm modal that Start/Advance open.
async function installModalAutoAccept(page) {
  await page.addInitScript(() => {
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg) new MutationObserver(tryAccept)
        .observe(dlg, { attributes: true, attributeFilter: ["open"] });
      setInterval(tryAccept, 200);
    });
  });
}

test("rules: create → join → advance round-trips through the real emulator", async ({ page, context }) => {
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);

  // ---- Facilitator: create a session (writes created/label/scenario/hash) ----
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("rules-smoke");
  await page.locator("#splash-create-pass").fill("emu-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

  // ---- Participant: join in a second tab (writes members + clientMapping + pool) ----
  const tab2 = await context.newPage();
  await useEmulator(tab2);
  tab2.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await tab2.goto("/");
  await tab2.locator("#splash-code").fill(code);
  await tab2.locator("#splash-enter").click();
  await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await tab2.locator("#name-input").fill("Emu Student");
  const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab2.locator("#uni-input").selectOption(uni);
  await tab2.locator("#consent-workshop").check();
  const joinBtn = tab2.locator("#join-btn");
  await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
  await joinBtn.click();
  await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 15_000 });

  // ---- Admin sees the participant (real cross-tab read of pool under rules) ----
  await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 15_000 });

  // ---- Start + advance: stage writes are admin-gated; participant follows ----
  await page.locator("#start-session-btn").click();
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 20_000 });

  const adv = () => page.getByRole("button", { name: /^Advance\s*→?$/ }).first();
  if (await adv().count()) {
    await adv().click();
    await expect(tab2.locator("#stage-indicator")).toContainText(/Stage 2/i, { timeout: 15_000 });
  }
});

/* Wait until the app has finished its anonymous sign-in so a write carries
   an auth.uid. Returns the signed-in uid. */
async function waitForUid(page) {
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* Attempt a write through the REAL rules; resolves "ALLOWED" or the
   PERMISSION_DENIED code/message. */
function tryWrite(page, path, value) {
  return page.evaluate(async ({ p, v }) => {
    try {
      await firebase.database().ref(p).set(v);
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  }, { p: path, v: value });
}

test("rules: FINDING-01 — a peer cannot overwrite a ballot bound to another stableId", async ({ page, browser }) => {
  // Unique session/key per run: stableIdMapping is write-once, so reusing a
  // key across runs (with a different uid) would spuriously fail.
  const code = "rul-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const room = "Room 1";
  const voteId = "d1";
  const victimKey = "s_victim_" + Math.floor(Math.random() * 1e9); // owner A's stableId
  const attackerKey = "s_attacker_" + Math.floor(Math.random() * 1e9);
  const ballotPath = (k) =>
    `sessions/${code}/rooms/${room}/votes/${voteId}/ballots/${k}`;
  const bindPath = (k) => `sessions/${code}/stableIdMapping/${k}`;

  // ---- Owner A ----
  await page.goto("/");
  const uidA = await waitForUid(page);

  // A joins as a member so the membership-gated session .read (R2-09) lets
  // A read its own ballot back at the end; this also mirrors a real voter.
  expect(await tryWrite(page, `sessions/${code}/members/${uidA}`, { at: Date.now() }))
    .toBe("ALLOWED");

  // A binds its stableId (write-once, value must equal auth.uid) then casts.
  expect(await tryWrite(page, bindPath(victimKey), uidA)).toBe("ALLOWED");
  expect(await tryWrite(page, ballotPath(victimKey), { choice: 1, at: Date.now() }))
    .toBe("ALLOWED");

  // ---- Peer B (a second anonymous uid) ----
  // A fresh, isolated context — NOT context.newPage() — so B gets its own
  // empty storage and signs in as a DISTINCT anonymous user (a new page in
  // the same context would reuse A's persisted anonymous session).
  const ctxB = await browser.newContext();
  const tab2 = await ctxB.newPage();
  await useEmulator(tab2);
  await tab2.goto("/");
  const uidB = await waitForUid(tab2);
  expect(uidB).not.toBe(uidA); // distinct anonymous identities

  // B tries to overwrite A's claimed ballot → DENIED (the FINDING-01 fix).
  const overwrite = await tryWrite(tab2, ballotPath(victimKey), { choice: 9, at: Date.now() });
  expect(overwrite).not.toBe("ALLOWED");
  expect(String(overwrite)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);

  // B tries to steal the binding itself → DENIED (write-once).
  const rebind = await tryWrite(tab2, bindPath(victimKey), uidB);
  expect(rebind).not.toBe("ALLOWED");

  // But B CAN cast under its own unclaimed key (first-write tolerance keeps
  // the happy path working before the binding round-trips).
  expect(await tryWrite(tab2, ballotPath(attackerKey), { choice: 2, at: Date.now() }))
    .toBe("ALLOWED");

  // And A's ballot is unchanged (B's overwrite never landed).
  const finalChoice = await page.evaluate(async (p) => {
    const snap = await firebase.database().ref(p).get();
    return snap.val() && snap.val().choice;
  }, ballotPath(victimKey));
  expect(finalChoice).toBe(1);

  await ctxB.close();
});

test("rules: FINDING-07 — admin hash is unreadable; login verifies by proof-write", async ({ page }) => {
  const code = "sec-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const realHash = "v2$100000$" + "ab".repeat(32);   // 64 hex → valid envelope
  const wrongHash = "v2$100000$" + "cd".repeat(32);

  await page.goto("/");
  const uid = await waitForUid(page);
  // Join as a member — proves the oracle is closed even for session members.
  expect(await tryWrite(page, `sessions/${code}/members/${uid}`, { at: Date.now() }))
    .toBe("ALLOWED");

  // The real hash is stored in adminSecrets (write-once, allowed first time).
  expect(await tryWrite(page, `adminSecrets/${code}/hash`, realHash)).toBe("ALLOWED");

  // It is UNREADABLE — a member's read is denied (no .read on adminSecrets).
  const readBack = await page.evaluate(async (p) => {
    try { const s = await firebase.database().ref(p).get(); return "READ:" + JSON.stringify(s.val()); }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, `adminSecrets/${code}/hash`);
  expect(readBack).not.toContain("READ:");
  expect(String(readBack)).toMatch(/permission_denied|denied/i);

  // Proof-write with the CORRECT hash → allowed (verification succeeds).
  expect(await tryWrite(page, `adminSecrets/${code}/proof/${uid}`, realHash)).toBe("ALLOWED");

  // Proof-write with a WRONG hash → denied (wrong password).
  const wrong = await tryWrite(page, `adminSecrets/${code}/proof/${uid}`, wrongHash);
  expect(wrong).not.toBe("ALLOWED");
  expect(String(wrong)).toMatch(/permission_denied|denied/i);

  // Hash is write-once: overwrite without a fresh _superadminReset is denied.
  const overwrite = await tryWrite(page, `adminSecrets/${code}/hash`, wrongHash);
  expect(overwrite).not.toBe("ALLOWED");
});

test("rules: a participant can save a Module B Phase-3 exchange reply, with validation enforced", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  const code = "exr-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const path = `sessions/${code}/rooms/Room 1/moduleB/exchangeReplies/0/${uid}`;

  // A well-formed group note for the current prompt is allowed (mirrors the
  // proven moduleA/promptReplies rule).
  expect(await tryWrite(page, path, {
    text: "In France the patient is told first; in Japan the family is often told first.",
    by: "Emu Student", cid: uid, at: Date.now()
  })).toBe("ALLOWED");

  // Empty text is rejected (.validate requires length > 0).
  const empty = await tryWrite(page, path, { text: "", by: "Emu", cid: uid, at: Date.now() });
  expect(empty).not.toBe("ALLOWED");

  // Over-long text (> 600) is rejected.
  const long = await tryWrite(page, path, { text: "x".repeat(601), by: "Emu", cid: uid, at: Date.now() });
  expect(long).not.toBe("ALLOWED");

  // Clearing the note (null) is allowed — that's how the autosave deletes.
  expect(await tryWrite(page, path, null)).toBe("ALLOWED");
});

test("rules: a write to a denied path is rejected (rules ARE enforced)", async ({ page }) => {
  await page.goto("/");
  // Wait for the app to finish anonymous sign-in so a write is even attempted.
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });

  // The root is `.read:false / .write:false`; a write to an unmatched
  // top-level key MUST be denied. If this resolves "ALLOWED", either the
  // emulator is running rule-less or a rule was opened to `true`.
  const result = await page.evaluate(async () => {
    try {
      await firebase.database().ref("/__attack_probe").set({ x: Date.now() });
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  });
  expect(result).not.toBe("ALLOWED");
  expect(String(result)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
});
