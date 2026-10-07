/* tests-e2e/consent-records.spec.js
 *
 * A participant's recorded consent must change only when the participant
 * changes it. Four things were rewriting it behind their back:
 *
 *   1. RELOADING. A reload mid-session resumes seamlessly — the page rejoins
 *      from the join data it saved, and that rejoin writes the consent record
 *      over the participant's pool entry again. The third box (`transcript`:
 *      keep the Teams transcript and recording) was lost on the way back in,
 *      so anyone who had ticked it was recorded as transcript:false from their
 *      first reload on. Reloads are routine here: a phone waking up, a dropped
 *      connection, a facilitator saying "refresh the page".
 *
 *   2. WITHDRAWING FROM ANOTHER SESSION. The account dialog lists every past
 *      session with its own "Withdraw consent" button. Using one while sitting
 *      in a different, open session switched research consent off in the OPEN
 *      session's record — the session the participant had not withdrawn from —
 *      and the research export then left them out of it.
 *
 *   3. RELOADING AFTER A WITHDRAWAL. Withdrawing inside the session set the
 *      pool entry's consent/research to false, but the page and its saved join
 *      data still said true. The next reload ticked the research box from the
 *      saved copy, rejoined, and recorded research:true again — dated after
 *      the withdrawal. The facilitator's in-browser research CSV reads that
 *      flag and nothing else, so a withdrawn participant was back in it.
 *
 *   4. COMING BACK AFTER A WITHDRAWAL MADE FROM SOMEWHERE ELSE. The account
 *      dialog is the route for withdrawing from a session one is not in. Used
 *      from the front page, it recorded the withdrawal and left the join data
 *      this browser had saved for that session at research:true — and also the
 *      copy the page had parsed when it loaded. Typing the session's code
 *      again, on the same page or after a reload, rejoined with the research
 *      box ticked.
 *
 * WHAT HOLDS, EXACTLY, AND WHAT DOES NOT. The consent record is rebuilt from
 * what one browser tab remembers. What these tests show is that, for ONE tab
 * of ONE browser:
 *   - a reload records again the three answers given at the join form;
 *   - after a withdrawal made in that tab — inside the session, or from the
 *     front page for a session this browser has join data for — a later
 *     reload or re-entry in that tab records research:false.
 * They do NOT show, and the fixes do not provide:
 *   - a second device signed in as the same person: it keeps its own saved
 *     answer and writes it again on its next reload;
 *   - a second tab open in the same session: it keeps its own pool entry at
 *     true, and it can save `true` back over the lowered copy (each tab saves
 *     its own in-memory answer to the one shared key), so the tab that
 *     withdrew is not safe from it either;
 *   - the pool entry after a withdrawal made from the front page: it is not
 *     written until this browser rejoins the session.
 * Closing those needs the join to read the participant's own withdrawal
 * record first, which is a separate change.
 *
 * Every test reads what is STORED, from the LocalDB's own backing store rather
 * than through the page's code or its checkboxes: (1), (3) and (4) are exactly
 * cases where the screen (a waiting room, as expected) and the record
 * disagree.
 *
 * Hermetic LOCAL mode: an in-page database with no rules and no auth. So
 *   - nothing here says anything about what the database rules allow, and
 *   - no user is ever signed in. The withdrawal tests stand one in, as
 *     account-dialog.spec.js does — the flow reads only `uid`, `email` and
 *     `isAnonymous` — and then drive the real buttons and the real confirm.
 *     The stand-in does not survive a reload; the resumed join does not need
 *     one.
 * The logic of the fixes is pinned in tests/consent-records.test.js and
 * tests/lib.test.js; this file is the proof that the running page behaves.
 *
 * Data fixes, not layout: runs on the three desktop engines only.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* WebKit occasionally stalls the first LocalDB write of the shared
   create-session step — environmental, same mitigation as the sibling consent
   specs. A retry cannot turn a wrong stored value into a right one. */
test.describe.configure({ retries: 2 });

const USER = { uid: "u_local", email: "local@example.test", isAnonymous: false };
const DONE = /Withdrawn\. You are excluded from the research dataset/;

async function createSession(page, label) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("e2e-consent-records-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
}

/* Enter the session and stop on the join form. */
async function openLobby(page, code) {
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 20_000 });
}

/* Fill the join form with an exact consent state and join. The boxes are set
   with a real bubbling `change` — the event the join button listens for —
   rather than a pointer tap, which WebKit re-forwards through the wrapping
   <label> (see consent-transcript.spec.js, where the taps themselves are
   tested). */
async function join(page, boxes) {
  await page.locator("#name-input").fill("E2E Student");
  await page.locator("#uni-input").selectOption("Caen");
  await page.evaluate((want) => {
    for (const [id, value] of Object.entries(want)) {
      const box = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
      if (!box) throw new Error("missing consent checkbox #" + id);
      if (box.checked !== value) {
        box.checked = value;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, {
    "consent-workshop": boxes.a, "consent-research": boxes.b, "consent-transcript": boxes.c
  });
  await expect(page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#join-btn").click();
  await expect(page.locator("#waiting")).toBeVisible({ timeout: 20_000 });
}

/* The whole stored database, read from where LocalDB keeps it. */
async function storedTree(page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("canamed_localdb_v1") || "{}"));
}

/* This tab's own pool entry in the session the page is in, as stored. The tab
   identity and the session come from the page; the record does not. */
async function storedPoolEntry(page) {
  return page.evaluate(() => {
    const tree = JSON.parse(localStorage.getItem("canamed_localdb_v1") || "{}");
    // @ts-ignore — script.js globals
    const code = sessionNum, cid = clientId;
    const pool = ((tree.sessions || {})[code] || {}).pool || {};
    return { code, cid, entry: pool[cid] || null };
  });
}

/* Wait until a resumed join has REWRITTEN the pool entry, and return it.
   Without this the "after" read could be the record the first join left
   behind, and a page that never rejoined would pass every assertion. */
async function awaitRejoin(page, before) {
  await expect(page.locator("#waiting")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    const now = await storedPoolEntry(page);
    return now.entry ? now.entry.at : 0;
  }, {
    message: "the page did not write the participant's pool entry again",
    timeout: 20_000
  }).toBeGreaterThan(before.entry.at);
  const after = await storedPoolEntry(page);
  expect(after.cid, "the page rejoined under a different tab identity").toBe(before.cid);
  expect(after.code).toBe(before.code);
  return after;
}

async function reloadAndRejoin(page, before) {
  await page.reload();
  return awaitRejoin(page, before);
}

/* The join data this browser has saved for the next page load, as stored. */
async function storedResume(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("canamed_resume") || "null"));
}

/* Scope: the three answers given at the join form, in the tab that gave them
   and with no withdrawal in between. What happens AFTER a withdrawal is the
   last two blocks of this file. */
test.describe("A reload keeps the answers given at the join form", () => {
  test("a ticked transcript box is still recorded as true after a reload", async ({ page }) => {
    const code = await createSession(page, "consent records: C kept");
    await openLobby(page, code);
    // B refused on purpose: the only `true` beside the mandatory box is C.
    await join(page, { a: true, b: false, c: true });

    const before = await storedPoolEntry(page);
    expect(before.entry, "the join wrote no pool entry").not.toBeNull();
    expect(before.entry.consent).toMatchObject({ workshop: true, research: false, transcript: true });

    const after = await reloadAndRejoin(page, before);
    expect(after.entry.consent.transcript,
      "the participant ticked the transcript box and is now recorded as having refused").toBe(true);
    expect(after.entry.consent.workshop).toBe(true);
    expect(after.entry.consent.research).toBe(false);

    // And once more: the resumed join saves its own resume data, which is what
    // the NEXT reload reads.
    const again = await reloadAndRejoin(page, after);
    expect(again.entry.consent.transcript, "lost on the second reload").toBe(true);
    expect(again.entry.consent.research).toBe(false);
  });

  test("an unticked transcript box is still recorded as false after a reload", async ({ page }) => {
    /* The other direction. Keeping the answer must not become ticking the
       box: a refusal has to come back as a refusal. */
    const code = await createSession(page, "consent records: C refused");
    await openLobby(page, code);
    await join(page, { a: true, b: true, c: false });

    const before = await storedPoolEntry(page);
    expect(before.entry, "the join wrote no pool entry").not.toBeNull();
    expect(before.entry.consent).toMatchObject({ workshop: true, research: true, transcript: false });

    const after = await reloadAndRejoin(page, before);
    expect(after.entry.consent.transcript).toBe(false);
    expect(after.entry.consent.research).toBe(true);
    expect(after.entry.consent.workshop).toBe(true);
  });
});

/* Click one session's "Withdraw consent" in the account dialog and confirm. */
async function withdrawFromRow(page, code) {
  const row = page.locator("#account-history .account-history-row")
    .filter({ hasText: code.toUpperCase() });
  await expect(row).toHaveCount(1);
  // Clear the last outcome so the wait below is for THIS withdrawal.
  await page.evaluate(() => { document.getElementById("account-action-hint").textContent = ""; });
  await row.locator(".account-history-withdraw").click();
  await expect(page.locator("#canamed-modal")).toBeVisible();
  await page.locator("#canamed-modal-confirm").click();
  /* The message is set once the whole write chain has settled — the
     withdrawal record AND whatever follows it — so a read after this sees
     everything the withdrawal wrote. */
  await expect(page.locator("#account-action-hint")).toHaveText(DONE, { timeout: 10_000 });
}

test.describe("Withdrawing from one session does not touch another", () => {
  const OLD = "old-111";   // a session from last month, long over

  test("withdrawing from a past session leaves the open session's research consent on", async ({ page }) => {
    const code = await createSession(page, "consent records: withdrawal");
    await openLobby(page, code);
    /* Signed in before joining, so the app itself records this session in the
       account's history — the row used further down is the app's own. */
    await page.evaluate((u) => {
      // @ts-ignore — script.js binding
      currentUser = u;
    }, USER);
    await join(page, { a: true, b: true, c: false });

    const mine = await storedPoolEntry(page);
    expect(mine.entry, "the join wrote no pool entry").not.toBeNull();
    expect(mine.entry.consent.research).toBe(true);
    const open = mine.code;

    await page.evaluate(async ({ uid, old }) => {
      // @ts-ignore — script.js globals
      await db.ref("users/" + uid + "/history/" + old).set({ code: old, joinedAt: 1 });
      // @ts-ignore
      openAccountDialog();
    }, { uid: USER.uid, old: OLD });
    await expect(page.locator("#account-dialog")).toBeVisible();
    await expect(page.locator("#account-history .account-history-row")).toHaveCount(2);

    // ---- withdraw from the PAST session, while sitting in the open one
    await withdrawFromRow(page, OLD);

    let tree = await storedTree(page);
    expect(tree.withdrawals[OLD][USER.uid], "the withdrawal from the past session was not recorded")
      .toEqual({ research: false, erasure: true, at: expect.any(Number) });
    expect(tree.sessions[open].pool[mine.cid].consent.research,
      "withdrawing from a PAST session switched research consent off in the OPEN one").toBe(true);
    expect(tree.withdrawals[open], "a withdrawal was recorded for the open session").toBeUndefined();
    // The past session got nothing but its withdrawal record.
    expect(tree.sessions[OLD]).toBeUndefined();

    // ---- then withdraw from the OPEN session, on the same page
    /* The control. The assertion above would hold just as well if a withdrawal
       no longer reached the pool entry at all; this shows it still does for
       the session it is meant for, read back the same way. */
    await withdrawFromRow(page, open);

    tree = await storedTree(page);
    expect(tree.withdrawals[open][USER.uid])
      .toEqual({ research: false, erasure: true, at: expect.any(Number) });
    expect(tree.sessions[open].pool[mine.cid].consent.research,
      "withdrawing from the session you are in must still switch it off there").toBe(false);
    // Only that one answer moved.
    expect(tree.sessions[open].pool[mine.cid].consent.workshop).toBe(true);
    expect(tree.sessions[open].pool[mine.cid].name).toBe("E2E Student");
  });

  test("withdrawing with no session open writes the withdrawal record and nothing else", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() =>
      // @ts-ignore — script.js globals
      typeof openAccountDialog === "function" && typeof dbInit === "function");
    await page.evaluate(async ({ u, old }) => {
      // @ts-ignore — script.js globals
      dbInit();
      // @ts-ignore
      currentUser = u;
      // @ts-ignore
      await db.ref("users/" + u.uid + "/history/" + old).set({ code: old, joinedAt: 1 });
      // @ts-ignore
      openAccountDialog();
    }, { u: USER, old: OLD });
    await expect(page.locator("#account-dialog")).toBeVisible();
    // @ts-ignore — script.js global
    expect(await page.evaluate(() => sessionNum), "the page is in a session after all").toBe("");

    const before = await storedTree(page);
    await withdrawFromRow(page, OLD);
    const tree = await storedTree(page);

    expect(tree.withdrawals).toEqual({
      [OLD]: { [USER.uid]: { research: false, erasure: true, at: expect.any(Number) } }
    });
    /* With no session the pool path used to collapse to
       sessions/pool/<clientId>/consent/research — a write into a "session"
       called pool. Nothing but the withdrawal may have been added. */
    expect(tree.sessions, "something was written under sessions/ with no session open")
      .toEqual(before.sessions);
    expect(Object.keys(tree).sort())
      .toEqual(Object.keys(before).concat("withdrawals").sort());
  });
});

/* Join with every box ticked, with a user stood in so the waiting screen's own
   withdrawal button has someone to record the withdrawal for. */
async function joinAllTicked(page, label) {
  const code = await createSession(page, label);
  await openLobby(page, code);
  await page.evaluate((u) => {
    // @ts-ignore — script.js binding
    currentUser = u;
  }, USER);
  await join(page, { a: true, b: true, c: true });
  const mine = await storedPoolEntry(page);
  expect(mine.entry, "the join wrote no pool entry").not.toBeNull();
  expect(mine.entry.consent).toMatchObject({ workshop: true, research: true, transcript: true });
  expect((await storedResume(page)).consent.research).toBe(true);
  return mine;
}

/* In the tab that withdrew. See the header for what this does not cover. */
test.describe("A reload after a withdrawal does not record research consent again", () => {
  test("withdraw on the waiting screen, reload twice: research consent stays off", async ({ page }) => {
    const mine = await joinAllTicked(page, "consent records: withdraw, reload");

    // The waiting screen's own button and the real confirm.
    await page.locator("#gdpr-withdraw-btn").click();
    await expect(page.locator("#canamed-modal")).toBeVisible();
    await page.locator("#canamed-modal-confirm").click();
    await expect(page.locator("#gdpr-withdraw-hint")).toHaveText(DONE, { timeout: 10_000 });

    const record = (await storedTree(page)).withdrawals[mine.code][USER.uid];
    expect(record).toEqual({ research: false, erasure: true, at: expect.any(Number) });
    const withdrawn = await storedPoolEntry(page);
    expect(withdrawn.entry.consent.research, "the withdrawal did not reach the pool entry")
      .toBe(false);
    /* What the next page load ticks the boxes from. Only the research answer
       may have moved. Soft, so that a failure here still goes on to show its
       consequence in the stored record below — the test fails either way. */
    expect.soft((await storedResume(page)).consent,
      "the saved join data still says research:true, so a reload ticks the box again")
      .toMatchObject({ workshop: true, research: false, transcript: true });

    const after = await reloadAndRejoin(page, withdrawn);
    expect(after.entry.consent.research,
      "the reload recorded research consent again, after the participant withdrew it")
      .toBe(false);
    // The other two answers were not withdrawn.
    expect(after.entry.consent.transcript).toBe(true);
    expect(after.entry.consent.workshop).toBe(true);

    const again = await reloadAndRejoin(page, after);
    expect(again.entry.consent.research, "it came back on the second reload").toBe(false);
    expect(again.entry.consent.transcript).toBe(true);
    expect(again.entry.consent.workshop).toBe(true);
    // And the reloads did not disturb the withdrawal itself.
    expect((await storedTree(page)).withdrawals[mine.code][USER.uid]).toEqual(record);
  });

  test("no withdrawal, the same two reloads: research consent stays on", async ({ page }) => {
    /* The control. The test above would pass on a page whose reload never
       restored the research answer at all. */
    const mine = await joinAllTicked(page, "consent records: no withdrawal, reload");

    const after = await reloadAndRejoin(page, mine);
    expect(after.entry.consent).toMatchObject({ workshop: true, research: true, transcript: true });
    const again = await reloadAndRejoin(page, after);
    expect(again.entry.consent).toMatchObject({ workshop: true, research: true, transcript: true });
    expect((await storedTree(page)).withdrawals, "a withdrawal was recorded for nobody")
      .toBeUndefined();
  });
});

/* Put the participant on the front page, in no session, with the join data for
   their session still saved in this browser. That is where a browser lands
   when the session it points at cannot be entered at load (ended, or the
   database unreachable) or when it follows a link elsewhere; here the pointer
   to the open session is simply dropped and the join data kept. */
async function toFrontPage(page) {
  await page.evaluate(() => localStorage.removeItem("canamed_session"));
  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() =>
    // @ts-ignore — script.js globals
    typeof openAccountDialog === "function" && typeof dbInit === "function");
  // @ts-ignore — script.js global
  expect(await page.evaluate(() => sessionNum), "the page is in a session after all").toBe("");
  expect((await storedResume(page)).consent.research,
    "the join data for the session is no longer saved with research ticked").toBe(true);
}

/* On the front page: open the account dialog (with the user stood in again —
   the stand-in does not survive a page load) and withdraw from `code`. */
async function withdrawFromFrontPage(page, code) {
  await page.evaluate((u) => {
    // @ts-ignore — script.js globals
    dbInit();
    // @ts-ignore
    currentUser = u;
    // @ts-ignore
    openAccountDialog();
  }, USER);
  await expect(page.locator("#account-dialog")).toBeVisible();
  await withdrawFromRow(page, code);
  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
}

/* Type the session's code on the front page. The saved join data takes the
   participant straight back into the waiting room. */
async function enterAndRejoin(page, before) {
  await page.locator("#splash-code").fill(before.code);
  await page.locator("#splash-enter").click();
  return awaitRejoin(page, before);
}

/* In the tab that withdrew, for a session this browser has join data for. */
test.describe("Coming back after a withdrawal made from the front page does not record research consent again", () => {
  test("withdraw on the front page, enter the session on the same page: research consent is off", async ({ page }) => {
    /* No page load between the withdrawal and coming back: what the rejoin
       reads is the copy the front page parsed when it loaded. */
    const mine = await joinAllTicked(page, "consent records: front page, same page");
    await toFrontPage(page);
    await withdrawFromFrontPage(page, mine.code);

    expect((await storedTree(page)).withdrawals[mine.code][USER.uid])
      .toEqual({ research: false, erasure: true, at: expect.any(Number) });
    // Soft, for the same reason as above: go on and show the consequence.
    expect.soft((await storedResume(page)).consent,
      "the join data saved for the session withdrawn from still says research:true")
      .toMatchObject({ workshop: true, research: false, transcript: true });

    const after = await enterAndRejoin(page, mine);
    expect(after.entry.consent.research,
      "coming back to the session recorded research consent again, after the withdrawal")
      .toBe(false);
    expect(after.entry.consent.transcript).toBe(true);
    expect(after.entry.consent.workshop).toBe(true);
  });

  test("withdraw on the front page, reload, then enter the session: research consent is off", async ({ page }) => {
    /* A page load in between: what the rejoin reads is what was saved. */
    const mine = await joinAllTicked(page, "consent records: front page, reload");
    await toFrontPage(page);
    await withdrawFromFrontPage(page, mine.code);

    await page.reload();
    await expect(page.locator("#splash")).toBeVisible({ timeout: 20_000 });
    const after = await enterAndRejoin(page, mine);
    expect(after.entry.consent.research,
      "coming back to the session recorded research consent again, after the withdrawal")
      .toBe(false);
    expect(after.entry.consent.transcript).toBe(true);
    expect(after.entry.consent.workshop).toBe(true);

    // And it stays off on the reloads that follow, now that the page is in it.
    const again = await reloadAndRejoin(page, after);
    expect(again.entry.consent.research, "it came back on a later reload").toBe(false);
  });

  test("no withdrawal, back from the front page: research consent is still on", async ({ page }) => {
    /* The control. The two tests above would pass if coming back from the
       front page never restored the research answer at all. */
    const mine = await joinAllTicked(page, "consent records: front page, no withdrawal");
    await toFrontPage(page);
    const after = await enterAndRejoin(page, mine);
    expect(after.entry.consent).toMatchObject({ workshop: true, research: true, transcript: true });
    expect((await storedTree(page)).withdrawals, "a withdrawal was recorded for nobody")
      .toBeUndefined();
  });
});
