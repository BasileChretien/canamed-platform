/* tests-e2e/branched-playthrough.spec.js
 *
 * The branched-scenarios format, played end-to-end in a REAL session (LOCAL
 * mode, cross-tab LocalDB sync): a facilitator creates a session on the
 * "ward-escalation-branched" scenario, one participant joins, and the team
 * works the branch tree by voting + locking in one node at a time. This is the
 * proof that the format actually PLAYS — the existing decision engine advances
 * the branch on a committed choice — not just that the wiring/CSS are present.
 *
 * Asserts, in-session (not synthetically):
 *   - on stage-1 the épuré layout is live (case chrome hidden, decisions shown);
 *   - committing node b_assess reveals its consequence (.dec-branch) AND unlocks
 *     the follow-up node b_escalate (the fork advances);
 *   - committing b_escalate advances again, unlocking the final node b_family;
 *   - committing b_family renders its ending consequence.
 * The whole tree is one stage (every node module A → #decisions-A).
 *
 * Single-participant quorum: need = min(2, max(1, present)) = 1, so one voter
 * can lock in (script.js ~9706). Desktop matrix (the multi-tab admin/participant
 * dance is desktop-shaped; the per-device CSS proof lives in branched-format).
 */

const { test, expect } = require("./fixtures");

// Pin LOCAL mode on a manually-spawned page (the fixture only auto-pins the
// primary `page`; the participant tab is a context.newPage()).
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
      // The Module-A entry tour (studentModA) uses its OWN key; without it the
      // overlay covers stage-1 and intercepts the vote clicks.
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
    } catch (e) {}
    // Auto-accept the in-page confirm modal (Start / Advance use it).
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

// Vote the given option of a decision and lock it in, then wait for the result.
async function voteAndLock(tab, container, decId, optIdx) {
  const opt = tab.locator(
    `${container} .dec-opt[data-dec="${decId}"][data-opt="${optIdx}"]`,
  );
  await expect(opt).toBeVisible({ timeout: 15_000 });
  await opt.click();
  await expect(opt).toHaveClass(/mine/, { timeout: 5_000 });
  const lock = tab.locator(`${container} .dec-lock[data-dec-lock="${decId}"]`);
  await expect(lock).toBeEnabled({ timeout: 5_000 });
  await lock.click();
}

test.describe("branched scenario — full playthrough", () => {
  test("a room votes through the whole branch tree to an ending", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);

    // ── Facilitator creates a session on the branched scenario ──────────────
    await pinLocal(page);
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Facilitator");
    await page.locator("#splash-create-label").fill("Branched run");
    // Selecting the branched scenario from the picker also confirms it is
    // listed there (the picker enumerates CANAMED_SCENARIOS).
    await page
      .locator("#splash-create-scenario")
      .selectOption("ward-escalation-branched");
    await page.locator("#splash-create-pass").fill("e2e-pass-2026");
    await page.locator("#splash-create-submit").click();

    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/[A-Z0-9]{3}-?[A-Z0-9]{3}/i, {
      timeout: 15_000,
    });
    const code = (await codeNode.textContent()).trim();

    // ── One participant joins ───────────────────────────────────────────────
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
    await expect(stu.locator("#join-btn")).toBeEnabled({ timeout: 5_000 });
    await stu.locator("#join-btn").click();
    await expect(stu.locator("#waiting")).toBeVisible({ timeout: 15_000 });

    // ── Facilitator starts, then advances the room to Act I (stage 1) ───────
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
    await page.locator("#start-session-btn").click();
    await expect(stu.locator("#app")).toBeVisible({ timeout: 20_000 });
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 2", {
      timeout: 20_000,
    });

    // ── In-session épuré proof: branched format live, chrome hidden ─────────
    expect(await stu.evaluate(() => document.body.dataset.format)).toBe(
      "branched",
    );
    expect(
      await stu.evaluate(() => {
        const n = document.querySelector("#stage-1 .columns > .col-left");
        return n ? getComputedStyle(n).display : "absent";
      }),
    ).toBe("none");
    await expect(stu.locator("#decisions-A")).toBeVisible({ timeout: 10_000 });

    // Per-stage DOCUMENTS render with the node: the entry node shows the obs.
    await expect(stu.locator("#decisions-A .dec-doc").first()).toContainText(
      /Bedside observations/i,
      { timeout: 10_000 },
    );

    // The leaderboard must start at ZERO — no Module-A workup milestone may
    // auto-award for a branched scenario. Regression: redFlagFirst (25 pts)
    // fired the instant the session opened because an empty SYNTH_PREREQS made
    // `[].every()` vacuously true.
    await expect
      .poll(
        () =>
          stu.evaluate(() =>
            typeof scoreTotal === "function"
              ? scoreTotal({ score: roomScore })
              : -1,
          ),
        { timeout: 8000 },
      )
      .toBe(0);

    // ── "Before you vote": the active decision's group-reasoning capture is
    //    shown, and a contribution persists for the team to see.
    const rationale = stu.locator("#branched-rationale-host");
    await expect(rationale).toBeVisible({ timeout: 10_000 });
    await expect(rationale).toContainText(/before you vote/i);
    await rationale
      .locator("#answer-input-moduleA-rat_b_assess")
      .fill("We treat first — oxygen before imaging; one of us wanted the film.");
    await rationale.locator(".branched-rationale-add").click();
    await expect(
      rationale.locator('.branched-rationale-list[data-field="rat_b_assess"]'),
    ).toContainText(/oxygen before imaging/i, { timeout: 10_000 });

    // ── Act I: commit b_assess → consequence + b_escalate unlocks ───────────
    await voteAndLock(stu, "#decisions-A", "b_assess", 0);
    // The rationale host re-binds to the NEW active decision (b_escalate).
    await expect
      .poll(
        () => rationale.getAttribute("data-dec"),
        { timeout: 10_000 },
      )
      .toBe("b_escalate");

    // ── Admin dashboard: this room's choice tree shows the committed path —
    //    a green (correct) step for b_assess + the node it is deciding now.
    await expect(
      page.locator(".room-choice-tree .ct-step.correct").first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(".room-choice-tree .ct-step.ct-active").first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(stu.locator("#decisions-A .dec-branch")).toBeVisible({
      timeout: 10_000,
    });
    await expect(stu.locator("#decisions-A")).toContainText(
      /bought yourselves time/i,
      { timeout: 10_000 },
    );
    // The fork advanced: the follow-up node is now on screen.
    await expect(
      stu.locator('#decisions-A .dec-opt[data-dec="b_escalate"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    // …and it reveals richer documents: a blood-gas result + a referenced image.
    await expect(stu.locator("#decisions-A")).toContainText(/blood gas/i, {
      timeout: 10_000,
    });
    const imgSrc = await stu
      .locator("#decisions-A .dec-doc-img")
      .first()
      .getAttribute("src");
    expect(imgSrc).toContain("scenario-images/");

    // Commit b_escalate → its consequence + the final node b_family unlocks
    // (still in #decisions-A — the whole tree is one stage).
    await voteAndLock(stu, "#decisions-A", "b_escalate", 0);
    await expect(stu.locator("#decisions-A")).toContainText(
      /antibiotics are running/i,
      { timeout: 10_000 },
    );
    await expect(
      stu.locator('#decisions-A .dec-opt[data-dec="b_family"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Ending: commit the honest-disclosure choice, assert its consequence ─
    await voteAndLock(stu, "#decisions-A", "b_family", 1);
    await expect(stu.locator("#decisions-A")).toContainText(
      /straight with me/i,
      { timeout: 10_000 },
    );

    // ── OSCE final deliverable: the tree is done → the final-diagnosis form
    //    appears, and a committed diagnosis persists in the team's answer list.
    const host = stu.locator("#branched-final-host");
    await expect(host).toBeVisible({ timeout: 10_000 });
    await expect(host).toContainText(/Final diagnosis/i);
    // …and the "before you vote" rationale host hides (no open decision left).
    await expect(stu.locator("#branched-rationale-host")).toBeHidden({
      timeout: 10_000,
    });
    await host
      .locator("#answer-input-moduleA-finalDx")
      .fill("Pulmonary embolism");
    await host
      .locator(
        ".branched-final-field:has(#answer-input-moduleA-finalDx) .branched-final-add",
      )
      .click();
    await expect(
      host.locator('.branched-final-list[data-field="finalDx"]'),
    ).toContainText(/Pulmonary embolism/i, { timeout: 10_000 });

    // ── Stage-2 skip: advancing from the case jumps straight to Wrap-up ──────
    // A branched session has no Module-B / Reflection stage. Advancing the room
    // off the case (stage 1) must land on Wrap-up (the 3rd of 3 stages), never
    // the empty stage 2 — proving stageFlow()'s skip end to end.
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 3 of 3", {
      timeout: 20_000,
    });
    expect(
      await stu.evaluate(() => {
        const s2 = document.getElementById("stage-2");
        return s2 ? getComputedStyle(s2).display : "absent";
      }),
    ).toBe("none");
    await expect(stu.locator("#stage-3")).toBeVisible({ timeout: 10_000 });

    await stu.close();
  });
});
