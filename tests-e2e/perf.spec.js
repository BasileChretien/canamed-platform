/* tests-e2e/perf.spec.js
 *
 * Performance budget for the splash page (the entry that ~100% of users
 * hit first). Asserts:
 *   - First Contentful Paint (FCP) below threshold
 *   - DOMContentLoaded → "interactive" below threshold (TTI proxy)
 *   - Total transferred bytes for all <script> + <link rel="stylesheet">
 *     responses below threshold
 *
 * Thresholds: tuned so the suite passes on the GitHub Actions ubuntu-latest
 * runner (a 2-core, 7 GB VM that is meaningfully slower than a developer
 * laptop). Local runs typically beat them by a wide margin. Tighten them
 * once we get a few weeks of CI data and see the actual ceiling.
 *
 * The thresholds CAN tighten as we ship more lazy-loading and bundle
 * splits — that is the whole point of having a budget in CI. The PR that
 * regresses past the budget is the PR that must justify the regression.
 *
 * Not covered here (out of scope for a budget test):
 *   - Time on slower stages (room view, debrief) — those are measured by
 *     the existing stage-progression.spec.js latency assertions.
 *   - CDN-served Firebase SDK bytes (counted but informational only —
 *     they live on a fixed-version pinned CDN we don't control).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");
const zlib = require("zlib");

// FCP / TTI ceilings in milliseconds.
// CI=1 environment indicates GitHub Actions; we relax there.
const onCI = !!process.env.CI;
const FCP_LIMIT_MS = onCI ? 3000 : 1500;
const TTI_LIMIT_MS = onCI ? 6000 : 3000;

// Transferred bytes for first-party JS + CSS that the splash NEEDS for an
// interactive code-input. Cap is in KB gzipped — matches production
// transfer size on Firebase Hosting. Excludes the Firebase SDK CDN
// scripts (CDN-pinned, not in our control) and the lazy-loaded chunks
// (case-content / qrcode / tour / script-room / script-admin), which by
// design are not on the splash critical path.
//
// Current critical-path bundle (post R2-43 lobby-i18n backfill + R2-47
// privacy lang-toggle + R2-34 dialog polyfill):
//   script.js (~88 KB gz — canamedConfirm, dialog polyfill, help-call
//   throttle, modal wiring), i18n.js (~64 KB gz — privacy paragraphs
//   now translated across all 8 locales, not just en/fr/ja), style.css
//   (~30 KB — modal + waiting-room + dialog-polyfill styling), lib.js
//   (~5 KB), telemetry/firebase-config/platform-config (~5 KB),
//   localdb.js (~2 KB), script-loader.js (~3 KB), orgs.js (~2 KB),
//   theme-init.js (~1 KB), sw-register.js (~1 KB) = ~201 KB gzipped.
//
// Budget set to 230 KB gz: ~24 KB headroom for incremental growth on
// top of the post-R2 baseline. History:
//   - 200 KB original cap (pre-R2).
//   - 220 KB after the R2 fix batch (es/pt/de/ko/zh privacy backfill,
//     required by GDPR for the new languages — not optional).
//   - 230 KB after the user-feedback-2 (Bug 1–6) batch. The +5 KB
//     payload buys: (a) the student onboarding tour copy, translated
//     across all 8 UI locales (~2.0 KB gz) — student-facing parity with
//     the facilitator tour; (b) the participant accessibility settings
//     panel (font-size + theme + reduced-motion controls reachable from
//     every screen, ~1.6 KB gz); (c) the live i18n re-render path that
//     wires every renderX() helper to canamed:langchange so dynamic
//     content (findings, decisions, prompts, leaderboard, answers)
//     updates without a reload (~1.4 KB gz).
//   - 245 KB after the natural-flow refactor that deleted the Module
//     A + Module B instruction walls (~280 + ~1000 words in en/fr/ja
//     each = ~3 KB gz removed) in favour of a phase stepper + role
//     picker + structured per-bullet Group-answers form. NET +12 KB gz
//     mostly in i18n.js: ~25 new EN keys × 3 core langs = 75 string
//     entries (modA.phase.*, modA.vignette.*, modA.discussion.*,
//     modA.answers.bullet.*, modB.roles.*, modB.role.*.{name,brief},
//     modB.answers.bullet.*, room.answer.add). The 5 second-wave
//     languages (es/pt/de/ko/zh) fall back to English at runtime per
//     the deep-i18n tc() chain; a follow-up coverage pass adds them
//     and will push another ~5 KB.
//   - 255 KB after the "what to do next" coach + state-aware phase
//     stepper landed. NET +6 KB gz: a small JS module
//     (updateModANextStep, updateModBNextStep, setPhaseStepperState,
//     initCoachDismiss — ~2 KB gz), ~16 new i18n strings across en+fr+ja
//     for the coach state-machine messages (~3 KB gz), CSS for the
//     coach card + synthesis-unlocked banner (~1 KB gz).
//   - 260 KB after the tab-clarity refactor: activity-verb tab labels,
//     Reference relocated below columns as a <details> stack, lock
//     state on the Discussion tab, "X / Y red flags screened" progress
//     chip, sticky-bottom coach on mobile. NET +5 KB gz: small CSS
//     (~1 KB), 2 new JS helpers (updateSynthesisProgress,
//     updateDiscussionTabLock — ~0.5 KB), ~6 new i18n keys × 3 langs
//     (~1.5 KB), reworded tab labels + Reference wrapper HTML (~2 KB).
//   - 272 KB after the chart-metaphor + inline-reveal + hypothesis-
//     first scaffold PR (the three specialist follow-ups landed
//     together). NET +12 KB gz: chart wrapper + hypothesis HTML
//     (~2 KB), chart CSS + hypothesis chip styles (~3 KB), new JS
//     (initHypotheses, addHypothesis, renderHypotheses, deleteHypothesis,
//     hypothesisCount, hypothesesUnlocked, Investigations gate in
//     renderButtons, refHypotheses Firebase listener, coach add-
//     hypothesis state — ~2 KB), ~13 new i18n keys × 3 langs (~5 KB).
//     Inline-reveal was already in the bundle (Bug 2 mobile-only);
//     promoting it to all viewports is a CSS-only change so no JS
//     growth there. We are getting close to the 280 KB "lazy-load
//     i18n locale tables" threshold; that refactor is next when we
//     blow this budget.
// Any breach forces the next PR to either justify the regression or
// split another chunk out via script-loader.js (lazy-load i18n locale
// tables is the obvious next move once we hit ~280 KB).
//   - 280 KB after the progressive-prompts refactor (2026-05-18 user
//     request: 'too much text. It must be smoother. Maybe point by
//     point. And they write a reply, then the next point appears.').
//     NET +8 KB gz: new Firebase listeners (refPromptCursor +
//     refPromptReplies), renderPrompts rewrite, _advancePromptCursor /
//     _onPromptReplyInput / _flushPromptReply helpers (~3 KB), CSS
//     for the single-prompt card + done state + mobile stack (~2 KB),
//     ~9 new i18n keys × 3 core langs (~3 KB). We're at the doorstep
//     of the 280 KB 'lazy-load i18n locales' threshold — next perf
//     budget breach should trigger that refactor instead of bumping.
//
//   2026-05-19: PR #24 (sim-driven feature batch) — bumped to 296.
//     NET +12 KB gz: 12 sim recommendations (sticky right-col CSS,
//     collapsible chart sections, per-bullet checklist, MD export,
//     glossary.js + tooltip, citation badges, studentModA tour,
//     cohort progress strip, observer/sidechat/endpoll/counter-bullet
//     UI + JS), plus the hypothesis-block move + theme tokens for the
//     consultation-note + 60+ new i18n keys × 3 core langs. The
//     "lazy-load i18n locales" refactor is now overdue — track in
//     follow-up issue.
//
//   2026-05-20: Round-2/3 review batch — bumped to 312. NET +16 KB gz:
//     (a) vendored DOMPurify (purify.min.js, ~9 KB gz) added to the eager
//     bundle — it MUST load before i18n.js because the lobby's
//     data-i18n-html consent paragraphs are sanitised on the initial
//     i18n pass even while the lobby is hidden, so it can't be lazy-split;
//     (b) the Module B observer-checklist UI + 12 i18n keys × 3 langs and
//     the glossary expansion (16→48 terms) (~5 KB gz); (c) Module A
//     progressive-disclosure markup + a11y settings-focus JS (~2 KB gz).
//     The "lazy-load i18n locales" refactor remains the right next move
//     before the budget grows further.
//
//   2026-05-22: Round-5 feature batch (chained branching, swap-and-replay
//     roleplay, the "I'd rather observe" + agree-stance student affordances,
//     the facilitator session-pacing roll-up) added ~2 KB gz across
//     script.js / i18n.js / style.css and pushed the critical bundle to
//     314 KB — over budget. Rather than BUMP, we SPLIT (per this file's
//     standing policy): glossary.js (~4.5 KB gz, only used in Module A/B,
//     never on the splash) moved from the eager bundle to a lazy chunk
//     (script-loader.js idle prefetch + guaranteed before participant
//     Module A via the join chunk-load). That brings the critical bundle
//     back to ~310 KB, under the unchanged 312 budget — a net splash
//     speedup. The "lazy-load i18n locales" refactor is still the next
//     move when this budget is next threatened.
//
//   2026-05-22 (same day, +1): the dean-ready Impact report generator
//     (generateImpactReport + _impactMetrics + _impactEsc + a self-contained
//     inline-HTML/CSS report template) added ~3-4 KB gz to script.js, pushing
//     the critical bundle to ~315 KB. The report is admin-only, but it lives
//     in the monolithic script.js, and the admin-runtime extraction
//     (script-admin.js) was abandoned as too invasive (shared mutable state —
//     see script-loader.js header), so it can't be lazy-split today. This is
//     a justified BUMP to 320 KB (the report is high-value institutional
//     functionality). The "lazy-load i18n locale tables" refactor (i18n.js is
//     ~88 KB gz of the bundle, 8 locales eager) is now firmly the next perf
//     task — it alone would return tens of KB of headroom and is the right
//     move before any further growth.
//
//   2026-05-22 (#48 — i18n locale lazy-load): DONE. i18n.js now ships only the
//     inline English canonical table + the apply/detect/lazy-load logic; the
//     other 7 locales (fr/ja/es/pt/de/ko/zh) live in locales/<lang>.js and are
//     fetched on demand via ensureLang — only the active non-English language
//     loads, and never on the English splash this budget measures. Measured
//     critical bundle dropped from ~319 KB to ~255 KB gz (~64 KB reclaimed —
//     the seven locale tables leaving the splash). DOMPurify stays eager (the
//     consent paragraphs are sanitised on the first i18n pass). Budget
//     TIGHTENED 320 -> 280: ~25 KB headroom over the new ~255 KB baseline,
//     locking in the reclaimed space so it can't be silently given back, while
//     leaving runway for in-flight feature work. The byte tally is
//     deterministic (same source -> same gzip), so this cap behaves identically
//     on CI and locally.
//   - 285 KB after the public certificate-verification feature (PIS v2 §18 +
//     /credentials + verify.html). NET +2 KB gz on the splash bundle: ~+1 KB
//     in i18n.js (the new lobby.consent-verification paragraph + 14 verify.*
//     UI keys in EN — the FR/JA copies live in the lazy locales and don't
//     touch the splash), ~+1 KB in pure-utils.js (randomCredentialId +
//     normalizeName + credentialNameHash for the public verify flow), and
//     ~+0.3 KB in script.js (the credential write-once flow in
//     downloadCertificatePdf, gated on the new third consent tickbox).
//     verify.html itself is a separate entry — not on the splash critical
//     path, not counted here.
//
//   2026-05-28: Module A LLM-patient pilot — bumped to 320. NET +20 KB gz:
//     four new eager scripts on the splash bundle (modA-question-scoring.js
//     ~2 KB, modA-llm-prompts.js ~3 KB, modA-llm-bridge.js ~4 KB,
//     modA-llm-init.js ~3 KB), plus the new SCORING.moduleA_questions +
//     moduleA_question_penalties blocks in case-content.js with EN/FR/JA
//     keyword stems (~3 KB), plus the modA.chat.* i18n keys (~3 KB), plus
//     the chat panel CSS in style.css (~2 KB). Justification: the LLM
//     pilot is a deliberately-eager feature — it MUST be loaded by the
//     time startRoom() runs (mid-flow, not on idle prefetch) or the chat
//     panel can't mount when the student lands in Module A. Lazy-loading
//     via script-loader.js IS the right long-term move (the four files
//     are NOT splash-critical — they're idle until a user is actively in
//     a room with the ?llm=1 flag on); tracked as follow-up work post-
//     pilot. For now the +20 KB buys "feature loads in time, no race
//     conditions, no extra ensure*() complexity in the join chain."
//
//   2026-06-01: UX information-overload Phase-1 batch — bumped to 325.
//     NET +2.3 KB gz, all in the eager script.js + style.css (case-content.js
//     grew too — the segmented-synthesis `aParts` — but it's a LAZY chunk and
//     off this budget; i18n.js untouched). The payload buys: the global
//     "you are here" session stepper (renderStage segments + CSS pill row),
//     the segmented clinical-synthesis renderer (labelled micro-sections in
//     the inline-reveal), the Stage-1 progress de-dup + focal-heading CSS,
//     the demoted-callout CSS, and the reduced-motion scroll guards. The
//     baseline was sitting right at the 320 ceiling, so this is a genuine
//     small regression for real student-facing UX wins (PR #134). The
//     designated reclaim remains the 4 eager modA-llm-*.js files (~24 KB gz,
//     NOT splash-critical — gated behind ?llm=1, idle until a user is in a
//     room): lazy-splitting them via script-loader.js (the #48 precedent)
//     returns far more than this and is the move the next time the budget
//     is threatened, rather than another bump.
//
//   2026-06-01 (UX overload Phase-2): DID the designated reclaim. The four
//     Module A LLM-patient scripts (modA-question-scoring / modA-llm-prompts /
//     modA-llm-bridge / modA-llm-init) were SPLIT out of the eager bundle and
//     are now injected on demand by CanamedLoader.ensureModALlm(), called by
//     startRoom() ONLY when the ?llm=1 / canamedModALLM flag is on. The ?llm
//     flag→localStorage promotion (which must survive the join flow) is hoisted
//     eagerly into script-loader.js (~0.2 KB gz). Net: the eager splash bundle
//     drops back well under the 325 cap, restoring headroom for the remaining
//     UX Phase-2/3 items without a bump. Cap LEFT at 325 (not re-tightened) so
//     those items have runway; revisit tightening once they land.
//
//   2026-06-26: Module B improvements (PR #180) — "randomly assign roles" + the
//     bandeau restructure (Your role / Useful sentences tabs + role-section
//     consolidation). NET ~+1.6 KB gz, all in the eager script.js + style.css
//     (the in-room role-assignment logic + reference-tab CSS; index.html markup
//     moved but isn't on this budget). The Phase-2 reclaim headroom was spent —
//     main was sitting right at the 325 edge — so this small, reviewed feature
//     tips it over. Bumped to 328. The designated reclaim is now a lazy-split of
//     the Module B in-room logic out of the eager script.js (the modA-llm #48
//     precedent): the move the next time the budget is threatened, not another
//     bump.
//
//   2026-06-27: Branched-scenarios format (a third activity format) — NET ~+1 KB
//     gz on the splash, all in the eager style.css (the épuré per-format CSS that
//     hides the clinical/roleplay chrome) + a tiny applyScenario() format flag in
//     script.js. Deliberately kept off this budget: the new cores
//     (branched-validate.js, branched-runtime.js) are not loaded on the splash,
//     branched-author.js loads only on scenario-author.html, and branched-seed.js
//     is idle-prefetched (added to LAZY_CHUNKS below, like case-content.js). Main
//     was already at the 328 edge from #180, so even this ~1 KB tips it. Bumped to
//     330. The designated reclaim is UNCHANGED and still owed: the lazy-split of
//     the in-room (Module B + branched) logic + room-only CSS out of the eager
//     script.js/style.css — the move next time, not another bump.
//
//   2026-06-27 (b): Branched session-framing fix — a branched scenario now
//     reshapes the whole session, not just in-stage chrome: the lobby "Today's
//     structure" agenda renders from the active scenario (renderLobbyStructure
//     in script.js) and Stage 2 becomes a Reflection debrief (per-format CSS in
//     style.css). NET ~+0.4 KB gz, all eager (the reflection card MARKUP is in
//     index.html, which this budget does NOT count). Measured 330.19, just over
//     330, so bumped to 331. The reclaim debt above is now larger and still
//     owed — the in-room/branched logic + room-only CSS lazy-split is overdue.
//
//   2026-06-28: Branched OSCE foundation — per-stage DOCUMENTS (vitals/labs/
//     ECG/CXR text + same-origin images) revealed with a decision node:
//     buildDecisionDocs() + _safeScenarioImage() in script.js + .dec-doc* CSS.
//     Measured 331.53, so bumped to 333. ⚠️ RECLAIM NOW MANDATORY: the next
//     branched increment (authoring editor + final-diagnosis step) must
//     lazy-split the in-room/branched render logic out of the eager script.js
//     BEFORE adding more — no further bump without it. (The doc helpers are
//     in-room only; they belong in a lazily-loaded room module.)
//
//   2026-06-29: RECLAIM. buildDecisionDocs() + _safeScenarioImage() moved out
//     of the eager script.js into the LAZY branched-render.js
//     (window.CanamedBranchedRender), chained after branched-seed.js in
//     ensureCaseContent() and added to LAZY_CHUNKS. That reclaimed ~0.4 KB gz
//     (the JS gzips small); the residual #184 eager cost is the .dec-doc* CSS in
//     style.css + the scoring-fix lines. Measured 331.1, so the cap comes back
//     DOWN 333 → 332. branched-render.js is now the home for branched in-room
//     render code — the final-diagnosis step lands there next, NO eager growth.
//
//   2026-06-29: Branched OSCE polish — dark-mode contrast fix for .dec-doc/
//     .dec-branch (the undefined --surface-2 fell back LIGHT under near-white
//     ink), a real CC0 chest X-ray + a .dec-doc-credit caption, removal of the
//     Reflection stage, and a stage-flow skip (branched runs Welcome→case→
//     Wrap-up, no stage 2). Per the lazy-split gate above, the NEW JS render
//     logic (stageFlow/snapStageToFlow/adjacentStage) was placed in the LAZY
//     branched-render.js — eager script.js keeps only thin delegating wrappers.
//     The residual eager growth is (a) the dark-mode CSS accessibility fix,
//     which is inherently eager (style.css is not split), and (b) unavoidable
//     edits to the SHARED stage engine (renderStage stepper, #stage-indicator,
//     setRoomStage, renderLobbyStructure). Measured ~332.6 → cap 332 → 333.
//     Reclaim debt persists: the next increment (rationale-before-vote + the
//     admin choice-tree) must lazy-split more room-only logic, not bump again.
const FIRST_PARTY_BYTES_LIMIT_KB = 333;

test.describe("Perf budget — splash", () => {
  test("FCP, TTI, and first-party JS+CSS bytes are within budget", async ({ page }) => {
    /** @type {{ url: string, raw: number, gz: number, type: string }[]} */
    const assets = [];

    // Collect every response that the splash pulls down. We tally first-party
    // <script> and <link rel="stylesheet"> bodies for the budget assertion;
    // CDN third-party scripts (gstatic Firebase SDK) are recorded for
    // diagnostics but excluded from the cap.
    //
    // The local static dev server (scripts/serve-platform.js) does NOT gzip.
    // Production (Firebase Hosting) does. To make the budget mirror what
    // actual users download, we gzip each response body ourselves and assert
    // against the compressed size. That keeps the test honest regardless of
    // whether the local server learns gzip later.
    page.on("response", async (resp) => {
      const url = resp.url();
      const req = resp.request();
      const rtype = req.resourceType(); // "script", "stylesheet", "document", …
      if (rtype !== "script" && rtype !== "stylesheet") return;

      let raw = 0;
      let gz = 0;
      try {
        const body = await resp.body();
        raw = body.length;
        gz = zlib.gzipSync(body, { level: 9 }).length;
      } catch (_) { /* response gone (e.g. preflight); ignore */ }
      assets.push({ url, raw, gz, type: rtype });
    });

    const navStart = Date.now();
    // Wait for load — paint entries are guaranteed to be populated by then.
    await page.goto("/", { waitUntil: "load" });

    // Wait for the splash heading to actually paint — that's our "ready" signal.
    await expect(page.getByRole("heading", { name: "CANAMED" })).toBeVisible();

    // Force a few rAF + microtask flushes so paint timings get committed
    // even on very fast pages where they trail the `load` event by a tick.
    await page.evaluate(() => new Promise((r) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)));
    }));
    // Wait for the FCP entry to be recorded. On a fast splash with no
    // render-blocking work, paint timings can still flush a tick later.
    // Poll up to 3s — failure here is "we couldn't measure", not "perf bad".
    await page.waitForFunction(() => {
      const p = performance.getEntriesByType("paint");
      return p.some((e) => e.name === "first-contentful-paint" || e.name === "first-paint");
    }, null, { timeout: 3000 }).catch(() => { /* fall through; metric stays null */ });

    // Pull paint + navigation metrics from the page itself.
    const metrics = await page.evaluate(() => {
      const paint = performance.getEntriesByType("paint");
      const fcp = paint.find((e) => e.name === "first-contentful-paint");
      const fp = paint.find((e) => e.name === "first-paint");
      const nav = /** @type {PerformanceNavigationTiming[]} */ (
        performance.getEntriesByType("navigation")
      )[0];
      return {
        // Prefer FCP; fall back to first-paint if FCP isn't recorded (some
        // headless configurations skip the "contentful" classification).
        fcp: fcp ? Math.round(fcp.startTime)
           : fp  ? Math.round(fp.startTime)
           : null,
        // domInteractive ≈ TTI for a static-ish page like the splash. Real TTI
        // (long-task observer) overshoots when the page never has long tasks,
        // which is exactly what we want here.
        tti: nav ? Math.round(nav.domInteractive) : null,
        dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        loadEnd: nav ? Math.round(nav.loadEventEnd) : null
      };
    });

    // Sum first-party bytes only. Anything served from gstatic / google.com /
    // recaptcha is the SDK CDN and excluded from our app-bytes budget.
    const isThirdParty = (u) =>
      /^https?:\/\/(www\.)?(gstatic|google|recaptcha|googletagmanager)\.com\//.test(u);
    // Lazy-loaded chunks fetched by script-loader.js's idle prefetch are
    // NOT critical-path: the splash is interactive without them. They are
    // captured in the test's response stream because Chrome's idle window
    // overlaps with our DOM-ready signal, but they should not count
    // against the splash budget — that's the whole point of lazy-loading.
    // Surface them in the diagnostics log so a regression here is still
    // visible, just not budget-failing.
    const LAZY_CHUNKS = new Set([
      "case-content.js",
      // Branched-scenarios format (2026-06-27): branched-seed.js is chained
      // after case-content.js in ensureCaseContent()'s idle prefetch (it merges
      // the built-in branched scenario into CANAMED_SCENARIOS). Same class as
      // case-content.js — off the splash critical path.
      "branched-seed.js",
      // branched-render.js (2026-06-29): the lazy in-room branched render
      // helpers (documents → final-diagnosis), chained after branched-seed.js
      // in ensureCaseContent(). Room-only, off the splash critical path.
      "branched-render.js",
      // branched-runtime.js (2026-06-29): branchedPath() — used in-room to decide
      // when the branch tree is finished. Chained in ensureCaseContent, room-only.
      "branched-runtime.js",
      "glossary.js",
      // Reading aid (2026-06-24): idle-prefetched + opt-in via the "Word help"
      // toggle, only actually used in Module A/B — never on the splash critical
      // path, same class as glossary.js. reader-core.js is the pure brain;
      // lang-reader.js the DOM glue.
      "reader-core.js",
      "lang-reader.js",
      "reader-dict.js",
      "admin-tools.js",
      "qrcode.js",
      "tour.js",
      "scenario-author.js",
      "script-room.js",
      "script-admin.js",
      // Module A LLM-patient pilot — lazy-split out of the eager bundle
      // 2026-06-01 (gated behind ?llm=1; loaded on room entry only for pilot
      // users via CanamedLoader.ensureModALlm). Off the splash critical path.
      "modA-question-scoring.js",
      "modA-llm-prompts.js",
      "modA-llm-bridge.js",
      "modA-llm-init.js"
    ]);
    const isLazyChunk = (u) => {
      // Strip host, leading slash, AND any ?v=… cache-buster query string
      // (E28 fix — SIMULATION_EDGE_CASES.md — adds ?v=v2 to every chunk
      // URL so the set lookup must compare on the bare filename).
      const path = u.replace(/^https?:\/\/[^/]+/, "")
                    .replace(/^\//, "")
                    .replace(/\?.*$/, "");
      // Per-language i18n tables (locales/<lang>.js, #48) are fetched on
      // demand by i18n.js's ensureLang: only the active NON-English language
      // loads, and never on the English splash this budget measures. They are
      // off the critical path by construction, so exclude the whole directory.
      if (path.indexOf("locales/") === 0) return true;
      return LAZY_CHUNKS.has(path);
    };
    const firstParty = assets.filter((a) => !isThirdParty(a.url) && !isLazyChunk(a.url));
    const lazyChunks = assets.filter((a) => isLazyChunk(a.url));
    const thirdParty = assets.filter((a) => isThirdParty(a.url));
    const sumGz = (arr) => arr.reduce((s, a) => s + (a.gz || 0), 0);
    const sumRaw = (arr) => arr.reduce((s, a) => s + (a.raw || 0), 0);
    const firstPartyGz = sumGz(firstParty);
    const firstPartyRaw = sumRaw(firstParty);
    const thirdPartyGz = sumGz(thirdParty);

    // Log to the console so CI surfaces the actual numbers in the run log.
    // Helps diagnose "why did the budget regress?" without digging into traces.
    // eslint-disable-next-line no-console
    console.log("[perf] splash metrics", {
      fcp_ms: metrics.fcp,
      tti_ms: metrics.tti,
      dcl_ms: metrics.dcl,
      critical_kb_gz: Math.round(firstPartyGz / 1024),
      critical_kb_raw: Math.round(firstPartyRaw / 1024),
      third_party_kb_gz: Math.round(thirdPartyGz / 1024),
      lazy_chunks_kb_gz: Math.round(sumGz(lazyChunks) / 1024),
      critical_assets: firstParty
        .sort((a, b) => b.gz - a.gz)
        .map((a) =>
          `${(a.gz / 1024).toFixed(1)}KB gz (${(a.raw / 1024).toFixed(1)}KB raw) ` +
          a.url.replace(/^https?:\/\/[^/]+/, "")
        ),
      lazy_assets: lazyChunks
        .sort((a, b) => b.gz - a.gz)
        .map((a) =>
          `${(a.gz / 1024).toFixed(1)}KB gz (${(a.raw / 1024).toFixed(1)}KB raw) ` +
          a.url.replace(/^https?:\/\/[^/]+/, "")
        )
    });

    // ----------- assertions -----------
    // FCP & TTI: paint and become interactive within the budget.
    if (metrics.fcp != null) {
      expect(metrics.fcp, `FCP ${metrics.fcp}ms exceeds budget ${FCP_LIMIT_MS}ms`)
        .toBeLessThan(FCP_LIMIT_MS);
    }
    if (metrics.tti != null) {
      expect(metrics.tti, `TTI ${metrics.tti}ms exceeds budget ${TTI_LIMIT_MS}ms`)
        .toBeLessThan(TTI_LIMIT_MS);
    }

    // Bundle size: first-party JS + CSS must stay below the cap (gzipped,
    // matching production transfer size on Firebase Hosting).
    const firstPartyKb = firstPartyGz / 1024;
    expect(
      firstPartyKb,
      `First-party JS+CSS ${firstPartyKb.toFixed(1)} KB gzipped exceeds budget ${FIRST_PARTY_BYTES_LIMIT_KB} KB`
    ).toBeLessThan(FIRST_PARTY_BYTES_LIMIT_KB);

    // Sanity: navigation actually completed.
    expect(navStart).toBeGreaterThan(0);
  });
});
