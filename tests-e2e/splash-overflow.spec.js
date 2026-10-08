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
 * The same contract with a larger default font size.
 *
 * What is modelled is the browser's default font size (Chrome's "Font size",
 * the root font size): the page's type is rem-based, its gutters, breakpoints
 * and columns are not. It is NOT a text-only zoom. Firefox's text zoom scales
 * every computed font size, viewport-relative ones included, so no font-size
 * cap can hold under it: there the page is still 371px wide in a 320px
 * viewport at 150%, with or without the caps this guards. Page zoom is a third
 * thing: it is simply a narrower viewport, covered at the bottom of this file.
 *
 * What it guards: display-size text whose size has a rem floor and no ceiling
 * tied to its column. One word that cannot break — the wordmark, or the longest
 * word of the mission line — was then wider than its column, and where that
 * column ends at the screen's edge, wider than the page: 370px in a 320px
 * viewport at 150%, 980px in 901px at 200%. Besides the sideways scroll, on
 * Android that widened the layout viewport, and the account dialog, centred in
 * it, hung off the right edge of the screen (tests-e2e/account-dialog.spec.js
 * asserts it stays on screen).
 *
 * The sizes are one per layout regime: three phones (one column, the column
 * nearly as wide as the viewport), a phone held sideways and a tablet (two
 * columns, each well under half the viewport), and a laptop (two columns, the
 * card's content at its fixed 480px).
 *
 * One language: the offending strings are not translated, and French, German
 * and Japanese were measured to add none of their own.
 * ------------------------------------------------------------------------- */

/** iPhone SE, small Android, iPhone 14 Pro; Pixel 7 held sideways, a tablet, a laptop. */
const ENLARGED_SIZES = [
  { width: 320, height: 800 }, { width: 360, height: 800 }, { width: 393, height: 800 },
  { width: 915, height: 412 }, { width: 1024, height: 768 }, { width: 1366, height: 768 }
];

/** Sweeps the root font size from 100% to 200% in steps of 5 inside the page
    and fails if the document is ever wider than the viewport, or either
    display text wider than its column, naming the text or the box that reaches
    furthest right. Leaves the font size as it found it. */
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
    const out = { sizes: 0, displayTexts: 0, uncapped: 0, violations: [] };
    /* A cap that bound at the default size would never overflow anything: the
       text would simply be smaller, and every check below would pass. So, before
       any enlarging: lifting the column cap must leave both sizes as they are. */
    const splash = document.getElementById("splash");
    const sizeOf = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    const capped = DISPLAY_TEXTS.map(sizeOf);
    splash.style.setProperty("--splash-col", "1000vw");
    const free = DISPLAY_TEXTS.map(sizeOf);
    splash.style.removeProperty("--splash-col");
    DISPLAY_TEXTS.forEach((sel, i) => {
      out.uncapped += free[i] > 20 ? 1 : 0;
      if (Math.abs(capped[i] - free[i]) > 0.1) {
        out.violations.push(`100%: ${sel} is ${capped[i]}px, but ${free[i]}px without its column cap — the cap must not bind at the default size`);
      }
    });
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
         can stick out of its box by the width of a gutter before the page itself
         gets wider — and in the left-hand column of the two-column layout it
         never widens the page at all, it runs under the card. */
      for (const sel of DISPLAY_TEXTS) {
        const el = document.querySelector(sel);
        // Counted only when laid out: a hidden element measures 0 against 0 and would pass.
        const laidOut = !!el && el.clientWidth > 0;
        out.displayTexts += laidOut ? 1 : 0;
        if (laidOut && el.scrollWidth > el.clientWidth + 1) {
          out.violations.push(`${pct}%: ${sel} is ${el.scrollWidth}px of text in a ${el.clientWidth}px column`);
        }
      }
    }
    root.style.fontSize = "";
    return out;
  });
  // 100% to 200% in steps of 5: the loop cannot have run empty.
  expect(result.sizes, `${where}: every text size was measured`).toBe(21);
  expect(result.displayTexts, `${where}: both display texts were laid out at every size`).toBe(21 * 2);
  // Both were measured with the cap lifted, at a display size: the comparison above compared something.
  expect(result.uncapped, `${where}: both display texts were sized with the cap lifted`).toBe(2);
  expect(result.violations.length, `${where}:\n` + result.violations.slice(0, 4).join("\n")).toBe(0);
}

test.describe("Splash fits the viewport with a larger default font size", () => {
  for (const { width, height } of ENLARGED_SIZES) {
    test(`no horizontal overflow at ${width}x${height} from 100% to 200% — entry, signed in, create+sections`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.waitForFunction(() => typeof paintUserChip === "function");
      await expect(page.locator("#splash-title")).toBeVisible();
      await expect(page.locator(".splash-mission")).toBeVisible();
      await expectNoOverflowWhenEnlarged(page, `entry view @${width}x${height}`);

      // The signed-in row and its unbreakable address, as in the sweep above.
      await page.evaluate(() => {
        currentUser = {
          uid: "u_local", isAnonymous: false,
          email: "firstname.middlename.familyname.u4@student.mail.example-university.test"
        };
        paintUserChip();
      });
      await expect(page.locator("#splash-signed-in")).toBeVisible();
      await expectNoOverflowWhenEnlarged(page, `signed-in entry view @${width}x${height}`);

      await openCreate(page);
      for (const id of ["chronic-pain-pbl", "sore-throat-roleplay", "jaundice-pbl"]) {
        await page.selectOption("#splash-section-add", id);
        await page.locator("#splash-section-add-btn").click();
      }
      await expect(page.locator(".splash-section-row")).toHaveCount(3);
      await expectNoOverflowWhenEnlarged(page, `create view + 3 sections @${width}x${height}`);
    });
  }

  /* Page zoom, and the OS-level display zoom a phone offers, do not enlarge the
     text against the page: they give the page a narrower viewport. A 320px
     phone zoomed to 133% is a 240px one. Page width only — at 240px the mission
     line's longest word sits a few px outside its column while the page fits. */
  for (const width of [240, 280]) {
    test(`no horizontal overflow at ${width}px — a 320px phone zoomed in`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expect(page.locator("#splash-title")).toBeVisible();
      await expectNoOverflow(page, `entry view @${width}`);
    });
  }
});
