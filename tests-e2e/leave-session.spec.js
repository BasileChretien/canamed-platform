/* tests-e2e/leave-session.spec.js
 *
 * Regression: user reported (2026-05-18) that once connected to a session
 * in a browser, it is not possible to disconnect from it. This suite
 * exercises every Leave path the platform exposes:
 *
 *   1. From the LOBBY (after the splash unlocks but before joining).
 *   2. From the WAITING ROOM (joined but not yet placed in a room).
 *   3. From the ROOM VIEW (placed in a room by the admin).
 *
 * After clicking Leave, the test asserts:
 *   - the participant lands back on the splash (#splash visible),
 *   - localStorage.canamed_resume is cleared,
 *   - reloading the page does NOT auto-rejoin into the previous session
 *     (this is the "really disconnected" guarantee).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Per-device viewports are
 * driven by playwright.config.js projects (chromium, firefox, webkit,
 * mobile-iphone, mobile-ipad, mobile-android) — Playwright re-runs each
 * test across every project, so a failure on mobile-iphone alone is
 * caught here without per-test viewport plumbing.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function dismissTours(page) {
  // Even with the localStorage flags set, a tour can occasionally render
  // mid-test if a code path resets the marker. Belt-and-braces: dismiss
  // anything that looks like an overlay so it can't sit on top of the
  // Leave button and eat the click.
  await page.evaluate(() => {
    document.querySelectorAll(".tour, .joyride, [data-tour], .shepherd-element").forEach(e => e.remove());
  });
}

async function setupSessionAndJoin(page, context, opts) {
  const clearTabStorage = !(opts && opts.preserveTabStorage);
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  // Auto-accept the in-page modal (canamedConfirm) used by Start/Advance.
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
      if (dlg) new MutationObserver(tryAccept).observe(dlg, { attributes: true, attributeFilter: ["open"] });
      setInterval(tryAccept, 200);
    });
  });

  // Tab 1: facilitator creates session.
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Leave Fac");
  await page.locator("#splash-create-label").fill("E2E leave button");
  await page.locator("#splash-create-pass").fill("e2e-leave-pw");
  await page.locator("#splash-create-submit").click();
  // Wait for the shown-code to actually populate (it starts as a placeholder
  // dash). textContent() alone does NOT wait — match the working pattern in
  // stage-progression.spec.js.
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible();

  // Tab 2: participant joins.
  const tab2 = await context.newPage();
  tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await tab2.addInitScript((shouldClear) => {
    if (shouldClear) {
      // Default for waiting/room flows: nuke any inherited canamed_*
      // storage from the admin context's cookies/localStorage so tab2 sees
      // a clean splash. The "preserveTabStorage" override skips this for
      // tests that need to seed their own resume/session state.
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
      } catch (e) {}
    }
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true, enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
  }, clearTabStorage);
  return { tab2, code, adminPage: page };
}

test.describe("Leave button — participant can always disconnect", () => {
  test("leave from WAITING ROOM clears resume + returns to splash + survives reload", async ({ page, context }) => {
    const { tab2, code } = await setupSessionAndJoin(page, context);
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();

    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    await tab2.locator("#name-input").fill("E2E Student WAIT");
    const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab2.locator("#uni-input").selectOption(uni);
    await tab2.locator("#consent-workshop").check();
    await tab2.locator("#join-btn").click();
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

    // Sanity: resume data was written.
    const resumeBefore = await tab2.evaluate(() => localStorage.getItem("canamed_resume"));
    expect(resumeBefore, "joinParticipant must save resume").toBeTruthy();

    // Click Leave in the waiting room.
    await dismissTours(tab2);
    const leaveBtn = tab2.locator("#waiting-leave");
    await expect(leaveBtn).toBeVisible();
    await expect(leaveBtn).toBeEnabled();
    await leaveBtn.click();

    // After leaveAndReload(): splash visible, resume cleared.
    await expect(tab2.locator("#splash")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#waiting")).toBeHidden();
    const resumeAfter = await tab2.evaluate(() => localStorage.getItem("canamed_resume"));
    expect(resumeAfter, "Leave must clear canamed_resume").toBeNull();

    // Hard reload must NOT auto-rejoin (this is the user's complaint).
    await tab2.reload();
    await expect(tab2.locator("#splash")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#waiting")).toBeHidden();
    await expect(tab2.locator("#app")).toBeHidden();

    await tab2.close();
  });

  test("leave from ROOM VIEW clears resume + returns to splash + survives reload", async ({ page, context }) => {
    const { tab2, code, adminPage } = await setupSessionAndJoin(page, context);
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    await tab2.locator("#name-input").fill("E2E Student ROOM");
    const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab2.locator("#uni-input").selectOption(uni);
    await tab2.locator("#consent-workshop").check();
    await tab2.locator("#join-btn").click();
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

    // Admin Starts → participant moves to #app.
    await expect(adminPage.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
    await adminPage.locator("#start-session-btn").click();
    await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });

    await dismissTours(tab2);
    const leaveBtn = tab2.locator("#leave-btn");
    await expect(leaveBtn, "Leave button must exist in room view for participants").toBeVisible();
    await expect(leaveBtn).toBeEnabled();
    await leaveBtn.click();

    // Splash visible, app hidden, resume cleared.
    await expect(tab2.locator("#splash")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#app")).toBeHidden();
    const resumeAfter = await tab2.evaluate(() => localStorage.getItem("canamed_resume"));
    expect(resumeAfter, "Leave must clear canamed_resume").toBeNull();

    // Hard reload must NOT auto-rejoin (user-reported regression).
    await tab2.reload();
    await expect(tab2.locator("#splash")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#app")).toBeHidden();
    await expect(tab2.locator("#waiting")).toBeHidden();

    await tab2.close();
  });
});

test.describe("Splash has a visible 'start fresh' affordance when a saved session exists", () => {
  // Even without clicking Leave (e.g. the user just closed the tab), the
  // splash must NOT silently auto-rejoin and must let the user pick a
  // different session OR explicitly clear the saved one.
  test("the lobby exposes a way to clear a saved session and not auto-rejoin", async ({ page, context }) => {
    // First create a real session so the stored code is valid (otherwise
    // initEntry sees stale canamed_session and shows splash without lobby).
    const { tab2, code } = await setupSessionAndJoin(page, context, { preserveTabStorage: true });
    // First navigate to seed localStorage from a same-origin context, THEN
    // reload so initEntry runs against the seeded state. We deliberately
    // do NOT use addInitScript here because that fires on the reload too
    // and would re-seed after switchSession clears it.
    await tab2.goto("/");
    await tab2.evaluate((c) => {
      localStorage.setItem("canamed_session", c);
      localStorage.setItem("canamed_resume", JSON.stringify({
        sessionNum: c, name: "Saved User",
        university: "caen", year: 4, english: "C1",
        consent: { workshop: true, research: false, version: 1, at: Date.now() }
      }));
    }, code);
    await tab2.reload();

    // Lobby renders (#name-input lives inside #lobby).
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    // The "← Use a different session" escape hatch must be visible + tappable.
    const lobbyBtn = tab2.locator("#lobby-switch-session-btn");
    await expect(lobbyBtn,
      "lobby must show a 'switch session' button when arriving via stored session"
    ).toBeVisible({ timeout: 10_000 });
    await expect(lobbyBtn).toBeEnabled();

    // Click it → must clear saved data + reload to a clean splash.
    await lobbyBtn.click();
    await expect(tab2.locator("#splash")).toBeVisible({ timeout: 10_000 });
    await expect(tab2.locator("#lobby")).toBeHidden();
    const cleared = await tab2.evaluate(() => ({
      resume: localStorage.getItem("canamed_resume"),
      name: localStorage.getItem("canamed_name"),
      session: localStorage.getItem("canamed_session")
    }));
    expect(cleared.resume,  "switch must clear canamed_resume").toBeNull();
    expect(cleared.name,    "switch must clear canamed_name").toBeNull();
    expect(cleared.session, "switch must clear canamed_session").toBeNull();

    await tab2.close();
  });

  test("splash banner appears + works when only resume data is stored", async ({ page }) => {
    // Only canamed_resume — no canamed_session — so initEntry() falls through
    // to showSplash() instead of auto-routing to the lobby. The splash banner
    // must then surface the saved name + code and offer the clear button.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("canamed_resume", JSON.stringify({
        sessionNum: "PREV-SESS", name: "Saved User",
        university: "caen", year: 4, english: "C1",
        consent: { workshop: true, research: false, version: 1, at: Date.now() }
      }));
      localStorage.removeItem("canamed_session");
    });
    await page.reload();
    await expect(page.locator("#splash")).toBeVisible({ timeout: 10_000 });

    const banner = page.locator("#splash-saved-session");
    await expect(banner, "splash must show the saved-session banner when resume data exists")
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#splash-saved-session-name")).toHaveText("Saved User");
    await expect(page.locator("#splash-saved-session-code")).toHaveText("PREV-SESS");

    const clearBtn = page.locator("#splash-saved-session-clear");
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeEnabled();
    await clearBtn.click();

    await expect(page.locator("#splash")).toBeVisible({ timeout: 10_000 });
    await expect(banner).toBeHidden();
    const resume = await page.evaluate(() => localStorage.getItem("canamed_resume"));
    expect(resume, "clear must remove canamed_resume").toBeNull();
  });
});
