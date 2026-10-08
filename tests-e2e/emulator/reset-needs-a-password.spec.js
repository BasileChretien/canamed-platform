/* tests-e2e/emulator/reset-needs-a-password.spec.js
 *
 * The password RESET, and the RECOVERY CODE it rests on, on sessions that have
 * no password — the states the reset was never meant for and used to work in.
 *
 * The RESET FLAG is the "forgotten admin password" path: write it with the
 * session's recovery code and, for 30 seconds, you may overwrite the admin
 * hash. (The flag lives at adminSecrets/…/reset/<own uid>; when this file was
 * first written it was sessions/<code>/_superadminReset — see flagPath below.)
 * Until PR #447 its rule asked for a matching `recovery/…/code` and a
 * session that was not closed, and NOTHING ELSE about the session; and the
 * recovery node itself could be written by any signed-in user (any allowlisted
 * one, while the creation gate is enforced) as long as the node and the
 * session's password did not exist yet. Together:
 *
 *   - on a session with no password, whoever held its recovery code set the
 *     FIRST hash — whatever `creatorUid` said, although the hash rule binds
 *     its first write to the creator;
 *   - on a session with no password AND no recovery node, anyone could write a
 *     code of their own and then do the same. That is exactly a session
 *     restored from the nightly archive, which holds the session body only:
 *     no password marker, no `adminSecrets`, no `recovery`.
 *
 * Both were measured here before the rules changed (the BEFORE column of the
 * tables below is that run, not a recollection). Two predicates close them:
 *
 *   (a) the reset flag requires the session to HAVE a password
 *       (`adminPasswordHash` exists). A reset needs something to reset.
 *   (b) the recovery node may be written only where the session has no
 *       `creatorUid` yet, or by that creator.
 *
 * (a) ALONE IS NOT ENOUGH, and one row below exists to show it: with only (a),
 * a stranger still PLANTS a code on a hashless session, waits for its creator
 * to set a password, and resets it then. Run against rules carrying (a) and
 * not (b), the cells marked ‡ come out ALLOWED.
 *
 * HOW TO READ THE TABLES. Every step is one write, by one user, and its verdict
 * under the rules as they are now. Each DENIED has an ALLOWED for the same
 * payload ON THE SAME PATH: by a user who should be able to, or by the same
 * user in the state the write is for — once the session has a password, or
 * before it was closed. A denial alone could not tell "the gate held" from
 * "nothing was ever writable here". ONE cell cannot have that and says so: a
 * session closed from the start is never resettable, so its pair is the same
 * payload on the session beside it, before that one was closed.
 * The BEFORE and "(a) only" comments are the runs of 2026-10-07 against main's
 * rules and against rules carrying (a) alone; a cell with no comment was the
 * same in all three, or was added afterwards and run against the final rules.
 *
 * WHAT IS STILL OPEN, and pinned as such rather than implied closed:
 *   - A session with NO `creatorUid` (hand-made, or older than the field) can
 *     be given its first password by anyone — the hash rule says so itself —
 *     so binding the recovery write to a creator adds nothing there.
 *   - A STALE recovery record at a session's code still resets that session
 *     once it has a password. What removes stale records is the purge and the
 *     sweep (tests-e2e/emulator/recovery-purge.spec.js), not these rules.
 *
 * Seeding is done as the emulator owner — the Admin SDK, which is what a
 * restore or a purge is. No allow/deny verdict is settled with the owner token.
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");
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
   session, so the "stranger" would carry the creator's uid. */
async function newUser(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  await page.goto("/");
  return { ctx, page, uid: await waitForUid(page) };
}

/* ALLOWED, DENIED, or the raw error for anything that is neither — an
   unexpected failure must not be mistaken for a rule's verdict. */
const tryWrite = (page, path, value) => page.evaluate(async ({ path, value }) => {
  try { await firebase.database().ref(path).set(value); return "ALLOWED"; }
  catch (e) {
    const code = String((e && (e.code || e.message)) || "");
    return /permission_denied/i.test(code) ? "DENIED" : "ERROR: " + code;
  }
}, { path, value });

const HASH_1 = "v2$100000$1111111111111111";
const HASH_2 = "v2$100000$2222222222222222";
const MARKER = "v2$100000$aaaaaaaaaaaaaaaa";
const OLD = "oldd-code-kept";       // a recovery code from a session long gone
const PLANT = "plnt-code-mine";     // a code the writer chose

/* The reset flag: adminSecrets/…/reset/<the writer's own uid>, where no client
   can read it. (Until 2026-10 it was sessions/<code>/_superadminReset, which
   every member of the session could read — reset-flag-unreadable.spec.js.) */
const flagPath = (loc, uid) => loc.adminSecretPath + "/reset/" + uid;
const flag = (code) => ({ requestedAt: Date.now(), code });
/* What the archive holds for a session: its body. `creatorUid` is in it; the
   password marker is stripped by the backup, and neither `adminSecrets` nor
   `recovery` is archived at all. */
const restoredBody = (creatorUid, extra) => Object.assign(
  { created: { by: "Original Facilitator", at: Date.now() - 20 * 864e5 }, workshopLabel: "restored" },
  creatorUid ? { creatorUid } : {}, extra || {});

/* The two session trees, as the purge library builds their paths. */
function locFor(tree) {
  const code = freshCode();
  if (tree === "default") return sessionLocationsFromKeys([code], {})[0];
  return sessionLocationsFromKeys([], { ["rstorg" + Date.now().toString(36)]: [code] })[0];
}

for (const tree of ["default", "org"]) {
  test(`${tree} tree: a reset needs a password, and a recovery code is its creator's to write`, async ({ page, browser }) => {
    await page.goto("/");
    const creator = { page, uid: await waitForUid(page) };
    const stranger = await newUser(browser);
    expect(stranger.uid, "the stranger must be a DISTINCT user, or every row below is " +
      "the creator testing themselves").not.toBe(creator.uid);

    const got = {};
    const step = async (name, who, path, value) => { got[name] = await tryWrite(who.page, path, value); };

    /* ── ROW 1: restored, open — a body with a creatorUid, no password, no
       recovery node. The stranger knows the session code and nothing else. */
    const r = locFor(tree);
    await ownerPut(r.path, restoredBody(creator.uid));
    await step("restored: a stranger writes a recovery code", stranger, r.recoveryPath, { code: PLANT });
    await step("restored: THE CREATOR writes the same recovery code", creator, r.recoveryPath, { code: PLANT });
    await step("restored: a stranger opens a reset before any password exists", stranger,
      flagPath(r, stranger.uid), flag(PLANT));
    await step("restored: a stranger sets the first hash", stranger, r.adminSecretPath + "/hash", HASH_1);
    await step("restored: THE CREATOR sets the first hash", creator, r.adminSecretPath + "/hash", HASH_1);
    await step("restored: the creator writes the password marker", creator, r.path + "/adminPasswordHash", MARKER);
    /* The session now has a password, and its recovery code is the one its
       creator wrote. From here the reset is what it was built to be: whoever
       holds that code may use it — the creator on another device, typically. */
    await step("restored, now keyed: the SAME reset by the same user is the recovery path", stranger,
      flagPath(r, stranger.uid), flag(PLANT));
    await step("restored, now keyed: and overwrites the hash", stranger, r.adminSecretPath + "/hash", HASH_2);
    /* …and once the session is closed, the very same write is refused. (Closed
       by the owner token: closing is not what is under test.) */
    await ownerPut(r.path + "/closed", { by: "Original Facilitator", at: Date.now() });
    await step("restored, keyed, then CLOSED: the same reset by the same user is refused", stranger,
      flagPath(r, stranger.uid), flag(PLANT));

    /* ── ROW 2: half-created — what the client leaves when it draws a code
       whose recovery record outlived an earlier session: `created`, a
       `creatorUid`, no password, and somebody else's old recovery code. */
    const h = locFor(tree);
    await ownerPut(h.path, { created: { by: "Facilitator", at: Date.now() }, creatorUid: creator.uid });
    await ownerPut(h.recoveryPath, { code: OLD });
    await step("half-created: the holder of the OLD code opens a reset", stranger,
      flagPath(h, stranger.uid), flag(OLD));
    await step("half-created: and sets the first hash", stranger, h.adminSecretPath + "/hash", HASH_1);
    await step("half-created: THE CREATOR sets the first hash", creator, h.adminSecretPath + "/hash", HASH_1);
    await step("half-created: the creator writes the password marker", creator, h.path + "/adminPasswordHash", MARKER);
    /* STILL OPEN, by these rules: a stale record's code is a recovery code. */
    await step("half-created, now keyed: the OLD code resets it (STILL OPEN — the purge's job)", stranger,
      flagPath(h, stranger.uid), flag(OLD));

    /* ── ROW 3: restored, CLOSED. */
    const c = locFor(tree);
    await ownerPut(c.path, restoredBody(creator.uid, { closed: { by: "Original Facilitator", at: Date.now() - 864e5 } }));
    await step("closed: a stranger writes a recovery code", stranger, c.recoveryPath, { code: PLANT });
    await step("closed: THE CREATOR writes the same recovery code", creator, c.recoveryPath, { code: PLANT });
    await step("closed: a stranger sets the first hash", stranger, c.adminSecretPath + "/hash", HASH_1);
    await step("closed: THE CREATOR sets the first hash", creator, c.adminSecretPath + "/hash", HASH_1);
    await step("closed: the creator writes the password marker", creator, c.path + "/adminPasswordHash", MARKER);
    /* The one cell with no allow on its own path: this session was never open.
       Its pair is "restored, now keyed" above — the same payload shape, allowed
       there until that session was closed. */
    await step("closed from the start: not resettable even by its creator, password or not", creator,
      flagPath(c, creator.uid), flag(PLANT));

    /* ── ROW 4: NO creatorUid — hand-made, or older than the field. The hash
       rule opens the first password to anyone here, so this state is open by
       design and the recovery write neither adds to it nor closes it. */
    const n = locFor(tree);
    await ownerPut(n.path, restoredBody(null));
    await step("no creator: a stranger writes a recovery code (OPEN BY DESIGN)", stranger, n.recoveryPath, { code: PLANT });
    await step("no creator: but cannot reset before a password exists", stranger,
      flagPath(n, stranger.uid), flag(PLANT));
    await step("no creator: a stranger sets the first hash directly (OPEN BY DESIGN)", stranger,
      n.adminSecretPath + "/hash", HASH_1);
    await step("no creator: …and the password marker (OPEN BY DESIGN)", stranger, n.path + "/adminPasswordHash", MARKER);
    await step("no creator, now keyed: the SAME reset by the same user goes through", stranger,
      flagPath(n, stranger.uid), flag(PLANT));

    /* ── CREATING A SESSION, in both orders the first batch can arrive in.
       createSession() issues `created`, the recovery code and `creatorUid`
       together: the recovery write may land before `creatorUid` or after it. */
    const a = locFor(tree);
    await step("create, recovery first: created", creator, a.path + "/created", { by: "C", at: Date.now() });
    await step("create, recovery first: recovery code (no creatorUid yet)", creator, a.recoveryPath, { code: PLANT });
    await step("create, recovery first: creatorUid", creator, a.path + "/creatorUid", creator.uid);
    const b = locFor(tree);
    await step("create, creatorUid first: created", creator, b.path + "/created", { by: "C", at: Date.now() });
    await step("create, creatorUid first: creatorUid", creator, b.path + "/creatorUid", creator.uid);
    await step("create, creatorUid first: recovery code (creatorUid is the writer's)", creator, b.recoveryPath, { code: PLANT });

    expect(got).toEqual({
      /*                                                              NOW       BEFORE   (a) only */
      "restored: a stranger writes a recovery code":                 "DENIED",  // ALLOWED  ALLOWED ‡
      "restored: THE CREATOR writes the same recovery code":         "ALLOWED", // DENIED   DENIED   (write-once: the stranger's was there)
      "restored: a stranger opens a reset before any password exists": "DENIED", // ALLOWED  DENIED
      "restored: a stranger sets the first hash":                    "DENIED",  // ALLOWED  DENIED
      "restored: THE CREATOR sets the first hash":                   "ALLOWED", // DENIED   ALLOWED  (before: the stranger's was there)
      "restored: the creator writes the password marker":            "ALLOWED", // ALLOWED  ALLOWED
      "restored, now keyed: the SAME reset by the same user is the recovery path": "ALLOWED", // ALLOWED ALLOWED ‡
      "restored, now keyed: and overwrites the hash":                "ALLOWED", // ALLOWED  ALLOWED ‡
      "restored, keyed, then CLOSED: the same reset by the same user is refused": "DENIED",

      "half-created: the holder of the OLD code opens a reset":      "DENIED",  // ALLOWED  DENIED
      "half-created: and sets the first hash":                       "DENIED",  // ALLOWED  DENIED
      "half-created: THE CREATOR sets the first hash":               "ALLOWED", // DENIED   ALLOWED
      "half-created: the creator writes the password marker":        "ALLOWED", // ALLOWED  ALLOWED
      "half-created, now keyed: the OLD code resets it (STILL OPEN — the purge's job)": "ALLOWED",

      "closed: a stranger writes a recovery code":                   "DENIED",  // ALLOWED  ALLOWED
      "closed: THE CREATOR writes the same recovery code":           "ALLOWED", // DENIED   DENIED
      "closed: a stranger sets the first hash":                      "DENIED",
      "closed: THE CREATOR sets the first hash":                     "ALLOWED",
      "closed: the creator writes the password marker":              "ALLOWED",
      "closed from the start: not resettable even by its creator, password or not": "DENIED",

      "no creator: a stranger writes a recovery code (OPEN BY DESIGN)": "ALLOWED",
      "no creator: but cannot reset before a password exists":       "DENIED",  // ALLOWED  DENIED
      "no creator: a stranger sets the first hash directly (OPEN BY DESIGN)": "ALLOWED",
      "no creator: …and the password marker (OPEN BY DESIGN)":       "ALLOWED",
      "no creator, now keyed: the SAME reset by the same user goes through": "ALLOWED",

      "create, recovery first: created":                             "ALLOWED",
      "create, recovery first: recovery code (no creatorUid yet)":   "ALLOWED",
      "create, recovery first: creatorUid":                          "ALLOWED",
      "create, creatorUid first: created":                           "ALLOWED",
      "create, creatorUid first: creatorUid":                        "ALLOWED",
      "create, creatorUid first: recovery code (creatorUid is the writer's)": "ALLOWED"
    });

    await stranger.ctx.close();
  });
}

test("under an enforced creation gate: an old recovery code opens nothing at a code with no session, and real recovery still works — both trees", async ({ page, browser }) => {
  /* `facilitatorGate` restricts who may create a session. The reset and the
     hash rules' reset branch are deliberately NOT gated — a facilitator who has
     been taken off the allowlist must still be able to recover a session they
     run. Without (a), that left a way round the gate for anyone holding an old
     recovery code whose record had outlived its session: reset, hash, proof,
     at a code where no session exists. */
  await page.goto("/");
  const allowed = { page, uid: await waitForUid(page) };
  const outsider = await newUser(browser);
  expect(outsider.uid).not.toBe(allowed.uid);

  const got = {};
  const step = async (name, who, path, value) => { got[name] = await tryWrite(who.page, path, value); };

  await ownerPut("facilitatorGate", { enforce: true, allow: { [allowed.uid]: true } });
  try {
    for (const tree of ["default", "org"]) {
      /* A recovery record with NO session beside it. */
      const o = locFor(tree);
      await ownerPut(o.recoveryPath, { code: OLD });
      await step(`${tree}: an outsider cannot begin a session (the gate)`, outsider, o.path + "/created", { by: "O", at: Date.now() });
      await step(`${tree}: an outsider with the OLD code opens a reset where there is no session`, outsider,
        flagPath(o, outsider.uid), flag(OLD));
      await step(`${tree}: and sets a hash there`, outsider, o.adminSecretPath + "/hash", HASH_1);
      /* The same three paths, once the ALLOWLISTED user has put a session with
         a password there. The first is the pair of the gate's refusal. The
         other two are the pair of the reset's — and they are also the item
         this file pins as STILL OPEN: the old record is that session's recovery
         record now, so its code resets it, for an outsider as for anyone. */
      await step(`${tree}: the allowlisted user begins a session at that code (same payload)`, allowed,
        o.path + "/created", { by: "O", at: Date.now() });
      await step(`${tree}: …its creatorUid`, allowed, o.path + "/creatorUid", allowed.uid);
      await step(`${tree}: …its first hash`, allowed, o.adminSecretPath + "/hash", HASH_2);
      await step(`${tree}: …its password marker`, allowed, o.path + "/adminPasswordHash", MARKER);
      await step(`${tree}: with a password there, the outsider's SAME reset goes through (STILL OPEN)`, outsider,
        flagPath(o, outsider.uid), flag(OLD));
      await step(`${tree}: and the SAME hash write`, outsider, o.adminSecretPath + "/hash", HASH_1);

      /* A session established by the allowlisted user, in the client's order. */
      const e = locFor(tree);
      await step(`${tree}: the allowlisted user creates: created`, allowed, e.path + "/created", { by: "A", at: Date.now() });
      await step(`${tree}: …recovery code`, allowed, e.recoveryPath, { code: PLANT });
      await step(`${tree}: …creatorUid`, allowed, e.path + "/creatorUid", allowed.uid);
      await step(`${tree}: …first hash`, allowed, e.adminSecretPath + "/hash", HASH_1);
      await step(`${tree}: …password marker`, allowed, e.path + "/adminPasswordHash", MARKER);
      /* Recovery under enforcement, by someone who is NOT on the allowlist and
         holds the session's code: the same payload shape as the refusal above. */
      await step(`${tree}: an outsider WITH THE SESSION'S CODE resets an established session`, outsider,
        flagPath(e, outsider.uid), flag(PLANT));
      await step(`${tree}: and overwrites its hash`, outsider, e.adminSecretPath + "/hash", HASH_2);
    }
  } finally {
    // ALWAYS clear the gate, or every later test's session creation is refused.
    await ownerPut("facilitatorGate", null);
  }

  const expected = {};
  for (const tree of ["default", "org"]) {
    Object.assign(expected, {
      [`${tree}: an outsider cannot begin a session (the gate)`]: "DENIED",
      [`${tree}: an outsider with the OLD code opens a reset where there is no session`]: "DENIED", // BEFORE: ALLOWED
      [`${tree}: and sets a hash there`]: "DENIED",                                                 // BEFORE: ALLOWED
      [`${tree}: the allowlisted user begins a session at that code (same payload)`]: "ALLOWED",
      [`${tree}: …its creatorUid`]: "ALLOWED",
      [`${tree}: …its first hash`]: "ALLOWED",
      [`${tree}: …its password marker`]: "ALLOWED",
      [`${tree}: with a password there, the outsider's SAME reset goes through (STILL OPEN)`]: "ALLOWED",
      [`${tree}: and the SAME hash write`]: "ALLOWED",
      [`${tree}: the allowlisted user creates: created`]: "ALLOWED",
      [`${tree}: …recovery code`]: "ALLOWED",
      [`${tree}: …creatorUid`]: "ALLOWED",
      [`${tree}: …first hash`]: "ALLOWED",
      [`${tree}: …password marker`]: "ALLOWED",
      [`${tree}: an outsider WITH THE SESSION'S CODE resets an established session`]: "ALLOWED",
      [`${tree}: and overwrites its hash`]: "ALLOWED"
    });
  }
  expect(got).toEqual(expected);

  await outsider.ctx.close();
});
