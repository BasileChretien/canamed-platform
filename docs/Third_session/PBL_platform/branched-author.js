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
 *   - a node reached from SEVERAL options of the SAME parent → afterDecision
 *     "parent" (id-only: any of that parent's choices converge here);
 *   - a node reached from MORE THAN ONE parent cannot be expressed by the
 *     single-gate model — it is gated on the first incoming edge and reported
 *     in `warnings` (the UI should steer authors away from cross-parent merges).
 *
 * English-only (the hovering reader supplies fr/ja at read-time). Pure +
 * dependency-free: emits the object; callers run validateBranchedGraph on it.
 *
 * buildBranchedScenario(meta, nodes) -> { scenario, warnings:[…] }
 *   meta  = { id, name, summary, title? }
 *   nodes = [{ id, stem, points?, penalty?,
 *              options:[{ text, correct?, consequence?, next? }] }]
 */
(function (root) {
  "use strict";

  const en = (s) => ({ en: typeof s === "string" ? s : "" });

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
      // Several distinct options of the same parent → "any option" (id-only).
      const distinctOpts = Array.from(new Set(fromP.map((e) => e.opt)));
      return distinctOpts.length > 1 ? p : { id: p, option: distinctOpts[0] };
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
          const opt = { text: en(o && o.text), correct: !!(o && o.correct) };
          if (o && o.consequence) opt.branch = { reveal: en(o.consequence) };
          if (o && o.why) opt.why = en(o.why);
          return opt;
        }),
      };
      if (gate != null) {
        d.unlockWhen = { afterDecision: gate };
        d.hideWhenLocked = true; // a follow-up lands as a surprise fork
      }
      return d;
    });

    const scenario = {
      id: meta.id || "",
      format: "branched",
      name: en(meta.name || meta.title),
      summary: en(meta.summary),
      moduleAName: en(meta.title || meta.name),
      moduleBName: en("Reflection"),
      // A branched scenario is pure decision flow — empty clinical stand-ins
      // keep case-derived code from choking (mirrors branched-seed.js).
      case: { history: [], exam: [], labs: [] },
      scoring: {},
      penalties: [],
      synthPrereqs: [],
      decisions,
    };

    return { scenario, warnings };
  }

  const api = { buildBranchedScenario };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.CanamedBranchedAuthor = api;
})(typeof window !== "undefined" ? window : this);
