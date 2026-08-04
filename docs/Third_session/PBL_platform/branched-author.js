/* branched-author.js
 *
 * Emit core for the branched-scenario authoring editor. Authors think in
 * FORWARD edges — "if they pick this choice, the case goes to node X" — but the
 * runtime gates a node on a PRIOR committed choice via the reverse
 * `unlockWhen.afterDecision`. This module is the pure translation between the
 * two: given the editor's node list (each option carrying a `next` target id,
 * or null to end the case), it builds the validated branched-scenario object
 * the runtime + validator consume.
 *
 * Edge → gate rules (a node carries at most ONE afterDecision gate):
 *   - a node no option points to is the ENTRY (no gate);
 *   - a node reached from a SINGLE option of one parent → afterDecision
 *     { id: parent, option: k } (only that choice opens it);
 *   - a node reached from a SUBSET of one parent's options → afterDecision
 *     { id: parent, option: [k…] } (any of those choices, and only those);
 *   - a node reached from EVERY option of the same parent → afterDecision
 *     "parent" (id-only: whatever they pick, the case converges here);
 *   - a node reached from MORE THAN ONE parent cannot be expressed by the
 *     single-gate model — it is gated on the first incoming edge and reported
 *     in `warnings` (the UI should steer authors away from cross-parent merges).
 *
 * English-only (the hovering reader supplies fr/ja at read-time). Pure +
 * dependency-free: emits the object; callers run validateBranchedGraph on it.
 *
 * buildBranchedScenario(meta, nodes) -> { scenario, warnings:[…] }
 *   meta  = { id, name, summary, title?, shell?, extra? }
 *   nodes = [{ id, stem, points?, penalty?, why?, hideWhenLocked?,
 *              unlockWhenExtra?, extra?,
 *              options:[{ text, correct?, consequence?, why?, next?,
 *                         branchExtra?, extra? }] }]
 *
 * PASSTHROUGH (`shell` / `extra` / `unlockWhenExtra` / `branchExtra`) — the
 * branched editor models a small slice of the branched shape, and everything it
 * did not model used to be DESTROYED the moment a case was loaded and
 * re-exported: the real shipped ward-escalation case lost all 5 evidence
 * `documents` panels, all 16 option `why` rationales and one whole gate (41% of
 * its bytes), silently. The standard editor solved this years ago with an
 * `_extra` bag; these fields are the same idea for the branched path. Unmodeled
 * content round-trips byte-for-byte while staying uneditable, which is the
 * honest contract: the editor may not show a field, but it must never eat one.
 */
(function (root) {
  "use strict";

  const en = (s) => ({ en: typeof s === "string" ? s : "" });

  /* The non-graph half of a branched scenario. A case LOADED into the editor
     re-emits exactly the shell it arrived with (including the ABSENCE of a
     key); a scenario authored from scratch gets the empty stand-ins that keep
     case-derived runtime code from choking on a pure decision flow. */
  const SHELL_KEYS = ["moduleBName", "case", "scoring", "penalties", "synthPrereqs"];
  const DEFAULT_SHELL = () => ({
    // A branched scenario is pure decision flow — empty clinical stand-ins
    // keep case-derived code from choking (mirrors branched-seed.js).
    case: { history: [], exam: [], labs: [] },
    scoring: {},
    penalties: [],
    synthPrereqs: [],
  });

  // Re-emit captured-but-unmodeled keys without clobbering anything the editor
  // actually set (same contract as scenario-author.js's mergeExtra).
  function mergeExtra(base, extra) {
    if (extra && typeof extra === "object" && !Array.isArray(extra)) {
      Object.keys(extra).forEach((k) => {
        if (!(k in base)) base[k] = extra[k];
      });
    }
    return base;
  }
  function hasKeys(o) {
    return !!(o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length);
  }

  function buildBranchedScenario(meta, nodes) {
    meta = meta || {};
    nodes = Array.isArray(nodes) ? nodes : [];
    const warnings = [];

    // Collect incoming edges per target node: { targetId: [{ parent, opt }] }.
    const incoming = Object.create(null);
    nodes.forEach((n) => {
      const opts = Array.isArray(n.options) ? n.options : [];
      opts.forEach((o, oi) => {
        const next = o && o.next;
        if (next) {
          (incoming[next] = incoming[next] || []).push({
            parent: n.id,
            opt: oi,
          });
        }
      });
    });

    // A `next` that matches no node id can't become a gate (gateFor only runs
    // for real nodes), so the edge would vanish and the choice quietly become an
    // ending. Warn rather than swallow it — the author almost certainly meant to
    // point somewhere real (e.g. a node they renamed or have not added yet).
    const nodeIds = new Set(nodes.map((n) => n && n.id).filter(Boolean));
    nodes.forEach((n) => {
      (Array.isArray(n.options) ? n.options : []).forEach((o, oi) => {
        if (o && o.next && !nodeIds.has(o.next)) {
          warnings.push(
            'Node "' + n.id + '" choice ' + oi + ' points to "' + o.next +
              '", which is not a node — that choice will silently end the case.'
          );
        }
      });
    });

    function gateFor(nodeId) {
      const edges = incoming[nodeId] || [];
      if (!edges.length) return null; // entry node
      const parents = Array.from(new Set(edges.map((e) => e.parent)));
      if (parents.length > 1) {
        warnings.push(
          'Node "' +
            nodeId +
            '" is reached from more than one node (' +
            parents.join(", ") +
            "); only the first path will open it. " +
            "Point those choices at separate nodes, or merge the earlier nodes.",
        );
      }
      const p = parents[0];
      const fromP = edges.filter((e) => e.parent === p);
      const distinctOpts = Array.from(new Set(fromP.map((e) => e.opt)))
        .sort((a, b) => a - b);
      if (distinctOpts.length === 1) return { id: p, option: distinctOpts[0] };
      /* SEVERAL options of the same parent. "Any option" (the id-only gate) is
         only true when EVERY one of the parent's choices lands here — the old
         code emitted it for any convergence, so a node reached from 3 of a
         parent's 4 choices also opened after the 4th. The runtime and the graph
         validator both accept an option ARRAY, which says exactly what the
         author drew; use it whenever the convergence is a subset. */
      const parent = nodes.filter((n) => n && n.id === p)[0];
      const parentOptCount = (parent && Array.isArray(parent.options))
        ? parent.options.length : 0;
      if (parentOptCount && distinctOpts.length >= parentOptCount) return p;
      return { id: p, option: distinctOpts };
    }

    const decisions = nodes.map((n) => {
      const gate = gateFor(n.id);
      const d = {
        id: n.id,
        module: "A",
        points: typeof n.points === "number" ? n.points : 10,
        penalty: typeof n.penalty === "number" ? n.penalty : 5,
        prompt: en(n.stem),
        options: (Array.isArray(n.options) ? n.options : []).map((o) => {
          o = o || {};
          const opt = { text: en(o.text), correct: !!o.correct };
          // `branch` carries the consequence narrative AND any unmodeled fork
          // keys (a group vote, a future reveal variant) captured on load.
          if (o.consequence || hasKeys(o.branchExtra)) {
            opt.branch = {};
            if (o.consequence) opt.branch.reveal = en(o.consequence);
            mergeExtra(opt.branch, o.branchExtra);
          }
          if (o.why) opt.why = en(o.why);
          return mergeExtra(opt, o.extra);
        }),
      };
      /* unlockWhen is DERIVED from the forward edges, but a loaded gate may
         also carry conditions the editor has no arrow for (hypotheses,
         historyRevealed…). Emit the derived afterDecision alongside those. */
      const gateExtra = hasKeys(n.unlockWhenExtra) ? n.unlockWhenExtra : null;
      if (gate != null || gateExtra) {
        d.unlockWhen = {};
        if (gate != null) d.unlockWhen.afterDecision = gate;
        mergeExtra(d.unlockWhen, gateExtra);
      }
      /* A gated follow-up lands as a surprise fork, so it hides while locked —
         unless the loaded case said otherwise, which is a decision the author
         made and the editor must not overwrite. */
      if (typeof n.hideWhenLocked === "boolean") d.hideWhenLocked = n.hideWhenLocked;
      else if (gate != null) d.hideWhenLocked = true;
      return mergeExtra(d, n.extra);
    });

    const scenario = {
      id: meta.id || "",
      format: "branched",
      name: en(meta.name || meta.title),
      summary: en(meta.summary),
      moduleAName: en(meta.title || meta.name),
    };
    const shell = (meta.shell && typeof meta.shell === "object" && !Array.isArray(meta.shell))
      ? meta.shell : DEFAULT_SHELL();
    SHELL_KEYS.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(shell, k)) scenario[k] = shell[k];
    });
    scenario.decisions = decisions;

    return { scenario: mergeExtra(scenario, meta.extra), warnings };
  }

  const api = { buildBranchedScenario };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.CanamedBranchedAuthor = api;
})(typeof window !== "undefined" ? window : this);
