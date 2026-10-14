/* tests-e2e/leave-rejoin-own-row.spec.js
 *
 * A tab keeps its client id across Leave (it lives in sessionStorage, which a
 * reload keeps), and the client id is the key of the participant's pool row:
 * name, university and the consent record their answers are read against.
 * Measured on the emulator on 2026-10-14: after Leave, a join in the same tab
 * rewrote the SAME row. For the person who left, coming back, that is right —
 * one row. For the next student on a shared machine it took over the previous
 * student's row, consent included.
 *
 * Now: a join whose name differs from the name on the tab's existing row takes
 * a fresh client id and a row of its own; the same name keeps the row.
 *
 * LOCAL mode (no accounts, no rules), so it runs on every device project — the
 * client-id choice is the same code in both modes. The room a returning
 * participant is placed in is a shared-mode matter, covered with the real
 * rules in tests-e2e/emulator/rejoin-room-claim.spec.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function createSession(page) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Row Fac");
  await page.locator("#splash-create-label").fill("E2E own row");
  await page.locator("#splash-create-pass").fill("e2e-own-row-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible();
  return code;
}

/* A participant tab in the facilitator's context: LocalDB is shared through
   this context's storage, which is how LOCAL mode syncs tabs. */
async function participantTab(context) {
  const tab = await context.newPage();
  tab.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await tab.addInitScript(() => {
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
    } catch (e) {}
    Object.defineProperty(window, "CANAMED_FIREBASE", {
      get: () => null, set: () => {}, configurable: true, enumerable: true
    });
  });
  return tab;
}

async function joinAs(tab, code, name) {
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  // The badge is set after initLobby() rebuilds the university list.
  await expect(tab.locator("#session-badge")).toBeVisible({ timeout: 10_000 });
  await tab.locator("#name-input").fill(name);
  const uni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab.locator("#uni-input").selectOption(uni);
  await tab.locator("#consent-workshop").check();
  await tab.locator("#join-btn").click();
  await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  return tab.evaluate(() => clientId);
}

async function leave(tab) {
  await tab.locator("#waiting-leave").click();
  await expect(tab.locator("#splash")).toBeVisible({ timeout: 10_000 });
}

const poolOf = (tab) => tab.evaluate(() =>
  db.ref(sPath("pool")).once("value").then((s) => s.val() || {}));

test("after Leave, a different name in the same tab gets a row of its own; the same name keeps its row", async ({ page, context }) => {
  test.setTimeout(180_000);   // three joins and two reloads; WebKit under load needs ~95 s
  const code = await createSession(page);
  const tab = await participantTab(context);

  const ana = await joinAs(tab, code, "Ana Leaver");
  expect((await poolOf(tab))[ana].name).toBe("Ana Leaver");
  await leave(tab);
  expect(await tab.evaluate(() => sessionStorage.getItem("canamed_client")),
    "the precondition: the tab still holds the id after Leave").toBe(ana);

  // ---- the next student, same tab ----
  const zoe = await joinAs(tab, code, "Zoe Next");
  expect(zoe, "a different name must not reuse the previous student's id").not.toBe(ana);
  const pool = await poolOf(tab);
  expect(pool[zoe] && pool[zoe].name).toBe("Zoe Next");
  expect(pool[ana] ? pool[ana].name : null,
    "the previous student's row must not have been rewritten as Zoe's").not.toBe("Zoe Next");

  // ---- the same student, back again ----
  await leave(tab);
  const zoeAgain = await joinAs(tab, code, "  zoe next ");
  expect(zoeAgain, "the same name (spacing and case aside) keeps the row").toBe(zoe);
  const after = Object.values(await poolOf(tab));
  expect(after.filter((r) => r && /^zoe next$/i.test(String(r.name).trim())).length,
    "one row for Zoe, not two").toBe(1);
});
