/* tests/professor-satisfaction.test.js
 *
 * Professor-satisfaction batch (2026-05-22): a session-wide pacing + attention
 * roll-up at the top of the facilitator dashboard. The per-room stage timer,
 * help-call and quiet-room signals already exist on each card; this aggregates
 * them into ONE glance so a lead prof running several rooms can pace the whole
 * session and triage attention without scanning every card.
 *
 * Static source-text checks, matching the convention of the existing
 * dashboard tests (facilitator-participation.test.js) — the dashboard reads
 * module-scoped `allRooms`/`roomCount` that aren't drivable in LOCAL e2e.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

test("sessionSignal aggregates pacing, help-calls and quiet rooms from allRooms", () => {
  assert.match(SCRIPT, /function sessionSignal\(\)/, "sessionSignal must be defined");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function sessionSignal"),
    SCRIPT.indexOf("function sessionSignal") + 1400);
  assert.match(fn, /roomNames\(roomCount\)/, "must iterate the session's rooms");
  assert.match(fn, /minsSince\(d\.stageAt\)/, "must read each room's time-in-stage");
  assert.match(fn, /STAGE_MINUTES\[st\]/, "must compare against the planned stage duration");
  assert.match(fn, /callForHelp && !d\.callForHelp\.ack/, "must count rooms calling for help");
  assert.match(fn, /roomParticipation\(d\)/, "must reuse roomParticipation for quiet rooms");
  assert.match(fn, /minStage[\s\S]*maxStage/, "must track the stage spread across rooms");
});

test("renderSessionSignal paints urgent calls first, then pacing, then quiet", () => {
  assert.match(SCRIPT, /function renderSessionSignal\(dash\)/, "renderSessionSignal must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function renderSessionSignal"),
    SCRIPT.indexOf("function renderSessionSignal") + 1800);
  assert.match(fn, /dash-signal-call/, "must render the help-call line");
  assert.match(fn, /dash-signal-pace/, "must render the pacing line");
  assert.match(fn, /dash-signal-quiet/, "must render the quiet-rooms line");
  // Pacing reflects on-track vs behind.
  assert.match(fn, /over > 0 \? " behind" : " ontrack"/, "pacing must flag behind vs on-track");
  assert.match(fn, /need a facilitator now/, "the call line must be actionable + urgent");
});

test("the session signal is painted at the top of the dashboard and stays live", () => {
  // renderDashboard prepends the signal before the per-room loop.
  const rd = SCRIPT.slice(SCRIPT.indexOf("function renderDashboard"),
    SCRIPT.indexOf("function renderDashboard") + 1500);
  assert.match(rd, /renderSessionSignal\(dash\)/,
    "renderDashboard must paint the session signal");
  // renderDashboard runs on the periodic refresh, so the signal stays fresh.
  assert.match(SCRIPT, /setInterval\([\s\S]{0,80}renderDashboard\(\)/,
    "renderDashboard must run on the periodic refresh so pacing stays live");
});

test("the session signal has dedicated styles", () => {
  assert.match(CSS, /\.dash-session-signal\b/, "the signal container must be styled");
  assert.match(CSS, /\.dash-signal-call\b/, "the urgent help-call line must be styled");
  assert.match(CSS, /\.dash-signal-pace\.behind\b/, "the behind-pace state must be styled");
});
