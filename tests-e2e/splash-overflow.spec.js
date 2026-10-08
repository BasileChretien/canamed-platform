/* tests-e2e/splash-overflow.spec.js
 *
 * The splash must never be wider than the viewport.
 *
 * Horizontal overflow on a phone is not a cosmetic scroll — mobile browsers
 * zoom the page out to fit the document width, and once they do, synthetic
 * pointer events (and real taps near a control's edge) land a few pixels off.
 * That is exactly how the admin Start button became untappable in PR #172, and
 * it is how the section picker's reorder controls became untappable here.
 *
 * The bug this guards: `#splash` stacks to a single column under 900px with
 * `grid-template-columns: 1fr`. A bare `1fr` is `minmax(auto, 1fr)`, so the
 * track's FLOOR is the widest grid item's min-content — and the card holds
 * <select>s whose min-content is their longest <option> label. The scenario
 * picker alone floored the page at 419px; the section picker's "add" list
 * ("Roleplay — The antibiotic-request conversation across cultures") pushed it
 * to 528px against a 412px Pixel 7. Fix: `minmax(0, 1fr)`.
 *
 * Registered into the mobile projects per the standing per-device rule; the
 * desktop projects run it too, at explicit narrow viewports.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/** Widths that matter: iPhone SE, small Android, iPhone 14 Pro, Pixel 7. */
const NARROW = [320, 360, 390, 412];

const overflow = (page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });

/** Fails with the widest offending element named, not just a number. */
async function expectNoOverflow(page, where) {
  const { scrollWidth, clientWidth } = await overflow(page);
  if (scrollWidth > clientWidth + 1) {
    const worst = await page.evaluate(() =>
      [...document.querySelectorAll("#splash *")]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => ({
          tag: e.tagName,
          cls: String(e.className || "").slice(0, 40),
          id: e.id,
          right: Math.round(e.getBoundingClientRect().right)
        }))
        .sort((a, b) => b.right - a.right)
        .slice(0, 5));
    throw new Error(
      `${where}: document is ${scrollWidth}px wide in a ${clientWidth}px viewport. ` +
      `Widest: ${JSON.stringify(worst)}`);
  }
  expect(scrollWidth, `${where}: no horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

async function openCreate(page) {
  await page.locator("#splash-go-create").click();
  // The section library is a lazy chunk; its long option labels ARE the thing
  // under test, so wait for them rather than asserting against an empty list.
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  /* The picker SEEDS one default section once the library lands. Clear it, so
     "+ 3 sections" below means exactly three rows — otherwise the count assert
     trips on four and the OVERFLOW check, which is the point of this spec,
     never runs at all. */
  await page.evaluate(() => { splashSectionPick.length = 0; renderSectionPick(); });
}

test.describe("Splash fits the viewport", () => {
  for (const width of NARROW) {
    test(`no horizontal overflow at ${width}px — entry, create, create+sections`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expectNoOverflow(page, `entry view @${width}`);

      await openCreate(page);
      await expectNoOverflow(page, `create view @${width}`);

      // A populated picker is the worst case: each row carries a long section
      // title, a type chip and three controls.
      for (const id of ["chronic-pain-pbl", "sore-throat-roleplay", "jaundice-pbl"]) {
        await page.selectOption("#splash-section-add", id);
        await page.locator("#splash-section-add-btn").click();
      }
      await expect(page.locator(".splash-section-row")).toHaveCount(3);
      await expectNoOverflow(page, `create view + 3 sections @${width}`);
    });
  }

  for (const width of NARROW) {
    test(`no horizontal overflow at ${width}px — signed in, with an unbreakable name`, async ({ page }) => {
      /* The signed-in row is hidden for everyone in LOCAL mode (no auth), so
         the sweep above never sees it. It holds the profile name — or, before a
         profile exists, the e-mail address, which has no break opportunity —
         next to two links ("Account", "Sign out"). Stand a user in and paint
         it, as the auth-state handler does. */
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.waitForFunction(() => typeof paintUserChip === "function");
      await page.evaluate(() => {
        currentUser = {
          uid: "u_local", isAnonymous: false,
          email: "firstname.middlename.familyname.u4@student.mail.example-university.test"
        };
        paintUserChip();
      });
      await expect(page.locator("#splash-signed-in")).toBeVisible();
      await expect(page.locator("#splash-signed-in-account")).toBeVisible();
      await expect(page.locator("#splash-signed-in-out")).toBeVisible();
      await expectNoOverflow(page, `signed-in entry view @${width}`);
    });
  }

  test("the stacked splash grid track cannot exceed the viewport", async ({ page }) => {
    // Guards the root cause directly: if someone reverts `minmax(0, 1fr)` to a
    // bare `1fr`, the single track grows to the card's min-content and this
    // fails even before anything visibly overflows.
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/");
    await openCreate(page);
    const { track, avail } = await page.evaluate(() => {
      const splash = /** @type {HTMLElement} */ (document.getElementById("splash"));
      return {
        track: parseFloat(getComputedStyle(splash).gridTemplateColumns),
        avail: splash.clientWidth
      };
    });
    expect(track).toBeLessThanOrEqual(avail + 1);
  });

  test("no horizontal overflow at the device's own viewport", async ({ page }) => {
    // Mobile projects supply the real device metrics (Pixel 7 / iPhone 14 Pro /
    // iPad Pro 11); desktop projects exercise the wide two-column layout.
    await page.goto("/");
    await expectNoOverflow(page, "entry view @device");
    await openCreate(page);
    await expectNoOverflow(page, "create view @device");
  });
});

/* ---------------------------------------------------------------------------
 * The same contract with the text enlarged.
 *
 * Text-only zoom, or a larger default font, is approximated through the root
 * font size: the page's type is rem-based, its gutters and breakpoints are not,
 * which is exactly the combination a reader with enlarged text gets. Page zoom
 * is a different thing — it scales everything, so it is just a narrower
 * viewport, and the sweep above covers that.
 *
 * What it guards: display-size text whose size has a rem floor and no ceiling
 * tied to the viewport. One word that cannot break — the wordmark, or the
 * longest word of the mission line — was then wider than a phone: 370px of
 * page in a 320px viewport at 150% text, 488px at 200%. Besides the sideways
 * scroll, on Android that widened the layout viewport, and the account dialog,
 * centred in it, hung off the right edge of the screen (tests-e2e/
 * account-dialog.spec.js asserts it stays on screen).
 *
 * One language: the offending strings are not translated, and French, German
 * and Japanese were measured to add none of their own.
 * ------------------------------------------------------------------------- */

/** iPhone SE, small Android, iPhone 14 Pro. */
const ENLARGED_WIDTHS = [320, 360, 393];

/** Sweeps the root font size from 100% to 200% in steps of 5 inside the page
    and fails if the document is ever wider than the viewport, naming the text
    or the box that reaches furthest right. Leaves the font size as it found it. */
async function expectNoOverflowWhenEnlarged(page, where) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const basePx = parseFloat(getComputedStyle(root).fontSize);
    const shown = (el) => {
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && !el.closest("dialog:not([open])");
    };
    const label = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "");
    /* Text can overflow a box that itself stays inside the page, so both the
       boxes and the text runs are measured. */
    const furthestRight = (edge) => {
      let worst = { right: edge, what: "nothing measurable" };
      for (const el of document.body.querySelectorAll("*")) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.right > worst.right) worst = { right: r.right, what: "the box of " + label(el) };
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.nodeValue.trim() || !parent || !shown(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.right > worst.right) {
          worst = { right: r.right, what: `the text "${node.nodeValue.trim().slice(0, 28)}" in ${label(parent)}` };
        }
      }
      /* Nothing past the edge and the page still too wide is WebKit and a <select>:
         its longest option counts toward the scroll width whatever the box is
         sized to, and the option grows with the text. */
      if (worst.right <= edge) {
        return "no box and no text (in WebKit: a <select>, whose longest option is counted — see contain: paint on .splash-field select)";
      }
      return `${worst.what}, ${Math.round(worst.right - edge)}px past the edge`;
    };
    const DISPLAY_TEXTS = ["#splash-title", ".splash-mission"];
    const out = { sizes: 0, displayTexts: 0, violations: [] };
    for (let pct = 100; pct <= 200; pct += 5) {
      root.style.fontSize = pct + "%";
      out.sizes++;
      const rootPx = parseFloat(getComputedStyle(root).fontSize);
      if (Math.abs(rootPx - basePx * pct / 100) > 0.5) {
        out.violations.push(`${pct}%: the text was not enlarged (root font ${rootPx}px)`);
      }
      if (root.scrollWidth > root.clientWidth + 1) {
        out.violations.push(`${pct}%: the page is ${root.scrollWidth}px wide in a ${root.clientWidth}px viewport; ` +
          `furthest right is ${furthestRight(root.clientWidth)}`);
      }
      /* The two display-size texts are held to their own column as well. A word
         can stick out of its box by the width of the page gutter before the
         page itself gets wider, so the check above alone leaves that much play
         in the two caps. */
      for (const sel of DISPLAY_TEXTS) {
        const el = document.querySelector(sel);
        out.displayTexts += el ? 1 : 0;
        if (el && el.scrollWidth > el.clientWidth + 1) {
          out.violations.push(`${pct}%: ${sel} is ${el.scrollWidth}px of text in a ${el.clientWidth}px column`);
        }
      }
    }
    root.style.fontSize = "";
    return out;
  });
  // 100% to 200% in steps of 5: the loop cannot have run empty.
  expect(result.sizes, `${where}: every text size was measured`).toBe(21);
  expect(result.displayTexts, `${where}: both display texts were found at every size`).toBe(21 * 2);
  expect(result.violations.length, `${where}:\n` + result.violations.slice(0, 4).join("\n")).toBe(0);
}

test.describe("Splash fits the viewport with enlarged text", () => {
  for (const width of ENLARGED_WIDTHS) {
    test(`no horizontal overflow at ${width}px from 100% to 200% text — entry, signed in, create+sections`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.waitForFunction(() => typeof paintUserChip === "function");
      await expectNoOverflowWhenEnlarged(page, `entry view @${width}`);

      // The signed-in row and its unbreakable address, as in the sweep above.
      await page.evaluate(() => {
        currentUser = {
          uid: "u_local", isAnonymous: false,
          email: "firstname.middlename.familyname.u4@student.mail.example-university.test"
        };
        paintUserChip();
      });
      await expect(page.locator("#splash-signed-in")).toBeVisible();
      await expectNoOverflowWhenEnlarged(page, `signed-in entry view @${width}`);

      await openCreate(page);
      for (const id of ["chronic-pain-pbl", "sore-throat-roleplay", "jaundice-pbl"]) {
        await page.selectOption("#splash-section-add", id);
        await page.locator("#splash-section-add-btn").click();
      }
      await expect(page.locator(".splash-section-row")).toHaveCount(3);
      await expectNoOverflowWhenEnlarged(page, `create view + 3 sections @${width}`);
    });
  }
});
