/* tests/modA-vote-flow.test.js
 *
 * Session-3 prep (2026-05-27): two facilitator asks for Module A —
 *   1. "Reduce the number of discussion prompts — it must be faster to do."
 *      The chronic-pain and breaking-bad-news discussion-prompt banks were
 *      trimmed (removal only; the kept Franco-Japanese prompts are untouched).
 *   2. "The decide-together vote is never opened." An always-open Module A vote
 *      never fires the locked→unlocked auto-open, and the synthesis/discussion
 *      auto-switches pull the team off the Decisions tab, so a team could finish
 *      the module without ever casting it. The flow now routes a finished
 *      discussion to the OPEN vote first (hasOpenUncommittedModuleAVote), and
 *      only opens Group answers once the vote is settled.
 *
 * Content counts are checked by evaluating case-content.js with a window shim;
 * the routing wiring is checked against the script.js source text (the same
 * lightweight approach as modb-vote-autoopen.test.js).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function loadCases() {
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.__CASE = CASE; this.__CASE_B = CASE_B; this.__CASE_C = CASE_C; this.__DEC = DECISIONS; this.__DEC_B = DECISIONS_B;";
  const ctx = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, {}, {});
  return { CASE: ctx.__CASE, CASE_B: ctx.__CASE_B, CASE_C: ctx.__CASE_C, DECISIONS: ctx.__DEC, DECISIONS_B: ctx.__DEC_B };
}

const tri = o => !!(o && typeof o.en === "string" && o.en &&
                    typeof o.fr === "string" && o.fr &&
                    typeof o.ja === "string" && o.ja);

test("chronic-pain discussion prompts further trimmed for speed (now 5), all trilingual", () => {
  const { CASE } = loadCases();
  assert.equal(CASE.prompts.length, 5, "chronic-pain should keep 5 discussion prompts");
  CASE.prompts.forEach((p, i) => assert.ok(tri(p), "prompt " + i + " must stay en/fr/ja"));
  // The kept spine: differential / plan(+explanation) / one FR-JP compare /
  // safety-net / take-a-position(+disagreement). Matched on stable lead-ins.
  const leads = CASE.prompts.map(p => p.en);
  assert.ok(leads.some(t => /^Differential first/.test(t)), "differential prompt kept");
  assert.ok(leads.some(t => /^Management plan/.test(t)), "management-plan prompt kept (now folds in the explanation skill)");
  assert.ok(leads.some(t => /opioid prescribing culture/.test(t)), "one Franco-Japanese comparison kept");
  assert.ok(leads.some(t => /^Take a position/.test(t)), "closing 'take a position' kept");
  // The closing prompt now elicits the disagreement live (feeds the 'disagree' bullet).
  assert.ok(leads.some(t => /could not agree on/.test(t)), "take-a-position now names one disagreement live");
  // The removed/merged overlapping prompts are gone.
  assert.ok(!leads.some(t => /^Explanation skill/.test(t)), "standalone explanation-skill prompt merged into the plan");
  assert.ok(!leads.some(t => /the medication request/.test(t)), "medication-request prompt removed");
  assert.ok(!leads.some(t => /the role of imaging/.test(t)), "imaging-comparison prompt removed");
});

test("breaking-bad-news discussion prompts further trimmed (now 5), all trilingual", () => {
  const { CASE_B } = loadCases();
  assert.equal(CASE_B.prompts.length, 5, "BBN should keep 5 discussion prompts");
  CASE_B.prompts.forEach((p, i) => assert.ok(tri(p), "BBN prompt " + i + " must stay en/fr/ja"));
  const leads = CASE_B.prompts.map(p => p.en);
  assert.ok(leads.some(t => /^Differential first/.test(t)), "differential kept");
  assert.ok(leads.some(t => /SPIKES in practice/.test(t)), "SPIKES prompt kept");
  assert.ok(leads.some(t => /The son's request/.test(t)), "the core disclosure-conflict prompt kept");
  assert.ok(leads.some(t => /the legal & professional default/.test(t)), "the key legal comparison kept");
  assert.ok(leads.some(t => /^Take a position/.test(t)), "closing 'take a position' kept");
  // Removed/absorbed: 'After the news' and the advance-care-planning step.
  assert.ok(!leads.some(t => /^After the news/.test(t)), "'After the news' prompt removed");
  assert.ok(!leads.some(t => /advance-care-planning step/.test(t)), "ACP-step prompt removed");
});

test("sore-throat discussion prompts collapsed (10 → 5): the four FR-JP comparisons became one", () => {
  const { CASE_C } = loadCases();
  assert.equal(CASE_C.prompts.length, 5, "sore-throat should keep 5 discussion prompts");
  CASE_C.prompts.forEach((p, i) => assert.ok(tri(p), "CASE_C prompt " + i + " must stay en/fr/ja"));
  const leads = CASE_C.prompts.map(p => p.en);
  // Exactly ONE 'Compare France & Japan' prompt now (was four + a delayed-prescribing prompt).
  assert.equal(leads.filter(t => /^Compare France & Japan/.test(t)).length, 1,
    "the four overlapping FR-JP comparisons were collapsed into a single stewardship comparison");
  assert.ok(leads.some(t => /^Differential first/.test(t)), "differential kept");
  assert.ok(leads.some(t => /^Symptomatic plan/.test(t)), "symptomatic-plan prompt kept (folds in the explanation skill)");
  assert.ok(leads.some(t => /^Safety netting/.test(t)), "safety-net kept");
  assert.ok(leads.some(t => /^Take a position/.test(t)), "closing 'take a position' kept");
  assert.ok(!leads.some(t => /the financial signal/.test(t)), "the standalone 'financial signal' comparison removed");
  assert.ok(!leads.some(t => /somebody else's problem/.test(t)), "the AMR-slogan comparison removed");
});

test("the chronic-pain Module A vote (dec_opioid) is unlocked from the start", () => {
  const { DECISIONS } = loadCases();
  const modA = DECISIONS.filter(d => d.module === "A");
  assert.ok(modA.length >= 1, "chronic-pain must have at least one Module A vote");
  const opioid = DECISIONS.find(d => d.id === "dec_opioid");
  assert.ok(opioid && !opioid.unlockWhen, "dec_opioid stays always-open (this is why it never auto-fired)");
});

test("breaking-bad-news Module A has no vote (votes live in Module B) — routing must no-op there", () => {
  const { DECISIONS_B } = loadCases();
  assert.equal(DECISIONS_B.filter(d => d.module === "A").length, 0,
    "BBN Module A has no decide-together vote; hasOpenUncommittedModuleAVote() must return false there");
});

function sliceFn(name, nextMarker) {
  const start = SCRIPT.indexOf("function " + name);
  assert.ok(start >= 0, name + " must exist");
  const end = SCRIPT.indexOf(nextMarker, start + 1);
  return SCRIPT.slice(start, end > start ? end : start + 3000);
}

test("hasOpenUncommittedModuleAVote() gates on module A, unlock state, and commit", () => {
  const fn = sliceFn("hasOpenUncommittedModuleAVote", "function ");
  assert.match(fn, /d\.module === "A"/, "filters Module A decisions only");
  assert.match(fn, /decisionUnlocked/, "only counts a vote that is actually unlocked/votable");
  assert.match(fn, /committed/, "skips a vote the team already committed");
});

test("finishing the discussion routes to the open vote, else to Group answers", () => {
  const fn = sliceFn("renderPrompts", "function renderContrib");
  const doneBlock = fn.slice(fn.indexOf("promptsWereDone = true"));
  assert.match(doneBlock, /hasOpenUncommittedModuleAVote\(\)\s*\)\s*\?\s*"decisions"\s*:\s*"answers"/,
    "open vote → decisions, otherwise → answers");
  assert.match(doneBlock, /switchRcolTab\(_target\)/, "switches to the computed target");
});

test("renderDecisions completes the flow to Group answers once the vote is settled", () => {
  const fn = sliceFn("renderDecisions", "function buildLockedDecision");
  assert.match(fn, /moduleASettled/, "tracks when no open Module A vote remains");
  assert.match(fn, /promptsWereDone/, "only completes after the discussion is done");
  assert.match(fn, /lastModuleAVotesAllCommitted/, "fires once on the settle transition");
  assert.match(fn, /switchRcolTab\("answers"\)/, "opens Group answers when settled");
});

test("the hypotheses listener repaints the decisions panel (gate-refresh bug, 2026-06-16)", () => {
  // A hypotheses-gated vote (dec_plan, unlockWhen.hypotheses) must drop its
  // "Ready when: add a working hypothesis" lock the moment the team crosses
  // two working hypotheses — the refHypotheses 'value' handler must therefore
  // re-render the decisions panel, not only the prompts. Previously it called
  // renderPrompts() but not renderDecisions(), so the management-plan vote
  // stayed locked until the next presence/score event happened to repaint it.
  const start = SCRIPT.indexOf('refHypotheses.on("value"');
  assert.ok(start >= 0, "refHypotheses 'value' listener must exist");
  const handler = SCRIPT.slice(start, SCRIPT.indexOf("});", start) + 3);
  assert.match(handler, /renderPrompts\(\)/, "still unlocks the discussion prompts on the gate");
  assert.match(handler, /renderDecisions\(\)/,
    "must also repaint a hypotheses-gated decision so it unlocks live");
});
