/* tests/prepost-gain.test.js
 *
 * Pre→post knowledge gain (2026-05-22) surfaced across the reports. _knowledgeGain()
 * reads the per-participant test scores already in allRooms
 * (rooms/<r>/tests/<cid>/{pre,post}/score), pairs them by cid, and reports mean
 * pre%, mean post% and Hake's normalized gain g = (post%−pre%)/(100−pre%). It
 * flows into _impactMetrics, the impact report, the session summary, the
 * accreditation report, the research export, and the program dashboard.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");

test("_knowledgeGain pairs pre/post by cid and uses Hake's normalized gain", () => {
  assert.match(SCRIPT, /function _knowledgeGain\(\)/, "_knowledgeGain must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function _knowledgeGain"),
    SCRIPT.indexOf("function _impactMetrics"));
  assert.match(fn, /window\.PRETEST/, "must read the pre-test bank length for the max");
  assert.match(fn, /window\.POSTTEST/, "must read the post-test bank length for the max");
  assert.match(fn, /\.tests\b/, "must read the per-room tests node");
  assert.match(fn, /pre\.score[\s\S]*post\.score|post\.score[\s\S]*pre\.score/,
    "must read pre + post scores");
  assert.match(fn, /\(postPct - prePct\) \/ \(100 - prePct\)/, "must use Hake's normalized gain");
  assert.match(fn, /!pre\.skipped[\s\S]*!post\.skipped|!post\.skipped[\s\S]*!pre\.skipped/,
    "must exclude skipped tests");
  assert.match(fn, /nPaired/, "must report the paired N");
});

test("gain flows into _impactMetrics + the session summary", () => {
  assert.match(SCRIPT, /gain: _knowledgeGain\(\)/, "_impactMetrics must include gain");
  const ss = SCRIPT.slice(SCRIPT.indexOf("function _sessionSummaryObj"),
    SCRIPT.indexOf("function _sessionSummaryObj") + 900);
  assert.match(ss, /normGain/, "session summary must carry normGain for the program trend");
});

test("the impact report renders a Knowledge gain section", () => {
  const i = SCRIPT.indexOf("function generateImpactReport");
  const blk = SCRIPT.slice(i, SCRIPT.indexOf("function _archiveCsvCell"));
  assert.match(blk, /Knowledge gain \(pre/, "must render a knowledge-gain section");
  assert.match(blk, /normalized learning gain|Hake/i, "must explain the normalized-gain metric");
  assert.match(blk, /gainKpi/, "must show a gain KPI at a glance");
});

test("gain is woven into the accreditation report, research export and program dashboard", () => {
  assert.match(TOOLS, /Knowledge gain \(pre/, "accreditation report must include knowledge gain");
  assert.match(TOOLS, /_knowledgeGain\(\)/, "admin-tools must read the shared gain helper");
  // research export bundle carries per-participant pre/post + the gain summary
  const re = TOOLS.slice(TOOLS.indexOf("function generateResearchExport"),
    TOOLS.indexOf("function generateAttestations"));
  assert.match(re, /tests:\s*tests/, "research bundle must include per-participant tests");
  assert.match(re, /knowledgeGain:/, "research bundle must include the gain summary");
  // program dashboard shows the gain KPI + column
  const pd = TOOLS.slice(TOOLS.indexOf("function generateProgramDashboard"),
    TOOLS.indexOf("// Expose on window"));
  assert.match(pd, /mean knowledge gain/, "program dashboard must show the gain KPI");
  assert.match(pd, /x\.normGain/, "program dashboard must aggregate normGain across sessions");
});
