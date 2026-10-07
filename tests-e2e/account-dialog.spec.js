/* tests-e2e/account-dialog.spec.js
 *
 * The account dialog OPENS, and says truthfully what "Delete account" does.
 *
 * Five reasons this spec exists:
 *
 *   1. Nothing opened this dialog in a browser. `_historyListenerRef` lost its
 *      declaration in #264 (2026-07-31); from then on openAccountDialog() threw
 *      a ReferenceError before reaching dialogShow(), so the profile editor,
 *      sign-out, "Delete account" and the per-session withdrawal button were
 *      all unreachable in production — for over two months, with every check
 *      green. The controls were covered only by tests that looked for their
 *      markup.
 *   2. The dialog's standing text described deletion as removing "your profile
 *      and history" and said session contributions were "no longer linked to
 *      your identity". Neither was accurate (see tests/account-delete.test.js).
 *      The replacement text is longer, so it is checked for overflow on every
 *      viewport.
 *   3. Because nothing opened it, nobody had seen it on a phone either. The
 *      profile form stuck out of the dialog, which scrolled sideways, and a
 *      history row broke its session code and its withdraw button across lines
 *      (style.css, "My-account dialog"). Both are pinned here: at explicit
 *      widths as well as each project's own viewport, under each of the three
 *      languages the withdraw button is labelled in, with a sign-in address
 *      and scenario names as long as real ones, and with text enlarged.
 *   4. Nor had anybody seen its title row, which is a <header>. style.css
 *      styled the page masthead through bare `header` rules, so the row was
 *      painted as a second masthead: the navy gradient, its tricolour rule,
 *      white ink, and a close button in the muted grey meant for a light
 *      surface. The masthead rules are now `body > header`.
 *   5. Once it could open again, it could still only be opened from INSIDE a
 *      session: its one caller was the header chip, and `body.locked` hides the
 *      whole header until a session code has been accepted. A signed-in person
 *      on the front page — which is where someone coming back weeks later to
 *      withdraw or delete lands, possibly with a code that has since been
 *      purged — had "Signed in as … Sign out" and nothing else. The front-page
 *      tests at the bottom open it through the link that row now carries.
 *
 * Hermetic LOCAL mode has no auth at all, so no user is ever signed in and
 * neither control that opens the dialog is shown. The tests stand a user in —
 * the dialog reads only `uid` and `email`. All but the last section call the
 * app's own openAccountDialog(), which is the function that was broken; the
 * front-page tests in the last section call paintUserChip() and then CLICK,
 * because there the route is the thing under test. The deletion itself needs
 * real rules and a real account: tests-e2e/emulator/account-delete.spec.js.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const CODE = "ABC-123";

async function openDialog(page, email) {
  await page.goto("/");
  await openDialogOnThisPage(page, email);
}

async function openDialogOnThisPage(page, email = "local@example.test") {
  await page.waitForFunction(() =>
    typeof dbInit === "function" && !!(window.CanamedLoader && window.CanamedLoader.ensureAccountUI));
  await page.evaluate(async ([code, email]) => {
    dbInit();
    /* `currentUser` is a script-scope `let`, so this assigns the app's own
       binding. */
    currentUser = { uid: "u_local", email, isAnonymous: false };
    await db.ref("users/u_local/history/" + code).set({ code, joinedAt: Date.now() });
    /* openAccountDialog() is in the lazy account-ui.js: fetched first, the way
       the page's own openers do it. */
    await window.CanamedLoader.ensureAccountUI();
    openAccountDialog();
  }, [CODE, email]);
}

test("the account dialog opens and lists joined sessions with a withdraw control", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));

  await openDialog(page);

  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("local@example.test");
  // The history is painted by loadHistoryForDialog() — the function that threw.
  await expect(page.locator("#account-history .account-history-code")).toHaveText(CODE);
  /* The only in-product route a signed-in participant has to withdraw from a
     session once it is over (DPA Annex VI, G12). */
  await expect(page.locator("#account-history .account-history-withdraw")).toBeVisible();

  // Closing reads the same variable, AFTER it has hidden the dialog — so a
  // broken close would still look closed. The error list is what catches it.
  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  expect(errors, "opening and closing the dialog must not throw").toEqual([]);
});

test("the dialog says what Delete account removes and what it does not, without overflowing", async ({ page }) => {
  await openDialog(page);

  const scope = page.locator("#account-delete-scope");
  await scope.scrollIntoViewIfNeeded();
  await expect(scope).toBeVisible();
  await expect(scope).toContainText("every scenario you authored");
  await expect(scope).toContainText("shared library");
  await expect(scope).toContainText("does not remove");
  await expect(scope).toContainText("the name you joined under");
  await expect(scope).toContainText("reports you filed");
  await expect(scope).not.toContainText("no longer linked");
  // The route to have the rest erased has to be reachable from here.
  await expect(scope.locator("a")).toHaveAttribute("href", /privacy/);

  await expect(page.locator("#account-delete-btn")).toBeVisible();

  /* The paragraph roughly tripled in length. The dialog must still not scroll
     sideways, and the text must wrap inside its own box, stay inside the
     fieldset that holds it, and leave the destructive button unclipped. The
     paragraph checks stay alongside the whole-dialog one because they are the
     more sensitive: text overflowing its paragraph only widens the dialog's
     scroll area once it has also crossed the fieldset's and the dialog's
     padding — 43px, measured, in all three engines. */
  const m = await page.evaluate(() => {
    const inner = document.querySelector(".account-dialog-inner");
    const p = document.getElementById("account-delete-scope");
    const zone = p.closest("fieldset").getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const btn = document.getElementById("account-delete-btn").getBoundingClientRect();
    return {
      innerScroll: inner.scrollWidth, innerClient: inner.clientWidth,
      pScroll: p.scrollWidth, pClient: p.clientWidth,
      pLeft: pr.left, pRight: pr.right, zoneLeft: zone.left, zoneRight: zone.right,
      btnLeft: btn.left, btnRight: btn.right,
      docScroll: document.documentElement.scrollWidth, vw: window.innerWidth
    };
  });
  expect(m.innerScroll, "the dialog must not scroll sideways").toBeLessThanOrEqual(m.innerClient + 1);
  expect(m.pScroll, "the text must wrap, not overflow its own box").toBeLessThanOrEqual(m.pClient + 1);
  expect(m.pLeft, "the text must stay inside its fieldset").toBeGreaterThanOrEqual(m.zoneLeft);
  expect(m.pRight, "the text must stay inside its fieldset").toBeLessThanOrEqual(m.zoneRight + 1);
  expect(m.zoneRight, "that fieldset must be inside the viewport").toBeLessThanOrEqual(m.vw + 1);
  expect(m.btnLeft).toBeGreaterThanOrEqual(0);
  expect(m.btnRight, "Delete account must not be clipped").toBeLessThanOrEqual(m.vw + 1);
  expect(m.docScroll, "the page must not scroll sideways").toBeLessThanOrEqual(m.vw + 1);
});

/** Phone widths that matter — iPhone SE, small Android, iPhone 14 Pro, Pixel 7 —
    run on every project, as tests-e2e/splash-overflow.spec.js does, and then
    the two sides of the 720px break in style.css. At 700 the dialog is already
    at its full width, so only the break — not a lack of room — stacks the row;
    without a width there, neither the break nor the stacked layout's
    `flex-basis: 100%` is exercised by anything. Each project's own viewport is
    added to them, for the tablet and the desktop. */
const TESTED_WIDTHS = [320, 360, 393, 412, 700, 760];

/* A participant reads the withdraw button in their browser's language, and the
   three labels differ in width by a factor of two (French is the longest). A
   layout that holds under one of them proves little about the others. */
const LOCALES = ["en-US", "fr-FR", "ja-JP"];
const ENGLISH_LABEL = "Withdraw consent";

/* University addresses run past fifty characters, and one with no hyphen has
   nowhere to break. */
const LONG_EMAIL = "given.second.third.familyname.u4@s.mail.exampleuniversity.test";

/* pushSessionToHistory() stores the scenario's name with the entry, and that
   long text is what squeezed the code and the button — at desktop width too.
   The rules allow a name 80 characters of anything: one row carries two section
   names joined the way a multi-section session joins them, cut at that limit,
   and one carries 80 characters with nowhere to break. */
const NAMED_SESSIONS = [
  { code: "XYZ-789", scenarioName: "A Difficult Child (Mayumi) — Step 3 of 6" },
  { code: "LNG-080", scenarioName: ("A Difficult Child (Mayumi) — Step 1 of 6 + " +
                                    "A Difficult Child (Mayumi) — Step 2 of 6").slice(0, 80) },
  { code: "QRS-456", scenarioName: "Pharmacovigilance".repeat(5).slice(0, 80) }
];
const ALL_CODES = [CODE, ...NAMED_SESSIONS.map(r => r.code)];

/* Opens the dialog in the context's language with the named sessions listed.
   The withdraw label comes from a lazily loaded locale chunk: opening before
   it has arrived would measure the English label under a French heading. */
async function openDialogWithHistory(page, locale, email) {
  await page.goto("/");
  if (!locale.startsWith("en")) {
    await page.waitForFunction((english) =>
      typeof t === "function" && t("data-rights.withdraw-btn-short") !== english, ENGLISH_LABEL);
  }
  await openDialogOnThisPage(page, email);
  /* The dialog's listener is live: the rows arrive without reopening. */
  await page.evaluate(async (rows) => {
    const day = 86400000, now = Date.now();
    for (let i = 0; i < rows.length; i++) {
      await db.ref("users/u_local/history/" + rows[i].code).set({ ...rows[i], joinedAt: now - (i + 1) * day });
    }
  }, NAMED_SESSIONS);
  await expect(page.locator("#account-history .account-history-row")).toHaveCount(ALL_CODES.length);
  const label = await page.locator("#account-history .account-history-withdraw").first().textContent();
  if (locale.startsWith("en")) expect(label).toBe(ENGLISH_LABEL);
  else expect(label, `the withdraw label must be the ${locale} one`).not.toBe(ENGLISH_LABEL);
}

for (const locale of LOCALES) {
  test.describe(`the dialog's layout under the ${locale} labels`, () => {
    test.use({ locale });

    test("the dialog fits every width, and a history row keeps its code and its button on one line", async ({ page }) => {
      await openDialogWithHistory(page, locale, LONG_EMAIL);
      await expect(page.locator("#account-email")).toHaveText(LONG_EMAIL);

      const own = page.viewportSize();
      for (const width of [own.width, ...TESTED_WIDTHS]) {
        await page.setViewportSize({ width, height: own.height });
        const m = await page.evaluate(() => {
          const inner = document.querySelector(".account-dialog-inner");
          const contentRight = inner.getBoundingClientRect().right -
            parseFloat(getComputedStyle(inner).paddingRight);
          // The number of line boxes an element's text occupies.
          const lines = (el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set([...range.getClientRects()]
              .filter(b => b.width > 0).map(b => Math.round(b.top))).size;
          };
          return {
            vw: window.innerWidth, docScroll: document.documentElement.scrollWidth,
            innerScroll: inner.scrollWidth, innerClient: inner.clientWidth,
            emailOver: Math.round(document.getElementById("account-email").getBoundingClientRect().right - contentRight),
            wideFieldsets: [...inner.querySelectorAll("fieldset")]
              .filter(f => f.getBoundingClientRect().right > contentRight + 1)
              .map(f => f.querySelector("legend").textContent.trim()),
            rows: [...inner.querySelectorAll(".account-history-row")].map(li => {
              const row = li.getBoundingClientRect();
              const code = li.querySelector(".account-history-code");
              const btn = li.querySelector(".account-history-withdraw");
              const c = code.getBoundingClientRect(), b = btn.getBoundingClientRect();
              const meta = li.querySelector(".account-history-meta").getBoundingClientRect();
              return {
                code: code.textContent, codeLines: lines(code), btnLines: lines(btn),
                metaBelowCode: meta.top >= c.bottom - 1,
                metaBetweenCodeAndButton: meta.left >= c.right - 1 && b.left >= meta.right - 1,
                buttonAboveMeta: b.top < meta.top - 1,
                inside: [...li.children].every(child => {
                  const r = child.getBoundingClientRect();
                  return r.left >= row.left - 1 && r.right <= row.right + 1;
                })
              };
            })
          };
        });
        const at = `at ${width}px`;
        expect(m.vw, `${at}: the resize took effect`).toBe(width);
        /* The named checks come first, because they say what is too wide. The
           scroll check after them also catches what no box measurement shows:
           WebKit counts a <select>'s longest option toward the scroll width
           whatever the select is sized to, which is the case at 320 on the three
           WebKit-family projects. */
        expect(m.emailOver, `${at}: the sign-in address must wrap inside the dialog`).toBeLessThanOrEqual(1);
        expect(m.wideFieldsets, `${at}: no fieldset may stick out of the dialog`).toEqual([]);
        expect(m.innerScroll, `${at}: the dialog must not scroll sideways`).toBeLessThanOrEqual(m.innerClient + 1);
        expect(m.docScroll, `${at}: the page must not scroll sideways`).toBeLessThanOrEqual(m.vw + 1);
        expect(m.rows.map(r => r.code), `${at}: every session is listed`).toEqual(ALL_CODES);
        for (const r of m.rows) {
          expect(r.codeLines, `${at}: the code ${r.code} must stay on one line`).toBe(1);
          expect(r.btnLines, `${at}: the withdraw button of ${r.code} must stay on one line`).toBe(1);
          expect(r.inside, `${at}: the row of ${r.code} must contain its code, date and button`).toBe(true);
          /* Where there is room (style.css breaks at 720px) the date and scenario
             name sit between the code and the button. Where there is not, they go
             last, on their own line: under the code AND under the button. */
          if (width > 720) {
            expect(r.metaBetweenCodeAndButton, `${at}: the date and name of ${r.code} sit between its code and its button`).toBe(true);
            expect(r.metaBelowCode, `${at}: the date and name of ${r.code} share the code's line`).toBe(false);
          } else {
            expect(r.metaBelowCode, `${at}: the date and name of ${r.code} go under its code`).toBe(true);
            expect(r.buttonAboveMeta, `${at}: the button of ${r.code} comes before its date and name`).toBe(true);
          }
        }
      }
    });

    test("enlarged text never leaves the date and scenario name less than their floor", async ({ page }) => {
      await openDialogWithHistory(page, locale);

      /* Desktop width on every project: the side-by-side layout, where the date
         and name get what the code and the button leave. With a zero flex basis
         that fell to 25px (thirty-one lines) at 221% text. The floor is the
         basis style.css gives the column, 20 zeros of its own font: once less
         than that is left, the button wraps to the next line instead.

         Text-only zoom and a larger default font are approximated through the
         root font size — every size in the row is rem-based or inherited, and the
         gaps and the dialog's width are px, as they are for a real user. Page
         zoom is not this case: it scales the dialog with the text, so the row is
         simply the 100% layout. */
      await page.setViewportSize({ width: 1280, height: page.viewportSize().height });
      const result = await page.evaluate(() => {
        const root = document.documentElement;
        const inner = document.querySelector(".account-dialog-inner");
        const basePx = parseFloat(getComputedStyle(root).fontSize);
        const lines = (el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()]
            .filter(b => b.width > 0).map(b => Math.round(b.top))).size;
        };
        const out = { vw: window.innerWidth, sizes: 0, rows: 0, narrowestOverFloor: Infinity, violations: [] };
        for (let pct = 100; pct <= 300; pct += 5) {
          root.style.fontSize = pct + "%";
          out.sizes++;
          const rootPx = parseFloat(getComputedStyle(root).fontSize);
          if (Math.abs(rootPx - basePx * pct / 100) > 0.5) {
            out.violations.push(`${pct}%: the text was not enlarged (root font ${rootPx}px)`);
          }
          if (inner.scrollWidth > inner.clientWidth + 1) {
            out.violations.push(`${pct}%: the dialog scrolls sideways (${inner.scrollWidth} > ${inner.clientWidth})`);
          }
          for (const li of inner.querySelectorAll(".account-history-row")) {
            out.rows++;
            const row = li.getBoundingClientRect();
            const code = li.querySelector(".account-history-code");
            const meta = li.querySelector(".account-history-meta");
            const name = code.textContent;
            const probe = document.createElement("span");
            probe.style.cssText = "position:absolute;visibility:hidden;width:20ch";
            meta.appendChild(probe);
            const floor = probe.getBoundingClientRect().width;
            probe.remove();
            const width = meta.getBoundingClientRect().width;
            out.narrowestOverFloor = Math.min(out.narrowestOverFloor, width - floor);
            if (width < floor - 1) {
              out.violations.push(`${pct}%: ${name}: the date and name have ${Math.round(width)}px, under their ${Math.round(floor)}px floor`);
            }
            if (lines(code) !== 1) out.violations.push(`${pct}%: ${name}: the code is broken across lines`);
            if (lines(li.querySelector(".account-history-withdraw")) !== 1) {
              out.violations.push(`${pct}%: ${name}: the withdraw button is broken across lines`);
            }
            for (const child of li.children) {
              const r = child.getBoundingClientRect();
              if (r.left < row.left - 1 || r.right > row.right + 1) {
                out.violations.push(`${pct}%: ${name}: ${child.className} sticks out of its row`);
              }
            }
          }
        }
        return out;
      });
      expect(result.vw, "the viewport is the desktop one").toBe(1280);
      // 100% to 300% in steps of 5, four sessions each: the loop cannot have run empty.
      expect(result.sizes).toBe(41);
      expect(result.rows).toBe(41 * ALL_CODES.length);
      expect(result.violations.length, result.violations.slice(0, 6).join("\n")).toBe(0);
      // The floor is reached, not merely cleared from a distance: some size in
      // the sweep leaves the column within a few px of it.
      expect(result.narrowestOverFloor, "the sweep samples the floor itself").toBeLessThan(12);
    });

    test("on a phone, enlarged text does not make the dialog scroll sideways", async ({ page }) => {
      await openDialogWithHistory(page, locale, LONG_EMAIL);
      // A closed dialog measures 0 against 0 and would pass every size below.
      await expect(page.locator("#account-dialog")).toBeVisible();

      /* The width test above runs at 100% text and the sweep above at desktop
         width; neither sees a phone with enlarged text, where a word that
         cannot break is the first thing to stick out. At 320px the dialog
         scrolled by 37px at 150% and by 106px at 200%: the two role options
         side by side, and the one unbreakable token in the security hint.

         Only the dialog is asserted on. The page behind it is the splash, which
         scrolls sideways by itself at these sizes, dialog open or closed (370px
         of content in a 320px viewport at 150%); that is the splash's defect,
         and asserting it here would make this test fail for a reason that is
         not the dialog's. */
      const height = page.viewportSize().height;
      for (const width of [320, 360, 393]) {
        await page.setViewportSize({ width, height });
        const result = await page.evaluate(() => {
          const root = document.documentElement;
          const inner = document.querySelector(".account-dialog-inner");
          root.style.fontSize = "";
          const basePx = parseFloat(getComputedStyle(root).fontSize);
          const out = { vw: window.innerWidth, sizes: 0, violations: [] };
          for (let pct = 100; pct <= 200; pct += 5) {
            root.style.fontSize = pct + "%";
            out.sizes++;
            const rootPx = parseFloat(getComputedStyle(root).fontSize);
            if (Math.abs(rootPx - basePx * pct / 100) > 0.5) {
              out.violations.push(`${pct}%: the text was not enlarged (root font ${rootPx}px)`);
            }
            const over = inner.scrollWidth - inner.clientWidth;
            if (over > 1) {
              // Name what reaches furthest right, so the failure says where to look.
              const contentRight = inner.getBoundingClientRect().right -
                parseFloat(getComputedStyle(inner).paddingRight);
              let worst = { right: -Infinity, what: "" };
              for (const el of inner.querySelectorAll("*")) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right >= worst.right) {
                  worst = { right: r.right, what: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
                    ` "${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28)}"` };
                }
              }
              out.violations.push(`${pct}%: the dialog scrolls sideways by ${over}px; furthest right is ` +
                `${worst.what}, ${Math.round(worst.right - contentRight)}px past the content edge`);
            }
          }
          root.style.fontSize = "";
          return out;
        });
        expect(result.vw, `at ${width}px: the resize took effect`).toBe(width);
        // 100% to 200% in steps of 5: the loop cannot have run empty.
        expect(result.sizes).toBe(21);
        expect(result.violations.length, `at ${width}px:\n` + result.violations.slice(0, 4).join("\n")).toBe(0);
      }
    });
  });
}

const THEMES = ["light", "dark", "high-contrast"];

/** WCAG contrast of one of an element's own colours (`prop`) against what it
    is drawn on: the nearest painted background at or above `from`. A
    background IMAGE met on the way is reported in `ground`, with no ratio —
    a gradient is not a colour to take a ratio against. Looking through it to
    the background-color behind is how white text on a navy band comes out as
    white on white, or grey on navy as grey on white. */
async function inkOn(page, selector, prop = "color", from = "self") {
  return page.evaluate(([sel, prop, from]) => {
    const el = document.querySelector(sel);
    const rgba = (s) => {
      const n = (s.match(/[\d.]+/g) || []).map(Number);
      return n.length < 4 ? [...n, 1] : n;
    };
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ink = getComputedStyle(el)[prop];
    for (let n = from === "parent" ? el.parentElement : el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return { ink, ground: s.backgroundImage, ratio: null };
      const c = rgba(s.backgroundColor);
      if (c[3] === 0) continue;
      // A translucent fill is no more a single colour than a gradient is.
      if (c[3] < 1) return { ink, ground: s.backgroundColor, ratio: null };
      const a = lum(rgba(ink)), b = lum(c);
      return { ink, ground: s.backgroundColor, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    }
    return { ink, ground: "nothing painted", ratio: null };
  }, [selector, prop, from]);
}

test("the title row is drawn on the dialog, not as a second masthead", async ({ page }) => {
  await openDialog(page);
  for (const theme of THEMES) {
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    const m = await page.evaluate(() => {
      const css = (sel) => getComputedStyle(document.querySelector(sel));
      const head = css(".account-dialog-head");
      return {
        masthead: css("body > header").backgroundImage,
        image: head.backgroundImage, rule: head.borderBottomWidth, shadow: head.boxShadow,
        dialog: css("#account-dialog").backgroundColor
      };
    });
    const at = `${theme} theme`;
    /* The control. The masthead keeps its gradient in every theme, so "the
       title row has none" below is a statement about the row — not about a
       stylesheet that failed to load, or a fix that unstyled the masthead. */
    expect(m.masthead, `${at}: the page masthead keeps its gradient`).toContain("gradient");
    expect(m.image, `${at}: the title row must not paint the masthead's background`).toBe("none");
    expect(m.rule, `${at}: nor carry the masthead's rule under it`).toBe("0px");
    expect(m.shadow, `${at}: nor its shadow`).toBe("none");

    /* What a person reads there: the title and the close button, both on the
       dialog's own surface. 4.5:1 for each — the "×" is the only way a pointer
       user has to see where the dialog closes. */
    for (const [what, sel] of [["title", "#account-dialog-title"], ["close button", "#account-dialog-close"]]) {
      const c = await inkOn(page, sel);
      expect(c.ground, `${at}: the ${what} must sit on the dialog's surface`).toBe(m.dialog);
      expect(c.ratio, `${at}: the ${what} (${c.ink} on ${c.ground})`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("the close button's focus ring shows on the dialog", async ({ page }) => {
  /* The masthead turns the focus ring of whatever it holds white, to show on
     navy. Inherited by the title row and left there once the row stops being
     navy, that is a white ring on a white dialog — no ring at all. */
  await openDialog(page);
  const close = page.locator("#account-dialog-close");
  /* Away and back with the keyboard: :focus-visible is certain only for a
     focus that the keyboard moved. */
  await close.focus();
  await page.keyboard.press("Tab");
  await expect(close).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  expect(await close.evaluate(el => el.matches(":focus-visible")),
    "the close button must be showing its focus ring").toBe(true);

  for (const theme of THEMES) {
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    const ring = await close.evaluate(el => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    const at = `${theme} theme`;
    expect(ring.style, `${at}: a ring is drawn`).not.toBe("none");
    expect(ring.width, `${at}: a ring is drawn`).toBeGreaterThanOrEqual(2);
    // The ring is drawn outside the button, so on what the button sits on.
    const c = await inkOn(page, "#account-dialog-close", "outlineColor", "parent");
    const surface = await page.evaluate(() =>
      getComputedStyle(document.getElementById("account-dialog")).backgroundColor);
    expect(c.ground, `${at}: the ring must be drawn on the dialog's surface`).toBe(surface);
    // WCAG 1.4.11: 3:1 for the indicator of a control's state.
    expect(c.ratio, `${at}: the ring (${c.ink} on ${c.ground})`).toBeGreaterThanOrEqual(3);
  }
});

test("Delete account asks nothing where there is no auth backend (LOCAL mode)", async ({ page }) => {
  /* What this covers is the `!auth` guard, and only that: the tests stand a
     USER in, but LOCAL mode never assigns `auth`. The button's shim must return
     before asking anything — and before fetching the lazy deletion code — when
     there is no account system behind it. A confirm appearing here would be a
     prompt to delete an account that does not exist. */
  const dialogs = [];
  page.on("dialog", d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await openDialog(page);
  await page.locator("#account-delete-btn").scrollIntoViewIfNeeded();
  await page.locator("#account-delete-btn").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => typeof window.deleteMyAccount),
    "the lazy chunk must not be fetched for a click that can do nothing").toBe("undefined");
});

/* ---- reaching the dialog from the front page ------------------------------ */

/* Stand a user in on the front page and paint the signed-in row, as the app's
   own auth-state handler does. No session code is entered at any point. */
async function signedInOnFrontPage(page, user) {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof paintUserChip === "function" && typeof dbInit === "function");
  await page.evaluate(async ({ user, code }) => {
    dbInit();
    currentUser = Object.assign({ uid: "u_local", isAnonymous: false }, user);
    await db.ref("users/u_local/history/" + code).set({ code, joinedAt: Date.now() });
    paintUserChip();
  }, { user, code: CODE });
}

test("a signed-in user opens the dialog from the front page, without a session code", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));

  await signedInOnFrontPage(page, { email: "local@example.test" });

  /* Positive control for "not in a session": the page is still locked, so the
     header — and the chip in it, which paintUserChip() has just un-hidden — is
     not displayed. Without this the test would pass just as well from inside a
     session, where the dialog was always reachable. */
  await expect(page.locator("body")).toHaveClass(/(^|\s)locked(\s|$)/);
  await expect(page.locator("#user-chip")).not.toHaveClass(/hidden/);
  await expect(page.locator("#user-chip")).toBeHidden();

  const link = page.locator("#splash-signed-in-account");
  await expect(link).toBeVisible();
  // The text, not just the element: a missing i18n key renders as the raw key.
  await expect(link).toHaveText("Account");
  await link.click();

  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("local@example.test");
  /* What a returning participant comes for: the per-session withdrawal control
     and Delete account, both reachable with no working session code. */
  await expect(page.locator("#account-history .account-history-code")).toHaveText(CODE);
  await expect(page.locator("#account-history .account-history-withdraw")).toBeVisible();
  await page.locator("#account-delete-btn").scrollIntoViewIfNeeded();
  await expect(page.locator("#account-delete-btn")).toBeVisible();

  await page.locator("#account-dialog-close").click();
  await expect(page.locator("#account-dialog")).toBeHidden();
  // Still on the front page, still locked: opening it must not have let anyone in.
  await expect(page.locator("body")).toHaveClass(/(^|\s)locked(\s|$)/);
  await expect(page.locator("#splash")).toBeVisible();
  expect(errors, "opening the dialog from the front page must not throw").toEqual([]);
});

test("the signed-in row keeps both of its links inside the card, whatever the name", async ({ page }) => {
  /* The row shows the profile name, or the e-mail address when there is no
     profile yet — and an institutional address has no break opportunity for
     fifty characters. The row grew a third item; on a phone it has to wrap
     rather than push "Sign out" out of the card. */
  await signedInOnFrontPage(page,
    { email: "firstname.middlename.familyname.u4@student.mail.example-university.test" });

  const row = page.locator("#splash-signed-in");
  await expect(row).toBeVisible();
  await expect(page.locator("#splash-signed-in-name"))
    .toHaveText("firstname.middlename.familyname.u4@student.mail.example-university.test");
  await expect(page.locator("#splash-signed-in-account")).toBeVisible();
  await expect(page.locator("#splash-signed-in-out")).toBeVisible();

  const m = await page.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    const row = box("splash-signed-in");
    const card = document.querySelector(".splash-card").getBoundingClientRect();
    const name = box("splash-signed-in-name"), acct = box("splash-signed-in-account"),
          out = box("splash-signed-in-out");
    return {
      rowLeft: row.left, rowRight: row.right, cardLeft: card.left, cardRight: card.right,
      nameLeft: name.left, nameRight: name.right,
      acctLeft: acct.left, acctRight: acct.right, acctTop: acct.top, acctBottom: acct.bottom,
      outLeft: out.left, outRight: out.right, outTop: out.top, outBottom: out.bottom,
      docScroll: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth
    };
  });
  expect(m.rowLeft, "the row must stay inside the card").toBeGreaterThanOrEqual(m.cardLeft - 1);
  expect(m.rowRight, "the row must stay inside the card").toBeLessThanOrEqual(m.cardRight + 1);
  expect(m.nameLeft, "the name must stay inside the row").toBeGreaterThanOrEqual(m.rowLeft - 1);
  expect(m.nameRight, "the name must wrap, not run out of the row").toBeLessThanOrEqual(m.rowRight + 1);
  for (const [what, l, r] of [["Account", m.acctLeft, m.acctRight], ["Sign out", m.outLeft, m.outRight]]) {
    expect(l, what + " must stay inside the row").toBeGreaterThanOrEqual(m.rowLeft - 1);
    expect(r, what + " must stay inside the row").toBeLessThanOrEqual(m.rowRight + 1);
  }
  /* Two tap targets, not one: they may share a line or sit on two, but their
     boxes must not overlap. */
  const sameLine = m.acctTop < m.outBottom && m.outTop < m.acctBottom;
  if (sameLine) {
    expect(m.acctRight, "Account and Sign out must not overlap").toBeLessThanOrEqual(m.outLeft + 1);
  }
  expect(m.docScroll, "the page must not scroll sideways").toBeLessThanOrEqual(m.vw + 1);
});
