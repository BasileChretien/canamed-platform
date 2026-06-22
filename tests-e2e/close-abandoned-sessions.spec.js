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
    // Confirmation is now the branded in-page modal (canamedConfirm), NOT a
    // native window.confirm — so a stray native dialog here signals a
    // regression. Fail loudly rather than silently auto-accepting it.
    page.on("dialog", (d) => {
      try { d.dismiss(); } catch (_) {}
      throw new Error("unexpected native dialog: close-session must use the in-page modal");
    });

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

    // Click Close → the branded in-page modal opens (NOT a native confirm).
    await row.locator(".my-session-close").dispatchEvent("click");
    const modal = page.locator("#canamed-modal");
    await expect(modal, "close must open the in-page modal").toBeVisible({ timeout: 5000 });
    // The session code is surfaced in the modal's monospace detail block.
    await expect(modal.locator("#canamed-modal-detail")).toHaveText(code);
    await modal.locator("#canamed-modal-confirm").dispatchEvent("click");

    // After the write the row should be removed from the list; the local
    // tracker should no longer contain this code; and the DB should have
    // the closed marker.
    await expect(row, "row must disappear after close").toHaveCount(0, { timeout: 5000 });
    const cleanedList = await page.evaluate(() => getMySessions().map(s => s.code));
    expect(cleanedList, "closed session must be removed from local tracker").not.toContain(code);

    const dbClosed = await page.evaluate(async (c) => {
      // Read via the SAME canonical (lower-case) key the close-write uses —
      // sessions live under sanitizeCode(code), not the upper-cased display
      // form. oPath adds the current org prefix.
      const snap = await db.ref(oPath(sanitizeCode(c), "closed")).once("value");
      return snap.val();
    }, code);
    expect(dbClosed, "DB must have a closed marker after the click").not.toBeNull();
    expect(typeof dbClosed.at, "closed.at must be a number").toBe("number");
  });

  test("'Close session' uses the in-page modal — cancel aborts without writing or freezing", async ({ page }) => {
    // Regression: the Close button used to call native window.confirm(),
    // which Chrome suppresses ("don't allow this page to create more dialogs")
    // after a couple of prompts — turning the button into a silent no-op — and
    // which freezes automation. It must use the branded in-page modal, and
    // Cancel must leave the session OPEN.
    let nativeDialogFired = false;
    page.on("dialog", (d) => { nativeDialogFired = true; try { d.dismiss(); } catch (_) {} });

    // Create a real session so a (mistaken) write would be observable.
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Cancel Fac");
    await page.locator("#splash-create-label").fill("E2E cancel workshop");
    await page.locator("#splash-create-pass").fill("e2e-cancel-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

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

    // Click Close → modal opens. Cancel it.
    await row.locator(".my-session-close").dispatchEvent("click");
    const modal = page.locator("#canamed-modal");
    await expect(modal, "close must open the in-page modal").toBeVisible({ timeout: 5000 });
    await modal.locator("#canamed-modal-cancel").dispatchEvent("click");
    await expect(modal, "cancel must close the modal").toBeHidden({ timeout: 5000 });

    // Cancel must NOT have used a native dialog, NOT written the closed
    // marker, and NOT removed the row — the Close button stays actionable.
    expect(nativeDialogFired, "must not use a native window.confirm").toBe(false);
    await expect(row, "row stays after cancel").toBeVisible();
    await expect(row.locator(".my-session-close")).toHaveText(/close session/i);
    const stillTracked = await page.evaluate(() => getMySessions().map(s => s.code));
    expect(stillTracked, "session stays tracked after cancel").toContain(code);
    const dbClosed = await page.evaluate(async (c) => {
      const snap = await db.ref(oPath(c, "closed")).once("value");
      return snap.val();
    }, code);
    expect(dbClosed, "cancel must NOT write a closed marker").toBeNull();
  });

  test("a session already marked closed in the DB is auto-pruned from the list", async ({ page }) => {
    // We don't need a real session here — just seed both sides of the
    // pruning logic and trigger a re-render.
    await page.goto("/");
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await page.evaluate(async () => {
      addMySession("ABC-DEF", "Was finished elsewhere");
      // Pre-write the closed marker as if another tab had ended this — at the
      // canonical lower-case key the session actually lives under.
      await db.ref(oPath(sanitizeCode("ABC-DEF"), "closed")).set({ by: "Other admin", at: Date.now() });
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

  test("a tracked session that no longer exists on the server is flagged 'ended' + auto-pruned", async ({ page }) => {
    // Regression for the real-world report: sessions a facilitator created
    // days ago had been removed from the DB by the retention policy, but the
    // local tracker still listed them as "Open". Clicking Close then failed
    // with PERMISSION_DENIED (the close rule requires the session's
    // adminPasswordHash to exist) and surfaced a misleading "check your
    // connection" error. Now the list detects the missing session (no `closed`
    // marker AND no adminPasswordHash) and flags it as ended + auto-prunes.
    await page.goto("/");
    await page.evaluate(() => {
      // Track a session that was never created in the DB (no closed, no hash).
      addMySession("ZZZ-999", "ghost workshop");
      paintMySessionsLink();
    });
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 5000 });
    await page.locator("#splash-go-my-sessions").click();

    const row = page.locator(".my-session-row[data-code='ZZZ-999']");
    // Status flips to "ended / no longer on the server" and Close is disabled.
    await expect(row.locator(".my-session-status")).toHaveText(
      /ended|no longer on the server/i, { timeout: 5000 }
    );
    await expect(row.locator(".my-session-close")).toBeDisabled();
    // Then it auto-prunes, just like an already-closed session.
    await expect(page.locator(".my-session-row")).toHaveCount(0, { timeout: 5000 });
    const tracked = await page.evaluate(() => getMySessions().map(s => s.code));
    expect(tracked).not.toContain("ZZZ-999");
  });

  test("a Close that fails because the session is gone shows an honest message + removes it", async ({ page }) => {
    // The reactive safety net: if a session is purged between render and click
    // (so its Close button was still enabled), the write is rejected. Instead
    // of "check your connection", closeMySession probes whether the session
    // still exists and — finding it gone — drops the stale entry with an
    // honest message. Driven directly here because the proactive check above
    // would otherwise disable Close before it can be clicked.
    await page.goto("/");
    const out = await page.evaluate(async () => {
      const code = "QQQ-111";
      addMySession(code, "ghost");
      // Auto-confirm the in-page modal (canamedConfirm is a global function).
      window.canamedConfirm = () => Promise.resolve(true);
      // Force ONLY the closed-WRITE to reject (like production
      // PERMISSION_DENIED), while keeping reads (.once) working so the
      // sessionStatus() existence probe still resolves — it returns
      // exists:false for this never-created session.
      const realRef = db.ref.bind(db);
      // closeMySession writes to the canonical lower-case key, so intercept
      // that exact path.
      const closedPath = oPath(sanitizeCode(code), "closed");
      db.ref = (p) => {
        const r = realRef(p);
        if (p === closedPath) { r.set = () => Promise.reject(new Error("PERMISSION_DENIED")); }
        return r;
      };
      const btn = document.createElement("button");
      const statusEl = document.createElement("p");
      closeMySession(code, btn, statusEl);
      // Wait for the rejection → adminPasswordHash probe → removal to settle.
      await new Promise((r) => setTimeout(r, 1600));
      const res = {
        status: statusEl.textContent,
        tracked: getMySessions().map((s) => s.code).includes(code)
      };
      db.ref = realRef; // restore
      return res;
    });
    expect(out.status, "honest 'already ended' message, not a connection error")
      .toMatch(/already ended/i);
    expect(out.tracked, "the dead session must be removed from the tracker").toBe(false);
  });

  test("an UPPER-cased tracker entry resolves to the real lower-case session and closes it", async ({ page }) => {
    // Direct regression for the casing bug behind "I still cannot close the
    // sessions". Session codes are generated + joined in lower case, so the
    // session lives at sessions/<lower>/… — but the tracker stored the code
    // upper-cased, so Close targeted sessions/<UPPER>/… (which never exists)
    // and the write was rejected with PERMISSION_DENIED. The status + close
    // must canonicalise to the lower-case key.
    await page.goto("/");
    page.on("dialog", (d) => {
      try { d.dismiss(); } catch (_) {}
      throw new Error("unexpected native dialog: close-session must use the in-page modal");
    });
    await page.evaluate(async () => {
      // Seed a real, open session at the LOWER-case key (as createSession does).
      await db.ref(oPath("low-er1", "created")).set({ by: "Fac", at: Date.now() });
      await db.ref(oPath("low-er1", "adminPasswordHash")).set("a".repeat(64));
      // Track it the way the buggy flow did — UPPER-cased.
      addMySession("LOW-ER1", "case mismatch");
      paintMySessionsLink();
    });
    await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 5000 });
    await page.locator("#splash-go-my-sessions").click();

    // It must read as OPEN (resolving the lower-case session), not "ended".
    const row = page.locator(".my-session-row[data-code='LOW-ER1']");
    await expect(row.locator(".my-session-status")).toHaveText(/open/i, { timeout: 5000 });
    const closeBtn = row.locator(".my-session-close");
    await expect(closeBtn).toBeEnabled();

    await closeBtn.click();
    const modal = page.locator("#canamed-modal");
    await expect(modal, "close must open the in-page modal").toBeVisible({ timeout: 5000 });
    await modal.locator("#canamed-modal-confirm").dispatchEvent("click");

    // The row clears AND the closed marker lands at the LOWER-case key.
    await expect(row, "row must disappear after a successful close").toHaveCount(0, { timeout: 5000 });
    const closedLower = await page.evaluate(async () =>
      (await db.ref(oPath("low-er1", "closed")).once("value")).val());
    expect(closedLower, "closed marker must be written at the lower-case key").not.toBeNull();
  });
});
