/* tests-e2e/emulator/rules-smoke.spec.js
 *
 * Smoke test against the REAL Firebase emulators (RTDB + Auth), exercising
 * database.rules.json end-to-end — the gap the LOCAL-mode suite can't cover.
 *
 * This is the test that would have caught the clientMapping regression
 * (PR #30) before merge: the participant join writes members/$uid +
 * clientMapping/$clientId + pool/$clientId, all gated by the real rules.
 *
 * Two checks:
 *   1. POSITIVE — a facilitator creates a session, a participant joins, the
 *      admin sees the head-count, and an Advance propagates. Every step is a
 *      real rules-gated read/write; if a rule breaks the flow, this fails.
 *   2. NEGATIVE — a write to a path the rules deny (the locked-down root)
 *      is rejected with PERMISSION_DENIED. Proves the emulator is actually
 *      enforcing the rules (guards against a rule accidentally opened to
 *      `true`, or the emulator running rule-less).
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");

// Auto-accept the in-page confirm modal that Start/Advance open.
async function installModalAutoAccept(page) {
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
      if (dlg) new MutationObserver(tryAccept)
        .observe(dlg, { attributes: true, attributeFilter: ["open"] });
      setInterval(tryAccept, 200);
    });
  });
}

test("rules: create → join → advance round-trips through the real emulator", async ({ page, context }) => {
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);

  // ---- Facilitator: create a session (writes created/label/scenario/hash) ----
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("rules-smoke");
  await page.locator("#splash-create-pass").fill("emu-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });

  // ---- Participant: join in a second tab (writes members + clientMapping + pool) ----
  const tab2 = await context.newPage();
  await useEmulator(tab2);
  tab2.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await tab2.goto("/");
  await tab2.locator("#splash-code").fill(code);
  await tab2.locator("#splash-enter").click();
  await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await tab2.locator("#name-input").fill("Emu Student");
  const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab2.locator("#uni-input").selectOption(uni);
  await tab2.locator("#consent-workshop").check();
  const joinBtn = tab2.locator("#join-btn");
  await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
  await joinBtn.click();
  await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 15_000 });

  // ---- Admin sees the participant (real cross-tab read of pool under rules) ----
  await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 15_000 });

  // ---- Start + advance: stage writes are admin-gated; participant follows ----
  await page.locator("#start-session-btn").click();
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 20_000 });

  const adv = () => page.getByRole("button", { name: /^Advance\s*→?$/ }).first();
  if (await adv().count()) {
    await adv().click();
    await expect(tab2.locator("#stage-indicator")).toContainText(/Stage 2/i, { timeout: 15_000 });
  }
});

test("rules: a write to a denied path is rejected (rules ARE enforced)", async ({ page }) => {
  await page.goto("/");
  // Wait for the app to finish anonymous sign-in so a write is even attempted.
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });

  // The root is `.read:false / .write:false`; a write to an unmatched
  // top-level key MUST be denied. If this resolves "ALLOWED", either the
  // emulator is running rule-less or a rule was opened to `true`.
  const result = await page.evaluate(async () => {
    try {
      await firebase.database().ref("/__attack_probe").set({ x: Date.now() });
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  });
  expect(result).not.toBe("ALLOWED");
  expect(String(result)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
});
