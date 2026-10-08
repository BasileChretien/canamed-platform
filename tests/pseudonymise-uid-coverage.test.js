/* tests/pseudonymise-uid-coverage.test.js
 *
 * scripts/lib/pseudonymise.js knows by NAME which parts of a session hold a
 * Firebase auth uid: `DROP_KEYS` for the ones it removes, `UID_KEYED` for the
 * maps it rekeys. Both are hand-written copies of something the DATABASE RULES
 * already state, and by 2026-10-08 the copy was three short. Run on a session
 * shaped like a real one, the "pseudonymised" research export still carried:
 *
 *   - `creatorUid`            the facilitator's account identifier;
 *   - `scenarioRef.ownerUid`  the scenario author's;
 *   - `roomOf/<uid>`          every participant's, as a key, beside their
 *                             clientId. `roomOf` entered the rules on
 *                             2026-08-03; the list of uid-keyed maps was
 *                             written on 2026-07-23 and nothing tied the two.
 *
 * tests/pseudonymise.test.js pinned the list AS IT THEN WAS ("clientMapping and
 * stableIdMapping are dropped, uidMembers is rekeyed"), which a list that is
 * one short passes. So the positions are DERIVED here from the rules, and the
 * real function is RUN on each:
 *
 *   1. Walk a session body as `database.rules.json` declares it — every node,
 *      and every child its parent's rules name (`newData.child('x')`,
 *      `hasChild('x')`, `hasChildren(['x', …])`).
 *   2. A position holds an account identifier when the rules key it by a uid
 *      wildcard (`$uid`, or any wildcard its own rules compare with
 *      `auth.uid`), require its value to be `auth.uid`, or name it
 *      `uid` / `…Uid`.
 *   3. Put a sentinel there, run pseudonymiseSession(), and look for the
 *      sentinel anywhere in the serialised output.
 *
 * WHAT THIS CAN AND CANNOT SEE. It narrows the gap; it does not close it.
 *   - It reads the RULES. A field the client writes and no rule names is
 *     invisible to it. There is one that matters, `pool/<clientId>/stableId`,
 *     and it is added by hand in the last section, with where it was read.
 *   - It reads the rules AS THEY ARE. A node the rules once declared and no
 *     longer do is invisible, and its data outlives the rule: the session mail
 *     queue held e-mail addresses until 2026-09-24. tests/pseudonymise.test.js
 *     pins that one by hand.
 *   - It sees an identifier, not a NAME. A display name inside a string — the
 *     JSON payload of a room event — is not a position the rules describe at
 *     all. That defect was found by a reviewer reading what the client writes,
 *     after this file was written and had passed.
 *   - Step 2's last test is a naming convention, and this trusts it: a field
 *     holding a uid under a name that says nothing (`owner`, `who`) and that no
 *     rule compares with `auth.uid` passes unseen. `scenarioRef.ownerUid` is
 *     found by its name alone — its rule asks only for a string — and would
 *     not have been found as `owner`.
 *   - It says nothing about free text. A uid typed into an answer is R7's
 *     subject (legal/dpa-draft.md), not this file's.
 *
 * tests/erasure-node-coverage.test.js does the same for the erasure planner and
 * is the model: that planner already listed `roomOf` under its uid-keyed nodes.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RULES = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform",
                        "database.rules.json");
const rules = JSON.parse(fs.readFileSync(RULES, "utf8")).rules;

const { pseudonymiseSession } = require("../scripts/lib/pseudonymise");

const TREES = {
  "sessions/$sessionId": rules.sessions.$sessionId,
  "orgs/$orgSlug/sessions/$sessionId": rules.orgs.$orgSlug.sessions.$sessionId
};

const UID_WILDCARD = /^\$(uid|[A-Za-z]*Uid)$/;
const UID_NAME = /^(uid|[A-Za-z]*Uid)$/;
/* `==` and `===`, and either operand first: the rules use both spellings. */
const OWN_VALUE_IS_AUTH_UID = /newData\.val\(\) ===? auth\.uid|auth\.uid ===? newData\.val\(\)/;
/* The three ways a rule names a child of the node it sits on. */
const CHILD_NAMED = /newData\.child\('([A-Za-z_]+)'\)|hasChild\('([A-Za-z_]+)'\)/g;
const CHILDREN_LISTED = /hasChildren\(\[([^\]]*)\]\)/g;

function ruleText(node) {
  return [node[".validate"], node[".write"], node[".read"]]
    .filter((s) => typeof s === "string").join(" ");
}

function childrenNamedIn(text) {
  const names = new Set();
  for (const m of text.matchAll(CHILD_NAMED)) names.add(m[1] || m[2]);
  for (const m of text.matchAll(CHILDREN_LISTED)) {
    for (const q of m[1].match(/'[A-Za-z_]+'/g) || []) names.add(q.slice(1, -1));
  }
  return names;
}

/** Every field a session body can hold, as the rules declare it: a node of its
 *  own, or a child that only its parent's rules name. */
function declaredFields(sessionRules) {
  const out = [];
  (function walk(node, at) {
    const text = ruleText(node);
    if (at.length) {
      const last = at[at.length - 1];
      /* A wildcard the node's own rules compare with `auth.uid` is a uid key
         whatever it is called (`$memberId` with `auth.uid == $memberId`). */
      const wild = last.startsWith("$") ? last.replace("$", "\\$") : null;
      const keyIsAuthUid = !!wild && new RegExp(
        "auth\\.uid ===? " + wild + "\\b|" + wild + " ===? auth\\.uid").test(text);
      out.push({ path: at, valueIsAuthUid: OWN_VALUE_IS_AUTH_UID.test(text), keyIsAuthUid });
    }
    for (const child of childrenNamedIn(text)) {
      if (Object.prototype.hasOwnProperty.call(node, child)) continue; // walked below
      const c = "newData\\.child\\('" + child + "'\\)\\.val\\(\\)";
      const bound = new RegExp(c + " ===? auth\\.uid|auth\\.uid ===? " + c).test(text);
      out.push({ path: at.concat(child), valueIsAuthUid: bound, keyIsAuthUid: false });
    }
    for (const k of Object.keys(node)) {
      if (k.startsWith(".")) continue;
      if (node[k] && typeof node[k] === "object") walk(node[k], at.concat(k));
    }
  })(sessionRules, []);
  return out;
}

const label = (p) => p.path.join("/");

/** The positions that hold an account identifier: `kind` says whether it is the
 *  KEY at that level or the VALUE. */
function accountIdPositions(sessionRules) {
  const seen = new Set();
  const out = [];
  for (const f of declaredFields(sessionRules)) {
    const last = f.path[f.path.length - 1];
    let kind = null;
    if (UID_WILDCARD.test(last) || f.keyIsAuthUid) kind = "key";
    else if (f.valueIsAuthUid || (!last.startsWith("$") && UID_NAME.test(last))) kind = "value";
    if (!kind || seen.has(label(f))) continue;
    seen.add(label(f));
    out.push({ path: f.path, kind });
  }
  return out;
}

/** The positions that hold the cross-session research identifier. */
function stableIdPositions(sessionRules) {
  const seen = new Set();
  const out = [];
  for (const f of declaredFields(sessionRules)) {
    const last = f.path[f.path.length - 1];
    const kind = last === "$stableId" ? "key" : last === "stableId" ? "value" : null;
    if (!kind || seen.has(label(f))) continue;
    seen.add(label(f));
    out.push({ path: f.path, kind });
  }
  return out;
}

const YES = { workshop: true, research: true, version: "PIS-v12", at: 5 };
const CID = "c1";

/** A session holding ONE consenting participant, some of their work, and
 *  `sentinel` at `position`. With `boundToParticipant` the sentinel is also
 *  that participant's uid in `clientMapping`, so a uid-keyed map has a
 *  pseudonym to move to; without it the uid is nobody's in the pool, as a
 *  facilitator's is. The two take different branches of the rekeying. */
function sessionWith(position, sentinel, boundToParticipant) {
  const body = {
    pool: { [CID]: { name: "Ann", university: "Caen", at: 10, consent: YES } },
    rooms: { r1: { answers: { moduleA: { a1: { by: "Ann", cid: CID, text: "kept", at: 20 } } } } }
  };
  if (boundToParticipant) body.clientMapping = { [CID]: sentinel };
  let node = body;
  position.path.forEach((seg, i) => {
    const last = i === position.path.length - 1;
    let key = seg;
    if (seg.startsWith("$")) {
      if (last && position.kind === "key") key = sentinel;
      else if (seg === "$clientId" || seg === "$cid") key = CID;
      else key = seg === "$roomId" ? "r1" : seg.slice(1) + "1";
    }
    if (last && position.kind === "value") { node[key] = sentinel; return; }
    if (!node[key] || typeof node[key] !== "object") node[key] = {};
    if (last) node[key].at = 1;
    node = node[key];
  });
  return body;
}

/** Where `needle` sits in `tree`, as a key or as a whole string value. */
function occurrences(tree, needle) {
  const out = [];
  (function walk(node, at) {
    for (const k of Object.keys(node)) {
      const here = at.concat(k);
      if (k === needle) out.push(here.join("/") + " [key]");
      if (node[k] === needle) out.push(here.join("/"));
      else if (node[k] && typeof node[k] === "object") walk(node[k], here);
    }
  })(tree, []);
  return out;
}

function run(position, sentinel, bound) {
  const body = sessionWith(position, sentinel, bound);
  const placed = occurrences(body, sentinel);
  const out = pseudonymiseSession(body, "S1", {});
  return { placed, out, left: occurrences(out, sentinel),
           anywhere: JSON.stringify(out).includes(sentinel) };
}

/* ------------------------------------------------------------------ *
 * 1. Account identifiers: none may reach the export
 * ------------------------------------------------------------------ */

for (const [treeName, tree] of Object.entries(TREES)) {
  test(`${treeName}: the derivation finds the account identifiers it is known to hold`, () => {
    /* A floor for the DERIVATION, not the coverage: if the walk stops finding
       these, a clean run below proves nothing. One of each kind — a uid key
       (`$uid`), a value the rule compares with `auth.uid` (the two mapping
       tables, `creatorUid`), a value found by its name alone (`ownerUid`).
       `_superadminReset/uid` is left out on purpose although the walk finds it
       today: the reset flag is on its way out of the session tree, and a floor
       must not fail because a uid LEFT the rules. */
    const found = accountIdPositions(tree).map(label);
    for (const known of ["members/$uid", "roomOf/$uid", "creatorUid", "scenarioRef/ownerUid",
                         "clientMapping/$clientId", "stableIdMapping/$stableId"]) {
      assert.ok(found.includes(known),
        `the walk over ${treeName} no longer finds ${known}; it found: ${found.join(", ")}`);
    }
  });

  test(`${treeName}: no position that holds an account identifier survives the export`, () => {
    const positions = accountIdPositions(tree);
    const failures = [];
    for (const position of positions) {
      for (const bound of [true, false]) {
        const sentinel = "AuthUidSentinel0000000000000X";
        const { placed, out, left, anywhere } = run(position, sentinel, bound);
        assert.ok(placed.length > 0,
          `the fixture for ${label(position)} does not hold the sentinel — the test is broken`);
        assert.strictEqual(out.pool[CID].name, "Student-A",
          "the function no longer pseudonymises the fixture's participant");
        assert.strictEqual(out.rooms.r1.answers.moduleA.a1.text, "kept",
          "the function no longer returns the fixture's research content");
        if (anywhere) {
          failures.push(`${label(position)} (${position.kind}; the uid is ` +
            `${bound ? "a consenting participant's" : "nobody's in the pool"}) -> ` +
            `${left.join(", ") || "inside a string"}`);
        }
      }
    }
    assert.deepStrictEqual(failures, [],
      "database.rules.json puts a Firebase auth uid in these places and " +
      "scripts/lib/pseudonymise.js lets it through to the research export. An auth uid is " +
      "the same in every session and joins straight to the account. Drop the field " +
      "(DROP_KEYS) or, for a map keyed by uid, rekey it (UID_KEYED).");
  });
}

/* ------------------------------------------------------------------ *
 * 2. stableId: the identifier the export DOES carry, listed
 * ------------------------------------------------------------------ *
 * `stableId` is the study's join key (Research_design/study_protocol_SAP.md,
 * section 9): one person's pre-test, post-test and questionnaire are joined on
 * it across the tabs they used. The export carries it as written. For a
 * participant who is SIGNED IN it is not a random value at all:
 * handleAuthStateChange() sets it to their Firebase auth uid, the same in
 * every session. For an anonymous one it is a random value kept in the
 * browser, which carries into the next session unless they left through
 * Leave / "use a different session" / "forget this session", each of which
 * clears it.
 *
 * This list is NOT a decision that carrying it as written is right, and the
 * in-platform joins do not require it: the pre-test, the post-test and the
 * wrap-up questionnaire all sit inside ONE session, so a stand-in assigned per
 * distinct stableId per session would keep every one of those joins and remove
 * both the cross-session link and the raw uid. The one join it would break is
 * to a questionnaire held OUTSIDE the platform, through a printed code derived
 * from the stableId — which the protocol plans (unticked in its checklist) and
 * the client does not show. legal/dpa-draft.md Annex VI R8 and R10 put the
 * choice to the controller. The list is here so that the places a stableId
 * reaches are written down and cannot grow unnoticed, and so that whoever
 * changes its treatment finds every one of them.
 */
const STABLE_ID_CARRIED = [
  "poll/$cid/stableId",
  "rooms/$roomId/tests/$cid/pre/stableId",
  "rooms/$roomId/tests/$cid/post/stableId",
  "rooms/$roomId/survey/$cid/stableId"
];

for (const [treeName, tree] of Object.entries(TREES)) {
  test(`${treeName}: every place the rules put a stableId is removed or listed as carried`, () => {
    const positions = stableIdPositions(tree);
    assert.ok(positions.map(label).includes("stableIdMapping/$stableId"),
      "the walk no longer finds stableIdMapping — it broke");
    const carried = [];
    for (const position of positions) {
      const sentinel = "sStableIdSentinel0X";
      const { placed, anywhere } = run(position, sentinel, false);
      assert.ok(placed.length > 0, `the fixture for ${label(position)} holds no sentinel`);
      if (anywhere) carried.push(label(position));
    }
    assert.deepStrictEqual(carried.sort(), STABLE_ID_CARRIED.slice().sort(),
      "the set of places where the export carries a stableId changed. A new one is a new " +
      "copy of a cross-session identifier (an auth uid, for a signed-in participant): " +
      "list it above with the others, or remove it in scripts/lib/pseudonymise.js. One " +
      "that is no longer carried must leave the list — and legal/dpa-draft.md R8 with it.");
  });
}

test("stableId: the two places the client writes it that no rule declares", () => {
  /* Read from script.js, 2026-10-08: the pool entry is written with a
     `stableId` field the pool rule does not name, and a ballot is keyed by
     ballotKey(), which is the stableId, under a wildcard the rules spell
     `$clientId`. The walk above cannot see either. */
  const accountUid = "SignedInStudentAuthUid000005";
  const body = {
    clientMapping: { [CID]: accountUid },
    stableIdMapping: { [accountUid]: accountUid },
    pool: { [CID]: { name: "Ann", at: 10, consent: YES, stableId: accountUid } },
    rooms: { r1: { votes: { d1: { ballots: { [accountUid]: { choice: 1, at: 30 } } } } } }
  };
  const out = pseudonymiseSession(body, "S1", {});
  assert.deepStrictEqual(occurrences(out, accountUid).sort(),
    ["pool/c1/stableId", "rooms/r1/votes/d1/ballots/" + accountUid + " [key]"],
    "for a signed-in participant the stableId IS the auth uid, and the export carries it " +
    "in exactly these two client-written places besides the four the rules declare. If " +
    "this changed, the treatment of stableId changed: update R8 in legal/dpa-draft.md.");
});
