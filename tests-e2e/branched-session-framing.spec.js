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
});
