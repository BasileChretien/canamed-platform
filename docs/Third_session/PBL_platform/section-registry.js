/* ===================================================================
 * section-registry.js — the flat SECTION library
 *
 * S0 of the section model (ARCHITECTURE/section-model-design.md). A session
 * stops being "one scenario, optionally narrowed" and becomes an ordered list
 * of independently-picked SECTIONS: opening + N sections + wrap-up, where two
 * sections may come from two different clinical cases.
 *
 * This file DERIVES that flat library from the existing scenario registry
 * rather than duplicating its content — one source of truth, no migration, and
 * a scenario stays the authoring container until S5 replaces it. Each standard
 * scenario yields two sections (a PBL and a Roleplay); a branched scenario
 * yields one.
 *
 * S0 IS INERT. Nothing loads this in the browser yet (no <script> tag, so no
 * shell-version bump and no splash perf cost); the runtime still runs the
 * scenarioId path. S1 wires it in.
 * ================================================================ */

(function (root, factory) {
  const exports_ = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports_;
  }
  if (typeof window !== "undefined") {
    Object.keys(exports_).forEach(k => { window[k] = exports_[k]; });
    window.CanamedSections = exports_;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ── Section types ────────────────────────────────────────────────────────
     The three skeleton types a facilitator can start from (user, 2026-07-27:
     "they must be called something like PBL, Roleplay, Branched Scenario").
     Type ids are opaque strings, like module ids — adding a 4th type must stay
     additive. Only the platform owner adds TYPES; facilitators add INSTANCES. */
  const SECTION_TYPES = [
    { id: "pbl",      label: "PBL",               fromModule: "A" },
    { id: "roleplay", label: "Roleplay",          fromModule: "B" },
    { id: "branched", label: "Branched Scenario", fromModule: null }
  ];

  /* ── Which built-in case yields which sections ────────────────────────────
     Section ids are `<case>-<type>` — stable, source-traceable, and distinct
     from the scenario ids so the two registries can coexist through S1-S5.
     The branched case keeps its EXISTING id: it is already a registry key and
     is referenced by `branchedRef` in composed scenarios (M4c), so renaming it
     would silently break those references. */
  const SECTION_SOURCES = [
    { scenarioId: "chronic-pain-opioids",          slug: "chronic-pain" },
    { scenarioId: "breaking-bad-news-disclosure",  slug: "jaundice" },
    { scenarioId: "respiratory-stewardship",       slug: "sore-throat" },
    { scenarioId: "ward-escalation-branched",      slug: null /* keeps its id */ }
  ];

  /* ── Per-item test classification (decision 3 + 10) ───────────────────────
     Each scenario ships ONE pre-test and ONE post-test covering both of its
     modules. A section owns its own items, so every item must be assigned to
     exactly one section type. This map is written out ITEM BY ITEM rather than
     by a rule, because the assignment is a clinical-education judgement the
     medical author must be able to review and correct in one place — and
     because `assertClassified()` can then fail loudly when a NEW test item is
     added without being classified, instead of defaulting it silently.

     Distribution is deliberately uneven and reflects the content as written:
     the jaundice case's items are almost entirely disclosure/communication, so
     its PBL section starts with ~1 item. See
     ARCHITECTURE/section-test-items-proposal.md for drafted PBL items awaiting
     medical review — they are NOT merged here. */
  const TEST_SPLIT = {
    "chronic-pain-opioids": {
      pre: { q1: "pbl",      /* red flags → urgent imaging          */
             q2: "pbl",      /* MRI not indicated                   */
             q3: "pbl",      /* first-line pharmacological          */
             q4: "pbl",      /* yellow flags                        */
             q5: "roleplay", /* responding to a named-drug request  */
             q6: "pbl",      /* definition of chronic               */
             q7: "pbl",      /* first-line non-pharmacological      */
             q8: "pbl",      /* paracetamol alone                   */
             q9: "pbl",      /* fear-avoidance management           */
             q10: "pbl" },   /* natural history                     */
      post: { q1: "pbl",       /* guideline-supported combination     */
              q2: "roleplay",  /* addressing a damage belief          */
              q3: "roleplay",  /* France/HAS vs JOA comparison        */
              q4: "pbl",       /* determinant of long-term outcome    */
              q5: "roleplay",  /* cross-cultural discussion recall    */
              q6: "pbl",       /* long-term opioid evidence           */
              q7: "pbl",       /* repeat imaging                      */
              q8: "pbl",       /* yellow flags → added intervention   */
              q9: "roleplay",  /* framing a non-opioid plan           */
              q10: "pbl" }     /* what success looks like             */
    },
    "breaking-bad-news-disclosure": {
      pre: { q1: "roleplay",  /* who decides how much is told        */
             q2: "roleplay",  /* SPIKES — Invitation                 */
             q3: "roleplay",  /* Loi Kouchner                        */
             q4: "roleplay",  /* Japanese disclosure practice        */
             q5: "roleplay",  /* family asks you not to tell         */
             q6: "roleplay",  /* language of the disclosure          */
             q7: "roleplay",  /* SPIKES — Setting                    */
             q8: "roleplay",  /* SPIKES — Empathy                    */
             q9: "roleplay",  /* the right not to know               */
             q10: "roleplay" },/* SPIKES — Perception                */
      post: { q1: "roleplay",  /* resolving family-vs-patient         */
              q2: "roleplay",  /* prognosis via SPIKES                */
              q3: "pbl",       /* ERCP biliary stenting — management  */
              q4: "roleplay",  /* France/Japan comparison             */
              q5: "roleplay",  /* capacity assessment                 */
              q6: "roleplay",  /* who attends the consultation        */
              q7: "roleplay",  /* silence after disclosure            */
              q8: "roleplay",  /* advance care planning               */
              q9: "roleplay",  /* softer Japanese clinical language   */
              q10: "roleplay" }/* transferable lesson                 */
    },
    "respiratory-stewardship": {
      pre: { q1: "pbl",       /* Centor/McIsaac criteria             */
             q2: "pbl",       /* management at Centor 0              */
             q3: "pbl",       /* delayed (back-pocket) prescribing   */
             q4: "pbl",       /* amoxicillin in EBV                  */
             q5: "roleplay",  /* MHLW AMR national plan target       */
             q6: "pbl" },     /* FeverPAIN                           */
      post: { q1: "roleplay",  /* "it always works for me"            */
              q2: "roleplay",  /* what to offer instead               */
              q3: "roleplay",  /* France/Japan financial signal       */
              q4: "roleplay",  /* AMR in the individual consultation  */
              q5: "roleplay",  /* cross-cultural summary              */
              q6: "pbl" }      /* amoxicillin & the COC pill          */
    }
  };

  /* Strip the "Module A — " / "Module B — " prefix from a trilingual name.
     Decision 8 makes the student-facing label "Section k — <title>", so the
     A/B wording must not survive into a section title. Derived rather than
     re-typed so the three built-ins keep ONE source of truth, and so an
     authored scenario imported later is cleaned the same way. */
  const MODULE_PREFIX = /^\s*(?:Module|モジュール)\s*[AB]\s*[—–-]\s*/;
  function stripModulePrefix(tri) {
    if (!tri || typeof tri !== "object") return tri;
    const out = {};
    Object.keys(tri).forEach(lang => {
      const v = tri[lang];
      out[lang] = (typeof v === "string") ? v.replace(MODULE_PREFIX, "") : v;
    });
    return out;
  }

  function testItemsFor(scenarioId, which, type) {
    const map = TEST_SPLIT[scenarioId] && TEST_SPLIT[scenarioId][which];
    if (!map) return null;
    return function (items) {
      if (!Array.isArray(items)) return [];
      return items.filter(it => it && map[it.id] === type);
    };
  }

  /* Every test item must be classified. Returns the unclassified ones so a unit
     test can fail when a new item is added without a decision being taken —
     the whole point of writing TEST_SPLIT out item by item. */
  function unclassifiedTestItems(scenarios) {
    const missing = [];
    Object.keys(scenarios || {}).forEach(sid => {
      const sc = scenarios[sid];
      if (!sc || sc.format === "branched") return;
      [["pre", "preTest"], ["post", "postTest"]].forEach(pair => {
        const items = sc[pair[1]];
        if (!Array.isArray(items)) return;
        const map = (TEST_SPLIT[sid] || {})[pair[0]] || {};
        items.forEach(it => {
          if (!it || !map[it.id]) missing.push(sid + "." + pair[0] + "." + (it && it.id));
        });
      });
    });
    return missing;
  }

  function byModule(list, mod) {
    if (!Array.isArray(list)) return [];
    return list.filter(x => {
      if (!x) return false;
      const m = x.module;
      if (Array.isArray(m)) return m.indexOf(mod) !== -1;
      return m === mod;
    });
  }

  /* Build ONE section from a scenario + a type. Returns null when the scenario
     has no content for that type (so a single-module scenario yields one
     section, not an empty second one). */
  function buildSection(scenario, slug, typeId) {
    const type = SECTION_TYPES.find(t => t.id === typeId);
    if (!scenario || !type) return null;

    if (typeId === "branched") {
      if (scenario.format !== "branched") return null;
      return {
        id: scenario.id,
        type: "branched",
        source: scenario.id,
        name: stripModulePrefix(scenario.name),
        summary: scenario.summary || null,
        /* A branched section is the whole case: its graph, its deliverable and
           its documents already live at the top level, and the branched engine
           reads them from there (M4c). Passed through unchanged so composition
           keeps resolving exactly what it resolves today. */
        content: {
          format: "branched",
          decisions: scenario.decisions || [],
          characters: scenario.characters || [],
          finalStep: scenario.finalStep || null,
          documents: scenario.documents || null
        },
        preTest: [],
        postTest: []
      };
    }

    const mod = type.fromModule;
    const name = stripModulePrefix(scenario["module" + mod + "Name"]);
    const scoring = (scenario.scoring || {})["module" + mod] || [];
    const decisions = byModule(scenario.decisions, mod);
    /* A section exists when the case names it OR gives it content — the same
       name-first precedence scenarioModuleSet() uses (module-set-design M1), so
       a section library derived here runs the same modules the scenario does. */
    const named = !!(name && name.en);
    if (!named && !scoring.length && !decisions.length) return null;

    const section = {
      id: slug + "-" + typeId,
      type: typeId,
      source: scenario.id,
      name: name || null,
      /* Per-section blurbs are not authored yet: the case summary describes
         BOTH modules. S3 shows one blurb per picked section, so these need
         writing — tracked in section-test-items-proposal.md. */
      summary: scenario.summary || null,
      summaryIsCaseWide: true,
      content: { scoring: scoring, decisions: decisions,
                 characters: byModule(scenario.characters, mod) },
      preTest: [],
      postTest: []
    };

    /* The workup items, their penalties and the synthesis gate belong to the
       PBL section only — a roleplay has no history/exam/investigation board. */
    if (typeId === "pbl") {
      section.content.case = scenario.case || null;
      section.content.penalties = scenario.penalties || [];
      section.content.synthId = scenario.synthId || null;
      section.content.synthPrereqs = scenario.synthPrereqs || [];
    }

    const pre = testItemsFor(scenario.id, "pre", typeId);
    const post = testItemsFor(scenario.id, "post", typeId);
    section.preTest = pre ? pre(scenario.preTest) : [];
    section.postTest = post ? post(scenario.postTest) : [];
    return section;
  }

  /* Derive the whole flat library. Order is the SECTION_SOURCES order, PBL
     before Roleplay within a case — the order the picker will list them in. */
  function buildSectionRegistry(scenarios) {
    const out = {};
    (SECTION_SOURCES).forEach(src => {
      const sc = (scenarios || {})[src.scenarioId];
      if (!sc) return;              // branched-seed.js may not have loaded yet
      const types = (sc.format === "branched") ? ["branched"] : ["pbl", "roleplay"];
      types.forEach(t => {
        const sec = buildSection(sc, src.slug, t);
        if (sec) out[sec.id] = sec;
      });
    });
    return out;
  }

  return { SECTION_TYPES, SECTION_SOURCES, TEST_SPLIT, MODULE_PREFIX,
           stripModulePrefix, byModule, buildSection, buildSectionRegistry,
           unclassifiedTestItems };
});
