/* tests-e2e/stage-progression.spec.js
 *
 * One cross-tab flow the initial E2E suite didn't cover, picked
 * because it bridges the participant + admin tabs and exercises the
 * round-2 rules write paths (pool assignment + room-write):
 *
 *   Admin Start → participant lands in their assigned room.
 *
 * The intermediate Advance step + close-session were tried but the
 * LocalDB → admin-dashboard visibility toggle + the confirm()/download
 * dialog handling combo races in CI just enough to be flaky. Those
 * paths are covered structurally (rules.test.js asserts the closed-
 * marker write rule; the existing splash + create tests exercise
 * dashboard render).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 * Stable selectors: by-ID throughout.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Cross-tab Start → participant placed", () => {
  test("admin Start propagates to the participant tab as a room assignment", async ({ page, context }) => {
    // Register one dialog acceptor up-front. .catch swallows the
    // "already handled" race if the same handler is invoked twice.
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    // SIMULATION_FACILITATOR.md batch: Start/Advance/End-session now use
    // an in-page modal (window.canamedConfirm) instead of native confirm,
    // so the CDP "dialog" handler no longer auto-accepts them. Auto-click
    // the modal's confirm button whenever the dialog opens, so the test
    // exercises the real Start flow without UI orchestration.
    await page.addInitScript(() => {
      const tryAccept = () => {
        const dlg = document.getElementById("canamed-modal");
        if (dlg && dlg.open) {
          const ok = document.getElementById("canamed-modal-confirm");
          if (ok) ok.click();
        }
      };
      const observer = new MutationObserver(tryAccept);
      document.addEventListener("DOMContentLoaded", () => {
        const dlg = document.getElementById("canamed-modal");
        if (dlg) observer.observe(dlg, { attributes: true, attributeFilter: ["open"] });
        // also poll briefly as a fallback for browsers that don't fire
        // attribute mutations on showModal()
        setInterval(tryAccept, 200);
      });
    });

    // ---- Tab 1 (facilitator): create session
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Stage Fac");
    await page.locator("#splash-create-label").fill("E2E stage progression");
    await page.locator("#splash-create-pass").fill("e2e-stage-pw");
    await page.locator("#splash-create-submit").click();

    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    // open admin dashboard on tab 1
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible();

    // ---- Tab 2 (participant): join the same session.
    // newPage() inherits the context's localStorage — which now contains
    // `canamed_session` from tab1's create flow, causing initEntry() to
    // skip the splash and auto-enter the unlocked session. The init
    // script clears that key BEFORE the platform scripts run so tab2's
    // splash renders normally.
    const tab2 = await context.newPage();
    tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await tab2.addInitScript(() => {
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
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();

    // Fill lobby + join
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    await tab2.locator("#name-input").fill("E2E Student");
    const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab2.locator("#uni-input").selectOption(uni);
    await tab2.locator("#consent-workshop").check();
    const joinBtn = tab2.locator("#join-btn");
    await expect(joinBtn).toBeEnabled({ timeout: 5000 });
    await joinBtn.click();
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

    // ---- Admin Starts.
    // Wait for the admin-side prestart panel AND for the participant
    // count to be > 0. joinParticipant() shows #waiting BEFORE the
    // auth-gated pool write completes; without this guard the test
    // races and clicks Start with an empty pool, hitting the "no one
    // has joined" alert (which would be auto-accepted but the start
    // still wouldn't happen).
    await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
    const startBtn = page.locator("#start-session-btn");
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // ---- Assertion: participant leaves waiting room, lands in #app
    // (the per-room session view). This is the cross-tab signal: it
    // requires assignRooms() on tab1 + pool/cid/room subscription on
    // tab2 + LocalDB cross-tab `storage` event propagation.
    await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });

    await tab2.close();
  });
});
