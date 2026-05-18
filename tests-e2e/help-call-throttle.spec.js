/* tests-e2e/help-call-throttle.spec.js
 *
 * C20 (SIMULATION_EDGE_CASES.md) — help-call spam regression test.
 *
 * Before PR #90, a student who rapidly tapped "Call a facilitator" could
 * spam the facilitator's chime by toggling cancel-then-call, bypassing
 * the 30-second server-side rule via remove() (cancel) followed by a
 * fresh set() (re-call). The fix added a client-side `lastHelpCallAt`
 * throttle in initCallProf() (script.js): cancel anchors the timer too,
 * so a re-call within HELP_CALL_THROTTLE_MS (30000) is rejected with an
 * alert("Please wait Ns ...") before any DB write happens.
 *
 * This test simulates 3 rapid click cycles (call → cancel → call) on the
 * student tab and asserts:
 *   - the first call goes through (button label switches to "pending")
 *   - the cancel goes through (label resets)
 *   - the SECOND call attempt is throttled (alert is fired AND the
 *     button does NOT re-enter the pending state)
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 * Selectors: by-ID throughout.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

// ---------------------------------------------------------------------------
// Helper duplicated (minimal) from advance-and-close.spec.js so this spec
// stands alone. createSession + spawnParticipant + startSession get the
// participant to the in-room view where #call-prof-btn lives.
// ---------------------------------------------------------------------------
async function createSession(adminPage) {
  await adminPage.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    // The facilitator-ux PR (#95) replaced native confirm() in startSession
    // (and Advance / End flows) with an in-page modal (#canamed-modal opened
    // via window.canamedConfirm). The pre-existing window.confirm override
    // no longer intercepts those confirmations, so the "you have N rooms
    // but only 1 participant — start anyway?" dialog blocks the click and
    // refStarted is never written, leaving the participant in #waiting.
    // Auto-click the modal's OK button whenever it opens so the throttle
    // test reaches the in-room view (same pattern as advance-and-close.spec.js).
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
  await adminPage.locator("#splash-create-label").fill("E2E help throttle");
  await adminPage.locator("#splash-create-pass").fill("e2e-throttle-pw");
  await adminPage.locator("#splash-create-submit").click();

  const codeNode = adminPage.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();

  await adminPage.locator("#splash-go-admin").click();
  await expect(adminPage.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
  return code;
}

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

    // Intercept window.alert so we can assert it was called by the throttle
    // path. The platform's initCallProf() throttle branch fires
    // alert("Please wait Ns before ...") when a click is rejected.
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
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

async function startSession(adminPage, tab2) {
  await expect(adminPage.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });

  await adminPage.locator("#start-session-btn").click();
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });

  await adminPage.evaluate(() => {
    const prestart = document.getElementById("admin-prestart");
    const dashboard = document.getElementById("admin-dashboard");
    if (prestart) prestart.classList.add("hidden");
    if (dashboard) dashboard.classList.remove("hidden");
  });
}

test.describe("C20 — help-call spam throttle", () => {
  test("rapid 3x call/cancel cycles trigger client throttle", async ({ page, context }) => {
    const code = await createSession(page);
    const tab2 = await spawnParticipant(context, code);
    await startSession(page, tab2);

    const callBtn = tab2.locator("#call-prof-btn");
    await expect(callBtn).toBeVisible({ timeout: 10_000 });
    // initCallProf wires the click handler in wireRoomUI, which runs in
    // startRoom after the room assignment lands. On webkit on CI the
    // assignment may complete a tick AFTER #app becomes visible; wait for
    // the dataset.callState attribute (set by renderCallProf) to confirm
    // the handler is installed before we start clicking.
    await expect(callBtn).toHaveAttribute("data-call-state", "idle", { timeout: 10_000 });

    // Click 1 — call goes through (idle -> pending). { force: true }
    // prevents webkit's stability-check from waiting on minor layout
    // shifts in the surrounding card; the click handler is synchronous.
    await callBtn.click({ force: true });
    await expect(callBtn).toHaveAttribute("data-call-state", "pending", { timeout: 5_000 });

    // Click 2 — cancel goes through (pending -> idle). The cancel anchors
    // the throttle timer (see initCallProf in script.js).
    await callBtn.click({ force: true });
    await expect(callBtn).toHaveAttribute("data-call-state", "idle", { timeout: 5_000 });

    // Click 3 — immediate re-call must be throttled. The button stays
    // idle and an alert was fired by the platform.
    await callBtn.click({ force: true });
    // Give the click handler a tick to fire its throttle branch.
    await tab2.waitForTimeout(150);

    // Assert: no transition to pending happened.
    const stateAfterThirdClick = await callBtn.getAttribute("data-call-state");
    expect(stateAfterThirdClick).toBe("idle");

    // Assert: alert was raised explaining the throttle.
    const alerts = await tab2.evaluate(() => window.__alerts || []);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.some(m => /wait .* before/i.test(m))).toBe(true);

    await tab2.close();
  });
});
