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
  /* data-theme="auto" (or unset) + a dark OS resolves to the dark palette
     via the prefers-color-scheme media query, so the light-tuned org
     primary must be skipped there too — otherwise this inline override
     beats the stylesheet's dark --primary/--on-primary pair and text on
     primary fills drops below AA. */
  const prefersDark = typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const skipPrimary = (theme === "dark" || theme === "high-contrast" ||
    ((theme === null || theme === "auto") && prefersDark));
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
/* Re-resolve the org primary when the OS flips light/dark mid-session while
   the user is on data-theme="auto" (same reason as the prefersDark check
   inside applyOrgTheme). */
try {
  if (typeof window !== "undefined" && window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", function () { applyOrgTheme(currentOrgConfig); });
  }
} catch (_) {}
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
// Set of reveal-item ids that are a DELIBERATELY-WRONG clinical choice (each
// maps to an entry in PENALTIES with a points cost). Used by renderButtons to
// colour a revealed "inappropriate" item RED instead of the normal green
// (user request 2026-06-02 — Module A examinations/investigations). Rebuilt
// from window.PENALTIES whenever the scenario changes (applyScenario).
let PENALTY_ITEM_IDS = new Set();
function rebuildCaseDerived() {
  ITEM_IDS = [];
  if (typeof CASE !== "object" || !CASE) return;
  ["history", "exam", "labs"].forEach(g => {
    if (CASE[g] && CASE[g].forEach) {
      CASE[g].forEach((_, i) => ITEM_IDS.push(g + ":" + i));
    }
  });
  // Derive the penalised-item set from the active PENALTIES list (window.PENALTIES
  // wins after applyScenario; the top-level `PENALTIES` from case-content.js is
  // the default). Each penalty's `item` is a "group:index" reveal id.
  const pens = (typeof window !== "undefined" && Array.isArray(window.PENALTIES))
    ? window.PENALTIES
    : (typeof PENALTIES !== "undefined" && Array.isArray(PENALTIES)) ? PENALTIES : [];
  PENALTY_ITEM_IDS = new Set(pens.map(p => p && p.item).filter(Boolean));
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
  // Unconditional: a scenario declaring no characters must NOT inherit the
  // previous scenario's cast. null → modA-llm-prompts falls back to a generic
  // patient built from this scenario's own facts.
  window.CURRENT_SCENARIO_CHARACTERS = Array.isArray(sc.characters) ? sc.characters : null;
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
  /* S1c-1 — the roleplay section's own content (its cast, for now). ALWAYS
     reassigned, including to null: a scenario without it must fall back to the
     built-in cast rather than inherit the previous scenario's, which is the
     same staleness trap scenarioModuleSet() documents for module names. */
  window.CURRENT_SECTION_ROLEPLAY = (sc && typeof sc.roleplay === "object") ? sc.roleplay : null;
  if (typeof document !== "undefined") {
    try {
      if (typeof renderRoleChips === "function") renderRoleChips();
      if (typeof renderRoleplayPanels === "function") renderRoleplayPanels();
      if (typeof renderObserverChecklist === "function") renderObserverChecklist();
      if (typeof renderPhaseStepper === "function") renderPhaseStepper();
      if (typeof renderRoleplayVignette === "function") renderRoleplayVignette();
    } catch (e) { /* pre-DOM call sites */ }
  }
  // Activity format: "branched" runs the épuré one-decision-at-a-time branch
  // flow (the existing decision engine, with the clinical/roleplay chrome
  // hidden via the per-stage .stage[data-format="branched"] CSS hook stamped
  // below — M4a; two genuinely-global rules stay body-scoped); anything else is
  // the standard PBL/roleplay layout. Defaults to "standard" so untagged
  // scenarios are unaffected.
  window.CURRENT_SCENARIO_FORMAT = (sc && sc.format) || "standard";
  // M1 — the module set this scenario CONTAINS (e.g. ["A"] for a clinical-
  // reasoning-only case, ["B"] for a pure breaking-bad-news roleplay). Null when
  // undeclared, in which case moduleSet() infers from content so every existing
  // scenario still runs A+B with no migration. Must be assigned AFTER
  // CURRENT_SCENARIO_FORMAT (moduleSet reads it) and before refreshModuleStages().
  window.CURRENT_SCENARIO_MODULES = Array.isArray(sc && sc.modules) ? sc.modules.slice() : null;
  // M4c — COMPOSITION: a mixed scenario runs a branched decision case alongside
  // A/B by REFERENCING a standalone branched scenario id, rather than inlining a
  // second node-graph schema. composeBranchedModule() resolves that reference and
  // merges its nodes into DECISIONS tagged module:"branched", so the existing
  // decision engine renders them on the branched stage with no new runtime.
  window.CURRENT_SCENARIO_BRANCHED_REF = (sc && sc.branchedRef) || null;
  refreshModuleStages();
  // Optional branched FINAL step (the OSCE diagnosis/management deliverable):
  // { title, prompt, fields:[{key,label,hint}] }. Null falls back to the
  // default diagnosis + management fields in branched-render.js.
  window.CURRENT_SCENARIO_FINAL_STEP = (sc && sc.finalStep) || null;
  // M4c — compose LAST of the scenario globals: it may override
  // CURRENT_SCENARIO_FINAL_STEP with the referenced branched scenario's own
  // deliverable, so it must run after the line above rather than before it.
  composeBranchedModule();
  try {
    if (typeof document !== "undefined" && document.body) {
      /* S7 — with the Scenario select gone, a session's FORMAT can no longer
         come only from the applied scenario: a pick of just the branched
         section applies no scenario at all, so the body would stamp "standard"
         and the épuré branched layout would never load. Derive it from the
         PICK when there is one — branched only when EVERY picked section is
         branched, i.e. a standalone branched session. A mixed pick stays
         "standard" at the body level and relies on the per-STAGE stamping
         below, which is what M4a built that stamping for. */
      var _picked = (typeof pickedSections === "function") ? pickedSections() : null;
      var _pickFmt = (_picked && _picked.length &&
                      _picked.every(function (x) { return x && x.type === "branched"; }))
        ? "branched" : null;
      document.body.dataset.format = _pickFmt || window.CURRENT_SCENARIO_FORMAT;
      // M4a: ALSO stamp each stage, so the épuré CSS keys off the STAGE
      // (.stage[data-format="branched"]) rather than the whole body. A standalone
      // branched scenario stamps every stage the same as body → byte-identical
      // rendering; a future MIXED session (M4c) stamps ONLY its branched stage,
      // so only that stage goes épuré while the A/B stages keep their chrome.
      var _fmt = _pickFmt || window.CURRENT_SCENARIO_FORMAT || "standard";
      var _stages = document.querySelectorAll(".stage");
      for (var _i = 0; _i < _stages.length; _i++) _stages[_i].dataset.format = _fmt;
    }
  } catch (_) { /* no document (Node/tests) — the format flag is a UI-only hook */ }
  // Branched scenarios pull in their room-only stylesheet (branched.css) HERE —
  // the earliest point the format is known — so the épuré layout + components
  // are styled before the room paints. Loaded lazily (kept off the splash CSS
  // budget); standard sessions never request it.
  /* S7 — the stylesheet must follow the SAME derivation as the format stamp
     above, not just the scenario: a pick of only the branched section applies
     no scenario, so keying on CURRENT_SCENARIO_FORMAT alone left the épuré
     layout unstyled (the format attribute was right and the CSS never arrived —
     a genuinely confusing half-broken state). A MIXED pick needs it too, since
     its branched STAGE is stamped even when the body is not. */
  var _needsBranchedCss = (window.CURRENT_SCENARIO_FORMAT === "branched");
  try {
    var _p = (typeof pickedSections === "function") ? pickedSections() : null;
    if (_p && _p.some(function (x) { return x && x.type === "branched"; })) {
      _needsBranchedCss = true;
    }
  } catch (_) { /* library not loaded yet — the scenario check still applies */ }
  if (_needsBranchedCss &&
      window.CanamedLoader && typeof window.CanamedLoader.ensureBranchedStyles === "function") {
    // Fire-and-forget: the stylesheet load is async (the room paints after the
    // lobby, so it has time). Swallow a load failure — the branched UI degrades
    // to the unstyled-but-functional layout rather than throwing here.
    window.CanamedLoader.ensureBranchedStyles().catch(function () {});
  }
  rebuildCaseDerived();
  return true;
}

/* Apply the platform DEFAULT scenario (window.CANAMED_DEFAULT_SCENARIO_ID).
   Used as the deterministic fallback whenever a session pins no usable scenario
   or the scenario read fails — so a client can NEVER keep the cast that a PRIOR
   session left in this tab. That stale-global leak was reported live: a
   chronic-pain Module A voiced "Mrs Tanaka" for a student whose tab had earlier
   run the breaking-bad-news case and whose scenario read then fell through, so
   CURRENT_SCENARIO_CHARACTERS (and CASE) were never re-applied. Re-applying the
   default is identical to a fresh page-load and is the correct content for a
   session that genuinely pinned no scenario. */
function applyDefaultScenario() {
  const defId = (typeof window !== "undefined" && window.CANAMED_DEFAULT_SCENARIO_ID) || null;
  return defId ? applyScenario(defId) : false;
}

/* read the scenario from the session record (set at creation) and apply it.
   Resolves once the content is in place - callers should await before any
   case-dependent UI is built.

   Resolution priority: scenarioCustomJson (legacy pasted JSON) →
   scenarioRef (authored, fetched from scenarios/$ownerUid or
   sharedScenarios/$shareId) → scenarioId (built-in registry). */
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
    db.ref(oPath(code, "scenarioCustomJson")).once("value"),
    db.ref(oPath(code, "scenarioRef")).once("value"),
    db.ref(oPath(code, "modules")).once("value"),
    db.ref(oPath(code, "sections")).once("value"),
    db.ref(oPath(code, "sectionBodies")).once("value")
  ])).then(res => {
    const id = res[0] && res[0].val();
    const customJson = res[1] && res[1].val();
    const ref = res[2] && res[2].val();
    // M2 — the facilitator's per-session narrowing, written write-once at create.
    // Publish it BEFORE any applyScenario() below: applyScenario calls
    // refreshModuleStages(), which must already see the narrowing or the first
    // stageFlow() of the session would use the scenario's full set and briefly
    // offer a stage this session does not run.
    setSessionModules(res[3] && res[3].val());
    /* S3a — the facilitator's ordered SECTION pick, same write-once timing rule
       as the narrowing above: publish it before any applyScenario(), or the
       session's first stageFlow() runs the scenario's shape instead of the
       picked one. Resolution needs the lazily-loaded section library, so a pick
       read before that chunk lands simply falls back until it does. */
    /* S7 — register any AUTHORED section snapshots into the library FIRST.
       Order matters: setSessionSections() below triggers refreshModuleStages(),
       which resolves every token against window.CANAMED_SECTIONS. Registering
       after it would make the session's first stageFlow() drop each
       custom-<slot> as unresolvable — the stage would simply not exist. */
    registerSectionBodies(res[5] && res[5].val());
    setSessionSections(res[4] && res[4].val());
    let custom = null;
    if (customJson) {
      try { custom = JSON.parse(customJson); } catch (e) {
        console.error("Custom scenario JSON parse failed", e);
      }
    }
    // Whatever the resolution path, END on a DETERMINISTIC scenario so a client
    // never keeps the cast a PRIOR session left in this tab (the stale-global
    // leak — see applyDefaultScenario). A character-less custom scenario is fine:
    // applyScenario sets CURRENT_SCENARIO_CHARACTERS = null → "the patient", not
    // a stale name. We only fall back to the default when NO usable scenario
    // applied (missing / unknown id, failed ref, absent field).
    if (custom && applyScenario(null, custom)) return true;
    if (ref) {
      return loadScenarioByRef(ref).then(body => {
        if (body && applyScenario(null, body)) return true;
        if (id && applyScenario(id)) return true;
        return applyDefaultScenario();
      });
    }
    if (id && applyScenario(id)) return true;
    // session pinned no scenario (or an unknown id) — apply the platform default
    // EXPLICITLY rather than leaving a prior session's cast in place.
    return applyDefaultScenario();
  }).catch(e => {
    console.error("loadSessionScenario failed", e);
    // Even on a hard read failure, re-establish a deterministic cast instead of
    // leaving whatever a prior session loaded into this tab.
    return applyDefaultScenario();
  });
}

/* Resolve a scenarioRef ({ ownerUid, scenarioId, source }) to a parsed
   scenario body object. source="private" reads scenarios/$ownerUid/$id
   (only succeeds when caller IS the owner — the rule blocks other reads);
   source="shared" reads sharedScenarios/$ownerUid_$id and is readable by
   any authenticated user. */
function loadScenarioByRef(ref) {
  if (!ref || !ref.ownerUid || !ref.scenarioId || !db) return Promise.resolve(null);
  const path = (ref.source === "shared")
    ? "sharedScenarios/" + ref.ownerUid + "_" + ref.scenarioId + "/bodyJson"
    : "scenarios/" + ref.ownerUid + "/" + ref.scenarioId + "/bodyJson";
  return db.ref(path).once("value")
    .then(snap => {
      const json = snap && snap.val();
      if (!json) return null;
      try { return JSON.parse(json); }
      catch (e) { console.error("Scenario bodyJson parse failed", e); return null; }
    })
    .catch(e => { console.error("loadScenarioByRef read failed", e); return null; });
}

/* List the calling user's authored scenarios. Returns [] when signed-out
   or in local-test mode. Each entry: { id, meta }. */
function listMyScenarios() {
  if (!auth || !auth.currentUser || !db) return Promise.resolve([]);
  const uid = auth.currentUser.uid;
  return db.ref("scenarios/" + uid).once("value")
    .then(snap => {
      const out = [];
      snap.forEach(child => {
        const v = child.val() || {};
        /* `bodyJson` is FREE here — this read already pulls the whole
           scenarios/<uid> subtree including it, and the previous version simply
           discarded it. The SECTION picker needs it: `meta` carries only
           {id,name,summary,createdAt,updatedAt,version,locale}, with no
           `modules` and no `format`, so metadata alone cannot tell you whether
           a scenario yields a PBL section, a Roleplay one, or a branched one.
           Left unparsed here — the caller parses defensively, so one malformed
           body cannot take the whole list down. */
        out.push({ id: child.key, meta: v.meta || {}, bodyJson: v.bodyJson || null });
      });
      return out;
    })
    .catch(e => { console.warn("listMyScenarios failed", e); return []; });
}

/* List shared scenarios published by any user. Each entry:
   { shareId, ownerUid, scenarioId, ownerName, meta }. Capped at 200 to
   avoid pulling unbounded data — the picker is for facilitator quick
   selection, not a marketplace. Feature-detects .limitToFirst so we work
   against both the real RTDB SDK (server-side limit) and LocalDB's shim
   (no limit support — we slice the snapshot client-side instead). */
function listSharedScenarios() {
  if (!db) return Promise.resolve([]);
  const baseRef = db.ref("sharedScenarios");
  const queryRef = (typeof baseRef.limitToFirst === "function")
    ? baseRef.limitToFirst(200)
    : baseRef;
  // Takedowns: moderation/removed/<shareId> (outside sharedScenarios so a
  // re-publish can't clear one). Degrades to "nothing removed" if absent.
  const removedP = db.ref("moderation/removed").once("value")
    .then(s => s.val() || {})
    .catch(() => ({}));
  return Promise.all([queryRef.once("value"), removedP])
    .then(res => {
      const snap = res[0];
      const removed = res[1] || {};
      const out = [];
      snap.forEach(child => {
        if (out.length >= 200) return true; // forEach stops on truthy return
        if (removed[child.key] === true) return; // taken down by a moderator
        const v = child.val() || {};
        out.push({
          shareId: child.key,
          ownerUid: v.ownerUid || "",
          scenarioId: v.scenarioId || "",
          ownerName: v.ownerName || "",
          meta: v.meta || {}
        });
      });
      return out;
    })
    .catch(e => { console.warn("listSharedScenarios failed", e); return []; });
}

/* File a moderation report: write-own + write-once at
   reports/scenarios/<shareId>/<uid>. `reason` capped to the rules' 500. */
function reportSharedScenario(shareId, reason) {
  if (!db || !auth || !auth.currentUser) {
    return Promise.reject(new Error("report: not signed in"));
  }
  const payload = { at: Date.now() };
  if (reason) payload.reason = String(reason).slice(0, 500);
  return db.ref("reports/scenarios/" + shareId + "/" + auth.currentUser.uid).set(payload);
}

/* Persist an authored scenario for the signed-in user. `body` is the
   scenario object the runtime expects (case / scoring / penalties /
   decisions / synthId / synthPrereqs / preTest / postTest / name /
   summary / moduleAName / moduleBName). Stored as a single stringified
   blob under bodyJson; queryable metadata is split out under meta/. When
   `share` is true, also publishes (or refreshes) a copy under
   sharedScenarios/<uid>_<id>; when false, removes the shared copy if
   one exists. Returns the stored meta on success. */
function saveScenario(scenarioId, body, share) {
  if (!auth || !auth.currentUser || !db) {
    return Promise.reject(new Error("Sign in to save scenarios."));
  }
  if (!scenarioId || !/^[a-z0-9_-]{1,60}$/.test(scenarioId)) {
    return Promise.reject(new Error("Scenario id must be 1-60 chars, lower-case alphanumerics, _ or -."));
  }
  if (!body || typeof body !== "object") {
    return Promise.reject(new Error("Scenario body must be an object."));
  }
  const uid = auth.currentUser.uid;
  const bodyJson = JSON.stringify(body);
  if (bodyJson.length > 262144) {
    return Promise.reject(new Error("Scenario is too large (" + bodyJson.length +
      " bytes, max 262144). Split content across modules or trim long narrative."));
  }
  const now = Date.now();
  const path = "scenarios/" + uid + "/" + scenarioId;
  return db.ref(path + "/meta/createdAt").once("value").then(snap => {
    const createdAt = snap.val() || now;
    const meta = {
      id: scenarioId,
      name: (typeof body.name === "string" ? body.name : (body.name && body.name.en) || scenarioId).slice(0, 200),
      summary: (typeof body.summary === "string" ? body.summary : (body.summary && body.summary.en) || "").slice(0, 400),
      createdAt: createdAt,
      updatedAt: now,
      version: (typeof body.version === "number" ? body.version : 1),
      locale: (typeof body.locale === "string" ? body.locale : "fr-ja")
    };
    const writes = [
      db.ref(path).set({ meta: meta, bodyJson: bodyJson })
    ];
    const shareId = uid + "_" + scenarioId;
    if (share) {
      const ownerName = (currentProfile && currentProfile.name) ||
                        (auth.currentUser.displayName) || "";
      writes.push(db.ref("sharedScenarios/" + shareId).set({
        ownerUid: uid,
        ownerName: ownerName.slice(0, 80),
        scenarioId: scenarioId,
        meta: meta,
        bodyJson: bodyJson
      }));
    } else {
      writes.push(db.ref("sharedScenarios/" + shareId).remove().catch(() => null));
    }
    return Promise.all(writes).then(() => meta);
  });
}

/* Remove an authored scenario (and any shared copy). Sessions that
   already reference it keep working at runtime only because the runtime
   reads bodyJson at session START — once deleted, future session loads
   will fall back to whatever scenarioId (if any) was also stored. */
function deleteScenario(scenarioId) {
  if (!auth || !auth.currentUser || !db) {
    return Promise.reject(new Error("Sign in required."));
  }
  const uid = auth.currentUser.uid;
  return Promise.all([
    db.ref("scenarios/" + uid + "/" + scenarioId).remove(),
    db.ref("sharedScenarios/" + uid + "_" + scenarioId).remove().catch(() => null)
  ]);
}

if (typeof window !== "undefined") {
  window.canamedScenarios = {
    list: listMyScenarios,
    listShared: listSharedScenarios,
    save: saveScenario,
    remove: deleteScenario,
    loadByRef: loadScenarioByRef
  };
}

/* Stage numbering, S1b: 0 = Welcome, 1..N = the sections this session picked in
   pick order, N+1 = Wrap-up. CONTIGUOUS — before S1b the middle indices were
   fixed per module (A→1, B→2, branched→3, wrap-up→4) and an A-only session ran
   [0,1,4] with two stages skipped. A stage number therefore no longer implies a
   module, a DOM node, or a duration; use slotAtStage(), stageViewId() and
   stageMinutes() for those. */
/* ⚠️ S1b — STAGE_COUNT IS NO LONGER THE STAGE COUNT. A session is Welcome + one
   stage per PICKED SECTION + Wrap-up, so the count is per-session: use
   stageCount() / lastStage(). This constant survives only as the PHYSICAL cap
   (the largest stage index the DB rules accept), and is what MAX_SECTION_SLOTS
   is derived from. Reading it as "the wrap-up index" — which every pre-S1b site
   did — is now a bug. */
const MAX_SECTION_SLOTS = 8;
const STAGE_COUNT = MAX_SECTION_SLOTS + 2;
// English fallback labels — used in admin-side text exports + as the
// fallback when i18n.js hasn't loaded yet (vanishingly rare). For
// any UI-visible label use stageLabel(i), which reads the current
// language from i18n.js. S1b: the middle entries are per-TYPE, not
// per-index, because a stage number no longer implies a module.
const STAGE_LABELS = { welcome: "Welcome", wrapup: "Wrap-up",
                       pbl: "Clinical case", roleplay: "Roleplay",
                       branched: "Decision case" };
/* Publish the wrap-up index for the LAZY branched-render.js, which owns
   stageFlow() once loaded. It used to hardcode `LAST_STAGE = 3`; M4b's 5th stage
   moved wrap-up to 4, so a literal copy would silently desync the lazy chunk
   from the shell. Deriving it here keeps one source of truth.

   S1b — the wrap-up index is now PER SESSION (Welcome + N sections + Wrap-up),
   so this is republished by refreshModuleStages() whenever the section set
   changes. The value below is only the pre-scenario default. */
if (typeof window !== "undefined") window.CANAMED_LAST_STAGE = 3;

/* ── Module set ───────────────────────────────────────────────────────────────
   WHICH modules a session runs, and the mapping between a module id and its
   stage. Everything that used to hardcode "stage 1 is Module A, stage 2 is
   Module B" now goes through here, so making the set scenario-driven (M1) and
   facilitator-narrowable (M2) means changing these few functions instead of
   hunting literals across 14k lines.

   M0 deliberately returns EXACTLY today's answer — this is a seam, not a
   behaviour change. Declared before stageLabel() so there is no
   const-temporal-dead-zone risk from an early call.
   See ARCHITECTURE/module-set-design.md. */
const MODULE_REGISTRY = [
  { id: "A", stage: 1 },
  { id: "B", stage: 2 },
  /* M4b — the branched decision case as a real module, so a session can run it
     alongside A/B (composition: the scenario references a standalone branched
     scenario for this stage). Sits at stage 3, BEFORE wrap-up, so the flow stays
     monotonic — snapStageToFlow() walks the flow array assuming ascending order.
     Inert until a scenario declares it: it is never NAME-inferred (moduleNameEn
     returns "" for it) and has no scoring family, so scenarioModuleSet() cannot
     pick it up by accident. */
  { id: "branched", stage: 3 }
];
/* Positional stage→module map, NOT filtered by the enabled set: stage 1 → "A",
   stage 2 → "B", anything else → null. Kept unfiltered because labels must keep
   resolving even for a branched scenario, whose moduleAName is written by
   branched-author.js as the node title. */
function moduleAtStage(stage) {
  const hit = MODULE_REGISTRY.find(m => m.stage === stage);
  return hit ? hit.id : null;
}
function stageForModule(id) {
  const hit = MODULE_REGISTRY.find(m => m.id === id);
  return hit ? hit.stage : -1;
}
/* The modules this session actually runs, in stage order. Today: both, except a
   branched scenario has no A/B modules at all (its content is the node graph,
   and stageFlow() already skips stage 2 for it). */
/* The modules this SESSION runs = the scenario's set, narrowed by the
   facilitator's per-session choice (M2). Decision 1 of the design doc: the
   scenario declares what it CONTAINS, the facilitator narrows what to RUN. */
function moduleSet() {
  const scenarioSet = scenarioModuleSet();
  const narrowed = (typeof window !== "undefined") && window.CANAMED_SESSION_MODULES;
  if (!Array.isArray(narrowed) || !narrowed.length) return scenarioSet;
  const kept = scenarioSet.filter(id => narrowed.indexOf(id) !== -1);
  // A narrowing that would leave NOTHING (stale selection, or a scenario swapped
  // under it) is ignored rather than producing an empty, unrunnable session.
  return kept.length ? kept : scenarioSet;
}
/* M2 — record the facilitator's narrowing. Stored write-once at create as a CSV
   string (e.g. "A"); absent/null means "no narrowing", i.e. run whatever the
   scenario declares. Callers MUST invoke this before applyScenario() for a
   session, since that calls refreshModuleStages(). */
function setSessionModules(csv) {
  if (typeof window === "undefined") return;
  const list = (typeof csv === "string" && csv)
    ? csv.split(",").map(s => s.trim()).filter(Boolean)
    : null;
  window.CANAMED_SESSION_MODULES = (list && list.length) ? list : null;
  refreshModuleStages();
}
/* The modules the SCENARIO contains (M1). */
function scenarioModuleSet() {
  if (typeof window !== "undefined" && window.CURRENT_SCENARIO_FORMAT === "branched") return [];
  // Precedence: an explicit scenario `modules: ["A"]` wins…
  const declared = (typeof window !== "undefined") && window.CURRENT_SCENARIO_MODULES;
  if (Array.isArray(declared)) {
    const named = MODULE_REGISTRY.filter(m => declared.indexOf(m.id) !== -1).map(m => m.id);
    if (named.length) return named;   // ignore a declaration naming nothing we know
  }
  // …otherwise INFER. Module NAMES are authoritative whenever any is given: this
  // is what makes every pre-existing scenario (all three built-ins name both)
  // keep A+B with no migration. It also avoids a staleness trap —
  // applyScenario() resets CURRENT_SCENARIO_MODULE_*_NAME for every scenario,
  // but only overwrites window.SCORING when the new scenario HAS a scoring key,
  // so a scenario naming only Module A must not inherit "B exists" from the
  // previous scenario's leftover scoring table.
  const byName = MODULE_REGISTRY.filter(m => moduleNameEn(m.id)).map(m => m.id);
  if (byName.length) return byName;
  // No names at all (unusual): fall back to the scoring families.
  const byScoring = MODULE_REGISTRY.filter(m => moduleHasScoring(m.id)).map(m => m.id);
  // Still nothing? A standard scenario with no module content is malformed; keep
  // the session navigable rather than collapsing the flow to Welcome → Wrap-up.
  return byScoring.length ? byScoring : [MODULE_REGISTRY[0].id];
}
/* The module's English display name, or "" — the primary presence signal. */
function moduleNameEn(id) {
  const trio = moduleNameTrio(id);
  return ((typeof trio === "string") ? trio : (trio && trio.en)) || "";
}
function moduleHasScoring(id) {
  const sc = (typeof window !== "undefined" && window.SCORING) ||
             ((typeof SCORING !== "undefined") ? SCORING : null);
  const fam = sc && sc["module" + id];
  return Array.isArray(fam) && fam.length > 0;
}
/* A module has substance when it is named OR carries a scoring family. */
function moduleHasContent(id) {
  return !!moduleNameEn(id) || moduleHasScoring(id);
}
/* Publish the enabled modules' stage indices so stageFlow() — here AND in the
   lazily-loaded branched-render.js, which takes over once loaded — can drop the
   stages of modules this scenario does not have. */
function refreshModuleStages() {
  if (typeof window === "undefined") return;
  /* S1b — the stages a session runs are the slot positions, and the wrap-up
     index moves with them. Both are republished here (rather than computed once
     at load) because the lazy branched-render.js owns stageFlow() after it
     loads and reads these two globals; a stale pair desyncs the lazy chunk from
     the shell, which is exactly the bug M4b's CANAMED_LAST_STAGE fixed. */
  window.CANAMED_MODULE_STAGES = sectionSlots().map(s => s.stage);
  window.CANAMED_LAST_STAGE = lastStage();
  /* S7 — the pick also decides two SESSION-level things. Republished from this
     same seam because every path that can change the pick funnels through here
     (setSessionSections, setSessionModules, applyScenario), and because
     applyScenario() sets its own PRETEST / CURRENT_SCENARIO_NAME EARLIER in its
     body than it calls this — so a picked session's values win, and a session
     with no pick keeps applyScenario's untouched. */
  publishSectionTests();
  publishSectionIdentity();
}

/* ── S7 — the pre/post knowledge banks belong to the SESSION, not to a slot ────
 * buildSection() has always computed section.preTest / .postTest and NOTHING
 * read them: only applyScenario() published PRETEST / POSTTEST, and _testBank()
 * reads only those globals. A post-S7 session pins no scenarioId, so
 * loadSessionScenario() falls through to applyDefaultScenario() and every picked
 * session showed the chronic-pain bank — un-split, i.e. including the items
 * TEST_SPLIT assigns to the half the session does not run. Silent, as always in
 * this class: "this section has no knowledge check" is a legitimate state.
 *
 * COMBINED across the picked sections (user decision, 2026-08-04): the pre-test
 * is shown ONCE before Module A and the post-test ONCE at wrap-up, so these are
 * session-level surfaces and cannot be derived from the active slot. Order is
 * pick order. DEDUPLICATED by item id, first occurrence winning — two sections
 * of one case legitimately carry the same id (a case ships one bank that
 * TEST_SPLIT divides; an authored one is not split at all) and a student must
 * never be asked the same question twice. An id-less item is dropped: it could
 * not be stored either, since the answer path keys on the id. */
function mergeSectionTestBanks(sections, key) {
  const out = [];
  const seen = Object.create(null);
  (sections || []).forEach(sec => {
    const bank = sec && sec[key];
    if (!Array.isArray(bank)) return;
    bank.forEach(item => {
      if (!item || item.id == null || item.id === "") return;
      const id = String(item.id);
      if (seen[id]) return;
      seen[id] = true;
      out.push(item);
    });
  });
  return out;
}
function publishSectionTests() {
  if (typeof window === "undefined") return;
  let picked = null;
  try { picked = pickedSections(); } catch (_) { picked = null; }
  /* NO pick ⇒ leave applyScenario's banks exactly as they are. A non-section
     session (and the pre-library window before section-registry.js lands) must
     keep working precisely as today. */
  if (!picked || !picked.length) return;
  window.PRETEST = mergeSectionTestBanks(picked, "preTest");
  window.POSTTEST = mergeSectionTestBanks(picked, "postTest");
}

/* ── S7 — the session's IDENTITY comes from the pick too ───────────────────────
 * applySectionContent() re-points the CONTENT globals per slot but publishes
 * none of the identity ones, which only applyScenario() ever set. With no
 * scenario pinned, the lobby line, the welcome agenda, the session history entry
 * and — worst — the facilitator ARCHIVE all labelled every picked session
 * "Chronic Pain & the Opioid Request". An export naming a case the session never
 * ran is a research-data-integrity defect, not a cosmetic one.
 *
 * MULTI-SECTION POLICY, decided here: the lobby line describes the SESSION, so
 * the NAME lists every picked section joined by " + " rather than silently
 * showing only the first. The SUMMARY is published only for a ONE-section
 * session — the blurbs are three-sentence case descriptions and two of them
 * concatenated make an unreadable one-line header; for a multi-section pick the
 * agenda below (renderLobbyStructure) carries each section's own blurb instead.
 *
 * CURRENT_SCENARIO_MODULE_A/B_NAME are deliberately NOT overwritten:
 * scenarioModuleSet() INFERS the module set from them (name-first, M1), so
 * writing section titles there would change which modules a no-pick session
 * believes it runs. renderLobbyStructure() is made section-aware instead. */
function joinSectionField(sections, key, sep) {
  const langs = ["en", "fr", "ja"];
  const out = {};
  const resolve = (typeof tc === "function") ? tc : null;
  langs.forEach(lang => {
    const parts = [];
    sections.forEach(sec => {
      const raw = sec && sec[key];
      const v = resolve ? resolve(raw, lang)
                        : ((typeof raw === "string") ? raw : (raw && (raw[lang] || raw.en)) || "");
      if (v) parts.push(v);
    });
    if (parts.length) out[lang] = parts.join(sep);
  });
  return Object.keys(out).length ? out : "";
}
function publishSectionIdentity() {
  if (typeof window === "undefined") return;
  let picked = null;
  try { picked = pickedSections(); } catch (_) { picked = null; }
  if (!picked || !picked.length) return;
  window.CURRENT_SCENARIO_NAME = joinSectionField(picked, "name", " + ") ||
                                 window.CURRENT_SCENARIO_NAME || "";
  window.CURRENT_SCENARIO_SUMMARY = (picked.length === 1)
    ? (joinSectionField(picked, "summary", " ") || "")
    : "";
  /* The archive/self-export dispatch key. It reported the FALLBACK scenario's id
     — a flatly wrong claim about what the session ran. Section ids are stable
     kebab-case too, so a pipeline keeps a stable key; it now names the sections
     rather than a case nobody opened. */
  window.CURRENT_SCENARIO_ID = picked.map(s => s.id).join("+");
}

/* ── S1a — SLOTS: a stage is a POSITION, the DOM is a per-TYPE view ───────────
 * The section model (ARCHITECTURE/section-model-design.md) makes a session
 * "opening + N independently-picked sections + wrap-up", where two sections may
 * come from different cases and the same TYPE may appear twice.
 *
 * The design doc listed the ~1200 lines of static per-module DOM as the biggest
 * blocker, on the assumption that N slots need N copies of the markup. They do
 * not: **exactly one stage is visible at a time** (renderStage() hides every
 * other one), so the markup is a VIEW the active slot borrows, not a per-slot
 * instance. #stage-1 stops meaning "stage number 1" and starts meaning "the PBL
 * view"; #stage-2 "the roleplay view"; #stage-3 "the branched view". Two PBL
 * sections in one session reuse the PBL view and re-render against their own
 * slot's data — which is why S2's per-slot DB paths are the real work, not the
 * DOM. Bonus: every `#stage-1 …` / `#stage-2 …` CSS rule already reads as a
 * per-type selector, so this costs ZERO CSS churn.
 *
 * S1a is a SEAM ONLY — same discipline as M0. Every function here returns
 * exactly today's answer (a slot sits at its module's fixed stage), so nothing
 * moves until S1b makes slots positional. */
const SECTION_TYPE_FOR_MODULE = { A: "pbl", B: "roleplay", branched: "branched" };
const STAGE_VIEW_FOR_TYPE = { pbl: "stage-1", roleplay: "stage-2", branched: "stage-3" };
/* The two fixed ends keep their DOM ids for ever, because a stage NUMBER no
   longer picks a node: in a 2-section session the wrap-up is stage 3, but its
   markup is still #stage-4. */
const WELCOME_VIEW_ID = "stage-0";
const WRAPUP_VIEW_ID = "stage-4";

/* The section slots this session runs, in the order the facilitator picked
   them. S1b: a slot's stage IS its position — stage 1 is whatever section was
   picked first, so a roleplay-then-PBL session runs the roleplay on stage 1.
   S1a derived the stage from the module's old fixed index; that mapping is
   gone, which is the whole point of the phase.

   S3 replaces moduleSet() here with the facilitator's ordered pick. */
/* ── S3a — the session's own ordered SECTION pick ─────────────────────────────
 * Stored write-once as a CSV of section ids (`sessions/$id/sections`), modelled
 * on M2's `modules` and read the same way. This is what finally decouples a
 * session from a single scenario: the ids may come from different clinical
 * cases, and the same TYPE may appear twice.
 *
 * Resolution is deliberately TOLERANT. The library is a lazily-loaded chunk
 * (`section-registry.js`, chained after case-content), so a pick can be read
 * before it exists; and a stale pick may name a section that has since been
 * renamed. Either way we fall back to the module-derived slots rather than
 * producing a session with no stages at all. */
/* S7 — fold a session's AUTHORED section snapshots into the section library so
   pickedSections() resolves "custom-<slot>" exactly like a built-in id.
   Each value is a serialised SECTION (already one half of a scenario), written
   write-once at create, so what is registered here is the version the session
   was created with — a later edit by the author cannot change a running
   session. Defensive throughout: one unparseable snapshot must not stop the
   others, and must not take down a session that also runs built-ins. */
function registerSectionBodies(bodies) {
  if (typeof window === "undefined" || !bodies || typeof bodies !== "object") return;
  if (!window.CANAMED_SECTIONS) window.CANAMED_SECTIONS = {};
  Object.keys(bodies).forEach(slot => {
    const raw = bodies[slot];
    if (typeof raw !== "string" || !raw) return;
    let sec = null;
    try { sec = JSON.parse(raw); }
    catch (e) { console.warn("section snapshot for slot " + slot + " is not JSON", e); return; }
    if (!sec || typeof sec !== "object" || !sec.type) {
      console.warn("section snapshot for slot " + slot + " has no type — ignored");
      return;
    }
    const id = "custom-" + slot;
    window.CANAMED_SECTIONS[id] = Object.assign({}, sec, { id: id });
  });
}
function setSessionSections(csv) {
  if (typeof window === "undefined") return;
  const list = (typeof csv === "string" && csv)
    ? csv.split(",").map(x => x.trim()).filter(Boolean)
    : null;
  window.CANAMED_SESSION_SECTIONS = (list && list.length) ? list : null;
  refreshModuleStages();
}
/* The picked sections resolved against the library, in pick order, or null when
   there is no usable pick — the caller then keeps today's behaviour. */
function pickedSections() {
  if (typeof window === "undefined") return null;
  const ids = window.CANAMED_SESSION_SECTIONS;
  if (!Array.isArray(ids) || !ids.length) return null;
  const lib = window.CANAMED_SECTIONS;
  if (!lib) return null;                       // library not loaded yet
  const out = [];
  ids.slice(0, MAX_SECTION_SLOTS).forEach(id => {
    const sec = lib[id];
    if (sec && STAGE_VIEW_FOR_TYPE[sec.type]) out.push(sec);
  });
  return out.length ? out : null;              // every id unknown ⇒ no pick
}
/* Does this session run any WORKUP (PBL) section? Answers the question "may the
   ambient CASE / SYNTH_ID globals be quoted as this session's content?" — they
   are only ever set by a PBL section (or by the fallback scenario, which is the
   trap). TRUE when there is no pick, so a pre-section session is unaffected. */
function sessionRunsCaseWork() {
  let picked = null;
  try { picked = pickedSections(); } catch (_) { picked = null; }
  if (!picked || !picked.length) return true;
  return picked.some(s => s && s.type === "pbl");
}
function sectionSlots() {
  /* An explicit pick wins: it is the facilitator's write-once choice for this
     session, and unlike the module set it can name two sections of one type. */
  const picked = pickedSections();
  if (picked) {
    /* A pick of ONE branched section is a STANDALONE branched session and must
       use the standalone view (#stage-1), the same as the no-pick fallback in
       _moduleDerivedSlots(). Not a stylistic choice: #decisions-branched lives
       in #stage-3 but #branched-final-host — the OSCE diagnosis/management
       DELIVERABLE a branched case builds toward — exists only in #stage-1. Type
       -routing this to stage 3 renders the decision tree and then silently
       loses its ending, which is the worst kind of half-working.
       A MIXED pick keeps per-type routing: there the branched module is
       COMPOSED into stage 3 and its deliverable goes to answers/moduleBranched
       instead (M4c/M4d). */
    const lone = (picked.length === 1 && picked[0].type === "branched");
    return picked.map((sec, i) => ({
      position: i + 1, stage: i + 1, module: null, type: sec.type,
      view: (lone ? "stage-1" : STAGE_VIEW_FOR_TYPE[sec.type]),
      standalone: lone || undefined,
      sectionId: sec.id
    }));
  }
  return _moduleDerivedSlots();
}
function _moduleDerivedSlots() {
  /* A STANDALONE branched scenario declares no module (its content is the node
     graph), but it is unambiguously one section, and it renders in the PBL view
     because the branched engine's standalone targets live there (#decisions-A,
     #branched-final-host) — see M4c. Giving it a real slot is what lets the
     rest of the engine stop special-casing the format. */
  if (typeof window !== "undefined" && window.CURRENT_SCENARIO_FORMAT === "branched") {
    return [{ position: 1, stage: 1, module: null, type: "branched",
              view: "stage-1", standalone: true }];
  }
  return moduleSet().slice(0, MAX_SECTION_SLOTS).map((mod, i) => {
    const type = SECTION_TYPE_FOR_MODULE[mod] || null;
    return { position: i + 1, stage: i + 1, module: mod, type: type,
             view: STAGE_VIEW_FOR_TYPE[type] || null };
  });
}
/* Welcome + one stage per section + Wrap-up. Per SESSION, not a constant. */
function stageCount() { return sectionSlots().length + 2; }
function lastStage() { return stageCount() - 1; }
function slotAtStage(stage) {
  return sectionSlots().find(s => s.stage === stage) || null;
}
/* Which DOM node shows a given stage: the welcome view, the wrap-up view, or
   the view belonging to that slot's section TYPE.

   The fallback matters — a STANDALONE branched scenario has an empty
   moduleSet() (its content is the node graph, not a module) yet renders on
   stage 1 with the épuré CSS, so an unmapped stage must still resolve to its
   like-numbered node rather than vanishing. */
function stageViewId(stage) {
  if (stage === 0) return WELCOME_VIEW_ID;
  if (stage === lastStage()) return WRAPUP_VIEW_ID;
  const slot = slotAtStage(stage);
  return (slot && slot.view) || ("stage-" + stage);
}
/* Every stage-view node, so renderStage() can hide the lot before showing one.
   Derived from the registry + the two fixed ends, never hardcoded, so adding a
   4th section type means adding one STAGE_VIEW_FOR_TYPE entry. */
function allStageViewIds() {
  const ids = [WELCOME_VIEW_ID, WRAPUP_VIEW_ID];
  Object.keys(STAGE_VIEW_FOR_TYPE).forEach(t => {
    if (ids.indexOf(STAGE_VIEW_FOR_TYPE[t]) === -1) ids.push(STAGE_VIEW_FOR_TYPE[t]);
  });
  return ids;
}

/* ── M4c — COMPOSITION: run a branched case as a module inside a mixed session ──
 * Rather than inventing a second node-graph schema inside the A/B scenario, a
 * mixed scenario REFERENCES a standalone branched scenario by id:
 *
 *   { modules: ["A", "B", "branched"], branchedRef: "ward-escalation-branched", … }
 *
 * This keeps the branched schema, engine, validator and authoring untouched —
 * the referenced scenario is exactly the one that already runs standalone.
 *
 * Resolution merges the referenced nodes into the outer DECISIONS array tagged
 * module:"branched", so the EXISTING decision engine renders them on the
 * branched stage with no new runtime. Node ids are namespaced (br_…) because
 * they become RTDB vote keys (votes/$voteId) and must not collide with the outer
 * scenario's own decision ids; unlockWhen.afterDecision edges are rewritten in
 * lockstep so the graph stays intact.
 *
 * Degrades to "no branched nodes" when the reference can't be resolved (registry
 * not loaded yet, unknown id) — the stage then renders empty rather than
 * throwing, and moduleHasContent() keeps it out of the flow. */
const BRANCHED_ID_PREFIX = "br_";
function composeBranchedModule() {
  if (typeof window === "undefined") return;
  const ref = window.CURRENT_SCENARIO_BRANCHED_REF;
  const base = Array.isArray(window.DECISIONS) ? window.DECISIONS : [];
  // Always drop any previously composed nodes first: applyScenario() only
  // reassigns window.DECISIONS when the new scenario HAS a decisions key, so a
  // stale branched graph could otherwise survive a scenario switch.
  const outer = base.filter(d => !(d && d.module === "branched"));
  if (outer.length !== base.length) window.DECISIONS = outer;
  if (!ref || typeof ref !== "string") return;

  const reg = window.CANAMED_SCENARIOS || {};
  const src = reg[ref];
  const nodes = (src && Array.isArray(src.decisions)) ? src.decisions : null;
  if (!nodes || !nodes.length) {
    console.warn("branchedRef could not be resolved:", ref);
    return;
  }
  const nsId = id => BRANCHED_ID_PREFIX + String(id);
  const composed = nodes.map(function (d) {
    const copy = JSON.parse(JSON.stringify(d));
    copy.module = "branched";
    copy.id = nsId(copy.id);
    // Rewrite the graph edges. afterDecision is either a bare id string or a
    // { id, option } pair (branched-validate's two accepted shapes).
    const uw = copy.unlockWhen;
    if (uw && uw.afterDecision != null) {
      if (typeof uw.afterDecision === "string") uw.afterDecision = nsId(uw.afterDecision);
      else if (uw.afterDecision.id) uw.afterDecision.id = nsId(uw.afterDecision.id);
    }
    return copy;
  });
  window.DECISIONS = outer.concat(composed);
  // The referenced scenario owns the deliverable prompt for its own tree.
  if (src.finalStep) window.CURRENT_SCENARIO_FINAL_STEP = src.finalStep;
}
/* The active scenario's translatable name trio for a module id. */
function moduleNameTrio(id) {
  if (typeof window === "undefined" || !id) return null;
  if (id === "A") return window.CURRENT_SCENARIO_MODULE_A_NAME || null;
  if (id === "B") return window.CURRENT_SCENARIO_MODULE_B_NAME || null;
  return null;
}

/* The English fallback label for a stage — used by the admin text exports and
   before i18n.js has loaded. Keyed by ROLE (welcome / section type / wrap-up),
   never by index, since S1b decoupled the two. */
function stageLabelEn(i) {
  if (i === 0) return STAGE_LABELS.welcome;
  if (i === lastStage()) return STAGE_LABELS.wrapup;
  const slot = slotAtStage(i);
  const base = (slot && STAGE_LABELS[slot.type]) || "Section";
  return "Section " + (slot ? slot.position : i) + " - " + base;
}
/* The section title shown to students for a stage: the picked section's own
   name. S1b still sources it from the module name trio (S3 sources it from the
   section registry), minus the "Module A — " prefix that decision 8 retired. */
const STAGE_TITLE_PREFIX = /^\s*(?:Module|モジュール)\s*[AB]\s*[—–-]\s*/;
function stageSectionTitle(i) {
  const slot = slotAtStage(i);
  if (!slot || typeof window === "undefined" || typeof window.tc !== "function") return "";
  /* A PICKED slot carries a sectionId and no module, so the module-name lookup
     below finds nothing — which silently reduced every label in a
     picker-created session to a bare "Section k". Resolve the section's own
     name first; the module trio remains the path for module-derived slots. */
  if (slot.sectionId) {
    const sec = (window.CANAMED_SECTIONS || {})[slot.sectionId];
    const nm = sec && sec.name;
    if (nm) {
      const l = (typeof _curLang === "function") ? _curLang() : "en";
      const v = window.tc(nm, l);
      if (v) return String(v).replace(STAGE_TITLE_PREFIX, "");
    }
  }
  const trio = moduleNameTrio(slot.module);
  if (!trio) return "";
  const lang = (typeof _curLang === "function") ? _curLang() : "en";
  const v = window.tc(trio, lang);
  return v ? String(v).replace(STAGE_TITLE_PREFIX, "") : "";
}
function stageLabel(i) {
  /* S1b — a middle stage reads "Section k — <the section's own title>"
     (decision 8). The position is what students navigate by, so it leads; the
     TYPE (PBL / Roleplay / Branched) is facilitator-facing only and appears in
     the picker, not here. */
  const slot = slotAtStage(i);
  if (slot && i !== 0 && i !== lastStage()) {
    const title = stageSectionTitle(i);
    const pattern = (typeof window !== "undefined" && typeof window.t === "function")
      ? window.t("stage.label.section") : "";
    const tpl = (pattern && pattern !== "stage.label.section")
      ? pattern : "Section {n} — {title}";
    const n = String(slot.position);
    if (title) return tpl.replace("{n}", n).replace("{title}", title);
    /* No title (an unnamed authored section): keep the position, drop the
       dangling separator rather than printing "Section 2 — ". */
    return tpl.replace("{n}", n).replace(/\s*[—–-]?\s*\{title\}\s*$/, "");
  }
  return stageLabelLegacy(i);
}
/* The two fixed ends. They are looked up by ROLE, not by index: the wrap-up
   sits at a different number in every session now, so the old
   "stage.label." + i lookup would fetch a middle stage's label for it (a
   2-section session's wrap-up is stage 3 — the old "Decision case" key).
   The numeric keys stay as a fallback for a cached older locale bundle. */
function stageLabelLegacy(i) {
  const role = (i === 0) ? "welcome" : "wrapup";
  const legacyKey = (i === 0) ? "stage.label.0" : "stage.label.4";
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const k = "stage.label." + role;
    const v = window.t(k);
    if (v && v !== k) return v;
    const lv = window.t(legacyKey);
    if (lv && lv !== legacyKey) return lv;
  }
  return STAGE_LABELS[role] || ("Stage " + (i + 1));
}
/* Stage-flow wrappers — the logic (branched skips stage 2) lives in the LAZY
   branched-render.js; these delegate once it has loaded, else the standard flow. */
/* Does the BRANCHED ENGINE own this session's stage flow?
 *
 * Only when the branched FORMAT owns the whole session. Once a session picks
 * sections (S1b) the pick is authoritative: a branched section is then one
 * section among several, and branched-render's mirror must not speak for the
 * whole flow. That mirror derives the flow from CURRENT_SCENARIO_FORMAT /
 * CANAMED_MODULE_STAGES — neither of which knows about picked sections — so it
 * collapsed a mixed session to its own [0, 1, LAST].
 *
 * Live symptom (found 2026-08-12) in a 2-section session (PBL + branched): the
 * stepper read "Stage 1 of 4", "Stage 2 of 4", then "Stage 3 of 3" the moment
 * the lazy branched chunk loaded — and the room's real stage (2) was not even a
 * member of the returned flow, so the wrap-up ALSO rendered as "Stage 3 of 3".
 *
 * Gating all three flow functions on this together is deliberate: if the
 * stepper used the section flow while Back/Advance used the branched one they
 * would disagree, which is the exact failure standardStageFlow's own comment
 * warns about. With no pick (legacy scenarios + STANDALONE branched) behaviour
 * is unchanged — the branched engine still owns the flow. */
function _branchedFlowOwner() {
  if (typeof window === "undefined" || !window.CanamedBranchedRender) return null;
  let picked = null;
  try { picked = pickedSections(); } catch (_) { picked = null; }
  return picked ? null : window.CanamedBranchedRender;
}
function stageFlow() {
  const b = _branchedFlowOwner();
  return (b && b.stageFlow) ? b.stageFlow() : standardStageFlow();
}
/* Welcome + one stage per module this scenario RUNS + Wrap-up. So an A-only
   scenario is [0,1,3] and a B-only one is [0,2,3], and every consumer of the
   flow (steppers, Back/Advance, the debrief legend) follows automatically.
   The branched format keeps its own [0,1,LAST]: its content lives on stage 1
   even though it declares no A/B module. Mirrored in branched-render.js, which
   owns the flow once that lazy chunk has loaded. */
function standardStageFlow() {
  /* S1b — the flow is now CONTIGUOUS: Welcome, one stage per picked section in
     pick order, Wrap-up. There are no skipped stages any more, because a stage
     only exists if a section occupies it. (Before S1b an A-only session ran
     [0,1,4] with 2 and 3 skipped; it now runs [0,1,2].) */
  /* Derive the tail from lastStage() so the stepper and the nav clamps cannot
     disagree — an empty-slot fallback of [1] used to render "Stage 1 of 3"
     while navigation clamped at 1, leaving a dead final segment. */
  const mid = sectionSlots().map(s => s.stage);
  return [0].concat(mid, [lastStage()]);
}
function snapStageToFlow(to, from) {
  const b = _branchedFlowOwner();
  return (b && b.snapStageToFlow) ? b.snapStageToFlow(to, from) : Math.max(0, Math.min(lastStage(), to));
}
function adjacentStage(cur, dir) {
  const b = _branchedFlowOwner();
  return (b && b.adjacentStage) ? b.adjacentStage(cur, dir) : Math.max(0, Math.min(lastStage(), cur + dir));
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
  // NB: these milestone toasts fire for EVERY teammate when the synced score
  // changes (and re-fire on resync after a phone unlock / tab refocus). So the
  // `did` text must celebrate the PROCESS STEP, never announce the clinical
  // OUTCOME — otherwise a passive teammate gets the answer handed to them
  // without reasoning it (dry-run 2026-05-27: a locked phone unlocked to "your
  // team found the diagnosis").
  synthesis: { points: 10, tier: "milestone", module: "A",
    title: "Committed your working hypotheses",
    did: "Your room committed at least one working hypothesis — the Exchange prompts are now open." },
  restraint: { points: 20, tier: "milestone", module: "A",
    title: "Diagnostic restraint",
    did: "You held off on imaging that isn't indicated here.",
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
  // English-only UI (user 2026-06-25: "delete all the French and Japanese inside
  // the website; keep only the dictionaries"). ALL case-content rendering goes
  // through tc(value, _curLang()), so pinning this to "en" makes every clinical
  // string render in English. The language PICKER (getLang()) still drives the
  // in-page reading aid's gloss language — that's the only FR/JA left, on hover.
  return "en";
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
  // Chat-mode penalties (Module A LLM pilot 2026-05-28): the dismissive /
  // promise-opioid penalties live in SCORING.moduleA_question_penalties,
  // not in PENALTIES. Check there before falling through to the standard
  // PENALTIES list so the renderObjectives penalty section displays them
  // with the right label.
  if (typeof SCORING !== "undefined" && SCORING.moduleA_question_penalties) {
    const chatPen = SCORING.moduleA_question_penalties.find(pp => pp.id === ev);
    if (chatPen) {
      return {
        id: ev,
        points: chatPen.points,
        title: tc(chatPen.label, lang),
        why: ""    // chat penalties don't carry a "why" paragraph
      };
    }
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

/* Inline-SVG icon system (2026-07-17) — markup + element helpers for the
   sprite in index.html. Static markup only (never user data). */
function icMarkup(name) {
  return '<svg class="ic" aria-hidden="true" focusable="false"><use href="#ic-' +
    name + '"/></svg>';
}
function icNode(name) {
  const s = document.createElement("span");
  s.innerHTML = icMarkup(name);
  return s.firstChild;
}
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
  // "loss" gives the penalty toast its own (calm amber/red) styling;
  // "gain" gives an award toast a calm green so points-earned reads positive.
  t.className = "toast" + (kind === "loss" ? " loss" : kind === "gain" ? " gain" : "");
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
 * Scope: any rules-enforced (shared-mode) deployment — both the default
 * `sessions/` tree and org-scoped `orgs/<slug>/sessions/` trees. */
// Use the adminSecrets proof-write scheme on ANY rules-enforced deployment
// (default `sessions/` AND org-scoped `orgs/<slug>/sessions/`). LOCAL mode
// (LocalDB) has no security rules, so a proof-write would always succeed there
// — LOCAL keeps the legacy read-verify path (the real hash sits at
// adminPasswordHash). Org support added 2026-05-30 to close the org hash oracle.
function useAdminSecrets() {
  return MODE === "shared";
}
function adminSecretPath(code, leaf) {
  // Default org keeps the legacy top-level path (adminSecrets/<code>, unchanged);
  // other orgs namespace under adminSecrets/orgs/<slug>/<code> so the unreadable
  // real hash is per-org. Mirrors _sessionPrefix() (default -> "sessions/").
  const base = (_sessionPrefix(currentOrg) === "sessions/")
    ? "adminSecrets/" + code
    : "adminSecrets/orgs/" + currentOrg + "/" + code;
  return base + (leaf ? "/" + leaf : "");
}

/* Module A free-text chat — same read-cascade problem as FINDING-07 above.
 *
 * The chat used to live at <session>/rooms/<roomId>/moduleA/chat with a
 * room-scoped `.read`. But `sessions/<code>` grants `.read` to every session
 * member and RTDB `.read` CASCADES — it cannot be revoked at a deeper path — so
 * that room-scoped rule was ADDITIVE ONLY and restricted nothing: every member
 * of the session could read every room's conversation with the LLM patient.
 * (Found by the 2026-07-23 Phase-4e legal fact-check, which had drafted the
 * participant consent text on the false assumption that it was room-private.)
 *
 * The only fix is to move the data OUT of the cascade, exactly as the admin
 * hash was moved to `adminSecrets/`: a TOP-LEVEL `roomChat/` tree whose own
 * `.read` is granted per ROOM (plus the facilitator, who needs it for debrief).
 * Namespacing mirrors adminSecretPath(). */
function roomChatPath(code, roomId) {
  const base = (_sessionPrefix(currentOrg) === "sessions/")
    ? "roomChat/" + code
    : "roomChat/orgs/" + currentOrg + "/" + code;
  return base + "/" + roomId;
}
/* Published-certificate id → participant map. Same out-of-cascade rationale as
   roomChatPath: it must live OUTSIDE sessions/<code> or a classmate could read
   a peer's id straight from the map (RTDB .read cascades and can't be revoked
   deeper). The stored id is CRYPTO-RANDOM (randomCredentialId) and persisted so
   a re-download reuses it and the facilitator export can read it — replacing the
   deterministic canamedCertId, which any classmate could recompute from the pool
   keys. certIdBasePath(code) is the admin-listable node; certIdPath adds the
   per-participant leaf. Namespacing mirrors roomChatPath/adminSecretPath. */
function certIdBasePath(code) {
  return (_sessionPrefix(currentOrg) === "sessions/")
    ? "certIds/" + code
    : "certIds/orgs/" + currentOrg + "/" + code;
}
function certIdPath(code, clientId) {
  return certIdBasePath(code) + "/" + clientId;
}
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
       new-tab on the same browser yields the same value. Cleared by
       leaveAndReload / switchSession / forgetSavedSession, and by
       accountSignOut / accountDelete (resetStableId), so a shared lab
       machine does not bleed the previous student's id into the next.
   localStorage availability is best-effort — private mode / disabled
   storage falls back to the in-memory value (still better than nothing
   for the current page lifetime). */
const STABLE_ID_KEY = "canamed_stable_id";
let stableId = null;
try { stableId = localStorage.getItem(STABLE_ID_KEY); } catch (e) {}
if (!stableId) stableId = mintStableId();

/* Mint a fresh random stableId and persist it. Hoisted (function decl) so the
   module-init block above can call it before this point. */
function mintStableId() {
  const sbuf = new Uint8Array(8);
  crypto.getRandomValues(sbuf);
  const id = "s" + Array.from(sbuf)
    .map(b => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(STABLE_ID_KEY, id); } catch (e) {}
  return id;
}

/* Drop the stableId left behind by a signed-in account and replace it with a
   fresh anonymous one.

   Needed because handleAuthStateChange() binds stableId to currentUser.uid for
   a non-anonymous user AND persists it to localStorage. Sign-out used to clear
   neither, so canamed_stable_id kept holding the SIGNED-OUT account's uid: the
   next person on that browser inherited it and their work was stamped with the
   previous account's identifier.

   Unlike leaveAndReload/switchSession — which clear the key and then reload —
   the account dialog stays on the page, so removing the localStorage entry
   alone would leave the stale uid live in the in-memory `stableId` for the rest
   of the page lifetime. Re-mint rather than merely clear. */
function resetStableId() {
  try { localStorage.removeItem(STABLE_ID_KEY); } catch (e) {}
  stableId = mintStableId();
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
let _lastRenderedViewStage = -1; // last stage we scrolled-to-top for (see renderStage)
/* ── S2b-1 — per-SLOT room state, with an active-slot pointer ─────────────────
 * A session may run two sections of the SAME TYPE (decision 1), so "the
 * revealed items" and "the hypotheses" are no longer one map per room — they
 * are one map per SLOT. Rather than thread a slot argument through ~115 read
 * sites, the store holds every slot and `revealed` / `hypotheses` stay as
 * POINTERS at the slot currently on screen. Exactly one stage is visible at a
 * time (the same fact that made the stage DOM a per-type view in S1a), so a
 * pointer is always unambiguous.
 *
 * S2b-1 is a SEAM: the listeners still bind to the LEGACY moduleA/moduleB paths,
 * so two PBL slots read the same node and nothing changes for today's sessions.
 * S2b-2 repoints them at rooms/$roomId/sections/$slot and the slots diverge. */
/* Which slot the LEGACY module path feeds, while S2b-1 still binds to
   moduleA/moduleB: the FIRST slot of that type. With two PBL sections both
   reading the same node today, the second mirrors the first until S2b-2 gives
   each its own path. Falls back to slot 1 so a session with no slot of that
   type — or a read that lands before the scenario applies — still has a home
   rather than throwing. */
function _legacySlotFor(type) {
  const hit = sectionSlots().find(s => s.type === type);
  return hit ? hit.position : 1;
}
let sectionState = {};     // slot → { revealed: {…}, hypotheses: {…} }
let activeSlot = 1;        // the slot whose state the pointers below refer to
function slotState(slot) {
  const k = String(slot);
  if (!sectionState[k]) sectionState[k] = { revealed: {}, hypotheses: {}, answers: {} };
  return sectionState[k];
}
/* Repoint the legacy globals at the slot on screen. Called whenever the viewed
   stage changes or a listener writes into the store. Assigning the SAME object
   (not a copy) matters: render code mutates `revealed` in place in a few spots,
   and a copy would silently drop those writes. */
function refreshActiveSlotState() {
  const slot = slotAtStage(viewStage);
  activeSlot = slot ? slot.position : activeSlot;
  const st = slotState(activeSlot);
  revealed = st.revealed;
  hypotheses = st.hypotheses;
  /* S2b-2 — and the WRITE refs follow the same slot, so an item revealed while
     looking at section 3 lands in section 3's node, not section 1's. */
  if (typeof pointSectionRefs === "function") pointSectionRefs();
  /* S3c — and so does the CONTENT. */
  applySectionContent(slot);
  /* Replay the slot's last-seen synced values. Without this the shared UI keeps
     the PREVIOUS slot's phase/role draw, because the listener that would have
     corrected it already fired while this slot was inactive. */
  const _st = slotState(activeSlot);
  if (typeof _st.phase !== "undefined") {
    const _max = ((modBCfg().phases) || []).length - 1;
    modBPhase = (typeof _st.phase === "number" && _st.phase >= 0 && _st.phase <= _max)
      ? Math.floor(_st.phase) : 0;
    if (typeof renderModBPhase === "function") { try { renderModBPhase(); } catch (e) {} }
  }
  if (typeof _st.roleAssign !== "undefined" && typeof handleRoleAssign === "function") {
    try { handleRoleAssign(_st.roleAssign); } catch (e) {}
  }
}
/* ── S3c — the active slot's section supplies the content ─────────────────────
 * With sections picked from different clinical cases, "the case" is no longer a
 * property of the session — it is a property of the SLOT. The globals the render
 * code reads (CASE, SCORING, PENALTIES, DECISIONS, the synthesis gate, the LLM
 * characters) are therefore re-pointed as the student moves between stages, the
 * same pattern as the state pointer and the write refs.
 *
 * NO-OP without an explicit pick: a session still running one scenario keeps
 * exactly today's behaviour, where applyScenario() sets these once. That is what
 * makes this safe to land before the picker UI exists.
 *
 * `_appliedSectionId` guards against re-applying on every render — these
 * assignments are cheap but rebuildCaseDerived() is not, and re-running it
 * mid-stage would rebuild ITEM_IDS underneath a half-rendered board. */
let _appliedSectionId = null;
function applySectionContent(slot) {
  if (typeof window === "undefined") return;
  if (!slot || !slot.sectionId) return;          // no pick ⇒ leave the globals alone
  /* Keyed on slot+section, NOT section alone: duplicates are supported, so the
     SAME section at slots 1 and 3 would otherwise return early at slot 3 and
     leave DECISIONS carrying the s1_ prefix while that stage's votes write into
     slot 3 — exactly the shared tally namespaceDecisions() exists to prevent. */
  const _applyKey = slot.position + ":" + slot.sectionId;
  if (_applyKey === _appliedSectionId) return;
  const sec = (window.CANAMED_SECTIONS || {})[slot.sectionId];
  if (!sec || !sec.content) return;
  const c = sec.content;
  _appliedSectionId = _applyKey;

  /* Only assign what the section HAS. A roleplay section carries no case or
     penalties, and blanking them would strip the board the PBL slot next door
     still needs when the student walks back to it. */
  if (c.case) window.CASE = c.case;
  if (Array.isArray(c.characters)) window.CURRENT_SCENARIO_CHARACTERS = c.characters;
  if (Array.isArray(c.penalties)) window.PENALTIES = c.penalties;
  if (c.synthId) { window.SYNTH_ID = c.synthId; SYNTH_ID = c.synthId; }
  if (Array.isArray(c.synthPrereqs) && c.synthPrereqs.length) {
    window.SYNTH_PREREQS = c.synthPrereqs; SYNTH_PREREQS = c.synthPrereqs;
  }
  /* Scoring is stored per section as a FLAT family list, but the engine reads
     SCORING["module" + id]. Publish it under the key this slot's type maps to,
     so the existing string-built lookups keep resolving. */
  if (Array.isArray(c.scoring)) {
    const mod = SECTION_MODULE_FOR_TYPE[slot.type];
    if (mod) {
      window.SCORING = window.SCORING || {};
      window.SCORING["module" + mod] = c.scoring;
    }
  }
  /* The LLM-chat consultation scoring travels with a PBL section too. It is a
     SEPARATE pair of keys, not part of the flat family list above, so publishing
     only `scoring` left the engine reading whatever the previous scenario put in
     the global — i.e. scoring this case's chat against another case's questions.
     Cleared when the section declares none, because a stale global is exactly
     the bug: silence here has to mean "no chat scoring", not "keep the last
     one's". */
  if (slot.type === "pbl") {
    window.SCORING = window.SCORING || {};
    window.SCORING.moduleA_questions =
      Array.isArray(c.scoringQuestions) ? c.scoringQuestions : [];
    window.SCORING.moduleA_question_penalties =
      Array.isArray(c.scoringQuestionPenalties) ? c.scoringQuestionPenalties : [];
  }
  /* DECISIONS are namespaced PER SLOT before they are published, because a
     decision id becomes an RTDB vote key (votes/$voteId). Two PBL sections in
     one session routinely carry the same ids — both built-in workups have a
     `dec_plan` — and unnamespaced they would share a tally: room votes on
     section 1's plan would appear pre-cast on section 3's. Same mechanism
     composeBranchedModule() uses for its `br_` prefix, and the edges must be
     rewritten in lockstep or the graph silently breaks. */
  if (Array.isArray(c.decisions)) {
    window.DECISIONS = namespaceDecisions(c.decisions, slot);
  }
  /* S7 — a BRANCHED section carries the rest of its case at the top level of
     its content (buildSection passes format/finalStep/documents through), and
     those were never published here. It did not show while the Scenario select
     existed, because a branched session always ALSO applied the branched
     scenario, which set these globals on the way past. Picking the branched
     section with no scenario behind it left the format right, the stylesheet
     loaded and the decisions panel empty — the half-broken state this fixes. */
  if (c.format) window.CURRENT_SCENARIO_FORMAT = c.format;
  if (slot.type === "branched") {
    window.CURRENT_SCENARIO_FINAL_STEP = c.finalStep || null;
    window.CURRENT_SCENARIO_DOCUMENTS = c.documents || null;
  }
  /* The roleplay's authorable content travels with its section. */
  window.CURRENT_SECTION_ROLEPLAY = (sec.roleplay && typeof sec.roleplay === "object")
    ? sec.roleplay : null;
  if (typeof document !== "undefined" && window.CanamedSectionContent) {
    try { window.CanamedSectionContent.refresh(); } catch (e) {}
  }
  try { rebuildCaseDerived(); } catch (e) {}
}
/* A slot's TYPE maps back to the module key the scoring/decision engine uses. */
const SECTION_MODULE_FOR_TYPE = { pbl: "A", roleplay: "B", branched: "branched" };

/* ── The branched graph THIS SESSION runs, for a viewer that never entered a
 * room ────────────────────────────────────────────────────────────────────────
 *
 * WHY READING `DECISIONS` IS NOT ENOUGH. applySectionContent() publishes a
 * section's decisions as the STUDENT walks into its stage — it is driven by
 * refreshActiveSlotState(), a stage-change path. The facilitator dashboard never
 * enters a room, so on the admin tab that never runs: CURRENT_SCENARIO_FORMAT
 * still reads "standard" and DECISIONS still carries the DEFAULT scenario's
 * nodes, not the picked section's. The per-room choice tree read both and so
 * rendered nothing at all for a section-picked branched session — the admin-side
 * half of the cutover that the student-side fixes did not reach.
 *
 * Ids go through namespaceDecisions() exactly as applySectionContent() does, so
 * they match the ids the room actually wrote its votes under: RAW for a
 * standalone branched pick, s<slot>_ prefixed in a mixed one. Deriving them any
 * other way yields a graph that looks right and matches no votes.
 *
 * Returns [] when this session runs no branched section. */
function sessionBranchedDecisions() {
  if (typeof window === "undefined") return [];
  let slots = null;
  try { slots = sectionSlots(); } catch (_) { slots = null; }
  const lib = window.CANAMED_SECTIONS || null;
  if (lib && Array.isArray(slots) && slots.length) {
    /* Only a PICKED slot carries a sectionId. _moduleDerivedSlots()' standalone
       branched slot has none, and falls through to the ambient path below. */
    const picked = slots.filter(s => s && s.type === "branched" && s.sectionId);
    if (picked.length) {
      const out = [];
      picked.forEach(slot => {
        const sec = lib[slot.sectionId];
        const dec = sec && sec.content && sec.content.decisions;
        if (Array.isArray(dec)) out.push.apply(out, namespaceDecisions(dec, slot));
      });
      /* A PICK IS AUTHORITATIVE — INCLUDING WHEN IT RESOLVES TO NOTHING.
         This used to read `if (out.length) return out;`, so a picked branched
         section that declared an empty graph fell through to the ambient
         globals below. Probed 2026-08-05 on a dashboard tab holding another
         case's composed nodes: the tree then rendered THAT case's graph for
         this room, complete with a ▶ "deciding now" step the room had never
         seen — not stale data but fabricated live state, and the facilitator
         has no way to tell. Same silent-substitution family as #275.
         "This session's branched section has no graph" is an ANSWER; the
         ambient fallback below is for a session with no pick to read at all. */
      return out;
    }
  }
  /* No pick to resolve — a pre-cutover session, or one composed via branchedRef.
     There the ambient globals ARE the session, so mirror what the room renders
     (branched-render.js branchedDecisions()). */
  const list = Array.isArray(window.DECISIONS) ? window.DECISIONS : [];
  if ((window.CURRENT_SCENARIO_FORMAT || "standard") === "branched") return list.slice();
  return list.filter(d => d && d.module === "branched");
}

/* Deep-copy a section's decisions with slot-scoped ids, and tag them with the
   module key their stage renders into. Pure — the library entry is never
   mutated, so switching back to a slot re-derives the same graph. */
function sectionDecisionPrefix(slot) {
  /* A STANDALONE branched slot keeps its decision ids RAW. Namespacing exists
     to stop two same-type sections sharing a vote tally (both built-in workups
     carry `dec_plan`), and a lone section has nothing to disambiguate. Keeping
     them raw also means a branched session's vote keys are identical whether it
     was created before or after the section cutover — a pre-cutover session has
     no sectionId, so applySectionContent() returns early and its ids stay raw.
     Prefixing only the new ones would split the same case's votes across two id
     shapes for no gain, and make revisit/export comparisons across the cutover
     read as different decisions. */
  if (slot && slot.standalone) return "";
  return "s" + slot.position + "_";
}
function namespaceDecisions(decisions, slot) {
  const pre = sectionDecisionPrefix(slot);
  /* A STANDALONE branched slot renders through the module-A targets
     (#decisions-A / #branched-final-host, both in #stage-1), so its decisions
     must be tagged "A" — tagged "branched" they render into #decisions-branched
     on a stage this session does not use, and the panel simply stays empty.
     Same rule the ANSWERS bucket already follows: a standalone branched session
     aggregates into moduleA, only a COMPOSED one uses the separate bucket. */
  const mod = slot.standalone ? "A" : (SECTION_MODULE_FOR_TYPE[slot.type] || "A");
  /* NULL-PROTOTYPE: keyed by AUTHORED ids, so a plain {} reports inherited
     names (toString, __proto__…) as decisions that exist — a gate on an absent
     one was rewritten into the permanently-locked dead end this prevents — and
     never registers one truly named __proto__. As the pseudonymiser. */
  const own = Object.create(null);
  decisions.forEach(d => { if (d && d.id) own[d.id] = true; });

  return decisions.map(d => {
    const copy = JSON.parse(JSON.stringify(d));
    if (copy.id) copy.id = pre + copy.id;
    copy.module = mod;
    const uw = copy.unlockWhen;
    if (uw && uw.afterDecision != null) {
      /* An UNRESOLVABLE gate is DROPPED, not left dangling. The split puts a
         scenario's decisions on separate stages by module, so a gate across
         that boundary names an id this stage never publishes: decisionUnlocked()
         reads it as permanently unmet and the decision stays locked all session
         — invisible outright under `hideWhenLocked`. Dropping costs only the
         ORDERING the stage boundary already imposes; keeping it destroys the
         decision. It warns, because it does change authored meaning. Nothing
         resolvable is lost: an empty prefix belongs only to a STANDALONE slot,
         which is by definition the session's ONLY one. Cross-SECTION unlocking
         is out of scope — this sees one section and one slot, so it cannot know
         which slot holds the target. validate() rejects it at authoring time,
         which is the real fix. */
      const tgt = (typeof uw.afterDecision === "string")
        ? uw.afterDecision
        : (uw.afterDecision && uw.afterDecision.id);
      if (own[tgt]) {
        if (typeof uw.afterDecision === "string") uw.afterDecision = pre + tgt;
        else uw.afterDecision.id = pre + tgt;
      } else {
        /* Only the dead reference goes; co-declared count gates (hypotheses,
           historyRevealed…) are still satisfiable and stay. */
        delete uw.afterDecision;
        if (!Object.keys(uw).length) delete copy.unlockWhen;
        if (typeof console !== "undefined" && console.warn) {
          /* Says only what was REMOVED: a retained count gate may still lock it. */
          console.warn("[sections] decision '" + copy.id + "' was gated on '" +
            tgt + "', which is not in this section — a gate only works inside " +
            "one section, so its afterDecision gate has been dropped.");
        }
      }
    }
    return copy;
  });
}
let revealed = {};
let seenFindingIds = {};   // findings already shown once, so new ones can flash in
let presence = {};
let typingState = {};      // who is typing - kept off the presence node so a
                           // keystroke does not force a presence re-render for everyone
let answers = { moduleA: {}, moduleB: {}, moduleBranched: {} };
let answerReplies = {};   // map: entryId → { replyId → { text, by, cid, at, stance } }
let hypotheses = {};  // PBL 7-jump scaffold: working diagnoses the team agrees on
                      // BEFORE running investigations. Cross-room synced via
                      // refHypotheses. Keyed by Firebase push id; value is
                      // { by, cid, university, text, at }.
let modBPhase = 0;          // Module B synced phase index (0..5) — room-shared
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
    refAnswers = { moduleA: null, moduleB: null, moduleBranched: null }, refCallForHelp = null, refRooms = null,
    refHypotheses = null,
    refScore = null, refTeamName = null, refLeaderboard = null, refVotes = null,
    refObservers = null, refAnswerReplies = null, refPoll = null, refCertIds = null,
    refRoleChoices = null,
    refReplayRound = null, refRoleAssign = null,
    refModBPhase = null,
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

/* Remove the Firebase SDK's cached "previous websocket failure" flag(s) from
   localStorage. The SDK keys this as `firebase:previous_websocket_failure`
   (sometimes with an origin suffix); once set, it stops attempting the
   WebSocket transport and uses long-poll only — which is broken under RTDB
   App Check enforcement (503). Returns the number of keys cleared. Defensive:
   localStorage can throw (private mode / disabled storage) — never fatal. */
function _clearStickyLongPollFlag() {
  try {
    if (typeof localStorage === "undefined") return 0;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("previous_websocket_failure") !== -1) doomed.push(k);
    }
    doomed.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    return doomed.length;
  } catch (e) { return 0; }
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
    // Clear the SDK's sticky "websocket previously failed" flag BEFORE the
    // realtime connection is built. The Firebase SDK caches
    // `firebase:previous_websocket_failure` in localStorage after a single
    // transient WebSocket hiccup, then permanently prefers long-poll for this
    // origin. Under App Check *enforcement*, the RTDB long-poll transport
    // returns HTTP 503 for App-Check-passing requests (the WebSocket transport
    // works fine) — so a wedged client falls into long-poll-only mode and every
    // realtime read (`once`/`on`) hangs forever with no rejection, leaving the
    // splash stuck on "Checking…" (diagnosed live 2026-05-30). Clearing the
    // flag each boot makes the SDK re-attempt WebSocket (which succeeds); if a
    // network genuinely blocks wss:// the SDK still falls back to long-poll as
    // before, so this is strictly safer.
    _clearStickyLongPollFlag();
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
      callIfFn("renderDecisions");
      callIfFn("renderModBPhase");
      callIfFn("renderObjectives");
      callIfFn("renderLeaderboard");
      callIfFn("renderScore");
      callIfFn("renderStage");
      callIfFn("renderContrib");
      callIfFn("updateWaitingStatus");   // i18n the waiting-room status on a mid-wait language switch
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
          try { nameFieldForFocus.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }); }
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
          try { target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }); }
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
    btn.innerHTML = icMarkup(soundOn ? "sound-on" : "sound-off");
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
const CONSENT_NOTICE_VERSION = "PIS-v3-2026-07";

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
  // Box C — retention of the Teams transcript + recording. Optional and
  // INDEPENDENT of box B (a participant may accept research use but refuse
  // the transcript, or the reverse), so it is read and recorded separately
  // and never gates the join.
  const cTranscript = !!(el("consent-transcript") && el("consent-transcript").checked);
  // Certificate verification is on by default and privacy-preserving (only a
  // one-way hash of name+session is ever published — see the verification note
  // in the lobby and the certificate flow). Recorded true for the audit trail.
  const cVerification = true;
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
    transcript: cTranscript,
    verification: cVerification,
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
    // Read first to avoid a doomed write (which the Firebase SDK logs as a
    // PERMISSION_DENIED warning at the SDK level — before our .catch can
    // swallow it). The binding is write-once, so once set it never changes;
    // skipping the set when a value already exists is correct + silent.
    const ref = db.ref(sPath("clientMapping/" + clientId));
    return ref.once("value").then(snap => {
      if (snap.exists()) return; // already bound (ours or legacy): no-op
      return ref.set(currentUser.uid).catch(e => {
        const code = e && e.code;
        if (code === "PERMISSION_DENIED") return; // raced another writer
        try { console.warn("claimClientMapping failed:", code); } catch (_) {}
      });
    }).catch(e => {
      try { console.warn("claimClientMapping read failed (continuing):", e && e.code); } catch (_) {}
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
    // Read first to avoid a doomed write (SDK logs PERMISSION_DENIED at
    // WARNING level before our .catch sees it). Mapping is write-once.
    const ref = db.ref(sPath("stableIdMapping/" + stableId));
    return ref.once("value").then(snap => {
      if (snap.exists()) return; // already bound: no-op
      return ref.set(currentUser.uid).catch(e => {
        const code = e && e.code;
        if (code === "PERMISSION_DENIED") return; // raced another writer
        try { console.warn("claimStableIdMapping failed:", code); } catch (_) {}
      });
    }).catch(e => {
      try { console.warn("claimStableIdMapping read failed (continuing):", e && e.code); } catch (_) {}
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
    .then(() => writeRoster())
    .then(() => {
      if (!joined) return; // user left while membership write was in-flight
      _joinParticipantWireUp();
    });
}

/* #14 — capture the participant's email into the facilitator-only /rosters
 * subtree, which lives OUTSIDE the peer-readable session tree so other
 * participants never see it (the session .read is "any member"; names are
 * already member-visible, but email is new PII and must not be). Only for
 * signed-in (Google) participants who gave RESEARCH consent — the consent
 * copy states "If you sign in with Google, your email is also recorded" and
 * that identifiable data is linked for research and seen only by the study
 * facilitators. Anonymous joiners have no email and write nothing. Keyed by
 * auth.uid; the rosters rule lets a participant write ONLY their own entry
 * and only the session creator (creatorUid) read the roster. Best-effort: a
 * legacy DB without the rosters rule, or a participant who declined research,
 * simply writes nothing and the join continues. */
function writeRoster() {
  if (!db || !currentUser || !currentUser.uid || !sessionNum) return Promise.resolve();
  if (currentUser.isAnonymous || !currentUser.email) return Promise.resolve();
  if (!myConsent || myConsent.research !== true) return Promise.resolve();
  try {
    const entry = { email: String(currentUser.email).slice(0, 254), at: Date.now() };
    if (myName) entry.name = String(myName).slice(0, 120);
    if (myUniversity) entry.university = String(myUniversity).slice(0, 120);
    return db.ref("rosters/" + sPath(currentUser.uid)).set(entry).catch(e => {
      // Tolerated: legacy DBs without the rosters rule, or a creatorUid the
      // emulator hasn't set — the workshop join continues regardless.
      try { console.warn("writeRoster skipped (continuing):", e && e.code); } catch (_) {}
    });
  } catch (e) {
    try { console.warn("writeRoster threw (continuing):", e); } catch (_) {}
    return Promise.resolve();
  }
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

  refRoomCount.on("value", snap => {
    roomCount = snap.val() || 4;
    // The leaderboard iterates roomNames(roomCount); a late/changed room count
    // must refresh it so a new room's score can show live (not only after the
    // next score write). No-op if the board isn't mounted yet.
    if (typeof renderLeaderboard === "function") { try { renderLeaderboard(); } catch (_) {} }
  });
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
  // UX/i18n fix (2026-06-01): these two messages were hardcoded English even
  // though the waiting.status-* keys already ship in en/fr/ja — so FR/JP
  // participants saw English on the waiting screen. Use the existing keys
  // (tFallback keeps the English text if i18n hasn't loaded yet); the
  // canamed:langchange handler re-calls this so a mid-wait language switch
  // updates the line.
  el("waiting-status").textContent = started
    ? tFallback("waiting.status-starting",
        "The session has started — placing you in a room…")
    : tFallback("waiting.status-not-started",
        "You have joined. Waiting for a facilitator to start the session…");
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
      // Combined wrap-up: finishing the POST-test unlocks the questionnaire
      // right below, so the two read as one end-of-session task.
      if (which === "post" && typeof renderSurvey === "function") renderSurvey();
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
        // Combined wrap-up: skipping the POST-test still unlocks the
        // questionnaire (the student may want to give feedback even so).
        if (which === "post" && typeof renderSurvey === "function") renderSurvey();
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
   test can mount it without a live wrap-up stage. When `preview` is true the
   form renders read-only (inputs disabled, no submit) for the facilitator. */
function _mountSurveyForm(preview) {
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
        if (preview) b.disabled = true;
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
      if (preview) sel.disabled = true;
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
      if (preview) ta.readOnly = true;
      field.appendChild(ta);
      getters[item.id] = () => (ta.value || "").trim();
    }
    form.appendChild(field);
  });
  body.appendChild(form);

  if (preview) {
    const note = document.createElement("p");
    note.className = "survey-preview-note hint";
    note.textContent = _tFmt("survey.preview-note",
      "Facilitator preview — students fill this in at wrap-up; nothing is saved here.");
    body.appendChild(note);
    return;
  }
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
/* Combined wrap-up gate (2026-05-27): the questionnaire is grouped WITH the
   post-test — it only becomes available once the post-test is done or skipped,
   so the student completes them as one task (post-test → feedback) instead of
   seeing two competing cards. A scenario that ships no post-test shows the
   questionnaire straight away. Pure (no DOM/Firebase) so it is unit-testable. */
function _surveyReadyAfterPostTest(postBankLen, postRec) {
  if (!postBankLen) return true;
  return !!(postRec && (typeof postRec.completedAt === "number" || postRec.skipped === true));
}

function renderSurvey() {
  const card = el("survey-card");
  if (!card) return;
  const bank = _surveyBank();
  if (!bank.length) { card.classList.add("hidden"); return; }
  // Facilitator preview (2026-06-16, PI request): show the questionnaire
  // read-only so the facilitator can see exactly what students fill in.
  // Nothing entered here is saved.
  if (isRoomAdmin) {
    card.classList.remove("hidden");
    const intro = el("survey-card-intro");
    if (intro) intro.textContent = _tFmt("survey.preview-intro",
      "Facilitator preview — this is the questionnaire students complete at wrap-up. Nothing you enter here is saved.");
    const startBtn = el("survey-start-btn"); if (startBtn) startBtn.classList.add("hidden");
    const skipBtn = el("survey-skip-btn"); if (skipBtn) skipBtn.classList.add("hidden");
    _mountSurveyForm(true);
    return;
  }
  if (!myRoom) { card.classList.add("hidden"); return; }
  // Post-test gate dropped 2026-06-16 (PI request): the questionnaire now always
  // shows for students at wrap-up, independent of the post-test.
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
  h.textContent = (teamName || myRoom || "Your team") + " — well played";
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
/* The Module A "answer" — the case's actual diagnosis — for the wrap-up. Read
 * from the active scenario's clinical-synthesis item (SYNTH_ID), whose aParts
 * carry a labelled "Diagnosis" segment. Returns { label, body } localised, or
 * null when the scenario's synthesis has no diagnosis segment (so it simply
 * shows nothing rather than guessing). */
function moduleADiagnosis() {
  const lang = (typeof _curLang === "function") ? _curLang() : "en";
  try {
    const syn = (typeof itemById === "function") ? itemById(SYNTH_ID) : null;
    if (syn && Array.isArray(syn.aParts)) {
      const dx = syn.aParts.find(p => {
        if (!p || !p.label) return false;
        const l = (p.label.en || "") + " " + (p.label.fr || "") + " " + (p.label.ja || "");
        return /diagnos|診断/i.test(l);   // "diagnos*" / "diagnostic" / 診断
      });
      if (dx && dx.body) return { label: tc(dx.label, lang), body: tc(dx.body, lang) };
    }
  } catch (_) { /* scenario without a synthesis diagnosis — show nothing */ }
  return null;
}
function renderWrapupSummary() {
  renderTeamRecap();
  const box = el("wrapup-summary");
  if (!box) return;
  box.innerHTML = "";
  // Set-driven: only the modules this scenario runs, labelled from the ACTIVE
  // scenario (the pair here used to be hardcoded to "Chronic Pain" /
  // "Breaking Bad News", so an A-only session printed an empty Module-B block
  // under the wrong title).
  moduleSet().map(id => ["module" + id, stageLabel(stageForModule(id))])
    .forEach(([moduleKey, label]) => {
      const h = document.createElement("h4");
      h.className = "wrapup-mod"; h.textContent = label;
      box.appendChild(h);
      // 1. The team's OWN answers (what they actually wrote) come first — this
      //    is what the "Your room's answers" heading promises.
      const entries = entriesSorted(answers[moduleKey]);
      if (entries.length === 0) {
        const e = document.createElement("p");
        e.className = "empty"; e.textContent = "No answers recorded.";
        box.appendChild(e);
      } else {
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
      }
      // 2. THEN the official model answer, clearly labelled and visually set
      //    apart so it never reads as something the team wrote (user request
      //    2026-06-02). Module A only — Module B is a roleplay with no single
      //    "correct" diagnosis to score against.
      if (moduleKey === "moduleA") {
        const dx = moduleADiagnosis();
        if (dx) {
          const block = document.createElement("div");
          block.className = "wrapup-official";
          const lbl = document.createElement("p");
          lbl.className = "wrapup-official-label";
          lbl.textContent = tFallback("wrap.official-answer",
            "✓ Official answer — the case diagnosis");
          const body = document.createElement("p");
          body.className = "wrapup-official-body";
          const strong = document.createElement("strong");
          strong.textContent = (dx.label || "Diagnosis") + ": ";
          body.appendChild(strong);
          body.appendChild(document.createTextNode(dx.body));
          block.appendChild(lbl);
          block.appendChild(body);
          box.appendChild(block);
        }
      }
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
    el("waiting-status").textContent = tFallback("waiting.status-place-failed",
      "We could not place you in a room yet. It will try again automatically. " +
      "If nothing happens after a minute, please reload the page.");
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
  initStageOverflow();
  initStageDetailsToggle();
  initLeaderboardFlow();
  initEndPoll();
  initTeamName();
  initRolePicker();
  initModBPhaseNav();
  initCoachDismiss();
  initHypotheses();
  // Initial coach paint — set the text + stepper-state from current
  // platform state on entry. Subsequent updates fire from the render
  // paths (renderFindings / renderAnswers / switchRcolTab).
  if (typeof updateModANextStep === "function") updateModANextStep();
  if (typeof updateModBNextStep === "function") updateModBNextStep();
  initChartTabs();
  initRightColumnTabs();
  initMobileTabbar();
}

/* ===================== STAGE 1: right-column tab bar =======================
   The right column carries five distinct things (findings, team decisions,
   discussion, group answers, reference) - each one big enough to bury the
   others if they all flowed in a single scroll. Tabs collapse the scroll to one
   click per section. The DOM ids of every section are unchanged so the rest of
   the engine (renderFindings, renderDecisions, renderAnswers)
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
/* ===================== STAGE 1: left-column workup tab bar =================
   The Module A "chart" carries three data-gathering modes — Dialogue (the LLM
   patient chat), Examination and Investigations — that used to stack as three
   <details>. A student had to scroll past a long chat transcript to reach the
   exam/labs buttons. This tab bar shows ONE at a time. Panel ids and group ids
   are unchanged, so buildButtons()/renderButtons(), the chat mount and the
   is-locked toggle keep working. Mirrors initRightColumnTabs() above (click +
   ArrowLeft/Right roving focus, role=tab/tabpanel set in the markup). */
function initChartTabs() {
  const bar = document.querySelector(".chart-tabs");
  if (!bar || bar.dataset.wired) return;
  bar.dataset.wired = "1";
  bar.querySelectorAll(".chart-tab").forEach(btn => {
    btn.addEventListener("click", () => switchChartTab(btn.dataset.chartTab));
    btn.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const tabs = [...bar.querySelectorAll(".chart-tab")];
      const i = tabs.indexOf(btn);
      const next = e.key === "ArrowRight"
        ? tabs[(i + 1) % tabs.length] : tabs[(i - 1 + tabs.length) % tabs.length];
      next.focus(); switchChartTab(next.dataset.chartTab);
    });
  });
}
function switchChartTab(tab) {
  if (!tab) return;
  document.querySelectorAll(".chart-tab").forEach(b => {
    const on = b.dataset.chartTab === tab;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) b.classList.remove("has-attention");
  });
  document.querySelectorAll(".chart-tab-panel").forEach(p => {
    const on = p.dataset.chartPanel === tab;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  // Returning to Dialogue clears the "Mr Lefebvre answered while you were on
  // another tab" badge (set by modA-llm-init.js _flagDialogueUnread()).
  if (tab === "dialogue") {
    const badge = document.getElementById("chart-tab-badge-dialogue");
    if (badge) { badge.hidden = true; badge.textContent = ""; delete badge.dataset.count; }
  }
}

function switchRcolTab(tab) {
  if (!tab) return;
  activeRcolTab = tab;
  // Progressive reveal (2026-06-01): switching TO a Module A tab must make it
  // visible. Callers include the auto-open-on-unlock flow, the coach's "Open
  // …" action buttons, and tests-e2e/modA-autoopen-steps.spec.js, which jump
  // straight to a panel before its phase-gated reveal has fired. Un-hide the
  // target button + un-collapse the right column so the chosen panel can show.
  // (revealModARightCol keeps it visible via the sticky data-revealed flag.)
  const targetBtn = document.querySelector('#stage-1 .rcol-tab[data-tab="' + tab + '"]');
  if (targetBtn) {
    targetBtn.dataset.revealed = "1";
    targetBtn.hidden = false;
    const cols = document.querySelector("#stage-1 .columns");
    if (cols) cols.classList.remove("rcol-collapsed");
  }
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
  if (typeof updateMobileTabbar === "function") updateMobileTabbar();
}

/* Progressive right-column reveal (2026-06-01 UX de-clutter). Module A used to
 * show all three tabs (Decide together / Debate / Our final answers) from the
 * moment the student landed on the stage — Debate even carried a 🔒 "locked"
 * teaser. None are usable at the start, so the whole strip was noise. This shows
 * each tab only once it becomes actionable, one per phase:
 *   • Decide together → the team has interviewed AND examined the patient
 *     (history ≥1 and exam ≥1) — the point where the plan decisions become live.
 *   • Debate         → the clinical synthesis (red-flag screen) is complete.
 *   • Our final answers → the Exchange is underway (a prompt reply or an answer
 *     exists, the debate is done, or the Module A votes are settled).
 * Reveal is STICKY (data-revealed) so a tab never vanishes under the user if the
 * underlying state momentarily regresses. While nothing is revealed the whole
 * right column is collapsed (.rcol-collapsed on #stage-1 .columns → single
 * column, no empty grid track). Idempotent; safe to call on every state change. */
function revealModARightCol() {
  const cols = document.querySelector("#stage-1 .columns");
  if (!cols) return;

  // Phase signals — mirror the reads in updateModANextStep().
  const histDone = (typeof revealedCountByGroup === "function") &&
    revealedCountByGroup("history") >= 1;
  const examDone = (typeof revealedCountByGroup === "function") &&
    revealedCountByGroup("exam") >= 1;
  // Debate + final answers now reveal on the ≥1-hypothesis phase gate
  // (2026-06-02), together with the Synthesis section — not on the synthesis
  // being revealed.
  const gateOpen = (typeof phaseGateOpen === "function") && phaseGateOpen();

  const reveal = {
    decisions: histDone && examDone,
    // Debate + answers MERGED (2026-06-25): the single "answers" tab carries the
    // two questions and reveals as soon as the ≥1-hypothesis gate opens.
    answers: gateOpen
  };

  let anyVisible = false;
  ["decisions", "answers"].forEach(tab => {
    const btn = cols.querySelector('.rcol-tab[data-tab="' + tab + '"]');
    if (!btn) return;
    const show = reveal[tab] || btn.dataset.revealed === "1";
    if (show) { btn.dataset.revealed = "1"; btn.hidden = false; anyVisible = true; }
    else { btn.hidden = true; }
  });

  cols.classList.toggle("rcol-collapsed", !anyVisible);

  // Once the column appears, make sure a *visible* tab owns the panel — the
  // default-active "decisions" tab may still be hidden when "discussion" is the
  // first to reveal. switchRcolTab re-enters here, but activeRcolTab is set to
  // the (now-visible) target first, so this branch does not fire again.
  if (anyVisible) {
    const active = cols.querySelector('.rcol-tab[data-tab="' + activeRcolTab + '"]');
    if (!active || active.hidden) {
      const firstVisible = [...cols.querySelectorAll(".rcol-tab")].find(b => !b.hidden);
      if (firstVisible && typeof switchRcolTab === "function") {
        switchRcolTab(firstVisible.dataset.tab);
      }
    }
  }

  // Keep the mobile thumb-reach mirror in lockstep with the canonical reveal
  // (it mirrors the per-tab hidden state + hides the whole bar until a tab
  // appears). switchRcolTab already calls it, but a reveal driven purely by a
  // state change (e.g. history+exam) wouldn't otherwise refresh the bar.
  if (typeof updateMobileTabbar === "function") updateMobileTabbar();
}

/* a small attention nudge: when content changes while the user is on a different
   tab, dot that tab so they know there is something new. Always safe to call. */
function nudgeRcolTab(tab) {
  if (tab === activeRcolTab) return;
  const btn = document.querySelector('.rcol-tab[data-tab="' + tab + '"]');
  if (btn) btn.classList.add("has-attention");
  if (typeof updateMobileTabbar === "function") updateMobileTabbar();
}
function setTabBadge(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  if (text === "" || text == null) { node.textContent = ""; node.hidden = true; }
  else { node.textContent = String(text); node.hidden = false; }
  if (typeof updateMobileTabbar === "function") updateMobileTabbar();
}

/* ===================== Mobile sticky bottom tab bar (Module A) ============
   A body-level mirror of the right-column .rcol-tabs, for thumb reach on
   phones (the canonical strip is sticky at the TOP of the right column, which
   on a long Module A scroll drifts well above the thumb). It can't live inside
   the right column: #app / #stage-1 carry the stage-transition transform,
   which would become the containing block for a position:fixed bar and pin it
   to the stage bottom instead of the viewport. So the bar is a
   <nav id="mobile-rcol-tabbar"> at body level and we MIRROR the canonical
   tabs' state here. Taps proxy to switchRcolTab(); the active / badge / locked
   state is copied FROM the real .rcol-tab buttons (single source of truth). */
let _mTabbarTyping = false;
function initMobileTabbar() {
  const bar = document.getElementById("mobile-rcol-tabbar");
  if (!bar || bar.dataset.wired) return;
  bar.dataset.wired = "1";
  bar.querySelectorAll(".mtab").forEach(btn => {
    btn.addEventListener("click", () => {
      if (typeof switchRcolTab === "function") switchRcolTab(btn.dataset.tab);
      updateMobileTabbar();
    });
  });
  // Hide the bar while a text field is focused — a fixed bottom bar would
  // otherwise float above the on-screen keyboard, covering the very field
  // being typed into.
  document.addEventListener("focusin", _mTabbarFocusChange);
  document.addEventListener("focusout", _mTabbarFocusChange);
  updateMobileTabbar();
}
function _mTabbarFocusChange() {
  const a = document.activeElement;
  const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" ||
    a.isContentEditable === true);
  if (typing === _mTabbarTyping) return;
  _mTabbarTyping = typing;
  updateMobileTabbar();
}
/* Sync the mirror from the canonical tabs, then decide visibility. Safe to
   call any time; no-ops if the bar isn't in the DOM. */
function updateMobileTabbar() {
  const bar = document.getElementById("mobile-rcol-tabbar");
  if (!bar) return;
  let anyRevealed = false;
  ["decisions", "answers"].forEach(tab => {
    const src = document.querySelector('.rcol-tab[data-tab="' + tab + '"]');
    const dst = bar.querySelector('.mtab[data-tab="' + tab + '"]');
    if (!src || !dst) return;
    // Mirror the progressive-reveal hidden state (2026-06-02): the canonical
    // tabs reveal one per phase (revealModARightCol), so the thumb-reach mirror
    // must hide the same buttons — otherwise the bottom bar shows Debate /
    // Our final answers before they're actionable. (.mtab[hidden] in CSS.)
    dst.hidden = src.hidden;
    if (!src.hidden) anyRevealed = true;
    const active = src.classList.contains("is-active");
    dst.classList.toggle("is-active", active);
    if (active) dst.setAttribute("aria-current", "true");
    else dst.removeAttribute("aria-current");
    dst.classList.toggle("is-locked", src.classList.contains("is-locked"));
    dst.classList.toggle("has-attention", src.classList.contains("has-attention"));
    const srcBadge = document.getElementById("tab-badge-" + tab);
    const dstBadge = document.getElementById("mtab-badge-" + tab);
    if (srcBadge && dstBadge) {
      const txt = srcBadge.textContent || "";
      dstBadge.textContent = txt;
      dstBadge.hidden = srcBadge.hidden || txt === "";
    }
  });
  // Visible only while Module A (stage-1) is the on-screen stage AND we're in
  // the room (#app shown), and not while a text field is focused. Gating on
  // the DOM (not the viewStage variable) keeps it correct under both the real
  // renderStage() flow and the _test_ harness, which surfaces stage-1 by
  // toggling .hidden directly. The <=720px gate is pure CSS.
  const app = document.getElementById("app");
  const stage1 = document.getElementById("stage-1");
  const onModuleA = !!app && !app.classList.contains("hidden") &&
    !!stage1 && !stage1.classList.contains("hidden");
  // Keep the bar down until at least one tab has been revealed — mirrors the
  // collapsed right column on desktop, so a fresh Module A shows neither.
  const show = onModuleA && !_mTabbarTyping && anyRevealed;
  bar.hidden = !show;
  if (document.body) document.body.classList.toggle("mtabbar-on", show);
}

function enterRoom(roomName, asAdmin) {
  asAdmin = !!asAdmin;
  // Room-only CSS is lazy (split out of the eager style.css — see
  // ensureRoomStyles in script-loader.js). Kick the fetch off at the very top of
  // room entry, before any of the teardown/subscription work below, so the
  // stylesheet is in flight while the room is still being wired up. Warmed even
  // earlier from the lobby (see below), so this is normally already resolved.
  try { CanamedLoader.ensureRoomStyles().catch(function () {}); } catch (e) {}
  if (refStage) teardownRoom();      // switching rooms: drop the old subscriptions
  isRoomAdmin = asAdmin;
  myRoom = roomName;
  roomStage = 0; viewStage = 0;
  firstStageFire = true;
  /* S2b-1 — clear the per-slot store too. Clearing only the pointer would
     leave the previous room's reveals in sectionState, and the next room's
     first refreshActiveSlotState() would hand them straight back. */
  sectionState = {}; activeSlot = 1; _appliedSectionId = null;
  revealed = {}; hypotheses = {};
  presence = {}; typingState = {}; seenFindingIds = {};
  myPendingReveal = null;
  answers = { moduleA: {}, moduleB: {}, moduleBranched: {} }; callForHelp = null;
  roomScore = {}; teamName = ""; celebratedEvents = {}; penalisedEvents = {};
  roomVotes = {}; committedDecisions = {}; firstVoteFire = true;
  firstScoreFire = true; wrapCelebrated = false;
  modBPhase = 0;
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
  // room.css is lazily <link>ed, so revealing #app before it lands flashes an
  // unstyled room (CI caught exactly this). If the sheet is already applied —
  // the normal path, warmed at enterUnlockedSession while the lobby rendered —
  // reveal synchronously so nothing below reorders. Only a COLD entry waits,
  // and it reveals on failure too: degraded styling beats a blank app.
  (function revealApp() {
    const show = function () { el("app").classList.remove("hidden"); };
    const link = document.getElementById("room-css");
    if (link && link.sheet) { show(); return; }
    let p = null;
    try { p = CanamedLoader.ensureRoomStyles(); } catch (e) { p = null; }
    if (p && typeof p.then === "function") p.then(show, show); else show();
  })();
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
    unbindSectionRefs();
    if (refPresence) refPresence.off();
    if (refTyping) refTyping.off();
    /* refAnswers.* are pointers into refSection, detached by
       unbindSectionRefs() above. */
    if (refCallForHelp) refCallForHelp.off();
    if (refScore) refScore.off();
    if (refVotes) refVotes.off();
    if (refObservers) refObservers.off();
    if (refRoleChoices) refRoleChoices.off();
    if (refReplayRound) refReplayRound.off();
    /* refRoleAssign / refModBPhase are pointers into refSection, already
       detached by unbindSectionRefs() above. */
    if (refAnswerReplies) refAnswerReplies.off();
    if (refTeamName) refTeamName.off();
    if (refLeaderboard) refLeaderboard.off();
    // Module A LLM-patient chat listeners (chat + awarded under
    // rooms/<id>/moduleA) are room-scoped. Release them like every other room
    // subscription so a room switch / leave doesn't leave a stale child_added
    // stacking duplicate chat bubbles on the next entry (session 1 double-render
    // fix, 2026-06-23). modALLMInit() is idempotent too, but tearing down here
    // keeps the contract uniform with the rest of teardownRoom.
    if (window.modALLMRuntime && typeof window.modALLMRuntime.destroy === "function") {
      try { window.modALLMRuntime.destroy(); } catch (e) { /* ignore */ }
      window.modALLMRuntime = null;
    }
    // NOTE: refClosed is session-scoped (not room-scoped). It is owned by
    // enterUnlockedSession / subscribeClosedListener, not by startRoom, so
    // teardownRoom does NOT unsubscribe it - we want the kick-screen to fire
    // even if the user is switching rooms or somehow leaves a room.
  } catch (e) { /* ignore */ }
}

/* ── S2b-2 — bind one listener set PER SLOT, at the per-slot paths ────────────
 * Room state now lives at rooms/$roomId/sections/$slot/… A set is bound for
 * EVERY slot the session runs, not just the one on screen: the wrap-up
 * aggregates all of them, and Back navigation can land on any.
 *
 * refRevealed / refHypotheses / refModBPhase / refRoleAssign remain as POINTERS
 * at the ACTIVE slot's refs (pointSectionRefs, called from
 * refreshActiveSlotState) — which is what leaves all ten write sites untouched.
 *
 * Bound once from startRoom(): the section set is write-once per session and is
 * loaded before the room starts, so it cannot change under a live room. */
let refSection = {};          // slot -> { revealed, hypotheses, phase, roleAssign }
function bindSectionRefs(base) {
  unbindSectionRefs();
  sectionSlots().forEach(sl => {
    const slot = sl.position;
    const p = base + "/sections/" + slot;
    const R = {
      revealed:   db.ref(p + "/revealed"),
      hypotheses: db.ref(p + "/hypotheses"),
      phase:      db.ref(p + "/phase"),
      roleAssign: db.ref(p + "/roleAssign"),
      /* S6 — answers move per slot too. They were the last room state still on
         a module-literal node, which is why three separate readers kept coming
         up empty. */
      answers:    db.ref(base + "/answers/sections/" + slot)
    };
    refSection[slot] = R;

    R.revealed.on("value", snap => {
      slotState(slot).revealed = snap.val() || {};
      refreshActiveSlotState();

      /* S2b-1 — land it in the SLOT's store, then repoint. Writing straight to
         `revealed` would make the last listener to fire win once two PBL slots
         exist. */
          renderCase();
      // The Investigations unlock gate now depends on revealed items
      // (red-flag screen: history:1 + history:2 + exam:3). Re-render
      // the hypotheses block so its visible lock state stays in sync.
      if (typeof renderHypotheses === "function") renderHypotheses();
    });
    R.hypotheses.on("value", snap => {
      slotState(slot).hypotheses = snap.val() || {};
      refreshActiveSlotState();

          if (typeof renderHypotheses === "function") renderHypotheses();
      if (typeof renderButtons === "function") renderButtons();
      // ≥1 hypothesis is the phase gate (2026-06-02; lowered to 1 on 2026-06-25):
      // updateModANextStep() below re-runs revealModARightCol(), so the Debate &
      // answers tab unlocks the moment the team crosses the gate.
      // ...and the decisions panel: a hypotheses-gated vote (e.g. dec_plan,
      // unlockWhen.hypotheses) must drop its "Ready when: add a working hypothesis"
      // lock the moment the gate opens — not wait for the next presence/score event
      // to repaint it. (Bug 2026-06-16: the management-plan vote stayed locked after
      // the team had already written a working hypothesis.)
      if (typeof renderDecisions === "function") renderDecisions();
      if (typeof updateModANextStep === "function") updateModANextStep();
    });
    /* The roleplay's synced phase and role draw are per slot, so two roleplay
       sections keep separate timetables. An inactive slot's snapshot must not
       repaint the visible stage — but it must NOT be thrown away either: RTDB
       does not re-fire on("value") for an unchanged value, so a dropped
       snapshot never comes back and walking into the second roleplay would show
       the FIRST one's phase. Store it per slot, then replay on activation. */
    R.phase.on("value", snap => {
      slotState(slot).phase = snap.val();
      if (slot !== activeSlot) return;

      const v = snap.val();
      /* S1c-3b — clamp to THIS roleplay's phase count, not the built-in six. A
         literal `<= 5` silently reset an authored 8-phase roleplay to phase 0 the
         moment the room advanced past its sixth beat: third instance of the same
         class as the two rules enums, and the only one on a READ path — so it
         would have looked like the room jumping back rather than a write being
         refused. */
      const _maxPhase = ((modBCfg().phases) || []).length - 1;
      modBPhase = (typeof v === "number" && v >= 0 && v <= _maxPhase) ? Math.floor(v) : 0;
      if (typeof renderModBPhase === "function") renderModBPhase();
    });
    R.answers.on("value", snap => {
      slotState(slot).answers = snap.val() || {};
      refreshAnswerAggregates();
      renderAnswers(ANSWER_KEY_FOR_TYPE[sl.type] === "moduleB" ? "moduleB" : "moduleA");
      renderObjectives();
      /* Branched: the "before you vote" reasoning lists live INSIDE the decision
         cards, so a teammate's contribution must re-render them. */
      if (typeof renderDecisions === "function") renderDecisions();
      if (typeof renderBranchedFinal === "function") renderBranchedFinal();
    });
    R.roleAssign.on("value", snap => {
      slotState(slot).roleAssign = snap.val();
      if (slot !== activeSlot) return;

      try { handleRoleAssign(snap.val()); } catch (_) {}
    });
  });
  pointSectionRefs();
}
function unbindSectionRefs() {
  Object.keys(refSection).forEach(k => {
    const R = refSection[k];
    ["revealed", "hypotheses", "phase", "roleAssign", "answers"].forEach(n => {
      if (R && R[n]) { try { R[n].off(); } catch (_) {} }
    });
  });
  refSection = {};
}
/* The type-keyed view every existing reader expects (`answers.moduleA` …),
   rebuilt from the per-slot buckets. Aggregating by TYPE rather than aliasing
   both keys to one bucket matters: the score engine drives DIFFERENT micro-
   bullets off aEntries and bEntries, so pointing both at the same map would
   award a roleplay's bullets for a PBL section's answers.
   KNOWN LIMIT: two sections of the same type share this view, so the wrap-up
   lists their answers together. Per-slot display needs the renderer scoped to a
   slot — tracked, not done here. */
/* Type → the answers key the readers use. NOT "module" + moduleId: that yields
   "modulebranched" for a branched section, which is neither a key of the
   aggregate nor what branchedAnswerBucket() reads — the final-diagnosis
   deliverable came back empty. Spelled out so the casing cannot drift. */
const ANSWER_KEY_FOR_TYPE = { pbl: "moduleA", roleplay: "moduleB",
                              branched: "moduleBranched" };
function refreshAnswerAggregates() {
  const agg = { moduleA: {}, moduleB: {}, moduleBranched: {} };
  sectionSlots().forEach(sl => {
    /* A STANDALONE branched session renders in the PBL view and its engine
       reads "moduleA" (branchedAnswerBucket), so its slot aggregates there —
       only a COMPOSED branched module uses the separate bucket. */
    const key = (sl.standalone && sl.type === "branched")
      ? "moduleA" : (ANSWER_KEY_FOR_TYPE[sl.type] || "moduleA");
    const bucket = slotState(sl.position).answers || {};
    Object.keys(bucket).forEach(k => { agg[key][k] = bucket[k]; });
  });
  answers.moduleA = agg.moduleA;
  answers.moduleB = agg.moduleB;
  answers.moduleBranched = agg.moduleBranched;
}
/* Point the legacy write refs at the active slot. */
function pointSectionRefs() {
  const R = refSection[activeSlot];
  refRevealed   = R ? R.revealed   : null;
  refHypotheses = R ? R.hypotheses : null;
  refModBPhase  = R ? R.phase      : null;
  refRoleAssign = R ? R.roleAssign : null;
  /* All three module keys write into the ACTIVE slot's bucket: which container
     the entry belongs to is decided by the stage on screen, not by the key. */
  refAnswers.moduleA = refAnswers.moduleB = refAnswers.moduleBranched =
    R ? R.answers : null;
}

function startRoom() {
  const base = sPath("rooms/" + myRoom);
  refStage = db.ref(base + "/stage");
  bindSectionRefs(base);
  refPresence = db.ref(base + "/presence");
  refTyping = db.ref(base + "/typing");
  refCallForHelp = db.ref(base + "/callForHelp");
  refScore = db.ref(base + "/score");
  refVotes = db.ref(base + "/votes");
  refTeamName = db.ref(base + "/teamName");
  refLeaderboard = db.ref(sPath("rooms"));
  // Sim 2026-05-19 features — per-room observer flags, free-text reply
  // threads on group-answers. Refs declared here so every room transition
  // wires/teardowns them in lock-step with the existing per-room subscribers.
  refObservers = db.ref(base + "/observers");
  refAnswerReplies = db.ref(base + "/answerReplies");
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

  // Randomly assign roles (2026-06-26): a member taps the button, which computes
  // a distinct-role draw over the present roster and writes a {clientId: role}
  // mapping here; each client then claims its OWN assigned role. handleRoleAssign
  // guards on `at` so a refresh / late snapshot doesn't re-apply an old draw.
  _lastRoleAssignAt = 0;   // room-scoped: a fresh room's draw must not be skipped
                           // just because the previous room's draw had a later `at`


  // Module B synced phase (2026-05-27): the whole room moves through the six
  // phases together. A room member can advance it (the write rule requires
  // auth + open session + room membership — gated in module-set M3a).


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
  // M4d — the composed branched module's deliverable + in-card reasoning.
  // Mirrors the moduleA handler's branched half: a teammate's contribution
  // must re-render the decision cards (the reasoning lists live inside them)
  // and refresh the final-answer lists.
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
    // The live leaderboard reads ALL rooms (sPath("rooms")), which requires
    // session membership. The old subscription passed NO error callback, so a
    // denied/raced all-rooms read (e.g. the listener registering before
    // claimMembership() has propagated) was swallowed silently: allRooms stayed
    // {}, the board showed "No points yet" for the whole session, while the
    // student's own-room score panel (the narrower refScore read) kept working —
    // exactly the first-session symptom (2026-06-23). Log the failure, fall back
    // to the own-room view (renderLeaderboard seeds allRooms[myRoom] locally),
    // and re-subscribe ONCE in case membership simply hadn't landed yet.
    var _lbResubscribed = false;
    var _onLb = function (snap) { allRooms = snap.val() || {}; renderLeaderboard(); };
    // Named error handler so the retry below ALSO passes it — otherwise a second
    // denied/raced read would fail silently again (CodeRabbit, 2026-06-23).
    var _onLbErr = function (err) {
      try { console.warn("[leaderboard] all-rooms read failed:", err && err.code); } catch (_) {}
      renderLeaderboard();
      if (!_lbResubscribed) {
        _lbResubscribed = true;
        setTimeout(function () {
          try { if (refLeaderboard && !isRoomAdmin) refLeaderboard.on("value", _onLb, _onLbErr); } catch (_) {}
        }, 1500);
      }
    };
    refLeaderboard.on("value", _onLb, _onLbErr);
  }

  /* NO participant-side stage initialiser here — deliberately. A room's stage
     has ONE writer, setRoomStage() in script-admin.js; a write of 0 from here
     raced it and rolled the room back a stage. Every reader already defaults a
     missing stage to 0. See tests/room-stage-single-writer.test.js. */

  /* Per-room uid membership claim (introduced 2026-05-28 with the LLM-patient
     pilot; the set of rules depending on it was EXPANDED 2026-05-30). Claimed
     here on room entry BEFORE any gameplay write. The per-room rules require
     this entry for: LLM chat, scoring (awarded/auto/penalties), moduleA
     hypotheses + prompt replies, moduleB exchange replies, votes/committed and
     the answers nodes.

     THE VALUE IS THE CLIENT ID, NOT `true` (changed 2026-08-03). Until then the
     claim was self-asserted — the rule only checked `auth.uid == $uid`, so any
     authenticated user who knew a session code could claim membership of ANY
     room and then write there, or read its LLM chat. Proven on the emulator: a
     cross-room write was denied before the claim and allowed after it.

     Writing the clientId lets the rule verify what it previously took on trust:
     `clientMapping/<cid> == auth.uid` (you own this clientId, write-once) and
     `pool/<cid>/room == $roomId` (it is assigned to THIS room). The claim
     becomes checkable rather than asserted, while the deliberate self-assign
     join flow keeps working — a participant may still choose their room, they
     just cannot claim one they were not placed in.

     It has to be the VALUE because RTDB rules cannot iterate: there is no way to
     ask "does SOME clientId owned by me map to this room". Safe to repurpose —
     all 36 rule references test `.exists()` only, never the value.

     The transaction stays idempotent; on a transient failure those room writes
     are denied until it is re-claimed on the next room entry. */
  try {
    const auth = (typeof firebase !== "undefined" && firebase.auth) ? firebase.auth() : null;
    const uid = auth && auth.currentUser && auth.currentUser.uid;
    if (uid && clientId && typeof myRoom === "string" && myRoom) {
      /* SESSION-level and write-once, so a participant has exactly ONE room for
         the whole session. Binding the old per-room marker to pool/<cid>/room
         achieved nothing, because that path is participant-writable too (the
         self-assign flow): you could rewrite your own assignment and claim each
         room in turn, since the marker was write-once PER ROOM. Fixed here at
         session level — rewriting the pool afterwards changes nothing.
         The facilitator can still reassign; the rule's admin branch overwrites.
         `cid` travels in the value so the rule can tie the claim to a clientId
         you own (RTDB cannot iterate to find one for you). */
      /* The rejection is NOT caught by the surrounding try/catch, and a lost
         claim is not cosmetic: EVERY later room-scoped write (scoring,
         hypotheses, phase, votes, answers) is denied for the rest of the
         session. Silent failure there looks to the participant like the sim
         simply stopped responding, so distinguish the two cases and say so —
         same shape as the leaderboard's _onLbErr retry above.

         PERMISSION_DENIED is TERMINAL: with a write-once claim it means this
         uid already holds a different room, and retrying can never succeed.
         Anything else wrote nothing, so one retry is worth it. */
      const _claimRoomOf = (retry) => {
        db.ref(sPath("roomOf/" + uid))
          .transaction(cur => (cur == null ? { room: myRoom, cid: clientId } : undefined))
          .catch(e => {
            const code = String((e && (e.code || e.message)) || "");
            const denied = /permission[_ ]denied/i.test(code);
            console.warn("roomOf claim failed — per-room writes will be denied:", code);
            if (!denied && retry) { setTimeout(() => _claimRoomOf(false), 1200); return; }
            try {
              toast(tFallback("room.err.membership",
                "We could not confirm your place in this room. Your work may not " +
                "save — please reload, and tell your facilitator if it continues."));
            } catch (_) { /* toast not available pre-room */ }
          });
      };
      _claimRoomOf(true);
    }
  } catch (e) { /* LOCAL mode or auth not ready — chat falls back to stub */ }

  // Module A LLM-patient pilot (2026-05-28). Dormant unless the feature
  // flag is on AND the IIFEs in modA-llm-init.js exposed window.modALLMInit
  // (eager <script> tags in index.html). Failure here must NEVER block
  // room entry — wrapped in try/catch and the function returns false when
  // the flag is off, leaving the legacy click-button UI untouched.
  //
  // Bridge needs sessionNum / myRoom / db / viewStage on window, but
  // those are declared with `let` at script-top (line 868, 941, 1012,
  // 1056), so they live in the script's lexical scope and never reach
  // window. Re-export them here so modALLMInit can read them via
  // window.<name>. This is the single-line bridge between script.js's
  // module-style state and the LLM init's window-accessor pattern.
  window.myRoom = myRoom;
  window.sessionNum = sessionNum;
  window.db = db;
  // The chat lives in the top-level roomChat/ tree (out of the session
  // read-cascade — see roomChatPath), so the LLM init needs the resolver too.
  window.roomChatPath = roomChatPath;
  window.viewStage = viewStage;
  // SYNTH_ID / prereqsMet are re-exported for the chat bridge's red-flag
  // SCORING (it reveals legacy history items so prereqsMet/SYNTH_PREREQS stay
  // deterministic) and for the E2E hooks. NB (2026-06-02): the chat no longer
  // auto-reveals the synthesis — it's a deliberate gated section now, unlocked
  // by ≥1 working hypothesis (phaseGateOpen), not by prereqsMet.
  // revealed is mutable script-state; expose it via a getter so the LLM
  // init reads the live value, not a snapshot at startRoom() time.
  window.SYNTH_ID = SYNTH_ID;
  window.prereqsMet = prereqsMet;
  Object.defineProperty(window, "revealed", {
    get: function () { return revealed; },
    configurable: true
  });
  // The four pilot scripts are LAZY (split out of the eager splash bundle
  // 2026-06-01). Load them ONLY when the flag is on — non-pilot students never
  // fetch them; pilot users (?llm=1 / canamedModALLM) load the bundle on room
  // entry, then init. Async + caught: this must NEVER block room entry, and
  // when the flag is off nothing is fetched and the legacy click-button UI is
  // untouched. modALLMInit re-reads the window.* re-exports above (live).
  try {
    var _ld = window.CanamedLoader;
    if (_ld && typeof _ld.modALLMFlagOn === "function" && _ld.modALLMFlagOn() &&
        typeof _ld.ensureModALlm === "function") {
      _ld.ensureModALlm()
        .then(function () { if (typeof window.modALLMInit === "function") window.modALLMInit(); })
        .catch(function (e) { console.warn("[modA LLM] lazy-load failed:", e); });
    }
  } catch (e) {
    console.warn("[modA LLM] init failed:", e);
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
      // qrcode + case-content + the dashboard engine (script-admin.js), all in
      // PARALLEL — starting script-admin.js only after this settles would queue
      // ~26 KB behind ~200 KB (reclaim plan §5.5). loadScript de-dupes, so the
      // shim's own ensureAdminApp() joins this in-flight fetch; its failure is
      // swallowed here so the shim, not this generic catch, owns the message.
      const loader = window.CanamedLoader;
      const adminChunks = loader ? Promise.all([
        loader.ensureQrcode(),
        loader.ensureCaseContent(),
        (loader.ensureAdminApp ? loader.ensureAdminApp().catch(() => {}) : Promise.resolve())
      ]) : Promise.resolve();
      // R2-09: claim membership before installing read listeners, so the
      // narrowed session-level .read predicate is satisfied by the time
      // startAdmin() attaches .on("value") to the rooms / pool subtrees.
      return Promise.all([adminChunks, claimMembership("admin")]).then(() => {
        try { rebuildCaseDerived(); } catch (_) {}
        return _enterAdminAppLazy(restore);
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
        : refMarker;   // LOCAL mode (no rules): the hash stays at the session path
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
        // uid binds the reset flag to its initiator so only this client (the
        // one that supplied the recovery code) can write the hash during the
        // 30s window — closes the recovery-race (2026-05-30 R3 review).
        return refReset.set({ requestedAt: TS, by: myName, code: recoveryCode, uid: (currentUser && currentUser.uid) })
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
    // The dashboard chunk fetch runs ALONGSIDE that claim (§5.5: parallel,
    // never chained) — the claim is a DB round-trip, the chunk an HTTP one.
    const loader = window.CanamedLoader;
    return Promise.all([
      loader && loader.ensureAdminApp ? loader.ensureAdminApp().catch(() => {}) : Promise.resolve(),
      claimMembership("superadmin")
    ]).then(() => _enterAdminAppLazy());
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

/* The facilitator-dashboard ENGINE lives in the lazy script-admin.js (perf
   reclaim 2026-08-05 — slice 2 of ARCHITECTURE/eager-bundle-reclaim-plan.md).
   Both routes into the dashboard — joinAdmin (password login) and
   joinSuperAdmin (first password set, recovery reset, and the post-create
   hand-off from createSession) — used to end with the same
   `enterAdminApp(); startAdmin();` pair. That pair is now this ONE shim, so
   the chunk is loaded in exactly one place instead of two that drift.

   Failure mode is a real message, not a ReferenceError out of a promise: a
   404/offline chunk leaves the facilitator on the lobby with an explanation
   and `joined` reset so the button works again on retry. Without the reset
   they would be permanently wedged by joinAdmin's `if (joined) return;`. */
function _enterAdminAppLazy(restore) {
  const loader = window.CanamedLoader || {};
  const load = (typeof loader.ensureAdminApp === "function")
    ? loader.ensureAdminApp()
    // An older cached shell can serve a loader without this helper; treat it
    // exactly like a failed fetch rather than throwing a TypeError.
    : Promise.reject(new Error("CanamedLoader.ensureAdminApp is unavailable"));
  return load.then(function () {
    // The chunk resolved, but assert it actually defined the dashboard — a
    // truncated/HTML-error-page response can load "successfully".
    if (typeof enterAdminApp !== "function" || typeof startAdmin !== "function") {
      throw new Error("script-admin.js loaded but did not define the dashboard");
    }
    enterAdminApp(); startAdmin();
  }).catch(function (e) {
    console.error("[admin] dashboard chunk failed to load", e);
    joined = false;
    const msg = _adminChunkFailedMsg();
    const hint = el("admin-hint");
    if (hint) { hint.textContent = msg; hint.className = "lobby-hint err"; }
    try { toast(msg); } catch (_) {}
    if (typeof restore === "function") { try { restore(); } catch (_) {} }
  });
}
function _adminChunkFailedMsg() {
  return tFallback("lobby.admin-chunk-failed",
    "Couldn't load the facilitator dashboard — check your connection and try again.");
}
/* Shared failure path for the three eager references INTO script-admin.js
   (setRoomStage ×2 in initStageNav, backToDashboard in initLeave). A dead
   button with no explanation is the worst outcome in a live classroom. */
function _adminChunkMissing() {
  console.error("[admin] dashboard chunk is not loaded");
  try { toast(_adminChunkFailedMsg()); } catch (_) {}
}

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

/* ── S6 — reading a room SNAPSHOT's per-slot data ─────────────────────────────
 * The admin dashboard, the participation tally and the exports all read rooms
 * out of `allRooms` rather than through the live refs, so they need their own
 * address resolution. Routing every one of them through this helper is what
 * stops the next path move from silently zeroing a counter — which is exactly
 * what happened three times in this initiative (export hypotheses, export
 * answers, and the dashboard's "findings N/M", which read `data.moduleA.revealed`
 * and had been showing 0 for every room since S2b-2).
 *
 * ⚠️ TRANSITIONAL: answers may still live on the module-literal node for rooms
 * that ran before the migration, so both addresses are read. Drop the legacy
 * half once no live session predates it. */
const LEGACY_SLOT_KEY = { pbl: "moduleA", roleplay: "moduleB", branched: "moduleBranched" };
function roomSlotBuckets(data) {
  const d = data || {};
  const sections = d.sections || {};
  const answers = d.answers || {};
  return sectionSlots().map(sl => {
    const k = String(sl.position);
    const legacyKey = LEGACY_SLOT_KEY[sl.type];
    const state = sections[k] || (legacyKey ? (d[legacyKey] || {}) : {});
    const ans = (answers.sections || {})[k] || (legacyKey ? answers[legacyKey] : null) || {};
    return { slot: sl.position, type: sl.type, sectionId: sl.sectionId || null,
             revealed: state.revealed || {}, hypotheses: state.hypotheses || {},
             answers: ans };
  });
}
/* Every `answers` / `hypotheses` / `revealed` entry a room produced, flattened
   across its slots and tagged with the slot it came from. `key` is one of those
   three; each row keeps its child key (an entryId, or an ITEM id for reveals)
   for callers that need the identity (_caseItemById, the free-text CSV).
   roomSlotBuckets() fixed the ADDRESS; the counters and attributers still spelt
   it `data.answers.moduleA|moduleB`, read undefined, and reported a confident
   zero — the take-home, the debrief funnel, the impact KPIs and all three
   research CSVs were empty for every section-model session (2026-08-05). */
function roomEntries(data, key) {
  const out = [];
  roomSlotBuckets(data).forEach(b => {
    const m = b[key] || {};
    Object.keys(m).forEach(k => {
      if (m[k]) out.push({ slot: b.slot, type: b.type, sectionId: b.sectionId,
                           key: k, entry: m[k] });
    });
  });
  return out;
}

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
   notification. Title-bar (n) counter is unaffected (always shows so
   the count of waiting calls is always visible). Persisted to
   localStorage so a refresh / new tab keeps the preference. */
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
    /* moduleBranched included: LEGACY_SLOT_KEY maps a branched slot to it,
       and an uninitialised bucket threw and rejected the WHOLE export. */
    answers: { moduleA: [], moduleB: [], moduleBranched: [] },
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
      /* S6 — walk the session's SLOTS, not the two retired module keys: a
         participant's own answers must come back whatever slot they wrote them
         in, or a GDPR export silently under-reports their data. */
      roomSlotBuckets(r).forEach(b => {
        const mod = LEGACY_SLOT_KEY[b.type] || "moduleA";
        const ans = b.answers || {};
        Object.keys(ans).forEach(entryId => {
          if (ans[entryId] && ans[entryId].cid === clientId) {
            out.answers[mod].push(Object.assign(
              { room: roomName, slot: b.slot, sectionId: b.sectionId, entryId: entryId },
              ans[entryId]));
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
   same way the session-archive download does — when on, the JSON archive's
   session subtree is walked and every real participant name (in pool,
   answers.{}.by, score.manual.{}.by, calls.{}.by, etc.) is replaced
   with the deterministic Student-A / Student-B / ... codes used by
   scripts/pseudonymise-export.js. */
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
// De-dup (2026-06-01): the section stages used to repeat the whole flow here
// ("ask, examine, investigate — then debate…"), duplicating the localized,
// state-aware next-step coach that owns "what to do now" inside each module.
// They are blank so the coach is the single source. Only Welcome and Wrap-up
// keep a line — there is no coach on those two.
// S1b: keyed by ROLE, since a section can now sit at any stage number.
const STAGE_NOW_BY_ROLE = {
  welcome: "Watch the opening presentation together. While you wait, name your team below.",
  wrapup: "You're finished — open the questionnaire below. Thank you for taking part!"
};
function stageNow(st) {
  if (st === 0) return STAGE_NOW_BY_ROLE.welcome;
  if (st === lastStage()) return STAGE_NOW_BY_ROLE.wrapup;
  return "";
}
function renderStage() {
  /* S1a — show the VIEW the current stage resolves to, not the like-numbered
     node. Identical today (slot k sits at stage k); once slots are positional
     a roleplay picked first shows the roleplay view on stage 1. Every other
     view is hidden, including ones no slot uses. */
  /* S2b-1 — the pointer follows the stage: walking Back into an earlier PBL
     section must show THAT section's reveals, not the one most recently
     written. */
  if (typeof refreshActiveSlotState === "function") refreshActiveSlotState();
  const activeView = stageViewId(viewStage);
  allStageViewIds().forEach(id => {
    const s = el(id);
    if (s) s.classList.toggle("hidden", id !== activeView);
  });
  // the mobile bottom tab bar mirrors Module A (stage-1) and must appear /
  // disappear with the on-screen stage — refresh once the stages are toggled.
  if (typeof updateMobileTabbar === "function") updateMobileTabbar();
  // Scroll back to the top of the window whenever the VIEWED stage actually
  // changes — via Back/Next, or the room advancing under a caught-up student —
  // so a new stage always starts at the top instead of wherever the previous
  // stage was scrolled to (user request 2026-06-02). Guarded on an actual
  // change so re-renders that leave viewStage put (e.g. the room rolling
  // forward while a student is reviewing an earlier stage) never yank the page.
  if (viewStage !== _lastRenderedViewStage) {
    _lastRenderedViewStage = viewStage;
    try { window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" }); }
    catch (_) { try { window.scrollTo(0, 0); } catch (__) {} }
  }
  if (viewStage === lastStage()) renderWrapupSummary();
  // in-platform pre-test (Welcome) and post-test (Wrap-up) — both optional
  // and per-scenario. Render functions are no-ops when the scenario does
  // not ship a question bank or when the user is an admin viewing a room.
  if (viewStage === 0) renderPreTest();
  if (viewStage === lastStage()) renderPostTest();
  if (viewStage === lastStage()) renderSurvey();
  renderObjectives();   // the objectives panel tracks the module the room is on
  renderDecisions();    // the team-decision cards for Module A and Module B
  // per-stage "chapter" accent + the "do this now" line
  const rm = el("room-main");
  if (rm) rm.dataset.stage = String(viewStage);
  const now = el("stage-now");
  if (now) {
    now.textContent = isRoomAdmin
      ? ""
      : (viewStage < roomStage ? "" : stageNow(viewStage));
  }
  // De-dup (2026-06-01): the module name used to be appended here AND shown on
  // the current segment of the #global-stage-progress stepper below — the same
  // "Module A — …" string twice, stacked. The stepper now owns the visible name
  // (its current segment renders stageLabel() + carries it in aria-label /
  // aria-current); this line is just the compact position counter.
  // Count by POSITION in the active flow, not by raw stage index, so a branched
  // scenario (which skips stage 2) reads "Stage 2 of 3", not "Stage 2 of 4".
  const _flow = stageFlow();
  const _pos = _flow.indexOf(viewStage);
  el("stage-indicator").textContent =
    "Stage " + ((_pos === -1 ? viewStage : _pos) + 1) + " of " + _flow.length;
  // Global "you are here" stepper — a compact visual map of the whole session
  // arc so the Module A LOCAL phase-stepper reads as sub-progress, not session
  // position (UX-overload fix 2026-06-01). Built with createElement +
  // textContent (never innerHTML) because stageLabel() can return a
  // facilitator-authored scenario name. Marks the viewed stage (is-current),
  // completed stages (is-done) and — when the student pressed Back to re-read
  // an earlier stage — the room's live furthest-open stage (is-live).
  const gsp = el("global-stage-progress");
  if (gsp) {
    gsp.textContent = "";
    // Iterate the active stage flow (branched skips stage 2) and number by
    // POSITION so the segments read 1·2·3 with no gap.
    stageFlow().forEach((i, pos) => {
      const li = document.createElement("li");
      li.className = "gsp-step" +
        (i < viewStage ? " is-done" : "") +
        (i === viewStage ? " is-current" : "") +
        (i === roomStage && i !== viewStage ? " is-live" : "");
      const label = stageLabel(i);
      li.setAttribute("aria-label", label);
      if (i === viewStage) li.setAttribute("aria-current", "step");
      const num = document.createElement("span");
      num.className = "gsp-num";
      num.setAttribute("aria-hidden", "true");
      num.textContent = String(pos + 1);
      li.appendChild(num);
      const name = document.createElement("span");
      name.className = "gsp-name";
      name.textContent = label;
      li.appendChild(name);
      gsp.appendChild(li);
    });
  }
  // The leaderboard is never auto-opened (user request 2026-06-02): it stays
  // closed on every stage — including Wrap-up — and opens ONLY when the student
  // clicks its disclosure triangle. (It used to force-open at Wrap-up, which
  // read as the page "opening it by itself" when navigating between stages.)
  // a celebration when the room reaches the wrap-up (once)
  if (!wrapCelebrated && roomStage === lastStage() && viewStage === lastStage()) {
    wrapCelebrated = true;
    burst();
    toast("Great work today — thank you for taking part!");
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
    /* Map of stage-bound tour sets → the stage they belong on. S1b: the Module
       A tour is bound to the FIRST PBL section wherever it landed, not to
       stage 1 — a session that opens with a roleplay would otherwise dismiss
       the tour the moment it started. */
    const firstPbl = sectionSlots().find(s => s.type === "pbl");
    const TOUR_STAGE = { student: 0, studentModA: firstPbl ? firstPbl.stage : -1 };
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
    // Flow-aware: at the first/last stage OF THE ACTIVE FLOW there is nowhere
    // to step, and a branched room must not be offered the skipped stage 2.
    el("prev-btn").disabled = adjacentStage(roomStage, -1) === roomStage;
    el("next-btn").disabled = adjacentStage(roomStage, 1) === roomStage;
    wait.textContent = "Admin view of " + myRoom +
      " - Back / Advance move the whole room's stage.";
  } else {
    el("prev-btn").textContent = "← Review previous stage";
    el("next-btn").textContent = "Go to next stage →";
    el("prev-btn").classList.remove("hidden");
    el("prev-btn").disabled = adjacentStage(viewStage, -1) === viewStage;
    // Students never move the room forward - only show Next to return after Back.
    el("next-btn").classList.toggle("hidden", viewStage >= roomStage);
    if (viewStage < roomStage) {
      wait.textContent = "You are looking back at an earlier stage. " +
        "Press \"Go to next stage\" to move forward again.";
    } else if (adjacentStage(roomStage, 1) !== roomStage) {
      wait.textContent = "Waiting for a facilitator to open the next stage.";
    } else {
      wait.textContent = "This is the last stage - you are all caught up. " +
        "Thank you for taking part!";
    }
  }
}
/* setRoomStage lives in the lazy script-admin.js (2026-08-05 reclaim). These
   two handlers are the only EAGER references to it, and both sit behind
   `if (isRoomAdmin)` — a flag only openRoomAsAdmin() sets, and that function is
   itself in the chunk — so in practice the guard can never fail. It is written
   anyway because "advance the stage" is the one control a live classroom cannot
   lose silently: a missing chunk must say so, not throw out of a click handler.
   `typeof` is safe here — an unloaded classic script's function declaration is
   simply undeclared, not in a TDZ. */
function initStageNav() {
  el("prev-btn").addEventListener("click", () => {
    // Admin steps through the active flow too: raw roomStage-1 could target the
    // skipped stage 2, which snapStageToFlow then rolls FORWARD again — making
    // "back" a silent no-op in a branched session.
    if (isRoomAdmin) {
      if (typeof setRoomStage !== "function") return _adminChunkMissing();
      setRoomStage(myRoom, roomStage, adjacentStage(roomStage, -1));
    }
    else { viewStage = adjacentStage(viewStage, -1); renderStage(); }
  });
  el("next-btn").addEventListener("click", () => {
    if (isRoomAdmin) {
      if (typeof setRoomStage !== "function") return _adminChunkMissing();
      setRoomStage(myRoom, roomStage, adjacentStage(roomStage, 1));
    }
    else { viewStage = Math.min(roomStage, adjacentStage(viewStage, +1)); renderStage(); }
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

/* ── Contextual "call a facilitator to advance" buttons (2026-06-02) ──────────
 * When a room finishes Module A's four group-answer bullets (or Module B's
 * three), a button appears in the Group-answers card that pings the facilitator
 * with a phase-specific reason ("ready to move to Module B" / "ready for the
 * final section"). It reuses the existing callForHelp channel + the same 30s
 * throttle as #call-prof-btn, so the facilitator dashboard surfaces it exactly
 * like any other help call (the reason rides in callForHelp.msg, ≤200 chars). */
function _callFacilitatorToAdvance(msgKey, fallbackMsg) {
  if (!refCallForHelp || isRoomAdmin) return false;
  const now = Date.now();
  if (now < lastHelpCallAt + HELP_CALL_THROTTLE_MS) {
    const wait = Math.ceil((lastHelpCallAt + HELP_CALL_THROTTLE_MS - now) / 1000);
    const msg = tFallback("room.call.throttle-again",
      "Please wait {seconds}s before calling a facilitator again.").replace("{seconds}", wait);
    alert(msg);
    return false;
  }
  lastHelpCallAt = now;
  const reason = tFallback(msgKey, fallbackMsg).slice(0, 200);
  refCallForHelp.set({ by: myName, at: now, msg: reason })
    .catch(e => console.error("advance call failed", e));
  logEvent(myRoom, "help", { msg: reason });
  if (typeof toast === "function") {
    toast(tFallback("room.call.sent", "Facilitator called ✓"), reason, "gain");
  }
  return true;
}

/* Wire one of the advance buttons once; clicking pings the facilitator and
 * flips the button into a "called" confirmation state. Idempotent. */
function _wireAdvanceCallBtn(btnId, msgKey, fallbackMsg) {
  const btn = el(btnId);
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => {
    if (_callFacilitatorToAdvance(msgKey, fallbackMsg)) {
      btn.classList.add("called");
      btn.textContent = tFallback("room.call.sent", "Facilitator called ✓");
    }
  });
}

/* Show/hide a Group-answers completion CTA. Also (re)wires its button so it
 * works even if the card was rendered after initCallProf ran. */
function _updateAnswersCompleteCta(boxId, btnId, complete, msgKey, fallbackMsg) {
  _wireAdvanceCallBtn(btnId, msgKey, fallbackMsg);
  const box = el(boxId);
  if (box) box.classList.toggle("hidden", !complete);
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

/* Build the display-only clinical-category clusters for a History/Examination
   section. Returns [{ key, label, indices:[origIdx,…] }, …] in first-appearance
   (original-index) order, or null when NO item in the section carries a `group`
   (custom scenarios without categories → caller uses the flat / overflow
   fallback). `label` is the translatable {en,fr,ja} (or plain string); clusters
   are keyed by the canonical EN value so the grouping is stable across language
   switches (when buildButtons re-runs on canamed:langchange). Indices are the
   ORIGINAL array positions, so the reveal IDs (group:index) never move. */
function _categoryClusters(group) {
  const items = (typeof CASE !== "undefined" && CASE && CASE[group]) || [];
  const order = [];
  const byKey = {};
  let any = false;
  for (let i = 0; i < items.length; i++) {
    const g = items[i] && items[i].group;
    if (!g) continue;
    any = true;
    const key = (typeof g === "string") ? g : (g.en || JSON.stringify(g));
    if (!byKey[key]) { byKey[key] = { key: key, label: g, indices: [] }; order.push(key); }
    byKey[key].indices.push(i);
  }
  return any ? order.map(k => byKey[k]) : null;
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

    // Investigations only (2026-06-02): the imaging/bloods (labs:1+) render
    // flat into #group-labs (the free "Investigations" section). The single
    // clinical SYNTHESIS item (SYNTH_ID, labs:0) is NO LONGER rendered as a
    // button — its model write-up now ships only in the stage-4 take-home
    // export (downloadMyRoomAnswers). IDs are positional, so skipping the
    // render keeps labs:1+ / SYNTH_PREREQS / PENALTIES valid.
    if (group === "labs") {
      order.forEach(i => {
        const id = group + ":" + i;
        if (id === SYNTH_ID) return;
        container.appendChild(_makeReqBtn(group, i));
      });
      return;
    }

    // History & Examination: cluster the reveal buttons by their display-only
    // clinical `group` category (2026-05-26 dry-run — the ~13-button History
    // wall reads better as a few labelled clinical clusters). Purely a render
    // grouping: item indices/IDs are untouched, so SYNTH_PREREQS and PENALTIES
    // stay valid. Categories appear in clinical (first-appearance) order;
    // buttons WITHIN a category keep the per-room shuffle, so students still
    // can't learn "the Nth button is the answer". Deliberately-wrong moves are
    // interspersed into the relevant clinical category (not a tell-tale bucket).
    const clusters = _categoryClusters(group);
    if (clusters) {
      const _t = (key, fb) => {
        if (typeof window !== "undefined" && typeof window.t === "function") {
          const v = window.t(key);
          if (v && v !== key) return v;
        }
        return fb;
      };
      const placed = {};
      clusters.forEach((cluster, ci) => {
        // Each clinical category is a collapsible <details> (summary = the
        // category label) so students can close categories they're done with
        // and the section isn't a wall of buttons + revealed answers all at
        // once (dry-run 2026-05-27). The first category of each section starts
        // open as an entry point; the rest collapse. Re-rendering (room change
        // / langchange) resets to this default, which is fine — it's a fresh
        // build, not a state we need to persist.
        const sub = document.createElement("details");
        sub.className = "req-category";
        if (ci === 0) sub.open = true;
        const label = (typeof tc === "function") ? tc(cluster.label, _curLang())
                                                 : (cluster.label.en || cluster.key);
        const heading = document.createElement("summary");
        heading.className = "req-category-label";
        heading.textContent = label;
        sub.appendChild(heading);
        // Buttons live in an inner wrapper that carries the group semantics
        // (role/aria-label) — the <details> itself owns the disclosure role.
        const items = document.createElement("div");
        items.className = "req-category-items";
        items.setAttribute("role", "group");
        items.setAttribute("aria-label", label);
        order.forEach(i => {
          if (cluster.indices.indexOf(i) !== -1) {
            items.appendChild(_makeReqBtn(group, i));
            placed[i] = true;
          }
        });
        sub.appendChild(items);
        container.appendChild(sub);
      });
      // Safety net: never drop an item that lacks a category (e.g. a partially
      // categorised custom scenario) — render any leftovers, in shuffle order.
      const leftover = order.filter(i => !placed[i]);
      if (leftover.length) {
        const extra = document.createElement("div");
        extra.className = "req-category req-category-other";
        extra.setAttribute("role", "group");
        leftover.forEach(i => extra.appendChild(_makeReqBtn(group, i)));
        container.appendChild(extra);
      }
      return;
    }

    // Dense History group → sub-cluster the overflow into a collapsed,
    // labelled <details> so the at-once count drops without removing
    // any option (round4-a11y Rec 4). Fallback for category-less scenarios
    // (custom JSON authored without `group` fields).
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
      mark.innerHTML = icMarkup("book");
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
      _wireGlossMarker(btn, mark, glossText);
    }
  }
}

/* ── Tap/keyboard-reachable glossary (2026-06-01) ──────────────────────────
   The book-icon .glossary-marker lives INSIDE the reveal <button>, so it must NOT be
   an interactive element (a focusable/button descendant of a <button> is
   invalid HTML and browsers flatten it). Instead the marker stays a plain
   <span> and we:
     • TAP (touch/mouse): a click handler opens the gloss popover and
       stopPropagation()s so the parent reveal button does NOT fire.
     • KEYBOARD: a keyboard user can't focus the marker without nesting
       interactive content, so we surface the gloss when the BUTTON itself
       gets KEYBOARD focus (:focus-visible) and hide it on blur. SR users
       already get the gloss via the button's aria-description; this is the
       sighted-keyboard equivalent (WCAG 1.4.13).
   The popover is a single body-level node (outside the button) — purely
   visual + aria-hidden, since aria-description carries it to SR. */
let _glossPopEl = null;
function _glossPop() {
  if (_glossPopEl) return _glossPopEl;
  const p = document.createElement("div");
  p.className = "gloss-pop";
  p.setAttribute("aria-hidden", "true");
  p.hidden = true;
  (document.body || document.documentElement).appendChild(p);
  // dismiss affordances (WCAG 1.4.13)
  document.addEventListener("keydown", e => { if (e.key === "Escape") _hideGloss(); });
  document.addEventListener("pointerdown", e => {
    if (!_glossPopEl || _glossPopEl.hidden) return;
    const t = e.target;
    const onMarker = t && t.classList && t.classList.contains("glossary-marker");
    if (t !== _glossPopEl && !onMarker) _hideGloss();
  }, true);
  window.addEventListener("scroll", _hideGloss, true);
  window.addEventListener("resize", _hideGloss);
  _glossPopEl = p;
  return p;
}
function _hideGloss() {
  if (_glossPopEl) { _glossPopEl.hidden = true; _glossPopEl._anchor = null; }
}
function _showGloss(anchor, text) {
  if (!anchor) return;
  const p = _glossPop();
  p.textContent = text;
  p.hidden = false;
  p._anchor = anchor;
  const r = anchor.getBoundingClientRect();
  const pw = Math.min(p.offsetWidth || 280, window.innerWidth - 12);
  const left = Math.min(Math.max(6, r.left), Math.max(6, window.innerWidth - pw - 6));
  let top = r.bottom + 6;
  if (top + p.offsetHeight > window.innerHeight - 6) {
    top = Math.max(6, r.top - p.offsetHeight - 6);   // flip above if it'd overflow
  }
  p.style.left = left + "px";
  p.style.top = top + "px";
}
function _wireGlossMarker(btn, mark, glossText) {
  mark.addEventListener("click", e => {
    e.stopPropagation();   // do NOT trigger the reveal button
    e.preventDefault();
    if (_glossPopEl && !_glossPopEl.hidden && _glossPopEl._anchor === mark) _hideGloss();
    else _showGloss(mark, glossText);
  });
  btn.addEventListener("focus", () => {
    // keyboard focus only (mouse-clicking the reveal must not flash the gloss)
    if (btn.matches && btn.matches(":focus-visible")) _showGloss(mark, glossText);
  });
  btn.addEventListener("blur", _hideGloss);
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
  // Dry-run change (2026-05-26): investigations (imaging + bloods) are NO
  // LONGER hard-locked behind "add a working hypothesis first". Ordering a
  // test is a real clinical choice the team can get wrong — every imaging /
  // bloods item carries a penalty (pen_mri / pen_xray / pen_bloods / pen_ct),
  // so a premature or un-indicated order costs points instead of being blocked.
  // Nothing in the chart is hard-locked any more: the old clinical-synthesis
  // button (SYNTH_ID, labs:0) was removed 2026-06-02, so there is no gated item
  // here. Hypotheses remain pedagogically encouraged (the coach nudges them) and
  // ≥1 of them opens the Debate (phaseGateOpen), but they don't gate this panel.
  document.querySelectorAll(".req-btn").forEach(btn => {
    const id = btn.dataset.id;
    btn.classList.toggle("done", !!revealed[id]);
    // Inappropriate choice (an exam/investigation this case does not need):
    // colour the revealed item RED instead of the normal green ✓, so students
    // see at a glance that the move cost points (user request 2026-06-02). The
    // penalty itself is still applied by the scoring engine (pen_mri / pen_dre /
    // …). Only meaningful once revealed, so gate on revealed[id].
    btn.classList.toggle("wrong-choice", !!revealed[id] && PENALTY_ITEM_IDS.has(id));
    // Investigations (imaging/bloods) are now FREELY clickable, like the
    // Examination (2026-06-02): no "screen the red flags first" warn cue. A
    // premature / un-indicated order still costs points via the scoring engine
    // (pen_mri / pen_xray / …), but the UI no longer nags. Clear any stale warn
    // node left by an older render.
    const isImaging = id && id.indexOf("labs:") === 0 && id !== SYNTH_ID;
    if (isImaging) {
      btn.classList.remove("warn");
      btn.removeAttribute("aria-describedby");
      let staleNote = btn.nextElementSibling;
      while (staleNote && staleNote.classList.contains("req-inline-reveal")) {
        staleNote = staleNote.nextElementSibling;
      }
      if (staleNote && staleNote.classList.contains("req-warn-note")) staleNote.remove();
      if (!revealed[id]) btn.title = "";
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
      // Tint the inline answer red too when this was an inappropriate choice.
      inline.classList.toggle("wrong", PENALTY_ITEM_IDS.has(id));
      const item = itemById(id);
      const meta = revealed[id];
      if (item) {
        const lang = (typeof _curLang === "function") ? _curLang() : "en";
        // Rebuild as two children so we can style the author byline
        // (italic + muted) separately from the answer body. Each child
        // is set via textContent — case content is author-controlled
        // but we keep the no-eval-by-default discipline.
        inline.textContent = "";
        // Inline reveal: the question's answer text, shown under its button.
        // (The old SYNTH_ID aParts "segmented synthesis" branch was removed
        // 2026-06-02 with the on-screen synthesis section — SYNTH_ID is no
        // longer rendered as a button.)
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
  // NB (2026-06-02): the chart sections used to auto-collapse once ~4 items in
  // them were revealed (sim 2026-05-19 feature). That backfired — revealing an
  // item closed the section the student was actively clicking in, forcing a
  // reopen on every further click (user report). The auto-collapse was removed;
  // students now open/close sections themselves and a click never closes them.
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

/* The chart sections (Ask the patient / Examination / Investigations) no longer
 * auto-collapse on reveal (removed 2026-06-02). Revealing an item used to close
 * the section the student was clicking in once ~4 items were revealed, which
 * forced an annoying reopen on every further click. Students now control the
 * open/closed state themselves; a reveal never collapses a section. */
/* renderFindings was the renderer for the "What we're finding" tab
 * (a chronological log of all revealed items). That tab was removed
 * 2026-05-18 — the inline-reveal chips under each chart button now
 * carry the same information at the point of action, no scrolling.
 *
 * The function is retained for two side effects that still matter:
 *   1. It triggers the coach (updateModANextStep) updates that fire
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

/* Module A phase gate (2026-06-02; threshold lowered to 1 on 2026-06-25 per user
 * request). The team works the case up FREELY (history chat + examination +
 * investigations), then commits ≥1 working hypothesis — THAT is the gate that
 * unlocks the Debate (discussion prompts). Replaces the old "synthesis revealed"
 * / red-flag-screen gate for progression; the on-screen Clinical synthesis
 * section was removed 2026-06-02 (its write-up moved to the stage-4 take-home).
 * (The red-flag screen still drives scoring.) */
function phaseGateOpen() {
  return (typeof hypothesisCount === "function") && hypothesisCount() >= 1;
}

/* Test hooks — top-level `let` bindings (revealed, ITEM_IDS, CASE) are
 * script-scoped and can't be reached via `window.X = ...` assignments from E2E
 * tests. These small setters mutate the bindings directly so Playwright tests
 * can drive renderButtons / renderFindings with deterministic state without
 * needing the full Firebase round-trip. Production code never calls these;
 * they're inert outside test runs. */
if (typeof window !== "undefined") {
  window._test_setRevealed = function (obj) { revealed = obj || {}; };
  window._test_getItemIds = function () { return ITEM_IDS.slice(); };
  window._test_getCase = function () { return CASE; };
  window._test_rebuildCaseDerived = function () { rebuildCaseDerived(); };
  // Sim 2026-05-19 follow-ups — hooks for the per-feature E2E tests
  // under tests-e2e/sim-recommendations.spec.js. Production code never
  // calls these; they're inert outside test runs.
  window._test_setClientId      = function (c) { clientId = String(c || ""); };
  /* The pre/post knowledge-check cards hide themselves outside a room
     (`!myRoom` ⇒ hidden), so asserting what a student actually READS in them
     needs this binding set. */
  window._test_setMyRoom        = function (r) { myRoom = String(r || ""); };
  window._test_setSessionNum    = function (n) { sessionNum = String(n || ""); };
  window._test_setRoomCount     = function (n) { roomCount = parseInt(n, 10) || 1; };
  window._test_setAllRooms      = function (m) { allRooms = m || {}; };
  window._test_setAnswerReplies = function (m) { answerReplies = m || {}; };
  window._test_setRoomVotes     = function (m) { roomVotes = m || {}; };
  window._test_setHypotheses    = function (m) { hypotheses = m || {}; };
  // Set the group-answers map (per module) so E2E can drive the
  // all-bullets-covered completion CTAs without a Firebase round-trip.
  window._test_setAnswers       = function (m) {
    answers = { moduleA: (m && m.moduleA) || {}, moduleB: (m && m.moduleB) || {} };
  };
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
  // Pure gate for the combined post-test → questionnaire flow (E2E-asserted).
  window._surveyReadyAfterPostTest = _surveyReadyAfterPostTest;
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
  renderButtons(); renderFindings(); renderContrib();
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
  // SYNTH_ID is no longer revealable (the synthesis button was removed
  // 2026-06-02); the "reached the synthesis / Exchange opens" milestone now
  // keys off the real phase gate — ≥1 committed working hypothesis.
  const reachedSynthesis = (typeof phaseGateOpen === "function") && phaseGateOpen();
  // SYNTH_PREREQS.length>0 guard: `[].every()` is vacuously TRUE, so a scenario
  // with no clinical workup (e.g. a branched scenario, SYNTH_PREREQS = []) would
  // otherwise auto-award this 25-pt milestone the instant the session starts —
  // the leaderboard opened at 25 with nothing done. Branched cases score only
  // through their decisions, never the Module-A workup milestones.
  if (SYNTH_PREREQS.length > 0 && prereqsDone && !imaging) setWant("redFlagFirst");  // ORDER: screen before scan
  if (reachedSynthesis) setWant("synthesis");
  if (reachedSynthesis && !imaging) setWant("restraint");

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
  const quiet = (moduleAtStage(roomStage) === "B") || metas.every(m => m.module === "B");
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
  const mod = moduleAtStage(viewStage) || "A";
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
    // Module A LLM-patient pilot (2026-05-28): also surface the chat-based
    // scoring families (red-flag screen, cauda equina, yellow flags, opioid
    // handling, etc.). The bridge writes the matching `chatA_<famId>` row
    // to score/auto when the family fires, so `done` flips automatically
    // from the existing `earned[ev]` check below.
    if (mod === "A") {
      (SCORING.moduleA_questions || []).forEach(f =>
        rows.push({ ev: "chatA_" + f.id, points: f.points, label: tc(f.label, lang) }));
    }
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
      // option may be a number (exact), an array (any listed) or absent (any).
      let needOpt = null;
      if (spec && typeof spec === "object") {
        if (typeof spec.option === "number") needOpt = spec.option;
        else if (Array.isArray(spec.option)) needOpt = spec.option;
      }
      const dv = (typeof roomVotes !== "undefined" && depId) ? roomVotes[depId] : null;
      const committedChoice = (dv && dv.committed && typeof dv.committed.choice === "number")
        ? dv.committed.choice : null;
      const matches = (needOpt == null)
        ? true
        : (Array.isArray(needOpt) ? needOpt.indexOf(committedChoice) !== -1 : committedChoice === needOpt);
      const ok = (committedChoice != null) && matches;
      if (!ok) unmet.push({ key: "afterDecision", depId: depId, needOption: needOpt });
      return;
    }
    const need = w[key] || 0;
    if ((have[key] || 0) < need) unmet.push({ key: key, need: need, have: have[key] || 0 });
  });
  return { unlocked: unmet.length === 0, unmet: unmet };
}

/* True when the active case has at least one Module A "decide together" vote
 * that is unlocked (votable now) but the team has not yet committed. Used to
 * route the team back to the Decisions tab when they finish the discussion
 * prompts, so an open vote is never silently skipped. Cases whose Module A
 * carries no vote (e.g. breaking-bad-news, where the votes live in Module B)
 * return false and the team flows straight on to Group answers. */
function hasOpenUncommittedModuleAVote() {
  const list = (typeof DECISIONS !== "undefined" ? DECISIONS : [])
    .filter(d => d && d.module === "A");
  if (!list.length) return false;
  return list.some(d => {
    const gate = (typeof decisionUnlocked === "function")
      ? decisionUnlocked(d) : { unlocked: true };
    if (!gate.unlocked) return false;
    const v = (typeof roomVotes !== "undefined" && roomVotes[d.id]) || {};
    const committed = v.committed && typeof v.committed.choice === "number";
    return !committed;
  });
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
        return t("modA.decision.unlock.synthesis", "write a working hypothesis");
      default:
        return u.key;
    }
  });
  return parts.join(" · ");
}

/* Track which Module A decisions were previously unlocked so we can
 * fire a coach-card "🗳️ A new decision opened" nudge on transitions. */
let lastUnlockedDecisionIds = new Set();


/* ── Live-vote a11y (2026-06-01) ───────────────────────────────────────────
   renderDecisions() rebuilds #decisions-A / -B via innerHTML on EVERY ballot
   or presence change (room-wide), which (a) drops keyboard focus to <body>
   whenever a teammate votes while you're navigating the options, and (b) gives
   screen-reader users no signal that the tally moved or the team locked in.
   These helpers preserve focus across the rebuild (vote buttons carry stable
   data-dec/data-opt; the lock button data-dec-lock) and feed a persistent,
   visually-hidden polite live region per module. */
const _decLiveLast = {};
function _captureDecisionFocus() {
  const ae = document.activeElement;
  if (!ae || typeof ae.closest !== "function") return null;
  if (!ae.closest("#decisions-A, #decisions-B")) return null;
  if (ae.dataset && ae.dataset.decLock != null) return { lock: ae.dataset.decLock };
  if (ae.dataset && ae.dataset.dec != null && ae.dataset.opt != null) {
    return { dec: ae.dataset.dec, opt: ae.dataset.opt };
  }
  return null;
}
function _restoreDecisionFocus(key) {
  if (!key) return;
  const sel = key.lock != null
    ? '.dec-lock[data-dec-lock="' + key.lock + '"]'
    : '.dec-opt[data-dec="' + key.dec + '"][data-opt="' + key.opt + '"]';
  const node = document.querySelector(sel);
  // A just-committed decision disables/removes its controls — focus then
  // simply falls back to <body>, same as before; no worse than today.
  if (node && !node.disabled && typeof node.focus === "function") {
    try { node.focus({ preventScroll: true }); } catch (_) { node.focus(); }
  }
}
/* Preserve the in-card reasoning textareas across renderDecisions' rebuild. The
 * logic is in the LAZY branched-render.js; these wrappers delegate / no-op. */
function _captureRationaleInputs() {
  const br = window.CanamedBranchedRender;
  return (br && br.captureRationaleInputs) ? br.captureRationaleInputs() : null;
}
function _restoreRationaleInputs(state) {
  const br = window.CanamedBranchedRender;
  if (br && br.restoreRationaleInputs) br.restoreRationaleInputs(state);
}
/* Persistent polite live region per module, updated only on CHANGE. The first
   population per region lifetime is SEEDED silently (region left empty) so a
   page load / room entry never announces the initial tally — only subsequent
   ballot/lock changes are spoken. */
function _announceDecisions(mod, text) {
  const box = el("decisions-" + mod);
  if (!box || !box.parentNode) return;
  let live = document.getElementById("dec-live-" + mod);
  if (!live) {
    live = document.createElement("div");
    live.id = "dec-live-" + mod;
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    box.parentNode.insertBefore(live, box);
    _decLiveLast[mod] = text;   // seed without announcing
    return;
  }
  if (text !== _decLiveLast[mod]) {
    _decLiveLast[mod] = text;
    live.textContent = text;
  }
}

function renderDecisions() {
  // Preserve keyboard focus + collect the per-module SR tally across the full
  // innerHTML rebuild below (see the _decLive* helpers above). Also snapshot the
  // branched in-card reasoning textareas so a rebuild never wipes typed text.
  const _focusKey = _captureDecisionFocus();
  const _ratState = _captureRationaleInputs();
  // M4c: keyed per rendered module (A, B, and — in a composed session — branched).
  const srLines = {};
  // Combined across modules: which decisions are unlocked right now. Chained
  // branches live in Module B (a committed decision unlocks a follow-up), so
  // the unlock-transition nudge must span both modules — a single tracker
  // keeps A and B from clobbering each other's "newly opened" state.
  const allUnlockedNow = new Set();
  /* M4c: render every module that has a decisions container, not a hardcoded
     ["A","B"]. MODULE_REGISTRY is the source of truth, so a composed branched
     module renders into #decisions-branched on its own stage with no new engine.
     Registry order = stage order, so the SR tallies stay deterministic. */
  MODULE_REGISTRY.map(m => m.id).forEach(mod => {
    const box = el("decisions-" + mod);
    if (!box) return;
    srLines[mod] = srLines[mod] || [];
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
    h.textContent = " Team decisions — vote together";
    h.prepend(icNode("ballot"));
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
        box.appendChild(buildDecision(d, srLines[mod]));
      } else if (d.hideWhenLocked) {
        // Chained-branch follow-ups stay invisible until they open, so the
        // continuation lands as a surprise fork rather than a spoiler teaser.
        // The unlock nudge below announces it the moment it opens.
      } else {
        box.appendChild(buildLockedDecision(d, gate.unmet));
      }
    });
    // "Disappear when filled" (user request 2026-06-02, Module B): once the team
    // has committed EVERY decision, hide the whole card so the discussion phase
    // declutters. The votes still live in RTDB (wrap-up + export read them); only
    // the on-screen card is hidden. Module A keeps its decisions tab as-is.
    if (mod === "B") {
      const allCommitted = list.every(d => {
        const v = roomVotes[d.id] || {};
        return v.committed && typeof v.committed.choice === "number";
      });
      box.classList.toggle("decisions-locked", allCommitted);
    }
    // Announce the module's running tally / lock-in state to SR users.
    _announceDecisions(mod, srLines[mod].join(" · "));
  });
  // Put keyboard focus back on the control the user was on before the rebuild,
  // and restore any in-progress reasoning text (value + caret).
  _restoreRationaleInputs(_ratState);
  _restoreDecisionFocus(_focusKey);
  // Coach nudge on unlock transitions (locked → unlocked), across both modules.
  // Surfaces a one-liner via toast() so the team sees a new decision opened
  // without auto-stealing focus. Skipped on the initial paint (empty tracker).
  allUnlockedNow.forEach(id => {
    if (lastUnlockedDecisionIds.has(id) || lastUnlockedDecisionIds.size === 0) return;
    const d = (typeof DECISIONS !== "undefined" ? DECISIONS : []).find(x => x.id === id);
    if (!d) return;
    const lang = _curLang();
    if (typeof toast === "function") {
      toast((typeof window.t === "function" ?
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
        box.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
      }
    } catch (_) { /* scrollIntoView unsupported / detached — non-fatal */ }
  });
  lastUnlockedDecisionIds = allUnlockedNow;

  // Keep the progressive tab reveal in sync with decision-unlock transitions
  // (the Decide-together tab appears when the plan decisions become live).
  if (typeof revealModARightCol === "function") revealModARightCol();
  // Branched OSCE: once the tree is finished, surface the team's final-diagnosis
  // deliverable. (The "before you vote" reasoning capture is now built INSIDE
  // each decision card by buildDecision, so it needs no separate render here.)
  renderBranchedFinal();
}

/* Branched OSCE final deliverable — the done-detection + the render live in the
 * LAZY branched-render.js (window.CanamedBranchedRender.renderBranchedFinal) to
 * stay off the eager splash bundle. This thin wrapper, called from
 * renderDecisions + the answers listener, delegates once the module has loaded
 * and no-ops before that (the form just appears on the next render). */
function renderBranchedFinal() {
  const br = window.CanamedBranchedRender;
  if (br && br.renderBranchedFinal) br.renderBranchedFinal();
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
  lock.innerHTML = icMarkup("lock");
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
/* The branched DOCUMENTS renderer (buildDecisionDocs + _safeScenarioImage)
 * lives in the LAZY branched-render.js (window.CanamedBranchedRender) — it is
 * room-only code kept off the splash eager bundle (perf). buildDecision below
 * calls it when present and degrades gracefully (no documents) until it loads;
 * script-loader's ensureCaseContent() chain loads it before any room render. */
function buildDecision(d, srSink) {
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

  // Branched-format DOCUMENTS — a node may carry `documents:[{title,text,image}]`
  // (vitals, labs, ECG/CXR/CT) shown WITH the decision. Rendered by the lazy
  // branched-render.js; degrade gracefully (no docs) until it has loaded.
  const _br = window.CanamedBranchedRender;
  const docs = (_br && _br.buildDecisionDocs) ? _br.buildDecisionDocs(d, lang) : null;
  if (docs) wrap.appendChild(docs);

  const opts = document.createElement("div");
  opts.className = "dec-options";
  d.options.forEach((opt, i) => {
    const n = tally[i].length;
    const pct = totalBallots ? Math.round((n / totalBallots) * 100) : 0;
    const btn = document.createElement("button");
    btn.type = "button";
    // stable identity so renderDecisions() can restore keyboard focus to the
    // same option after the room-wide innerHTML rebuild
    btn.dataset.dec = d.id;
    btn.dataset.opt = String(i);
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
    lock.dataset.decLock = d.id;   // stable identity for focus restore
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
  // Branched: the "before you vote" reasoning capture at the BOTTOM of the card
  // (input while open; just the recorded reasoning once committed). Lazy module.
  if ((window.CURRENT_SCENARIO_FORMAT || "standard") === "branched" &&
      _br && _br.buildBranchedRationale) {
    const rat = _br.buildBranchedRationale(d, lang, committed != null);
    if (rat) wrap.appendChild(rat);
  }
  // Feed the per-module SR live region (reuses the same English tally strings
  // the visible card shows — the vote component is English-only by design).
  if (srSink) {
    const _lbl = tc(d.prompt, lang).split(/\s+/).slice(0, 6).join(" ");
    if (committed != null) {
      const _cOpt = d.options[committed] || {};
      srSink.push(_lbl + ": locked in — " +
        (_cOpt.correct ? "the safest answer" : "not the safest answer"));
    } else {
      const _present = votablePresentCount();
      srSink.push(_lbl + ": " +
        (_present ? totalBallots + " of " + _present + " voted" : totalBallots + " voted"));
    }
  }
  return wrap;
}

/* Per-room totals at the last render, so renderLeaderboard() can flag which
   rooms just scored and pulse them — makes the live update visible (2026-06-03
   user report: "the score doesn't feel like it updates live"). null = first
   paint (no pulse on the initial render). */
let _lbPrevTotals = null;
let _lbPrevTogether = null;

/* the live leaderboard - a cooperative shared goal first, then a gentle ranking
   (top three only; everyone else shown but never labelled "last") */
function renderLeaderboard() {
  const box = el("leaderboard");
  if (!box) return;
  // Graceful degradation (2026-06-23): the cross-room read (refLeaderboard /
  // refRooms → allRooms) can be empty or lagging — a denied/raced all-rooms read,
  // or a slow first paint. The student's OWN team total is always known locally
  // (roomScore), so seed it into the view so the board never shows a false
  // "No points yet" while this room is actively scoring. Never mutates allRooms.
  const view = Object.assign({}, allRooms);
  if (myRoom && !isRoomAdmin) {
    const own = view[myRoom] ? Object.assign({}, view[myRoom]) : {};
    // Always prefer the local live roomScore for the student's OWN room — it's
    // the authoritative, freshest source (refScore), so it must override a stale
    // or empty allRooms[myRoom].score, not just a missing one (CodeRabbit).
    if (roomScore && Object.keys(roomScore).length) own.score = roomScore;
    if (!own.teamName && teamName) own.teamName = teamName;
    view[myRoom] = own;
  }
  const rows = roomNames(roomCount).map(r => {
    const data = view[r] || {};
    return { room: r, name: (data.teamName || r), total: scoreTotal(data) };
  }).sort((a, b) => b.total - a.total || a.room.localeCompare(b.room));
  box.innerHTML = "";
  // Which rooms went UP since the last paint? Those rows get a one-shot pulse.
  const prevTotals = _lbPrevTotals;
  const bumped = {};
  if (prevTotals) {
    rows.forEach(r => { if (prevTotals[r.room] != null && r.total > prevTotals[r.room]) bumped[r.room] = true; });
  }
  _lbPrevTotals = {};
  rows.forEach(r => { _lbPrevTotals[r.room] = r.total; });

  // --- the cooperative shared goal: every room's points count together ---
  const together = rows.reduce((s, r) => s + r.total, 0);
  const togetherUp = (_lbPrevTogether != null) && (together > _lbPrevTogether);
  _lbPrevTogether = together;
  const goal = Math.max(1, roomCount) * 220;
  const pct = Math.min(100, Math.round(together / goal * 100));
  const shared = document.createElement("div");
  shared.className = "lb-shared" + (togetherUp ? " lb-shared-bumped" : "");
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
      (ranked ? " ranked" : "") + (bumped[r.room] ? " lb-bumped" : "");
    const rankWord = ranked ? ("rank " + (i + 1)) : "in play";
    row.setAttribute("aria-label",
      r.name + (r.room === myRoom ? " (your team)" : "") + ", " + rankWord +
      ", " + r.total + " points");
    const rank = document.createElement("span");
    rank.className = "lb-rank";
    rank.setAttribute("aria-hidden", "true");
    if (ranked && i === 0) rank.innerHTML = icMarkup("trophy");
    else rank.textContent = ranked ? "#" + (i + 1) : "•";
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
 * phase stepper accordingly. Called from renderFindings,
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
  const modAAnswerEntries = Object.keys(answers.moduleA || {})
    .map(k => answers.moduleA[k]).filter(Boolean);
  const bulletsCovered = new Set(
    modAAnswerEntries.map(e => e.bulletKey).filter(Boolean)
  );
  // Debate + answers MERGED (2026-06-25): two questions — diagnosis & plan,
  // and pain across cultures. "Done" = both have at least one entry.
  const allBulletsCovered = ["diagnosis", "culture"]
    .every(k => bulletsCovered.has(k));

  // When both questions are answered, reveal the "call a facilitator to move to
  // Module B" button in the Debate & answers card (user request 2026-06-02).
  _updateAnswersCompleteCta("modA-answers-complete", "modA-call-next-btn",
    allBulletsCovered, "modA.answers.complete.callMsg",
    "Module A done — ready to move on to Module B.");

  // Phase gate: the team works the case up freely, then commits ≥1 working
  // hypothesis — that unlocks the merged Debate & answers section.
  const gateOpen = (typeof phaseGateOpen === "function") ? phaseGateOpen() : false;

  // State machine (highest-priority match wins).
  if (revealedCount === 0) {
    textEl.textContent = _coachT("modA.coach.read-case",
      "Read the case, then ask the patient, examine and investigate to work it up.");
    _coachSetAction(actionsEl, null);
  } else if (!gateOpen) {
    textEl.textContent = _coachT("modA.coach.gather",
      "Work the case up — ask, examine, investigate. When you're ready, write " +
      "a working hypothesis to unlock the discussion.");
    _coachSetAction(actionsEl, null);
  } else if (modAAnswerEntries.length === 0) {
    textEl.textContent = _coachT("modA.coach.open-discussion",
      "✓ Hypotheses in — open Debate & answers and tackle the two questions " +
      "together: your diagnosis & plan, and pain across cultures.");
    _coachSetAction(actionsEl, null);
  } else if (!allBulletsCovered) {
    const remaining = 2 - bulletsCovered.size;
    const tpl = _coachT("modA.coach.bullets-partial",
      "Capturing answers — {n} still to add to cover both questions.");
    textEl.textContent = tpl.replace("{n}", String(remaining));
    _coachSetAction(actionsEl, null);
  } else if (allBulletsCovered) {
    textEl.textContent = _coachT("modA.coach.bullets-complete",
      "✓ Both questions answered. Add more refinements or wait for your facilitator.");
    _coachSetAction(actionsEl, null);
  } else {
    // catch-all: fall back to the generic next-step text
    textEl.textContent = _coachT("modA.coach.gather",
      "Work the case up — ask, examine, investigate. When you're ready, write " +
      "a working hypothesis to unlock the discussion.");
    _coachSetAction(actionsEl, null);
  }

  // Progressive right-column reveal rides the same state hook as the coach —
  // this is called from renderFindings / renderAnswers / switchRcolTab / room
  // entry, so the tabs appear exactly when their phase becomes actionable.
  if (typeof revealModARightCol === "function") revealModARightCol();
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
  // The answer bullets now span Phase 3 (family-sentence + differ-converge) and
  // Phase 6 (reflect-improved + practice-change) — derive from ANSWER_BULLETS so
  // the count can't drift (2026-06-26).
  const modBBullets = (typeof ANSWER_BULLETS !== "undefined" && ANSWER_BULLETS.moduleB) ||
    ["family-sentence", "differ-converge", "reflect-improved", "practice-change"];
  const allBulletsCovered = modBBullets.every(k => bulletsCovered.has(k));

  // When EVERY answer bullet is captured, reveal the "call a facilitator to go to
  // the final section" button in the Group-answers card (user request 2026-06-02).
  _updateAnswersCompleteCta("modB-answers-complete", "modB-call-next-btn",
    allBulletsCovered, "modB.answers.complete.callMsg",
    "Module B done — ready for the final wrap-up section.");

  // NB: the phase stepper is now driven by the synced room phase
  // (renderModBPhase), so the coach only supplies guidance text — it no longer
  // sets the stepper state (that would fight the shared phase).
  if (!rolePicked) {
    // De-dup (2026-06-01): this used to repeat the role-picker card's own prompt
    // ("Pick your role… the observer keeps time"). It now frames the approach and
    // points down to the picker, which carries the mechanic.
    textEl.textContent = _coachT("modB.coach.pick-role",
      "Read the situation together, then take a seat below — there's no wrong choice, and you'll swap roles and replay.");
    _coachSetAction(actionsEl, null);
  } else if (modBAnswerEntries.length === 0) {
    textEl.textContent = _coachT("modB.coach.roleplay",
      "Roles set! Play the scene, then talk it through and vote — and you'll swap roles and replay.");
    _coachSetAction(actionsEl, null);
  } else if (!allBulletsCovered) {
    const remaining = modBBullets.filter(k => !bulletsCovered.has(k)).length;
    const tpl = _coachT("modB.coach.bullets-partial",
      "Capturing your answers — {n} still to add.");
    textEl.textContent = tpl.replace("{n}", String(remaining));
    _coachSetAction(actionsEl, null);
  } else {
    textEl.textContent = _coachT("modB.coach.bullets-complete",
      "✓ All your answers are in. Add more refinements or wait for your facilitator.");
    _coachSetAction(actionsEl, null);
  }
}

/* ===================== MODULE B — SYNCED PHASE FLOW (2026-05-27) =============
 * The room moves through its phases together (rooms/$room/sections/$slot/phase,
 * 0..5). A room member can advance it. Only the CURRENT phase's action sections
 * are shown; reference material (SPIKES strip, useful sentences, history,
 * guidelines, recap) stays visible throughout (those sections carry no entry in
 * MODB_PHASE_SECTIONS). */
// Six-phase Module B (2026-06-26): a play → reflect → SWAP → replay → reflect
// loop. P3 fuses the old 6-prompt exchange + 3-bullet write-up into TWO
// questions + the vote; P4 swaps roles; P5 replays the scene from the new role;
// P6 reflects on what improved between the two plays.
const MODB_PHASES = ["setup", "play", "exchange", "swap", "replay", "reflect"];
// selector (scoped to #stage-2) → the phases in which that action section shows.
const MODB_PHASE_SECTIONS = [
  { sel: ".vignette",                   phases: ["setup"] },
  // The role picker is live through both plays + the swap (so the swapped role
  // shows on the chips in round 2).
  { sel: "#modB-role-picker",           phases: ["setup", "play", "swap", "replay"] },
  // The per-role guides, observer checklist, private brief, useful-sentences and
  // the safety note live in the always-available reference tabs ("Your role" /
  // "Useful sentences"), so they are NOT phase-gated; role-gating
  // (MODB_ROLE_SECTIONS) still narrows "Your role" to the holder.
  //
  // P3 "exchange": two questions (col-right) + the vote-together (col-left).
  { sel: ".answers-card-modB-exchange", phases: ["exchange"] },
  // Team decisions ("vote together") appear only in the discussion phase. Once
  // the team has committed them all, renderDecisions() hides the card.
  { sel: "#decisions-B",                phases: ["exchange"] },
  // P4 "swap": rotate roles for round 2.
  { sel: "#modB-swap-card",             phases: ["swap"] },
  // P5 "replay": play the same scene from the new role.
  { sel: "#modB-replay-card",           phases: ["replay"] },
  // P6 "reflect": what changed between the two plays + a personal takeaway.
  { sel: ".answers-card-modB-reflect",  phases: ["reflect"] }
];

/* ── Phase-based progress: shared plumbing (module-set M3b) ────────────────────
 * Module B runs on an ordinal phase index whose only job is to show/hide the
 * right sections of #stage-2 as the room walks through the roleplay timetable.
 * That mechanism is generic, so it lives here as data-driven helpers a FUTURE
 * phase-based module would reuse by adding a MODULE_PROGRESS entry — instead of
 * copy-pasting the render/visibility/nav functions.
 *
 * This is NOT a merge of the two module engines. Module A's progress is a
 * DERIVED hypothesis gate (revealModARightCol) — unforgeable because computed,
 * per-participant sticky — and is DELIBERATELY absent from this registry; it
 * keeps its own visibility function. Module B is an ungated shared timetable.
 * See ARCHITECTURE/module-set-design.md (M3). */

/* Toggle `is-phase-hidden` on every section-table node NOT visible in phaseKey
   (selectors scoped under the module's stage), and collapse the two-column grid
   to full width outside the `expandedIn` phases (mirrors Module A's
   rcol-collapsed). Pure DOM; no module-specific knowledge. */
function applyPhaseVisibility(stageId, sections, phaseKey, columnsSel, expandedIn) {
  const stage = document.getElementById(stageId);
  if (!stage) return;
  sections.forEach(function (s) {
    stage.querySelectorAll(s.sel).forEach(function (node) {
      node.classList.toggle("is-phase-hidden", s.phases.indexOf(phaseKey) === -1);
    });
  });
  if (columnsSel) {
    const cols = stage.querySelector(columnsSel);
    if (cols) cols.classList.toggle("rcol-collapsed", (expandedIn || []).indexOf(phaseKey) === -1);
  }
}

/* Render a phase-based module at `phaseIndex`: apply visibility, sync the
   stepper chips, disable prev/next at the ends, set the indicator text. */
function renderModulePhase(cfg, phaseIndex) {
  const phaseKey = cfg.phases[phaseIndex] || cfg.phases[0];
  applyPhaseVisibility(cfg.stageId, cfg.sections, phaseKey, cfg.columnsSel, cfg.expandedIn);
  setPhaseStepperState(cfg.stageId, phaseKey, cfg.phases.slice(0, phaseIndex));
  const nav = cfg.nav || {};
  const prev = nav.prevId && el(nav.prevId), next = nav.nextId && el(nav.nextId);
  if (prev) prev.disabled = phaseIndex <= 0;
  if (next) next.disabled = phaseIndex >= cfg.phases.length - 1;
  const ind = nav.indicatorId && el(nav.indicatorId);
  if (ind) ind.textContent = _modBT(nav.indicatorKey, nav.indicatorFallback, { n: phaseIndex + 1 });
}

/* Per-module phase config the shared plumbing above reads. Module A is
   deliberately absent (derived gate, not an ordinal phase list). A future
   phase-based module adds an entry here + its own set-phase/DB wiring. */
const MODULE_PROGRESS = {
  B: {
    stageId: "stage-2",
    phases: MODB_PHASES,
    sections: MODB_PHASE_SECTIONS,
    columnsSel: ".columns.modB-columns",
    // The right column (answer cards) is populated only in the discussion
    // phases — P3 "exchange" (the two questions) and P6 "reflect" (what improved
    // + the takeaway); collapse the grid to full width everywhere else.
    expandedIn: ["exchange", "reflect"],
    nav: {
      prevId: "modB-phase-prev", nextId: "modB-phase-next",
      indicatorId: "modB-phase-indicator",
      indicatorKey: "modB.phase.indicator", indicatorFallback: "Phase {n} / 6"
    }
  }
};

/* Name-preserving wrapper (module-set M3b): Module B's phase visibility now runs
   on the shared applyPhaseVisibility + its MODULE_PROGRESS.B config. Kept so the
   ~11 callers/specs that drive applyModBPhaseVisibility stay unchanged. */
function applyModBPhaseVisibility(phaseKey) {
  const c = modBCfg();   // S1c-3b — authored phases when declared
  applyPhaseVisibility(c.stageId, c.sections, phaseKey, c.columnsSel, c.expandedIn);
}

/* ── Module B — per-role section visibility (2026-06-03) ───────────────────
 * Each role-specific guidance block shows ONLY for the participant holding
 * that role. This is independent of the phase toggle above: a block is
 * visible only when it carries NEITHER `is-phase-hidden` NOR `is-role-hidden`.
 * `role` is the viewer's own pick (null when none chosen → all hidden).
 * Called from showRoleObjective(), so every pick / deselect / restore / swap
 * keeps the gating in sync. */
const MODB_ROLE_SECTIONS = [
  { sel: ".micro-framework-card", roles: ["physician"] },
  { sel: "#observer-checklist",   roles: ["observer"] },
  { sel: "#modB-patient-guide",   roles: ["patient"] },
  { sel: "#modB-family-guide",    roles: ["family"] }
];

function applyModBRoleVisibility(role) {
  if (typeof document === "undefined") return;
  const stage = document.getElementById("stage-2");
  if (!stage) return;
  MODB_ROLE_SECTIONS.forEach(({ sel, roles }) => {
    const show = !!role && roles.indexOf(role) !== -1;
    stage.querySelectorAll(sel).forEach(node => {
      node.classList.toggle("is-role-hidden", !show);
    });
  });
}

/* Blink a node once to draw the eye (used when a Module B role is picked, so
   the student notices the section that just appeared and reads it). The
   remove→reflow→add dance restarts the CSS animation even on a rapid re-pick;
   the class is cleared on animationend so the node returns to its base style. */
function _flashEl(node) {
  if (!node) return;
  node.classList.remove("attention-flash");
  void node.offsetWidth;                 // force reflow so the animation restarts
  node.classList.add("attention-flash");
  node.addEventListener("animationend", function handler() {
    node.classList.remove("attention-flash");
    node.removeEventListener("animationend", handler);
  });
}

/* On a Module B role PICK, pulse the "Your role" reference tab so the student
   notices it lit up — the guides + private brief live inside it now. We do NOT
   auto-open it: the reference section is sticky, and on a phone an auto-opened
   tall panel would overlay the role picker mid-selection. The amber .has-role
   highlight (set by showRoleObjective) is the persistent "your part is here". */
function flashRoleSections(role) {
  if (typeof document === "undefined" || !role) return;
  _flashEl(el("refB-btn-role"));
  _flashEl(el("modB-role-objective"));
}

function _modBT(key, fallback, vars) {
  let s = fallback;
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const v = window.t(key);
    if (v && v !== key) s = v;
  }
  if (vars) Object.keys(vars).forEach(k => { s = s.replace("{" + k + "}", String(vars[k])); });
  return s;
}

/* Name-preserving wrapper (module-set M3b): render Module B at its current
   shared phase index via the generic renderModulePhase. */
function renderModBPhase() {
  renderModulePhase(modBCfg(), modBPhase);
}

function setModBPhase(idx) {
  const n = Math.max(0, Math.min(modBCfg().phases.length - 1, idx | 0));
  if (refModBPhase) refModBPhase.set(n).catch(() => {});
  else { modBPhase = n; renderModBPhase(); }   // LOCAL/solo fallback
}

/* Wire the synced phase + exchange navigation. Idempotent (per-element _wired
 * flag) so repeated wireRoomUI calls don't stack handlers. */
function initModBPhaseNav() {
  const prev = el("modB-phase-prev"), next = el("modB-phase-next");
  if (prev && !prev._wired) { prev._wired = true; prev.addEventListener("click", () => setModBPhase(modBPhase - 1)); }
  if (next && !next._wired) { next._wired = true; next.addEventListener("click", () => setModBPhase(modBPhase + 1)); }
  // Make the phase-stepper chips jump to a phase (free nav 1↔4). Each chip is a
  // real <button> inside its <li>, so it's natively keyboard-operable and the
  // <ol> keeps valid <li>-only children (axe `list` rule).
  const stepper = document.querySelector("#stage-2 .phase-stepper");
  if (stepper && !stepper._wired) {
    stepper._wired = true;
    Array.from(stepper.querySelectorAll(".phase-step-btn")).forEach((btn, idx) => {
      btn.addEventListener("click", () => setModBPhase(idx));
    });
  }
  renderModBPhase();
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
/* Cross-room synced (refHypotheses). Hypotheses are pedagogically encouraged —
 * the coach nudges the team to brainstorm before committing to investigations
 * and a plan — but they no longer hard-gate the Investigations panel (dry-run
 * 2026-05-26: ordering a test is a real choice that can be wrong + penalised,
 * not a step to unlock). Only the synthesis is gated, on the red-flag screen. */

function hypothesisCount() {
  return Object.keys(hypotheses || {}).length;
}
function initHypotheses() {
  const input = el("hypothesis-input");
  const btn = el("hypothesis-add-btn");
  if (!input || !btn || btn._wired) return;
  btn._wired = true;
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
  // Investigations are FREELY clickable (2026-06-02) — that section is never
  // locked. The old clinical-synthesis section (removed 2026-06-02) was the
  // gated one; the ≥1-hypothesis phase gate (phaseGateOpen) now only drives the
  // Debate/Decisions reveal in revealModARightCol().
  const inv = el("chart-investigations");
  if (inv) inv.classList.remove("is-locked");
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
  // Keep the role-specific guidance blocks in sync with the held role — this
  // is the single choke-point every pick / deselect / restore / swap flows
  // through, so role-gating never drifts from the private brief.
  applyModBRoleVisibility(role);
  // Highlight the "Your role" reference tab and hide its "pick a role" prompt
  // once a role is held (both cleared on deselect). showRoleObjective is the
  // single choke-point for pick / deselect / restore / swap / random-assign, so
  // the tab + prompt never drift from the actual role.
  const roleTabBtn = el("refB-btn-role");
  if (roleTabBtn) roleTabBtn.classList.toggle("has-role", !!role);
  const cardPrompt = el("modB-role-card-prompt");
  if (cardPrompt) cardPrompt.classList.toggle("hidden", !!role);
  const panel = el("modB-role-objective");
  if (!panel) return;
  const textEl = el("modB-role-objective-text");
  /* S1c-1 — an authored section supplies its own private brief; the built-ins
     keep resolving through i18n, where their translations live. Authored text
     goes in as textContent (never the sanitised-innerHTML i18n path), because
     it is facilitator input rather than a shipped string. */
  const _authored = (typeof roleplayRole === "function") ? roleplayRole(role) : null;
  if (role && textEl && _authored && _authored.brief) {
    textEl.removeAttribute("data-i18n");
    textEl.removeAttribute("data-i18n-html");
    textEl.textContent = (typeof tc === "function")
      ? tc(_authored.brief, _curLang()) : String(_authored.brief);
    panel.classList.remove("hidden");
    return;
  }
  if (role && textEl) {
    const key = (_authored && _authored.briefKey) || ("modB.role." + role + ".brief");
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

/* S1c-1 — rebuild the chip row from the section's cast.
   No-ops when the cast already matches the markup, so the built-in roleplays
   keep their hand-authored chips and i18n attributes untouched; this only
   rewrites the row for a section that declares its own roles. Built with
   createElement + textContent, never innerHTML — a role name is
   facilitator-authored text. */
function renderRoleChips() {
  const row = document.querySelector("#modB-role-picker .role-chip-row");
  if (!row) return;
  const cast = roleplayRoles();
  const current = Array.prototype.map.call(
    row.querySelectorAll(".role-chip"), c => c.getAttribute("data-role"));
  if (current.join(",") === cast.map(r => r.id).join(",")) return;

  row.textContent = "";
  cast.forEach(r => {
    const b = document.createElement("button");
    b.className = "role-chip";
    b.type = "button";
    b.setAttribute("data-role", r.id);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    const span = document.createElement("span");
    span.className = "role-chip-name";
    if (r.name) {
      span.textContent = (typeof tc === "function") ? tc(r.name, _curLang()) : String(r.name);
    } else if (r.nameKey) {
      span.setAttribute("data-i18n", r.nameKey);
      span.textContent = r.id;
    } else {
      span.textContent = r.id;
    }
    b.appendChild(span);
    row.appendChild(b);
  });
  if (typeof window !== "undefined" && typeof window.applyI18n === "function") {
    window.applyI18n(row);
  }
  /* The picker wires its listeners once, over the chips that existed then —
     re-arm it against the new ones. */
  const picker = el("modB-role-picker");
  if (picker) picker._wired = false;
  initRolePicker();
}

function initRolePicker() {
  const picker = el("modB-role-picker");
  if (!picker || picker._wired) return;
  picker._wired = true;
  const chips = picker.querySelectorAll(".role-chip");
  const STORAGE_KEY = "canamed_modB_role";
  // restore saved selection
  let restored = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      restored = saved;
      chips.forEach(c => c.setAttribute("aria-checked",
        c.dataset.role === saved ? "true" : "false"));
    }
  } catch (e) { /* localStorage may be blocked; OK */ }
  // Always run once — re-shows a restored role's private brief AND establishes
  // the role-gating baseline (with no saved role, hides every role-specific
  // block so nothing leaks before a role is picked).
  showRoleObjective(restored);
  // Single selection routine shared by click AND arrow keys. Per the
  // WAI-ARIA radiogroup pattern (round4-a11y Rec 3 / WCAG 2.1.1) arrow
  // keys must MOVE focus AND SELECT — previously they only moved focus,
  // so the role never committed unless the user also pressed Space/Enter.
  const select = chip => {
    chips.forEach(c => c.setAttribute("aria-checked", "false"));
    chip.setAttribute("aria-checked", "true");
    showRoleObjective(chip.dataset.role);   // reveal MY private brief only
    flashRoleSections(chip.dataset.role);   // blink it so they notice + read it
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
  // "Randomly assign roles" — distribute distinct roles across the room.
  wireAssignRoles();
}
// The "I'd rather observe" panic affordance (wireObserveEscape) was removed
// 2026-07-16 (user request): it duplicated the Observer role chip, which already
// moves the student into the observer role via the same synced chip-select path.

/* Randomly assign roles (Module B, 2026-06-26): one tap distributes DISTINCT
   roles across everyone present (physician/patient/family first, observers for
   the rest). The presser draws over the live `presence` roster and writes a
   {clientId: role} mapping to <base>/moduleB/roleAssign; each client then claims
   its OWN slot (no cross-writes). Re-tapping reshuffles; solo mode gives this
   device one of the four at random. Grief surface (a skewed mapping) is the
   accepted room-griefing class — each client only writes its own roleChoices. */
/* S1c-1 — the deck is the SECTION's cast, not a literal. Kept as a function so
   it re-reads after a scenario switch; the "extras become observers" fallback
   uses the LAST declared role, which is the observer in every built-in and the
   natural spectator slot in an authored cast. */
/* The chunk that owns the cast is loaded with the room and its load failure is
   deliberately SWALLOWED (a hiccup fetching it must not block the room), so
   every bare-name call into it has to tolerate absence. Falling back to the
   four shipped roles keeps a session runnable rather than throwing. */
const ROLEPLAY_FALLBACK_ROLE_IDS = ["physician", "patient", "family", "observer"];
/* Same reasoning for the phase config: without the chunk, fall back to the
   shipped six-phase timetable rather than throwing. */
function modBCfg() {
  return (typeof modBProgressCfg === "function") ? modBProgressCfg() : MODULE_PROGRESS.B;
}
function assignRoleDeck() {
  return (typeof roleplayRoleIds === "function")
    ? roleplayRoleIds() : ROLEPLAY_FALLBACK_ROLE_IDS.slice();
}

function _fisherYates(arr) {
  // Browser Math.random (client code, not the deterministic workflow sandbox).
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Roles for a roster of `count`, in priority order (physician, patient, family,
   then observers) — the named parts are always distinct + physician always
   filled; the shuffle above randomises only WHO gets which. Pure + global so the
   distinctness property is testable. */
function _roleDeckFor(count) {
  const cast = assignRoleDeck();
  const spare = cast[cast.length - 1] || "observer";
  const deck = [];
  for (let i = 0; i < count; i++) {
    deck.push(i < cast.length ? cast[i] : spare);
  }
  return deck;
}

function assignRolesRandomly() {
  // Solo / LOCAL: no shared roster — give THIS device a random role.
  if (MODE !== "shared" || !refRoleAssign) {
    const _solo = assignRoleDeck();
    _applyAssignedRole(_solo[Math.floor(Math.random() * _solo.length)]);
    return;
  }
  const roster = Object.keys(presence || {});
  if (clientId && roster.indexOf(clientId) === -1) roster.push(clientId);
  if (!roster.length) return;
  const deck = _roleDeckFor(roster.length);
  const order = _fisherYates(roster);
  const assignments = {};
  order.forEach((cid, i) => { assignments[cid] = deck[i]; });
  refRoleAssign.set({ assignments: assignments, by: clientId, at: Date.now() })
    .catch(() => { /* offline — apply my own slot locally as a fallback */
      if (assignments[clientId]) _applyAssignedRole(assignments[clientId]);
    });
}

let _lastRoleAssignAt = 0;
function handleRoleAssign(val) {
  if (!val || typeof val !== "object" || !val.assignments) return;
  const at = (typeof val.at === "number") ? val.at : 0;
  if (at && at <= _lastRoleAssignAt) return;   // already applied this draw
  _lastRoleAssignAt = at;
  const mine = val.assignments[clientId];
  if (typeof mine === "string" && assignRoleDeck().indexOf(mine) !== -1) {
    _applyAssignedRole(mine);
  }
}

/* Apply an assigned role to THIS device: tick the chip, reveal the brief, sync
   my own pick, update the coach — exactly like a manual selection. */
function _applyAssignedRole(role) {
  const picker = el("modB-role-picker");
  if (!picker) return;
  picker.querySelectorAll(".role-chip").forEach(c =>
    c.setAttribute("aria-checked", c.dataset.role === role ? "true" : "false"));
  showRoleObjective(role);
  if (typeof flashRoleSections === "function") flashRoleSections(role);
  try { localStorage.setItem("canamed_modB_role", role); } catch (e) {}
  try {
    if (MODE === "shared" && refRoleChoices && clientId && !isRoomAdmin) {
      refRoleChoices.child(clientId).set({ role: role, name: myName || "", at: Date.now() });
    }
  } catch (e) { /* offline — local pick stands */ }
  if (typeof updateModBNextStep === "function") updateModBNextStep();
}

/* Wire the "Randomly assign roles" button (idempotent). */
function wireAssignRoles() {
  const btn = el("modB-assign-roles-btn");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", assignRolesRandomly);
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
/* S1c-1 — the swap rotation walks the SECTION's cast in declared order. */
function replayRoleOrder() {
  return (typeof roleplayRoleIds === "function")
    ? roleplayRoleIds() : ROLEPLAY_FALLBACK_ROLE_IDS.slice();
}

function _swapT(key, fallback) {
  if (typeof window !== "undefined" && typeof window.t === "function") {
    const v = window.t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

/* Rotate a role by `steps` around the 4-role cycle. Unknown/unpicked → unchanged. */
function rotateRole(role, steps) {
  const order = replayRoleOrder();
  const i = order.indexOf(role);
  if (i < 0) return role;
  const n = order.length;
  return order[(i + ((steps % n) + n)) % n];
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
  if (next > replayRoleOrder().length) {
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
  round = (typeof round === "number" && round >= 1 && round <= replayRoleOrder().length)
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
    flashRoleSections(next);   // blink the rotated role's section so they re-read it
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
  banner.textContent = _swapRoundLabel(round) + " — " + line;
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
  // Module A merged Debate + answers into TWO questions (2026-06-25):
  // diagnosis & plan, and pain across cultures.
  moduleA: ["diagnosis", "culture"],
  // Phase 3 (exchange) = family-sentence + differ-converge; Phase 6 (reflect) =
  // reflect-improved + practice-change. All share moduleB answer storage.
  moduleB: ["family-sentence", "differ-converge", "reflect-improved", "practice-change"]
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
    if (refCertIds) refCertIds.off();
  } catch (e) { /* ignore */ }
  location.reload();
}
function initLeave() {
  el("leave-btn").addEventListener("click", () => {
    // backToDashboard lives in the lazy script-admin.js; the branch is only
    // reachable for an admin, who necessarily loaded it to get here. Guarded
    // anyway — see initStageNav's note.
    if (isRoomAdmin) {
      if (typeof backToDashboard !== "function") return _adminChunkMissing();
      backToDashboard();
    }
    else leaveAndReload();
  });
}

/* The participant "I'm just observing" button was removed 2026-06-02 (user
 * request). It used to write /sessions/{code}/rooms/{room}/observers/{clientId}
 * and set body[data-observer="1"]; with the button gone nothing populates that
 * node, so the related CSS softening simply never triggers. Module B's roleplay
 * observer ROLE is a separate mechanism (the role picker) and is unaffected. */

/* Control-row overflow (UX-overload #5): the "··· More" disclosure that holds
   Teams / observe / leave on narrow viewports (they're display:contents inline
   on desktop, so this toggle is hidden there). Toggles .is-open on the wrapper;
   closes on outside click + Escape. The toggle only exists in the participant
   row, so this no-ops for the admin dashboard. */
function initStageOverflow() {
  const toggle = el("stage-overflow-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  const wrap = toggle.closest(".stage-overflow");
  if (!wrap) return;
  const setOpen = open => {
    wrap.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(!wrap.classList.contains("is-open")));
  document.addEventListener("click", e => {
    if (wrap.classList.contains("is-open") && !wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && wrap.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
  });
}

/* Room-header collapse (2026-07-15, user request). The session stepper, the
   "waiting for a facilitator" line and the room presence now live in
   #stage-details, collapsed by default so the header is a single line. This
   toggle shows/hides them and remembers the choice across rooms + reloads via
   localStorage ("for all sessions"). #stage-indicator stays in the always-
   visible row, so the screen-reader position announcement still fires while
   this is collapsed. */
/* Leaderboard flow (2026-07-21, third iteration on this element): the chip
   must stay on the top line AND the ranking must expand IN FLOW (pushing the
   content below, never overlaying it). CSS alone cannot do both — the panel
   is a child of the <details> chip, and display:contents on <details> is
   intermittently broken in Chromium. So: while open, the panel is reparented
   to the end of .stage-card (normal full-width flow); on close it returns
   into the details so native toggling hides it again. */
function initLeaderboardFlow() {
  const card = el("leaderboard-card");
  if (!card || card.dataset.flowWired === "1") return;
  card.dataset.flowWired = "1";
  card.addEventListener("toggle", () => {
    const stageCard = card.closest(".stage-card");
    if (!stageCard) return;
    if (card.open) {
      const p = card.querySelector(".lb-panel");
      if (p) stageCard.appendChild(p);
    } else {
      const p = stageCard.querySelector(":scope > .lb-panel");
      if (p) card.appendChild(p);
    }
  });
}

function initStageDetailsToggle() {
  // The leaderboard flow handler is part of the same header wiring (and the
  // e2e surfaceRoom helper invokes THIS function directly) — keep them
  // together so every path that wires the header gets both. Idempotent.
  initLeaderboardFlow();
  const LS_KEY = "canamedStageDetailsOpen";
  const toggle = el("stage-details-toggle");
  const panel = el("stage-details");
  if (!toggle || !panel || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  const reflect = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  // Restore the remembered choice (default collapsed). Reading only — the
  // initial state is NOT written back, so a fresh browser stays at the default
  // without a spurious storage write.
  let start = false;
  try { start = localStorage.getItem(LS_KEY) === "1"; } catch (e) { /* private mode — default collapsed */ }
  reflect(start);
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    reflect(open);
    try { localStorage.setItem(LS_KEY, open ? "1" : "0"); } catch (e) { /* private mode — ignore */ }
  });
}

/* "More tools ▾" dropdown for the decluttered admin toolbar (2026-06-03). Keeps
   the rarely-used dean/research/accreditation/reporting actions one click away
   without crowding the live-session control row. Mirrors initStageOverflow:
   toggle .is-open, close on item-pick / outside-click / Escape. */
function initAdminToolsMenu() {
  const toggle = el("admin-overflow-toggle");
  if (!toggle || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  const wrap = toggle.closest(".admin-overflow");
  if (!wrap) return;
  const setOpen = open => {
    wrap.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", e => {
    e.stopPropagation();
    setOpen(!wrap.classList.contains("is-open"));
  });
  // Picking any tool closes the menu (the doc links open in a new tab anyway).
  wrap.querySelectorAll(".admin-overflow-menu > button, .admin-overflow-menu > a")
    .forEach(item => item.addEventListener("click", () => setOpen(false)));
  document.addEventListener("click", e => {
    if (wrap.classList.contains("is-open") && !wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && wrap.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
  });
}

/* End-of-session poll — sim 2026-05-19 (Akari, Antoine, Manon, Sophie,
 * Daichi): "End-of-session quick poll: 'What was the hardest moment?'
 * + 'One word that describes how you felt.'" Writes one entry per
 * client to /sessions/{code}/poll/{cid}. Idempotent — submitting again
 * overwrites the existing entry. No facilitator notification (the
 * facilitator reads /poll later as part of the archive). */
function initEndPoll() {
  // The quick-reflection end-poll was removed 2026-06-16 (PI request); the full
  // subjective questionnaire (#survey-card, renderSurvey) is the reflection
  // surface now. This function now only wires the student wrap-up downloads
  // (room answers / certificate / booklet). (The facilitator retention-reminder
  // card was removed 2026-07-16 — user request.)
  if (isRoomAdmin) {
    // Admins have their own all-rooms export; hide the student per-room one.
    const d = el("wrapup-download-btn"); if (d) d.classList.add("hidden");
    return;
  }
  // The room-answers Markdown export.
  _wireTakeHomeButton("wrapup-download-btn", "downloadMyRoomAnswers");
  // Student certificate of attendance (PDF) — lazy-loads pdfmake on click.
  _wireTakeHomeButton("wrapup-cert-btn", "downloadCertificatePdf");
  // Student study booklet (PDF) — designed revision aid.
  _wireTakeHomeButton("wrapup-booklet-btn", "downloadStudyBookletPdf");
}

/* Wire one wrap-up download button to a handler that lives in the LAZY
   takehome.js (perf reclaim, 2026-08-04 — see the pointer comment where that
   block used to sit). The chunk is fetched ON CLICK, so a student who never
   downloads never pays for it, and the two PDF handlers were already pulling
   ~2.2 MB of pdfmake at that same moment.

   script.js keeps no copy of the handler, so the reference has to be
   typeof-guarded: an offline / 404 / CSP-blocked chunk must surface a toast,
   not throw a ReferenceError out of a click handler and leave a dead button.
   The button is wired synchronously (before the chunk resolves) so a click
   during the fetch is still honoured — it queues behind the same promise. */
function _wireTakeHomeButton(id, fnName) {
  const btn = el(id);
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", function () {
    const loader = window.CanamedLoader || {};
    Promise.resolve()
      .then(() => loader.ensureTakeHome ? loader.ensureTakeHome()
                                        : Promise.reject(new Error("loader")))
      .then(() => {
        const fn = window[fnName];
        if (typeof fn !== "function") throw new Error(fnName + " unavailable");
        fn();
      })
      .catch(() => {
        // Same wording + English-only treatment as the pdfmake failure toast
        // inside takehome.js — this is the identical failure to the user.
        if (typeof toast === "function") {
          toast("Couldn't prepare your download — check your connection and try again.", "", "loss");
        }
      });
  });
}

/* The facilitator retention-reminder feature (2026-06-16) — the wrap-up
   "📅 Schedule the retention reminder" card + its .ics / Google-Calendar
   builders (initRetentionReminder, _retentionReminderEvent, _icsStamp,
   _buildIcs, _gcalUrl) — was removed 2026-07-16 (user request). The student
   revisit.html self-check page is unchanged. */

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
// How long to wait on the existence/closed reads before declaring the DB
// unreachable. A realtime `once("value")` against a down connection never
// rejects — it just never resolves — so without this race the splash would
// sit on "Checking…" forever (the 2026-05-30 long-poll/App-Check wedge). 12s
// is comfortably above a normal cold read (~250ms) yet short enough that a
// genuinely wedged client gets a real error + retry instead of a dead UI.
const SESSION_STATUS_TIMEOUT_MS = 12000;

function sessionStatus(code) {
  try { dbInit(); } catch (e) {}
  if (!db) return Promise.resolve({ exists: false, closed: false, unreachable: true });
  const read = ensureSignedIn()
    .then(() => Promise.all([
      db.ref(oPath(code, "created")).once("value"),
      db.ref(oPath(code, "closed")).once("value")
    ]))
    .then(snaps => ({
      exists: snaps[0].val() != null,
      closed: snaps[1].val() != null
    }))
    .catch(() => ({ exists: false, closed: false, unreachable: true }));
  // Race the read against a timeout so a hung realtime connection surfaces a
  // distinguishable `unreachable` result instead of leaving callers pending.
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(
      () => resolve({ exists: false, closed: false, unreachable: true }),
      SESSION_STATUS_TIMEOUT_MS
    );
  });
  return Promise.race([read, timeout]).then(r => { clearTimeout(timer); return r; });
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
  // Warm the lazy room stylesheet as soon as a session is entered: the user is
  // now committed to a room, but the lobby/waiting room still has to render
  // first, so room.css has ample time to land before the room paints. Entering
  // a room re-calls this (idempotent) as a backstop. Deliberately NOT on the
  // splash — keeping it out of the eager CSS is the whole point.
  try { CanamedLoader.ensureRoomStyles().catch(function () {}); } catch (e) {}
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
  const cTranscript = el("consent-transcript");
  if (prior && prior.version === CONSENT_NOTICE_VERSION) {
    if (cWorkshop) cWorkshop.checked = !!prior.workshop;
    if (cResearch) cResearch.checked = !!prior.research;
    if (cTranscript) cTranscript.checked = !!prior.transcript;
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
/* peekDeepLinkCode(): read ?s=CODE from the URL WITHOUT consuming it — no
 * input fill, no history rewrite, no click. Returns the session code in the
 * SAME normalised form as the stored pointer (sanitizeCode → lowercase) so the
 * two are directly comparable, or "" when no link is present. initEntry() uses
 * this to decide whether an incoming link should override the silent
 * auto-resume of a previously-joined session. */
function peekDeepLinkCode() {
  try {
    return sanitizeCode(new URLSearchParams(window.location.search).get("s"));
  } catch (e) { return ""; }
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
    // blob, up to 256 KB) was being persisted across facilitators on
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
  // Match case-insensitively (via the canonical lower-case key) so a session
  // stored under either case — legacy upper-cased entries or new lower-case
  // ones — is removed regardless of how the caller spells the code.
  const c = sanitizeCode(code);
  _writeMySessions(_readMySessions().filter(s => sanitizeCode(s.code) !== c));
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

    // Best-effort live status check via the platform's canonical
    // sessionStatus() helper, which probes the session's `created` and
    // `closed` nodes (the same pair the splash join-gate uses) and returns
    // { exists, closed, unreachable }. That resolves the row into one of:
    //   • closed              → facilitator already ended it → prune.
    //   • !exists (reachable) → the whole session no longer exists on the
    //       server (ended long ago, or removed by the retention policy). It
    //       can NEVER be closed — the close-write rule requires the session's
    //       adminPasswordHash to exist — so flag it as ended and prune rather
    //       than offering a Close button that can only fail with a misleading
    //       "check your connection" error.
    //   • otherwise           → genuinely open.
    // `unreachable` (offline / rules-deny before auth) degrades to
    // "Status unknown" so we never prune a session that's merely offline.
    const pruneSoon = () => setTimeout(() => {
      removeMySession(s.code);
      renderMySessions();
      paintMySessionsLink();
    }, 1500);
    try {
      if (db && typeof sessionStatus === "function") {
        // Probe the canonical (lower-case) key — see closeMySession() — so the
        // status reflects the session that actually exists in the DB rather
        // than an upper-cased path that never does.
        sessionStatus(sanitizeCode(s.code))
          .then(st => {
            if (st.unreachable) {
              status.textContent = tFallback("splash.my-sessions.status-unknown",
                "Status unknown");
            } else if (st.closed) {
              status.textContent = tFallback("splash.my-sessions.already-closed",
                "Already closed — will be removed");
              closeBtn.disabled = true;
              // Auto-prune after a short visible delay so the user notices the
              // list shrank rather than items just silently vanishing.
              pruneSoon();
            } else if (!st.exists) {
              status.textContent = tFallback("splash.my-sessions.ended",
                "Ended — no longer on the server; removing from your list");
              closeBtn.disabled = true;
              pruneSoon();
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
  // Canonicalise to the SAME case the session is stored under. Session codes
  // are generated and joined in lower case (generateSessionCode + sanitizeCode
  // are lower-case), so the session subtree lives at sessions/<lower>/… . The
  // my-sessions tracker historically upper-cased the code, which made every
  // read/write here target sessions/<UPPER>/… — a path that does not exist —
  // so the close-write was rejected (PERMISSION_DENIED: the rule checks
  // sessions/<UPPER>/adminPasswordHash, which is absent). sanitizeCode() maps
  // either case to the real lower-case key.
  const c = sanitizeCode(code);
  if (!c) return;

  // Confirm with the platform's branded in-page modal (canamedConfirm), NOT
  // native window.confirm(). Native dialogs were the bug here: after a couple
  // of prompts Chrome offers a "Don't allow this page to create more dialogs"
  // checkbox, and once ticked every later window.confirm() returns false
  // WITHOUT showing anything — so `if (!ok) return` aborted silently and the
  // Close button became a dead no-op until a full reload. (Native dialogs also
  // freeze automated tests and are suppressed entirely in some in-app
  // browsers.) canamedConfirm is the same modal the rest of the platform uses;
  // it falls back to native confirm() internally only when the <dialog>
  // element is missing, so we never deadlock on a missing modal.
  const baseMessage = tFallback("splash.my-sessions.close-confirm",
    "End this session? Participants will see the wrap-up screen and " +
    "cannot interact further. The data stays in the database — you can " +
    "re-open the admin dashboard later to download the archive.");
  // Best-effort head-count (pool = everyone who joined) so accidentally
  // closing a session with students in it requires noticing that fact.
  // Any failure degrades to the plain confirm — never blocks the close.
  const countJoined = (db)
    ? db.ref(oPath(c, "pool")).once("value")
        .then(sn => { const v = sn && sn.val(); return v ? Object.keys(v).length : 0; })
        .catch(() => 0)
    : Promise.resolve(0);
  const ask = countJoined.then(n => {
    const live = (n > 0)
      ? tFallback("splash.my-sessions.close-live-warning",
          "⚠ " + n + " participant(s) have joined this session — closing ends it for everyone.")
          .replace("{n}", String(n)) + "\n\n"
      : "";
    const message = live + baseMessage;
    return (typeof canamedConfirm === "function")
      ? canamedConfirm({
          title: tFallback("splash.my-sessions.close-btn", "Close session"),
          message: message,
          detail: c.toUpperCase(),                     // session code, monospace (display upper)
          okLabel: tFallback("splash.my-sessions.close-btn", "Close session"),
          danger: true
        })
      : Promise.resolve(window.confirm(message));
  });

  ask.then(ok => {
    if (!ok) return;
    if (btn) { btn.disabled = true; btn.textContent = tFallback("splash.my-sessions.closing", "Closing…"); }

    const write = () => db.ref(oPath(c, "closed")).set({
      by: (myName || "Admin").toString().slice(0, 40),
      at: Date.now()
    });

    // ensureSignedIn() is the platform's standard pre-write gate. The
    // closed-write rule now enforces what this list only implied: the
    // writer must BE the session's creator (creatorUid == auth.uid — this
    // browser's persisted anonymous/linked uid) or hold a fresh admin
    // password-proof at adminSecrets/<code>/proof/<uid>. A student who
    // merely knows the code can no longer end the session for everyone.
    const auth = (typeof ensureSignedIn === "function") ? ensureSignedIn() : Promise.resolve();
    return auth.then(write).then(() => {
      if (statusEl) statusEl.textContent = tFallback("splash.my-sessions.closed-ok", "Closed ✓");
      if (btn) btn.textContent = tFallback("splash.my-sessions.closed-btn", "Closed");
      removeMySession(c);
      setTimeout(() => { renderMySessions(); paintMySessionsLink(); }, 700);
    }).catch(e => {
      console.warn("Could not close session", c, e);
      // Distinguish "session no longer exists" from a genuine transient
      // failure. The close-write is denied (PERMISSION_DENIED) when the
      // session's adminPasswordHash is absent — which is exactly what happens
      // once a session has been ended long ago or removed by the retention
      // policy. Such a session can never be closed and is already effectively
      // over, so drop the stale local entry with an honest message instead of
      // nagging the facilitator about their connection. Only fall back to the
      // generic retry message when the session DOES still exist (or we can't
      // tell).
      const showRetry = () => {
        if (statusEl) statusEl.textContent = tFallback("splash.my-sessions.close-failed",
          "Could not close — check your connection and try again.");
        if (btn) {
          btn.disabled = false;
          btn.textContent = tFallback("splash.my-sessions.close-btn", "Close session");
        }
      };
      // Only treat the failure as "already ended" when sessionStatus can
      // CONFIRM the session is gone (reachable + no `created` node). On an
      // unreachable/unknown read, show the retry message rather than wrongly
      // dropping a session that's merely offline.
      const probe = (typeof sessionStatus === "function")
        ? sessionStatus(c) : Promise.reject();
      probe.then(st => {
        if (st && !st.unreachable && !st.exists) {
          if (statusEl) statusEl.textContent = tFallback("splash.my-sessions.ended-on-close",
            "This session has already ended — removing it from your list.");
          if (btn) { btn.disabled = true; btn.textContent = tFallback("splash.my-sessions.closed-btn", "Closed"); }
          removeMySession(c);
          setTimeout(() => { renderMySessions(); paintMySessionsLink(); }, 1200);
        } else {
          showRetry();
        }
      }).catch(showRetry);
    });
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
  /* S7 — the create form's section picker is a LAZY chunk (splash-only code
     behind a click). This is the single choke point every route into the create
     view passes through, so loading it here covers the button, a deep link and
     "Create another" alike — one place instead of three that can drift. */
  if (name === "create")      { try { ensureSectionPicker(); } catch (e) {} }
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
  // The "Today's structure" agenda must match the chosen scenario — it used to
  // be hardcoded to chronic-pain / breaking-bad-news, which read as the wrong
  // session for every other scenario (and especially for branched ones).
  renderLobbyStructure();
  // Reveal the "← Use a different session" escape hatch. The lobby is the
  // ONLY view a returning user with stored canamed_session sees before the
  // (silent) auto-rejoin, so without this they have no visible way back to
  // the splash. User-reported regression 2026-05-18.
  paintLobbySwitchSession();
}

/* Populate the lobby "Today's structure" list from the ACTIVE scenario's
 * module names (set by applyScenario), so the agenda always matches what the
 * room will actually run. Opening presentation + Wrap-up are fixed real-world
 * steps; only the two middle items are scenario-specific. Branched scenarios
 * run the whole case in Stage 1 and use Stage 2 as a reflection/debrief, so
 * their wording differs. Built with textContent (never innerHTML) because the
 * names can be facilitator-authored. */
/* The per-type sentence that follows a section's title in the agenda, used only
   when the section carries no blurb of its own. */
const LOBBY_STRUCT_TAIL = {
  pbl: ", worked through here on the platform.",
  roleplay: ", a cross-cultural roleplay.",
  branched: " — a guided decision case: your team works through it together, " +
            "one decision at a time, then commits a final diagnosis and plan."
};
function renderLobbyStructure() {
  const liA = el("lobby-struct-modA");
  const liB = el("lobby-struct-modB");
  if (!liA || !liB) return;
  const lang = _curLang();
  /* S7 — a session built from PICKED sections has an agenda of its own length,
     and its rows are the sections, not "Module A / Module B". The two shipped
     <li> nodes cannot express that: a three-section session needs three rows,
     and a roleplay-only session needs one that is not called Module A. So the
     rows are generated per pick and the two static ones are hidden.

     Generated rows are rebuilt from scratch on every call (this runs again on a
     language switch and on every lobby paint), and inserted BEFORE the static
     Module-A row so they land between "Opening presentation" and "Wrap-up". */
  const parent = liA.parentNode;
  if (parent) {
    Array.prototype.slice.call(parent.querySelectorAll("li[data-sec-slot]"))
      .forEach(n => { n.parentNode.removeChild(n); });
  }
  let picked = null;
  try { picked = pickedSections(); } catch (_) { picked = null; }
  if (parent && picked && picked.length) {
    liA.hidden = true;
    liB.hidden = true;
    picked.forEach((sec, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-sec-slot", String(i + 1));
      const title = tc(sec.name, lang) ||
                    (STAGE_LABELS[sec.type] || "Section " + (i + 1));
      const s = document.createElement("strong");
      s.textContent = String(title).replace(STAGE_TITLE_PREFIX, "");
      li.appendChild(s);
      /* The section's OWN blurb when it has one — this is where the per-section
         summaries live for a multi-section session, since the one-line lobby
         header cannot carry three of them (publishSectionIdentity). */
      const blurb = tc(sec.summary, lang);
      li.appendChild(document.createTextNode(
        blurb ? " — " + blurb : (LOBBY_STRUCT_TAIL[sec.type] || ".")));
      parent.insertBefore(li, liA);
    });
    return;
  }
  liA.hidden = false;
  const branched = (window.CURRENT_SCENARIO_FORMAT === "branched");
  // Branched scenarios have no Module-B / Reflection step — the agenda lists
  // only the case (between the Welcome and Wrap-up rows). Hide the second item.
  liB.hidden = branched;
  const aName = tc(window.CURRENT_SCENARIO_MODULE_A_NAME, lang)
    || (branched ? "The case" : "Module A — Chronic Pain & the Clinical Case");
  const fill = (li, name, tail) => {
    li.textContent = "";
    const s = document.createElement("strong");
    s.textContent = name;
    li.appendChild(s);
    li.appendChild(document.createTextNode(tail));
  };
  fill(liA, aName, branched ? LOBBY_STRUCT_TAIL.branched : LOBBY_STRUCT_TAIL.pbl);
  if (!branched) {
    const bName = tc(window.CURRENT_SCENARIO_MODULE_B_NAME, lang)
      || "Module B — Breaking Bad News";
    fill(liB, bName, LOBBY_STRUCT_TAIL.roleplay);
  }
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
      msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;").replace(/'/g, "&#39;") + '</p></div>';
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
  // A deep link (?s=CODE) is an EXPLICIT request to join that specific session
  // and must take precedence over the silent auto-resume of a previously-joined
  // session. Without this gate, a user who joined session A and is later handed
  // a link to session B silently lands back in A: the stored pointer short-
  // circuits initEntry (the `return` below) before tryConsumeDeepLink() — which
  // only runs inside showSplash() — ever gets a chance to consume the link.
  // (Reported 2026-06-08.) We still auto-resume when there is no link, or when
  // the link points at the SAME session the device already holds (the smoother
  // path — restores name/consent and rejoins without a splash round-trip). When
  // the link names a DIFFERENT session we fall through to showSplash(), whose
  // tryConsumeDeepLink() joins the new session; the stored A pointer is left
  // intact until that join overwrites it, so a dead-link typo still falls back
  // to resuming A on the next reload rather than stranding the user.
  const linkCode = peekDeepLinkCode();
  if (stored && (!linkCode || linkCode === stored)) {
    sessionStatus(stored).then(status => {
      if (status.exists && !status.closed) {
        enterUnlockedSession(stored);
      } else if (status.unreachable) {
        // Couldn't reach the database (e.g. realtime connection wedged). Do
        // NOT clear the stored code — it may be perfectly valid. Show the
        // splash with a one-shot connectivity hint so the user can retry
        // instead of being stranded on a blank, locked screen.
        try { sessionStorage.setItem("canamed_db_unreachable", "1"); } catch (e) {}
        sessionNum = "";
        showSplash();
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
      const unreachable = sessionStorage.getItem("canamed_db_unreachable");
      if (endedCode) {
        sessionStorage.removeItem("canamed_just_ended_session");
        const hint = el("splash-hint");
        if (hint) {
          hint.textContent = tFallback("splash.enter.previous-session-ended",
            "Your previous session (" + endedCode.toUpperCase() +
            ") has ended. Enter a new code from your facilitator.");
          hint.className = "splash-hint err";
        }
      } else if (unreachable) {
        // Auto-resume bailed because the DB was unreachable (not because the
        // session was closed/invalid). Explain why we're back on the splash
        // and invite a retry — the stored code was intentionally preserved.
        sessionStorage.removeItem("canamed_db_unreachable");
        const hint = el("splash-hint");
        if (hint) {
          hint.textContent = tFallback("splash.enter.unreachable",
            "Couldn't reach the session server. Check your connection and try again.");
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
      if (status.unreachable) {
        // The DB read timed out / the realtime connection is wedged. Surface a
        // real connectivity error + retry rather than the misleading "no
        // session matches" (the code may be perfectly valid) or a silent
        // "Checking…" hang. Keep what the user typed so a retry is one click.
        hint.textContent = tFallback("splash.enter.unreachable",
          "Couldn't reach the session server. Check your connection and try again.");
        hint.className = "splash-hint err";
        shake();
        return;
      }
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
    /* S7 CUTOVER — the SECTION PICK is now the only description of what a
       session runs. The Scenario select is gone, so there is no longer any
       shape to fall back to: an empty pick would create a session with no
       content at all, which used to be masked by the scenario default. Hence
       the pick is REQUIRED here rather than optional as it was in S3b. */
    /* The picker is a lazy chunk. Reaching this handler means the create view
       opened, which triggers the load — but a failed fetch would leave these
       names undefined, and a bare call would throw an unhandled ReferenceError
       out of the submit handler. Report it as what it is instead. */
    if (typeof sectionPickCsv !== "function") {
      cHint.textContent = "Still loading the section list — try again in a moment.";
      cHint.className = "splash-hint err";
      try { ensureSectionPicker(); } catch (_) {}
      return;
    }
    const _sectionCsv = sectionPickCsv();
    if (!_sectionCsv) {
      cHint.textContent = (window.t ? window.t("splash.create.sections-required")
                                    : "Add at least one section to this session.");
      cHint.className = "splash-hint err";
      const addBtn = el("splash-section-add");
      if (addBtn && typeof addBtn.focus === "function") addBtn.focus();
      return;
    }
    /* An authored section too big for the rules' cap must be caught HERE, while
       nothing has been written yet. Its body is written after `created` and
       `recovery` (ordering is forced by the rule), so letting it through leaves
       a half-created session behind and reports the real cause as a connection
       error. Refuse up front, and name the section so it can be shortened. */
    const _snapshot = sectionPickBodies();
    if (_snapshot.oversized.length) {
      const first = _snapshot.oversized[0];
      const pat = (window.t ? window.t("splash.create.section-too-big") : "");
      const tpl = (pat && pat !== "splash.create.section-too-big") ? pat
        : "“{title}” is too large to attach to a session. Shorten it on the authoring board, then try again.";
      cHint.textContent = tpl.replace("{title}", first.title);
      cHint.className = "splash-hint err";
      console.warn("section body over the " + SECTION_BODY_MAX_LEN + "-char cap",
        _snapshot.oversized);
      return;
    }
    cHint.textContent = "Creating session…";
    cHint.className = "splash-hint";
    const _sectionBodies = _snapshot.bodies;
    /* scenarioId / customJson / scenarioRef are all null now. The PARAMETERS
       stay on createSession: they still carry legacy sessions through
       revisit/exports, and scenarioCustomJson remains how a snapshot is pinned.
       Passing null is what retires the create-time path, not deleting them. */
    createSession(name, label, pass, null, null, null,
                  null, _sectionCsv, _sectionBodies).then(result => {
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
      /* The clone-last-workshop summary keeps the SECTION pick now — a
         scenarioId no longer describes what ran. Never the password or the
         session code, only the user-typed config. */
      saveLastWorkshop({
        label: label || null,
        sections: _sectionCsv || null,
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
    }).catch(e => {
      console.error("Create failed", e);
      cHint.textContent = "Could not create the session — check your connection and try again.";
      cHint.className = "splash-hint err";
    });
  };
  if (cForm) cForm.addEventListener("submit", e => { e.preventDefault(); tryCreate(); });

  /* S7 — the SECTION picker is the ONLY content control, but it is no longer
     wired HERE. Its code is the lazy section-picker.js, loaded (and wired, and
     filled) by splashShowView("create") — so nothing is set up until the create
     view is actually opened. Wiring it here as well would only force the chunk
     onto the splash critical path, which is exactly what the split avoids.

     BUT KEEP THE SIDE EFFECT IT USED TO HAVE. populateSectionPicker() ran here
     eagerly, and on a cold splash its "library not loaded yet" branch called
     ensureCaseContent() — so wiring the picker was ALSO what pulled
     case-content.js forward, at splash-wiring time rather than on idle. Nothing
     said so, and dropping it moved CASE/CANAMED_SCENARIOS measurably later:
     anything reading them without awaiting the chunk started losing a race it
     had implicitly won for months. Kick the same fetch off explicitly, so the
     split changes WHERE the picker lives and nothing about when the case
     library arrives. It is a lazy chunk either way — this costs the splash
     budget nothing. */
  try {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      window.CanamedLoader.ensureCaseContent();
    }
  } catch (_) {}

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
    /* S7 — restore the SECTION PICK. A saved scenarioId no longer describes
       what a session runs, and the select it used to drive is gone. Ids that no
       longer resolve (a shared scenario taken down, or one authored by an
       account this browser is no longer signed into) are dropped rather than
       written back as unresolvable tokens. */
    /* typeof-guarded on the lazy picker chunk: this button lives on the create
       view, so the chunk is normally in by now, but a failed load must skip the
       pick restore rather than throw out of the click handler. */
    if (typeof last.sections === "string" && last.sections &&
        typeof sectionLibEntry === "function") {
      splashSectionPick = last.sections.split(",")
        .map(x => x.trim()).filter(Boolean)
        /* DROP custom-<slot> tokens. saveLastWorkshop persists the output of
           sectionPickCsv(), where an authored pick has already become
           "custom-<slot>" — a token that means "the body stored on THAT
           session". Restoring it into a NEW pick would write a token whose
           body no longer accompanies it, giving a session a slot that can
           never resolve. Worse, it can survive the resolve-check below: if
           this tab has since joined a session, registerSectionBodies() has put
           custom-<slot> into CANAMED_SECTIONS, so sectionLibEntry() finds the
           PREVIOUS session's section and cheerfully keeps it. Authored picks
           are re-selected by hand; built-ins clone as before. */
        .filter(id => !/^custom-[1-9]$/.test(id))
        .filter(id => !!sectionLibEntry(id))
        .slice(0, MAX_SECTION_SLOTS);
      renderSectionPick();
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

/* ── S3b — the SECTION PICKER on the create form ──────────────────────────
 * Replaces "Scenario (the clinical case for this workshop)" as the primary
 * control. A session is opening + N independently-picked sections + wrap-up:
 * sections may come from different clinical cases, the same TYPE may appear
 * twice, and PICK ORDER IS RUNNING ORDER.
 *
 * THE CODE LIVES IN THE LAZY section-picker.js. It is splash-only and sits
 * behind a click — the entry view never needs it — so it is off the critical
 * path, repaying the reclaim the perf budget header has demanded since
 * 2026-06-28. ensureSectionPicker() loads it the moment the create view opens;
 * every call site here goes through typeof, because until that load lands the
 * names genuinely do not exist. See section-picker.js for splashSectionPick,
 * populateSectionPicker, renderSectionPick, sectionPickCsv, sectionPickBodies
 * and the authored-section helpers. */
let _sectionPickerChunk = null;
/* Load the picker chunk (once) and bring the form up. Idempotent: re-opening
   the create view re-wires and re-fills, which is also what refreshes an
   authored list that changed while the facilitator signed in. */
function ensureSectionPicker() {
  const start = () => {
    try {
      if (typeof wireSectionPicker === "function") wireSectionPicker();
      if (typeof populateSectionPicker === "function") populateSectionPicker();
      if (typeof loadAuthoredSectionsIntoPicker === "function") loadAuthoredSectionsIntoPicker();
    } catch (e) { console.warn("section picker init failed", e); }
  };
  if (typeof wireSectionPicker === "function") { start(); return Promise.resolve(); }
  const L = (typeof window !== "undefined") && window.CanamedLoader;
  if (!L || typeof L.ensureSectionPicker !== "function") return Promise.resolve();
  if (!_sectionPickerChunk) _sectionPickerChunk = L.ensureSectionPicker();
  return _sectionPickerChunk.then(start).catch(e => {
    /* Keep the cached promise: retrying on every view-open would hammer a
       failing network. The picker stays empty and create refuses an empty pick,
       which is the designed degradation. */
    console.warn("section picker chunk failed to load", e);
  });
}
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
function createSession(creatorName, workshopLabel, password, scenarioId, customJson, scenarioRef, modules, sections, sectionBodies) {
  try { dbInit(); } catch (e) {}
  if (!db) return Promise.reject(new Error("No database"));
  // Round-2 rules require auth != null on every write; wait for the
  // anonymous (or identified) sign-in before any session writes.
  return ensureSignedIn().then(() => {
  // Phase 1 (integrity): when creating from an authored-scenario reference,
  // resolve it to a concrete snapshot now and pin the session to that exact
  // version by storing it inline as scenarioCustomJson. Without this, a later
  // owner edit or delete of the shared scenario would mutate or break this
  // running session, because loadScenarioByRef() reads bodyJson LIVE at each
  // participant load. Degrade gracefully: if the resolve fails (offline /
  // unreadable / oversized) we fall back to storing the live ref (legacy
  // path) so session creation never blocks. The resolve doesn't depend on the
  // session code, so do it once here rather than inside each retry.
  let snapshotPromise = Promise.resolve(null);
  if (!customJson && scenarioRef && scenarioRef.ownerUid && scenarioRef.scenarioId) {
    const resolveBody = loadScenarioByRef(scenarioRef)
      .then((body) => {
        if (!body) return null;
        const s = JSON.stringify(body);
        return (s && s.length > 0 && s.length <= 262144) ? s : null;
      })
      .catch(() => null);
    // Race the resolve against a timeout: `.catch()` only handles rejection, but
    // a hung `.once("value")` (dropped realtime connection) would otherwise leave
    // snapshotPromise pending forever and block session creation. On timeout we
    // resolve null → fall back to the live ref, mirroring sessionStatus().
    let snapTimer;
    const snapTimeout = new Promise((resolve) => {
      snapTimer = setTimeout(() => resolve(null), SESSION_STATUS_TIMEOUT_MS);
    });
    snapshotPromise = Promise.race([resolveBody, snapTimeout])
      .then((r) => { clearTimeout(snapTimer); return r; });
  }
  return snapshotPromise.then((snapshotJson) => {
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
      // creatorUid — the gate for the facilitator-only /rosters email subtree.
      // Write-once, set to OUR uid, in this pre-password create batch (the rule
      // rejects it once adminPasswordHash exists or if it isn't our own uid).
      // A stable (Google) uid lets the facilitator return later to read the
      // roster; an anonymous creator still gets a working gate for this session.
      const _creatorUid = (auth && auth.currentUser && auth.currentUser.uid) ||
                          (currentUser && currentUser.uid) || null;
      if (_creatorUid) {
        writes.push(db.ref(oPath(code, "creatorUid")).set(_creatorUid));
      }
      if (workshopLabel) {
        writes.push(db.ref(oPath(code, "workshopLabel")).set(workshopLabel));
      }
      if (customJson) {
        writes.push(db.ref(oPath(code, "scenarioCustomJson")).set(customJson));
      } else if (snapshotJson && scenarioRef && scenarioRef.ownerUid && scenarioRef.scenarioId) {
        // Pinned snapshot of the authored scenario (Phase 1 integrity). Store
        // the resolved body inline so loadSessionScenario() — which prefers
        // scenarioCustomJson over scenarioRef — always renders this exact
        // version. Keep scenarioRef + a stable scenarioId as provenance (both
        // ignored by the loader once the snapshot exists; used by
        // exports/aggregations and to show which shared scenario this came from).
        const refSrc = scenarioRef.source === "shared" ? "shared" : "private";
        writes.push(db.ref(oPath(code, "scenarioCustomJson")).set(snapshotJson));
        writes.push(db.ref(oPath(code, "scenarioRef")).set({
          ownerUid: scenarioRef.ownerUid,
          scenarioId: scenarioRef.scenarioId,
          source: refSrc
        }));
        if (/^[a-z0-9_-]{1,60}$/.test(scenarioRef.scenarioId)) {
          writes.push(db.ref(oPath(code, "scenarioId")).set(scenarioRef.scenarioId));
        }
      } else if (scenarioRef && scenarioRef.ownerUid && scenarioRef.scenarioId) {
        // Fallback (snapshot resolve failed / oversized): store the live ref,
        // as before. loadScenarioByRef() will read the current bodyJson at load.
        const refSrc = scenarioRef.source === "shared" ? "shared" : "private";
        writes.push(db.ref(oPath(code, "scenarioRef")).set({
          ownerUid: scenarioRef.ownerUid,
          scenarioId: scenarioRef.scenarioId,
          source: refSrc
        }));
        // record a stable scenarioId too — survives the authored scenario
        // being deleted, and keeps existing exports/aggregations that key
        // on scenarioId working unchanged.
        if (/^[a-z0-9_-]{1,60}$/.test(scenarioRef.scenarioId)) {
          writes.push(db.ref(oPath(code, "scenarioId")).set(scenarioRef.scenarioId));
        }
      } else if (scenarioId) {
        writes.push(db.ref(oPath(code, "scenarioId")).set(scenarioId));
      }
      // M2 — the facilitator's per-session module narrowing, write-once (the
      // rule is `!data.exists()`, mirroring scenarioId). Stored as a CSV of
      // module ids. Omitted entirely when they kept everything the scenario
      // offers, so an unnarrowed session is byte-identical to M1.
      const modCsv = Array.isArray(modules)
        ? modules.map(m => String(m).trim()).filter(Boolean).join(",")
        : "";
      if (modCsv) writes.push(db.ref(oPath(code, "modules")).set(modCsv));
      /* S3b — the ordered section pick. Write-once, like `modules`: a session's
         shape must not shift under participants mid-flight. */
      if (typeof sections === "string" && sections)
        writes.push(db.ref(oPath(code, "sections")).set(sections));
      /* S7 — AUTHORED sections travel as a per-slot SNAPSHOT, not a reference.
         The CSV can only hold /^[A-Za-z0-9_-]{1,48}$/ tokens (no colons), so an
         authored pick is written as "custom-<slot>" and its body lands here.
         Snapshotting also pins the session to the version it was created with,
         exactly as scenarioCustomJson does — a facilitator editing their
         scenario mid-workshop must not change what a running session shows. */
      /* ORDERING MATTERS: a body's rule requires the `sections` CSV to already
         name `custom-<slot>`, so these cannot ride the same parallel batch as
         the CSV write — a body landing first would be rejected. Chained after
         the batch instead. */
      const _bodyWrites = () => {
        if (!sectionBodies || typeof sectionBodies !== "object") return Promise.resolve();
        return Promise.all(Object.keys(sectionBodies).map(slot => {
          const body = sectionBodies[slot];
          if (typeof body !== "string" || !body) return Promise.resolve();
          return db.ref(oPath(code, "sectionBodies/" + slot)).set(body);
        }));
      };
      return Promise.all(writes)
        .then(_bodyWrites)
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
          return db.ref(oPath(code, "adminPasswordHash")).set(h);   // LOCAL mode only (no rules)
        })
        .then(() => ({ code: code, recoveryCode: recoveryCode }));
    });
  };
  return tryOne(0);
  });
  });
}

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
    "auth/requires-recent-login": "For this action, please sign out and sign back in, then try again.",
    "auth/invalid-email": "That email address does not look valid.",
    "auth/missing-password": "Enter your password.",
    "auth/wrong-password": "Wrong password — try again, or use Create account if this is your first sign-in.",
    "auth/user-not-found": "No account with that email — use Create account to make one.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/weak-password": "Pick a stronger password: at least 8 characters mixing letters, numbers, and symbols.",
    "auth/email-already-in-use": "An account with that email already exists — use Sign in instead."
  };
  if (map[code]) return map[code];
  // Don't surface raw SDK messages to the UI — they can leak internal request
  // URLs or quota strings. Log the code for debugging, show a generic line.
  if (code) { try { console.warn("[auth] unmapped error code:", code); } catch (_) { /* noop */ } }
  return "Sign-in failed — please try again.";
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

/* Cheap password-strength scorer — no zxcvbn dependency. Returns
   { score: 0-4, label: i18n-key, ok: boolean }. ok=true means the
   password is acceptable for account creation (≥8 chars + at least 3 of
   {lowercase, uppercase, digit, symbol}). The score 0-4 drives the
   colored meter; the threshold for ok is score >= 3. */
function scorePassword(pw) {
  pw = String(pw || "");
  if (!pw) return { score: 0, key: "splash.account.pwd-strength-empty", ok: false };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  // Soft penalty for trivially weak strings (single char class regardless of
  // length, or sequences like 12345/abcdef). Doesn't try to be a full check.
  if (classes <= 1 || /(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) {
    score = Math.min(score, 1);
  }
  score = Math.max(0, Math.min(4, score));
  const labels = [
    "splash.account.pwd-strength-veryweak",
    "splash.account.pwd-strength-weak",
    "splash.account.pwd-strength-fair",
    "splash.account.pwd-strength-good",
    "splash.account.pwd-strength-strong"
  ];
  return {
    score: score,
    key: labels[score],
    ok: score >= 3 && pw.length >= 8 && classes >= 3
  };
}

/* Wire the sign-in / sign-up email form: tab toggle, password-strength
   meter, single submit handler that dispatches on data-mode. Idempotent
   — calling it again rebinds without duplicating listeners (we only
   look up by id and use simple guard flags). */
function wireEmailAuthForm() {
  const form    = el("splash-email-form");
  const tabIn   = el("splash-email-mode-signin");
  const tabUp   = el("splash-email-mode-signup");
  const pwIn    = el("splash-password-input");
  const submit  = el("splash-email-submit");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  function applyMode(mode) {
    const isSignup = (mode === "signup");
    form.dataset.mode = isSignup ? "signup" : "signin";
    if (tabIn) {
      tabIn.classList.toggle("is-active", !isSignup);
      tabIn.setAttribute("aria-selected", String(!isSignup));
    }
    if (tabUp) {
      tabUp.classList.toggle("is-active", isSignup);
      tabUp.setAttribute("aria-selected", String(isSignup));
    }
    // Show / hide the sign-up-only rows (confirm field + strength meter).
    Array.from(document.querySelectorAll(".splash-signup-only"))
      .forEach(n => { n.hidden = !isSignup; });
    if (pwIn) {
      pwIn.setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
      pwIn.setAttribute("minlength", isSignup ? "8" : "6");
    }
    if (submit) {
      const key = isSignup ? "splash.account.signup-email" : "splash.account.signin-email";
      submit.setAttribute("data-i18n", key);
      submit.textContent = (window.t ? window.t(key) :
        (isSignup ? "Create account" : "Sign in"));
    }
    // Clear any stale hint from the other mode.
    splashHintOk(el("splash-account-hint"), "");
    if (isSignup) updateStrengthMeter();
  }

  function updateStrengthMeter() {
    const fill  = el("splash-pwd-strength-fill");
    const label = el("splash-pwd-strength-label");
    if (!fill || !label) return;
    const s = scorePassword(pwIn ? pwIn.value : "");
    // 0..4 → width 0..100%; data attribute drives colour via CSS.
    fill.style.width = (s.score * 25) + "%";
    fill.dataset.score = String(s.score);
    label.textContent = (window.t ? window.t(s.key) : s.key);
  }

  if (tabIn) tabIn.addEventListener("click", () => applyMode("signin"));
  if (tabUp) tabUp.addEventListener("click", () => applyMode("signup"));
  if (pwIn)  pwIn.addEventListener("input", () => {
    if (form.dataset.mode === "signup") updateStrengthMeter();
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const em = (el("splash-email-input") || {}).value.trim();
    const pw = (el("splash-password-input") || {}).value || "";
    if (form.dataset.mode === "signup") {
      const pw2 = (el("splash-password-confirm") || {}).value || "";
      const hint = el("splash-account-hint");
      if (pw !== pw2) {
        splashHintErr(hint, (window.t && window.t("splash.account.pwd-mismatch")) ||
          "The two passwords don't match — retype them.");
        return;
      }
      const s = scorePassword(pw);
      if (!s.ok) {
        splashHintErr(hint, (window.t && window.t("splash.account.pwd-too-weak")) ||
          "Pick a stronger password: at least 8 characters with a mix of upper-case, lower-case, digits, and symbols.");
        return;
      }
      signUpWithEmail(em, pw);
    } else {
      signInWithEmail(em, pw);
    }
  });

  applyMode("signin");
}

/* Sign in to an EXISTING email/password account. No anonymous-uid linking
   here — the user is claiming an account that pre-dates this tab, so any
   throwaway anonymous uid is forfeited (same fate as Google sign-in for a
   returning user). For first-time account creation, see signUpWithEmail. */
function signInWithEmail(email, password) {
  const hint = el("splash-account-hint");
  if (!auth) { splashHintErr(hint, "Sign-in is not available in local-test mode."); return; }
  if (!email || !password) {
    splashHintErr(hint, "Enter your email and password.");
    return;
  }
  splashHintOk(hint, "Signing you in…");
  auth.signInWithEmailAndPassword(email, password)
    .then(() => splashHintOk(hint, ""))
    .catch(e => splashHintErr(hint, authErrorMessage(e)));
}

/* Create a new email/password account. If the caller is currently anonymous
   we LINK the credential so users/{uid}/profile + history written under the
   anon uid survive the upgrade. If the email is already in use, salvage by
   signing in with the typed credential directly — same fall-back as the
   Google flow. */
function signUpWithEmail(email, password) {
  const hint = el("splash-account-hint");
  if (!auth) { splashHintErr(hint, "Sign-in is not available in local-test mode."); return; }
  if (!email || !password) {
    splashHintErr(hint, "Enter your email and password.");
    return;
  }
  // Backstop must not be weaker than the UI strength gate: enforce the same
  // policy (>= 8 chars AND >= 3 character classes) for ANY caller of this
  // function, not just the wired form (2026-05-30 R2 review).
  if (!scorePassword(password).ok) {
    splashHintErr(hint, authErrorMessage({ code: "auth/weak-password" }));
    return;
  }
  splashHintOk(hint, "Creating your account…");
  const cur = auth.currentUser;
  const cred = firebase.auth.EmailAuthProvider.credential(email, password);
  const link = (cur && cur.isAnonymous)
    ? cur.linkWithCredential(cred).catch(e => {
        if (e && (e.code === "auth/credential-already-in-use" ||
                  e.code === "auth/email-already-in-use")) {
          // returning user — burn the throwaway anon uid, sign in as them
          return auth.signInWithCredential(cred);
        }
        throw e;
      })
    : auth.createUserWithEmailAndPassword(email, password)
        .catch(e => {
          if (e && e.code === "auth/email-already-in-use") {
            return auth.signInWithEmailAndPassword(email, password);
          }
          throw e;
        });
  link.then(() => splashHintOk(hint, ""))
      .catch(e => splashHintErr(hint, authErrorMessage(e)));
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
      // Refresh the create-session picker so this user's authored scenarios
      // (and any shared ones they can now see) show up immediately after
      // sign-in. Idempotent + cheap; safe to call even if the picker is
      // not currently on screen.
      try {
        /* A user's own scenarios are unreadable until they are signed in, so a
           picker painted before sign-in lists built-ins only — refresh it.
           Guarded by typeof: the picker is a lazy chunk now, and signing in
           without ever opening the create view means it was never loaded (there
           is then nothing on screen to refresh either). */
        if (typeof loadAuthoredSectionsIntoPicker === "function") {
          loadAuthoredSectionsIntoPicker();
        }
      } catch (_) {}
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
    // The signed-in uid was persisted as the stableId; drop it so the next
    // person on this browser is not stamped with the previous account's id.
    resetStableId();
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
    // Same stale-identifier problem as sign-out, and more acute: the account
    // is gone, so its uid must not linger as this browser's stableId.
    resetStableId();
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
  wireEmailAuthForm();

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

/* ===================== Reference toolbar (Modules A & B) =====================
 * The three reference lookups (historical context / guidelines / recap) sit as
 * a single row of buttons at the TOP of each module; clicking a button expands
 * its panel below and collapses the others (accordion — one open at a time).
 * Buttons carry aria-controls → panel id and toggle aria-expanded; panels use
 * the `hidden` attribute. Static HTML, wired once (idempotent). */
function wireReferenceToolbars() {
  document.querySelectorAll(".reference-toolbar").forEach(bar => {
    if (bar.dataset.wired === "1") return;
    bar.dataset.wired = "1";
    const btns = Array.prototype.slice.call(bar.querySelectorAll(".reference-btn"));
    const panelOf = btn => {
      const id = btn.getAttribute("aria-controls");
      return id ? document.getElementById(id) : null;
    };
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        const wasOpen = btn.getAttribute("aria-expanded") === "true";
        // Close every button/panel in this toolbar group first.
        btns.forEach(b => {
          b.setAttribute("aria-expanded", "false");
          const p = panelOf(b);
          if (p) p.hidden = true;
        });
        // A second click on the already-open button just closes it.
        if (!wasOpen) {
          btn.setAttribute("aria-expanded", "true");
          const panel = panelOf(btn);
          if (panel) panel.hidden = false;
        }
      });
    });
  });
}

/* ===================== Back-to-top button =====================
 * The stage card no longer pins to the top of the viewport (2026-06-02), so a
 * floating "↑ Back to top" button gives a one-tap return to the top once the
 * user has scrolled down. Visibility is throttled via requestAnimationFrame. */
function wireBackToTop() {
  const btn = document.getElementById("back-to-top");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  const SHOW_AFTER = 600;
  let ticking = false;
  const sync = () => {
    ticking = false;
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;
    btn.classList.toggle("is-visible", y > SHOW_AFTER);
  };
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(sync);
  }, { passive: true });
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  sync();
}

/* ===================== START ===================== */
initEntry();
initObserverChecklist();
wireReferenceToolbars();
wireBackToTop();

