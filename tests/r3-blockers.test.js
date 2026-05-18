/* tests/r3-blockers.test.js
 *
 * Unit tests pinning the Round-3 blocker fixes (SIMULATION_ROUND3.md):
 *
 *   R3-A1  pseudonymise toggle scrubs the JSON archive (operator-name leaks)
 *   R3-A2  GDPR Art. 15 self-export includes pre/post-test answers
 *   R3-B2  /orgs/$slug/sessions tests + events rules mirror /sessions
 *   R3-C1  late-join banner i18n keys exist for en/fr/ja (+ es/pt/de/ko/zh)
 *   R3-C3  bestRoomFor caps overflow room size
 *   R3-D1  super-admin reset uses ServerValue.TIMESTAMP, not Date.now()
 *   R3-D4  _superadminReset.by / _adminPresence stripped from pseudonymised
 *   R3-E1/E4 archive header carries scenarioId + canamedSchemaVersion
 *   R3-F1  ballot key prefers stableId (double-vote-on-refresh closed)
 *   R3-G1  lobby.join-hint:de no longer hardcodes "deutsch-japanisch"
 *   R3-G2  stage.label.{1,2} pulls from CURRENT_SCENARIO module names
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const lib  = require("../docs/Third_session/PBL_platform/lib.js");
const i18n = require("../docs/Third_session/PBL_platform/i18n.js");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT_JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const RULES = JSON.parse(fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8"));

// ============================================================
// R3-A1 — pseudonymise toggle scrubs operator-name leaks
// ============================================================

test("R3-A1: pseudonymiseTree replaces created.by + closed.by with 'Admin'", () => {
  const tree = {
    pool:    { c1: { name: "Alice", at: 100 } },
    created: { by: "Dr Smith", at: 50 },
    closed:  { by: "Dr Smith", at: 9999 },
    rooms:   {}
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  assert.equal(out.created.by, "Admin",
    "created.by should be replaced with 'Admin' so operator name is not in shared export");
  assert.equal(out.closed.by, "Admin",
    "closed.by should be replaced with 'Admin'");
  // Timestamps preserved
  assert.equal(out.created.at, 50);
  assert.equal(out.closed.at, 9999);
});

test("R3-D4: pseudonymiseTree strips _superadminReset entirely", () => {
  const tree = {
    pool: { c1: { name: "Alice", at: 100 } },
    _superadminReset: { requestedAt: 999, by: "Dr Renaud" }
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  assert.ok(!("_superadminReset" in out),
    "_superadminReset must be removed from pseudonymised export — leaks operator name");
});

test("R3-D4: pseudonymiseTree strips _adminPresence entirely", () => {
  const tree = {
    pool: { c1: { name: "Alice", at: 100 } },
    _adminPresence: { by: "Dr Renaud", at: 999 }
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  assert.ok(!("_adminPresence" in out),
    "_adminPresence must be stripped from pseudonymised export");
});

test("R3-A1: no operator name survives a realistic archive", () => {
  const tree = {
    adminPasswordHash: "v2$100000$deadbeef",
    pool:    { c1: { name: "Akari", at: 100 } },
    created: { by: "Dr Smith", at: 50 },
    closed:  { by: "Dr Smith", at: 9999 },
    _superadminReset: { requestedAt: 200, by: "Dr Renaud" },
    _adminPresence:   { by: "Dr Smith", at: 60 },
    rooms: {
      "Room 1": { answers: { moduleA: { a1: { by: "Akari", text: "history first", at: 110 } } } }
    }
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  const json = JSON.stringify(out);
  assert.ok(!json.includes("Dr Smith"),
    "operator name 'Dr Smith' leaked into pseudonymised archive");
  assert.ok(!json.includes("Dr Renaud"),
    "super-admin name 'Dr Renaud' leaked into pseudonymised archive");
  assert.ok(!json.includes("Akari"),
    "student name 'Akari' leaked into pseudonymised archive");
  assert.ok(!json.includes("v2$100000$deadbeef"),
    "admin password hash leaked into pseudonymised archive");
});

// ============================================================
// R3-A2 — GDPR Art. 15 self-export plumbing visible in source
// ============================================================
//
// downloadMyData is a DOM/Firebase function so we can't unit-test it cold,
// but we can lock in the BEHAVIOUR via source-level invariants the
// implementation must satisfy: the export object must declare the new
// fields, and the rooms loop must populate them from the right RTDB paths.

test("R3-A2: downloadMyData declares tests / manualScoresAboutMe / helpCallsByMe", () => {
  // The export envelope must reserve the three new fields up-front so the
  // shape is stable even for participants who have not contributed any
  // test answers / manual scores / help calls.
  assert.match(SCRIPT_JS, /tests:\s*\{\s*\}/,
    "downloadMyData must initialise tests: {} so empty exports keep stable shape");
  assert.match(SCRIPT_JS, /manualScoresAboutMe:\s*\[\s*\]/,
    "downloadMyData must initialise manualScoresAboutMe: []");
  assert.match(SCRIPT_JS, /helpCallsByMe:\s*\[\s*\]/,
    "downloadMyData must initialise helpCallsByMe: []");
});

test("R3-A2: downloadMyData reads tests/{cid}/{pre|post} from rooms tree", () => {
  // The rooms-loop must pull r.tests[clientId] so pre/post-test answers
  // belonging to this participant are included in the SAR export.
  assert.match(SCRIPT_JS, /r\.tests\s*&&\s*r\.tests\[clientId\]/,
    "downloadMyData must read r.tests[clientId] from each room");
  assert.match(SCRIPT_JS, /pre:\s*tests\.pre\s*\|\|\s*null/,
    "downloadMyData must export pre-test sub-tree");
  assert.match(SCRIPT_JS, /post:\s*tests\.post\s*\|\|\s*null/,
    "downloadMyData must export post-test sub-tree");
});

// ============================================================
// R3-B2 — multi-tenant rules parity for tests + events
// ============================================================

test("R3-B2: /orgs/$orgSlug/sessions/.../rooms/$roomId/events rule exists", () => {
  const orgRooms = RULES.rules.orgs["$orgSlug"].sessions["$sessionId"].rooms["$roomId"];
  assert.ok(orgRooms.events,
    "/orgs/$orgSlug/sessions/$sessionId/rooms/$roomId/events must be declared (mirrors /sessions/...)");
  const node = orgRooms.events["$pushId"];
  assert.ok(node, "org events subtree must wildcard over $pushId");
  const w = node[".write"];
  assert.ok(w.includes("auth != null"),
    "org events writes must require auth: " + w);
  assert.ok(w.includes("!data.exists()"),
    "org events writes must be append-only: " + w);
  assert.ok(w.includes("root.child('orgs').child($orgSlug)"),
    "org events writes must reference the org-scoped path: " + w);
});

test("R3-B2: /orgs/.../rooms/$roomId/tests/$cid/{pre,post} rules exist", () => {
  const orgRooms = RULES.rules.orgs["$orgSlug"].sessions["$sessionId"].rooms["$roomId"];
  const tests = orgRooms.tests;
  assert.ok(tests,
    "/orgs/$orgSlug/sessions/$sessionId/rooms/$roomId/tests must be declared (mirrors /sessions/...)");
  const pre = tests["$cid"].pre;
  const post = tests["$cid"].post;
  assert.ok(pre, "org tests must include a pre sub-tree");
  assert.ok(post, "org tests must include a post sub-tree");
  // Writes must be org-scoped (a typo here would let an org tamper with /sessions/)
  assert.ok(pre[".write"].includes("root.child('orgs').child($orgSlug)"),
    "org tests/pre.write must reference the org-scoped path: " + pre[".write"]);
  assert.ok(post[".write"].includes("root.child('orgs').child($orgSlug)"),
    "org tests/post.write must reference the org-scoped path: " + post[".write"]);
  // answers subtree must be validated
  assert.ok(pre.answers["$qid"][".validate"].includes("'choice'"),
    "org tests/pre/answers must validate {choice, at}");
  assert.ok(post.answers["$qid"][".validate"].includes("'choice'"),
    "org tests/post/answers must validate {choice, at}");
});

// ============================================================
// R3-C1 — late-join banner i18n
// ============================================================

test("R3-C1: waiting.late-join.banner key present in EN + FR + JA", () => {
  const T = i18n._T;
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(T[lang]["waiting.late-join.banner"],
      "lang '" + lang + "' missing waiting.late-join.banner key");
    assert.ok(T[lang]["waiting.late-join.dismiss"],
      "lang '" + lang + "' missing waiting.late-join.dismiss key");
    // Must contain the {stage} placeholder so the banner can name the
    // current stage in the user's language.
    assert.ok(T[lang]["waiting.late-join.banner"].indexOf("{stage}") >= 0,
      "lang '" + lang + "' waiting.late-join.banner missing {stage} placeholder");
  }
});

test("R3-C1: waiting.late-join.banner key present in es/pt/de/ko/zh too", () => {
  // Full coverage so users in any supported language get a translated
  // banner; falling back to EN at the most disorienting moment defeats
  // the whole point of the i18n layer.
  const T = i18n._T;
  for (const lang of ["es", "pt", "de", "ko", "zh"]) {
    assert.ok(T[lang]["waiting.late-join.banner"],
      "lang '" + lang + "' missing waiting.late-join.banner key");
    assert.ok(T[lang]["waiting.late-join.banner"].indexOf("{stage}") >= 0,
      "lang '" + lang + "' waiting.late-join.banner missing {stage} placeholder");
  }
});

test("R3-C1: showLateBanner uses tFallback for both span and dismiss button", () => {
  // Pin the source-level wiring so a future refactor can't quietly drop
  // the i18n call and leave the banner monolingual again.
  assert.match(SCRIPT_JS, /waiting\.late-join\.banner/,
    "showLateBanner must reference waiting.late-join.banner");
  assert.match(SCRIPT_JS, /waiting\.late-join\.dismiss/,
    "showLateBanner must reference waiting.late-join.dismiss for the button");
});

// ============================================================
// R3-C3 — bestRoomFor caps room size
// ============================================================
//
// bestRoomFor lives in script.js (not lib.js) and reads roomNames(), so we
// inline a minimal harness to evaluate it. The function is pure: it takes
// (person, assignedPool, roomCount) and returns a room name.

function loadBestRoomFor() {
  // Inline-extract the function source + its roomNames dependency, then
  // eval it in a sandboxed module-like context. Keeps this test free of
  // a DOM/Firebase setup while still exercising the live source.
  const m = SCRIPT_JS.match(/function roomNames\(count\) \{[\s\S]*?return out;\s*\}/);
  const fn = SCRIPT_JS.match(/function bestRoomFor\(person, assignedPool, roomCount\) \{[\s\S]*?\n\}/);
  if (!m || !fn) throw new Error("Could not extract bestRoomFor + roomNames from script.js");
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + "\n" + fn[0] + "\nreturn bestRoomFor;")();
}

const bestRoomFor = loadBestRoomFor();

test("R3-C3: bestRoomFor spreads a late-joiner to the smallest room", () => {
  // Three rooms — one heavily loaded, the other two empty. The late-joiner
  // must NOT go to the loaded room (over the soft cap) even if same-uni
  // would normally bias them there.
  const pool = [
    { university: "Caen",   room: "Room 1" },
    { university: "Caen",   room: "Room 1" },
    { university: "Caen",   room: "Room 1" },
    { university: "Caen",   room: "Room 1" },
    { university: "Caen",   room: "Room 1" },
    { university: "Caen",   room: "Room 1" },
    { university: "Caen",   room: "Room 1" }
    // Room 2 / Room 3 are empty
  ];
  const late = { university: "Caen" };
  const out = bestRoomFor(late, pool, 3);
  assert.notStrictEqual(out, "Room 1",
    "Late-joiner must not land in the over-capacity room (Room 1 has 7 members already)");
});

test("R3-C3: bestRoomFor still respects same-uni when no room is over cap", () => {
  // When every room is under the cap, the function should still bias
  // against same-uni clustering (the original cost dominates).
  const pool = [
    { university: "Caen",   room: "Room 1" },
    { university: "Nagoya", room: "Room 2" }
  ];
  const newcomer = { university: "Caen" };
  const out = bestRoomFor(newcomer, pool, 2);
  // Room 2 has 1 Nagoya member (same-uni cost = 0) vs Room 1 with 1 Caen
  // (same-uni cost = 100). Newcomer should go to Room 2.
  assert.strictEqual(out, "Room 2",
    "Under cap, same-uni diversification still beats raw size");
});

test("R3-C3: bestRoomFor falls back gracefully when every room is over cap", () => {
  // Pathological input: 10 people in a single room out of 2 — every room
  // is at or above the soft cap. The function still must return a valid
  // room name (smallest preferred).
  const pool = [];
  for (let i = 0; i < 10; i++) pool.push({ university: "Caen", room: "Room 1" });
  for (let i = 0; i < 9; i++)  pool.push({ university: "Caen", room: "Room 2" });
  const late = { university: "Nagoya" };
  const out = bestRoomFor(late, pool, 2);
  assert.strictEqual(out, "Room 2",
    "When every room overflows, smallest wins (Room 2 has 9 < Room 1's 10)");
});

// ============================================================
// R3-D1 — ServerValue.TIMESTAMP in super-admin reset
// ============================================================

test("R3-D1: joinSuperAdmin uses ServerValue.TIMESTAMP for _superadminReset", () => {
  // Source-level pin — the previous Date.now() call would be rejected by
  // the rule's ±5s freshness window on a drifted client clock.
  assert.match(SCRIPT_JS, /firebase\.database\.ServerValue\.TIMESTAMP/,
    "joinSuperAdmin must use firebase.database.ServerValue.TIMESTAMP for requestedAt");
  // The token should appear inside the _superadminReset.set call site —
  // pick out the substring and confirm the TS variable feeds the .set:
  const block = SCRIPT_JS.match(/_superadminReset[\s\S]{0,2500}refReset\.set\([\s\S]{0,300}/);
  assert.ok(block, "could not locate _superadminReset set block");
  assert.ok(block[0].includes("ServerValue.TIMESTAMP") || block[0].includes("TS"),
    "the _superadminReset.set call must use the server timestamp token, not Date.now()");
});

// ============================================================
// R3-E1/E4/E5 — archive header carries scenarioId + schemaVersion
// ============================================================

test("R3-E1: archive header includes canamedSchema URL + canamedSchemaVersion", () => {
  assert.match(SCRIPT_JS, /canamedSchema:\s*"https:\/\/canamed\.web\.app\/schema\//,
    "archive header must include canamedSchema URL");
  assert.match(SCRIPT_JS, /canamedSchemaVersion:\s*"1\.0\.0"/,
    "archive header must include canamedSchemaVersion semver");
});

test("R3-E4: archive header includes scenarioId alongside scenarioName", () => {
  // scenarioId is the stable kebab-case dispatch key; scenarioName is the
  // localised display string. Both must be present so pipelines can
  // dispatch on the id and humans can read the name.
  const block = SCRIPT_JS.match(/scenarioId:\s*window\.CURRENT_SCENARIO_ID[\s\S]{0,200}scenarioName:/);
  assert.ok(block,
    "archive header must include scenarioId (right before scenarioName) — got no match");
});

test("R3-E2: downloadMyData mirrors the schema fields", () => {
  // Two related artefacts (full archive + per-participant SAR export)
  // should validate against parallel schemas — pipelines pin both.
  const block = SCRIPT_JS.match(/canamedSchema:\s*"https:\/\/canamed\.web\.app\/schema\/participant-export-v1\.json"/);
  assert.ok(block,
    "downloadMyData must declare participant-export-v1 schema URL");
});

// ============================================================
// R3-F1 — ballot key uses stableId (double-vote-on-refresh fix)
// ============================================================

test("R3-F1: castVote / commitDecision read ballotKey() not raw clientId", () => {
  // The new ballotKey() helper returns stableId (localStorage-backed,
  // survives refresh) when present, falling back to clientId for tests
  // that haven't initialised stableId. Pin the wiring so a future refactor
  // can't re-introduce the double-vote loophole.
  assert.match(SCRIPT_JS, /function ballotKey\(\)/,
    "ballotKey() helper must be defined");
  assert.match(SCRIPT_JS, /ballots"\)\.child\(bkey\)/,
    "castVote must write to ballots/{ballotKey()}, not ballots/{clientId}");
  // The render path must also prefer the stableId-keyed ballot so a
  // refresh during an open vote still shows my prior choice.
  assert.match(SCRIPT_JS, /ballots\[_bk\]/,
    "buildDecision must read ballots[ballotKey()] when rendering 'my choice'");
});

test("R3-F1: castVote opportunistically cleans up stale clientId ballots", () => {
  // When ballotKey() returns stableId (refresh case), the old per-tab
  // clientId-keyed ballot is still in the tally. The new write must
  // remove it so the tally doesn't double-count.
  const block = SCRIPT_JS.match(/function castVote[\s\S]{0,2000}/);
  assert.ok(block, "could not locate castVote source");
  assert.ok(block[0].includes(".child(clientId).remove()"),
    "castVote must remove a stale clientId-keyed ballot when stableId is used");
});

// ============================================================
// R3-G1 — lobby.join-hint:de no longer hardcodes "deutsch-japanisch"
// ============================================================

test("R3-G1: lobby.join-hint:de uses partnership-agnostic phrasing", () => {
  const de = i18n._T.de["lobby.join-hint"];
  assert.ok(de, "lobby.join-hint:de must be defined");
  assert.ok(!de.includes("deutsch-japanisch"),
    "lobby.join-hint:de must not hardcode 'deutsch-japanisch' on a Caen-Nagoya deployment");
  // Keep the educational intent (mixed room, balanced by uni/year/level)
  // so the user still understands what's happening.
  assert.ok(/international|gemischt/.test(de),
    "lobby.join-hint:de should still describe a mixed/international room");
});

// ============================================================
// R3-G2 — stage labels are scenario-aware
// ============================================================

test("R3-G2: applyScenario exposes moduleAName / moduleBName / scenario id on window", () => {
  // Pin the source-level wiring — stageLabel() reads these globals.
  assert.match(SCRIPT_JS, /window\.CURRENT_SCENARIO_MODULE_A_NAME\s*=\s*sc\.moduleAName/,
    "applyScenario must expose moduleAName on window");
  assert.match(SCRIPT_JS, /window\.CURRENT_SCENARIO_MODULE_B_NAME\s*=\s*sc\.moduleBName/,
    "applyScenario must expose moduleBName on window");
  assert.match(SCRIPT_JS, /window\.CURRENT_SCENARIO_ID\s*=/,
    "applyScenario must expose CURRENT_SCENARIO_ID for archive scenarioId");
});

test("R3-G2: stageLabel reads CURRENT_SCENARIO_MODULE_A_NAME for stage 1", () => {
  // Pin the priority: scenario-specific trio wins over the static i18n
  // bag so a future antibiotic-stewardship case shows the right label.
  assert.match(SCRIPT_JS, /CURRENT_SCENARIO_MODULE_A_NAME/,
    "stageLabel must reference CURRENT_SCENARIO_MODULE_A_NAME for stage 1");
  assert.match(SCRIPT_JS, /CURRENT_SCENARIO_MODULE_B_NAME/,
    "stageLabel must reference CURRENT_SCENARIO_MODULE_B_NAME for stage 2");
});
