/* tests-e2e/emulator/room-writes-room-bound.spec.js
 *
 * Seven writes inside a room named nobody. Until 2026-10-14 the rule on each
 * of
 *
 *     rooms/<room>/teamName
 *     rooms/<room>/roleplayRound
 *     rooms/<room>/callForHelp
 *     rooms/<room>/sections/<slot>/revealed/<item>
 *     rooms/<room>/moduleA/revealed/<item>          (the address before slots)
 *     rooms/<room>/events/<id>
 *     rooms/<room>/answerReplies/<entry>/<reply>
 *
 * was "signed in, and the session is not closed" — in both rule trees. Signing
 * in is automatic and anonymous, so the writer could be any visitor who knew a
 * session code: no `members` entry, no client id, no room.
 *
 * WHAT THAT ALLOWED — measured on this emulator on 2026-10-08, before the rules changed, with
 * the real client in every seat and a further browser context that had never
 * entered the code (the probes are not in the repository; the numbers are in
 * the pull request that added this file):
 *
 *   - a revealed MRI: within a tenth of a second a participant's own client
 *     wrote the 12-point penalty for it. The stranger then deleted the reveal;
 *     the penalty stayed, and nobody in the room can remove one;
 *   - a call for help: on the facilitator's dashboard, with the stranger's 200
 *     characters, and a badge in the tab title. The thirty-second limit did not
 *     apply: delete, then call again. And a REAL call from the room was
 *     cancelled — the dashboard's alert went from raised to nothing;
 *   - the roleplay round: every participant's client rotated its own role and
 *     showed "You've swapped seats"; set back and raised again, it rotated again;
 *   - replies to answers: one forged under a participant's name, a real one
 *     rewritten, a real one deleted;
 *   - the team name: on the room's score chip and on the dashboard;
 *   - the event log, which nothing displays: an entry dated and signed as the
 *     facilitator, kept with the session in the backup and the export;
 *   - the legacy reveal address: the dashboard's "findings 0/31" became 1/31
 *     for a room that had found nothing.
 *
 * THE RULE NOW, in both trees — appended to what each had. On six of them:
 *
 *     the writer's room claim names THIS room      (roomOf/<uid>/room)
 *     OR the writer is the session's facilitator   (its creator, or a proof of
 *                                                   the current password)
 *
 * and on the call for help: a room claim on ANY room of the session, or the
 * facilitator. Why it asks for less, and what that costs, is at the two places
 * below that pin it (the first test's call-for-help section; the last test).
 *
 * WHY THE SECOND HALF. The room condition alone is what the neighbouring nodes
 * have, and it would have been wrong here. The facilitator writes six of
 * these with no claim on the room, and all of that was run before a line of
 * the rule was written:
 *   - `events`: every stage change from the dashboard logs one, in every room;
 *   - `callForHelp`: "Resolve call" inside a room is a delete;
 *   - `teamName`, `answerReplies`, `revealed`, `roleplayRound`: a facilitator
 *     who opens a room is shown the room's own controls, and they work.
 * (The seventh, the legacy reveal address, has no client writer left; it
 * carries the same rule so that the old address is not the one left open.)
 * A facilitator does acquire a claim — on the FIRST room it opens, through the
 * claim rule's own facilitator branch — and never another. So "the room
 * condition" would have meant: works in the first room visited, refused in
 * every other, and of those controls only "Save name" reports a failed write.
 *
 * WHAT IT DOES NOT DO, and one test below exists to say so. Joining a session
 * takes three writes and asks for nothing but the code. Somebody who has the
 * code can therefore still do all of the above — as a participant: in ONE
 * room, the one they joined, and listed in the facilitator's waiting room
 * WHEN THEY JOIN. (Not for good: the pool entry's owner can delete it and the
 * write-once claim stays. Read from the rules; no test here runs it.) This
 * binds a writer to a room. It is not a boundary against a person who has the
 * code.
 *
 * AND WHO IT REFUSES THAT IS NOT A STRANGER. A participant shown a room their
 * claim does not name. There is a way into that state through the product,
 * measured on 2026-10-08 too: press Leave, join again in the same browser. The
 * account and its write-once claim survive; the room is chosen afresh, and on
 * a tie it is the first by name. Twice out of two a participant who left
 * "Room 2" came back in "Room 1" holding a claim on "Room 2", with no message.
 * Such a participant's answers were ALREADY refused there (and the box kept
 * the text while a toast said "+3 — First answer written"). Their call for
 * help and their reveals were not. Their reveals now are — and their call for
 * help is NOT, by decision: it asks for a claim on any room, so that this
 * participant keeps the one control that still worked for them (the last
 * test). The call lands; the `help` entry the button also writes to the
 * room's event log does not, since `events` still asks for a claim on the
 * room itself. And a participant with NO claim at all is still refused the
 * call, where on the old rules it landed: no route through the product into
 * that state has been shown. The `neighbour` below is the misplaced
 * participant as far as the rules can tell. The repair is in the client (place a returning participant in the
 * room they hold), not here.
 *
 * ── A denial here is never left to stand alone ──────────────────────────
 * Every refused write has its ALLOW: the same payload, on the same path, by a
 * member of that room. A rule that refused everybody would pass a denial-only
 * test — and these are the nodes a room is worked through.
 *
 * ── A second user is a second CONTEXT ───────────────────────────────────
 * A second page in a context is the first user again. Every identity below is
 * its own browser context, and each test asserts the uids differ.
 *
 * ── The DB value first, then the DOM ────────────────────────────────────
 * dbReadAsOwner() observes; it never decides a verdict.
 */

// @ts-check
const { test, expect, useEmulator, claimRoom, dbReadAsOwner } = require("./fixtures.js");

async function signedInUid(page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* One write through the rules. `value === undefined` is a delete. */
function tryWrite(page, path, value) {
  return page.evaluate(async ([p, v, del]) => {
    try {
      const ref = firebase.database().ref(p);
      if (del) await ref.remove(); else await ref.set(v);
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  }, [path, value === undefined ? null : value, value === undefined]);
}
const tryDelete = (page, path) => tryWrite(page, path, undefined);

/* A denial must be a PERMISSION denial: tryWrite() reports any error, so a bare
   .not.toBe("ALLOWED") also passes on a transport or config failure. */
function expectDenied(result, why) {
  expect(result, why).not.toBe("ALLOWED");
  expect(String(result), why + " (and denied for PERMISSION, not by a transport error)")
    .toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
}

/* Its own browser context, hence its own anonymous user. */
async function someone(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  const uid = await signedInUid(page);
  return { ctx, page, uid };
}

const uniq = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const HEX_A = "a".repeat(64);          // the readable marker
const HEX_C = "c".repeat(64);          // the real hash, where no client can read it

const TREES = [
  ["sessions/", (id) => "sessions/" + id, (id) => "adminSecrets/" + id],
  ["orgs/<slug>/sessions/", (id) => "orgs/e2e-org/sessions/" + id, (id) => "adminSecrets/orgs/e2e-org/" + id]
];

/* Six of the seven — the call for help, whose rule also carries a time limit,
   has a section of its own below. One VALID payload per node, used unchanged
   for every identity, so that a denial can only be the write gate: never the
   validator, and never a payload that differs from the one that is then
   allowed. It is BUILT when its node's turn comes (`make()`), not when the
   test starts: the event log accepts a date no older than a minute, and a
   payload stamped once for the whole test would, on a slow run, be refused to
   the member for its age — failing the allow leg with a message about the
   gate. `key` is for the two nodes whose last segment is an id the writer
   picks. */
const SIX_OF_THE_SEVEN = [
  { name: "teamName", path: () => "teamName", make: () => "Team Alpha" },
  { name: "roleplayRound", path: () => "roleplayRound", make: () => 2 },
  { name: "sections/<slot>/revealed/<item>", path: () => "sections/1/revealed/history:0",
    make: () => ({ by: "Room One", at: Date.now() }) },
  { name: "moduleA/revealed/<item>", path: () => "moduleA/revealed/history:0",
    make: () => ({ by: "Room One", at: Date.now() }) },
  { name: "answerReplies/<entry>/<reply>", path: (key) => "answerReplies/e1/" + (key || "r1"),
    make: () => ({ text: "a counter-point", by: "Room One", cid: "c-room-one", at: Date.now(), stance: "disagree" }) },
  /* Write-once: each writer needs an id of its own. */
  { name: "events/<id>", path: (key) => "events/" + (key || "ev1"), appendOnly: true,
    make: () => ({ kind: "reveal", by: "Room One", at: Date.now(), payload: "{\"itemId\":\"history:0\"}" }) }
];

for (const [tree, baseOf, secretsOf] of TREES) {
  test(`rules: ${tree} — a room's seven open writes are the room's and the facilitator's, and nobody else's`, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const id = uniq("room-");
    const base = baseOf(id);
    const room = `${base}/rooms/Room 1`;

    /* The facilitator: creates the session and gives it a password. */
    const creatorUid = await signedInUid(page);
    expect(await tryWrite(page, `${base}/creatorUid`, creatorUid)).toBe("ALLOWED");
    expect(await tryWrite(page, `${base}/adminPasswordHash`, HEX_A)).toBe("ALLOWED");
    expect(await tryWrite(page, `${secretsOf(id)}/hash`, HEX_C)).toBe("ALLOWED");

    const member = await someone(browser);        // joins Room 1
    const neighbour = await someone(browser);     // joins Room 2 — a member of the SESSION, not of this room
    const stranger = await someone(browser);      // knows the code, joins nothing
    const cofac = await someone(browser);         // proves the password; not the creator
    const uids = [creatorUid, member.uid, neighbour.uid, stranger.uid, cofac.uid];
    expect(new Set(uids).size, "five DISTINCT users, or every verdict below is about somebody else").toBe(5);

    await claimRoom(member.page, base, "Room 1", member.uid);
    await claimRoom(neighbour.page, base, "Room 2", neighbour.uid);
    expect(await tryWrite(cofac.page, `${secretsOf(id)}/proof/${cofac.uid}`, HEX_C),
      "the co-facilitator proves the password").toBe("ALLOWED");

    /* Who holds what — read, not assumed. The two facilitators have NO room
       claim, so that every allow of theirs below can only be the facilitator
       half of the rule; and the stranger has left no trace in the session. */
    expect((await dbReadAsOwner(`${base}/roomOf/${member.uid}`)).room).toBe("Room 1");
    expect((await dbReadAsOwner(`${base}/roomOf/${neighbour.uid}`)).room).toBe("Room 2");
    for (const [who, uid] of [["the creator", creatorUid], ["the co-facilitator", cofac.uid], ["the stranger", stranger.uid]]) {
      expect(await dbReadAsOwner(`${base}/roomOf/${uid}`), `${who} holds no room claim`).toBeNull();
    }
    expect(await dbReadAsOwner(`${base}/members/${stranger.uid}`), "the stranger is not a member").toBeNull();
    expect(Object.keys(await dbReadAsOwner(`${base}/pool`)), "…and the pool lists the two who joined, only")
      .toHaveLength(2);

    for (const spec of SIX_OF_THE_SEVEN) {
      /* One payload object for this node, for every identity below. */
      const node = { name: spec.name, path: spec.path, appendOnly: spec.appendOnly, payload: spec.make() };
      const at = `${room}/${node.path()}`;

      /* ── refused: no claim at all, and a claim on ANOTHER room ─────────── */
      expectDenied(await tryWrite(stranger.page, at, node.payload),
        `${node.name}: written by a visitor who knows the code and has joined nothing`);
      expectDenied(await tryWrite(neighbour.page, at, node.payload),
        `${node.name}: written by a participant of the same session who is in another room`);
      expect(await dbReadAsOwner(at), `${node.name}: neither refused write landed`).toBeNull();

      /* ── THE ALLOW LEG: same path, same payload, a member of the room ──── */
      expect(await tryWrite(member.page, at, node.payload),
        `${node.name}: a participant of this room must be able to write it`).toBe("ALLOWED");
      expect(await dbReadAsOwner(at), `${node.name}: and it is what the participant wrote`).toEqual(node.payload);

      /* ── a delete is a write too, and no validator runs on one ─────────── */
      expectDenied(await tryDelete(stranger.page, at), `${node.name}: deleted by the stranger`);
      expectDenied(await tryDelete(neighbour.page, at), `${node.name}: deleted from another room`);
      expect(await dbReadAsOwner(at), `${node.name}: still there`).toEqual(node.payload);

      /* ── the facilitator, who has no claim on this room ────────────────── */
      const facAt = node.appendOnly ? `${room}/${node.path("ev-creator")}` : at;
      const cofacAt = node.appendOnly ? `${room}/${node.path("ev-cofac")}` : at;
      expect(await tryWrite(page, facAt, node.payload),
        `${node.name}: the session's creator, from the dashboard or from inside any room`).toBe("ALLOWED");
      expect(await tryWrite(cofac.page, cofacAt, node.payload),
        `${node.name}: a co-facilitator, whose title is a proof no client can read`).toBe("ALLOWED");
      expect(await dbReadAsOwner(cofacAt)).toEqual(node.payload);

      if (node.appendOnly) {
        /* The log stays append-only for the people who may write to it. Not an
           identity denial: its allow leg is the same member, a new id. */
        expectDenied(await tryWrite(member.page, at, node.payload), "events: an entry rewritten by a member");
        expectDenied(await tryDelete(member.page, at), "events: an entry deleted by a member");
        expectDenied(await tryDelete(page, at), "events: an entry deleted by the facilitator");
        expect(await tryWrite(member.page, `${room}/${node.path("ev-member-2")}`, node.payload),
          "events: the same member appends a second entry").toBe("ALLOWED");
      } else {
        expect(await tryDelete(member.page, at), `${node.name}: removed by a member of the room`).toBe("ALLOWED");
        expect(await dbReadAsOwner(at)).toBeNull();
      }
    }

    /* ── the call for help: raising, cancelling, resolving ─────────────────
       Its rule also carries a thirty-second limit, so each step is taken from
       a state in which only the WRITER decides the outcome. */
    const call = `${room}/callForHelp`;
    const CALL = { by: "Room One", at: Date.now(), msg: "we are ready to move on" };
    expectDenied(await tryWrite(stranger.page, call, CALL), "callForHelp: raised by the stranger");
    expect(await dbReadAsOwner(call), "no call reached the dashboard").toBeNull();
    expect(await tryWrite(member.page, call, CALL), "callForHelp: raised by a member — the same payload").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toEqual(CALL);
    /* Cancelling somebody else's call was the worst of what was measured. */
    expectDenied(await tryDelete(stranger.page, call), "callForHelp: a real call cancelled by the stranger");
    expect(await dbReadAsOwner(call), "the room's call is still raised").toEqual(CALL);

    /* THE ONE OF THE SEVEN THAT ASKS FOR LESS, and its price, pinned. The call
       for help needs a claim on A room of this session — any room — or the
       facilitator. Decided on 2026-10-14 after review: with a claim on THIS
       room required, a participant the product had moved to another room
       (Leave, join again; the last test in this file) lost the one control
       that still worked for them. So the neighbour, who holds a claim on
       Room 2, can cancel Room 1's call and raise one there. That is the
       residual the decision accepted: somebody who has JOINED can raise or
       cancel calls in other rooms. The stranger above, who has joined
       nothing, cannot — same payload, same path. If these two lines deny,
       the call for help has been bound to its room again: read the last test
       before deleting them. */
    expect(await tryDelete(neighbour.page, call),
      "callForHelp: cancelled by a participant of ANOTHER room — the accepted residual").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toBeNull();
    expect(await tryWrite(neighbour.page, call, CALL),
      "callForHelp: raised by a participant of another room — the accepted residual").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toEqual(CALL);
    /* …and nothing else of Room 1's is theirs: the loop above refused them the
       other six, with these same two identities. */
    /* "Resolve call": the facilitator's own delete, from a room it has no claim on. */
    expect(await tryDelete(cofac.page, call), "callForHelp: resolved by a co-facilitator").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toBeNull();
    expect(await tryWrite(member.page, call, CALL)).toBe("ALLOWED");
    expect(await tryDelete(page, call), "callForHelp: resolved by the creator").toBe("ALLOWED");
    /* …and the member's own cancel. */
    expect(await tryWrite(member.page, call, CALL)).toBe("ALLOWED");
    expect(await tryDelete(member.page, call), "callForHelp: cancelled by the room that raised it").toBe("ALLOWED");
    /* The limit itself is unchanged, and applies to the room's own members:
       a second call over an unanswered one is refused inside thirty seconds —
       the allow leg is the first call, three lines up, same payload. */
    expect(await tryWrite(member.page, call, CALL)).toBe("ALLOWED");
    expectDenied(await tryWrite(member.page, call, CALL), "callForHelp: raised again over an unanswered call");
    expect(await tryDelete(member.page, call)).toBe("ALLOWED");

    /* ── a closed session takes none of it, from anybody ───────────────────
       Unchanged by this fix; asserted because the clause sits in the same
       expression and must have survived the edit. The allow legs are above:
       same writers, same payloads, session open. */
    expect(await tryWrite(page, `${base}/closed`, { by: "Emu Fac", at: Date.now() }),
      "the creator closes the session").toBe("ALLOWED");
    expectDenied(await tryWrite(member.page, `${room}/teamName`, "Team Alpha"), "teamName: by a member, session closed");
    expectDenied(await tryWrite(page, `${room}/teamName`, "Team Alpha"), "teamName: by the creator, session closed");
    expectDenied(await tryWrite(member.page, `${room}/events/after-close`,
      { kind: "reveal", by: "Room One", at: Date.now() }), "events: by a member, session closed");

    for (const u of [member, neighbour, stranger, cofac]) await u.ctx.close();
  });
}

test("rules: what the room condition does NOT do — whoever has the code can join, and is then a participant of one room", async ({ page, browser }) => {
  /* The contract, recorded rather than implied. Joining is three writes and
     asks for the session code and nothing else, so this fix does not keep out a
     person who has the code. What it changes is what they are afterwards: bound
     to the one room they joined, and present in the facilitator's list. */
  const base = "sessions/" + uniq("join-");
  const creatorUid = await signedInUid(page);
  expect(await tryWrite(page, `${base}/creatorUid`, creatorUid)).toBe("ALLOWED");

  const j = await someone(browser);
  expect(j.uid).not.toBe(creatorUid);
  const r1 = `${base}/rooms/Room 1`, r2 = `${base}/rooms/Room 2`;
  const CALL = { by: "Newcomer", at: Date.now() };

  expectDenied(await tryWrite(j.page, `${r1}/callForHelp`, CALL), "before joining: refused");

  /* Two of the three writes — a client id of their own, and a place in a room —
     are not the claim. A participant whose claim has not landed, or has failed,
     is in exactly this state, and is refused like a stranger: the rule reads
     the claim, not the assignment. */
  const cid = "cnewcomer";
  expect(await tryWrite(j.page, `${base}/clientMapping/${cid}`, j.uid)).toBe("ALLOWED");
  expect(await tryWrite(j.page, `${base}/pool/${cid}`,
    { name: "Newcomer", university: "Caen", year: 4, english: "B2", at: Date.now(), room: "Room 1" })).toBe("ALLOWED");
  expectDenied(await tryWrite(j.page, `${r1}/callForHelp`, CALL),
    "assigned to the room, but with no claim on it yet: still refused");
  expect(await dbReadAsOwner(`${r1}/callForHelp`)).toBeNull();

  /* The third write is the claim… */
  expect(await tryWrite(j.page, `${base}/roomOf/${j.uid}`, { room: "Room 1", cid })).toBe("ALLOWED");
  /* …and THE ALLOW LEG: the same payload, the same path, the same user. */
  expect(await tryWrite(j.page, `${r1}/callForHelp`, CALL),
    "after joining Room 1: a participant of Room 1").toBe("ALLOWED");
  expect(await dbReadAsOwner(`${r1}/callForHelp`)).toEqual(CALL);
  expect(await tryWrite(j.page, `${r1}/teamName`, "Named by the newcomer")).toBe("ALLOWED");

  /* One room. Not the next one… */
  expectDenied(await tryWrite(j.page, `${r2}/teamName`, "Named by the newcomer"), "Room 2: not theirs");
  expectDenied(await tryWrite(j.page, `${r2}/events/e1`, { kind: "reveal", by: "Newcomer", at: Date.now() }),
    "Room 2's event log: not theirs");
  expect(await dbReadAsOwner(r2), "nothing was written in the other room").toBeNull();
  /* …with one exception, which is the call for help: it asks for a claim on
     any room of the session (see the note in the first test). Having joined
     Room 1, they can call in Room 2. */
  expect(await tryWrite(j.page, `${r2}/callForHelp`, CALL),
    "Room 2's call for help: open to anyone who has joined the session").toBe("ALLOWED");
  expect(Object.keys(await dbReadAsOwner(r2)), "and that is all they left there").toEqual(["callForHelp"]);
  /* …and not by moving: the claim is written once. */
  expectDenied(await tryWrite(j.page, `${base}/roomOf/${j.uid}`, { room: "Room 2", cid }), "a second claim");

  /* And they are on the list the facilitator is shown. */
  expect((await dbReadAsOwner(`${base}/pool/${cid}`)).name).toBe("Newcomer");

  await j.ctx.close();
});

/* ── the product itself ─────────────────────────────────────────────────── */

// Auto-accept the in-page confirm modal that Start opens.
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
async function freshPage(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  await installModalAutoAccept(page);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  return { ctx, page };
}
async function toLobby(page, code, name) {
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await page.locator("#name-input").fill(name);
}
async function joinAsStudent(browser, code, name) {
  const u = await freshPage(browser);
  await toLobby(u.page, code, name);
  const uni = await u.page.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await u.page.locator("#uni-input").selectOption(uni);
  await u.page.locator("#consent-workshop").check();
  await expect(u.page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await u.page.locator("#join-btn").click();
  await expect(u.page.locator("#waiting")).toBeVisible({ timeout: 15_000 });
  return Object.assign(u, { name, uid: await u.page.evaluate(() => firebase.auth().currentUser.uid) });
}

/* The product's controls, run through their own handlers. Clicked from script
   because the chat-first case view keeps the workup buttons out of the layout
   (`?llm=0` shows them); the handler, and the write it makes, are the same. */
const clickWorkup = (page, itemId) => page.evaluate((id) => {
  const b = Array.from(document.querySelectorAll(".req-btn")).find(x => x.dataset.id === id);
  if (!b) throw new Error("no workup button for " + id);
  b.click();
}, itemId);
const callButton = (page) => page.locator("#call-prof-btn");
const callingRows = (page) => page.evaluate(() => document.querySelectorAll("#dashboard .calling").length);
const findingsLines = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("#dashboard *"))
    .filter(e => e.children.length === 0 && /findings \d+\/\d+/.test(e.textContent || ""))
    .map(e => (e.textContent.match(/findings \d+\/\d+/) || [""])[0]));

test("the product's own writes all land — a room's participants, the facilitator from the dashboard and from a room it has no claim on, a co-facilitator's transaction — while a stranger's change nothing", async ({ page, browser }) => {
  test.setTimeout(300_000);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);

  /* ── the real form, three participants, two rooms ─────────────────────── */
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("room-bound");
  await page.locator("#splash-create-pass").fill("emu-room-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  const facUid = await page.evaluate(() => firebase.auth().currentUser.uid);

  const students = [];
  for (const name of ["Ana", "Ben", "Cho"]) students.push(await joinAsStudent(browser, code, name));
  await expect(page.locator("#prestart-count")).toHaveText("3", { timeout: 20_000 });
  await page.locator("#roomcount-input").selectOption("2");
  await page.locator("#start-session-btn").click();
  for (const s of students) {
    await expect(s.page.locator("#app")).toBeVisible({ timeout: 25_000 });
    s.room = await s.page.evaluate(() => myRoom);
  }
  /* R: the room two of them share. Q: the other one. Read, not assumed —
     assignRooms() decides. */
  const R = ["Room 1", "Room 2"].find(r => students.filter(s => s.room === r).length === 2);
  expect(R, "three participants over two rooms: one room has two").toBeTruthy();
  const Q = R === "Room 1" ? "Room 2" : "Room 1";
  const [p1, p2] = students.filter(s => s.room === R);
  const rp = `${base}/rooms/${R}`, qp = `${base}/rooms/${Q}`;

  /* A stranger: its own context, signed in, never given the code by the UI. */
  const s = await someone(browser);
  const everyone = [facUid, s.uid].concat(students.map(x => x.uid));
  expect(new Set(everyone).size, "five DISTINCT users").toBe(5);

  /* ── 1. the facilitator moves both rooms on, from the DASHBOARD ─────────
     setRoomStage() logs the change in the room's event log. The facilitator
     has no room claim here (it has opened no room), so this write is the
     facilitator half of the rule, made by the product. A rule with the room
     condition alone refuses it — silently: a console warning, on every stage
     change of every session. */
  expect(await dbReadAsOwner(`${base}/roomOf/${facUid}`), "on the dashboard the facilitator holds no claim").toBeNull();
  for (const r of [R, Q]) await page.evaluate((r) => setRoomStage(r, 0, 1), r);
  for (const r of [R, Q]) {
    await expect.poll(async () => Object.values((await dbReadAsOwner(`${base}/rooms/${r}/events`)) || {})
      .filter(e => e.kind === "stage" && e.by === "Emu Fac").length,
      { message: `${r}: the facilitator's stage change must be in the room's event log`, timeout: 15_000 }).toBe(1);
  }
  /* The participants' claims: issued on entering the room, before any of what
     follows can be clicked. */
  for (const x of students) {
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/roomOf/${x.uid}`)) || {}).room,
      { message: `${x.name}: the room claim`, timeout: 15_000 }).toBe(x.room);
  }
  await expect(p1.page.locator("#stage-indicator")).toContainText(/Stage 2/i, { timeout: 15_000 });

  /* ── 2. the stranger, who has joined nothing ──────────────────────────── */
  const sl = `${rp}/sections/1`;
  const now = Date.now();
  expectDenied(await tryWrite(s.page, `${sl}/revealed/labs:1`, { by: "Ana", at: now }),
    "a stranger reveals an investigation that costs the room 12 points");
  expectDenied(await tryWrite(s.page, `${rp}/moduleA/revealed/history:0`, { by: "x", at: now }),
    "…and writes the legacy reveal address, which the dashboard counts");
  expectDenied(await tryWrite(s.page, `${rp}/teamName`, "Stranger Team"), "a stranger names the team");
  expectDenied(await tryWrite(s.page, `${rp}/roleplayRound`, 2), "a stranger moves the roleplay round");
  expectDenied(await tryWrite(s.page, `${rp}/callForHelp`, { by: "Dr Nobody", at: now, msg: "not this room's message" }),
    "a stranger raises a call for help on the dashboard");
  expectDenied(await tryWrite(s.page, `${rp}/events/forged`, { kind: "stage", by: "Emu Fac", at: now }),
    "a stranger signs an event as the facilitator");
  /* The DB first: nothing landed, and above all nothing FOLLOWED — before the
     fix a participant's client answered the stranger's reveal with a penalty. */
  await page.waitForTimeout(1500);
  const roomNow = await dbReadAsOwner(rp);
  expect(((roomNow.sections || {})[1] || {}).revealed, "no reveal").toBeUndefined();
  expect(roomNow.moduleA, "no legacy reveal").toBeUndefined();
  expect(roomNow.score, "no penalty, and no point either").toBeUndefined();
  expect(roomNow.teamName).toBeUndefined();
  expect(roomNow.roleplayRound).toBeUndefined();
  expect(roomNow.callForHelp).toBeUndefined();
  expect(Object.keys(roomNow.events), "the event log holds the facilitator's entry, and that one only").toHaveLength(1);
  expect(await dbReadAsOwner(`${base}/members/${s.uid}`), "and the stranger is still nobody in this session").toBeNull();
  /* Then the DOM. */
  const counted = await findingsLines(page);
  expect(counted, "one counter per room").toHaveLength(2);
  for (const line of counted) expect(line, "the dashboard counts no finding in either room").toMatch(/^findings 0\//);
  expect(await callingRows(page), "no room is calling").toBe(0);
  await expect(callButton(p1.page)).toHaveText(/Call a facilitator/);
  await expect(p1.page.locator("#room-score-chip")).not.toContainText("Stranger Team");

  /* ── 3. the room, through the product ─────────────────────────────────── */
  /* A reveal is a TRANSACTION (reveal() in script.js). */
  await clickWorkup(p1.page, "history:0");
  await expect.poll(async () => ((await dbReadAsOwner(`${sl}/revealed/history:0`)) || {}).by,
    { message: "the participant's reveal — the same click the stranger's write stood in for", timeout: 15_000 }).toBe(p1.name);
  await expect.poll(async () => Object.values((await dbReadAsOwner(`${rp}/events`)) || {})
    .filter(e => e.kind === "reveal" && e.by === p1.name).length,
    { message: "…and its entry in the event log", timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await findingsLines(page)).filter(l => /^findings 1\//.test(l)).length,
    { message: "then the DOM: the dashboard counts the room's one finding", timeout: 15_000 }).toBe(1);

  await p1.page.evaluate(() => {
    document.getElementById("team-name-input").value = "Team One";
    document.getElementById("team-name-btn").click();
  });
  await expect.poll(() => dbReadAsOwner(`${rp}/teamName`), { timeout: 15_000 }).toBe("Team One");
  await expect(p1.page.locator("#room-score-chip")).toContainText("Team One", { timeout: 15_000 });

  /* An answer, and a teammate's reply under it. */
  await p1.page.evaluate(() => {
    const i = document.querySelector("[id^='answer-input-moduleA-']");
    i.value = "Screen for red flags before imaging";
    addAnswer("moduleA", i.id.replace("answer-input-moduleA-", ""));
  });
  await expect.poll(async () => Object.keys((await dbReadAsOwner(`${rp}/answers/sections/1`)) || {}).length,
    { timeout: 15_000 }).toBe(1);
  const entryId = Object.keys(await dbReadAsOwner(`${rp}/answers/sections/1`))[0];
  const replyText = "A teammate's counter-point";
  await expect.poll(() => p2.page.evaluate((eid) =>
    Array.from(document.querySelectorAll(".answer-replies")).some(u => u.dataset.repliesFor === eid), entryId),
    { message: "the answer must have reached the teammate's page", timeout: 15_000 }).toBe(true);
  await p2.page.evaluate(([eid, text]) => {
    const li = Array.from(document.querySelectorAll(".answer-replies")).find(u => u.dataset.repliesFor === eid).parentElement;
    li.querySelector(".entry-disagree").click();
    li.querySelector(".counter-bullet-form textarea").value = text;
    li.querySelector(".counter-send").click();
  }, [entryId, replyText]);
  await expect.poll(async () => Object.values((await dbReadAsOwner(`${rp}/answerReplies/${entryId}`)) || {}).map(r => r.by + ": " + r.text),
    { message: "the teammate's reply", timeout: 15_000 }).toEqual([p2.name + ": " + replyText]);
  const replyKey = Object.keys(await dbReadAsOwner(`${rp}/answerReplies/${entryId}`))[0];

  await callButton(p1.page).click();
  await expect.poll(async () => ((await dbReadAsOwner(`${rp}/callForHelp`)) || {}).by, { timeout: 15_000 }).toBe(p1.name);
  await expect.poll(() => callingRows(page), { message: "the dashboard shows the room calling", timeout: 15_000 }).toBeGreaterThan(0);
  await expect(callButton(p1.page)).toHaveText(/tap to cancel/);

  /* ── 4. the stranger against what the room really wrote ───────────────── */
  expectDenied(await tryDelete(s.page, `${rp}/callForHelp`), "a stranger cancels the room's call for help");
  expectDenied(await tryWrite(s.page, `${rp}/answerReplies/${entryId}/forged`,
    { text: "I think that is wrong", by: p2.name, cid: "x", at: Date.now(), stance: "disagree" }),
    "a stranger forges a reply under a participant's name");
  expectDenied(await tryWrite(s.page, `${rp}/answerReplies/${entryId}/${replyKey}`,
    { text: "rewritten", by: p2.name, cid: "x", at: Date.now() }), "a stranger rewrites a real reply");
  expectDenied(await tryDelete(s.page, `${rp}/answerReplies/${entryId}/${replyKey}`), "a stranger deletes a real reply");
  expectDenied(await tryDelete(s.page, `${sl}/revealed/history:0`), "a stranger takes back the room's finding");
  expect(((await dbReadAsOwner(`${rp}/callForHelp`)) || {}).by, "the DB first: the call is still raised").toBe(p1.name);
  expect(Object.values(await dbReadAsOwner(`${rp}/answerReplies/${entryId}`)).map(r => r.text),
    "one reply, and it says what the teammate wrote").toEqual([replyText]);
  expect(((await dbReadAsOwner(`${sl}/revealed/history:0`)) || {}).by).toBe(p1.name);
  expect(await callingRows(page), "and the dashboard still shows it").toBeGreaterThan(0);

  /* ── 5. a co-facilitator: the TRANSACTION, on a title no client can read ─
     CLAUDE.md (PR #223) records a transaction on an admin rule being refused
     in the browser, because the rule reads the proof node the client cannot.
     Here it commits — a reveal, by a co-facilitator whose only title in this
     room is that proof. Kept as a test because the rule on `revealed` now has
     exactly that shape, and reveal() is a transaction.

     Opening a room gives a facilitator a claim on the FIRST room it opens (the
     claim rule's own facilitator branch) and never another. So each
     facilitator below opens the OTHER room first: in R, being a facilitator is
     all it has. */
  const dee = await freshPage(browser);
  await toLobby(dee.page, code, "Dee Cofac");
  await dee.page.locator("#admin-toggle").click();
  await dee.page.locator("#admin-pass-input").fill("emu-room-pw");
  await dee.page.locator("#join-admin-btn").click();
  await expect(dee.page.locator("#admin-app")).toBeVisible({ timeout: 20_000 });
  const deeUid = await dee.page.evaluate(() => firebase.auth().currentUser.uid);
  expect(everyone, "the co-facilitator is a sixth user").not.toContain(deeUid);
  expect(await dbReadAsOwner(`${base}/creatorUid`), "…and not the creator").toBe(facUid);
  const hash = await dbReadAsOwner(`adminSecrets/${code.toLowerCase()}/hash`);
  expect(hash, "the session has a real hash").toBeTruthy();
  expect(await dbReadAsOwner(`adminSecrets/${code.toLowerCase()}/proof/${deeUid}`), "…which the co-facilitator has proved").toBe(hash);

  await dee.page.evaluate((q) => openRoomAsAdmin(q), Q);
  await expect.poll(async () => ((await dbReadAsOwner(`${base}/roomOf/${deeUid}`)) || {}).room, { timeout: 15_000 }).toBe(Q);
  await dee.page.evaluate((r) => openRoomAsAdmin(r), R);
  await expect.poll(() => dee.page.evaluate(() => myRoom), { timeout: 15_000 }).toBe(R);
  await expect.poll(() => dee.page.evaluate(() => document.querySelectorAll(".req-btn").length), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(((await dbReadAsOwner(`${base}/roomOf/${deeUid}`)) || {}).room, "still the first room, not this one").toBe(Q);
  await clickWorkup(dee.page, "history:4");
  await expect.poll(async () => ((await dbReadAsOwner(`${sl}/revealed/history:4`)) || {}).by,
    { message: "a co-facilitator's reveal, by transaction, in a room it holds no claim on", timeout: 15_000 }).toBe("Dee Cofac");
  /* Then the DOM — on the creator's dashboard, and BEFORE the creator opens a
     room: measured while writing this test, a dashboard stops updating once
     its facilitator has been into a room and back (teardownRoom() drops every
     listener on `rooms`, the dashboard's own included). Not this change's, and
     reported; it is why this line is here and not at the end. */
  await expect.poll(async () => (await findingsLines(page)).filter(l => /^findings 2\//.test(l)).length,
    { message: "then the DOM: the creator's dashboard counts both findings", timeout: 15_000 }).toBe(1);

  /* ── 6. the creator, inside a room it has NO claim on ─────────────────── */
  await page.evaluate((q) => openRoomAsAdmin(q), Q);
  await expect.poll(async () => ((await dbReadAsOwner(`${base}/roomOf/${facUid}`)) || {}).room, { timeout: 15_000 }).toBe(Q);
  await page.evaluate((r) => openRoomAsAdmin(r), R);
  await expect(callButton(page)).toHaveText(/Resolve call/, { timeout: 15_000 });
  expect(((await dbReadAsOwner(`${base}/roomOf/${facUid}`)) || {}).room, "still the first room, not this one").toBe(Q);
  await page.evaluate(() => document.getElementById("call-prof-btn").click());   // "Resolve call": a delete
  await expect.poll(() => dbReadAsOwner(`${rp}/callForHelp`),
    { message: "the facilitator must be able to clear a room's alert from inside that room", timeout: 15_000 }).toBeNull();
  /* Then the DOM, in the room that had called. */
  await expect(callButton(p1.page)).toHaveText(/Call a facilitator/, { timeout: 15_000 });

  for (const u of students.concat([s, dee])) await u.ctx.close();
});

test("a participant who leaves and joins again can still call the facilitator, from the room they are put back in — which is not always theirs", async ({ page, browser }) => {
  /* Why the call for help asks for a claim on ANY room of the session.
     Leave keeps the anonymous account, and with it the write-once room claim;
     joining again places the participant afresh (bestRoomFor(): lowest cost,
     and on a tie the first room by name). Measured on 2026-10-08, twice out of
     two: left "Room 2", came back in "Room 1", claim still on "Room 2", no
     message. In that room their answers are refused (they were before any of
     this), and with a claim on THIS room required, so was their call for
     help — the one control that had still worked. That was the review's
     blocking finding on the first version of this change. */
  test.setTimeout(240_000);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);

  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("leave-rejoin");
  await page.locator("#splash-create-pass").fill("emu-room-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

  const students = [];
  for (const name of ["Ana", "Ben", "Cho"]) students.push(await joinAsStudent(browser, code, name));
  await expect(page.locator("#prestart-count")).toHaveText("3", { timeout: 20_000 });
  await page.locator("#roomcount-input").selectOption("2");
  await page.locator("#start-session-btn").click();
  for (const x of students) {
    await expect(x.page.locator("#app")).toBeVisible({ timeout: 25_000 });
    x.room = await x.page.evaluate(() => myRoom);
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/roomOf/${x.uid}`)) || {}).room,
      { message: `${x.name}: the room claim`, timeout: 15_000 }).toBe(x.room);
  }
  const pairRoom = ["Room 1", "Room 2"].find(r => students.filter(x => x.room === r).length === 2);
  expect(pairRoom, "three participants over two rooms: one room has two").toBeTruthy();
  const leaver = students.find(x => x.room === pairRoom);
  const stayedAlone = students.find(x => x.room !== pairRoom);

  /* ── Leave (the product's own button), then join again, same browser ──── */
  await Promise.all([
    leaver.page.waitForEvent("load", { timeout: 20_000 }),
    leaver.page.evaluate(() => document.getElementById("leave-btn").click())
  ]);
  await toLobby(leaver.page, code, leaver.name);
  const uni = await leaver.page.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await leaver.page.locator("#uni-input").selectOption(uni);
  await leaver.page.locator("#consent-workshop").check();
  await expect(leaver.page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await leaver.page.locator("#join-btn").click();
  await expect(leaver.page.locator("#app")).toBeVisible({ timeout: 30_000 });
  const shown = await leaver.page.evaluate(() => myRoom);

  expect(await leaver.page.evaluate(() => firebase.auth().currentUser.uid), "the same account as before").toBe(leaver.uid);
  expect(((await dbReadAsOwner(`${base}/roomOf/${leaver.uid}`)) || {}).room, "and the same claim: it is written once").toBe(pairRoom);
  /* THE PRECONDITION, asserted — not a condition around what follows. If this
     fails, the participant came back to the room they hold: the placement has
     been corrected, or assignRooms()/bestRoomFor() now break the tie another
     way. Then this test no longer shows what it is for; the rule-level case in
     the first test still pins the rule. Rewrite it, do not wrap it in an if. */
  expect(shown, "the participant must have been put in a room their claim does not name").not.toBe(pairRoom);
  expect(shown).toBe(stayedAlone.room);
  const shownRoom = `${base}/rooms/${shown}`;

  /* ── the call for help, through the button, from the room on screen ───── */
  await callButton(leaver.page).click();
  await expect.poll(async () => ((await dbReadAsOwner(`${shownRoom}/callForHelp`)) || {}).by,
    { message: "the call must reach the database from a participant whose claim names another room", timeout: 15_000 })
    .toBe(leaver.name);
  await expect.poll(() => callingRows(page), { message: "then the DOM: the dashboard shows the room calling", timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(callButton(leaver.page)).toHaveText(/tap to cancel/);

  /* ── and that is the ONLY one of the seven that is theirs in this room ──
     The allow leg is the room's own participant, same payload, same path. */
  const NAME = "Named from the room on screen";
  expectDenied(await tryWrite(leaver.page, `${shownRoom}/teamName`, NAME),
    "teamName: by a participant whose claim names another room");
  expect(await dbReadAsOwner(`${shownRoom}/teamName`)).toBeNull();
  expect(await tryWrite(stayedAlone.page, `${shownRoom}/teamName`, NAME),
    "teamName: by the participant who holds this room").toBe("ALLOWED");

  /* ── somebody who has joined NOTHING still cannot touch the call ──────── */
  const s = await someone(browser);
  expect(students.map(x => x.uid), "a fourth user").not.toContain(s.uid);
  expect(await dbReadAsOwner(`${base}/roomOf/${s.uid}`), "with no claim in this session").toBeNull();
  expectDenied(await tryDelete(s.page, `${shownRoom}/callForHelp`), "a visitor who never joined cancels the call");
  expect(((await dbReadAsOwner(`${shownRoom}/callForHelp`)) || {}).by, "the DB first: the call stands").toBe(leaver.name);
  expect(await callingRows(page), "then the DOM: the dashboard still shows it").toBeGreaterThan(0);
  /* The allow leg of that denial: the caller's own cancel, through the button. */
  await callButton(leaver.page).click();
  await expect.poll(() => dbReadAsOwner(`${shownRoom}/callForHelp`),
    { message: "the caller cancels their own call", timeout: 15_000 }).toBeNull();

  for (const u of students.concat([s])) await u.ctx.close();
});
