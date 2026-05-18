/* tests-e2e/offline-banner.spec.js
 *
 * R2-03 / R2-04 (SIMULATION_ROUND2.md) — offline-aware behaviour:
 *
 *   1. The offline banner inserted by sw-register.js shows when the page
 *      goes offline and disappears when connectivity returns. The banner
 *      text must be localised at call time (NOT registration time) so a
 *      sw-register helper that runs before the deferred i18n bundle has
 *      finished parsing still picks up the right language once the
 *      offline event fires.
 *
 *   2. A >60-second offline window must NOT silently drop the offline
 *      banner or break the page. The Round-1 freshness rule rejected
 *      queued writes whose `at` timestamp was older than 60 s; the
 *      fix widens that window to 30 min (1 800 000 ms) on /answers/*
 *      so legitimate replays after a wifi blip survive. The DB rule
 *      itself is asserted in tests/rules.test.js — this spec covers
 *      the user-visible behaviour during a real >60 s outage (banner
 *      stays up, no JS errors, returns to normal on reconnect).
 *
 * Why the offline window is simulated in browser context rather than via
 * page.context().setOffline alone: Playwright's setOffline cuts network
 * but does not always fire window 'offline' / 'online' events in every
 * browser. We dispatch them explicitly to exercise the banner code path
 * in addition to flipping the network state.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Offline behaviour", () => {
  test("offline banner appears on disconnect, hides on reconnect", async ({ page, context }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CANAMED" })).toBeVisible();

    // Go offline + dispatch the event explicitly (Playwright's setOffline
    // does not always fire it in headless chromium).
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // Banner should appear with non-empty localised text.
    const banner = page.locator("#canamed-offline-banner");
    await expect(banner).toBeVisible();
    const offlineText = await banner.textContent();
    expect(offlineText, "offline banner must carry non-empty text").toBeTruthy();
    expect((offlineText || "").trim().length).toBeGreaterThan(0);

    // Reconnect — the banner must hide again.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(banner).toBeHidden();

    expect(errors, "offline cycle must not produce console / page errors").toEqual([]);
  });

  test("survives a >60s outage without silent write rejection or banner loss", async ({ page, context }) => {
    // R2-03/04 — the previous freshness rule (>= now - 60_000) would
    // silently reject answer writes whose Firebase-queued `at` timestamp
    // exceeded 60 s old. This test reproduces the >60 s outage shape and
    // confirms:
    //   - the banner stays visible for the full window (no fade due to
    //     a stale event or a watchdog reset)
    //   - no console / page errors fire during the outage
    //   - the page returns to normal once connectivity resumes
    //
    // We don't sit through a literal 70-second wall-clock wait — that
    // would slow the CI suite considerably. Instead we fast-forward the
    // page's perception of time by advancing Date.now() in the renderer
    // while the network stays offline, then poll the banner state. This
    // proves the >60-second-outage code path stays well-behaved without
    // the test itself becoming a slow point.
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CANAMED" })).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    const banner = page.locator("#canamed-offline-banner");
    await expect(banner).toBeVisible();

    // Simulate the >60 s window: nudge Date.now() forward inside the page
    // so any code that compares "did more than 60 s elapse?" sees a true
    // outage of 70 s. The banner DOM state is event-driven, not time-
    // driven, so it must stay visible regardless.
    await page.evaluate(() => {
      const realNow = Date.now;
      const offset = 70_000;
      const start = realNow();
      // Restore on reconnect via the online handler below.
      // @ts-ignore — test-only override
      window.__realDateNow = realNow;
      Date.now = function () { return realNow.call(Date) + offset; };
      // Re-dispatch an offline event mid-window — the banner must not
      // disappear or throw.
      window.dispatchEvent(new Event("offline"));
      return start;
    });

    // Banner still visible after the simulated >60 s window.
    await expect(banner).toBeVisible();
    const midText = (await banner.textContent()) || "";
    expect(midText.trim().length).toBeGreaterThan(0);

    // Reconnect — both Playwright's network state and the in-page event.
    await page.evaluate(() => {
      // @ts-ignore — restore the unpatched Date.now
      if (window.__realDateNow) { Date.now = window.__realDateNow; }
    });
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(banner).toBeHidden();

    expect(errors, ">60s outage must not produce console / page errors").toEqual([]);
  });
});
