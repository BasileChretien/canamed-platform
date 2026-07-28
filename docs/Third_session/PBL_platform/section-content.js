/* ===================================================================
 * section-content.js — a Roleplay section's authorable CONTENT
 *
 * Extracted from script.js in S3a: every renderer here is ROOM-ONLY (a
 * roleplay's cast, reference panels, observation framework, title and
 * vignette), so carrying it in the shell spent ~6 KB gzipped of the splash
 * budget on code the splash never runs. The section work had pushed
 * first-party JS+CSS to 342.5 KB against a 337 KB cap; this is the reclaim.
 *
 * Loaded as a HARD ROOM DEPENDENCY, chained into ensureRoomStyles() — which
 * room entry already awaits before revealing the app — so in-room every one of
 * these is present under its bare name. The applyScenario() call sites stay
 * `typeof`-guarded for the splash, where none of it is used.
 *
 * Functions are published on `window` so script.js keeps calling them by bare
 * name (roleplayRoles(), renderObserverChecklist(), …), exactly like
 * pure-utils.js.
 * ================================================================ */

(function (root) {
  "use strict";
  const el = function (id) { return document.getElementById(id); };
  const _curLang = function () {
    return (typeof root._curLang === "function") ? root._curLang() : "en";
  };
  const tc = function (v, lang) {
    return (typeof root.tc === "function") ? root.tc(v, lang) : v;
  };

  /* ── S1c-1 — the roleplay's ROLE SET becomes section data ─────────────────────
   * A Roleplay section's cast used to be hardcoded in three places at once: the
   * four `.role-chip` buttons in index.html, ASSIGN_ROLE_DECK and
   * REPLAY_ROLE_ORDER — so every roleplay in the platform was necessarily
   * physician / patient / family / observer, with Mrs Tanaka's briefs. A
   * facilitator authoring their own roleplay (a pharmacist and a prescriber; a
   * nurse, a relative and two clinicians) had nothing to change.
   *
   * The cast is now ONE list, read from the active section. Defaults reproduce
   * today's four roles exactly — including their i18n keys — so the built-in
   * roleplays are unchanged until a section declares its own.
   *
   * Names and briefs may be given inline by an authored section; the built-ins
   * keep resolving through i18n (`modB.role.<id>.name` / `.brief`), which is
   * where their translations already live. */
  const ROLEPLAY_DEFAULT_ROLES = [
    { id: "physician", nameKey: "modB.role.physician.name", briefKey: "modB.role.physician.brief" },
    { id: "patient",   nameKey: "modB.role.patient.name",   briefKey: "modB.role.patient.brief" },
    { id: "family",    nameKey: "modB.role.family.name",    briefKey: "modB.role.family.brief" },
    { id: "observer",  nameKey: "modB.role.observer.name",  briefKey: "modB.role.observer.brief" }
  ];
  /* The cast of the roleplay section this session runs. An authored section
     supplies `roleplay.roles`; anything it omits falls back to the default entry
     with the same id, so a section may rename one role without restating all of
     them. Ids are validated (they become DOM data-role values and RTDB keys). */
  function roleplayRoles() {
    const declared = (typeof window !== "undefined") && window.CURRENT_SECTION_ROLEPLAY;
    const list = declared && Array.isArray(declared.roles) ? declared.roles : null;
    if (!list || !list.length) return ROLEPLAY_DEFAULT_ROLES.slice();
    const out = [];
    list.forEach(r => {
      const id = r && typeof r.id === "string" ? r.id.trim() : "";
      if (!/^[a-z][a-z0-9_-]{0,23}$/.test(id)) return;   // DOM + RTDB safe
      if (out.some(o => o.id === id)) return;            // a duplicate would break the deck
      const base = ROLEPLAY_DEFAULT_ROLES.find(d => d.id === id) || {};
      out.push({ id: id,
                 name: r.name || null, nameKey: base.nameKey || null,
                 brief: r.brief || null, briefKey: base.briefKey || null });
    });
    /* A declaration that resolves to NOTHING usable (all ids malformed) falls
       back rather than leaving a roleplay with no cast at all. */
    return out.length ? out : ROLEPLAY_DEFAULT_ROLES.slice();
  }
  function roleplayRoleIds() { return roleplayRoles().map(r => r.id); }
  function roleplayRole(id) { return roleplayRoles().find(r => r.id === id) || null; }

  /* ── S1c-2 — the roleplay's REFERENCE PANELS become optional section data ─────
   * The four panels behind the roleplay toolbar (historical context, guidelines,
   * recap, useful sentences) are static case-specific prose in index.html, shown
   * to every roleplay regardless of the case — so a facilitator's own roleplay
   * still displayed France/Japan disclosure history.
   *
   * Decision 11: every panel is OPTIONAL. A section fills what it wants; an
   * unfilled panel DISAPPEARS (button and all) rather than rendering blank.
   *
   * Built-ins are untouched by construction: a section that declares no `panels`
   * key at all leaves the shipped markup exactly as authored — same no-op
   * discipline as renderRoleChips(). Declaring `panels` opts INTO full control,
   * so an authored section shows only its own panels.
   *
   * Panel content shape (all fields optional):
   *   { label: "…", paragraphs: ["…"], bullets: ["…"] }                        */
  const ROLEPLAY_PANEL_IDS = ["history", "guidelines", "recap", "useful"];

  function roleplayPanels() {
    const rp = (typeof window !== "undefined") && window.CURRENT_SECTION_ROLEPLAY;
    return (rp && typeof rp.panels === "object" && rp.panels) ? rp.panels : null;
  }
  /* Fill one panel from data. Text only — createElement + textContent, never
     innerHTML: every string here is facilitator-authored. */
  function _fillRoleplayPanel(node, spec) {
    node.textContent = "";
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    const str = v => (typeof v === "object" && typeof tc === "function")
      ? tc(v, lang) : String(v == null ? "" : v);
    if (spec.label) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = str(spec.label);
      p.appendChild(strong);
      node.appendChild(p);
    }
    (Array.isArray(spec.paragraphs) ? spec.paragraphs : []).forEach(t => {
      const p = document.createElement("p");
      p.textContent = str(t);
      node.appendChild(p);
    });
    if (Array.isArray(spec.bullets) && spec.bullets.length) {
      const ul = document.createElement("ul");
      ul.className = "info-list";
      spec.bullets.forEach(t => {
        const li = document.createElement("li");
        li.textContent = str(t);
        ul.appendChild(li);
      });
      node.appendChild(ul);
    }
  }
  function renderRoleplayPanels() {
    const panels = roleplayPanels();
    if (!panels) return;              // built-in: leave the shipped markup alone
    ROLEPLAY_PANEL_IDS.forEach(id => {
      const node = el("refB-panel-" + id);
      const btn = el("refB-btn-" + id);
      const spec = panels[id];
      const on = !!(spec && typeof spec === "object");
      /* Hide the BUTTON as well as the panel: a toolbar button that opens an
         empty region is worse than an absent one, and the toolbar is a row of
         buttons the accordion wiring walks. */
      if (btn) btn.classList.toggle("hidden", !on);
      if (!node) return;
      if (!on) { node.textContent = ""; node.hidden = true; return; }
      _fillRoleplayPanel(node, spec);
    });
  }

  /* ── S1c-3a — the OBSERVATION FRAMEWORK becomes a shipped library ─────────────
   * The observer's tick-list was SPIKES, hardcoded as six <li> in index.html — so
   * an antibiotic-negotiation roleplay handed its observer a breaking-bad-news
   * checklist. Decision 11: the checklist comes from a small library I own (the
   * same rule as the skeleton types — code-owned frameworks, facilitator-owned
   * instances), with a custom escape hatch.
   *
   * A section picks one by id (`roleplay.framework: "calgary-cambridge"`) or
   * supplies its own (`{ label, steps: [{ id, label }] }`). Declaring nothing
   * leaves the shipped SPIKES markup untouched — the same no-op discipline as the
   * chips and panels, so the built-in roleplays cannot regress.
   *
   * SPIKES keeps its i18n keys (its translations already exist). The frameworks
   * added here ship English-only, per the English-canonical policy. */
  const OBSERVATION_FRAMEWORKS = {
    spikes: {
      label: "SPIKES",
      steps: [
        { id: "s",  labelKey: "modB.obs.s" },
        { id: "p",  labelKey: "modB.obs.p" },
        { id: "i",  labelKey: "modB.obs.i" },
        { id: "k",  labelKey: "modB.obs.k" },
        { id: "e",  labelKey: "modB.obs.e" },
        { id: "s2", labelKey: "modB.obs.s2" }
      ]
    },
    "calgary-cambridge": {
      label: "Calgary–Cambridge",
      steps: [
        { id: "cc1", label: "Initiating the session — greeting, agenda, the patient's opening concern" },
        { id: "cc2", label: "Gathering information — open questions first, then focused ones" },
        { id: "cc3", label: "Providing structure — signposting and summarising along the way" },
        { id: "cc4", label: "Building the relationship — acknowledging feelings, involving the patient" },
        { id: "cc5", label: "Explanation and planning — chunked information, checked understanding" },
        { id: "cc6", label: "Closing the session — agreed next step, safety-netting" }
      ]
    },
    "pause-explore-explain-realign": {
      label: "Pause / Explore / Explain / Realign",
      steps: [
        { id: "pe1", label: "Pause — stopped rather than answering the demand straight away" },
        { id: "pe2", label: "Explore — asked what is behind the request" },
        { id: "pe3", label: "Explain — gave the reasoning in plain language, no jargon wall" },
        { id: "pe4", label: "Realign — offered a plan that meets the underlying need" }
      ]
    }
  };
  /* The framework this roleplay observes with, or null to keep the shipped one. */
  function observationFramework() {
    const rp = (typeof window !== "undefined") && window.CURRENT_SECTION_ROLEPLAY;
    const f = rp && rp.framework;
    if (!f) return null;
    if (typeof f === "string") return OBSERVATION_FRAMEWORKS[f] || null;
    if (typeof f === "object" && Array.isArray(f.steps)) {
      const steps = f.steps
        .filter(s => s && typeof s.id === "string" && /^[a-z0-9_-]{1,16}$/i.test(s.id))
        .map(s => ({ id: s.id, label: s.label || s.id }));
      /* Step ids are sessionStorage keys for the observer's private scratchpad;
         a malformed one would silently fail to persist. A custom framework with
         no usable step is ignored rather than emptying the checklist. */
      return steps.length ? { label: f.label || "Observation", steps: steps } : null;
    }
    return null;
  }
  function renderObserverChecklist() {
    const fw = observationFramework();
    if (!fw) return;                 // built-in: leave the shipped SPIKES list
    const root = document.getElementById("observer-checklist");
    if (!root) return;
    const ul = root.querySelector("ul");
    if (!ul) return;
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    ul.textContent = "";
    fw.steps.forEach(step => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute("data-obs", step.id);
      const span = document.createElement("span");
      if (step.labelKey) {
        span.setAttribute("data-i18n", step.labelKey);
        span.textContent = step.labelKey;
      } else {
        span.textContent = (typeof tc === "function") ? tc(step.label, lang) : String(step.label);
      }
      label.appendChild(box);
      label.appendChild(document.createTextNode(" "));
      label.appendChild(span);
      li.appendChild(label);
      ul.appendChild(li);
    });
    if (typeof window !== "undefined" && typeof window.applyI18n === "function") {
      window.applyI18n(ul);
    }
    /* initObserverChecklist() binds its change listeners once, over the boxes
       that existed then — re-arm it against the new ones, or an authored
       framework ticks but never persists. */
    root.dataset.wired = "";
    if (typeof initObserverChecklist === "function") initObserverChecklist();
  }

  /* ── S1c-3b — an authored roleplay declares its own PHASES ────────────────────
   * `MODB_PHASES` is a six-entry literal, its minute budgets live in the markup,
   * and the stepper is six hand-authored <li>. So every roleplay ran the same
   * setup → play → exchange → swap → replay → reflect timetable, which is right
   * for breaking bad news and wrong for, say, a three-beat pharmacy negotiation.
   * Decision 12: the phase list is section data, and WHICH CARDS a phase shows is
   * part of the declaration — the consumer M3b's phase-visibility seam was built
   * for and never had.
   *
   * A phase names the cards it shows by KEY, not by CSS selector:
   *
   *   phases: [ { id: "brief", label: "Brief the room", minutes: 5,
   *               shows: ["vignette", "roles"] },
   *             { id: "play",  label: "Play it",  minutes: 12, shows: ["roles"] },
   *             { id: "debrief", label: "Debrief", minutes: 8,
   *               shows: ["reflect"], expanded: true } ]
   *
   * Keys rather than selectors on purpose: a raw selector from a facilitator can
   * be malformed (querySelectorAll throws) or reach chrome it has no business
   * touching, and a key is something the S5 author UI can offer as a tick box. */
  const ROLEPLAY_CARDS = {
    vignette:  ".vignette",
    roles:     "#modB-role-picker",
    exchange:  ".answers-card-modB-exchange",
    decisions: "#decisions-B",
    swap:      "#modB-swap-card",
    replay:    "#modB-replay-card",
    reflect:   ".answers-card-modB-reflect"
  };
  /* The authored phase list, or null to keep the shipped six. */
  function roleplayPhases() {
    const rp = (typeof window !== "undefined") && window.CURRENT_SECTION_ROLEPLAY;
    const list = rp && Array.isArray(rp.phases) ? rp.phases : null;
    if (!list || !list.length) return null;
    const out = [];
    list.forEach(p => {
      const id = p && typeof p.id === "string" ? p.id.trim() : "";
      /* Phase ids are written to RTDB (rooms/$room/sections/$slot/phase) and read back
         as DOM data-phase values, so they are validated like role ids. */
      if (!/^[a-z][a-z0-9_-]{0,23}$/.test(id)) return;
      if (out.some(o => o.id === id)) return;
      const shows = (Array.isArray(p.shows) ? p.shows : [])
        .filter(k => Object.prototype.hasOwnProperty.call(ROLEPLAY_CARDS, k));
      out.push({ id: id, label: p.label || id,
                 minutes: (typeof p.minutes === "number" && p.minutes > 0) ? p.minutes : null,
                 shows: shows, expanded: !!p.expanded });
    });
    return out.length ? out : null;
  }
  /* The phase config the roleplay actually runs on. Falls back to the shipped
     MODULE_PROGRESS.B untouched, so the built-ins are byte-identical. */
  function modBProgressCfg() {
    const authored = roleplayPhases();
    if (!authored) return MODULE_PROGRESS.B;
    /* EVERY known card gets an entry, including ones no phase shows — an omitted
       card is absent from `sections`, so applyPhaseVisibility never touches it
       and it would stay permanently visible. An empty `phases` array hides it in
       every phase, which is what "the author did not include this" means. */
    const sections = Object.keys(ROLEPLAY_CARDS).map(key => ({
      sel: ROLEPLAY_CARDS[key],
      phases: authored.filter(p => p.shows.indexOf(key) !== -1).map(p => p.id)
    }));
    return {
      stageId: MODULE_PROGRESS.B.stageId,
      phases: authored.map(p => p.id),
      sections: sections,
      columnsSel: MODULE_PROGRESS.B.columnsSel,
      expandedIn: authored.filter(p => p.expanded).map(p => p.id),
      nav: {
        prevId: MODULE_PROGRESS.B.nav.prevId,
        nextId: MODULE_PROGRESS.B.nav.nextId,
        indicatorId: MODULE_PROGRESS.B.nav.indicatorId,
        /* Deliberately no i18n key here — the shipped one reads "Phase {n} / 6"
           and an authored roleplay rarely has six. Count-aware literal instead. */
        indicatorFallback: "Phase {n} / " + authored.length
      }
    };
  }
  /* Rebuild the phase stepper for an authored phase list. No-ops for the
     built-ins, so their hand-authored chips and i18n attributes survive. */
  function renderPhaseStepper() {
    const authored = roleplayPhases();
    if (!authored) return;
    const stage = document.getElementById(MODULE_PROGRESS.B.stageId);
    const nav = stage && stage.querySelector(".phase-stepper");
    const list = nav && nav.querySelector(".phase-stepper-list");
    if (!list) return;
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    nav.setAttribute("data-steps", String(authored.length));
    list.textContent = "";
    authored.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "phase-step" + (i === 0 ? " is-current" : "");
      li.setAttribute("data-phase", p.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "phase-step-btn";
      const num = document.createElement("span");
      num.className = "phase-step-num";
      num.textContent = String(i + 1);
      const label = document.createElement("span");
      label.className = "phase-step-label";
      label.textContent = (typeof tc === "function") ? tc(p.label, lang) : String(p.label);
      btn.appendChild(num);
      btn.appendChild(label);
      if (p.minutes) {
        const time = document.createElement("span");
        time.className = "phase-step-time";
        time.textContent = p.minutes + " min";
        btn.appendChild(time);
      }
      li.appendChild(btn);
      list.appendChild(li);
    });
    /* initModBPhaseNav() binds one listener PER CHIP, by index, and guards on a
       `_wired` PROPERTY of the stepper node — not a dataset flag. Clearing the
       right one matters: a rebuilt stepper otherwise renders perfectly and is
       completely untappable. Third instance of this class of bug in S1c (role
       picker, observer checklist, now the stepper). */
    nav._wired = false;
    if (typeof initModBPhaseNav === "function") initModBPhaseNav();
  }

  /* ── S1c-3c — the roleplay's TITLE and VIGNETTE become section data ───────────
   * The last hardcoded case-specific block on the roleplay stage: an <h2> reading
   * "Module B — Breaking Bad News: A Cross-Cultural Roleplay" and the situation
   * paragraph naming Mr/Mrs Tanaka-Martin. Both were shown to every roleplay.
   *
   * The heading also carried the "Module B" wording decision 8 retired — a
   * section is "Section k — <title>" now, and its own stage heading should be its
   * own title, not a module label.
   *
   * `vignette` accepts a string or an array of paragraphs, so the situation can
   * be read out in beats. Declaring neither leaves the shipped markup alone. */
  function renderRoleplayVignette() {
    const rp = (typeof window !== "undefined") && window.CURRENT_SECTION_ROLEPLAY;
    if (!rp || (!rp.title && !rp.vignette)) return;
    const stage = document.getElementById("stage-2");
    const card = stage && stage.querySelector(".vignette");
    if (!card) return;
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    const str = v => (v && typeof v === "object" && typeof tc === "function")
      ? tc(v, lang) : String(v == null ? "" : v);

    if (rp.title) {
      const h = card.querySelector("h2");
      if (h) {
        /* Drop the i18n binding as well as the text: applyI18n() runs on every
           language switch and would otherwise put the shipped heading straight
           back over the authored one. */
        h.removeAttribute("data-i18n");
        h.removeAttribute("data-i18n-html");
        h.textContent = str(rp.title);
      }
    }
    if (rp.vignette) {
      const paras = Array.isArray(rp.vignette) ? rp.vignette : [rp.vignette];
      /* Replace only the prose, never the whole card — the editorial SVG spot is
         shell decoration and belongs to the layout, not to the section. */
      Array.prototype.slice.call(card.querySelectorAll("p")).forEach(p => p.remove());
      paras.forEach(t => {
        const p = document.createElement("p");
        p.textContent = str(t);
        card.appendChild(p);
      });
    }
  }

  /* Publish under bare names, and re-run the renderers once — applyScenario()
     may have run before this chunk landed, in which case its guarded calls
     were no-ops and an authored section would have rendered nothing. */
  /* Publish EVERY declaration under its bare name — script.js calls into
     this chunk by bare name (roleplayRoles(), modBProgressCfg(), …), so a
     missing entry is a ReferenceError in the room.

     Assigned EXPLICITLY, never via eval(): the page ships a strict CSP, so
     an eval-based publish throws EvalError and — swallowed per name —
     leaves the chunk loaded but silently exporting NOTHING. That is
     exactly what the first cut of this extraction did, and it presents as
     "is not defined" for every name at once. */
  root.ROLEPLAY_DEFAULT_ROLES = ROLEPLAY_DEFAULT_ROLES;
  root.roleplayRoles = roleplayRoles;
  root.roleplayRoleIds = roleplayRoleIds;
  root.roleplayRole = roleplayRole;
  root.ROLEPLAY_PANEL_IDS = ROLEPLAY_PANEL_IDS;
  root.roleplayPanels = roleplayPanels;
  root._fillRoleplayPanel = _fillRoleplayPanel;
  root.renderRoleplayPanels = renderRoleplayPanels;
  root.OBSERVATION_FRAMEWORKS = OBSERVATION_FRAMEWORKS;
  root.observationFramework = observationFramework;
  root.renderObserverChecklist = renderObserverChecklist;
  root.ROLEPLAY_CARDS = ROLEPLAY_CARDS;
  root.roleplayPhases = roleplayPhases;
  root.modBProgressCfg = modBProgressCfg;
  root.renderPhaseStepper = renderPhaseStepper;
  root.renderRoleplayVignette = renderRoleplayVignette;
  root.CanamedSectionContent = { refresh: function () {
    try { if (typeof root.renderRoleChips === "function") root.renderRoleChips(); } catch (e) {}
    try { renderRoleplayPanels(); } catch (e) {}
    try { renderObserverChecklist(); } catch (e) {}
    try { renderRoleplayVignette(); } catch (e) {}
  } };
})(typeof window !== "undefined" ? window : this);
