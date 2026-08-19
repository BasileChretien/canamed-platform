/* tests-e2e/modA-triage.spec.js
 *
 * Module A appropriateness triage (slice 1, flag ?triage=1): the symmetric
 * "Order vs Rule out (+ graded reason)" affordance that rides under each
 * investigation button. Hermetic — drives buildButtons()/renderTriage() with
 * the _test_ hooks, no room / Firebase round-trip (mirrors
 * investigations-anytime.spec.js).
 *
 * Listed in the mobile-iphone / mobile-ipad / mobile-android testMatch in
 * playwright.config.js so it runs per-device (chromium + the three mobile
 * viewports) per the standing per-device-tests rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setup(page, opts) {
  return page.evaluate(async (args) => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    /* The triage engine is a LAZY chunk (modA-triage.js + .css), fetched only
       when the flag is on. Set the flag the way a real session does, then go
       through the loader — driving renderTriage() without this would test a
       function that production never loads. */
    if (args.on) {
      try { localStorage.setItem("canamedModATriage", "1"); } catch (e) {}
      if (window.CanamedLoader && window.CanamedLoader.ensureModATriage) {
        await window.CanamedLoader.ensureModATriage();
      }
    }
    window._test_setTriageOn(!!args.on);
    if (window._test_rebuildCaseDerived) window._test_rebuildCaseDerived();
    window._test_setRevealed(args.rev || {});
    window._test_setTriage(args.tri || {});
    window.buildButtons();
    window.renderButtons();
    /* Guarded exactly like the production call site: with the flag off the
       LAZY chunk is never fetched, so renderTriage does not exist. */
    if (typeof window.renderTriage === "function") window.renderTriage();
    return true;
  }, opts);
}

function boxFacts(page, id) {
  return page.evaluate((id) => {
    const box = document.querySelector('.req-triage[data-id="' + id + '"]');
    const btn = document.querySelector('.req-btn[data-id="' + id + '"]');
    if (!box) return null;
    const txt = (sel) => { const n = box.querySelector(sel); return n ? n.textContent : null; };
    return {
      hidden: box.hidden,
      hasToggle: !!box.querySelector(".triage-toggle"),
      done: txt(".triage-done"),
      award: txt(".triage-award"),
      penalty: txt(".triage-penalty"),
      why: !!box.querySelector(".triage-why"),
      btnRuledOut: btn ? btn.classList.contains("ruled-out") : null,
      btnDisabled: btn ? btn.disabled : null
    };
  }, id);
}

test.describe("Module A — appropriateness triage (Order / Rule-out)", () => {
  test("each investigation gets a Rule-out control + a bulk action when the flag is on", async ({ page }) => {
    await page.goto("/");
    await setup(page, { on: true, rev: {}, tri: {} });

    const mri = await boxFacts(page, "labs:1");
    expect(mri, "labs:1 has a triage box").not.toBeNull();
    expect(mri.hidden, "an undecided box is visible").toBe(false);
    expect(mri.hasToggle, "an undecided box shows the Rule out toggle").toBe(true);

    const bulk = await page.evaluate(() => {
      const f = document.querySelector(".req-triage-bulk");
      const b = f && f.querySelector(".triage-bulk-btn");
      return { present: !!b, hidden: f ? f.hidden : null, text: b ? b.textContent : "" };
    });
    expect(bulk.present, "a bulk 'Rule out the rest' action is offered").toBe(true);
    expect(bulk.hidden, "the bulk action is visible when >=2 tests are undecided").toBe(false);
    expect(bulk.text).toContain("Rule out the rest");
  });

  test("Examination items get the Rule-out control too, and each item wraps button+control in one inline row", async ({ page }) => {
    await page.goto("/");
    await setup(page, { on: true, rev: {}, tri: {} });

    const s = await page.evaluate(() => {
      const labItem = document.querySelector("#group-labs .req-item");
      const examItem = document.querySelector("#group-exam .req-item");
      return {
        labWrapsBtn: !!(labItem && labItem.querySelector(".req-btn")),
        labWrapsTriage: !!(labItem && labItem.querySelector(".req-triage")),
        examBoxes: document.querySelectorAll("#group-exam .req-triage").length,
        examWrapsBtn: !!(examItem && examItem.querySelector(".req-btn")),
        examWrapsTriage: !!(examItem && examItem.querySelector(".req-triage")),
        // History must NOT get the control.
        historyBoxes: document.querySelectorAll("#group-history .req-triage").length
      };
    });
    expect(s.labWrapsBtn && s.labWrapsTriage, "each investigation wraps its button + Rule-out control in one row").toBe(true);
    expect(s.examBoxes, "examination maneuvers also get the Rule-out control").toBeGreaterThan(0);
    expect(s.examWrapsBtn && s.examWrapsTriage, "each exam maneuver wraps its button + Rule-out control in one row").toBe(true);
    expect(s.historyBoxes, "history questions do NOT get the Rule-out control").toBe(0);
  });

  test("opening the rail reveals exactly the 4 controlled reason chips, best one suggested", async ({ page }) => {
    await page.goto("/");
    await setup(page, { on: true, rev: {}, tri: {} });

    const chips = await page.evaluate(() => {
      const box = document.querySelector('.req-triage[data-id="labs:1"]');
      box.querySelector(".triage-toggle").click();   // toggles the rail open + re-renders
      const reasons = Array.from(box.querySelectorAll(".triage-reason"));
      return {
        count: reasons.length,
        keys: reasons.map(c => c.dataset.reason).sort(),
        suggested: reasons.filter(c => c.classList.contains("suggested")).map(c => c.dataset.reason),
        allRadios: reasons.every(c => c.getAttribute("role") === "radio"),
        groupRole: (box.querySelector(".triage-reasons") || {}).getAttribute
          ? box.querySelector(".triage-reasons").getAttribute("role") : null
      };
    });
    expect(chips.count, "four controlled reason chips").toBe(4);
    expect(chips.keys).toEqual(["harm", "low_value", "not_indicated", "premature"]);
    expect(chips.suggested, "the best reason for an MRI is pre-highlighted").toContain("not_indicated");
    expect(chips.allRadios, "each chip is an ARIA radio").toBe(true);
    expect(chips.groupRole, "the rail is a radiogroup").toBe("radiogroup");
  });

  test("a correctly ruled-out test shows the graded reward, the reason and the teaching feedback; its order button locks", async ({ page }) => {
    await page.goto("/");
    await setup(page, {
      on: true, rev: {},
      tri: { "labs:1": { disposition: "ruleout", reason: "not_indicated", by: "t", at: 1 } }
    });

    const mri = await boxFacts(page, "labs:1");
    expect(mri.done, "committed state names the chosen reason").toContain("Ruled out");
    expect(mri.award, "best reason earns +5 (base 3 + reason-quality 2)").toContain("+5");
    expect(mri.why, "the item's own teaching 'why' is surfaced as positive feedback").toBe(true);
    expect(mri.btnRuledOut, "the order button is flagged ruled-out").toBe(true);
    expect(mri.btnDisabled, "you can no longer order a test you ruled out").toBe(true);
  });

  test("the reason wins OR loses points: sharp = +5, acceptable = +2, off-target = a penalty", async ({ page }) => {
    await page.goto("/");
    await setup(page, {
      on: true, rev: {},
      tri: {
        "labs:1": { disposition: "ruleout", reason: "premature", by: "t", at: 1 },  // ok for MRI  => +2
        "labs:4": { disposition: "ruleout", reason: "low_value", by: "t", at: 1 },   // ok for CT   => +2
        "labs:3": { disposition: "ruleout", reason: "harm", by: "t", at: 1 }         // wrong for bloods => −3
      }
    });
    const mriOk = await boxFacts(page, "labs:1");
    expect(mriOk.award, "an acceptable reason (premature) for an MRI earns +2").toContain("+2");
    const ctOk = await boxFacts(page, "labs:4");
    expect(ctOk.award, "low_value is only 'ok' for a CT => +2").toContain("+2");
    // A clinically wrong reason (a blood test does not "harm") LOSES points.
    const bloodsWrong = await boxFacts(page, "labs:3");
    expect(bloodsWrong.award, "a wrong reason shows no reward chip").toBeNull();
    expect(bloodsWrong.penalty, "an off-target reason renders a penalty chip").not.toBeNull();
    expect(bloodsWrong.penalty, "the off-target reason LOSES 3 points").toContain("3");
  });

  test("ruling out a NEEDED exam loses points (indicated items penalise regardless of reason)", async ({ page }) => {
    await page.goto("/");
    // exam:3 = the leg neurological examination — indicated (a red-flag screen step).
    await setup(page, {
      on: true, rev: {},
      tri: { "exam:3": { disposition: "ruleout", reason: "not_indicated", by: "t", at: 1 } }
    });
    const legNeuro = await boxFacts(page, "exam:3");
    expect(legNeuro.penalty, "ruling out a needed exam shows a penalty chip").not.toBeNull();
    expect(legNeuro.penalty, "it reads that the exam was needed").toContain("needed");
    expect(legNeuro.award, "no reward for skipping a needed exam").toBeNull();
    expect(legNeuro.why, "feedback shows what the skipped exam would have found").toBe(true);
  });

  test("ordering a test hides its rule-out control (ordered wins)", async ({ page }) => {
    await page.goto("/");
    await setup(page, { on: true, rev: { "labs:2": { by: "t", at: 1 } }, tri: {} });
    const xray = await boxFacts(page, "labs:2");
    expect(xray.hidden, "an ordered test's triage box is hidden").toBe(true);
  });

  test("no triage UI renders when the flag is off (default)", async ({ page }) => {
    await page.goto("/");
    await setup(page, { on: false, rev: {}, tri: {} });
    const boxes = await page.evaluate(() => document.querySelectorAll(".req-triage").length);
    expect(boxes, "flag off => no triage boxes built").toBe(0);
    /* Stronger since the split: flag off must not even FETCH the engine. This
       is the whole point of making it lazy — it was ~5 KB gz on every splash. */
    const loaded = await page.evaluate(() => ({
      js: typeof window.renderTriage === "function",
      css: !!document.getElementById("moda-triage-css")
    }));
    expect(loaded.js, "flag off => modA-triage.js never loaded").toBe(false);
    expect(loaded.css, "flag off => modA-triage.css never linked").toBe(false);
  });
});
