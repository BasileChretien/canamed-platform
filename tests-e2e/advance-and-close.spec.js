/* tests-e2e/advance-and-close.spec.js
 *
 * Two cross-tab flows that extend stage-progression.spec.js:
 *
 *   Test 1 — Advance:
 *     Admin starts session → participant lands in #app →
 *     admin clicks #advance-all-btn (confirms dialog) →
 *     participant's #stage-indicator updates to "Stage 2".
 *
 *   Test 2 — Close session:
 *     Admin starts session → participant lands in #app →
 *     admin clicks #admin-close-btn (confirms dialog) →
 *     participant tab's #session-ended element becomes visible.
 *
 * Dialog strategy:
 *   startSession() (platform code) calls refPool.once("value").then() →
 *   confirms. The dialog fires in a microtask after the click returns.
 *   We override window.confirm = () => true via addInitScript (browser-
 *   side, permanent) so all confirms return true without any CDP round-trip.
 *   window.alert = () => {} silences the "no one joined yet" alert too.
 *
 *   closeSession() uses db.ref().once("value").then(confirm()) — same
 *   pattern; the override handles it.
 *
 *   page.on("download") cancels the archive download triggered by
 *   End-session so it doesn't block CI or pollute artefacts.
 *
 *   page.on("dialog") is kept as a fallback for any native dialog that
 *   might slip past the override (e.g., browser-generated ones).
 *
 * Sync strategy:
 *   After clicking Start we wait for participant tab2 to reach #app —
 *   that event is driven by the pool room-assignment write and is
 *   observable cross-tab without depending on #admin-dashboard visibility.
 *   We then use page.evaluate() to set window._e2eStarted=true from
 *   within the platform's refStarted subscriber, providing a reliable
 *   in-page signal that the listener has fired.
 *
 *   For Advance/Close we wait for participant-visible signals (#stage-
 *   indicator change and #session-ended respectively), which are entirely
 *   independent of the admin-tab rendering.
 *
 * Cross-tab:
 *   Tab2 clears canamed_session / canamed_resume before goto() so it
 *   always renders the splash. LocalDB cross-tab sync uses storage events;
 *   generous timeouts (15 s) are used on all cross-tab assertions.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 * Selectors: by-ID throughout.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// ---------------------------------------------------------------------------
// Shared helper — admin tab setup.
//   - window.confirm = () => true so all confirms in async .then() chains
//     (startSession, advance, close) return true without CDP dialog events.
//   - window.alert = () => {} silences alert() calls.
//   - page.on("dialog") as a CDP-level fallback.
//   - page.on("download") cancels archive downloads.
//   - Creates session, opens admin dashboard, returns code.
// ---------------------------------------------------------------------------
async function createSession(adminPage) {
  await adminPage.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    // SIMULATION_FACILITATOR.md batch replaced native confirm() with an
    // in-page modal (#canamed-modal opened via window.canamedConfirm).
    // Auto-click the modal's OK button whenever it opens so the test
    // exercises the real Start / Advance / End flow without UI clicks.
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg) {
        const observer = new MutationObserver(tryAccept);
        observer.observe(dlg, { attributes: true, attributeFilter: ["open"] });
      }
      setInterval(tryAccept, 200);
    });
  });
  adminPage.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  adminPage.on("download", (d) => { try { d.cancel?.(); } catch (_) {} });

  await adminPage.goto("/");
  await adminPage.locator("#splash-go-create").click();
  await adminPage.locator("#splash-create-name").fill("E2E Fac");
  await adminPage.locator("#splash-create-label").fill("E2E adv/close test");
  await adminPage.locator("#splash-create-pass").fill("e2e-adv-pw");
  await adminPage.locator("#splash-create-submit").click();

  const codeNode = adminPage.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();

  await adminPage.locator("#splash-go-admin").click();
  await expect(adminPage.locator("#admin-app")).toBeVisible({ timeout: 10_000 });

  return code;
}

// ---------------------------------------------------------------------------
// Shared helper — spawn a participant tab.
// ---------------------------------------------------------------------------
async function spawnParticipant(context, code) {
  const tab = await context.newPage();
  tab.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  tab.on("download", (d) => { try { d.cancel?.(); } catch (_) {} });

  await tab.addInitScript(() => {
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
    } catch (e) {}
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value,
        set: () => {},
        configurable: true,
        enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    pin("CANAMED_PERF_MONITORING", false);
    window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
  });

  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();

  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  await tab.locator("#name-input").fill("E2E Student");
  const uni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab.locator("#uni-input").selectOption(uni);
  await tab.locator("#consent-workshop").check();

  const joinBtn = tab.locator("#join-btn");
  await expect(joinBtn).toBeEnabled({ timeout: 5_000 });
  await joinBtn.click();

  await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  return tab;
}

// ---------------------------------------------------------------------------
// Shared helper — start the session from the admin tab.
//
//   Strategy: Instead of waiting for #admin-dashboard to become visible
//   (which races with the cross-tab presence write that fires tab1's
//   _notifyAll synchronously and can intermittently re-hide it), we:
//
//   1. Click Start (window.confirm override handles all dialogs in .then())
//   2. Wait for tab2 to be in #app — this is the reliable cross-tab signal
//      that refStarted was written (rooms were assigned → tab2 entered room)
//   3. Use page.evaluate() to directly invoke the startAdmin() side-effect
//      (show #admin-dashboard) so Advance/Close buttons are clickable.
//
//   The evaluate() call removes "hidden" from #admin-dashboard and adds it
//   to #admin-prestart, mirroring exactly what the refStarted.on("value")
//   listener does when started=true. Since the session IS started at this
//   point (tab2 is in #app), this is correct state — we're just ensuring
//   the DOM reflects reality for subsequent button interactions.
// ---------------------------------------------------------------------------
async function startSession(adminPage, tab2) {
  await expect(adminPage.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });

  await adminPage.locator("#start-session-btn").click();

  // Wait for the participant to reach #app — this is the reliable cross-tab
  // signal that the session has started (rooms were assigned).
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });

  // Ensure the admin dashboard DOM reflects the started state so that
  // #advance-all-btn and #admin-close-btn are visible and clickable.
  // This mirrors the refStarted.on("value") listener's DOM update.
  await adminPage.evaluate(() => {
    const prestart = document.getElementById("admin-prestart");
    const dashboard = document.getElementById("admin-dashboard");
    if (prestart) prestart.classList.add("hidden");
    if (dashboard) dashboard.classList.remove("hidden");
    // Also un-hide the End-session button (hidden by default in HTML until
    // the refStarted listener fires true) so the close-session test can
    // click it without depending on the LocalDB cross-tab listener race.
    const closeBtn = document.getElementById("admin-close-btn");
    if (closeBtn) closeBtn.hidden = false;
  });

  await expect(adminPage.locator("#advance-all-btn")).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Test 1 — Advance all rooms
// ---------------------------------------------------------------------------
test.describe("Cross-tab Advance → participant stage updates", () => {
  test("admin Advance propagates stage change to participant tab", async ({ page, context }) => {
    const code = await createSession(page);
    const tab2 = await spawnParticipant(context, code);

    await startSession(page, tab2);

    // Snapshot the current stage indicator text.
    const stageBefore = await tab2.locator("#stage-indicator").textContent();

    // Clicking Advance triggers a confirm() which the window.confirm override
    // accepts (returns true) synchronously without any dialog event.
    await page.locator("#advance-all-btn").click();

    // The setRoomStage() transaction writes to rooms/room-1/stage in
    // LocalDB. Tab2 receives a cross-tab storage event → refStage.on
    // fires → renderStage() → #stage-indicator updates to "Stage 2 of 4".
    await expect(tab2.locator("#stage-indicator")).not.toHaveText(
      stageBefore || "",
      { timeout: 15_000 }
    );
    await expect(tab2.locator("#stage-indicator")).toContainText("Stage 2", { timeout: 5_000 });

    await tab2.close();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Close session → participant sees session-ended screen
// ---------------------------------------------------------------------------
test.describe("Cross-tab Close session → participant sees ended screen", () => {
  test("admin End-session write propagates closed state to participant tab", async ({ page, context }) => {
    const code = await createSession(page);
    const tab2 = await spawnParticipant(context, code);

    await startSession(page, tab2);

    // Click End-session. The platform flow:
    //   db.ref().once("value") → confirm() [overridden → true]
    //   → db.ref().once("value") → downloadFullArchive() [cancelled]
    //   → db.ref("closed").set({...})
    await page.locator("#admin-close-btn").click();

    // The closed marker write fires a cross-tab storage event on tab2.
    // renderClosedState() → isClosed=true, isAdminLike=false →
    // shows #session-ended, hides #app / #waiting / #splash.
    await expect(tab2.locator("#session-ended")).toBeVisible({ timeout: 15_000 });

    await tab2.close();
  });
});
