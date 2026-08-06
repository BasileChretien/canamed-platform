/* tests-e2e/org-session-e2e.spec.js
 *
 * DOES THE MULTI-TENANT `orgs/` SUBTREE ACTUALLY WORK?
 *
 * Until this spec, nothing had ever driven an org-scoped session. The whole
 * `orgs/…` half of database.rules.json, `_sessionPrefix()`, `oPath()`,
 * `adminSecretPath()`, `roomChatPath()` and `certIdPath()` was verified by
 * INSPECTION and by unit tests on path DERIVATION — never by running a
 * session. Two things made that impossible:
 *
 *   1. scripts/serve-platform.js had no `/o/**` route, so `/o/<slug>/`
 *      returned 404 and the page could not even load. (Fixed alongside this
 *      spec; pinned by tests/serve-platform-routing.test.js.)
 *   2. orgs.js registers exactly ONE org — `caen-nagoya` — and that IS
 *      `CANAMED_DEFAULT_ORG`, which `canamedSessionPrefix()` maps back to the
 *      legacy `sessions/` prefix. So no client shipped today can produce an
 *      `orgs/…` path at all.
 *
 * (2) is solved WITHOUT touching orgs.js — that file is production config and
 * must not gain a fake partnership. Instead the test installs a `configurable`
 * accessor for `window.CANAMED_ORGS` whose SETTER augments whatever orgs.js
 * assigns (see `pinLocalOrg`). A plain pre-assignment would be overwritten by
 * orgs.js's `root.CANAMED_ORGS = {…}`, and a getter-only property would make
 * that assignment THROW inside orgs.js's "use strict" IIFE.
 *
 * What is proved here, on a REAL two-section session driven through the real
 * UI at `/o/e2e-org/`:
 *   1. a facilitator creates and a participant joins under the org URL;
 *   2. every write lands under `orgs/e2e-org/sessions/<code>/…` — asserted by
 *      reading the DATABASE (both through the app's own db handle at a
 *      LITERAL org path, and out of the raw LocalDB store), not inferred
 *      from the UI;
 *   3. NOTHING is written under the legacy top-level `sessions/<code>/…`;
 *   4. each section's answers route to their own slot inside the org tree
 *      (same shape as answers-bucket-routing.spec.js, one tenant deeper);
 *   5. the READ path returns them — traced to the file the student downloads
 *      and to the visible wrap-up, not to a populated object.
 *
 * CONTROL RUN — set CANAMED_ORG_SABOTAGE=1 to break org routing on purpose
 * (`window.canamedSessionPrefix` is forced to return "sessions/", which is
 * exactly the org-blind bug this spec exists to catch). The isolation
 * assertions must FAIL under it; if they still pass, they are not testing
 * anything. `_sessionPrefix()` in script.js reads that global at CALL time,
 * so the override reaches every read and write.
 */

// @ts-check
const { test, expect } = require("@playwright/test");

const ORG_SLUG = "e2e-org";
const ORG_URL = "/o/" + ORG_SLUG + "/";
const LEGACY_PREFIX = "sessions/";
const ORG_PREFIX = "orgs/" + ORG_SLUG + "/sessions/";
const LOCALDB_KEY = "canamed_localdb_v1";

/* Two sections of different types → two different slots. Same picks as
   answers-bucket-routing.spec.js, so a failure here vs. there separates
   "org routing broke it" from "slot routing broke it". */
const PICK = ["chronic-pain-pbl", "jaundice-roleplay"];
const A_TEXT = "Org slot-1 PBL answer — mechanical low back pain, no red flags";
const B_TEXT = "Org slot-2 roleplay answer — I would ask the parent what they want to know";

/* The tenant this spec runs as. Deliberately NOT caen-nagoya: only a
   non-default slug produces an `orgs/…` prefix. */
const E2E_ORG = {
  name: "E2E Org (test tenant)",
  cohorts: [
    { id: "Lyon",  label: "Université Claude Bernard Lyon 1 (E2E)", short: "Lyon",
      country: "France", color: "#7c3aed" },
    { id: "Tokyo", label: "University of Tokyo (E2E)",              short: "Tokyo",
      country: "Japan",  color: "#0ea5e9" }
  ],
  primary: "#7c3aed",
  accent: "#0ea5e9",
  privacyEmail: "e2e@example.invalid"
};

const SABOTAGE = process.env.CANAMED_ORG_SABOTAGE === "1";

/* LOCAL mode + the extra org, pinned on a page BEFORE any of its scripts run.
   Not the shared fixture: this needs the CANAMED_ORGS accessor, and the
   student tab is a context.newPage() the fixture would not touch anyway. */
async function pinLocalOrg(p) {
  await p.addInitScript(([slug, cfg, sabotage]) => {
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value,
        set: () => { /* swallow the page's own assignment */ },
        configurable: true,
        enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);

    /* AUGMENTING accessor — orgs.js does `root.CANAMED_ORGS = {…}` inside a
       "use strict" IIFE. A swallowing setter would leave the registry empty
       (no caen-nagoya, no cohorts); a getter-only property would throw there.
       So the setter takes what orgs.js assigns and ADDS the test tenant. */
    let _orgs = { [slug]: cfg };
    Object.defineProperty(window, "CANAMED_ORGS", {
      configurable: true,
      enumerable: true,
      get: () => _orgs,
      set: (v) => { _orgs = Object.assign({}, v || {}, { [slug]: cfg }); }
    });

    if (sabotage) {
      /* CONTROL RUN ONLY — org-blind path derivation. script.js's
         _sessionPrefix() consults this global on every call. */
      pin("canamedSessionPrefix", function () { return "sessions/"; });
    }

    try {
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      localStorage.setItem("canamed_tour_student_done", "v1");
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
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
  }, [ORG_SLUG, E2E_ORG, SABOTAGE]);
}

/* The raw LocalDB store — the whole database as it is actually persisted, with
   no path helper in the way. Reading this is what makes the isolation claim a
   measurement rather than a restatement of sPath(). */
async function rawTree(tab) {
  return tab.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; }
  }, LOCALDB_KEY);
}

/* Read an ABSOLUTE database path through the app's own db handle. Literal
   string, not sPath() — so a broken sPath() cannot make this pass. */
async function readPath(tab, dbPath) {
  return tab.evaluate(
    (p) => window.db.ref(p).once("value").then((s) => s.val()),
    dbPath
  );
}

async function createSession(page, picks) {
  await pinLocalOrg(page);
  await page.goto(ORG_URL);
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Org Facilitator");
  await page.locator("#splash-create-label").fill("Org routing probe");
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

async function joinStudent(context, code) {
  const stu = await context.newPage();
  await pinLocalOrg(stu);
  await stu.goto(ORG_URL);
  await stu.locator("#splash-code").fill(code);
  await stu.locator("#splash-enter").click();
  await expect(stu.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await stu.locator("#name-input").fill("E2E Org Student");
  /* The cohort list comes from the ORG's config — proof the tenant is live in
     the UI, not just in a path string. */
  await expect(stu.locator("#uni-input")).toContainText("Université Claude Bernard Lyon 1 (E2E)");
  await expect(stu.locator("#uni-input")).toBeVisible();
  await stu.locator("#uni-input").selectOption("Lyon");
  await stu.locator("#consent-workshop").check();
  await stu.locator("#consent-research").check();
  await expect(stu.locator("#join-btn")).toBeEnabled({ timeout: 5_000 });
  await stu.locator("#join-btn").click();
  await expect(stu.locator("#waiting")).toBeVisible({ timeout: 15_000 });
  return stu;
}

async function startSession(page, stu) {
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  await page.locator("#start-session-btn").click();
  await expect(stu.locator("#app")).toBeVisible({ timeout: 20_000 });
}

/* Type + Enter, then wait for the app's OWN success signal (both writers clear
   the box only once the push resolves). Enter rather than the Add button: on
   the touch projects a tap there is intermittently swallowed. */
async function submitInto(tab, selector, text) {
  const input = tab.locator(selector);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(text);
  await input.press("Enter");
  await expect(input, "the app clears the box when the write resolves")
    .toHaveValue("", { timeout: 10_000 });
}

async function writeModuleAAnswer(stu, hypothesis, text) {
  const details = stu.locator("#chart-hypotheses");
  if (!(await details.evaluate((n) => /** @type {any} */ (n).open))) {
    await stu.locator("#chart-hypotheses > summary").click();
  }
  await submitInto(stu, "#hypothesis-input", hypothesis);
  await expect(stu.locator("#hypothesis-list")).toContainText(hypothesis, { timeout: 10_000 });
  await expect(stu.locator("#hypothesis-list")).toBeVisible();
  await expect(stu.locator("#rcol-tab-answers")).toBeVisible({ timeout: 15_000 });
  /* dispatchEvent, not a geometric click — the right-column tab chips
     hit-test unreliably on iPad, and this spec runs on mobile-ipad. */
  await stu.locator("#rcol-tab-answers").dispatchEvent("click");
  await submitInto(stu, "#answer-input-moduleA-diagnosis", text);
  await expect(stu.locator("#answers-list-moduleA-diagnosis")).toContainText(text, {
    timeout: 10_000
  });
  await expect(stu.locator("#answers-list-moduleA-diagnosis")).toBeVisible();
}

/* Record every SAME-ORIGIN asset response, with the content-type the server
   really returned. The org-asset defect is invisible to "does the page
   render" — under it the shell still paints, it is the SCRIPTS that come back
   as HTML — so the proof has to be read off the network. */
function trackAssets(p) {
  const all = [];
  const cspErrors = [];
  p.on("response", (r) => {
    let u;
    try { u = new URL(r.url()); } catch (_) { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (!/\.(?:js|css|woff2|webmanifest)$/.test(u.pathname)) return;
    all.push({
      host: u.host,
      path: u.pathname,
      status: r.status(),
      ctype: (r.headers()["content-type"] || "")
    });
  });
  p.on("console", (m) => {
    if (m.type() === "error" && /content security policy/i.test(m.text())) {
      cspErrors.push(m.text());
    }
  });
  /* Same-origin only, resolved from the page's OWN url after navigation —
     no private config API, and correct whatever PORT the run uses. */
  const firstParty = () => {
    const host = new URL(p.url()).host;
    return all.filter((a) => a.host === host);
  };
  return { firstParty, cspErrors };
}

test.describe("org-scoped session — /o/<slug>/ end to end", () => {
  /* THE PRODUCTION DEFECT THIS PINS (measured on the live deploy 2026-08-05):
   *     GET /theme-init.js               -> 200 text/javascript (1 579 B)
   *     GET /o/caen-nagoya/theme-init.js -> 200 text/html     (221 781 B)
   * index.html addressed every asset RELATIVELY, so a shell served under the
   * `/o/**` -> /index.html rewrite asked for /o/<slug>/<asset> and Hosting
   * handed back the SPA shell, which nosniff then refused to execute.
   *
   * TWO INDEPENDENT HALVES, asserted separately on purpose:
   *   (a) the STATIC shell — index.html's own src/href refs;
   *   (b) the LAZY chunks — script-loader.js's v(), which returned a BARE
   *       filename and so re-created the bug for ~30 chunks the static shell
   *       never mentions. (a) passing proves nothing about (b), which is why
   *       the control run in the PR reverts v() alone and watches ONLY the
   *       lazy assertion go red. */
  test("every asset the org shell fetches is served from the site ROOT as JS/CSS, never swallowed by the /o/** rewrite", async ({
    page
  }) => {
    await pinLocalOrg(page);
    const { firstParty, cspErrors } = trackAssets(page);
    const failures = [];
    page.on("requestfailed", (r) => failures.push(r.url()));
    await page.goto(ORG_URL);

    /* Interactive, not merely painted: the splash is live and script.js ran. */
    await expect(page.locator("#splash-go-create")).toBeVisible({ timeout: 15_000 });
    expect(failures, "no asset may fail to load under the org prefix").toEqual([]);

    // ── (a) THE STATIC SHELL — index.html's own src/href refs ───────────────
    /* Scoped to the EAGER assets by name. Deliberately not a sweep over
       everything fetched: a sweep would also catch the lazy chunks, and then
       the control run could not tell the two halves apart. */
    const at = (p) => firstParty().find((a) => a.path === p);
    for (const name of ["/theme-init.js", "/script.js", "/script-loader.js",
                        "/i18n.js", "/localdb.js", "/purify.min.js"]) {
      const hit = at(name);
      expect(hit, `${name} must be fetched at the site ROOT, not under /o/<slug>/`).toBeTruthy();
      expect(hit.status, `${name} must be served, not rewritten`).toBe(200);
      expect(
        hit.ctype,
        `${name} came back as "${hit.ctype}" — an asset served as text/html IS ` +
        `the bug: the /o/** rewrite returned the SPA shell and nosniff refuses it`
      ).toMatch(/javascript|ecmascript/);
    }
    for (const name of ["/style.css", "/tokens.css"]) {
      const hit = at(name);
      expect(hit, `${name} must be fetched at the site ROOT`).toBeTruthy();
      expect(hit.ctype, `${name} must arrive as CSS, not the SPA shell`).toMatch(/text\/css/);
    }

    // ── (b) THE LAZY CHUNKS — script-loader.js's v() ────────────────────────
    /* The half the static shell cannot cover: v() built a BARE filename, so
       every chunk resolved under /o/<slug>/ no matter how index.html was
       written. case-content.js is idle-PREFETCHED, so the request may already
       have happened — read it off the recorded responses rather than waiting
       for a new one. The call is fired without awaiting its promise: when the
       chunk arrives as HTML the script errors and the promise rejects, and the
       NETWORK evidence is what matters here, not that exception. */
    await page.evaluate(() => {
      window.CanamedLoader.ensureCaseContent().catch(() => {});
    });
    const chunkName = /case-content\.js$/;
    await expect
      .poll(() => firstParty().filter((a) => chunkName.test(a.path)).length, {
        timeout: 20_000
      })
      .toBeGreaterThan(0);

    for (const hit of firstParty().filter((a) => chunkName.test(a.path))) {
      expect(
        hit.path,
        "a LAZY chunk must be addressed at the site root too — script-loader's " +
        "v() returning a bare filename re-creates the bug for ~30 chunks"
      ).toBe("/case-content.js");
      expect(
        hit.ctype,
        `the lazy chunk came back as "${hit.ctype}" — nosniff will refuse to execute it`
      ).toMatch(/javascript|ecmascript/);
    }

    /* Fetched AND executed — a chunk refused by nosniff never builds its
       registry, so this is the consequence, not a restatement of the header. */
    await expect
      .poll(() => page.evaluate(() => !!window.CANAMED_SCENARIOS), { timeout: 15_000 })
      .toBe(true);

    // ── The user-visible consequence ────────────────────────────────────────
    /* The create view needs a SECOND lazy chunk (section-picker.js) plus the
       registry above to populate its picker. A populated control is what "the
       org page works" means to a facilitator. */
    await page.locator("#splash-go-create").click();
    const sectionAdd = page.locator("#splash-section-add");
    await expect(sectionAdd).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => sectionAdd.evaluate((n) => n.options.length), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // ── (c) THE COMBINED INVARIANT ──────────────────────────────────────────
    /* Now that both halves have been exercised, nothing at all may have been
       requested under the org prefix or served as the SPA shell. */
    expect(
      firstParty().filter((a) => a.path.startsWith("/o/")),
      "no asset may be requested under the org prefix — on Firebase Hosting " +
      "that path only ever resolves to index.html"
    ).toEqual([]);
    expect(
      firstParty().filter((a) => /text\/html/.test(a.ctype)),
      "no asset may be served as text/html"
    ).toEqual([]);

    expect(cspErrors, "root-absolute same-origin URLs must not trip script-src 'self'")
      .toEqual([]);
  });

  test("the org shell boots at /o/<slug>/ and paints the tenant's own identity", async ({
    page
  }) => {
    await pinLocalOrg(page);
    const failures = [];
    page.on("requestfailed", (r) => failures.push(r.url()));
    await page.goto(ORG_URL);

    /* The shell is alive at the org URL: script.js ran (splash rendered) and
       nothing in the head 404'd into the SPA rewrite. */
    await expect(page.locator("#splash-go-create")).toBeVisible({ timeout: 15_000 });
    expect(failures, "no asset may fail to load under the org prefix").toEqual([]);

    /* The engine resolved THIS tenant, not the default one. */
    await expect(page.locator("html")).toHaveAttribute("data-org", ORG_SLUG);
    const prefix = await page.evaluate(() => window.sPath(""));
    expect(prefix, "sPath() must be namespaced to the org").toContain(ORG_PREFIX);

    /* The "Org not found" splash must NOT be showing — a registered slug. */
    await expect(page.locator("#splash")).not.toContainText(/Org not found/i);
  });

  test("a session created at the org URL lives entirely under orgs/<slug>/ and never in the legacy tree", async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);

    const code = await createSession(page, PICK);
    const stu = await joinStudent(context, code);
    await startSession(page, stu);

    // ── Section 1 (PBL) ─────────────────────────────────────────────────────
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 2", { timeout: 20_000 });
    await writeModuleAAnswer(stu, "mechanical low back pain", A_TEXT);

    // ── Section 2 (roleplay) ────────────────────────────────────────────────
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 3", { timeout: 20_000 });
    await stu.locator("#modB-phase-next").click();
    await stu.locator("#modB-phase-next").click();
    await submitInto(stu, "#answer-input-moduleB-family-sentence", B_TEXT);
    await expect(stu.locator("#answers-list-moduleB-family-sentence")).toContainText(B_TEXT, {
      timeout: 10_000
    });
    await expect(stu.locator("#answers-list-moduleB-family-sentence")).toBeVisible();

    // ── 1. THE ADDRESS THE APP USES ─────────────────────────────────────────
    const room = await stu.evaluate(() => window.myRoom);
    /* The splash SHOWS the code upper-cased; the session id the engine stores
       is the lower-cased form. Take the id from the app so the path assertions
       compare against what is really on disk. */
    const sid = await stu.evaluate(() => window.sessionNum);
    expect(sid.toUpperCase(), "the joined session is the one that was created")
      .toBe(code.toUpperCase());
    const roomPath = await stu.evaluate(() => window.sPath("rooms/" + window.myRoom));

    /* ── 2. TENANT ISOLATION ───────────────────────────────────────────────
     * SOFT on purpose. These four are the whole point of tenant namespacing,
     * and they fail together when org routing breaks — a hard first failure
     * would hide the other three and make the control run under
     * CANAMED_ORG_SABOTAGE=1 look like a single unrelated assertion. Soft
     * still fails the test.
     */
    expect.soft(roomPath, "the room path must be org-namespaced").toBe(
      ORG_PREFIX + sid + "/rooms/" + room
    );
    expect.soft(roomPath, "…and must not be the legacy address")
      .not.toMatch(new RegExp("^" + LEGACY_PREFIX));

    /* Read the legacy address through the app's own db handle: an org
       session must have put nothing there. */
    const legacy = await readPath(stu, LEGACY_PREFIX + sid);
    expect.soft(legacy, "an org session must write NOTHING under sessions/<code>").toBeNull();

    /* And out of the RAW store, so no path helper is trusted. The whole key
       list, because a leak under any other legacy session id is a defect too. */
    const tree = await rawTree(stu);
    expect.soft(
      Object.keys(tree.sessions || {}),
      "the legacy sessions/ tree must be untouched by an org session"
    ).toEqual([]);

    // ── 3. THE DATABASE, READ AT A LITERAL ORG PATH ─────────────────────────
    const orgRoot = ORG_PREFIX + sid;
    const sections = await readPath(stu, orgRoot + "/rooms/" + room + "/answers/sections");
    expect(sections, "the org tree must hold the room's answers").toBeTruthy();
    const slotTexts = (slot) =>
      Object.values((sections || {})[slot] || {}).map((e) => (e || {}).text);
    expect(slotTexts("1"), "section 1's answer belongs to slot 1").toContain(A_TEXT);
    expect(slotTexts("2"), "section 2's answer belongs to slot 2").toContain(B_TEXT);
    expect(slotTexts("1"), "slot 1 must not carry section 2's answer").not.toContain(B_TEXT);
    expect(slotTexts("2"), "slot 2 must not carry section 1's answer").not.toContain(A_TEXT);

    /* The session's own bookkeeping is org-side too, not only its answers. */
    const orgSession = await readPath(stu, orgRoot);
    expect(orgSession, "the whole session record must live in the org tree").toBeTruthy();
    expect(Object.keys(orgSession)).toEqual(
      expect.arrayContaining(["created", "pool", "rooms", "started"])
    );

    /* The same thing spelled out segment by segment in the raw store. */
    expect(Object.keys(tree.orgs || {}), "the org bucket must exist").toContain(ORG_SLUG);
    expect(
      Object.keys((tree.orgs || {})[ORG_SLUG].sessions || {}),
      "…and hold this session"
    ).toContain(sid);
    const rawSlots =
      tree.orgs[ORG_SLUG].sessions[sid].rooms[room].answers.sections;
    expect(Object.values(rawSlots["1"]).map((e) => e.text)).toContain(A_TEXT);
    expect(Object.values(rawSlots["2"]).map((e) => e.text)).toContain(B_TEXT);

    /* WHICH NODES DOES AN ORG SESSION ACTUALLY TOUCH? Attached, not asserted:
       the answer is needed to decide which rules must exist in the org tree
       before an org go-live, and nobody had a measured list. Push-ids and room
       names are collapsed so the shape stays readable and stable. */
    const shapes = new Set();
    (function walk(node, p) {
      if (!node || typeof node !== "object") { shapes.add(p); return; }
      for (const k of Object.keys(node)) {
        const seg = /^-[A-Za-z0-9_-]{10,}$/.test(k) ? "<pushId>"
          : /^Room \d+$/.test(k) ? "<room>"
          : /^c[0-9a-f]{8,}$/.test(k) ? "<clientId>"
          : /^\d+$/.test(k) ? "<slot>"
          : k;
        walk(node[k], p ? p + "/" + seg : seg);
      }
    })(tree.orgs[ORG_SLUG].sessions[sid], "");
    await test.info().attach("org-session-node-shapes", {
      body: [...shapes].sort().join("\n"),
      contentType: "text/plain"
    });

    // ── 4. THE READ PATH — what the student actually receives ───────────────
    await page.locator("#advance-all-btn").click();
    await expect(stu.locator("#stage-indicator")).toContainText("Stage 4", { timeout: 20_000 });

    await expect(stu.locator("#wrapup-download-btn")).toBeVisible({ timeout: 15_000 });

    const [download] = await Promise.all([
      stu.waitForEvent("download", { timeout: 30_000 }),
      stu.locator("#wrapup-download-btn").click()
    ]);
    const md = require("node:fs").readFileSync(await download.path(), "utf8");
    expect(md, "the take-home must carry section 1's answer").toContain(A_TEXT);
    expect(md, "…and section 2's").toContain(B_TEXT);
    const mineStart = md.indexOf("## My responses");
    const groupStart = md.indexOf("## Group answers");
    expect(mineStart, "the take-home must have a 'My responses' section").toBeGreaterThan(-1);
    expect(groupStart, "…followed by 'Group answers'").toBeGreaterThan(mineStart);
    const mine = md.slice(mineStart, groupStart);
    expect(mine, "the student's OWN responses must list what they wrote").toContain(A_TEXT);
    expect(mine, "…including the roleplay section's").toContain(B_TEXT);

    // ── 5. THE FACILITATOR SIDE reads the same org tree ─────────────────────
    const counters = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w._impactMetrics
        ? { answers: w._impactMetrics().answers, hypotheses: w._impactMetrics().hypotheses }
        : null;
    });
    expect(counters, "_impactMetrics must be reachable on the admin tab").not.toBeNull();
    expect(counters.answers, "the facilitator must see both answers").toBe(2);
    expect(counters.hypotheses, "…and the working hypothesis").toBe(1);

    /* Rendered, not just computed — the debrief funnel is DOM the facilitator
       reads, fed by the org-tree snapshot. toBeVisible() pairs with the text
       assertion because the debrief panel is collapsed until toggled. */
    await page.locator("#admin-debrief-btn").click();
    const answeredRow = page.locator(".debrief-funnel-row", { hasText: /Answered/i }).first();
    await expect(answeredRow).toBeVisible({ timeout: 10_000 });
    await expect(answeredRow, "the one contributor must be counted, not zero")
      .toContainText("— 1");
  });
});
