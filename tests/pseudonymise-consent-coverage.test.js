/* tests/pseudonymise-consent-coverage.test.js
 *
 * The research export's inclusion filter (scripts/lib/research-inclusion.js)
 * knows by NAME which containers are keyed by a participant identity and which
 * records carry an author. Both are hand-written copies of what
 * database.rules.json states, and a copy one short is how the export came to
 * carry `roomOf` (tests/pseudonymise-uid-coverage.test.js). So the positions
 * are DERIVED here from the rules, in both trees, and the real function is RUN
 * on each:
 *
 *   A. A container is keyed by a participant identity when its children's
 *      wildcard is `$clientId`, `$cid`, `$uid` or `$stableId`, or is compared
 *      with `auth.uid` by its own rules. Under each, a child keyed by an
 *      identity no included participant holds must be gone from the output,
 *      and one keyed by the included participant's must still be there
 *      (unless the container is dropped whole — listed below, with why).
 *   B. A record carries an author when its rules name a `by` or a `cid`
 *      child. At each, a record by somebody who is not included must be gone,
 *      and one by the included participant must be there — unless only the
 *      facilitator can write it (the creator-or-proof predicate), in which
 *      case it is the facilitator's and stays either way.
 *
 * WHAT THIS CANNOT SEE — the same limits as the uid coverage test: a field the
 * client writes that no rule names, a node the rules no longer declare (the
 * per-prompt reply lists, removed 2026-07-24, are covered by hand in the last
 * test), and an author recorded under a name other than `by` or `cid`.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { pseudonymiseSession, DROP_KEYS } = require("../scripts/lib/pseudonymise");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const rules = JSON.parse(fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8")).rules;
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8").replace(/\r\n/g, "\n");

const TREES = {
  "sessions/$sessionId": rules.sessions.$sessionId,
  "orgs/$orgSlug/sessions/$sessionId": rules.orgs.$orgSlug.sessions.$sessionId
};

const IDENTITY_WILDCARD = /^\$(clientId|cid|uid|stableId)$/;
const CHILD_NAMED = /newData\.child\('([A-Za-z_]+)'\)|hasChild\('([A-Za-z_]+)'\)/g;
const CHILDREN_LISTED = /hasChildren\(\[([^\]]*)\]\)/g;
const ADMIN_PREDICATE = /adminPasswordHash'\)\.exists\(\)/;

/* Containers dropped WHOLE by pseudonymise.js, so nothing under them reaches
   the export whoever it belongs to: the two tables that bind an identity to
   an account, and the room claim (see that file's header). */
const DROPPED_WHOLE = ["clientMapping", "stableIdMapping", "roomOf"];

/* `created` is written by the session's first writer, who is its facilitator
   by definition; the rules gate it by facilitatorGate, not by the
   creator-or-proof predicate, so the derivation below does not see it as the
   facilitator's. */
const FACILITATOR_BY_DEFINITION = ["created"];

/* Records whose `by` holds a CLIENTID, not a name. Read from script.js:
   assignRolesRandomly() writes `{ assignments, by: clientId, at }`. */
const BY_HOLDS_CLIENT_ID = ["rooms/$roomId/moduleB/roleAssign", "rooms/$roomId/sections/$slot/roleAssign"];

function ruleText(node) {
  return [node[".validate"], node[".write"]].filter((s) => typeof s === "string").join(" ");
}

function namedChildren(node) {
  const text = ruleText(node);
  const names = new Set(Object.keys(node).filter((k) => !k.startsWith(".")));
  for (const m of text.matchAll(CHILD_NAMED)) names.add(m[1] || m[2]);
  for (const m of text.matchAll(CHILDREN_LISTED)) {
    for (const q of m[1].match(/'[A-Za-z_]+'/g) || []) names.add(q.slice(1, -1));
  }
  return names;
}

function nodes(sessionRules) {
  const out = [];
  (function walk(node, at) {
    if (at.length) out.push({ path: at, node });
    for (const k of Object.keys(node)) {
      if (!k.startsWith(".") && node[k] && typeof node[k] === "object") walk(node[k], at.concat(k));
    }
  })(sessionRules, []);
  return out;
}

const label = (p) => p.join("/");

function keyedContainers(sessionRules) {
  return nodes(sessionRules).filter(({ path: p, node }) => {
    const last = p[p.length - 1];
    if (!last.startsWith("$")) return false;
    const wild = last.replace("$", "\\$");
    const comparedWithAuth = new RegExp("auth\\.uid ===? " + wild + "\\b|" + wild + " ===? auth\\.uid")
      .test(ruleText(node));
    return IDENTITY_WILDCARD.test(last) || comparedWithAuth;
  }).map(({ path: p }) => p);
}

function authoredRecords(sessionRules) {
  return nodes(sessionRules).filter(({ path: p, node }) => {
    const names = namedChildren(node);
    return (names.has("by") || names.has("cid")) && !IDENTITY_WILDCARD.test(p[p.length - 1]);
  }).map(({ path: p, node }) => ({
    path: p,
    hasCid: namedChildren(node).has("cid"),
    adminOnly: ADMIN_PREDICATE.test(node[".write"] || "") && !/roomOf|clientMapping/.test(node[".write"] || "")
  }));
}

const YES = { workshop: true, research: true, version: "PIS-v12", at: 5 };
const NO = { workshop: true, research: false, version: "PIS-v12", at: 5 };
const IN = { cid: "c1", uid: "uidAnn000000000000000000001", stableId: "sid-ann", name: "Ann" };
const OUT = { cid: "cid-NOT-INCLUDED", uid: "uidNobody00000000000000001", stableId: "sid-nobody",
              name: "Nobody Known" };

function baseSession() {
  return {
    clientMapping: { c1: IN.uid, c2: "uidBen000000000000000000002" },
    stableIdMapping: { [IN.stableId]: IN.uid },
    pool: { c1: { name: IN.name, at: 10, consent: YES, stableId: IN.stableId },
            c2: { name: "Ben", at: 20, consent: NO } },
    rooms: { r1: {} }
  };
}

function wildValue(seg) {
  return { $roomId: "r1", $slot: "1", $voteId: "d1" }[seg] || "x1";
}

function author(recordPath, who) {
  return BY_HOLDS_CLIENT_ID.includes(label(recordPath)) ? { by: who.cid } : { by: who.name, cid: who.cid };
}

/** Put `value` at `segs` (wildcards filled), giving every intermediate node
 *  that is itself an authored record the included participant as author, so
 *  that only the node under test decides the outcome. */
function put(body, segs, value, recordLabels) {
  let node = body;
  segs.forEach((seg, i) => {
    const key = seg.startsWith("$") ? wildValue(seg) : seg;
    if (i === segs.length - 1) {
      node[key] = (node[key] && typeof node[key] === "object" && typeof value === "object")
        ? Object.assign(node[key], value) : value;
      return;
    }
    if (!node[key] || typeof node[key] !== "object") {
      node[key] = {};
      const prefix = segs.slice(0, i + 1);
      if (recordLabels.has(label(prefix))) Object.assign(node[key], author(prefix, IN), { at: 1 });
    }
    node = node[key];
  });
}

function identityFor(wildcard, who) {
  if (wildcard === "$uid") return who.uid;
  if (wildcard === "$stableId") return who.stableId;
  return who.cid;
}

for (const [treeName, tree] of Object.entries(TREES)) {
  const recordLabels = new Set(authoredRecords(tree).map((r) => label(r.path)));

  test(`${treeName}: the derivation finds the containers and records it is known to hold`, () => {
    const keyed = keyedContainers(tree).map(label);
    for (const known of ["pool/$clientId", "poll/$cid", "members/$uid", "rooms/$roomId/tests/$cid",
                         "rooms/$roomId/votes/$voteId/ballots/$clientId", "rooms/$roomId/presence/$clientId"]) {
      assert.ok(keyed.includes(known), `the walk no longer finds ${known}; it found ${keyed.join(", ")}`);
    }
    const records = authoredRecords(tree).map((r) => label(r.path));
    for (const known of ["rooms/$roomId/answers/moduleA/$entryId", "rooms/$roomId/events/$pushId",
                         "rooms/$roomId/answersDeleted/$pushId", "rooms/$roomId/answerReplies/$entryId/$replyId",
                         "rooms/$roomId/callForHelp", "audit/$entryId"]) {
      assert.ok(records.includes(known), `the walk no longer finds ${known}; it found ${records.join(", ")}`);
    }
    for (const p of BY_HOLDS_CLIENT_ID) assert.ok(records.includes(p), p + " is no longer in the rules");
  });

  test(`${treeName}: under every container keyed by a participant identity, only the included participant's child stays`, () => {
    const failures = [];
    for (const p of keyedContainers(tree)) {
      const wildcard = p[p.length - 1];
      const container = p.slice(0, -1);
      const body = baseSession();
      if (label(container) === "pool") {
        body.pool.c1.sentinel = "KEYED-IN";
        body.pool[OUT.cid] = { name: OUT.name, at: 30, consent: YES, sentinel: "KEYED-OUT" };
      } else {
        put(body, container.concat(identityFor(wildcard, IN)), { sentinel: "KEYED-IN", at: 1 }, recordLabels);
        put(body, container.concat(identityFor(wildcard, OUT)), { sentinel: "KEYED-OUT", at: 1 }, recordLabels);
      }
      const db = JSON.stringify(body);
      assert.ok(db.includes("KEYED-IN") && db.includes("KEYED-OUT"), "fixture for " + label(p) + " is broken");
      const blob = JSON.stringify(pseudonymiseSession(body, "S1", {}));
      if (blob.includes("KEYED-OUT")) failures.push(label(p) + ": a child keyed by an identity nobody included holds stayed");
      const dropped = DROPPED_WHOLE.includes(container[0]) && container.length === 1;
      if (!dropped && !blob.includes("KEYED-IN")) failures.push(label(p) + ": the included participant's child was removed");
      if (dropped && blob.includes("KEYED-IN")) failures.push(label(p) + ": listed as dropped whole, and is not");
    }
    assert.deepStrictEqual(failures, [],
      "database.rules.json keys these by a participant identity and the export does not treat " +
      "them as such. Add the container to scripts/lib/research-inclusion.js.");
    for (const d of DROPPED_WHOLE) assert.ok(DROP_KEYS.has(d), d + " is no longer dropped whole");
  });

  test(`${treeName}: at every record that carries an author, only the included participant's record stays`, () => {
    const failures = [];
    for (const rec of authoredRecords(tree)) {
      const facilitator = rec.adminOnly || FACILITATOR_BY_DEFINITION.includes(label(rec.path));
      const dropped = DROP_KEYS.has(rec.path[rec.path.length - 1]);
      const variants = [["by the included participant", IN, true],
                        ["by somebody who is not included", OUT, facilitator]];
      if (rec.hasCid) {
        variants.push(["with the included participant's cid and a name nobody included holds",
          { cid: IN.cid, name: OUT.name }, false]);
      }
      for (const [how, who, shouldStay] of variants) {
        const body = baseSession();
        put(body, rec.path, Object.assign(author(rec.path, who), { at: 1, sentinel: "RECORD-SENTINEL" }),
            recordLabels);
        assert.ok(JSON.stringify(body).includes("RECORD-SENTINEL"), "fixture for " + label(rec.path) + " is broken");
        const stayed = JSON.stringify(pseudonymiseSession(body, "S1", {})).includes("RECORD-SENTINEL");
        const expected = dropped ? false : shouldStay;
        if (stayed !== expected) {
          failures.push(`${label(rec.path)} ${how}: ${stayed ? "kept" : "removed"}, expected ${expected ? "kept" : "removed"}`);
        }
      }
    }
    assert.deepStrictEqual(failures, [],
      "database.rules.json gives these records an author and the export does not judge them by " +
      "it. Add the position to scripts/lib/research-inclusion.js.");
  });
}

test("roleAssign's `by` really is a clientId in the client", () => {
  /* BY_HOLDS_CLIENT_ID is read from the client. If the client starts writing a
     name there, the inclusion filter must judge it as one. */
  const fn = SCRIPT.slice(SCRIPT.indexOf("function assignRolesRandomly"));
  assert.match(fn.slice(0, 2000), /refRoleAssign\.set\(\{ assignments: assignments, by: clientId, at: serverNow\(\) \}\)/);
});

test("legacy per-prompt reply lists — keyed by clientId until 2026-07-24 — keep only the included participant's", () => {
  /* Their rules were removed in #244 (moduleA/promptReplies/$promptIdx/$cid,
     moduleB/exchangeReplies/$promptIdx/$cid), so part A cannot see them. A
     closed session older than that may still be in the database. */
  const body = baseSession();
  body.rooms.r1.moduleA = { promptReplies: { 0: { c1: { text: "LEGACY-IN" }, [OUT.cid]: { text: "LEGACY-OUT" } } } };
  body.rooms.r1.moduleB = { exchangeReplies: { 2: { c2: { text: "LEGACY-OUT" } } } };
  const blob = JSON.stringify(pseudonymiseSession(body, "S1", {}));
  assert.ok(blob.includes("LEGACY-IN"));
  assert.ok(!blob.includes("LEGACY-OUT"));
});
