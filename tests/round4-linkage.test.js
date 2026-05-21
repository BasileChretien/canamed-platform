/* tests/round4-linkage.test.js
 *
 * Lock-in for the Round-4 P0 research-linkage fix. The pre/post tests and
 * the wrap-up poll were keyed only by the ephemeral per-tab clientId, so a
 * student's pre↔post↔questionnaire records could not be reliably joined.
 * The durable per-person `stableId` is now stamped onto every research
 * write (it was already on pool + answers), and the rules allow it.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const RULES = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

const sess = RULES.rules.sessions["$sessionId"];
const org  = RULES.rules.orgs["$orgSlug"].sessions["$sessionId"];

test("rules: poll/$cid validate permits a bounded stableId", () => {
  assert.match(sess.poll["$cid"][".validate"],
    /hasChild\('stableId'\)[\s\S]*stableId'\)\.isString\(\)[\s\S]*length <= 64/,
    "poll validate must allow an optional stableId string (<=64)");
});

test("rules: tests pre+post validate permits stableId in BOTH trees", () => {
  const nodes = [
    sess.rooms["$roomId"].tests["$cid"].pre,
    sess.rooms["$roomId"].tests["$cid"].post,
    org.rooms["$roomId"].tests["$cid"].pre,
    org.rooms["$roomId"].tests["$cid"].post
  ];
  for (const n of nodes) {
    assert.match(n[".validate"], /hasChild\('stableId'\)/,
      "each test pre/post validate must allow an optional stableId");
    assert.match(n[".validate"], /stableId'\)\.val\(\)\.length <= 64/,
      "stableId must be length-bounded");
  }
});

test("script.js: stableId is stamped onto the test stream + the wrap-up poll", () => {
  // test start writes stableId
  const startFn = SCRIPT.slice(SCRIPT.indexOf("function _saveTestStart"),
    SCRIPT.indexOf("function _saveTestStart") + 600);
  assert.match(startFn, /child\("stableId"\)\.set\(stableId\)/,
    "_saveTestStart must write the durable stableId onto the test node");
  // skipped test keeps stableId (attrition linkage)
  const skipFn = SCRIPT.slice(SCRIPT.indexOf("function _saveTestSkipped"),
    SCRIPT.indexOf("function _saveTestSkipped") + 700);
  assert.match(skipFn, /stableId/,
    "_saveTestSkipped must keep stableId so non-completers still link");
  // poll payload carries stableId
  const pollIdx = SCRIPT.indexOf("hardest: (hard.value");
  const pollBlk = SCRIPT.slice(pollIdx, pollIdx + 500);
  assert.match(pollBlk, /payload\.stableId\s*=\s*stableId/,
    "the wrap-up poll payload must carry stableId");
});
