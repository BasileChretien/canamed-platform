/* tests-e2e/branched-session-framing.spec.js
 *
 * The branched format must reshape the whole SESSION framing, not just hide
 * in-stage chrome: the lobby "Today's structure" agenda was hardcoded to the
 * chronic-pain / breaking-bad-news modules, so a branched session read as the
 * wrong (A+B) session. This locks:
 *   - the lobby agenda is rendered from the ACTIVE scenario's module names;
 *   - branched → the agenda reads as a decision case + reflection, not A+B;
 *   - standard scenarios keep their real module names (regression);
 *   - Stage 2 in a branched session shows the Reflection card (not an empty
 *     Module-B roleplay stage).
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
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
  }, scenarioId);
}

const disp = (page, sel) =>
  page.evaluate((s) => {
    const n = document.querySelector(s);
    return n ? getComputedStyle(n).display : "absent";
  }, sel);

test.describe("branched session framing", () => {
  test("branched: lobby agenda + reflection stage match the scenario, not chronic-pain", async ({
    page,
  }) => {
    await applyAndFrame(page, "ward-escalation-branched");

    // The "Today's structure" agenda reflects the branched scenario.
    await expect(page.locator("#lobby-struct-modA")).toContainText(
      /breathless/i,
    );
    await expect(page.locator("#lobby-struct-modA")).not.toContainText(
      /Chronic Pain/i,
    );
    await expect(page.locator("#lobby-struct-modB")).toContainText(
      /Reflection/i,
    );
    await expect(page.locator("#lobby-struct-modB")).not.toContainText(
      /Breaking Bad News/i,
    );

    // Stage 2 shows the Reflection card; the empty Module-B decision columns are gone.
    expect(await disp(page, "#branched-reflection")).not.toBe("none");
    expect(await disp(page, "#stage-2 .columns")).toBe("none");
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "branched",
    );
  });

  test("standard scenario: agenda keeps its real module names, no reflection card", async ({
    page,
  }) => {
    await applyAndFrame(page, "chronic-pain-opioids");

    await expect(page.locator("#lobby-struct-modA")).toContainText(
      /Chronic Pain/i,
    );
    await expect(page.locator("#lobby-struct-modB")).toContainText(
      /Breaking Bad News/i,
    );
    // The Reflection card stays hidden in a standard session.
    expect(await disp(page, "#branched-reflection")).toBe("none");
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "standard",
    );
  });
});
