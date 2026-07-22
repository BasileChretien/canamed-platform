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

  // The real flow claims write-once room membership on entry (script.js
  // enterRoom). The per-room write rules (chat, scoring, hypotheses, replies,
  // score, votes/committed) require it — added 2026-05-30 to stop cross-room
  // tampering. Claim it first, exactly as a participant entering Room 1 does.
  expect(await tryWrite(page, `sessions/${code}/rooms/Room 1/uidMembers/${uid}`, true)).toBe("ALLOWED");

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

test("rules: roleAssign (random role assignment) is member-gated and validates role values", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  const code = "rassign-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const path = `sessions/${code}/rooms/Room 1/moduleB/roleAssign`;

  // A non-member cannot write the draw (the .write rule requires uidMembers).
  expect(await tryWrite(page, path, { assignments: { [uid]: "physician" }, by: uid, at: Date.now() }))
    .not.toBe("ALLOWED");

  // Claim Room 1 membership (as a participant entering the room does), then a
  // well-formed distinct-role draw is allowed.
  expect(await tryWrite(page, `sessions/${code}/rooms/Room 1/uidMembers/${uid}`, true)).toBe("ALLOWED");
  expect(await tryWrite(page, path, {
    assignments: { c1: "physician", c2: "patient", c3: "family", c4: "observer" },
    by: uid, at: Date.now()
  })).toBe("ALLOWED");

  // A bogus role value is rejected by the per-assignment validator.
  expect(await tryWrite(page, path, { assignments: { c1: "wizard" }, by: uid, at: Date.now() }))
    .not.toBe("ALLOWED");

  // An unknown sibling field is rejected ($other sentinel).
  expect(await tryWrite(page, path, {
    assignments: { c1: "physician" }, by: uid, at: Date.now(), evil: "x"
  })).not.toBe("ALLOWED");

  // Clearing the draw (null) is allowed.
  expect(await tryWrite(page, path, null)).toBe("ALLOWED");
});

test("rules: /moduleB/phase accepts the six synced phases (0..5) and rejects 6", async ({ page }) => {
  await page.goto("/");
  await waitForUid(page);
  const code = "mbphase-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const path = `sessions/${code}/rooms/Room 1/moduleB/phase`;
  // Any authed participant can advance the synced phase (no membership gate, like
  // the exchange cursor). Phase 5 (the sixth phase) became valid with the
  // 2026-06-26 swap → replay → reflect extension; 6 is out of range.
  expect(await tryWrite(page, path, 0)).toBe("ALLOWED");
  expect(await tryWrite(page, path, 5)).toBe("ALLOWED");
  expect(await tryWrite(page, path, 6)).not.toBe("ALLOWED");
  expect(await tryWrite(page, path, null)).toBe("ALLOWED");
  // Integer-only: the client floors phase on read, so a fractional value would
  // persist shared state the UI never shows — the rule rejects it.
  expect(await tryWrite(page, path, 2.5)).not.toBe("ALLOWED");
});

test("rules: per-room write gating — a Room 1 member cannot write into Room 2 (cross-room tampering denied)", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  const code = "xroom-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);

  // Become a member of Room 1 only.
  expect(await tryWrite(page, `sessions/${code}/rooms/Room 1/uidMembers/${uid}`, true)).toBe("ALLOWED");

  // Writing into Room 1 (own room) is allowed for every gated path...
  const ok = (p, v) => tryWrite(page, `sessions/${code}/rooms/Room 1/${p}`, v);
  expect(await ok("moduleA/hypotheses/h1", { text: "dx X", by: "S", cid: uid, at: Date.now() })).toBe("ALLOWED");
  expect(await ok("moduleA/promptReplies/0/" + uid, { text: "r", by: "S", cid: uid, at: Date.now() })).toBe("ALLOWED");
  expect(await ok("moduleA/scoring/awarded/fam1", { points: 2, at: Date.now() })).toBe("ALLOWED");
  expect(await ok("score/auto/e1", { points: 3, at: Date.now() })).toBe("ALLOWED");
  expect(await ok("score/penalties/e1", { points: 1, at: Date.now() })).toBe("ALLOWED");
  expect(await ok("votes/v1/committed", { choice: 2, at: Date.now() })).toBe("ALLOWED");

  // ...but the SAME writes targeting Room 2 (where this uid is NOT a member)
  // are all denied. This is the cross-room tampering boundary.
  const x = (p, v) => tryWrite(page, `sessions/${code}/rooms/Room 2/${p}`, v);
  const denied = [
    await x("moduleA/hypotheses/h1", { text: "dx X", by: "S", cid: uid, at: Date.now() }),
    await x("moduleA/promptReplies/0/" + uid, { text: "r", by: "S", cid: uid, at: Date.now() }),
    await x("moduleA/scoring/awarded/fam1", { points: 2, at: Date.now() }),
    await x("moduleB/exchangeReplies/0/" + uid, { text: "r", by: "S", cid: uid, at: Date.now() }),
    await x("score/auto/e1", { points: 999, at: Date.now() }),
    await x("score/penalties/e1", { points: 999, at: Date.now() }),
    await x("votes/v1/committed", { choice: 2, at: Date.now() })
  ];
  for (const r of denied) {
    expect(r).not.toBe("ALLOWED");
    expect(String(r)).toMatch(/permission_denied|denied/i);
  }
});

test("rules: org-scoped adminSecrets — real hash unreadable; proof-write verifies; write-once (D1)", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  const slug = "org" + Math.floor(Math.random() * 1e6);
  const sid = "os-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const hashPath = `adminSecrets/orgs/${slug}/${sid}/hash`;
  const proofPath = `adminSecrets/orgs/${slug}/${sid}/proof/${uid}`;
  const realHash = "a".repeat(64);
  const wrongHash = "b".repeat(64);

  // Initial set (no data yet) is allowed without a reset flag.
  expect(await tryWrite(page, hashPath, realHash)).toBe("ALLOWED");

  // The real hash is UNREADABLE — adminSecrets has no .read rule (closes the
  // org hash-oracle that the readable adminPasswordHash used to be).
  const read = await page.evaluate(async (p) => {
    try { const s = await firebase.database().ref(p).get(); return "READ:" + s.val(); }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, hashPath);
  expect(read).not.toContain("READ:");
  expect(String(read)).toMatch(/permission_denied|denied/i);

  // Proof-write with the CORRECT hash → allowed (server-side compare).
  expect(await tryWrite(page, proofPath, realHash)).toBe("ALLOWED");

  // Proof-write with a WRONG hash → denied (wrong password).
  const wrong = await tryWrite(page, proofPath, wrongHash);
  expect(wrong).not.toBe("ALLOWED");
  expect(String(wrong)).toMatch(/permission_denied|denied/i);

  // Hash is write-once: overwrite without a fresh _superadminReset is denied.
  const overwrite = await tryWrite(page, hashPath, wrongHash);
  expect(overwrite).not.toBe("ALLOWED");
});

test("rules: org per-room gating — moduleA/B writes allowed in own org room, denied cross-room", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  const slug = "org" + Math.floor(Math.random() * 1e6);
  const code = "oc-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const base = `orgs/${slug}/sessions/${code}`;

  // Member of Room 1 only.
  expect(await tryWrite(page, `${base}/rooms/Room 1/uidMembers/${uid}`, true)).toBe("ALLOWED");

  // Own room: the org-tree paths added for parity (2026-05-30 R2) accept writes.
  const own = (p, v) => tryWrite(page, `${base}/rooms/Room 1/${p}`, v);
  expect(await own("moduleA/hypotheses/h1", { text: "dx", by: "S", cid: uid, at: Date.now() })).toBe("ALLOWED");
  expect(await own("moduleA/promptReplies/0/" + uid, { text: "r", by: "S", cid: uid, at: Date.now() })).toBe("ALLOWED");
  expect(await own("moduleB/exchangeReplies/0/" + uid, { text: "r", by: "S", cid: uid, at: Date.now() })).toBe("ALLOWED");

  // Room 2 (not a member): all denied (cross-room tampering closed in org tree too).
  for (const p of ["moduleA/hypotheses/h1", "moduleA/promptReplies/0/" + uid, "moduleB/exchangeReplies/0/" + uid]) {
    const r = await tryWrite(page, `${base}/rooms/Room 2/${p}`, { text: "x", by: "S", cid: uid, at: Date.now() });
    expect(r, p).not.toBe("ALLOWED");
    expect(String(r)).toMatch(/permission_denied|denied/i);
  }
});

test("rules: initial-set admin hash is creatorUid-bound — a non-creator can't claim admin in the create gap (R4)", async ({ page, browser }) => {
  await page.goto("/");
  const uidA = await waitForUid(page);
  const code = "init-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);

  // Creator A claims creatorUid (write-once, == auth.uid, before any admin hash).
  expect(await tryWrite(page, `sessions/${code}/creatorUid`, uidA)).toBe("ALLOWED");

  // A DIFFERENT uid B cannot do the INITIAL set of adminPasswordHash (racing the
  // create gap) once creatorUid is claimed — the !data.exists() branch is now
  // guarded by creatorUid == auth.uid (R4 initial-set-race fix).
  const ctxB = await browser.newContext();
  const tabB = await ctxB.newPage();
  await useEmulator(tabB);
  await tabB.goto("/");
  const uidB = await waitForUid(tabB);
  expect(uidB).not.toBe(uidA);
  const bClaim = await tryWrite(tabB, `sessions/${code}/adminPasswordHash`, "a".repeat(64));
  expect(bClaim, "a non-creator must not initial-set the admin hash").not.toBe("ALLOWED");
  expect(String(bClaim)).toMatch(/permission_denied|denied/i);
  await ctxB.close();

  // The creator A CAN set the initial admin hash.
  expect(await tryWrite(page, `sessions/${code}/adminPasswordHash`, "a".repeat(64))).toBe("ALLOWED");
});

test("rules: roleChoices is owner-bound — a peer cannot overwrite another participant's role choice", async ({ page, browser }) => {
  const code = "role-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const cid = "c_" + Math.floor(Math.random() * 1e9);
  const cmPath = `sessions/${code}/clientMapping/${cid}`;          // clientMapping is session-level
  const rcPath = `sessions/${code}/rooms/Room 1/roleChoices/${cid}`; // roleChoices is per-room

  // Owner A binds the clientId to its uid (write-once = auth.uid) and sets a role.
  await page.goto("/");
  const uidA = await waitForUid(page);
  expect(await tryWrite(page, cmPath, uidA)).toBe("ALLOWED");
  expect(await tryWrite(page, rcPath, { role: "Doctor", name: "A", at: Date.now() })).toBe("ALLOWED");

  // Peer B — a fresh isolated context so it signs in as a DISTINCT anonymous
  // uid (context.newPage would reuse A's session).
  const ctxB = await browser.newContext();
  const tab2 = await ctxB.newPage();
  await useEmulator(tab2);
  await tab2.goto("/");
  const uidB = await waitForUid(tab2);
  expect(uidB).not.toBe(uidA);

  // B cannot overwrite A's role choice for that cid (clientMapping ownership).
  const overwrite = await tryWrite(tab2, rcPath, { role: "Nurse", name: "B", at: Date.now() });
  expect(overwrite).not.toBe("ALLOWED");
  expect(String(overwrite)).toMatch(/permission_denied|denied/i);
  await ctxB.close();
});

test("rules: mail queue is admin-gated — a non-admin cannot enqueue mail (open-relay guard)", async ({ page }) => {
  await page.goto("/");
  await waitForUid(page);
  // A fresh code has no adminPasswordHash, so the existence-based admin gate
  // fails: a participant who merely knows a code cannot turn the queue into an
  // open relay. A well-formed mail job is still denied.
  const code = "mail-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const res = await tryWrite(page, `sessions/${code}/mail/m1`, {
    to: "victim@example.com", subject: "phish", at: Date.now()
  });
  expect(res).not.toBe("ALLOWED");
  expect(String(res)).toMatch(/permission_denied|denied/i);
});

test("rules: /credentials/$id — public read by exact id; listing denied; write-once enforced; bad payload denied", async ({ page }) => {
  await page.goto("/");
  const uid = await waitForUid(page);
  const id = "CNM-T582B-V53WX"; // valid Crockford format
  const path = "credentials/" + id;
  const goodHash = "a".repeat(64);

  // Reading the parent /credentials node (listing) is DENIED — no enumeration.
  const list = await page.evaluate(async () => {
    try { const s = await firebase.database().ref("credentials").get(); return "READ:" + (s.exists() ? "exists" : "empty"); }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  });
  expect(list, "/credentials must not be listable").not.toMatch(/^READ:/);

  // Write a well-formed credential entry → ALLOWED.
  expect(await tryWrite(page, path, {
    nameHash: goodHash, session: "ABC-DEF", sessionLabel: "Test session",
    at: Date.now(), retentionUntil: Date.now() + 365 * 86400 * 1000
  })).toBe("ALLOWED");

  // Reading that exact id back is ALLOWED (rule .read: true on $id).
  const readBack = await page.evaluate(async (p) => {
    try { const s = await firebase.database().ref(p).get(); return s.val(); }
    catch (e) { return "DENIED:" + (e && (e.code || e.message)); }
  }, path);
  expect(readBack && readBack.nameHash, "by-id read must return the stored entry").toBe(goodHash);

  // Overwriting is DENIED (write-once).
  const over = await tryWrite(page, path, {
    nameHash: "b".repeat(64), session: "ABC-DEF", at: Date.now()
  });
  expect(over).not.toBe("ALLOWED");

  // Client-initiated delete is DENIED (withdrawal is admin-only via console).
  const del = await tryWrite(page, path, null);
  expect(del).not.toBe("ALLOWED");

  // A bad payload (bad nameHash format) at a fresh id is DENIED.
  const bad = await tryWrite(page, "credentials/CNM-BADHX-PAYL2", {
    nameHash: "not-hex", session: "ABC-DEF", at: Date.now()
  });
  expect(bad).not.toBe("ALLOWED");

  // A bad key format (not CNM-XXXXX-XXXXX) is DENIED.
  const badKey = await tryWrite(page, "credentials/not-a-cnm-id", {
    nameHash: goodHash, session: "ABC-DEF", at: Date.now()
  });
  expect(badKey).not.toBe("ALLOWED");
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

test("rules: closing a session is creator/proof-bound — a student who knows the code cannot end it", async ({ page, browser }) => {
  // Before this rule, ANY authenticated user could write the (write-once,
  // unrecoverable) closed marker for any session whose code they knew — i.e.
  // any student could end the whole session for everyone. The rule now
  // requires the writer to be the session's creator (creatorUid == auth.uid)
  // or to hold a fresh admin password-proof at adminSecrets/<code>/proof/<uid>.
  await page.goto("/");
  const uidA = await waitForUid(page);
  const REAL_HASH = "b".repeat(64);

  // --- scenario 1: creator closes; a student cannot -----------------------
  const code = "close-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  expect(await tryWrite(page, `sessions/${code}/creatorUid`, uidA)).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/${code}/adminPasswordHash`, "a".repeat(64))).toBe("ALLOWED");
  expect(await tryWrite(page, `adminSecrets/${code}/hash`, REAL_HASH)).toBe("ALLOWED");

  // Student B (distinct anonymous uid) knows the code but is neither creator
  // nor proof-holder — the close write must be denied.
  const ctxB = await browser.newContext();
  const tabB = await ctxB.newPage();
  await useEmulator(tabB);
  await tabB.goto("/");
  const uidB = await waitForUid(tabB);
  expect(uidB).not.toBe(uidA);
  const grief = await tryWrite(tabB, `sessions/${code}/closed`, { by: "Student B", at: Date.now() });
  expect(grief, "a non-creator/non-proof-holder must not close the session").not.toBe("ALLOWED");
  expect(String(grief)).toMatch(/permission_denied|denied/i);

  // The creator CAN close it…
  expect(await tryWrite(page, `sessions/${code}/closed`, { by: "Facilitator", at: Date.now() })).toBe("ALLOWED");
  // …and the marker stays write-once even for the creator.
  const again = await tryWrite(page, `sessions/${code}/closed`, { by: "Facilitator", at: Date.now() });
  expect(again).not.toBe("ALLOWED");

  // --- scenario 2: a different-browser facilitator closes via password proof
  const code2 = "close2-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  expect(await tryWrite(page, `sessions/${code2}/creatorUid`, uidA)).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/${code2}/adminPasswordHash`, "a".repeat(64))).toBe("ALLOWED");
  expect(await tryWrite(page, `adminSecrets/${code2}/hash`, REAL_HASH)).toBe("ALLOWED");

  // B still cannot close code2 (no proof yet)…
  const grief2 = await tryWrite(tabB, `sessions/${code2}/closed`, { by: "B", at: Date.now() });
  expect(grief2).not.toBe("ALLOWED");
  // …but after a successful password proof-write (FINDING-07 scheme: the
  // candidate must equal the stored hash, verified server-side), B is a
  // legitimate facilitator on another browser and CAN close.
  expect(await tryWrite(tabB, `adminSecrets/${code2}/proof/${uidB}`, REAL_HASH)).toBe("ALLOWED");
  expect(await tryWrite(tabB, `sessions/${code2}/closed`, { by: "Co-facilitator", at: Date.now() })).toBe("ALLOWED");
  await ctxB.close();
});

test("rules: admin-write nodes + pool/room are creator/proof-bound (Phase 4a)", async ({ page, browser }) => {
  // Before this, any authed user who knew the code could write admin-gated
  // nodes (started, roomCount, summary) and assign ANY participant's room —
  // fine under a supervised classroom, grief-able once self-serve. They are now
  // bound to the session's creator (creatorUid == auth.uid) or a fresh
  // password-proof, and pool/$clientId/room is restricted to the client itself
  // (clientMapping ownership) OR an admin.
  await page.goto("/");
  const uidA = await waitForUid(page);
  const REAL_HASH = "c".repeat(64);
  const code = "adm-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);

  // Creator A establishes the session.
  expect(await tryWrite(page, `sessions/${code}/creatorUid`, uidA)).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/${code}/adminPasswordHash`, "a".repeat(64))).toBe("ALLOWED");
  expect(await tryWrite(page, `adminSecrets/${code}/hash`, REAL_HASH)).toBe("ALLOWED");

  // Student B — distinct uid, knows the code, neither creator nor proof-holder.
  const ctxB = await browser.newContext();
  const tabB = await ctxB.newPage();
  await useEmulator(tabB);
  await tabB.goto("/");
  const uidB = await waitForUid(tabB);
  expect(uidB).not.toBe(uidA);

  // B cannot perform admin writes…
  expect(String(await tryWrite(tabB, `sessions/${code}/started`, true))).toMatch(/denied/i);
  expect(String(await tryWrite(tabB, `sessions/${code}/roomCount`, 3))).toMatch(/denied/i);
  expect(String(await tryWrite(tabB, `sessions/${code}/summary`, { at: Date.now() }))).toMatch(/denied/i);
  // …incl. advancing a room's stage (now identity-bound; setRoomStage was
  // changed from a transaction to a set so the server evaluates the rule).
  expect(String(await tryWrite(tabB, `sessions/${code}/rooms/r1/stage`, 2))).toMatch(/denied/i);
  // A "victim" participant owned by A (clientMapping = uidA) with a full pool
  // entry, so a room reassignment is decided by the room .write rule (not the
  // pool-entry .validate, which requires name/university/…).
  const entry = (name) => ({ name, university: "U", year: 2, english: "B2", at: Date.now() });
  expect(await tryWrite(page, `sessions/${code}/pool/cidV`, entry("Victim"))).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/${code}/clientMapping/cidV`, uidA)).toBe("ALLOWED");

  // B (non-owner, non-admin) cannot reassign the victim's room…
  expect(String(await tryWrite(tabB, `sessions/${code}/pool/cidV/room`, "Room 9"))).toMatch(/denied/i);
  // …but the creator can (admin-assign path), and can do the other admin writes.
  expect(await tryWrite(page, `sessions/${code}/pool/cidV/room`, "Room 1")).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/${code}/started`, true)).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/${code}/rooms/r1/stage`, 2)).toBe("ALLOWED");

  // B CAN self-assign its OWN room (owns cidB via clientMapping).
  expect(await tryWrite(tabB, `sessions/${code}/pool/cidB`, entry("Bee"))).toBe("ALLOWED");
  expect(await tryWrite(tabB, `sessions/${code}/clientMapping/cidB`, uidB)).toBe("ALLOWED");
  expect(await tryWrite(tabB, `sessions/${code}/pool/cidB/room`, "Room 3")).toBe("ALLOWED");

  // After a valid password proof-write, B is a legitimate facilitator and CAN
  // do admin writes — incl. reassigning the victim's room (proof path).
  expect(await tryWrite(tabB, `adminSecrets/${code}/proof/${uidB}`, REAL_HASH)).toBe("ALLOWED");
  expect(await tryWrite(tabB, `sessions/${code}/summary`, { at: Date.now() })).toBe("ALLOWED");
  expect(await tryWrite(tabB, `sessions/${code}/pool/cidV/room`, "Room 2")).toBe("ALLOWED");
  expect(await tryWrite(tabB, `sessions/${code}/rooms/r1/stage`, 3)).toBe("ALLOWED");

  await ctxB.close();
});

// Phase 4c — session-creation soft-launch gate (facilitatorGate). Admin-only
// node (.write:false): seeded via the emulator's owner REST token, which
// bypasses rules. Default (absent/enforce!=true) → creation open (current
// behaviour); enforce==true → only allow/<uid>==true may create.
const EMU_DB_REST = "http://127.0.0.1:9000";
const EMU_NS = "canamed-sim-default-rtdb";
async function adminPut(pathNoJson, value) {
  const res = await fetch(`${EMU_DB_REST}/${pathNoJson}.json?ns=${EMU_NS}`, {
    method: "PUT",
    headers: { "Authorization": "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`admin PUT ${pathNoJson} -> ${res.status}`);
}

test("rules: facilitatorGate — every session-establishment write is gated when enforced (Phase 4c)", async ({ page, browser }) => {
  // A 64-hex string is a valid adminPasswordHash / adminSecrets hash, so a
  // denial here is unambiguously the .write gate, not a .validate failure.
  const HEX = "a".repeat(64), HEX2 = "b".repeat(64);
  await page.goto("/");
  const uidA = await waitForUid(page);
  const ts = Date.now().toString(36);
  const org = "fgorg" + ts; // org tree must gate the same establishment writes

  // 1) Default (no facilitatorGate) — any authed user can begin a session: both
  //    the `created` marker AND the load-bearing `creatorUid` write are open,
  //    in the legacy sessions/ tree AND the orgs/ tree.
  expect(await tryWrite(page, `sessions/fgA-${ts}/created`, { by: "A", at: Date.now() })).toBe("ALLOWED");
  expect(await tryWrite(page, `sessions/fgAc-${ts}/creatorUid`, uidA)).toBe("ALLOWED");
  expect(await tryWrite(page, `orgs/${org}/sessions/fgOA-${ts}/creatorUid`, uidA)).toBe("ALLOWED");

  let ctxB;
  try {
    // 2) Enforce, allowlisting ONLY uidA (admin/console-only node → owner REST).
    await adminPut("facilitatorGate", { enforce: true, allow: { [uidA]: true } });

    // Allowlisted uidA still creates — every establishment write is allowed,
    // including the recovery code (itself a first-write bootstrap field).
    expect(await tryWrite(page, `sessions/fgA2-${ts}/created`, { by: "A", at: Date.now() })).toBe("ALLOWED");
    expect(await tryWrite(page, `sessions/fgA2c-${ts}/creatorUid`, uidA)).toBe("ALLOWED");
    expect(await tryWrite(page, `recovery/sessions/fgA2r-${ts}`, { code: "estrecover12345" })).toBe("ALLOWED");

    // Establish a full session as the allowlisted admin so step 4 can prove its
    // recovery/reset chain still works under enforcement.
    const est = `est-${ts}`, estRC = "estreset-code-99";
    expect(await tryWrite(page, `recovery/sessions/${est}`, { code: estRC })).toBe("ALLOWED");
    expect(await tryWrite(page, `sessions/${est}/creatorUid`, uidA)).toBe("ALLOWED");
    expect(await tryWrite(page, `sessions/${est}/adminPasswordHash`, HEX)).toBe("ALLOWED");

    // 3) A different, non-allowlisted uid B cannot begin a session by ANY path.
    //    Gating only `created` was bypassable (CodeRabbit): B could instead write
    //    creatorUid (ownership admin path) or adminPasswordHash + the real
    //    adminSecrets hash (password-proof admin path) and operate the session
    //    without ever writing `created`. All of these must now be denied.
    ctxB = await browser.newContext();
    const tabB = await ctxB.newPage();
    await useEmulator(tabB);
    await tabB.goto("/");
    const uidB = await waitForUid(tabB);
    expect(uidB).not.toBe(uidA);
    for (const [path, value] of [
      [`sessions/fgB-${ts}/created`, { by: "B", at: Date.now() }],
      [`sessions/fgBc-${ts}/creatorUid`, uidB],
      [`sessions/fgBh-${ts}/adminPasswordHash`, HEX],
      [`adminSecrets/fgBs-${ts}/hash`, HEX2],
      // …and every mirror in the orgs/ tree (CodeRabbit: org parity).
      [`orgs/${org}/sessions/fgOB-${ts}/created`, { by: "B", at: Date.now() }],
      [`orgs/${org}/sessions/fgOBc-${ts}/creatorUid`, uidB],
      [`orgs/${org}/sessions/fgOBh-${ts}/adminPasswordHash`, HEX],
      [`adminSecrets/orgs/${org}/fgOBs-${ts}/hash`, HEX2],
      // …including the recovery-code bootstrap (the _superadminReset entry point):
      // seeding it on a fresh, hashless session was the recovery bypass.
      [`recovery/sessions/fgBr-${ts}`, { code: "attacker-code-01" }],
      [`recovery/orgs/${org}/sessions/fgOBr-${ts}`, { code: "attacker-code-02" }],
    ]) {
      expect(String(await tryWrite(tabB, path, value)), `uidB must be denied ${path}`).toMatch(/denied/i);
    }

    // 4) The recovery BRANCHES stay open for an ALREADY-established session, so
    //    gating the recovery-code bootstrap does not break legitimate password
    //    recovery under enforcement. uidA resets `est` (established in step 2):
    //    _superadminReset with the known code, then overwrite the hash via the
    //    (ungated) recovery branch — both must succeed.
    const now = Date.now();
    expect(await tryWrite(page, `sessions/${est}/_superadminReset`,
      { requestedAt: now, by: "A", code: estRC, uid: uidA })).toBe("ALLOWED");
    expect(await tryWrite(page, `sessions/${est}/adminPasswordHash`, HEX2)).toBe("ALLOWED");
  } finally {
    // ALWAYS clear the gate so later tests' session creation isn't blocked.
    await adminPut("facilitatorGate", null);
    if (ctxB) await ctxB.close();
  }
});
