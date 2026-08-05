/* tests-e2e/answers-bucket-routing.spec.js
 *
 * WHICH BUCKET DOES A SECTION'S WORK LAND IN — AND DOES THE CONSUMER READ THE
 * SAME ONE?
 *
 * Since S6 (#259) a participant's answers are written to
 *   rooms/<room>/answers/sections/<slot>/<entryId>
 * and the slot is chosen by the STAGE ON SCREEN (refreshActiveSlotState →
 * pointSectionRefs points all three refAnswers.module* at the active slot's
 * ref). The three retired module-literal nodes — answers/moduleA, moduleB,
 * moduleBranched — are no longer written by anything.
 *
 * The WRITE half of that was covered. The READ half was not: a consumer that
 * still addresses answers/moduleA gets `undefined`, renders an empty section,
 * and reports nothing wrong. That is the same silent-substitution failure as
 * #275 (a roleplay-only session handing students the chronic-pain model
 * answers) — data attributed to the wrong place, no error anywhere.
 *
 * This spec drives the REAL UI of a REAL mixed session (facilitator tab +
 * student tab, LOCAL cross-tab LocalDB): pick two sections of different types,
 * write one answer in each through the on-screen form, then assert
 *   1. the DB routed each entry to ITS OWN slot bucket (and to no other);
 *   2. the take-home the student actually DOWNLOADS contains both;
 *   3. the facilitator dashboard's participation funnel + impact counters see
 *      them.
 *
 * Assertion 2 reads the downloaded file, not an in-page object: a populated
 * bucket proves nothing if the document the student receives is empty.
 *
 * Registered on the mobile projects too (playwright.config.js testMatch), per
 * the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures");

/* Two sections of DIFFERENT types, so the two writes must land in two
   different slots. chronic-pain-pbl is slot 1 (stage 1), jaundice-roleplay is
   slot 2 (stage 2). */
const PICK = ["chronic-pain-pbl", "jaundice-roleplay"];

const A_TEXT = "Slot-1 PBL answer — mechanical low back pain, no red flags";
const B_TEXT = "Slot-2 roleplay answer — I would ask the parent what they want to know";
/* Used by the same-type test, where BOTH slots are PBL. */
const C_TEXT = "Slot-2 PBL answer — obstructive jaundice, image the biliary tree";

/* Pin LOCAL mode on a manually-spawned page (the fixture only auto-pins the
   primary `page`; the student tab is a context.newPage()). */
async function pinLocal(p) {
  await p.addInitScript(() => {
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value,
        set: () => {},
        configurable: true,
        enumerable: true,
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    try {
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      localStorage.setItem("canamed_tour_student_done", "v1");
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
    } catch (e) {}
    window.confirm = () => true;
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    setInterval(tryAccept, 150);
  });
}

/* The room subtree as the DB actually holds it — read through the app's own
   db handle, so this is the same snapshot every consumer receives. */
async function roomSnapshot(tab) {
  return tab.evaluate(() =>
    window.db
      .ref(window.sPath("rooms/" + window.myRoom))
      .once("value")
      .then((s) => s.val() || {}));
}

/* Facilitator creates a session on the given section picks; returns the code. */
async function createSession(page, picks) {
  await pinLocal(page);
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Facilitator");
  await page.locator("#splash-create-label").fill("Routing probe");
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  await page.evaluate((ids) => {
    // @ts-ignore — splash globals
    splashSectionPick.length = 0;
    // @ts-ignore
    ids.forEach((i) => splashSectionPick.push(i));
    // @ts-ignore
    renderSectionPick();
  }, picks);
  await page.locator("#splash-create-pass").fill("e2e-pass-2026");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/[A-Z0-9]{3}-?[A-Z0-9]{3}/i, { timeout: 15_000 });
  return (await codeNode.textContent()).trim();
}

/* One participant joins that session and waits in the lobby. */
async function joinStudent(context, code) {
  const stu = await context.newPage();
  await pinLocal(stu);
  await stu.goto("/");
  await stu.locator("#splash-code").fill(code);
  await stu.locator("#splash-enter").click();
  await expect(stu.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await stu.locator("#name-input").fill("E2E Student");
  const uni = await stu
    .locator("#uni-input option:not([disabled])")
    .first()
    .getAttribute("value");
  await stu.locator("#uni-input").selectOption(uni);
  await stu.locator("#consent-workshop").check();
  /* Research consent: without it the participant is (correctly) excluded from
     every research_*.csv, and the export assertions below would pass on an
     empty file for the wrong reason. */
  await stu.locator("#consent-research").check();
  await expect(stu.locator("#join-btn")).toBeEnabled({ timeout: 5_000 });
  await stu.locator("#join-btn").click();
  await expect(stu.locator("#waiting")).toBeVisible({ timeout: 15_000 });
  return stu;
}

/* Facilitator opens the dashboard and starts the session. */
async function startSession(page, stu) {
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  await page.locator("#start-session-btn").click();
  await expect(stu.locator("#app")).toBeVisible({ timeout: 20_000 });
}

/* Type into one of the room's text inputs and submit it the way the form
 * supports, then wait for the app's OWN success signal.
 *
 * Enter rather than the adjacent Add button: both run the same handler
 * (initHypotheses' submit / addAnswer), but on the touch projects a tap on the
 * button was intermittently swallowed — the input kept its text, nothing was
 * written, and the failure surfaced ten seconds later as "the answers tab never
 * revealed", which is not what went wrong. Both writers clear the input only
 * once the push RESOLVES, so an empty box is the app telling us the write
 * landed; assert that before asserting anything downstream of it.
 */
async function submitInto(tab, selector, text) {
  const input = tab.locator(selector);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(text);
  await input.press("Enter");
  await expect(input, "the app clears the box when the write resolves")
    .toHaveValue("", { timeout: 10_000 });
}

/* Write one Module-A answer through the on-screen form. The merged
   "Debate & answers" tab reveals on the ≥1-hypothesis gate, so cross it the way
   a student does: open the collapsed hypotheses section, type one, press Add. */
async function writeModuleAAnswer(stu, hypothesis, text) {
  /* Two PBL slots share the stage-1 DOM, so the <details> may already be open
     from the previous section — clicking it again would CLOSE it. */
  const details = stu.locator("#chart-hypotheses");
  if (!(await details.evaluate((n) => /** @type {any} */ (n).open))) {
    await stu.locator("#chart-hypotheses > summary").click();
  }
  await submitInto(stu, "#hypothesis-input", hypothesis);
  /* The gate is ≥1 hypothesis: assert the student can SEE theirs before waiting
     on the tab it unlocks. */
  await expect(stu.locator("#hypothesis-list")).toContainText(hypothesis, { timeout: 10_000 });
  await expect(stu.locator("#hypothesis-list")).toBeVisible();
  await expect(stu.locator("#rcol-tab-answers")).toBeVisible({ timeout: 15_000 });
  await stu.locator("#rcol-tab-answers").click();
  await submitInto(stu, "#answer-input-moduleA-diagnosis", text);
  /* What the student SEES — the entry is in the visible list, not merely in
     some object a test could read. */
  await expect(stu.locator("#answers-list-moduleA-diagnosis")).toContainText(text, {
    timeout: 10_000,
  });
  await expect(stu.locator("#answers-list-moduleA-diagnosis")).toBeVisible();
}

test.describe("answers bucket routing — a section's work lands in its own slot", () => {
  test("a mixed session routes each section's answers to its own slot, and every consumer reads them back", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    const code = await createSession(page, PICK);
    const stu = await joinStudent(context, code);
    await startSession(page, stu);

    // ── Facilitator advances into section 1 ─────────────────────────────────
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 2", { timeout: 20_000 });

    // ── SECTION 1 (PBL) — write one answer through the real form ────────────
    await writeModuleAAnswer(stu, "mechanical low back pain", A_TEXT);

    // ── SECTION 2 (roleplay) — advance a stage, write one answer there ──────
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 3", { timeout: 20_000 });
    // The exchange card lives in phase 3 ("exchange"); walk the phase nav there.
    await stu.locator("#modB-phase-next").click();
    await stu.locator("#modB-phase-next").click();
    await submitInto(stu, "#answer-input-moduleB-family-sentence", B_TEXT);
    await expect(stu.locator("#answers-list-moduleB-family-sentence")).toContainText(B_TEXT, {
      timeout: 10_000,
    });
    await expect(stu.locator("#answers-list-moduleB-family-sentence")).toBeVisible();

    // ── 1. THE WRITE PATH: each entry in its own slot, and nowhere else ─────
    const snap = await roomSnapshot(stu);
    const buckets = snap.answers || {};
    const slotTexts = (slot) =>
      Object.values((buckets.sections || {})[slot] || {}).map((e) => (e || {}).text);
    expect(slotTexts("1"), "section 1's answer must be in slot 1").toContain(A_TEXT);
    expect(slotTexts("2"), "section 2's answer must be in slot 2").toContain(B_TEXT);
    expect(slotTexts("1"), "slot 1 must not carry section 2's answer").not.toContain(B_TEXT);
    expect(slotTexts("2"), "slot 2 must not carry section 1's answer").not.toContain(A_TEXT);
    /* The retired module-literal nodes must stay unwritten — if one of them
       filled up, the write path silently regressed to the pre-S6 address. */
    expect(buckets.moduleA, "answers/moduleA is retired").toBeFalsy();
    expect(buckets.moduleB, "answers/moduleB is retired").toBeFalsy();
    expect(buckets.moduleBranched, "answers/moduleBranched is retired").toBeFalsy();

    // ── 2. THE READ PATH: the file the student actually downloads ───────────
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 4", { timeout: 20_000 });
    const dlBtn = stu.locator("#wrapup-download-btn");
    await expect(dlBtn).toBeVisible({ timeout: 15_000 });
    const [download] = await Promise.all([
      stu.waitForEvent("download", { timeout: 30_000 }),
      dlBtn.click(),
    ]);
    const fs = require("node:fs");
    const md = fs.readFileSync(await download.path(), "utf8");
    /* Both halves: the group listing AND the student's own responses. An
       address that resolves to nothing empties both at once. */
    expect(md, "the take-home must carry section 1's answer").toContain(A_TEXT);
    expect(md, "the take-home must carry section 2's answer").toContain(B_TEXT);
    const mine = md.slice(md.indexOf("## My responses"), md.indexOf("## Group answers"));
    expect(mine, "the student's OWN responses must list what they wrote").toContain(A_TEXT);
    expect(mine, "…including the roleplay section's").toContain(B_TEXT);
    expect(mine, "and their working hypothesis").toContain("mechanical low back pain");
    /* Grouped by SLOT, not by module key — otherwise two sections of the same
       type merge two different patients' work under one heading. */
    expect(md, "each list is headed by the section it came from").toMatch(/### Section 1 — /);
    expect(md).toMatch(/### Section 2 — /);

    // ── 3. THE FACILITATOR'S COUNTERS ───────────────────────────────────────
    /* Two answers from one participant: the funnel's "answered" step counts
       distinct contributors (1), the impact report counts entries (2). Both
       read the room snapshot, and both used to address the retired nodes. */
    const counters = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w._impactMetrics
        ? { answers: w._impactMetrics().answers, hypotheses: w._impactMetrics().hypotheses }
        : null;
    });
    expect(counters, "_impactMetrics must be reachable on the admin tab").not.toBeNull();
    expect(counters.answers, "the impact report must count both answers").toBe(2);
    expect(counters.hypotheses, "…and the working hypothesis").toBe(1);
    /* The debrief funnel, rendered — its "answered" row must not report a
       cliff that did not happen. toBeVisible() pairs with the text assertion:
       the debrief panel is collapsed until toggled. */
    await page.locator("#admin-debrief-btn").click();
    const answeredRow = page
      .locator(".debrief-funnel-row", { hasText: /Answered/i })
      .first();
    await expect(answeredRow).toBeVisible({ timeout: 10_000 });
    await expect(answeredRow, "the one contributor must be counted, not zero")
      .toContainText("— 1");

    // ── 4. THE RESEARCH EXPORT ──────────────────────────────────────────────
    /* The archive that outlives the session, built from THIS session's live
       data. Read through the row builders rather than the five blob downloads
       generateResearchExportCSV() fires: WebKit delivers only the first of a
       rapid burst, so a download-based assertion cannot run on iPhone/iPad. The
       CSV serialiser those rows feed is covered by its own unit tests. */
    const research = await page.evaluate(async () => {
      await window.CanamedLoader.ensureAdminTools();
      const T = window.CanamedAdminTools;
      const idx = T._participantIndex();
      return {
        freetext: T._freetextRows(idx),
        participants: T.researchCsvParticipantRows().rows,
      };
    });
    const texts = research.freetext.map((r) => r.text);
    expect(texts, "the free-text export must carry section 1's answer").toContain(A_TEXT);
    expect(texts, "…and section 2's").toContain(B_TEXT);
    expect(texts, "…and the hypothesis").toContain("mechanical low back pain");
    /* Tagged by SLOT: "moduleA-answer" cannot say WHICH case the words are
       about once a session can run two sections of the same type. */
    const types = research.freetext.map((r) => r.type);
    expect(types).toContain("slot1-answer");
    expect(types).toContain("slot2-answer");
    /* Under the retired address every participant row read 0 / 0 / 0. */
    expect(research.participants).toHaveLength(1);
    expect(research.participants[0].answers).toBe(2);
    expect(research.participants[0].hypotheses).toBe(1);
    expect(research.participants[0].contributed).toBe(1);
    expect(research.participants[0].university).toBeTruthy();
  });

  test("two sections of the SAME type do not share a bucket — the take-home keeps them apart", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    /* The case a module-keyed reader cannot express. Both slots are `pbl`, so
       both write through the SAME on-screen form and both map to the legacy key
       "moduleA": anything grouping by module key merges two different patients'
       answers into one undifferentiated list, and the student can no longer
       tell which case they were writing about. Grouping by SLOT is what keeps
       them separable — the same reason the archive export is keyed by slot. */
    const code = await createSession(page, ["chronic-pain-pbl", "jaundice-pbl"]);
    const stu = await joinStudent(context, code);
    await startSession(page, stu);

    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 2", { timeout: 20_000 });
    await writeModuleAAnswer(stu, "mechanical low back pain", A_TEXT);

    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 3", { timeout: 20_000 });
    /* ⚠ PINNED, NOT ENDORSED — the on-screen list is still the TYPE aggregate.
       refreshAnswerAggregates() merges every `pbl` slot into `answers.moduleA`
       (the score engine drives its Module-A bullets off that aggregate), and
       renderAnswers() reads the same map, so on section 2's board the student
       ALSO sees section 1's answer. That is the "KNOWN LIMIT" recorded above
       refreshAnswerAggregates in script.js — per-slot DISPLAY needs the renderer
       scoped to a slot, which is tracked separately and deliberately not
       attempted here (it moves the scoring input). Asserted so the limit is
       visible in a test rather than only in a comment: if the renderer is ever
       scoped, this line fails and the decision gets made on purpose. The
       DURABLE artefacts — the DB, the take-home, the archive — do keep them
       apart, which is what the assertions below prove. */
    await expect(stu.locator("#answers-list-moduleA-diagnosis")).toContainText(A_TEXT);
    await writeModuleAAnswer(stu, "post-hepatic obstruction", C_TEXT);

    const snap = await roomSnapshot(stu);
    const slotTexts = (slot) =>
      Object.values(((snap.answers || {}).sections || {})[slot] || {}).map((e) => (e || {}).text);
    expect(slotTexts("1")).toEqual([A_TEXT]);
    expect(slotTexts("2")).toEqual([C_TEXT]);

    // The document the student downloads keeps them under separate headings.
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 4", { timeout: 20_000 });
    const [download] = await Promise.all([
      stu.waitForEvent("download", { timeout: 30_000 }),
      stu.locator("#wrapup-download-btn").click(),
    ]);
    const md = require("node:fs").readFileSync(await download.path(), "utf8");
    const group = md.slice(md.indexOf("## Group answers"));
    const h1 = group.indexOf("### Section 1");
    const h2 = group.indexOf("### Section 2");
    expect(h1, "section 1 must have its own heading").toBeGreaterThan(-1);
    expect(h2, "section 2 must have its own heading").toBeGreaterThan(h1);
    /* Each answer sits under ITS OWN heading, not merged into one list. */
    expect(group.slice(h1, h2)).toContain(A_TEXT);
    expect(group.slice(h1, h2)).not.toContain(C_TEXT);
    expect(group.slice(h2)).toContain(C_TEXT);
    expect(group.slice(h2)).not.toContain(A_TEXT);
  });
});
