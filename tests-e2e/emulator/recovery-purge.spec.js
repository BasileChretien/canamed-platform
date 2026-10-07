/* tests-e2e/emulator/recovery-purge.spec.js
 *
 * What a recovery code that OUTLIVES its session does, on the real rules — and
 * that deleting it with the session (scripts/cleanup-stale-sessions.js, since
 * the fix of 2026-10-07) puts both things right.
 *
 * Creating a session writes `recovery/sessions/<code>` (or, for an organisation
 * session, `recovery/orgs/<slug>/sessions/<id>`). The purge deleted a session
 * with its other out-of-cascade siblings and left this one, so every recovery
 * node ever written was still in the database. tests/purge-tree-coverage.test.js
 * runs the real purge and shows it now deletes the path; that test cannot say
 * what the leftover DID, because nothing in the unit suite evaluates a rule.
 * This one can. Measured here before the fix was written:
 *
 *   1. THE CODE CANNOT BE USED AGAIN. The node is write-once
 *      (`!data.exists()`), so a session that later draws the same code has its
 *      own recovery write refused. That write rides the first parallel batch of
 *      createSession(), so the batch rejects AFTER `created`, `creatorUid` and
 *      the rest of it have landed: the facilitator is told to check their
 *      connection, and a session with no password hash is left behind.
 *   2. THE OLD CODE IS THE RECOVERY CODE OF WHATEVER IS CREATED THERE NEXT.
 *      `_superadminReset` is allowed when its `code` equals `recovery/…/code`,
 *      and the record at that path is still the old one. Since 2026-10-07 the
 *      reset also needs the session to have a password
 *      (reset-needs-a-password.spec.js), so the old code no longer opens it on
 *      the passwordless session a collision leaves behind — it did when this
 *      file was first written, and set that session's FIRST password. But the
 *      moment the session at that code is given a password, whoever wrote the
 *      old code down can reset it. No rule can tell a stale record from a
 *      fresh one; only deleting it does.
 *
 * Each denial below is paired with an ALLOW of the same payload, on the same
 * path, by the same user, on the other side of the purge. A denial alone could
 * not tell "the stale node is gone" from "nothing was ever writable here".
 *
 * THE PURGE IS A STAND-IN, and only for the delete. The real script cannot be
 * pointed at this database without also purging every other spec's sessions
 * (anything with no timestamps is purged defensively). So the delete is applied
 * here as the emulator owner — which is what the Admin SDK is — as ONE root
 * update over the paths scripts/lib/session-trees.js builds, exactly as
 * `db.ref().update(purge)` does. The paths are the library's own: a wrong
 * `recoveryPath` leaves the node standing and every assertion after it fails.
 * No allow/deny verdict is settled with the owner token.
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

/* What the purge does to ONE session: every path its location carries, set to
   null in a single root-level update. */
async function purgeAsOwner(loc) {
  const update = {};
  for (const [prop, value] of Object.entries(loc)) {
    if (prop === "path" || /Path$/.test(prop)) update[value] = null;
  }
  expect(Object.keys(update), "the location carries no recovery path — nothing to test")
    .toContain(loc.recoveryPath);
  const r = await fetch(`${EMU}/.json?ns=${NS}`, {
    method: "PATCH", headers: OWNER, body: JSON.stringify(update)
  });
  if (!r.ok) throw new Error(`owner multi-path update -> HTTP ${r.status}`);
}

/* A code in the alphabet generateSessionCode() uses, unique per call. */
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
   session, so the "other" client would carry the first one's uid. */
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
  catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
}, { path, value });

/* Drive the REAL createSession() through the create form, with the code
   generator pinned to `code` for the next call only. createSession() resolves
   generateSessionCode through the global scope (lib.js publishes it on
   window), so nothing else about the flow is replaced. */
async function createAtCode(page, code) {
  await page.evaluate((forced) => {
    const real = window.generateSessionCode;
    let used = false;
    window.generateSessionCode = () => {
      if (used) return real();
      used = true;
      return forced;
    };
  }, code);
  const createView = page.locator("#splash-create-name");
  if (!(await createView.isVisible())) await page.locator("#splash-go-create").click();
  await createView.fill("Recovery Purge Fac");
  await page.locator("#splash-create-label").fill("recovery-purge");
  await page.locator("#splash-create-pass").fill("emu-init-pw");
  await page.locator("#splash-create-submit").click();
}

/* The client has finished one way or the other: the create form shows its
   error, or the "created" view shows a code. A WAIT, not a verdict — which of
   the two happened is read from the database first. Only meaningful on a form
   that has not failed before (a stale error would satisfy it at once). */
async function createSettled(page) {
  await page.waitForFunction(() => {
    const hint = document.getElementById("splash-create-hint");
    const shown = document.getElementById("splash-shown-code");
    const failed = !!hint && /Could not create the session/.test(hint.textContent || "");
    const made = !!shown && shown.offsetParent !== null && /^\w{3}-\w{3}$/.test((shown.textContent || "").trim());
    return failed || made;
  }, { timeout: 30_000 });
}

const resetPayload = (who, code, uid) => ({ requestedAt: Date.now(), by: who, code, uid });
const OLD = "oldd-code-kept";
const HASH = "v2$100000$1111111111111111";
const MARKER = "v2$100000$aaaaaaaaaaaaaaaa";

test("default tree: a recovery code left behind blocks its session code and still opens the reset — until the purge removes it", async ({ page, browser }) => {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  const X = freshCode();
  const [loc] = sessionLocationsFromKeys([X], {});
  expect(loc.recoveryPath).toBe("recovery/sessions/" + X);

  // What the purge used to leave: the recovery node, and nothing else.
  await ownerPut(loc.recoveryPath, { code: OLD });
  expect(await dbReadAsOwner(loc.path), "precondition: no session at this code").toBeNull();

  await page.goto("/");
  const facilitatorUid = await waitForUid(page);
  const holder = await newUser(browser);         // kept the purged session's recovery code
  expect(holder.uid, "the holder must be a DISTINCT user, or this is the facilitator " +
    "testing themselves").not.toBe(facilitatorUid);

  /* ── BEFORE the purge ─────────────────────────────────────────────── */

  // 1. The real client draws the code. DB first, then the DOM.
  await createAtCode(page, X);
  await createSettled(page);
  /* The batch rejects on its FIRST refusal; the writes queued behind the
     recovery one are acknowledged a moment later, so wait for the last of the
     ones this test names rather than reading once. */
  await expect.poll(() => dbReadAsOwner(loc.path + "/creatorUid"),
    "`creatorUid` landed although the create failed").toBe(facilitatorUid);
  const half = await dbReadAsOwner(loc.path);
  expect(half.created, "`created` landed before the batch rejected").toBeTruthy();
  expect(half.adminPasswordHash, "no password was ever set").toBeUndefined();
  expect(await dbReadAsOwner(loc.adminSecretPath)).toBeNull();
  expect((await dbReadAsOwner(loc.recoveryPath)).code, "the stale code is untouched").toBe(OLD);
  await expect(page.locator("#splash-create-hint")).toHaveText(/Could not create the session/);
  await expect(page.locator("#splash-shown-code")).toBeHidden();

  // 2. The old code, and the session that now sits at its session code.
  //    a. While that session has no password the reset is refused — there is
  //       nothing to reset (reset-needs-a-password.spec.js).
  expect(String(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid))),
    "a reset on a session with no password").toMatch(/permission_denied/i);
  //    b. Its creator gives it one, by hand: the first hash is the creator's.
  expect(await tryWrite(page, loc.adminSecretPath + "/hash", HASH)).toBe("ALLOWED");
  expect(await tryWrite(page, loc.path + "/adminPasswordHash", MARKER)).toBe("ALLOWED");
  //    c. And now the SAME payload from the same user goes through: the stale
  //       record is this session's recovery record, and its code resets a
  //       password its holder never set. (The ALLOW leg for a. and for 2'.)
  expect(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid)),
    "while the stale node stands, its code is the recovery code of the session at that code")
    .toBe("ALLOWED");

  /* ── the purge ────────────────────────────────────────────────────── */
  await purgeAsOwner(loc);
  expect(await dbReadAsOwner(loc.recoveryPath), "the purge removed the recovery node").toBeNull();
  expect(await dbReadAsOwner(loc.path)).toBeNull();

  /* ── AFTER the purge ──────────────────────────────────────────────── */

  // 2'. Same user, same path, same payload: the old code is worth nothing.
  expect(String(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid))),
    "with the node gone the old code must not open a reset").toMatch(/permission_denied/i);

  // 1'. Same client, same code: creation now completes. The password hash and
  //     its marker are the LAST things createSession() writes, so they are the
  //     wait as well as the verdict (the form still shows the first attempt's
  //     error until then).
  await createAtCode(page, X);
  await expect.poll(() => dbReadAsOwner(loc.path + "/adminPasswordHash"),
    { message: "the session never got its password marker — creation at a purged code still fails",
      timeout: 30_000 }).toBeTruthy();
  await expect.poll(() => dbReadAsOwner(loc.adminSecretPath + "/hash"),
    { message: "the real hash, in adminSecrets/" }).toBeTruthy();
  expect(await dbReadAsOwner(loc.path + "/creatorUid")).toBe(facilitatorUid);
  const stored = (await dbReadAsOwner(loc.recoveryPath)).code;
  expect(stored).not.toBe(OLD);
  await expect(page.locator("#splash-shown-code")).toHaveText(X.toUpperCase());
  await expect(page.locator("#splash-recovery-code")).toHaveText(stored);

  // On the NEW session the old code is refused and the session's OWN code
  // works for whoever holds it — the reset path is intact, it is only the
  // stale credential that is gone.
  expect(String(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid))),
    "the old code on the session created after the purge").toMatch(/permission_denied/i);
  expect(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", stored, holder.uid)))
    .toBe("ALLOWED");

  await holder.ctx.close();
});

test("org tree: the same, at recovery/orgs/<slug>/sessions/<id>", async ({ page, browser }) => {
  /* No shipped client can produce an orgs/ path (orgs.js registers only the
     default org), so this half writes the rule-gated nodes directly. What it
     adds is the PATH: the org branch repeats the literal `sessions`, unlike
     adminSecrets/orgs/<slug>/<id>, and a purge aimed at the adminSecrets shape
     would delete nothing. */
  const slug = "rcvorg" + Date.now().toString(36);
  const id = freshCode();
  const [loc] = sessionLocationsFromKeys([], { [slug]: [id] });
  expect(loc.recoveryPath).toBe("recovery/orgs/" + slug + "/sessions/" + id);

  await ownerPut(loc.recoveryPath, { code: OLD });

  await page.goto("/");
  const creatorUid = await waitForUid(page);
  const holder = await newUser(browser);
  expect(holder.uid).not.toBe(creatorUid);
  const MINE = "mine-code-fresh";

  /* A session with a password, written the way its creator's client would,
     minus the recovery code (which is the write under test). */
  const establish = async () => {
    for (const [p, v] of [
      [loc.path + "/created", { by: "Creator", at: Date.now() }],
      [loc.path + "/creatorUid", creatorUid],
      [loc.adminSecretPath + "/hash", HASH],
      [loc.path + "/adminPasswordHash", MARKER]
    ]) expect(await tryWrite(page, p, v), "the creator writes " + p).toBe("ALLOWED");
  };

  /* ── BEFORE ── */
  expect(String(await tryWrite(page, loc.recoveryPath, { code: MINE })),
    "write-once: a new session cannot store its own code over the stale one")
    .toMatch(/permission_denied/i);
  expect(String(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid))),
    "no session, so no password: nothing to reset").toMatch(/permission_denied/i);
  await establish();
  expect(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid)),
    "the stale record is now the recovery record of the session at its code").toBe("ALLOWED");

  /* ── the purge ── */
  await purgeAsOwner(loc);
  expect(await dbReadAsOwner(loc.recoveryPath)).toBeNull();
  expect(await dbReadAsOwner(loc.path)).toBeNull();

  /* ── AFTER: each verdict above, reversed, on the same payload ── */
  expect(await tryWrite(page, loc.recoveryPath, { code: MINE })).toBe("ALLOWED");
  expect((await dbReadAsOwner(loc.recoveryPath)).code).toBe(MINE);
  await establish();
  expect(String(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", OLD, holder.uid))),
    "the old code on the session created after the purge").toMatch(/permission_denied/i);
  expect(await tryWrite(holder.page, loc.path + "/_superadminReset", resetPayload("Holder", MINE, holder.uid)),
    "the session's own code, by whoever holds it").toBe("ALLOWED");

  await holder.ctx.close();
});
