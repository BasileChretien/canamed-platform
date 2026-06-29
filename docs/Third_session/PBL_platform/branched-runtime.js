/* branched-runtime.js
 *
 * Pure path resolver for the branched-scenarios format. Given the branch tree
 * (a validated `decisions` array) and the room's committed choices, it answers
 * the only two questions the épuré renderer needs:
 *
 *   - which ONE node is active right now (show its prompt + options); and
 *   - what is the trail of choices already locked in (so we can show each
 *     consequence narrative — branch.reveal — leading up to here).
 *
 * It deliberately does NOT compute score: a branched node IS a decision, so the
 * existing scoring engine (script.js) already awards its points/penalty to the
 * room leaderboard. Keeping score out of here avoids two sources of truth.
 *
 * `committed` is a plain map { decisionId: optionIndex } — in the app this is
 * derived from roomVotes[id].committed.choice, which already syncs across the
 * room, so every member resolves the same active node. Pure + dependency-free
 * (shares afterSpec with branched-validate.js so the edge model can't drift).
 *
 * Returns { trail:[{ id, optionIndex, reveal }], active, done }.
 */
(function (root) {
  "use strict";

  // Single source of truth for the edge model: reuse branched-validate's
  // afterSpec (Node: require; browser: the global it published on load).
  const V =
    typeof require !== "undefined"
      ? require("./branched-validate.js")
      : root.CanamedBranched || {};
  const afterSpec =
    V._afterSpec ||
    function (node) {
      const w = node && node.unlockWhen;
      if (!w || w.afterDecision == null) return null;
      const a = w.afterDecision;
      if (typeof a === "string") return { id: a, option: null };
      if (a && typeof a === "object" && a.id) {
        let opt = null;
        if (typeof a.option === "number") opt = a.option;
        else if (Array.isArray(a.option)) {
          const nums = a.option.filter((n) => typeof n === "number");
          opt = nums.length ? nums : null;
        }
        return { id: a.id, option: opt };
      }
      return { id: null, option: null };
    };
  // Shared option matcher (null=any, N=exact, [N,…]=any listed). Prefer the
  // validator's copy so the edge model can't drift; fall back to a local one.
  const optionMatches =
    V._optionMatches ||
    function (specOption, choice) {
      if (specOption == null) return true;
      if (Array.isArray(specOption)) return specOption.indexOf(choice) !== -1;
      return specOption === choice;
    };

  /* True when node N's unlock gate is satisfied by the committed choices. An
   * entry node (no gate) is always available; a gated node is available once
   * its dependency is committed to the required option (or any listed option). */
  function isAvailable(node, committed) {
    const spec = afterSpec(node);
    if (!spec) return true;
    if (!(spec.id in committed)) return false;
    return optionMatches(spec.option, committed[spec.id]);
  }

  function branchedPath(decisions, committed) {
    const nodes = Array.isArray(decisions) ? decisions : [];
    committed = committed || {};
    const byId = Object.create(null);
    nodes.forEach((n) => {
      if (n && n.id) byId[n.id] = n;
    });

    const entry = nodes.find((n) => n && n.id && !afterSpec(n)) || null;

    // Walk the committed chain from the entry node, in order, collecting each
    // locked-in choice and its consequence narrative. Guard against malformed
    // cycles with a visited set (a committed node is only followed once).
    const trail = [];
    const seen = new Set();
    let cur = entry;
    while (cur && cur.id in committed && !seen.has(cur.id)) {
      seen.add(cur.id);
      const optionIndex = committed[cur.id];
      const opt =
        (Array.isArray(cur.options) && cur.options[optionIndex]) || null;
      const reveal =
        opt && opt.branch && opt.branch.reveal ? opt.branch.reveal : null;
      trail.push({ id: cur.id, optionIndex, reveal });
      // The next committed node is the child gated on (cur.id, optionIndex)
      // that is itself committed; otherwise the chain stops here.
      const next = nodes.find((c) => {
        const s = afterSpec(c);
        return (
          s && s.id === cur.id && optionMatches(s.option, optionIndex) && c.id in committed
        );
      });
      cur = next || null;
    }

    // The active node is the available-but-uncommitted node. For a well-formed
    // tree there is exactly one; if several (a quirky multi-fork), document
    // order wins so the renderer always shows a single, deterministic node.
    const active =
      nodes.find(
        (n) => n && n.id && !(n.id in committed) && isAvailable(n, committed),
      ) || null;

    return { trail, active, done: active == null };
  }

  const api = { branchedPath, _isAvailable: isAvailable };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") {
    root.CanamedBranchedRuntime = api;
  }
})(typeof window !== "undefined" ? window : this);
