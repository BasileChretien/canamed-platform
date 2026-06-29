/* branched-render.js — LAZY in-room render helpers for the branched format.
 *
 * Split out of the eager script.js so this room-only code is NOT in the splash
 * critical-path bundle (perf budget). Loaded by script-loader's
 * ensureCaseContent() chain, so it is present before any decision renders.
 *
 * Classic script: it shares the global script scope, so tc() (the localiser)
 * and `document` are reachable directly — no imports. Exposes
 * window.CanamedBranchedRender; buildDecision() (in script.js) calls it if
 * present and degrades gracefully (no documents) if it is not yet loaded.
 *
 * This is the designated home for branched in-room render code as the OSCE
 * format grows (documents now; the final diagnosis/guidelines step next).
 */
(function (root) {
  "use strict";

  /* Only allow a same-origin, extension-whitelisted, traversal-free image path.
   * Document images come from facilitator-authored scenario content, so guard
   * against javascript:/external/absolute/.. srcs. Bundled images live under a
   * same-origin folder (e.g. scenario-images/…) and need no CSP change (img-src
   * 'self'). Returns an <img> or null. */
  function _safeScenarioImage(path) {
    if (typeof path !== "string" || !path) return null;
    if (path.indexOf("..") !== -1) return null;
    if (/^[a-z]+:/i.test(path) || path.charAt(0) === "/") return null; // no scheme, no absolute
    if (!/^[\w][\w./-]*\.(png|jpe?g|webp|svg|gif)$/i.test(path)) return null;
    const img = document.createElement("img");
    img.className = "dec-doc-img";
    img.loading = "lazy";
    img.src = path;
    return img;
  }

  /* Build the documents block for a branched node (vitals/labs/ECG/CXR/CT
   * revealed with the decision). Each doc: { title, text, image, alt } — all
   * optional, all localisable. DOM-built with textContent (never innerHTML).
   * Returns the block element or null when the node carries no documents. */
  function buildDecisionDocs(d, lang) {
    if (!d || !Array.isArray(d.documents) || !d.documents.length) return null;
    const box = document.createElement("div");
    box.className = "dec-documents";
    d.documents.forEach(doc => {
      if (!doc) return;
      const card = document.createElement("div");
      card.className = "dec-doc";
      const title = tc(doc.title, lang);
      if (title) {
        const h = document.createElement("h4");
        h.className = "dec-doc-title";
        h.textContent = title;
        card.appendChild(h);
      }
      const img = _safeScenarioImage(doc.image);
      if (img) {
        img.alt = tc(doc.alt, lang) || title || "Clinical document";
        card.appendChild(img);
      }
      const text = tc(doc.text, lang);
      if (text) {
        const p = document.createElement("p");
        p.className = "dec-doc-text";
        p.textContent = text;
        card.appendChild(p);
      }
      // Optional image/source credit (e.g. a CC0 attribution line). Rendered as
      // a small, muted caption so licence credits travel with the asset.
      const credit = tc(doc.credit, lang);
      if (credit) {
        const cr = document.createElement("p");
        cr.className = "dec-doc-credit";
        cr.textContent = credit;
        card.appendChild(cr);
      }
      box.appendChild(card);
    });
    return box;
  }

  /* The FINAL diagnosis / management deliverable (the OSCE answer). Shown when
   * the branch tree is finished. Two free-text fields by default — diagnosis +
   * management/guidelines — or whatever scenario.finalStep.fields defines. Each
   * field reuses the EXISTING Module-A answers mechanism: addAnswer() pushes to
   * rooms/<room>/answers/moduleA tagged with the field's bulletKey, so storage,
   * rules, cross-tab sync, the wrap-up and the research export all work with no
   * new schema. Entries (each team member's contribution) render beneath each
   * field, read from the synced `answers.moduleA`. DOM-built, textContent only.
   *
   * Reads/calls globals from the shared script scope: tc, el, answers, addAnswer.
   */
  var DEFAULT_FINAL_FIELDS = [
    { key: "finalDx", label: { en: "Final diagnosis" },
      hint: { en: "Your team's single best diagnosis, with a one-line justification." } },
    { key: "finalMgmt", label: { en: "Management & guidelines" },
      hint: { en: "The immediate plan and the guideline(s) it follows." } }
  ];

  function _finalEntries(bulletKey) {
    var all = (typeof answers !== "undefined" && answers && answers.moduleA) || {};
    return Object.keys(all)
      .map(function (k) { return all[k]; })
      .filter(function (e) { return e && e.bulletKey === bulletKey && e.text; });
  }

  /* (Re)build the entry <li>s of one field's list from the synced answers.
   * Rebuilding ONLY the list (never the textareas) keeps a teammate's in-
   * progress typing intact while others' contributions appear live. */
  function _populateFinalList(list, key) {
    list.textContent = "";
    _finalEntries(key).forEach(function (e) {
      var li = document.createElement("li");
      li.className = "answer-item";
      var txt = document.createElement("span");
      txt.className = "answer-text";
      txt.textContent = e.text;
      li.appendChild(txt);
      if (e.by) {
        var by = document.createElement("span");
        by.className = "answer-by";
        by.textContent = " — " + e.by;
        li.appendChild(by);
      }
      list.appendChild(li);
    });
  }

  /* Refresh every field's entry list inside an already-built final card. */
  function refreshBranchedFinal(host) {
    if (!host) return;
    host.querySelectorAll(".branched-final-list[data-field]").forEach(function (ul) {
      _populateFinalList(ul, ul.getAttribute("data-field"));
    });
  }

  function buildBranchedFinal(scenario, lang) {
    var step = (scenario && scenario.finalStep) || {};
    var fields = Array.isArray(step.fields) && step.fields.length ? step.fields : DEFAULT_FINAL_FIELDS;
    var card = document.createElement("section");
    card.className = "card branched-final";
    card.id = "branched-final";

    var h = document.createElement("h3");
    h.textContent = (step.title && tc(step.title, lang)) || "Your team's final answer";
    card.appendChild(h);
    var lead = document.createElement("p");
    lead.className = "branched-final-lead";
    lead.textContent = (step.prompt && tc(step.prompt, lang)) ||
      "You've reached the end of the case. Agree on and commit your team's verdict.";
    card.appendChild(lead);

    fields.forEach(function (f) {
      var wrap = document.createElement("div");
      wrap.className = "branched-final-field";
      var lab = document.createElement("label");
      lab.className = "branched-final-label";
      lab.setAttribute("for", "answer-input-moduleA-" + f.key);
      lab.textContent = tc(f.label, lang) || f.key;
      wrap.appendChild(lab);
      if (f.hint) {
        var hint = document.createElement("p");
        hint.className = "branched-final-hint";
        hint.textContent = tc(f.hint, lang);
        wrap.appendChild(hint);
      }
      var ta = document.createElement("textarea");
      ta.id = "answer-input-moduleA-" + f.key;
      ta.className = "branched-final-input";
      ta.setAttribute("maxlength", "1000");
      wrap.appendChild(ta);
      var add = document.createElement("button");
      add.type = "button";
      add.className = "add-btn branched-final-add";
      add.textContent = "Add to the team's answer";
      add.addEventListener("click", function () {
        if (typeof addAnswer === "function") addAnswer("moduleA", f.key);
      });
      wrap.appendChild(add);

      var list = document.createElement("ul");
      list.className = "answers-list branched-final-list";
      list.setAttribute("data-field", f.key);
      _populateFinalList(list, f.key);
      wrap.appendChild(list);
      card.appendChild(wrap);
    });
    return card;
  }

  /* True when a branched scenario's tree is FINISHED. We follow the committed
   * branch PATH (via branchedPath in branched-runtime.js) rather than asking
   * "is any vote open right now": a node gated behind a future committed choice
   * is not yet unlocked, so a "no open vote" heuristic would surface the final
   * card too early and then clear it (losing the team's draft) once that node
   * unlocked. branchedPath walks from the entry along committed choices and is
   * "done" only when the path reaches a node with no follow-up — an ending —
   * which never reverts. Needs ≥1 committed (an empty committed map leaves the
   * entry node active → not done). Returns false until the runtime has loaded. */
  function branchedTreeDone() {
    if ((root.CURRENT_SCENARIO_FORMAT || "standard") !== "branched") return false;
    var list = (typeof DECISIONS !== "undefined" ? DECISIONS : []);
    if (!list.length) return false;
    var rt = root.CanamedBranchedRuntime;
    if (!rt || !rt.branchedPath) return false;
    var committed = {};
    list.forEach(function (d) {
      var v = (typeof roomVotes !== "undefined" && roomVotes[d.id]) || {};
      if (v.committed && typeof v.committed.choice === "number") {
        committed[d.id] = v.committed.choice;
      }
    });
    if (!Object.keys(committed).length) return false;
    return rt.branchedPath(list, committed).done;
  }

  /* Populate the STABLE #branched-final-host with the deliverable when the tree
   * is done; hide it otherwise. Built ONCE (the host is NOT rebuilt by
   * renderDecisions on presence/ballot churn, so the answer textareas keep
   * focus + content); only the synced entry lists refresh. */
  function renderBranchedFinal() {
    var host = document.getElementById("branched-final-host");
    if (!host) return;
    if (!branchedTreeDone()) {
      if (host.firstChild) host.textContent = "";
      host.classList.add("hidden");
      return;
    }
    var lang = (typeof _curLang === "function") ? _curLang() : "en";
    if (!host.querySelector("#branched-final")) {
      var sc = { finalStep: root.CURRENT_SCENARIO_FINAL_STEP || null };
      var card = buildBranchedFinal(sc, lang);
      if (card) host.appendChild(card);
    } else {
      refreshBranchedFinal(host);
    }
    host.classList.remove("hidden");
  }

  /* ── Stage flow (lazy: kept out of the eager splash bundle per the perf
     budget). A branched scenario is a pure decision flow with NO Module-B /
     Reflection phase, so it skips stage 2 — Welcome(0) → case(1) → Wrap-up(3);
     standard PBL/roleplay uses all four. STAGE_COUNT is fixed at 4, so the last
     stage index is 3. The eager script.js keeps thin wrappers that delegate
     here once this room module has loaded (and fall back to the standard
     all-stages flow in the brief pre-load window, before any stage is
     navigable). The shared endpoints (0, 3) leave the first/last button-disable
     logic untouched. */
  var LAST_STAGE = 3;
  function stageFlow() {
    return (root.CURRENT_SCENARIO_FORMAT === "branched")
      ? [0, 1, LAST_STAGE] : [0, 1, 2, LAST_STAGE];
  }
  /* Snap a requested stage to the nearest stage IN the flow, in the travel
     direction — an advance onto a skipped stage (1→2 branched) rolls on to the
     next real stage (3); a step-back snaps the other way. */
  function snapStageToFlow(to, from) {
    var flow = stageFlow();
    if (flow.indexOf(to) !== -1) return to;
    if (from != null && to < from) {
      for (var k = flow.length - 1; k >= 0; k--) if (flow[k] <= to) return flow[k];
      return flow[0];
    }
    for (var j = 0; j < flow.length; j++) if (flow[j] >= to) return flow[j];
    return flow[flow.length - 1];
  }
  /* The stage one step forward (+1) or back (-1) of `cur` within the flow — for
     the participant's local Back/Next (which moves viewStage, not the room). */
  function adjacentStage(cur, dir) {
    var flow = stageFlow();
    var i = flow.indexOf(cur);
    if (i === -1) return snapStageToFlow(cur + dir, dir < 0 ? cur + 1 : null);
    return flow[Math.max(0, Math.min(flow.length - 1, i + dir))];
  }

  root.CanamedBranchedRender = {
    buildDecisionDocs, _safeScenarioImage, buildBranchedFinal,
    refreshBranchedFinal, renderBranchedFinal, branchedTreeDone,
    stageFlow, snapStageToFlow, adjacentStage
  };
})(typeof window !== "undefined" ? window : this);
