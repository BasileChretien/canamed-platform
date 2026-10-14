/* tests-e2e/emulator/dashboard-after-room-visit-sdk.spec.js
 *
 * (Not "dashboard-after-room-visit.spec.js": that is the LOCAL twin's name, and
 * the mobile projects' testMatch in playwright.config.js matches a basename in
 * any directory, so a second file of that name would run in LOCAL mode there.)
 *
 * The facilitator's dashboard stopped updating once the facilitator had opened
 * a room and come back to it. A participant's reveals and call for help landed
 * in the database and never reached the dashboard; a stage change made from
 * the dashboard landed and the row kept the old stage, so the row's next
 * Advance — bound to that stale stage — read the database, saw a different
 * value from the one it expected, and did nothing.
 *
 * The cause was one call in teardownRoom(): `refLeaderboard.off()`.
 * refLeaderboard is `rooms`, the same location as the dashboard's own listener
 * (refRooms in script-admin.js), and in the Firebase SDK `off()` with no
 * callback removes EVERY callback at a location, whichever Reference object
 * registered it. teardownRoom() runs when a facilitator leaves a room for the
 * dashboard and when it switches rooms from the sidebar, and nothing ever
 * subscribed the dashboard again.
 *
 * Only the emulator can show it. LocalDB (the LOCAL suite's database) removes
 * only the callbacks registered through the Reference that `off()` is called
 * on, so in LOCAL mode the dashboard's listener survived and the defect could
 * not be seen.
 *
 * Each test reads the dashboard BEFORE the room visit as its control: the same
 * write, rendered by the same code, has to show up there first. A failure after
 * the visit is then the listener, not a selector or a refused write. The
 * database is read first and the DOM second, so "the write never landed" and
 * "it landed and never rendered" fail differently.
 */

// @ts-check
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");

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

/* Room names are "Room 1" … "Room N": anchor on the name and the separator
   after it, so "Room 1" never matches "Room 10". */
function startsWithRoom(room) {
  return new RegExp("^" + room.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s");
}
function dashRow(page, room) {
  return page.locator(".dash-room").filter({
    has: page.locator(".dash-title", { hasText: startsWithRoom(room) })
  });
}
function sidebarRow(page, room) {
  return page.locator("#sidebar-rooms .sidebar-room").filter({
    has: page.locator(".sidebar-room-name", { hasText: startsWithRoom(room) })
  });
}

function revealedCount(roomNode) {
  const sections = (roomNode && roomNode.sections) || {};
  return Object.keys(sections).reduce((n, slot) =>
    n + Object.keys((sections[slot] && sections[slot].revealed) || {}).length, 0);
}
const readRoom = async (base, room) => (await dbReadAsOwner(`${base}/rooms/${room}`)) || {};

/* "Stage 2/4", as the dashboard and the sidebar both print it. */
function stageText(flow, stage) {
  return "Stage " + (flow.indexOf(stage) + 1) + "/" + flow.length;
}

/* A session from the real create form, one participant in a second browser
   CONTEXT (a second page would share the facilitator's anonymous user), started
   from the dashboard. */
async function startSessionWithOneParticipant(page, browser) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  page.on("download", (d) => { try { d.cancel(); } catch (_) {} });
  await installModalAutoAccept(page);

  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Dash Fac");
  await page.locator("#splash-create-label").fill("dashboard-after-room-visit");
  await page.locator("#splash-create-pass").fill("emu-dash-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

  const ctx = await browser.newContext();
  const tab2 = await ctx.newPage();
  await useEmulator(tab2);
  tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await tab2.goto("/");
  await tab2.locator("#splash-code").fill(code);
  await tab2.locator("#splash-enter").click();
  await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await tab2.locator("#name-input").fill("Dash Student");
  const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab2.locator("#uni-input").selectOption(uni);
  await tab2.locator("#consent-workshop").check();
  await expect(tab2.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await tab2.locator("#join-btn").click();
  await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 15_000 });

  const uidFac = await page.evaluate(() => firebase.auth().currentUser.uid);
  const uidStu = await tab2.evaluate(() => firebase.auth().currentUser.uid);
  expect(uidStu, "the participant must be a DISTINCT user").not.toBe(uidFac);

  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 15_000 });
  await page.locator("#start-session-btn").click();
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#admin-dashboard")).toBeVisible({ timeout: 15_000 });

  const room = await tab2.evaluate(() => myRoom);
  const rooms = await page.evaluate(() => roomNames(roomCount));
  const flow = await page.evaluate(() => stageFlow());
  expect(rooms, "the participant's room is one of the session's rooms").toContain(room);
  expect(rooms.length, "a second room to switch to").toBeGreaterThan(1);
  expect(flow.length, "two advances need a welcome, a section and a wrap-up").toBeGreaterThanOrEqual(3);
  const otherRoom = rooms.find((r) => r !== room);
  return { base, room, otherRoom, flow, tab2, ctx };
}

/* The participant reveals a finding through the client's own write path. */
async function revealNth(tab2, base, room, n) {
  const id = await tab2.evaluate((i) => ITEM_IDS[i], n);
  expect(id, "the case has a finding at index " + n).toBeTruthy();
  await tab2.evaluate((x) => reveal(x), id);
  await expect.poll(async () => revealedCount(await readRoom(base, room)),
    { message: "the reveal must land", timeout: 15_000 }).toBe(n + 1);
}

/* The participant presses "Call a facilitator". */
async function callForHelp(tab2, base, room) {
  await tab2.locator("#call-prof-btn").click();
  await expect.poll(async () => {
    const c = (await readRoom(base, room)).callForHelp;
    return !!c && !c.ack;
  }, { message: "the call must land, unacknowledged", timeout: 15_000 }).toBe(true);
}

async function advanceTo(clickTarget, base, room, stage) {
  await clickTarget.click();
  await expect.poll(async () => (await readRoom(base, room)).stage,
    { message: "the advance must have written stage = " + stage, timeout: 15_000 }).toBe(stage);
}

test("the dashboard keeps updating after the facilitator opens a room and comes back", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { base, room, flow, tab2, ctx } = await startSessionWithOneParticipant(page, browser);
  const row = () => dashRow(page, room);

  /* CONTROL — before any room visit, a reveal reaches the dashboard. */
  await expect(row()).toHaveCount(1);
  await revealNth(tab2, base, room, 0);
  await expect(row().locator(".dash-progress")).toContainText(/findings 1\//, { timeout: 15_000 });

  /* The facilitator opens the room, then comes back. */
  await row().locator(".view-btn").click();
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => myRoom)).toBe(room);
  await page.locator("#sidebar-dashboard-btn").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

  /* A second reveal. */
  await revealNth(tab2, base, room, 1);
  await expect(row().locator(".dash-progress"),
    "the reveal landed (read above) — the dashboard must show it")
    .toContainText(/findings 2\//, { timeout: 15_000 });

  /* A call for help: the row, the session signal and the tab title. */
  await callForHelp(tab2, base, room);
  await expect(row(), "the call landed — the room's row must say it is calling")
    .toHaveClass(/\bcalling\b/, { timeout: 15_000 });
  await expect(page, "and the tab title must count it").toHaveTitle(/^\(1\) /, { timeout: 15_000 });

  /* Two advances from the row. The second runs on the row the first one
     re-rendered: a stale row's handler carries the old stage and refuses. */
  await advanceTo(row().getByRole("button", { name: /^Advance\s*→?$/ }), base, room, flow[1]);
  await expect(row().locator(".dash-stage"), "the advance landed — the row must show the new stage")
    .toContainText(stageText(flow, flow[1]), { timeout: 15_000 });
  await advanceTo(row().getByRole("button", { name: /^Advance\s*→?$/ }), base, room, flow[2]);
  await expect(row().locator(".dash-stage"))
    .toContainText(stageText(flow, flow[2]), { timeout: 15_000 });

  await ctx.close();
});

test("the sidebar keeps updating after the facilitator switches rooms from it", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { base, room, otherRoom, flow, tab2, ctx } = await startSessionWithOneParticipant(page, browser);
  const side = () => sidebarRow(page, room);
  const advanceBtn = () => side().getByRole("button", { name: "Advance " + room + " a stage" });

  /* Into the participant's room first: entering a first room tears nothing
     down, so the sidebar is live here. */
  await dashRow(page, room).locator(".view-btn").click();
  await expect(page.locator("#room-sidebar")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => myRoom)).toBe(room);

  /* CONTROL — an advance from the sidebar reaches the sidebar. */
  await advanceTo(advanceBtn(), base, room, flow[1]);
  await expect(side().locator(".sidebar-room-meta"))
    .toContainText(stageText(flow, flow[1]), { timeout: 15_000 });

  /* Switch to another room from the sidebar. */
  await sidebarRow(page, otherRoom).locator(".sidebar-room-name").click();
  await expect.poll(() => page.evaluate(() => myRoom)).toBe(otherRoom);

  await callForHelp(tab2, base, room);
  await expect(side(), "the call landed — the sidebar must show the room calling")
    .toHaveClass(/\bcalling\b/, { timeout: 15_000 });

  await advanceTo(advanceBtn(), base, room, flow[2]);
  await expect(side().locator(".sidebar-room-meta"), "the advance landed — the sidebar must show it")
    .toContainText(stageText(flow, flow[2]), { timeout: 15_000 });

  await ctx.close();
});
