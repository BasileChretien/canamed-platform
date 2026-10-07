/* tests-e2e/account-dialog.spec.js
 *
 * The account dialog OPENS, and says truthfully what "Delete account" does.
 *
 * Four reasons this spec exists:
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
 *      (style.css, "My-account dialog"). Both are pinned here, at explicit
 *      phone widths as well as at each project's own viewport.
 *   4. Nor had anybody seen its title row, which is a <header>. style.css
 *      styled the page masthead through bare `header` rules, so the row was
 *      painted as a second masthead: the navy gradient, its tricolour rule,
 *      white ink, and a close button in the muted grey meant for a light
 *      surface. The masthead rules are now `body > header`.
 *
 * Hermetic LOCAL mode has no auth at all, so no user is ever signed in and the
 * header chip that opens the dialog stays hidden. The tests stand a user in —
 * the dialog reads only `uid` and `email` — and call the app's own
 * openAccountDialog(), which is the function that was broken. The deletion
 * itself needs real rules and a real account: that is
 * tests-e2e/emulator/account-delete.spec.js.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const CODE = "ABC-123";

async function openDialog(page) {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof openAccountDialog === "function" && typeof dbInit === "function");
  await page.evaluate(async (code) => {
    dbInit();
    /* `currentUser` is a script-scope `let`, so this assigns the app's own
       binding. */
    currentUser = { uid: "u_local", email: "local@example.test", isAnonymous: false };
    await db.ref("users/u_local/history/" + code).set({ code, joinedAt: Date.now() });
    openAccountDialog();
  }, CODE);
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
    run on every project, as tests-e2e/splash-overflow.spec.js does. Each
    project's own viewport is added to them, for the tablet and the desktop. */
const PHONE_WIDTHS = [320, 360, 393, 412];

test("the dialog fits every width, and a history row keeps its code and its button on one line", async ({ page }) => {
  await openDialog(page);
  /* pushSessionToHistory() stores the scenario's name with the entry, and that
     long text is what squeezed the code and the button — at desktop width too.
     The rules allow a name 80 characters of anything, so the third row carries
     one with nowhere to break. The dialog's listener is live: the rows arrive
     without reopening. */
  await page.evaluate(async () => {
    const day = 86400000, now = Date.now();
    await db.ref("users/u_local/history/XYZ-789").set({
      code: "XYZ-789", joinedAt: now - day,
      scenarioName: "A Difficult Child (Mayumi) — Step 3 of 6"
    });
    await db.ref("users/u_local/history/QRS-456").set({
      code: "QRS-456", joinedAt: now - 2 * day, scenarioName: "Pharmacovigilance".repeat(5).slice(0, 80)
    });
  });
  await expect(page.locator("#account-history .account-history-row")).toHaveCount(3);

  const own = page.viewportSize();
  for (const width of [own.width, ...PHONE_WIDTHS]) {
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
        wideFieldsets: [...inner.querySelectorAll("fieldset")]
          .filter(f => f.getBoundingClientRect().right > contentRight + 1)
          .map(f => f.querySelector("legend").textContent.trim()),
        rows: [...inner.querySelectorAll(".account-history-row")].map(li => {
          const row = li.getBoundingClientRect();
          const code = li.querySelector(".account-history-code");
          const btn = li.querySelector(".account-history-withdraw");
          const meta = li.querySelector(".account-history-meta").getBoundingClientRect();
          return {
            code: code.textContent, codeLines: lines(code), btnLines: lines(btn),
            metaBelowCode: meta.top >= code.getBoundingClientRect().bottom - 1,
            inside: [...li.children].every(c => {
              const b = c.getBoundingClientRect();
              return b.left >= row.left - 1 && b.right <= row.right + 1;
            })
          };
        })
      };
    });
    const at = `at ${width}px`;
    /* First, because it names the form that is too wide. The scroll check
       after it also catches what no box measurement shows: WebKit counts a
       <select>'s longest option toward the scroll width whatever the select is
       sized to, which is the case at 320 on the three WebKit-family projects. */
    expect(m.wideFieldsets, `${at}: no fieldset may stick out of the dialog`).toEqual([]);
    expect(m.innerScroll, `${at}: the dialog must not scroll sideways`).toBeLessThanOrEqual(m.innerClient + 1);
    expect(m.docScroll, `${at}: the page must not scroll sideways`).toBeLessThanOrEqual(m.vw + 1);
    expect(m.rows.map(r => r.code), `${at}: every session is listed`).toEqual(["ABC-123", "XYZ-789", "QRS-456"]);
    for (const r of m.rows) {
      expect(r.codeLines, `${at}: the code ${r.code} must stay on one line`).toBe(1);
      expect(r.btnLines, `${at}: the withdraw button of ${r.code} must stay on one line`).toBe(1);
      expect(r.inside, `${at}: the row of ${r.code} must contain its code, date and button`).toBe(true);
      /* The date and scenario name sit beside the code where there is room and
         on their own line under it where there is not (style.css breaks at
         720px). What keeps them from becoming a sliver between the code and the
         button is the next test's business. */
      expect(r.metaBelowCode, `${at}: where the date and scenario name of ${r.code} sit`).toBe(width <= 720);
    }
  }
});

test("enlarged text does not squeeze the date and scenario name into a sliver", async ({ page }) => {
  await openDialog(page);
  await page.evaluate(() => db.ref("users/u_local/history/XYZ-789").set({
    code: "XYZ-789", joinedAt: Date.now() - 86400000,
    scenarioName: "A Difficult Child (Mayumi) — Step 3 of 6"
  }));
  await expect(page.locator("#account-history .account-history-row")).toHaveCount(2);

  /* Desktop width on every project: this is the side-by-side layout, where the
     date and name only get what the code and the button leave. With a zero flex
     basis that was 62px (2.3em, eleven lines, a 480px row in a 240px list) at
     200% text. Below 720px the row stacks and the name has the full width. */
  await page.setViewportSize({ width: 1280, height: page.viewportSize().height });
  for (const pct of [100, 150, 175, 200]) {
    const m = await page.evaluate((pct) => {
      /* Text-only zoom, approximated through the root font size: the sizes in
         this row are rem-based. Page zoom is a different thing — it narrows the
         viewport, which lands in the stacked layout. */
      document.documentElement.style.fontSize = pct + "%";
      const inner = document.querySelector(".account-dialog-inner");
      const lines = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()]
          .filter(b => b.width > 0).map(b => Math.round(b.top))).size;
      };
      return {
        vw: window.innerWidth,
        innerScroll: inner.scrollWidth, innerClient: inner.clientWidth,
        rows: [...inner.querySelectorAll(".account-history-row")].map(li => {
          const row = li.getBoundingClientRect();
          const code = li.querySelector(".account-history-code");
          const meta = li.querySelector(".account-history-meta");
          return {
            code: code.textContent, codeLines: lines(code),
            btnLines: lines(li.querySelector(".account-history-withdraw")),
            metaEm: meta.getBoundingClientRect().width / parseFloat(getComputedStyle(meta).fontSize),
            inside: [...li.children].every(c => {
              const b = c.getBoundingClientRect();
              return b.left >= row.left - 1 && b.right <= row.right + 1;
            })
          };
        })
      };
    }, pct);
    const at = `at ${pct}% text`;
    expect(m.vw, "the viewport is the desktop one").toBe(1280);
    expect(m.innerScroll, `${at}: the dialog must not scroll sideways`).toBeLessThanOrEqual(m.innerClient + 1);
    expect(m.rows.map(r => r.code), `${at}: every session is listed`).toEqual(["ABC-123", "XYZ-789"]);
    for (const r of m.rows) {
      // A date alone is about 5em; less than that is a column of fragments.
      expect(r.metaEm, `${at}: the date and scenario name of ${r.code} need a readable column`).toBeGreaterThanOrEqual(5);
      expect(r.codeLines, `${at}: the code ${r.code} must stay on one line`).toBe(1);
      expect(r.btnLines, `${at}: the withdraw button of ${r.code} must stay on one line`).toBe(1);
      expect(r.inside, `${at}: the row of ${r.code} must contain its code, date and button`).toBe(true);
    }
  }
});

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
