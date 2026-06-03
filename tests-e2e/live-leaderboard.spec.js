/* tests-e2e/live-leaderboard.spec.js
 *
 * Regression for the "live leaderboard + goals not updating in real time"
 * facilitator-reported bug. Pre-fix, the admin dashboard rebuild was
 * debounced 400ms on every refRooms tick, so a score write could be
 * hidden behind churn (presence / typing / answers) for noticeably
 * longer than 400ms. The fix bypasses the debounce when the score
 * signature (auto / manual / penalty totals across rooms) changes —
 * score events render essentially immediately.
 *
 * What we assert here:
 *   1. After a write to `sessions/{code}/rooms/Room 1/score/auto/test1`,
 *      the admin's #dashboard reflects the new score within < 500ms.
 *   2. After a manual-points write, the same room's chip updates
 *      within < 500ms (covering the auto + manual + penalty signature).
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Writes go through
 * window.db (the LocalDB shim) so we exercise the real refRooms.on
 * subscription path the production admin uses.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Live leaderboard + dashboard update without facilitator refresh", () => {
  test("score write to a room reflects in #dashboard within 500ms", async ({ page }) => {
    // Modal-confirm auto-acceptor for any Start / End-session prompts.
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });

    // 1. Create the session via the facilitator flow.
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Live Fac");
    await page.locator("#splash-create-label").fill("Live leaderboard test");
    await page.locator("#splash-create-pass").fill("e2e-live-pw");
    await page.locator("#splash-create-submit").click();

    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    // The splash displays the code uppercase but the platform stores
    // /sessions/{code}/* under the lowercase form (sessionNum is the
    // normalized createSession() output). Pin to lowercase so the
    // direct LocalDB writes below land on the same subtree the admin's
    // refRooms / refStarted listeners are subscribed to.
    const code = (await codeNode.textContent()).trim().toLowerCase();

    // 2. Open admin dashboard.
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible();

    // 3. Force the session into "started" so #admin-dashboard renders and
    //    the refRooms listener begins ticking. We do this via the LocalDB
    //    directly to avoid the start-button modal flow (covered by
    //    stage-progression.spec.js). Seed Room 1 so refRooms has something
    //    to render before the started flip.
    await page.evaluate((sessionCode) => {
      const db = window.db;
      // sessions/{code}/rooms/Room 1 with a minimal stage so renderDashboard
      // doesn't trip on an undefined stage.
      db.ref("sessions/" + sessionCode + "/rooms/Room 1").set({ stage: 0 });
      db.ref("sessions/" + sessionCode + "/started").set(true);
    }, code);

    // 4. Wait for the admin dashboard panel to be visible (the started
    //    listener toggles its hidden class).
    await expect(page.locator("#admin-dashboard")).toBeVisible({ timeout: 10_000 });
    // And for the initial dashboard render to have produced at least one
    // .dash-room block.
    await expect(page.locator("#dashboard .dash-room").first()).toBeVisible({ timeout: 10_000 });

    // 5. ASSERT the bug fix: write an auto score and the dashboard chip
    //    must reflect it within 500ms. Pre-fix the 400ms debounce alone
    //    would barely fit; under any presence / typing churn it would
    //    miss. Post-fix the debounce is bypassed when the score signature
    //    changes, so the render is essentially synchronous.
    const tWriteStart = Date.now();
    await page.evaluate((sessionCode) => {
      window.db.ref(
        "sessions/" + sessionCode + "/rooms/Room 1/score/auto/test_live_event"
      ).set({ points: 77, at: Date.now() });
    }, code);

    // The score line in the dashboard is `.dash-score` inside the
    // .dash-room block. Wait for "77" to appear in that text.
    const room1Score = page.locator("#dashboard .dash-room").first().locator(".dash-score");
    await expect(room1Score).toContainText("77", { timeout: 500 });
    const elapsed = Date.now() - tWriteStart;
    expect(elapsed).toBeLessThan(500);

    // 6. Second write: a penalty changes the signature too. Assert the
    //    chip updates fast for the auto + penalty composite. Pre-fix
    //    this would also have been debounced.
    const tPenStart = Date.now();
    await page.evaluate((sessionCode) => {
      window.db.ref(
        "sessions/" + sessionCode + "/rooms/Room 1/score/penalties/test_pen"
      ).set({ points: 5, at: Date.now() });
    }, code);
    // After the penalty (−5) the room total is 72.
    await expect(room1Score).toContainText("72", { timeout: 500 });
    expect(Date.now() - tPenStart).toBeLessThan(500);
  });

  test("cohort leaderboard 'Together' total updates within 500ms of a score write", async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });

    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Together Fac");
    await page.locator("#splash-create-label").fill("Together leaderboard test");
    await page.locator("#splash-create-pass").fill("e2e-together-pw");
    await page.locator("#splash-create-submit").click();

    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    // Splash displays uppercase, /sessions/{code}/* is stored lowercase.
    // See the comment in the first spec for the rationale.
    const code = (await codeNode.textContent()).trim().toLowerCase();

    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible();

    // Seed two rooms with zero score, flip started so #leaderboard
    // renders. The admin's renderLeaderboard runs inside the same
    // (now-bypassed-on-score) debounced batch.
    await page.evaluate((sessionCode) => {
      const base = "sessions/" + sessionCode + "/rooms/";
      window.db.ref(base + "Room 1").set({ stage: 0 });
      window.db.ref(base + "Room 2").set({ stage: 0 });
      window.db.ref("sessions/" + sessionCode + "/started").set(true);
    }, code);

    await expect(page.locator("#admin-dashboard")).toBeVisible({ timeout: 10_000 });
    // Wait for the leaderboard 'Together' header to render once.
    const togetherHead = page.locator("#leaderboard .lb-shared-head");
    await expect(togetherHead).toContainText("0 /", { timeout: 10_000 });

    // Write a score; assert the 'Together' total updates within 500ms.
    const t0 = Date.now();
    await page.evaluate((sessionCode) => {
      window.db.ref(
        "sessions/" + sessionCode + "/rooms/Room 2/score/auto/together_test"
      ).set({ points: 33, at: Date.now() });
    }, code);
    await expect(togetherHead).toContainText("33 /", { timeout: 500 });
    expect(Date.now() - t0).toBeLessThan(500);

    // The room that just scored gets a one-shot "bumped" highlight so the live
    // update is VISIBLE, not silent (2026-06-03: "the score doesn't feel like it
    // updates live"). Room 2 (0 → 33) is the only room that went up.
    const bumped = page.locator("#leaderboard .lb-row.lb-bumped");
    await expect(bumped).toHaveCount(1, { timeout: 1000 });
    await expect(bumped).toContainText("Room 2");
  });
});
