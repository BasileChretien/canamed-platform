/* tests-e2e/branched-session-framing.spec.js
 *
 * The branched format reshapes the whole SESSION framing, not just in-stage
 * chrome: the lobby "Today's structure" agenda was hardcoded to the
 * chronic-pain / breaking-bad-news modules, so a branched session read as the
 * wrong (A+B) session. A branched scenario is a single-stage decision case
 * with NO Module-B / Reflection step — the session runs Welcome → the case →
 * Wrap-up (stageFlow() skips stage 2). This locks:
 *   - the lobby agenda is rendered from the ACTIVE scenario's module names;
 *   - branched → the agenda lists ONLY the case (the Module-B row is hidden);
 *   - branched → stageFlow() drops stage 2 (a 3-stage session);
 *   - standard scenarios keep their real module names + all four stages.
 */

const { test, expect } = require("./fixtures");

async function applyAndFrame(page, scenarioId) {
  await page.goto("/");
  await page.evaluate(async (id) => {
    await window.CanamedLoader.ensureCaseContent();
    window.applyScenario(id);
    window.renderLobbyStructure();
    const rm = document.getElementById("room-main");
    if (rm) rm.classList.remove("hidden");
  }, scenarioId);
}

test.describe("branched session framing", () => {
  test("branched: agenda lists only the case + the session skips stage 2", async ({
    page,
  }) => {
    await applyAndFrame(page, "ward-escalation-branched");

    // The "Today's structure" agenda reflects the branched scenario's case…
    await expect(page.locator("#lobby-struct-modA")).toContainText(
      /breathless/i,
    );
    await expect(page.locator("#lobby-struct-modA")).not.toContainText(
      /Chronic Pain/i,
    );
    // …and the Module-B / reflection agenda row is hidden (no roleplay step).
    expect(
      await page.locator("#lobby-struct-modB").evaluate((n) => n.hidden),
    ).toBe(true);

    // The reflection card was removed entirely (not merely hidden).
    expect(
      await page.evaluate(() => !!document.getElementById("branched-reflection")),
    ).toBe(false);

    // The session is a 3-stage flow: Welcome → the case → Wrap-up (no stage 2).
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 3]);
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "branched",
    );
  });

  test("standard scenario: agenda keeps its real module names + all four stages", async ({
    page,
  }) => {
    await applyAndFrame(page, "chronic-pain-opioids");

    await expect(page.locator("#lobby-struct-modA")).toContainText(
      /Chronic Pain/i,
    );
    await expect(page.locator("#lobby-struct-modB")).toContainText(
      /Breaking Bad News/i,
    );
    expect(
      await page.locator("#lobby-struct-modB").evaluate((n) => n.hidden),
    ).toBe(false);
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "standard",
    );
  });

  /* Phase M0 (ARCHITECTURE/module-set-design.md) — the dead-stage bug.
     Six navigation sites did raw arithmetic on STAGE_COUNT instead of walking
     the active flow. The worst case was silent: stepping BACK from Wrap-up in a
     branched session targeted the SKIPPED stage 2, and snapStageToFlow() rolls a
     skipped target FORWARD, landing back on Wrap-up — so "back" did nothing. */
  test("branched: stage nav never targets the skipped stage (M0 dead-stage fix)", async ({
    page,
  }) => {
    await applyAndFrame(page, "ward-escalation-branched");
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 3]);

    // Back from Wrap-up returns to the case, NOT the skipped stage 2 (and not
    // a no-op back on 3, which is what raw roomStage-1 produced).
    expect(await page.evaluate(() => window.adjacentStage(3, -1))).toBe(1);
    // Forward from the case jumps straight to Wrap-up.
    expect(await page.evaluate(() => window.adjacentStage(1, 1))).toBe(3);
    // Ends of the flow are fixed points, which is how the nav buttons disable.
    expect(await page.evaluate(() => window.adjacentStage(0, -1))).toBe(0);
    expect(await page.evaluate(() => window.adjacentStage(3, 1))).toBe(3);
    // Neither direction ever yields the skipped stage.
    const targets = await page.evaluate(() =>
      [0, 1, 3].flatMap((s) => [window.adjacentStage(s, -1), window.adjacentStage(s, 1)]),
    );
    expect(targets).not.toContain(2);

    // Documents the trap: snapStageToFlow() will NOT hand back the skipped
    // stage, which is precisely why raw ±1 arithmetic was unsafe.
    expect(await page.evaluate(() => window.snapStageToFlow(2, 3))).not.toBe(2);
  });

  test("standard: stage nav still walks all four stages (M0 regression guard)", async ({
    page,
  }) => {
    await applyAndFrame(page, "chronic-pain");
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);
    const walk = await page.evaluate(() => [
      window.adjacentStage(0, 1),
      window.adjacentStage(1, 1),
      window.adjacentStage(2, 1),
      window.adjacentStage(3, 1),
      window.adjacentStage(2, -1),
    ]);
    // Unchanged behaviour for a standard A+B session: 0→1→2→3, 3 is terminal.
    expect(walk).toEqual([1, 2, 3, 3, 1]);
  });
});
