/* tests-e2e/consent-records.spec.js
 *
 * A participant's recorded consent must change only when the participant
 * changes it. Two things were rewriting it behind their back:
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
 * Every test reads what is STORED, from the LocalDB's own backing store rather
 * than through the page's code or its checkboxes: the defect in (1) is exactly
 * a case where the screen (a waiting room, as expected) and the record
 * disagree.
 *
 * Hermetic LOCAL mode: an in-page database with no rules and no auth. So
 *   - nothing here says anything about what the database rules allow, and
 *   - no user is ever signed in. The withdrawal tests stand one in, as
 *     account-dialog.spec.js does — the flow reads only `uid`, `email` and
 *     `isAnonymous` — and then drive the real dialog and the real confirm.
 * The logic of both fixes is pinned in tests/consent-records.test.js and
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

/* Reload and wait until the resumed join has REWRITTEN the pool entry. Without
   this the "after" read could be the record the first join left behind, and a
   reload that never rejoined would pass every assertion. */
async function reloadAndRejoin(page, before) {
  await page.reload();
  await expect(page.locator("#waiting")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    const now = await storedPoolEntry(page);
    return now.entry ? now.entry.at : 0;
  }, {
    message: "the reload did not write the participant's pool entry again",
    timeout: 20_000
  }).toBeGreaterThan(before.entry.at);
  const after = await storedPoolEntry(page);
  expect(after.cid, "the reload joined under a different tab identity").toBe(before.cid);
  expect(after.code).toBe(before.code);
  return after;
}

test.describe("Reloading does not change the recorded consent", () => {
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
