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
 * LIFECYCLE: this landed INERT in S0 (nothing loaded it), and is now LIVE —
 * loaded lazily by ensureCaseContent() for the room and the author, and by
 * revisit.html, off the splash critical path so it costs no splash bytes. The
 * runtime reads it through pickedSections()/sectionSlots(); a session with no
 * explicit pick still falls back to the scenario shape.
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
             q10: "pbl",     /* natural history                     */
             /* Approved 2026-07-28: the roleplay half had ONE pre-test item of
                its own (q5). These three test the consultation skills the
                section actually rehearses, without repeating the jaundice
                roleplay's SPIKES bank. */
             q11: "roleplay",/* opening an unwelcome refusal        */
             q12: "roleplay",/* the warning shot                    */
             q13: "roleplay" },/* SPIKES — Strategy & Summary       */
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
             q10: "roleplay",/* SPIKES — Perception                 */
             /* Approved 2026-07-28: the workup items this case never had. The
                jaundice PBL section had ZERO pre-test items of its own. */
             q11: "pbl",     /* Courvoisier's sign                  */
             q12: "pbl",     /* first-line imaging                  */
             q13: "pbl",     /* cholestatic LFT pattern             */
             q14: "pbl",     /* new diabetes + weight loss          */
             q15: "pbl",     /* role of CA 19-9                     */
             q16: "pbl" },   /* staging for resectability           */
      post: { q1: "roleplay",  /* resolving family-vs-patient         */
              q2: "roleplay",  /* prognosis via SPIKES                */
              q3: "pbl",       /* ERCP biliary stenting — management  */
              q4: "roleplay",  /* France/Japan comparison             */
              q5: "roleplay",  /* capacity assessment                 */
              q6: "roleplay",  /* who attends the consultation        */
              q7: "roleplay",  /* silence after disclosure            */
              q8: "roleplay",  /* advance care planning               */
              q9: "roleplay",  /* softer Japanese clinical language   */
              q10: "roleplay",/* transferable lesson                */
              q11: "pbl",     /* tissue diagnosis before chemo      */
              q12: "pbl",     /* stage BEFORE stenting              */
              q13: "pbl",     /* pancreatic enzyme replacement      */
              q14: "pbl" }    /* early palliative care              */
    },
    "respiratory-stewardship": {
      pre: { q1: "pbl",       /* Centor/McIsaac criteria             */
             q2: "pbl",       /* management at Centor 0              */
             q3: "pbl",       /* delayed (back-pocket) prescribing   */
             q4: "pbl",       /* amoxicillin in EBV                  */
             q5: "roleplay",  /* MHLW AMR national plan target       */
             q6: "pbl",       /* FeverPAIN                           */
             /* Approved 2026-07-28: the roleplay half had ONE pre-test item. */
             q7: "roleplay",  /* satisfaction ≠ getting a script     */
             q8: "roleplay",  /* the misread-expectation driver      */
             q9: "roleplay" },/* what makes safety-netting work      */
      post: { q1: "roleplay",  /* "it always works for me"            */
              q2: "roleplay",  /* what to offer instead               */
              q3: "roleplay",  /* France/Japan financial signal       */
              q4: "roleplay",  /* AMR in the individual consultation  */
              q5: "roleplay",  /* cross-cultural summary              */
              q6: "pbl",       /* amoxicillin & the COC pill          */
              /* Approved 2026-07-28: the PBL half had ONE post-test item. */
              q7: "pbl",       /* what a positive RADT establishes    */
              q8: "pbl",       /* which complication treatment averts */
              q9: "pbl" }      /* first-line agent once GAS confirmed */
    }
  };

  /* ── Per-section blurbs ───────────────────────────────────────────────────
     A case summary describes BOTH of its halves ("Module A is the workup;
     Module B is the roleplay"), so a section cannot inherit it: stage 0 prints
     one blurb per PICKED section (decision 4), and a mixed session would
     otherwise advertise content it does not run.

     English only, deliberately. The platform is English-canonical since the
     reading-aid work — t() renders English for everything outside the
     consent/safety whitelist — so a trilingual blurb would be three strings to
     maintain and one to display. DRAFT: written from each section's own
     content, awaiting the author's review alongside
     ARCHITECTURE/section-test-items-proposal.md. */
  const SECTION_SUMMARIES = {
    "chronic-pain-pbl": { en:
      "A 45-year-old office worker with 8 months of low-back pain asks for " +
      "oxycodone by name. Work the pain up, sort red flags from yellow flags, " +
      "and build a plan that does not start with an opioid." },
    "chronic-pain-roleplay": { en:
      "Play the consultation in which the requested opioid is declined — " +
      "keeping the patient's pain credible and the relationship intact, across " +
      "a French and a Japanese consulting style." },
    "jaundice-pbl": { en:
      "A 75-year-old woman presents with painless obstructive jaundice. Work " +
      "through the biochemistry and imaging to a diagnosis of Stage IV " +
      "pancreatic adenocarcinoma, and decide what to do about the biliary " +
      "obstruction." },
    "jaundice-roleplay": { en:
      "The patient's adult son asks the team, privately, not to tell his " +
      "mother. Run the disclosure with SPIKES, between France's Loi-Kouchner " +
      "default of direct patient information and Japan's evolving " +
      "family-mediated tradition." },
    "sore-throat-pbl": { en:
      "A 32-year-old with five days of pharyngitis and a Centor/McIsaac score " +
      "of 0 wants amoxicillin before a Friday presentation. Score the throat, " +
      "weigh delayed prescribing, and land on a no-antibiotic plan you can " +
      "defend." },
    "sore-throat-roleplay": { en:
      "Hold the conversation with a patient who has already decided she needs " +
      "antibiotics — against France's persistently high outpatient prescribing " +
      "and Japan's AMR action plan and stewardship premium." },
    "ward-escalation-branched": { en:
      "A breathless patient on the ward deteriorates. The team works through a " +
      "branching decision tree in which each choice reveals its consequence and " +
      "opens the next fork." }
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
        summary: SECTION_SUMMARIES[scenario.id] || scenario.summary || null,
        summaryIsCaseWide: !SECTION_SUMMARIES[scenario.id],
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

    const id = slug + "-" + typeId;
    const section = {
      id: id,
      type: typeId,
      source: scenario.id,
      name: name || null,
      /* Falls back to the case-wide summary only for a section with no blurb of
         its own — an authored one, until S5 gives the author a blurb field. */
      summary: SECTION_SUMMARIES[id] || scenario.summary || null,
      summaryIsCaseWide: !SECTION_SUMMARIES[id],
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

  return { SECTION_TYPES, SECTION_SOURCES, TEST_SPLIT, SECTION_SUMMARIES, MODULE_PREFIX,
           stripModulePrefix, byModule, buildSection, buildSectionRegistry,
           unclassifiedTestItems };
});
