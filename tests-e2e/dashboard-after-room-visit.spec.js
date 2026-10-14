/* tests-e2e/dashboard-after-room-visit.spec.js
 *
 * The facilitator's dashboard must keep updating after the facilitator has
 * opened a room and come back, and the room sidebar after a switch from one
 * room to another. Both stopped: teardownRoom() called `refLeaderboard.off()`
 * on `rooms`, the location the dashboard listens on, and in the Firebase SDK
 * off() with no callback removes every callback at a location.
 *
 * LOCAL mode could not see it until LocalDB's off() was made to act on the
 * location as Firebase's does (tests/localdb-off-location.test.js): before
 * that, this spec passed on the defect. It runs on every device project; the
 * SDK-backed twin is tests-e2e/emulator/dashboard-after-room-visit-sdk.spec.js.
 *
 * Each test's first step is its control: the same write, rendered by the same
 * code, reaches the dashboard BEFORE the room visit. The store is read before
 * the DOM — through a one-shot read, which no listener teardown can affect —
 * so "it never landed" and "it never rendered" fail differently.
 *
 * Mode: LOCAL (fixtures.js). The participant is a second PAGE of the same
 * context, which is how LocalDB's tabs share a store; there are no users in
 * LOCAL mode, so the two-users rule of the emulator suite does not arise.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function createSessionAsAdmin(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      // @ts-ignore
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    document.addEventListener("DOMContentLoaded", () => setInterval(tryAccept, 200));
  });
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  page.on("download", (d) => { try { d.cancel(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Dash Fac");
  await page.locator("#splash-create-label").fill("dashboard after a room visit");
  await page.locator("#splash-create-pass").fill("e2e-dash-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
  return code;
}

async function joinAsParticipant(context, code) {
  const tab = await context.newPage();
  tab.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await tab.addInitScript(() => {
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
      /* The Module A tour opens at stage 1 and covers "Call a facilitator". */
      localStorage.setItem("canamed_tour_student_done", "v1");
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
    } catch (e) {}
    function pin(name, value) {
      Object.defineProperty(window, name, { get: () => value, set: () => {}, configurable: true, enumerable: true });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
  });
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  await tab.locator("#name-input").fill("Dash Student");
  const uni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab.locator("#uni-input").selectOption(uni);
  await tab.locator("#consent-workshop").check();
  await expect(tab.locator("#join-btn")).toBeEnabled({ timeout: 5_000 });
  await tab.locator("#join-btn").click();
  await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  return tab;
}

async function startWithOneParticipant(page, context) {
  /* Two tabs, a full session, six clicks: on mobile-ipad (WebKit) a click took
     7-12 s and the whole test ~2.5 min, every assertion passing. */
  test.setTimeout(240_000);
  const code = await createSessionAsAdmin(page);
  const tab = await joinAsParticipant(context, code);
  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
  await page.locator("#start-session-btn").click();
  await expect(tab.locator("#app")).toBeVisible({ timeout: 15_000 });
  /* The started listener's own DOM toggle, as advance-and-close.spec.js does:
     a cross-tab LocalDB write can re-hide it for a moment. Not under test. */
  await page.evaluate(() => {
    document.getElementById("admin-prestart").classList.add("hidden");
    document.getElementById("admin-dashboard").classList.remove("hidden");
  });
  const room = await tab.evaluate(() => myRoom);
  const rooms = await page.evaluate(() => roomNames(roomCount));
  const flow = await page.evaluate(() => stageFlow());
  expect(rooms).toContain(room);
  expect(rooms.length, "a second room to switch to").toBeGreaterThan(1);
  expect(flow.length, "two advances need a welcome, a section and a wrap-up").toBeGreaterThanOrEqual(3);
  return { tab, room, otherRoom: rooms.find((r) => r !== room), flow };
}

function startsWithRoom(room) {
  return new RegExp("^" + room.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s");
}
const dashRow = (page, room) => page.locator(".dash-room").filter({
  has: page.locator(".dash-title", { hasText: startsWithRoom(room) })
});
const sidebarRow = (page, room) => page.locator("#sidebar-rooms .sidebar-room").filter({
  has: page.locator(".sidebar-room-name", { hasText: startsWithRoom(room) })
});
const stageText = (flow, stage) => "Stage " + (flow.indexOf(stage) + 1) + "/" + flow.length;

/* A one-shot read of the room from the store. */
const readRoom = (page, room) => page.evaluate((r) =>
  db.ref(sPath("rooms/" + r)).once("value").then((s) => s.val() || {}), room);
function revealedCount(node) {
  const sections = (node && node.sections) || {};
  return Object.keys(sections).reduce((n, k) =>
    n + Object.keys((sections[k] && sections[k].revealed) || {}).length, 0);
}

async function revealNth(tab, page, room, n) {
  await tab.evaluate((i) => reveal(ITEM_IDS[i]), n);
  await expect.poll(async () => revealedCount(await readRoom(page, room)),
    { message: "the reveal must land", timeout: 10_000 }).toBe(n + 1);
}
async function callForHelp(tab, page, room) {
  await tab.locator("#call-prof-btn").click();
  await expect.poll(async () => {
    const c = (await readRoom(page, room)).callForHelp;
    return !!c && !c.ack;
  }, { message: "the call must land, unacknowledged", timeout: 10_000 }).toBe(true);
}
async function advanceTo(btn, page, room, stage) {
  await btn.click();
  await expect.poll(async () => (await readRoom(page, room)).stage,
    { message: "the advance must have written stage = " + stage, timeout: 10_000 }).toBe(stage);
}

test("the dashboard keeps updating after the facilitator opens a room and comes back", async ({ page, context }) => {
  const { tab, room, flow } = await startWithOneParticipant(page, context);
  const row = () => dashRow(page, room);

  /* CONTROL — before any room visit. */
  await revealNth(tab, page, room, 0);
  await expect(row().locator(".dash-progress")).toContainText(/findings 1\//, { timeout: 10_000 });

  await row().locator(".view-btn").click();
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => myRoom)).toBe(room);
  await page.locator("#sidebar-dashboard-btn").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 10_000 });

  await revealNth(tab, page, room, 1);
  await expect(row().locator(".dash-progress"), "the reveal landed — the dashboard must show it")
    .toContainText(/findings 2\//, { timeout: 10_000 });

  await callForHelp(tab, page, room);
  await expect(row(), "the call landed — the row must say the room is calling")
    .toHaveClass(/\bcalling\b/, { timeout: 10_000 });
  await expect(page, "and the tab title must count it").toHaveTitle(/^\(1\) /, { timeout: 10_000 });

  await advanceTo(row().getByRole("button", { name: /^Advance\s*→?$/ }), page, room, flow[1]);
  await expect(row().locator(".dash-stage"), "the advance landed — the row must show the new stage")
    .toContainText(stageText(flow, flow[1]), { timeout: 10_000 });
  await advanceTo(row().getByRole("button", { name: /^Advance\s*→?$/ }), page, room, flow[2]);
  await expect(row().locator(".dash-stage")).toContainText(stageText(flow, flow[2]), { timeout: 10_000 });
});

test("the sidebar keeps updating after the facilitator switches rooms from it", async ({ page, context }) => {
  const { tab, room, otherRoom, flow } = await startWithOneParticipant(page, context);
  const side = () => sidebarRow(page, room);
  const advanceBtn = () => side().getByRole("button", { name: "Advance " + room + " a stage" });

  await dashRow(page, room).locator(".view-btn").click();
  await expect(page.locator("#room-sidebar")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => myRoom)).toBe(room);

  /* CONTROL — a first room tears nothing down, so the sidebar is live here. */
  await advanceTo(advanceBtn(), page, room, flow[1]);
  await expect(side().locator(".sidebar-room-meta")).toContainText(stageText(flow, flow[1]), { timeout: 10_000 });

  await sidebarRow(page, otherRoom).locator(".sidebar-room-name").click();
  await expect.poll(() => page.evaluate(() => myRoom)).toBe(otherRoom);

  await callForHelp(tab, page, room);
  await expect(side(), "the call landed — the sidebar must show the room calling")
    .toHaveClass(/\bcalling\b/, { timeout: 10_000 });
  await advanceTo(advanceBtn(), page, room, flow[2]);
  await expect(side().locator(".sidebar-room-meta"), "the advance landed — the sidebar must show it")
    .toContainText(stageText(flow, flow[2]), { timeout: 10_000 });
});
