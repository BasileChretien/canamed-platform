/* tests-e2e/modal-race.spec.js
 *
 * Regression: canamedConfirm() used to leave stale OK / Cancel
 * listeners attached if the caller fired a second prompt while the
 * first was still open. A rapid double-click on Advance or End-session
 * could then resolve TWO promises from a single user click — running
 * the action twice. Sim 2026-05-18 hit this as a flake; the fix
 * ensures the second canamedConfirm call cancels the first cleanly so
 * exactly one promise per user interaction is settled.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). The tests drive
 * canamedConfirm directly via page.evaluate — no full session flow
 * required.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("canamedConfirm double-open guard", () => {
  test("a second canamedConfirm() call cancels the first promise with false", async ({ page }) => {
    await page.goto("/");
    // Wait for the splash so canamedConfirm is wired in.
    await page.waitForFunction(() => typeof window.canamedConfirm === "function");

    // Start two confirms in rapid succession. The first one's promise
    // MUST resolve with `false` the moment the second one opens.
    const result = await page.evaluate(async () => {
      const first = window.canamedConfirm({ title: "first", message: "first" });
      // a microtask to let the modal open
      await new Promise(r => setTimeout(r, 30));
      const second = window.canamedConfirm({ title: "second", message: "second" });
      // give the second modal a moment, then accept it via the OK button
      await new Promise(r => setTimeout(r, 30));
      const ok = document.getElementById("canamed-modal-confirm");
      if (ok) ok.click();
      const [a, b] = await Promise.all([first, second]);
      return { a, b };
    });
    expect(result.a, "first prompt must resolve with false when superseded").toBe(false);
    expect(result.b, "second prompt must resolve with the user's OK click").toBe(true);
  });

  test("clicking OK on the modal resolves with true exactly once", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof window.canamedConfirm === "function");

    const result = await page.evaluate(async () => {
      let resolvedCount = 0;
      const p = window.canamedConfirm({ title: "t", message: "m" }).then(v => {
        resolvedCount++;
        return { val: v, count: resolvedCount };
      });
      await new Promise(r => setTimeout(r, 30));
      const ok = document.getElementById("canamed-modal-confirm");
      // Hammer OK several times — only the first click should count.
      if (ok) { ok.click(); ok.click(); ok.click(); }
      return await p;
    });
    expect(result.val, "OK must resolve true").toBe(true);
    expect(result.count, "promise must settle exactly once even with N clicks").toBe(1);
  });

  test("clicking Cancel resolves with false", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof window.canamedConfirm === "function");

    const result = await page.evaluate(async () => {
      const p = window.canamedConfirm({ title: "t", message: "m" });
      await new Promise(r => setTimeout(r, 30));
      const cancel = document.getElementById("canamed-modal-cancel");
      if (cancel) cancel.click();
      return await p;
    });
    expect(result).toBe(false);
  });
});
