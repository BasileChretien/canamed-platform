/* tests-e2e/close-refused-message.spec.js
 *
 * What a facilitator is told when a close does not go through.
 *
 * Two places close a session, and both used to name the wrong cause when the
 * SERVER refused the write (PERMISSION_DENIED):
 *
 *   - "Sessions you created → Close session" said "Could not close — check
 *     your connection and try again." A refusal is an answer from the server:
 *     the connection is fine, and no retry changes it.
 *   - The dashboard's "End session & download archive" said the database rules
 *     needed deploying, and gave the command — to a facilitator, about a
 *     system they do not deploy.
 *
 * Both now say the server refused and what to do instead, and keep the
 * connection message for a failure that is not a refusal.
 *
 * LOCAL mode has no rules, so the refusal is put in by hand: the `closed`
 * write is made to reject the way the real SDK rejects it. What a real refusal
 * looks like to the client is covered where there are real rules —
 * tests-e2e/emulator/device-clock.spec.js, "a close the server REFUSES…".
 * This file is the per-device half: the same messages on a desktop, an iPhone,
 * an iPad and an Android phone, where the longer sentence has to fit the row.
 *
 * Every refusal here is followed by the same click with the write let
 * through, and that one must close the session.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Make the `closed` write fail. "refused": as the rules refuse it. "transport":
   any other failure — no code. Reads are left alone, so the page can still
   check whether the session exists. */
async function failCloseWrites(page, how) {
  await page.evaluate((mode) => {
    if (!window.__realDbRef) window.__realDbRef = db.ref.bind(db);
    db.ref = (p) => {
      const r = window.__realDbRef(p);
      if (/(?:^|\/)closed$/.test(String(p))) {
        r.set = () => {
          const e = new Error(mode === "refused" ? "PERMISSION_DENIED: Permission denied" : "socket hang up");
          if (mode === "refused") e.code = "PERMISSION_DENIED";
          return Promise.reject(e);
        };
      }
      return r;
    };
  }, how);
}

async function letCloseWritesThrough(page) {
  await page.evaluate(() => { if (window.__realDbRef) db.ref = window.__realDbRef; });
}

async function createSession(page, name) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill(name);
  await page.locator("#splash-create-label").fill("refused close");
  await page.locator("#splash-create-pass").fill("e2e-refused-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  return (await codeNode.textContent()).trim();
}

const closedInDb = (page, code) => page.evaluate(async (c) => {
  const snap = await db.ref(oPath(sanitizeCode(c), "closed")).once("value");
  return snap.val();
}, code);

async function confirmModal(page) {
  const modal = page.locator("#canamed-modal");
  await expect(modal).toBeVisible({ timeout: 5000 });
  await modal.locator("#canamed-modal-confirm").dispatchEvent("click");
}

test.describe("a close that does not go through", () => {
  /* Each test creates a session (a password hash) and then goes through the
     close three times: refused, failed, let through. The default thirty
     seconds is not enough for that on the slower engines — iPad took 27.8 s
     and Firefox 33.6 s on the first run. */
  test.setTimeout(90_000);

  test("Sessions you created: a refusal is reported as a refusal, and fits the row", async ({ page }) => {
    const code = await createSession(page, "E2E Refused Fac");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
        localStorage.removeItem("canamed_name");
      } catch (e) {}
    });
    await page.reload();
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 10_000 });
    await page.locator("#splash-go-my-sessions").click();
    const row = page.locator(`.my-session-row[data-code='${code}']`);
    const status = row.locator(".my-session-status");
    const closeBtn = row.locator(".my-session-close");
    await expect(row).toBeVisible();

    // ---- refused by the server ----
    await failCloseWrites(page, "refused");
    await closeBtn.dispatchEvent("click");
    await confirmModal(page);
    await expect(status, "the page must say the SERVER refused").toContainText(/server refused/i, { timeout: 10_000 });
    await expect(status, "and must not blame the connection").not.toContainText(/connection/i);
    await expect(status, "and must say what to do instead").toContainText(/dashboard/i);
    expect(await closedInDb(page, code), "the session is still open").toBeNull();
    await expect(closeBtn, "the button is usable again").toBeEnabled();
    await expect(row, "and the session stays in the list: it exists and is open").toBeVisible();

    /* The sentence is about three times as long as the one it replaces. On a
       phone it has to wrap inside the row, not widen the page. */
    const fit = await status.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const root = document.documentElement;
      return { right: r.right, width: root.clientWidth, scroll: root.scrollWidth };
    });
    expect(fit.right, "the message must end inside the viewport").toBeLessThanOrEqual(fit.width + 1);
    expect(fit.scroll, "and the page must not scroll sideways").toBeLessThanOrEqual(fit.width + 1);

    // ---- a failure that is NOT a refusal keeps the connection message ----
    await failCloseWrites(page, "transport");
    await closeBtn.dispatchEvent("click");
    await confirmModal(page);
    await expect(status).toContainText(/check your connection/i, { timeout: 10_000 });
    await expect(status).not.toContainText(/server refused/i);
    expect(await closedInDb(page, code)).toBeNull();

    // ---- the same click, let through: the session closes ----
    await letCloseWritesThrough(page);
    await closeBtn.dispatchEvent("click");
    await confirmModal(page);
    await expect.poll(() => closedInDb(page, code),
      { message: "with the write let through, the same click must close the session", timeout: 10_000 })
      .not.toBeNull();
    expect(typeof (await closedInDb(page, code)).at, "closed.at is a number in LOCAL mode").toBe("number");
    await expect(row, "and the row leaves the list").toHaveCount(0, { timeout: 5000 });
  });

  test("Sessions you created: a session ended from elsewhere is reported as already closed, not as a refusal to act on", async ({ page }) => {
    /* The list reads each session's state once, when it is drawn. A session
       ended afterwards from another device still shows "Open" here, with a
       live Close button. `closed` is write-once, so that click is refused —
       and the first version of the refusal message then told the facilitator
       to open the session with its password and end it from the dashboard. It
       had already ended. The page checks before it says anything. */
    const code = await createSession(page, "E2E Elsewhere Fac");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
        localStorage.removeItem("canamed_name");
      } catch (e) {}
    });
    await page.reload();
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 10_000 });
    await page.locator("#splash-go-my-sessions").click();
    const row = page.locator(`.my-session-row[data-code='${code}']`);
    const status = row.locator(".my-session-status");
    await expect(status, "the list has drawn the session as open").toContainText(/open/i, { timeout: 10_000 });

    /* "Another device" ends it: the marker is written straight into the
       database, behind the list's back. */
    await page.evaluate(async (c) => {
      await db.ref(oPath(sanitizeCode(c), "closed")).set({ by: "Another device", at: 1700000000000 });
    }, code);
    await expect(row.locator(".my-session-close"), "the stale row still offers Close").toBeEnabled();

    /* The write-once rule refuses a second close. LOCAL mode has no rules, so
       the refusal is supplied; the emulator suite has the real one. */
    await failCloseWrites(page, "refused");
    await row.locator(".my-session-close").dispatchEvent("click");
    await confirmModal(page);

    await expect(status, "the page must say it is already closed").toContainText(/already closed/i, { timeout: 10_000 });
    await expect(status, "and must not send the facilitator to the dashboard").not.toContainText(/password|dashboard|server refused/i);
    await expect(status).not.toContainText(/connection/i);
    await expect(row, "and the row leaves the list").toHaveCount(0, { timeout: 5000 });
    expect((await closedInDb(page, code)).by, "the first close stands, untouched").toBe("Another device");
    expect(await page.evaluate(() => getMySessions().map((s) => s.code)),
      "and it is gone from this browser's list").not.toContain(code);
  });

  test("the dashboard: a refused close no longer tells the facilitator to deploy the database rules", async ({ page }) => {
    const alerts = [];
    page.on("dialog", (d) => { alerts.push(d.message()); d.accept().catch(() => {}); });
    page.on("download", (d) => { try { d.cancel().catch(() => {}); } catch (_) {} });

    const code = await createSession(page, "E2E Refused Dash");
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
    /* The button is shown once a session has started. Starting one needs a
       second tab; the close flow itself does not, so it is un-hidden here —
       as advance-and-close.spec.js does for the same reason. */
    const endBtn = page.locator("#admin-close-btn");
    await endBtn.evaluate((b) => { b.hidden = false; });

    // ---- refused by the server ----
    await failCloseWrites(page, "refused");
    await endBtn.dispatchEvent("click");
    await confirmModal(page);
    await expect.poll(() => alerts.length, { message: "the failure must be reported", timeout: 10_000 }).toBe(1);
    expect(alerts[0], "the archive DID download, and the alert must still say so").toMatch(/archive downloaded/i);
    expect(alerts[0]).toMatch(/could NOT be marked as closed/);
    expect(alerts[0], "the actual error stays visible").toMatch(/PERMISSION_DENIED/);
    expect(alerts[0], "it is a refusal, and is called one").toMatch(/server refused/i);
    expect(alerts[0], "a facilitator does not deploy database rules").not.toMatch(/firebase deploy|rules need/i);
    expect(alerts[0], "and it is not the connection").not.toMatch(/connection/i);
    expect(alerts[0], "what to do instead").toMatch(/facilitator password/i);
    expect(await closedInDb(page, code), "the session is still open").toBeNull();
    await expect(endBtn, "the button is usable again").toBeEnabled();

    // ---- a failure that is NOT a refusal ----
    await failCloseWrites(page, "transport");
    await endBtn.dispatchEvent("click");
    await confirmModal(page);
    await expect.poll(() => alerts.length, { timeout: 10_000 }).toBe(2);
    expect(alerts[1]).toMatch(/check your connection/i);
    expect(alerts[1]).not.toMatch(/server refused/i);
    expect(await closedInDb(page, code)).toBeNull();

    // ---- the same click, let through ----
    await letCloseWritesThrough(page);
    await endBtn.dispatchEvent("click");
    await confirmModal(page);
    await expect.poll(() => closedInDb(page, code),
      { message: "with the write let through, the same click must close the session", timeout: 10_000 })
      .not.toBeNull();
    await expect(endBtn).toContainText(/Session closed/i, { timeout: 5000 });
    expect(alerts.length, "and no further alert").toBe(2);
  });
});
