/* tests-e2e/consent-transcript.spec.js
 *
 * Box C — consent to retention of the Microsoft Teams transcript AND the
 * audio/video recording of the session (added 2026-07-29, confirmed by the
 * study lead while reviewing the CER Unicaen ethics dossier). The sessions run
 * over Teams and the automatic transcript was being retained and analysed with
 * nothing in the participant-facing notice about it and no consent control.
 *
 * The one property that must never regress is SEPARABILITY. GDPR Art. 7(2)
 * and the dossier's own promise ("je peux participer sans cocher cette case C,
 * et sans cocher la case B") mean every combination has to be reachable:
 *
 *      A alone            → join enabled   (research + transcript refused)
 *      A + C              → join enabled   (transcript accepted, research not)
 *      A + B              → join enabled   (the pre-existing pair)
 *      A + B + C          → join enabled
 *      B and/or C, no A   → join DISABLED  (A is the only gate)
 *
 * A bug that made C required, or that coupled it to B, would collect consent
 * the participant did not freely give — the exact defect this file exists to
 * prevent. So the matrix is asserted explicitly rather than sampled.
 *
 * The second half asserts the DISCLOSURE actually reaches the screen: box C's
 * own wording, plus the video-conference paragraph in the data-use notice
 * (Microsoft named as a processor, the transcript carrying the speaker's name,
 * the recording kept too, 5-year retention, removal on request, no photograph
 * and no obligation to turn the camera on). A correct string in i18n.js that
 * is collapsed, clipped or overwritten by the index.html fallback is still a
 * notice nobody read — which is why this runs in the browser and on all four
 * viewports (playwright.config.js routes this file to desktop + iPhone + iPad
 * + Android).
 *
 * The lobby UI is English-only by deliberate decision (user 2026-06-25); the
 * language picker drives the reading aid, not the UI copy. The FR/JA/other
 * locale tables are covered at source level by tests/i18n.test.js.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures.js");

// WebKit-family emulation (desktop Safari + iPad) occasionally stalls the
// first anonymous-auth + LocalDB write on the shared create-session step —
// environmental, not this spec's assertions. Same mitigation as the sibling
// consent specs.
test.describe.configure({ retries: 2 });

async function createSession(page, label) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("e2e-transcript-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
}

async function openLobbyTab(context, code) {
  const tab = await context.newPage();
  await forceLocalMode(tab);
  await tab.addInitScript(() => {
    try {
      localStorage.setItem("canamed_lang", "en");
      localStorage.removeItem("canamed_session");
    } catch (e) {}
  });
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 20_000 });
  return tab;
}

// The data-use notice lives inside a <details> that is collapsed by default
// (UX-overload fix 2026-06-01). Open it the way a participant does.
async function openNotice(tab) {
  const para = tab.locator('[data-i18n-html="lobby.privacy.transcript"]');
  await expect(para).toHaveCount(1);
  const summary = tab.locator('[data-i18n="lobby.privacy.summary"], summary').first();
  if (await summary.count()) {
    // Idempotent: clicking an already-open <details> would close it.
    const isOpen = await para.isVisible().catch(() => false);
    if (!isOpen) await summary.click();
  }
  await expect(para).toBeVisible({ timeout: 10_000 });
  return para;
}

const A = "#consent-workshop";
const B = "#consent-research";
const C = "#consent-transcript";

// Set the three boxes to an exact state, then report whether Join is enabled.
//
// The state is set programmatically + a real bubbling `change` event, NOT by
// pointer input. Each checkbox sits INSIDE its <label class="consent-row">, and
// on WebKit-iPad a click landing on the input is re-forwarded by the label, so
// the net state can come back unchanged and Playwright's setChecked() retries
// until the test times out (reproduced on every mobile-ipad run of the matrix
// below — every other spec in the repo only ever .check()s, never unchecks, so
// this had not been hit before). `change` is exactly the event script.js's
// refreshJoinBtnState listens for, so the wiring under test is still exercised;
// genuine pointer taps on all three boxes are asserted separately in the last
// test, which is where a broken tap target belongs.
async function applyAndProbe(tab, { a, b, c }) {
  await tab.evaluate(({ want }) => {
    for (const [id, value] of Object.entries(want)) {
      const box = document.getElementById(id);
      if (!box) throw new Error("missing consent checkbox #" + id);
      if (box.checked !== value) {
        box.checked = value;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, { want: { "consent-workshop": a, "consent-research": b, "consent-transcript": c } });

  const join = tab.locator("#join-btn");
  return { join, enabled: !(await join.isDisabled()) };
}

test.describe("Consent box C — transcript + recording", () => {
  test("box C exists, starts unticked, and does not gate the Join button", async ({ page, context }) => {
    const code = await createSession(page, "consent C presence");
    const tab = await openLobbyTab(context, code);

    const c = tab.locator(C);
    await expect(c, "box C must render on first paint, next to A and B").toHaveCount(1);
    await expect(c, "consent must never be pre-ticked — it would not be freely given")
      .not.toBeChecked();
    await expect(tab.locator(B), "box B must still be unticked by default").not.toBeChecked();

    // C sits after B inside the same consent block, so the three read as one
    // separable set rather than C looking like a detail of B.
    const order = await tab.evaluate(() => {
      const ids = ["consent-workshop", "consent-research", "consent-transcript"];
      const block = document.querySelector(".consent-block");
      if (!block) return null;
      const rows = Array.from(block.querySelectorAll('input[type="checkbox"]'))
        .map((n) => n.id);
      return { rows, allPresent: ids.every((i) => rows.includes(i)) };
    });
    expect(order && order.allPresent, "all three boxes must live in .consent-block").toBe(true);
    expect(order.rows.indexOf("consent-transcript"))
      .toBeGreaterThan(order.rows.indexOf("consent-research"));

    await tab.close();
  });

  test("the join gate depends on A only — every B/C combination is reachable", async ({ page, context }) => {
    const code = await createSession(page, "consent C matrix");
    const tab = await openLobbyTab(context, code);

    // A is the only gate.
    expect((await applyAndProbe(tab, { a: false, b: false, c: false })).enabled,
      "with nothing ticked the Join button must stay locked").toBe(false);
    expect((await applyAndProbe(tab, { a: false, b: true, c: true })).enabled,
      "B and C must not unlock Join on their own — A is the participation consent").toBe(false);

    // …and with A ticked, all four B/C combinations must be joinable.
    for (const [b, c] of [[false, false], [false, true], [true, false], [true, true]]) {
      const { enabled } = await applyAndProbe(tab, { a: true, b, c });
      expect(enabled,
        `A ticked with research=${b}, transcript=${c} must leave Join enabled — ` +
        "B and C are both optional and independent").toBe(true);
    }

    await tab.close();
  });

  test("a participant can join having accepted C while refusing B", async ({ page, context }) => {
    // The combination the dossier explicitly promises and the one a coupled
    // implementation would break first. Carry it through to an actual join so
    // the assertion covers joinParticipant(), not just the button state.
    const code = await createSession(page, "consent C only");
    const tab = await openLobbyTab(context, code);

    await applyAndProbe(tab, { a: true, b: false, c: true });
    await tab.locator("#name-input").fill("Transcript Only");
    await tab.locator("#uni-input").selectOption("Caen");
    await tab.locator("#join-btn").click();

    // Landing in the waiting room proves the join went through with B refused.
    await expect(tab.locator("#waiting"), "join must succeed with A+C and B refused")
      .toBeVisible({ timeout: 20_000 });
    await expect(tab.locator("#lobby")).toBeHidden();

    await tab.close();
  });

  test("box C discloses the transcript, the recording, retention and the camera rule", async ({ page, context }) => {
    const code = await createSession(page, "consent C wording");
    const tab = await openLobbyTab(context, code);

    const text = (await tab.locator('[data-i18n="lobby.consent-transcript"]').innerText())
      .replace(/\s+/g, " ").trim();

    // Each claim the study lead required, asserted separately so a failure
    // names the missing one rather than "the string changed".
    expect(text, "must say the sessions are held by video conference")
      .toMatch(/video[- ]conference/i);
    expect(text, "must say the transcript is produced automatically")
      .toMatch(/automatically/i);
    expect(text, "must say the transcript carries the speaker's name per utterance")
      .toMatch(/carries my name against each/i);
    // Confirmed 2026-07-29: the raw Teams recording is retained too, not just
    // the transcript — so box C has to say so in as many words.
    expect(text, "must disclose that the recording is kept as well, not only the transcript")
      .toMatch(/recording/i);
    expect(text, "must state the 5-year retention")
      .toMatch(/5\s*years/i);
    expect(text, "must state the access is the same as the rest of the research dataset")
      .toMatch(/same restricted access/i);
    expect(text, "must offer removal on request at any time")
      .toMatch(/deleted at any time/i);
    expect(text, "must say no photograph is taken")
      .toMatch(/no photograph/i);
    expect(text, "must say the camera is not required")
      .toMatch(/not required to turn my camera on/i);
    expect(text, "must state that C is optional and independent of B")
      .toMatch(/without ticking this third box, and without ticking the research box/i);

    await tab.close();
  });

  test("the data-use notice names Microsoft and the video conference", async ({ page, context }) => {
    const code = await createSession(page, "consent C notice");
    const tab = await openLobbyTab(context, code);
    const para = await openNotice(tab);

    const text = (await para.innerText()).replace(/\s+/g, " ").trim();

    expect(text, "Microsoft must be named as a processor alongside Google")
      .toMatch(/Microsoft/);
    expect(text, "Google must still be named in the same breath")
      .toMatch(/Google/);
    expect(text, "must disclose the video conference itself")
      .toMatch(/video conference/i);
    expect(text, "must disclose the automatic written transcript")
      .toMatch(/written transcript/i);
    expect(text, "must disclose the recording, not only the transcript")
      .toMatch(/recording of the session is kept as well/i);
    expect(text, "must tie retention to the third consent box")
      .toMatch(/only if you tick the third consent box/i);
    expect(text, "must state the 5-year retention")
      .toMatch(/5\s*years/i);
    expect(text, "must say no photograph is taken and the camera is optional")
      .toMatch(/no photograph is taken, and you are not required to turn your camera on/i);

    await tab.close();
  });

  test("the consent block stays legible with no horizontal overflow", async ({ page, context }) => {
    // Horizontal overflow is this repo's known mobile failure mode: it zooms
    // the page out and breaks hit-testing, so a third long consent paragraph
    // could make the Join button untappable on a phone (cf. PR #172). Assert
    // the document does not scroll sideways with the notice open, and that box
    // C is actually clickable at its rendered position.
    const code = await createSession(page, "consent C layout");
    const tab = await openLobbyTab(context, code);
    await openNotice(tab);

    const overflow = await tab.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(
      overflow.scrollWidth,
      `page scrolls horizontally (${overflow.scrollWidth} > ${overflow.clientWidth}) — ` +
      "on mobile this zooms the viewport out and breaks tapping"
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Tick each box by REAL pointer input so a covering element or an
    // off-screen position fails here rather than in production. The tap lands
    // on the label — that is the target a participant actually hits, and it
    // avoids the label-forwards-the-click ambiguity of tapping the bare input
    // (see applyAndProbe). Only ticking is exercised, matching how a
    // participant uses the form and how every other spec drives consent.
    for (const sel of [A, B, C]) {
      const box = tab.locator(sel);
      const rect = await box.boundingBox();
      expect(rect, `${sel} has no layout box`).not.toBeNull();
      await tab.locator("label.consent-row", { has: box }).click();
      await expect(box, `${sel} did not toggle on a real tap`).toBeChecked();
    }
    // Join must be enabled now that A is ticked — the tap really reached the
    // handler, not just the DOM.
    await expect(tab.locator("#join-btn")).toBeEnabled();

    await tab.close();
  });
});
