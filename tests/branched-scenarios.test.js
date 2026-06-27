/* tests/branched-scenarios.test.js
 *
 * Branched-scenarios format (2026-06-27) — the third activity format. It reuses
 * the existing decision engine (branch.reveal consequences + unlockWhen.
 * afterDecision chaining), so these tests lock the GRAPH VALIDATOR that guards
 * a branch tree before it is launched or saved: dangling refs, unreachable
 * nodes, dead choices, missing endings, trilingual coverage.
 *
 * Pure unit tests against branched-validate.js (no DOM, no Firebase).
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { validateBranchedGraph } = require(
  path.join(
    __dirname,
    "..",
    "docs",
    "Third_session",
    "PBL_platform",
    "branched-validate.js",
  ),
);

/* A minimal, sound 3-node branch tree: start → (option 0) follow-up → endings.
 * Built fresh per test via a factory so mutations don't leak between cases. */
function goodGraph() {
  return {
    format: "branched",
    decisions: [
      {
        id: "n0",
        points: 10,
        prompt: {
          en: "Patient is short of breath. You first…",
          fr: "Le patient est essoufflé. Vous…",
          ja: "患者は息切れしています。まず…",
        },
        options: [
          {
            text: {
              en: "Sit them up and give oxygen",
              fr: "Asseoir et oxygène",
              ja: "起坐位・酸素",
            },
            branch: {
              reveal: {
                en: "Their sats climb to 94%.",
                fr: "La SpO₂ remonte à 94 %.",
                ja: "SpO₂が94%に上昇。",
              },
            },
          },
          {
            text: {
              en: "Lie them flat for an ECG",
              fr: "Allonger pour un ECG",
              ja: "心電図のため臥位に",
            },
            branch: {
              reveal: {
                en: "They desaturate further.",
                fr: "La SpO₂ chute.",
                ja: "SpO₂がさらに低下。",
              },
            },
          },
        ],
      },
      {
        // Unlocks only when n0 option 0 is committed → the fork.
        id: "n1",
        points: 10,
        hideWhenLocked: true,
        unlockWhen: { afterDecision: { id: "n0", option: 0 } },
        prompt: {
          en: "Sats are 94%. Next step?",
          fr: "SpO₂ 94 %. Étape suivante ?",
          ja: "SpO₂ 94%。次は?",
        },
        options: [
          {
            text: {
              en: "Treat the cause",
              fr: "Traiter la cause",
              ja: "原因を治療",
            },
            branch: {
              reveal: {
                en: "Good — the team stabilises them.",
                fr: "Bien — l'équipe stabilise.",
                ja: "良好 — 安定化。",
              },
            },
          },
          {
            text: { en: "Wait and watch", fr: "Attendre", ja: "経過観察" },
            branch: {
              reveal: {
                en: "They deteriorate while you wait.",
                fr: "Il se dégrade.",
                ja: "悪化。",
              },
            },
          },
        ],
      },
    ],
  };
}

test("a sound branch tree validates ok with no errors", () => {
  const r = validateBranchedGraph(goodGraph());
  assert.strictEqual(
    r.ok,
    true,
    "expected ok; errors: " + JSON.stringify(r.errors),
  );
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.stats.nodes, 2);
  assert.strictEqual(r.stats.reachable, 2);
  assert.ok(r.stats.endings >= 1, "tree must have at least one ending");
});

test("a dangling afterDecision reference is a hard error", () => {
  const g = goodGraph();
  g.decisions[1].unlockWhen.afterDecision.id = "does_not_exist";
  const r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, false);
  assert.ok(
    r.errors.some((e) => /does_not_exist/.test(e)),
    "must name the missing node",
  );
});

test("an out-of-range option index on afterDecision is an error", () => {
  const g = goodGraph();
  g.decisions[1].unlockWhen.afterDecision.option = 9;
  const r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /option 9/.test(e)));
});

test("an unreachable node is an error", () => {
  const g = goodGraph();
  // Gate n1 behind n0 option 1, but ALSO add an orphan gated behind a never-picked path.
  g.decisions.push({
    id: "orphan",
    unlockWhen: { afterDecision: { id: "n1", option: 0 } },
    prompt: { en: "x", fr: "x", ja: "x" },
    options: [
      {
        text: { en: "a", fr: "a", ja: "a" },
        branch: { reveal: { en: "end", fr: "end", ja: "end" } },
      },
      {
        text: { en: "b", fr: "b", ja: "b" },
        branch: { reveal: { en: "end", fr: "end", ja: "end" } },
      },
    ],
  });
  // Make orphan unreachable: remove the reveal-only ending and instead make n1
  // option 0 lead to orphan — that IS reachable. To force unreachability, gate
  // orphan behind a non-existent option path: n0 option 5 (out of range too).
  g.decisions[g.decisions.length - 1].unlockWhen.afterDecision = {
    id: "nowhere",
    option: 0,
  };
  const r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /unreachable|does not exist/.test(e)));
});

test("no entry node (every node gated) is an error", () => {
  const g = goodGraph();
  g.decisions[0].unlockWhen = { afterDecision: { id: "n1", option: 0 } };
  const r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /entry node/.test(e)));
});

test("more than one entry node is a hard error (nondeterministic start)", () => {
  const g = goodGraph();
  // A second ungated node — branchedPath would start at one and ignore it.
  g.decisions.push({
    id: "m0",
    prompt: { en: "another start" },
    options: [
      { text: { en: "a" }, branch: { reveal: { en: "end a" } } },
      { text: { en: "b" }, branch: { reveal: { en: "end b" } } },
    ],
  });
  const r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /Multiple entry/.test(e)));
});

test("a node with fewer than 2 options is an error", () => {
  const g = goodGraph();
  g.decisions[0].options = [g.decisions[0].options[0]];
  const r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /at least 2 choices/.test(e)));
});

test("a dead choice (no follow-up, no consequence) is a warning, not an error", () => {
  const g = goodGraph();
  delete g.decisions[1].options[1].branch; // option leads nowhere and now shows nothing
  const r = validateBranchedGraph(g);
  assert.strictEqual(
    r.ok,
    true,
    "dead choice must not block: " + JSON.stringify(r.errors),
  );
  assert.ok(r.warnings.some((w) => /dead choice/.test(w)));
});

test("English-canonical: missing fr/ja is NOT flagged; missing en IS an error", () => {
  // Branched content is English-only (the hovering reader supplies fr/ja at
  // read-time), so absent fr/ja must produce neither error nor warning —
  // otherwise the editor's panel drowns in noise.
  const g = goodGraph();
  delete g.decisions[0].prompt.fr;
  delete g.decisions[0].prompt.ja;
  let r = validateBranchedGraph(g);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(
    r.warnings.filter((w) => /missing|fr|ja/i.test(w)).length,
    0,
    "no language-coverage warnings for English-canonical content",
  );

  const g2 = goodGraph();
  delete g2.decisions[0].prompt.en;
  r = validateBranchedGraph(g2);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /no English prompt/.test(e)));
});

test("an empty decisions array is rejected", () => {
  const r = validateBranchedGraph({ format: "branched", decisions: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /at least one decision/.test(e)));
});
