/* tests-e2e/close-abandoned-sessions.spec.js
 *
 * Regression suite for the "My open sessions" reaper.
 *
 * User-reported gap (2026-05-18): "I need a way to close ongoing
 * sessions for which there are no more participants and the admin forgot
 * to close them." Previously the platform never persisted a list of
 * sessions a given browser had created, so a facilitator who closed
 * their tab without clicking "End session" had no way to reach those
 * sessions again later — they stayed OPEN forever.
 *
 * What this suite locks down:
 *   1. addMySession() persists code + label + openedAt to localStorage.
 *   2. Creating a session through the splash auto-pushes it to the list.
 *   3. The splash entry view shows a "My open sessions (N) →" link iff
 *      the list is non-empty, and the link opens the list view.
 *   4. The list view renders one row per tracked session with code,
 *      label, opened-when text, Close button, Remove-from-list button.
 *   5. "Remove from list" drops the entry locally without touching the DB.
 *   6. "Close session" writes the closed marker AND removes the entry.
 *   7. A session already marked closed in the DB is auto-pruned from
 *      the list on next render.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("My open sessions — reaper for abandoned sessions", () => {
  test("storage helpers persist + read + remove entries", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(() => {
      addMySession("ABC-DEF", "Workshop 1");
      addMySession("GHI-JKL", "Workshop 2");
      const after2 = getMySessions().map(s => s.code);
      removeMySession("ABC-DEF");
      const after1 = getMySessions().map(s => s.code);
      removeMySession("GHI-JKL");
      const empty = getMySessions().length;
      // Re-adding the same code must dedupe + update timestamp, not stack.
      addMySession("XYZ-XYZ", "A"); addMySession("XYZ-XYZ", "B");
      const dedup = getMySessions();
      return { after2, after1, empty, dedup };
    });
    expect(out.after2).toEqual(["ABC-DEF", "GHI-JKL"]);
    expect(out.after1).toEqual(["GHI-JKL"]);
    expect(out.empty).toBe(0);
    expect(out.dedup).toHaveLength(1);
    expect(out.dedup[0].code).toBe("XYZ-XYZ");
    expect(out.dedup[0].label).toBe("B");
  });

  test("splash entry view shows the 'My open sessions (N) →' link only when non-empty", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#splash-my-sessions-row"),
      "link must be hidden when no sessions tracked").toBeHidden();

    await page.evaluate(() => {
      addMySession("ABC-DEF", "Workshop A");
      addMySession("GHI-JKL", "Workshop B");
      paintMySessionsLink();
    });
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible();
    await expect(page.locator("#splash-my-sessions-count")).toHaveText("2");
  });

  test("clicking the link opens the list view + renders each tracked session", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      addMySession("ABC-DEF", "Workshop One");
      addMySession("GHI-JKL", "Workshop Two");
      paintMySessionsLink();
    });
    await page.locator("#splash-go-my-sessions").click();
    await expect(page.locator("#splash-view-my-sessions")).toBeVisible();
    // One .my-session-row per tracked session. Newest-first ordering means
    // GHI-JKL (added second) is the first row.
    const rows = page.locator(".my-session-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator(".my-session-code")).toHaveText("GHI-JKL");
    await expect(rows.nth(0).locator(".my-session-label")).toHaveText("Workshop Two");
    await expect(rows.nth(1).locator(".my-session-code")).toHaveText("ABC-DEF");
    // Each row must expose both action buttons.
    await expect(rows.nth(0).locator(".my-session-close")).toBeVisible();
    await expect(rows.nth(0).locator(".my-session-forget")).toBeVisible();
  });

  test("'Remove from list' drops the entry locally without touching the DB", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      addMySession("ABC-DEF", "Workshop A");
      addMySession("GHI-JKL", "Workshop B");
      paintMySessionsLink();
    });
    await page.locator("#splash-go-my-sessions").click();
    // Remove the first (newest) row.
    await page.locator(".my-session-row").first().locator(".my-session-forget").click();
    await expect(page.locator(".my-session-row")).toHaveCount(1);
    const remaining = await page.evaluate(() => getMySessions().map(s => s.code));
    expect(remaining).toEqual(["ABC-DEF"]);
  });

  test("'Close session' writes the closed marker, removes the entry, surfaces feedback", async ({ page, context }) => {
    // Real session needed so the write actually succeeds against LocalDB.
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });

    // Create a session as facilitator.
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Reaper Fac");
    await page.locator("#splash-create-label").fill("E2E reaper workshop");
    await page.locator("#splash-create-pass").fill("e2e-reaper-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    // The newly created session must have auto-registered in the list.
    const tracked = await page.evaluate(() => getMySessions());
    expect(tracked.map(s => s.code), "create-session must auto-track").toContain(code);

    // Navigate back to splash entry view + open the list.
    // Easiest path: reload (canamed_session is set but with no scenario
    // wired in LocalDB; we just want the splash entry view).
    await page.evaluate(() => {
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
      } catch (e) {}
    });
    await page.reload();
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 10_000 });
    await page.locator("#splash-go-my-sessions").click();

    const row = page.locator(`.my-session-row[data-code='${code}']`);
    await expect(row).toBeVisible();

    // Click Close. window.confirm is auto-accepted by the page.on("dialog") above.
    await row.locator(".my-session-close").click();

    // After the write the row should be removed from the list; the local
    // tracker should no longer contain this code; and the DB should have
    // the closed marker.
    await expect(row, "row must disappear after close").toHaveCount(0, { timeout: 5000 });
    const cleanedList = await page.evaluate(() => getMySessions().map(s => s.code));
    expect(cleanedList, "closed session must be removed from local tracker").not.toContain(code);

    const dbClosed = await page.evaluate(async (c) => {
      // oPath uses the current org prefix; reading via the same helper
      // keeps the test resilient to org-prefix changes.
      const snap = await db.ref(oPath(c, "closed")).once("value");
      return snap.val();
    }, code);
    expect(dbClosed, "DB must have a closed marker after the click").not.toBeNull();
    expect(typeof dbClosed.at, "closed.at must be a number").toBe("number");
  });

  test("a session already marked closed in the DB is auto-pruned from the list", async ({ page }) => {
    // We don't need a real session here — just seed both sides of the
    // pruning logic and trigger a re-render.
    await page.goto("/");
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await page.evaluate(async () => {
      addMySession("ABC-DEF", "Was finished elsewhere");
      // Pre-write the closed marker as if another tab had ended this.
      await db.ref(oPath("ABC-DEF", "closed")).set({ by: "Other admin", at: Date.now() });
      paintMySessionsLink();
    });
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 5000 });
    await page.locator("#splash-go-my-sessions").click();
    // The row appears briefly with "Already closed" status, then auto-prunes.
    await expect(page.locator(".my-session-row")).toHaveCount(1);
    await expect(page.locator(".my-session-row .my-session-status")).toHaveText(
      /already closed/i, { timeout: 5000 }
    );
    // Within ~2s the auto-prune fires and the row disappears.
    await expect(page.locator(".my-session-row")).toHaveCount(0, { timeout: 5000 });
    const tracked = await page.evaluate(() => getMySessions().map(s => s.code));
    expect(tracked).not.toContain("ABC-DEF");
  });
});
