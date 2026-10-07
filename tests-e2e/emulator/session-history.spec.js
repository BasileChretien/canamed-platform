/* tests-e2e/emulator/session-history.spec.js
 *
 * A signed-in participant's session history, through the real rules.
 *
 * THE DEFECT: pushSessionToHistory() wrote `scenarioName` as the session's
 * whole name. Since #275 (2026-08-04) a session built from several sections is
 * named after ALL of them, joined with " + " — and the rule on
 * `users/$uid/history/$code` caps that field at 80 characters. A longer name
 * fails `.validate`, which refuses the WHOLE entry, not the one field. Two of
 * the built-in sections already come to 99 characters, so the entry was never
 * written, the session never appeared under "Sessions you have joined", and
 * that list carries the only "Withdraw consent" button a signed-in participant
 * has once a session is over (DPA Annex VI, G12). The one trace was a console
 * warning.
 *
 * Why this needs the emulator: the LOCAL suite models no rules, so there the
 * write always lands. Whether an entry is ACCEPTED is a property of
 * database.rules.json and nothing else.
 *
 * Conventions (CLAUDE.md): the participant is a second CONTEXT and the two
 * uids are asserted to differ; the DATABASE is read with dbReadAsOwner() before
 * anything is said about the page; every denial sits beside an allow of the
 * same payload shape by the same identity; payloads are ASCII.
 */

// @ts-check
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");

/* The rule's own limits. tests/session-history-label.test.js reads the same
   numbers out of database.rules.json and out of the client, so the three
   cannot drift apart unnoticed. */
const NAME_MAX = 80;
const CODE_MAX = 30;

/* Two halves of one built-in case. Chosen because their joined English name is
   over the limit AND plain ASCII — both asserted below, so a renamed section
   fails here saying so instead of turning this into a test of nothing. */
const PICK = ["sore-throat-pbl", "sore-throat-roleplay"];

async function waitForUid(page) {
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, null, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* A write through the REAL rules: "ALLOWED" or the denial's code/message. */
function tryWrite(page, path, value) {
  return page.evaluate(async ({ p, v }) => {
    try { await firebase.database().ref(p).set(v); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, { p: path, v: value });
}

/* A denial has to be the RULES saying no — not a typo in the path, a dropped
   socket or a thrown TypeError, all of which `not.toBe("ALLOWED")` accepts. */
function expectDenied(result, why) {
  expect(String(result), why).toMatch(/permission[_ ]denied/i);
}

const isAscii = (s) => Array.from(String(s)).every(ch => {
  const c = ch.charCodeAt(0);
  return c >= 32 && c < 127;
});

/* Turn the page's start-up anonymous user into a real (non-anonymous) account
   with a profile, the way a new user does it: sign up, then fill in the
   profile-setup form the app shows. History is only ever written for such a
   user (issue #347), so an anonymous page cannot reproduce any of this. */
async function signUpWithProfile(page, stamp) {
  await page.goto("/");
  const anonUid = await waitForUid(page);
  const email = "hist-" + stamp + "@example.test";
  const password = "Emu-" + stamp + "-Aa1!";
  await page.evaluate(({ email, password }) =>
    firebase.auth().createUserWithEmailAndPassword(email, password), { email, password });
  await page.waitForFunction(() => {
    const u = firebase.auth().currentUser;
    return !!u && !u.isAnonymous && currentUser && currentUser.uid === u.uid;
  }, null, { timeout: 20_000 });
  const uid = await page.evaluate(() => firebase.auth().currentUser.uid);
  expect(uid, "sign-up must produce a new account, not reuse the anonymous one").not.toBe(anonUid);

  await expect(page.locator("#splash-view-profile-setup")).toBeVisible({ timeout: 20_000 });
  await page.locator("#splash-prof-name").fill("Emu Student");
  const uni = await page.locator("#splash-prof-uni option:not([disabled])").first().getAttribute("value");
  await page.locator("#splash-prof-uni").selectOption(uni);
  await page.locator("#splash-profile-setup-submit").click();
  await expect(page.locator("#splash-view-enter")).toBeVisible({ timeout: 20_000 });
  return uid;
}

/* The app's own record of a history write that did not land. Read from the
   telemetry buffer (telemetry.js), which the participant never sees. */
const historyFailures = (page) => page.evaluate(() =>
  window.CanamedTelemetry.getErrors().filter(e => e.kind === "history-write-failed"));

test("a signed-in participant who joins a multi-section session gets a history entry", async ({ page, browser }) => {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });

  // ---- Facilitator: a session built from two sections ----
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  }, null, { timeout: 20_000 });
  /* The pick is set through the picker's own state, not by choosing in
     #splash-section-add and clicking Add. That list is REBUILT when the
     signed-in user's authored sections finish loading, which resets the
     select to its first option: against the emulator the rebuild can land
     between the choice and the click, and the session is then created with
     the first built-in section instead of the one chosen (seen on the second
     run of this very test). The picker's UI has its own specs; what this test
     needs is a session that really carries PICK, asserted on the database
     a few lines down. */
  await page.evaluate((ids) => {
    splashSectionPick.length = 0;
    ids.forEach(id => splashSectionPick.push(id));
    renderSectionPick();
  }, PICK);
  await expect(page.locator("#splash-section-list .splash-section-row")).toHaveCount(PICK.length);
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("history-entry");
  await page.locator("#splash-create-pass").fill("emu-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const key = code.toLowerCase();
  expect(await dbReadAsOwner(`sessions/${key}/sections`),
    "the session must really carry the two-section pick").toBe(PICK.join(","));

  // ---- Participant: a different person, in a different CONTEXT, signed in ----
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await useEmulator(p);
  p.on("dialog", d => { try { d.accept(); } catch (_) {} });
  const warnings = [];
  p.on("console", m => { if (/session history/i.test(m.text())) warnings.push(m.text()); });
  const uid = await signUpWithProfile(p, stamp);
  const uidFacilitator = await page.evaluate(() => firebase.auth().currentUser.uid);
  expect(uid, "the participant must be a different user from the facilitator").not.toBe(uidFacilitator);

  await p.locator("#splash-code").fill(code);
  await p.locator("#splash-enter").click();
  await expect(p.locator("#name-input")).toBeVisible({ timeout: 20_000 });

  /* WHEN the name is in place. The lobby is on screen, nothing has been joined
     yet, and the session already carries every section's name: the history
     write that follows the join click therefore sees the long one. */
  const names = await p.evaluate((ids) =>
    ids.map(id => tc(window.CANAMED_SECTIONS[id].name, "en")), PICK);
  const joined = await p.evaluate(() => tc(window.CURRENT_SCENARIO_NAME, "en"));
  expect(joined, "before the join, the session is named after every picked section")
    .toBe(names.join(" + "));
  expect(joined.length, "the premise: this name is over the rule's limit").toBeGreaterThan(NAME_MAX);
  expect(isAscii(joined), "the premise: an ASCII name (the emulator's rules are a transformed copy)")
    .toBe(true);

  await p.locator("#name-input").fill("Emu Student");
  const uni = await p.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await p.locator("#uni-input").selectOption(uni);
  await p.locator("#consent-workshop").check();
  await expect(p.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await p.locator("#join-btn").click();
  await expect(p.locator("#waiting")).toBeVisible({ timeout: 20_000 });

  // ---- The database first: the entry must exist ----
  /* Positive control for the wait below: the join itself reached the database
     as this user, so a missing history entry is not a join that never ran. */
  await expect.poll(async () => await dbReadAsOwner(`sessions/${key}/members/${uid}`),
    { message: "the join must have registered this account as a member", timeout: 15_000 })
    .not.toBeNull();

  /* The warnings ride along so a failure says WHICH failure it is: an entry
     that is missing beside a logged refusal was rejected by the rules; one
     missing with nothing logged was never written at all. */
  await expect.poll(async () => ({
    stored: (await dbReadAsOwner(`users/${uid}/history/${key}`)) !== null,
    warnings: warnings.slice()
  }), { message: "users/<uid>/history/<code> must exist after a signed-in join. " +
                 "Session name at the join: " + joined.length + " characters.",
        timeout: 15_000 })
    .toEqual({ stored: true, warnings: [] });
  const entry = await dbReadAsOwner(`users/${uid}/history/${key}`);
  expect(entry.code).toBe(key);
  expect(typeof entry.joinedAt).toBe("number");
  expect(entry.scenarioName.length, "the stored name fits the rule").toBeLessThanOrEqual(NAME_MAX);
  expect(entry.scenarioName, "it names the first section, whole, and counts the rest")
    .toBe(names[0] + " + 1 more");
  /* The workshop's own name, not merely "something short": an empty string
     would satisfy a length check and say nothing. */
  const workshop = await p.evaluate(() => CFG.workshopName);
  expect(workshop, "the premise: this deployment has a workshop name").toBeTruthy();
  expect(entry.workshopName).toBe(workshop);

  expect(await historyFailures(p), "the app recorded no failed history write").toEqual([]);

  // ---- then the page: the row, and its way out ----
  await p.locator("#user-chip").click();
  await expect(p.locator("#account-dialog")).toBeVisible();
  const row = p.locator("#account-history .account-history-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".account-history-code")).toHaveText(code.toUpperCase());
  await expect(row.locator(".account-history-meta")).toContainText(names[0] + " + 1 more");
  await expect(row.locator(".account-history-withdraw"),
    "the withdrawal route this list exists to provide").toBeVisible();

  await ctx.close();
});

/* This one pins the RULE, not the fix: it writes straight to the database and
   passes with or without the client change. It is here because the fix is
   "fit to what the rule allows" — so what the rule allows, and that one long
   field costs the whole entry, have to be on record somewhere that runs. */
test("the history rule refuses a whole entry over one long field, at exactly the limits the client fits to", async ({ page }) => {
  await page.goto("/");
  /* The start-up anonymous user is enough here: the rule is owner-only and does
     not look at how the owner signed in. (The CLIENT never writes history for
     an anonymous user; this test is about what the rules accept.) */
  const uid = await waitForUid(page);
  const base = `users/${uid}/history`;
  const entry = (over) => Object.assign(
    { code: "emu-hist", workshopName: "Emu workshop", scenarioName: "Emu case", joinedAt: Date.now() }, over);

  // scenarioName: 80 allowed, 81 refused — same shape, same identity.
  expect(await tryWrite(page, `${base}/emu-name-80`, entry({ scenarioName: "s".repeat(NAME_MAX) })))
    .toBe("ALLOWED");
  expectDenied(await tryWrite(page, `${base}/emu-name-81`, entry({ scenarioName: "s".repeat(NAME_MAX + 1) })),
    "an 81-character scenarioName must be refused");
  /* ...and the refusal takes the WHOLE entry with it, valid fields included.
     This is why a long name meant no row at all rather than a row with no name. */
  expect(await dbReadAsOwner(`${base}/emu-name-81`), "nothing of the refused entry was stored").toBeNull();
  expect((await dbReadAsOwner(`${base}/emu-name-80`)).scenarioName.length).toBe(NAME_MAX);

  // The name the app used to send for the two sections above, verbatim.
  const real = "Sore-throat workup & the stewardship decision + " +
               "The antibiotic-request conversation across cultures";
  expect(real.length).toBeGreaterThan(NAME_MAX);
  expectDenied(await tryWrite(page, `${base}/emu-real`, entry({ scenarioName: real })),
    "the joined name of two built-in sections must be refused as written");
  expect(await tryWrite(page, `${base}/emu-real`, entry({ scenarioName: real.slice(0, NAME_MAX) })),
    "allow leg: the same entry, to the same path, once the name fits").toBe("ALLOWED");

  // workshopName carries the same cap.
  expect(await tryWrite(page, `${base}/emu-ws-80`, entry({ workshopName: "w".repeat(NAME_MAX) })))
    .toBe("ALLOWED");
  expectDenied(await tryWrite(page, `${base}/emu-ws-81`, entry({ workshopName: "w".repeat(NAME_MAX + 1) })),
    "an 81-character workshopName must be refused");

  // code: 30 allowed, 31 refused.
  expect(await tryWrite(page, `${base}/emu-code-30`, entry({ code: "c".repeat(CODE_MAX) })))
    .toBe("ALLOWED");
  expectDenied(await tryWrite(page, `${base}/emu-code-31`, entry({ code: "c".repeat(CODE_MAX + 1) })),
    "a 31-character code must be refused");
});

test("a history write the rules refuse is recorded where a test can read it, and nowhere the participant looks", async ({ page }) => {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const uid = await signUpWithProfile(page, stamp);
  expect(await historyFailures(page), "clean before anything is written").toEqual([]);

  /* The app's own function, with a code the rule accepts and one it refuses.
     A session code can never really be this long (sanitizeCode() stops at 20),
     which is what makes it a safe way to provoke a refusal: both names are
     fitted by the client now, so the code is the only field left to push over. */
  const ok = "h".repeat(CODE_MAX);
  const tooLong = "h".repeat(CODE_MAX + 1);

  expect(await page.evaluate((c) => pushSessionToHistory(c), ok),
    "allow leg: the same call with a code the rule accepts").toBe(true);
  const stored = await dbReadAsOwner(`users/${uid}/history/${ok}`);
  expect(stored.code).toBe(ok);
  /* True whether or not the section library has been fetched yet on this
     front page: with it or without it, a short name is stored as it is. */
  expect(stored.workshopName).toBe(await page.evaluate(() => CFG.workshopName));
  expect(await historyFailures(page)).toEqual([]);

  expect(await page.evaluate((c) => pushSessionToHistory(c), tooLong),
    "a refused write resolves false instead of vanishing").toBe(false);
  expect(await dbReadAsOwner(`users/${uid}/history/${tooLong}`)).toBeNull();
  const failures = await historyFailures(page);
  expect(failures.length, "exactly one failure was recorded").toBe(1);
  expect(String(failures[0].payload.code)).toMatch(/permission[_ ]denied/i);
  /* The log is downloadable by a facilitator, so it must not carry who or
     which session: only what kind of failure it was. */
  const logged = JSON.stringify(failures[0].payload);
  expect(logged).not.toContain(uid);
  expect(logged).not.toContain(tooLong);

  // Nothing about it reaches the page.
  await expect(page.locator("#splash-view-enter")).toBeVisible();
  await expect(page.locator(".splash-hint.err")).toHaveCount(0);
});
