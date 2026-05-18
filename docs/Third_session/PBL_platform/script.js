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
   environments without a real DOM (guarded). */
function applyOrgTheme(orgCfg) {
  if (!orgCfg || typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  if (orgCfg.primary) root.style.setProperty("--primary", orgCfg.primary);
  if (orgCfg.primary) root.style.setProperty("--primary-hover", orgCfg.primary);
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
const COLORS = ["#2E9FDF", "#E7B800", "#1e8449", "#c0392b", "#8e44ad",
                "#e67e22", "#16a085", "#2c3e50", "#d81b60", "#00838f"];
const ENG_RANK = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };
function roomNames(count) {
  const out = [];
  for (let i = 1; i <= count; i++) out.push("Room " + i);
  return out;
}

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
function hashStr(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
const _colorCache = {};
function colorFor(name) {
  if (!name) return "#6b7785";
  return _colorCache[name] ||
    (_colorCache[name] = COLORS[parseInt(hashStr(name).slice(0, 8), 16) % COLORS.length]);
}
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
function canamedConfirm(opts) {
  opts = opts || {};
  const dlg = el("canamed-modal");
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
      cleanup();
      try { dialogClose(dlg); } catch (e) {}
      resolve(val);
    };
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
function reducedMotion() {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch (e) { return false; }
}
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

/* ===================== ROOM BALANCING ===================== */
function assignRooms(pool, roomCount) {
  const sortFn = (a, b) =>
    ((ENG_RANK[b.english] || 0) - (ENG_RANK[a.english] || 0)) ||
    ((b.year || 0) - (a.year || 0));
  const byUni = {};
  pool.forEach(p => { (byUni[p.university] = byUni[p.university] || []).push(p); });
  const lists = Object.keys(byUni).sort().map(u => byUni[u].slice().sort(sortFn));
  const combined = [];
  let added = true, i = 0;
  while (added) {
    added = false;
    lists.forEach(list => { if (i < list.length) { combined.push(list[i]); added = true; } });
    i++;
  }
  const names = roomNames(roomCount);
  const assignment = {};
  let r = 0, dir = 1;
  combined.forEach(p => {
    assignment[p.clientId] = names[r];
    r += dir;
    if (r >= roomCount) { r = roomCount - 1; dir = -1; }
    else if (r < 0) { r = 0; dir = 1; }
  });
  return assignment;
}
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
    refScore = null, refTeamName = null, refLeaderboard = null, refVotes = null,
    refClosed = null;

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

function dbInit() {
  if (db) return;
  if (MODE === "shared") {
    if (!firebase.apps.length) firebase.initializeApp(window.CANAMED_FIREBASE);
    // App Check must be activated AFTER initializeApp but BEFORE any other
    // Firebase service is used (auth, database). Idempotent and a no-op when
    // window.CANAMED_RECAPTCHA_SITE_KEY isn't configured.
    initAppCheck();
    // Performance Monitoring is similarly opt-in via the firebase-config
    // flag. Safe to activate before database/auth — it just attaches to
    // the global window.fetch / XMLHttpRequest for timing capture.
    initPerfMonitoring();
    db = firebase.database();
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
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
        // create the authReady promise BEFORE wiring the listener so the
        // first auth-state change can resolve it
        authReady = new Promise(resolve => { _authReadyResolve = resolve; });
        auth.onAuthStateChanged(handleAuthStateChange);
        // kick off anonymous sign-in if no current user. ensureSignedIn()
        // is idempotent — calling it again from joinParticipant is safe.
        ensureSignedIn();
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
  el("set-pass-btn").addEventListener("click", joinSuperAdmin);
  if (!SUPERADMIN_KEY) el("superadmin-toggle").classList.add("hidden");
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
  const roomChunks = loader ? loader.ensureCaseContent() : Promise.resolve();
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

function _joinParticipantAfterAuth() {
  // user may have hit "Leave" while we were waiting for auth
  if (!joined) return;
  // R2-09: claim membership BEFORE setting up the listeners below, so the
  // session-level .read predicate (data.child('members').hasChild(auth.uid))
  // is satisfied by the time the .on("value") handlers fire. We chain
  // through claimMembership() because the listener installs would race the
  // members write otherwise and the server would PERMISSION_DENY them.
  claimMembership("participant").then(() => {
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
  refMyPool.onDisconnect().remove();
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
    // A stale onDisconnect from a previous tab or a reload can wipe our entry
    // moments after we re-set it. If we are joined but missing, re-assert -
    // keeping any room we were already placed in.
    if (!mine && joined) {
      try { refMyPool.onDisconnect().cancel(); } catch (e) {}
      refMyPool.set({
        name: myName, university: myUniversity, year: myYear,
        english: myEnglish, at: Date.now(), room: myRoom || null,
        consent: myConsent,
        stableId: stableId   // R2-24/25: persistent per-person id
      });
      refMyPool.onDisconnect().remove();
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
    .then(() => true).catch(() => false);
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
    return Object.assign({}, prev, {
      startedAt: prev.startedAt || now,
      skipped: true
    });
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
        state.answered = true;
        state.picked = -1;     // marker for "skipped" — no points awarded
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
  initTeamName();
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
let activeRcolTab = "findings";
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
}

function teardownRoom() {
  try {
    // a pending typing-timeout would otherwise fire setTyping(null) against the
    // NEXT room's typing ref after an admin switches rooms
    clearTimeout(typingTimer);
    if (refStage) refStage.off();
    if (refRevealed) refRevealed.off();
    if (refPresence) refPresence.off();
    if (refTyping) refTyping.off();
    if (refAnswers.moduleA) refAnswers.moduleA.off();
    if (refAnswers.moduleB) refAnswers.moduleB.off();
    if (refCallForHelp) refCallForHelp.off();
    if (refScore) refScore.off();
    if (refVotes) refVotes.off();
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
  refPresence = db.ref(base + "/presence");
  refTyping = db.ref(base + "/typing");
  refAnswers.moduleA = db.ref(base + "/answers/moduleA");
  refAnswers.moduleB = db.ref(base + "/answers/moduleB");
  refCallForHelp = db.ref(base + "/callForHelp");
  refScore = db.ref(base + "/score");
  refVotes = db.ref(base + "/votes");
  refTeamName = db.ref(base + "/teamName");
  refLeaderboard = db.ref(sPath("rooms"));
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
  }

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
  refRevealed.on("value", snap => { revealed = snap.val() || {}; renderCase(); });
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
  myName = readName("admin-hint");
  if (!myName) return;
  const pass = el("admin-pass-input").value;
  if (!pass) { el("admin-hint").textContent = "Enter the session password."; return; }
  dbInit();
  const btn = el("join-admin-btn");
  const btnLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Checking…";
  const restore = () => { btn.disabled = false; btn.textContent = btnLabel; };
  // Wait for anonymous (or identified) sign-in so the password-hash read
  // succeeds under Round-2 rules (session .read requires auth != null).
  ensureSignedIn().then(() =>
    db.ref(sPath("adminPasswordHash")).once("value")
  ).then(snap => {
    const stored = snap.val();
    if (!stored) {
      el("admin-hint").textContent =
        "No admin password set yet - the super admin must set one first.";
      restore(); return;
    }
    // verifyPassword handles both the new PBKDF2 ("v2$…") format and any
    // legacy raw-SHA-256 hash; comparison is constant-time
    return verifyPassword(pass, sessionNum, stored).then(ok => {
      if (!ok) {
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
  // refuse explicitly when super-admin is disabled in this deployment - the
  // comparison-against-null path below would still reject any non-null
  // submission, but a clear error message avoids confusion
  if (!SUPERADMIN_KEY) {
    el("admin-hint").textContent = "Super-admin is disabled on this deployment.";
    return;
  }
  if (key !== SUPERADMIN_KEY) {
    el("admin-hint").textContent = "Incorrect super-admin key."; return;
  }
  if (!newPass) { el("admin-hint").textContent = "Enter a new session password to set."; return; }
  dbInit();
  // Round-2 rules require auth != null on every write; super-admin needs
  // to be signed in before setting the first password hash.
  //
  // D21 recovery flow: if a hash already exists (forgotten-password case
  // during a live session), the new rule for adminPasswordHash refuses a
  // bare overwrite. The super-admin must first write a fresh
  // `_superadminReset` flag (requestedAt within ±5s of server `now`); the
  // adminPasswordHash rule then allows a single overwrite within 30s. We
  // clear the flag after the overwrite to keep the door shut.
  //
  // SECURITY NOTE: SUPERADMIN_KEY is verified client-side only; an
  // attacker with the database URL + the key in their own browser can
  // still trigger this path. This is the same threat model as the
  // initial-password set. A stronger gate (Firebase Custom Claims via a
  // Cloud Function checking the key server-side) would require Blaze.
  // The in-rules approach above bounds the overwrite window and creates
  // a visible `_superadminReset` audit trail in the DB.
  ensureSignedIn()
    .then(() => hashPassword(newPass, sessionNum))
    .then(h => {
      const refHash = db.ref(sPath("adminPasswordHash"));
      return refHash.once("value").then(snap => {
        if (!snap.exists()) {
          // initial set — the existing !data.exists() branch of the rule
          // allows this without a reset flag
          return refHash.set(h);
        }
        // overwrite path — write the freshness-bounded flag, set the hash,
        // then clear the flag. If any step fails, the catch below surfaces
        // a generic "could not reach" hint and the operator can retry.
        //
        // R3-D1 fix: use firebase.database.ServerValue.TIMESTAMP rather than
        // Date.now() so a client clock that is skewed beyond ±5 s of server
        // time still passes the rule's freshness window. The rule compares
        // requestedAt against the server `now` — Date.now() reads the local
        // wall-clock, which routinely drifts on unplugged laptops, after
        // long sleeps, or with a dead CMOS battery. Falling back to
        // Date.now() preserves behaviour in non-Firebase test contexts.
        const refReset = db.ref(sPath("_superadminReset"));
        const TS = (typeof firebase !== "undefined" &&
          firebase.database && firebase.database.ServerValue &&
          firebase.database.ServerValue.TIMESTAMP) || Date.now();
        return refReset.set({ requestedAt: TS, by: myName })
          .then(() => refHash.set(h))
          .then(() => refReset.remove())
          .catch(err => {
            // best-effort flag cleanup; the rule's 30s window self-expires
            // even if remove() fails, so the door re-closes automatically
            try { refReset.remove(); } catch (_) {}
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
    el("admin-hint").textContent = "Could not reach the session database.";
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
  const debriefBtn = el("admin-debrief-btn");
  if (debriefBtn && !debriefBtn.dataset.wired) {
    debriefBtn.dataset.wired = "1";
    debriefBtn.addEventListener("click", toggleDebrief);
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
    // D21 recovery: if the target session already has a hash, the rule
    // requires a fresh _superadminReset flag (see joinSuperAdmin comment
    // above and database.rules.json for full rationale).
    hashPassword(np, targetSession)
      .then(h => {
        const refHash = db.ref(oPath(targetSession, "adminPasswordHash"));
        return refHash.once("value").then(snap => {
          if (!snap.exists()) return refHash.set(h);
          const refReset = db.ref(oPath(targetSession, "_superadminReset"));
          return refReset.set({ requestedAt: Date.now(), by: myName || "superadmin" })
            .then(() => refHash.set(h))
            .then(() => refReset.remove())
            .catch(err => { try { refReset.remove(); } catch (_) {} throw err; });
        });
      })
      .then(() => {
        el("change-pass-input").value = "";
        const ok = el("change-pass-ok");
        ok.textContent = "Saved for Session " + targetSession;
        flashSaved("change-pass-ok", 2000);
      }).catch(e => {
      console.error("Set password failed", e);
      alert("Could not save the password - check your connection and try again.");
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

function renderPrestart() {
  const waiting = Object.keys(pool).map(cid => pool[cid]);
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
  if (waiting.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No one has joined yet.";
    list.appendChild(p);
    return;
  }
  waiting.sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(person => {
    list.appendChild(makeChip(person.name,
      person.name + "  ·  " + person.university +
      "  ·  Year " + person.year + "  ·  English " + person.english,
      "prestart-person"));
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
        const updates = [];
        Object.keys(assignment).forEach(cid => {
          updates.push(refPool.child(cid).child("room").set(assignment[cid]));
        });
        Promise.all(updates).then(() => {
          return Promise.all([refRoomCount.set(rc), refStarted.set(true)]);
        }).then(() => {
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
function minsSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 60000);
}
function roomProgress(data) {
  const revealed = (data.moduleA && data.moduleA.revealed) || {};
  const aCount = Object.keys((data.answers && data.answers.moduleA) || {}).length;
  const bCount = Object.keys((data.answers && data.answers.moduleB) || {}).length;
  return "findings " + Object.keys(revealed).length + "/" + ITEM_IDS.length +
    " · answers A" + aCount + " B" + bCount;
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
    return (v === "dark" || v === "light") ? v : "auto";
  } catch (e) { return "auto"; }
}
function setTheme(mode) {
  if (mode !== "dark" && mode !== "light" && mode !== "auto") return;
  try {
    if (mode === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", mode);
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
    info.appendChild(timer); info.appendChild(prog); info.appendChild(ppl);
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
      // write succeeded - update the button
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
function buildButtons() {
  ["history", "exam", "labs"].forEach(group => {
    const container = el("group-" + group);
    container.innerHTML = "";
    CASE[group].forEach((item, i) => {
      const id = group + ":" + i;
      const btn = document.createElement("button");
      btn.className = "req-btn" + (item.key ? " key-btn" : "");
      btn.dataset.id = id;
      // item.q is a translatable { en, fr, ja } in the default content, but
      // tc() also passes plain strings through (back-compat for custom JSON).
      btn.textContent = tc(item.q, _curLang());
      btn.addEventListener("click", () => reveal(id));
      container.appendChild(btn);
    });
  });
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
  document.querySelectorAll(".req-btn").forEach(btn => {
    const id = btn.dataset.id;
    btn.classList.toggle("done", !!revealed[id]);
    if (id === SYNTH_ID) {
      const locked = !gateOK && !revealed[id];
      btn.disabled = locked;
      btn.title = locked
        ? "First screen serious causes, screen for cauda equina, and examine the legs"
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
      let note = btn.nextElementSibling;
      if (note && !note.classList.contains("req-warn-note")) note = null;
      if (warn) {
        if (!note) {
          note = document.createElement("p");
          note.className = "req-warn-note";
          note.id = "warn-" + id.replace(":", "-");
          note.textContent = "Screen the red flags and examine the legs first — " +
            "ordering a scan now costs the 'safety first' points.";
          btn.insertAdjacentElement("afterend", note);
        }
        btn.setAttribute("aria-describedby", note.id);
        btn.title = "";
      } else {
        if (note) note.remove();
        btn.removeAttribute("aria-describedby");
        if (!revealed[id]) btn.title = "";
      }
    }
  });
}
function renderFindings() {
  const log = el("findings-log");
  log.innerHTML = "";
  const ids = ITEM_IDS.filter(id => revealed[id])
    .sort((a, b) => (revealed[a].at || 0) - (revealed[b].at || 0));
  el("findings-count").textContent = ids.length + " / " + ITEM_IDS.length;
  el("findings-empty").classList.toggle("hidden", ids.length > 0);
  setTabBadge("tab-badge-findings", ids.length);
  // Track the <li> we just created for the local revealer's tap so we
  // can scroll it into view AFTER the loop (Bug 3 — Android: on stacked
  // mobile layout the new finding lands far below the buttons and the
  // user doesn't see it appear).
  let scrollTarget = null;
  ids.forEach(id => {
    const item = itemById(id), meta = revealed[id];
    const li = document.createElement("li");
    if (item.key) li.className = "key";
    if (!seenFindingIds[id]) {
      li.classList.add("just-in"); seenFindingIds[id] = true;
      nudgeRcolTab("findings");
    }
    if (id === myPendingReveal) scrollTarget = li;
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
  if (scrollTarget) {
    // Switch to the Findings tab in case the user was on Decisions /
    // Discussion / Reference when the patient response landed (otherwise
    // the panel is display:none and scrollIntoView is a no-op).
    if (typeof switchRcolTab === "function") switchRcolTab("findings");
    // rAF gives the layout engine a tick to apply the tab switch before
    // we ask the browser to scroll — without it the panel is still
    // hidden when scrollIntoView runs and the call is a no-op on Android
    // Chrome.
    const doScroll = () => {
      try {
        scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (_) {
        // Older Android Chrome doesn't support the options object —
        // fall back to the no-arg form which still scrolls.
        try { scrollTarget.scrollIntoView(); } catch (__) {}
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(doScroll);
    else doScroll();
    myPendingReveal = null;
  }
}
function keyRevealed() {
  return ITEM_IDS.some(id => revealed[id] && itemById(id).key);
}
let promptsWereUnlocked = false;
function renderPrompts() {
  const unlocked = keyRevealed();
  el("prompts-locked").classList.toggle("hidden", unlocked);
  const list = el("prompts-list");
  list.classList.toggle("hidden", !unlocked);
  el("compare-card").classList.toggle("hidden", !unlocked);
  list.innerHTML = "";
  if (unlocked) {
    const lang = _curLang();
    CASE.prompts.forEach(p => {
      const li = document.createElement("li");
      li.textContent = tc(p, lang);
      list.appendChild(li);
    });
  }
  setTabBadge("tab-badge-discussion", unlocked ? "🔓" : "");
  if (unlocked && !promptsWereUnlocked) {
    promptsWereUnlocked = true;
    nudgeRcolTab("discussion");
  } else if (!unlocked) {
    promptsWereUnlocked = false;
  }
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
  list.forEach(nm => {
    const did = !!acted[nm];
    const chip = document.createElement("span");
    chip.className = "contrib-chip" + (did ? " acted" : "");
    const dot = document.createElement("span");
    dot.className = "contrib-dot" + (did ? " on" : "");
    if (did) dot.style.background = colorFor(nm);
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(nm));
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
function renderDecisions() {
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
    list.forEach(d => box.appendChild(buildDecision(d)));
  });
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
      + (committed != null && opt.correct ? " is-correct" : "");
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

/* save the room's chosen team name (any room member may set it) */
function initTeamName() {
  const btn = el("team-name-btn"), inp = el("team-name-input");
  if (!btn || !inp) return;
  const save = () => {
    const v = (inp.value || "").trim().slice(0, 32);
    if (!v || !refTeamName) return;
    refTeamName.set(v)
      .then(() => toast("Team name saved — " + v))
      .catch(e => console.error("Team name save failed", e));
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
function renderAnswers(moduleKey) {
  renderContrib();
  renderAnswerHints(moduleKey);
  checkScoreEvents();
  const list = el("answers-list-" + moduleKey);
  if (!list) return;
  // tab badge for the Module A "Group answers" tab in the right column
  if (moduleKey === "moduleA") {
    const n = Object.keys(answers.moduleA || {}).length;
    setTabBadge("tab-badge-answers", n || "");
    if (n > (lastAnswerCount.moduleA || 0)) nudgeRcolTab("answers");
    lastAnswerCount.moduleA = n;
  }
  // if THIS user is mid inline-edit, a rebuild would destroy their open <input>
  // and abort the edit - defer until the edit finishes (flag set in editAnswer)
  if (list._editing) { list._pendingRender = true; return; }
  list._pendingRender = false;
  list.innerHTML = "";
  const entries = entriesSorted(answers[moduleKey]);
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "answers-empty";
    li.textContent = "No points yet - add the group's bullets below.";
    list.appendChild(li);
    return;
  }
  entries.forEach(entry => {
    const li = document.createElement("li");
    li.className = "answer-entry";
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
    }
    list.appendChild(li);
  });
}
function addAnswer(moduleKey) {
  const input = el("answer-input-" + moduleKey);
  const text = (input.value || "").trim();
  if (!text || !refAnswers[moduleKey]) return;
  clearTimeout(typingTimer);   // stop the pending "still typing" tick
  setTyping(null);
  // tag the author's university so the export is analysable for cross-cultural
  // balance (who from which country contributed which point)
  refAnswers[moduleKey].push({
    by: myName, cid: clientId, university: myUniversity || "", text: text, at: Date.now()
  })
    .then(() => { input.value = ""; })
    .catch(() => { /* keep the text in the box so a failed write doesn't lose it */ });
  // append-only event log: NEVER include the answer body (see §3.4 of the
  // event-sourcing design — payload is metadata only: who, where, length)
  logEvent(myRoom, "answer." + moduleKey, {
    by: myName, university: myUniversity || "", len: text.length
  });
}
/* Inline edit: swap the text span for an input (no native prompt() - it is
   modal, untranslatable and awkward on a projector / second language). */
function editAnswer(moduleKey, entry, li) {
  if (li.querySelector(".answer-edit")) return;
  const txtSpan = li.querySelector(".answer-text");
  if (!txtSpan) return;
  const list = el("answers-list-" + moduleKey);
  list._editing = true;   // pause rebuilds while this edit is open
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
    refAnswers[moduleKey].child(entry.id).once("value").then(snap => {
      if (snap.val() == null) { renderAnswers(moduleKey); return; }   // deleted meanwhile
      if (!v) return deleteAnswer(moduleKey, entry.id);
      return refAnswers[moduleKey].child(entry.id).child("text").set(v);
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
    list._editing = false;
    save();
    renderAnswers(moduleKey);
  });
  txtSpan.replaceWith(input);
  input.focus();
  input.select();
}
function deleteAnswer(moduleKey, id) {
  return refAnswers[moduleKey].child(id).remove().catch(e => {
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
  document.querySelectorAll(".answer-add-btn").forEach(btn => {
    btn.addEventListener("click", () => addAnswer(btn.dataset.mod));
  });
  const i18nT = (typeof window !== "undefined" && typeof window.t === "function")
    ? window.t
    : ((k) => k);
  ["moduleA", "moduleB"].forEach(moduleKey => {
    const input = el("answer-input-" + moduleKey);
    input.addEventListener("keydown", e => { if (e.key === "Enter") addAnswer(moduleKey); });
    input.addEventListener("input", () => {
      setTyping(moduleKey);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(null), 2500);
    });
    input.addEventListener("blur", () => setTyping(null));
    // localize the placeholder (the i18n applyI18n() pass only handles one
    // attribute via data-i18n-attr, which we use for aria-label).
    input.setAttribute("placeholder", i18nT("room.answer-input-placeholder"));
  });
  // initial hint text; renderAnswerHints keeps it live as answers come in
  el("answersA-hint").textContent = i18nT("room.answers.hint.moduleA");
  el("answersB-hint").textContent = i18nT("room.answers.hint.moduleB");
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
function paintJoinQr(code) {
  const container = el("splash-qr-img");
  const wrap = el("splash-qr-wrap");
  if (!container || !wrap) return;
  // qrcode.js is lazy-loaded (out of the splash bundle). Pull it in now
  // if the admin hasn't reached this surface yet, then re-call ourselves.
  if (typeof QRCode === "undefined") {
    if (window.CanamedLoader && window.CanamedLoader.ensureQrcode) {
      window.CanamedLoader.ensureQrcode()
        .then(() => paintJoinQr(code))
        .catch(() => { wrap.hidden = true; });
      return;
    }
    // Library not available and no loader — hide the section, fall back to
    // "read the code aloud", same UX as the old onerror handler.
    wrap.hidden = true;
    return;
  }
  // Clear any previous render — qrcode.js appends a <canvas> + <img>
  // each call, so a fresh "Create another" round would otherwise stack.
  container.innerHTML = "";
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

/* swap which splash view is visible. The card itself stays put, only the inner
   "view" changes - keeps the layout stable as the user moves between flows. */
function splashShowView(name) {
  ["enter", "create", "created", "account", "profile-setup"].forEach(v => {
    const node = el("splash-view-" + v);
    if (node) node.hidden = (v !== name);
  });
  const focusable = {
    "enter": "splash-code",
    "create": "splash-create-name",
    "created": "splash-copy-code",
    "account": "splash-account-email",
    "profile-setup": "splash-prof-name"
  }[name];
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
  // if a previously unlocked session is still valid, skip the splash
  const stored = sanitizeCode(localStorage.getItem("canamed_session"));
  if (stored) {
    sessionExists(stored).then(ok => {
      if (ok) {
        enterUnlockedSession(stored);
      } else {
        // stale code (session purged or never existed): clear and show splash
        try { localStorage.removeItem("canamed_session"); } catch (e) {}
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
    // If the user landed via a deep-link (e.g., a QR scan or a shared
    // URL), pre-fill the code and auto-submit. Runs AFTER wireSplash() so
    // the splash-enter form's submit handler is already attached.
    tryConsumeDeepLink();
  }
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
    sessionExists(got).then(ok => {
      if (!ok) {
        // B7 (SIMULATION_EDGE_CASES.md): if the user typed a 6-char code
        // without the dash (e.g. "abcdef"), try the dashed variant
        // ("abc-def") before showing the generic miss. Only auto-retry
        // when (a) we got exactly 6 alphanumeric chars and (b) inserting
        // a dash produces the canonical XXX-XXX format that
        // generateSessionCode() emits.
        if (/^[a-z0-9]{6}$/.test(got)) {
          const dashed = got.slice(0, 3) + "-" + got.slice(3);
          return sessionExists(dashed).then(okDashed => {
            if (okDashed) {
              hint.textContent = "";
              if (code) code.value = dashed;
              enterUnlockedSession(dashed);
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
    createSession(name, label, pass, scenarioId, customJson).then(code => {
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
      paintJoinQr(code);
      splashShowView("created");
      cHint.textContent = "";
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
    .addEventListener("click", () => { window._splashJustCreated = null; splashShowView("create"); });
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
      // write the markers - `created` first so a half-finished create is still
      // recognisable (and easy to clean up), then the password hash
      const at = Date.now();
      const writes = [
        db.ref(oPath(code, "created")).set({ by: creatorName, at: at })
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
        .then(h => db.ref(oPath(code, "adminPasswordHash")).set(h))
        .then(() => code);
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
  // Round-2: if the user is currently anonymous, upgrade (link) the
  // existing uid so users/{uid}/history survives the sign-in. If linking
  // fails because the credential is already attached to another account
  // (auth/credential-already-in-use, auth/email-already-in-use), fall
  // back to a plain signInWithPopup so the user can still get into the
  // app — they'll lose history written under the anon uid in that case.
  const cur = auth.currentUser;
  const popupSignIn = () => auth.signInWithPopup(provider);
  const link = (cur && cur.isAnonymous)
    ? cur.linkWithPopup(provider).catch(e => {
        if (e && (e.code === "auth/credential-already-in-use" ||
                  e.code === "auth/email-already-in-use" ||
                  e.code === "auth/provider-already-linked")) {
          return popupSignIn();
        }
        throw e;
      })
    : popupSignIn();
  link.then(() => {
    // handleAuthStateChange takes over from here
    splashHintOk(hint, "");
  }).catch(e => splashHintErr(hint, authErrorMessage(e)));
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

/* Profile-setup submit (right after sign-up) */
function profileSetupSubmit() {
  const hint = el("splash-profile-setup-hint");
  const name = (el("splash-prof-name").value || "").trim();
  const uni = (el("splash-prof-uni").value || "").trim();
  const year = parseInt(el("splash-prof-year").value, 10) || 1;
  const english = (el("splash-prof-english").value || "B2").trim();
  if (!name) { splashHintErr(hint, "Enter your name."); return; }
  if (!uni) { splashHintErr(hint, "Pick your university."); return; }
  splashHintOk(hint, "Saving your profile…");
  saveProfile({ name: name, university: uni, year: year, english: english }).then(() => {
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
  const name = (el("account-name").value || "").trim();
  const uni = (el("account-uni").value || "").trim();
  const year = parseInt(el("account-year").value, 10) || 1;
  const english = (el("account-english").value || "B2").trim();
  if (!name) { splashHintErr(hint, "Enter your name."); return; }
  saveProfile({ name: name, university: uni, year: year, english: english }).then(() => {
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

/* ===================== START ===================== */
initEntry();
