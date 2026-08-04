/* tests-e2e/section-session-identity.spec.js
 *
 * THE SESSION-LEVEL HALF OF "authored content must survive becoming a section".
 *
 * #275's first three fixes were all per-SLOT: content that reaches the stage the
 * student is standing on. Two more of the same class survived, and both are
 * session-level — which is why applySectionContent(), a stage-change path, could
 * never have fixed them:
 *
 *   D1  the pre/post knowledge banks. buildSection() has always computed
 *       section.preTest / section.postTest and NOTHING read them: only
 *       applyScenario() published window.PRETEST / window.POSTTEST, and
 *       _testBank() reads only those globals. A post-S7 session pins no
 *       scenario, so loadSessionScenario() falls through to
 *       applyDefaultScenario() and every session — jaundice roleplay, sore
 *       throat, an authored case — showed the CHRONIC-PAIN check, in its
 *       un-split form.
 *
 *   D2  the section's identity. applySectionContent() publishes none of
 *       CURRENT_SCENARIO_NAME / _SUMMARY, so the lobby line, the welcome agenda,
 *       the user's session history and the facilitator ARCHIVE all said "Chronic
 *       Pain & the Opioid Request" for every session. The archive one is a
 *       research-data-integrity defect: the exported record names a case the
 *       session never ran.
 *
 * And one found while probing the same seam:
 *
 *   D3  window.CASE stays on the fallback scenario for a session with no PBL
 *       section (applySectionContent deliberately skips `c.case` when absent).
 *       No roleplay stage renders a workup, so nothing looked wrong — but the
 *       TAKE-HOME walks CASE, and handed every roleplay-only student a
 *       chronic-pain model synthesis and chronic-pain discussion prompts.
 *
 * Every assertion below is about what the STUDENT reads: the question text in
 * the knowledge-check card, the lobby line and agenda rows on screen, and the
 * markdown of the file the wrap-up hands them.
 *
 * Registered on the mobile projects too, per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Boot the room engine with the section library loaded, then pick `ids`. This is
   the same shape mixed-session-e2e.spec.js uses: the picker UI is exercised by
   section-picker.spec.js, so driving setSessionSections() directly keeps this
   spec on the resolution chain it is actually about. */
async function pickSections(page, ids) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  /* buildRoomTakeawayMarkdown moved into the lazy takehome.js (perf reclaim,
     2026-08-04). In the app it arrives with the first wrap-up download click;
     this spec calls it directly, so pull the chunk in explicitly. */
  await page.evaluate(() => window.CanamedLoader.ensureTakeHome());
  await page.waitForFunction(() => !!window.CANAMED_SECTIONS);
  await page.evaluate((csv) => {
    window.setSessionSections(csv);
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
  }, ids.join(","));
}

const bankIds = (page, sectionId, key) => page.evaluate(
  ([id, k]) => (window.CANAMED_SECTIONS[id][k] || []).map(q => q.id),
  [sectionId, key]);

/* Surface the WELCOME stage. Both the knowledge-check card and the "Today's
   structure" agenda live in #stage-0 inside #app — renderLobbyStructure() is
   named for the lobby it was written for, but paints the Welcome stage. */
async function showWelcome(page) {
  await page.evaluate(() => {
    window._test_setSessionNum("1234");
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    document.getElementById("app").classList.remove("hidden");
    document.body.classList.remove("locked");
    window._test_setViewStage(0);
    window.renderStage();
    window.renderLobbyStructure();
  });
}

test.describe("The knowledge banks belong to the picked sections", () => {
  test("a roleplay-only session's pre-test asks ITS questions, on screen", async ({ page }) => {
    await pickSections(page, ["jaundice-roleplay"]);

    /* The resolved bank first — when this is wrong the DOM assertions below all
       fail together and say nothing about which link broke. */
    const published = await page.evaluate(() => (window.PRETEST || []).map(q => q.id));
    expect(published, "the picked section's own bank must be published")
      .toEqual(await bankIds(page, "jaundice-roleplay", "preTest"));

    /* Now what a student actually reads. The card hides itself outside a room,
       and the questions only mount after Start — so drive both, then assert on
       the rendered text. */
    await page.evaluate(() => {
      window._test_setMyRoom("Room 1");
      window._test_setClientId("cid-test");
    });
    await showWelcome(page);
    const expected = await page.evaluate(() =>
      window.tc((window.PRETEST[0] || {}).q, "en"));
    const card = page.locator("#pretest-card");
    /* VISIBLE, not merely present: toContainText reads textContent and passes on
       a node no student can see. */
    await expect(card).toBeVisible();
    await page.locator("#pretest-start-btn").click();
    const body = page.locator("#pretest-body");
    await expect(body).toBeVisible();
    await expect(body).toContainText(expected);

    /* And the chronic-pain bank the fallback scenario loads must be gone. Its
       first pre-test question is the one every session used to open with. */
    const fallback = await page.evaluate(() => {
      const sc = window.CANAMED_SCENARIOS[window.CANAMED_DEFAULT_SCENARIO_ID];
      return { q1: window.tc(sc.preTest[0].q, "en"), count: sc.preTest.length };
    });
    /* Compared by TEXT, not by id: item ids are per-case (`q1` … `qN`), so both
       banks contain a "q1" and an id comparison would pass on the very bug this
       asserts against. */
    const texts = await page.evaluate(() => (window.PRETEST || []).map(q => window.tc(q.q, "en")));
    expect(texts, "the fallback scenario's questions must not survive the pick")
      .not.toContain(fallback.q1);
    expect(published.length, "nor may the un-split fallback bank be shown whole")
      .not.toBe(fallback.count);
    await expect(body, "a jaundice roleplay must not open with the chronic-pain check")
      .not.toContainText(fallback.q1);
  });

  test("two picked sections COMBINE their banks, in pick order", async ({ page }) => {
    await pickSections(page, ["chronic-pain-pbl", "chronic-pain-roleplay"]);
    const pbl = await bankIds(page, "chronic-pain-pbl", "preTest");
    const rp = await bankIds(page, "chronic-pain-roleplay", "preTest");
    expect(pbl.length, "fixture check: the PBL half must ship pre-test items").toBeGreaterThan(0);
    expect(rp.length, "fixture check: the roleplay half must ship pre-test items").toBeGreaterThan(0);
    const pre = await page.evaluate(() => (window.PRETEST || []).map(q => q.id));
    expect(pre).toEqual(pbl.concat(rp));
    /* Post-test too — it is a separate global on a separate stage, and getting
       one right while leaving the other on the default is exactly the kind of
       half-fix this file exists to catch. */
    const post = await page.evaluate(() => (window.POSTTEST || []).map(q => q.id));
    expect(post).toEqual((await bankIds(page, "chronic-pain-pbl", "postTest"))
      .concat(await bankIds(page, "chronic-pain-roleplay", "postTest")));
  });

  test("the same section picked twice does NOT ask its questions twice", async ({ page }) => {
    /* Duplicates are a supported pick (section-model decision 4), and two
       sections of ONE case legitimately carry the same item ids — the case ships
       one bank that TEST_SPLIT divides, and an authored one is not split at all.
       A student must never see a question twice on one screen. */
    await pickSections(page, ["chronic-pain-pbl", "chronic-pain-pbl"]);
    const once = await bankIds(page, "chronic-pain-pbl", "preTest");
    const pre = await page.evaluate(() => (window.PRETEST || []).map(q => q.id));
    expect(pre).toEqual(once);
    expect(new Set(pre).size, "no id may repeat").toBe(pre.length);
  });

  test("a session with NO pick keeps the scenario's banks untouched", async ({ page }) => {
    /* The other half of the contract: every pre-section session, and the window
       before section-registry.js lands, must behave exactly as it does today. */
    await page.goto("/");
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => !!window.CANAMED_SCENARIOS);
    const r = await page.evaluate(() => {
      window.setSessionSections(null);
      window.applyScenario("breaking-bad-news-disclosure");
      return {
        pre: (window.PRETEST || []).map(q => q.id),
        want: (window.CANAMED_SCENARIOS["breaking-bad-news-disclosure"].preTest || [])
          .map(q => q.id)
      };
    });
    expect(r.want.length).toBeGreaterThan(0);
    expect(r.pre).toEqual(r.want);
  });
});

test.describe("The session says which sections it runs", () => {
  /* Resolve the shipped names at runtime rather than re-typing them — a rename
     in case-content.js must not silently turn these into vacuous assertions. */
  const secName = (page, id) => page.evaluate(
    (i) => window.tc(window.CANAMED_SECTIONS[i].name, "en"), id);

  async function showLobby(page) {
    await page.evaluate(() => {
      window._test_setSessionNum("1234");
      ["splash", "app", "waiting", "admin-app"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      const lobby = document.getElementById("lobby");
      if (lobby) lobby.classList.remove("hidden");
      window.lobbyShowLockedSession();
    });
  }

  test("the lobby line names the picked section, not the fallback case", async ({ page }) => {
    await pickSections(page, ["jaundice-roleplay"]);
    await showLobby(page);
    const line = page.locator("#scenario-line-name");
    await expect(line).toBeVisible();
    await expect(line).toContainText(await secName(page, "jaundice-roleplay"));
    await expect(line, "the chronic-pain fallback must not be advertised")
      .not.toContainText(/Chronic Pain/i);
    /* A one-section session still gets its blurb — the summary is only withheld
       for a multi-section pick, where three case descriptions would not fit. */
    await expect(page.locator("#scenario-line-summary")).not.toBeEmpty();
  });

  test("a two-case session advertises BOTH, not just the first", async ({ page }) => {
    await pickSections(page, ["chronic-pain-pbl", "jaundice-roleplay"]);
    await showLobby(page);
    const line = page.locator("#scenario-line-name");
    await expect(line).toBeVisible();
    await expect(line).toContainText(await secName(page, "chronic-pain-pbl"));
    await expect(line).toContainText(await secName(page, "jaundice-roleplay"));
  });

  test("the welcome agenda has one row per picked section", async ({ page }) => {
    await pickSections(page, ["chronic-pain-pbl", "jaundice-roleplay"]);
    await showWelcome(page);
    const rows = page.locator("li[data-sec-slot]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toBeVisible();
    await expect(rows.nth(0)).toContainText(await secName(page, "chronic-pain-pbl"));
    await expect(rows.nth(1)).toContainText(await secName(page, "jaundice-roleplay"));
    /* The two hardcoded Module A / Module B rows are what used to describe a
       session that runs neither. */
    await expect(page.locator("#lobby-struct-modA")).toBeHidden();
    await expect(page.locator("#lobby-struct-modB")).toBeHidden();
    await expect(rows.nth(0), "the agenda must not name the fallback case")
      .not.toContainText(/Breaking Bad News/i);
  });

  test("the agenda falls back to Module A / Module B when nothing is picked", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => !!window.CANAMED_SCENARIOS);
    await page.evaluate(() => {
      window.setSessionSections(null);
      window.applyScenario("chronic-pain-opioids");
    });
    await showWelcome(page);
    await expect(page.locator("li[data-sec-slot]")).toHaveCount(0);
    await expect(page.locator("#lobby-struct-modA")).toBeVisible();
    await expect(page.locator("#lobby-struct-modB")).toBeVisible();
  });

  test("the archive and the session history label the SECTIONS", async ({ page }) => {
    /* These two are the research-data-integrity end of the same bug: the
       facilitator archive and the user's own history recorded a case the session
       never ran. Both read the identity globals through tc(…, "en"). */
    await pickSections(page, ["jaundice-roleplay"]);
    const r = await page.evaluate(() => ({
      name: window.tc(window.CURRENT_SCENARIO_NAME, "en"),
      id: window.CURRENT_SCENARIO_ID
    }));
    expect(r.name).toBe(await secName(page, "jaundice-roleplay"));
    expect(r.name).not.toMatch(/Chronic Pain/i);
    /* Still a stable kebab-case key a pipeline can dispatch on — it just names
       the sections now instead of a scenario nobody opened. */
    expect(r.id).toBe("jaundice-roleplay");
  });
});

test.describe("The take-home carries only the case the session ran", () => {
  const CHRONIC_SYNTH = /Clinical synthesis \(model summary\)/;

  test("a roleplay-only session's take-home has no workup content", async ({ page }) => {
    await pickSections(page, ["jaundice-roleplay"]);
    const md = await page.evaluate(() => {
      window._test_setMyRoom("Room 1");
      window._test_setSessionNum("1234");
      return window.buildRoomTakeawayMarkdown({});
    });
    /* Each of these three was previously filled from the FALLBACK scenario's
       CASE — a chronic-pain synthesis and chronic-pain discussion prompts, in a
       document handed to a student who never opened a workup board. */
    expect(md).not.toMatch(CHRONIC_SYNTH);
    expect(md).not.toContain("## Discussion guidelines");
    expect(md).not.toContain("## The case — clinical information gathered");
    expect(md, "the rest of the take-home is unaffected").toContain("## My responses");
  });

  test("a session that DOES run a workup still gets its case sections", async ({ page }) => {
    /* The regression guard: the guard above must not blank the take-home for
       the sessions the feature exists for. */
    await pickSections(page, ["chronic-pain-pbl"]);
    const md = await page.evaluate(() => {
      window._test_setMyRoom("Room 1");
      window._test_setSessionNum("1234");
      return window.buildRoomTakeawayMarkdown({});
    });
    expect(md).toContain("## The case — clinical information gathered");
    expect(md).toMatch(CHRONIC_SYNTH);
    expect(md).toContain("## Discussion guidelines");
  });
});
