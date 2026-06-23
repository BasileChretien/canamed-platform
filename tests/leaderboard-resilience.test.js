/* tests/leaderboard-resilience.test.js
 *
 * Regression for the first-session "live leaderboard shows nothing" bug
 * (2026-06-23). Two defects in the student leaderboard:
 *
 *   1. The all-rooms subscription (refLeaderboard.on("value", ...)) had NO
 *      error callback, so a denied/raced read of sPath("rooms") (which needs
 *      session membership) was swallowed silently — allRooms stayed {} and the
 *      board showed "No points yet" for the whole session, even though each
 *      room's score WAS being written and the own-room score panel worked.
 *   2. renderLeaderboard() read allRooms directly, so when that cross-room read
 *      was empty/lagging the student saw nothing — not even their own team.
 *
 * Fix: the subscription now logs + re-subscribes on error, and
 * renderLeaderboard() seeds the student's own room from the local roomScore.
 * Static source-contract test (mirrors the other structural guards).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function fnBody(name) {
  const at = SCRIPT.indexOf("function " + name + "(");
  assert.ok(at >= 0, "function " + name + " must exist");
  // crude brace-match from the function header
  let depth = 0, started = false;
  for (let i = at; i < SCRIPT.length; i++) {
    const c = SCRIPT[i];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) return SCRIPT.slice(at, i + 1); }
  }
  return SCRIPT.slice(at);
}

test("the all-rooms leaderboard subscription has an error callback (no silent swallow)", () => {
  // The .on("value", success, ERROR) third argument must be present so a denied
  // read is logged + retried instead of leaving the board blank forever.
  // The initial subscription AND the retry must pass the same named error
  // handler (3-arg .on), so a denied/raced read is never swallowed — including
  // on the retry.
  assert.match(SCRIPT, /refLeaderboard\.on\("value",\s*_onLb,\s*_onLbErr\)/,
    "the subscription must pass the named error callback (3-arg .on)");
  assert.match(SCRIPT, /var _onLbErr = function/,
    "the error handler must be a named function so the retry can reuse it");
  // The retry inside the error handler must ALSO pass _onLbErr.
  assert.match(SCRIPT, /setTimeout\([\s\S]{0,200}?refLeaderboard\.on\("value",\s*_onLb,\s*_onLbErr\)/,
    "the retry re-subscribe must also pass the error callback (no silent second failure)");
  assert.match(SCRIPT, /\[leaderboard\][^\n]*read failed/,
    "the error handler must log the failed all-rooms read");
  assert.match(SCRIPT, /_lbResubscribed/,
    "the subscription must re-subscribe once after an error (membership-race self-heal)");
});

test("renderLeaderboard seeds the student's own room from roomScore (graceful degradation)", () => {
  const body = fnBody("renderLeaderboard");
  // It must build a local view (never mutate allRooms) and inject the own room.
  assert.match(body, /Object\.assign\(\{\},\s*allRooms\)/,
    "renderLeaderboard must copy allRooms into a local view (no mutation)");
  assert.match(body, /view\[myRoom\]/,
    "renderLeaderboard must seed the student's own room into the view");
  assert.match(body, /own\.score\s*=\s*roomScore/,
    "the own-room seed must use the locally-known roomScore");
  // And the rows must be built from the seeded view, not raw allRooms.
  assert.match(body, /roomNames\(roomCount\)\.map\([\s\S]*?view\[r\]/,
    "rows must be computed from the seeded view");
});
