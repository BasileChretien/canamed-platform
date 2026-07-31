/* tests-e2e/admin-choice-tree.spec.js
 *
 * The facilitator dashboard's per-room BRANCHED CHOICE TREE (.room-choice-tree),
 * for a session whose branched case came from a SECTION PICK.
 *
 * Why this spec exists. buildRoomChoiceTree() used to read the ambient
 * CURRENT_SCENARIO_FORMAT / DECISIONS globals. Those are published by
 * applySectionContent(), which hangs off refreshActiveSlotState() — a
 * STAGE-CHANGE path. The facilitator dashboard never enters a room, so on that
 * tab it never runs: the admin saw format "standard" and the DEFAULT scenario's
 * decisions, and the tree silently rendered NOTHING for every section-picked
 * branched session. It now resolves the graph from the session's own pick via
 * sessionBranchedDecisions().
 *
 * The unit tests cover that resolution as a pure function; they do not render
 * the dashboard. This spec renders it, on every viewport, per the standing
 * per-device rule — the basename is registered in the three mobile testMatch
 * regexes in playwright.config.js.
 *
 * LOCAL mode, no room or Firebase needed: the tree is a pure read of a room
 * snapshot, so it is built directly from a synthetic votes map — the same
 * lightweight approach branched-format.spec.js uses.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Put the page in the state a facilitator dashboard is actually in: the section
   library loaded, a session whose `sections` CSV names the branched section, and
   — deliberately — NO applySectionContent() ever having run, exactly as on a tab
   that never entered a room. */
async function asDashboardOfPickedBranchedSession(page) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => !!window.CANAMED_SECTIONS &&
    !!window.CanamedBranchedRender && !!window.CanamedBranchedRuntime);
  return page.evaluate(() => {
    // The session's write-once pick, as applySessionSections() would publish it.
    window.CANAMED_SESSION_SECTIONS = ["ward-escalation-branched"];
    // The admin tab's globals still describe whatever loaded by default. Assert
    // that, so this test keeps reproducing the ORIGINAL failing condition rather
    // than quietly starting to pass for the wrong reason.
    return {
      ambientFormat: window.CURRENT_SCENARIO_FORMAT || "standard",
      ambientDecisionIds: (Array.isArray(window.DECISIONS) ? window.DECISIONS : [])
        .map(d => d && d.id)
    };
  });
}

function buildTree(page, votes) {
  return page.evaluate((v) => {
    const tree = window.CanamedBranchedRender.buildRoomChoiceTree({ votes: v }, "en");
    if (!tree) return { built: false };
    return {
      built: true,
      classes: Array.from(tree.querySelectorAll(".ct-step")).map(s => s.className),
      text: tree.textContent
    };
  }, votes);
}

test.describe("Admin dashboard — branched choice tree for a PICKED section", () => {
  test("a committed step renders green, plus the node being decided now", async ({ page }) => {
    const ambient = await asDashboardOfPickedBranchedSession(page);
    /* The precondition that made this fail: the dashboard's own globals are NOT
       the branched case. If this ever stops being true the test still passes,
       but it would no longer be testing the admin path — so pin it. */
    expect(ambient.ambientFormat,
      "the dashboard tab must NOT have the branched scenario applied").not.toBe("branched");
    expect(ambient.ambientDecisionIds,
      "…nor the branched case's decisions in the ambient globals").not.toContain("b_assess");

    /* A standalone branched pick keeps RAW decision ids — the ids ARE the vote
       keys, so a room's ballots are stored under b_assess, not s1_b_assess. */
    const r = await buildTree(page, { b_assess: { committed: { choice: 0 } } });
    expect(r.built, "the tree must resolve from the PICK, not the ambient globals").toBe(true);
    expect(r.classes.some(c => c.includes("correct"))).toBe(true);
    expect(r.classes.some(c => c.includes("ct-active"))).toBe(true);
    expect(r.classes.some(c => c.includes("wrong"))).toBe(false);
  });

  test("a wrong-then-correct path renders red, green and an ending", async ({ page }) => {
    await asDashboardOfPickedBranchedSession(page);
    const r = await buildTree(page, {
      b_assess: { committed: { choice: 1 } },
      b_deteriorate: { committed: { choice: 0 } }
    });
    expect(r.built).toBe(true);
    expect(r.classes.some(c => c.includes("wrong"))).toBe(true);
    expect(r.classes.some(c => c.includes("correct"))).toBe(true);
    expect(r.classes.some(c => c.includes("ct-done"))).toBe(true);
    expect(r.text).toMatch(/Reached an ending/i);
  });

  test("a room that has voted on nothing shows the entry node, not an empty tree", async ({ page }) => {
    await asDashboardOfPickedBranchedSession(page);
    const r = await buildTree(page, {});
    expect(r.built).toBe(true);
    expect(r.classes.some(c => c.includes("ct-active")),
      "an un-started room must still show WHERE it is").toBe(true);
  });

  test("a session with NO branched section draws no tree at all", async ({ page }) => {
    /* The predicate replaced the old format guard, so it has to stay negative
       for an ordinary PBL/roleplay session — otherwise every dashboard grows a
       meaningless empty tree. */
    await page.goto("/");
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => !!window.CANAMED_SECTIONS && !!window.CanamedBranchedRender);
    await page.evaluate(() => {
      window.CANAMED_SESSION_SECTIONS = ["chronic-pain-pbl", "sore-throat-roleplay"];
    });
    const r = await buildTree(page, {});
    expect(r.built).toBe(false);
  });
});
