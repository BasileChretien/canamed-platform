/* tests-e2e/emulator/reset-flag-unreadable.spec.js
 *
 * The recovery code must not be readable by a session's members while a
 * password reset is in progress — and it was, every time one was used.
 *
 * To open a reset the client wrote the code IN CLEAR to
 * `sessions/<code>/_superadminReset`; the rule required it there. That node
 * had no `.read` of its own, so it inherited the session's — which every
 * member has — and membership is self-claimed (`members/<own uid>`). So:
 *
 *   1. anyone signed in who knew the session code wrote their own member entry;
 *   2. listened on that node;
 *   3. a facilitator used "forgot password" once, and the listener was handed
 *      the recovery code;
 *   4. from then on, while the session was open, they opened a reset
 *      themselves,
 *   5. overwrote the admin hash,
 *   6. and wrote their own proof — which is all the admin predicates ask for.
 *
 * The record is write-once, so a code that had leaked could not be replaced.
 * And ANY signed-in user could delete the flag, which made the facilitator's
 * own reset fail. All of it measured on the emulator before the change (the
 * BEFORE comments below are that run).
 *
 * NO PREDICATE COULD FIX IT. A read that cascades cannot be revoked at a
 * deeper path, so nothing under `sessions/` will do. The flag moved to
 * `adminSecrets/<code>/reset/<uid>` (org: `adminSecrets/orgs/<slug>/<id>/…`):
 * a tree with no read rule at all, keyed by the writer's own uid — so only
 * that user can write it or delete it, and the hash rules look for the flag of
 * the user who is writing the hash. The old node accepts nothing but a delete,
 * and no rule reads it any more.
 *
 * Every DENIED below has an ALLOWED for the same payload on the same path, by
 * a user who should be able to or in the state the write is for. Seeding is
 * done as the emulator owner; no verdict is settled with the owner token.
 *
 * NOT CLOSED HERE, and said so rather than implied: a code that leaked BEFORE
 * this change stays valid while its session is open — the record is still
 * write-once, and a successful reset does not issue a new one.
 */

// @ts-check
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");
const { sessionLocationsFromKeys } = require("../../scripts/lib/session-trees.js");

const EMU = "http://127.0.0.1:9000";
const NS = "canamed-sim-default-rtdb";          // the namespace the rules apply to
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function ownerPut(path, value) {
  const r = await fetch(`${EMU}/${path}.json?ns=${NS}`, {
    method: "PUT", headers: OWNER, body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error(`owner PUT ${path} -> HTTP ${r.status}`);
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
let seq = 0;
function freshCode() {
  let n = Date.now() * ALPHABET.length + (seq++);
  let s = "";
  for (let i = 0; i < 6; i++) { s += ALPHABET[n % ALPHABET.length]; n = Math.floor(n / ALPHABET.length); }
  return s.slice(0, 3) + "-" + s.slice(3);
}

async function waitForUid(page) {
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* A second USER, not a second page: context.newPage() shares the anonymous
   session, so the "watcher" would carry the facilitator's uid. */
async function newUser(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  return { ctx, page, uid: await waitForUid(page) };
}

const tryWrite = (page, path, value) => page.evaluate(async ({ path, value }) => {
  try { await firebase.database().ref(path).set(value); return "ALLOWED"; }
  catch (e) {
    const code = String((e && (e.code || e.message)) || "");
    return /permission_denied/i.test(code) ? "DENIED" : "ERROR: " + code;
  }
}, { path, value });

const tryRead = (page, path) => page.evaluate(async (path) => {
  try { await firebase.database().ref(path).once("value"); return "ALLOWED"; }
  catch (e) {
    const code = String((e && (e.code || e.message)) || "");
    return /permission_denied/i.test(code) ? "DENIED" : "ERROR: " + code;
  }
}, path);

/* Listen on a path and keep everything it delivers. */
const watch = (page, path) => page.evaluate((path) => {
  window.__seen = window.__seen || {};
  window.__seen[path] = [];
  firebase.database().ref(path).on("value",
    (s) => window.__seen[path].push(s.val()),
    (e) => window.__seen[path].push("LISTEN-DENIED"));
}, path);
/* Did anything delivered on that path carry a `code`? Returns it, or null. */
const codeSeen = (page, path) => page.evaluate((path) => {
  const hit = ((window.__seen || {})[path] || []).find((v) => v && typeof v === "object" && v.code);
  return hit ? hit.code : null;
}, path);

const HASH_0 = "v2$100000$0000000000000000";
const HASH_1 = "v2$100000$1111111111111111";
const HASH_2 = "v2$100000$2222222222222222";
const MARKER = "v2$100000$aaaaaaaaaaaaaaaa";
const K = "kkkk-code-real";        // the session's recovery code
const WRONG = "nope-nope-nope";

/* Where the flag lives now, and what it holds. */
const flagPath = (loc, uid) => loc.adminSecretPath + "/reset/" + uid;
const flag = (code) => ({ requestedAt: Date.now(), code });
/* What the client wrote before, where every member could read it. */
const oldNode = (loc) => loc.path + "/_superadminReset";
const oldFlag = (code, uid) => ({ requestedAt: Date.now(), by: "Emu", code, uid });

function locFor(tree) {
  const code = freshCode();
  if (tree === "default") return sessionLocationsFromKeys([code], {})[0];
  return sessionLocationsFromKeys([], { ["flgorg" + Date.now().toString(36)]: [code] })[0];
}

for (const tree of ["default", "org"]) {
  test(`${tree} tree: the reset flag is unreadable, its writer's alone, and the old node opens nothing`, async ({ page, browser }) => {
    await page.goto("/");
    const creator = { page, uid: await waitForUid(page) };
    const returning = await newUser(browser);   // the facilitator on another device: knows K
    const stranger = await newUser(browser);    // knows the session code, nothing else
    expect(new Set([creator.uid, returning.uid, stranger.uid]).size,
      "three DISTINCT users, or the rows below are one user testing themselves").toBe(3);

    /* A session with a password, written the way its creator's client does. */
    const loc = locFor(tree);
    for (const [p, v] of [
      [loc.path + "/created", { by: "Creator", at: Date.now() }],
      [loc.recoveryPath, { code: K }],
      [loc.path + "/creatorUid", creator.uid],
      [loc.adminSecretPath + "/hash", HASH_0],
      [loc.path + "/adminPasswordHash", MARKER]
    ]) expect(await tryWrite(creator.page, p, v), "set-up: the creator writes " + p).toBe("ALLOWED");

    const got = {};
    const step = async (name, who, path, value) => { got[name] = await tryWrite(who.page, path, value); };

    /* ── the watcher ── */
    await step("1. a stranger joins: writes its own members entry", stranger, loc.path + "/members/" + stranger.uid, { at: Date.now() });
    await watch(stranger.page, oldNode(loc));
    got["2. the stranger reads the tree the flags are in"] = await tryRead(stranger.page, loc.adminSecretPath + "/reset");
    got["2. …and one user's flag by its exact path"] = await tryRead(stranger.page, flagPath(loc, returning.uid));

    /* ── a browser still on the old shell writes the code where it always did ── */
    await step("3. a cached client writes the code to the OLD node", returning, oldNode(loc), oldFlag(K, returning.uid));

    /* ── the reset, as the client now makes it ── */
    await step("4. the returning facilitator opens a reset where no client can read it", returning, flagPath(loc, returning.uid), flag(K));
    await step("5. …and overwrites the hash", returning, loc.adminSecretPath + "/hash", HASH_1);
    await step("5. the stranger overwrites the hash while that reset is open", stranger, loc.adminSecretPath + "/hash", HASH_2);
    await step("6. the stranger deletes the facilitator's flag", stranger, flagPath(loc, returning.uid), null);
    await step("6. the stranger overwrites the facilitator's flag", stranger, flagPath(loc, returning.uid), flag(K));
    await step("6. …and the facilitator's hash write STILL goes through", returning, loc.adminSecretPath + "/hash", HASH_1);
    await step("7. the facilitator deletes its own flag", returning, flagPath(loc, returning.uid), null);
    await step("7. with no flag left, the same hash write is refused", returning, loc.adminSecretPath + "/hash", HASH_1);

    /* What the watcher was handed, after all of that. */
    await stranger.page.waitForTimeout(500);
    got["8. the watcher was handed the recovery code"] = (await codeSeen(stranger.page, oldNode(loc))) === K ? "YES" : "no";

    /* ── the stranger, with what it has ── */
    await step("9. the stranger opens a reset with a code it guessed", stranger, flagPath(loc, stranger.uid), flag(WRONG));
    await step("9. whoever really holds the code opens one on the same path", stranger, flagPath(loc, stranger.uid), flag(K));
    await step("9. …and clears it", stranger, flagPath(loc, stranger.uid), null);

    /* ── the old node no longer opens anything ──
       Seeded by the owner exactly as it used to stand when it opened the hash
       for the user it names: fresh, the right code, that user's uid. */
    await ownerPut(oldNode(loc), oldFlag(K, stranger.uid));
    await step("10. an old-style flag naming the stranger sits in the old node: the stranger overwrites the hash", stranger, loc.adminSecretPath + "/hash", HASH_2);
    await step("10. anyone may DELETE what is left in the old node", stranger, oldNode(loc), null);

    /* ── a reset still needs a password, and an open session ── */
    const bare = locFor(tree);
    await ownerPut(bare.path, { created: { by: "Creator", at: Date.now() }, creatorUid: creator.uid });
    await ownerPut(bare.recoveryPath, { code: K });
    await step("11. a reset on a session with no password", returning, flagPath(bare, returning.uid), flag(K));
    await ownerPut(loc.path + "/closed", { by: "Creator", at: Date.now() });
    await step("12. a reset once the session is closed", returning, flagPath(loc, returning.uid), flag(K));

    expect(got).toEqual({
      /*                                                                                  NOW        BEFORE */
      "1. a stranger joins: writes its own members entry":                               "ALLOWED",
      "2. the stranger reads the tree the flags are in":                                 "DENIED",
      "2. …and one user's flag by its exact path":                                       "DENIED",
      "3. a cached client writes the code to the OLD node":                              "DENIED",  // ALLOWED
      "4. the returning facilitator opens a reset where no client can read it":          "ALLOWED", // DENIED (no such rule)
      "5. …and overwrites the hash":                                                     "ALLOWED",
      "5. the stranger overwrites the hash while that reset is open":                    "DENIED",
      "6. the stranger deletes the facilitator's flag":                                  "DENIED",
      "6. the stranger overwrites the facilitator's flag":                               "DENIED",
      "6. …and the facilitator's hash write STILL goes through":                         "ALLOWED",
      "7. the facilitator deletes its own flag":                                         "ALLOWED",
      "7. with no flag left, the same hash write is refused":                            "DENIED",
      "8. the watcher was handed the recovery code":                                     "no",      // YES
      "9. the stranger opens a reset with a code it guessed":                            "DENIED",
      "9. whoever really holds the code opens one on the same path":                     "ALLOWED",
      "9. …and clears it":                                                               "ALLOWED",
      "10. an old-style flag naming the stranger sits in the old node: the stranger overwrites the hash": "DENIED", // ALLOWED
      "10. anyone may DELETE what is left in the old node":                              "ALLOWED",
      "11. a reset on a session with no password":                                       "DENIED",
      "12. a reset once the session is closed":                                          "DENIED"
    });

    await returning.ctx.close();
    await stranger.ctx.close();
  });
}

/* ── the REAL client, end to end ───────────────────────────────────────── */

async function createSessionUI(page) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Flag Emu Fac");
  await page.locator("#splash-create-label").fill("reset-flag");
  await page.locator("#splash-create-pass").fill("emu-init-pw-1");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const recoveryNode = page.locator("#splash-recovery-code");
  await expect(recoveryNode).toBeVisible({ timeout: 10_000 });
  return { code: (await codeNode.textContent()).trim().toLowerCase(), recovery: (await recoveryNode.textContent()).trim() };
}

test("the real client: a facilitator resets a forgotten password, and a member watching the session is handed nothing", async ({ page, browser }) => {
  const { code, recovery } = await createSessionUI(page);
  const [loc] = sessionLocationsFromKeys([code], {});
  const hashBefore = await dbReadAsOwner(loc.adminSecretPath + "/hash");
  expect(hashBefore, "set-up: the session has its password hash").toBeTruthy();

  /* The watcher: joins the way anyone can, and listens where the code used to
     pass. Its listener is attached BEFORE the reset starts. */
  const watcher = await newUser(browser);
  expect(await tryWrite(watcher.page, loc.path + "/members/" + watcher.uid, { at: Date.now() })).toBe("ALLOWED");
  await watch(watcher.page, oldNode(loc));
  await expect.poll(() => watcher.page.evaluate((p) => window.__seen[p].length, oldNode(loc)),
    "the watcher's listener is live (it has received the node's current value)").toBeGreaterThan(0);

  /* The facilitator, on another device, password forgotten: the real panel. */
  const fac = await newUser(browser);
  expect(new Set([await waitForUid(page), watcher.uid, fac.uid]).size).toBe(3);
  await fac.page.locator("#splash-code").fill(code);
  await fac.page.locator("#splash-enter").click();
  await expect(fac.page.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await fac.page.locator("#admin-toggle").click();
  await fac.page.locator("#forgot-pass-link").click();
  await expect(fac.page.locator("#superadmin-panel")).toBeVisible();
  await fac.page.locator("#name-input").fill("Flag Emu Fac");
  await fac.page.locator("#new-pass-input").fill("brand-new-pw-2026");
  await fac.page.locator("#new-pass-confirm-input").fill("brand-new-pw-2026");
  await fac.page.locator("#recovery-code-input").fill(recovery);
  await fac.page.locator("#set-pass-btn").click();

  /* DB first: the hash was replaced, and the flag is gone from BOTH places. */
  await expect.poll(() => dbReadAsOwner(loc.adminSecretPath + "/hash"),
    { message: "the reset never replaced the hash — the legitimate path is broken", timeout: 20_000 })
    .not.toBe(hashBefore);
  await expect.poll(() => dbReadAsOwner(loc.adminSecretPath + "/reset"),
    "the client removes its flag once the hash is written").toBeNull();
  expect(await dbReadAsOwner(oldNode(loc)), "nothing was written to the node members can read").toBeNull();
  /* Then the DOM: the facilitator is in. */
  await expect(fac.page.locator("#admin-app")).toBeVisible({ timeout: 20_000 });

  /* And the watcher: its listener is still attached, and nothing it received
     carried a code. BEFORE this change it received the session's recovery code. */
  expect(await codeSeen(watcher.page, oldNode(loc)), "the watcher was handed the recovery code").toBeNull();
  const delivered = await watcher.page.evaluate((p) => window.__seen[p], oldNode(loc));
  expect(delivered.every((v) => v === null), "every value the watcher received was null: " + JSON.stringify(delivered)).toBe(true);

  await watcher.ctx.close();
  await fac.ctx.close();
});

/* ── the purge's blind clear, as the Admin SDK sends it ────────────────── */

test("the purge's clearing update: nulls written blind remove a leftover, and are a no-op where there is none", async () => {
  /* scripts/cleanup-stale-sessions.js writes a null to the old node of EVERY
     session it keeps, without reading whether anything is there (it may read
     only the identifiers and the two dates). That rests on one property of the
     database, checked here against a real one with the real Admin SDK rather
     than assumed from the fake the unit tests use: a multi-path update whose
     paths mostly do not exist is ACCEPTED, deletes the one that does, and
     creates nothing.

     The map is built by the same function the purge uses, and sent the way
     the purge sends it: db.ref().update(map). This is the Admin SDK, which
     bypasses the rules — an observation of the database, not a verdict on a
     rule. */
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { legacyResetFlagPath } = require("../../scripts/lib/reset-flag.js");

  const held = locFor("default");      // kept, and holds a leftover
  const clean = locFor("org");         // kept, holds none
  const absent = locFor("default");    // no such session at all
  const body = () => ({ created: { by: "Emu", at: Date.now() }, creatorUid: "uid-emu", pool: { c1: { name: "Emu" } } });
  await ownerPut(held.path, Object.assign(body(), { _superadminReset: oldFlag(K, "uid-emu") }));
  await ownerPut(clean.path, body());
  const heldBefore = await dbReadAsOwner(held.path);
  const cleanBefore = await dbReadAsOwner(clean.path);
  expect(heldBefore._superadminReset.code, "set-up: the leftover is there, with a code in it").toBe(K);

  process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000";
  const app = initializeApp({ databaseURL: `${EMU}/?ns=${NS}` }, "reset-flag-clear-" + Date.now());
  try {
    const map = {};
    for (const loc of [held, clean, absent]) map[legacyResetFlagPath(loc)] = null;
    await getDatabase(app).ref().update(map);
  } finally {
    await deleteApp(app);
  }

  const heldAfter = await dbReadAsOwner(held.path);
  delete heldBefore._superadminReset;
  expect(heldAfter, "the leftover is gone, and the session is otherwise what it was").toEqual(heldBefore);
  expect(await dbReadAsOwner(clean.path), "a session with nothing there is untouched").toEqual(cleanBefore);
  expect(await dbReadAsOwner(absent.path), "nothing was created where there was no session").toBeNull();
});
