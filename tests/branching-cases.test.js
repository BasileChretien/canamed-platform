/* tests/branching-cases.test.js
 *
 * Lock-in for branching cases (2026-05-21) — the first vertical slice.
 * A decision option may carry `branch: { reveal: {en,fr,ja} }`; when the room
 * locks in that option, the engine renders the consequence narrative ("what
 * happens next"), turning the decision into a fork. Derived from the synced
 * committed choice, so no new Firebase path or rules are needed.
 *
 * dec_prognosis (Module B, Mrs Tanaka) is the worked example: all three
 * responses branch to distinct reactions.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CASE = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

test("case-content documents the branch model + dec_prognosis branches all 3 options", () => {
  assert.match(CASE, /BRANCHING CASES \(model\)/,
    "the branch content model must be documented for future authors");
  // Isolate the dec_prognosis decision block.
  const start = CASE.indexOf('id: "dec_prognosis"');
  assert.ok(start > -1, "dec_prognosis must exist");
  const block = CASE.slice(start, CASE.indexOf('id: "dec_ercp_stent"'));
  const branchCount = block.split("branch: { reveal:").length - 1;
  assert.strictEqual(branchCount, 3,
    "all three dec_prognosis options must carry a branch.reveal (got " + branchCount + ")");
  // Each reveal must be trilingual.
  const revealBlocks = block.split("branch: { reveal:").slice(1);
  for (const rb of revealBlocks) {
    const head = rb.slice(0, 2000);
    assert.match(head, /\ben:/, "branch.reveal must have en");
    assert.match(head, /\bfr:/, "branch.reveal must have fr");
    assert.match(head, /\bja:/, "branch.reveal must have ja");
  }
});

test("the engine renders a committed option's branch as a consequence (no innerHTML)", () => {
  const i = SCRIPT.indexOf("BRANCHING");
  assert.ok(i > -1, "renderDecisions must have the branch-render block");
  const blk = SCRIPT.slice(i, i + 900);
  assert.match(blk, /opt\.branch\b/, "must read branch off the committed option");
  assert.match(blk, /tc\(opt\.branch\.reveal/, "must localise branch.reveal via tc()");
  assert.match(blk, /dec-branch/, "must render a .dec-branch element");
  assert.match(blk, /\.textContent\s*=\s*branchText/, "narrative must be set via textContent");
  assert.doesNotMatch(blk, /innerHTML/, "branch render must not use innerHTML");
});

test("the branch consequence has a distinct style", () => {
  assert.match(CSS, /\.dec-branch\b/, "a .dec-branch style must exist");
});
