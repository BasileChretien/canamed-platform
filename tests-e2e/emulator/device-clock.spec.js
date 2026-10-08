/* tests-e2e/emulator/device-clock.spec.js
 *
 * The rules compare almost every date a client writes with the server's clock:
 * 92 of them must be no more than five seconds ahead of it, and most have a
 * floor too — two minutes for the join, thirty for an answer. The client used
 * to send Date.now(), the DEVICE's clock. So a participant whose laptop was a
 * minute fast could not join, and the only trace was a permission-denied in
 * the console; a facilitator's `created` and `closed` — the two dates the
 * retention clock runs from — were as wrong as their laptop, and refused
 * outright past twelve hours (the window #438 gave those two).
 *
 * The client now sends the server's time: serverNow() (lib.js) is the
 * device clock plus the offset the database publishes at
 * .info/serverTimeOffset. This spec runs the real client on a device whose
 * clock is wrong and reads back what it wrote.
 *
 * ── How the clock is made wrong ─────────────────────────────────────────
 * `Date` itself is replaced in the page, before any script runs: Date.now()
 * AND `new Date()` are both shifted. Overriding Date.now() alone would be a
 * different, impossible device — the Firebase SDK measures its offset with
 * `new Date().getTime()`, so it would see an honest clock while the page saw a
 * wrong one. Timers and performance.now() are left alone, as on a real device
 * whose wall clock is simply set wrong.
 *
 * The first test is the control for all the others: on such a device the SDK
 * still signs in and writes, its published offset is the skew, a date taken
 * from the device clock is REFUSED and the same write with the offset applied
 * is ALLOWED. Without it, a failure below could be the override breaking the
 * SDK rather than the rules refusing a date.
 *
 * "The server's clock" here is this process's Date.now(): the emulator runs on
 * the same machine, and `now` in a rule is that machine's clock.
 */

// @ts-check
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");

const HOUR = 60 * 60 * 1000;

/* Every skew is far outside what the join allows (+5 s / -2 min), and the
   thirteen-hour pair is outside what `created` and `closed` allow as well. */
const SKEWS = [
  ["one hour fast", HOUR],
  ["one hour slow", -HOUR],
  ["thirteen hours fast", 13 * HOUR],
  ["thirteen hours slow", -13 * HOUR]
];

async function skewDeviceClock(page, ms) {
  await page.addInitScript((skew) => {
    const Real = Date;
    function Skewed(...args) {
      if (!new.target) return new Real(Real.now() + skew).toString();
      return args.length ? new Real(...args) : new Real(Real.now() + skew);
    }
    Skewed.prototype = Real.prototype;
    Skewed.now = () => Real.now() + skew;
    Skewed.parse = Real.parse;
    Skewed.UTC = Real.UTC;
    // @ts-ignore — replacing the global is the point
    window.Date = Skewed;
  }, ms);
}

/* The SDK logs every refused write before the caller's catch sees it. Kept per
   page so a failure can say WHICH write was refused, and so the session test
   can require that none was. */
function recordRefusals(page, into) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (/permission_denied/i.test(text)) into.push(text.slice(0, 300));
  });
}

async function installModalAutoAccept(page) {
  await page.addInitScript(() => {
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      // @ts-ignore
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

function tryWrite(page, path, value) {
  return page.evaluate(async ([p, v]) => {
    try {
      await firebase.database().ref(p).set(v);
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  }, [path, value]);
}

function expectDenied(result, why) {
  expect(result, why).not.toBe("ALLOWED");
  expect(String(result), why + " (and denied for PERMISSION, not by a transport error)")
    .toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
}

/* A date the client wrote is the server's when it falls between the moment
   the step began and the moment it was read back. Five seconds of slack each
   way: the offset is an estimate, good to the latency of one message. Every
   skew above is at least an hour, so a device-clock date cannot pass. Soft, so
   that one run names EVERY date that came from the device rather than
   stopping at the first; a write that never lands still stops the test. */
function expectServerDate(at, startedAt, what) {
  expect.soft(typeof at, what + " must be a number").toBe("number");
  expect.soft(at, what + " is earlier than the step that wrote it — the device's clock, not the server's")
    .toBeGreaterThanOrEqual(startedAt - 5000);
  expect.soft(at, what + " is later than now — the device's clock, not the server's")
    .toBeLessThanOrEqual(Date.now() + 5000);
}

const uniq = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

/* The first object under `node` whose `text` is `text`. */
function findByText(node, text) {
  if (!node || typeof node !== "object") return null;
  if (node.text === text) return node;
  for (const k of Object.keys(node)) {
    const hit = findByText(node[k], text);
    if (hit) return hit;
  }
  return null;
}

async function createSessionAs(page, name) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill(name);
  await page.locator("#splash-create-label").fill("device-clock");
  await page.locator("#splash-create-pass").fill("emu-clock-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode, "the session must be created — a refused `created` write stops here")
    .toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  return { code, base };
}

for (const [what, skew] of SKEWS) {
  test(`control: on a device ${what} the SDK still works, and it is the DATE the rules refuse`, async ({ page }) => {
    await skewDeviceClock(page, skew);
    const uid = await signedInUid(page);

    const seen = await page.evaluate(() => Date.now());
    expect(Math.abs(seen - Date.now() - skew), "the page's clock must be the skewed one")
      .toBeLessThan(60_000);
    expect(await page.evaluate(() => Math.abs(new Date().getTime() - Date.now())),
      "`new Date()` and Date.now() must agree in the page, as on a real device").toBeLessThan(1000);

    /* The offset the database publishes cancels the skew. This is the number
       serverNow() adds, read here straight from the SDK. (The callback is a
       named function and never unsubscribes itself: `on()` calls it
       synchronously when the value is already known, before any handle it
       returns could be assigned.) */
    const offset = await page.evaluate(() => new Promise((resolve) => {
      firebase.database().ref(".info/serverTimeOffset").on("value", function seenOffset(s) {
        if (typeof s.val() === "number") resolve(s.val());
      });
    }));
    expect(Math.abs(offset + skew), "the published offset must be the skew, reversed").toBeLessThan(60_000);

    for (const base of ["sessions/" + uniq("clk-"), "orgs/e2e-org/sessions/" + uniq("clk-")]) {
      /* A write with no date in it: the SDK works on this device. */
      expect(await tryWrite(page, base + "/creatorUid", uid),
        "a write that carries no date must be allowed — otherwise the override broke the SDK")
        .toBe("ALLOWED");

      /* The join. Same node, same user, same shape, twice; only the date
         differs. Five seconds ahead and two minutes behind is all the rule
         allows, so every skew here is refused, fast or slow. */
      const member = (at) => tryWrite(page, base + "/members/" + uid, { at: at });
      expectDenied(await member(await page.evaluate(() => Date.now())),
        "members.at taken from a device clock " + what);
      expect(await dbReadAsOwner(base + "/members/" + uid), "the refused claim must not have landed").toBeNull();
      const beforeJoin = Date.now();
      expect(await member(await page.evaluate((o) => Date.now() + o, offset)),
        "the same membership claim with the published offset applied").toBe("ALLOWED");
      expectServerDate((await dbReadAsOwner(base + "/members/" + uid)).at, beforeJoin, "members.at");

      /* `created` has twelve hours either side (#438). Inside them a device
         date is ACCEPTED, wrong as it is — which is the other half of the
         defect, and the whole-session test below is what catches it. */
      const dated = (at) => tryWrite(page, base + "/created", { by: "Facilitator", at: at });
      if (Math.abs(skew) > 12 * HOUR) {
        expectDenied(await dated(await page.evaluate(() => Date.now())),
          "created.at taken from a device clock " + what);
        expect(await dbReadAsOwner(base + "/created"), "the refused write must not have landed").toBeNull();
      }
      const before = Date.now();
      expect(await dated(await page.evaluate((o) => Date.now() + o, offset)),
        "`created` with the published offset applied").toBe("ALLOWED");
      expectServerDate((await dbReadAsOwner(base + "/created")).at, before, "created.at");
    }
  });
}

for (const [what, skew] of SKEWS) {
  test(`the real client runs a whole session from devices ${what}`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    const refused = { facilitator: [], participant: [] };
    recordRefusals(page, refused.facilitator);
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await installModalAutoAccept(page);
    await skewDeviceClock(page, skew);

    // ---- create ----
    let step = Date.now();
    const { code, base } = await createSessionAs(page, "Clock Fac");
    expectServerDate((await dbReadAsOwner(base + "/created")).at, step, "created.at");
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

    // ---- join: a second USER is a second context, with the same wrong clock ----
    const ctx = await browser.newContext();
    const tab2 = await ctx.newPage();
    await useEmulator(tab2);
    recordRefusals(tab2, refused.participant);
    tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await skewDeviceClock(tab2, skew);
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 15_000 });
    await tab2.locator("#name-input").fill("Clock Student");
    const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab2.locator("#uni-input").selectOption(uni);
    await tab2.locator("#consent-workshop").check();
    await expect(tab2.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
    step = Date.now();
    await tab2.locator("#join-btn").click();

    const uidFac = await page.evaluate(() => firebase.auth().currentUser.uid);
    await tab2.waitForFunction(() => !!firebase.auth().currentUser, null, { timeout: 20_000 });
    const uidStu = await tab2.evaluate(() => firebase.auth().currentUser.uid);
    expect(uidStu, "the participant must be a DISTINCT user").not.toBe(uidFac);
    const cid = await tab2.evaluate(() => clientId);

    /* The DB first. Both writes are needed to take part at all: `members` is
       what lets this user read the session, `pool` is what puts them in it. */
    await expect.poll(() => dbReadAsOwner(`${base}/members/${uidStu}`),
      { message: "the membership claim must land — refused, the participant can read nothing", timeout: 15_000 })
      .not.toBeNull();
    expectServerDate((await dbReadAsOwner(`${base}/members/${uidStu}`)).at, step, "members.at");
    await expect.poll(() => dbReadAsOwner(`${base}/pool/${cid}`),
      { message: "the pool entry must land — refused, the facilitator never sees this participant", timeout: 15_000 })
      .not.toBeNull();
    const poolEntry = await dbReadAsOwner(`${base}/pool/${cid}`);
    expectServerDate(poolEntry.at, step, "pool.at");
    expectServerDate(poolEntry.consent.at, step, "pool.consent.at — the date consent was given");
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#prestart-count"), "and the facilitator must see them")
      .not.toHaveText("0", { timeout: 15_000 });

    // ---- start, then advance: `stageAt` has the tightest window of all (±5 s) ----
    await page.locator("#start-session-btn").click();
    await expect(tab2.locator("#app")).toBeVisible({ timeout: 20_000 });
    const room = await tab2.evaluate(() => myRoom);
    const adv = page.getByRole("button", { name: /^Advance\s*→?$/ }).first();
    await expect(adv).toBeEnabled({ timeout: 15_000 });
    step = Date.now();
    await adv.click();
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/rooms/${room}`)) || {}).stage,
      { message: "the advance must have written stage = 1", timeout: 15_000 }).toBe(1);
    await expect.poll(async () => typeof ((await dbReadAsOwner(`${base}/rooms/${room}`)) || {}).stageAt,
      { message: "and its date: `stageAt` is what every stage timer counts from", timeout: 15_000 })
      .toBe("number");
    expectServerDate((await dbReadAsOwner(`${base}/rooms/${room}`)).stageAt, step, "stageAt");
    await expect(tab2.locator("#stage-indicator")).toContainText(/Stage 2/i, { timeout: 15_000 });

    // ---- the participant writes: a working hypothesis ----
    const text = "clock " + uniq("h");
    await tab2.locator("#chart-hypotheses > summary").click();   // collapsed by default
    await expect(tab2.locator("#hypothesis-input")).toBeVisible({ timeout: 15_000 });
    await tab2.locator("#hypothesis-input").fill(text);
    step = Date.now();
    await tab2.locator("#hypothesis-add-btn").click();
    await expect.poll(async () => findByText(await dbReadAsOwner(`${base}/rooms/${room}`), text),
      { message: "the participant's hypothesis must land", timeout: 15_000 }).not.toBeNull();
    expectServerDate(findByText(await dbReadAsOwner(`${base}/rooms/${room}`), text).at, step, "hypothesis.at");
    await expect(tab2.locator("#hypothesis-list")).toContainText(text, { timeout: 10_000 });

    // ---- end the session from the dashboard ----
    step = Date.now();
    await page.locator("#admin-close-btn").click();
    await expect.poll(() => dbReadAsOwner(base + "/closed"),
      { message: "the close must land — refused, the session stays open for everyone", timeout: 20_000 })
      .not.toBeNull();
    expectServerDate((await dbReadAsOwner(base + "/closed")).at, step, "closed.at");
    await expect(page.locator("#admin-close-btn"), "and the dashboard must say so")
      .toContainText(/Session closed/i, { timeout: 15_000 });
    await expect(tab2.locator("#session-ended"),
      "and the participant must be shown that it ended").toBeVisible({ timeout: 15_000 });

    expect(refused, "no write of the session was refused, on either device")
      .toEqual({ facilitator: [], participant: [] });
    await ctx.close();
  });
}

for (const [what, skew] of [SKEWS[2], SKEWS[3]]) {
  test(`"Sessions you created → Close session" works from a device ${what}`, async ({ page, context }) => {
    /* The session is created on an honest clock; the SAME browser — same
       storage, same user, which is what the list is keyed on — then closes it
       with its clock wrong. That is a laptop whose clock was changed between
       the class and the tidy-up. */
    const { code, base } = await createSessionAs(page, "Clock Closer");
    expect(await dbReadAsOwner(base + "/closed")).toBeNull();

    const late = await context.newPage();
    await useEmulator(late);
    await skewDeviceClock(late, skew);
    await late.goto("/");
    await expect(late.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 15_000 });
    await late.locator("#splash-go-my-sessions").click();
    const row = late.locator(`.my-session-row[data-code='${code}']`);
    await expect(row).toBeVisible();
    const step = Date.now();
    await row.locator(".my-session-close").dispatchEvent("click");
    const modal = late.locator("#canamed-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await modal.locator("#canamed-modal-confirm").dispatchEvent("click");

    await expect.poll(() => dbReadAsOwner(base + "/closed"),
      { message: "the close must land — refused, the session stays open and takes the 90-day path", timeout: 15_000 })
      .not.toBeNull();
    expectServerDate((await dbReadAsOwner(base + "/closed")).at, step, "closed.at");
    await expect(row, "and the row leaves the list").toHaveCount(0, { timeout: 10_000 });
  });
}

test("a close the server REFUSES says so, and does not send the facilitator to check their connection", async ({ page, browser }) => {
  /* The list is this browser's; the right to close is the creator's (or a
     password-proof holder's). A browser that has the session in its list but
     is signed in as someone else is refused by the rules — and used to be told
     "check your connection and try again", which no retry could ever satisfy.
     A real refusal, because only the real SDK shows what a refusal looks like
     to the client (`code === "PERMISSION_DENIED"`); the LOCAL suite stubs it. */
  const { code, base } = await createSessionAs(page, "Clock Owner");
  const uidOwner = await page.evaluate(() => firebase.auth().currentUser.uid);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await useEmulator(other);
  const uidOther = await signedInUid(other);
  expect(uidOther, "the second browser must be a DISTINCT user").not.toBe(uidOwner);
  await other.evaluate((c) => addMySession(c, "not mine"), code);
  await other.reload();
  await expect(other.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 15_000 });
  await other.locator("#splash-go-my-sessions").click();
  const theirs = other.locator(`.my-session-row[data-code='${code}']`);
  await expect(theirs).toBeVisible();
  await theirs.locator(".my-session-close").dispatchEvent("click");
  await expect(other.locator("#canamed-modal")).toBeVisible({ timeout: 10_000 });
  await other.locator("#canamed-modal-confirm").dispatchEvent("click");

  await expect(theirs.locator(".my-session-status"), "the page must say the SERVER refused")
    .toContainText(/server refused/i, { timeout: 15_000 });
  await expect(theirs.locator(".my-session-status")).not.toContainText(/connection/i);
  expect(await dbReadAsOwner(base + "/closed"), "and the session must still be open").toBeNull();
  await expect(theirs.locator(".my-session-close"), "with the button usable again").toBeEnabled();

  /* THE ALLOW LEG: the same click, the same client, the same payload — from
     the creator's browser. Without it the refusal above could be a rule that
     refuses everyone. */
  await page.reload();
  await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 15_000 });
  await page.locator("#splash-go-my-sessions").click();
  const mine = page.locator(`.my-session-row[data-code='${code}']`);
  await expect(mine).toBeVisible();
  const step = Date.now();
  await mine.locator(".my-session-close").dispatchEvent("click");
  await expect(page.locator("#canamed-modal")).toBeVisible({ timeout: 10_000 });
  await page.locator("#canamed-modal-confirm").dispatchEvent("click");
  await expect.poll(() => dbReadAsOwner(base + "/closed"),
    { message: "the creator's close must land", timeout: 15_000 }).not.toBeNull();
  expectServerDate((await dbReadAsOwner(base + "/closed")).at, step, "closed.at");
  await ctx.close();
});
