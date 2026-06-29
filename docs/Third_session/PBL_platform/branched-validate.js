/* branched-validate.js
 *
 * Pure validator for the "branched scenarios" format (the third activity
 * format, alongside PBL/Module-A and roleplay/Module-B). A branched scenario
 * is NOT a new runtime: it reuses the existing decision engine — each node is
 * a `decision` (id + prompt + options), each option may carry a
 * `branch.reveal` consequence, and an option forks the case by UNLOCKING a
 * follow-up decision through `unlockWhen.afterDecision: { id, option }`
 * (see decisionUnlocked() in script.js, and the BRANCHING CASES note in
 * case-content.js). This module checks that the resulting graph is sound
 * BEFORE it is launched or saved:
 *
 *   - every node has a stable id and at least two options;
 *   - exactly one entry node (no `afterDecision`);
 *   - every `afterDecision` reference resolves to a real node + option;
 *   - every node is reachable from the entry node;
 *   - the graph terminates (at least one reachable ending);
 *   - no option is a dead choice (leads nowhere AND shows no consequence).
 *
 * It is shared by the runtime (refuse to launch an invalid graph) and the
 * authoring UI (live error panel). Pure + dependency-free so it runs in the
 * browser and under `node --test`.
 *
 * Returns { ok, errors:[…], warnings:[…], stats:{ nodes, reachable, endings } }.
 * `ok` is true iff there are zero errors. Warnings never block.
 */
(function (root) {
  "use strict";

  /* Read an afterDecision gate off a node, normalised to { id, option } where
   * option is a number, a non-empty array of numbers, or null. null = entry
   * node. Accepts the documented forms:
   *   afterDecision: "dec_x"               → any committed option of dec_x
   *   afterDecision: { id, option: N }     → only committed option N
   *   afterDecision: { id, option: [N,…] } → any of these committed options
   * The array form lets several wrong options of a 4-choice node converge onto
   * one consequence node (e.g. every poor first move → the deterioration path)
   * without duplicating that node per option. */
  function afterSpec(node) {
    const w = node && node.unlockWhen;
    if (!w || w.afterDecision == null) return null;
    const a = w.afterDecision;
    if (typeof a === "string") return { id: a, option: null };
    if (a && typeof a === "object" && a.id) {
      let opt = null;
      if (typeof a.option === "number") opt = a.option;
      else if (Array.isArray(a.option)) {
        // An array with no valid option index is MALFORMED — do NOT widen it to
        // null ("any option"), or a typo would silently unlock the branch on
        // every choice. Return a dangling spec so the validator flags it.
        const nums = a.option.filter((n) => Number.isInteger(n));
        if (!nums.length) return { id: null, option: null };
        opt = nums;
      }
      return { id: a.id, option: opt };
    }
    return { id: null, option: null }; // malformed; caught as a dangling ref
  }

  /* Does a committed option index satisfy a gate's option spec?
   *   null  → any option        N → exactly N        [N,…] → any listed */
  function optionMatches(specOption, choice) {
    if (specOption == null) return true;
    if (Array.isArray(specOption)) return specOption.indexOf(choice) !== -1;
    return specOption === choice;
  }

  /* Branched scenarios are English-canonical: their content is authored in
   * English only, and the in-product hovering reader (lang-reader.js) supplies
   * FR/JA at read-time. So the validator requires a non-empty English string
   * and does NOT flag missing FR/JA — that would be noise on every node and
   * would bury the real errors in the editor's live panel. */
  function hasEn(field) {
    return !!(field && typeof field.en === "string" && field.en.trim());
  }

  function validateBranchedGraph(scenario) {
    const errors = [];
    const warnings = [];
    const nodes =
      scenario && Array.isArray(scenario.decisions) ? scenario.decisions : null;

    if (!nodes || !nodes.length) {
      errors.push("A branched scenario needs at least one decision node.");
      return {
        ok: false,
        errors,
        warnings,
        stats: { nodes: 0, reachable: 0, endings: 0 },
      };
    }

    // ── Index nodes by id, flagging duplicates / missing ids. ───────────────
    const byId = Object.create(null);
    nodes.forEach((n, i) => {
      const id = n && n.id;
      if (!id || typeof id !== "string") {
        errors.push("Node #" + i + " has no id.");
        return;
      }
      if (byId[id]) errors.push('Duplicate node id "' + id + '".');
      byId[id] = n;
    });

    // ── Per-node shape: options, trilingual prompt. ─────────────────────────
    nodes.forEach((n) => {
      if (!n || !n.id) return;
      const opts = Array.isArray(n.options) ? n.options : [];
      if (opts.length < 2) {
        errors.push(
          'Node "' +
            n.id +
            '" must offer at least 2 choices (has ' +
            opts.length +
            ").",
        );
      }
      if (!hasEn(n.prompt))
        errors.push('Node "' + n.id + '" has no English prompt.');
      opts.forEach((o, oi) => {
        if (!hasEn(o && o.text))
          errors.push(
            'Node "' + n.id + '" option ' + oi + " has no English text.",
          );
      });
    });

    // ── Entry node(s): nodes with no afterDecision gate. ────────────────────
    const entries = nodes.filter((n) => n && n.id && !afterSpec(n));
    if (entries.length === 0) {
      errors.push(
        "No entry node: every node is gated behind another, so the case can never start.",
      );
    } else if (entries.length > 1) {
      // More than one ungated node is a hard error, not a warning: the runtime
      // (branchedPath) starts at the FIRST available node and silently ignores
      // the rest, so a multi-entry graph is nondeterministic. Reject it up front.
      errors.push(
        "Multiple entry nodes (" +
          entries.map((n) => n.id).join(", ") +
          "); a branched scenario must have exactly one start. Gate the extras " +
          "behind a choice, or merge them.",
      );
    }

    // ── Resolve every afterDecision reference. ──────────────────────────────
    nodes.forEach((n) => {
      const spec = afterSpec(n);
      if (!spec) return;
      if (!spec.id || !byId[spec.id]) {
        errors.push(
          'Node "' +
            n.id +
            '" unlocks after "' +
            (spec.id || "?") +
            '", which does not exist.',
        );
        return;
      }
      if (spec.option != null) {
        const dep = byId[spec.id];
        const count = Array.isArray(dep.options) ? dep.options.length : 0;
        const wanted = Array.isArray(spec.option) ? spec.option : [spec.option];
        wanted.forEach((o) => {
          if (o < 0 || o >= count) {
            errors.push(
              'Node "' +
                n.id +
                '" unlocks after "' +
                spec.id +
                '" option ' +
                o +
                ", but that option does not exist (has " +
                count +
                ").",
            );
          }
        });
      }
    });

    // ── Reachability BFS from the entry node(s). ────────────────────────────
    // Edge model: from (parentId, optionIndex) to any child whose afterSpec
    // matches that parent and either targets that exact option or any option.
    const childrenOf = (parentId, optIdx) =>
      nodes.filter((c) => {
        const s = afterSpec(c);
        return s && s.id === parentId && optionMatches(s.option, optIdx);
      });
    const reachable = new Set();
    const queue = entries.map((n) => n.id);
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id) || !byId[id]) continue;
      reachable.add(id);
      const node = byId[id];
      const opts = Array.isArray(node.options) ? node.options : [];
      opts.forEach((_o, oi) => {
        childrenOf(id, oi).forEach((c) => {
          if (!reachable.has(c.id)) queue.push(c.id);
        });
      });
    }
    nodes.forEach((n) => {
      if (n && n.id && !reachable.has(n.id)) {
        errors.push(
          'Node "' +
            n.id +
            '" is unreachable — no committed choice leads to it.',
        );
      }
    });

    // ── Endings + dead-choice detection over reachable nodes. ───────────────
    // An ending is a reachable option that shows a consequence (branch.reveal)
    // and unlocks no follow-up. A dead choice unlocks nothing AND shows no
    // consequence — picking it visibly does nothing.
    let endings = 0;
    reachable.forEach((id) => {
      const node = byId[id];
      const opts = Array.isArray(node.options) ? node.options : [];
      opts.forEach((o, oi) => {
        const leadsOn = childrenOf(id, oi).length > 0;
        const hasReveal = !!(
          o &&
          o.branch &&
          o.branch.reveal &&
          hasEn(o.branch.reveal)
        );
        if (!leadsOn && hasReveal) endings++;
        if (!leadsOn && !hasReveal) {
          warnings.push(
            'Node "' +
              id +
              '" option ' +
              oi +
              " is a dead choice: it unlocks nothing and shows no consequence.",
          );
        }
      });
    });
    if (reachable.size && endings === 0) {
      warnings.push(
        "The graph has no ending: no reachable choice closes the case with a consequence.",
      );
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats: { nodes: nodes.length, reachable: reachable.size, endings },
    };
  }

  const api = {
    validateBranchedGraph,
    _afterSpec: afterSpec,
    _optionMatches: optionMatches,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.CanamedBranched = api;
})(typeof window !== "undefined" ? window : this);
