/* tests/reserved-session-key.test.js
 *
 * `orgs` is not a session code.
 *
 * Every per-session tree outside `sessions/` comes in two layouts:
 *
 *   adminSecrets/<code>        adminSecrets/orgs/<slug>/<code>
 *   roomChat/<code>            roomChat/orgs/<slug>/<code>
 *   certIds/<code>             certIds/orgs/<slug>/<code>
 *   withdrawals/<code>         withdrawals/orgs/<slug>/<code>
 *   purgedSessions/<code>      purgedSessions/orgs/<slug>/<code>
 *
 * so the paths of a default-tree session whose code is the literal `orgs` ARE
 * the roots of every organisation's data. Nothing reserved the key: the rules
 * put no shape on `$sessionId`, and `sessions/<any code>/members/<own uid>` is
 * writable by any signed-in visitor. One anonymous write of
 * `sessions/orgs/members/<uid>` therefore produced a "session" with no
 * timestamps, which the nightly purge removes defensively — together with
 * `adminSecrets/orgs`, `roomChat/orgs`, `certIds/orgs` and `withdrawals/orgs`,
 * whole. Found by an independent review on 2026-10-07; the first three predate
 * that day's changes, which would have added the purge markers to the list.
 *
 * Closed three ways, each tested here or on the emulator: the rules refuse the
 * key; the enumerators never emit a location for it; and the path builder
 * throws rather than build those paths.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  sessionLocations, sessionLocationsFromKeys, readSessionLocationsShallow,
  locationForKey, withdrawalLocations, purgedMarkers,
} = require("../scripts/lib/session-trees");
const { runOpsScript, ROOT } = require("./fixtures/run-ops-script");

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 7, 3, 17);
const ago = (d) => NOW - d * DAY;

// ------------------------------------------------------------ the builders

test("no location is ever built for a default-tree session keyed `orgs`", () => {
  const deep = sessionLocations(
    { orgs: { members: { u: { at: 1 } } }, "ABC-123": {} },
    { "uni-x": { sessions: { "XYZ-789": {} } } });
  assert.deepStrictEqual(deep.map((l) => l.key), ["ABC-123", "orgs/uni-x/XYZ-789"]);
  assert.strictEqual(deep.reservedSkipped, 1, "the skipped node must be countable, not silent");

  const keys = sessionLocationsFromKeys(["orgs", "ABC-123"], { "uni-x": ["XYZ-789"] });
  assert.deepStrictEqual(keys.map((l) => l.key), ["ABC-123", "orgs/uni-x/XYZ-789"]);
  assert.strictEqual(keys.reservedSkipped, 1);

  // No colliding path can come out of either.
  for (const loc of deep.concat(keys)) {
    for (const field of Object.keys(loc)) {
      if (typeof loc[field] !== "string" || !field.endsWith("Path")) continue;
      assert.ok(!/^[A-Za-z]+\/orgs$/.test(loc[field]), field + " = " + loc[field]);
    }
  }
  assert.strictEqual(sessionLocations({ "ABC-123": {} }, {}).reservedSkipped, 0);
  assert.throws(() => locationForKey("orgs"), /reserved/i,
    "a bare `orgs` is the organisation subtree, never a session");
});

test("the keys-only enumerator the nightly jobs use skips it too", async () => {
  const tree = { sessions: { orgs: { members: {} }, "ABC-123": {} }, orgs: { "uni-x": { sessions: { "XYZ-789": {} } } } };
  const fetchShallow = async (p) => {
    const node = p.split("/").reduce((n, k) => (n && typeof n === "object" && k in n ? n[k] : null), tree);
    return node && typeof node === "object" ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : null;
  };
  const locations = await readSessionLocationsShallow({ fetchShallow });
  assert.deepStrictEqual(locations.map((l) => l.key), ["ABC-123", "orgs/uni-x/XYZ-789"]);
  assert.strictEqual(locations.reservedSkipped, 1);
});

test("inside an organisation, `orgs` is an ordinary code: nothing collides there", () => {
  const [loc] = sessionLocations({}, { "uni-x": { sessions: { orgs: {} } } });
  assert.strictEqual(loc.key, "orgs/uni-x/orgs");
  assert.strictEqual(loc.withdrawalsPath, "withdrawals/orgs/uni-x/orgs");
  assert.deepStrictEqual(locationForKey("orgs/uni-x/orgs").path, "orgs/uni-x/sessions/orgs");
});

// ------------------------------------------------------------- the purge

const live = () => ({ created: { at: ago(2) } });
const orgTree = () => ({
  sessions: { orgs: { members: { uidAttacker: { at: ago(1) } } }, "LIVE-1": live() },
  orgs: { "uni-x": { sessions: { "ORG-1": live() } } },
  adminSecrets: { orgs: { "uni-x": { "ORG-1": { hash: "h" } } }, "LIVE-1": { hash: "h" } },
  roomChat: { orgs: { "uni-x": { "ORG-1": { r: { t: { content: "x" } } } } } },
  roomChatAuthors: { orgs: { "uni-x": { "ORG-1": { r: { t: "uidOrg" } } } } },
  certIds: { orgs: { "uni-x": { "ORG-1": { c1: "cert" } } } },
  withdrawals: { orgs: { "uni-x": {
    "ORG-1": { uidOrg: { research: false, at: ago(1) } },
    "GONE-2": { uidAsked: { research: false, erasure: true, at: ago(5) } },
  } } },
  purgedSessions: { orgs: { "uni-x": { "GONE-2": ago(10) } } },
});

test("the purge leaves every organisation's data alone when `sessions/orgs` exists, and says so", () => {
  const before = orgTree();
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree: before, now: NOW,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
  });
  for (const tree of ["adminSecrets", "roomChat", "roomChatAuthors", "certIds", "withdrawals", "purgedSessions", "orgs"]) {
    assert.deepStrictEqual(r.tree[tree], before[tree], tree + " was changed by purging a node keyed `orgs`");
  }
  assert.deepStrictEqual(r.tree.sessions, before.sessions,
    "the node itself is left for a person: it is not a session, and something put it there");
  assert.strictEqual(r.code, 1, "an anomaly that needs a person must not be a green run:\n" + r.out);
  assert.match(r.out, /reserved key/i);
  assert.doesNotMatch(r.out, /uidAttacker|LIVE-1|ORG-1|GONE-2/);
});

test("without that node the same database is a clean run — the control", () => {
  const tree = orgTree();
  delete tree.sessions.orgs;
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree, now: NOW,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
  });
  assert.strictEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /reserved key/i);
});

// --------------------------------------------------------------- the rules

const rules = JSON.parse(fs.readFileSync(
  path.join(ROOT, "docs", "Third_session", "PBL_platform", "database.rules.json"), "utf8")).rules;

test("the rules refuse `orgs` as a session code, in both trees", () => {
  /* A `.validate` on the session node is evaluated for any write beneath it, so
     this closes every participant-writable child at once (members,
     clientMapping, pool, …) rather than one rule at a time. Both trees, so the
     two session subtrees keep the same shape; in the organisation tree the key
     collides with nothing, and is refused for symmetry. Proven on the emulator
     in tests-e2e/emulator/rules-smoke.spec.js — a structural check cannot show
     that a rule denies. */
  assert.strictEqual(rules.sessions.$sessionId[".validate"], "$sessionId != 'orgs'");
  assert.strictEqual(rules.orgs.$orgSlug.sessions.$sessionId[".validate"], "$sessionId != 'orgs'");
});

// ------------------------------------------- integer keys come back as arrays

test("a tree whose keys are all small integers is read, not treated as empty", () => {
  /* The Admin SDK hands back an ARRAY for a node whose keys are 0, 1, 2…
     Session codes are not shaped like that, but anyone who can create a
     session can choose its code, and the regroupers used to answer "nothing
     here" for an array — which, for the monitor, is the direction that hides
     requests. */
  const rec = { research: false, erasure: true, at: 5 };
  assert.deepStrictEqual(withdrawalLocations([{ u0: rec }, null, { u2: rec }]),
    { 0: { u0: rec }, 2: { u2: rec } });
  assert.deepStrictEqual(withdrawalLocations({ orgs: { "uni-x": [{ u: rec }] } }),
    { "orgs/uni-x/0": { u: rec } });
  assert.deepStrictEqual(purgedMarkers([111, null, 333]), { 0: 111, 2: 333 });
  assert.deepStrictEqual(purgedMarkers({ orgs: { "uni-x": [444] } }), { "orgs/uni-x/0": 444 });
  // Still nothing for things that are not trees at all.
  for (const junk of [null, undefined, "x", 7]) {
    assert.deepStrictEqual(withdrawalLocations(junk), {});
    assert.deepStrictEqual(purgedMarkers(junk), {});
  }
});

