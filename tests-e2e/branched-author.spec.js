/* tests-e2e/branched-author.spec.js
 *
 * The branched-scenario authoring editor (scenario-author.html). Switching the
 * format to "branched" swaps the standard PBL form for the node-graph editor;
 * the author wires forward "Then →" edges, and the tool emits a branched
 * scenario the runtime validator accepts. Drives the real UI end-to-end.
 */

const { test, expect } = require("./fixtures");

// Fill a node-id input then blur it, so the change handler re-renders and the
// "Then →" dropdowns pick up the new id before we wire targets.
async function setNodeId(page, node, id) {
  await node.locator('input[type="text"]').first().fill(id);
  await page.keyboard.press("Tab");
}

test.describe("branched scenario authoring", () => {
  test("author a 2-node branch tree and emit valid branched JSON", async ({
    page,
  }) => {
    await page.goto("/scenario-author.html");

    // Switch to branched: branch editor shows, the standard PBL form hides.
    await page.locator("#meta-format").selectOption("branched");
    await expect(page.locator("#branched-editor")).toBeVisible();
    await expect(page.locator("#list-decisions")).toBeHidden();

    await page.locator("#meta-id").fill("e2e-branch");
    await page
      .locator('.trio-block[data-trio="meta.name"] input')
      .first()
      .fill("E2E branch case");

    // Default state has one node; add a second.
    await page.locator("#btn-add-branched-node").click();
    const n0 = page.locator("#list-branched .dyn-row").nth(0);
    const n1 = page.locator("#list-branched .dyn-row").nth(1);

    // Name both nodes first (blurring re-renders so the dropdowns see the ids).
    await setNodeId(page, n0, "n0");
    await setNodeId(page, n1, "n1");

    // Node 0: stem + two choices; choice 0 leads to n1, choice 1 ends.
    await n0
      .locator("textarea")
      .first()
      .fill("The patient deteriorates. You first…");
    await n0
      .locator(".bn-opt")
      .nth(0)
      .locator('input[type="text"]')
      .first()
      .fill("Escalate early");
    await n0
      .locator(".bn-opt")
      .nth(0)
      .locator("textarea")
      .first()
      .fill("Help arrives quickly.");
    await n0
      .locator(".bn-opt")
      .nth(1)
      .locator('input[type="text"]')
      .first()
      .fill("Wait and see");
    await n0
      .locator(".bn-opt")
      .nth(1)
      .locator("textarea")
      .first()
      .fill("They worsen — the end.");

    // Node 1: an ending node, one choice marked best.
    await n1.locator("textarea").first().fill("Help is here. Next?");
    await n1
      .locator(".bn-opt")
      .nth(0)
      .locator('input[type="text"]')
      .first()
      .fill("Treat the cause");
    await n1
      .locator(".bn-opt")
      .nth(0)
      .locator("textarea")
      .first()
      .fill("They stabilise.");
    await n1
      .locator(".bn-opt")
      .nth(0)
      .locator('input[type="checkbox"]')
      .check();
    await n1
      .locator(".bn-opt")
      .nth(1)
      .locator('input[type="text"]')
      .first()
      .fill("Keep waiting");
    await n1
      .locator(".bn-opt")
      .nth(1)
      .locator("textarea")
      .first()
      .fill("They deteriorate.");

    // Wire the fork: node 0 choice 0 → n1.
    await n0.locator(".bn-opt").nth(0).locator("select").selectOption("n1");

    // The live JSON preview reflects the branched format + the derived gate.
    const json = await page.locator("#json-preview").inputValue();
    expect(json).toContain('"format": "branched"');

    // The validation panel reports a sound tree (no ✗ errors).
    await expect(page.locator("#branched-validation")).toContainText(
      "Valid branch tree",
    );

    // The emitted object validates and carries the reverse afterDecision gate.
    const result = await page.evaluate(() => {
      const j = window.__scenarioAuthor.toJson();
      const v = window.CanamedBranched.validateBranchedGraph(j);
      const n1 = j.decisions.find((d) => d.id === "n1");
      return {
        ok: v.ok,
        errors: v.errors,
        count: j.decisions.length,
        gate: n1 && n1.unlockWhen && n1.unlockWhen.afterDecision,
        consequence: j.decisions[0].options[0].branch.reveal.en,
      };
    });
    expect(result.ok, "errors: " + JSON.stringify(result.errors)).toBe(true);
    expect(result.count).toBe(2);
    expect(result.gate).toEqual({ id: "n0", option: 0 });
    expect(result.consequence).toBe("Help arrives quickly.");
  });

  test("a branched scenario round-trips through Load JSON", async ({
    page,
  }) => {
    await page.goto("/scenario-author.html");
    const seed = JSON.stringify({
      id: "rt-branch",
      format: "branched",
      name: { en: "RT" },
      decisions: [
        {
          id: "a",
          module: "A",
          points: 10,
          penalty: 5,
          prompt: { en: "Q?" },
          options: [
            {
              text: { en: "x" },
              correct: true,
              branch: { reveal: { en: "to b" } },
            },
            { text: { en: "y" }, branch: { reveal: { en: "end" } } },
          ],
        },
        {
          id: "b",
          module: "A",
          points: 10,
          penalty: 5,
          unlockWhen: { afterDecision: { id: "a", option: 0 } },
          hideWhenLocked: true,
          prompt: { en: "Q2?" },
          options: [
            {
              text: { en: "p" },
              correct: true,
              branch: { reveal: { en: "end p" } },
            },
            { text: { en: "q" }, branch: { reveal: { en: "end q" } } },
          ],
        },
      ],
    });
    await page.locator("#btn-load").click();
    await page.locator("#load-textarea").fill(seed);
    await page.locator("#btn-load-apply").click();

    // The form switched to branched and reconstructed the forward edge.
    await expect(page.locator("#meta-format")).toHaveValue("branched");
    const nextOfA0 = await page.evaluate(() => {
      const st = window.__scenarioAuthor.getState();
      return st.branchedNodes[0].options[0].next;
    });
    expect(nextOfA0).toBe("b");
  });
});
