/* tests-e2e/modb-exchange-answers.spec.js
 *
 * Session-3 facilitator ask (2026-05-27): "For Module B, when there are the
 * prompts, the students shall be able to enter them." The Phase-3 exchange
 * prompts were display-only; they now carry a per-prompt answer box that
 * autosaves to rooms/$room/moduleB/exchangeReplies/$cursor/$cid (mirrors
 * Module A's prompt-reply).
 *
 * Driven via the LOCAL fallback (no Firebase): setModBPhase /
 * setModBExchangeCursor mutate state + re-render synchronously, and
 * _test_setModBExchangeReplies injects saved notes to exercise the restore
 * path. Listed in the mobile testMatch in playwright.config.js (per-device).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setupExchange(page) {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-1", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    if (window.initModBPhaseNav) window.initModBPhaseNav();
    if (window.setModBPhase) window.setModBPhase(2);          // exchange phase
    if (window.setModBExchangeCursor) window.setModBExchangeCursor(0);
  });
}

test.describe("Module B — Phase-3 prompt answer entry", () => {
  test("the answer box is present and editable on a prompt", async ({ page }) => {
    await setupExchange(page);
    const ta = page.locator("#modB-exchange-reply");
    await expect(ta).toBeVisible();
    await ta.fill("In France the patient is told first; in Japan the family is often told first.");
    await expect(ta).toHaveValue(/patient is told first/);
  });

  test("the answer box is hidden on the done screen", async ({ page }) => {
    await setupExchange(page);
    await page.evaluate(() => window.setModBExchangeCursor(6)); // past the last prompt → done
    await expect(page.locator("#modB-exchange-done")).toBeVisible();
    await expect(page.locator("#modB-exchange-reply-area")).toBeHidden();
  });

  test("a saved note is restored for its own prompt and is per-prompt", async ({ page }) => {
    await setupExchange(page);
    await page.evaluate(() => {
      window._test_setModBExchangeReplies({
        0: { teamA: { text: "Q1 note: who is told first", by: "Ami", cid: "teamA", at: Date.now() } },
        1: { teamA: { text: "Q2 note: norms changed", by: "Ami", cid: "teamA", at: Date.now() } }
      });
      window.setModBExchangeCursor(0);
    });
    await expect(page.locator("#modB-exchange-reply")).toHaveValue(/who is told first/);
    // Moving to the next prompt shows that prompt's own saved note, not q1's.
    await page.evaluate(() => window.setModBExchangeCursor(1));
    await expect(page.locator("#modB-exchange-reply")).toHaveValue(/norms changed/);
    // A prompt with no saved note shows an empty box.
    await page.evaluate(() => window.setModBExchangeCursor(2));
    await expect(page.locator("#modB-exchange-reply")).toHaveValue("");
  });

  test("the newest note across the room wins on display", async ({ page }) => {
    await setupExchange(page);
    await page.evaluate(() => {
      window._test_setModBExchangeReplies({
        0: {
          older: { text: "earlier draft", by: "A", cid: "older", at: 1000 },
          newer: { text: "the latest edit", by: "B", cid: "newer", at: 9000 }
        }
      });
      window.setModBExchangeCursor(0);
    });
    await expect(page.locator("#modB-exchange-reply")).toHaveValue("the latest edit");
  });
});
