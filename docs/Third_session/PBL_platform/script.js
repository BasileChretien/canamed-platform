/* CaNaMED Session 3 platform - whole-session hub.
 *
 * Flow: an admin opens the dashboard for a numbered session, chooses how many rooms
 * and starts. Participants enter name + university + year + English level and land
 * in a waiting room; on Start they are balanced across the rooms by those factors
 * (late arrivals too). Each room runs 4 stages: 0 Welcome, 1 Module A (interactive
 * chronic-pain case), 2 Module B (breaking-bad-news roleplay), 3 Wrap-up.
 *
 * Stage rules: a facilitator advances a room forward. A participant can step BACK to
 * review earlier stages on their own screen, but cannot move past the room's stage.
 *
 * Participants have a "Call a facilitator" button. When an admin opens a room they see the
 * exact student view of that room, plus a side panel listing every room (with stage,
 * head-count and call alerts) to switch between them and move any room's stage.
 * Opening a room clears its call alert.
 *
 * Backends: SHARED (Firebase Realtime Database) or LOCAL TEST (localStorage + the
 * 'storage' event, syncing across tabs of one browser). Vanilla JS, no build step.
 */

/* ===================== LOCAL TEST BACKEND ===================== */
/* The LocalDB + LocalRef classes (a localStorage-backed Firebase
   Realtime Database mock used in MODE === "local") were extracted to
   localdb.js in 2026-05 so this file stays under control. localdb.js
   exposes window.LocalDB and window.LocalRef so the rest of this file
   can `new LocalDB()` exactly as before. The load order in index.html
   puts localdb.js before script.js. */

/* ===================== DEPLOYMENT CONFIG ===================== */
/* The partnership of universities and the branding live in platform-config.js
   (single-tenant fallback) and in orgs.js (multi-tenant registry). Both load
   before this file. To run CaNaMED for a different partnership, ADD AN ENTRY
   in orgs.js and visit /o/{newSlug}/; nothing about "France/Japan" is
   hard-coded in the engine below.

   Multi-tenant flow:
     1. Parse /o/{orgSlug}/ from location.pathname (canamedParseOrgFromPath).
     2. Fall back to window.CANAMED_DEFAULT_ORG ("caen-nagoya") when absent
        — keeps existing canamed.web.app/ links working unchanged.
     3. Look up the org in window.CANAMED_ORGS. If the slug is unknown,
        show the "Org not found" splash error (see showOrgNotFoundSplash()).
     4. Apply the org's primary/accent colours as CSS custom properties.
     5. sPath() routes reads/writes to /orgs/{slug}/sessions/{code}/... for
        non-default orgs, and to the legacy /sessions/{code}/... path for the
        default org so existing canamed.web.app data is reachable unchanged. */
const _orgsApi = (typeof window !== "undefined") ? window : {};
const DEFAULT_ORG = _orgsApi.CANAMED_DEFAULT_ORG || "caen-nagoya";
/* Compute currentOrg from the URL, falling back to the default. This MUST
   stay synchronous (no awaits) — sPath() and dbInit() rely on it being set
   before any database call. */
let currentOrg = DEFAULT_ORG;
let currentOrgConfig = null;
let currentOrgInvalid = false;       // true when the slug in the URL isn't registered
(function resolveCurrentOrg() {
  const pathname = (typeof location !== "undefined" && location.pathname) || "/";
  const parser = _orgsApi.canamedParseOrgFromPath;
  const resolver = _orgsApi.canamedResolveOrg;
  const fromUrl = (typeof parser === "function") ? parser(pathname) : null;
  if (fromUrl) {
    const resolved = (typeof resolver === "function") ? resolver(fromUrl) : null;
    if (resolved) {
      currentOrg = fromUrl;
      currentOrgConfig = resolved;
    } else {
      // Unknown slug — keep the default org for engine bring-up but flag so
      // initEntry() can paint the "Org not found" splash before any join.
      currentOrgInvalid = true;
      currentOrgConfig = (typeof resolver === "function") ? resolver(DEFAULT_ORG) : null;
    }
  } else {
    currentOrgConfig = (typeof resolver === "function") ? resolver(DEFAULT_ORG) : null;
  }
})();

const CFG = (typeof window !== "undefined" && window.CANAMED_CONFIG) || {};
/* Cohorts come from (in order): the resolved org's cohort list, the legacy
   CANAMED_CONFIG.cohorts, then the hard-coded Caen/Nagoya fallback. */
const COHORTS = (currentOrgConfig && Array.isArray(currentOrgConfig.cohorts)
                  && currentOrgConfig.cohorts.length >= 2)
  ? currentOrgConfig.cohorts
  : ((CFG.cohorts && CFG.cohorts.length >= 2) ? CFG.cohorts : [
      { id: "Caen", label: "Université de Caen Normandie (France)", short: "Caen",
        country: "France", color: "#b45309" },
      { id: "Nagoya", label: "Nagoya University (Japan)", short: "Nagoya",
        country: "Japan", color: "#1763a6" }
    ]);

/* Apply the org's primary/accent colours as CSS custom properties on the
   root element. style.css already references --primary / --accent in many
   places; non-default orgs override them here. Idempotent + safe in test
   environments without a real DOM (guarded).

   Bug 4 follow-up (user-feedback-2): org primary tokens (e.g. #1763a6 for
   the Caen × Nagoya partnership) are tuned for AA contrast on the LIGHT
   palette's white card. In dark / high-contrast mode those values clash
   with the dark surface (e.g. #1763a6 on #16202b → 2.42:1 for
   `#scenario-line-name`). When a non-light theme is active we skip the
   --primary / --primary-hover override so the theme's own accessible
   palette (--nagoya-500 = #5cb8e8 in dark, #0033a0 in high-contrast)
   wins. --accent is decorative only and stays. */
function applyOrgTheme(orgCfg) {
  if (!orgCfg || typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme");
  const skipPrimary = (theme === "dark" || theme === "high-contrast");
  if (orgCfg.primary && !skipPrimary) {
    root.style.setProperty("--primary", orgCfg.primary);
    root.style.setProperty("--primary-hover", orgCfg.primary);
  } else if (skipPrimary) {
    // Clear any prior inline override so the stylesheet's themed value wins.
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-hover");
  }
  if (orgCfg.accent)  root.style.setProperty("--accent", orgCfg.accent);
  root.setAttribute("data-org", currentOrg);
}
applyOrgTheme(currentOrgConfig);
const COHORT_IDS = COHORTS.map(c => c.id);
/* per-cohort lowercase token sets, so the "named a cross-cohort difference"
   answer-scoring family works for ANY partnership, not only France/Japan */
const COHORT_TOKENS = COHORTS.map(c => {
  const toks = [];
  [c.id, c.short, c.country, c.label].forEach(s => {
    if (s) String(s).toLowerCase().split(/[^a-z]+/).forEach(w => {
      if (w.length >= 3 && toks.indexOf(w) < 0) toks.push(w);
    });
  });
  return toks;
});
function cohortColor(id) {
  const c = COHORTS.find(x => x.id === id);
  return c ? c.color : "#6b7785";
}

/* ===================== MODULE A CASE CONTENT ===================== */
/* The CASE / SCORING / PENALTIES / DECISIONS objects (clinical content) live
   in case-content.js as a SCENARIOS registry. `let` so applyScenario() can
   swap the synth-gate fields and rebuild ITEM_IDS when the facilitator picks
   a different scenario at session-creation time. */
let SYNTH_ID = "labs:0";          // the gate item that unlocks the prompts
// must screen serious causes + cauda equina + examine the legs before synthesis
let SYNTH_PREREQS = ["history:1", "history:2", "exam:3"];
let ITEM_IDS = [];
function rebuildCaseDerived() {
  ITEM_IDS = [];
  if (typeof CASE !== "object" || !CASE) return;
  ["history", "exam", "labs"].forEach(g => {
    if (CASE[g] && CASE[g].forEach) {
      CASE[g].forEach((_, i) => ITEM_IDS.push(g + ":" + i));
    }
  });
}
rebuildCaseDerived();
function itemById(id) { const [g, i] = id.split(":"); return CASE[g][+i]; }

/* swap the global content to a different scenario. `customContent` is an
   already-parsed object (from a session's scenarioCustomJson); `id` is one of
   the keys in window.CANAMED_SCENARIOS. customContent wins if both are given. */
function applyScenario(id, customContent) {
  let sc = null;
  if (customContent && typeof customContent === "object") sc = customContent;
  else if (id && window.CANAMED_SCENARIOS && window.CANAMED_SCENARIOS[id]) {
    sc = window.CANAMED_SCENARIOS[id];
  }
  if (!sc) return false;
  if (sc.case) window.CASE = sc.case;
  if (sc.scoring) window.SCORING = sc.scoring;
  if (sc.penalties) window.PENALTIES = sc.penalties;
  if (sc.decisions) window.DECISIONS = sc.decisions;
  if (sc.synthId) SYNTH_ID = sc.synthId;
  if (Array.isArray(sc.synthPrereqs)) SYNTH_PREREQS = sc.synthPrereqs;
  // pre/post-test question banks are optional per scenario — empty / missing
  // means the in-platform knowledge-check panels stay hidden. Stored on
  // window so renderPreTest / renderPostTest can read them.
  window.PRETEST = Array.isArray(sc.preTest) ? sc.preTest : [];
  window.POSTTEST = Array.isArray(sc.postTest) ? sc.postTest : [];
  // sc.name / sc.summary may be either a plain string (legacy / custom JSON)
  // or a translatable { en, fr, ja } — store the raw value so the active
  // language can re-resolve later when the user switches it. The current
  // language's text is exposed via the *_TEXT globals for any caller that
  // wants a ready-to-render string without recomputing.
  window.CURRENT_SCENARIO_NAME = sc.name || id || "";
  window.CURRENT_SCENARIO_SUMMARY = sc.summary || "";
  // R3-G2 — expose Module A/B names + stable id so stageLabel() and the
  // archive can render them scenario-aware. moduleAName/moduleBName are
  // translatable { en, fr, ja } trios; CURRENT_SCENARIO_ID is the stable
  // kebab-case key that pipelines should dispatch on (see archive header).
  window.CURRENT_SCENARIO_MODULE_A_NAME = sc.moduleAName || null;
  window.CURRENT_SCENARIO_MODULE_B_NAME = sc.moduleBName || null;
  window.CURRENT_SCENARIO_ID = (sc && (sc.id || (sc.meta && sc.meta.id))) || id || "";
  rebuildCaseDerived();
  return true;
}

/* read the scenario from the session record (set at creation) and apply it.
   Resolves once the content is in place - callers should await before any
   case-dependent UI is built. */
function loadSessionScenario(code) {
  if (!code) return Promise.resolve(false);
  try { dbInit(); } catch (e) {}
  if (!db) return Promise.resolve(false);
  // case-content.js is lazy-loaded by script-loader.js (out of the splash
  // bundle to keep first-contentful-paint cheap). Make sure SCENARIOS +
  // CASE are populated before we try to applyScenario(). The loader
  // de-duplicates in-flight loads so concurrent callers share one fetch.
  const ensureContent = (window.CanamedLoader && window.CanamedLoader.ensureCaseContent)
    ? window.CanamedLoader.ensureCaseContent()
    : Promise.resolve();
  // session subtree .read requires auth != null under Round-2 rules
  return ensureContent.then(() => {
    // Re-derive ITEM_IDS now that CASE is in place; rebuildCaseDerived()
    // on first script.js parse ran when CASE was still undefined.
    try { rebuildCaseDerived(); } catch (_) {}
    return ensureSignedIn();
  }).then(() => Promise.all([
    db.ref(oPath(code, "scenarioId")).once("value"),
    db.ref(oPath(code, "scenarioCustomJson")).once("value")
  ])).then(res => {
    const id = res[0] && res[0].val();
    const customJson = res[1] && res[1].val();
    let custom = null;
    if (customJson) {
      try { custom = JSON.parse(customJson); } catch (e) {
        console.error("Custom scenario JSON parse failed", e);
      }
    }
    if (custom) return applyScenario(null, custom);
    if (id) return applyScenario(id);
    // session has no scenario set - keep whatever default case-content loaded
    return false;
  }).catch(e => { console.error("loadSessionScenario failed", e); return false; });
}

const STAGE_COUNT = 4;
// English fallback labels — used in admin-side text exports + as the
// fallback when i18n.js hasn't loaded yet (vanishingly rare). For
// any UI-visible label use stageLabel(i), which reads the current
// language from i18n.js. Keeping STAGE_LABELS so the dozens of
// existing call sites don't all need editing in one go.
const STAGE_LABELS = ["Welcome", "Module A - Chronic Pain", "Module B - Breaking Bad News",
                      "Wrap-up"];
function stageLabel(i) {
  // R3-G2 fix: stages 1 and 2 are scenario-specific (Module A / Module B
  // names depend on the chosen clinical case). Prefer the active scenario's
  // moduleAName / moduleBName (translatable { en, fr, ja } trios) so a
  // future antibiotic-stewardship case does not still display "Chronic
  // Pain" in every language. Fall back to the i18n bag, then to the
  // English STAGE_LABELS.
  if (typeof window !== "undefined" && typeof window.tc === "function") {
    let trio = null;
    if (i === 1) trio = window.CURRENT_SCENARIO_MODULE_A_NAME || null;
    else if (i === 2) trio = window.CURRENT_SCENARIO_MODULE_B_NAME || null;
    if (trio) {
      const lang = (typeof window.getLang === "function")
        ? window.getLang() : "en";
      const v = window.tc(trio, lang);
      if (v) return v;
    }
  }
  const key = "stage.label." + i;
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const v = window.t(key);
    // If translation is missing, window.t returns the key as-is — fall
    // back to the English label rather than show "stage.label.0" in UI.
    if (v && v !== key) return v;
  }
  return STAGE_LABELS[i] || ("Stage " + (i + 1));
}
// Generic i18n lookup with English-string fallback. Use for hardcoded
// strings being migrated to i18n: pass the new key and the existing English
// text — when the key is missing from the table (or window.t is unavailable
// in tests), the English string is returned so behaviour is unchanged.
function tFallback(key, en) {
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const v = window.t(key);
    if (v && v !== key) return v;
  }
  return en;
}
const ENG_RANK = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };
/* ===================== SCORING ===================== */
/* Points reward good clinical reasoning, the ORDER decisions are taken, the
 * CHOICES made, and the KEY IDEAS the team writes in its answers - never speed.
 * Three tiers of auto-event, all detected from the platform's own data and
 * written once (idempotent transaction guard):
 *   micro     - small, frequent ("you're on the board")
 *   milestone - the big moments (order, restraint, real exchange)
 *   concept   - a key idea recognised in the team's typed answers
 *               (the families live in SCORING in case-content.js)
 * Facilitators add a capped number of manual points for things software cannot
 * see (deep debate, drawing out a quiet voice). */
const SCORE_AUTO = {
  /* --- micro: the case work-up --- */
  firstAsk:  { points: 4, tier: "micro", module: "A", title: "Started the history",
               did: "Your room asked the patient its first question." },
  firstExam: { points: 4, tier: "micro", module: "A", title: "Started examining",
               did: "Your room did its first examination." },
  firstTest: { points: 4, tier: "micro", module: "A", title: "Opened the investigations",
               did: "Your room opened the investigations panel." },
  redflag1:  { points: 5, tier: "micro", module: "A", title: "Screened the serious causes",
               did: "You asked the red-flag screening question." },
  redflag2:  { points: 5, tier: "micro", module: "A", title: "Screened for cauda equina",
               did: "You checked for the cauda equina emergency." },
  redflag3:  { points: 5, tier: "micro", module: "A", title: "Examined the legs",
               did: "You did the leg neurological examination." },
  /* --- micro: bullets written (graduated) --- */
  bulletsA1: { points: 3, tier: "micro", module: "A", title: "First answer written" },
  bulletsA2: { points: 3, tier: "micro", module: "A", title: "Two answers written" },
  bulletsA3: { points: 3, tier: "micro", module: "A", title: "Three answers written" },
  bulletsA4: { points: 3, tier: "micro", module: "A", title: "All four answers written" },
  bulletsB1: { points: 3, tier: "micro", module: "B", title: "First answer written" },
  bulletsB2: { points: 3, tier: "micro", module: "B", title: "Two answers written" },
  bulletsB3: { points: 3, tier: "micro", module: "B", title: "All three answers written" },
  /* --- milestones --- */
  redFlagFirst: { points: 25, tier: "milestone", module: "A",
    title: "Safety first — screened before scanning",
    did: "You screened the serious causes, screened for cauda equina and examined the legs BEFORE ordering any scan.",
    why: "That is the order real practice demands — rule out danger first, image only with a reason." },
  synthesis: { points: 10, tier: "milestone", module: "A",
    title: "Reached the clinical synthesis",
    did: "Your room pulled the findings together into a working diagnosis." },
  restraint: { points: 20, tier: "milestone", module: "A",
    title: "Diagnostic restraint",
    did: "You reached a diagnosis without ordering imaging that is not indicated.",
    why: "Unnecessary scans find harmless age-related changes that worry patients and lead to more tests." },
  exchangeA: { points: 20, tier: "milestone", module: "A",
    title: "Two universities in the conversation",
    did: "Students from at least two partner universities each wrote a real answer in Module A.",
    why: "Comparing how each health system actually works is the whole point of this case." },
  exchangeA2: { points: 15, tier: "milestone", module: "A",
    title: "Everyone in the conversation",
    did: "At least two students from each partner university contributed in Module A." },
  exchangeB: { points: 20, tier: "milestone", module: "B",
    title: "Two universities in Module B",
    did: "Students from at least two partner universities each wrote a real answer in Module B." }
};
const SCORE_MICRO_BULLETS = {
  A: ["bulletsA1", "bulletsA2", "bulletsA3", "bulletsA4"],
  B: ["bulletsB1", "bulletsB2", "bulletsB3"]
};
const SCORE_MANUAL_TAGS = [
  { tag: "Deep debate — a real disagreement explored", points: 15 },
  { tag: "Drew out a quiet voice", points: 15 },
  { tag: "Both universities genuinely contributed (heard aloud)", points: 10 },
  { tag: "Strong cross-cultural insight", points: 10 },
  { tag: "Excellent clinical reasoning", points: 10 }
];
const MANUAL_CAP = 70;   // ceiling on facilitator-awarded points per room
/* PENALTIES: a wrong clinical choice costs the team points - the PENALTIES list
   (which items, how much, and WHY) lives in case-content.js, so the deductions
   are part of the editable case, not the engine. The returned `title` and `why`
   are RESOLVED strings (via tc() in the active language) so callers can render
   them directly without worrying about the { en, fr, ja } wrap shape. */
function _curLang() {
  return (typeof getLang === "function") ? getLang() : "en";
}
function penaltyMeta(ev) {
  const lang = _curLang();
  // a wrong team decision: id is "decpen_<decisionId>" - the explanation is the
  // committed option's own "why", read live from roomVotes
  const dp = /^decpen_(.+)$/.exec(ev);
  if (dp) {
    const d = decisionMeta(dp[1]);
    if (!d || !d.decision || d.option == null) return null;
    return {
      id: ev, points: d.decision.penalty || 0,
      title: "Team decision: " + decisionShort(d.decision, lang),
      why: tc(d.option.why, lang)
    };
  }
  if (typeof PENALTIES === "undefined") return null;
  const p = PENALTIES.find(pp => pp.id === ev) || null;
  if (!p) return null;
  // resolve the translatable fields once, keep everything else intact
  return Object.assign({}, p, {
    title: tc(p.title, lang),
    why: tc(p.why, lang)
  });
}
// decisionShort is in lib.js (covered by tests/) - global available here.
/* look up a decision and (if the team has locked one in) the committed option.
   roomVotes is live, so the meta functions can quote the exact option chosen. */
function decisionMeta(id) {
  if (typeof DECISIONS === "undefined") return null;
  const decision = DECISIONS.find(d => d.id === id);
  if (!decision) return null;
  const v = roomVotes[id] || {};
  const committed = (v.committed && typeof v.committed.choice === "number")
    ? v.committed.choice : null;
  const option = (committed != null) ? (decision.options[committed] || null) : null;
  return { decision: decision, committedChoice: committed, option: option,
           correct: !!(option && option.correct) };
}
/* metadata for ANY auto-event, including the dynamically-keyed concept events
   ("conceptA_active" ...) whose definition lives in SCORING in case-content.js.
   The returned `title` is a RESOLVED string in the active language so callers
   can render it directly. SCORE_AUTO entries are engine-defined English-only
   chrome and pass through as-is. */
function scoreEventMeta(ev) {
  if (SCORE_AUTO[ev]) return SCORE_AUTO[ev];
  const lang = _curLang();
  // a correct team decision: id is "decision_<decisionId>"
  const dm = /^decision_(.+)$/.exec(ev);
  if (dm) {
    const d = decisionMeta(dm[1]);
    if (!d || !d.decision) return null;
    return {
      points: d.decision.points, tier: "milestone", module: d.decision.module,
      title: "Team decision: " + decisionShort(d.decision, lang),
      why: tc(d.option && d.option.why, lang),
      did: "Your team voted together and locked in the safest answer."
    };
  }
  const m = /^concept([AB])_(.+)$/.exec(ev);
  if (m && typeof SCORING !== "undefined") {
    const fam = (SCORING["module" + m[1]] || []).find(f => f.id === m[2]);
    if (fam) {
      const famLabel = tc(fam.label, lang);
      return {
        points: fam.points, tier: "concept", module: m[1], title: famLabel,
        did: "Your written answers showed a key idea: " + famLabel.toLowerCase() + "."
      };
    }
  }
  return null;
}
// scoreTotal is in lib.js (covered by tests/) - thin wrapper here so the
// rest of the engine can keep calling scoreTotal(roomData) without
// having to remember to pass MANUAL_CAP each time.
const _libScoreTotal = scoreTotal;
scoreTotal = function (roomData) { return _libScoreTotal(roomData, MANUAL_CAP); };
function scorePenaltyTotal(roomData) {
  const s = (roomData && roomData.score) || {};
  let pen = 0;
  Object.keys(s.penalties || {}).forEach(k => { pen += (s.penalties[k].points || 0); });
  return pen;
}
// normalizeForScore is in lib.js (covered by tests/)
function familyHits(family, text) {
  if (family.any) return family.any.some(stem => text.indexOf(stem) >= 0);
  // "cohorts": the answers name two or more partner universities - works for any
  // partnership, not only France/Japan (cohort tokens come from platform-config.js)
  if (family.cohorts) {
    return COHORT_TOKENS.filter(toks =>
      toks.some(t => text.indexOf(t) >= 0)).length >= 2;
  }
  if (family.pairs) {   // legacy form, kept for backward compatibility
    return family.pairs.every(group => group.some(stem => text.indexOf(stem) >= 0));
  }
  return false;
}

/* ===================== HELPERS ===================== */
/* hashStr / colorFor (+ COLORS), roomNames, minsSince and reducedMotion now
   live in pure-utils.js, loaded before this file. They remain available as
   globals, so calls below are unchanged. See ARCHITECTURE/script-js-map.md. */
function el(id) { return document.getElementById(id); }
/* show a "Saved" confirmation element, then hide it again after ms */
function flashSaved(elId, ms) {
  const ok = el(elId);
  if (!ok) return;
  ok.classList.remove("hidden");
  setTimeout(() => ok.classList.add("hidden"), ms || 1500);
}
/* a coloured-dot + name chip - the dot carries the colour, the name is always
   plain dark text (colour alone is not an accessible differentiator) */
function makeChip(name, label, cls) {
  const chip = document.createElement("span");
  chip.className = cls || "chip";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = colorFor(name);
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(label != null ? label : name));
  return chip;
}

/* ============================================================
 * dialogShow / dialogClose — minimal <dialog> polyfill for older
 * iOS Safari (iOS 15.0-15.3 shipped <dialog> without showModal()).
 * The iPhone-SE simulation in R2-34 caught this regression: the
 * native modal didn't open at all on an iOS 15.4 user; the page
 * silently swallowed the click. We detect the missing method and
 * fall through to a CSS-class polyfill that:
 *   • puts the dialog on top via .dialog-polyfill (position: fixed,
 *     centred, with a dim backdrop),
 *   • blocks page scroll while open (body.dialog-polyfill-open),
 *   • routes ESC to a close handler,
 *   • returns focus to the previously focused element on close.
 * Modern browsers (Chrome, Firefox, Safari 15.4+) keep using the
 * native showModal() path — no behaviour change for them.
 * ============================================================ */
function dialogSupportsModal(dlg) {
  return !!(dlg && typeof dlg.showModal === "function");
}
const _dialogPolyfillStack = [];
function dialogShow(dlg) {
  if (!dlg) return false;
  if (dialogSupportsModal(dlg)) {
    try { dlg.showModal(); return true; }
    catch (e) { /* fall through to polyfill */ }
  }
  // Polyfill path. Mark the element so CSS picks it up, lock body scroll,
  // and remember the prior focus so we can restore it on close.
  const prior = (typeof document !== "undefined") ? document.activeElement : null;
  dlg.classList.add("dialog-polyfill");
  dlg.setAttribute("open", "");
  if (document && document.body) document.body.classList.add("dialog-polyfill-open");
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // Mirror native <dialog>'s cancel event so callers' close handlers
      // can stay generic.
      try { dlg.dispatchEvent(new Event("cancel")); } catch (_) {}
      dialogClose(dlg);
    }
  };
  dlg.__polyfillKeyHandler = onKey;
  document.addEventListener("keydown", onKey);
  _dialogPolyfillStack.push({ dlg: dlg, prior: prior });
  // Move focus into the dialog so keyboard users can act.
  setTimeout(() => {
    const focusable = dlg.querySelector(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
    );
    if (focusable) try { focusable.focus(); } catch (_) {}
  }, 10);
  return true;
}
function dialogClose(dlg) {
  if (!dlg) return;
  if (dialogSupportsModal(dlg) && dlg.open) {
    try { dlg.close(); return; }
    catch (e) { /* fall through to polyfill cleanup */ }
  }
  dlg.classList.remove("dialog-polyfill");
  dlg.removeAttribute("open");
  if (dlg.__polyfillKeyHandler) {
    document.removeEventListener("keydown", dlg.__polyfillKeyHandler);
    dlg.__polyfillKeyHandler = null;
  }
  // Pop the most recent matching entry from the stack and restore focus.
  for (let i = _dialogPolyfillStack.length - 1; i >= 0; i--) {
    if (_dialogPolyfillStack[i].dlg === dlg) {
      const prior = _dialogPolyfillStack[i].prior;
      _dialogPolyfillStack.splice(i, 1);
      if (prior && typeof prior.focus === "function") {
        try { prior.focus(); } catch (_) {}
      }
      break;
    }
  }
  if (_dialogPolyfillStack.length === 0 && document && document.body) {
    document.body.classList.remove("dialog-polyfill-open");
  }
  // Fire a close event so callers waiting on it (like canamedConfirm's
  // promise resolver) work identically to the native code path.
  try { dlg.dispatchEvent(new Event("close")); } catch (_) {}
}
if (typeof window !== "undefined") {
  window.canamedDialogShow = dialogShow;
  window.canamedDialogClose = dialogClose;
}

/* ============================================================
 * canamedConfirm — branded in-page confirmation modal.
 *
 * Drop-in replacement for native window.confirm() that:
 *   • renders inside the page (survives screen-share unlike native
 *     macOS confirm alerts, which suppress the dock badge),
 *   • keeps CaNaMED branding + typography,
 *   • lets the caller pass a `detail` payload (rendered in a
 *     monospace block) so room-by-room previews don't lose their
 *     newlines like native confirms' \n,
 *   • is fully keyboard-driven (ESC = cancel, Enter on the confirm
 *     button = OK, focus moves to the confirm button on open),
 *   • supports a `danger` flag that colours the OK button red — useful
 *     for End-session confirmations.
 *
 * Returns a Promise<boolean>: true on confirm, false on cancel / ESC.
 * Falls back to native confirm() if <dialog> isn't supported (very
 * old browsers) so the platform never deadlocks on a missing modal.
 * ============================================================ */
/* Per-modal resolver pointer: when canamedConfirm is called while a
 * previous prompt is still open, the previous Promise gets resolved
 * with `false` (treated as cancel) and the new prompt takes over.
 * Without this guard, a double-click on Advance / End-session would
 * stack two sets of listeners on the same OK button — the first OK
 * click would resolve BOTH promises, executing the action twice.
 * Sim 2026-05-18 reproduced this as a flake; the fix also hardens the
 * production path. */
let _activeModalResolver = null;
function canamedConfirm(opts) {
  opts = opts || {};
  const dlg = el("canamed-modal");
  if (typeof _activeModalResolver === "function") {
    const prev = _activeModalResolver;
    _activeModalResolver = null;
    try { prev(false); } catch (e) { /* prev was already settled */ }
  }
  if (!dlg) {
    // Old browsers (or stripped test harness). Synthesise a single-line
    // string and fall back to the native confirm — the caller still
    // gets a boolean answer.
    const lines = [];
    if (opts.title) lines.push(opts.title);
    if (opts.message) lines.push("", opts.message);
    if (opts.detail) lines.push("", opts.detail);
    /* eslint-disable no-alert */
    return Promise.resolve(window.confirm(lines.join("\n")));
    /* eslint-enable no-alert */
  }
  const titleNode = el("canamed-modal-title");
  const msgNode = el("canamed-modal-message");
  const detailNode = el("canamed-modal-detail");
  const okBtn = el("canamed-modal-confirm");
  const cancelBtn = el("canamed-modal-cancel");
  if (titleNode) titleNode.textContent = opts.title || "";
  if (msgNode) msgNode.textContent = opts.message || "";
  if (detailNode) {
    if (opts.detail) {
      detailNode.textContent = opts.detail;
      detailNode.hidden = false;
    } else {
      detailNode.textContent = "";
      detailNode.hidden = true;
    }
  }
  if (okBtn) {
    okBtn.textContent = opts.okLabel || (window.t ? window.t("modal.confirm") : "OK");
    okBtn.classList.toggle("danger", !!opts.danger);
  }
  if (cancelBtn) {
    cancelBtn.textContent = opts.cancelLabel || (window.t ? window.t("modal.cancel") : "Cancel");
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (_activeModalResolver === finish) _activeModalResolver = null;
      cleanup();
      try { dialogClose(dlg); } catch (e) {}
      resolve(val);
    };
    // Register this resolver so a later canamedConfirm call can cancel it.
    _activeModalResolver = finish;
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onCancelEvent = (e) => { e.preventDefault(); finish(false); };
    const onKey = (e) => {
      if (e.key === "Enter" && document.activeElement !== cancelBtn) {
        e.preventDefault();
        finish(true);
      }
    };
    const cleanup = () => {
      if (okBtn) okBtn.removeEventListener("click", onOk);
      if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onCancelEvent);
      dlg.removeEventListener("keydown", onKey);
    };
    if (okBtn) okBtn.addEventListener("click", onOk);
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onCancelEvent);
    dlg.addEventListener("keydown", onKey);
    const opened = dialogShow(dlg);
    if (!opened) { finish(window.confirm(opts.message || "Are you sure?")); return; }
    // Move focus to the confirm button so Enter immediately commits.
    setTimeout(() => { if (okBtn) try { okBtn.focus(); } catch (_) {} }, 10);
  });
}
window.canamedConfirm = canamedConfirm;

/* ===================== FUN: confetti, count-up, toast ===================== */
/* a CSS-only confetti burst - brand-coloured pieces in three shapes, varied
   size and arc. `big` = a fuller burst for the rare shared-goal moment. */
function burst(big) {
  if (reducedMotion()) return;
  const c = document.createElement("div");
  c.className = "burst";
  c.setAttribute("aria-hidden", "true");
  const palette = ["#2e9fdf", "#e08a1e", "#1763a6", "#4f7d8c", "#1e8449", "#ffffff"];
  const shapes = ["", "c-circle", "c-tri"];
  const n = big ? 30 : 18;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    const shape = shapes[i % shapes.length];
    p.className = "confetti" + (shape ? " " + shape : "");
    const colour = palette[i % palette.length];
    const size = (7 + Math.random() * 6).toFixed(0);
    p.style.setProperty("--x", (Math.random() * 280 - 140).toFixed(0) + "px");
    p.style.setProperty("--y", (90 + Math.random() * 110).toFixed(0) + "px");
    p.style.setProperty("--r", (Math.random() * 760 - 380).toFixed(0) + "deg");
    p.style.setProperty("--d", (Math.random() * 160).toFixed(0) + "ms");
    p.style.setProperty("--cf", colour);
    if (shape === "c-tri") p.style.borderBottomColor = colour;
    else { p.style.background = colour; p.style.width = size + "px"; p.style.height = size + "px"; }
    c.appendChild(p);
  }
  document.body.appendChild(c);
  setTimeout(() => c.remove(), 1600);
}
/* a tiny WebAudio celebration cue - no asset needed, CSP-safe. Off by default
   (a projected room should not suddenly chime); toggled from the header. */
let soundOn = false;
let audioCtx = null;
function playCue(kind) {
  if (!soundOn || reducedMotion()) return;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    const notes = kind === "goal" ? [523, 659, 784] : kind === "milestone" ? [523, 784] : [660];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      const t0 = audioCtx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + 0.24);
    });
  } catch (e) { /* audio not available - silent */ }
}
/* animate a number element from its current value up to `to` */
function countUp(node, to) {
  if (!node) return;
  const from = parseInt(node.textContent, 10) || 0;
  if (reducedMotion() || from === to) { node.textContent = String(to); return; }
  const t0 = performance.now();
  (function step(now) {
    const k = Math.min(1, (now - t0) / 600);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = String(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
/* one recycled bottom-centre toast - a bold headline plus an optional "why"
   line, so every score moment is a small formative lesson, not just a number */
let toastTimer = null;
function toast(msg, sub, kind) {
  let t = el("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  // "loss" gives the penalty toast its own (calm amber/red) styling
  t.className = "toast" + (kind === "loss" ? " loss" : "");
  // build the visible content
  t.innerHTML = "";
  const head = document.createElement("div");
  head.className = "toast-msg";
  head.textContent = msg;
  t.appendChild(head);
  if (sub) {
    const why = document.createElement("div");
    why.className = "toast-sub";
    why.textContent = sub;
    t.appendChild(why);
  }
  t.classList.add("show");
  // re-announce reliably: clearing + refilling the SAME live region in one tick
  // can be coalesced into silence by screen readers, so (re)set aria-live on the
  // next frame, after the DOM mutation has settled.
  t.removeAttribute("aria-live");
  requestAnimationFrame(() => { t.setAttribute("aria-live", "polite"); });
  clearTimeout(toastTimer);
  // longer dwell for the two-line formative toast - second-language readers
  toastTimer = setTimeout(() => t.classList.remove("show"), sub ? 8000 : 3600);
}
function sharedAvailable() {
  return !!(window.CANAMED_FIREBASE && typeof firebase !== "undefined" &&
            firebase.initializeApp);
}
/* A Firebase config IS present but the SDK script did not load (CDN blocked,
   offline). Without this guard the app would silently run every device in
   isolated local mode mid-workshop - so we detect it and refuse to start. */
function sharedExpectedButBroken() {
  return !!window.CANAMED_FIREBASE && !sharedAvailable();
}
const SDK_BROKEN_MSG =
  "This session is configured for shared mode, but the Firebase library did " +
  "not load. Check the internet connection and reload the page before joining " +
  "- do not start the workshop until the lobby shows \"Shared mode\".";
/* safeHref, hashPassword, pbkdf2, sha256Hex, verifyPassword,
   constantTimeEq, sanitizeResume, entriesSorted, normalizeForScore,
   decisionShort, generateSessionCode, sanitizeCode, scoreTotal — all
   defined in lib.js and exposed as window globals. lib.js loads before
   this file via index.html. Keeping them in lib.js means they get
   covered by the Node-based unit tests under tests/. */
// sanitizeResume in lib.js takes the list of valid university IDs as an
// optional param; in this deployment we hand it the cohort IDs from
// platform-config.js. Wrap once so the rest of the engine keeps calling
// sanitizeResume(r) the way it used to.
const _libSanitizeResume = sanitizeResume;
sanitizeResume = function (r) {
  return _libSanitizeResume(r, (typeof COHORTS !== "undefined" && COHORTS)
    ? COHORTS.map(c => c.id) : ["Caen", "Nagoya"]);
};

const MODE = sharedAvailable() ? "shared" : "local";
const SUPERADMIN_KEY = window.CANAMED_SUPERADMIN_KEY || (MODE === "local" ? "test" : null);
if (MODE === "shared" && window.CANAMED_SUPERADMIN_KEY) {
  console.warn("[CaNaMED] A super-admin key is set in firebase-config.js and is " +
    "readable in the page source of a public deployment. Prefer setting the " +
    "session password from the Firebase console and leaving the key null.");
}

/* ===================== ROOM BALANCING =====================
 * The pure implementation lives in lib.js (assignRooms) — covered by
 * unit tests under tests/lib.test.js without needing a browser. lib.js
 * loads first and attaches assignRooms to the global window object via
 * its UMD wrapper, so the rest of script.js can call it by name. */
/* R3-C3 fix — late-joiner room cap.
   A facilitator who carefully balanced 4 rooms of 5 each at start time can
   end up with one room of 7 after three late-joiners arrive. The original
   cost function `sameUni * 100 + members.length * 10` softly biases against
   bigger rooms but lets a same-uni penalty dominate, so all three latecomers
   from the same university can land in the same already-full room.
   This adds a hard "soft cap" at `ceil(pool.length / roomCount) + 2` (the
   target balanced size plus a 2-person tolerance) — anyone hitting it pays a
   massive cost penalty so the next-best (smaller) room wins. Falls back to
   the original placement if EVERY room is at or above the cap (so the engine
   never refuses a placement). */
function bestRoomFor(person, assignedPool, roomCount) {
  const names = roomNames(roomCount);
  const rooms = {};
  names.forEach(n => rooms[n] = []);
  assignedPool.forEach(p => { if (p.room && rooms[p.room]) rooms[p.room].push(p); });
  const total = assignedPool.length;
  // target balanced size; +2 tolerance so late-joiners don't ping-pong
  // between rooms at exact balance.
  const cap = Math.max(1, Math.ceil(total / Math.max(1, roomCount)) + 2);
  // hard absolute cap (defence-in-depth — keeps even pathological inputs
  // from creating a 12-person room).
  const ABSOLUTE_CAP = 8;
  let best = names[0], bestCost = Infinity;
  names.forEach(n => {
    const members = rooms[n];
    const sameUni = members.filter(m => m.university === person.university).length;
    const size = members.length;
    let cost = sameUni * 100 + size * 10;
    if (size >= ABSOLUTE_CAP || size >= cap) {
      // overflow penalty dwarfs every other term so the smallest under-cap
      // room is picked first; ties between over-cap rooms still resolve to
      // the smallest one (via the cost above).
      cost += 100000;
    }
    if (cost < bestCost) { bestCost = cost; best = n; }
  });
  return best;
}

/* ===================== STATE ===================== */
let role = "participant";
let sessionNum = "";
/* sPath / oPath route every read+write under the right org's session subtree.
   - For the default org (caen-nagoya) we keep the legacy "sessions/{code}/..."
     path so existing canamed.web.app data is reachable unchanged.
   - For every other org we namespace under "orgs/{slug}/sessions/{code}/..."
     so partnerships running on one deployment never see each other.
   sessionPrefix() comes from orgs.js (or a local fallback when orgs.js is
   absent, e.g. in older bundles). */
function _sessionPrefix(slug) {
  const helper = (typeof window !== "undefined") ? window.canamedSessionPrefix : null;
  if (typeof helper === "function") return helper(slug);
  if (!slug || slug === DEFAULT_ORG) return "sessions/";
  return "orgs/" + slug + "/sessions/";
}
function oPath(code, p) { return _sessionPrefix(currentOrg) + code + (p ? "/" + p : ""); }
function sPath(p) { return oPath(sessionNum, p); }

/* FINDING-07 (admin-password hash oracle) — free fix.
 *
 * The real PBKDF2 hash used to live at sessions/<code>/adminPasswordHash,
 * which is readable by any session member (the membership .read cascades and
 * cannot be revoked at a child). A member could read it and brute-force the
 * facilitator's password offline. The fix moves the REAL hash into the
 * top-level `adminSecrets/<code>` tree, which has NO read rule (root is
 * .read:false) so it is unreadable by every client. Login verifies by a
 * "proof write": the client writes its candidate hash to
 * adminSecrets/<code>/proof/<uid>; the rule allows the write ONLY when the
 * candidate equals the stored hash (compared server-side) — so a successful
 * write means the password was correct, and the hash itself is never sent to
 * any client. A non-secret RANDOM marker stays at the old readable path so the
 * existence checks the admin-gated rules + recovery rely on keep working.
 *
 * Scope: the live legacy `sessions/` deployment only. Org-scoped sessions keep
 * the prior read-verify scheme for now (no live org deployments). */
// Use the adminSecrets scheme only on the live, rules-enforced legacy
// `sessions/` deployment. LOCAL mode (LocalDB) has no security rules, so a
// proof-write would always succeed there — LOCAL keeps the legacy read-verify
// path (the real hash sits at adminPasswordHash). Org-scoped sessions are
// deferred (no live org deployments yet).
function useAdminSecrets() {
  return MODE === "shared" && _sessionPrefix(currentOrg) === "sessions/";
}
function adminSecretPath(code, leaf) { return "adminSecrets/" + code + (leaf ? "/" + leaf : ""); }
function randomAdminMarker() {
  // 32 random bytes -> 64 lowercase hex, which satisfies the existing
  // adminPasswordHash .validate (legacy SHA-256 shape) while revealing
  // nothing about the password.
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}
/* Verify a typed admin password. Returns "ok" | "wrong" | "none".
 * Legacy-org sessions try the proof-write first; on denial they fall back to
 * the read-verify path, which transparently handles (a) a new session with a
 * wrong password (verifies against the random marker -> "wrong") and (b) an
 * older session that predates adminSecrets (verifies against its real hash). */
function verifyAdminPassword(pass) {
  const legacyVerify = () => db.ref(sPath("adminPasswordHash")).once("value").then(snap => {
    const stored = snap.val();
    if (!stored) return "none";
    return verifyPassword(pass, sessionNum, stored).then(ok => ok ? "ok" : "wrong");
  });
  return hashPassword(pass, sessionNum).then(candidate => {
    if (useAdminSecrets() && currentUser && currentUser.uid) {
      return db.ref(adminSecretPath(sessionNum, "proof/" + currentUser.uid)).set(candidate)
        .then(() => "ok")
        .catch(() => legacyVerify());   // denied: wrong pw OR pre-adminSecrets session
    }
    return legacyVerify();
  });
}
let myName = null, myUniversity = null, myYear = null, myEnglish = null;
let myConsent = null;            // { workshop, research, version, at }
let myRoom = null;
let started = false, roomCount = 4;
/* clientId identifies this BROWSER TAB inside a session - it keys pool,
   presence, typing, votes/ballots. We use sessionStorage so two tabs of
   the same browser on the same machine each get their own identity (so
   two students sharing a laptop can both join the same workshop without
   stepping on each other's pool entries), and we use crypto.getRandomValues
   so the id cannot be predicted or collided with via Math.random() state.
   On a fully-shared lab machine the value naturally clears when the tab
   closes; no manual cleanup needed. */
let clientId = (typeof sessionStorage !== "undefined")
  ? sessionStorage.getItem("canamed_client") : null;
if (!clientId) {
  // 80 bits of entropy in 16 lowercase hex chars
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  clientId = "c" + Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  try { sessionStorage.setItem("canamed_client", clientId); } catch (e) {}
}

/* stableId — R2-24/25 fix — survives a tab close / refresh / new-tab open
   so researchers (Aisha's longitudinal replay) can deduplicate
   participants across sessionStorage resets. clientId stays per-tab (so
   two students sharing a laptop still get distinct pool entries within
   one session); stableId is a *separate* field written into pool / answers
   metadata so a researcher can group entries by person regardless of how
   many tabs/refreshes that person went through.
     - Google-authenticated users (auth.uid present + non-anonymous):
       stableId is bound to auth.uid the moment handleAuthStateChange()
       upgrades the user — same value across tabs, devices, browsers.
     - Anonymous-only users: stableId is a random 80-bit id kept in
       localStorage under canamed_stable_id, so a tab close / refresh /
       new-tab on the same browser yields the same value. Cleared on
       full sign-out (signOut() removes it) so a shared lab machine
       does not bleed the previous student's id into the next student.
   localStorage availability is best-effort — private mode / disabled
   storage falls back to the in-memory value (still better than nothing
   for the current page lifetime). */
const STABLE_ID_KEY = "canamed_stable_id";
let stableId = null;
try { stableId = localStorage.getItem(STABLE_ID_KEY); } catch (e) {}
if (!stableId) {
  const sbuf = new Uint8Array(8);
  crypto.getRandomValues(sbuf);
  stableId = "s" + Array.from(sbuf)
    .map(b => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(STABLE_ID_KEY, stableId); } catch (e) {}
}
/* Remove any legacy localStorage clientId from older builds — kept here
   so an upgrade from a pre-stableId build does not leak a stale id. */
try { localStorage.removeItem("canamed_client"); } catch (e) {}
/* resume data lets a participant survive a reload / wifi drop without losing
   their room, identity or authored work */
const RESUME_KEY = "canamed_resume";
let resumeData = null;
try { resumeData = sanitizeResume(JSON.parse(localStorage.getItem(RESUME_KEY))); } catch (e) {}
function saveResume(room) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      sessionNum: sessionNum, name: myName, university: myUniversity,
      year: myYear, english: myEnglish, room: room || null,
      consent: myConsent
    }));
  } catch (e) {}
}

let joined = false;
let isRoomAdmin = false;   // an admin is currently viewing a room
let wired = false;         // room-view event listeners attached once
let firstStageFire = true; // detect a late join (room already past stage 0)
let roomStage = 0;         // the room's stage (admin-controlled)
let viewStage = 0;         // the stage this participant is looking at (<= roomStage)
let revealed = {};
let seenFindingIds = {};   // findings already shown once, so new ones can flash in
let presence = {};
let typingState = {};      // who is typing - kept off the presence node so a
                           // keystroke does not force a presence re-render for everyone
let answers = { moduleA: {}, moduleB: {} };
let answerReplies = {};   // map: entryId → { replyId → { text, by, cid, at, stance } }
let hypotheses = {};  // PBL 7-jump scaffold: working diagnoses the team agrees on
                      // BEFORE running investigations. Cross-room synced via
                      // refHypotheses. Keyed by Firebase push id; value is
                      // { by, cid, university, text, at }.
/* Progressive discussion-prompts (user request 2026-05-18: 'The compare
 * prompt is too much text. It must be smoother. Maybe point by point.
 * And they write a reply, then the next point appears.'). Only ONE
 * prompt is visible at a time. promptCursor is the room-shared index
 * of the currently-active prompt; promptReplies maps prompt index →
 * { cid → { text, by, at } } so the team's collective notes are
 * recorded alongside the conversation. Anyone in the room can advance
 * the cursor (the platform is leaderless by design). */
let promptCursor = 0;
let promptReplies = {};
let _promptReplyTimer = null;
let callForHelp = null;
let teamsLink = "";
let quizLink = "";          // end-of-session questionnaire link
let preQuizLink = "";       // pre-session questionnaire link (shown on Welcome)
let pool = {};
let allRooms = {};
let selfAssigning = false;
let roomScore = {};        // this room's score subtree { auto:{}, manual:{} }
let roomVotes = {};        // this room's team-decision votes { $id:{ballots,committed} }
let teamName = "";         // this room's chosen team name
let celebratedEvents = {}; // auto events already celebrated, so we don't repeat
let penalisedEvents = {};  // penalty events already announced, so we don't repeat
let committedDecisions = {}; // decision ids whose commit banner toast has fired
let firstScoreFire = true; // skip celebration on the first score snapshot (join)
let firstVoteFire = true;  // skip the commit toast on the first votes snapshot (join)
let wrapCelebrated = false; // fire the wrap-up celebration only once

let db = null;
/* Firebase Authentication (shared mode only). currentUser is the auth user
   object (or null when signed out); currentProfile is the editable profile
   under users/{uid}/profile loaded the moment the user signs in.

   Round-2 hardening: every browser tab signs in *anonymously* on first
   dbInit() so the realtime-database rules can require `auth != null` on
   every write path. The clientId (per-tab sessionStorage random) is kept
   as a separate identifier — anonymous-auth uses LOCAL persistence and
   would share one uid across tabs, but pool / presence / typing all need
   per-tab identity. Google sign-in later links into the same uid via
   linkWithPopup so history under users/{uid}/* survives the upgrade. */
let auth = null;
let currentUser = null;
let currentProfile = null;
/* authReady resolves the moment auth.currentUser exists (anonymous OR
   identified). joinParticipant / joinAdmin / any DB-write path awaits
   this so writes happen with an auth token attached. */
let authReady = null;
let _authReadyResolve = null;
/* While we are mid-anonymous-sign-in, hold a single in-flight promise so
   concurrent callers don't kick off duplicate signInAnonymously() calls. */
let _anonSignInPromise = null;
let refPool = null, refMyPool = null, refStarted = null, refRoomCount = null,
    refTeams = null, refQuiz = null, refPreQuiz = null;
let refStage = null, refRevealed = null, refPresence = null, refTyping = null,
    refAnswers = { moduleA: null, moduleB: null }, refCallForHelp = null, refRooms = null,
    refHypotheses = null, refPromptCursor = null, refPromptReplies = null,
    refScore = null, refTeamName = null, refLeaderboard = null, refVotes = null,
    refObservers = null, refAnswerReplies = null, refChat = null, refPoll = null,
    refRoleChoices = null,
    refReplayRound = null,
    refClosed = null;

/* Swap-and-replay loop state (Module B). `replayRound` is the current
 * roleplay round (1..4); `replayRoundReady` guards the first sync/local paint
 * so a late joiner doesn't auto-rotate on arrival — rotation only fires on a
 * genuine round increment after the listener has seen its baseline. */
let replayRound = 1;
let replayRoundReady = false;

/* Activate Firebase App Check with reCAPTCHA Enterprise. Idempotent — safe
   to call multiple times. No-op (with a single console.info hint to
   the operator) when the site key is not configured. Wraps the SDK in a
   try/catch because:
   - the App Check compat SDK may not have loaded (offline / CDN blocked)
   - firebase.appCheck() throws if called twice on the same app
   - the network call to attest may fail and we don't want to break the app
   The platform stays functional in any of those failure modes; only the
   abuse-protection layer goes missing. */
let _appCheckActivated = false;
function initAppCheck() {
  if (_appCheckActivated) return;
  const siteKey = window.CANAMED_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    // operator hint — shown once per page load, never to participants in
    // any disruptive way. Surfaces a security recommendation in DevTools.
    if (!window.__canamedAppCheckHinted) {
      window.__canamedAppCheckHinted = true;
      console.info(
        "[CaNaMED] App Check is OFF (no reCAPTCHA site key). The platform " +
        "still works, but the database is protected by rules only. See " +
        "README.md → Enabling App Check to turn this on."
      );
    }
    return;
  }
  if (!firebase.appCheck) {
    console.warn("[CaNaMED] App Check requested but the SDK didn't load.");
    return;
  }
  try {
    // reCAPTCHA Classic v3 — free up to 10k assessments/month, no Cloud
    // billing account required. Switched from ReCaptchaEnterpriseProvider
    // because Enterprise requires Blaze plan; the protection level is
    // effectively the same for our threat model (bot abuse of free-tier
    // RTDB quotas via stolen anonymous-auth tokens).
    const provider = new firebase.appCheck.ReCaptchaV3Provider(siteKey);
    firebase.appCheck().activate(provider, /* isTokenAutoRefreshEnabled */ true);
    _appCheckActivated = true;
  } catch (e) {
    console.warn("[CaNaMED] App Check activation failed", e);
  }
}

/* Firebase Performance Monitoring activation. No-op when
   window.CANAMED_PERF_MONITORING isn't truthy (the script tag still
   loads the SDK but doesn't call .performance(), so no traces ship).
   Auto-tracks page load + each network request — we don't add custom
   traces in code yet. Privacy: timing-only, no content. */
let _perfActivated = false;
function initPerfMonitoring() {
  if (_perfActivated) return;
  if (!window.CANAMED_PERF_MONITORING) return;
  if (!firebase.performance) {
    console.warn("[CaNaMED] Perf monitoring requested but the SDK didn't load.");
    return;
  }
  try {
    firebase.performance();
    _perfActivated = true;
  } catch (e) {
    console.warn("[CaNaMED] Perf monitoring activation failed", e);
  }
}

/* Firebase-emulator wiring (sim + integration-test use).
 *
 * When window.CANAMED_EMULATOR is set to
 *   { host: "127.0.0.1", dbPort: 9000, authPort: 9099 }
 * dbInit() points the Realtime Database + Auth SDKs at the local Firebase
 * emulator suite (launched by `npm run emulator` or by the sim harness).
 * That lets us drive 28-tab classroom simulations through the same
 * Firebase code path production uses — without the LocalDB cross-tab
 * storage-event drops we hit at scale.
 *
 * The flag is gated to MODE === "shared" only; in LOCAL mode the engine
 * still rides LocalDB. The flag is a NO-OP in production (the global is
 * never set on a real deploy). */
function _isEmulatorMode() {
  return !!(typeof window !== "undefined" && window.CANAMED_EMULATOR);
}
function _maybeWireEmulators(databaseInstance) {
  const cfg = (typeof window !== "undefined") && window.CANAMED_EMULATOR;
  if (!cfg || !databaseInstance || typeof databaseInstance.useEmulator !== "function") return;
  try {
    databaseInstance.useEmulator(cfg.host || "127.0.0.1", parseInt(cfg.dbPort, 10) || 9000);
  } catch (e) { console.warn("DB emulator hookup failed", e); }
}
function _maybeWireAuthEmulator(authInstance) {
  const cfg = (typeof window !== "undefined") && window.CANAMED_EMULATOR;
  if (!cfg || !authInstance || typeof authInstance.useEmulator !== "function") return;
  try {
    const host = cfg.host || "127.0.0.1";
    const port = parseInt(cfg.authPort, 10) || 9099;
    // disableWarnings:true hides the "running in emulator" yellow banner
    // the Web Auth SDK normally renders — fine for sim, fine for tests.
    authInstance.useEmulator("http://" + host + ":" + port,
      { disableWarnings: true });
  } catch (e) { console.warn("Auth emulator hookup failed", e); }
}

function dbInit() {
  if (db) return;
  if (MODE === "shared") {
    if (!firebase.apps.length) firebase.initializeApp(window.CANAMED_FIREBASE);
    // App Check must be activated AFTER initializeApp but BEFORE any other
    // Firebase service is used (auth, database). Idempotent and a no-op when
    // window.CANAMED_RECAPTCHA_SITE_KEY isn't configured.
    //
    // Emulator mode skips App Check: the local emulator doesn't enforce it
    // and reCAPTCHA can't reach the Google verification endpoint in tests
    // (which would otherwise spam the console with appCheck/recaptcha-error).
    if (!_isEmulatorMode()) initAppCheck();
    // Performance Monitoring is similarly opt-in via the firebase-config
    // flag. Safe to activate before database/auth — it just attaches to
    // the global window.fetch / XMLHttpRequest for timing capture.
    initPerfMonitoring();
    db = firebase.database();
    // Emulator hookup: when window.CANAMED_EMULATOR is set to
    // { host: "127.0.0.1", dbPort: 9000, authPort: 9099 }, point the
    // database + auth SDKs at the local Firebase emulator suite. Used by
    // scripts/sim/simulate-session.js so the sim no longer relies on
    // LocalDB's flaky cross-tab storage events. No-op in production.
    _maybeWireEmulators(db);
    // live connection indicator - a silent write failure mid-workshop is worse
    // than a visible "Reconnecting" badge
    try {
      db.ref(".info/connected").on("value", snap => {
        const badge = el("connection-badge");
        if (!badge) return;
        const ok = snap.val() === true;
        badge.textContent = ok ? "Connected" : "Reconnecting…";
        badge.className = "conn-badge " + (ok ? "conn-ok" : "conn-lost");
      });
    } catch (e) { /* .info/connected unavailable - non-fatal */ }
    // Firebase Authentication - we sign in anonymously on first init so DB
    // rules can require `auth != null` on every write. Google sign-in later
    // links into the same uid so users/{uid}/history persists.
    try {
      if (firebase.auth) {
        auth = firebase.auth();
        // Emulator hookup must run BEFORE any auth call (setPersistence,
        // onAuthStateChanged, etc.) so the SDK routes to localhost.
        _maybeWireAuthEmulator(auth);
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
        // create the authReady promise BEFORE wiring the listener so the
        // first auth-state change can resolve it
        authReady = new Promise(resolve => { _authReadyResolve = resolve; });
        auth.onAuthStateChanged(handleAuthStateChange);
        // kick off anonymous sign-in if no current user. ensureSignedIn()
        // is idempotent — calling it again from joinParticipant is safe.
        ensureSignedIn();
        // Complete a redirect-based sign-in when the user returns from the
        // provider (the popup-blocked fallback in signInWithProvider). On
        // success handleAuthStateChange drives the UI; surface real errors.
        auth.getRedirectResult().catch(e => {
          if (e && (e.code === "auth/credential-already-in-use" ||
                    e.code === "auth/email-already-in-use") && e.credential) {
            // anon link clashed with an existing account — sign in with that
            // Google credential directly (anon-uid history is forfeited, same
            // as the popup path's credential-already-in-use fallback).
            auth.signInWithCredential(e.credential).catch(err => {
              const hint = el("splash-account-hint");
              if (hint) splashHintErr(hint, authErrorMessage(err));
            });
            return;
          }
          if (e && e.code && e.code !== "auth/no-auth-event") {
            const hint = el("splash-account-hint");
            if (hint) splashHintErr(hint, authErrorMessage(e));
          }
        });
      }
    } catch (e) { console.warn("Auth init failed", e); }
  } else {
    db = new LocalDB();
    // E2E hook: expose the LocalDB instance so tests can seed / write
    // directly through the same subscription tree the platform listens
    // on (live-leaderboard.spec.js asserts <500ms render after a score
    // write — only reachable via the platform's own db handle, because
    // LocalDB's storage-event broadcast does not fire in the writing
    // tab). LOCAL mode only; never attached to the production Firebase
    // handle so there's no added attack surface in shared mode.
    try { window.db = db; } catch (_) {}
  }
}

/* ===================== DEPLOYMENT BRANDING ===================== */
/* Everything the partnership is "called" lives in platform-config.js. This
   paints it into the page so the engine itself stays partnership-agnostic -
   to run CaNaMED for a different set of universities, edit only the config. */
/* WCAG 2.4.1 — when the skip-link is activated, jump focus to the
   currently visible <main> landmark. The visible main changes over the
   life of the session (splash → waiting → app → admin-app → ended) so
   we resolve at click time, not at page load. Idempotent. */
function wireSkipLink() {
  const link = el("skip-link");
  if (!link || link.dataset.wired) return;
  link.dataset.wired = "1";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    // <main> landmarks share the contract that exactly one is visible at
    // a time. .splash is a <section> but also a top-level surface; treat
    // it the same way.
    const mains = document.querySelectorAll("main, #splash");
    let target = null;
    mains.forEach((node) => {
      if (target) return;
      if (!node.classList.contains("hidden")) target = node;
    });
    if (!target) return;
    // Make the landmark focusable for one keystroke without leaving a
    // permanent tabindex on it.
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: false });
    target.addEventListener("blur", function once() {
      target.removeAttribute("tabindex");
      target.removeEventListener("blur", once);
    });
  });
}

/* Wire the language switcher buttons. Idempotent. i18n.js auto-applies
   translations on DOMContentLoaded; this just lets the user override. */
function wireLanguageSwitcher() {
  if (typeof window.setLang !== "function") return;
  // Legacy button-style switcher (kept for back-compat if any view
  // still emits the [data-lang-btn] markup).
  document.querySelectorAll("[data-lang-btn]").forEach(btn => {
    if (btn.dataset.langWired) return;
    btn.dataset.langWired = "1";
    btn.addEventListener("click", () => {
      const lang = btn.getAttribute("data-lang-btn");
      window.setLang(lang);
    });
  });
  // Splash <select> switcher (R2-42 — exposes all 8 supported languages
  // without overflowing 320px viewports). Sync the option to the current
  // language so the dropdown reflects the user's choice on first paint.
  // We wire the splash switcher and the always-visible global switcher
  // through the same helper — both are <select> elements that drive
  // setLang() on change, sync to the active lang on load, and stay in
  // sync via the canamed:langchange event.
  const wireSelect = (id) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.langWired) return;
    node.dataset.langWired = "1";
    if (typeof window.getLang === "function") {
      try { node.value = window.getLang(); } catch (e) {}
    }
    node.addEventListener("change", () => {
      window.setLang(node.value);
    });
    document.addEventListener("canamed:langchange", e => {
      try { node.value = (e && e.detail && e.detail.lang) || window.getLang(); }
      catch (_) {}
    });
  };
  wireSelect("splash-lang-select");
  // Global switcher — visible from every post-splash screen so a user who
  // landed past the splash (deep link, returning participant, admin
  // dashboard) can still change UI language.
  wireSelect("global-lang-select");

  // Bug 6 (user-feedback-2): wire the participant settings widget. The cog
  // toggles the panel; the theme picker calls setTheme(); the "restart
  // tour" link clears every tour's localStorage marker and re-fires the
  // student tour (or the create tour if the user is on the splash). Wires
  // exactly once even if applyBranding() runs multiple times.
  const settingsBtn = document.getElementById("global-settings-btn");
  const settingsPanel = document.getElementById("global-settings-panel");
  if (settingsBtn && settingsPanel && !settingsBtn.dataset.wired) {
    settingsBtn.dataset.wired = "1";
    const closeBtn = document.getElementById("global-settings-close");
    const themeSel = document.getElementById("global-theme-select");
    const restartBtn = document.getElementById("global-settings-restart-tour");
    // Round-2 a11y review: the settings popup had no focus management.
    // On open, move keyboard focus into the panel (the theme <select>, or
    // the Close button as a fallback); on a deliberate close (Esc / Close
    // button / toggle) restore focus to the cog. A click-outside close does
    // NOT steal focus back (the user is interacting elsewhere).
    const setOpen = (open, restoreFocus) => {
      settingsPanel.hidden = !open;
      settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        const focusTarget = themeSel || closeBtn ||
          settingsPanel.querySelector(
            "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (focusTarget && typeof focusTarget.focus === "function") {
          try { focusTarget.focus(); } catch (_) {}
        }
      } else if (restoreFocus && settingsBtn && typeof settingsBtn.focus === "function") {
        try { settingsBtn.focus(); } catch (_) {}
      }
    };
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(settingsPanel.hidden, true);
    });
    if (closeBtn) closeBtn.addEventListener("click", () => setOpen(false, true));
    document.addEventListener("click", (e) => {
      if (settingsPanel.hidden) return;
      // User report (2026-05-18): "The setting button on the phone
      // does not work." Root cause: the original check used reference
      // equality `e.target === settingsBtn` which FAILS on mobile —
      // tapping the cog SVG sets e.target to the <svg> or one of its
      // child <path>/<circle> elements, NOT the button itself. The
      // button's own click handler called stopPropagation, but on
      // some mobile WebKit/Android Chrome versions stopPropagation
      // around synthetic touch→click events can be missed, and the
      // document handler then fires AFTER the button handler, closing
      // the panel that was just opened.
      //
      // Defensive fix: use .contains() so the WHOLE button subtree
      // (the SVG icon + every child path) is treated as "inside" the
      // button. Same approach as the panel check on the next clause.
      if (settingsBtn.contains(e.target) || settingsPanel.contains(e.target)) return;
      setOpen(false, false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !settingsPanel.hidden) setOpen(false, true);
    });
    if (themeSel) {
      try { themeSel.value = (typeof getTheme === "function") ? getTheme() : "auto"; }
      catch (_) {}
      themeSel.addEventListener("change", () => {
        if (typeof setTheme === "function") setTheme(themeSel.value);
      });
    }
    if (restartBtn) {
      restartBtn.addEventListener("click", () => {
        setOpen(false);
        // Clear every tour-done marker so the appropriate tour fires
        // on the next opportunity. Pick the student tour if the user is
        // currently in a room; the create tour otherwise.
        try {
          ["canamed_tour_done", "canamed_tour_admin_done",
           "canamed_tour_student_done"].forEach(k => localStorage.removeItem(k));
        } catch (_) {}
        if (window.CanamedTour) {
          try {
            const inRoom = document.getElementById("app") &&
              !document.getElementById("app").classList.contains("hidden");
            window.CanamedTour.start(inRoom ? "student" : "create");
          } catch (e) { /* tour module missing — best-effort */ }
        }
      });
    }
  }

  // Bug 3 (user-feedback-2): every render function that consults the
  // current language via `tc(value, lang)` is invoked only on state changes
  // (firebase write, stage change, vote, etc.). After a user switches
  // language mid-session, the data-i18n nodes update — but the dynamic
  // content (revealed findings, decision options, prompts, group answers,
  // objectives, leaderboard, the Module B body and the contrib tally) keeps
  // its old language because no re-render was triggered. Wire a single
  // global listener that calls the relevant render helpers. We guard each
  // call with a typeof check so it works during early boot (before
  // firebase wires) and in tests where the function may be absent.
  if (!document._canamedLangchangeRerenderWired) {
    document._canamedLangchangeRerenderWired = true;
    document.addEventListener("canamed:langchange", () => {
      const callIfFn = (name) => {
        try {
          const fn = window[name];
          if (typeof fn === "function") fn();
        } catch (_) { /* render functions are best-effort during boot */ }
      };
      // Re-build the request buttons FIRST — `buildButtons()` re-creates
      // the button DOM and reads `tc(item.q, _curLang())`. `renderButtons`
      // then re-attaches the .done / .warn state and re-populates the
      // inline-reveal text (Bug 2) in the new language.
      callIfFn("buildButtons");
      callIfFn("renderButtons");
      callIfFn("renderFindings");
      callIfFn("renderPrompts");
      callIfFn("renderDecisions");
      callIfFn("renderObjectives");
      callIfFn("renderLeaderboard");
      callIfFn("renderScore");
      callIfFn("renderStage");
      callIfFn("renderContrib");
      // renderAnswers takes a module key — call it for both Module A and B.
      try {
        const fn = window.renderAnswers;
        if (typeof fn === "function") { fn("moduleA"); fn("moduleB"); }
      } catch (_) {}
    });
  }
}

function applyBranding() {
  wireLanguageSwitcher();
  wireSkipLink();
  const setText = (sel, val) => {
    if (!val) return;
    const node = document.querySelector(sel);
    if (node) node.textContent = val;
  };
  // browser title stays the generic "CaNaMED - Platform" no matter which
  // partnership / workshop is loaded - the workshop-specific name still
  // lives in the page header (h1 below)
  document.title = "CaNaMED - Platform";
  if (CFG.workshopName) {
    setText("header h1", CFG.workshopName);
  }
  const headerSub = [CFG.tagline, CFG.subtitle].filter(Boolean).join(" · ");
  setText("header .sub", headerSub);
  setText(".hero-eyebrow", CFG.subtitle);
  setText(".hero-title", CFG.tagline);
  const tags = document.querySelectorAll(".hero-aside .hero-tag");
  if (tags[0] && CFG.heroTagline) tags[0].textContent = CFG.heroTagline;
  if (tags[1]) {
    const line = [CFG.institutionsLine, CFG.workshopName].filter(Boolean).join(" · ");
    if (line) tags[1].textContent = line;
  }
  // the university dropdown is the cohorts list - never hard-coded
  const sel = el("uni-input");
  if (sel && COHORTS.length) {
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = ""; ph.selected = true; ph.disabled = true;
    ph.textContent = "Select your university…";
    sel.appendChild(ph);
    COHORTS.forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label || c.id;
      sel.appendChild(o);
    });
  }
}

/* ===================== LOBBY ===================== */
function initLobby() {
  applyBranding();
  // R2-37: the privacy <details> is marked `open` by default so participants
  // see the full notice before joining. On iPhone SE / 320px viewports that
  // pushes the Join button below ~3 screens of scroll, which the simulation
  // surfaced as a "where do I click?" blocker. Collapse the details on
  // narrow viewports so the consent checkboxes + Join button stay in the
  // initial paint. The user can still expand the privacy summary in one tap.
  const privacyDetails = document.querySelector(".privacy-note");
  if (privacyDetails && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(max-width: 600px)").matches) {
        privacyDetails.removeAttribute("open");
      }
    } catch (e) { /* matchMedia unsupported — keep default open state */ }
  }
  const modeEl = el("lobby-mode");
  const hintEl = el("lobby-hint");
  if (sharedExpectedButBroken()) {
    modeEl.textContent = SDK_BROKEN_MSG;
    modeEl.className = "lobby-mode broken";
    hintEl.textContent = "";
  } else if (MODE === "shared") {
    modeEl.textContent = "Shared mode - synced via Firebase across all devices.";
    modeEl.className = "lobby-mode shared";
    hintEl.textContent = "Everyone opens this same address; the admin starts the session.";
  } else {
    modeEl.textContent = "Single-device mode - your work stays in this browser.";
    modeEl.className = "lobby-mode solo";
    hintEl.textContent = "";
    console.info("[CaNaMED] Local test mode. Super-admin key is \"test\". " +
      "Open multiple tabs to simulate rooms; add a Firebase config in " +
      "firebase-config.js for real multi-device use.");
  }
  const nameInput = el("name-input");
  const savedName = localStorage.getItem("canamed_name");
  if (savedName) nameInput.value = savedName;
  const savedSession = localStorage.getItem("canamed_session");
  if (savedSession) el("session-input").value = savedSession;

  el("join-btn").addEventListener("click", joinParticipant);
  nameInput.addEventListener("keydown", e => { if (e.key === "Enter") joinParticipant(); });
  // the workshop-consent checkbox is required to enable the Join button.
  // (The research-consent box is optional and does not gate joining; it just
  // changes whether the user's contributions may be analysed later.)
  const cWorkshop = el("consent-workshop");
  const joinBtn = el("join-btn");
  const refreshJoinBtnState = () => {
    if (!joinBtn) return;
    const ok = !!(cWorkshop && cWorkshop.checked);
    joinBtn.disabled = !ok;
    // Translated lock tooltip: visible only while the button is disabled,
    // matched to whatever language i18n has chosen. Cleared once the user
    // ticks consent so the unlocked button doesn't carry a stale "locked"
    // message in screen readers / on hover.
    if (ok) {
      joinBtn.removeAttribute("title");
    } else {
      joinBtn.setAttribute("title", tt(
        "lobby.consent-required-title",
        "Tick the workshop-consent box above to enable this button."
      ));
    }
  };
  if (cWorkshop) cWorkshop.addEventListener("change", refreshJoinBtnState);
  // Re-apply the lock-tooltip in the new language when the user switches
  // languages — applyI18n() handles all data-i18n* attributes but the
  // join-btn title is set imperatively (so it can be CLEARED on unlock),
  // and would otherwise stay in the pre-switch language.
  document.addEventListener("canamed:langchange", refreshJoinBtnState);
  refreshJoinBtnState();
  el("join-admin-btn").addEventListener("click", joinAdmin);
  el("admin-pass-input").addEventListener("keydown", e => {
    if (e.key === "Enter") joinAdmin();
  });
  function wireToggle(btnId, panelId) {
    const btn = el(btnId), panel = el(panelId);
    btn.setAttribute("aria-controls", panelId);
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      const open = panel.classList.toggle("hidden") === false;
      btn.setAttribute("aria-expanded", String(open));
    });
  }
  wireToggle("admin-toggle", "admin-lobby-body");
  wireToggle("superadmin-toggle", "superadmin-panel");
  // When the admin sub-panel opens, scroll the SHARED name field into
  // view so a facilitator notices they need to fill it (this prevents
  // the silent-bounce sim 2026-05-18 hit when Dr Chrétien clicked
  // "Open admin dashboard" without typing a name first).
  const adminToggleBtn = el("admin-toggle");
  const adminBody = el("admin-lobby-body");
  const nameFieldForFocus = el("name-input");
  if (adminToggleBtn && adminBody && nameFieldForFocus) {
    adminToggleBtn.addEventListener("click", () => {
      // wireToggle uses a class swap; observe the next tick to see the
      // post-click state. If the body is now visible AND the name field
      // is empty, scroll/highlight it.
      setTimeout(() => {
        if (adminBody.classList.contains("hidden")) return;
        const nameVal = (nameFieldForFocus.value || "").trim();
        if (!nameVal) {
          try { nameFieldForFocus.scrollIntoView({ behavior: "smooth", block: "center" }); }
          catch (_) { try { nameFieldForFocus.scrollIntoView(); } catch (__) {} }
          const hint = el("admin-hint");
          if (hint) {
            hint.textContent = tFallback("lobby.admin-name-prompt",
              "Type your name above first, then your admin password here.");
            hint.className = "lobby-hint";   // informational, not red
          }
        }
      }, 30);
    });
  }
  // "Need to set or recover the admin password?" link (R3-D2). Opens the
  // superadmin-panel and focuses the first relevant field. D21: the panel
  // is now a RECOVERY surface that works without a super-admin key, so we
  // focus the super-admin key input only when a key is actually configured;
  // otherwise we jump straight to the recovery-code input, which is the real
  // gate for resetting a forgotten password.
  const forgotLink = el("forgot-pass-link");
  const superPanel = el("superadmin-panel");
  if (forgotLink && superPanel) {
    forgotLink.addEventListener("click", () => {
      superPanel.classList.remove("hidden");
      const toggle = el("superadmin-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      // Defer focus by a tick so the panel has laid out before we steal
      // focus — otherwise some browsers ignore the focus() call on a
      // freshly-unhidden element.
      setTimeout(() => {
        const target = SUPERADMIN_KEY
          ? el("superadmin-key-input")
          : (el("recovery-code-input") || el("new-pass-input"));
        if (target) {
          try { target.scrollIntoView({ behavior: "smooth", block: "center" }); }
          catch (_) { try { target.scrollIntoView(); } catch (__) {} }
          try { target.focus(); } catch (e) {}
        }
      }, 0);
    });
  }
  el("set-pass-btn").addEventListener("click", joinSuperAdmin);
  // D21 — the recovery-code path works WITHOUT a super-admin key, so the
  // "Need to set or recover the password?" link must stay available on a
  // key-less (public) deployment. Only the legacy key-framed toggle and the
  // now-meaningless super-admin key field are hidden when no key is set.
  if (!SUPERADMIN_KEY) {
    const sToggle = el("superadmin-toggle");
    if (sToggle) sToggle.classList.add("hidden");
    // Hide the super-admin key input + its label (the closest <label>
    // ancestor) so the panel shows only the password + recovery fields.
    const keyInput = el("superadmin-key-input");
    if (keyInput) {
      const keyLabel = keyInput.closest("label") || keyInput;
      keyLabel.classList.add("hidden");
    }
  }
  initSoundToggle();
}

/* the header sound toggle - celebration chimes are OFF by default (a projected
   room should not suddenly make noise); the choice is remembered per device */
function initSoundToggle() {
  const btn = el("sound-toggle");
  if (!btn) return;
  soundOn = localStorage.getItem("canamed_sound") === "on";
  const paint = () => {
    btn.textContent = soundOn ? "🔊" : "🔇";
    btn.setAttribute("aria-pressed", String(soundOn));
    const label = soundOn
      ? "Celebration sounds are on — tap to mute"
      : "Sound is off — tap to turn celebration sounds on";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  paint();
  btn.addEventListener("click", () => {
    soundOn = !soundOn;
    try { localStorage.setItem("canamed_sound", soundOn ? "on" : "off"); } catch (e) {}
    paint();
    if (soundOn) {
      // a user gesture - safe to create/resume the AudioContext and confirm
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { if (!audioCtx) audioCtx = new AC(); if (audioCtx.resume) audioCtx.resume(); }
      } catch (e) { /* ignore */ }
      playCue("milestone");
    }
  });
}

// small helper that resolves an i18n key via window.t when available, falling
// back to the supplied English default if t() isn't loaded or returns the key
// unchanged (missing translation). Keeps script.js usable in tests/old browsers.
function tt(key, fallback) {
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const v = window.t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

function readName(hintId) {
  const nameInput = el("name-input");
  const n = (nameInput.value || "").trim();
  if (!n) {
    nameInput.focus(); nameInput.classList.add("err");
    if (hintId) el(hintId).textContent = tt("lobby.name-required-hint", "Enter your name.");
    return null;
  }
  nameInput.classList.remove("err");
  // localStorage can throw on Safari private mode + quota-exceeded; never
  // let a persistence failure break the join flow.
  try { localStorage.setItem("canamed_name", n); } catch (e) {}
  return n;
}
function readSession(hintId) {
  const inp = el("session-input");
  const raw = (inp.value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!raw) {
    inp.focus(); inp.classList.add("err");
    if (hintId) el(hintId).textContent = tt("lobby.session-required-hint", "Enter the session number.");
    return null;
  }
  inp.classList.remove("err");
  try { localStorage.setItem("canamed_session", raw); } catch (e) {}
  return raw;
}

/* version stamp written next to every consent record. Bump whenever the
   privacy notice / Participant Information Sheet text changes materially
   so that researchers can identify which version of the notice each
   participant consented to. */
const CONSENT_NOTICE_VERSION = "PIS-v1-2026-05";

/* ===================== PARTICIPANT: JOIN -> WAITING -> ROOM ===================== */
function joinParticipant() {
  if (joined) return;
  if (sharedExpectedButBroken()) { el("lobby-hint").textContent = SDK_BROKEN_MSG; return; }
  el("lobby-hint").textContent = "";
  // GDPR Art. 6/7/9 + APPI Art. 20(2): the workshop-consent box is required;
  // the research-consent box is optional and recorded separately so that
  // analysis pipelines can skip participants who opted out
  const cWorkshop = !!(el("consent-workshop") && el("consent-workshop").checked);
  const cResearch = !!(el("consent-research") && el("consent-research").checked);
  if (!cWorkshop) {
    el("lobby-hint").textContent = tt(
      "lobby.consent-required-hint",
      "Please read the data-use notice and tick the consent box above to take part."
    );
    if (el("consent-workshop")) el("consent-workshop").focus();
    return;
  }
  sessionNum = readSession("lobby-hint");
  if (!sessionNum) return;
  myName = readName("lobby-hint");
  if (!myName) return;
  myUniversity = el("uni-input").value;
  if (!myUniversity) {
    el("uni-input").focus();
    el("lobby-hint").textContent = tt(
      "lobby.university-required-hint",
      "Please select your university."
    );
    return;
  }
  joined = true;
  myYear = parseInt(el("year-input").value, 10);
  myEnglish = el("english-input").value;
  // pin the consent values to module-level state so the pool write + any
  // re-write on auto-resume use the same record
  myConsent = {
    workshop: cWorkshop,
    research: cResearch,
    version: CONSENT_NOTICE_VERSION,
    at: Date.now()
  };
  role = "participant";
  dbInit();

  el("lobby").classList.add("hidden");
  el("waiting").classList.remove("hidden");
  el("waiting-name").textContent = myName;
  el("header-right").textContent = "Session " + sessionNum;
  el("header-right").className = "mode-badge " + (MODE === "shared" ? "shared" : "solo");
  el("waiting-leave").addEventListener("click", leaveAndReload);
  // GDPR Art. 15 self-export button. Wired once per join — guarded so
  // re-joining after a leave doesn't stack handlers.
  const gdprBtn = el("gdpr-export-btn");
  if (gdprBtn && !gdprBtn.dataset.wired) {
    gdprBtn.dataset.wired = "1";
    gdprBtn.addEventListener("click", downloadMyData);
  }
  focusHeading("waiting");
  updateWaitingStatus();   // show status immediately, not only once refStarted fires

  // Wait for anonymous (or identified) sign-in to complete before writing
  // to the database — under Round-2 rules every write path requires
  // `auth != null`. ensureSignedIn() resolves immediately in solo / local
  // mode, and resolves with null on failure (so we still try the writes
  // and surface a visible error if the rules deny them).
  //
  // In parallel, lazy-load case-content (out of the splash bundle). By
  // the time auth resolves it is usually already in the HTTP cache via
  // the loader's idle prefetch. The previously-planned script-room.js
  // chunk was removed in R2-01: the room-runtime functions still live
  // inline in script.js, so there is nothing extra to await here.
  const loader = window.CanamedLoader;
  // Load case-content AND the (now lazy) glossary before the participant
  // lands in Module A, so term tooltips are ready on first render. Glossary
  // is non-blocking-critical (the annotator degrades gracefully), but pairing
  // it with the case-content await guarantees it's present for Module A/B.
  const roomChunks = loader
    ? Promise.all([
        loader.ensureCaseContent(),
        loader.ensureGlossary ? loader.ensureGlossary() : Promise.resolve()
      ])
    : Promise.resolve();
  Promise.all([ensureSignedIn(), roomChunks]).then(() => {
    try { rebuildCaseDerived(); } catch (_) {}
    _joinParticipantAfterAuth();
  });
}

/* R2-09: claim membership in the session under the user's auth.uid.
 * The Round-2 rules narrow /sessions/$sessionId/.read to members only
 * (plus a small set of pre-join readable fields with their own .read).
 * Every join path — participant, admin, super-admin — must call this
 * after sign-in so the user can read pool, rooms, etc. The write is
 * idempotent (key is auth.uid) and best-effort; failures are logged
 * but not surfaced to the user, because the legacy database (without
 * the new `members` rule deployed) will return PERMISSION_DENIED and
 * we still want the rest of the join flow to proceed in that case. */
function claimMembership(roleStr) {
  if (!db || !currentUser || !currentUser.uid || !sessionNum) return Promise.resolve();
  try {
    const payload = { at: Date.now() };
    if (roleStr) payload.role = String(roleStr).slice(0, 20);
    return db.ref(sPath("members/" + currentUser.uid)).set(payload).catch(e => {
      // Tolerated: legacy DBs without the members rule reject the write.
      // We log so an operator notices in staging, but the join continues.
      try { console.warn("claimMembership failed (continuing):", e && e.code); } catch (_) {}
    });
  } catch (e) {
    try { console.warn("claimMembership threw (continuing):", e); } catch (_) {}
    return Promise.resolve();
  }
}

/* R3 FINDING-01: bind this tab's clientId to auth.uid, write-once. The
 * server rules for pool / presence / typing / tests / poll / observers
 * accept a write to $clientId only when this mapping is absent (first
 * write) or already equals the caller's uid — so one participant can no
 * longer overwrite another's slot. Best-effort + idempotent:
 *   - on a refresh the same clientId re-resolves and the write-once rule
 *     refuses the re-set; that's expected and harmless (the binding is
 *     already ours), so PERMISSION_DENIED is swallowed.
 *   - on a legacy DB without the clientMapping rule, the write simply
 *     lands as ordinary data; the tolerant ".write" rule keeps working. */
function claimClientMapping() {
  if (!db || !currentUser || !currentUser.uid || !sessionNum || !clientId) {
    return Promise.resolve();
  }
  try {
    return db.ref(sPath("clientMapping/" + clientId)).set(currentUser.uid).catch(e => {
      // Expected when the binding already exists (refresh / re-join) or on
      // a legacy DB; the join continues regardless.
      try { console.warn("claimClientMapping skipped (continuing):", e && e.code); } catch (_) {}
    });
  } catch (e) {
    try { console.warn("claimClientMapping threw (continuing):", e); } catch (_) {}
    return Promise.resolve();
  }
}

/* R3 FINDING-01 (ballots): bind this person's stableId to auth.uid, write-once.
 * Ballots are keyed by stableId (see ballotKey / castVote), so the per-tab
 * clientMapping guard cannot protect them — a peer could otherwise overwrite
 * another participant's ballot to swing a team tally. This parallel
 * stableIdMapping is what the votes/ballots .write rule consults: once a
 * stableId is bound here, only its owner (or, until then, the first writer)
 * can write a ballot under that key. Best-effort + idempotent, exactly like
 * claimClientMapping: a refresh re-resolves the same stableId and the
 * write-once rule refuses the re-set (PERMISSION_DENIED is swallowed). */
function claimStableIdMapping() {
  if (!db || !currentUser || !currentUser.uid || !sessionNum ||
      typeof stableId !== "string" || !stableId) {
    return Promise.resolve();
  }
  try {
    return db.ref(sPath("stableIdMapping/" + stableId)).set(currentUser.uid).catch(e => {
      try { console.warn("claimStableIdMapping skipped (continuing):", e && e.code); } catch (_) {}
    });
  } catch (e) {
    try { console.warn("claimStableIdMapping threw (continuing):", e); } catch (_) {}
    return Promise.resolve();
  }
}

function _joinParticipantAfterAuth() {
  // user may have hit "Leave" while we were waiting for auth
  if (!joined) return;
  // R2-09: claim membership BEFORE setting up the listeners below, so the
  // session-level .read predicate (data.child('members').hasChild(auth.uid))
  // is satisfied by the time the .on("value") handlers fire. We chain
  // through claimMembership() because the listener installs would race the
  // members write otherwise and the server would PERMISSION_DENY them.
  // R3 FINDING-01: also bind clientId->uid before the pool write so the
  // owner-only write rules accept our own pool/presence/typing/tests writes.
  claimMembership("participant")
    .then(() => claimClientMapping())
    .then(() => claimStableIdMapping())
    .then(() => {
      if (!joined) return; // user left while membership write was in-flight
      _joinParticipantWireUp();
    });
}

function _joinParticipantWireUp() {
  refPool = db.ref(sPath("pool"));
  refMyPool = refPool.child(clientId);
  refStarted = db.ref(sPath("started"));
  refRoomCount = db.ref(sPath("roomCount"));
  refTeams = db.ref(sPath("teamsLink"));
  refQuiz = db.ref(sPath("questionnaireLink"));
  refPreQuiz = db.ref(sPath("preQuestionnaireLink"));

  const resumeRoom = (resumeData && resumeData.sessionNum === sessionNum)
    ? (resumeData.room || null) : null;
  // cancel any onDisconnect left over from a prior connection before re-asserting,
  // so a stale server-side remove cannot wipe the entry we are about to write
  try { refMyPool.onDisconnect().cancel(); } catch (e) {}
  refMyPool.set({
    name: myName, university: myUniversity, year: myYear,
    english: myEnglish, at: Date.now(), room: resumeRoom,
    consent: myConsent,
    // R2-24/25: stableId is a per-person identifier (Google uid for
    // signed-in users, localStorage random for anonymous) that lets
    // research deduplicate one person across tab refresh / close.
    // Distinct from clientId (per-tab, key of this pool entry).
    stableId: stableId
  });
  // log this session under the signed-in user's history (if any); silent
  // no-op for anonymous joiners
  pushSessionToHistory(sessionNum);
  // Membership is persistent: do NOT arm onDisconnect().remove() here. On
  // mobile, locking the screen or switching apps drops the connection, and an
  // onDisconnect-remove would eject the student from their room every time.
  // They now stay in the session across disconnects and reconnect on wake.
  // (The cancel() above clears any stale removal armed by an older build.)
  saveResume(resumeRoom);

  refRoomCount.on("value", snap => { roomCount = snap.val() || 4; });
  refStarted.on("value", snap => { started = !!snap.val(); maybeSelfAssign(); updateWaitingStatus(); });
  refTeams.on("value", snap => { teamsLink = snap.val() || ""; renderTeamsButtons(); });
  refQuiz.on("value", snap => { quizLink = snap.val() || ""; renderQuizButton(); });
  refPreQuiz.on("value", snap => { preQuizLink = snap.val() || ""; renderPreQuizButton(); });
  refPool.on("value", snap => {
    pool = snap.val() || {};
    renderWaitingList();
    const mine = pool[clientId];
    // Safety net: if we are joined but our entry is missing (e.g. a stale
    // onDisconnect-remove armed by an older build fired, or an admin action),
    // re-assert it — keeping any room we were already placed in. Cancel any
    // leftover server-side removal so it cannot wipe us again.
    if (!mine && joined) {
      try { refMyPool.onDisconnect().cancel(); } catch (e) {}
      refMyPool.set({
        name: myName, university: myUniversity, year: myYear,
        english: myEnglish, at: Date.now(), room: myRoom || null,
        consent: myConsent,
        stableId: stableId   // R2-24/25: persistent per-person id
      });
      return;
    }
    if (mine && mine.room && !myRoom) enterRoom(mine.room, false);
    else maybeSelfAssign();
  });
}

function updateWaitingStatus() {
  el("waiting-status").textContent = started
    ? "The session has started - placing you in a room…"
    : "You have joined. Waiting for a facilitator to start the session…";
}
function renderWaitingList() {
  const list = el("waiting-list");
  const waiting = Object.keys(pool).map(cid => pool[cid]);
  el("waiting-count").textContent = waiting.length;
  list.innerHTML = "";
  waiting.sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(p => {
    list.appendChild(makeChip(p.name,
      p.name + " · " + p.university + " · Y" + p.year + " · " + p.english));
  });
}
function renderTeamsButtons() {
  const safe = safeHref(teamsLink);
  [el("teams-btn"), el("teams-btn-waiting")].forEach(btn => {
    if (!btn) return;
    if (safe) { btn.href = safe; btn.classList.remove("hidden"); }
    else { btn.removeAttribute("href"); btn.classList.add("hidden"); }
  });
}
function renderQuizButton() {
  const btn = el("quiz-btn"), fallback = el("quiz-fallback");
  const safe = safeHref(quizLink);
  if (btn) {
    if (safe) {
      btn.href = safe;
      btn.classList.remove("hidden");
      if (fallback) fallback.classList.add("hidden");
    } else {
      btn.removeAttribute("href");
      btn.classList.add("hidden");
      if (fallback) fallback.classList.remove("hidden");
    }
  }
  // also light up the post-questionnaire link on the "session ended" screen
  // (the facilitator wants students to find it even if they were kicked
  // before reaching the Wrap-up stage)
  const ended = el("ended-quiz-btn");
  if (ended) {
    if (safe) { ended.href = safe; ended.classList.remove("hidden"); }
    else { ended.removeAttribute("href"); ended.classList.add("hidden"); }
  }
}
/* the pre-session questionnaire button on the Welcome stage - shown only
   when the facilitator has entered a link in the admin dashboard */
function renderPreQuizButton() {
  const btn = el("prequiz-btn");
  const card = el("prequiz-card");
  if (!btn || !card) return;
  const safe = safeHref(preQuizLink);
  if (safe) {
    btn.href = safe;
    card.classList.remove("hidden");
  } else {
    btn.removeAttribute("href");
    card.classList.add("hidden");
  }
}
/* ===================== PRE / POST KNOWLEDGE TESTS ==========================
 * Per-scenario optional MCQ banks rendered in-platform. Pre-test on the
 * Welcome stage (so the room has it in their hands before Module A starts),
 * post-test on the Wrap-up stage. Both are OPTIONAL: a Skip button records
 * the skip in the DB and the workshop continues normally. Storage path:
 *   /sessions/{code}/rooms/{room}/tests/{cid}/{pre|post}/{startedAt,
 *     completedAt, skipped, score, answers:{qid:{choice,at}}}
 * Score is computed client-side and persisted so the upcoming debrief
 * dashboard can aggregate without re-reading the question keys. The
 * client-id (per-tab) keys each student's record — so re-loading the page
 * resumes the same record rather than creating a fresh one.
 * ========================================================================== */
const _TEST_RUNTIME = { pre: null, post: null };

function _testBank(which) {
  const bank = which === "pre" ? window.PRETEST : window.POSTTEST;
  return Array.isArray(bank) ? bank : [];
}

function _testRef(which) {
  // tests live under the room subtree, keyed by clientId (per-tab). If we
  // are not in a room yet (e.g. admin viewing the dashboard) bail out —
  // tests are a participant-only affordance.
  if (!db || !sessionNum || !myRoom || !clientId) return null;
  return db.ref(sPath("rooms/" + myRoom + "/tests/" + clientId + "/" + which));
}

function _tFmt(key, vars) {
  let s = (typeof window.t === "function") ? window.t(key) : key;
  if (vars) Object.keys(vars).forEach(k => { s = s.replace("{" + k + "}", vars[k]); });
  return s;
}

/* Read whether the participant has already taken (or skipped) the given test
   on this device. Called once when the panel mounts; subsequent state is
   tracked in _TEST_RUNTIME so we don't refetch on every keystroke. */
function _loadTestStatus(which) {
  const ref = _testRef(which);
  if (!ref) return Promise.resolve(null);
  return ref.once("value").then(snap => snap.val()).catch(() => null);
}

function _saveTestAnswer(which, qid, choiceIndex) {
  const ref = _testRef(which);
  if (!ref) return Promise.resolve(false);
  return ref.child("answers/" + qid)
    .set({ choice: choiceIndex, at: Date.now() })
    .then(() => true).catch(e => { console.warn("test save failed", e); return false; });
}

function _saveTestStart(which) {
  const ref = _testRef(which);
  if (!ref) return Promise.resolve(false);
  return ref.child("startedAt").transaction(cur => (cur == null ? Date.now() : undefined))
    .then(() => {
      // R4 linkage: tag the test with the durable per-person id so a
      // researcher can link pre↔post↔questionnaire reliably (the test node
      // is otherwise keyed only by the ephemeral per-tab clientId).
      if (typeof stableId === "string" && stableId) {
        ref.child("stableId").set(stableId).catch(() => {});
      }
      return true;
    }).catch(() => false);
}

function _saveTestComplete(which, score) {
  const ref = _testRef(which);
  if (!ref) return Promise.resolve(false);
  return ref.update({ completedAt: Date.now(), score: score })
    .then(() => true).catch(() => false);
}

function _saveTestSkipped(which) {
  const ref = _testRef(which);
  if (!ref) return Promise.resolve(false);
  // ensure a startedAt exists so the rules validation passes
  return ref.transaction(cur => {
    const now = Date.now();
    const prev = cur || {};
    const next = Object.assign({}, prev, {
      startedAt: prev.startedAt || now,
      skipped: true
    });
    // R4 linkage: keep the durable per-person id on a skipped test too, so a
    // non-completer still links to their pre-test + questionnaire (attrition).
    if (typeof stableId === "string" && stableId) next.stableId = stableId;
    return next;
  }).then(() => true).catch(e => { console.warn("skip save failed", e); return false; });
}

/* Build the per-test panel. `which` is "pre" or "post". On first call we
   show the intro + Start/Skip buttons; tapping Start mounts the question
   runner. The runner shows one question at a time, the explanation after
   submission, then a Next button. After the last question we render the
   score and a Thanks. The whole thing is rebuilt from scratch on language
   change (applyI18n re-runs on setLang). */
function _mountTestRunner(which) {
  const bank = _testBank(which);
  const bodyId = which === "pre" ? "pretest-body" : "posttest-body";
  const body = el(bodyId);
  if (!body || !bank.length) return;
  body.innerHTML = "";
  body.classList.remove("hidden");

  const state = _TEST_RUNTIME[which] = _TEST_RUNTIME[which] || {
    index: 0, score: 0, picked: null, answered: false
  };

  function render() {
    body.innerHTML = "";
    const lang = _curLang();
    if (state.index >= bank.length) {
      // Final score panel
      _saveTestComplete(which, state.score);
      const wrap = document.createElement("div");
      wrap.className = "test-result";
      const h = document.createElement("p");
      h.className = "score";
      h.textContent = _tFmt("test.score-line",
        { n: state.score, total: bank.length });
      wrap.appendChild(h);
      const thanks = document.createElement("p");
      thanks.textContent = _tFmt("test.thanks");
      wrap.appendChild(thanks);
      const done = document.createElement("p");
      done.className = "hint";
      done.textContent = _tFmt("test.complete");
      wrap.appendChild(done);
      body.appendChild(wrap);
      return;
    }
    const q = bank[state.index];
    const prog = document.createElement("p");
    prog.className = "test-progress";
    prog.textContent = _tFmt("test.question",
      { n: state.index + 1, total: bank.length });
    body.appendChild(prog);

    const qEl = document.createElement("p");
    qEl.className = "test-question";
    qEl.textContent = tc(q.q, lang);
    body.appendChild(qEl);

    const opts = document.createElement("div");
    opts.className = "test-options";
    body.appendChild(opts);

    (q.options || []).forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "test-option";
      b.textContent = tc(opt.text, lang);
      b.setAttribute("aria-pressed", state.picked === i ? "true" : "false");
      b.disabled = !!state.answered;
      if (state.answered) {
        if (opt.correct) b.classList.add("correct");
        else if (state.picked === i) b.classList.add("incorrect");
      }
      b.addEventListener("click", () => {
        if (state.answered) return;
        state.picked = i;
        // re-render to reflect the selection
        render();
      });
      opts.appendChild(b);
    });

    if (state.answered) {
      const correct = (q.options[state.picked] || {}).correct === true;
      const fb = document.createElement("div");
      fb.className = "test-feedback " + (correct ? "correct" : "incorrect");
      const head = document.createElement("strong");
      head.textContent = correct ? _tFmt("test.correct") : _tFmt("test.incorrect");
      fb.appendChild(head);
      const expl = document.createElement("span");
      expl.textContent = tc(q.explanation, lang);
      fb.appendChild(expl);
      body.appendChild(fb);
    }

    const controls = document.createElement("div");
    controls.className = "test-controls";
    body.appendChild(controls);

    if (!state.answered) {
      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "ghost-btn";
      skipBtn.textContent = _tFmt("test.skip-question");
      skipBtn.addEventListener("click", () => {
        // Skip = move past this question without grading, revealing the
        // answer, or recording the picked option. (Previously it set
        // answered=true, which rendered the graded feedback — showing
        // "Incorrect" and the correct answer — so a skip looked like a
        // submitted wrong answer.) No points are awarded for a skip.
        state.index += 1;
        state.picked = null;
        state.answered = false;
        render();
      });
      controls.appendChild(skipBtn);

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "teams-btn";
      submitBtn.textContent = _tFmt("test.submit");
      submitBtn.disabled = state.picked == null;
      submitBtn.addEventListener("click", () => {
        if (state.picked == null) return;
        state.answered = true;
        const correct = (q.options[state.picked] || {}).correct === true;
        if (correct) state.score += 1;
        _saveTestAnswer(which, q.id || ("q" + (state.index + 1)), state.picked);
        render();
      });
      controls.appendChild(submitBtn);
    } else {
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "teams-btn";
      const last = state.index >= bank.length - 1;
      nextBtn.textContent = last ? _tFmt("test.see-results") : _tFmt("test.next");
      nextBtn.addEventListener("click", () => {
        state.index += 1;
        state.picked = null;
        state.answered = false;
        render();
      });
      controls.appendChild(nextBtn);
    }
  }

  render();
}

function renderPreTest() { return _renderTestCard("pre"); }
function renderPostTest() { return _renderTestCard("post"); }

function _renderTestCard(which) {
  const cardId = which === "pre" ? "pretest-card" : "posttest-card";
  const startBtnId = which === "pre" ? "pretest-start-btn" : "posttest-start-btn";
  const skipBtnId = which === "pre" ? "pretest-skip-btn" : "posttest-skip-btn";
  const bodyId = which === "pre" ? "pretest-body" : "posttest-body";
  const introId = which === "pre" ? "pretest-card-intro" : "posttest-card-intro";
  const card = el(cardId);
  if (!card) return;
  const bank = _testBank(which);
  // Hide the whole card if the scenario doesn't ship a bank, or we're not
  // in a participant room yet (admins viewing a room get the same panel
  // but the writes go through cleanly under the same auth).
  if (!bank.length || !myRoom || isRoomAdmin) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  // Pull persisted state once and show the right view.
  _loadTestStatus(which).then(rec => {
    const startBtn = el(startBtnId);
    const skipBtn = el(skipBtnId);
    const body = el(bodyId);
    const intro = el(introId);
    if (!startBtn || !skipBtn || !body) return;
    const completed = rec && typeof rec.completedAt === "number";
    const skipped = rec && rec.skipped === true;
    if (completed) {
      // already took it — hide intro/buttons, show a short "thanks" line
      if (intro) intro.textContent = _tFmt("test.already-done");
      startBtn.classList.add("hidden");
      skipBtn.classList.add("hidden");
      body.classList.add("hidden");
      body.innerHTML = "";
      return;
    }
    if (skipped) {
      if (intro) intro.textContent = _tFmt("test.skipped");
      startBtn.classList.remove("hidden");
      // re-show the Start as "take it now" — the skip button can disappear
      skipBtn.classList.add("hidden");
    } else {
      startBtn.classList.remove("hidden");
      skipBtn.classList.remove("hidden");
    }

    // wire (idempotent — re-binding is fine because we replace listeners
    // by cloning); use a marker attribute so we only bind once per card.
    if (!startBtn.dataset.bound) {
      startBtn.dataset.bound = "1";
      startBtn.addEventListener("click", () => {
        _saveTestStart(which);
        startBtn.classList.add("hidden");
        skipBtn.classList.add("hidden");
        _TEST_RUNTIME[which] = { index: 0, score: 0, picked: null, answered: false };
        _mountTestRunner(which);
      });
    }
    if (!skipBtn.dataset.bound) {
      skipBtn.dataset.bound = "1";
      skipBtn.addEventListener("click", () => {
        _saveTestSkipped(which);
        startBtn.classList.remove("hidden");
        skipBtn.classList.add("hidden");
        body.classList.add("hidden");
        body.innerHTML = "";
        if (intro) intro.textContent = _tFmt("test.skipped");
      });
    }
  });
}

/* ===================== END-OF-SESSION FEEDBACK SURVEY =====================
 * The subjective questionnaire (Likert + single-choice + open-ended), captured
 * in-platform on the Wrap-up stage and stored alongside the pre/post tests at
 *   /sessions/{code}/rooms/{room}/survey/{cid}:
 *     { startedAt, completedAt, skipped, stableId, responses:{ qid:{ v, at } } }
 * The bank is window.SURVEY (case-content.js). Optional + skippable; never
 * blocks closing the session. Mirrors the pre/post test card lifecycle, but
 * renders one scrollable form (a survey gives no per-item feedback, so the
 * one-question-at-a-time runner the tests use would only add friction). */
function _surveyBank() {
  return Array.isArray(window.SURVEY) ? window.SURVEY : [];
}
function _surveyRef() {
  // survey lives under the room subtree, keyed by clientId (per-tab), exactly
  // like the tests node — so the admin export can read both the same way.
  if (!db || !sessionNum || !myRoom || !clientId) return null;
  return db.ref(sPath("rooms/" + myRoom + "/survey/" + clientId));
}
function _loadSurveyStatus() {
  const ref = _surveyRef();
  if (!ref) return Promise.resolve(null);
  return ref.once("value").then(snap => snap.val()).catch(() => null);
}
function _saveSurveyStart() {
  const ref = _surveyRef();
  if (!ref) return Promise.resolve(false);
  return ref.child("startedAt").transaction(cur => (cur == null ? Date.now() : undefined))
    .then(() => {
      if (typeof stableId === "string" && stableId) ref.child("stableId").set(stableId).catch(() => {});
      return true;
    }).catch(() => false);
}
function _saveSurveySkipped() {
  const ref = _surveyRef();
  if (!ref) return Promise.resolve(false);
  return ref.transaction(cur => {
    const now = Date.now();
    const prev = cur || {};
    const next = Object.assign({}, prev, { startedAt: prev.startedAt || now, skipped: true });
    if (typeof stableId === "string" && stableId) next.stableId = stableId;
    return next;
  }).then(() => true).catch(e => { console.warn("survey skip failed", e); return false; });
}
function _saveSurveyComplete(responses) {
  const ref = _surveyRef();
  if (!ref) return Promise.resolve(false);
  const update = { completedAt: Date.now() };
  Object.keys(responses).forEach(qid => { update["responses/" + qid] = responses[qid]; });
  return ref.update(update).then(() => true).catch(e => { console.warn("survey save failed", e); return false; });
}

/* Resolve a survey item's `prefill` key to the value the participant already
   gave on the join form, so the questionnaire never re-asks it (dry-run
   feedback 2026-05-26). Prefer the post-join globals; fall back to the live
   join inputs (still in the DOM, also restored on resume) so the value is
   available even before a global is set. Returns "" when unknown. */
function _surveyProfileVal(key) {
  if (key === "university") {
    if (typeof myUniversity === "string" && myUniversity) return myUniversity;
    const i = el("uni-input");
    return (i && typeof i.value === "string" && i.value) ? i.value : "";
  }
  if (key === "year") {
    if (myYear != null && !isNaN(myYear) && myYear) return String(myYear);
    const i = el("year-input");
    return (i && i.value) ? String(i.value) : "";
  }
  return "";
}

/* Build the scrollable survey form into #survey-body. Exposed for E2E so a
   test can mount it without a live wrap-up stage. */
function _mountSurveyForm() {
  const body = el("survey-body");
  const bank = _surveyBank();
  if (!body || !bank.length) return;
  body.innerHTML = "";
  body.classList.remove("hidden");
  const lang = _curLang();
  const form = document.createElement("div");
  form.className = "survey-form";
  const getters = {};
  let lastSection = null;
  bank.forEach(item => {
    const secText = item.section ? tc(item.section, lang) : "";
    if (secText && secText !== lastSection) {
      lastSection = secText;
      const h = document.createElement("h4");
      h.className = "survey-section";
      h.textContent = secText;
      form.appendChild(h);
    }
    const field = document.createElement("div");
    field.className = "survey-field";
    const q = document.createElement("p");
    q.className = "survey-q";
    q.textContent = tc(item.q, lang);
    field.appendChild(q);

    if (item.type === "likert") {
      const scale = document.createElement("div");
      scale.className = "survey-likert";
      scale.setAttribute("role", "radiogroup");
      scale.setAttribute("aria-label", tc(item.q, lang));
      const picked = { v: null };
      for (let n = 1; n <= 5; n++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "survey-likert-opt";
        b.textContent = String(n);
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", n + " — " + _tFmt("survey.likert." + n));
        b.setAttribute("aria-checked", "false");
        b.addEventListener("click", () => {
          picked.v = n;
          Array.from(scale.children).forEach((c, i) => {
            if (c.classList.contains("survey-likert-opt")) c.setAttribute("aria-checked", (i + 1) === n ? "true" : "false");
          });
        });
        scale.appendChild(b);
      }
      field.appendChild(scale);
      const ends = document.createElement("div");
      ends.className = "survey-likert-ends";
      const lo = document.createElement("span"); lo.textContent = _tFmt("survey.likert.1");
      const hi = document.createElement("span"); hi.textContent = _tFmt("survey.likert.5");
      ends.appendChild(lo); ends.appendChild(hi);
      field.appendChild(ends);
      getters[item.id] = () => picked.v;
    } else if (item.type === "single") {
      const sel = document.createElement("select");
      sel.className = "survey-select";
      sel.setAttribute("aria-label", tc(item.q, lang));
      const ph = document.createElement("option");
      ph.value = ""; ph.textContent = _tFmt("survey.choose");
      sel.appendChild(ph);
      (item.options || []).forEach(o => {
        const op = document.createElement("option");
        op.value = o.v; op.textContent = tc(o.text, lang);
        sel.appendChild(op);
      });
      field.appendChild(sel);
      // Pre-fill from the join profile so we never re-ask university/year
      // (dry-run feedback). Stays editable: a wrong join entry can be corrected.
      if (item.prefill) {
        const pv = _surveyProfileVal(item.prefill);
        if (pv && Array.from(sel.options).some(o => o.value === pv)) {
          sel.value = pv;
          field.classList.add("survey-prefilled");
          const hint = document.createElement("p");
          hint.className = "survey-prefill-hint";
          hint.textContent = _tFmt("survey.prefilled");
          field.appendChild(hint);
        }
      }
      getters[item.id] = () => (sel.value || null);
    } else {
      const ta = document.createElement("textarea");
      ta.className = "survey-open";
      ta.rows = 3; ta.maxLength = 2000;
      ta.setAttribute("aria-label", tc(item.q, lang));
      field.appendChild(ta);
      getters[item.id] = () => (ta.value || "").trim();
    }
    form.appendChild(field);
  });
  body.appendChild(form);

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "teams-btn survey-submit";
  submit.id = "survey-submit-btn";
  submit.textContent = _tFmt("survey.submit");
  submit.addEventListener("click", () => {
    submit.disabled = true;
    const responses = {};
    Object.keys(getters).forEach(qid => {
      const v = getters[qid]();
      if (v === null || v === undefined || v === "") return;
      responses[qid] = { v: v, at: Date.now() };
    });
    _saveSurveyComplete(responses).then(() => {
      body.innerHTML = "";
      const done = document.createElement("p");
      done.className = "survey-thanks";
      done.textContent = _tFmt("survey.thanks");
      body.appendChild(done);
    }).catch(() => { submit.disabled = false; });
  });
  body.appendChild(submit);
}

/* Mount the survey card on the Wrap-up stage. Hidden for room admins (they get
   the all-rooms export) and when no bank ships. Mirrors _renderTestCard(). */
function renderSurvey() {
  const card = el("survey-card");
  if (!card) return;
  const bank = _surveyBank();
  if (!bank.length || !myRoom || isRoomAdmin) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  _loadSurveyStatus().then(rec => {
    const startBtn = el("survey-start-btn");
    const skipBtn = el("survey-skip-btn");
    const body = el("survey-body");
    const intro = el("survey-card-intro");
    if (!startBtn || !skipBtn || !body) return;
    const completed = rec && typeof rec.completedAt === "number";
    const skipped = rec && rec.skipped === true;
    if (completed) {
      if (intro) intro.textContent = _tFmt("survey.already-done");
      startBtn.classList.add("hidden");
      skipBtn.classList.add("hidden");
      body.classList.add("hidden");
      body.innerHTML = "";
      return;
    }
    if (skipped) {
      if (intro) intro.textContent = _tFmt("survey.skipped");
      startBtn.classList.remove("hidden");
      skipBtn.classList.add("hidden");
    } else {
      startBtn.classList.remove("hidden");
      skipBtn.classList.remove("hidden");
    }
    if (!startBtn.dataset.bound) {
      startBtn.dataset.bound = "1";
      startBtn.addEventListener("click", () => {
        _saveSurveyStart();
        startBtn.classList.add("hidden");
        skipBtn.classList.add("hidden");
        _mountSurveyForm();
      });
    }
    if (!skipBtn.dataset.bound) {
      skipBtn.dataset.bound = "1";
      skipBtn.addEventListener("click", () => {
        _saveSurveySkipped();
        startBtn.classList.remove("hidden");
        skipBtn.classList.add("hidden");
        body.classList.add("hidden");
        body.innerHTML = "";
        if (intro) intro.textContent = _tFmt("survey.skipped");
      });
    }
  });
}

/* the wrap-up "your team did well" card - every room leaves with a named set
   of strengths and the cohort's shared total, so finishing not-#1 still feels
   like a real achievement. */
function renderTeamRecap() {
  const box = el("team-recap");
  if (!box) return;
  box.innerHTML = "";
  const earned = (roomScore && roomScore.auto) || {};
  const wins = [];
  Object.keys(earned).forEach(ev => {
    const meta = scoreEventMeta(ev);
    if (meta && meta.tier !== "micro") wins.push(meta.title);
  });
  const total = scoreTotal({ score: roomScore });
  const cohort = roomNames(roomCount)
    .reduce((s, r) => s + scoreTotal(allRooms[r] || {}), 0);
  const h = document.createElement("h3");
  h.textContent = "🎉 " + (teamName || myRoom || "Your team") + " — well played";
  box.appendChild(h);
  const tot = document.createElement("p");
  tot.className = "recap-total";
  tot.innerHTML = "Your team scored <strong>" + total + " points</strong>. " +
    "Together the whole cohort reached <strong>" + cohort + "</strong> — every " +
    "room's work counted toward that.";
  box.appendChild(tot);
  if (wins.length) {
    const sub = document.createElement("p");
    sub.className = "hint";
    sub.textContent = "What your team did well:";
    box.appendChild(sub);
    const ul = document.createElement("ul");
    ul.className = "recap-wins";
    wins.forEach(w => {
      const li = document.createElement("li");
      li.textContent = w;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  } else {
    const e = document.createElement("p");
    e.className = "hint";
    e.textContent = "Thank you for taking part today.";
    box.appendChild(e);
  }
  // a calm, non-punitive "worth remembering" note for any wrong choices made
  const pen = (roomScore && roomScore.penalties) || {};
  const penMetas = Object.keys(pen).map(penaltyMeta).filter(Boolean);
  if (penMetas.length) {
    const sub = document.createElement("p");
    sub.className = "hint";
    sub.textContent = "Worth remembering for next time:";
    box.appendChild(sub);
    const ul = document.createElement("ul");
    ul.className = "recap-lessons";
    penMetas.forEach(m => {
      const li = document.createElement("li");
      li.textContent = m.title + " — " + (m.why || "");
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
}
function renderWrapupSummary() {
  renderTeamRecap();
  const box = el("wrapup-summary");
  if (!box) return;
  box.innerHTML = "";
  [["moduleA", "Module A - Chronic Pain"], ["moduleB", "Module B - Breaking Bad News"]]
    .forEach(([moduleKey, label]) => {
      const h = document.createElement("h4");
      h.className = "wrapup-mod"; h.textContent = label;
      box.appendChild(h);
      const entries = entriesSorted(answers[moduleKey]);
      if (entries.length === 0) {
        const e = document.createElement("p");
        e.className = "empty"; e.textContent = "No points recorded.";
        box.appendChild(e);
        return;
      }
      const ul = document.createElement("ul");
      ul.className = "answers-list";
      entries.forEach(en => {
        const li = document.createElement("li");
        li.className = "answer-entry";
        const dot = document.createElement("span");
        dot.className = "dot"; dot.style.background = colorFor(en.by);
        const who = document.createElement("span");
        who.className = "answer-by"; who.textContent = en.by;
        const txt = document.createElement("span");
        txt.className = "answer-text"; txt.textContent = en.text;
        li.appendChild(dot); li.appendChild(who); li.appendChild(txt);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
}
function maybeSelfAssign() {
  if (myRoom || selfAssigning || !started) return;
  const mine = pool[clientId];
  if (!mine || mine.room) return;
  selfAssigning = true;
  // if the round-trip stalls (flaky wifi), release the lock so a later pool
  // update can retry instead of leaving the student stuck in the waiting room
  const stallGuard = setTimeout(() => { selfAssigning = false; }, 8000);
  Promise.all([refPool.once("value"), refRoomCount.once("value")]).then(res => {
    const poolNow = res[0].val() || {};
    const rc = res[1].val() || 4;
    if (poolNow[clientId] && poolNow[clientId].room) {
      clearTimeout(stallGuard); selfAssigning = false; return;
    }
    const assignedPool = Object.keys(poolNow).map(cid => poolNow[cid]);
    const person = poolNow[clientId] || mine;
    const target = bestRoomFor(person, assignedPool, rc);
    return refMyPool.child("room").set(target).then(() => {
      clearTimeout(stallGuard); selfAssigning = false;
    });
  }).catch(e => {
    console.error(e);
    clearTimeout(stallGuard);
    selfAssigning = false;
    el("waiting-status").textContent =
      "We could not place you in a room yet. It will try again automatically. " +
      "If nothing happens after a minute, please reload the page.";
  });
}

/* ===================== ROOM VIEW (participants AND admins) ===================== */
/* Wire the room-view event listeners exactly once - enterRoom may run several
 * times (an admin switching rooms), but listeners must not stack up. */
function wireRoomUI() {
  buildButtons();
  initAnswers();
  initReset();
  initStageNav();
  initCallProf();
  initLeave();
  initObserver();
  initSideChat();
  initEndPoll();
  initTeamName();
  initRolePicker();
  initCoachDismiss();
  initHypotheses();
  // Initial coach paint — set the text + stepper-state from current
  // platform state on entry. Subsequent updates fire from the render
  // paths (renderFindings / renderPrompts / renderAnswers / switchRcolTab).
  if (typeof updateModANextStep === "function") updateModANextStep();
  if (typeof updateModBNextStep === "function") updateModBNextStep();
  initRightColumnTabs();
}

/* ===================== STAGE 1: right-column tab bar =======================
   The right column carries five distinct things (findings, team decisions,
   discussion, group answers, reference) - each one big enough to bury the
   others if they all flowed in a single scroll. Tabs collapse the scroll to one
   click per section. The DOM ids of every section are unchanged so the rest of
   the engine (renderFindings, renderDecisions, renderPrompts, renderAnswers)
   keeps working unmodified - the tabs only toggle visibility and a small badge
   that nudges attention when something new arrives while a different tab is
   open. */
/* Default tab. Was "findings" until the tab was removed 2026-05-18
   (redundant with inline-reveal chips under each chart button).
   "decisions" is now the first tab and the natural default. */
let activeRcolTab = "decisions";
function initRightColumnTabs() {
  const bar = document.querySelector(".rcol-tabs");
  if (!bar || bar.dataset.wired) return;
  bar.dataset.wired = "1";
  bar.querySelectorAll(".rcol-tab").forEach(btn => {
    btn.addEventListener("click", () => switchRcolTab(btn.dataset.tab));
    btn.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const tabs = [...bar.querySelectorAll(".rcol-tab")];
      const i = tabs.indexOf(btn);
      const next = e.key === "ArrowRight"
        ? tabs[(i + 1) % tabs.length] : tabs[(i - 1 + tabs.length) % tabs.length];
      next.focus(); switchRcolTab(next.dataset.tab);
    });
  });
}
function switchRcolTab(tab) {
  if (!tab) return;
  activeRcolTab = tab;
  document.querySelectorAll(".rcol-tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
    if (on) b.classList.remove("has-attention");
  });
  document.querySelectorAll(".rcol-panel").forEach(p => {
    const on = p.dataset.panel === tab;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  // The Module A coach text depends on which tab the user is on
  // (e.g. "open Discussion" vs "you're in Discussion — when ready,
  // open Group answers"). Refresh on every tab change.
  if (typeof updateModANextStep === "function") updateModANextStep();
}
/* a small attention nudge: when content changes while the user is on a different
   tab, dot that tab so they know there is something new. Always safe to call. */
function nudgeRcolTab(tab) {
  if (tab === activeRcolTab) return;
  const btn = document.querySelector('.rcol-tab[data-tab="' + tab + '"]');
  if (btn) btn.classList.add("has-attention");
}
function setTabBadge(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  if (text === "" || text == null) { node.textContent = ""; node.hidden = true; }
  else { node.textContent = String(text); node.hidden = false; }
}

function enterRoom(roomName, asAdmin) {
  asAdmin = !!asAdmin;
  if (refStage) teardownRoom();      // switching rooms: drop the old subscriptions
  isRoomAdmin = asAdmin;
  myRoom = roomName;
  roomStage = 0; viewStage = 0;
  firstStageFire = true;
  revealed = {}; presence = {}; typingState = {}; seenFindingIds = {};
  myPendingReveal = null;
  answers = { moduleA: {}, moduleB: {} }; callForHelp = null;
  roomScore = {}; teamName = ""; celebratedEvents = {}; penalisedEvents = {};
  roomVotes = {}; committedDecisions = {}; firstVoteFire = true;
  firstScoreFire = true; wrapCelebrated = false;
  // reset in-platform test runtime — a re-join is a fresh attempt UI-side
  // (the DB record per clientId still drives "already done" detection)
  _TEST_RUNTIME.pre = null; _TEST_RUNTIME.post = null;
  ["pretest-card", "posttest-card"].forEach(id => {
    const c = el(id); if (c) c.classList.add("hidden");
  });
  ["pretest-body", "posttest-body"].forEach(id => {
    const b = el(id); if (b) { b.classList.add("hidden"); b.innerHTML = ""; }
  });
  // right-column tab state - start fresh on each room
  lastAnswerCount = { moduleA: 0, moduleB: 0 };
  lastDecisionBallotCount = 0;
  promptsWereUnlocked = false;
  if (typeof switchRcolTab === "function") switchRcolTab("findings");
  el("late-banner").classList.add("hidden");

  el("waiting").classList.add("hidden");
  if (asAdmin) {
    el("admin-app").classList.add("hidden");
    document.body.classList.add("admin-room");
    el("room-sidebar").classList.remove("hidden");
  } else {
    document.body.classList.remove("admin-room");
    el("room-sidebar").classList.add("hidden");
  }
  el("app").classList.remove("hidden");
  el("room-name").textContent = roomName;
  el("call-prof-btn").classList.toggle("hidden", asAdmin);
  // admins navigate via the sidebar's "Full dashboard"; no duplicate leave button
  el("leave-btn").classList.toggle("hidden", asAdmin);
  el("reset-btn").classList.toggle("hidden", !asAdmin);

  if (!asAdmin) saveResume(roomName);
  if (!wired) { wireRoomUI(); wired = true; }
  setHeaderBadge();
  startRoom();
  focusHeading("room-main");
  // Bug 5 (user-feedback-2): first-time participant onboarding tour.
  // Only for real participants (admins viewing a room have their own
  // admin tour). Gated by localStorage.canamed_tour_student_done so a
  // returning student doesn't see it again. Deferred so the room
  // chrome has had a frame to lay out (anchor elements need a non-zero
  // bounding rect for the tour bubble positioning).
  if (!asAdmin && window.CanamedTour && !window.CanamedTour.isDone("student")) {
    setTimeout(() => {
      try {
        if (!window.CanamedTour.isDone("student")) {
          window.CanamedTour.start("student");
        }
      } catch (e) { console.warn("student tour failed", e); }
    }, 700);
  }
}

function teardownRoom() {
  try {
    // a pending typing-timeout would otherwise fire setTyping(null) against the
    // NEXT room's typing ref after an admin switches rooms
    clearTimeout(typingTimer);
    if (refStage) refStage.off();
    if (refRevealed) refRevealed.off();
    if (refHypotheses) refHypotheses.off();
    if (refPromptCursor) refPromptCursor.off();
    if (refPromptReplies) refPromptReplies.off();
    if (refPresence) refPresence.off();
    if (refTyping) refTyping.off();
    if (refAnswers.moduleA) refAnswers.moduleA.off();
    if (refAnswers.moduleB) refAnswers.moduleB.off();
    if (refCallForHelp) refCallForHelp.off();
    if (refScore) refScore.off();
    if (refVotes) refVotes.off();
    if (refObservers) refObservers.off();
    if (refRoleChoices) refRoleChoices.off();
    if (refReplayRound) refReplayRound.off();
    if (refAnswerReplies) refAnswerReplies.off();
    if (refChat) refChat.off();
    if (refTeamName) refTeamName.off();
    if (refLeaderboard) refLeaderboard.off();
    // NOTE: refClosed is session-scoped (not room-scoped). It is owned by
    // enterUnlockedSession / subscribeClosedListener, not by startRoom, so
    // teardownRoom does NOT unsubscribe it - we want the kick-screen to fire
    // even if the user is switching rooms or somehow leaves a room.
  } catch (e) { /* ignore */ }
}

function startRoom() {
  const base = sPath("rooms/" + myRoom);
  refStage = db.ref(base + "/stage");
  refRevealed = db.ref(base + "/moduleA/revealed");
  refHypotheses = db.ref(base + "/moduleA/hypotheses");
  refPromptCursor = db.ref(base + "/moduleA/promptCursor");
  refPromptReplies = db.ref(base + "/moduleA/promptReplies");
  refPresence = db.ref(base + "/presence");
  refTyping = db.ref(base + "/typing");
  refAnswers.moduleA = db.ref(base + "/answers/moduleA");
  refAnswers.moduleB = db.ref(base + "/answers/moduleB");
  refCallForHelp = db.ref(base + "/callForHelp");
  refScore = db.ref(base + "/score");
  refVotes = db.ref(base + "/votes");
  refTeamName = db.ref(base + "/teamName");
  refLeaderboard = db.ref(sPath("rooms"));
  // Sim 2026-05-19 features — per-room observer flags, free-text reply
  // threads on group-answers, in-room side-chat. Refs declared here so
  // every room transition wires/teardowns them in lock-step with the
  // existing per-room subscribers.
  refObservers = db.ref(base + "/observers");
  refAnswerReplies = db.ref(base + "/answerReplies");
  refChat = db.ref(base + "/chat");
  // Module B role-pick sync (roleplay review 2026-05-20): each student
  // writes their OWN choice keyed by clientId (protected by the same
  // clientMapping ownership rule as presence/typing); everyone in the room
  // sees the live picks so a double-claim ("two physicians") is visible and
  // resolved socially rather than discovered mid-scene.
  refRoleChoices = db.ref(base + "/roleChoices");
  // session-wide closed marker - shows the "session closed by facilitator"
  // banner the moment an admin ends the session. Wired here (not in the room
  // subtree) because `closed` lives at the session level, not the room level.
  if (!refClosed) {
    refClosed = db.ref(sPath("closed"));
    refClosed.on("value", snap => renderClosedState(snap.val()));
  }

  if (!isRoomAdmin) {
    const myPresence = refPresence.child(clientId);
    myPresence.set({ name: myName, at: Date.now() });
    myPresence.onDisconnect().remove();
    refTyping.child(clientId).onDisconnect().remove();
    // Drop my role pick when I disconnect so a stale claim doesn't linger.
    refRoleChoices.child(clientId).onDisconnect().remove();
  }
  // Render the room's live role picks on every change (admins observing a
  // room see them too). renderRoleChoices is a no-op if the picker DOM for
  // this stage isn't mounted yet.
  refRoleChoices.on("value", snap => {
    try { renderRoleChoices(snap.val() || {}); } catch (_) {}
  });

  // Swap-and-replay round: the whole room advances together. The first
  // snapshot establishes the baseline (no rotation); later increments rotate
  // each client's own role. A late joiner landing in round 2 therefore does
  // not auto-rotate — handleReplayRound() guards on replayRoundReady.
  refReplayRound = db.ref(base + "/roleplayRound");
  refReplayRound.on("value", snap => {
    try { handleReplayRound(snap.val(), true); } catch (_) {}
  });

  refStage.on("value", snap => {
    const newStage = typeof snap.val() === "number" ? snap.val() : 0;
    if (firstStageFire && !isRoomAdmin && newStage > 0) showLateBanner(newStage);
    firstStageFire = false;
    if (isRoomAdmin) {
      roomStage = newStage; viewStage = newStage;
    } else if (newStage !== roomStage) {
      const wasCurrent = (viewStage === roomStage);
      roomStage = newStage;
      if (wasCurrent) viewStage = roomStage;   // only auto-follow students who were caught up
      else if (viewStage > roomStage) viewStage = roomStage;  // room rolled back past their view
    }
    renderStage();
  });
  refRevealed.on("value", snap => {
    revealed = snap.val() || {};
    renderCase();
    // The Investigations unlock gate now depends on revealed items
    // (red-flag screen: history:1 + history:2 + exam:3). Re-render
    // the hypotheses block so its visible lock state stays in sync.
    if (typeof renderHypotheses === "function") renderHypotheses();
  });
  refHypotheses.on("value", snap => {
    hypotheses = snap.val() || {};
    if (typeof renderHypotheses === "function") renderHypotheses();
    if (typeof renderButtons === "function") renderButtons();
    if (typeof updateModANextStep === "function") updateModANextStep();
  });
  // Progressive prompt state (cross-room synced).
  refPromptCursor.on("value", snap => {
    const v = snap.val();
    promptCursor = (typeof v === "number" && v >= 0) ? Math.floor(v) : 0;
    if (typeof renderPrompts === "function") renderPrompts();
  });
  refPromptReplies.on("value", snap => {
    promptReplies = snap.val() || {};
    if (typeof renderPrompts === "function") renderPrompts();
  });
  refPresence.on("value", snap => {
    presence = snap.val() || {};
    renderPresence();
    renderDecisions();   // voter dots + the "X of Y voted" status depend on presence
  });
  refTyping.on("value", snap => { typingState = snap.val() || {}; renderTyping(); });
  // Refresh the "objectives / goals" tally too: renderAnswers writes any
  // newly-earned auto-scores via a transaction and then the refScore
  // listener re-renders objectives — but that roundtrip is visible (an
  // answer arrives, the counter waits a tick to tick up). Re-rendering
  // objectives directly off the answer event makes the goal counter feel
  // live for every teammate, not just the writer.
  refAnswers.moduleA.on("value", snap => {
    answers.moduleA = snap.val() || {};
    renderAnswers("moduleA");
    renderObjectives();
  });
  refAnswers.moduleB.on("value", snap => {
    answers.moduleB = snap.val() || {};
    renderAnswers("moduleB");
    renderObjectives();
  });
  // Sim 2026-05-19 — counter-bullet replies on group-answer entries.
  // Re-render Module A + B answers so the new replies appear under
  // their parent <li>. The pure-DOM render is cheap.
  if (refAnswerReplies) {
    refAnswerReplies.on("value", snap => {
      answerReplies = snap.val() || {};
      try {
        renderAnswers("moduleA");
        renderAnswers("moduleB");
      } catch (e) { /* render may not be ready */ }
    });
  }
  refCallForHelp.on("value", snap => { callForHelp = snap.val(); renderCallProf(); });

  refScore.on("value", snap => {
    roomScore = snap.val() || {};
    renderScore();
    // celebrate genuinely new auto-events, and explain genuinely new penalties;
    // the first snapshot on join is silent (no retro-fire of past state)
    const wasFirst = firstScoreFire;
    const auto = roomScore.auto || {};
    const fresh = [];
    Object.keys(auto).forEach(ev => {
      if (celebratedEvents[ev]) return;
      celebratedEvents[ev] = true;
      if (!wasFirst) fresh.push(ev);
    });
    const pen = roomScore.penalties || {};
    const freshPen = [];
    Object.keys(pen).forEach(ev => {
      if (penalisedEvents[ev]) return;
      penalisedEvents[ev] = true;
      if (!wasFirst) freshPen.push(ev);
    });
    firstScoreFire = false;
    if (fresh.length) celebrateEvents(fresh);
    if (freshPen.length) penaltyToast(freshPen);
  });

  // team decisions: the Kahoot-style votes. A fresh "committed" node means the
  // room has just locked in an answer - announce it, and let checkScoreEvents
  // turn it into points (or a penalty). The score listener's toast is suppressed
  // for decisions (guards pre-seeded) so the announcement is not duplicated.
  refVotes.on("value", snap => {
    roomVotes = snap.val() || {};
    const wasFirst = firstVoteFire;
    firstVoteFire = false;
    if (typeof DECISIONS !== "undefined") {
      DECISIONS.forEach(d => {
        const v = roomVotes[d.id] || {};
        const committed = !!(v.committed && typeof v.committed.choice === "number");
        if (!committed || committedDecisions[d.id]) return;
        committedDecisions[d.id] = true;
        celebratedEvents["decision_" + d.id] = true;   // suppress the score toast
        penalisedEvents["decpen_" + d.id] = true;      // suppress the penalty toast
        if (!wasFirst) announceDecision(d.id);
      });
    }
    renderDecisions();
    checkScoreEvents();
  });

  refTeamName.on("value", snap => { teamName = snap.val() || ""; renderScore(); });
  // everyone in a room sees the live board; admins also get it via refRooms
  if (!isRoomAdmin) {
    refLeaderboard.on("value", snap => { allRooms = snap.val() || {}; renderLeaderboard(); });
  }

  if (!isRoomAdmin) {
    refStage.once("value").then(snap => {
      if (typeof snap.val() !== "number") return refStage.set(0);
    }).catch(e => console.error("Stage init failed", e));
  }
}

/* ===================== ADMIN ===================== */
function joinAdmin() {
  if (joined) return;
  if (sharedExpectedButBroken()) { el("admin-hint").textContent = SDK_BROKEN_MSG; return; }
  el("admin-hint").textContent = "";
  sessionNum = readSession("admin-hint");
  if (!sessionNum) return;
  // The lobby reuses the participant #name-input for the admin flow. A
  // facilitator who jumps straight to "I am a facilitator" without typing
  // a name was previously bounced silently: readName() focuses the empty
  // field and returns null, but the admin section is below the fold so
  // the focus shift isn't noticed. Surface that explicitly + auto-fill
  // a sensible default so the next click goes through.
  // (Sim 2026-05-18 surfaced this — Dr Chrétien got stuck on the lobby
  // because the name field was empty.)
  const nameField = el("name-input");
  if (nameField && !(nameField.value || "").trim()) {
    const cached = (function () {
      try { return (localStorage.getItem("canamed_name") || "").trim(); }
      catch (e) { return ""; }
    })();
    nameField.value = cached || tFallback("lobby.admin-default-name", "Facilitator");
    el("admin-hint").textContent = tFallback("lobby.admin-name-defaulted",
      "Joining as \"" + nameField.value + "\" — edit the name field above if " +
      "you want it on the audit trail.");
    el("admin-hint").className = "lobby-hint";   // not .err — informational
  }
  myName = readName("admin-hint");
  if (!myName) return;
  const pass = el("admin-pass-input").value;
  if (!pass) { el("admin-hint").textContent = "Enter the session password."; return; }
  dbInit();
  const btn = el("join-admin-btn");
  const btnLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Checking…";
  const restore = () => { btn.disabled = false; btn.textContent = btnLabel; };
  // Wait for anonymous (or identified) sign-in so the proof-write / fallback
  // read succeeds under Round-2 rules (session .read requires auth != null).
  ensureSignedIn()
    .then(() => verifyAdminPassword(pass))   // FINDING-07: server-side proof-write (hash never read)
    .then(status => {
      if (status === "none") {
        el("admin-hint").textContent =
          "No admin password set yet - the super admin must set one first.";
        restore(); return;
      }
      if (status !== "ok") {
        el("admin-hint").textContent = "Incorrect password.";
        restore(); return;
      }
      joined = true;
      role = "admin";
      // Lazy-load qrcode + case-content together — the dashboard
      // immediately renders the QR for joining, debrief panel, and
      // download-archive buttons, all of which live in chunks the splash
      // bundle does not ship. Resolving in parallel keeps the
      // dashboard-paint latency low. The previously-planned
      // script-admin.js chunk was removed in R2-01: the admin-runtime
      // functions still live inline in script.js, so there is nothing
      // extra to await here.
      const loader = window.CanamedLoader;
      const adminChunks = loader ? Promise.all([
        loader.ensureQrcode(),
        loader.ensureCaseContent()
      ]) : Promise.resolve();
      // R2-09: claim membership before installing read listeners, so the
      // narrowed session-level .read predicate is satisfied by the time
      // startAdmin() attaches .on("value") to the rooms / pool subtrees.
      Promise.all([adminChunks, claimMembership("admin")]).then(() => {
        try { rebuildCaseDerived(); } catch (_) {}
        enterAdminApp(); startAdmin();
      });
  }).catch(e => {
    el("admin-hint").textContent = "Could not reach the session database.";
    console.error(e);
    restore();
  });
}
function joinSuperAdmin() {
  if (joined) return;
  if (sharedExpectedButBroken()) { el("admin-hint").textContent = SDK_BROKEN_MSG; return; }
  el("admin-hint").textContent = "";
  sessionNum = readSession("admin-hint");
  if (!sessionNum) return;
  myName = readName("admin-hint");
  if (!myName) return;
  const key = el("superadmin-key-input").value;
  const newPass = el("new-pass-input").value;
  const confirmEl = el("new-pass-confirm-input");
  const confirmPass = confirmEl ? confirmEl.value : null;
  const recoveryEl = el("recovery-code-input");
  // Normalise the recovery code: trim + lowercase (the alphabet is lowercase)
  // so a facilitator who pastes "ABCD-EFGH-JKMN" or adds spaces still matches.
  const recoveryCode = recoveryEl ? (recoveryEl.value || "").trim().toLowerCase() : "";

  // D21 — the SUPERADMIN_KEY is no longer the security boundary for a
  // password RESET; the per-session recovery code is (it gates
  // _superadminReset in the rules, which gates the adminPasswordHash
  // overwrite). The key, when a deployment sets one, is kept as an
  // additional client-side gate on this panel — but the public deployment
  // sets it to null, and the recovery-code path MUST work there. So we only
  // enforce the key when one is configured; we never hard-stop on a null key.
  if (SUPERADMIN_KEY && key !== SUPERADMIN_KEY) {
    el("admin-hint").textContent =
      tFallback("lobby.superadmin.bad-key", "Incorrect super-admin key.");
    return;
  }
  if (!newPass) {
    el("admin-hint").textContent =
      tFallback("lobby.superadmin.no-new-pass", "Enter a new session password to set.");
    return;
  }
  // R3-D3 — confirm field guards against a silent typo in the new password.
  if (confirmEl && confirmPass !== newPass) {
    el("admin-hint").textContent =
      tFallback("lobby.superadmin.confirm-mismatch",
        "The two password fields do not match — please re-type the new password.");
    return;
  }
  dbInit();
  // Round-2 rules require auth != null on every write; we must be signed in
  // before any session write (including the first password hash).
  //
  // D21 recovery flow: if a hash already EXISTS (forgotten-password case
  // during a live session), the adminPasswordHash rule refuses a bare
  // overwrite. The reset must first write a fresh `_superadminReset` flag
  // whose `code` equals the unreadable /recovery/.../code; the rule then
  // allows a single hash overwrite within its 30s window. We clear the flag
  // afterwards to shut the door early (the window self-expires regardless).
  //
  // SECURITY NOTE: the recovery code is the real gate. It is generated with
  // ~59.5 bits of entropy, shown to the creator exactly once, and stored in
  // the unreadable /recovery subtree — so a participant who only knows the
  // (spoken-aloud) session code cannot read it, cannot inject one (the
  // /recovery write is locked once a password exists), and therefore cannot
  // pass the _superadminReset rule. A wrong/blank code is rejected by the
  // rules as a generic permission error, which we translate into a helpful
  // hint below rather than claiming success.
  ensureSignedIn()
    .then(() => hashPassword(newPass, sessionNum))
    .then(h => {
      const refMarker = db.ref(sPath("adminPasswordHash"));
      // FINDING-07: on the legacy path the REAL hash lives in the unreadable
      // adminSecrets tree; sessions/<code>/adminPasswordHash is only a
      // readable non-secret marker. adminSecrets is unreadable, so we use the
      // (readable) marker's existence to decide initial-set vs reset.
      const refSecret = useAdminSecrets()
        ? db.ref(adminSecretPath(sessionNum, "hash"))
        : refMarker;   // org path (deferred): the hash stays at the session path
      return refMarker.once("value").then(snap => {
        // snap.val() == null (NOT snap.exists()) so this works against BOTH
        // Firebase and the LOCAL-mode LocalDB snapshot (which exposes .val()
        // but not .exists()) — equivalent to !exists() on Firebase.
        if (snap.val() == null) {
          // initial set — the !data.exists() branch of the rule allows this
          // without a reset flag or recovery code. On the legacy path also
          // drop the readable marker so existence checks + future resets work.
          return useAdminSecrets()
            ? Promise.all([refSecret.set(h), refMarker.set(randomAdminMarker())])
            : refSecret.set(h);
        }
        // OVERWRITE path — requires the recovery code. Validate it is
        // non-empty client-side so we can show a clear message instead of a
        // bare permission error (the rule rejects an empty/wrong code).
        if (!recoveryCode) {
          const err = new Error("recovery-code-required");
          err._canamedRecovery = true;
          throw err;
        }
        // R3-D1 fix: use firebase.database.ServerValue.TIMESTAMP rather than
        // Date.now() so a client clock skewed beyond ±5 s of server time still
        // passes the rule's freshness window. Falling back to Date.now()
        // preserves behaviour in non-Firebase test contexts.
        const refReset = db.ref(sPath("_superadminReset"));
        const TS = (typeof firebase !== "undefined" &&
          firebase.database && firebase.database.ServerValue &&
          firebase.database.ServerValue.TIMESTAMP) || Date.now();
        // FINDING-07 + recovery: the reset payload MUST carry the recovery code
        // (the rule compares it against /recovery/.../code), and the real hash
        // is written to the unreadable adminSecrets tree (refSecret).
        return refReset.set({ requestedAt: TS, by: myName, code: recoveryCode })
          .then(() => refSecret.set(h))
          .then(() => refReset.remove())
          .catch(err => {
            // best-effort flag cleanup; the rule's 30s window self-expires
            // even if remove() fails, so the door re-closes automatically
            try { refReset.remove(); } catch (_) {}
            // A PERMISSION_DENIED here means the recovery code did not match
            // (the rule compares it to the unreadable /recovery/.../code). Tag
            // it so the outer catch shows the recovery-specific hint. Any other
            // failure (e.g. a transient network error) keeps the generic
            // db-error hint. Either way we never enter admin on a failed write.
            const code = (err && (err.code || err.message)) || "";
            if (/permission_denied|denied/i.test(String(code))) {
              err._canamedRecovery = true;
            }
            throw err;
          });
      });
    })
    .then(() => {
    joined = true;
    role = "superadmin";
    // R2-09: claim membership BEFORE startAdmin() installs read listeners,
    // so the narrowed session-level .read predicate is satisfied in time.
    return claimMembership("superadmin").then(() => {
      enterAdminApp(); startAdmin();
    });
  }).catch(e => {
    if (e && e._canamedRecovery) {
      // Either no code was entered, or the write was rejected because the
      // code did not match this session's recovery code.
      el("admin-hint").textContent =
        tFallback("lobby.superadmin.bad-recovery",
          "That recovery code doesn't match this session. Check the code you saved when the session was created.");
    } else {
      el("admin-hint").textContent =
        tFallback("lobby.superadmin.db-error", "Could not reach the session database.");
    }
    console.error(e);
  });
}

function enterAdminApp() {
  el("lobby").classList.add("hidden");
  el("admin-app").classList.remove("hidden");
  el("admin-mode-line").textContent =
    (role === "superadmin" ? "Super admin" : "Admin") + " · Session " + sessionNum +
    " · " + myName + (MODE === "local" ? "  (local test mode)" : "");
  // the session code, always visible at the top of the admin dashboard so the
  // facilitator can read it aloud or copy it again for a late-joiner
  const codeNode = el("admin-session-code");
  if (codeNode) codeNode.textContent = sessionNum || "—";
  const copyBtn = el("admin-copy-code");
  const copyOk = el("admin-copy-ok");
  if (copyBtn && !copyBtn.dataset.wired) {
    copyBtn.dataset.wired = "1";
    copyBtn.addEventListener("click", () => {
      const code = (sessionNum || "").toUpperCase();
      const showOk = () => {
        if (!copyOk) return;
        copyOk.classList.remove("hidden");
        clearTimeout(copyBtn._t);
        copyBtn._t = setTimeout(() => copyOk.classList.add("hidden"), 1800);
      };
      const selectFallback = () => {
        // clipboard refused (e.g. insecure context) - fall back to selecting
        // the code so the facilitator can press Ctrl/Cmd-C themselves
        if (!codeNode) return;
        const range = document.createRange();
        range.selectNodeContents(codeNode);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(showOk).catch(selectFallback);
      } else {
        selectFallback();
      }
    });
  }
  el("header-right").textContent =
    (role === "superadmin" ? "Super admin" : "Admin") + " · Session " + sessionNum;
  el("header-right").className = MODE === "shared" ? "mode-badge shared" : "mode-badge solo";
  if (role === "superadmin") {
    el("superadmin-card").classList.remove("hidden");
    el("change-session-input").value = sessionNum;
    el("purge-session-btn").addEventListener("click", () => {
      const target = (el("change-session-input").value || "").trim()
        .replace(/[^a-zA-Z0-9_-]/g, "");
      if (!target) return;
      if (!confirm("Permanently delete ALL data for Session " + target +
        " (names, rooms, answers, password)?\n\nThis cannot be undone. Make sure " +
        "you have downloaded the group answers first.")) return;
      db.ref(oPath(target, "")).remove().then(() => {
        el("purge-ok").textContent = "Purged Session " + target;
        flashSaved("purge-ok", 2500);
      }).catch(e => {
        console.error("Purge failed", e);
        alert("Could not purge Session " + target + " - check your connection and try again.");
      });
    });
  }
  focusHeading("admin-app");

  el("admin-leave-btn").addEventListener("click", () => {
    if (confirm("Leave the admin dashboard? You will return to the lobby.")) location.reload();
  });
  el("admin-download-btn").addEventListener("click", downloadAllAnswers);
  const mdBtn = el("admin-download-md-btn");
  if (mdBtn) mdBtn.addEventListener("click", downloadAllAnswersMarkdown);
  const debriefBtn = el("admin-debrief-btn");
  if (debriefBtn && !debriefBtn.dataset.wired) {
    debriefBtn.dataset.wired = "1";
    debriefBtn.addEventListener("click", toggleDebrief);
  }
  const impactBtn = el("admin-impact-btn");
  if (impactBtn && !impactBtn.dataset.wired) {
    impactBtn.dataset.wired = "1";
    impactBtn.addEventListener("click", generateImpactReport);
  }
  // Admin-tools buttons (accreditation evidence, …) — the report code lives in
  // the lazy admin-tools.js chunk; ensure it's loaded, then invoke. A brief
  // toast covers the (usually sub-second) load.
  const accredBtn = el("admin-accred-btn");
  if (accredBtn && !accredBtn.dataset.wired) {
    accredBtn.dataset.wired = "1";
    accredBtn.addEventListener("click", () => runAdminTool("generateAccreditationReport"));
  }
  const researchBtn = el("admin-research-btn");
  if (researchBtn && !researchBtn.dataset.wired) {
    researchBtn.dataset.wired = "1";
    researchBtn.addEventListener("click", () => runAdminTool("generateResearchExport"));
  }
  const researchCsvBtn = el("admin-research-csv-btn");
  if (researchCsvBtn && !researchCsvBtn.dataset.wired) {
    researchCsvBtn.dataset.wired = "1";
    researchCsvBtn.addEventListener("click", () => runAdminTool("generateResearchExportCSV"));
  }
  const attestBtn = el("admin-attest-btn");
  if (attestBtn && !attestBtn.dataset.wired) {
    attestBtn.dataset.wired = "1";
    attestBtn.addEventListener("click", () => runAdminTool("generateAttestations"));
  }
  const programBtn = el("admin-program-btn");
  if (programBtn && !programBtn.dataset.wired) {
    programBtn.dataset.wired = "1";
    programBtn.addEventListener("click", () => runAdminTool("generateProgramDashboard"));
  }
  const itemDiffBtn = el("admin-itemdiff-btn");
  if (itemDiffBtn && !itemDiffBtn.dataset.wired) {
    itemDiffBtn.dataset.wired = "1";
    itemDiffBtn.addEventListener("click", () => runAdminTool("generateItemDifficulty"));
  }
  const cohortBtn = el("admin-cohort-btn");
  if (cohortBtn && !cohortBtn.dataset.wired) {
    cohortBtn.dataset.wired = "1";
    cohortBtn.addEventListener("click", () => runAdminTool("generateCohortComparison"));
  }
  const closeBtn = el("admin-close-btn");
  if (closeBtn && !closeBtn.dataset.wired) {
    closeBtn.dataset.wired = "1";
    closeBtn.addEventListener("click", closeSession);
  }
  // Mute-alerts checkbox — restores from localStorage on render, writes
  // through on toggle. Idempotent against re-renders.
  const muteBox = el("admin-mute-alerts");
  if (muteBox && !muteBox.dataset.wired) {
    muteBox.dataset.wired = "1";
    muteBox.checked = isHelpAlertsMuted();
    muteBox.addEventListener("change", () => setHelpAlertsMuted(muteBox.checked));
  }
  // Theme picker — light / dark / auto. Persisted via setTheme() to
  // localStorage.canamed_theme and applied immediately on <html data-theme>;
  // theme-init.js reads the same key at page boot so a refresh keeps the choice.
  const themeSel = el("admin-theme-select");
  if (themeSel && !themeSel.dataset.wired) {
    themeSel.dataset.wired = "1";
    themeSel.value = getTheme();
    themeSel.addEventListener("change", () => setTheme(themeSel.value));
  }
  // Download error log — exposes the in-page telemetry buffer
  // (window.CanamedTelemetry from telemetry.js) as a downloadable
  // JSON file. Empty-buffer case: download is still produced (with
  // entries: []) so a postmortem reviewer can confirm "no errors
  // captured during this session" vs "no telemetry running".
  const errLogBtn = el("admin-error-log-btn");
  if (errLogBtn && !errLogBtn.dataset.wired) {
    errLogBtn.dataset.wired = "1";
    errLogBtn.addEventListener("click", () => {
      if (window.CanamedTelemetry && typeof window.CanamedTelemetry.download === "function") {
        window.CanamedTelemetry.download();
      } else {
        alert("Error-log capture is not available in this build.");
      }
    });
  }
  // Report a bug — opens the user's mail client with a pre-filled message
  // describing the session context + browser fingerprint + a hint to
  // attach the just-downloaded error log. Avoids putting the full
  // telemetry blob in the mailto URL (most mail clients clamp it to
  // ~2 KB), instead instructing the user to attach the file. We do NOT
  // transmit any data ourselves — the email is composed locally and the
  // user remains in control of what they send.
  const bugBtn = el("admin-bug-report-btn");
  if (bugBtn && !bugBtn.dataset.wired) {
    bugBtn.dataset.wired = "1";
    bugBtn.addEventListener("click", () => openBugReportMailto());
  }
  el("start-session-btn").addEventListener("click", startSession);
  el("advance-all-btn").addEventListener("click", () => {
    const summary = roomNames(roomCount).map(r => {
      const cur = (allRooms[r] && typeof allRooms[r].stage === "number") ? allRooms[r].stage : 0;
      return r + ": " + STAGE_LABELS[cur] +
        (cur < STAGE_COUNT - 1 ? "  →  " + STAGE_LABELS[cur + 1] : "  (already last)");
    }).join("\n");
    canamedConfirm({
      title: (window.t ? window.t("modal.advance-all.title") : "Advance all rooms?"),
      message: (window.t ? window.t("modal.advance-all.message") :
        "Every room will move forward by one stage. Per-room preview below:"),
      detail: summary,
      okLabel: (window.t ? window.t("modal.advance-all.ok") : "Advance all")
    }).then(ok => {
      if (!ok) return;
      roomNames(roomCount).forEach(r => {
        const cur = (allRooms[r] && typeof allRooms[r].stage === "number") ? allRooms[r].stage : 0;
        if (cur < STAGE_COUNT - 1) setRoomStage(r, cur, cur + 1);
      });
    });
  });
  el("save-teams-btn").addEventListener("click", () => {
    const val = (el("teams-link-input").value || "").trim();
    db.ref(sPath("teamsLink")).set(val)
      .then(() => { flashSaved("teams-saved-ok"); saveLastWorkshop({ teamsLink: val || null }); })
      .catch(e => {
        console.error("Save Teams link failed", e);
        alert("Could not save the link - check your connection and try again.");
      });
  });
  el("save-quiz-btn").addEventListener("click", () => {
    const val = (el("quiz-link-input").value || "").trim();
    db.ref(sPath("questionnaireLink")).set(val)
      .then(() => { flashSaved("quiz-saved-ok"); saveLastWorkshop({ questionnaireLink: val || null }); })
      .catch(e => {
        console.error("Save questionnaire link failed", e);
        alert("Could not save the link - check your connection and try again.");
      });
  });
  const savePreQuizBtn = el("save-prequiz-btn");
  if (savePreQuizBtn) savePreQuizBtn.addEventListener("click", () => {
    const val = (el("prequiz-link-input").value || "").trim();
    db.ref(sPath("preQuestionnaireLink")).set(val)
      .then(() => { flashSaved("prequiz-saved-ok"); saveLastWorkshop({ preQuestionnaireLink: val || null }); })
      .catch(e => {
        console.error("Save pre-questionnaire link failed", e);
        alert("Could not save the link - check your connection and try again.");
      });
  });
  el("change-pass-btn").addEventListener("click", () => {
    const np = el("change-pass-input").value;
    const targetSession = (el("change-session-input").value || "").trim()
      .replace(/[^a-zA-Z0-9_-]/g, "");
    if (!np || !targetSession) return;
    const recoveryEl = el("change-recovery-input");
    // Normalise (trim + lowercase) — the recovery alphabet is lowercase.
    const recoveryCode = recoveryEl ? (recoveryEl.value || "").trim().toLowerCase() : "";
    // D21 recovery: pre-provisioning a NEW session number (no hash yet) needs
    // no code — the rule's !data.exists() branch allows it. OVERWRITING an
    // existing session's password requires that session's recovery code: the
    // rule gates _superadminReset on the code matching the unreadable
    // /recovery/.../code, and the hash overwrite on a fresh _superadminReset.
    hashPassword(np, targetSession)
      .then(h => {
        // FINDING-07: legacy path stores the real hash in unreadable
        // adminSecrets/<code>/hash + a readable random marker; the readable
        // marker's existence decides initial-set vs reset.
        const legacy = useAdminSecrets();
        const refMarker = db.ref(oPath(targetSession, "adminPasswordHash"));
        const refSecret = legacy ? db.ref(adminSecretPath(targetSession, "hash")) : refMarker;
        return refMarker.once("value").then(snap => {
          // snap.val() == null (NOT snap.exists()) for LOCAL-mode LocalDB
          // compatibility (no .exists() there); equivalent on Firebase.
          if (snap.val() == null) {
            // initial set / pre-provision a new session number — no code needed
            return legacy
              ? Promise.all([refSecret.set(h), refMarker.set(randomAdminMarker())])
              : refSecret.set(h);
          }
          // OVERWRITE an existing session's password — requires that session's
          // recovery code (the rule gates _superadminReset on it). Validate it
          // is non-empty client-side for a clear message vs a bare denial.
          if (!recoveryCode) {
            const err = new Error("recovery-code-required");
            err._canamedRecovery = true;
            throw err;
          }
          const refReset = db.ref(oPath(targetSession, "_superadminReset"));
          // ServerValue.TIMESTAMP (R3-D1) so a skewed client clock still
          // passes the rule's ±5s freshness window; Date.now() fallback for
          // non-Firebase test contexts.
          const TS = (typeof firebase !== "undefined" &&
            firebase.database && firebase.database.ServerValue &&
            firebase.database.ServerValue.TIMESTAMP) || Date.now();
          return refReset.set({ requestedAt: TS, by: myName || "superadmin", code: recoveryCode })
            .then(() => refSecret.set(h))
            .then(() => refReset.remove())
            .catch(err => {
              try { refReset.remove(); } catch (_) {}
              const code = (err && (err.code || err.message)) || "";
              if (/permission_denied|denied/i.test(String(code))) err._canamedRecovery = true;
              throw err;
            });
        });
      })
      .then(() => {
        el("change-pass-input").value = "";
        if (recoveryEl) recoveryEl.value = "";
        const ok = el("change-pass-ok");
        ok.textContent = "Saved for Session " + targetSession;
        flashSaved("change-pass-ok", 2000);
      }).catch(e => {
      console.error("Set password failed", e);
      if (e && e._canamedRecovery) {
        alert(tFallback("lobby.superadmin.bad-recovery",
          "That recovery code doesn't match this session. Check the code you saved when the session was created."));
      } else {
        alert("Could not save the password - check your connection and try again.");
      }
    });
  });
  el("sidebar-dashboard-btn").addEventListener("click", backToDashboard);
}

/* Audible + title-bar alert when a room raises a NEW un-acknowledged call -
   a floating prof watching other rooms would otherwise miss a silent badge. */
let prevCallRooms = {};
let baseTitle = document.title;
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.42);
  } catch (e) { /* audio not available - silent */ }
}
function checkCallAlerts() {
  // Title-bar counter only — the actual audible + desktop alert path
  // goes through maybeAlertHelpCall() inside renderDashboard(), which
  // de-duplicates per-room by the call's `at` timestamp. Previously
  // this function also fired beep() on `isNew`, which double-alerted
  // (chime from here + chime from maybeAlertHelpCall) on every other
  // room joining the calling set. Security/UX audit caught it.
  const calling = {};
  Object.keys(allRooms).forEach(r => {
    const c = allRooms[r] && allRooms[r].callForHelp;
    if (c && !c.ack) calling[r] = true;
  });
  prevCallRooms = calling;
  const n = Object.keys(calling).length;
  document.title = n > 0 ? "🔔 (" + n + ") " + baseTitle : baseTitle;
}

function startAdmin() {
  // Reset the sticky-presence view (otherwise an admin re-entering the
  // dashboard after switching sessions would see students from the
  // previous session as "gone").
  adminSeenPool = {};
  refStarted = db.ref(sPath("started"));
  refRoomCount = db.ref(sPath("roomCount"));
  refPool = db.ref(sPath("pool"));
  refRooms = db.ref(sPath("rooms"));
  refTeams = db.ref(sPath("teamsLink"));
  refQuiz = db.ref(sPath("questionnaireLink"));
  refPreQuiz = db.ref(sPath("preQuestionnaireLink"));
  // closed marker - so the admin's "End session" button reflects state even if
  // the session was already closed (e.g. by a second facilitator re-opening
  // the dashboard later to re-download the archive)
  db.ref(sPath("closed")).on("value", snap => {
    const closed = snap.val();
    renderClosedState(closed);
    const btn = el("admin-close-btn");
    if (btn && closed) {
      btn.textContent = "Session closed ✓ — re-download archive";
      btn.classList.add("done");
    }
  });

  refRoomCount.on("value", snap => {
    roomCount = snap.val() || 4;
    if (!started) el("roomcount-input").value = String(roomCount);
  });
  refStarted.on("value", snap => {
    started = !!snap.val();
    el("admin-prestart").classList.toggle("hidden", started);
    el("admin-dashboard").classList.toggle("hidden", !started);
    // Reveal the destructive End-session button only once the session has
    // actually started (it's hidden in HTML by default). If the session
    // gets closed and re-opened the listener will toggle this back on.
    const endBtn = el("admin-close-btn");
    if (endBtn) endBtn.hidden = !started;
    // First-time admin-dashboard onboarding tour. Defer so the dashboard
    // has had time to render at least once (anchor elements need to be
    // measurable for getBoundingClientRect). The tour is gated by its
    // own localStorage key (canamed_tour_admin_done) and is independent
    // of the create-session tour version.
    if (started && window.CanamedTour && !window.CanamedTour.isDone("admin")) {
      setTimeout(() => {
        const dash = el("admin-dashboard");
        if (dash && !dash.classList.contains("hidden") &&
            !window.CanamedTour.isDone("admin")) {
          try { window.CanamedTour.start("admin"); } catch (e) { console.warn("admin tour failed", e); }
        }
      }, 600);
    }
  });
  refPool.on("value", snap => {
    pool = snap.val() || {};
    renderPrestart();
    wireExpectedTotal();    // idempotent — wires on first render, no-op after
    wireTestAlertsBtn();    // ditto
    if (debriefVisible) renderDebrief();
  });
  // the rooms subtree changes on every presence / answer / stage write across
  // every room - debounce the (heavy) dashboard rebuild so a burst of writes
  // collapses into one render; call alerts stay immediate (a missed beep is
  // worse than a 400ms-stale badge).
  //
  // BUT: facilitators reported that the per-room score chip and the cohort
  // leaderboard felt sluggish ("not updating in real time"). The 400ms
  // debounce was kicked further every time presence / typing churned, so a
  // score event could be hidden for far longer than 400ms in a busy room.
  // Fix: compute a cheap score signature on every snapshot; when it changes
  // we bypass the debounce and render immediately. Non-score churn still
  // collapses into the debounced render.
  let dashRenderTimer = null;
  let prevScoreSig = "";
  function _scoreSignature(rooms) {
    // Stable string of (room → auto/manual/penalty totals). Cheap enough to
    // run on every refRooms tick — O(rooms * scoreKeys) — and changes iff
    // any score node was added / removed / re-pointed.
    const out = [];
    Object.keys(rooms || {}).sort().forEach(r => {
      const s = (rooms[r] && rooms[r].score) || {};
      let a = 0, m = 0, p = 0;
      const sa = s.auto || {}, sm = s.manual || {}, sp = s.penalties || {};
      Object.keys(sa).forEach(k => { a += (sa[k] && sa[k].points) || 0; });
      Object.keys(sm).forEach(k => { m += (sm[k] && sm[k].points) || 0; });
      Object.keys(sp).forEach(k => { p += (sp[k] && sp[k].points) || 0; });
      out.push(r + ":" + a + "/" + m + "/" + p);
    });
    return out.join("|");
  }
  function _flushDashRender() {
    clearTimeout(dashRenderTimer); dashRenderTimer = null;
    renderDashboard(); renderSidebar(); renderLeaderboard();
    if (debriefVisible) renderDebrief();
  }
  refRooms.on("value", snap => {
    allRooms = snap.val() || {};
    checkCallAlerts();
    const sig = _scoreSignature(allRooms);
    if (sig !== prevScoreSig) {
      // A score (auto / manual / penalty) changed somewhere — operators
      // expect the leaderboard chip to move instantly. Skip the debounce.
      prevScoreSig = sig;
      _flushDashRender();
      return;
    }
    clearTimeout(dashRenderTimer);
    dashRenderTimer = setTimeout(_flushDashRender, 400);
  });
  // keep the "minutes in stage" timers fresh even when nothing changes
  setInterval(() => {
    if (started) { renderDashboard(); renderSidebar(); }
  }, 30000);

  // D22 (SIMULATION_EDGE_CASES.md): admin presence heartbeat. Writes a
  // {by, at} stamp to _adminPresence every 30s and clears it via
  // onDisconnect, so students can detect a facilitator who closed the
  // browser without ending the session and show a "facilitator may be
  // offline" hint. The interval starts immediately on dashboard entry
  // (well before `started` flips true) so a forgotten password / dead
  // tab pre-start is also visible to anyone in the lobby.
  try {
    const refAdminPresence = db.ref(sPath("_adminPresence"));
    const writePresence = () => {
      try { refAdminPresence.set({ by: myName || "facilitator", at: Date.now() }); }
      catch (e) { /* offline / closed — non-fatal */ }
    };
    try { refAdminPresence.onDisconnect().remove(); } catch (e) {}
    writePresence();
    setInterval(writePresence, 30000);
  } catch (e) { console.warn("Admin presence heartbeat failed to start", e); }
  refTeams.on("value", snap => {
    const v = snap.val() || "";
    if (document.activeElement !== el("teams-link-input")) el("teams-link-input").value = v;
  });
  refQuiz.on("value", snap => {
    const v = snap.val() || "";
    if (document.activeElement !== el("quiz-link-input")) el("quiz-link-input").value = v;
  });
  refPreQuiz.on("value", snap => {
    const v = snap.val() || "";
    if (document.activeElement !== el("prequiz-link-input")) el("prequiz-link-input").value = v;
  });
}

/* Per-cohort live count for the waiting room — see lib.js for the pure
   computation. Renders as chips in renderPrestart() below. */

/* Persisted facilitator hint: how many students were expected in this
   session. Local-only (per-browser, per-session), never written to the
   DB — it's a personal anxiety reducer, not session state. */
const EXPECTED_TOTAL_KEY_PREFIX = "canamed_expected_";
function getExpectedTotalFor(code) {
  if (!code) return null;
  try {
    const raw = localStorage.getItem(EXPECTED_TOTAL_KEY_PREFIX + code);
    const n = parseInt(raw, 10);
    return (isFinite(n) && n > 0 && n <= 500) ? n : null;
  } catch (e) { return null; }
}
function setExpectedTotalFor(code, n) {
  if (!code) return;
  // Inline try/catch on each call so the storage-guard test (E30 in
  // edge-cases.test.js) can detect the guard via simple brace-balance —
  // a try wrapping an if/else is logically equivalent but the walker
  // only matches the immediately-enclosing try.
  if (n == null || n === "" || !isFinite(n) || n <= 0) {
    try { localStorage.removeItem(EXPECTED_TOTAL_KEY_PREFIX + code); } catch (e) {}
  } else {
    try { localStorage.setItem(EXPECTED_TOTAL_KEY_PREFIX + code, String(Math.min(500, Math.floor(n)))); } catch (e) {}
  }
}

/* ── Admin sticky-presence view (2026-05-18 user report:
 * "Frequently as an admin I cannot see which students are connected.
 *  I think that this is caused by how the website checks it.")
 *
 * Root cause: Firebase's onDisconnect().remove() fires after a 60-90s
 * WebSocket silence. On a typical workshop where students are on phones,
 * normal events — screen lock, tab background, cellular handoff,
 * brief network drop — trigger that disconnect handler. The student's
 * pool entry is removed, the admin's refPool listener fires with the
 * updated pool (student missing), and renderPrestart shows the student
 * VANISHED. When the student reconnects 20s later they re-appear.
 *
 * From the admin's viewpoint the waiting list FLICKERS — students
 * appear and disappear with no clear signal whether they actually left
 * or just had a brief network hiccup.
 *
 * Fix: smooth the admin's view client-side. We keep a per-session
 * "ever-seen" map of every cid that has been in the pool at any point.
 * Each entry carries (a) the LATEST data snapshot, (b) when we last
 * saw them in a live pool snapshot, (c) a status — online / blip /
 * gone — derived from that age. The admin's waiting list shows ALL
 * ever-seen entries with a colour-coded status dot, plus a manual
 * remove button for entries that are truly gone. */
const ADMIN_PRESENCE_BLIP_MS = 30_000;    // ≤30s gap = probably a network blip
const ADMIN_PRESENCE_GONE_MS = 120_000;   // >2min gap = treat as truly gone
let adminSeenPool = {};                   // cid → { entry, lastSeenAt }
let _adminPresenceRefreshTimer = null;

function adminPresenceStatus(cid) {
  const seen = adminSeenPool[cid];
  if (!seen) return "gone";
  if (pool[cid]) return "online";   // present in the current live snapshot
  const age = Date.now() - seen.lastSeenAt;
  if (age < ADMIN_PRESENCE_BLIP_MS) return "online";   // tolerant of micro-gaps
  if (age < ADMIN_PRESENCE_GONE_MS) return "blip";
  return "gone";
}

function adminRemoveStudent(cid) {
  if (!cid) return;
  const seen = adminSeenPool[cid];
  const nm = (seen && seen.entry && seen.entry.name) || cid;
  if (typeof confirm === "function" && !confirm(
    "Remove " + nm + " from the waiting list? They'll have to rejoin if they come back."
  )) return;
  // Best-effort: clear from Firebase if their entry still exists, AND
  // wipe the local sticky record so the admin's view stops showing them.
  if (refPool) refPool.child(cid).remove().catch(e => console.error("admin remove failed", e));
  delete adminSeenPool[cid];
  renderPrestart();
}

/* Periodically re-render the prestart list so age-based status
 * transitions (online→blip→gone) happen even when no new Firebase
 * snapshot has arrived. */
function _scheduleAdminPresenceRefresh() {
  if (_adminPresenceRefreshTimer) return;
  _adminPresenceRefreshTimer = setInterval(() => {
    if (typeof renderPrestart === "function" && el("prestart-list")) renderPrestart();
  }, 15_000);
}

function renderPrestart() {
  // Update the sticky "ever-seen" map from the current pool snapshot,
  // BEFORE we compute the visible list. Every cid present in pool[]
  // refreshes its lastSeenAt; cids present in adminSeenPool but absent
  // from pool[] keep their old lastSeenAt and age into blip/gone.
  const now = Date.now();
  Object.keys(pool || {}).forEach(cid => {
    if (!pool[cid]) return;
    const prev = adminSeenPool[cid];
    adminSeenPool[cid] = {
      entry: pool[cid],
      lastSeenAt: now,
      firstSeenAt: (prev && prev.firstSeenAt) || now
    };
  });
  _scheduleAdminPresenceRefresh();

  // The "live count" in the header is the count of TRULY-ONLINE
  // students (pool snapshot intersection); the visible list below
  // includes blip + gone so the admin doesn't lose sight of who joined.
  const onlineNow = Object.keys(pool || {}).filter(cid => !!pool[cid]);
  const waiting = onlineNow.map(cid => pool[cid]);
  el("prestart-count").textContent = waiting.length;
  // expected-total chip "(of 30)" — read from localStorage, updated by
  // the input change handler in wireExpectedTotal()
  const expNode = el("prestart-expected");
  const expected = getExpectedTotalFor(sessionNum);
  if (expNode) {
    if (expected) {
      expNode.textContent = "/ " + expected;
      expNode.classList.remove("hidden");
      expNode.classList.toggle("full", waiting.length >= expected);
    } else {
      expNode.textContent = "";
      expNode.classList.add("hidden");
      expNode.classList.remove("full");
    }
  }
  // Cohort split chips ("Caen: 14 · Nagoya: 16"). Always shown when at
  // least one person has joined; uses the COHORTS registry for labels +
  // colours so additional partnerships get correct visuals for free.
  const cohortRow = el("prestart-cohort-row");
  if (cohortRow) {
    cohortRow.innerHTML = "";
    if (waiting.length > 0 && typeof COHORTS !== "undefined" && COHORTS) {
      const counts = computeCohortCounts(waiting, COHORTS);
      COHORTS.forEach(c => {
        const chip = document.createElement("span");
        chip.className = "prestart-cohort-chip";
        chip.setAttribute("data-cohort", c.id);
        const dot = document.createElement("span");
        dot.className = "prestart-cohort-chip-dot";
        if (c.color) dot.style.background = c.color;
        chip.appendChild(dot);
        const label = document.createElement("span");
        label.textContent = (c.short || c.id) + ": ";
        chip.appendChild(label);
        const num = document.createElement("span");
        num.className = "prestart-cohort-chip-count";
        num.textContent = String(counts[c.id] || 0);
        chip.appendChild(num);
        cohortRow.appendChild(chip);
      });
      if (counts.__other__) {
        const chip = document.createElement("span");
        chip.className = "prestart-cohort-chip";
        chip.setAttribute("data-cohort", "__other__");
        const dot = document.createElement("span");
        dot.className = "prestart-cohort-chip-dot";
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode("Other: " + counts.__other__));
        cohortRow.appendChild(chip);
      }
    }
  }
  const list = el("prestart-list");
  list.innerHTML = "";
  // Render every cid we've EVER seen during this session, not just the
  // ones in the current live pool snapshot. This is the sticky-presence
  // view that prevents the admin from losing sight of students during
  // network blips.
  const allCids = Object.keys(adminSeenPool);
  if (allCids.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No one has joined yet.";
    list.appendChild(p);
    return;
  }
  allCids
    .map(cid => ({ cid: cid, entry: adminSeenPool[cid].entry,
                    seen: adminSeenPool[cid] }))
    .sort((a, b) => (a.entry.name || "").localeCompare(b.entry.name || ""))
    .forEach(({ cid, entry, seen }) => {
      const status = adminPresenceStatus(cid);
      const chip = makeChip(entry.name,
        entry.name + "  ·  " + entry.university +
        "  ·  Year " + entry.year + "  ·  English " + entry.english,
        "prestart-person prestart-person-" + status);
      // Status dot — colour-coded by online/blip/gone state.
      const dot = document.createElement("span");
      dot.className = "prestart-status-dot prestart-status-dot-" + status;
      dot.setAttribute("aria-hidden", "true");
      chip.insertBefore(dot, chip.firstChild);
      // Status label for screen readers + a small visible age tag for
      // blip/gone states so the admin knows HOW long someone's been
      // missing without having to click them.
      if (status !== "online") {
        const ageMs = Date.now() - seen.lastSeenAt;
        const ageS = Math.round(ageMs / 1000);
        const ageStr = ageS < 60 ? ageS + "s" : Math.round(ageS / 60) + "m";
        const ageEl = document.createElement("span");
        ageEl.className = "prestart-status-age";
        ageEl.textContent = (status === "blip" ? "away " : "offline ") + ageStr;
        chip.appendChild(ageEl);
        // Manual remove button — only shown on truly-gone entries so
        // the admin doesn't accidentally drop someone whose phone just
        // blipped.
        if (status === "gone") {
          const rm = document.createElement("button");
          rm.type = "button";
          rm.className = "prestart-remove-btn";
          rm.title = "Remove this student from the waiting list";
          rm.setAttribute("aria-label", "Remove " + entry.name);
          rm.textContent = "×";
          rm.addEventListener("click", e => {
            e.stopPropagation();
            adminRemoveStudent(cid);
          });
          chip.appendChild(rm);
        }
      }
      const aria = chip.getAttribute("aria-label") || entry.name;
      chip.setAttribute("aria-label", aria + " — " + status);
      list.appendChild(chip);
    });
}

/* Wire the "Expected total" input on first render. Local-only (per-browser
   key), so two facilitators sharing a session can each have their own
   target without colliding. */
function wireExpectedTotal() {
  const inp = el("prestart-expected-input");
  if (!inp || inp.dataset.wired === "1") return;
  inp.dataset.wired = "1";
  const cur = getExpectedTotalFor(sessionNum);
  if (cur) inp.value = String(cur);
  inp.addEventListener("input", () => {
    const v = inp.value.trim();
    if (v === "") { setExpectedTotalFor(sessionNum, null); }
    else {
      const n = parseInt(v, 10);
      if (isFinite(n) && n >= 0) setExpectedTotalFor(sessionNum, n);
    }
    renderPrestart();
  });
}

/* Wire the pre-start "Test alerts" button. Pre-arms the AudioContext
   (Chrome's autoplay-on-no-interaction rule needs a user gesture before
   any audio can play, including the help-call chime) AND deliberately
   triggers the Notification permission prompt now, rather than during
   the first real help call. */
function wireTestAlertsBtn() {
  const btn = el("test-alerts-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  const status = el("test-alerts-status");
  const setStatus = (msg, isErr) => {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("err", !!isErr);
  };
  btn.addEventListener("click", () => {
    setStatus("");
    // 1. Audio: pre-arm the Web Audio context with a user gesture.
    let audioOk = false;
    try {
      if (typeof helpCallChime === "function") helpCallChime();
      audioOk = true;
    } catch (e) { audioOk = false; }
    // 2. Notifications: request permission proactively. The browser
    //    only prompts once per origin; subsequent clicks reuse the
    //    decision, so this is idempotent.
    if (typeof Notification === "undefined") {
      setStatus(window.t ? window.t("admin.test-alerts.ok-noperm") :
        "Chime played. Desktop notifications are not supported in this browser.",
        false);
      return;
    }
    const finish = (perm) => {
      const ok = window.t ? window.t("admin.test-alerts.ok") :
        "Chime played. Desktop notifications enabled.";
      const denied = window.t ? window.t("admin.test-alerts.denied") :
        "Chime played, but desktop notifications are blocked. Check your browser settings.";
      const noaudio = window.t ? window.t("admin.test-alerts.noaudio") :
        "Audio was blocked by the browser — click anywhere on the page first, then try again.";
      if (!audioOk) { setStatus(noaudio, true); return; }
      if (perm === "granted") {
        setStatus(ok, false);
        // Fire one real notification so the facilitator sees what it
        // looks like (auto-close after 4s so it doesn't linger).
        try {
          const n = new Notification("CaNaMED — alerts armed", {
            body: "Help-call notifications are now enabled for this tab.",
            tag: "canamed-test-alerts"
          });
          setTimeout(() => { try { n.close(); } catch (e) {} }, 4000);
        } catch (e) {}
      } else if (perm === "denied") {
        setStatus(denied, true);
      } else {
        // "default" — user dismissed without choosing
        setStatus(audioOk ? (window.t ? window.t("admin.test-alerts.dismissed") :
          "Chime played. Notifications prompt was dismissed — click Test alerts again to retry.") : noaudio,
          true);
      }
    };
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      finish(Notification.permission);
    } else {
      try {
        Notification.requestPermission().then(finish).catch(() => finish("default"));
      } catch (e) { finish("default"); }
    }
  });
}

/* Append-only audit log for admin actions. Each entry is a push-id'd
   record under {org-prefix}/sessions/{code}/audit/. Best-effort: if the
   write fails (network / rules), we don't block the underlying action. */
function logAdminAction(kind, payload) {
  if (typeof db === "undefined" || !db || typeof sessionNum !== "string" || !sessionNum) return;
  try {
    const envelope = {
      kind: String(kind || "").slice(0, 30),
      by: (typeof myName === "string" ? myName : "Admin").slice(0, 40),
      at: Date.now()
    };
    if (payload && typeof payload === "object") {
      try {
        const s = JSON.stringify(payload).slice(0, 500);
        envelope.payload = s;
      } catch (e) { /* unserialisable payload — skip it */ }
    }
    db.ref(sPath("audit")).push(envelope)
      .catch(e => console.warn("audit log write failed", kind, e && e.message));
  } catch (e) { console.warn("audit log helper failed", e); }
}

/* Append-only EVENT log for participant-side state changes (Phase 1 of the
   event-sourcing design — see ARCHITECTURE/EVENT_SOURCING_DESIGN.md). Each
   call writes one record under {org-prefix}/sessions/{code}/rooms/{room}/events/.
   Same envelope shape as the admin audit log, but writable by any
   authenticated participant (not just admins). */
function logEvent(roomName, kind, payload) {
  if (typeof db === "undefined" || !db || typeof sessionNum !== "string" || !sessionNum) return;
  if (!roomName || typeof roomName !== "string") return;
  try {
    const envelope = {
      kind: String(kind || "").slice(0, 30),
      by: (typeof myName === "string" && myName ? myName : "system").slice(0, 40),
      at: Date.now()
    };
    if (payload && typeof payload === "object") {
      try {
        const s = JSON.stringify(payload).slice(0, 500);
        envelope.payload = s;
      } catch (e) { /* unserialisable payload — skip it */ }
    }
    db.ref(sPath("rooms/" + roomName + "/events")).push(envelope)
      .catch(e => console.warn("event log write failed", kind, e && e.message));
  } catch (e) { console.warn("event log helper failed", e); }
}

function startSession() {
  const rc = parseInt(el("roomcount-input").value, 10) || 4;
  refPool.once("value").then(snap => {
    const poolNow = snap.val() || {};
    const arr = Object.keys(poolNow).map(cid => Object.assign({ clientId: cid }, poolNow[cid]));
    if (arr.length === 0) {
      alert("No one has joined the waiting room yet - wait for participants before starting.");
      return;
    }
    const checkRoomCount = () => {
      if (rc <= arr.length) return Promise.resolve(true);
      return canamedConfirm({
        title: (window.t ? window.t("modal.start.too-many-rooms-title") :
          "More rooms than participants"),
        message: (window.t ? window.t("modal.start.too-many-rooms-message") :
          "You have " + arr.length + " participant(s) but " + rc +
          " rooms. Some rooms will be empty or very small. Start anyway?"),
        okLabel: (window.t ? window.t("modal.start.ok") : "Start anyway")
      });
    };
    checkRoomCount().then(okRooms => {
      if (!okRooms) return;
      const assignment = assignRooms(arr, rc);
      // flag rooms that are tiny or single-university so the prof can rebalance
      const byRoom = {};
      Object.keys(assignment).forEach(cid => {
        (byRoom[assignment[cid]] = byRoom[assignment[cid]] || []).push(poolNow[cid]);
      });
      const weak = Object.keys(byRoom).sort().filter(r => {
        const m = byRoom[r];
        return m.length < 3 || new Set(m.map(p => p.university)).size < 2;
      });
      const checkBalance = () => {
        if (!weak.length) return Promise.resolve(true);
        return canamedConfirm({
          title: (window.t ? window.t("modal.start.weak-rooms-title") :
            "Some rooms are unbalanced"),
          message: (window.t ? window.t("modal.start.weak-rooms-message") :
            "These rooms are small or single-university:\n" + weak.join(", ") +
            "\n\nThe goal is mixed Franco-Japanese groups. Start anyway?"),
          okLabel: (window.t ? window.t("modal.start.ok") : "Start anyway")
        });
      };
      checkBalance().then(okBalance => {
        if (!okBalance) return;
        // Single atomic multi-path write: every room assignment + roomCount +
        // started commit together, or not at all. The old code wrote each
        // room separately and only set `started` AFTER all of them resolved —
        // so one transient write blip rejected Promise.all and left the
        // session half-started (rooms assigned but `started` never set, so the
        // facilitator stayed stuck on the waiting room). One update() is also
        // a single round-trip, far less exposed to a connection blip.
        const updates = { roomCount: rc, started: true };
        Object.keys(assignment).forEach(cid => {
          updates["pool/" + cid + "/room"] = assignment[cid];
        });
        db.ref(sPath("")).update(updates).then(() => {
          // Remember this session's room count so the next "Clone last
          // workshop" includes it as a default.
          saveLastWorkshop({ roomCount: rc });
        }).catch(e => {
          console.error("Start session failed", e);
          alert("Could not start the session (connection issue) - some participants " +
            "may not be placed in rooms. Check the dashboard and press Start again; " +
            "it is safe to retry.");
        });
      });
    });
  }).catch(e => {
    console.error("Start session failed", e);
    alert("Could not start the session (connection issue) - some participants " +
      "may not be placed in rooms. Check the dashboard and press Start again; " +
      "it is safe to retry.");
  });
}

function setRoomStage(r, from, to) {
  to = Math.max(0, Math.min(STAGE_COUNT - 1, to));
  let changed = false;
  db.ref(sPath("rooms/" + r + "/stage")).transaction(cur => {
    const c = typeof cur === "number" ? cur : 0;
    // returning undefined ABORTS the transaction - returning a value commits it,
    // so a conflict (another admin already moved this room) must return undefined
    if (from != null && c !== from) return undefined;
    changed = (c !== to);
    return to;
  }).then(() => {
    if (changed) {
      db.ref(sPath("rooms/" + r + "/stageAt")).set(Date.now());
      logAdminAction("room.stage", { room: r, from: from, to: to });
      logEvent(r, "stage", { room: r, from: from, to: to });
    }
  }).catch(e => {
    console.error("Stage change failed for " + r, e);
    alert("Could not change the stage for " + r + " - check your connection and try again.");
  });
}
/* approximate planned minutes per stage, for the dashboard "over time" cue */
const STAGE_MINUTES = [20, 40, 40, 15];
function roomProgress(data) {
  const revealed = (data.moduleA && data.moduleA.revealed) || {};
  const aCount = Object.keys((data.answers && data.answers.moduleA) || {}).length;
  const bCount = Object.keys((data.answers && data.answers.moduleB) || {}).length;
  return "findings " + Object.keys(revealed).length + "/" + ITEM_IDS.length +
    " · answers A" + aCount + " B" + bCount;
}

/* Live participation equity for the facilitator dashboard. Returns how many
 * of the students PRESENT in the room have actually CONTRIBUTED a substantive
 * artefact (a group answer or a working hypothesis — both tagged with the
 * author's clientId via `cid`). Lets the lead facilitator spot a room where
 * one or two students are carrying the group while others stay silent, and
 * intervene mid-session rather than discover it in the transcript afterwards.
 *   present     = clientIds with a presence record
 *   contributing = present clientIds that authored >= 1 answer/hypothesis
 *   quiet        = present but never contributed (the students to nudge) */
/* Gini coefficient of a list of non-negative values (0 = perfectly even,
 * → 1 = one person holds everything). Used to summarise how evenly the
 * room's contributions are spread across the present students. Returns 0
 * for an empty list or an all-zero list (no contributions yet = "even"). */
function gini(values) {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  if (sum === 0) return 0;
  let absDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) absDiff += Math.abs(values[i] - values[j]);
  }
  return absDiff / (2 * n * sum);
}

function roomParticipation(data) {
  const presence = (data && data.presence) || {};
  const present = Object.keys(presence);
  // Per-student contribution COUNT (not just a boolean) so we can measure
  // the spread, not only the headcount. Each answer / hypothesis is tagged
  // with its author's clientId via `cid`.
  const counts = Object.create(null);
  const tally = (obj) => {
    Object.keys(obj || {}).forEach(k => {
      const cid = obj[k] && obj[k].cid;
      if (typeof cid === "string") counts[cid] = (counts[cid] || 0) + 1;
    });
  };
  tally(data && data.answers && data.answers.moduleA);
  tally(data && data.answers && data.answers.moduleB);
  tally(data && data.moduleA && data.moduleA.hypotheses);
  const perPresent = present.map(cid => counts[cid] || 0);
  const contributing = perPresent.filter(c => c > 0).length;
  // "Who's stuck" — present students who haven't contributed anything yet.
  const quietNames = present
    .filter(cid => !(counts[cid] > 0))
    .map(cid => (presence[cid] && presence[cid].name) ? presence[cid].name : "—");
  return {
    present: present.length,
    contributing: contributing,
    gini: gini(perPresent),
    quietNames: quietNames
  };
}

/* the big dashboard overview */
/* Help-call notifier — when a NEW (not-already-alerted) call appears
   on a room the admin is watching, play a soft chime + fire a desktop
   notification. Idempotent: each call's `at` timestamp is the de-dup
   key, so re-renders don't repeat the alert. Silent fallback when
   the browser denies Notifications or blocks Web Audio. */
const _helpCallSeen = Object.create(null);  // room → at-timestamp last alerted
let _helpAudioCtx = null;
function helpCallChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_helpAudioCtx) _helpAudioCtx = new Ctx();
    const ctx = _helpAudioCtx;
    // soft 2-tone chime: 880 Hz then 660 Hz, 200ms total, gentle ADSR
    const now = ctx.currentTime;
    [
      { freq: 880, start: 0,    dur: 0.18 },
      { freq: 660, start: 0.10, dur: 0.22 }
    ].forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(0.18, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.05);
    });
  } catch (e) { /* audio API unavailable or autoplay-blocked — silent */ }
}
function helpCallNotify(roomName, message) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "denied") return;
    const show = () => {
      try {
        const n = new Notification("CaNaMED — facilitator wanted", {
          body: roomName + (message ? ": " + message : " is calling for help"),
          tag: "canamed-help-" + roomName,  // collapse duplicates per room
          silent: false
        });
        // auto-close after 12s so they don't pile up
        setTimeout(() => { try { n.close(); } catch (e) {} }, 12_000);
        n.onclick = () => {
          try { window.focus(); n.close(); } catch (e) {}
        };
      } catch (e) {}
    };
    if (Notification.permission === "granted") {
      show();
    } else if (Notification.permission === "default") {
      // lazy-request — only the first call triggers the prompt; subsequent
      // calls reuse whichever decision the user made
      Notification.requestPermission().then(p => { if (p === "granted") show(); });
    }
  } catch (e) {}
}
/* Bug-report helper. Builds a mailto: with a short summary of the
   session context + browser fingerprint, then opens the user's mail
   client. We never transmit anything ourselves — the user remains in
   control of whether they actually hit Send and whether they attach
   the previously-downloaded error log. Mail clients clamp mailto bodies
   to ~2 KB so we don't pack the full telemetry payload; we ask the user
   to attach the JSON file instead. */
const BUG_REPORT_EMAIL = "canamed-bugs@unicaen.fr";  // operator deliverable
function openBugReportMailto() {
  const ctx = (function () {
    try {
      var summary = {
        when: new Date().toISOString(),
        url: location.href,
        sessionCode: (typeof currentSession === "string" ? currentSession : null),
        ua: navigator.userAgent,
        lang: (typeof getLang === "function" ? getLang() : (navigator.language || "")),
        viewport: window.innerWidth + "x" + window.innerHeight,
        errorCount: (window.CanamedTelemetry && Array.isArray(window.CanamedTelemetry.getErrors())
          ? window.CanamedTelemetry.getErrors().length : null)
      };
      return summary;
    } catch (e) { return { when: new Date().toISOString(), error: String(e) }; }
  })();
  var subject = "[CaNaMED bug] " + (ctx.sessionCode || "no-session") + " — please describe";
  var bodyLines = [
    "Please describe what you were doing when the issue happened, and what happened instead of what you expected.",
    "",
    "----- DO NOT EDIT BELOW THIS LINE -----",
    "Session: " + (ctx.sessionCode || "(none)"),
    "URL: " + (ctx.url || ""),
    "Time: " + ctx.when,
    "Viewport: " + ctx.viewport,
    "UI lang: " + ctx.lang,
    "Browser: " + (ctx.ua || ""),
    "In-page error log entries captured this tab: " + (ctx.errorCount == null ? "(unknown)" : ctx.errorCount),
    "",
    "If your facilitator asked you to attach the error log, please use the",
    "'Download error log' button in the admin panel before sending this email,",
    "and attach the resulting JSON file."
  ];
  var href = "mailto:" + encodeURIComponent(BUG_REPORT_EMAIL)
    + "?subject=" + encodeURIComponent(subject)
    + "&body=" + encodeURIComponent(bodyLines.join("\n"));
  // Some browsers cap mailto length around 2000 chars; truncate the UA if needed.
  if (href.length > 1800) {
    // re-build with truncated UA
    bodyLines[7] = "Browser: " + (ctx.ua || "").slice(0, 200) + " (truncated)";
    href = "mailto:" + encodeURIComponent(BUG_REPORT_EMAIL)
      + "?subject=" + encodeURIComponent(subject)
      + "&body=" + encodeURIComponent(bodyLines.join("\n"));
  }
  // Opening via location.href lets the OS hand off to the default mail
  // app; we don't open a new tab (which would just show a blank page if
  // no mail handler is registered).
  try { location.href = href; }
  catch (e) { alert("Could not open mail client: " + e.message); }
}
if (typeof window !== "undefined") {
  window.openBugReportMailto = openBugReportMailto;
}

/* Theme preference: "light" | "dark" | "auto" (= follow OS prefers-color-scheme).
   Read at boot by theme-init.js to set <html data-theme> before the first
   paint so a returning user never sees a flash of the wrong palette. */
const THEME_KEY = "canamed_theme";
function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    // Bug 6 (user-feedback-2): "high-contrast" is now a first-class user-
    // selectable theme alongside light/dark. Previously the constant was
    // recognised by theme-init.js + CSS but never offered as a value the
    // picker could set.
    return (v === "dark" || v === "light" || v === "high-contrast") ? v : "auto";
  } catch (e) { return "auto"; }
}
function setTheme(mode) {
  if (mode !== "dark" && mode !== "light" && mode !== "auto" &&
      mode !== "high-contrast") return;
  try {
    if (mode === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", mode);
  // Bug 4 follow-up (user-feedback-2): re-apply org theme so the
  // inline --primary / --primary-hover overrides are added (light) or
  // removed (dark / high-contrast) for the new mode. See applyOrgTheme.
  try { applyOrgTheme(currentOrgConfig); } catch (_) {}
  // Bug 6: keep every theme picker in the page in sync. The admin picker
  // (#admin-theme-select) and the participant settings picker
  // (#global-theme-select) both call setTheme — when one changes the
  // value, mirror it into the other so neither shows a stale option.
  try {
    ["admin-theme-select", "global-theme-select"].forEach(id => {
      const n = document.getElementById(id);
      if (n && n.value !== mode) n.value = mode;
    });
  } catch (_) {}
}
if (typeof window !== "undefined") {
  window.getTheme = getTheme;
  window.setTheme = setTheme;
}

/* Facilitator preference: mute the audible chime + the desktop
   notification. Title-bar 🔔 counter is unaffected (always shows so
   the count of waiting calls is always visible). Persisted to
   localStorage so a refresh / new tab keeps the preference. */
const HELP_MUTE_KEY = "canamed_help_alerts_muted";
function isHelpAlertsMuted() {
  try { return localStorage.getItem(HELP_MUTE_KEY) === "1"; }
  catch (e) { return false; }
}
function setHelpAlertsMuted(muted) {
  try {
    if (muted) localStorage.setItem(HELP_MUTE_KEY, "1");
    else localStorage.removeItem(HELP_MUTE_KEY);
  } catch (e) {}
}
function maybeAlertHelpCall(roomName, callForHelpRecord) {
  if (!callForHelpRecord || callForHelpRecord.ack) return;
  const at = callForHelpRecord.at;
  if (typeof at !== "number") return;
  if (_helpCallSeen[roomName] === at) return;   // already alerted on THIS call
  _helpCallSeen[roomName] = at;
  if (isHelpAlertsMuted()) return;              // facilitator opted out
  helpCallChime();
  helpCallNotify(roomName, callForHelpRecord.msg || "");
}

/* ===== Dashboard search/filter =====
   Module-scope state: the filter string survives re-renders of the
   dashboard (which fire on every Firebase write — presence churn alone
   would otherwise wipe what the facilitator typed).
   The input is only revealed once there are MORE than 5 rooms, because
   the typical 3-4-room workshop has no clutter to filter. */
let dashboardFilter = "";
let dashboardFilterWired = false;
const DASHBOARD_FILTER_THRESHOLD = 5;

function wireDashboardFilter() {
  if (dashboardFilterWired) return;
  const input = el("dashboard-filter-input");
  const clear = el("dashboard-filter-clear");
  if (!input) return;
  dashboardFilterWired = true;
  input.addEventListener("input", () => {
    dashboardFilter = (input.value || "").trim().toLowerCase();
    if (clear) clear.hidden = !dashboardFilter;
    renderDashboard();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dashboardFilter) {
      e.preventDefault();
      input.value = "";
      dashboardFilter = "";
      if (clear) clear.hidden = true;
      renderDashboard();
    }
  });
  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      dashboardFilter = "";
      clear.hidden = true;
      input.focus();
      renderDashboard();
    });
  }
}

/* Returns true if the room (named `name`, with `data` from allRooms[name])
   matches the current dashboardFilter. Empty filter matches everything.
   Match is case-insensitive substring against the room's name, its team
   name (if set) and the names of any participants currently in it. */
function roomMatchesFilter(name, data) {
  if (!dashboardFilter) return true;
  const q = dashboardFilter;
  if ((name || "").toLowerCase().indexOf(q) >= 0) return true;
  if (data && data.teamName && data.teamName.toLowerCase().indexOf(q) >= 0) return true;
  if (data && data.presence) {
    const keys = Object.keys(data.presence);
    for (let i = 0; i < keys.length; i++) {
      const p = data.presence[keys[i]];
      if (p && p.name && p.name.toLowerCase().indexOf(q) >= 0) return true;
    }
  }
  return false;
}

/* Session-wide pacing + attention roll-up for the lead facilitator. Aggregates
   the same per-room signals already on each card (stage timer vs planned, help
   calls, quiet rooms) into ONE glance, so a prof running several rooms can pace
   the whole session and triage attention without scanning every card. Pure
   read of the live `allRooms` — no new schema, no new listeners. */
function sessionSignal() {
  const names = roomNames(roomCount);
  let active = 0, over = 0, minStage = Infinity, maxStage = -Infinity;
  let slowest = null, slowestMin = -1, quietRooms = 0;
  const calling = [];
  names.forEach(r => {
    const d = allRooms[r] || {};
    const st = typeof d.stage === "number" ? d.stage : 0;
    if (d.callForHelp && !d.callForHelp.ack) calling.push(r);
    const mins = minsSince(d.stageAt);
    if (mins == null) return;            // room hasn't started a stage yet
    active++;
    minStage = Math.min(minStage, st);
    maxStage = Math.max(maxStage, st);
    if (mins > (STAGE_MINUTES[st] || 99)) {
      over++;
      if (mins > slowestMin) { slowestMin = mins; slowest = r; }
    }
    if ((st === 1 || st === 2) && typeof roomParticipation === "function") {
      const p = roomParticipation(d);
      if (p.present >= 2 && p.contributing < p.present) quietRooms++;
    }
  });
  return { rooms: names.length, active, over, minStage, maxStage,
           slowest, slowestMin, calling, quietRooms };
}

/* Paint the session signal as the first child of #dashboard. */
function renderSessionSignal(dash) {
  if (!dash) return;
  const s = sessionSignal();
  if (!s.active && !s.calling.length) return;   // nothing started yet
  const wrap = document.createElement("div");
  wrap.className = "dash-session-signal";

  // 1) Urgent first: rooms calling for a facilitator.
  if (s.calling.length) {
    const call = document.createElement("div");
    call.className = "dash-signal-line dash-signal-call";
    call.textContent = "🔔 " + s.calling.length + " room" + (s.calling.length === 1 ? "" : "s") +
      " need a facilitator now: " + s.calling.join(", ");
    wrap.appendChild(call);
  }

  // 2) Pacing.
  const pace = document.createElement("div");
  pace.className = "dash-signal-line dash-signal-pace" + (s.over > 0 ? " behind" : " ontrack");
  if (!s.active) {
    pace.textContent = "⏱ Pacing — waiting for rooms to start.";
  } else if (s.over === 0) {
    pace.textContent = "⏱ Pacing — all " + s.active + " active room" +
      (s.active === 1 ? "" : "s") + " on track.";
  } else {
    pace.textContent = "⏱ Pacing — " + s.over + "/" + s.active +
      " over planned stage time" +
      (s.slowest ? " (slowest: " + s.slowest + ", " + s.slowestMin + " min)" : "") +
      (s.maxStage > s.minStage
        ? " · rooms span stages " + (s.minStage + 1) + "–" + (s.maxStage + 1) : "") + ".";
  }
  wrap.appendChild(pace);

  // 3) Quiet rooms (gentle nudge; per-room names are still on each card).
  if (s.quietRooms > 0) {
    const q = document.createElement("div");
    q.className = "dash-signal-line dash-signal-quiet";
    q.textContent = "💤 " + s.quietRooms + " room" + (s.quietRooms === 1 ? "" : "s") +
      " with a student not yet contributing.";
    wrap.appendChild(q);
  }
  dash.appendChild(wrap);
}

function renderDashboard() {
  const dash = el("dashboard");
  dash.innerHTML = "";
  // toggle the filter wrap visibility based on roomCount; wire its
  // listeners once the input is in the DOM (which it always is — it
  // lives in index.html alongside #dashboard — but the wiring is
  // deferred so it doesn't run when there's no admin view yet).
  const filterWrap = el("dashboard-filter-wrap");
  if (filterWrap) {
    const showFilter = roomCount > DASHBOARD_FILTER_THRESHOLD;
    filterWrap.classList.toggle("hidden", !showFilter);
    if (showFilter) wireDashboardFilter();
    else if (dashboardFilter) {
      // facilitator dropped to <=5 rooms (rare, but cope) — clear stale filter
      dashboardFilter = "";
      const inp = el("dashboard-filter-input");
      if (inp) inp.value = "";
      const clr = el("dashboard-filter-clear");
      if (clr) clr.hidden = true;
    }
  }
  // Session-wide pacing + attention roll-up at the top of the dashboard, so
  // the lead facilitator can pace the whole room set at a glance instead of
  // scanning every card (read-only; derived from the live `allRooms`).
  renderSessionSignal(dash);
  let visibleCount = 0;
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const people = data.presence
      ? Object.keys(data.presence).map(c => data.presence[c].name) : [];
    const calling = !!data.callForHelp && !data.callForHelp.ack;
    // Side-effect: trigger sound + desktop notification for any NEW
    // call (per-room dedup by the call's `at` timestamp).
    if (calling) maybeAlertHelpCall(r, data.callForHelp);

    const row = document.createElement("div");
    row.className = "dash-room" + (calling ? " calling" : "");
    // apply the search filter: hide rooms that don't match without
    // dropping them from the DOM (so a clear-filter is instant)
    if (!roomMatchesFilter(r, data)) {
      row.classList.add("dashboard-filtered-out");
    } else {
      visibleCount++;
    }

    const info = document.createElement("div");
    info.className = "dash-info";
    const title = document.createElement("div");
    title.className = "dash-title";
    title.textContent = r + "  ·  " + people.length +
      (people.length === 1 ? " person" : " people");
    if (calling) {
      const badge = document.createElement("span");
      badge.className = "call-badge";
      const age = minsSince(data.callForHelp.at);
      badge.textContent = "🔔 calling for a facilitator" +
        (age != null && age > 0 ? " · " + age + " min" : "");
      title.appendChild(badge);
    }
    const stg = document.createElement("div");
    stg.className = "dash-stage";
    stg.textContent = "Stage " + (st + 1) + "/" + STAGE_COUNT + " · " + stageLabel(st);
    // time-in-stage + work-progress, so the lead prof can pace without opening rooms
    const timer = document.createElement("div");
    const mins = minsSince(data.stageAt);
    if (mins != null) {
      const over = mins > (STAGE_MINUTES[st] || 99);
      timer.className = "dash-timer" + (over ? " over" : "");
      timer.textContent = mins + " min in this stage" +
        (over ? " (planned ~" + STAGE_MINUTES[st] + ")" : "");
    } else {
      timer.className = "dash-timer";
      timer.textContent = "";
    }
    const prog = document.createElement("div");
    prog.className = "dash-progress";
    prog.textContent = roomProgress(data);
    if (calling && data.callForHelp.msg) {
      const det = document.createElement("span");
      det.className = "call-detail";
      det.textContent = "needs: ";
      const m = document.createElement("span");
      m.className = "call-msg"; m.textContent = data.callForHelp.msg;
      det.appendChild(m);
      prog.appendChild(det);
    }
    // Live participation equity — how evenly the room is engaged. Only
    // meaningful once the room is in an interactive stage (Module A/B) with
    // students present. Shows the contributing headcount + a Gini-derived
    // "balance" read, and (separately) names the students who haven't
    // contributed yet so the facilitator can nudge them by name.
    const part = roomParticipation(data);
    const interactive = (st === 1 || st === 2);
    const quiet = interactive && part.present >= 2 && part.contributing < part.present;

    const partic = document.createElement("div");
    partic.className = "dash-participation" + (quiet ? " quiet" : "");
    if (interactive && part.present >= 1) {
      let line = "👥 " + part.contributing + "/" + part.present + " contributing";
      // A balance read is only meaningful with 2+ actual contributors among
      // 3+ present (Gini on tiny / single-contributor sets is noise).
      if (part.contributing >= 2 && part.present >= 3) {
        const g = part.gini;
        const label = g < 0.2 ? "even" :
                      g < 0.4 ? "slightly uneven" : "uneven — one or two carrying it";
        line += " · " + label;
        partic.title = "Contribution balance (Gini) " + g.toFixed(2) +
          " — 0 is perfectly even, 1 is one person doing everything";
      }
      partic.textContent = line;
    } else {
      partic.textContent = "";
    }

    // "Who's stuck" — name the present students with zero contributions so
    // the facilitator can prompt them directly. Names via textContent only.
    const quietLine = document.createElement("div");
    quietLine.className = "dash-quiet-names";
    if (interactive && part.present >= 2 && part.quietNames.length &&
        part.quietNames.length < part.present) {
      quietLine.textContent = "💤 not yet contributing: " + part.quietNames.join(", ");
    } else {
      quietLine.textContent = "";
    }

    const ppl = document.createElement("div");
    ppl.className = "dash-people";
    if (people.length) {
      people.forEach(nm => ppl.appendChild(makeChip(nm, nm, "mini-chip")));
    } else {
      ppl.textContent = "empty";
    }
    // live score line - total, plus the auto / manual / penalty split
    const s = data.score || {};
    let sAuto = 0, sManualRaw = 0, sPen = 0;
    Object.keys(s.auto || {}).forEach(k => { sAuto += (s.auto[k].points || 0); });
    Object.keys(s.manual || {}).forEach(k => { sManualRaw += (s.manual[k].points || 0); });
    Object.keys(s.penalties || {}).forEach(k => { sPen += (s.penalties[k].points || 0); });
    const sManual = Math.min(sManualRaw, MANUAL_CAP);
    const score = document.createElement("div");
    score.className = "dash-score";
    score.textContent = (data.teamName ? data.teamName + " — " : "") +
      "Score " + Math.max(0, sAuto + sManual - sPen) + "  ·  auto " + sAuto +
      "  ·  facilitator " + sManual + "/" + MANUAL_CAP +
      (sPen ? "  ·  penalties −" + sPen : "");
    info.appendChild(title); info.appendChild(stg);
    info.appendChild(timer); info.appendChild(prog);
    info.appendChild(partic); info.appendChild(quietLine); info.appendChild(ppl);
    info.appendChild(score);

    const ctrl = document.createElement("div");
    ctrl.className = "dash-ctrl";
    const view = document.createElement("button");
    view.className = "view-btn";
    view.textContent = "Open room";
    view.addEventListener("click", () => openRoomAsAdmin(r));
    const back = document.createElement("button");
    back.textContent = "← Back"; back.disabled = st === 0;
    back.addEventListener("click", () => setRoomStage(r, st, st - 1));
    const fwd = document.createElement("button");
    fwd.textContent = "Advance →"; fwd.disabled = st === STAGE_COUNT - 1;
    fwd.addEventListener("click", () => setRoomStage(r, st, st + 1));
    const ptsBtn = document.createElement("button");
    ptsBtn.className = "pts-btn";
    ptsBtn.textContent = "+ Points";
    ptsBtn.addEventListener("click", () => {
      pointsPanelOpen = (pointsPanelOpen === r) ? null : r;
      renderDashboard();
    });
    ctrl.appendChild(view); ctrl.appendChild(back); ctrl.appendChild(fwd);
    ctrl.appendChild(ptsBtn);

    row.appendChild(info); row.appendChild(ctrl);
    if (pointsPanelOpen === r) row.appendChild(buildPointsPanel(r, sManualRaw));
    dash.appendChild(row);
  });
  // when a filter is active and nothing matched, show a polite empty-
  // state line instead of an entirely blank panel
  if (dashboardFilter && visibleCount === 0) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty-filter";
    empty.textContent = (typeof window.t === "function")
      ? window.t("admin.search.empty")
      : "No rooms match this filter.";
    dash.appendChild(empty);
  }
}

/* the facilitator's +points panel - fixed reason tags, capped manual total */
let pointsPanelOpen = null;
function buildPointsPanel(room, manualRaw) {
  const panel = document.createElement("div");
  panel.className = "dash-points-panel";
  const atCap = manualRaw >= MANUAL_CAP;
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = atCap
    ? "Facilitator-points cap reached for this room (" + MANUAL_CAP + ")."
    : "Award the room that reasons and debates well — not the one that finishes first.";
  panel.appendChild(intro);
  SCORE_MANUAL_TAGS.forEach(t => {
    const b = document.createElement("button");
    b.className = "pts-tag";
    b.textContent = "+" + t.points + "  " + t.tag;
    b.disabled = atCap;
    b.addEventListener("click", () => awardManual(room, t.tag, t.points));
    panel.appendChild(b);
  });
  const undo = document.createElement("button");
  undo.className = "pts-undo";
  undo.textContent = "Undo last award";
  undo.addEventListener("click", () => undoLastManual(room));
  panel.appendChild(undo);
  return panel;
}
function awardManual(room, tag, points) {
  db.ref(sPath("rooms/" + room + "/score/manual")).push({
    points: points, tag: tag, by: myName, at: Date.now()
  }).catch(e => console.error("Award failed", e));
  logEvent(room, "score.manual", { tag: tag, points: points, by: myName });
}
function undoLastManual(room) {
  const ref = db.ref(sPath("rooms/" + room + "/score/manual"));
  ref.once("value").then(snap => {
    const v = snap.val() || {};
    const keys = Object.keys(v).sort((a, b) => (v[a].at || 0) - (v[b].at || 0));
    if (keys.length) return ref.child(keys[keys.length - 1]).remove();
  }).catch(e => console.error("Undo failed", e));
}

/* ===================== POST-SESSION DEBRIEF DASHBOARD =====================
   Aggregate stats panel for facilitators, toggled from the admin chrome.
   Computed entirely from `allRooms` (already live-subscribed via startAdmin)
   and `pool` (also live). No new Firebase listeners, no new schema.

   Sections, in order:
     1. Ranking — rooms by total score
     2. Decisions — per-decision option split across rooms
     3. Penalties — heatmap of penalties × rooms
     4. Concepts — per scoring family, how many rooms hit it
     5. Funnel — pool → assigned → answered → voted
     6. Time-on-stage — when stage history is unavailable, current
        stage durations are used (only stageAt is stored)

   Rendered into #debrief-body when the panel is visible. The debounced
   refRooms listener also triggers a re-render here (cheap, pure-DOM). */
let debriefVisible = false;
function _debriefT(key) { return (typeof t === "function") ? t(key) : key; }
function _debriefBucket(roomData) {
  /* returns an object with { total, auto, manual, pen } for the given room */
  const s = (roomData && roomData.score) || {};
  let auto = 0, manualRaw = 0, pen = 0;
  Object.keys(s.auto || {}).forEach(k => { auto += (s.auto[k].points || 0); });
  Object.keys(s.manual || {}).forEach(k => { manualRaw += (s.manual[k].points || 0); });
  Object.keys(s.penalties || {}).forEach(k => { pen += (s.penalties[k].points || 0); });
  const manual = Math.min(manualRaw, MANUAL_CAP);
  return { total: Math.max(0, auto + manual - pen), auto: auto,
           manual: manual, pen: pen };
}
function _debriefRoomList() {
  return roomNames(roomCount).filter(r => allRooms[r] != null);
}
function _debriefMakeBar(labelText, fillPct, valText, kind) {
  const row = document.createElement("div");
  row.className = "debrief-bar-row";
  const lbl = document.createElement("div");
  lbl.className = "lbl"; lbl.textContent = labelText;
  const track = document.createElement("div");
  track.className = "debrief-bar-track";
  const fill = document.createElement("i");
  fill.className = "debrief-bar-fill" + (kind ? " " + kind : "");
  // CSP forbids inline style="..." attrs in our policy, but element.style.X
  // is a property set, which is allowed and not parsed as inline CSS.
  fill.style.width = Math.max(0, Math.min(100, fillPct)) + "%";
  track.appendChild(fill);
  const val = document.createElement("div");
  val.className = "val"; val.textContent = valText;
  row.appendChild(lbl); row.appendChild(track); row.appendChild(val);
  return row;
}
function _debriefSection(titleKey) {
  const sec = document.createElement("section");
  sec.className = "debrief-section";
  const h = document.createElement("h4");
  h.textContent = _debriefT(titleKey);
  sec.appendChild(h);
  return sec;
}
function _debriefEmpty(sec) {
  const p = document.createElement("p");
  p.className = "debrief-empty";
  p.textContent = _debriefT("debrief.no-data");
  sec.appendChild(p);
  return sec;
}
function _debriefRankingSection() {
  const sec = _debriefSection("debrief.section.ranking");
  const rooms = _debriefRoomList();
  if (!rooms.length) return _debriefEmpty(sec);
  const rows = rooms.map(r => ({
    room: r,
    team: (allRooms[r] && allRooms[r].teamName) || "",
    score: _debriefBucket(allRooms[r]).total
  })).sort((a, b) => b.score - a.score);
  const maxScore = Math.max(1, rows[0].score);
  rows.forEach(rr => {
    const lbl = rr.room + (rr.team ? " — " + rr.team : "");
    sec.appendChild(_debriefMakeBar(
      lbl, (rr.score / maxScore) * 100, String(rr.score)));
  });
  return sec;
}
function _debriefDecisionsSection() {
  const sec = _debriefSection("debrief.section.decisions");
  const rooms = _debriefRoomList();
  if (!rooms.length || typeof DECISIONS === "undefined" || !Array.isArray(DECISIONS)) {
    return _debriefEmpty(sec);
  }
  const lang = _curLang();
  DECISIONS.forEach(d => {
    const card = document.createElement("div");
    card.className = "debrief-decision";
    const prompt = document.createElement("div");
    prompt.className = "debrief-decision-prompt";
    prompt.textContent = (d.module ? "[" + _debriefT(
      d.module === "B" ? "debrief.module-b" : "debrief.module-a") + "] " : "") +
      tc(d.prompt, lang);
    card.appendChild(prompt);

    // tally how each room locked it in
    const counts = (d.options || []).map(() => 0);
    let committed = 0;
    rooms.forEach(r => {
      const v = ((allRooms[r] || {}).votes || {})[d.id] || {};
      const c = v.committed && typeof v.committed.choice === "number"
        ? v.committed.choice : null;
      if (c != null && c >= 0 && c < counts.length) {
        counts[c] += 1; committed += 1;
      }
    });
    const meta = document.createElement("div");
    meta.className = "debrief-decision-meta";
    meta.textContent = committed + " / " + rooms.length + " " +
      _debriefT("debrief.rooms-picked") +
      (committed ? "" : " — " + _debriefT("debrief.no-commit"));
    card.appendChild(meta);

    (d.options || []).forEach((opt, i) => {
      const row = document.createElement("div");
      row.className = "debrief-decision-option";
      const text = document.createElement("span");
      text.className = "opt-text" + (opt.correct ? " correct" : "");
      text.textContent = tc(opt.text, lang) +
        (opt.correct ? " " + _debriefT("debrief.correct-option") : "");
      const cnt = document.createElement("span");
      cnt.className = "opt-count";
      const pct = committed > 0 ? Math.round((counts[i] / committed) * 100) : 0;
      const pts = (opt.correct ? (d.points || 0) : -(d.penalty || 0));
      cnt.textContent = counts[i] + " · " + pct + "% · " +
        (pts >= 0 ? "+" : "") + pts;
      const bar = document.createElement("div");
      bar.className = "debrief-option-bar";
      const fill = document.createElement("i");
      if (opt.correct) fill.className = "correct";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      row.appendChild(text); row.appendChild(cnt);
      card.appendChild(row);
      card.appendChild(bar);
    });
    sec.appendChild(card);
  });
  return sec;
}
function _debriefPenaltiesSection() {
  const sec = _debriefSection("debrief.section.penalties");
  const rooms = _debriefRoomList();
  if (!rooms.length || typeof PENALTIES === "undefined" || !Array.isArray(PENALTIES)) {
    return _debriefEmpty(sec);
  }
  const lang = _curLang();
  // identify which penalties have fired anywhere; if none, show empty state
  // (much friendlier than a fully-empty grid)
  const firedByRoom = {};
  rooms.forEach(r => {
    firedByRoom[r] = {};
    const s = ((allRooms[r] || {}).score || {}).penalties || {};
    Object.keys(s).forEach(eid => {
      // eid is the penalty's id (or "decpen_<...>") — count by id
      firedByRoom[r][eid] = (firedByRoom[r][eid] || 0) + (s[eid].points || 0);
    });
  });
  const totalFires = rooms.reduce((acc, r) =>
    acc + Object.keys(firedByRoom[r]).length, 0);
  if (totalFires === 0) return _debriefEmpty(sec);

  const wrap = document.createElement("div");
  wrap.className = "debrief-heat-wrap";
  const grid = document.createElement("div");
  grid.className = "debrief-heat";
  // grid columns: penalty label + one per room
  grid.style.gridTemplateColumns = "minmax(180px, 1fr) repeat(" + rooms.length + ", minmax(60px, 1fr))";
  // header row
  const corner = document.createElement("div"); corner.className = "debrief-heat-h"; grid.appendChild(corner);
  rooms.forEach(r => {
    const h = document.createElement("div");
    h.className = "debrief-heat-h"; h.textContent = r; grid.appendChild(h);
  });
  // only render penalties that fired in ≥1 room
  PENALTIES.forEach(p => {
    const anyHit = rooms.some(r => firedByRoom[r][p.id]);
    if (!anyHit) return;
    const lbl = document.createElement("div");
    lbl.className = "debrief-heat-rowlbl";
    lbl.textContent = tc(p.title, lang);
    grid.appendChild(lbl);
    rooms.forEach(r => {
      const cell = document.createElement("div");
      cell.className = "debrief-heat-cell" + (firedByRoom[r][p.id] ? " fired" : "");
      cell.textContent = firedByRoom[r][p.id] ? "−" + firedByRoom[r][p.id] : "";
      grid.appendChild(cell);
    });
  });
  wrap.appendChild(grid);
  sec.appendChild(wrap);
  return sec;
}
function _debriefConceptsSection() {
  const sec = _debriefSection("debrief.section.concepts");
  const rooms = _debriefRoomList();
  if (!rooms.length || typeof SCORING === "undefined") return _debriefEmpty(sec);
  const lang = _curLang();
  const totalRooms = rooms.length;
  ["moduleA", "moduleB"].forEach(mk => {
    const fams = (SCORING && SCORING[mk]) || [];
    if (!fams.length) return;
    const sub = document.createElement("div");
    const sh = document.createElement("strong");
    sh.textContent = _debriefT(mk === "moduleA" ? "debrief.module-a" : "debrief.module-b");
    sub.appendChild(sh);
    fams.forEach(fam => {
      const evKey = "concept" + (mk === "moduleA" ? "A" : "B") + "_" + fam.id;
      let hits = 0;
      rooms.forEach(r => {
        const auto = ((allRooms[r] || {}).score || {}).auto || {};
        if (auto[evKey]) hits += 1;
      });
      const pct = totalRooms ? (hits / totalRooms) * 100 : 0;
      const kind = hits === totalRooms ? "ok"
                 : hits === 0 ? "bad"
                 : (hits / totalRooms < 0.5 ? "warn" : "");
      sub.appendChild(_debriefMakeBar(
        tc(fam.label, lang), pct,
        hits + " / " + totalRooms + " " + _debriefT("debrief.concept.rooms-hit"),
        kind));
    });
    sec.appendChild(sub);
  });
  return sec;
}
function _debriefFunnelSection() {
  const sec = _debriefSection("debrief.section.funnel");
  // count: anyone in pool (with consent already implied)
  const poolList = Object.keys(pool || {}).map(k => pool[k] || {});
  const joinedPool = poolList.length;
  if (!joinedPool) return _debriefEmpty(sec);
  const assigned = poolList.filter(p => p && typeof p.room === "string" && p.room).length;
  // answered ≥1: count unique clientIds across all rooms' answer entries
  const answeredCids = {};
  const votedCids = {};
  _debriefRoomList().forEach(r => {
    const room = allRooms[r] || {};
    const ans = room.answers || {};
    ["moduleA", "moduleB"].forEach(mk => {
      const entries = ans[mk] || {};
      Object.keys(entries).forEach(eid => {
        const e = entries[eid] || {};
        if (e.cid) answeredCids[e.cid] = true;
      });
    });
    const votes = room.votes || {};
    Object.keys(votes).forEach(vid => {
      const ballots = (votes[vid] && votes[vid].ballots) || {};
      Object.keys(ballots).forEach(cid => { votedCids[cid] = true; });
    });
  });
  const rows = [
    { key: "debrief.funnel.registered", n: joinedPool },
    { key: "debrief.funnel.assigned",   n: assigned },
    { key: "debrief.funnel.answered",   n: Object.keys(answeredCids).length },
    { key: "debrief.funnel.voted",      n: Object.keys(votedCids).length }
  ];
  rows.forEach(rr => {
    const row = document.createElement("div");
    row.className = "debrief-funnel-row";
    const lbl = document.createElement("span");
    lbl.textContent = _debriefT(rr.key) + " — " + rr.n;
    const pct = document.createElement("span");
    pct.className = "pct";
    pct.textContent = Math.round((rr.n / Math.max(1, joinedPool)) * 100) + "%";
    row.appendChild(lbl); row.appendChild(pct);
    sec.appendChild(row);
  });
  return sec;
}
function _debriefTimeSection() {
  const sec = _debriefSection("debrief.section.time");
  const rooms = _debriefRoomList();
  if (!rooms.length) return _debriefEmpty(sec);
  // We only have the CURRENT stage's stageAt (no history). Show minutes spent
  // on the current stage per room as a single coloured segment — this is the
  // best signal available without adding schema.
  const now = Date.now();
  rooms.forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const at = typeof data.stageAt === "number" ? data.stageAt : null;
    const mins = at ? Math.max(0, Math.round((now - at) / 60000)) : 0;
    const block = document.createElement("div");
    block.className = "debrief-time-room";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.textContent = r + " — " + _debriefT("debrief.time.stage") + " " + (st + 1) +
      " · " + mins + " " + _debriefT("debrief.time.minutes");
    block.appendChild(lbl);
    const stack = document.createElement("div");
    stack.className = "debrief-time-stack";
    const seg = document.createElement("div");
    seg.className = "debrief-time-seg s" + st;
    seg.style.width = "100%";
    seg.textContent = mins + " " + _debriefT("debrief.time.minutes");
    stack.appendChild(seg);
    block.appendChild(stack);
    sec.appendChild(block);
  });
  // legend
  const legend = document.createElement("div");
  legend.className = "debrief-time-legend";
  for (let i = 0; i < STAGE_COUNT; i++) {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = "s" + i;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(stageLabel(i)));
    legend.appendChild(item);
  }
  sec.appendChild(legend);
  return sec;
}
function renderDebrief() {
  const body = el("debrief-body");
  if (!body) return;
  body.innerHTML = "";
  const noRooms = _debriefRoomList().length === 0;
  if (noRooms) {
    const p = document.createElement("p");
    p.className = "debrief-empty";
    p.textContent = _debriefT("debrief.empty");
    body.appendChild(p);
    return;
  }
  body.appendChild(_debriefRankingSection());
  body.appendChild(_debriefDecisionsSection());
  body.appendChild(_debriefPenaltiesSection());
  body.appendChild(_debriefConceptsSection());
  body.appendChild(_debriefFunnelSection());
  body.appendChild(_debriefTimeSection());
}
function toggleDebrief() {
  debriefVisible = !debriefVisible;
  const panel = el("admin-debrief");
  const btn = el("admin-debrief-btn");
  if (panel) panel.classList.toggle("hidden", !debriefVisible);
  if (btn) {
    btn.setAttribute("aria-expanded", debriefVisible ? "true" : "false");
    // toggle the data-i18n key + textContent so the language switcher refreshes
    btn.setAttribute("data-i18n",
      debriefVisible ? "debrief.toggle-close" : "debrief.toggle");
    btn.textContent = _debriefT(
      debriefVisible ? "debrief.toggle-close" : "debrief.toggle");
  }
  if (debriefVisible) renderDebrief();
}
if (typeof window !== "undefined") {
  window.renderDebrief = renderDebrief;
  window.toggleDebrief = toggleDebrief;
}

/* the side panel shown while an admin is inside a room */
function renderSidebar() {
  const box = el("sidebar-rooms");
  if (!box) return;
  box.innerHTML = "";
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const calling = !!data.callForHelp && !data.callForHelp.ack;
    const count = data.presence ? Object.keys(data.presence).length : 0;

    const row = document.createElement("div");
    row.className = "sidebar-room" + (r === myRoom ? " current" : "") +
      (calling ? " calling" : "");
    const nameBtn = document.createElement("button");
    nameBtn.className = "sidebar-room-name";
    nameBtn.textContent = r + (calling ? "  🔔" : "") + "  ·  " + count +
      (count === 1 ? " person" : " people");
    nameBtn.addEventListener("click", () => { if (r !== myRoom) openRoomAsAdmin(r); });

    const meta = document.createElement("div");
    meta.className = "sidebar-room-meta";
    meta.textContent = "Stage " + (st + 1) + "/" + STAGE_COUNT + " · " + stageLabel(st);

    const ctrl = document.createElement("div");
    ctrl.className = "sidebar-room-ctrl";
    const back = document.createElement("button");
    back.textContent = "←"; back.disabled = st === 0;
    back.title = "Step " + r + " back a stage";
    back.setAttribute("aria-label", back.title);
    back.addEventListener("click", () => setRoomStage(r, st, st - 1));
    const fwd = document.createElement("button");
    fwd.textContent = "→"; fwd.disabled = st === STAGE_COUNT - 1;
    fwd.title = "Advance " + r + " a stage";
    fwd.setAttribute("aria-label", fwd.title);
    fwd.addEventListener("click", () => setRoomStage(r, st, st + 1));
    ctrl.appendChild(back); ctrl.appendChild(fwd);

    row.appendChild(nameBtn); row.appendChild(meta); row.appendChild(ctrl);
    box.appendChild(row);
  });
}

/* an admin opens (or switches to) a room - sees the exact student view.
   Acknowledge any call for help: the dashboard alert clears, and the room's
   students see "a prof is on the way". */
function openRoomAsAdmin(roomName) {
  const cfh = db.ref(sPath("rooms/" + roomName + "/callForHelp"));
  cfh.once("value").then(snap => {
    const v = snap.val();
    if (v && !v.ack) return cfh.set({ by: v.by, at: v.at, ack: true });
  }).catch(e => console.error("Acknowledging call failed", e));
  enterRoom(roomName, true);
  renderSidebar();
}
function backToDashboard() {
  teardownRoom();
  isRoomAdmin = false;
  myRoom = null;
  document.body.classList.remove("admin-room");
  el("app").classList.add("hidden");
  el("room-sidebar").classList.add("hidden");
  el("admin-app").classList.remove("hidden");
  el("header-right").textContent =
    (role === "superadmin" ? "Super admin" : "Admin") + " · Session " + sessionNum;
  focusHeading("admin-app");
}

/* ===================== CLOSE SESSION & FULL ARCHIVE EXPORT ==================
   When an admin "ends" the session, the platform downloads the WHOLE session
   subtree as one JSON file (every group's answers, votes, revealed findings,
   scores, contributions, presence) and writes a `closed` marker so every
   participant sees a "thanks for taking part" banner.

   The marker is advisory: the database stays readable so latecomers can still
   review their team's work, but the social signal is unambiguous - the
   facilitator has ended the workshop, and the full record is in the
   facilitator's downloads folder. */
function closeSession() {
  if (!sessionNum || !db) {
    alert("No session loaded — nothing to close.");
    return;
  }
  const btn = el("admin-close-btn");
  const orig = btn && btn.textContent;
  const resetBtn = (text) => {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = text || orig || "End session & download archive";
  };

  if (btn) { btn.disabled = true; btn.textContent = "Building archive…"; }

  // 1. is the session already closed? If yes, we'll just re-download.
  db.ref(sPath("closed")).once("value")
    .then(snap => {
      const alreadyClosed = !!snap.val();
      if (!alreadyClosed) {
        return canamedConfirm({
          title: (window.t ? window.t("modal.close.title") :
            "End session and download archive?"),
          message: (window.t ? window.t("modal.close.message") :
            "This will:\n" +
            "  • download a JSON file with every group's answers, votes, " +
            "reveals, scores, contributions and presence\n" +
            "  • mark the session as closed — participants see a 'thanks " +
            "for taking part' banner and cannot type any more text\n\n" +
            "The students' data stays in the database — you can re-download " +
            "the archive any time. The marker cannot easily be undone."),
          okLabel: (window.t ? window.t("modal.close.ok") :
            "End and download"),
          danger: true
        }).then(ok => {
          if (!ok) { resetBtn(); return { cancelled: true }; }
          // 2. fetch the full tree and download it
          return db.ref(sPath("")).once("value")
            .then(t => ({ tree: t.val() || {}, alreadyClosed: alreadyClosed }));
        });
      }
      // already closed → skip confirm, just re-fetch + re-download
      return db.ref(sPath("")).once("value")
        .then(t => ({ tree: t.val() || {}, alreadyClosed: alreadyClosed }));
    })
    .then(result => {
      if (!result || result.cancelled) return null;
      const tree = result.tree;
      // strip the password hash from the archive
      if (tree.adminPasswordHash) delete tree.adminPasswordHash;
      downloadFullArchive(tree, sessionNum);
      if (result.alreadyClosed) {
        resetBtn("Session closed ✓ — re-download archive");
        if (btn) btn.classList.add("done");
        return null;          // nothing more to do
      }
      // 3. archive is downloaded; now write the closed marker
      if (btn) btn.textContent = "Closing session…";
      return db.ref(sPath("closed")).set({
        by: myName || "Admin",
        at: Date.now()
      }).then(() => "written");
    })
    .then(result => {
      if (result !== "written") return;
      // Persist a pseudonymous program summary: a durable DB copy (rules-guarded
      // /summary) AND a local rollup entry kept across close, so the Program
      // overview can aggregate this session later. Best-effort — never blocks.
      try {
        const summary = _sessionSummaryObj();
        recordProgramSession(summary);
        if (db) db.ref(sPath("summary")).set(summary).catch(() => { /* rules/offline */ });
      } catch (e) { /* non-fatal */ }
      // write succeeded - update the button + drop this session from the
      // local "my open sessions" tracker (the reaper list won't show it
      // anymore on next splash visit).
      try { removeMySession(sessionNum); } catch (e) { /* non-fatal */ }
      resetBtn("Session closed ✓ — re-download archive");
      if (btn) btn.classList.add("done");
    })
    .catch(e => {
      console.error("Close session failed", e);
      // The archive was downloaded but the close-write failed - tell the user
      // exactly that, with the actual error so they can act on it. The most
      // common cause is stale database rules in production (the `closed`
      // field validation was added later) - solved by:
      //   firebase deploy --only database
      const reason = (e && e.code) ? (e.code + ": " + (e.message || ""))
                                   : (e && e.message) || String(e);
      alert(
        "The archive downloaded, but the session could NOT be marked as " +
        "closed.\n\n" +
        "Reason: " + reason + "\n\n" +
        "If this says PERMISSION_DENIED, your database rules need to be " +
        "deployed (run `firebase deploy --only database` from the platform " +
        "folder). Otherwise check your connection and try again."
      );
      resetBtn();
    });
}

/* GDPR Art. 15 (right of access) participant data export.
 *
 * Self-service "download everything you have on me" for the current
 * session. Runs entirely in the browser:
 *   - reads /sessions/{code}/pool/{clientId}
 *   - reads /sessions/{code}/rooms/{room}/presence/{clientId}
 *   - reads /sessions/{code}/rooms/{room}/typing/{clientId}
 *   - reads /sessions/{code}/rooms/{room}/answers/{module}/{*} and
 *     filters by cid === clientId
 *   - reads /sessions/{code}/rooms/{room}/votes/{*}/ballots/{clientId}
 *   - if Google-signed-in, also reads /users/{uid}/profile + history
 *
 * No admin involvement; rules already permit the participant to read
 * their own pool/presence/answers (the session-level .read is
 * auth != null, and the participant IS auth'd). Triggers a JSON
 * download via Blob.
 *
 * If the platform is in MODE === "local" (no Firebase), the function
 * walks the LocalDB the same way — useful for E2E + demos.
 */
function downloadMyData() {
  if (!sessionNum) {
    alert(tFallback("data-rights.err.no-session",
      "Join a session first — there's nothing to export yet."));
    return;
  }
  if (!db || !clientId) {
    alert(tFallback("data-rights.err.not-ready",
      "The platform is still initialising. Please try again in a moment."));
    return;
  }
  const stamp = new Date();
  const out = {
    // R3-E2 — keep canamedDataExport for back-compat; mirror the archive's
    // schema fields so a single pipeline can validate both shapes.
    canamedSchema: "https://canamed.web.app/schema/participant-export-v1.json",
    canamedSchemaVersion: "1.0.0",
    canamedDataExport: 1,
    type: "participant-self-export-art-15-gdpr",
    exportedAt: stamp.toISOString(),
    sessionCode: sessionNum,
    scenarioId: window.CURRENT_SCENARIO_ID || "",
    clientId: clientId,
    user: {
      uid: (currentUser && currentUser.uid) || null,
      email: (currentUser && currentUser.email) || null,
      displayName: (currentUser && currentUser.displayName) || null,
      isAnonymous: !!(currentUser && currentUser.isAnonymous)
    },
    pool: null,
    presence: {},
    typing: {},
    answers: { moduleA: [], moduleB: [] },
    votes: [],
    // R3-A2 — pre/post-test answers belong to the participant and must be
    // exported under GDPR Art. 15. Keyed by room then by 'pre'/'post' so a
    // researcher can correlate test scores with the same room's discussion.
    tests: {},
    // R3-A2 — manual score entries the admin awarded to me, plus help calls
    // I raised. Both reference the participant by name (`by`) so we filter
    // post-hoc against myName.
    manualScoresAboutMe: [],
    helpCallsByMe: [],
    profile: null,
    history: null
  };
  const tasks = [];
  // pool entry
  tasks.push(db.ref(sPath("pool/" + clientId)).once("value").then(s => {
    out.pool = s.val();
  }));
  // rooms — presence, typing, answers, votes, all filtered by clientId
  tasks.push(db.ref(sPath("rooms")).once("value").then(s => {
    const rooms = s.val() || {};
    Object.keys(rooms).forEach(roomName => {
      const r = rooms[roomName] || {};
      if (r.presence && r.presence[clientId]) {
        out.presence[roomName] = r.presence[clientId];
      }
      if (r.typing && r.typing[clientId]) {
        out.typing[roomName] = r.typing[clientId];
      }
      ["moduleA", "moduleB"].forEach(mod => {
        const ans = (r.answers && r.answers[mod]) || {};
        Object.keys(ans).forEach(entryId => {
          if (ans[entryId] && ans[entryId].cid === clientId) {
            out.answers[mod].push(Object.assign({ room: roomName, entryId: entryId }, ans[entryId]));
          }
        });
      });
      const votes = r.votes || {};
      Object.keys(votes).forEach(voteId => {
        const ballot = votes[voteId] && votes[voteId].ballots && votes[voteId].ballots[clientId];
        if (ballot) {
          out.votes.push({ room: roomName, voteId: voteId, ballot: ballot });
        }
      });
      // R3-A2 — pre/post-test answers under tests/{cid}/{pre|post}/...
      const tests = (r.tests && r.tests[clientId]) || null;
      if (tests) {
        out.tests[roomName] = {
          pre:  tests.pre  || null,
          post: tests.post || null
        };
      }
      // R3-A2 — manual scores the admin awarded that name the participant.
      // The rule layer requires `by` to be the participant's name (string,
      // <=40 chars), so a name match is the canonical filter. We also keep
      // the room name so the participant knows which group it referred to.
      const manual = (r.score && r.score.manual) || {};
      Object.keys(manual).forEach(pid => {
        const m = manual[pid];
        if (m && typeof m.by === "string" && myName && m.by === myName) {
          out.manualScoresAboutMe.push(Object.assign({ room: roomName, id: pid }, m));
        }
      });
      // R3-A2 — help calls I raised. Same name-match rationale as manual
      // scores; the room rule stores `by` as the participant's name.
      const cfh = r.callForHelp;
      if (cfh && typeof cfh.by === "string" && myName && cfh.by === myName) {
        out.helpCallsByMe.push(Object.assign({ room: roomName }, cfh));
      }
    });
  }));
  // identified-user data — only if Google-signed-in
  if (currentUser && !currentUser.isAnonymous) {
    tasks.push(db.ref("users/" + currentUser.uid + "/profile").once("value").then(s => {
      out.profile = s.val();
    }));
    tasks.push(db.ref("users/" + currentUser.uid + "/history").once("value").then(s => {
      out.history = s.val();
    }));
  }
  Promise.all(tasks).then(() => {
    const ymd = stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const blob = new Blob([JSON.stringify(out, null, 2)],
      { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "canamed-my-data-" + sessionNum + "-" + ymd + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 250);
  }).catch(e => {
    console.error("Self-export failed", e);
    alert(tFallback("data-rights.err.export-failed",
      "Could not export your data — please try again, or contact the facilitator."));
  });
}

/* download the full session tree as a single JSON file. The shape mirrors the
   database exactly, so a researcher can re-import it for analysis later.
   R2-23 fix: honours the "Pseudonymise names in export" admin toggle the
   same way downloadAllAnswers() does — when on, the JSON archive's
   session subtree is walked and every real participant name (in pool,
   answers.{}.by, score.manual.{}.by, calls.{}.by, etc.) is replaced
   with the deterministic Student-A / Student-B / ... codes used by
   scripts/pseudonymise-export.js. */
function downloadFullArchive(tree, code) {
  const anon = !!(el("anon-export") && el("anon-export").checked);
  const stamp = new Date();
  const ymd = stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  let sessionPayload = tree;
  let linkage = null;
  if (anon) {
    const result = pseudonymiseTree(tree);
    sessionPayload = result.tree;
    linkage = result.linkage;
  }
  const archive = {
    // R3-E1/E2/E4/E5 — explicit schema metadata so Tariq's R-pipeline (and
    // any downstream consumer) can detect drift between archives.
    //
    //   canamedSchema:        the canonical JSON-Schema document URL — bump
    //                         this when fields are added / removed / renamed.
    //   canamedSchemaVersion: human-readable semver. Pre-1.0 means the schema
    //                         is still in flux; pipelines should pin to a
    //                         minor and tolerate patch bumps.
    //   canamedVersion:       legacy integer kept for back-compat with
    //                         pre-R3 readers; will be removed at v2.0.
    //   scenarioId:           stable kebab-case id (e.g. "chronic-pain-opioids")
    //                         — pipelines should dispatch on this, NOT on
    //                         scenarioName which is a localised display string.
    canamedSchema: "https://canamed.web.app/schema/archive-v1.json",
    canamedSchemaVersion: "1.0.0",
    canamedVersion: 1,
    exportedAt: stamp.toISOString(),
    sessionCode: code,
    workshopName: (window.CFG && window.CFG.workshopName) || "",
    scenarioId: window.CURRENT_SCENARIO_ID || "",
    scenarioName: tc(window.CURRENT_SCENARIO_NAME, "en") || "",
    pseudonymised: !!anon,
    cohorts: (window.COHORTS || []).map(c => ({
      id: c.id, label: c.label, country: c.country
    })),
    /* the live tree as the engine saw it - rooms, pool, answers, votes,
       scores, presence, callForHelp, revealed items, decisions, the lot */
    session: sessionPayload
  };
  // When pseudonymised, include the linkage table count (not the table
  // itself) so a researcher reviewing the export knows the export was
  // pseudonymised and how many distinct participants were re-coded.
  if (anon) {
    archive.pseudonymisedParticipantCount = Object.keys(linkage || {}).length;
    archive.pseudonymisedNote = "Real names replaced by Student-A / Student-B / ... " +
      "deterministic per session, ordered by pool join time. " +
      "Linkage table is NOT included in this on-demand export — " +
      "re-identification requires the linkage table held by the operator.";
  }
  const json = JSON.stringify(archive, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "canamed-" + code + "-" + ymd +
    (anon ? "_pseudonymised.json" : ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ===================== PER-STUDENT DEBRIEF CARD =====================
   Renders into #student-debrief inside the full-page session-ended screen.
   Pulls from the data the student already subscribes to during the session:
     - allRooms (refLeaderboard) — every room's score, decisions, presence
     - myRoom, teamName — which row in allRooms is "ours"
     - myUniversity — for the "agreed with your country" framing
   Pure DOM build; idempotent (clears + repopulates on each call). */
function renderStudentDebrief() {
  const card = el("student-debrief");
  if (!card) return;
  card.innerHTML = "";
  card.classList.remove("hidden");

  const room = (myRoom && allRooms && allRooms[myRoom]) || null;
  const lang = _curLang();

  const title = document.createElement("h2");
  title.textContent = _debriefT("debrief.student.title");
  card.appendChild(title);

  if (!room) {
    const p = document.createElement("p");
    p.textContent = _debriefT("debrief.student.no-team");
    card.appendChild(p);
    return;
  }

  // 1. Score line — "Your team scored X points in N decisions"
  const bucket = _debriefBucket(room);
  const committed = (function () {
    const v = room.votes || {};
    let n = 0;
    Object.keys(v).forEach(k => {
      if (v[k] && v[k].committed && typeof v[k].committed.choice === "number") n++;
    });
    return n;
  })();
  const score = document.createElement("p");
  score.className = "sd-score";
  score.textContent = _debriefT("debrief.student.score") + " " + bucket.total +
    " " + _debriefT("debrief.student.score-suffix") +
    " · " + committed + " " + _debriefT("debrief.student.decisions-locked");
  card.appendChild(score);

  // 2. Decisions: which ones the team got "right" (chose the correct option),
  //    which to revisit (committed but incorrect, or never locked in).
  const agreed = [];
  const disagreed = [];
  if (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) {
    DECISIONS.forEach(d => {
      const v = (room.votes || {})[d.id] || {};
      const c = (v.committed && typeof v.committed.choice === "number")
        ? v.committed.choice : null;
      if (c == null) return;
      const opt = (d.options || [])[c];
      if (!opt) return;
      const short = tc(d.prompt, lang);
      const trimmed = short.length > 90 ? short.slice(0, 90).trim() + "…" : short;
      (opt.correct ? agreed : disagreed).push(trimmed);
    });
  }
  if (agreed.length) {
    const row = document.createElement("div");
    row.className = "sd-row";
    const h = document.createElement("strong");
    h.textContent = _debriefT("debrief.student.agreed");
    row.appendChild(h);
    const ul = document.createElement("ul");
    agreed.forEach(s => {
      const li = document.createElement("li"); li.textContent = s; ul.appendChild(li);
    });
    row.appendChild(ul);
    card.appendChild(row);
  }
  if (disagreed.length) {
    const row = document.createElement("div");
    row.className = "sd-row";
    const h = document.createElement("strong");
    h.textContent = _debriefT("debrief.student.disagreed");
    row.appendChild(h);
    const ul = document.createElement("ul");
    disagreed.forEach(s => {
      const li = document.createElement("li"); li.textContent = s; ul.appendChild(li);
    });
    row.appendChild(ul);
    card.appendChild(row);
  }

  // 3. Top concept the team hit + the concept they missed (most "interesting"
  //    miss = highest-point family not hit). Looks across moduleA + moduleB.
  if (typeof SCORING !== "undefined") {
    const autoEvents = (room.score && room.score.auto) || {};
    let topHit = null, topHitPts = -1;
    let topMiss = null, topMissPts = -1;
    ["moduleA", "moduleB"].forEach(mk => {
      const tag = mk === "moduleA" ? "A" : "B";
      ((SCORING && SCORING[mk]) || []).forEach(fam => {
        const evKey = "concept" + tag + "_" + fam.id;
        if (autoEvents[evKey]) {
          if ((fam.points || 0) > topHitPts) {
            topHit = tc(fam.label, lang); topHitPts = fam.points || 0;
          }
        } else {
          if ((fam.points || 0) > topMissPts) {
            topMiss = tc(fam.label, lang); topMissPts = fam.points || 0;
          }
        }
      });
    });
    if (topHit) {
      const row = document.createElement("div");
      row.className = "sd-row";
      const h = document.createElement("strong");
      h.textContent = _debriefT("debrief.student.top-concept");
      const p = document.createElement("div"); p.textContent = topHit + " (+" + topHitPts + ")";
      row.appendChild(h); row.appendChild(p);
      card.appendChild(row);
    }
    if (topMiss) {
      const row = document.createElement("div");
      row.className = "sd-row";
      const h = document.createElement("strong");
      h.textContent = _debriefT("debrief.student.missed-concept");
      const p = document.createElement("div"); p.textContent = topMiss;
      row.appendChild(h); row.appendChild(p);
      card.appendChild(row);
    }
  }

  // 4. "Most engaged moment" — we only have current-stage timing per room (no
  //    stage-history). Use the team's current stage + elapsed minutes as the
  //    best signal available; the closing line frames it warmly.
  const st = typeof room.stage === "number" ? room.stage : 0;
  const at = typeof room.stageAt === "number" ? room.stageAt : null;
  if (at) {
    const mins = Math.max(1, Math.round((Date.now() - at) / 60000));
    const row = document.createElement("div");
    row.className = "sd-row";
    const h = document.createElement("strong");
    h.textContent = _debriefT("debrief.student.engaged");
    const p = document.createElement("div");
    p.textContent = mins + " " + _debriefT("debrief.time.minutes") + " " +
      _debriefT("debrief.student.engaged-detail") + " " + stageLabel(st);
    row.appendChild(h); row.appendChild(p);
    card.appendChild(row);
  }

  // 5. Warm closing line
  const closing = document.createElement("p");
  closing.className = "sd-closing";
  closing.textContent = _debriefT("debrief.student.closing");
  card.appendChild(closing);
}
if (typeof window !== "undefined") {
  window.renderStudentDebrief = renderStudentDebrief;
}

/* paint the "session closed by facilitator" banner over the page for any
   participant in a closed session. Admins still see the dashboard so they can
   re-download the archive on demand. */
/* When an admin ends the session, every participant should be removed from
   the workshop UI immediately. They see a full-page "Thank you for taking
   part" screen instead of the lobby / waiting / room, so there is no way to
   keep writing answers, voting, etc. - the workshop has finished.
   Admins keep their dashboard (they may want to re-download the archive). */
function renderClosedState(closed) {
  const banner = el("closed-banner");
  const ended = el("session-ended");
  if (!banner || !ended) return;
  const isClosed = !!(closed && typeof closed === "object" && closed.at);
  const isAdminLike = !!(isRoomAdmin || role === "admin" || role === "superadmin");

  if (!isClosed) {
    banner.classList.add("hidden");
    ended.classList.add("hidden");
    document.body.classList.remove("session-closed", "session-ended-shown");
    return;
  }
  if (isAdminLike) {
    // admins keep their dashboard; the "Session closed ✓" button state already
    // tells them the session has been ended
    banner.classList.add("hidden");
    ended.classList.add("hidden");
    document.body.classList.remove("session-closed", "session-ended-shown");
    return;
  }

  // participant: replace the workshop UI with the full-page "session ended" screen
  document.body.classList.add("session-closed", "session-ended-shown");
  ["splash", "lobby", "waiting", "app"].forEach(id => {
    const n = el(id);
    if (n) n.classList.add("hidden");
  });
  banner.classList.add("hidden");                  // fallback - not needed when full screen shows
  ended.classList.remove("hidden");
  const by = el("session-ended-by");
  if (by) by.textContent = closed.by ? "Closed by " + closed.by + "." : "";

  // personalised per-student debrief — computed entirely from the data the
  // student already subscribes to (allRooms / answers / roomVotes / roomScore /
  // myRoom / teamName / myUniversity). No new schema. Best-effort: if the
  // student joined late and their room data is empty, falls back to a
  // simple "your contributions are saved" message.
  try { renderStudentDebrief(); }
  catch (e) { console.error("Student debrief render failed", e); }

  // wire the leave button once
  if (!ended.dataset.wired) {
    ended.dataset.wired = "1";
    const btn = el("session-ended-leave");
    if (btn) btn.addEventListener("click", () => {
      if (typeof leaveAndReload === "function") leaveAndReload();
      else { try { localStorage.removeItem("canamed_session"); } catch (e) {} location.reload(); }
    });
  }
}

/* Program-session rollup: a durable LOCAL record of each session the
   facilitator closes (kept across close, unlike the open-session reaper list),
   so the cross-session Program overview aggregates with no DB round-trips.
   Pseudonymous aggregate numbers only — never names or answers. */
const PROGRAM_SESSIONS_KEY = "canamed_program_sessions";
function recordProgramSession(summary) {
  if (!summary || !summary.code) return;
  try {
    let list = JSON.parse(localStorage.getItem(PROGRAM_SESSIONS_KEY)) || [];
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex(s => s && s.code === summary.code);
    if (i >= 0) list[i] = summary; else list.push(summary);
    localStorage.setItem(PROGRAM_SESSIONS_KEY, JSON.stringify(list.slice(-300)));
  } catch (e) { /* storage blocked — non-fatal */ }
}
function _sessionSummaryObj() {
  const m = (typeof _impactMetrics === "function") ? _impactMetrics() : {};
  return {
    code: (typeof sessionNum !== "undefined" && sessionNum) ? sessionNum : "",
    at: Date.now(),
    participants: m.present || 0,
    rooms: m.roomCount || 0,
    contribPct: (m.contribPct != null) ? m.contribPct : null,
    meanGini: (m.meanGini != null) ? Math.round(m.meanGini * 100) / 100 : null,
    decisionAccuracyPct: (m.decisionAccuracyPct != null) ? m.decisionAccuracyPct : null,
    answers: m.answers || 0,
    normGain: (m.gain && m.gain.meanNormGain != null) ? m.gain.meanNormGain : null,
    prePct: (m.gain && m.gain.meanPrePct != null) ? m.gain.meanPrePct : null,
    postPct: (m.gain && m.gain.meanPostPct != null) ? m.gain.meanPostPct : null,
    nPaired: (m.gain && m.gain.nPaired) ? m.gain.nPaired : 0,
    // Per-decision correct-rate for this session (id → %), so the cross-session
    // item-difficulty view can see which decisions consistently trip rooms up.
    decAcc: (m.decAgg || []).reduce(function (acc, d) {
      if (d.id && d.committedRooms > 0) acc[d.id] = Math.round((d.correctRooms / d.committedRooms) * 100);
      return acc;
    }, {})
  };
}

/* Lazy-load admin-tools.js (accreditation evidence, research export,
   attestations, program rollup), then invoke one of its exported functions.
   Keeps those heavy report generators off the splash critical path. */
function runAdminTool(fnName) {
  const call = () => {
    const fn = (window.CanamedAdminTools && window.CanamedAdminTools[fnName]) || window[fnName];
    if (typeof fn === "function") fn();
    else if (typeof toast === "function") toast("Report tool unavailable.");
  };
  const loader = window.CanamedLoader;
  if (loader && loader.ensureAdminTools) {
    if (typeof toast === "function") toast("⏳ Preparing…");
    loader.ensureAdminTools().then(call).catch(() => {
      if (typeof toast === "function") toast("Could not load the report tools — check your connection.");
    });
  } else {
    call();
  }
}

/* Pre→post knowledge gain across the cohort. Reads the per-participant test
   scores already in allRooms (rooms/<r>/tests/<cid>/{pre,post}/score), keyed
   by clientId; PRETEST/POSTTEST bank lengths give the maxima. Pairs a person's
   pre + post by cid (most students keep one tab; the stableId field supports
   stricter offline linkage). Reports mean pre%, mean post%, and Hake's
   normalized gain g = (post% − pre%) / (100 − pre%) — the standard
   education-research learning-gain metric. Aggregate; no names. */
function _knowledgeGain() {
  const rooms = (typeof _debriefRoomList === "function")
    ? _debriefRoomList()
    : roomNames(typeof roomCount !== "undefined" ? roomCount : 0).filter(r => allRooms[r] != null);
  const preMax = Array.isArray(window.PRETEST) ? window.PRETEST.length : 0;
  const postMax = Array.isArray(window.POSTTEST) ? window.POSTTEST.length : 0;
  let nPre = 0, nPost = 0, nPaired = 0, nGain = 0;
  let sumPre = 0, sumPost = 0, sumGain = 0;
  rooms.forEach(r => {
    const tests = (allRooms[r] || {}).tests || {};
    Object.keys(tests).forEach(cid => {
      const t = tests[cid] || {};
      const pre = t.pre, post = t.post;
      const preDone = pre && !pre.skipped && typeof pre.score === "number" && preMax > 0;
      const postDone = post && !post.skipped && typeof post.score === "number" && postMax > 0;
      if (preDone) nPre++;
      if (postDone) nPost++;
      if (preDone && postDone) {
        nPaired++;
        const prePct = (pre.score / preMax) * 100;
        const postPct = (post.score / postMax) * 100;
        sumPre += prePct; sumPost += postPct;
        if (prePct < 100) { sumGain += (postPct - prePct) / (100 - prePct); nGain++; }
      }
    });
  });
  return {
    preMax: preMax, postMax: postMax, nPre: nPre, nPost: nPost, nPaired: nPaired,
    meanPrePct: nPaired ? Math.round(sumPre / nPaired) : null,
    meanPostPct: nPaired ? Math.round(sumPost / nPaired) : null,
    meanNormGain: nGain ? Math.round((sumGain / nGain) * 100) / 100 : null
  };
}

/* ── Impact report ────────────────────────────────────────────────────────
   A one-click, dean-ready summary of the session, assembled CLIENT-SIDE from
   the data already live on the admin dashboard (allRooms). Opens as a
   self-contained, printable page (Save as PDF). Aggregate + pseudonymous: NO
   individual names — only counts, rates and balance measures. No new Firebase
   path. Built to drop straight into an accreditation dossier or partnership
   report: participation + equity, decision quality (a reasoning proxy),
   engagement, and a per-room appendix. */
function _impactMetrics() {
  const rooms = (typeof _debriefRoomList === "function")
    ? _debriefRoomList()
    : roomNames(roomCount).filter(r => allRooms[r] != null);
  let present = 0, contributing = 0, giniSum = 0, giniN = 0, unevenRooms = 0;
  let answers = 0, hypotheses = 0, decisionsCommitted = 0;
  const perRoom = [];

  rooms.forEach(r => {
    const d = allRooms[r] || {};
    const part = (typeof roomParticipation === "function")
      ? roomParticipation(d) : { present: 0, contributing: 0, gini: 0 };
    present += part.present || 0;
    contributing += part.contributing || 0;
    if ((part.present || 0) >= 3 && (part.contributing || 0) >= 2) {
      giniSum += part.gini || 0; giniN++;
    }
    if ((part.present || 0) >= 2 && (part.contributing || 0) < (part.present || 0)) unevenRooms++;

    const ans = d.answers || {};
    let roomAnswers = 0;
    ["moduleA", "moduleB"].forEach(mk => { roomAnswers += Object.keys(ans[mk] || {}).length; });
    answers += roomAnswers;
    hypotheses += Object.keys(d.hypotheses || {}).length;

    const votes = d.votes || {};
    let roomCommitted = 0;
    Object.keys(votes).forEach(id => {
      if (votes[id] && votes[id].committed && typeof votes[id].committed.choice === "number") {
        roomCommitted++;
      }
    });
    decisionsCommitted += roomCommitted;

    const score = (typeof _debriefBucket === "function") ? _debriefBucket(d).total : 0;
    perRoom.push({
      room: r, team: d.teamName || "",
      present: part.present || 0, contributing: part.contributing || 0,
      gini: part.gini || 0, answers: roomAnswers, committed: roomCommitted, score: score
    });
  });

  // Decision accuracy across rooms — a reasoning proxy: per DECISION, of the
  // rooms that locked an answer in, how many chose the safest (correct) option.
  const decAgg = [];
  const decList = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [];
  let totalCommitted = 0, totalCorrect = 0;
  decList.forEach(dec => {
    let committedRooms = 0, correctRooms = 0;
    rooms.forEach(r => {
      const v = ((allRooms[r] || {}).votes || {})[dec.id] || {};
      const c = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
      if (c == null) return;
      committedRooms++;
      const opt = (dec.options || [])[c];
      if (opt && opt.correct) correctRooms++;
    });
    if (committedRooms > 0) {
      decAgg.push({ id: dec.id, prompt: tc(dec.prompt, _curLang()), module: dec.module || "",
                    committedRooms: committedRooms, correctRooms: correctRooms });
      totalCommitted += committedRooms; totalCorrect += correctRooms;
    }
  });

  return {
    rooms: rooms, perRoom: perRoom, decAgg: decAgg,
    roomCount: rooms.length, present: present, contributing: contributing,
    contribPct: present ? Math.round((contributing / present) * 100) : 0,
    meanGini: giniN ? (giniSum / giniN) : null, unevenRooms: unevenRooms,
    answers: answers, hypotheses: hypotheses, decisionsCommitted: decisionsCommitted,
    decisionAccuracyPct: totalCommitted ? Math.round((totalCorrect / totalCommitted) * 100) : null,
    gain: _knowledgeGain()
  };
}

/* HTML-escape for values interpolated into the report document. The report is
   opened in a fresh window (no platform CSP), so we escape defensively even
   though the inputs are aggregate numbers + the session code. */
function _impactEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateImpactReport() {
  const m = _impactMetrics();
  const when = new Date();
  const giniTxt = m.meanGini == null ? "—"
    : m.meanGini.toFixed(2) + " (" +
      (m.meanGini < 0.2 ? "even" : m.meanGini < 0.4 ? "slightly uneven" : "uneven") + ")";
  const accTxt = m.decisionAccuracyPct == null ? "—" : m.decisionAccuracyPct + "%";
  const g = m.gain || {};
  const gainKpi = (g.meanNormGain == null) ? "—" : ("+" + g.meanNormGain.toFixed(2));

  const decRows = m.decAgg.map(d => {
    const pct = d.committedRooms ? Math.round((d.correctRooms / d.committedRooms) * 100) : 0;
    return "<tr><td>" + (d.module ? "[" + _impactEsc(d.module) + "] " : "") + _impactEsc(d.prompt) +
      "</td><td class='num'>" + d.correctRooms + "/" + d.committedRooms +
      "</td><td class='num'>" + pct + "%</td></tr>";
  }).join("");

  const roomRows = m.perRoom.map(r =>
    "<tr><td>" + _impactEsc(r.room) + (r.team ? " — " + _impactEsc(r.team) : "") +
    "</td><td class='num'>" + r.contributing + "/" + r.present +
    "</td><td class='num'>" + (r.present >= 3 && r.contributing >= 2 ? r.gini.toFixed(2) : "—") +
    "</td><td class='num'>" + r.answers + "</td><td class='num'>" + r.committed +
    "</td><td class='num'>" + r.score + "</td></tr>"
  ).join("");

  const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Session Impact Report</title><style>" +
"*{box-sizing:border-box}body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2733;max-width:900px;margin:0 auto;padding:32px 24px;background:#fff}" +
"h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px;border-bottom:2px solid #2563eb;padding-bottom:4px;color:#16335c}" +
".sub{color:#5b6b7b;margin:0 0 20px}.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}" +
".kpi{flex:1 1 150px;border:1px solid #e1e7ed;border-radius:10px;padding:12px 14px;background:#f7f9fb}" +
".kpi .v{font-size:1.6rem;font-weight:700;color:#16335c}.kpi .l{font-size:.8rem;color:#5b6b7b}" +
"table{width:100%;border-collapse:collapse;margin:8px 0;font-size:.92rem}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e8edf2}" +
"th{background:#f0f4f8;color:#16335c}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}" +
".note{font-size:.85rem;color:#5b6b7b;background:#f7f9fb;border-left:3px solid #2563eb;padding:10px 12px;border-radius:6px;margin:10px 0}" +
".foot{margin-top:28px;font-size:.8rem;color:#7a8694;border-top:1px solid #e8edf2;padding-top:12px}" +
"@media print{.noprint{display:none}body{padding:0}}" +
".pbtn{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:.95rem;cursor:pointer}" +
"</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>🖨 Print / Save as PDF</button>" +
"<h1>CANAMED — Session Impact Report</h1>" +
"<p class='sub'>Session <strong>" + _impactEsc(typeof sessionNum !== "undefined" ? sessionNum : "—") +
"</strong> · generated " + _impactEsc(when.toLocaleString()) + "</p>" +

"<h2>At a glance</h2><div class='kpis'>" +
"<div class='kpi'><div class='v'>" + m.present + "</div><div class='l'>participants present</div></div>" +
"<div class='kpi'><div class='v'>" + m.roomCount + "</div><div class='l'>active rooms</div></div>" +
"<div class='kpi'><div class='v'>" + m.contribPct + "%</div><div class='l'>actively contributing</div></div>" +
"<div class='kpi'><div class='v'>" + accTxt + "</div><div class='l'>decisions reached the safest answer</div></div>" +
"<div class='kpi'><div class='v'>" + gainKpi + "</div><div class='l'>knowledge gain (pre→post, g)</div></div>" +
"</div>" +

"<h2>Knowledge gain (pre → post)</h2>" +
(g.nPaired
  ? "<p>Among the <strong>" + g.nPaired + "</strong> participant(s) who completed BOTH the pre- and post-test, " +
    "mean score rose from <strong>" + (g.meanPrePct == null ? "—" : g.meanPrePct + "%") + "</strong> to <strong>" +
    (g.meanPostPct == null ? "—" : g.meanPostPct + "%") + "</strong>" +
    (g.meanNormGain == null ? "" : ", a normalized learning gain of <strong>g = " + g.meanNormGain.toFixed(2) +
      "</strong> (Hake's g; 0 = no gain, 1 = closed the whole gap)") + ". " +
    "(" + g.nPre + " pre-tests, " + g.nPost + " post-tests completed.)</p>" +
    "<p class='note'>Normalized gain is the standard education-research learning-outcome metric — the headline " +
    "evidence that the session <em>taught</em>, not just engaged. Pre↔post are paired per participant.</p>"
  : "<p>No paired pre/post tests are complete yet — the gain fills in once participants finish both tests. " +
    "(" + (g.nPre || 0) + " pre, " + (g.nPost || 0) + " post completed.)</p>") +

"<h2>Participation &amp; equity</h2>" +
"<p>" + m.contributing + " of " + m.present + " present participants actively contributed (" +
m.contribPct + "%). Mean contribution balance (Gini) across rooms with enough activity to measure: <strong>" +
giniTxt + "</strong> — 0 is perfectly even, 1 is one person carrying the room. " +
m.unevenRooms + " room(s) flagged as uneven for facilitator follow-up.</p>" +
"<p class='note'>Equity is a first-class outcome of this design: the platform measures whether <em>every</em> student engages, not just the average — directly relevant to inclusive-teaching and the cross-cultural (Caen × Nagoya) cohort.</p>" +

"<h2>Decision quality (clinical-reasoning proxy)</h2>" +
(decRows ? "<table><thead><tr><th>Team decision</th><th class='num'>safest</th><th class='num'>%</th></tr></thead><tbody>" +
  decRows + "</tbody></table>" +
  "<p>Across all committed team decisions, <strong>" + accTxt +
  "</strong> reached the safest option. These are deliberate, discussed choices on hard communication/ethics calls — a reasoning signal, not recall.</p>"
  : "<p>No team decisions were locked in yet.</p>") +

"<h2>Engagement</h2><div class='kpis'>" +
"<div class='kpi'><div class='v'>" + m.answers + "</div><div class='l'>group answers contributed</div></div>" +
"<div class='kpi'><div class='v'>" + m.hypotheses + "</div><div class='l'>working hypotheses</div></div>" +
"<div class='kpi'><div class='v'>" + m.decisionsCommitted + "</div><div class='l'>team decisions committed</div></div>" +
"</div>" +

"<h2>Per-room appendix</h2>" +
(roomRows ? "<table><thead><tr><th>Room</th><th class='num'>contributing</th><th class='num'>balance</th>" +
  "<th class='num'>answers</th><th class='num'>decisions</th><th class='num'>score</th></tr></thead><tbody>" +
  roomRows + "</tbody></table>" : "<p>No room activity recorded.</p>") +

"<div class='foot'><p><strong>Methodology &amp; privacy.</strong> Figures are computed client-side from this " +
"session's live data and are <strong>aggregate and pseudonymous</strong> — no individual is named. " +
"Decision accuracy counts a room's <em>committed</em> choice against the clinically-safest option defined " +
"in the case. Satisfaction and knowledge gain (pre/post) are captured separately via the session " +
"questionnaire and pre/post tests. This report is intended as supporting evidence of communication-skills " +
"teaching activity and student engagement.</p></div>" +
"</body></html>";

  // Open in a new window (user-gesture, so not popup-blocked). Fall back to a
  // downloadable .html file if the browser blocks the popup.
  let w = null;
  try { w = window.open("", "_blank"); } catch (e) { /* blocked */ }
  if (w && w.document) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } else {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CANAMED_Session" + (typeof sessionNum !== "undefined" ? sessionNum : "") + "_impact_report.html";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  if (typeof toast === "function") toast("📊 Impact report generated.");
}

function downloadAllAnswers() {
  // these are named opinions on sensitive medical-ethics topics - let the prof
  // export them pseudonymised (Student A, Student B...) per room when sharing
  const anon = !!(el("anon-export") && el("anon-export").checked);
  const lines = [];
  lines.push("CaNaMED Session " + sessionNum + " - Group Answers");
  lines.push("Exported: " + new Date().toLocaleString());
  if (anon) lines.push("(names pseudonymised per room)");
  lines.push("");
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const ans = data.answers || {};
    const aliasMap = {};
    let aliasN = 0;
    const labelFor = nm => {
      if (!anon) return nm;
      if (!(nm in aliasMap)) {
        const letter = String.fromCharCode(65 + (aliasN % 26));
        const suffix = aliasN >= 26 ? String(Math.floor(aliasN / 26) + 1) : "";
        aliasMap[nm] = "Student " + letter + suffix;
        aliasN++;
      }
      return aliasMap[nm];
    };
    lines.push("======================================");
    lines.push(r + "   (reached: " + STAGE_LABELS[st] + ")");
    lines.push("======================================");
    ["moduleA", "moduleB"].forEach(mk => {
      lines.push(mk === "moduleA"
        ? "-- Module A: Chronic Pain --" : "-- Module B: Breaking Bad News --");
      const entries = entriesSorted(ans[mk]);
      if (entries.length === 0) lines.push("(no points recorded)");
      else entries.forEach(e => lines.push("- [" + labelFor(e.by) +
        (e.university ? " / " + e.university : "") + "] " + e.text));
      lines.push("");
    });
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "CaNaMED_Session" + sessionNum +
    (anon ? "_group_answers_pseudonymised.txt" : "_group_answers.txt");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* Markdown variant of downloadAllAnswers — sim 2026-05-19 feature for
 * the `writes_lots` / `methodical` / `checks_evidence` personas who
 * want a revision-friendly export. Same payload + pseudonymisation
 * toggle as the .txt version; structure mirrors the .txt one with
 * markdown headings (room = h2, module = h3) and bulleted answers. */
function downloadAllAnswersMarkdown() {
  const anon = !!(el("anon-export") && el("anon-export").checked);
  const lines = [];
  lines.push("# CaNaMED Session " + sessionNum + " — Group Answers");
  lines.push("");
  lines.push("- **Exported:** " + new Date().toLocaleString());
  if (anon) lines.push("- _Names pseudonymised per room (Student A, B, …)._");
  lines.push("");
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const ans = data.answers || {};
    const aliasMap = {};
    let aliasN = 0;
    const labelFor = nm => {
      if (!anon) return nm;
      if (!(nm in aliasMap)) {
        const letter = String.fromCharCode(65 + (aliasN % 26));
        const suffix = aliasN >= 26 ? String(Math.floor(aliasN / 26) + 1) : "";
        aliasMap[nm] = "Student " + letter + suffix;
        aliasN++;
      }
      return aliasMap[nm];
    };
    lines.push("## " + r + " — reached " + STAGE_LABELS[st]);
    lines.push("");
    ["moduleA", "moduleB"].forEach(mk => {
      lines.push("### " + (mk === "moduleA"
        ? "Module A — Chronic Pain"
        : "Module B — Breaking Bad News"));
      const entries = entriesSorted(ans[mk]);
      if (entries.length === 0) lines.push("_(no points recorded)_");
      else entries.forEach(e => lines.push("- **" + labelFor(e.by) +
        (e.university ? " / " + e.university : "") + ":** " +
        // escape markdown-sensitive chars in user-typed content
        String(e.text || "").replace(/([*_`#|])/g, "\\$1")));
      lines.push("");
    });
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "CaNaMED_Session" + sessionNum +
    (anon ? "_group_answers_pseudonymised.md" : "_group_answers.md");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* Escape the markdown control chars (incl. the table pipe) so a free-text
   answer can never break the document structure. */
function _mdEsc(s) {
  return String(s == null ? "" : s).replace(/([*_`#|\[\]])/g, "\\$1");
}
/* Resolve a revealed item id ("history:2", "exam:0", "labs:0") back to the
   case content (button label + result text) in the active language, so the
   student's takeaway carries the actual clinical information, not just ids. */
function _caseItemById(itemId, lang) {
  const m = /^([a-zA-Z]+):(\d+)$/.exec(itemId || "");
  if (!m) return null;
  const group = (typeof CASE !== "undefined" && CASE) ? CASE[m[1]] : null;
  const item = Array.isArray(group) ? group[parseInt(m[2], 10)] : null;
  if (!item) return null;
  return { q: tc(item.q, lang), a: tc(item.a, lang) };
}

/* Student-facing end-of-session takeaway. Round-4 began as a plain group-answer
 * dump; the dry-run (2026-05-26) asked for the FULL record a student can revise
 * from: the clinical information the team gathered (historical context), the
 * discussion guidelines, the team's committed decisions + teaching points, the
 * student's OWN responses (answers / hypotheses / votes), the whole group's
 * answers, and the recap. Exports ONLY the participant's own room as Markdown,
 * read fresh from the room subtree (the student is a member, so the read is
 * allowed). Distinct from the admin export above, which dumps every room. */
function downloadMyRoomAnswers() {
  if (!db || !myRoom) return;
  db.ref(sPath("rooms/" + myRoom)).once("value").then(snap => {
    const data = snap.val() || {};
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    const ans = data.answers || {};
    const reveals = (data.moduleA || {}).revealed || {};
    const hyps = (data.moduleA || {}).hypotheses || data.hypotheses || {};
    const votes = data.votes || {};
    const me = (typeof myName === "string" && myName) ? myName : "";
    const decList = []
      .concat((typeof window !== "undefined" && Array.isArray(window.DECISIONS)) ? window.DECISIONS
        : (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [])
      .concat((typeof DECISIONS_B !== "undefined" && Array.isArray(DECISIONS_B)) ? DECISIONS_B : []);
    const decById = {};
    decList.forEach(d => { if (d && d.id) decById[d.id] = d; });
    const decPrompt = (dec, id) => _mdEsc(dec && dec.prompt ? tc(dec.prompt, lang) : id);

    const lines = [];
    lines.push("# CaNaMED — my session takeaway");
    lines.push("");
    lines.push("- **Session:** " + _mdEsc(sessionNum));
    lines.push("- **Room / team:** " + _mdEsc(myRoom) + (data.teamName ? " — " + _mdEsc(data.teamName) : ""));
    if (me) lines.push("- **Name:** " + _mdEsc(me));
    lines.push("- **Exported:** " + new Date().toLocaleString());
    lines.push("");

    // 1. Historical context — the clinical information the team gathered, in
    //    the order it was opened.
    lines.push("## The case — clinical information gathered");
    const revealSeq = Object.keys(reveals)
      .map(id => ({ id: id, by: (reveals[id] || {}).by || "", at: (reveals[id] || {}).at || 0 }))
      .sort((a, b) => a.at - b.at);
    if (!revealSeq.length) {
      lines.push("_(nothing was opened)_");
    } else {
      revealSeq.forEach((e, i) => {
        const it = _caseItemById(e.id, lang);
        if (it) lines.push("- **" + (i + 1) + ". " + _mdEsc(it.q) + "** — " + _mdEsc(it.a) +
          (e.by ? "  _(opened by " + _mdEsc(e.by) + ")_" : ""));
      });
    }
    lines.push("");

    // 2. Discussion guidelines — the prompts that framed the debate.
    const prompts = (typeof CASE !== "undefined" && CASE && Array.isArray(CASE.prompts)) ? CASE.prompts : [];
    if (prompts.length) {
      lines.push("## Discussion guidelines");
      prompts.forEach(p => lines.push("- " + _mdEsc(tc(p, lang))));
      lines.push("");
    }

    // 3. The team's committed decisions (group common responses) + teaching points.
    const decIds = Object.keys(votes);
    if (decIds.length) {
      lines.push("## Your team's decisions");
      lines.push("");
      lines.push("| Decision | Team's choice | Safest? |");
      lines.push("| --- | --- | --- |");
      decIds.forEach(decId => {
        const dec = decById[decId] || {};
        const v = votes[decId] || {};
        const ci = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
        const opt = (ci != null && dec.options) ? dec.options[ci] : null;
        lines.push("| " + decPrompt(dec, decId) + " | " + _mdEsc(opt ? tc(opt.text, lang) : "—") +
          " | " + (opt ? (opt.correct ? "yes" : "no") : "—") + " |");
      });
      lines.push("");
      const teaching = [];
      decIds.forEach(decId => {
        const dec = decById[decId] || {};
        const v = votes[decId] || {};
        const ci = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
        const opt = (ci != null && dec.options) ? dec.options[ci] : null;
        const why = (opt && opt.why) ? tc(opt.why, lang) : (dec.why ? tc(dec.why, lang) : "");
        if (why) teaching.push("- **" + decPrompt(dec, decId) + ":** " + _mdEsc(why));
      });
      if (teaching.length) { lines.push("### Teaching points"); teaching.forEach(t => lines.push(t)); lines.push(""); }
    }

    // 4. The student's OWN responses.
    lines.push("## My responses");
    let mineAny = false;
    [["moduleA", "Module A"], ["moduleB", "Module B"]].forEach(pair => {
      const mine = entriesSorted(ans[pair[0]]).filter(e => e.cid === clientId);
      if (mine.length) {
        mineAny = true;
        lines.push("### " + pair[1] + " — my answers");
        mine.forEach(e => lines.push("- " + _mdEsc(e.text)));
      }
    });
    const myHyps = Object.keys(hyps).map(k => hyps[k]).filter(h => h && h.cid === clientId);
    if (myHyps.length) {
      mineAny = true;
      lines.push("### My hypotheses");
      myHyps.forEach(h => lines.push("- " + _mdEsc(h.text)));
    }
    const myVotes = [];
    decIds.forEach(decId => {
      const dec = decById[decId] || {};
      const b = ((votes[decId] || {}).ballots || {})[clientId];
      if (b && typeof b.choice === "number" && dec.options) {
        const opt = dec.options[b.choice];
        myVotes.push("- **" + decPrompt(dec, decId) + ":** " + _mdEsc(opt ? tc(opt.text, lang) : "?") +
          (opt && opt.correct ? " (safest)" : ""));
      }
    });
    if (myVotes.length) { mineAny = true; lines.push("### My votes"); myVotes.forEach(l => lines.push(l)); }
    if (!mineAny) lines.push("_(no individual responses recorded)_");
    lines.push("");

    // 5. The whole group's answers (everyone in the room).
    lines.push("## Group answers (everyone in the room)");
    [["moduleA", "Module A"], ["moduleB", "Module B"]].forEach(pair => {
      lines.push("### " + pair[1]);
      const entries = entriesSorted(ans[pair[0]]);
      if (!entries.length) lines.push("_(no points recorded)_");
      else entries.forEach(e => lines.push("- **" + _mdEsc(e.by || "?") +
        (e.university ? " / " + _mdEsc(e.university) : "") + ":** " + _mdEsc(e.text)));
      lines.push("");
    });

    // 6. Recap — the team's score, what went well, what to remember.
    lines.push("## Recap");
    try {
      const sc = data.score || (typeof roomScore !== "undefined" ? roomScore : null) || {};
      lines.push("- **Team score:** " + scoreTotal({ score: sc }) + " points");
      const wins = Object.keys(sc.auto || {}).map(scoreEventMeta)
        .filter(m => m && m.tier !== "micro").map(m => m.title);
      if (wins.length) { lines.push("- **What your team did well:**"); wins.forEach(w => lines.push("  - " + _mdEsc(w))); }
      const lessons = Object.keys(sc.penalties || {}).map(penaltyMeta).filter(Boolean);
      if (lessons.length) {
        lines.push("- **Worth remembering for next time:**");
        lessons.forEach(m => lines.push("  - " + _mdEsc(m.title) + (m.why ? " — " + _mdEsc(m.why) : "")));
      }
    } catch (_) { /* recap is best-effort — never block the download */ }
    lines.push("");

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CaNaMED_" + myRoom + "_my-takeaway.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(e => { try { console.warn("room export failed", e); } catch (_) {} });
}

/* ===================== ROOM VIEW: STAGE & NAVIGATION ===================== */
/* Late-join banner. R3-C1 fix: every visible string flows through tFallback()
   so a Japanese / French / German late-joiner sees a localised message at the
   exact moment the platform is most disorienting. stageLabel(stage) already
   handles per-language stage names — re-using it keeps the banner consistent
   with the rest of the chrome. */
function showLateBanner(stage) {
  const b = el("late-banner");
  b.innerHTML = "";
  const txt = document.createElement("span");
  const tmpl = tFallback("waiting.late-join.banner",
    "You joined while your room is already on “{stage}”. Earlier stages " +
    "happened before you arrived — use “← Review previous stage” at any " +
    "time to read them.  ");
  txt.textContent = tmpl.replace("{stage}", stageLabel(stage));
  const dismiss = document.createElement("button");
  dismiss.textContent = tFallback("waiting.late-join.dismiss", "Got it");
  dismiss.addEventListener("click", () => b.classList.add("hidden"));
  b.appendChild(txt); b.appendChild(dismiss);
  b.classList.remove("hidden");
}

/* one short, plain-language "do this now" line per stage - the single biggest
   help for a stressed second-language student who has lost the thread */
const STAGE_NOW = [
  "Watch the opening presentation together. While you wait, name your team below.",
  "Work the case up: ask, examine, investigate — then debate the prompts and write your four answers together.",
  "Run the breaking-bad-news roleplay in your group, then write your three answers together.",
  "You're finished — open the questionnaire below. Thank you for taking part!"
];
function renderStage() {
  for (let i = 0; i < STAGE_COUNT; i++) {
    const s = el("stage-" + i);
    if (s) s.classList.toggle("hidden", i !== viewStage);
  }
  if (viewStage === STAGE_COUNT - 1) renderWrapupSummary();
  // in-platform pre-test (Welcome) and post-test (Wrap-up) — both optional
  // and per-scenario. Render functions are no-ops when the scenario does
  // not ship a question bank or when the user is an admin viewing a room.
  if (viewStage === 0) renderPreTest();
  if (viewStage === STAGE_COUNT - 1) renderPostTest();
  if (viewStage === STAGE_COUNT - 1) renderSurvey();
  renderObjectives();   // the objectives panel tracks the module the room is on
  renderDecisions();    // the team-decision cards for Module A and Module B
  // per-stage "chapter" accent + the "do this now" line
  const rm = el("room-main");
  if (rm) rm.dataset.stage = String(viewStage);
  const now = el("stage-now");
  if (now) {
    now.textContent = isRoomAdmin
      ? ""
      : (viewStage < roomStage ? "" : (STAGE_NOW[viewStage] || ""));
  }
  el("stage-indicator").textContent =
    "Stage " + (viewStage + 1) + " of " + STAGE_COUNT + " · " + stageLabel(viewStage);
  // the leaderboard auto-opens at the milestones (Welcome and Wrap-up)
  const lb = el("leaderboard-card");
  if (lb && (viewStage === 0 || viewStage === STAGE_COUNT - 1)) lb.open = true;
  // a celebration when the room reaches the wrap-up (once)
  if (!wrapCelebrated && roomStage === STAGE_COUNT - 1 && viewStage === STAGE_COUNT - 1) {
    wrapCelebrated = true;
    burst();
    toast("Great work today — thank you for taking part! 🎌");
  }
  // Sim 2026-05-19 (Camille, first-timer): 3-step Module A walkthrough
  // the first time a participant lands on stage 1. Skip-able via the
  // tour overlay's Esc / Skip control. Idempotent — fires once per
  // browser per session via the localStorage marker handled by
  // CanamedTour. Admins-in-a-room are skipped (they have their own tour).
  if (!isRoomAdmin && viewStage === 1 && window.CanamedTour &&
      !window.CanamedTour.isDone("studentModA")) {
    setTimeout(() => {
      try {
        if (!window.CanamedTour.isDone("studentModA")) {
          window.CanamedTour.start("studentModA");
        }
      } catch (e) { /* tour module missing — non-fatal */ }
    }, 500);
  }
  // Auto-dismiss any stage-specific tour when the room advances past
  // its stage. Sim 2026-05-19 (Marie/Room 5, Sara/Room 1) caught the
  // studentModA overlay still pinned to the wrap-up screen because the
  // student hadn't finished clicking through it before the admin
  // Advanced. Without this guard the tour bubble blocks the wrap-up
  // content + its anchors (chart-section-history etc.) are gone, so
  // the bubble misaligns over an empty area.
  if (window.CanamedTour && typeof window.CanamedTour.activeSet === "function") {
    const activeSet = window.CanamedTour.activeSet();
    // Map of stage-bound tour sets → the stage they belong on.
    const TOUR_STAGE = { student: 0, studentModA: 1 };
    if (activeSet && TOUR_STAGE.hasOwnProperty(activeSet) &&
        TOUR_STAGE[activeSet] !== viewStage) {
      try { window.CanamedTour.dismiss(); } catch (e) {}
    }
  }
  const wait = el("stage-wait");
  if (isRoomAdmin) {
    el("prev-btn").textContent = "← Move room back";
    el("next-btn").textContent = "Advance room →";
    el("prev-btn").classList.remove("hidden");
    el("next-btn").classList.remove("hidden");
    el("prev-btn").disabled = roomStage === 0;
    el("next-btn").disabled = roomStage >= STAGE_COUNT - 1;
    wait.textContent = "Admin view of " + myRoom +
      " - Back / Advance move the whole room's stage.";
  } else {
    el("prev-btn").textContent = "← Review previous stage";
    el("next-btn").textContent = "Return to current stage →";
    el("prev-btn").classList.remove("hidden");
    el("prev-btn").disabled = viewStage === 0;
    // Students never move the room forward - only show Next to return after Back.
    el("next-btn").classList.toggle("hidden", viewStage >= roomStage);
    if (viewStage < roomStage) {
      wait.textContent = "You are looking back at an earlier stage. " +
        "Press \"Return to current stage\" to come back.";
    } else if (roomStage < STAGE_COUNT - 1) {
      wait.textContent = "Waiting for a facilitator to open the next stage.";
    } else {
      wait.textContent = "This is the last stage - you are all caught up. " +
        "Thank you for taking part!";
    }
  }
}
function initStageNav() {
  el("prev-btn").addEventListener("click", () => {
    if (isRoomAdmin) setRoomStage(myRoom, roomStage, roomStage - 1);
    else { viewStage = Math.max(0, viewStage - 1); renderStage(); }
  });
  el("next-btn").addEventListener("click", () => {
    if (isRoomAdmin) setRoomStage(myRoom, roomStage, roomStage + 1);
    else { viewStage = Math.min(roomStage, viewStage + 1); renderStage(); }
  });
}

/* ===================== ROOM VIEW: CALL A PROF ===================== */
// Client-side throttle. The DB rule enforces a 30s minimum between
// successive help-calls when the previous one is still un-ack'd, but a
// student can cancel-then-recall to bypass it. This guard prevents that:
// once a call has been raised OR cancelled, no new call is allowed for
// HELP_CALL_THROTTLE_MS from the local clock. Server-side rule still
// applies as a second layer of defence.
const HELP_CALL_THROTTLE_MS = 30000;
let lastHelpCallAt = 0;
function initCallProf() {
  el("call-prof-btn").addEventListener("click", () => {
    if (!refCallForHelp) return;
    if (isRoomAdmin) { refCallForHelp.remove(); return; }   // admin: resolve the call
    if (callForHelp && callForHelp.ack) {
      // a prof acknowledged but the room still needs help - raise a fresh call
      const now = Date.now();
      if (now < lastHelpCallAt + HELP_CALL_THROTTLE_MS) {
        const wait = Math.ceil((lastHelpCallAt + HELP_CALL_THROTTLE_MS - now) / 1000);
        const msg = tFallback("room.call.throttle-recall",
          "Please wait {seconds}s before re-calling a facilitator.")
          .replace("{seconds}", wait);
        alert(msg);
        return;
      }
      lastHelpCallAt = now;
      refCallForHelp.set({ by: myName, at: now });
      logEvent(myRoom, "help", { msg: "" });
    } else if (callForHelp) {
      // cancel a pending (un-acked) call — record the cancel time as the
      // throttle anchor so a quick cancel-then-recall is throttled too
      lastHelpCallAt = Date.now();
      refCallForHelp.remove();
    } else {
      const now = Date.now();
      if (now < lastHelpCallAt + HELP_CALL_THROTTLE_MS) {
        const wait = Math.ceil((lastHelpCallAt + HELP_CALL_THROTTLE_MS - now) / 1000);
        const msg = tFallback("room.call.throttle-again",
          "Please wait {seconds}s before calling a facilitator again.")
          .replace("{seconds}", wait);
        alert(msg);
        return;
      }
      lastHelpCallAt = now;
      refCallForHelp.set({ by: myName, at: now });
      logEvent(myRoom, "help", { msg: "" });
    }
  });
}
function renderCallProf() {
  const btn = el("call-prof-btn");
  if (isRoomAdmin) {
    if (callForHelp) {
      btn.classList.remove("hidden");
      btn.textContent = "Resolve call (clear the alert)";
      btn.classList.add("pending");
    } else {
      btn.classList.add("hidden");
    }
    return;
  }
  // a11y: track the previous state so we only announce real transitions
  // (not the noop re-render on every snapshot). The button's label changes,
  // which most screen readers will NOT re-announce — write to the polite
  // live region so a participant who pressed "Call" knows it landed.
  const prev = btn.dataset.callState || "idle";
  let next, label;
  if (!callForHelp) {
    next = "idle";
    label = "Call a facilitator";
    btn.classList.remove("pending");
  } else if (callForHelp.ack) {
    next = "ack";
    label = "A facilitator is coming ✓ (tap to call again)";
    btn.classList.add("pending");
  } else {
    next = "pending";
    label = "Facilitator called ✓ (tap to cancel)";
    btn.classList.add("pending");
  }
  btn.textContent = label;
  btn.dataset.callState = next;
  if (prev !== next) {
    const announcer = el("a11y-stage-announce");
    if (announcer) {
      if (next === "pending") announcer.textContent = "Facilitator called. Waiting for acknowledgement.";
      else if (next === "ack") announcer.textContent = "A facilitator is on the way.";
      else if (next === "idle" && prev !== "idle") announcer.textContent = "Facilitator call cleared.";
    }
  }
}

/* ===================== ROOM VIEW: INTERACTIVE CASE ===================== */
/* Seeded shuffle helpers for the case-action button display order.
 * User request (2026-05-18): "the ask the patients, examination,
 * investigations sections button must be in a random order. Not always
 * the same one." Goal: prevent students from memorising a fixed
 * sequence (or copying "what to click" verbatim from a previous
 * cohort). Constraints:
 *   - All teammates in the SAME ROOM must see the SAME order so
 *     discussion ("let's tap the third one") stays coherent.
 *   - Reloading the page must give the same order (so a student
 *     mid-conversation doesn't lose their cursor position).
 *   - The underlying item IDs (group:index) MUST NOT change, because
 *     they key Firebase writes that other teammates already saw.
 *
 * Solution: deterministic seeded shuffle of the DISPLAY ORDER only.
 * Seed = sessionNum + room + group. Same room + same session always
 * yields the same order; different rooms / different sessions get
 * different orders. IDs stay tied to the original CASE[group][i]
 * indexes so refRevealed entries remain consistent. */
function _csHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}
function _csRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _seededShuffleIndexes(n, seedStr) {
  const a = []; for (let i = 0; i < n; i++) a.push(i);
  const rand = _csRng(_csHash(seedStr));
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
// Expose for E2E tests so they can verify the shuffle directly without
// having to override script-scoped sessionNum/myRoom (which `let` keeps
// out of reach of window.X assignments).
if (typeof window !== "undefined") {
  window._seededShuffleIndexes = _seededShuffleIndexes;
}

// History sub-grouping: the History chart-section is `open` by default and
// holds the most buttons (~11), so on entry it dominates the ~22-button
// "wall" the round4-a11y review flagged as a cognitive-accessibility
// blocker for the A2/B1 cohort. We keep ALL buttons reachable and DON'T
// touch the shuffle or item IDs; we just split the rendered list into a
// short visible cluster ("First questions") plus a labelled, collapsed
// <details> sub-group ("More questions to ask") so fewer prompts hit the
// screen at once. Only applied to `history` (the dense group); exam/labs
// stay flat. Threshold chosen so the always-visible count stays small.
const HISTORY_VISIBLE_COUNT = 4;

function _makeReqBtn(group, i) {
  const item = CASE[group][i];
  const id = group + ":" + i;   // ← ORIGINAL index, not the shuffled position
  const btn = document.createElement("button");
  btn.className = "req-btn" + (item.key ? " key-btn" : "");
  btn.dataset.id = id;
  // item.q is a translatable { en, fr, ja } in the default content, but
  // tc() also passes plain strings through (back-compat for custom JSON).
  btn.textContent = tc(item.q, _curLang());
  _annotateButtonWithGlossary(btn);
  btn.addEventListener("click", () => reveal(id));
  return btn;
}

function buildButtons() {
  ["history", "exam", "labs"].forEach(group => {
    const container = el("group-" + group);
    container.innerHTML = "";
    // Per-room+session deterministic shuffle of display order.
    // Seed components: sessionNum (cohort) + myRoom (so different rooms
    // in the same session don't share an order) + group (so the three
    // sections are shuffled independently).
    const seedStr = (sessionNum || "default") + ":" +
                    (myRoom || "lobby") + ":" + group;
    const order = _seededShuffleIndexes(CASE[group].length, seedStr);

    // Dense History group → sub-cluster the overflow into a collapsed,
    // labelled <details> so the at-once count drops without removing
    // any option (round4-a11y Rec 4).
    if (group === "history" && order.length > HISTORY_VISIBLE_COUNT + 1) {
      const _t = (key, fallback) => {
        if (typeof window !== "undefined" && typeof window.t === "function") {
          const v = window.t(key);
          if (v && v !== key) return v;
        }
        return fallback;
      };
      const primary = document.createElement("div");
      primary.className = "history-sub history-sub-primary";
      primary.setAttribute("role", "group");
      primary.setAttribute("aria-label",
        _t("modA.history.sub.primary", "First questions to ask"));
      order.slice(0, HISTORY_VISIBLE_COUNT)
        .forEach(i => primary.appendChild(_makeReqBtn(group, i)));
      container.appendChild(primary);

      const more = document.createElement("details");
      more.className = "history-sub history-sub-more";
      const summary = document.createElement("summary");
      summary.className = "history-sub-summary";
      summary.textContent = _t("modA.history.sub.more", "More questions to ask");
      more.appendChild(summary);
      const moreGroup = document.createElement("div");
      moreGroup.className = "btn-group";
      moreGroup.setAttribute("role", "group");
      moreGroup.setAttribute("aria-label",
        _t("modA.history.sub.more", "More questions to ask"));
      order.slice(HISTORY_VISIBLE_COUNT)
        .forEach(i => moreGroup.appendChild(_makeReqBtn(group, i)));
      more.appendChild(moreGroup);
      container.appendChild(more);
      return;
    }

    order.forEach(i => container.appendChild(_makeReqBtn(group, i)));
  });
}

/* Attach a multi-line `title` tooltip to a case-content button when
 * the button text contains any glossed clinical term. Browsers render
 * `title` natively (hover on desktop, long-press on mobile), so this
 * needs no extra CSS / JS frameworks. Sim 2026-05-19 feature for the
 * A2-English Japanese students. */
function _annotateButtonWithGlossary(btn) {
  if (!btn || !btn.textContent) return;
  const gloss = (typeof window !== "undefined") && window.CANAMED_GLOSSARY;
  if (!gloss) return;
  const txt = btn.textContent.toLowerCase();
  const hits = [];
  Object.keys(gloss).forEach(term => {
    if (txt.indexOf(term) !== -1) {
      const g = gloss[term];
      hits.push("• " + term + " — " + g.en + " / " + g.ja);
    }
  });
  if (hits.length) {
    const glossText = hits.slice(0, 3).join("\n");
    // First-hit only if there are many — keep the tooltip readable.
    // `title` is the mouse-hover affordance (round4-a11y Rec 5: hover-only,
    // invisible to keyboard + touch + SR). Add a NON-title accessible hook
    // so the gloss is reachable without a mouse:
    //  1. aria-description carries the same gloss into the accessible name
    //     computation, so a SR announces it on focus (no hover needed).
    //  2. a visible 📖 marker (with its own accessible label) tells sighted
    //     keyboard/touch users a definition exists. The marker is appended
    //     as a child <span>; the button label text stays first so the
    //     primary action name is unchanged.
    btn.title = glossText;
    btn.setAttribute("aria-description", glossText);
    btn.classList.add("has-glossary");
    if (!btn.querySelector(".glossary-marker")) {
      const mark = document.createElement("span");
      mark.className = "glossary-marker";
      mark.textContent = "📖";
      // Accessible name for the marker glyph (the gloss itself lives in
      // aria-description on the button); keep it short + translatable.
      const markLabel = (typeof window !== "undefined" && typeof window.t === "function"
        && window.t("modA.glossary.marker-label") !== "modA.glossary.marker-label")
        ? window.t("modA.glossary.marker-label")
        : "has a plain-language definition";
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", markLabel);
      btn.appendChild(document.createTextNode(" "));
      btn.appendChild(mark);
    }
  }
}
function prereqsMet() {
  return SYNTH_PREREQS.every(id => revealed[id]);
}
/* When THIS participant taps a finding button we remember the id so the
   next renderFindings() pass can switch to the Findings tab and scroll
   the new <li> into view. User feedback: on Android Chrome the buttons
   live in the left column and the findings log in the right column —
   on mobile the columns stack and the freshly-revealed answer lands
   below the viewport with no visible feedback that anything happened.
   We only do this for the local revealer (not for every teammate's
   reveal) so we don't yank everyone's scroll position when someone
   else clicks. Cleared on consumption. */
let myPendingReveal = null;
function reveal(id) {
  if (revealed[id] || !refRevealed) return;
  if (id === SYNTH_ID && !prereqsMet()) return;   // must do the workup first

  // ── Mobile feedback (user report 2026-05-18): on stacked-column
  // layouts the findings log lives FAR below the case panels, so
  // tapping "Ask the patient" / "Examine" / "Investigations" buttons
  // feels like nothing happened — the user can't see the freshly-
  // logged answer without scrolling. The existing scrollIntoView +
  // tab-switch path (renderFindings, below) only fires once the
  // Firebase round-trip completes, AND only helps when the user is
  // already on the Findings tab.
  //
  // Fire an instant bottom-of-screen toast with the question + answer
  // text so the user sees the result *at the button* (well, near it)
  // without any scroll. The toast text matches what lands in the
  // findings log so there's no risk of divergence; we don't include
  // the revealer's name (it's "you" by definition) and we don't show
  // a sub-toast on the duplicate-tap path (the early-return above
  // means we never reach here twice).
  const item = itemById(id);
  if (item && typeof toast === "function") {
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    // tc() also passes plain strings through, so this is safe for
    // both translated triplets and the legacy bare-string content.
    const q = (typeof tc === "function") ? tc(item.q, lang) : item.q;
    const a = (typeof tc === "function") ? tc(item.a, lang) : item.a;
    toast("✓ " + q, a);
  }

  const entry = { by: myName, at: Date.now() };
  myPendingReveal = id;
  // undefined aborts - if someone already revealed this item, do not re-write it
  refRevealed.child(id).transaction(cur => (cur == null ? entry : undefined))
    .then(res => {
      // append-only event log (Phase 1 dual-write — EVENT_SOURCING_DESIGN.md);
      // only emit when WE were the first revealer, so the event log mirrors the
      // mutable `revealed` subtree's first-wins semantics
      if (res && res.committed) logEvent(myRoom, "reveal", { itemId: id });
    });
}
function renderButtons() {
  const gateOK = prereqsMet();
  // PBL 7-jump scaffold (2026-05-18 specialist panel): Investigations
  // are locked until the team has at least one working hypothesis.
  // Hypotheses come BEFORE data gathering — that's the missing
  // pedagogical step. History + Examination stay open (you gather
  // information to FORM hypotheses); Investigations is where you
  // test them.
  const hypoOK = (typeof hypothesesUnlocked === "function")
    ? hypothesesUnlocked() : true;
  document.querySelectorAll(".req-btn").forEach(btn => {
    const id = btn.dataset.id;
    btn.classList.toggle("done", !!revealed[id]);
    // Investigations panel — disable EVERY button (not just SYNTH_ID)
    // when no hypothesis is recorded yet. The .chart-investigations
    // .is-locked class handles the visual fade; we also disable the
    // buttons here so the click doesn't fire even with keyboard focus.
    const isInv = id && id.indexOf("labs:") === 0;
    if (isInv && !hypoOK && !revealed[id]) {
      btn.disabled = true;
      btn.title = "Add a working hypothesis above to unlock Investigations.";
      return;   // skip the SYNTH-specific + isImaging branches below
    }
    if (id === SYNTH_ID) {
      const locked = !gateOK && !revealed[id];
      btn.disabled = locked;
      btn.title = locked
        ? "First screen the red flags by asking the patient and/or by examination"
        : "";
    }
    // imaging buttons: a soft "order matters" cue while the red-flag screen is
    // unfinished - it is still the room's choice, but the consequence is visible.
    // The warning is a REAL sibling node (not ::after content) so screen readers
    // read it and the button is linked to it via aria-describedby.
    const isImaging = id && id.indexOf("labs:") === 0 && id !== SYNTH_ID;
    if (isImaging) {
      const warn = !gateOK && !revealed[id];
      btn.classList.toggle("warn", warn);
      // Walk past any sibling req-inline-reveal to find the warn-note slot
      // (the inline-reveal is unconditional; the warn-note follows it).
      let note = btn.nextElementSibling;
      while (note && note.classList.contains("req-inline-reveal")) {
        note = note.nextElementSibling;
      }
      if (note && !note.classList.contains("req-warn-note")) note = null;
      if (warn) {
        if (!note) {
          note = document.createElement("p");
          note.className = "req-warn-note";
          note.id = "warn-" + id.replace(":", "-");
          note.textContent = "Screen the red flags and examine the legs first — " +
            "ordering a scan now costs the 'safety first' points.";
          // Insert AFTER the inline-reveal if present, else after the button.
          const anchor = (btn.nextElementSibling &&
            btn.nextElementSibling.classList.contains("req-inline-reveal"))
              ? btn.nextElementSibling : btn;
          anchor.insertAdjacentElement("afterend", note);
        }
        btn.setAttribute("aria-describedby", note.id);
        btn.title = "";
      } else {
        if (note) note.remove();
        btn.removeAttribute("aria-describedby");
        if (!revealed[id]) btn.title = "";
      }
    }
    // Bug 2 (user-feedback-2): on stacked mobile layout (<=960px) the right-
    // column findings log lives below the buttons, so the operator's tap and
    // the patient's answer are separated by hundreds of pixels of scroll. Add
    // an inline reveal that lives directly under each button on mobile only
    // (CSS hides it on desktop, where the right-column log is still the
    // canonical surface). Hidden on desktop via @media; populated whenever
    // the finding becomes revealed. Idempotent against re-renders.
    let inline = btn.nextElementSibling;
    if (inline && !inline.classList.contains("req-inline-reveal")) inline = null;
    if (revealed[id]) {
      if (!inline) {
        inline = document.createElement("div");
        inline.className = "req-inline-reveal";
        // Insert IMMEDIATELY after the button so DOM-adjacency matches the
        // visual relationship "answer is under its button".
        btn.insertAdjacentElement("afterend", inline);
      }
      const item = itemById(id);
      const meta = revealed[id];
      if (item) {
        const lang = (typeof _curLang === "function") ? _curLang() : "en";
        // Rebuild as two children so we can style the author byline
        // (italic + muted) separately from the answer body. Each child
        // is set via textContent — case content is author-controlled
        // but we keep the no-eval-by-default discipline.
        inline.textContent = "";
        const ans = document.createElement("span");
        ans.className = "req-inline-answer";
        ans.textContent = tc(item.a, lang);
        inline.appendChild(ans);
        // Citation badge (sim 2026-05-19 — Lucas): "Inline citation
        // badges (NICE 2021, HAS 2023…) on each finding so we can argue
        // from sources." Pull from CASE item's optional `cite` field
        // (a translatable trio { en, fr, ja } or a plain string). Two
        // children so we can style the badge separately from the
        // author byline (badge sits between answer + byline).
        if (item.cite) {
          const cite = document.createElement("span");
          cite.className = "req-inline-cite";
          cite.textContent = (typeof tc === "function")
            ? tc(item.cite, lang) : String(item.cite);
          inline.appendChild(cite);
        }
        // Author byline: replaces the work the removed Findings tab
        // used to do ("revealed by [name]") so the WHO information
        // stays visible without a separate tab.
        if (meta && meta.by) {
          const by = document.createElement("span");
          by.className = "req-inline-by";
          by.textContent = " — " + meta.by;
          inline.appendChild(by);
        }
        inline.setAttribute("aria-live", "polite");
      }
    } else if (inline) {
      inline.remove();
    }
  });
  // Auto-collapse a chart section once every KEY item in it is revealed
  // — sim 2026-05-19 finding (25 personas): "Could Module A let me
  // collapse a chart section the moment I've ticked a 'done' box?"
  // We only collapse ONCE per section (data-auto-collapsed flag) so a
  // student who manually reopens it later isn't fought by the engine.
  _autoCollapseCompletedChartSections();
}

/* Build the anonymised per-room cohort progress strip used by
 * renderLeaderboard. One bar per room, in name order (NOT score order)
 * so a competitive student doesn't accidentally learn the ranking.
 * Bar fill = revealed-keys / total-keys for the current stage (a
 * proxy for module progress). My room's bar is highlighted in the
 * accent colour; others are neutral grey. */
function _buildCohortProgressStrip(rows) {
  // <section> + role="group" so axe-core accepts the aria-label.
  // The previous structure used a bare <div aria-label="..."> which
  // axe flagged as aria-prohibited-attr (an aria-label on a div with
  // no valid role is an a11y violation per WAI-ARIA 1.2).
  const wrap = document.createElement("section");
  wrap.className = "lb-cohort-progress";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Anonymised cohort progress per room");
  const head = document.createElement("p");
  head.className = "lb-cohort-head";
  head.textContent = "Cohort progress (anonymised) — your bar is highlighted";
  wrap.appendChild(head);
  const grid = document.createElement("ul");
  grid.className = "lb-cohort-grid";
  // Each cell is a <li> (implicit role=listitem, accepts aria-label
  // per ARIA 1.2). The inner bar is aria-hidden so the SR reads the
  // li's label once instead of also stumbling through the empty bar.
  const inNameOrder = rows.slice().sort((a, b) => a.room.localeCompare(b.room));
  const target = 220;   // matches the goal-per-room used above
  inNameOrder.forEach(r => {
    const pct = Math.min(100, Math.round((r.total / target) * 100));
    const cell = document.createElement("li");
    cell.className = "lb-cohort-cell" + (r.room === myRoom ? " is-me" : "");
    cell.setAttribute("aria-label",
      (r.room === myRoom ? "Your room: " : "A room in the cohort: ") +
      pct + " per cent of the typical progress");
    const tinyBar = document.createElement("div");
    tinyBar.className = "lb-cohort-bar";
    tinyBar.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.style.width = pct + "%";
    tinyBar.appendChild(fill);
    cell.appendChild(tinyBar);
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);
  return wrap;
}

/* Update the per-bullet progress checklist at the top of Module A.
 * A bullet is "done" the moment its group-answers list has at least
 * one entry. Pure DOM toggle — safe to call repeatedly. */
function _updateModABulletProgress() {
  const list = el("modA-bullet-progress");
  if (!list) return;
  const buckets = {};
  entriesSorted(answers.moduleA || {}).forEach(e => {
    if (e.bulletKey) buckets[e.bulletKey] = (buckets[e.bulletKey] || 0) + 1;
  });
  list.querySelectorAll("li[data-bullet-key]").forEach(li => {
    const k = li.dataset.bulletKey;
    li.classList.toggle("is-done", (buckets[k] || 0) > 0);
  });
}

/* Per chart-section: collapse the section once the team has done a
 * reasonable workup in it. "Reasonable" = the section's flagged `key`
 * item was revealed AND there are ≥ 4 items revealed, OR (for sections
 * without a key item like history/exam) ≥ 4 items revealed. Idempotent
 * — leaves alone any section the user reopened after our auto-collapse
 * (`data-auto-collapsed` flag) so the engine never fights an explicit
 * user choice. Sim 2026-05-19 (25 personas asked for this). */
const _AUTO_COLLAPSE_MIN = 4;
function _autoCollapseCompletedChartSections() {
  const sectionIds = {
    history: "chart-section-history",
    exam:    "chart-section-exam",
    labs:    "chart-investigations"
  };
  Object.keys(sectionIds).forEach(group => {
    const sec = document.getElementById(sectionIds[group]);
    if (!sec || !sec.hasAttribute("open")) return;
    if (sec.dataset.autoCollapsed === "1") return;
    const items = (CASE && CASE[group]) || [];
    if (!items.length) return;
    let revealedCount = 0;
    let keyRevealed = false;
    let keyExists = false;
    items.forEach((it, i) => {
      if (revealed[group + ":" + i]) revealedCount++;
      if (it && it.key) {
        keyExists = true;
        if (revealed[group + ":" + i]) keyRevealed = true;
      }
    });
    const done = (keyExists && keyRevealed) ||
                 (revealedCount >= _AUTO_COLLAPSE_MIN);
    if (done) {
      sec.dataset.autoCollapsed = "1";
      sec.removeAttribute("open");
    }
  });
}
/* renderFindings was the renderer for the "What we're finding" tab
 * (a chronological log of all revealed items). That tab was removed
 * 2026-05-18 — the inline-reveal chips under each chart button now
 * carry the same information at the point of action, no scrolling.
 *
 * The function is retained for two side effects that still matter:
 *   1. It triggers the coach + synthesis-progress updates that fire
 *      whenever a finding is revealed. (Those used to live elsewhere
 *      but were wired through this entry point.)
 *   2. It keeps seenFindingIds populated so the inline-reveal "just-
 *      in" animation can run once per item (CSS req-reveal-in
 *      keyframe doesn't need this, but other future consumers might).
 *
 * The DOM operations on #findings-log / #findings-count / #findings-
 * empty / tab-badge-findings are all gated on the element existing,
 * because those nodes are no longer in the HTML. Same for the scroll-
 * into-view path — inline reveals are already at the click site, so
 * the scroll is now redundant. */
function renderFindings() {
  if (typeof updateModANextStep === "function") updateModANextStep();
  if (typeof updateSynthesisProgress === "function") updateSynthesisProgress();
  // Mark all currently-revealed items as seen so subsequent renders
  // don't re-fire any future "just appeared" animation/effect.
  ITEM_IDS.forEach(id => {
    if (revealed[id]) seenFindingIds[id] = true;
  });
  // Legacy DOM updates — kept guarded so the function still works if
  // a future PR re-introduces the findings panel (or if a custom
  // operator deployment keeps it). All no-ops in the current build.
  const log = el("findings-log");
  if (log) {
    log.innerHTML = "";
    const ids = ITEM_IDS.filter(id => revealed[id])
      .sort((a, b) => (revealed[a].at || 0) - (revealed[b].at || 0));
    const countEl = el("findings-count");
    if (countEl) countEl.textContent = ids.length + " / " + ITEM_IDS.length;
    const emptyEl = el("findings-empty");
    if (emptyEl) emptyEl.classList.toggle("hidden", ids.length > 0);
    setTabBadge("tab-badge-findings", ids.length);
    ids.forEach(id => {
      const item = itemById(id), meta = revealed[id];
      const li = document.createElement("li");
      if (item.key) li.className = "key";
      const lang = _curLang();
      const q = document.createElement("div"); q.className = "q"; q.textContent = tc(item.q, lang);
      const a = document.createElement("div"); a.className = "a"; a.textContent = tc(item.a, lang);
      const by = document.createElement("div"); by.className = "by";
      by.textContent = "revealed by ";
      const who = document.createElement("span");
      who.textContent = meta.by || "?";
      who.style.fontWeight = "600";
      by.appendChild(who);
      li.appendChild(q); li.appendChild(a); li.appendChild(by);
      log.appendChild(li);
    });
  }
  // Clear the local-reveal-pending marker even though we no longer
  // need the scroll-into-view (inline reveal is already at the click).
  if (myPendingReveal) myPendingReveal = null;
}
function keyRevealed() {
  return ITEM_IDS.some(id => revealed[id] && itemById(id).key);
}

/* Test hooks — top-level `let` bindings (revealed, promptCursor,
 * promptReplies, ITEM_IDS, CASE) are script-scoped and can't be
 * reached via `window.X = ...` assignments from E2E tests. These
 * small setters mutate the bindings directly so Playwright tests
 * can drive renderPrompts / renderButtons with deterministic state
 * without needing the full Firebase round-trip. Production code
 * never calls these; they're inert outside test runs. */
if (typeof window !== "undefined") {
  window._test_setRevealed = function (obj) { revealed = obj || {}; };
  window._test_setPromptCursor = function (n) { promptCursor = (typeof n === "number") ? n : 0; };
  window._test_setPromptReplies = function (obj) { promptReplies = obj || {}; };
  window._test_getItemIds = function () { return ITEM_IDS.slice(); };
  window._test_getCase = function () { return CASE; };
  window._test_rebuildCaseDerived = function () { rebuildCaseDerived(); };
  // Sim 2026-05-19 follow-ups — hooks for the per-feature E2E tests
  // under tests-e2e/sim-recommendations.spec.js. Production code never
  // calls these; they're inert outside test runs.
  window._test_setClientId      = function (c) { clientId = String(c || ""); };
  window._test_setSessionNum    = function (n) { sessionNum = String(n || ""); };
  window._test_setRoomCount     = function (n) { roomCount = parseInt(n, 10) || 1; };
  window._test_setAllRooms      = function (m) { allRooms = m || {}; };
  window._test_setAnswerReplies = function (m) { answerReplies = m || {}; };
  window._test_setHypotheses    = function (m) { hypotheses = m || {}; };
  window._test_setViewStage     = function (n) {
    // Drive both viewStage and roomStage so renderStage's lock/coach
    // branches see a consistent state. Used by tour-stage-dismiss.
    viewStage = parseInt(n, 10) || 0;
    roomStage = Math.max(roomStage, viewStage);
  };
  // Wrap-up feedback survey — exposed so E2E can mount the form and assert the
  // rendered fields without a live wrap-up stage / Firebase round-trip.
  window.renderSurvey = renderSurvey;
  window._mountSurveyForm = _mountSurveyForm;
}

/* Move the room-shared promptCursor by ±1 (clamped). Anyone in the room
 * can advance it; the cursor write triggers refPromptCursor.on for every
 * teammate, which re-renders renderPrompts with the new prompt. */
function _advancePromptCursor(delta) {
  if (!refPromptCursor) return;
  // Flush any pending reply edit to the previous prompt BEFORE advancing,
  // so the change isn't lost if the user clicks Next while still in the
  // textarea (the blur-based flush usually catches this, but a tap
  // sequence on mobile sometimes fires next/save in the wrong order).
  _flushPromptReply();
  const total = (CASE && Array.isArray(CASE.prompts)) ? CASE.prompts.length : 0;
  const next = Math.max(0, Math.min((promptCursor || 0) + delta, total));
  refPromptCursor.set(next).catch(e => console.error("prompt cursor set failed", e));
}

/* Debounced save of the textarea content for the current prompt.
 * Cross-room synced via refPromptReplies/$promptIdx/$cid. */
function _onPromptReplyInput(e) {
  if (_promptReplyTimer) clearTimeout(_promptReplyTimer);
  _promptReplyTimer = setTimeout(_flushPromptReply, 600);
}

function _flushPromptReply() {
  if (_promptReplyTimer) { clearTimeout(_promptReplyTimer); _promptReplyTimer = null; }
  const replyEl = el("prompt-reply");
  if (!replyEl || !refPromptReplies) return;
  const text = (replyEl.value || "").trim().slice(0, 600);
  const cursor = promptCursor || 0;
  const path = refPromptReplies.child(String(cursor)).child(clientId);
  if (text === "") {
    path.remove().catch(() => {});
    return;
  }
  path.set({
    text: text,
    by: myName || "",
    cid: clientId,
    at: Date.now()
  }).catch(e => console.error("prompt reply save failed", e));
}

/* Synthesis progress chip — shows "X / Y red flags screened" above
 * the Investigations button group. Driven from renderFindings()
 * (where prereq state can change). When all prereqs are met the chip
 * flips to ✓ and the green palette. */
function updateSynthesisProgress() {
  const node = el("synthesis-progress");
  if (!node) return;
  const total = SYNTH_PREREQS.length;
  const done = SYNTH_PREREQS.filter(id => revealed[id]).length;
  const allDone = done === total;
  node.classList.toggle("is-done", allDone);
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const key = allDone ? "modA.synthesis.unlocked" : "modA.synthesis.progress";
    const tpl = window.t(key);
    if (tpl && tpl !== key) {
      node.textContent = tpl.replace("{done}", String(done)).replace("{total}", String(total));
      return;
    }
  }
  node.textContent = allDone
    ? "✓ Red-flag screen complete — synthesis is unlocked."
    : done + " / " + total + " red flags screened";
}

/* Visible lock state on the Discussion tab — driven from renderPrompts()
 * via the same `unlocked` computation. Tab stays clickable but the
 * .is-locked class greys it out so students don't think it's
 * "available but uninteresting" (specialist quote: "Discussion lies
 * about being available"). */
function updateDiscussionTabLock(unlocked) {
  const tab = el("rcol-tab-discussion");
  if (!tab) return;
  tab.classList.toggle("is-locked", !unlocked);
  tab.setAttribute("aria-disabled", unlocked ? "false" : "true");
}

let promptsWereUnlocked = false;
function renderPrompts() {
  const unlocked = keyRevealed();
  el("prompts-locked").classList.toggle("hidden", unlocked);
  // Hide the legacy <ol> permanently (kept in HTML for back-compat).
  const legacyList = el("prompts-list");
  if (legacyList) {
    legacyList.classList.add("hidden");
    legacyList.innerHTML = "";
  }
  el("compare-card").classList.toggle("hidden", !unlocked);

  const progressive = el("prompt-progressive");
  const done = el("prompt-done");
  if (!progressive || !done) {
    // HTML hasn't been migrated yet; skip the new UI but DON'T crash.
    setTabBadge("tab-badge-discussion", unlocked ? "🔓" : "");
    if (typeof updateDiscussionTabLock === "function") updateDiscussionTabLock(unlocked);
    return;
  }

  if (!unlocked) {
    progressive.classList.add("hidden");
    done.classList.add("hidden");
    setTabBadge("tab-badge-discussion", "");
    if (typeof updateDiscussionTabLock === "function") updateDiscussionTabLock(false);
    return;
  }

  const lang = _curLang();
  const prompts = (CASE && Array.isArray(CASE.prompts)) ? CASE.prompts : [];
  const total = prompts.length;
  const cursor = Math.max(0, Math.min(promptCursor || 0, total));

  // Final state — student worked through every prompt.
  if (cursor >= total && total > 0) {
    progressive.classList.add("hidden");
    done.classList.remove("hidden");
    setTabBadge("tab-badge-discussion", "✓");
    if (typeof updateDiscussionTabLock === "function") updateDiscussionTabLock(true);
    return;
  }

  // Progressive single-prompt view.
  progressive.classList.remove("hidden");
  done.classList.add("hidden");

  const currentEl = el("prompt-progress-current");
  const totalEl = el("prompt-progress-total");
  const textEl = el("prompt-text");
  const replyEl = el("prompt-reply");
  const prevBtn = el("prompt-prev");
  const skipBtn = el("prompt-skip");
  const nextBtn = el("prompt-next");

  if (currentEl) currentEl.textContent = String(cursor + 1);
  if (totalEl) totalEl.textContent = String(total);
  const promptText = total > 0 ? tc(prompts[cursor], lang) : "";
  if (textEl) textEl.textContent = promptText;

  // Restore the team's saved reply for this prompt (if any). Use the
  // newest reply across all room members (anyone can edit, last-write-wins
  // on display — full per-author log is preserved in promptReplies for
  // research/export purposes).
  const repliesForThisPrompt = (promptReplies && promptReplies[cursor]) || {};
  let latest = null;
  Object.keys(repliesForThisPrompt).forEach(cid => {
    const r = repliesForThisPrompt[cid];
    if (r && (!latest || (r.at || 0) > (latest.at || 0))) latest = r;
  });
  if (replyEl && !replyEl.matches(":focus")) {
    replyEl.value = (latest && latest.text) || "";
  }

  // Prev disabled at the start; Next always enabled (reply is optional).
  if (prevBtn) prevBtn.disabled = cursor === 0;
  if (nextBtn) {
    nextBtn.disabled = false;
    nextBtn.textContent = (cursor + 1 >= total)
      ? (typeof window.t === "function" && window.t("prompts.next.last") !== "prompts.next.last"
          ? window.t("prompts.next.last")
          : "Save and finish →")
      : (typeof window.t === "function" && window.t("prompts.next") !== "prompts.next"
          ? window.t("prompts.next")
          : "Save and next →");
  }
  // Wire handlers once (idempotent guard).
  if (progressive && !progressive.dataset.wired) {
    progressive.dataset.wired = "1";
    if (nextBtn) nextBtn.addEventListener("click", () => _advancePromptCursor(+1));
    if (skipBtn) skipBtn.addEventListener("click", () => _advancePromptCursor(+1));
    if (prevBtn) prevBtn.addEventListener("click", () => _advancePromptCursor(-1));
    if (replyEl) {
      replyEl.addEventListener("input", _onPromptReplyInput);
      replyEl.addEventListener("blur", _flushPromptReply);
    }
  }
  // Wire the done-state buttons once.
  const doneCta = el("prompt-done-cta");
  const reviewBtn = el("prompt-review");
  if (done && !done.dataset.wired) {
    done.dataset.wired = "1";
    if (doneCta) doneCta.addEventListener("click", () => {
      if (typeof switchRcolTab === "function") switchRcolTab("answers");
    });
    if (reviewBtn) reviewBtn.addEventListener("click", () => {
      if (refPromptCursor) refPromptCursor.set(Math.max(0, total - 1));
    });
  }

  setTabBadge("tab-badge-discussion", unlocked ? "🔓" : "");
  // Visible lock state on the tab itself — driven by the same `unlocked`
  // computation as the panel content.
  if (typeof updateDiscussionTabLock === "function") updateDiscussionTabLock(unlocked);
  if (unlocked && !promptsWereUnlocked) {
    promptsWereUnlocked = true;
    nudgeRcolTab("discussion");
    // Auto-switch the local user to the Discussion panel + show the
    // "synthesis unlocked" banner. Only when the synthesis was just
    // revealed (this is the !promptsWereUnlocked branch) so it doesn't
    // re-fire on subsequent renders. Skipped if the user has already
    // navigated to Discussion (no surprise scroll) or is on Group
    // answers / another tab they actively chose to be on. Safer to
    // switch only when the user is on the default Findings tab — most
    // users haven't actively navigated away yet.
    // Auto-switch to Discussion ONLY when the user is on Decisions
    // (the new default tab after removing "What we're finding"). If
    // they've actively navigated elsewhere — Group answers — we don't
    // yank their view.
    if (activeRcolTab === "decisions" && typeof switchRcolTab === "function") {
      switchRcolTab("discussion");
    }
    const banner = el("synthesis-unlocked-banner");
    if (banner) {
      banner.classList.remove("hidden");
      // Trigger the 6-second auto-fade-out after a tick so the
      // enter animation finishes first.
      requestAnimationFrame(() => banner.classList.add("auto-fade"));
    }
  } else if (!unlocked) {
    promptsWereUnlocked = false;
    const banner = el("synthesis-unlocked-banner");
    if (banner) {
      banner.classList.add("hidden");
      banner.classList.remove("auto-fade");
    }
  }
  // Coach update — runs on every renderPrompts pass so the text stays
  // in sync as state changes (e.g., when the user opens Discussion).
  if (typeof updateModANextStep === "function") updateModANextStep();
}
/* "everyone taking part" - a non-numeric participation indicator. Each name in
   the room shows a filled dot once they have done ANYTHING (revealed a finding
   or written an answer). No per-person scores - this is a no-leader room of
   equals, and a visible count would invite shame and keyboard-grabbing. */
function renderContrib() {
  const box = el("contrib-tally");
  if (!box) return;
  const acted = {};
  const mark = nm => { if (nm) acted[nm] = true; };
  ITEM_IDS.forEach(id => { if (revealed[id]) mark(revealed[id].by); });
  ["moduleA", "moduleB"].forEach(mk => {
    Object.keys(answers[mk] || {}).forEach(k => {
      const entry = answers[mk][k];   // can be null mid-delete before re-snapshot
      if (entry) mark(entry.by);
    });
  });
  const names = {};
  Object.keys(presence).forEach(cid => {
    if (presence[cid] && presence[cid].name) names[presence[cid].name] = true;
  });
  Object.keys(acted).forEach(n => { names[n] = true; });
  const list = Object.keys(names).sort((a, b) => a.localeCompare(b));
  box.innerHTML = "";
  if (list.length === 0) return;
  const label = document.createElement("span");
  label.className = "contrib-label";
  label.textContent = "Everyone taking part:";
  box.appendChild(label);
  // Non-visual status text: a screen reader otherwise hears an identical
  // name list whether or not someone has acted (the done-state is colour +
  // dot-fill + font-weight only — WCAG 1.4.1 / 1.3.1). A visually-hidden
  // span per chip carries the meaning. We deliberately keep it QUALITATIVE
  // ("contributed" / "not yet"), never a number — the no-score, no-shame
  // design above is intentional.
  const tStatus = (key, fallback) => {
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const v = window.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  };
  list.forEach(nm => {
    const did = !!acted[nm];
    const chip = document.createElement("span");
    chip.className = "contrib-chip" + (did ? " acted" : "");
    const dot = document.createElement("span");
    dot.className = "contrib-dot" + (did ? " on" : "");
    dot.setAttribute("aria-hidden", "true");
    if (did) dot.style.background = colorFor(nm);
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(nm));
    // Name via textContent (createTextNode) — never innerHTML.
    const status = document.createElement("span");
    status.className = "sr-only";
    status.textContent = did
      ? " — " + tStatus("modA.contrib.acted", "contributed")
      : " — " + tStatus("modA.contrib.not-yet", "not yet");
    chip.appendChild(status);
    box.appendChild(chip);
  });
}
function renderCase() {
  renderButtons(); renderFindings(); renderPrompts(); renderContrib();
  checkScoreEvents();
}

/* ===================== SCORING: detect, render, leaderboard ===================== */
/* Detect which auto-events the room now satisfies, and write any new ones.
   Idempotent: each event is a fixed key written under a transaction guard, so
   it cannot be double-claimed. Only participants write; admins just watch. */
function checkScoreEvents() {
  if (isRoomAdmin || !refScore) return;
  const earned = roomScore.auto || {};
  const want = {};                       // eventId -> points
  const setWant = ev => {
    if (earned[ev]) return;
    const meta = scoreEventMeta(ev);
    if (meta) want[ev] = meta.points;
  };

  /* --- Module A: working the case up --- */
  const hasGroup = g => ITEM_IDS.some(id => id.indexOf(g + ":") === 0 && revealed[id]);
  if (hasGroup("history")) setWant("firstAsk");
  if (hasGroup("exam")) setWant("firstExam");
  if (hasGroup("labs")) setWant("firstTest");
  if (revealed["history:1"]) setWant("redflag1");
  if (revealed["history:2"]) setWant("redflag2");
  if (revealed["exam:3"]) setWant("redflag3");

  const imaging = ["labs:1", "labs:2", "labs:3", "labs:4"].some(id => revealed[id]);
  const prereqsDone = SYNTH_PREREQS.every(id => revealed[id]);
  if (prereqsDone && !imaging) setWant("redFlagFirst");  // ORDER: screen before scan
  if (revealed[SYNTH_ID]) setWant("synthesis");
  if (revealed[SYNTH_ID] && !imaging) setWant("restraint");

  /* --- the team's typed answers --- */
  const entriesOf = mk => Object.keys(answers[mk] || {})
    .map(k => answers[mk][k]).filter(Boolean);
  const aEntries = entriesOf("moduleA"), bEntries = entriesOf("moduleB");
  SCORE_MICRO_BULLETS.A.forEach((ev, i) => { if (aEntries.length > i) setWant(ev); });
  SCORE_MICRO_BULLETS.B.forEach((ev, i) => { if (bEntries.length > i) setWant(ev); });

  // exchange: a *substantive* answer (>=12 chars) from each university; graded
  const subByUni = arr => {
    const uni = {};
    arr.forEach(e => {
      if (e.university && String(e.text || "").trim().length >= 12) {
        (uni[e.university] = uni[e.university] || {})[(e.by || e.cid || "?")] = true;
      }
    });
    return uni;
  };
  const aUni = subByUni(aEntries), bUni = subByUni(bEntries);
  // generalised across ANY number of partner universities (platform-config.js):
  // count how many cohorts have at least `min` substantive contributors
  const cohortsWith = (uni, min) =>
    COHORT_IDS.filter(id => Object.keys(uni[id] || {}).length >= min).length;
  if (cohortsWith(aUni, 1) >= 2) setWant("exchangeA");
  if (cohortsWith(aUni, 2) >= 2) setWant("exchangeA2");
  if (cohortsWith(bUni, 1) >= 2) setWant("exchangeB");

  // concept families - key ideas recognised in the team's answers (case-content.js)
  if (typeof SCORING !== "undefined") {
    [["A", aEntries], ["B", bEntries]].forEach(pair => {
      const text = normalizeForScore(pair[1].map(e => e.text).join("  ||  "));
      (SCORING["module" + pair[0]] || []).forEach(fam => {
        if (familyHits(fam, text)) setWant("concept" + pair[0] + "_" + fam.id);
      });
    });
  }

  Object.keys(want).forEach(ev => {
    refScore.child("auto").child(ev).transaction(cur =>
      (cur == null ? { points: want[ev], at: Date.now() } : undefined)
    ).then(res => {
      // only emit the event when WE wrote the score - the transaction returns
      // committed=true on the writer, false on a loser; this keeps the event
      // log strictly one-per-state-change instead of one-per-render
      if (res && res.committed) {
        logEvent(myRoom, "score.auto", { itemId: ev, points: want[ev] });
      }
    }).catch(e => console.error("Score write failed", e));
  });

  // --- PENALTIES: a wrong choice (an investigation this case does not need)
  //     costs the team points. Idempotent, like the rewards. ---
  if (typeof PENALTIES !== "undefined") {
    const pen = roomScore.penalties || {};
    PENALTIES.forEach(p => {
      if (pen[p.id]) return;                       // already lost
      if (!revealed[p.item]) return;               // the wrong choice not made
      refScore.child("penalties").child(p.id).transaction(cur =>
        (cur == null ? { points: p.points, at: Date.now() } : undefined)
      ).then(res => {
        if (res && res.committed) {
          logEvent(myRoom, "score.penalty", { penaltyId: p.id, points: p.points });
        }
      }).catch(e => console.error("Penalty write failed", e));
    });
  }

  // --- TEAM DECISIONS: a locked-in vote earns points if correct, or costs
  //     points if wrong (penalty 0 = teaching feedback only). Idempotent. ---
  if (typeof DECISIONS !== "undefined") {
    const pen = roomScore.penalties || {};
    DECISIONS.forEach(d => {
      const v = roomVotes[d.id] || {};
      if (!v.committed || typeof v.committed.choice !== "number") return;
      const opt = d.options[v.committed.choice];
      if (!opt) return;
      if (opt.correct) {
        if (earned["decision_" + d.id]) return;
        refScore.child("auto").child("decision_" + d.id).transaction(cur =>
          (cur == null ? { points: d.points, at: Date.now() } : undefined)
        ).then(res => {
          if (res && res.committed) {
            logEvent(myRoom, "score.auto", { itemId: "decision_" + d.id, points: d.points });
          }
        }).catch(e => console.error("Decision score write failed", e));
      } else if (d.penalty > 0) {
        if (pen["decpen_" + d.id]) return;
        refScore.child("penalties").child("decpen_" + d.id).transaction(cur =>
          (cur == null ? { points: d.penalty, at: Date.now() } : undefined)
        ).then(res => {
          if (res && res.committed) {
            logEvent(myRoom, "score.penalty", { penaltyId: "decpen_" + d.id, points: d.penalty });
          }
        }).catch(e => console.error("Decision penalty write failed", e));
      }
    });
  }
}

/* one tiered celebration per score tick - proportional to what was earned, and
   QUIET during Module B (a breaking-bad-news roleplay throws no confetti).
   micro -> chip pop only; milestone -> confetti + chime; shared goal -> the
   full burst. The score chip itself pops via renderScore(). */
function celebrateEvents(evs) {
  const metas = evs.map(scoreEventMeta).filter(Boolean);
  if (!metas.length) return;
  const pts = metas.reduce((s, m) => s + m.points, 0);
  const quiet = (roomStage === 2) || metas.every(m => m.module === "B");
  const hasMilestone = metas.some(m => m.tier === "milestone");
  // has the cohort just crossed the shared goal? (rare, the biggest moment)
  let sharedGoalHit = false;
  try {
    const goal = Math.max(1, roomCount) * 220;
    const totalNow = roomNames(roomCount)
      .reduce((s, r) => s + scoreTotal(allRooms[r] || {}), 0);
    sharedGoalHit = (totalNow >= goal) && ((totalNow - pts) < goal);
  } catch (e) { /* allRooms not ready - skip */ }

  if (!quiet) {
    if (sharedGoalHit) { burst(true); playCue("goal"); }
    else if (hasMilestone) { burst(); playCue("milestone"); }
    else { playCue("micro"); }
  }
  if (metas.length === 1) {
    const m = metas[0];
    toast("+" + m.points + " — " + m.title, m.why || m.did || "");
  } else {
    toast("+" + pts + " — " + metas.length + " goals reached!",
      metas.map(m => m.title).join("  ·  "));
  }
}

/* the mirror of celebrateEvents for a WRONG choice - no confetti, no sound,
   just a calm "loss"-styled toast that always says WHY the points were lost,
   so a mistake stays a teaching moment. */
function penaltyToast(evs) {
  const metas = evs.map(penaltyMeta).filter(Boolean);
  if (!metas.length) return;
  const pts = metas.reduce((s, m) => s + m.points, 0);
  if (metas.length === 1) {
    const m = metas[0];
    toast("−" + m.points + " — " + m.title, m.why || "", "loss");
  } else {
    toast("−" + pts + " — " + metas.length + " choices cost points",
      metas.map(m => m.title).join("  ·  "), "loss");
  }
}

/* the room's own score chip in the stage row */
function renderScore() {
  const chip = el("room-score-chip");
  if (chip) {
    const total = scoreTotal({ score: roomScore });
    chip.classList.remove("hidden");
    const label = (teamName || myRoom || "Your team") + " — ";
    let numEl = chip.querySelector(".score-num");
    if (!numEl) {
      chip.textContent = label;
      numEl = document.createElement("span");
      numEl.className = "score-num";
      numEl.textContent = "0";
      chip.appendChild(numEl);
      chip.appendChild(document.createTextNode(" pts"));
    } else {
      chip.childNodes[0].textContent = label;
    }
    const prev = parseInt(numEl.textContent, 10) || 0;
    if (total !== prev) {
      countUp(numEl, total);
      chip.classList.remove("pop");
      void chip.offsetWidth;            // restart the pop animation
      chip.classList.add("pop");
    }
  }
  // reflect a saved team name back into the stage-0 input (unless being typed in)
  const inp = el("team-name-input");
  if (inp && teamName && document.activeElement !== inp) inp.value = teamName;
  renderObjectives();
  renderLeaderboard();
}

/* the live "how points work" panel - the milestone + concept goals for the
   module the room is on, each with a done/open state and live progress */
function renderObjectives() {
  const box = el("objectives");
  if (!box) return;
  const earned = (roomScore && roomScore.auto) || {};
  const mod = (viewStage === 2) ? "B" : "A";
  const rows = [];
  Object.keys(SCORE_AUTO).forEach(ev => {
    const m = SCORE_AUTO[ev];
    if (m.module === mod && m.tier === "milestone")
      rows.push({ ev: ev, points: m.points, label: m.title });
  });
  if (typeof SCORING !== "undefined") {
    const lang = _curLang();
    (SCORING["module" + mod] || []).forEach(f =>
      rows.push({ ev: "concept" + mod + "_" + f.id, points: f.points, label: tc(f.label, lang) }));
  }
  let got = 0, max = 0;
  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "obj-head";
  const list = document.createElement("ul");
  list.className = "obj-list";
  list.setAttribute("role", "list");
  rows.forEach(o => {
    max += o.points;
    const done = !!earned[o.ev];
    if (done) got += o.points;
    const row = document.createElement("li");
    row.className = "obj-row" + (done ? " done" : "");
    row.setAttribute("aria-label",
      (done ? "Earned: " : "Not yet earned: ") + o.label + ", worth " + o.points + " points");
    const mark = document.createElement("span");
    mark.className = "obj-mark"; mark.textContent = done ? "✓" : "○";
    mark.setAttribute("aria-hidden", "true");
    const lbl = document.createElement("span");
    lbl.className = "obj-label"; lbl.textContent = o.label;
    const pts = document.createElement("span");
    pts.className = "obj-pts"; pts.textContent = "+" + o.points;
    pts.setAttribute("aria-hidden", "true");
    row.appendChild(mark); row.appendChild(lbl); row.appendChild(pts);
    list.appendChild(row);
  });
  head.innerHTML = "<strong>Module " + mod + " — how your team earns points</strong>" +
    "<span class=\"obj-tally\">" + got + " / " + max + "</span>";
  box.appendChild(head);
  box.appendChild(list);
  const note = document.createElement("p");
  note.className = "obj-note";
  const twoNames = COHORTS.slice(0, 2).map(c => c.short || c.id).join(" and a ");
  note.textContent = mod === "A"
    ? "The ORDER matters: screen the red flags and examine the legs BEFORE any scan — that earns the big points, and ordering a scan early quietly costs them. Your written answers earn points when they show the key ideas above. There is no time bonus."
    : "Points here are deliberately quiet — Module B is about the conversation, not the score. Make sure a " + twoNames + " voice both write, and that your answers name a real difference between the partner countries.";
  box.appendChild(note);

  // --- Points lost: every wrong choice this team made, with the reason why ---
  const pen = (roomScore && roomScore.penalties) || {};
  const penIds = Object.keys(pen);
  if (penIds.length) {
    const lost = penIds.reduce((s, id) => s + ((pen[id] && pen[id].points) || 0), 0);
    const wrap = document.createElement("div");
    wrap.className = "obj-penalties";
    const ph = document.createElement("div");
    ph.className = "obj-pen-head";
    ph.innerHTML = "<strong>Points lost — why</strong>" +
      "<span class=\"obj-pen-tally\">−" + lost + "</span>";
    wrap.appendChild(ph);
    const pl = document.createElement("ul");
    pl.className = "obj-pen-list";
    pl.setAttribute("role", "list");
    penIds.forEach(id => {
      const meta = penaltyMeta(id);
      if (!meta) return;
      const li = document.createElement("li");
      li.className = "obj-pen-row";
      li.setAttribute("aria-label",
        "Lost " + meta.points + " points: " + meta.title + ". " + (meta.why || ""));
      const t = document.createElement("span");
      t.className = "obj-pen-title";
      t.textContent = meta.title;
      const p = document.createElement("span");
      p.className = "obj-pen-pts"; p.textContent = "−" + meta.points;
      p.setAttribute("aria-hidden", "true");
      const w = document.createElement("span");
      w.className = "obj-pen-why"; w.textContent = meta.why || "";
      li.appendChild(t); li.appendChild(p); li.appendChild(w);
      pl.appendChild(li);
    });
    wrap.appendChild(pl);
    box.appendChild(wrap);
  }
}

/* ===================== TEAM DECISIONS: vote together (Kahoot-style) =========
   The "very important questions" of each module. Every student casts a ballot,
   a live tally shows the room how it is leaning, and the team LOCKS IN one
   answer together. A correct lock-in earns points; a wrong one costs points
   (and always shows WHY). Votes live at rooms/{room}/votes/{decisionId}. */

/* cast (or change) my ballot for a decision.
   R3-F1 fix: key ballots by `stableId`, not the per-tab `clientId`. A refresh
   used to rotate clientId, leaving the old ballot in the tally AND letting
   the new tab cast a fresh one — the same participant could double-count.
   stableId is localStorage-backed for anonymous users and bound to auth.uid
   for Google-signed-in users, so a refresh / new-tab on the same browser
   resolves to the same key and the ballot is overwritten in place. */
function ballotKey() {
  // Defence: in test contexts stableId may be unset; fall back to clientId
  // so the function never writes under `undefined`.
  return (typeof stableId === "string" && stableId) ? stableId : clientId;
}
function castVote(decisionId, choiceIndex) {
  if (isRoomAdmin || !refVotes) return;
  const v = roomVotes[decisionId] || {};
  if (v.committed) return;                         // locked - no more voting
  const bkey = ballotKey();
  // R3-F1 — opportunistic cleanup: if a legacy ballot exists under our old
  // per-tab clientId AND the new stableId-keyed ballot is empty, the move
  // is automatic. Otherwise the old ballot is overwritten by the new write
  // below (and the stale clientId-keyed entry — from a previous tab whose
  // clientId we no longer hold — will linger only until the room rebuilds).
  if (bkey !== clientId) {
    const stale = (v.ballots && v.ballots[clientId]);
    if (stale) {
      refVotes.child(decisionId).child("ballots").child(clientId).remove()
        .catch(e => console.warn("Stale ballot cleanup failed", e));
    }
  }
  refVotes.child(decisionId).child("ballots").child(bkey)
    .set({ choice: choiceIndex, at: Date.now() })
    .catch(e => console.error("Vote write failed", e));
  logEvent(myRoom, "vote.cast", { voteId: decisionId, choice: choiceIndex });
}

/* lock in the team's answer: the option with the most ballots. A tie is not
   committed - the room is told to talk it through and vote again. */
function commitDecision(decisionId) {
  if (!refVotes) return;
  const v = roomVotes[decisionId] || {};
  if (v.committed) return;                         // already locked
  const ballots = v.ballots || {};
  const tally = {};
  Object.keys(ballots).forEach(cid => {
    const c = ballots[cid] && ballots[cid].choice;
    if (typeof c === "number") tally[c] = (tally[c] || 0) + 1;
  });
  const choices = Object.keys(tally);
  if (!choices.length) return;
  let best = null, bestN = -1, tie = false;
  choices.forEach(c => {
    const n = tally[c];
    if (n > bestN) { best = parseInt(c, 10); bestN = n; tie = false; }
    else if (n === bestN) tie = true;
  });
  if (tie) {
    toast("It's a tie — talk it through and vote again", "", "loss");
    return;
  }
  refVotes.child(decisionId).child("committed").transaction(cur =>
    (cur == null ? { choice: best, at: Date.now() } : undefined)
  ).then(res => {
    if (res && res.committed) {
      logEvent(myRoom, "vote.lockin", { voteId: decisionId, choice: best });
    }
  }).catch(e => console.error("Commit failed", e));
}

/* announce a freshly locked-in decision: a normal toast + small celebration if
   the team got it right, a calm "loss" toast (with the reason) if they did not.
   Module B stays quiet by design - no burst, no sound. */
function announceDecision(id) {
  const d = decisionMeta(id);
  if (!d || !d.decision || !d.option) return;
  const why = tc(d.option.why, _curLang());
  if (d.correct) {
    toast("+" + d.decision.points + " — Team decision locked in", why);
    if (d.decision.module !== "B" && roomStage !== 2) { burst(); playCue("milestone"); }
  } else {
    const pen = d.decision.penalty || 0;
    toast((pen ? "−" + pen + " — " : "") + "Not the safest answer — locked in",
      why, "loss");
  }
}

/* how many people in the room can vote (present participants; admins observe) */
function votablePresentCount() {
  return Object.keys(presence || {}).filter(cid => presence[cid]).length;
}

/* render the team-decision cards for Module A and Module B */
let lastDecisionBallotCount = 0;
/* Count revealed items per case group (history / exam / labs). Used by
 * decisionUnlocked() to evaluate per-decision unlockWhen gates.
 * Mirrors the structure case content uses: id format is "group:index". */
function revealedCountByGroup(group) {
  let n = 0;
  Object.keys(revealed || {}).forEach(id => {
    if (typeof id === "string" && id.indexOf(group + ":") === 0) n++;
  });
  return n;
}

/* Evaluate whether a decision is currently unlocked. A decision without
 * an `unlockWhen` field is always unlocked (back-compat for content
 * that doesn't opt in to gating). The schema is a plain object of
 * threshold names → minimum counts. Returns { unlocked, unmet } where
 * unmet is the list of requirements still missing (used to build the
 * "ready when…" hint). */
function decisionUnlocked(d) {
  if (!d || !d.unlockWhen) return { unlocked: true, unmet: [] };
  const w = d.unlockWhen;
  const have = {
    hypotheses: (typeof hypothesisCount === "function") ? hypothesisCount() : 0,
    historyRevealed: revealedCountByGroup("history"),
    examRevealed: revealedCountByGroup("exam"),
    labsRevealed: revealedCountByGroup("labs"),
    synthesis: (typeof keyRevealed === "function" && keyRevealed()) ? 1 : 0
  };
  const unmet = [];
  Object.keys(w).forEach(key => {
    // CHAINED-BRANCH GATE: gate this decision behind a PRIOR decision's
    // committed choice. `afterDecision` is either a decision id (any option
    // unlocks) or { id, option } (only that committed option unlocks). Reads
    // the live, synced roomVotes[id].committed — no new Firebase path. This is
    // how a committed decision forks the case into a follow-up decision.
    if (key === "afterDecision") {
      const spec = w[key];
      const depId = (typeof spec === "string") ? spec : (spec && spec.id);
      const needOpt = (spec && typeof spec.option === "number") ? spec.option : null;
      const dv = (typeof roomVotes !== "undefined" && depId) ? roomVotes[depId] : null;
      const committedChoice = (dv && dv.committed && typeof dv.committed.choice === "number")
        ? dv.committed.choice : null;
      const ok = (committedChoice != null) && (needOpt == null || committedChoice === needOpt);
      if (!ok) unmet.push({ key: "afterDecision", depId: depId, needOption: needOpt });
      return;
    }
    const need = w[key] || 0;
    if ((have[key] || 0) < need) unmet.push({ key: key, need: need, have: have[key] || 0 });
  });
  return { unlocked: unmet.length === 0, unmet: unmet };
}

/* Build the human-readable "ready when…" hint for a locked decision.
 * Goes through the unmet requirements and renders each one in the
 * active UI language. Falls back to English wording when i18n is
 * unavailable. */
function decisionUnlockHint(unmet) {
  const t = (key, fallback) => {
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const v = window.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  };
  const parts = unmet.map(u => {
    switch (u.key) {
      case "afterDecision": {
        // Chained branch: name the prior decision the team must lock in first.
        const dep = (typeof DECISIONS !== "undefined" ? DECISIONS : [])
          .find(d => d.id === u.depId);
        const depTitle = dep ? tc(dep.prompt, _curLang()) : "";
        const lead = t("modA.decision.unlock.after", "the team locks in the previous decision");
        return depTitle ? (lead + ": “" + depTitle + "”") : lead;
      }
      case "hypotheses":
        return t("modA.decision.unlock.hypotheses", "add a working hypothesis");
      case "historyRevealed":
        return t("modA.decision.unlock.history", "ask the patient");
      case "examRevealed":
        return t("modA.decision.unlock.exam", "examine");
      case "labsRevealed":
        return t("modA.decision.unlock.labs", "investigate");
      case "synthesis":
        return t("modA.decision.unlock.synthesis", "complete the clinical synthesis");
      default:
        return u.key;
    }
  });
  return parts.join(" · ");
}

/* Track which Module A decisions were previously unlocked so we can
 * fire a coach-card "🗳️ A new decision opened" nudge on transitions. */
let lastUnlockedDecisionIds = new Set();

function renderDecisions() {
  // Combined across modules: which decisions are unlocked right now. Chained
  // branches live in Module B (a committed decision unlocks a follow-up), so
  // the unlock-transition nudge must span both modules — a single tracker
  // keeps A and B from clobbering each other's "newly opened" state.
  const allUnlockedNow = new Set();
  ["A", "B"].forEach(mod => {
    const box = el("decisions-" + mod);
    if (!box) return;
    const list = (typeof DECISIONS !== "undefined" ? DECISIONS : [])
      .filter(d => d.module === mod);
    box.innerHTML = "";
    if (!list.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    // Module A's decisions tab badge: outstanding decisions (✓ when all done),
    // and a gentle nudge whenever a new ballot or commit arrives elsewhere
    if (mod === "A") {
      let pending = 0, ballots = 0;
      list.forEach(d => {
        const v = roomVotes[d.id] || {};
        ballots += Object.keys(v.ballots || {}).length;
        if (!v.committed) pending++;
      });
      setTabBadge("tab-badge-decisions", pending ? pending : (list.length ? "✓" : ""));
      if (ballots !== lastDecisionBallotCount) {
        if (ballots > lastDecisionBallotCount) nudgeRcolTab("decisions");
        lastDecisionBallotCount = ballots;
      }
    }
    const head = document.createElement("div");
    head.className = "dec-head";
    const h = document.createElement("h3");
    h.textContent = "🗳️ Team decisions — vote together";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "The big calls of this module. Everyone taps their choice, " +
      "the bars show how your room is leaning — then lock in one answer together.";
    head.appendChild(h); head.appendChild(hint);
    box.appendChild(head);
    list.forEach(d => {
      // Gating now applies to ALL modules. Decisions without an `unlockWhen`
      // are always unlocked (back-compat), so only opted-in decisions gate —
      // including Module B chained branches (unlockWhen.afterDecision).
      const gate = decisionUnlocked(d);
      if (gate.unlocked) {
        allUnlockedNow.add(d.id);
        box.appendChild(buildDecision(d));
      } else if (d.hideWhenLocked) {
        // Chained-branch follow-ups stay invisible until they open, so the
        // continuation lands as a surprise fork rather than a spoiler teaser.
        // The unlock nudge below announces it the moment it opens.
      } else {
        box.appendChild(buildLockedDecision(d, gate.unmet));
      }
    });
  });
  // Coach nudge on unlock transitions (locked → unlocked), across both modules.
  // Surfaces a one-liner via toast() so the team sees a new decision opened
  // without auto-stealing focus. Skipped on the initial paint (empty tracker).
  allUnlockedNow.forEach(id => {
    if (lastUnlockedDecisionIds.has(id) || lastUnlockedDecisionIds.size === 0) return;
    const d = (typeof DECISIONS !== "undefined" ? DECISIONS : []).find(x => x.id === id);
    if (!d) return;
    const lang = _curLang();
    if (typeof toast === "function") {
      toast("🗳️ " + (typeof window.t === "function" ?
            (window.t("modA.decision.unlocked") !== "modA.decision.unlocked"
              ? window.t("modA.decision.unlocked")
              : "A new team decision just opened")
            : "A new team decision just opened"),
            tc(d.prompt, lang));
    }
    // Auto-open the decide-together / vote panel when a vote becomes due
    // (dry-run: students missed that a decision had opened). Module A's panel
    // lives in the right-column "decisions" tab; Module B's is always visible.
    // Guard: never yank focus from someone mid-answer (the unlock fires for the
    // whole room, possibly while a teammate is typing their bullet).
    const typing = document.activeElement &&
      /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName || "");
    if (d.module === "A" && activeRcolTab !== "decisions" && !typing &&
        typeof switchRcolTab === "function") {
      switchRcolTab("decisions");
    }
    try {
      const box = el("decisions-" + (d.module || "A"));
      if (box && !typing && typeof box.scrollIntoView === "function") {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (_) { /* scrollIntoView unsupported / detached — non-fatal */ }
  });
  lastUnlockedDecisionIds = allUnlockedNow;
}

/* Slim locked-state placeholder for a decision that hasn't yet met its
 * unlockWhen gate. Shows the prompt title (so students see the menu of
 * what's coming) + a 🔒 + a "ready when…" hint built from the unmet
 * requirements. No vote controls — students cannot anchor on a vote
 * before they've earned the information that should drive it. */
function buildLockedDecision(d, unmet) {
  const wrap = document.createElement("div");
  wrap.className = "decision decision-locked";
  const lang = _curLang();

  const head = document.createElement("div");
  head.className = "decision-locked-head";
  const lock = document.createElement("span");
  lock.className = "decision-locked-icon";
  lock.setAttribute("aria-hidden", "true");
  lock.textContent = "🔒";
  const title = document.createElement("p");
  title.className = "decision-locked-title";
  title.textContent = tc(d.prompt, lang);
  head.appendChild(lock);
  head.appendChild(title);
  wrap.appendChild(head);

  const hintLine = document.createElement("p");
  hintLine.className = "decision-locked-hint";
  const prefix = (typeof window !== "undefined" && typeof window.t === "function" &&
                  window.t("modA.decision.ready-when") !== "modA.decision.ready-when")
    ? window.t("modA.decision.ready-when")
    : "Ready when:";
  hintLine.textContent = prefix + " " + decisionUnlockHint(unmet);
  wrap.appendChild(hintLine);

  return wrap;
}

/* one decision block: the prompt, the option bars with a live tally, who voted,
   and either a "lock in" button or the committed result with its explanation */
function buildDecision(d) {
  const v = roomVotes[d.id] || {};
  const ballots = v.ballots || {};
  const committed = (v.committed && typeof v.committed.choice === "number")
    ? v.committed.choice : null;
  // R3-F1 — read my ballot under stableId first (the canonical key now),
  // fall back to the legacy clientId-keyed entry so a refresh during an
  // open ballot still shows my prior choice in the UI.
  const _bk = ballotKey();
  const myBallot = (ballots[_bk] && typeof ballots[_bk].choice === "number")
    ? ballots[_bk]
    : (ballots[clientId] && typeof ballots[clientId].choice === "number"
        ? ballots[clientId] : null);
  const myChoice = myBallot ? myBallot.choice : null;

  // tally + the voters behind each option (name via presence, for the dots)
  const tally = d.options.map(() => []);
  Object.keys(ballots).forEach(cid => {
    const c = ballots[cid] && ballots[cid].choice;
    if (typeof c !== "number" || !tally[c]) return;
    const nm = (presence[cid] && presence[cid].name) || "";
    tally[c].push(nm);
  });
  const totalBallots = Object.keys(ballots).length;

  const wrap = document.createElement("div");
  wrap.className = "decision" + (committed != null
    ? (d.options[committed] && d.options[committed].correct ? " committed correct" : " committed wrong")
    : "");

  const lang = _curLang();
  const q = document.createElement("p");
  q.className = "dec-prompt";
  q.textContent = tc(d.prompt, lang);
  wrap.appendChild(q);

  const opts = document.createElement("div");
  opts.className = "dec-options";
  d.options.forEach((opt, i) => {
    const n = tally[i].length;
    const pct = totalBallots ? Math.round((n / totalBallots) * 100) : 0;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dec-opt"
      + (myChoice === i ? " mine" : "")
      + (committed === i ? " won" : "")
      + (committed != null && opt.correct ? " is-correct" : "")
      // The committed option that turned out to be WRONG (user request
      // 2026-05-18: 'When clicking wrong questions or assessment, they
      // must be coloured in red, not in green'). Distinct from
      // .is-correct so styling can scream 'this is the choice the team
      // locked in but it's wrong' rather than the previous neutral amber.
      + (committed === i && !opt.correct ? " is-wrong" : "");
    btn.disabled = isRoomAdmin || committed != null;
    btn.setAttribute("aria-pressed", String(myChoice === i));
    // the live bar (proportion of ballots cast so far)
    const bar = document.createElement("span");
    bar.className = "dec-bar";
    bar.style.width = pct + "%";
    btn.appendChild(bar);
    const label = document.createElement("span");
    label.className = "dec-opt-label";
    label.textContent = tc(opt.text, lang);
    btn.appendChild(label);
    const count = document.createElement("span");
    count.className = "dec-opt-count";
    count.textContent = n ? String(n) : "";
    btn.appendChild(count);
    btn.addEventListener("click", () => castVote(d.id, i));
    opts.appendChild(btn);
    // The previous build showed a coloured dot per voter per option,
    // attributing each vote to a named person. The research-ethics audit
    // flagged this as cross-cultural peer-shaming surface (especially on
    // the opioid / family-disclosure decisions). We now show only a single
    // dot for the CURRENT viewer's own vote ("you voted for this option")
    // - other voters stay aggregated into the count + bar above.
    if (myChoice === i) {
      const who = document.createElement("div");
      who.className = "dec-voters";
      const dot = document.createElement("span");
      dot.className = "dec-voter-dot dec-voter-mine";
      dot.title = "Your vote";
      dot.style.background = colorFor(myName || "you");
      who.appendChild(dot);
      const lbl = document.createElement("span");
      lbl.className = "dec-voter-mine-label";
      lbl.textContent = "Your vote";
      who.appendChild(lbl);
      opts.appendChild(who);
    }
  });
  wrap.appendChild(opts);

  if (committed != null) {
    // the locked-in result + the teaching explanation
    const opt = d.options[committed] || {};
    const res = document.createElement("div");
    res.className = "dec-result " + (opt.correct ? "good" : "bad");
    const tag = document.createElement("strong");
    tag.textContent = opt.correct
      ? "✓ Locked in — the safest answer"
      : "Locked in — not the safest answer";
    const why = document.createElement("p");
    why.textContent = tc(opt.why, lang);
    res.appendChild(tag); res.appendChild(why);
    if (opt.correct && d.points) {
      const pts = document.createElement("span");
      pts.className = "dec-result-pts good";
      pts.textContent = "+" + d.points;
      res.appendChild(pts);
    } else if (!opt.correct && d.penalty > 0) {
      const pts = document.createElement("span");
      pts.className = "dec-result-pts bad";
      pts.textContent = "−" + d.penalty;
      res.appendChild(pts);
    }
    wrap.appendChild(res);
    // BRANCHING: a committed option may carry a `branch.reveal` — a short
    // narrative of what the patient/family does next, turning the decision
    // into a fork. Derived from the synced committed choice, so the whole
    // room sees the same continuation with no extra Firebase path. Options
    // without a branch render nothing here (branching is opt-in per option).
    const branchText = opt.branch && tc(opt.branch.reveal, lang);
    if (branchText) {
      const br = document.createElement("div");
      br.className = "dec-branch";
      const bh = document.createElement("strong");
      bh.className = "dec-branch-h";
      bh.textContent = "→ What happens next";
      const bp = document.createElement("p");
      bp.textContent = branchText;   // narrative content — textContent, no markup
      br.appendChild(bh); br.appendChild(bp);
      wrap.appendChild(br);
    }
  } else {
    // not locked yet: the status line + the lock-in button
    const present = votablePresentCount();
    const need = Math.min(2, Math.max(1, present));
    const canLock = totalBallots >= need;
    const foot = document.createElement("div");
    foot.className = "dec-foot";
    const status = document.createElement("span");
    status.className = "dec-status";
    status.textContent = present
      ? totalBallots + " of " + present + " voted"
      : totalBallots + " voted";
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "dec-lock";
    lock.textContent = "Lock in the team's answer";
    lock.disabled = !canLock;
    lock.title = canLock
      ? "Commit the option with the most votes"
      : "At least " + need + " people need to vote first";
    lock.addEventListener("click", () => commitDecision(d.id));
    foot.appendChild(status);
    foot.appendChild(lock);
    wrap.appendChild(foot);
    if (isRoomAdmin) status.textContent += " · you are observing";
  }
  return wrap;
}

/* the live leaderboard - a cooperative shared goal first, then a gentle ranking
   (top three only; everyone else shown but never labelled "last") */
function renderLeaderboard() {
  const box = el("leaderboard");
  if (!box) return;
  const rows = roomNames(roomCount).map(r => {
    const data = allRooms[r] || {};
    return { room: r, name: (data.teamName || r), total: scoreTotal(data) };
  }).sort((a, b) => b.total - a.total || a.room.localeCompare(b.room));
  box.innerHTML = "";

  // --- the cooperative shared goal: every room's points count together ---
  const together = rows.reduce((s, r) => s + r.total, 0);
  const goal = Math.max(1, roomCount) * 220;
  const pct = Math.min(100, Math.round(together / goal * 100));
  const shared = document.createElement("div");
  shared.className = "lb-shared";
  const sh = document.createElement("div");
  sh.className = "lb-shared-head";
  sh.innerHTML = "<strong>Together</strong><span>" + together + " / " + goal +
    " cohort points</span>";
  const bar = document.createElement("div");
  bar.className = "lb-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(pct));
  bar.setAttribute("aria-label",
    "Cohort shared goal: " + together + " of " + goal + " points, " + pct + " per cent");
  const fill = document.createElement("span");
  fill.style.width = pct + "%";
  bar.appendChild(fill);
  const note = document.createElement("p");
  note.className = "lb-shared-note";
  note.textContent = "Every room's points add to the same goal — across all the " +
    "rooms you are one team today.";
  shared.appendChild(sh); shared.appendChild(bar); shared.appendChild(note);
  // Anonymised cohort progress strip — sim 2026-05-19 (Daichi,
  // competitive): "A small per-room progress bar against the other
  // rooms (without exposing 'which room is winning')." Each room is one
  // bar; the rooms are shown in a stable order (by room name, NOT by
  // rank) so a competitive participant can spot relative progress
  // without learning who's behind. My room is highlighted.
  shared.appendChild(_buildCohortProgressStrip(rows));
  box.appendChild(shared);

  if (rows.every(r => r.total === 0)) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No points yet — your team earns points as you work the case " +
      "and debate. The board updates live for everyone.";
    box.appendChild(p);
    return;
  }
  // --- the rooms: top 3 ranked; the rest shown but unranked (no last-place sting) ---
  const myRank = rows.findIndex(r => r.room === myRoom);
  const list = document.createElement("ul");
  list.className = "lb-list";
  list.setAttribute("role", "list");
  rows.forEach((r, i) => {
    const ranked = i < 3;
    const row = document.createElement("li");
    row.className = "lb-row" + (r.room === myRoom ? " me" : "") +
      (ranked ? " ranked" : "");
    const rankWord = ranked ? ("rank " + (i + 1)) : "in play";
    row.setAttribute("aria-label",
      r.name + (r.room === myRoom ? " (your team)" : "") + ", " + rankWord +
      ", " + r.total + " points");
    const rank = document.createElement("span");
    rank.className = "lb-rank";
    rank.setAttribute("aria-hidden", "true");
    rank.textContent = ranked ? (i === 0 ? "🏆" : "#" + (i + 1)) : "•";
    const name = document.createElement("span");
    name.className = "lb-name";
    name.textContent = r.name + (r.room === myRoom ? " (your team)" : "");
    const pts = document.createElement("span");
    pts.className = "lb-pts";
    pts.textContent = r.total + " pts";
    pts.setAttribute("aria-hidden", "true");
    row.appendChild(rank); row.appendChild(name); row.appendChild(pts);
    if (r.room === myRoom && myRank > 0) {
      const ahead = rows[myRank - 1];
      const gap = ahead.total - r.total;
      const tag = document.createElement("span");
      tag.className = "lb-gap";
      tag.textContent = gap > 0
        ? "+" + gap + " to catch " + ahead.name
        : "joint — keep going!";
      row.appendChild(tag);
    }
    list.appendChild(row);
  });
  box.appendChild(list);
}

/* ===================== "What to do next" coach ===================== */
/* Persistent (but dismissible) guidance card under each module's phase
 * stepper. Reads observable platform state — findings count, synthesis
 * unlock status, group-answers per bullet, role-picker selection — and
 * updates the coach text + optional action buttons accordingly. Also
 * drives the live highlight of the phase stepper (is-current / is-done
 * per chip). Wired from every render path that changes the state the
 * coach reads from. */

const COACH_DISMISS_KEY_A = "canamed_coach_dismissed_modA";
const COACH_DISMISS_KEY_B = "canamed_coach_dismissed_modB";

function _coachDismissed(key) {
  try { return localStorage.getItem(key) === "1"; } catch (e) { return false; }
}
function _coachSetDismissed(key) {
  try { localStorage.setItem(key, "1"); } catch (e) {}
}

/* i18n fallback for translator that may not be loaded yet (very early
 * boot). Returns the EN default string if window.t isn't available. */
function _coachT(key, fallback) {
  if (typeof window.t === "function") {
    const v = window.t(key);
    // t() returns the key itself when missing — use fallback in that case
    if (v && v !== key) return v;
  }
  return fallback;
}

/* Apply the is-current / is-done classes to the phase stepper chips
 * under the given stage. `currentPhase` is the data-phase value of
 * the active chip; `donePhases` is an array of data-phase values
 * already complete. Both can be null/empty. */
function setPhaseStepperState(stageId, currentPhase, donePhases) {
  const root = document.getElementById(stageId);
  if (!root) return;
  const chips = root.querySelectorAll(".phase-step");
  const doneSet = new Set(donePhases || []);
  chips.forEach(chip => {
    const phase = chip.getAttribute("data-phase");
    chip.classList.toggle("is-current", phase === currentPhase);
    chip.classList.toggle("is-done", doneSet.has(phase));
  });
}

/* Render an optional action button inside the coach actions slot.
 * Resets the slot first so repeated calls don't accumulate buttons. */
function _coachSetAction(actionsEl, labelKey, fallbackLabel, onClick) {
  if (!actionsEl) return;
  actionsEl.innerHTML = "";
  if (!labelKey) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = _coachT(labelKey, fallbackLabel);
  btn.addEventListener("click", onClick);
  actionsEl.appendChild(btn);
}

/* Compute current state for Module A and update the coach card +
 * phase stepper accordingly. Called from renderFindings, renderPrompts,
 * renderAnswers, switchRcolTab, and on first room entry. */
function updateModANextStep() {
  const coach = el("modA-next-step");
  if (!coach) return;
  if (_coachDismissed(COACH_DISMISS_KEY_A)) {
    coach.classList.add("hidden");
    // The phase stepper update still happens — students who dismiss
    // the verbose coach still benefit from the live stepper highlight.
  } else {
    coach.classList.remove("hidden");
  }
  const textEl = el("modA-next-step-text");
  const actionsEl = el("modA-next-step-actions");

  // Read observable state.
  const revealedCount = ITEM_IDS.filter(id => revealed[id]).length;
  const keyDone = (typeof keyRevealed === "function") ? keyRevealed() : false;
  const onDiscussion = activeRcolTab === "discussion";
  const onAnswers = activeRcolTab === "answers";
  const modAAnswerEntries = Object.keys(answers.moduleA || {})
    .map(k => answers.moduleA[k]).filter(Boolean);
  const bulletsCovered = new Set(
    modAAnswerEntries.map(e => e.bulletKey).filter(Boolean)
  );
  const allBulletsCovered = ["plan", "differ", "disagree", "takehome"]
    .every(k => bulletsCovered.has(k));

  // Hypothesis-first scaffold: if the team has gathered enough info
  // to form a hypothesis (≥3 findings) but hasn't recorded one yet,
  // nudge them to add one. Investigations are gated on this.
  const hypoCount = (typeof hypothesisCount === "function") ? hypothesisCount() : 0;

  // State machine (highest-priority match wins).
  if (revealedCount === 0) {
    textEl.textContent = _coachT("modA.coach.read-case",
      "Read the case below, then tap any button on the left (Ask the patient / " +
      "Examine / Investigations) to start gathering info.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-1", "setup", []);
  } else if (revealedCount >= 2 && hypoCount === 0) {
    textEl.textContent = _coachT("modA.coach.add-hypothesis",
      "You've gathered some info — now agree on at least one working hypothesis " +
      "above (what do you suspect?). Investigations unlock once you have one.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-1", "case", ["setup"]);
  } else if (!keyDone) {
    textEl.textContent = _coachT("modA.coach.gather",
      "Keep gathering case info — when you're ready, complete the clinical " +
      "synthesis (red-flag review) to unlock the Discussion prompts.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-1", "case", ["setup"]);
  } else if (!onDiscussion && !onAnswers && modAAnswerEntries.length === 0) {
    textEl.textContent = _coachT("modA.coach.open-discussion",
      "✓ Synthesis done! Open Discussion to start the Exchange. " +
      "Make sure both Caen and Nagoya voices speak on each compare prompt.");
    _coachSetAction(actionsEl, "modA.coach.btn.open-discussion", "Open Discussion →",
      () => { if (typeof switchRcolTab === "function") switchRcolTab("discussion"); });
    setPhaseStepperState("stage-1", "exchange", ["setup", "case"]);
  } else if (onDiscussion && modAAnswerEntries.length === 0) {
    textEl.textContent = _coachT("modA.coach.in-discussion",
      "Debate the prompts with your group — when you're ready, open Group answers " +
      "to capture your 4 bullets.");
    _coachSetAction(actionsEl, "modA.coach.btn.open-answers", "Open Group answers →",
      () => { if (typeof switchRcolTab === "function") switchRcolTab("answers"); });
    setPhaseStepperState("stage-1", "exchange", ["setup", "case"]);
  } else if (modAAnswerEntries.length > 0 && !allBulletsCovered) {
    const remaining = 4 - bulletsCovered.size;
    const tpl = _coachT("modA.coach.bullets-partial",
      "Capturing bullets — {n} still to add to cover all 4.");
    textEl.textContent = tpl.replace("{n}", String(remaining));
    _coachSetAction(actionsEl, onAnswers ? null : "modA.coach.btn.open-answers", "Open Group answers →",
      () => { if (typeof switchRcolTab === "function") switchRcolTab("answers"); });
    setPhaseStepperState("stage-1", "bullets", ["setup", "case", "exchange"]);
  } else if (allBulletsCovered) {
    textEl.textContent = _coachT("modA.coach.bullets-complete",
      "✓ All 4 bullets covered. Add more refinements or wait for your facilitator.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-1", "bullets", ["setup", "case", "exchange"]);
  } else {
    // catch-all: fall back to the generic next-step text
    textEl.textContent = _coachT("modA.coach.gather",
      "Keep gathering case info — when you're ready, complete the clinical " +
      "synthesis to unlock the Discussion prompts.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-1", "case", ["setup"]);
  }
}

function updateModBNextStep() {
  const coach = el("modB-next-step");
  if (!coach) return;
  if (_coachDismissed(COACH_DISMISS_KEY_B)) {
    coach.classList.add("hidden");
  } else {
    coach.classList.remove("hidden");
  }
  const textEl = el("modB-next-step-text");
  const actionsEl = el("modB-next-step-actions");

  let rolePicked = null;
  try {
    rolePicked = localStorage.getItem("canamed_modB_role");
  } catch (e) { /* private mode — treat as not picked */ }

  const modBAnswerEntries = Object.keys(answers.moduleB || {})
    .map(k => answers.moduleB[k]).filter(Boolean);
  const bulletsCovered = new Set(
    modBAnswerEntries.map(e => e.bulletKey).filter(Boolean)
  );
  const allBulletsCovered = ["family-sentence", "differ-converge", "practice-change"]
    .every(k => bulletsCovered.has(k));

  if (!rolePicked) {
    textEl.textContent = _coachT("modB.coach.pick-role",
      "Pick your role below before starting the roleplay. The observer keeps time.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-2", "setup", []);
  } else if (modBAnswerEntries.length === 0) {
    textEl.textContent = _coachT("modB.coach.roleplay",
      "Roles set! Run the scene — Phase 2 is the roleplay, Phase 3 is the discussion " +
      "with the prompts below.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-2", "play", ["setup"]);
  } else if (!allBulletsCovered) {
    const remaining = 3 - bulletsCovered.size;
    const tpl = _coachT("modB.coach.bullets-partial",
      "Capturing bullets — {n} still to add to cover all 3.");
    textEl.textContent = tpl.replace("{n}", String(remaining));
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-2", "bullets", ["setup", "play", "exchange"]);
  } else {
    textEl.textContent = _coachT("modB.coach.bullets-complete",
      "✓ All 3 bullets covered. Add more refinements or wait for your facilitator.");
    _coachSetAction(actionsEl, null);
    setPhaseStepperState("stage-2", "bullets", ["setup", "play", "exchange"]);
  }
}

/* Wire the × dismiss buttons on both coach cards. Idempotent (uses
 * a _wired flag) so repeated wireRoomUI calls don't stack handlers. */
function initCoachDismiss() {
  const wire = (btnId, key, coachId) => {
    const btn = el(btnId);
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener("click", () => {
      _coachSetDismissed(key);
      const c = el(coachId);
      if (c) c.classList.add("hidden");
    });
  };
  wire("modA-next-step-dismiss", COACH_DISMISS_KEY_A, "modA-next-step");
  wire("modB-next-step-dismiss", COACH_DISMISS_KEY_B, "modB-next-step");
}

/* ===================== WORKING HYPOTHESES (PBL 7-jump scaffold) ===================== */
/* Cross-room synced (refHypotheses). Students MUST agree on at least
 * one hypothesis before Investigations unlock — this enforces the
 * classical PBL "brainstorm BEFORE data gathering" step, the missing
 * pedagogical move the 2026-05-18 specialist panel flagged. */

function hypothesisCount() {
  return Object.keys(hypotheses || {}).length;
}
/* Investigations unlock gate — was "≥1 hypothesis recorded" (a gate
 * satisfiable by typing 'back pain' to unlock the panel; trained
 * gaming, not reasoning). Specialist panel 2026-05-19 recommended
 * extending it to ALSO require the red-flag screen: history:1
 * (serious-cause screen), history:2 (cauda equina screen), exam:3
 * (leg neuro). The same items SYNTH_PREREQS already enforces for the
 * synthesis step — applying them earlier means students cannot
 * order an MRI without first ruling out the emergencies NICE NG59
 * is written to catch. */
function redFlagScreenDone() {
  const need = ["history:1", "history:2", "exam:3"];
  return need.every(id => !!revealed[id]);
}
function hypothesesUnlocked() {
  return hypothesisCount() > 0 && redFlagScreenDone();
}

/* "First impressions (optional)" — sim 2026-05-19 UX-practitioner
 * recommendation. A small textarea at the top of the Module A chart
 * that lets a Y3/first-timer note their gut-feel BEFORE asking the
 * patient anything. Per-tab only (localStorage); never written to
 * Firebase, never shown to teammates, never assessed — the entire
 * purpose is to give the student a place to externalise their first
 * guess so they have something to refine after History + Exam.
 * Keyed per session+room so it doesn't bleed across sessions. */
function initImpressions() {
  const ta = el("impressions-input");
  if (!ta || ta._wired) return;
  ta._wired = true;
  const key = "canamed_impressions:" + (sessionNum || "?") + ":" + (myRoom || "?");
  try {
    const prev = localStorage.getItem(key);
    if (prev) ta.value = prev;
  } catch (e) { /* private mode — non-fatal */ }
  ta.addEventListener("input", () => {
    try { localStorage.setItem(key, ta.value); } catch (e) {}
  });
}

function initHypotheses() {
  const input = el("hypothesis-input");
  const btn = el("hypothesis-add-btn");
  if (!input || !btn || btn._wired) return;
  btn._wired = true;
  // Wire the sibling "first impressions" textarea while we're here —
  // they share a setup phase in Module A.
  initImpressions();
  const submit = () => {
    const text = (input.value || "").trim().slice(0, 160);
    if (!text || !refHypotheses) return;
    refHypotheses.push({
      by: myName, cid: clientId,
      university: myUniversity || "",
      text: text, at: Date.now()
    })
      .then(() => { input.value = ""; })
      .catch(e => console.error("hypothesis push failed", e));
    if (typeof logEvent === "function") {
      logEvent(myRoom, "hypothesis", {
        by: myName, university: myUniversity || "", len: text.length
      });
    }
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
}

function deleteHypothesis(id) {
  if (!refHypotheses) return;
  refHypotheses.child(id).remove().catch(e => {
    console.error("hypothesis delete failed", e);
  });
}

function renderHypotheses() {
  const list = el("hypothesis-list");
  const empty = el("hypothesis-empty");
  if (!list) return;
  list.innerHTML = "";
  const ids = Object.keys(hypotheses || {}).sort((a, b) =>
    (hypotheses[a].at || 0) - (hypotheses[b].at || 0));
  if (empty) empty.classList.toggle("hidden", ids.length > 0);
  ids.forEach(id => {
    const h = hypotheses[id];
    if (!h) return;
    const li = document.createElement("li");
    const txt = document.createElement("span");
    txt.textContent = h.text || "";
    li.appendChild(txt);
    const by = document.createElement("span");
    by.className = "by";
    by.textContent = "— " + (h.by || "?");
    li.appendChild(by);
    if (h.cid === clientId) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "×";
      del.setAttribute("aria-label", "Remove this hypothesis");
      del.addEventListener("click", () => deleteHypothesis(id));
      li.appendChild(del);
    }
    list.appendChild(li);
  });
  // Investigations gate — visible lock state on the panel.
  const inv = el("chart-investigations");
  const hint = el("investigations-locked-hint");
  const unlocked = hypothesesUnlocked();
  if (inv) inv.classList.toggle("is-locked", !unlocked);
  if (hint) hint.classList.toggle("hidden", unlocked);
}

/* Module B role picker (local-only). The HTML chips are radio buttons;
 * clicking one toggles its aria-checked=true and unsets all siblings.
 * Local state persists in localStorage so a refresh during the roleplay
 * doesn't lose the assignment. Cross-room sync (everyone seeing each
 * other's picks) is a future PR. Idempotent — safe to call on every
 * wireRoomUI invocation; uses a `_wired` flag to bind once. */
/* Reveal the picked role's brief in the PRIVATE objective panel — only on the
   device of the student who chose it. The role chips deliberately show just the
   NAME now (printing the full brief on every chip leaked the patient's hidden
   stance and the family's secret request to the physician before the scene).
   Reuses the role's existing modB.role.<role>.brief key: we point the panel's
   text node at that key and re-run applyI18n so the brief renders sanitised
   (DOMPurify, via the data-i18n-html path) AND stays translated when the user
   switches language (the global applyI18n() re-touches this node like any
   other). Passing a falsy role hides the panel (no role held). */
function showRoleObjective(role) {
  if (typeof document === "undefined") return;
  const panel = el("modB-role-objective");
  if (!panel) return;
  const textEl = el("modB-role-objective-text");
  if (role && textEl) {
    const key = "modB.role." + role + ".brief";
    textEl.setAttribute("data-i18n", key);
    textEl.setAttribute("data-i18n-html", "");
    if (typeof window !== "undefined" && typeof window.applyI18n === "function") {
      window.applyI18n(panel);   // sanitised innerHTML + language-aware
    } else if (typeof window !== "undefined" && typeof window.t === "function") {
      textEl.textContent = window.t(key);  // no-DOM/no-i18n fallback (loses emphasis, still safe)
    }
    panel.classList.remove("hidden");
  } else {
    if (textEl) {
      textEl.removeAttribute("data-i18n");
      textEl.removeAttribute("data-i18n-html");
      textEl.textContent = "";
    }
    panel.classList.add("hidden");
  }
}

function initRolePicker() {
  const picker = el("modB-role-picker");
  if (!picker || picker._wired) return;
  picker._wired = true;
  const chips = picker.querySelectorAll(".role-chip");
  const STORAGE_KEY = "canamed_modB_role";
  // restore saved selection
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      chips.forEach(c => c.setAttribute("aria-checked",
        c.dataset.role === saved ? "true" : "false"));
      showRoleObjective(saved);   // re-show the restored role's private brief
    }
  } catch (e) { /* localStorage may be blocked; OK */ }
  // Single selection routine shared by click AND arrow keys. Per the
  // WAI-ARIA radiogroup pattern (round4-a11y Rec 3 / WCAG 2.1.1) arrow
  // keys must MOVE focus AND SELECT — previously they only moved focus,
  // so the role never committed unless the user also pressed Space/Enter.
  const select = chip => {
    chips.forEach(c => c.setAttribute("aria-checked", "false"));
    chip.setAttribute("aria-checked", "true");
    showRoleObjective(chip.dataset.role);   // reveal MY private brief only
    try { localStorage.setItem(STORAGE_KEY, chip.dataset.role); } catch (e) {}
    // Publish my pick so the room sees it live (double-claim becomes visible).
    // Best-effort: keyed by clientId, the rule lets me write only my own slot.
    // No-op in LOCAL/solo mode or before a room exists. Living inside select()
    // means arrow-key selection syncs too, not just clicks.
    try {
      if (refRoleChoices && clientId && !isRoomAdmin) {
        refRoleChoices.child(clientId).set({
          role: chip.dataset.role, name: myName || "", at: Date.now()
        });
      }
    } catch (e) { /* offline / rules — local pick still stands */ }
    // Coach updates: role-picked drives Module B's setup→play transition.
    if (typeof updateModBNextStep === "function") updateModBNextStep();
  };
  // Allow UN-selecting a role (dry-run: "allow unselecting a role"). Re-tapping
  // the role you already hold clears it — back to no role — and retracts the
  // live pick so the room no longer shows you in it. Keyboard navigation stays
  // select-only (the APG radio pattern); only a pointer re-tap toggles off.
  const deselect = chip => {
    chip.setAttribute("aria-checked", "false");
    showRoleObjective(null);   // no role held → hide the private brief
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    try {
      if (refRoleChoices && clientId && !isRoomAdmin) refRoleChoices.child(clientId).remove();
    } catch (e) { /* offline / rules — the local clear still stands */ }
    if (typeof updateModBNextStep === "function") updateModBNextStep();
  };
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      if (chip.getAttribute("aria-checked") === "true") deselect(chip);
      else select(chip);
    });
    // arrow-key navigation inside the radiogroup — select-on-move
    chip.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const list = Array.from(chips);
      const i = list.indexOf(chip);
      const next = list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length];
      next.focus();
      select(next);   // move AND select, matching the APG radio pattern
    });
  });
  // Swap-and-replay: wire the round button + seed local round state so
  // LOCAL/solo mode can advance rounds without a Firebase listener.
  wireSwapReplay();
  // "I'd rather observe" panic affordance — a calm one-tap escape hatch.
  wireObserveEscape();
}

/* "I'd rather observe" panic affordance: one calm tap moves the student into
   the observer role (reusing the role-pick sync so the change propagates and
   the coach updates) and shows a reassuring, no-judgment note. Always
   available — the safety-note promises this exit, this makes it one tap. */
function wireObserveEscape() {
  const btn = el("modB-observe-instead-btn");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", () => {
    const picker = el("modB-role-picker");
    const observerChip = picker && picker.querySelector('.role-chip[data-role="observer"]');
    // Reuse the chip-select path so the pick syncs + coach hooks fire.
    if (observerChip) observerChip.click();
    const note = el("modB-observe-reassure");
    if (note) {
      note.textContent = _swapT("modB.observe.reassure",
        "That's completely fine — you're observing now. Watch the SPIKES steps, and step back in whenever you're ready.");
      note.classList.remove("hidden");
    }
  });
}

/* Render the room's live role picks onto the chips. `map` is
 * { clientId: { role, name, at } } from refRoleChoices. Each chip shows the
 * names of who picked it; if two+ students pick the same role, the chip is
 * flagged and a shared "decide together" note appears. Names go through
 * textContent (never innerHTML) so a participant-supplied name can't inject
 * markup. No-op when the picker isn't mounted (e.g. not on Module B). */
function renderRoleChoices(map) {
  const picker = el("modB-role-picker");
  if (!picker) return;
  const byRole = {};
  Object.keys(map || {}).forEach(cid => {
    const c = map[cid];
    if (!c || typeof c.role !== "string") return;
    (byRole[c.role] = byRole[c.role] || []).push(
      (typeof c.name === "string" && c.name.trim()) ? c.name.trim() : "—");
  });
  let anyClash = false;
  picker.querySelectorAll(".role-chip").forEach(chip => {
    const names = byRole[chip.dataset.role] || [];
    const clash = names.length > 1;
    if (clash) anyClash = true;
    chip.classList.toggle("role-claimed", names.length > 0);
    chip.classList.toggle("role-clash", clash);
    let slot = chip.querySelector(".role-chip-claimants");
    if (!slot) {
      slot = document.createElement("span");
      slot.className = "role-chip-claimants";
      chip.appendChild(slot);
    }
    slot.textContent = names.length ? names.join(", ") : "";
  });
  const note = el("role-clash-note");
  if (note) note.classList.toggle("hidden", !anyClash);
}

/* ── Swap-and-replay loop (Module B) ──────────────────────────────────────
   After a roleplay round the room rotates roles and replays the scene from
   the other side — where the cross-perspective empathy learning happens.
   Rotation: physician → patient → family → observer → physician. Any member
   advances the round (synced via <base>/roleplayRound); each client rotates
   ITS OWN pick only, so no cross-client writes or extra privilege are needed.
   Works in LOCAL/solo mode (no listener — the button applies the bump here). */
const REPLAY_ROLE_ORDER = ["physician", "patient", "family", "observer"];

function _swapT(key, fallback) {
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const v = window.t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

/* Rotate a role by `steps` around the 4-role cycle. Unknown/unpicked → unchanged. */
function rotateRole(role, steps) {
  const i = REPLAY_ROLE_ORDER.indexOf(role);
  if (i < 0) return role;
  const n = REPLAY_ROLE_ORDER.length;
  return REPLAY_ROLE_ORDER[(i + ((steps % n) + n)) % n];
}

/* Wire the "Swap roles & replay" button and seed local round state. */
function wireSwapReplay() {
  const btn = el("modB-swap-replay-btn");
  if (!btn || btn._wired) { renderReplayRound(replayRound); return; }
  btn._wired = true;
  // No roleplayRound listener exists in LOCAL/solo mode, so mark the round
  // state ready here; shared mode flips this on its first synced snapshot.
  if (MODE !== "shared") replayRoundReady = true;
  btn.addEventListener("click", bumpReplayRound);
  renderReplayRound(replayRound);
}

/* Advance to the next round. Shared mode writes <base>/roleplayRound (the
   listener then drives every client's own rotation); LOCAL applies it here. */
function bumpReplayRound() {
  const next = replayRound + 1;
  if (next > REPLAY_ROLE_ORDER.length) {
    if (typeof toast === "function") {
      toast(_swapT("modB.replay.full",
        "Everyone has now played every role — nicely done."));
    }
    return;
  }
  if (MODE === "shared" && refReplayRound) {
    refReplayRound.set(next).catch(() => { handleReplayRound(next, false); });
  } else {
    handleReplayRound(next, false);
  }
}

/* Apply a round value (from sync or local). Rotates this client's own role
   ONLY on a real increment after the baseline round is known — a late joiner
   landing straight into round 2 must NOT rotate on arrival. */
function handleReplayRound(round, fromSync) {
  round = (typeof round === "number" && round >= 1 && round <= REPLAY_ROLE_ORDER.length)
    ? round : 1;
  const prev = replayRound;
  const wasReady = replayRoundReady;
  replayRound = round;
  replayRoundReady = true;
  renderReplayRound(round);
  if (wasReady && round > prev) applyRoleSwap(round - prev, round);
}

/* Rotate THIS client's own role chip by `steps` and show a reflective banner.
   Writes only the client's own roleChoices node (shared mode). */
function applyRoleSwap(steps, round) {
  const picker = el("modB-role-picker");
  if (!picker) return;
  const chips = Array.from(picker.querySelectorAll(".role-chip"));
  let cur = null;
  chips.forEach(c => { if (c.getAttribute("aria-checked") === "true") cur = c.dataset.role; });
  if (!cur) { try { cur = localStorage.getItem("canamed_modB_role"); } catch (e) {} }
  const next = cur ? rotateRole(cur, steps) : null;
  if (next) {
    chips.forEach(c =>
      c.setAttribute("aria-checked", c.dataset.role === next ? "true" : "false"));
    showRoleObjective(next);   // swap-and-replay: reveal the rotated role's brief
    try { localStorage.setItem("canamed_modB_role", next); } catch (e) {}
    try {
      if (MODE === "shared" && refRoleChoices && clientId && !isRoomAdmin) {
        refRoleChoices.child(clientId).set({ role: next, name: myName || "", at: Date.now() });
      }
    } catch (e) { /* offline — local pick still stands */ }
    if (typeof updateModBNextStep === "function") updateModBNextStep();
  }
  showSwapBanner(cur, next, round);
}

/* The "you've swapped seats" reflective banner — names the roles in the
   active language and prompts the cross-perspective reflection. */
function showSwapBanner(oldRole, newRole, round) {
  const banner = el("modB-replay-banner");
  if (!banner) return;
  const roleName = (r) => r ? _swapT("modB.role." + r + ".name", r) : "";
  const lead = _swapT("modB.replay.swapped",
    "You've swapped seats — notice how the conversation feels from here.");
  let line = lead;
  if (oldRole && newRole) {
    line = _swapT("modB.replay.fromto", "You were the {old} — now you're the {new}.")
      .replace("{old}", roleName(oldRole)).replace("{new}", roleName(newRole)) + " " + lead;
  }
  banner.textContent = "🔄 " + _swapRoundLabel(round) + " — " + line;
  banner.classList.remove("hidden");
}

function renderReplayRound(round) {
  const ind = el("modB-replay-round");
  if (ind) ind.textContent = _swapRoundLabel(round);
}

function _swapRoundLabel(round) {
  if (round <= 1) return _swapT("modB.replay.round1", "Round 1 — first run");
  return _swapT("modB.replay.roundN", "Round {n}").replace("{n}", String(round));
}

/* Save the room's chosen team name (any room member may set it).
 * Idempotent: protected by _wired so repeated wireRoomUI calls don't
 * stack handlers. User-visible feedback for EVERY failure path —
 * the previous version silently returned when the input was empty,
 * when refTeamName wasn't ready yet, or when the Firebase write
 * failed, so clicking "Save name" felt like "nothing happens"
 * (user report 2026-05-18). */
function initTeamName() {
  const btn = el("team-name-btn"), inp = el("team-name-input");
  if (!btn || !inp || btn._wired) return;
  btn._wired = true;
  const _t = (key, fallback) => {
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const v = window.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  };
  const save = () => {
    const v = (inp.value || "").trim().slice(0, 32);
    if (!v) {
      // Empty input — flash the input + toast a hint. No silent return.
      inp.focus();
      inp.classList.add("input-empty-flash");
      setTimeout(() => inp.classList.remove("input-empty-flash"), 600);
      if (typeof toast === "function") {
        toast(_t("room.team-name.empty", "Type a team name first."));
      }
      return;
    }
    if (!refTeamName) {
      // Not in a room yet (rare race) — tell the user instead of silently
      // dropping the save.
      if (typeof toast === "function") {
        toast(_t("room.team-name.not-ready", "Not ready yet — try again in a second."));
      }
      return;
    }
    // Optimistic UX: dim the button + show a "saving…" state so the
    // user knows the click was registered before the round-trip completes.
    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = _t("room.team-name.saving", "Saving…");
    refTeamName.set(v)
      .then(() => {
        btn.disabled = false;
        btn.textContent = origLabel;
        if (typeof toast === "function") {
          toast(_t("room.team-name.saved", "Team name saved —") + " " + v);
        }
      })
      .catch(e => {
        btn.disabled = false;
        btn.textContent = origLabel;
        console.error("Team name save failed", e);
        if (typeof toast === "function") {
          toast(_t("room.team-name.error",
            "Could not save the team name — check your connection and try again."));
        }
      });
  };
  btn.addEventListener("click", save);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
}
function initReset() {
  el("reset-btn").addEventListener("click", () => {
    if (!refRevealed) return;
    if (!confirm("Clear this room's case findings for everyone?")) return;
    refRevealed.remove();
  });
}

/* ===================== ROOM VIEW: PRESENCE ===================== */
function renderPresence() {
  const bar = el("presence-bar");
  bar.innerHTML = "";
  const people = Object.keys(presence)
    .map(cid => ({ cid: cid, name: presence[cid].name }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (people.length === 0) {
    const s = document.createElement("span");
    s.className = "empty"; s.textContent = isRoomAdmin ? "empty" : "Just you.";
    bar.appendChild(s); return;
  }
  people.forEach(p => {
    const isMe = p.cid === clientId;
    bar.appendChild(makeChip(p.name, p.name + (isMe ? " (you)" : ""),
      isMe ? "chip me" : "chip"));
  });
}

/* ===================== ROOM VIEW: COLLABORATIVE ANSWERS ===================== */
/* a gentle, live "how are we doing" line under each answers box - confirmation
   only, never correction, and never reveals the keyword matcher */
function renderAnswerHints(moduleKey) {
  const hintEl = el(moduleKey === "moduleA" ? "answersA-hint" : "answersB-hint");
  if (!hintEl) return;
  const entries = Object.keys(answers[moduleKey] || {})
    .map(k => answers[moduleKey][k]).filter(Boolean);
  const unis = {};
  entries.forEach(e => {
    if (e.university && String(e.text || "").trim().length >= 12) unis[e.university] = true;
  });
  const i18nT = (typeof window !== "undefined" && typeof window.t === "function")
    ? window.t
    : ((k) => k);
  const countKey = entries.length === 1
    ? "room.answers.hint.count-one"
    : "room.answers.hint.count-many";
  const bits = [];
  bits.push(i18nT(countKey).replace("{n}", entries.length));
  if (unis.Caen && unis.Nagoya) bits.push(i18nT("room.answers.hint.both-wrote"));
  else if (unis.Caen || unis.Nagoya) bits.push(i18nT("room.answers.hint.one-wrote"));
  hintEl.textContent = bits.join("  ·  ") + ".  " + i18nT("room.answers.hint.suffix");
}
let lastAnswerCount = { moduleA: 0, moduleB: 0 };

/* Bullet-key validators per module: any entry whose `bulletKey` is not in
 * this set falls through to the "_unsorted" bucket (typically: legacy
 * pre-refactor entries that have no bulletKey at all, or future bullet
 * keys not yet known to the running client). Keep in sync with the HTML
 * data-bullet-key attributes in index.html. */
const ANSWER_BULLETS = {
  moduleA: ["plan", "differ", "disagree", "takehome"],
  moduleB: ["family-sentence", "differ-converge", "practice-change"]
};

function renderAnswers(moduleKey) {
  renderContrib();
  renderAnswerHints(moduleKey);
  checkScoreEvents();
  // Coach updates: answers drive the module's "bullets" phase highlight.
  if (moduleKey === "moduleA" && typeof updateModANextStep === "function") updateModANextStep();
  if (moduleKey === "moduleB" && typeof updateModBNextStep === "function") updateModBNextStep();
  // tab badge for the Module A "Group answers" tab in the right column
  if (moduleKey === "moduleA") {
    const n = Object.keys(answers.moduleA || {}).length;
    setTabBadge("tab-badge-answers", n || "");
    if (n > (lastAnswerCount.moduleA || 0)) nudgeRcolTab("answers");
    lastAnswerCount.moduleA = n;
    // Refresh the per-bullet checklist at the top of Module A
    // (sim 2026-05-19 feature for `methodical` personas).
    _updateModABulletProgress();
  }

  // The form is now a set of per-bullet sections; gather the entries
  // for each bullet's <ul> separately. Anything without a recognised
  // bulletKey lands in `_unsorted` (legacy entries from before this
  // refactor, plus any future-bulletKey value not in ANSWER_BULLETS).
  const validBullets = ANSWER_BULLETS[moduleKey] || [];
  const buckets = {};
  validBullets.forEach(k => { buckets[k] = []; });
  buckets._unsorted = [];
  entriesSorted(answers[moduleKey]).forEach(entry => {
    const key = entry.bulletKey;
    if (key && validBullets.indexOf(key) !== -1) buckets[key].push(entry);
    else buckets._unsorted.push(entry);
  });

  // Render each bucket into its own <ul>. Hide the unsorted section when
  // empty (it only matters for legacy data).
  Object.keys(buckets).forEach(bulletKey => {
    const list = el("answers-list-" + moduleKey + "-" + bulletKey);
    if (!list) return;
    if (list._editing) { list._pendingRender = true; return; }
    list._pendingRender = false;
    list.innerHTML = "";
    buckets[bulletKey].forEach(entry => {
      list.appendChild(buildAnswerLi(moduleKey, entry));
    });
    // toggle visibility of the unsorted wrapper card based on whether
    // there's anything to show. Real bullets always stay visible (so
    // students see their empty inputs).
    if (bulletKey === "_unsorted") {
      const wrap = list.closest(".answer-bullet-unsorted");
      if (wrap) wrap.classList.toggle("hidden", buckets._unsorted.length === 0);
    }
  });

  // back-compat: some legacy fallbacks (or future tests) may still look
  // for the original flat list element id; keep one if the page renders
  // it. Render the flat list as an aggregate of all buckets when present.
  const flatList = el("answers-list-" + moduleKey);
  if (flatList && !flatList._editing) {
    flatList.innerHTML = "";
    entriesSorted(answers[moduleKey]).forEach(entry => {
      flatList.appendChild(buildAnswerLi(moduleKey, entry));
    });
  }
}

/* Build a single answer <li>. Extracted from the original renderAnswers
 * so it's reusable across the per-bullet lists and the legacy flat list. */
function buildAnswerLi(moduleKey, entry) {
  const li = document.createElement("li");
  li.className = "answer-entry";
  li.dataset.entryId = entry.id || "";
  const dot = document.createElement("span");
  dot.className = "dot"; dot.style.background = colorFor(entry.by);
  const who = document.createElement("span");
  who.className = "answer-by"; who.textContent = entry.by;
  const txt = document.createElement("span");
  txt.className = "answer-text"; txt.textContent = entry.text;
  li.appendChild(dot); li.appendChild(who); li.appendChild(txt);
  if (entry.cid === clientId) {
    const editBtn = document.createElement("button");
    editBtn.className = "entry-act"; editBtn.textContent = "edit";
    editBtn.setAttribute("aria-label", "Edit your point");
    editBtn.addEventListener("click", () => editAnswer(moduleKey, entry, li));
    const delBtn = document.createElement("button");
    delBtn.className = "entry-act"; delBtn.textContent = "delete";
    delBtn.setAttribute("aria-label", "Delete your point");
    delBtn.addEventListener("click", () => deleteAnswer(moduleKey, entry.id));
    li.appendChild(editBtn); li.appendChild(delBtn);
  } else {
    // Sim 2026-05-19 (Akari, Antoine, Hugo, Sophie): "A 'disagree'
    // button on a teammate's answer that opens a counter-bullet —
    // keeps debate visible." Only render for SOMEONE ELSE's answer
    // (you can't disagree with yourself). Click opens an inline
    // textarea below this li; submit pushes to answerReplies/{entryId}.
    const disBtn = document.createElement("button");
    disBtn.className = "entry-act entry-disagree";
    disBtn.textContent = "disagree ↪";
    disBtn.setAttribute("aria-label",
      "Add a counter-point under " + entry.by + "'s answer");
    disBtn.addEventListener("click", () => openCounterBullet(entry, li, "disagree"));
    li.appendChild(disBtn);
    // ...and a matching "agree ↩" so debate isn't only dissent — quieter
    // students can amplify a point they back, not just challenge it. Same
    // inline form, stance="support" (rendered distinctly by is-support).
    const agreeBtn = document.createElement("button");
    agreeBtn.className = "entry-act entry-agree";
    agreeBtn.textContent = "agree ↩";
    agreeBtn.setAttribute("aria-label",
      "Add a supporting point under " + entry.by + "'s answer");
    agreeBtn.addEventListener("click", () => openCounterBullet(entry, li, "support"));
    li.appendChild(agreeBtn);
  }
  // Always render any existing counter-bullets under this answer.
  const repliesWrap = document.createElement("ul");
  repliesWrap.className = "answer-replies";
  repliesWrap.dataset.repliesFor = entry.id || "";
  li.appendChild(repliesWrap);
  _renderRepliesForEntry(entry.id, repliesWrap);
  return li;
}

/* Render counter-bullets (any { text, by, stance } entries under
 * answerReplies/{entryId}) into the supplied wrapper. Read-only;
 * deletion belongs to whoever wrote the reply (could be added later). */
function _renderRepliesForEntry(entryId, wrap) {
  if (!entryId || !wrap) return;
  wrap.innerHTML = "";
  const replies = (answerReplies && answerReplies[entryId]) || {};
  Object.keys(replies)
    .map(k => Object.assign({ id: k }, replies[k]))
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .forEach(r => {
      const li = document.createElement("li");
      li.className = "answer-reply " + (r.stance === "support" ? "is-support" : "is-disagree");
      const arrow = document.createElement("span");
      arrow.className = "reply-arrow"; arrow.textContent = "↪";
      const who = document.createElement("strong");
      who.textContent = (r.by || "?") + ":";
      const txt = document.createElement("span");
      txt.textContent = " " + (r.text || "");
      li.appendChild(arrow); li.appendChild(who); li.appendChild(txt);
      wrap.appendChild(li);
    });
}

/* Open an inline counter-bullet input under a teammate's answer.
 * Idempotent — calling twice on the same answer reuses the existing
 * input rather than stacking duplicates. */
function openCounterBullet(entry, li, stance) {
  if (!li || !entry || !entry.id) return;
  stance = (stance === "support") ? "support" : "disagree";
  const existing = li.querySelector(".counter-bullet-form");
  if (existing) {
    // already open — switch its stance (agree ↔ disagree) and refocus rather
    // than stacking a second form.
    _setCounterFormStance(existing, stance);
    const ta = existing.querySelector("textarea");
    if (ta) try { ta.focus(); } catch (e) {}
    return;
  }
  const form = document.createElement("div");
  form.className = "counter-bullet-form";
  const ta = document.createElement("textarea");
  ta.rows = 2;
  ta.maxLength = 400;
  const send = document.createElement("button");
  send.type = "button";
  send.className = "counter-send";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost-btn";
  cancel.textContent = tFallback("modal.cancel", "Cancel");
  form.appendChild(ta);
  form.appendChild(send);
  form.appendChild(cancel);
  li.appendChild(form);
  _setCounterFormStance(form, stance);   // sets placeholder/aria + send label + dataset
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 30);
  cancel.addEventListener("click", () => form.remove());
  send.addEventListener("click", () => {
    const text = (ta.value || "").trim();
    if (!text || !refAnswerReplies) return;
    send.disabled = true;
    refAnswerReplies.child(entry.id).push({
      text: text.slice(0, 400),
      by:   (myName || "anon").slice(0, 40),
      cid:  clientId,
      at:   Date.now(),
      stance: form.dataset.stance === "support" ? "support" : "disagree"
    }).then(() => { form.remove(); })
      .catch(() => { send.disabled = false; });
  });
}

/* Set (or switch) a counter-bullet form's stance — placeholder, aria-label
 * and send-button copy follow the stance, and the stance is stored on the
 * form so the submit handler tags the reply correctly. */
function _setCounterFormStance(form, stance) {
  if (!form) return;
  stance = (stance === "support") ? "support" : "disagree";
  form.dataset.stance = stance;
  form.classList.toggle("is-support", stance === "support");
  const ta = form.querySelector("textarea");
  const send = form.querySelector(".counter-send");
  if (stance === "support") {
    if (ta) {
      ta.placeholder = tFallback("answer.support.placeholder",
        "What would you add, or why do you agree?");
      ta.setAttribute("aria-label", tFallback("answer.support.aria", "Supporting point"));
    }
    if (send) send.textContent = tFallback("answer.support.send", "Add supporting point");
  } else {
    if (ta) {
      ta.placeholder = tFallback("answer.counter.placeholder",
        "Why do you see it differently?");
      ta.setAttribute("aria-label", tFallback("answer.counter.aria", "Counter-bullet"));
    }
    if (send) send.textContent = tFallback("answer.counter.send", "Send counter-point");
  }
}

/* `bulletKey` is optional — when present, the answer is tagged so the
 * structured form can group it under the matching bullet. Legacy
 * callers without a bulletKey still work (entries land in _unsorted on
 * render). */
function addAnswer(moduleKey, bulletKey) {
  // resolve the right input element: per-bullet form uses
  //   answer-input-{moduleKey}-{bulletKey}
  // legacy form uses
  //   answer-input-{moduleKey}
  const input = bulletKey
    ? el("answer-input-" + moduleKey + "-" + bulletKey)
    : el("answer-input-" + moduleKey);
  if (!input) return;
  const text = (input.value || "").trim();
  if (!text || !refAnswers[moduleKey]) return;
  clearTimeout(typingTimer);   // stop the pending "still typing" tick
  setTyping(null);
  // tag the author's university so the export is analysable for cross-cultural
  // balance (who from which country contributed which point). bulletKey is
  // included when present so structured answers carry their bucket.
  const payload = {
    by: myName, cid: clientId, university: myUniversity || "",
    text: text, at: Date.now()
  };
  if (bulletKey) payload.bulletKey = bulletKey;
  refAnswers[moduleKey].push(payload)
    .then(() => { input.value = ""; })
    .catch(() => { /* keep the text in the box so a failed write doesn't lose it */ });
  // append-only event log: NEVER include the answer body (see §3.4 of the
  // event-sourcing design — payload is metadata only: who, where, length).
  // bulletKey IS metadata so it's safe + useful for analysis.
  logEvent(myRoom, "answer." + moduleKey, {
    by: myName, university: myUniversity || "", len: text.length,
    bulletKey: bulletKey || ""
  });
}
/* Inline edit: swap the text span for an input (no native prompt() - it is
   modal, untranslatable and awkward on a projector / second language). */
function editAnswer(moduleKey, entry, li) {
  if (li.querySelector(".answer-edit")) return;
  const txtSpan = li.querySelector(".answer-text");
  if (!txtSpan) return;
  // The list element being edited is the entry's parent <ul> — the
  // legacy form had one flat list per module, the new bulleted form has
  // one per bullet (answers-list-{module}-{bullet}). Resolve via DOM
  // climb rather than a hardcoded id so both shapes work.
  const list = li.closest(".answers-list") || el("answers-list-" + moduleKey);
  if (list) list._editing = true;   // pause rebuilds while this edit is open
  const input = document.createElement("input");
  input.type = "text";
  input.className = "answer-edit";
  input.value = entry.text;
  input.maxLength = 500;
  let done = false;
  const save = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    const ref = refAnswers[moduleKey].child(entry.id);
    ref.once("value").then(snap => {
      const cur = snap.val();
      if (cur == null) { renderAnswers(moduleKey); return; }   // deleted meanwhile
      if (!v) return deleteAnswer(moduleKey, entry.id);
      const priorText = (cur && typeof cur.text === "string") ? cur.text : "";
      if (priorText === v) return;   // no-op edit — nothing to record
      // Research integrity (point 4): edits used to overwrite `text` in place,
      // losing a point's wording history. Snapshot the SUPERSEDED text into an
      // append-only `edits` log BEFORE overwriting, so researchers can see how
      // the group's reasoning evolved. `text` still holds the current value, so
      // every existing render/export path is unchanged.
      return ref.child("edits").push({ text: priorText, by: myName, at: Date.now() })
        .then(() => ref.child("text").set(v))
        .then(() => logEvent(myRoom, "answer.edit." + moduleKey, {
          by: myName, fromLen: priorText.length, toLen: v.length,
          bulletKey: (cur && cur.bulletKey) || ""
        }));
    }).catch(e => {
      console.error("Edit failed", e);
      alert(tFallback("room.answer.err.edit-failed",
        "Your edit could not be saved — check your connection. Your text: ")
        + v);
      renderAnswers(moduleKey);
    });
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); save(); input.blur(); }
    else if (e.key === "Escape") { done = true; input.blur(); }
  });
  // edit is over once the input blurs: clear the pause flag FIRST (so any
  // render triggered from inside save() can proceed), commit, then rebuild
  input.addEventListener("blur", () => {
    if (list) list._editing = false;
    save();
    renderAnswers(moduleKey);
  });
  txtSpan.replaceWith(input);
  input.focus();
  input.select();
}
function deleteAnswer(moduleKey, id) {
  const ref = refAnswers[moduleKey].child(id);
  // Research integrity: snapshot the body into the append-only
  // rooms/<room>/answersDeleted log BEFORE removing it, so a withdrawn point
  // is recoverable for analysis. This is deliberately a SEPARATE log (not an
  // in-place tombstone): the live answer still disappears from the room and
  // correctly stops contributing to scoring, while the text survives for
  // researchers. A metadata-only "answer.delete" event is also recorded in
  // the activity stream (no body there, per the event-sourcing privacy rule).
  return ref.once("value").then(snap => {
    const cur = snap.val();
    const archive = (cur && db && typeof myRoom === "string" && myRoom)
      ? db.ref(sPath("rooms/" + myRoom + "/answersDeleted")).push({
          text: (cur.text || ""), by: myName, module: moduleKey, at: Date.now(),
          cid: clientId, bulletKey: cur.bulletKey || "",
          university: cur.university || ""
        }).catch(e => { console.warn("answersDeleted archive failed", e && e.code); })
      : Promise.resolve();
    return Promise.resolve(archive)
      .then(() => ref.remove())
      .then(() => {
        if (cur) logEvent(myRoom, "answer.delete." + moduleKey, {
          by: myName, len: (cur.text || "").length, bulletKey: cur.bulletKey || ""
        });
      });
  }).catch(e => {
    console.error("Delete failed", e);
    alert(tFallback("room.answer.err.delete-failed",
      "That point could not be deleted — check your connection and try again."));
  });
}
let typingTimer = null;
function setTyping(moduleKey) {
  if (!refTyping || isRoomAdmin) return;
  refTyping.child(clientId).set(moduleKey || null);
}
function renderTyping() {
  ["moduleA", "moduleB"].forEach(moduleKey => {
    const line = el("typing-" + moduleKey);
    if (!line) return;
    const n = Object.keys(typingState)
      .filter(cid => cid !== clientId && typingState[cid] === moduleKey).length;
    if (n > 0) {
      line.textContent = n === 1 ? "Someone is writing…" : n + " people are writing…";
      line.classList.remove("hidden");
    } else {
      line.classList.add("hidden");
    }
  });
}
function initAnswers() {
  // Every "Add" button carries data-mod + (optional) data-bullet-key.
  // The legacy flat form uses no data-bullet-key; the new bulleted form
  // tags it. addAnswer() handles both cases.
  document.querySelectorAll(".answer-add-btn").forEach(btn => {
    btn.addEventListener("click", () => addAnswer(btn.dataset.mod, btn.dataset.bulletKey));
  });
  const i18nT = (typeof window !== "undefined" && typeof window.t === "function")
    ? window.t
    : ((k) => k);
  // Wire every input under .answer-add: typing indicator + Enter-to-submit.
  // Each per-bullet input has its own id pattern answer-input-{mod}-{bullet};
  // the legacy flat input is answer-input-{mod}. We iterate the rendered
  // .answer-add wrappers so both shapes are covered.
  document.querySelectorAll(".answer-add").forEach(addRow => {
    const input = addRow.querySelector("input[id^='answer-input-']");
    const btn = addRow.querySelector(".answer-add-btn");
    if (!input || !btn) return;
    const moduleKey = btn.dataset.mod;
    const bulletKey = btn.dataset.bulletKey;
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") addAnswer(moduleKey, bulletKey);
    });
    input.addEventListener("input", () => {
      setTyping(moduleKey);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(null), 2500);
    });
    input.addEventListener("blur", () => setTyping(null));
    // The legacy flat input had its placeholder set programmatically (no
    // data-i18n-attr). Keep doing so only for the legacy element so the
    // new per-bullet inputs (which DO use data-i18n-attr="placeholder")
    // aren't double-set.
    if (!bulletKey) {
      input.setAttribute("placeholder", i18nT("room.answer-input-placeholder"));
    }
  });
  // initial hint text; renderAnswerHints keeps it live as answers come in.
  // Element may be absent on a stripped-down test fixture; guard for that.
  const hintA = el("answersA-hint");
  if (hintA) hintA.textContent = i18nT("room.answers.hint.moduleA");
  const hintB = el("answersB-hint");
  if (hintB) hintB.textContent = i18nT("room.answers.hint.moduleB");
}

/* ===================== MISC ===================== */
/* move keyboard focus to the new view's heading on every view transition */
function focusHeading(containerId) {
  const c = el(containerId);
  if (!c) return;
  const h = c.querySelector("h1, h2, h3");
  if (h) { h.setAttribute("tabindex", "-1"); try { h.focus(); } catch (e) {} }
}
function setHeaderBadge() {
  const e = el("header-right");
  if (isRoomAdmin) {
    e.textContent = (role === "superadmin" ? "Super admin" : "Admin") +
      " · Session " + sessionNum + " · " + myRoom;
  } else {
    e.textContent = "Session " + sessionNum + " · " + myRoom;
  }
  e.className = MODE === "shared" ? "mode-badge shared" : "mode-badge solo";
}
function leaveAndReload() {
  try {
    // clear everything identifying - lab machines are shared between students
    localStorage.removeItem(RESUME_KEY);
    localStorage.removeItem("canamed_name");
    localStorage.removeItem("canamed_session");
    localStorage.removeItem("canamed_client");
    // R2-24/25: also clear the localStorage-backed stableId on leave so a
    // shared lab machine doesn't carry the previous student's persistent
    // id into the next student. The next page load will mint a fresh one.
    localStorage.removeItem(STABLE_ID_KEY);
    if (refMyPool) refMyPool.remove();
    // remove our own presence/typing FIRST, then drop the listeners
    if (refPresence) refPresence.child(clientId).remove();
    if (refTyping) refTyping.child(clientId).remove();
    teardownRoom();
    if (refPool) refPool.off();
    if (refStarted) refStarted.off();
    if (refRoomCount) refRoomCount.off();
    if (refTeams) refTeams.off();
    if (refQuiz) refQuiz.off();
    if (refPreQuiz) refPreQuiz.off();
  } catch (e) { /* ignore */ }
  location.reload();
}
function initLeave() {
  el("leave-btn").addEventListener("click", () => {
    if (isRoomAdmin) backToDashboard();
    else leaveAndReload();
  });
}

/* "I'm just observing" — sim 2026-05-19 feature for anxious / B1 /
 * first-timer personas. Writes /sessions/{code}/rooms/{room}/observers/
 * {clientId} = {at} so other clients (and the scoring engine) can
 * distinguish observers from active participants. Local UX: button
 * flips to "Rejoin actively" and the room view gets data-observer="1"
 * so CSS can soften participation prompts (toned-down call-to-action
 * styling on Decisions, Hypotheses, etc.). No broadcast / no toast —
 * intentionally quiet so a stressed student can step back without
 * announcing it to the room. */
function initObserver() {
  const btn = el("observer-btn");
  if (!btn || isRoomAdmin) {
    if (btn) btn.classList.add("hidden");
    return;
  }
  if (btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  // Reflect any pre-existing observer state (e.g. after a refresh).
  if (refObservers) {
    refObservers.child(clientId).on("value", snap => {
      const isObs = !!snap.val();
      document.body.dataset.observer = isObs ? "1" : "";
      btn.textContent = isObs
        ? tFallback("room.observer-rejoin", "Rejoin actively")
        : tFallback("room.observer-btn",   "I'm just observing");
      btn.classList.toggle("is-active", isObs);
    });
  }
  btn.addEventListener("click", () => {
    if (!refObservers) return;
    const isObs = document.body.dataset.observer === "1";
    if (isObs) {
      // toggle off
      refObservers.child(clientId).remove().catch(() => {});
    } else {
      refObservers.child(clientId).set({ at: Date.now() }).catch(() => {});
    }
  });
}

/* End-of-session poll — sim 2026-05-19 (Akari, Antoine, Manon, Sophie,
 * Daichi): "End-of-session quick poll: 'What was the hardest moment?'
 * + 'One word that describes how you felt.'" Writes one entry per
 * client to /sessions/{code}/poll/{cid}. Idempotent — submitting again
 * overwrites the existing entry. No facilitator notification (the
 * facilitator reads /poll later as part of the archive). */
function initEndPoll() {
  const card = el("endpoll-card");
  if (!card || isRoomAdmin) {
    if (card) card.classList.add("hidden");
    // Admins have their own all-rooms export; hide the student per-room one.
    if (isRoomAdmin) { const d = el("wrapup-download-btn"); if (d) d.classList.add("hidden"); }
    return;
  }
  if (card.dataset.wired === "1") return;
  card.dataset.wired = "1";
  // Round-4: wire the student room-answers export (student-only — this whole
  // function early-returns for admins, who have their own all-rooms export).
  const dlBtn = el("wrapup-download-btn");
  if (dlBtn && !dlBtn.dataset.wired) {
    dlBtn.dataset.wired = "1";
    dlBtn.addEventListener("click", downloadMyRoomAnswers);
  }
  // Spaced-reinforcement: point the retention-check link at this session's
  // scenario + language, and draw a scan-to-save QR (lazy qrcode.js).
  const revisit = el("wrapup-revisit-link");
  if (revisit && !revisit.dataset.wired) {
    revisit.dataset.wired = "1";
    const sid = (typeof window.CURRENT_SCENARIO_ID === "string") ? window.CURRENT_SCENARIO_ID : "";
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    const url = "revisit.html?s=" + encodeURIComponent(sid) + "&lang=" + encodeURIComponent(lang);
    revisit.href = url;
    try {
      const loader = window.CanamedLoader;
      if (loader && loader.ensureQrcode) {
        loader.ensureQrcode().then(() => {
          const holder = el("wrapup-revisit-qr");
          if (!holder || typeof QRCode === "undefined") return;   // link still works
          holder.innerHTML = "";
          const abs = new URL(url, location.href).href;
          /* eslint-disable no-new */
          new QRCode(holder, {
            text: abs, width: 132, height: 132,
            colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M
          });
          holder.setAttribute("aria-label", "QR code linking to your retention check");
        }).catch(() => { /* QR optional — the link still works */ });
      }
    } catch (e) { /* QR optional */ }
  }
  const hard = el("endpoll-hardest");
  const feel = el("endpoll-feeling");
  const btn = el("endpoll-submit");
  const thanks = el("endpoll-thanks");
  if (!btn || !hard || !feel) return;
  // Pre-fill if the user already submitted this session (refresh case).
  if (!refPoll && db && typeof sPath === "function") {
    try { refPoll = db.ref(sPath("poll/" + clientId)); } catch (e) {}
  }
  if (refPoll) {
    refPoll.once("value").then(snap => {
      const v = snap && snap.val();
      if (v) {
        if (hard) hard.value = String(v.hardest || "");
        if (feel) feel.value = String(v.feeling || "");
        if (thanks) thanks.classList.remove("hidden");
      }
    }).catch(() => {});
  }
  btn.addEventListener("click", () => {
    if (!refPoll) {
      try { refPoll = db.ref(sPath("poll/" + clientId)); } catch (e) { return; }
    }
    const payload = {
      hardest: (hard.value || "").trim().slice(0, 280),
      feeling: (feel.value || "").trim().slice(0, 40),
      by:      (myName || "anon").slice(0, 40),
      at:      Date.now()
    };
    // R4 linkage: stamp the durable per-person id so the wrap-up poll can be
    // joined to this student's pre/post tests + questionnaire without the
    // ephemeral per-tab clientId (Round-4 research-methods finding #1).
    if (typeof stableId === "string" && stableId) payload.stableId = stableId;
    if (!payload.hardest && !payload.feeling) return;   // nothing to send
    btn.disabled = true;
    refPoll.set(payload).then(() => {
      if (thanks) thanks.classList.remove("hidden");
      setTimeout(() => { btn.disabled = false; }, 1500);
    }).catch(() => { btn.disabled = false; });
  });
}

/* Per-room side-chat — sim 2026-05-19 (Sayaka, Mei): "A private side-
 * chat with just my room (separate from group-answers) for clarifying
 * questions." Light-touch UI: collapsed by default, expands to a
 * scroll-pane of messages + a one-line input. Messages live at
 * /sessions/{code}/rooms/{room}/chat/{msgId} (push id). */
function initSideChat() {
  const panel = el("rcol-p-chat");
  if (!panel || isRoomAdmin) return;
  if (panel.dataset.wired === "1") return;
  panel.dataset.wired = "1";
  const list = el("chat-list");
  const input = el("chat-input");
  const send = el("chat-send");
  if (!list || !input || !send) return;

  if (refChat) {
    refChat.on("value", snap => {
      const msgs = snap.val() || {};
      const sorted = Object.keys(msgs)
        .map(k => Object.assign({ id: k }, msgs[k]))
        .filter(m => m && m.text)
        .sort((a, b) => (a.at || 0) - (b.at || 0))
        .slice(-50);   // last 50 only
      list.innerHTML = "";
      sorted.forEach(m => {
        const li = document.createElement("li");
        li.className = "chat-msg" + (m.cid === clientId ? " me" : "");
        const who = document.createElement("strong");
        who.textContent = m.by || "?";
        const txt = document.createElement("span");
        txt.textContent = " " + m.text;
        li.appendChild(who);
        li.appendChild(txt);
        list.appendChild(li);
      });
      list.scrollTop = list.scrollHeight;
    });
  }

  function sendMessage() {
    const text = (input.value || "").trim();
    if (!text) return;
    refChat.push({
      text: text.slice(0, 500),
      by: (myName || "anon").slice(0, 40),
      cid: clientId,
      at: Date.now()
    }).then(() => { input.value = ""; }).catch(() => {});
  }
  send.addEventListener("click", sendMessage);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

/* ===================== CANAMED SPLASH / SESSION-CODE GATE ===================
   The "main page" is the generic CANAMED splash. The code typed there IS the
   session id - facilitators create a session in-app (which generates the code)
   and hand it to participants. Everything below this gate is partnership-
   specific branding. The unlock is remembered per device. */

// generateSessionCode and sanitizeCode are in lib.js (covered by tests/).

/* a valid session is one a facilitator has actually CREATED (the `created`
   node is written together with `adminPasswordHash` in the create flow). */
function sessionExists(code) {
  try { dbInit(); } catch (e) {}
  if (!db) return Promise.resolve(false);
  // session subtree .read requires auth != null under Round-2 rules
  return ensureSignedIn()
    .then(() => db.ref(oPath(code, "created")).once("value"))
    .then(snap => (snap.val() != null)).catch(() => false);
}

/* Tri-state session status — used by the splash + auto-resume to reject
 * closed (finished) sessions BEFORE the student fills in name + consent
 * and gets kicked to the "session ended" screen anyway. Returns:
 *   { exists: bool, closed: bool }
 * User report (2026-05-18): "It should not be possible for a student to
 * join a finished session anyway." Right — the old sessionExists() only
 * checked `created`, so students could pass the splash and waste
 * effort on a session that's already over. */
function sessionStatus(code) {
  try { dbInit(); } catch (e) {}
  if (!db) return Promise.resolve({ exists: false, closed: false });
  return ensureSignedIn()
    .then(() => Promise.all([
      db.ref(oPath(code, "created")).once("value"),
      db.ref(oPath(code, "closed")).once("value")
    ]))
    .then(snaps => ({
      exists: snaps[0].val() != null,
      closed: snaps[1].val() != null
    }))
    .catch(() => ({ exists: false, closed: false }));
}

function setUnlockedSession(code) {
  sessionNum = code;
  try { localStorage.setItem("canamed_session", code); } catch (e) {}
  const splash = el("splash");
  if (splash) splash.classList.add("hidden");
  document.body.classList.remove("locked");
  document.title = "CaNaMED - Platform";
}

/* the full "we now have a valid session code" sequence: unlock, fetch the
   chosen scenario into the global content, set up the lobby, then run any
   auto-resume the device had stored. Returns a Promise resolved after the
   scenario has been applied and the lobby is showing. */
function enterUnlockedSession(code) {
  setUnlockedSession(code);
  return loadSessionScenario(code).then(() => {
    initLobby();
    lobbyShowLockedSession();
    subscribeClosedListener();   // react to admin "End session" from any view
    autoResume();
  });
}

/* subscribe to sessions/{code}/closed so that the kick-to-ended-screen
   happens regardless of which view the participant is on (splash, lobby,
   waiting room, in a room). Idempotent - safe to call from multiple paths. */
function subscribeClosedListener() {
  if (!sessionNum) return;
  try { dbInit(); } catch (e) {}
  if (!db) return;
  if (refClosed) return;        // already subscribed
  refClosed = db.ref(sPath("closed"));
  refClosed.on("value", snap => renderClosedState(snap.val()));
  // D22 — facilitator-presence subscription: admins write a
  // {by, at} heartbeat every 30s and clear it via onDisconnect. If we
  // see no fresh stamp for >5 minutes (FACILITATOR_STALE_MS), show a
  // polite hint. The check runs both on every snapshot AND on a 30s
  // timer, so a facilitator who quietly closed their tab triggers the
  // hint within ~5min even though no snapshot would fire (the node is
  // already null at that point).
  subscribeFacilitatorPresence();
}

const FACILITATOR_STALE_MS = 5 * 60 * 1000;
let _adminPresenceCache = null;
let _adminPresenceTimer = null;
let _refAdminPresence = null;
function subscribeFacilitatorPresence() {
  if (isRoomAdmin || role === "admin" || role === "superadmin") return; // admins don't need to see their own banner
  if (_refAdminPresence) return; // already subscribed
  try { _refAdminPresence = db.ref(sPath("_adminPresence")); }
  catch (e) { return; }
  _refAdminPresence.on("value", snap => {
    _adminPresenceCache = snap.val();
    renderFacilitatorPresenceBanner();
  });
  if (_adminPresenceTimer) clearInterval(_adminPresenceTimer);
  _adminPresenceTimer = setInterval(renderFacilitatorPresenceBanner, 30000);
}
function renderFacilitatorPresenceBanner() {
  const banner = (typeof document !== "undefined") && document.getElementById("facilitator-presence-banner");
  if (!banner) return;
  if (isRoomAdmin || role === "admin" || role === "superadmin") {
    if (banner.dataset.shown === "1") {
      banner.classList.add("hidden");
      banner.textContent = "";
      banner.dataset.shown = "0";
    }
    return;
  }
  const p = _adminPresenceCache;
  const at = (p && typeof p.at === "number") ? p.at : 0;
  // While we have never received a snapshot (at === 0), don't flash a
  // false-positive "offline" banner — only show it after we know the
  // node exists/existed but went stale. The initial subscribe gives us
  // up to FACILITATOR_STALE_MS to get the first heartbeat; the timer
  // re-checks every 30s. This also prevents layout-shift jitter in E2E
  // tests where the banner would otherwise toggle on each tick.
  const seen = banner.dataset.seenAt ? parseInt(banner.dataset.seenAt, 10) : 0;
  if (at > seen) banner.dataset.seenAt = String(at);
  const everSeen = (banner.dataset.seenAt && parseInt(banner.dataset.seenAt, 10) > 0);
  const stale = everSeen && (Date.now() - at) > FACILITATOR_STALE_MS;
  const shouldShow = stale ? "1" : "0";
  if (banner.dataset.shown === shouldShow) return; // no DOM churn when state unchanged
  banner.dataset.shown = shouldShow;
  if (stale) {
    banner.textContent = "Facilitator may be offline — your work is still saved. " +
                         "Check with your group or wait for them to return.";
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
    banner.textContent = "";
  }
}

function autoResume() {
  if (!resumeData || !resumeData.sessionNum || !resumeData.name) return;
  // only auto-rejoin if the resume points at the session we just unlocked
  if (resumeData.sessionNum !== sessionNum) return;
  el("session-input").value = resumeData.sessionNum;
  el("name-input").value = resumeData.name;
  if (resumeData.university) el("uni-input").value = resumeData.university;
  if (resumeData.year) el("year-input").value = String(resumeData.year);
  if (resumeData.english) el("english-input").value = resumeData.english;
  // Restore the previous consent state ONLY if the notice version still
  // matches. A version bump means the notice text materially changed and we
  // must re-collect consent under the new version.
  const prior = resumeData.consent;
  const cWorkshop = el("consent-workshop");
  const cResearch = el("consent-research");
  if (prior && prior.version === CONSENT_NOTICE_VERSION) {
    if (cWorkshop) cWorkshop.checked = !!prior.workshop;
    if (cResearch) cResearch.checked = !!prior.research;
    if (el("join-btn")) el("join-btn").disabled = !prior.workshop;
    // consent is fresh enough - resume seamlessly
    if (prior.workshop) joinParticipant();
    return;
  }
  // notice changed or no prior consent recorded - leave boxes unticked,
  // force the user to re-read and re-consent before joining
}

/* ============================================================
 * Deep-link + QR — share a session by URL, not by dictation.
 *
 * buildJoinUrl(code): returns a https URL that, when opened, lands in
 * the lobby with the code pre-filled. Format: <origin>/?s=CODE.
 * paintJoinQr(code): renders the QR client-side via the vendored
 * qrcode.js (Kazuhiko Arase, MIT). No third-party CDN, no outbound
 * request — security audit flagged the previous api.qrserver.com
 * dependency as a session-code leak channel. The render targets
 * #splash-qr-img (now a <div>) using canvas; wrapper hides itself
 * if the lib failed to load.
 * tryConsumeDeepLink(): inspects window.location for ?s=CODE and
 * pre-fills #splash-code (then strips the param from the URL bar so
 * a refresh doesn't keep re-firing).
 * ============================================================ */
function buildJoinUrl(code) {
  const safeCode = String(code || "").trim().toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  if (!safeCode) return window.location.origin + "/";
  return window.location.origin + "/?s=" + encodeURIComponent(safeCode);
}
/* Tracks the most-recently-requested QR code so async paths can detect
 * when they're stale and bail out. User report (2026-05-18): "the QR
 * code that was displayed, was displayed for the last session. It was
 * not updated to the current one." Root cause: two paths could leave
 * the previous session's QR visible —
 *   1. paintJoinQr(newCode) was called BEFORE the lazy qrcode lib
 *      finished loading; the function returned early WITHOUT clearing
 *      the container, so the old QR for the previous session stayed
 *      on screen until the lib loaded.
 *   2. A second create-session click could fire a second paintJoinQr
 *      while the first's load-then-recurse was still pending — the
 *      two recursive callbacks could resolve in unpredictable order,
 *      and the loser's render would overwrite the winner's.
 * Both fixed below: clear the container FIRST regardless of lib state,
 * and gate the post-load recursive call on the latest-code check. */
let _lastJoinQrCode = null;
function paintJoinQr(code) {
  const container = el("splash-qr-img");
  const wrap = el("splash-qr-wrap");
  if (!container || !wrap) return;
  // Record the latest requested code IMMEDIATELY so any earlier-in-
  // flight callbacks can detect they're stale.
  _lastJoinQrCode = code;
  // Clear the container BEFORE any early-return path so a stale QR
  // from a previous session never lingers on screen while the new
  // one is being prepared. Show a transient "Generating QR…" hint
  // so the user knows the empty space is intentional + temporary.
  container.innerHTML = "";
  // qrcode.js is lazy-loaded (out of the splash bundle). Pull it in now
  // if the admin hasn't reached this surface yet, then re-call ourselves.
  if (typeof QRCode === "undefined") {
    const ph = document.createElement("p");
    ph.className = "splash-qr-placeholder";
    ph.textContent = (typeof window !== "undefined" && typeof window.t === "function" &&
                      window.t("splash.qr.loading") !== "splash.qr.loading")
      ? window.t("splash.qr.loading")
      : "Generating QR code…";
    container.appendChild(ph);
    wrap.hidden = false;
    if (window.CanamedLoader && window.CanamedLoader.ensureQrcode) {
      window.CanamedLoader.ensureQrcode()
        .then(() => {
          // Race guard: a newer paintJoinQr call may have come in
          // while we were waiting. If so, the NEW call will repaint
          // itself; we abandon this stale resolution.
          if (_lastJoinQrCode !== code) return;
          paintJoinQr(code);
        })
        .catch(() => { wrap.hidden = true; });
      return;
    }
    // Library not available and no loader — hide the section, fall back to
    // "read the code aloud", same UX as the old onerror handler.
    wrap.hidden = true;
    return;
  }
  try {
    /* eslint-disable no-new */
    new QRCode(container, {
      text: buildJoinUrl(code),
      width: 180,
      height: 180,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    container.setAttribute("aria-label",
      "QR code for joining session " + (code || "").toUpperCase());
    wrap.hidden = false;
  } catch (e) {
    console.warn("[CaNaMED] QR render failed", e);
    wrap.hidden = true;
  }
}
function tryConsumeDeepLink() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("s");
    if (!raw) return;
    const code = String(raw).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!code) return;
    const input = el("splash-code");
    if (input) input.value = code;
    window.history.replaceState({}, document.title, window.location.pathname);
    const enterBtn = el("splash-enter");
    if (enterBtn) enterBtn.click();
  } catch (e) { /* malformed URL — nothing to do */ }
}

/* ============================================================
 * Last-workshop memory ("Clone last session").
 *
 * Persists a small, never-secret summary of the most recent session
 * the facilitator created on THIS browser, so the next session can be
 * spun up with one click instead of re-entering label / scenario /
 * room count / Teams link / questionnaire URLs from scratch.
 *
 * Stored in localStorage (per-browser; no DB round-trip; survives
 * sign-out). Contains NO passwords, NO session codes — only the
 * setup metadata the facilitator typed into the form / dashboard.
 * ============================================================ */
const LAST_WORKSHOP_KEY = "canamed_last_workshop";
function saveLastWorkshop(patch) {
  try {
    const cur = JSON.parse(localStorage.getItem(LAST_WORKSHOP_KEY)) || {};
    const merged = Object.assign({}, cur, patch, { updatedAt: Date.now() });
    // Defensive: never persist credentials.
    delete merged.password;
    delete merged.adminPasswordHash;
    // Security-audit finding: customJson (the full custom-scenario JSON
    // blob, up to 32 KB) was being persisted across facilitators on
    // shared lab machines. A facilitator who clicked "Clone last
    // workshop" inherited the previous facilitator's custom case
    // content. Not a credential leak, but a data-integrity issue.
    // Built-in scenarioId still persists (no leak there — those are
    // public). Custom blob is dropped; if the facilitator wants a
    // custom scenario again they re-paste it (intentional friction).
    delete merged.customJson;
    localStorage.setItem(LAST_WORKSHOP_KEY, JSON.stringify(merged));
  } catch (e) { /* localStorage full / disabled — non-fatal */ }
}
function loadLastWorkshop() {
  try { return JSON.parse(localStorage.getItem(LAST_WORKSHOP_KEY)) || null; }
  catch (e) { return null; }
}
function clearLastWorkshop() {
  // Operator-facing "Clear saved workshop" affordance — useful on
  // shared lab machines so a facilitator can wipe their stash before
  // logging off. Also useful for testing/demo.
  try { localStorage.removeItem(LAST_WORKSHOP_KEY); } catch (e) {}
}

/* ============================================================
 * "My open sessions" tracker — abandoned-session reaper.
 *
 * User-reported gap (2026-05-18): "I need a way to close ongoing
 * sessions for which there are no more participants and the admin
 * forgot to close them."
 *
 * The platform never persisted a list of sessions a given browser
 * created, so a facilitator who closed their tab without clicking
 * "End session" had no way to reach those sessions again later. They
 * stayed OPEN forever, wasting Spark-plan quota and showing as live.
 *
 * We track them locally (per-browser localStorage list of code +
 * label + openedAt) and surface a "My open sessions →" link on the
 * splash entry view. The list view exposes a one-click "Close" that
 * writes the closed marker directly (no archive download — the
 * facilitator can re-open the dashboard later for that).
 *
 * Schema: [{ code, label, openedAt }, ...]   (most-recent last)
 * ============================================================ */
const MY_SESSIONS_KEY = "canamed_my_sessions";

function _readMySessions() {
  try {
    const v = JSON.parse(localStorage.getItem(MY_SESSIONS_KEY)) || [];
    return Array.isArray(v) ? v.filter(s => s && typeof s.code === "string") : [];
  } catch (e) { return []; }
}
function _writeMySessions(list) {
  try { localStorage.setItem(MY_SESSIONS_KEY, JSON.stringify(list || [])); }
  catch (e) { /* full / disabled — non-fatal */ }
}
function addMySession(code, label) {
  if (!code) return;
  const c = String(code).toUpperCase();
  const list = _readMySessions().filter(s => s.code !== c);
  list.push({
    code: c,
    label: (label || "").toString().slice(0, 80),
    openedAt: Date.now()
  });
  // Cap to a reasonable number — even an active facilitator rarely
  // opens more than 20 unique sessions per device.
  if (list.length > 50) list.splice(0, list.length - 50);
  _writeMySessions(list);
}
function removeMySession(code) {
  if (!code) return;
  const c = String(code).toUpperCase();
  _writeMySessions(_readMySessions().filter(s => s.code !== c));
}
function getMySessions() { return _readMySessions(); }

/* Reveal / hide the "My open sessions (N) →" link on the splash entry
 * view + update its count. Idempotent; called whenever the entry view is
 * shown or the list changes. */
function paintMySessionsLink() {
  const row = el("splash-my-sessions-row");
  const count = el("splash-my-sessions-count");
  if (!row || !count) return;
  const list = getMySessions();
  if (!list.length) { row.hidden = true; return; }
  count.textContent = String(list.length);
  row.hidden = false;
  const btn = el("splash-go-my-sessions");
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => splashShowView("my-sessions"));
  }
}

/* Format an absolute timestamp as a human-friendly "Opened 2h ago" /
 * "Opened 3 days ago" / "Opened just now" string. Defensive: bad input
 * returns a generic "Opened earlier". */
function _formatOpenedAt(ms) {
  if (!ms || typeof ms !== "number") return tFallback("splash.my-sessions.opened-earlier", "Opened earlier");
  const dMs = Date.now() - ms;
  if (dMs < 60_000) return tFallback("splash.my-sessions.opened-just-now", "Opened just now");
  if (dMs < 3_600_000) {
    const m = Math.round(dMs / 60_000);
    return tFallback("splash.my-sessions.opened-mins", "Opened " + m + " min ago")
      .replace("{n}", String(m));
  }
  if (dMs < 86_400_000) {
    const h = Math.round(dMs / 3_600_000);
    return tFallback("splash.my-sessions.opened-hours", "Opened " + h + "h ago")
      .replace("{n}", String(h));
  }
  const d = Math.round(dMs / 86_400_000);
  return tFallback("splash.my-sessions.opened-days", "Opened " + d + " day(s) ago")
    .replace("{n}", String(d));
}

/* Render the splash "My open sessions" list. One row per tracked session
 * (newest first), each with code, label, opened-when, and a "Close"
 * button. The Close button writes the closed marker directly via
 * closeMySession(code) — no archive download (the facilitator can
 * re-enter the dashboard later for that). Closed/missing sessions are
 * marked then auto-pruned on next render. */
function renderMySessions() {
  const list = el("splash-my-sessions-list");
  const empty = el("splash-my-sessions-empty");
  if (!list || !empty) return;
  const entries = getMySessions().slice().reverse();   // newest first
  list.innerHTML = "";
  if (!entries.length) { empty.hidden = false; return; }
  empty.hidden = true;

  // Wire the back button once.
  const back = el("splash-my-sessions-back");
  if (back && !back.dataset.wired) {
    back.dataset.wired = "1";
    back.addEventListener("click", () => splashShowView("enter"));
  }

  entries.forEach(s => {
    const row = document.createElement("div");
    row.className = "my-session-row";
    row.setAttribute("role", "listitem");
    row.dataset.code = s.code;

    const code = document.createElement("p");
    code.className = "my-session-code";
    code.textContent = s.code;

    const label = document.createElement("p");
    label.className = "my-session-label";
    label.textContent = s.label || tFallback("splash.my-sessions.no-label", "(no label)");

    const when = document.createElement("p");
    when.className = "my-session-when";
    when.textContent = _formatOpenedAt(s.openedAt);

    const status = document.createElement("p");
    status.className = "my-session-status";
    status.textContent = tFallback("splash.my-sessions.checking", "Checking status…");

    const actions = document.createElement("div");
    actions.className = "my-session-actions";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "my-session-close";
    closeBtn.textContent = tFallback("splash.my-sessions.close-btn", "Close session");
    closeBtn.addEventListener("click", () => closeMySession(s.code, closeBtn, status));

    const forgetBtn = document.createElement("button");
    forgetBtn.type = "button";
    forgetBtn.className = "splash-link my-session-forget";
    forgetBtn.textContent = tFallback("splash.my-sessions.forget-btn", "Remove from list");
    forgetBtn.addEventListener("click", () => {
      removeMySession(s.code);
      renderMySessions();
      paintMySessionsLink();
    });

    actions.appendChild(closeBtn);
    actions.appendChild(forgetBtn);

    row.appendChild(code);
    row.appendChild(label);
    row.appendChild(when);
    row.appendChild(status);
    row.appendChild(actions);
    list.appendChild(row);

    // Best-effort live status check: is the session already closed in the
    // DB? If we can read it, update the status text + disable Close.
    // Silently ignores read-permission errors (LOCAL mode or rules deny).
    try {
      if (db && typeof db.ref === "function") {
        db.ref(oPath(s.code, "closed")).once("value")
          .then(snap => {
            if (snap.val()) {
              status.textContent = tFallback("splash.my-sessions.already-closed",
                "Already closed — will be removed");
              closeBtn.disabled = true;
              // Auto-prune the local entry after a short visible delay so
              // the user notices the list shrank rather than items just
              // silently vanishing.
              setTimeout(() => {
                removeMySession(s.code);
                renderMySessions();
                paintMySessionsLink();
              }, 1200);
            } else {
              status.textContent = tFallback("splash.my-sessions.status-open",
                "Open — click Close to end it");
            }
          })
          .catch(() => {
            status.textContent = tFallback("splash.my-sessions.status-unknown",
              "Status unknown");
          });
      } else {
        status.textContent = tFallback("splash.my-sessions.status-unknown", "Status unknown");
      }
    } catch (e) {
      status.textContent = tFallback("splash.my-sessions.status-unknown", "Status unknown");
    }
  });
}

/* Click handler for the "Close session" button in the my-sessions list.
 * Writes the closed marker directly — the close-write rule allows any
 * authenticated user to close any open session that exists. No archive
 * download is attempted here; the facilitator can re-open the admin
 * dashboard later to grab the archive. Defensive: confirms before the
 * write, then removes the local entry on success. */
function closeMySession(code, btn, statusEl) {
  if (!code) return;
  const c = String(code).toUpperCase();
  const ok = window.confirm(tFallback("splash.my-sessions.close-confirm",
    "End session " + c + "? Participants will see the wrap-up screen and " +
    "cannot interact further. The data stays in the database — you can " +
    "re-open the admin dashboard later to download the archive."));
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = tFallback("splash.my-sessions.closing", "Closing…"); }

  const write = () => db.ref(oPath(c, "closed")).set({
    by: (myName || "Admin").toString().slice(0, 40),
    at: Date.now()
  });

  // ensureSignedIn() is the platform's standard pre-write gate — the
  // closed-write rule requires auth != null even though it doesn't
  // require admin password verification (we trust the local UX gate
  // since we only show sessions THIS browser created).
  const auth = (typeof ensureSignedIn === "function") ? ensureSignedIn() : Promise.resolve();
  auth.then(write).then(() => {
    if (statusEl) statusEl.textContent = tFallback("splash.my-sessions.closed-ok", "Closed ✓");
    if (btn) btn.textContent = tFallback("splash.my-sessions.closed-btn", "Closed");
    removeMySession(c);
    setTimeout(() => { renderMySessions(); paintMySessionsLink(); }, 700);
  }).catch(e => {
    console.warn("Could not close session", c, e);
    if (statusEl) statusEl.textContent = tFallback("splash.my-sessions.close-failed",
      "Could not close — check your connection and try again.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = tFallback("splash.my-sessions.close-btn", "Close session");
    }
  });
}

/* swap which splash view is visible. The card itself stays put, only the inner
   "view" changes - keeps the layout stable as the user moves between flows. */
function splashShowView(name) {
  ["enter", "create", "created", "account", "profile-setup", "my-sessions"].forEach(v => {
    const node = el("splash-view-" + v);
    if (node) node.hidden = (v !== name);
  });
  const focusable = {
    "enter": "splash-code",
    "create": "splash-create-name",
    "created": "splash-copy-code",
    "account": "splash-account-email",
    "profile-setup": "splash-prof-name",
    "my-sessions": "splash-my-sessions-back"
  }[name];
  // When entering the my-sessions view, re-render the list (the data may
  // have changed since the user last opened the splash). When returning
  // to the entry view, refresh the link's count.
  if (name === "my-sessions") { try { renderMySessions(); } catch (e) {} }
  if (name === "enter")       { try { paintMySessionsLink(); } catch (e) {} }
  // a11y: when the splash swaps to a new view, push focus to that
  // view's main heading (so a screen-reader user hears the section
  // name on transition). The splash uses .splash-label-big paragraphs
  // as visual headings rather than <h*> elements; treat them as the
  // section heading and make them programmatically focusable. If no
  // heading-like element exists in this view (e.g. the enter view,
  // which is just a single labelled input), fall back to focusing the
  // form control the user is most likely to touch next.
  setTimeout(() => {
    const activeView = el("splash-view-" + name);
    const heading = activeView
      ? activeView.querySelector("h1, h2, h3, .splash-label-big")
      : null;
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      try { heading.focus({ preventScroll: false }); } catch (e) {}
    } else {
      const n = el(focusable);
      if (n) {
        try { n.focus({ preventScroll: false }); } catch (e) {}
      }
    }
  }, 30);
  // First-time onboarding tour for facilitators landing on the create-
  // session view. Defer one tick so the view's elements have been laid
  // out (anchors are measured via getBoundingClientRect). The tour is
  // very skippable — ESC, outside-click, and the Skip button all dismiss.
  if (name === "create" && window.CanamedTour && !window.CanamedTour.isDone("create")) {
    setTimeout(() => {
      // re-check inside the timeout: the user may have navigated away in
      // the 250ms between scheduling and firing (e.g. clicked Back)
      const view = el("splash-view-create");
      if (view && !view.hidden && !window.CanamedTour.isDone("create")) {
        try { window.CanamedTour.start("create"); } catch (e) { console.warn("tour failed", e); }
      }
    }, 250);
  } else if (name !== "create" && window.CanamedTour) {
    // leaving the create view dismisses any in-progress create-tour
    try { window.CanamedTour.dismiss(); } catch (e) {}
  }
}

/* paint the locked-in session as a small badge on the lobby + hide the manual
   session-code input (it has already been answered by the splash). */
function lobbyShowLockedSession() {
  if (!sessionNum) return;
  const label = el("session-input-label");
  if (label) label.hidden = true;
  const inp = el("session-input");
  if (inp) inp.value = sessionNum;
  const badge = el("session-badge");
  const code = el("session-badge-code");
  if (badge && code) {
    code.textContent = sessionNum;
    badge.hidden = false;
  }
  const chSes = el("change-session-input");
  if (chSes) chSes.value = sessionNum;
  // show today's scenario name + summary so the room knows what they will work on
  const line = el("scenario-line");
  const nameEl = el("scenario-line-name");
  const sumEl = el("scenario-line-summary");
  const lang = _curLang();
  const name = tc(window.CURRENT_SCENARIO_NAME, lang);
  const summary = tc(window.CURRENT_SCENARIO_SUMMARY, lang);
  if (line && nameEl && name) {
    nameEl.textContent = name;
    if (sumEl) sumEl.textContent = summary ? " — " + summary : "";
    line.hidden = false;
  } else if (line) {
    line.hidden = true;
  }
  // Reveal the "← Use a different session" escape hatch. The lobby is the
  // ONLY view a returning user with stored canamed_session sees before the
  // (silent) auto-rejoin, so without this they have no visible way back to
  // the splash. User-reported regression 2026-05-18.
  paintLobbySwitchSession();
}

/* Reveal + wire the lobby "switch session" button whenever the lobby is
 * showing an unlocked session. Idempotent: the click handler is attached at
 * most once via a dataset flag. */
function paintLobbySwitchSession() {
  const row = el("lobby-switch-session");
  const btn = el("lobby-switch-session-btn");
  if (!row || !btn) return;
  row.hidden = false;
  if (!btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", switchSession);
  }
}

/* User picked "← Use a different session" from the lobby. Clears the
 * unlocked-session pointer + any resume data so initEntry() shows the
 * splash on reload. Same cleanup surface as forgetSavedSession() (the
 * splash banner's equivalent button), but kept as a separate symbol so
 * each entry point is greppable and easy to test. */
function switchSession() {
  try {
    localStorage.removeItem(RESUME_KEY);
    localStorage.removeItem("canamed_name");
    localStorage.removeItem("canamed_session");
    localStorage.removeItem("canamed_client");
    if (typeof STABLE_ID_KEY === "string") localStorage.removeItem(STABLE_ID_KEY);
  } catch (e) { /* ignore */ }
  location.reload();
}

/* Paint a minimal "Org not found" splash + abort entry. Triggered when the
   URL contains /o/{slug}/ but {slug} is not registered in window.CANAMED_ORGS.
   Keeps the rest of the engine inert — no db init, no auth, no joins — so a
   typo or stale partnership link can't accidentally land users in the default
   org's session. */
function showOrgNotFoundSplash() {
  const splash = el("splash");
  const slug = (typeof location !== "undefined" && location.pathname) || "";
  const msg =
    "This CaNaMED partnership is not configured on this deployment.\n\n" +
    "URL: " + slug + "\n\n" +
    "Ask the workshop organiser to confirm the correct /o/{slug}/ link, " +
    "or open canamed.web.app/ for the default partnership.";
  // Prefer a visible in-page card; fall back to a plain document overlay if
  // the splash element isn't in the DOM (e.g. a stripped test harness).
  if (splash) {
    splash.classList.remove("hidden");
    splash.innerHTML =
      '<div role="alert" class="splash-org-error" ' +
      'style="max-width:520px;margin:60px auto;padding:24px;border:1px solid #cbd5e1;' +
      'border-radius:12px;background:#fff;font-family:system-ui,sans-serif;color:#0f172a;">' +
      '<h1 style="margin:0 0 12px 0;font-size:20px;">Org not found</h1>' +
      '<p style="white-space:pre-line;line-height:1.5;margin:0;">' +
      msg.replace(/&/g, "&amp;").replace(/</g, "&lt;") + '</p></div>';
  } else if (typeof document !== "undefined" && document.body) {
    const div = document.createElement("div");
    div.setAttribute("role", "alert");
    div.style.cssText = "padding:24px;font-family:system-ui,sans-serif;";
    div.textContent = "Org not found — " + msg;
    document.body.appendChild(div);
  }
  document.title = "Org not found · CANAMED";
}

function initEntry() {
  // Multi-tenant gate: an /o/{slug}/ URL whose slug is unknown short-circuits
  // here, before any database/auth wiring. This keeps the engine inert for
  // mistyped partnership links instead of silently dropping users into the
  // default org's data.
  if (currentOrgInvalid) {
    showOrgNotFoundSplash();
    return;
  }
  const splash = el("splash");
  // if a previously unlocked session is still valid, skip the splash.
  // 2026-05-18: switched from sessionExists to sessionStatus so we
  // also reject CLOSED sessions on auto-resume — a stored code for a
  // session the facilitator has already ended should clear localStorage
  // and show the splash (with a one-time "session ended" hint), not
  // auto-resume into a session that's about to kick the user out.
  const stored = sanitizeCode(localStorage.getItem("canamed_session"));
  if (stored) {
    sessionStatus(stored).then(status => {
      if (status.exists && !status.closed) {
        enterUnlockedSession(stored);
      } else {
        // stale code (purged, never existed, or finished): clear and
        // show splash. Stash a one-shot hint key so the splash can
        // explain "your previous session has ended" if that's why we
        // ended up here (vs the generic "not found").
        try { localStorage.removeItem("canamed_session"); } catch (e) {}
        if (status.closed) {
          try {
            sessionStorage.setItem("canamed_just_ended_session", stored);
          } catch (e) {}
        }
        sessionNum = "";
        showSplash();
      }
    });
    return;
  }
  showSplash();

  function showSplash() {
    if (!splash) { setUnlockedSession(""); initLobby(); return; }
    splash.classList.remove("hidden");
    document.title = "CANAMED";
    wireSplash();
    splashShowView("enter");
    // If the auto-resume just bailed because the stored session was
    // CLOSED, surface a one-shot hint so the student sees why they're
    // back on the splash (rather than silently dumping them there).
    try {
      const endedCode = sessionStorage.getItem("canamed_just_ended_session");
      if (endedCode) {
        sessionStorage.removeItem("canamed_just_ended_session");
        const hint = el("splash-hint");
        if (hint) {
          hint.textContent = tFallback("splash.enter.previous-session-ended",
            "Your previous session (" + endedCode.toUpperCase() +
            ") has ended. Enter a new code from your facilitator.");
          hint.className = "splash-hint err";
        }
      }
    } catch (e) { /* sessionStorage may be blocked — silently ignore */ }
    // If the user landed via a deep-link (e.g., a QR scan or a shared
    // URL), pre-fill the code and auto-submit. Runs AFTER wireSplash() so
    // the splash-enter form's submit handler is already attached.
    tryConsumeDeepLink();
    // Surface the "Resuming as <name> in session <CODE> — disconnect & start
    // fresh →" escape hatch if localStorage still has resume data. Without
    // this, a returning user has no visible way to clear a saved session
    // before the next code-entry triggers a silent auto-rejoin (user-reported
    // regression 2026-05-18).
    paintSavedSessionBanner();
    // Surface the "My open sessions (N) →" reaper link so a facilitator
    // can find + close abandoned sessions they previously created.
    paintMySessionsLink();
  }
}

/* Populate + reveal the .splash-saved-session banner if resume data is in
 * localStorage. Wires the clear button to forgetSavedSession() the first
 * time it runs (subsequent calls just refresh the displayed name + code).
 * Safe to call on any view transition that lands the user back on the
 * splash — the hidden attribute toggles per the current localStorage state. */
function paintSavedSessionBanner() {
  const banner = el("splash-saved-session");
  if (!banner) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(RESUME_KEY) || "null"); } catch (e) { saved = null; }
  const hasName = saved && saved.name;
  const hasCode = saved && saved.sessionNum;
  if (!hasName || !hasCode) {
    banner.hidden = true;
    return;
  }
  const nameEl = el("splash-saved-session-name");
  const codeEl = el("splash-saved-session-code");
  if (nameEl) nameEl.textContent = String(saved.name).slice(0, 40);
  if (codeEl) codeEl.textContent = String(saved.sessionNum).toUpperCase();
  banner.hidden = false;
  const btn = el("splash-saved-session-clear");
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", forgetSavedSession);
  }
}

/* User-initiated "I'm not that person / I want a different session". Mirrors
 * leaveAndReload()'s localStorage cleanup but does NOT touch any Firebase
 * refs (we're on the splash — no active session refs to detach). After
 * clearing, reload so initEntry() sees a clean slate and shows the splash. */
function forgetSavedSession() {
  try {
    localStorage.removeItem(RESUME_KEY);
    localStorage.removeItem("canamed_name");
    localStorage.removeItem("canamed_session");
    localStorage.removeItem("canamed_client");
    // Match leaveAndReload(): drop the persistent stableId too so a shared
    // lab machine doesn't carry the previous student's identity forward.
    if (typeof STABLE_ID_KEY === "string") localStorage.removeItem(STABLE_ID_KEY);
  } catch (e) { /* ignore */ }
  location.reload();
}

let splashWired = false;
function wireSplash() {
  if (splashWired) return;
  splashWired = true;
  // R2-42: wire the language <select> so the user can switch languages
  // BEFORE entering a session. Previously the switcher was only wired by
  // applyBranding() (which runs from initLobby), so on the splash screen
  // itself the dropdown's change handler was inert until the user typed
  // a code and crossed into the lobby — a real blocker for non-English
  // users at the very first screen they see.
  if (typeof wireLanguageSwitcher === "function") wireLanguageSwitcher();
  // account paths (Google sign-in, profile setup, account dialog) get wired
  // up alongside the rest of the splash so a signed-out user can either
  // continue as a guest with the code or click "Sign in with Google"
  if (typeof wireAccountUI === "function") wireAccountUI();
  // and make sure dbInit has run so the auth state listener can fire (it
  // normally runs lazily, but here we want it ready before the splash paints)
  try { dbInit(); } catch (e) {}

  // VIEW 1: enter
  const form = el("splash-form");
  const code = el("splash-code");
  const hint = el("splash-hint");
  const shake = () => {
    if (!code) return;
    code.classList.remove("shake"); void code.offsetWidth; code.classList.add("shake");
    code.focus(); code.select();
  };
  const tryEnter = () => {
    if (!hint || !code) return;
    const got = sanitizeCode(code.value);
    if (!got) {
      hint.textContent = "Enter the code your facilitator gave you.";
      hint.className = "splash-hint err";
      if (code) code.focus();
      return;
    }
    hint.textContent = "Checking…";
    hint.className = "splash-hint";
    // 2026-05-18: switched from sessionExists (boolean) to sessionStatus
    // ({exists, closed}) so a CLOSED session is rejected up front with a
    // clear "this session has ended" message — students no longer waste
    // time on the lobby + name/consent + room only to get kicked.
    sessionStatus(got).then(status => {
      if (!status.exists) {
        // B7 (SIMULATION_EDGE_CASES.md): if the user typed a 6-char code
        // without the dash (e.g. "abcdef"), try the dashed variant
        // ("abc-def") before showing the generic miss. Only auto-retry
        // when (a) we got exactly 6 alphanumeric chars and (b) inserting
        // a dash produces the canonical XXX-XXX format that
        // generateSessionCode() emits.
        if (/^[a-z0-9]{6}$/.test(got)) {
          const dashed = got.slice(0, 3) + "-" + got.slice(3);
          return sessionStatus(dashed).then(dashedStatus => {
            if (dashedStatus.exists && !dashedStatus.closed) {
              hint.textContent = "";
              if (code) code.value = dashed;
              enterUnlockedSession(dashed);
            } else if (dashedStatus.exists && dashedStatus.closed) {
              hint.textContent = tFallback("splash.enter.session-ended",
                "This session has already ended. Ask your facilitator for a new session code.");
              hint.className = "splash-hint err";
              shake();
            } else {
              hint.textContent = "No session matches this code. Did you mean " +
                dashed.toUpperCase() + "? Check it with your facilitator.";
              hint.className = "splash-hint err";
              shake();
            }
          });
        }
        hint.textContent = "No session matches this code. Check it with your facilitator, or have a facilitator create a new session.";
        hint.className = "splash-hint err";
        shake();
        return;
      }
      if (status.closed) {
        // Session exists but the facilitator has ended it — bail before
        // we drag the student through the lobby + consent only to get
        // kicked. Clear, single-line error in the splash hint slot.
        hint.textContent = tFallback("splash.enter.session-ended",
          "This session has already ended. Ask your facilitator for a new session code.");
        hint.className = "splash-hint err";
        shake();
        return;
      }
      hint.textContent = "";
      enterUnlockedSession(got);
    });
  };
  if (form) form.addEventListener("submit", e => { e.preventDefault(); tryEnter(); });
  if (el("splash-go-create")) el("splash-go-create")
    .addEventListener("click", () => splashShowView("create"));

  // VIEW 2: create
  const cForm = el("splash-create-form");
  const cName = el("splash-create-name");
  const cLabel = el("splash-create-label");
  const cPass = el("splash-create-pass");
  const cHint = el("splash-create-hint");
  if (el("splash-back-from-create")) el("splash-back-from-create")
    .addEventListener("click", () => splashShowView("enter"));
  const tryCreate = () => {
    const name = (cName.value || "").trim().slice(0, 40);
    const label = (cLabel.value || "").trim().slice(0, 80);
    const pass = cPass.value || "";
    if (!name) { cHint.textContent = "Enter your name."; cHint.className = "splash-hint err"; cName.focus(); return; }
    if (!pass) { cHint.textContent = "Set a session password."; cHint.className = "splash-hint err"; cPass.focus(); return; }
    if (pass.length < 4) { cHint.textContent = "Password should be at least 4 characters."; cHint.className = "splash-hint err"; cPass.focus(); return; }
    // which content the session will run: a built-in scenario id, or "__custom__"
    // with a JSON blob the facilitator has pasted in
    const sel = el("splash-create-scenario");
    let scenarioId = sel ? sel.value : "";
    let customJson = null;
    if (scenarioId === "__custom__") {
      const ta = el("splash-create-custom");
      const text = (ta && ta.value || "").trim();
      if (!text) {
        cHint.textContent = "Paste your custom content, or pick a built-in scenario.";
        cHint.className = "splash-hint err"; if (ta) ta.focus(); return;
      }
      if (text.length > 32000) {
        cHint.textContent = "Custom content is too large (limit 32 KB).";
        cHint.className = "splash-hint err"; return;
      }
      const v = validateScenarioJson(text);
      if (!v.ok) {
        cHint.textContent = "Custom content: " + v.msg;
        cHint.className = "splash-hint err"; if (ta) ta.focus(); return;
      }
      customJson = text;
      scenarioId = null;
    }
    cHint.textContent = "Creating session…";
    cHint.className = "splash-hint";
    createSession(name, label, pass, scenarioId, customJson).then(result => {
      // createSession resolves { code, recoveryCode }. The recoveryCode is
      // a one-time secret we surface ONCE on the created view and never
      // persist (it cannot be read back from the DB), so the facilitator
      // must write it down now.
      const code = result.code;
      const recoveryCode = result.recoveryCode;
      // remember the credentials for the one-click "Open admin dashboard"
      window._splashJustCreated = { code: code, name: name, pass: pass };
      // Persist a clone-friendly summary of this session's setup so the
      // facilitator can spin up the next one in one click. Never includes
      // the password or session code — only the user-typed config.
      // customJson is INTENTIONALLY not persisted — see saveLastWorkshop
      // header note (audit finding: shared-machine data-integrity).
      saveLastWorkshop({
        label: label || null,
        scenarioId: scenarioId || null,
        facilitatorName: name || null
      });
      // If the user clicked "Clone last workshop" before submitting, copy
      // the previous room count + links to the new session. db is
      // initialised (createSession ran); ensureSignedIn() gates the writes.
      const clone = window._splashCloneCarry;
      if (clone) {
        window._splashCloneCarry = null;
        try {
          ensureSignedIn().then(() => {
            const writes = [];
            if (typeof clone.roomCount === "number" && clone.roomCount >= 1 && clone.roomCount <= 20) {
              writes.push(db.ref(oPath(code, "roomCount")).set(clone.roomCount));
            }
            if (clone.teamsLink && safeHref(clone.teamsLink)) {
              writes.push(db.ref(oPath(code, "teamsLink")).set(clone.teamsLink));
            }
            if (clone.preQuestionnaireLink && safeHref(clone.preQuestionnaireLink)) {
              writes.push(db.ref(oPath(code, "preQuestionnaireLink")).set(clone.preQuestionnaireLink));
            }
            if (clone.questionnaireLink && safeHref(clone.questionnaireLink)) {
              writes.push(db.ref(oPath(code, "questionnaireLink")).set(clone.questionnaireLink));
            }
            // best-effort; non-fatal if any individual write fails
            Promise.all(writes).catch(e => console.warn("Clone-write partial fail", e));
          });
        } catch (e) { console.warn("Clone-write skipped", e); }
      }
      el("splash-shown-code").textContent = code.toUpperCase();
      // Surface the one-time recovery code prominently. This is the ONLY
      // moment it is ever visible — it is stored in the unreadable
      // /recovery subtree and can never be fetched back, so the facilitator
      // must record it now. The block stays visible until "Create another"
      // or page reload.
      showRecoveryCode(recoveryCode);
      paintJoinQr(code);
      splashShowView("created");
      cHint.textContent = "";
      // Track in localStorage so the facilitator can find + close this
      // session later via the "My open sessions →" splash link even if
      // they close the tab without clicking "End session".
      addMySession(code, label || name || "");
      cName.value = ""; cLabel.value = ""; cPass.value = "";
      const ta = el("splash-create-custom"); if (ta) ta.value = "";
    }).catch(e => {
      console.error("Create failed", e);
      cHint.textContent = "Could not create the session — check your connection and try again.";
      cHint.className = "splash-hint err";
    });
  };
  if (cForm) cForm.addEventListener("submit", e => { e.preventDefault(); tryCreate(); });

  // populate the scenario picker from window.CANAMED_SCENARIOS + wire the
  // description line and the "Create new content (advanced)" → textarea toggle
  populateScenarioPicker();
  const sel = el("splash-create-scenario");
  if (sel) sel.addEventListener("change", onScenarioChange);
  const tplBtn = el("splash-load-template");
  if (tplBtn) tplBtn.addEventListener("click", loadScenarioTemplate);
  // The advanced toggle is independent of case-content.js (it only flips
  // the <textarea>'s hidden attribute), so wire it eagerly here as well.
  // populateScenarioPicker() also calls it once case-content has loaded;
  // wireAdvancedScenarioToggle() is idempotent (dataset.wired guard).
  wireAdvancedScenarioToggle();

  // "Clone last workshop" row — appears only when a previous create has
  // populated localStorage with a workshop summary. One click pre-fills
  // the form (label + scenario) AND stashes the room count + links into
  // window._splashCloneCarry so they're written to the new session
  // immediately after createSession() returns.
  const cloneRow = el("splash-clone-row");
  const cloneBtn = el("splash-clone-last");
  const cloneMeta = el("splash-clone-meta");
  const refreshCloneRow = () => {
    const last = loadLastWorkshop();
    if (!cloneRow || !cloneBtn) return;
    // customJson is no longer persisted (audit fix); the row appears
    // when the user has a previous label or built-in scenarioId.
    if (!last || !(last.label || last.scenarioId)) {
      cloneRow.hidden = true;
      return;
    }
    cloneRow.hidden = false;
    if (cloneMeta) {
      const when = last.updatedAt
        ? new Date(last.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })
        : "";
      cloneMeta.textContent = (last.label ? "“" + last.label + "”" : "")
        + (when ? " · " + when : "");
    }
  };
  refreshCloneRow();
  // "Clear saved workshop" — small operator affordance for shared lab
  // machines. Wipes localStorage.canamed_last_workshop and re-renders
  // (which hides the clone row entirely).
  const cloneClearBtn = el("splash-clone-clear");
  if (cloneClearBtn) cloneClearBtn.addEventListener("click", () => {
    clearLastWorkshop();
    refreshCloneRow();
  });
  if (cloneBtn) cloneBtn.addEventListener("click", () => {
    const last = loadLastWorkshop();
    if (!last) return;
    if (cLabel && last.label) cLabel.value = last.label;
    const sceSel = el("splash-create-scenario");
    if (sceSel && last.scenarioId) {
      // Try to select the saved built-in scenario; if it's no longer
      // valid (renamed/removed), leave the dropdown at its default.
      // We intentionally don't persist customJson (audit fix), so the
      // facilitator re-pastes a custom blob if they want one again.
      const opt = Array.from(sceSel.options).find(o => o.value === last.scenarioId);
      if (opt) {
        sceSel.value = last.scenarioId;
        onScenarioChange();
      }
    }
    // Stash the post-create writes for tryCreate() to apply once the new
    // session exists. Persisted across the async createSession call.
    window._splashCloneCarry = {
      roomCount: last.roomCount,
      teamsLink: last.teamsLink,
      preQuestionnaireLink: last.preQuestionnaireLink,
      questionnaireLink: last.questionnaireLink
    };
    cHint.textContent = "Cloned from last workshop. Set a new password and click Create.";
    cHint.className = "splash-hint ok";
    if (cPass) cPass.focus();
  });

  // VIEW 3: created
  const copyBtn = el("splash-copy-code");
  const copyHint = el("splash-copy-hint");
  // small DRY helper — same UX whether the user clicks Copy (the code) or
  // Copy-link (the full join URL)
  const copyToClipboard = (text, okLabel, fallbackLabel) => {
    const done = () => {
      copyHint.textContent = okLabel;
      copyHint.className = "splash-hint ok";
      setTimeout(() => { copyHint.textContent = ""; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        copyHint.textContent = fallbackLabel;
        copyHint.className = "splash-hint err";
      });
    } else {
      copyHint.textContent = fallbackLabel;
    }
  };
  if (copyBtn) copyBtn.addEventListener("click", () => {
    const code = el("splash-shown-code").textContent.trim();
    copyToClipboard(code, "Copied!",
      "Couldn't copy — select and copy the code manually.");
  });
  // Copy-link: full deep-link URL students can tap from a chat / email to
  // land in the lobby with the code pre-filled. Removes the manual-typing
  // step entirely on phones.
  const copyLinkBtn = el("splash-copy-link");
  if (copyLinkBtn) copyLinkBtn.addEventListener("click", () => {
    const code = el("splash-shown-code").textContent.trim().toUpperCase();
    const url = buildJoinUrl(code);
    copyToClipboard(url, "Link copied!",
      "Couldn't copy — share the code above instead.");
  });
  if (el("splash-create-another")) el("splash-create-another")
    .addEventListener("click", () => {
      window._splashJustCreated = null;
      // Hide + clear the previous recovery code so it never lingers on
      // screen for the next session's created view.
      const rWrap = el("splash-recovery-wrap");
      if (rWrap) rWrap.hidden = true;
      const rCode = el("splash-recovery-code");
      if (rCode) rCode.textContent = "—";
      splashShowView("create");
    });
  if (el("splash-go-admin")) el("splash-go-admin")
    .addEventListener("click", () => {
      const c = window._splashJustCreated;
      if (!c) return;
      setUnlockedSession(c.code);
      // load the scenario the facilitator just chose before driving the admin
      // join - the dashboard / room view all read CASE / SCORING / etc. live
      loadSessionScenario(c.code).then(() => {
        initLobby();
        lobbyShowLockedSession();
        // pre-fill the admin section and submit
        el("name-input").value = c.name;
        el("admin-pass-input").value = c.pass;
        const adminBody = el("admin-lobby-body");
        const toggle = el("admin-toggle");
        if (adminBody) adminBody.classList.remove("hidden");
        if (toggle) toggle.setAttribute("aria-expanded", "true");
        joinAdmin();
        window._splashJustCreated = null;
      });
    });

  // "Show tour again" affordance inside the create form. Always wired,
  // even after the tour is marked done — addReopenLink() clears the
  // done-flag on click and re-runs the tour.
  if (window.CanamedTour && typeof window.CanamedTour.addReopenLink === "function") {
    window.CanamedTour.addReopenLink("splash-tour-reopen", "create");
  }
}

/* fill the scenario dropdown from the SCENARIOS registry + one trailing
   "Create new content (advanced)" option that reveals the JSON textarea */
function populateScenarioPicker() {
  const sel = el("splash-create-scenario");
  if (!sel) return;
  // case-content.js is lazy-loaded. If it hasn't landed yet, kick off the
  // load and re-call ourselves once it has. (The loader's idle-prefetch
  // usually beats us here, in which case CANAMED_SCENARIOS is already set.)
  if (!window.CANAMED_SCENARIOS && window.CanamedLoader) {
    window.CanamedLoader.ensureCaseContent().then(populateScenarioPicker);
    return;
  }
  sel.innerHTML = "";
  const scenarios = window.CANAMED_SCENARIOS || {};
  const lang = _curLang();
  Object.keys(scenarios).forEach(id => {
    const sc = scenarios[id];
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = tc(sc.name, lang) || id;
    sel.appendChild(opt);
  });
  // NOTE: "Create new content (advanced)" used to be an option inside
  // this dropdown. The simulation report (Step 2) found that first-time
  // facilitators panicked at the JSON textarea after picking it by
  // mistake. It is now a separate button below the picker (toggled via
  // splash-create-advanced-toggle); the dropdown lists ONLY clinical
  // scenarios. Picking the toggle sets sel.value = "__custom__" so the
  // existing tryCreate() branch remains unchanged.
  const firstBuiltIn = Object.keys(scenarios)[0];
  if (firstBuiltIn) sel.value = firstBuiltIn;
  // Wire the advanced toggle (idempotent — guard with dataset.wired)
  wireAdvancedScenarioToggle();
  onScenarioChange();
}
function wireAdvancedScenarioToggle() {
  const toggle = el("splash-create-advanced-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  toggle.addEventListener("click", () => {
    const wrap = el("splash-custom-wrap");
    const sel = el("splash-create-scenario");
    const isOpen = wrap && !wrap.hidden;
    if (isOpen) {
      // Closing the advanced panel reverts to the first built-in scenario.
      if (wrap) wrap.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (sel) {
        const scenarios = window.CANAMED_SCENARIOS || {};
        const firstBuiltIn = Object.keys(scenarios)[0];
        if (firstBuiltIn) {
          sel.value = firstBuiltIn;
          onScenarioChange();
        }
      }
    } else {
      // Opening: reveal the textarea and tag the picker so tryCreate's
      // existing branch reads sel.value === "__custom__". We add a
      // synthetic option for this so even an unloaded case-content
      // dropdown can carry the flag, then immediately re-call
      // onScenarioChange to update the description line.
      if (wrap) wrap.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      if (sel) {
        const hasCustom = Array.from(sel.options).some(o => o.value === "__custom__");
        if (!hasCustom) {
          const opt = document.createElement("option");
          opt.value = "__custom__";
          opt.textContent = (window.t ? window.t("splash.create.advanced-toggle") :
            "Create new content (advanced)");
          opt.hidden = true;
          sel.appendChild(opt);
        }
        sel.value = "__custom__";
      }
      onScenarioChange();
      const ta = el("splash-create-custom");
      if (ta) try { ta.focus(); } catch (e) {}
    }
  });
}
function onScenarioChange() {
  const sel = el("splash-create-scenario");
  const wrap = el("splash-custom-wrap");
  const desc = el("splash-scenario-desc");
  const toggle = el("splash-create-advanced-toggle");
  if (!sel) return;
  const isCustom = sel.value === "__custom__";
  if (wrap) wrap.hidden = !isCustom;
  if (toggle) toggle.setAttribute("aria-expanded", isCustom ? "true" : "false");
  if (desc) {
    if (isCustom) {
      desc.textContent = (window.t ? window.t("splash.create.custom-desc") :
        "Paste a JSON object describing your case. Use 'Load template' to start from the built-in content.");
    } else {
      const sc = (window.CANAMED_SCENARIOS || {})[sel.value];
      desc.textContent = tc(sc && sc.summary, _curLang());
    }
  }
}
function loadScenarioTemplate() {
  const ta = el("splash-create-custom");
  if (!ta) return;
  const scenarios = window.CANAMED_SCENARIOS || {};
  const firstId = Object.keys(scenarios)[0];
  if (!firstId) { ta.value = "{\n  \"name\": \"My new case\",\n  \"case\": { \"history\": [], \"exam\": [], \"labs\": [], \"prompts\": [] },\n  \"scoring\": { \"moduleA\": [], \"moduleB\": [] },\n  \"penalties\": [],\n  \"decisions\": []\n}"; return; }
  const sc = scenarios[firstId];
  // include the shape but with a fresh name so the facilitator edits, not copies
  const template = {
    name: "My new case",
    summary: "A one-line description shown on the picker.",
    moduleAName: sc.moduleAName,
    moduleBName: sc.moduleBName,
    synthId: sc.synthId,
    synthPrereqs: sc.synthPrereqs,
    case: sc.case,
    scoring: sc.scoring,
    penalties: sc.penalties,
    decisions: sc.decisions
  };
  ta.value = JSON.stringify(template, null, 2);
}

/* Surface the one-time per-session recovery code on the created view. The
   code is never readable from the DB (it lives in the unreadable /recovery
   subtree), so this is the ONLY moment the facilitator can record it. */
function showRecoveryCode(recoveryCode) {
  const wrap = el("splash-recovery-wrap");
  const codeNode = el("splash-recovery-code");
  if (!codeNode) return;
  codeNode.textContent = recoveryCode || "—";
  if (wrap) wrap.hidden = false;
  const copyBtn = el("splash-recovery-copy");
  const hint = el("splash-recovery-copy-hint");
  if (copyBtn && !copyBtn.dataset.wired) {
    copyBtn.dataset.wired = "1";
    copyBtn.addEventListener("click", () => {
      const code = (codeNode.textContent || "").trim();
      const okMsg = tFallback("splash.created.recovery-copied", "Recovery code copied!");
      const failMsg = tFallback("splash.created.recovery-copy-fail",
        "Couldn't copy — write the recovery code down manually.");
      const done = () => {
        if (!hint) return;
        hint.textContent = okMsg;
        hint.className = "splash-hint ok";
        setTimeout(() => { hint.textContent = ""; }, 2400);
      };
      const fail = () => {
        if (!hint) return;
        hint.textContent = failMsg;
        hint.className = "splash-hint err";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(fail);
      } else {
        fail();
      }
    });
  }
}

/* generate a unique code, write the session's marker + scenario choice +
   admin password hash. `scenarioId` is a key from window.CANAMED_SCENARIOS,
   or null when a custom-JSON scenario is being saved instead. `customJson` is
   the validated raw JSON string for a custom scenario (or null). */
function createSession(creatorName, workshopLabel, password, scenarioId, customJson) {
  try { dbInit(); } catch (e) {}
  if (!db) return Promise.reject(new Error("No database"));
  // Round-2 rules require auth != null on every write; wait for the
  // anonymous (or identified) sign-in before any session writes.
  return ensureSignedIn().then(() => {
  const tryOne = (tries) => {
    if (tries > 6) return Promise.reject(new Error("Could not allocate a unique code"));
    const code = generateSessionCode();
    return db.ref(oPath(code, "created")).once("value").then(snap => {
      if ((snap.val() != null)) return tryOne(tries + 1);
      // D21 hardening — per-session recovery code. Generated here, shown
      // to the facilitator ONCE (returned alongside the session code), and
      // written to the UNREADABLE top-level /recovery subtree. The database
      // rules only allow this write while the session has no
      // adminPasswordHash yet (write-once, pre-password binding), so it MUST
      // land in the same initial batch that runs BEFORE the hash is set.
      // Possession of this code is later the only way to overwrite a
      // forgotten password (see joinSuperAdmin's recovery path). It lives
      // outside the session subtree, so it never appears in archives/exports.
      const recoveryCode = generateRecoveryCode();
      // write the markers - `created` first so a half-finished create is still
      // recognisable (and easy to clean up), then the password hash
      const at = Date.now();
      const writes = [
        db.ref(oPath(code, "created")).set({ by: creatorName, at: at }),
        // recovery/sessions/<code> or recovery/orgs/<slug>/sessions/<code>
        // — exactly matching the rule tree (recovery/ + _sessionPrefix + code).
        db.ref("recovery/" + oPath(code)).set({ code: recoveryCode })
      ];
      if (workshopLabel) {
        writes.push(db.ref(oPath(code, "workshopLabel")).set(workshopLabel));
      }
      if (customJson) {
        writes.push(db.ref(oPath(code, "scenarioCustomJson")).set(customJson));
      } else if (scenarioId) {
        writes.push(db.ref(oPath(code, "scenarioId")).set(scenarioId));
      }
      return Promise.all(writes)
        .then(() => hashPassword(password, code))
        .then(h => {
          if (useAdminSecrets()) {
            // FINDING-07: store the REAL hash in the unreadable adminSecrets
            // tree; put only a non-secret random marker at the readable
            // session path so the existence-based admin-gated rules and the
            // super-admin recovery flow keep working without exposing the
            // password hash to participants.
            return Promise.all([
              db.ref(adminSecretPath(code, "hash")).set(h),
              db.ref(oPath(code, "adminPasswordHash")).set(randomAdminMarker())
            ]);
          }
          return db.ref(oPath(code, "adminPasswordHash")).set(h);   // org path: unchanged (deferred)
        })
        .then(() => ({ code: code, recoveryCode: recoveryCode }));
    });
  };
  return tryOne(0);
  });
}

/* validate a pasted custom-scenario JSON string. The engine reads case.history,
   case.exam and case.labs - those are the minimum a scenario must declare. */
function validateScenarioJson(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { return { ok: false, msg: "Invalid JSON (" + e.message + ")." }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, msg: "Must be a JSON object." };
  }
  if (!obj.case || typeof obj.case !== "object") {
    return { ok: false, msg: "Missing 'case' object." };
  }
  if (!Array.isArray(obj.case.history) || !obj.case.history.length) {
    return { ok: false, msg: "case.history must be a non-empty array." };
  }
  if (!Array.isArray(obj.case.exam) || !Array.isArray(obj.case.labs)) {
    return { ok: false, msg: "case.exam and case.labs must be arrays." };
  }
  return { ok: true, content: obj };
}

/* ===================== ACCOUNTS, PROFILES, HISTORY =========================
   Firebase Email/Password auth is optional - the code-only join still works
   for guests. A signed-in user has a profile (name, university, year, English)
   that auto-fills the join form, and a history of sessions they have joined.

   Per-user data lives under users/{uid}/{profile, history}; rules in
   database.rules.json restrict read/write to the matching auth.uid.

   Sign-up flow:
     splash-enter → "create one" → splash-account-view (sign-up mode)
       → submit email+password → splash-profile-setup-view
       → save → back to splash-enter with header chip shown
   Sign-in flow:
     splash-enter → "Sign in to your account" → splash-account-view (sign-in mode)
       → submit email+password → splash-enter with chip + pre-filled identity
   Forgot password:
     splash-account-view → "Forgot password?" → enter email → password reset email
   Account dialog (header chip):
     edit profile · change password · sign out · delete account · session history */

let _historyListenerRef = null;        // realtime subscription for the dialog

function splashHintErr(node, msg) {
  if (!node) return; node.textContent = msg || ""; node.className = "splash-hint" + (msg ? " err" : "");
}
function splashHintOk(node, msg) {
  if (!node) return; node.textContent = msg || ""; node.className = "splash-hint" + (msg ? " ok" : "");
}

/* turn the Firebase auth error code into a sentence a human can act on */
function authErrorMessage(err) {
  const code = err && err.code || "";
  const map = {
    "auth/popup-blocked": "Your browser blocked the sign-in popup — allow popups on this site and try again.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/operation-not-allowed": "This sign-in provider is not enabled for this Firebase project (turn it on in Firebase Console → Authentication → Sign-in method).",
    "auth/configuration-not-found": "This sign-in provider is not configured for this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method.",
    "auth/unauthorized-domain": "This domain is not authorised for sign-in — add it in Firebase Console → Authentication → Settings → Authorized domains.",
    "auth/account-exists-with-different-credential": "An account already exists with this email under a different sign-in method.",
    "auth/network-request-failed": "Could not reach the sign-in server — check your connection.",
    "auth/too-many-requests": "Too many attempts — try again in a few minutes.",
    "auth/requires-recent-login": "For this action, please sign out and sign back in, then try again."
  };
  return map[code] || (err && err.message) || "Sign-in failed.";
}

/* sign in via a popup against any supported identity provider. Firebase
   creates the account on first use, so there is no separate "sign up" path -
   first sign-in IS the sign-up. Supports google / microsoft / apple. */
function signInWithProvider(name) {
  const hint = el("splash-account-hint");
  if (!auth) { splashHintErr(hint, "Sign-in is not available in local-test mode."); return; }
  let provider;
  let pretty;
  if (name === "google") {
    pretty = "Google";
    provider = new firebase.auth.GoogleAuthProvider();
    // ask Google every time which account to use (avoids silently re-using a
    // session from a different tab when a user wants to switch identities)
    provider.setCustomParameters({ prompt: "select_account" });
  } else if (name === "microsoft") {
    pretty = "Microsoft";
    provider = new firebase.auth.OAuthProvider("microsoft.com");
    // same UX: let the user pick their account every time
    provider.setCustomParameters({ prompt: "select_account" });
  } else if (name === "apple") {
    pretty = "Apple";
    provider = new firebase.auth.OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
  } else {
    return;
  }
  splashHintOk(hint, "Opening " + pretty + " sign-in…");
  // Round-2: if the user is currently anonymous, upgrade (link) the existing
  // uid so users/{uid}/history survives the sign-in. If linking fails because
  // the Google account already exists as its own user
  // (auth/credential-already-in-use / email-already-in-use) — i.e. any
  // returning signed-in user — sign in AS that account with the credential the
  // error carries. Direct credential sign-in needs no popup, so it can't be
  // popup-blocked. (History under the throwaway anon uid is forfeited.)
  const cur = auth.currentUser;
  const popupSignIn = () => auth.signInWithPopup(provider);
  const salvageSignIn = e =>
    (e && e.credential) ? auth.signInWithCredential(e.credential) : popupSignIn();
  // If the browser blocks the popup (common outside Incognito), fall back to a
  // full-page redirect — no popup blocker can stop it, and it completes
  // reliably now that auth is first-party (authDomain = web.app). The matching
  // getRedirectResult() handler in dbInit() finishes the sign-in on return.
  const popupBlocked = e => e && (
    e.code === "auth/popup-blocked" ||
    e.code === "auth/cancelled-popup-request" ||
    e.code === "auth/operation-not-supported-in-this-environment" ||
    e.code === "auth/web-storage-unsupported");
  const redirectSignIn = () => {
    splashHintOk(hint, "Redirecting to " + pretty + "…");
    const c = auth.currentUser;
    return (c && c.isAnonymous)
      ? c.linkWithRedirect(provider)
      : auth.signInWithRedirect(provider);
  };
  const link = (cur && cur.isAnonymous)
    ? cur.linkWithPopup(provider).catch(e => {
        if (e && (e.code === "auth/credential-already-in-use" ||
                  e.code === "auth/email-already-in-use")) {
          return salvageSignIn(e);
        }
        if (e && e.code === "auth/provider-already-linked") {
          return popupSignIn();
        }
        throw e;
      })
    : popupSignIn();
  link.then(() => {
    // handleAuthStateChange takes over from here
    splashHintOk(hint, "");
  }).catch(e => {
    if (popupBlocked(e)) {
      redirectSignIn().catch(err => splashHintErr(hint, authErrorMessage(err)));
      return;
    }
    splashHintErr(hint, authErrorMessage(e));
  });
}

/* Returns a promise that resolves once auth.currentUser is non-null. If
   no user exists yet (first tab load, or someone signed out), kicks off
   an anonymous sign-in. Idempotent — concurrent callers share one
   in-flight promise. Returns a resolved promise immediately in solo /
   local mode (no Firebase), so calling code can always `.then()`. */
function ensureSignedIn() {
  if (!auth) return Promise.resolve(null);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (_anonSignInPromise) return _anonSignInPromise;
  _anonSignInPromise = auth.signInAnonymously()
    .then(cred => {
      _anonSignInPromise = null;
      return cred && cred.user || auth.currentUser;
    })
    .catch(err => {
      _anonSignInPromise = null;
      console.warn("Anonymous sign-in failed; DB writes may be denied", err);
      // resolve authReady with null so UI doesn't hang; subsequent DB
      // writes will surface permission-denied errors visibly. Surface a
      // hint to the operator if anonymous auth simply isn't enabled.
      if (_authReadyResolve) { _authReadyResolve(null); _authReadyResolve = null; }
      if (err && err.code === "auth/operation-not-allowed") {
        const banner = el("connection-badge");
        if (banner) {
          banner.textContent = "Auth disabled";
          banner.className = "conn-badge conn-lost";
          banner.title = "Anonymous sign-in is disabled in this Firebase project — DB writes will be denied. Enable it in Authentication → Sign-in method.";
        }
      }
      return null;  // resolved promise, not rejected, so callers can always .then()
    });
  return _anonSignInPromise;
}

/* Auth state changes: signed-in / signed-out / after sign-up */
function handleAuthStateChange(user) {
  currentUser = user || null;
  // R2-24/25: bind stableId to auth.uid the moment we have a non-anonymous
  // user. Persistent across tabs/devices, lets research (longitudinal
  // replay) deduplicate the same person across many sessions / browsers.
  // For anonymous users the localStorage-backed random stableId set at
  // module init is left in place — survives refresh / tab close on the
  // same browser without binding to any account.
  if (currentUser && !currentUser.isAnonymous && currentUser.uid) {
    stableId = currentUser.uid;
    try { localStorage.setItem(STABLE_ID_KEY, stableId); } catch (e) {}
  }
  // Resolve authReady the moment we have *any* user (anonymous or
  // identified). Pending DB-write paths can now proceed.
  if (currentUser && _authReadyResolve) {
    _authReadyResolve(currentUser);
    _authReadyResolve = null;
  }
  // If we lose the user mid-session (e.g. token revoked, manual sign-out
  // from another tab), re-arm and immediately re-sign-in anonymously so
  // the DB rules keep accepting writes.
  if (!currentUser && auth) {
    authReady = new Promise(resolve => { _authReadyResolve = resolve; });
    ensureSignedIn();
  }
  if (currentUser) {
    // Anonymous users (the default for every tab post-Round-2) don't get a
    // persistent profile and shouldn't be pushed into the profile-setup
    // screen — they use the code-only join flow. Only identified users
    // (Google sign-in) hit the profile path below.
    if (currentUser.isAnonymous) {
      currentProfile = null;
      paintUserChip();
      return;
    }
    loadProfile().then(profile => {
      currentProfile = profile;
      paintUserChip();
      // first sign-in for this identified account → guide them through profile setup
      if (!profile || !profile.name) {
        populateProfileSelects("splash-prof-uni");
        setRoleRadio("splash-prof-role", (profile && profile.role) || "student");
        applyProfileRoleVisibility("splash-prof-role", "splash-prof-student-fields");
        // pre-fill what Google gave us: displayName for the name, email otherwise
        const nm = el("splash-prof-name");
        if (nm && !nm.value) {
          nm.value = (currentUser.displayName && currentUser.displayName.split(" ")[0])
            || (currentUser.email && currentUser.email.split("@")[0])
            || "";
        }
        splashShowView("profile-setup");
        return;
      }
      // existing user → return them to whichever view they were on. If they
      // were on the account view (just signed in), return to enter; otherwise
      // do nothing (auth state can fire mid-session and we don't want to yank
      // the user out of an active workshop).
      const splash = el("splash");
      if (splash && !splash.classList.contains("hidden")) {
        splashShowView("enter");
      }
      // auto-fill the lobby join form too, if it is on screen
      applyProfileToJoinForm();
    });
  } else {
    currentProfile = null;
    paintUserChip();
  }
}

function loadProfile() {
  if (!currentUser || !db) return Promise.resolve(null);
  return db.ref("users/" + currentUser.uid + "/profile").once("value")
    .then(snap => snap.val()).catch(() => null);
}

function saveProfile(updates) {
  if (!currentUser || !db) return Promise.reject(new Error("Not signed in"));
  const now = Date.now();
  const merged = Object.assign({}, currentProfile || {}, updates, { updatedAt: now });
  if (!merged.createdAt) merged.createdAt = now;
  return db.ref("users/" + currentUser.uid + "/profile").set(merged)
    .then(() => { currentProfile = merged; return merged; });
}

/* Log a session join to the user's history. Idempotent: writing the same
   code twice just updates the timestamp. */
function pushSessionToHistory(code) {
  if (!currentUser || !db || !code) return;
  const path = "users/" + currentUser.uid + "/history/" + code;
  db.ref(path).set({
    code: code,
    workshopName: (CFG && CFG.workshopName) || "",
    scenarioName: tc(window.CURRENT_SCENARIO_NAME, "en") || "",
    joinedAt: Date.now()
  }).catch(e => console.warn("Could not write session history", e));
}

/* populate any university <select> from COHORTS (signed-in profile setup +
   account dialog use the same source as the lobby) */
function populateProfileSelects(selectId) {
  const sel = el(selectId);
  if (!sel || !COHORTS || !COHORTS.length) return;
  const prev = sel.value;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.disabled = true; ph.textContent = "Select your university…";
  sel.appendChild(ph);
  COHORTS.forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.label || c.id;
    sel.appendChild(o);
  });
  if (prev) sel.value = prev;
  if (!sel.value) sel.value = "";
}

/* The header user chip - shown when signed in, hidden otherwise. Two letters
   for initials; clicking opens the account dialog. */
function paintUserChip() {
  const chip = el("user-chip");
  const splashRow = el("splash-signed-in");
  // Anonymous users are treated as "not signed in" UI-wise — the chip / row
  // belong to identified (Google) users only. Round-2 introduced an
  // always-on anonymous user under the hood for DB-rule purposes, but it
  // is intentionally invisible to the participant.
  if (!currentUser || currentUser.isAnonymous) {
    if (chip) chip.classList.add("hidden");
    if (splashRow) splashRow.hidden = true;
    return;
  }
  const display = (currentProfile && currentProfile.name) || currentUser.email || "Account";
  const initials = ((display || "?").trim().split(/\s+/).map(s => s[0] || "")
    .join("").slice(0, 2) || display.slice(0, 1)).toUpperCase();
  if (chip) {
    chip.classList.remove("hidden");
    const init = el("user-chip-initials");
    const name = el("user-chip-name");
    if (init) init.textContent = initials;
    if (name) name.textContent = display;
    chip.title = "Signed in as " + display + " — open your account";
  }
  // also paint the in-splash status row so signed-in users can sign out
  // without having to enter a session first
  if (splashRow) {
    splashRow.hidden = false;
    const n = el("splash-signed-in-name");
    if (n) n.textContent = display;
  }
}

/* Role-aware profile helpers. The profile form serves both students and
   facilitators; facilitators only need name + institution, so the
   student-only fields (year of study, English level) are hidden for them. */
function selectedRole(radioName) {
  const sel = document.querySelector('input[name="' + radioName + '"]:checked');
  return sel ? sel.value : "student";
}
function setRoleRadio(radioName, value) {
  const r = document.querySelector(
    'input[name="' + radioName + '"][value="' + (value || "student") + '"]');
  if (r) r.checked = true;
}
function applyProfileRoleVisibility(radioName, studentFieldsId) {
  const fields = el(studentFieldsId);
  if (fields) fields.hidden = (selectedRole(radioName) === "facilitator");
}
/* Build the saveProfile payload for the given role. Facilitators null out
   the student-only fields so a student→facilitator switch doesn't leave
   stale year/English behind. */
function profileUpdatesForRole(role, name, uni, yearEl, englishEl) {
  if (role === "facilitator") {
    return { name: name, university: uni, role: "facilitator", year: null, english: null };
  }
  return {
    name: name, university: uni, role: "student",
    year: parseInt(el(yearEl).value, 10) || 1,
    english: (el(englishEl).value || "B2").trim()
  };
}

/* Profile-setup submit (right after sign-up) */
function profileSetupSubmit() {
  const hint = el("splash-profile-setup-hint");
  const role = selectedRole("splash-prof-role");
  const name = (el("splash-prof-name").value || "").trim();
  const uni = (el("splash-prof-uni").value || "").trim();
  if (!name) { splashHintErr(hint, "Enter your name."); return; }
  if (!uni) { splashHintErr(hint, "Pick your university."); return; }
  splashHintOk(hint, "Saving your profile…");
  const updates = profileUpdatesForRole(role, name, uni, "splash-prof-year", "splash-prof-english");
  saveProfile(updates).then(() => {
    splashHintOk(hint, "");
    paintUserChip();
    splashShowView("enter");
    applyProfileToJoinForm();
  }).catch(e => splashHintErr(hint, "Could not save: " + (e.message || "")));
}

/* When a user with a profile lands on the lobby, pre-fill their join form */
function applyProfileToJoinForm() {
  if (!currentProfile) return;
  const n = el("name-input");
  if (n && !n.value) n.value = currentProfile.name || "";
  const u = el("uni-input");
  if (u && currentProfile.university &&
      [...u.options].some(o => o.value === currentProfile.university)) {
    u.value = currentProfile.university;
  }
  const y = el("year-input");
  if (y && currentProfile.year) y.value = String(currentProfile.year);
  const e = el("english-input");
  if (e && currentProfile.english) e.value = currentProfile.english;
}

/* The account dialog (opened by clicking the header chip) */
function openAccountDialog() {
  const dlg = el("account-dialog");
  if (!dlg || !currentUser) return;
  el("account-email").textContent = currentUser.email || "";
  populateProfileSelects("account-uni");
  if (currentProfile) {
    el("account-name").value = currentProfile.name || "";
    if (currentProfile.university) el("account-uni").value = currentProfile.university;
    if (currentProfile.year) el("account-year").value = String(currentProfile.year);
    if (currentProfile.english) el("account-english").value = currentProfile.english;
  }
  setRoleRadio("account-role", (currentProfile && currentProfile.role) || "student");
  applyProfileRoleVisibility("account-role", "account-student-fields");
  splashHintOk(el("account-action-hint"), "");
  loadHistoryForDialog();
  dialogShow(dlg);
}
function closeAccountDialog() {
  const dlg = el("account-dialog");
  if (!dlg) return;
  dialogClose(dlg);
  if (_historyListenerRef) { _historyListenerRef.off(); _historyListenerRef = null; }
}

function loadHistoryForDialog() {
  const list = el("account-history");
  if (!list || !currentUser || !db) return;
  if (_historyListenerRef) _historyListenerRef.off();
  _historyListenerRef = db.ref("users/" + currentUser.uid + "/history");
  _historyListenerRef.on("value", snap => {
    const v = snap.val() || {};
    const items = Object.keys(v).map(k => v[k])
      .sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
    list.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "No sessions yet — your history will appear here once you join one.";
      list.appendChild(li);
      return;
    }
    items.forEach(it => {
      const li = document.createElement("li");
      li.className = "account-history-row";
      const code = document.createElement("strong");
      code.className = "account-history-code";
      code.textContent = (it.code || "").toUpperCase();
      const meta = document.createElement("span");
      meta.className = "account-history-meta";
      const when = it.joinedAt ? new Date(it.joinedAt).toLocaleDateString() : "";
      const sc = it.scenarioName ? " · " + it.scenarioName : "";
      meta.textContent = when + sc;
      li.appendChild(code); li.appendChild(meta);
      list.appendChild(li);
    });
  });
}

function accountSaveBtn() {
  const hint = el("account-action-hint");
  const role = selectedRole("account-role");
  const name = (el("account-name").value || "").trim();
  const uni = (el("account-uni").value || "").trim();
  if (!name) { splashHintErr(hint, "Enter your name."); return; }
  const updates = profileUpdatesForRole(role, name, uni, "account-year", "account-english");
  saveProfile(updates).then(() => {
    splashHintOk(hint, "Profile saved.");
    paintUserChip();
    applyProfileToJoinForm();
    const ok = el("account-save-ok");
    if (ok) {
      ok.classList.remove("hidden");
      setTimeout(() => ok.classList.add("hidden"), 1800);
    }
  }).catch(e => splashHintErr(hint, "Could not save: " + (e.message || "")));
}

function accountSignOut() {
  if (!auth) return;
  auth.signOut().then(() => {
    closeAccountDialog();
    splashHintOk(el("account-action-hint"), "");
  }).catch(e => splashHintErr(el("account-action-hint"), authErrorMessage(e)));
}

function accountDelete() {
  const hint = el("account-action-hint");
  if (!currentUser || !auth) return;
  const ok = confirm(
    "Delete your account?\n\n" +
    "This permanently removes your profile and history. Your contributions in " +
    "past sessions stay in those sessions' records but are no longer linked " +
    "to your identity.\n\nThis cannot be undone."
  );
  if (!ok) return;
  const uid = currentUser.uid;
  const userRef = db.ref("users/" + uid);
  // Two-step deletion: remove the user-data subtree FIRST while we still
  // have write permission, then delete the Firebase Auth user. If the Auth
  // deletion fails (e.g. "requires-recent-login"), the data is gone but
  // the user can sign back in and try again - which is the lesser harm.
  // Doing it in the other order (Auth first) would leave orphan data we
  // can no longer write to.
  userRef.remove().then(() => {
    return currentUser.delete().catch(e => {
      // Auth deletion failed - put the user's data back if we can, so a
      // retry is possible. Best-effort; not all paths are guaranteed.
      console.warn("Auth delete failed after data delete:", e);
      splashHintErr(hint, authErrorMessage(e) +
        " Your profile data has been removed; please sign back in and try " +
        "again to fully delete the Firebase account.");
      throw e;
    });
  }).then(() => {
    closeAccountDialog();
    // onAuthStateChanged fires with null next; paintUserChip clears the chip
  }).catch(e => {
    if (e && e.code) {
      // already surfaced above; nothing more to do
    } else {
      splashHintErr(hint, authErrorMessage(e));
    }
  });
}

/* wire the splash-view-account / splash-view-profile-setup / account-dialog
   handlers. Called once on first splash render. */
let _accountWired = false;
function wireAccountUI() {
  if (_accountWired) return;
  _accountWired = true;

  // splash → "Sign in with Google" view
  if (el("splash-go-account")) el("splash-go-account").addEventListener("click", () => {
    populateProfileSelects("splash-prof-uni");
    const hint = el("splash-account-hint");
    if (hint) { hint.textContent = ""; hint.className = "splash-hint"; }
    splashShowView("account");
  });
  if (el("splash-signed-in-out")) el("splash-signed-in-out").addEventListener("click", accountSignOut);
  if (el("splash-back-from-account")) el("splash-back-from-account")
    .addEventListener("click", () => splashShowView("enter"));
  if (el("splash-google-signin")) el("splash-google-signin")
    .addEventListener("click", () => signInWithProvider("google"));
  if (el("splash-microsoft-signin")) el("splash-microsoft-signin")
    .addEventListener("click", () => signInWithProvider("microsoft"));
  if (el("splash-apple-signin")) el("splash-apple-signin")
    .addEventListener("click", () => signInWithProvider("apple"));

  // profile-setup (runs once, right after the first Google sign-in)
  if (el("splash-profile-setup-form")) el("splash-profile-setup-form")
    .addEventListener("submit", e => { e.preventDefault(); profileSetupSubmit(); });

  // role toggle: hide the student-only fields (year / English) for facilitators
  document.querySelectorAll('input[name="splash-prof-role"]').forEach(r =>
    r.addEventListener("change", () =>
      applyProfileRoleVisibility("splash-prof-role", "splash-prof-student-fields")));
  document.querySelectorAll('input[name="account-role"]').forEach(r =>
    r.addEventListener("change", () =>
      applyProfileRoleVisibility("account-role", "account-student-fields")));

  // header chip + account dialog
  if (el("user-chip")) el("user-chip").addEventListener("click", openAccountDialog);
  if (el("account-dialog-close")) el("account-dialog-close")
    .addEventListener("click", closeAccountDialog);
  if (el("account-save-btn")) el("account-save-btn").addEventListener("click", accountSaveBtn);
  if (el("account-signout-btn")) el("account-signout-btn").addEventListener("click", accountSignOut);
  if (el("account-delete-btn")) el("account-delete-btn").addEventListener("click", accountDelete);
  // close dialog when clicking the backdrop
  const dlg = el("account-dialog");
  if (dlg) dlg.addEventListener("click", e => {
    if (e.target === dlg) closeAccountDialog();
  });
}

/* ===================== Observer SPIKES checklist (Module B) =====================
 * Roleplay review 2026-05-20: the observer had no structured tool. The
 * #observer-checklist <details> in index.html gives them a SPIKES tick-list
 * + two note fields to anchor the Phase-3 debrief. State is LOCAL (per-tab
 * sessionStorage) — a private scratchpad, no Firebase write path, so it
 * needs no rules change and never leaves the device. Wired idempotently. */
function initObserverChecklist() {
  const root = document.getElementById("observer-checklist");
  if (!root || root.dataset.wired === "1") return;
  root.dataset.wired = "1";
  const KEY = "canamed_obs_spikes";
  const boxes = Array.from(root.querySelectorAll("input[type=checkbox][data-obs]"));
  const win = document.getElementById("observer-note-win");
  const hard = document.getElementById("observer-note-hard");

  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || "{}") || {}; } catch (_) { saved = {}; }

  // Restore.
  boxes.forEach(b => { if (saved[b.dataset.obs]) b.checked = true; });
  if (win && typeof saved._win === "string") win.value = saved._win;
  if (hard && typeof saved._hard === "string") hard.value = saved._hard;

  const persist = () => {
    const state = {};
    boxes.forEach(b => { if (b.checked) state[b.dataset.obs] = 1; });
    if (win && win.value) state._win = win.value.slice(0, 400);
    if (hard && hard.value) state._hard = hard.value.slice(0, 400);
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ }
  };
  boxes.forEach(b => b.addEventListener("change", persist));
  if (win) win.addEventListener("input", persist);
  if (hard) hard.addEventListener("input", persist);
}

/* ===================== START ===================== */
initEntry();
initObserverChecklist();
