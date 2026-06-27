/* scenario-author.js — scenario-authoring form logic for CaNaMED.
 *
 * Standalone offline tool: no Firebase, no network, no framework. Pure DOM
 * manipulation against scenario-author.html. CSP-safe (no inline scripts).
 *
 * Architecture:
 *   STATE: a single mutable JS object mirroring the scenario shape:
 *     { meta: {id, name, summary, moduleAName, moduleBName},
 *       history: [{q,a}, ...], exam: [...], labs: [{q,a,key}, ...],
 *       prompts: [{en,fr,ja}, ...],
 *       scoringA: [{id, points, label, any, cohorts}, ...],
 *       scoringB: [...],
 *       penalties: [{id, item, points, title, why}, ...],
 *       decisions: [{id, module, prompt, points, penalty, options:[{text,correct,why}]}, ...],
 *       synthId, synthPrereqs }
 *
 *   RENDER cycle: any user input updates STATE in place, then calls
 *   refreshOutput() which:
 *     - rebuilds the JSON-friendly object via toScenarioJson(),
 *     - serialises it into the live preview textarea.
 *   We DON'T re-render the form on each keystroke — too jarring. We re-render
 *   only when rows are added/removed/loaded, and we update STATE directly from
 *   input event listeners that carry a (rowIndex, fieldPath) reference.
 *
 *   ROUND-TRIP: scenarioJsonToState() parses a pasted snippet (either bare
 *   { id, name, ... } or the full `window.CANAMED_SCENARIOS["id"] = { ... };`
 *   wrapper) into STATE, then renderAll() rebuilds the form.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */

  // a translatable triplet — every user-facing string in the scenario.
  function emptyTrio() { return { en: "", fr: "", ja: "" }; }
  function trio(en, fr, ja) { return { en: en || "", fr: fr || "", ja: ja || "" }; }

  // Accept legacy plain-string values: case-content.js's tc() does, so we do too.
  function asTrio(v) {
    if (v == null) return emptyTrio();
    if (typeof v === "string") return { en: v, fr: "", ja: "" };
    if (typeof v === "object") {
      return { en: v.en || "", fr: v.fr || "", ja: v.ja || "" };
    }
    return emptyTrio();
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        // No `html` key on purpose — never set innerHTML from caller data (it
        // was dead code and a latent XSS sink). Use `text` (2026-05-30 R3).
        else if (k.indexOf("data-") === 0) n.setAttribute(k, attrs[k]);
        else n[k] = attrs[k];
      });
    }
    if (children) children.forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* default STATE                                                      */
  /* ------------------------------------------------------------------ */

  function emptyHistoryRow() { return { q: emptyTrio(), a: emptyTrio() }; }
  function emptyLabRow() { return { q: emptyTrio(), a: emptyTrio(), key: false }; }
  function emptyScoringRow() {
    return { id: "", points: 5, label: emptyTrio(), any: "", cohorts: false };
  }
  function emptyPenaltyRow() {
    return { id: "", item: "", points: 5, title: emptyTrio(), why: emptyTrio() };
  }
  function emptyOption() {
    return { text: emptyTrio(), correct: false, why: emptyTrio() };
  }
  function emptyDecision() {
    return {
      id: "", module: "A", prompt: emptyTrio(), points: 10, penalty: 5,
      options: [emptyOption(), emptyOption()]
    };
  }
  // Branched-format editor state: English-only, FORWARD edges (option.next is a
  // target node id; "" = ends the case). buildBranchedScenario translates these
  // to the runtime's reverse unlockWhen.afterDecision gates.
  function emptyBranchedOption() {
    return { text: "", consequence: "", correct: false, next: "" };
  }
  function emptyBranchedNode() {
    return { id: "", stem: "", points: 20, penalty: 15,
      options: [emptyBranchedOption(), emptyBranchedOption()] };
  }
  function defaultState() {
    return {
      format: "standard",
      branchedNodes: [emptyBranchedNode()],
      meta: {
        id: "",
        name: emptyTrio(),
        summary: emptyTrio(),
        moduleAName: emptyTrio(),
        moduleBName: emptyTrio()
      },
      history: [emptyHistoryRow()],
      exam:    [emptyHistoryRow()],
      labs:    [(function () { var r = emptyLabRow(); r.key = true; return r; })()],
      prompts: [emptyTrio()],
      scoringA: [emptyScoringRow()],
      scoringB: [emptyScoringRow()],
      penalties: [emptyPenaltyRow()],
      decisions: [emptyDecision()],
      synthId: "labs:0",
      synthPrereqs: ""
    };
  }

  var STATE = defaultState();

  /* ------------------------------------------------------------------ */
  /* trio block builder (label + en/fr/ja inputs)                       */
  /* ------------------------------------------------------------------ */

  function buildTrio(label, trioObj, onChange, multiline) {
    var wrap = el("div", { class: "trio-block" });
    wrap.appendChild(el("span", { class: "trio-label", text: label }));
    var grid = el("div", { class: "trio-grid" });
    ["en", "fr", "ja"].forEach(function (lang) {
      var cell = el("div");
      cell.appendChild(el("label", { text: lang.toUpperCase() }));
      var input = multiline
        ? el("textarea", { value: trioObj[lang] || "" })
        : el("input", { type: "text", value: trioObj[lang] || "" });
      input.addEventListener("input", function () {
        trioObj[lang] = input.value;
        onChange();
      });
      cell.appendChild(input);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* dynamic-row builders                                               */
  /* ------------------------------------------------------------------ */

  function rowShell(title, onRemove) {
    var row = el("div", { class: "dyn-row" });
    var head = el("div", { class: "row-header" });
    head.appendChild(el("span", { class: "row-title", text: title }));
    var rm = el("button", { type: "button", class: "remove-btn", text: "× remove" });
    rm.addEventListener("click", onRemove);
    head.appendChild(rm);
    row.appendChild(head);
    return row;
  }

  function renderHistoryLike(listId, arr, label /* "history" | "exam" */) {
    var container = document.getElementById(listId);
    container.innerHTML = "";
    arr.forEach(function (row, i) {
      var shell = rowShell(label + ":" + i, function () {
        arr.splice(i, 1);
        renderAll();
      });
      shell.appendChild(buildTrio("Question / button label (q)", row.q, refreshOutput));
      shell.appendChild(buildTrio("Answer / revealed text (a)", row.a, refreshOutput, true));
      container.appendChild(shell);
    });
  }

  function renderLabs() {
    var container = document.getElementById("list-labs");
    container.innerHTML = "";
    STATE.labs.forEach(function (row, i) {
      var shell = rowShell("labs:" + i, function () {
        STATE.labs.splice(i, 1);
        renderAll();
      });
      // key checkbox row
      var keyRow = el("div", { class: "row-flex" });
      var cell = el("div", { class: "check-cell" });
      var cb = el("input", { type: "checkbox", id: "lab-key-" + i, checked: !!row.key });
      cb.addEventListener("change", function () {
        if (cb.checked) {
          // only one key allowed
          STATE.labs.forEach(function (r, j) { r.key = (j === i); });
          STATE.synthId = "labs:" + i;
          document.getElementById("synth-id").value = STATE.synthId;
        } else {
          row.key = false;
        }
        renderAll();
      });
      var lbl = el("label", { htmlFor: "lab-key-" + i, text: "key (gates the synthesis)" });
      cell.appendChild(cb); cell.appendChild(lbl);
      keyRow.appendChild(cell);
      shell.appendChild(keyRow);
      shell.appendChild(buildTrio("Question / button label (q)", row.q, refreshOutput));
      shell.appendChild(buildTrio("Answer / revealed text (a)", row.a, refreshOutput, true));
      container.appendChild(shell);
    });
  }

  function renderPrompts() {
    var container = document.getElementById("list-prompts");
    container.innerHTML = "";
    STATE.prompts.forEach(function (p, i) {
      var shell = rowShell("prompts:" + i, function () {
        STATE.prompts.splice(i, 1);
        renderAll();
      });
      shell.appendChild(buildTrio("Discussion prompt", p, refreshOutput, true));
      container.appendChild(shell);
    });
  }

  function renderScoring(listId, arr) {
    var container = document.getElementById(listId);
    container.innerHTML = "";
    arr.forEach(function (row, i) {
      var shell = rowShell((listId === "list-scoringA" ? "moduleA[" : "moduleB[") + i + "]", function () {
        arr.splice(i, 1);
        renderAll();
      });
      var top = el("div", { class: "row-flex" });

      // id
      var idCell = el("div", { class: "field-row" });
      idCell.appendChild(el("label", { class: "field-label", text: "id" }));
      var idIn = el("input", { type: "text", value: row.id });
      idIn.addEventListener("input", function () { row.id = idIn.value; refreshOutput(); });
      idCell.appendChild(idIn);
      top.appendChild(idCell);

      // points
      var ptCell = el("div", { class: "field-row narrow" });
      ptCell.appendChild(el("label", { class: "field-label", text: "points" }));
      var ptIn = el("input", { type: "number", value: row.points });
      ptIn.addEventListener("input", function () {
        row.points = parseInt(ptIn.value, 10) || 0;
        refreshOutput();
      });
      ptCell.appendChild(ptIn);
      top.appendChild(ptCell);

      // cohorts checkbox
      var cohCell = el("div", { class: "check-cell" });
      var cohCb = el("input", { type: "checkbox", id: listId + "-coh-" + i, checked: !!row.cohorts });
      cohCb.addEventListener("change", function () {
        row.cohorts = cohCb.checked;
        refreshOutput();
      });
      cohCell.appendChild(cohCb);
      cohCell.appendChild(el("label", { htmlFor: listId + "-coh-" + i, text: "cohorts (named ≥2 partner universities)" }));
      top.appendChild(cohCell);

      shell.appendChild(top);

      shell.appendChild(buildTrio("Label (what learners see in the points panel)", row.label, refreshOutput));

      // any stems
      var anyRow = el("div", { class: "field-row" });
      anyRow.appendChild(el("label", { class: "field-label", text: "any (English keyword stems, comma-separated)" }));
      var anyIn = el("input", { type: "text", value: row.any || "",
        placeholder: "e.g. activ, exercise, walk, mobil" });
      anyIn.addEventListener("input", function () { row.any = anyIn.value; refreshOutput(); });
      anyRow.appendChild(anyIn);
      anyRow.appendChild(el("p", { class: "field-hint",
        text: "Stems are matched against the team's typed English answer (accent-stripped, " +
              "case-insensitive, word-prefix). Leave blank if this row uses cohorts instead." }));
      shell.appendChild(anyRow);

      container.appendChild(shell);
    });
  }

  function renderPenalties() {
    var container = document.getElementById("list-penalties");
    container.innerHTML = "";
    STATE.penalties.forEach(function (row, i) {
      var shell = rowShell("penalties[" + i + "]", function () {
        STATE.penalties.splice(i, 1);
        renderAll();
      });
      var top = el("div", { class: "row-flex" });

      var idCell = el("div", { class: "field-row" });
      idCell.appendChild(el("label", { class: "field-label", text: "id" }));
      var idIn = el("input", { type: "text", value: row.id });
      idIn.addEventListener("input", function () { row.id = idIn.value; refreshOutput(); });
      idCell.appendChild(idIn);
      top.appendChild(idCell);

      var itemCell = el("div", { class: "field-row" });
      itemCell.appendChild(el("label", { class: "field-label", text: "item (e.g. labs:4)" }));
      var itemIn = el("input", { type: "text", value: row.item, placeholder: "group:index" });
      itemIn.addEventListener("input", function () { row.item = itemIn.value; refreshOutput(); });
      itemCell.appendChild(itemIn);
      top.appendChild(itemCell);

      var ptCell = el("div", { class: "field-row narrow" });
      ptCell.appendChild(el("label", { class: "field-label", text: "points" }));
      var ptIn = el("input", { type: "number", value: row.points });
      ptIn.addEventListener("input", function () {
        row.points = parseInt(ptIn.value, 10) || 0;
        refreshOutput();
      });
      ptCell.appendChild(ptIn);
      top.appendChild(ptCell);

      shell.appendChild(top);
      shell.appendChild(buildTrio("Title (shown to learners as the deduction header)", row.title, refreshOutput));
      shell.appendChild(buildTrio("Why (the teaching explanation)", row.why, refreshOutput, true));
      container.appendChild(shell);
    });
  }

  function renderDecisions() {
    var container = document.getElementById("list-decisions");
    container.innerHTML = "";
    STATE.decisions.forEach(function (dec, i) {
      var shell = rowShell("decisions[" + i + "]", function () {
        STATE.decisions.splice(i, 1);
        renderAll();
      });
      var top = el("div", { class: "row-flex" });

      var idCell = el("div", { class: "field-row" });
      idCell.appendChild(el("label", { class: "field-label", text: "id" }));
      var idIn = el("input", { type: "text", value: dec.id });
      idIn.addEventListener("input", function () { dec.id = idIn.value; refreshOutput(); });
      idCell.appendChild(idIn);
      top.appendChild(idCell);

      var modCell = el("div", { class: "field-row narrow" });
      modCell.appendChild(el("label", { class: "field-label", text: "module" }));
      var sel = el("select", { class: "module-select" });
      ["A", "B"].forEach(function (m) {
        var opt = el("option", { value: m, text: m });
        if (dec.module === m) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () { dec.module = sel.value; refreshOutput(); });
      modCell.appendChild(sel);
      top.appendChild(modCell);

      var ptCell = el("div", { class: "field-row narrow" });
      ptCell.appendChild(el("label", { class: "field-label", text: "points (correct)" }));
      var ptIn = el("input", { type: "number", value: dec.points });
      ptIn.addEventListener("input", function () {
        dec.points = parseInt(ptIn.value, 10) || 0; refreshOutput();
      });
      ptCell.appendChild(ptIn);
      top.appendChild(ptCell);

      var penCell = el("div", { class: "field-row narrow" });
      penCell.appendChild(el("label", { class: "field-label", text: "penalty (wrong)" }));
      var penIn = el("input", { type: "number", value: dec.penalty });
      penIn.addEventListener("input", function () {
        dec.penalty = parseInt(penIn.value, 10) || 0; refreshOutput();
      });
      penCell.appendChild(penIn);
      top.appendChild(penCell);

      shell.appendChild(top);
      shell.appendChild(buildTrio("Prompt (the question put to the team)", dec.prompt, refreshOutput, true));

      // options
      var optsWrap = el("div", { class: "decision-options" });
      optsWrap.appendChild(el("p", { class: "field-hint",
        text: "Options — tick the correct one(s). At least 2 options recommended." }));
      var optsList = el("div", { class: "decision-options-list" });
      dec.options.forEach(function (opt, j) {
        var optRow = el("div", { class: "opt-row" });
        var oh = el("div", { class: "row-header" });
        oh.appendChild(el("span", { class: "row-title", text: "option[" + j + "]" }));
        var rm = el("button", { type: "button", class: "remove-btn", text: "× remove" });
        rm.addEventListener("click", function () {
          dec.options.splice(j, 1); renderAll();
        });
        oh.appendChild(rm);
        optRow.appendChild(oh);

        var corrCell = el("div", { class: "check-cell" });
        var corrCb = el("input", { type: "checkbox",
          id: "opt-corr-" + i + "-" + j, checked: !!opt.correct });
        corrCb.addEventListener("change", function () {
          opt.correct = corrCb.checked; refreshOutput();
        });
        corrCell.appendChild(corrCb);
        corrCell.appendChild(el("label", { htmlFor: "opt-corr-" + i + "-" + j,
          text: "correct" }));
        optRow.appendChild(corrCell);

        optRow.appendChild(buildTrio("Option text", opt.text, refreshOutput));
        optRow.appendChild(buildTrio("Why (shown after the vote)", opt.why, refreshOutput, true));
        optsList.appendChild(optRow);
      });
      optsWrap.appendChild(optsList);
      var addOpt = el("button", { type: "button", class: "add-btn",
        text: "+ Add option" });
      addOpt.addEventListener("click", function () {
        dec.options.push(emptyOption()); renderAll();
      });
      optsWrap.appendChild(addOpt);
      shell.appendChild(optsWrap);

      container.appendChild(shell);
    });
  }

  /* ------------------------------------------------------------------ */
  /* branched-format editor (English-only node graph)                   */
  /* ------------------------------------------------------------------ */

  function isBranched() { return (STATE.format || "standard") === "branched"; }

  // small single-input field (English) — label + input/textarea, live onInput.
  function enField(label, value, multiline, onInput) {
    var wrap = el("div", { class: "field-row" });
    wrap.appendChild(el("label", { class: "field-label", text: label }));
    var inp = multiline
      ? el("textarea", { value: value || "" })
      : el("input", { type: "text", value: value || "" });
    inp.addEventListener("input", function () { onInput(inp.value); });
    wrap.appendChild(inp);
    return wrap;
  }
  function numField(label, value, onInput) {
    var cell = el("div", { class: "field-row narrow" });
    cell.appendChild(el("label", { class: "field-label", text: label }));
    var inp = el("input", { type: "number", value: value });
    inp.addEventListener("input", function () { onInput(parseInt(inp.value, 10) || 0); });
    cell.appendChild(inp);
    return cell;
  }

  function renderBranchedNodes() {
    var container = document.getElementById("list-branched");
    if (!container) return;
    container.innerHTML = "";
    var nodes = STATE.branchedNodes;
    nodes.forEach(function (node, i) {
      var shell = rowShell("node[" + i + "]" + (node.id ? " — " + node.id : ""),
        function () { nodes.splice(i, 1); renderAll(); });

      var top = el("div", { class: "row-flex" });
      var idCell = el("div", { class: "field-row" });
      idCell.appendChild(el("label", { class: "field-label", text: "node id" }));
      var idIn = el("input", { type: "text", value: node.id });
      idIn.addEventListener("input", function () { node.id = idIn.value; refreshOutput(); });
      // Re-render on blur so the "Then →" target dropdowns pick up a node id
      // the moment it is named (input alone would not refresh the other rows).
      idIn.addEventListener("change", function () { renderAll(); });
      idCell.appendChild(idIn);
      top.appendChild(idCell);
      top.appendChild(numField("points (best)", node.points, function (v) { node.points = v; refreshOutput(); }));
      top.appendChild(numField("penalty (other)", node.penalty, function (v) { node.penalty = v; refreshOutput(); }));
      shell.appendChild(top);

      shell.appendChild(enField("The situation / question (English)", node.stem, true,
        function (v) { node.stem = v; refreshOutput(); }));

      var optsWrap = el("div", { class: "decision-options" });
      node.options.forEach(function (opt, j) {
        var optRow = el("div", { class: "opt-row bn-opt" });
        var oh = el("div", { class: "row-header" });
        oh.appendChild(el("span", { class: "row-title", text: "choice[" + j + "]" }));
        var rm = el("button", { type: "button", class: "remove-btn", text: "× remove" });
        rm.addEventListener("click", function () { node.options.splice(j, 1); renderAll(); });
        oh.appendChild(rm);
        optRow.appendChild(oh);

        var cc = el("div", { class: "check-cell" });
        var cb = el("input", { type: "checkbox", id: "bn-corr-" + i + "-" + j, checked: !!opt.correct });
        cb.addEventListener("change", function () { opt.correct = cb.checked; refreshOutput(); });
        cc.appendChild(cb);
        cc.appendChild(el("label", { htmlFor: "bn-corr-" + i + "-" + j,
          text: "best choice (scores the points)" }));
        optRow.appendChild(cc);

        optRow.appendChild(enField("Choice text (English)", opt.text, false,
          function (v) { opt.text = v; refreshOutput(); }));
        optRow.appendChild(enField("What happens next — consequence (English)", opt.consequence, true,
          function (v) { opt.consequence = v; refreshOutput(); }));

        var thenWrap = el("div", { class: "bn-then" });
        thenWrap.appendChild(el("label", { class: "field-label", text: "Then →" }));
        var sel = el("select");
        sel.appendChild(el("option", { value: "", text: "— ends the case —" }));
        var matched = false;
        nodes.forEach(function (other, oi) {
          if (oi === i || !other.id) return;
          var o = el("option", { value: other.id, text: other.id });
          if (opt.next === other.id) { o.selected = true; matched = true; }
          sel.appendChild(o);
        });
        // A target that no longer resolves (renamed/removed) stays selectable so
        // the author sees the break (the validator also flags it).
        if (opt.next && !matched) {
          var dang = el("option", { value: opt.next, text: opt.next + " (missing!)" });
          dang.selected = true;
          sel.appendChild(dang);
        }
        sel.addEventListener("change", function () { opt.next = sel.value; refreshOutput(); });
        thenWrap.appendChild(sel);
        optRow.appendChild(thenWrap);

        optsWrap.appendChild(optRow);
      });
      var addOpt = el("button", { type: "button", class: "add-btn", text: "+ Add choice" });
      addOpt.addEventListener("click", function () { node.options.push(emptyBranchedOption()); renderAll(); });
      optsWrap.appendChild(addOpt);
      shell.appendChild(optsWrap);

      container.appendChild(shell);
    });
  }

  // meta → buildBranchedScenario input (English strings, not trios).
  function branchedMeta() {
    var m = STATE.meta;
    return {
      id: m.id,
      name: (m.name && m.name.en) || "",
      summary: (m.summary && m.summary.en) || "",
      title: (m.moduleAName && m.moduleAName.en) || (m.name && m.name.en) || ""
    };
  }
  function buildBranched() {
    if (!window.CanamedBranchedAuthor || !window.CanamedBranchedAuthor.buildBranchedScenario) {
      return { scenario: { id: STATE.meta.id, format: "branched", decisions: [] }, warnings: [] };
    }
    return window.CanamedBranchedAuthor.buildBranchedScenario(branchedMeta(), STATE.branchedNodes);
  }
  function toBranchedJson() { return buildBranched().scenario; }

  // Live validation panel under the branch editor (errors + warnings).
  function refreshBranchedValidation() {
    var box = document.getElementById("branched-validation");
    if (!box) return;
    var built = buildBranched();
    var msgs = [];
    var m = STATE.meta;
    if (!m.id) msgs.push("✗ Scenario id is required.");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(m.id)) msgs.push("✗ Scenario id must be lowercase kebab-case.");
    if (!(m.name && m.name.en)) msgs.push("✗ Scenario name (English) is required.");
    if (window.CanamedBranched && window.CanamedBranched.validateBranchedGraph) {
      var r = window.CanamedBranched.validateBranchedGraph(built.scenario);
      r.errors.forEach(function (e) { msgs.push("✗ " + e); });
      r.warnings.forEach(function (w) { msgs.push("⚠ " + w); });
    }
    built.warnings.forEach(function (w) { msgs.push("⚠ " + w); });
    var hasErr = msgs.some(function (s) { return s.charAt(0) === "✗"; });
    box.className = "validation-output" + (hasErr ? " error" : " success");
    box.textContent = msgs.length ? msgs.join("\n") : "✓ Valid branch tree — ready to copy.";
  }

  // Reverse buildBranchedScenario (afterDecision gates → forward next) so a
  // branched scenario round-trips back into the editor via Load JSON.
  function branchedJsonToState(json) {
    var st = defaultState();
    st.format = "branched";
    st.meta.id = json.id || "";
    st.meta.name = asTrio(json.name);
    st.meta.summary = asTrio(json.summary);
    st.meta.moduleAName = asTrio(json.moduleAName);
    st.meta.moduleBName = asTrio(json.moduleBName);
    var decisions = Array.isArray(json.decisions) ? json.decisions : [];
    st.branchedNodes = decisions.map(function (d) {
      return {
        id: d.id || "",
        stem: (d.prompt && d.prompt.en) || "",
        points: typeof d.points === "number" ? d.points : 20,
        penalty: typeof d.penalty === "number" ? d.penalty : 15,
        options: (Array.isArray(d.options) ? d.options : []).map(function (o) {
          return {
            text: (o.text && o.text.en) || "",
            consequence: (o.branch && o.branch.reveal && o.branch.reveal.en) || "",
            correct: !!o.correct,
            next: ""
          };
        })
      };
    });
    var byId = {};
    st.branchedNodes.forEach(function (n) { byId[n.id] = n; });
    decisions.forEach(function (d) {
      var w = d.unlockWhen && d.unlockWhen.afterDecision;
      if (!w) return;
      if (typeof w === "string") {
        var any = byId[w];
        if (any) any.options.forEach(function (o) { if (!o.next) o.next = d.id; });
      } else if (w && w.id) {
        var p = byId[w.id];
        if (p && p.options[w.option]) p.options[w.option].next = d.id;
      }
    });
    if (!st.branchedNodes.length) st.branchedNodes = [emptyBranchedNode()];
    return st;
  }

  /* ------------------------------------------------------------------ */
  /* meta-section binding (top form fields + synth gate)                */
  /* ------------------------------------------------------------------ */

  function bindMeta() {
    var idIn = document.getElementById("meta-id");
    idIn.value = STATE.meta.id;
    idIn.addEventListener("input", function () {
      STATE.meta.id = idIn.value;
      refreshOutput();
    });

    document.querySelectorAll(".trio-block[data-trio]").forEach(function (host) {
      host.innerHTML = "";
      var path = host.getAttribute("data-trio"); // e.g. "meta.name"
      var label = host.getAttribute("data-label") || path;
      var multiline = host.getAttribute("data-multiline") === "true";
      var parts = path.split(".");
      var obj = STATE;
      for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      var leaf = obj[parts[parts.length - 1]];
      host.appendChild(buildTrio(label, leaf, refreshOutput, multiline));
    });

    var synthIn = document.getElementById("synth-id");
    synthIn.value = STATE.synthId || "";
    synthIn.addEventListener("input", function () {
      STATE.synthId = synthIn.value; refreshOutput();
    });
    var prereqIn = document.getElementById("synth-prereqs");
    prereqIn.value = STATE.synthPrereqs || "";
    prereqIn.addEventListener("input", function () {
      STATE.synthPrereqs = prereqIn.value; refreshOutput();
    });

    // Format toggle. onchange (assignment, not addEventListener) so re-binding
    // on every renderAll never stacks duplicate handlers.
    var fmtSel = document.getElementById("meta-format");
    if (fmtSel) {
      fmtSel.value = STATE.format || "standard";
      fmtSel.onchange = function () { STATE.format = fmtSel.value; renderAll(); };
    }
  }

  /* ------------------------------------------------------------------ */
  /* STATE -> scenario JSON object                                      */
  /* ------------------------------------------------------------------ */

  function parsePrereqs(str) {
    if (!str) return [];
    return String(str).split(",").map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }
  function parseStems(str) {
    if (!str) return [];
    return String(str).split(",").map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function toScenarioJson() {
    if (isBranched()) return toBranchedJson();
    var m = STATE.meta;
    var caseObj = {
      history: STATE.history.map(function (r) { return { q: r.q, a: r.a }; }),
      exam:    STATE.exam.map(function (r) { return { q: r.q, a: r.a }; }),
      labs:    STATE.labs.map(function (r) {
        var out = { q: r.q };
        if (r.key) out.key = true;
        out.a = r.a;
        return out;
      }),
      prompts: STATE.prompts.map(function (p) { return p; })
    };
    var scoring = {
      moduleA: STATE.scoringA.map(scoringRowToJson),
      moduleB: STATE.scoringB.map(scoringRowToJson)
    };
    var penalties = STATE.penalties.map(function (p) {
      return {
        id: p.id, item: p.item, points: p.points,
        title: p.title, why: p.why
      };
    });
    var decisions = STATE.decisions.map(function (d) {
      return {
        id: d.id, module: d.module, points: d.points, penalty: d.penalty,
        prompt: d.prompt,
        options: d.options.map(function (o) {
          return { text: o.text, correct: !!o.correct, why: o.why };
        })
      };
    });

    return {
      id: m.id,
      name: m.name,
      summary: m.summary,
      moduleAName: m.moduleAName,
      moduleBName: m.moduleBName,
      synthId: STATE.synthId,
      synthPrereqs: parsePrereqs(STATE.synthPrereqs),
      case: caseObj,
      scoring: scoring,
      penalties: penalties,
      decisions: decisions
    };
  }

  function scoringRowToJson(r) {
    var out = { id: r.id, points: r.points, label: r.label };
    if (r.cohorts) {
      out.cohorts = true;
    } else {
      out.any = parseStems(r.any);
    }
    return out;
  }

  function refreshOutput() {
    var json = toScenarioJson();
    var pretty = JSON.stringify(json, null, 2);
    document.getElementById("json-preview").value = pretty;
    if (isBranched()) refreshBranchedValidation();
  }

  /* ------------------------------------------------------------------ */
  /* validation                                                         */
  /* ------------------------------------------------------------------ */

  // Branched: the graph validator is the source of truth (hard errors only;
  // warnings live in the always-on #branched-validation panel).
  function validateBranchedForm() {
    var errs = [];
    var m = STATE.meta;
    if (!m.id) errs.push("Scenario id is required.");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(m.id))
      errs.push("Scenario id must be lowercase kebab-case (e.g. acute-asthma).");
    if (!(m.name && m.name.en)) errs.push("Scenario name (English) is required.");
    var built = buildBranched();
    if (window.CanamedBranched && window.CanamedBranched.validateBranchedGraph) {
      window.CanamedBranched.validateBranchedGraph(built.scenario)
        .errors.forEach(function (e) { errs.push(e); });
    }
    return errs;
  }

  function validate() {
    if (isBranched()) return validateBranchedForm();
    var errs = [];
    var json = toScenarioJson();

    // scenario meta
    if (!json.id) errs.push("Scenario id is required.");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(json.id))
      errs.push("Scenario id must be lowercase kebab-case (e.g. acute-asthma-er).");
    if (!json.name.en) errs.push("Scenario name (English) is required.");
    if (!json.summary.en) errs.push("Scenario summary (English) is required.");
    if (!json.moduleAName.en) errs.push("Module A name (English) is required.");
    if (!json.moduleBName.en) errs.push("Module B name (English) is required.");

    // history / exam / labs / prompts non-empty
    if (json.case.history.length === 0) errs.push("CASE.history must have at least one item.");
    if (json.case.exam.length === 0)    errs.push("CASE.exam must have at least one item.");
    if (json.case.labs.length === 0)    errs.push("CASE.labs must have at least one item.");
    if (json.case.prompts.length === 0) errs.push("CASE.prompts must have at least one item.");

    // each q/a must have English
    ["history", "exam", "labs"].forEach(function (g) {
      json.case[g].forEach(function (r, i) {
        if (!r.q || !r.q.en) errs.push(g + ":" + i + " — question (English) is required.");
        if (!r.a || !r.a.en) errs.push(g + ":" + i + " — answer (English) is required.");
      });
    });
    json.case.prompts.forEach(function (p, i) {
      if (!p || !p.en) errs.push("prompts:" + i + " — English text is required.");
    });

    // exactly one labs row with key
    var keyRows = STATE.labs.filter(function (r) { return r.key; });
    if (keyRows.length === 0) errs.push("Exactly one labs row must have the key checkbox ticked (the synthesis item).");
    else if (keyRows.length > 1) errs.push("Only one labs row may have the key checkbox ticked.");

    // synthId references the key row
    var synthOk = /^labs:(\d+)$/.exec(json.synthId || "");
    if (!synthOk) errs.push("synthId must look like 'labs:N'.");
    else {
      var idx = parseInt(synthOk[1], 10);
      if (idx < 0 || idx >= json.case.labs.length)
        errs.push("synthId 'labs:" + idx + "' does not point to an existing lab item.");
      else if (!json.case.labs[idx].key)
        errs.push("synthId 'labs:" + idx + "' does not have the key flag set on that lab row.");
    }

    // synthPrereqs all resolve
    var groupLen = {
      history: json.case.history.length,
      exam:    json.case.exam.length,
      labs:    json.case.labs.length
    };
    json.synthPrereqs.forEach(function (p) {
      var m = /^(history|exam|labs):(\d+)$/.exec(p);
      if (!m) {
        errs.push("synthPrereqs entry '" + p + "' must look like history:N, exam:N or labs:N.");
        return;
      }
      var n = parseInt(m[2], 10);
      if (n < 0 || n >= groupLen[m[1]])
        errs.push("synthPrereqs entry '" + p + "' does not resolve (only " + groupLen[m[1]] + " " + m[1] + " items).");
    });

    // unique ids across scoring, penalties, decisions
    function checkUnique(list, label) {
      var seen = {};
      list.forEach(function (r, i) {
        if (!r.id) { errs.push(label + "[" + i + "] is missing an id."); return; }
        if (seen[r.id]) errs.push(label + " has duplicate id '" + r.id + "'.");
        seen[r.id] = true;
      });
    }
    checkUnique(json.scoring.moduleA, "scoring.moduleA");
    checkUnique(json.scoring.moduleB, "scoring.moduleB");
    checkUnique(json.penalties, "penalties");
    checkUnique(json.decisions, "decisions");

    // scoring rows: either cohorts or any must be present
    function checkScoring(list, label) {
      list.forEach(function (r, i) {
        if (!r.cohorts && (!r.any || r.any.length === 0))
          errs.push(label + "[" + i + "] (id='" + r.id + "') needs either cohorts:true or at least one 'any' stem.");
        if (!r.label || !r.label.en)
          errs.push(label + "[" + i + "] (id='" + r.id + "') needs an English label.");
      });
    }
    checkScoring(json.scoring.moduleA, "scoring.moduleA");
    checkScoring(json.scoring.moduleB, "scoring.moduleB");

    // penalties: item must resolve
    json.penalties.forEach(function (p, i) {
      if (!p.item) { errs.push("penalties[" + i + "] (id='" + p.id + "') missing item."); return; }
      var m = /^(history|exam|labs):(\d+)$/.exec(p.item);
      if (!m) {
        errs.push("penalties[" + i + "] item '" + p.item + "' must look like history:N, exam:N or labs:N.");
        return;
      }
      var n = parseInt(m[2], 10);
      if (n < 0 || n >= groupLen[m[1]])
        errs.push("penalties[" + i + "] item '" + p.item + "' does not resolve.");
      if (!p.title || !p.title.en) errs.push("penalties[" + i + "] (id='" + p.id + "') needs an English title.");
      if (!p.why   || !p.why.en)   errs.push("penalties[" + i + "] (id='" + p.id + "') needs an English why.");
    });

    // decisions
    json.decisions.forEach(function (d, i) {
      if (d.module !== "A" && d.module !== "B")
        errs.push("decisions[" + i + "] (id='" + d.id + "') module must be 'A' or 'B'.");
      if (!d.prompt || !d.prompt.en)
        errs.push("decisions[" + i + "] (id='" + d.id + "') needs an English prompt.");
      if (!d.options || d.options.length < 2)
        errs.push("decisions[" + i + "] (id='" + d.id + "') needs at least 2 options.");
      else {
        var anyCorrect = false;
        d.options.forEach(function (o, j) {
          if (!o.text || !o.text.en)
            errs.push("decisions[" + i + "].options[" + j + "] needs English text.");
          if (!o.why || !o.why.en)
            errs.push("decisions[" + i + "].options[" + j + "] needs an English why.");
          if (o.correct) anyCorrect = true;
        });
        if (!anyCorrect)
          errs.push("decisions[" + i + "] (id='" + d.id + "') has no option marked correct.");
      }
    });

    return errs;
  }

  function showValidation(errs) {
    var out = document.getElementById("validation-output");
    out.className = "validation-output";
    out.innerHTML = "";
    if (errs.length === 0) {
      out.classList.add("success");
      out.appendChild(el("strong", { text: "Validation passed — the scenario JSON is well-formed and self-consistent." }));
      return;
    }
    out.classList.add("error");
    out.appendChild(el("strong", { text: errs.length + " issue" + (errs.length === 1 ? "" : "s") + " found:" }));
    var ul = el("ul");
    errs.forEach(function (e) { ul.appendChild(el("li", { text: e })); });
    out.appendChild(ul);
  }

  /* Human-readable preview of the authored scenario — how it reads to
     participants, not raw JSON. Text goes through el()'s textContent (no
     innerHTML of user input). */
  function renderPreview() {
    var json = toScenarioJson();
    var out = document.getElementById("preview-output");
    if (!out) return;
    out.innerHTML = "";
    function line(label, val) {
      var p = el("p");
      p.appendChild(el("strong", { text: label + ": " }));
      p.appendChild(document.createTextNode(val));
      return p;
    }
    out.appendChild(el("h3", { text: (json.name && json.name.en) || "(untitled scenario)" }));
    if (json.summary && json.summary.en) out.appendChild(el("p", { text: json.summary.en }));
    out.appendChild(line("Module A", (json.moduleAName && json.moduleAName.en) || "—"));
    out.appendChild(line("Module B", (json.moduleBName && json.moduleBName.en) || "—"));
    out.appendChild(line("Case items", json.case.history.length + " history · " +
      json.case.exam.length + " exam · " + json.case.labs.length + " labs · " +
      json.case.prompts.length + " prompts"));
    out.appendChild(line("Scoring stems", json.scoring.moduleA.length + " (A) · " +
      json.scoring.moduleB.length + " (B)"));
    out.appendChild(line("Penalties", String(json.penalties.length)));
    var pre = (json.preTest && json.preTest.length) || 0;
    var post = (json.postTest && json.postTest.length) || 0;
    out.appendChild(line("Pre/post test", pre + " pre · " + post + " post" +
      ((pre === 0 || post === 0)
        ? "  ⚠ add a pre/post test (edit the JSON) to enable knowledge-gain measurement"
        : "")));
    out.appendChild(el("h4", { text: "Team decisions (" + json.decisions.length + ")" }));
    if (!json.decisions.length) {
      out.appendChild(el("p", { class: "field-hint", text: "No team decisions yet." }));
    }
    json.decisions.forEach(function (d) {
      var card = el("div", { class: "preview-decision" });
      card.appendChild(el("p", { class: "preview-dec-prompt",
        text: "[" + (d.module || "?") + "] " + ((d.prompt && d.prompt.en) || "(no prompt)") }));
      var ul = el("ul");
      (d.options || []).forEach(function (o) {
        var li = el("li", { text: (o.text && o.text.en) || "(no text)" });
        if (o.correct) {
          li.appendChild(document.createTextNode("  "));
          li.appendChild(el("span", { class: "preview-correct", text: "✓ safest" }));
        }
        ul.appendChild(li);
      });
      card.appendChild(ul);
      out.appendChild(card);
    });
  }

  /* ------------------------------------------------------------------ */
  /* JSON -> STATE (round-trip)                                         */
  /* ------------------------------------------------------------------ */

  function tryParseScenarioInput(text) {
    // Accept either a bare JSON object or a snippet that looks like
    //   window.CANAMED_SCENARIOS["my-id"] = { ... };
    var trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("Empty input.");
    // Strip optional trailing semicolons and leading assignments.
    var m = trimmed.match(/=\s*({[\s\S]*})\s*;?\s*$/);
    var body = m ? m[1] : trimmed;
    // JSON only. We used to fall back to Function() eval to accept raw JS
    // object-literal syntax (unquoted keys, `+` concatenation), but that is a
    // code-execution sink (a facilitator could be socially-engineered into
    // pasting a snippet that exfiltrates their auth token) and its keyword
    // blocklist was bypassable (globalThis, bracket access, hex escapes). The
    // tool EXPORTS valid JSON, so the normal round-trip is unaffected; raw JS
    // must be converted to JSON first (2026-05-30 R3 review).
    try {
      return JSON.parse(body);
    } catch (jsonErr) {
      throw new Error("Could not parse the input as JSON. Paste the scenario as JSON " +
        "(the format this tool exports) — not raw JavaScript. Details: " + jsonErr.message);
    }
  }

  function scenarioJsonToState(obj) {
    if (obj && obj.format === "branched") return branchedJsonToState(obj);
    var s = defaultState();
    s.meta.id = obj.id || "";
    s.meta.name        = asTrio(obj.name);
    s.meta.summary     = asTrio(obj.summary);
    s.meta.moduleAName = asTrio(obj.moduleAName);
    s.meta.moduleBName = asTrio(obj.moduleBName);

    var c = obj.case || {};
    s.history = (c.history || []).map(function (r) {
      return { q: asTrio(r.q), a: asTrio(r.a) };
    });
    if (s.history.length === 0) s.history = [emptyHistoryRow()];

    s.exam = (c.exam || []).map(function (r) {
      return { q: asTrio(r.q), a: asTrio(r.a) };
    });
    if (s.exam.length === 0) s.exam = [emptyHistoryRow()];

    s.labs = (c.labs || []).map(function (r) {
      return { q: asTrio(r.q), a: asTrio(r.a), key: !!r.key };
    });
    if (s.labs.length === 0) {
      var lr = emptyLabRow(); lr.key = true; s.labs = [lr];
    }

    s.prompts = (c.prompts || []).map(asTrio);
    if (s.prompts.length === 0) s.prompts = [emptyTrio()];

    var sc = obj.scoring || {};
    s.scoringA = (sc.moduleA || []).map(scoringJsonToState);
    s.scoringB = (sc.moduleB || []).map(scoringJsonToState);
    if (s.scoringA.length === 0) s.scoringA = [emptyScoringRow()];
    if (s.scoringB.length === 0) s.scoringB = [emptyScoringRow()];

    s.penalties = (obj.penalties || []).map(function (p) {
      return {
        id: p.id || "", item: p.item || "", points: p.points || 0,
        title: asTrio(p.title), why: asTrio(p.why)
      };
    });
    if (s.penalties.length === 0) s.penalties = [emptyPenaltyRow()];

    s.decisions = (obj.decisions || []).map(function (d) {
      return {
        id: d.id || "",
        module: (d.module === "B" ? "B" : "A"),
        points: d.points || 0,
        penalty: d.penalty || 0,
        prompt: asTrio(d.prompt),
        options: (d.options || []).map(function (o) {
          return { text: asTrio(o.text), correct: !!o.correct, why: asTrio(o.why) };
        })
      };
    });
    if (s.decisions.length === 0) s.decisions = [emptyDecision()];

    s.synthId = obj.synthId || "labs:0";
    s.synthPrereqs = Array.isArray(obj.synthPrereqs)
      ? obj.synthPrereqs.join(", ")
      : (obj.synthPrereqs || "");

    return s;
  }
  function scoringJsonToState(r) {
    return {
      id: r.id || "", points: r.points || 0,
      label: asTrio(r.label),
      any: Array.isArray(r.any) ? r.any.join(", ") : "",
      cohorts: !!r.cohorts
    };
  }

  /* ------------------------------------------------------------------ */
  /* render orchestration                                               */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    var form = document.getElementById("author-form");
    if (form) form.dataset.format = STATE.format || "standard";
    bindMeta();
    if (isBranched()) {
      renderBranchedNodes();
    } else {
      renderHistoryLike("list-history", STATE.history, "history");
      renderHistoryLike("list-exam",    STATE.exam,    "exam");
      renderLabs();
      renderPrompts();
      renderScoring("list-scoringA", STATE.scoringA);
      renderScoring("list-scoringB", STATE.scoringB);
      renderPenalties();
      renderDecisions();
    }
    refreshOutput();
  }

  /* ------------------------------------------------------------------ */
  /* action handlers                                                    */
  /* ------------------------------------------------------------------ */

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // fallback for older browsers / non-secure contexts
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error("execCommand copy failed"));
      } catch (err) { reject(err); }
    });
  }

  function makeSnippet(json) {
    var id = json.id || "my-scenario";
    return 'window.CANAMED_SCENARIOS["' + id + '"] = ' +
      JSON.stringify(json, null, 2) + ';\n';
  }

  function wireActions() {
    document.querySelectorAll(".add-btn[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var which = btn.getAttribute("data-add");
        switch (which) {
          case "history":   STATE.history.push(emptyHistoryRow()); break;
          case "exam":      STATE.exam.push(emptyHistoryRow()); break;
          case "labs":      STATE.labs.push(emptyLabRow()); break;
          case "prompts":   STATE.prompts.push(emptyTrio()); break;
          case "scoringA":  STATE.scoringA.push(emptyScoringRow()); break;
          case "scoringB":  STATE.scoringB.push(emptyScoringRow()); break;
          case "penalties": STATE.penalties.push(emptyPenaltyRow()); break;
          case "decisions": STATE.decisions.push(emptyDecision()); break;
        }
        renderAll();
      });
    });

    var addNodeBtn = document.getElementById("btn-add-branched-node");
    if (addNodeBtn) addNodeBtn.addEventListener("click", function () {
      STATE.branchedNodes.push(emptyBranchedNode());
      renderAll();
    });

    document.getElementById("btn-validate").addEventListener("click", function () {
      showValidation(validate());
    });

    var btnPreview = document.getElementById("btn-preview");
    if (btnPreview) btnPreview.addEventListener("click", renderPreview);

    document.getElementById("btn-copy").addEventListener("click", function () {
      var snippet = makeSnippet(toScenarioJson());
      copyToClipboard(snippet).then(function () {
        var out = document.getElementById("validation-output");
        out.className = "validation-output success";
        out.textContent = "Snippet copied to clipboard. Paste it at the bottom of case-content.js, inside the CANAMED_SCENARIOS object.";
      }).catch(function (err) {
        var out = document.getElementById("validation-output");
        out.className = "validation-output error";
        out.textContent = "Copy failed: " + err.message + ". Select the JSON preview manually and copy with Ctrl+C.";
      });
    });

    document.getElementById("btn-download").addEventListener("click", function () {
      var json = toScenarioJson();
      var pretty = JSON.stringify(json, null, 2);
      var blob = new Blob([pretty], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = (json.id || "scenario") + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    document.getElementById("btn-load").addEventListener("click", function () {
      document.getElementById("load-modal").classList.remove("hidden");
      document.getElementById("load-textarea").value = "";
      document.getElementById("load-error").textContent = "";
      document.getElementById("load-error").className = "validation-output";
    });
    document.getElementById("btn-load-cancel").addEventListener("click", function () {
      document.getElementById("load-modal").classList.add("hidden");
    });
    document.getElementById("btn-load-apply").addEventListener("click", function () {
      var txt = document.getElementById("load-textarea").value;
      var errOut = document.getElementById("load-error");
      try {
        var parsed = tryParseScenarioInput(txt);
        STATE = scenarioJsonToState(parsed);
        renderAll();
        document.getElementById("load-modal").classList.add("hidden");
        var out = document.getElementById("validation-output");
        out.className = "validation-output success";
        out.textContent = "Loaded scenario '" + (STATE.meta.id || "(no id)") + "' into the form.";
      } catch (err) {
        errOut.className = "validation-output error";
        errOut.textContent = err.message;
      }
    });

    document.getElementById("btn-reset").addEventListener("click", function () {
      if (window.confirm("Discard the current form and start over?")) {
        STATE = defaultState();
        renderAll();
        var out = document.getElementById("validation-output");
        out.className = "validation-output";
        out.textContent = "";
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  function boot() {
    wireActions();
    renderAll();
  }

  // expose for debugging / tests
  if (typeof window !== "undefined") {
    window.__scenarioAuthor = {
      getState: function () { return STATE; },
      setState: function (s) { STATE = s; renderAll(); },
      toJson: toScenarioJson,
      fromJson: scenarioJsonToState,
      validate: validate,
      parseInput: tryParseScenarioInput
    };
  }
})();
