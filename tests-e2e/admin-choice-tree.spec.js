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

  /* ── The FALLBACK, which nothing had ever rendered ─────────────────────────
   * sessionBranchedDecisions() resolves the pick first and drops to the ambient
   * globals when there is no pick to read. Both halves are exercised here, on
   * the dashboard, because the two produce very different documents and only
   * the pick half had ever been rendered in a test.
   */
  test("the branchedRef-COMPOSED fallback renders that composition's tree, not the outer case's",
    async ({ page }) => {
      /* A mixed scenario that REFERENCES a branched case (M4c). There is no
         section pick to resolve, so the tree comes from the ambient globals —
         but only the composed `br_*` nodes, never the outer A/B decisions.
         This is the one fallback branch a live session actually reaches. */
      await page.goto("/");
      await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
      await page.waitForFunction(() => !!window.CANAMED_SECTIONS &&
        !!window.CanamedBranchedRender && !!window.CanamedBranchedRuntime);
      const ids = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.CANAMED_SESSION_SECTIONS = null;
        w.applyScenario(null, {
          id: "e2e-mixed", name: { en: "E2E mixed" },
          modules: ["A", "B", "branched"],
          branchedRef: "ward-escalation-branched",
          decisions: [{ id: "dec_plan", module: "A",
                        options: [{ text: { en: "outer" }, correct: true }] }]
        });
        return w.sessionBranchedDecisions().map((d) => d && d.id);
      });
      expect(ids, "the composed nodes carry the br_ prefix the room voted under")
        .toContain("br_b_assess");
      expect(ids, "the outer A/B decision is not part of the branch tree")
        .not.toContain("dec_plan");
      const r = await buildTree(page, { br_b_assess: { committed: { choice: 0 } } });
      expect(r.built).toBe(true);
      expect(r.classes.some((c) => c.includes("correct"))).toBe(true);
    });

  test("a PICKED branched section with no graph draws NOTHING — never the ambient case's tree",
    async ({ page }) => {
      /* THE UNPROBED PATH. The pick used to be abandoned whenever it produced an
         empty list, dropping through to the ambient globals — which on a
         dashboard are whatever scenario this tab applied. Set up exactly that
         collision: a session whose pick names a branched section with no graph,
         on a tab holding ANOTHER case's composed branched nodes. Before the fix
         this rendered that other case's tree, with a ▶ "deciding now" step for a
         decision the room had never been shown. */
      await page.goto("/");
      await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
      await page.waitForFunction(() => !!window.CANAMED_SECTIONS &&
        !!window.CanamedBranchedRender && !!window.CanamedBranchedRuntime);
      const ambient = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.applyScenario(null, {
          id: "e2e-other", name: { en: "E2E other" },
          modules: ["A", "branched"],
          branchedRef: "ward-escalation-branched",
          decisions: [{ id: "dec_plan", module: "A", options: [{ text: { en: "outer" } }] }]
        });
        w.CANAMED_SECTIONS["e2e-empty-branched"] = {
          id: "e2e-empty-branched", type: "branched", name: { en: "Empty branched" },
          content: { format: "branched", decisions: [] }
        };
        w.CANAMED_SESSION_SECTIONS = ["e2e-empty-branched"];
        w.refreshModuleStages();
        return (w.DECISIONS || []).map((d) => d && d.id);
      });
      /* Pin the precondition: if the ambient globals ever stop holding another
         case's branched nodes this test would pass for the wrong reason. */
      expect(ambient, "the tab must really be holding another case's branched graph")
        .toContain("br_b_assess");
      const r = await buildTree(page, {});
      expect(r.built,
        "an empty pick is an answer — the dashboard must draw no tree").toBe(false);
    });
});
