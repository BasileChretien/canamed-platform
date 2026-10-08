"use strict";
/* tests/session-config-creator-bound.test.js
 *
 * A session's configuration is written once, at creation, by its creator — and
 * until 2026-10-08 the rules said only the first half of that sentence.
 *
 * Eight nodes under `sessions/$sessionId` (and their org mirrors) carried
 * `auth != null && !data.exists()`: `controller`, `workshopLabel`,
 * `scenarioId`, `sections`, `sectionBodies/$slot`, `modules`,
 * `scenarioCustomJson`, `scenarioRef`. Written once — by anyone signed in, at
 * any time. The create form writes three of them; whatever it leaves unset was
 * the first comer's, and write-once then stopped the creator from undoing it.
 * What that did to a running session was measured on the emulator and is in
 * the header of tests-e2e/emulator/session-config-creator-bound.spec.js.
 *
 * THE RULES NOW, and why there are two of them.
 *
 *   IN THE CREATE BATCH (`controller`, `workshopLabel`, `sections`) — the rule
 *   the recovery record has: once, while the session has no password, by its
 *   creator or, when it has no creator yet, by whoever the creation gate
 *   admits. createSession() issues these in ONE parallel batch with
 *   `creatorUid`. A rule that required the claim to have LANDED first would
 *   stake every session creation on the database applying one client's writes
 *   in the order they were issued — almost certainly true, and not provable
 *   before the rules are live, where a wrong guess stops every facilitator.
 *   So these three do not depend on it.
 *
 *   NOT IN THE BATCH (`scenarioId`, `modules`, `scenarioCustomJson`,
 *   `scenarioRef`, `sectionBodies/$slot`) — the creator, and nobody else. The
 *   only caller of createSession() passes null for the first four, and the
 *   bodies are chained AFTER the batch has been acknowledged, so nothing the
 *   current client sends can arrive before the claim. Being strict here is
 *   what stops a stranger from seeding one of them on a code nobody has drawn
 *   yet and having a facilitator's creation complete around it: to write one,
 *   the stranger must hold the claim, and then the facilitator's own claim is
 *   refused and the creation fails where it can be seen.
 *
 * WHY NOTHING CAUGHT THE DEFECT. Three unit tests pinned the rule as the exact
 * string `auth != null && !data.exists()` — green on the defect, and they would
 * have gone red on the fix. And every hardening pass since Phase 4a worked from
 * a list of nodes somebody had thought of; these eight were on none of them,
 * because "write-once" read as "safe".
 *
 * So the list is DERIVED here. Each `.write` in both session subtrees is parsed
 * into its `&&` / `||` structure, and asked one question: is there a way
 * through it — and through the `.validate` beside it — that never mentions
 * `auth.uid`? A write that has one must be in OPEN below with the reason, and
 * an entry in OPEN whose rule has since been closed fails too, so the list
 * cannot go stale in either direction.
 *
 * WHAT THIS CAN AND CANNOT SEE.
 *   - It answers "does every way through name the writer", not "is the tie
 *     enough". `clientMapping/<a made-up id> == auth.uid` names the writer and
 *     binds nothing until the id is claimed; a proof compared with a hash that
 *     may be null would count as a tie.
 *   - It pairs a `.write` with the `.validate` on the SAME node only. A
 *     `.validate` does not run on a delete, so a write tied only by its
 *     validator can still be deleted by whoever passes the `.write`.
 *   - It reads the two session subtrees and nothing above them: `recovery/`,
 *     `adminSecrets/`, `roomChat/` and the other top-level trees are not this
 *     file's.
 *   Whether a rule HOLDS is settled on the emulator
 *   (tests-e2e/emulator/session-config-creator-bound.spec.js), where every
 *   denial is paired with an allow.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
/* Normalised at the read site: a CRLF checkout must not change what a regex
   that walks lines sees. */
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8").replace(/\r\n/g, "\n");

const S_PREFIX = "root.child('sessions').child($sessionId)";
const O_PREFIX = "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)";
const TREES = [
  ["sessions/$sessionId", rules.sessions.$sessionId, S_PREFIX],
  ["orgs/$orgSlug/sessions/$sessionId", rules.orgs.$orgSlug.sessions.$sessionId, O_PREFIX],
];

const GATE = "(root.child('facilitatorGate').child('enforce').val() != true || " +
  "root.child('facilitatorGate').child('allow').child(auth.uid).val() == true)";

/* The three createSession() writes in its parallel batch. */
const IN_BATCH = ["/controller", "/workshopLabel", "/sections"];
const inBatchRule = (p) =>
  "auth != null && !data.exists() && !" + p + ".child('adminPasswordHash').exists() && (!" +
  p + ".child('creatorUid').exists() || " + p + ".child('creatorUid').val() == auth.uid) && " + GATE;

/* The five it does not: four the only caller passes null for, and the authored
   bodies, which are chained after the batch. */
const NOT_IN_BATCH = ["/scenarioId", "/modules", "/scenarioCustomJson", "/scenarioRef", "/sectionBodies/$slot"];
const creatorOnlyRule = (p) =>
  "auth != null && !data.exists() && " + p + ".child('creatorUid').val() == auth.uid && !" +
  p + ".child('adminPasswordHash').exists()";

/* ── reading a rule ─────────────────────────────────────────────────────── */

/* Step over a string or a regex literal, so that an operator or a bracket
   inside one is not read as structure. Returns the index after it, or -1. */
function skipLiteral(expr, i) {
  if (expr[i] === "'") {
    const j = expr.indexOf("'", i + 1);
    assert.notStrictEqual(j, -1, "unterminated string in a rule: " + expr.slice(i, i + 40));
    return j + 1;
  }
  if (expr[i] === "/" && expr.slice(Math.max(0, i - 8), i) === "matches(") {
    const j = expr.indexOf("/)", i + 1);
    assert.notStrictEqual(j, -1, "unterminated regex in a rule: " + expr.slice(i, i + 40));
    return j + 1;
  }
  return -1;
}
function splitTop(expr, op) {
  const parts = [];
  let depth = 0, start = 0, i = 0;
  while (i < expr.length) {
    const lit = skipLiteral(expr, i);
    if (lit !== -1) { i = lit; continue; }
    const c = expr[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i));
      i += op.length;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(expr.slice(start));
  return parts.map((s) => s.trim());
}
function wrapsWhole(expr) {
  if (expr[0] !== "(") return false;
  let depth = 0, i = 0;
  while (i < expr.length) {
    const lit = skipLiteral(expr, i);
    if (lit !== -1) { i = lit; continue; }
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") {
      depth--;
      if (depth === 0) return i === expr.length - 1;
    }
    i++;
  }
  return false;
}
/* Can this expression be satisfied by somebody it does not name? `||` needs one
   such branch, `&&` needs every term to allow it, and a term allows it unless
   it mentions `auth.uid`. A negated group is taken as satisfiable: whoever it
   names, somebody else is not them. */
function identityFree(expr) {
  expr = expr.trim();
  while (wrapsWhole(expr)) expr = expr.slice(1, -1).trim();
  const ors = splitTop(expr, "||");
  if (ors.length > 1) return ors.some(identityFree);
  const ands = splitTop(expr, "&&");
  if (ands.length > 1) return ands.every(identityFree);
  if (expr.startsWith("!(")) return true;
  return !/\bauth\.uid\b/.test(expr);
}

/* Every `.write` under a node, with the `.validate` that sits beside it. */
function writesUnder(node) {
  const out = [];
  (function walk(n, at) {
    if (!n || typeof n !== "object") return;
    if (typeof n[".write"] === "string") {
      out.push({ at, write: n[".write"], validate: typeof n[".validate"] === "string" ? n[".validate"] : "" });
    }
    for (const k of Object.keys(n)) if (k[0] !== ".") walk(n[k], at + "/" + k);
  })(node, "");
  return out;
}
const isOpen = (w) => identityFree(w.write) && (!w.validate || identityFree(w.validate));

/* ── the writes that have a way through naming nobody, and why ──────────── */

const CREATING =
  "creating a session: on a code with no creator and no password, this is the first writer's — " +
  "that is what creating one is. Refused on any session that has a creator who is somebody else, " +
  "and on any session that has a password";
const UNCLAIMED_CLIENT_ID =
  "open for a client id nobody has claimed yet (the tolerant first-write branch): bound from the " +
  "moment the join chain writes clientMapping. Recorded — CLAUDE.md \"Accepted by design\", DPA " +
  "Annex VI R3 — as a narrow window, which understates it: until then any signed-in visitor who " +
  "knows the code can write it under an id of their own making, and an invented id is never " +
  "claimed (DPA Annex VI G14, item 5: no decision recorded on the difference)";
const ROOM_GATE =
  "NOT FIXED — any signed-in visitor who knows the code can write this in any room of an open " +
  "session, joined or not (run on the emulator 2026-10-08: ALLOWED). A different defect from the " +
  "one this file is about; listed so that another cannot join it unnoticed, not because it is " +
  "acceptable";

const OPEN = {
  "/created": CREATING,
  "/adminPasswordHash": CREATING + " (its other branch, the reset, is tied to whoever opened it)",
  "/controller": CREATING + " — the recovery record's rule, because createSession() issues it in one batch with the claim",
  "/workshopLabel": CREATING + " — as controller",
  "/sections": CREATING + " — as controller",
  "/_superadminReset":
    "its DELETE branch (`newData.val() == null`) names nobody: any signed-in visitor can remove a " +
    "reset in progress on an open session. Not this change's; writing one needs the recovery code",
  "/poll/$cid": UNCLAIMED_CLIENT_ID,
  "/pool/$clientId": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/presence/$clientId": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/typing/$clientId": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/votes/$voteId/ballots/$clientId": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/observers/$clientId": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/roleChoices/$clientId": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/tests/$cid/pre": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/tests/$cid/post": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/survey/$cid": UNCLAIMED_CLIENT_ID,
  "/rooms/$roomId/events/$pushId": ROOM_GATE,
  "/rooms/$roomId/teamName": ROOM_GATE,
  "/rooms/$roomId/roleplayRound": ROOM_GATE,
  "/rooms/$roomId/callForHelp": ROOM_GATE,
  "/rooms/$roomId/sections/$slot/revealed/$itemId": ROOM_GATE,
  "/rooms/$roomId/moduleA/revealed/$itemId": ROOM_GATE,
  "/rooms/$roomId/answerReplies/$entryId/$replyId": ROOM_GATE,
};

test("the reader takes a rule apart correctly (anti-vacuity)", () => {
  /* The defect's own shape must read as open, or everything below is blind to
     exactly what it exists for. */
  assert.strictEqual(identityFree("auth != null && !data.exists()"), true);
  /* The soft-launch gate is off by default; its first branch names nobody. */
  assert.strictEqual(identityFree("auth != null && !data.exists() && " + GATE), true);
  assert.strictEqual(identityFree(creatorOnlyRule(S_PREFIX)), false, "creator-only must read as closed");
  assert.strictEqual(identityFree(inBatchRule(S_PREFIX)), true,
    "the in-batch rule has a nobody-yet branch, and must be read as having one");
  /* Structure, not text: a tie inside ONE branch of an `||` does not close the
     other, however the operands are ordered. */
  assert.strictEqual(identityFree("auth != null && (!x.exists() || x.val() == auth.uid)"), true);
  assert.strictEqual(identityFree("auth != null && (auth.uid == x.val() || y.val() == auth.uid)"), false);
  assert.strictEqual(identityFree("auth != null && (newData.val() == null || newData.child('uid').val() == auth.uid)"), true);
  /* An operator or a bracket inside a literal is not structure. */
  assert.strictEqual(identityFree("auth.uid == $uid && newData.val().matches(/^(a||b)$/)"), false);
  assert.strictEqual(identityFree("newData.val() == 'a || b' && auth.uid == $uid"), false);
  assert.strictEqual(identityFree("newData.val().matches(/^(a||b)$/) && newData.val() != 'x)'"), true);

  for (const [label, node] of TREES) {
    const ws = writesUnder(node);
    assert.ok(ws.length > 50, `${label}: only ${ws.length} writes found — the walk has stopped working`);
    const closed = ws.filter((w) => !isOpen(w)).length;
    assert.ok(closed > 30, `${label}: only ${closed} writes read as closed — the reader has stopped working`);
  }
});

test("every write in a session names the writer on every way through it, or is listed here with the reason it does not", () => {
  for (const [label, node] of TREES) {
    const open = writesUnder(node).filter(isOpen).map((w) => w.at).sort();
    assert.deepStrictEqual(open, Object.keys(OPEN).sort(),
      `${label}: the writes that have a way through naming nobody have changed.\n` +
      "  A path here that is not in OPEN can be written by a signed-in visitor the rule does not\n" +
      "  name — bind every branch of it (the creator, a proof, a room claim, an owned client id)\n" +
      "  or add it to OPEN with the reason.\n" +
      "  A path in OPEN that is not here has been closed since: delete its entry.");
  }
});

test("nothing at or above a session grants a write — one there would cascade over every rule below it", () => {
  /* writesUnder() starts at the session node and reads each rule on its own.
     A `.write` on an ancestor is outside what it walks, and RTDB grants it to
     everything underneath whatever the deeper rules say: `"auth != null"` on
     `sessions` would reopen all eight nodes and leave the test above green
     (found in review, by adding one). The session node itself is included: a
     rule there that names its writer would read as closed above and still
     hand that writer the whole subtree. */
  const above = [
    ["the root", rules],
    ["sessions", rules.sessions],
    ["sessions/$sessionId", rules.sessions.$sessionId],
    ["orgs", rules.orgs],
    ["orgs/$orgSlug", rules.orgs.$orgSlug],
    ["orgs/$orgSlug/sessions", rules.orgs.$orgSlug.sessions],
    ["orgs/$orgSlug/sessions/$sessionId", rules.orgs.$orgSlug.sessions.$sessionId],
  ];
  for (const [label, node] of above) {
    const w = node[".write"];
    assert.ok(w === undefined || w === false || w === "false",
      `${label} carries ".write": ${JSON.stringify(w)}. A write granted here cascades over every ` +
      "session node, the eight configuration nodes included, and no deeper rule can take it back.");
  }
  assert.strictEqual(rules[".write"], false, "the root must refuse writes outright, not leave them undeclared");
});

test("the eight configuration nodes carry one of two rules, and it is the right one for each", () => {
  for (const [label, node, prefix] of TREES) {
    const ws = writesUnder(node);
    const ruleAt = (at) => {
      const w = ws.find((x) => x.at === at);
      assert.ok(w, `${label}${at}: no write rule — the node would fail closed and stop every creation`);
      return w.write;
    };
    for (const at of IN_BATCH) assert.strictEqual(ruleAt(at), inBatchRule(prefix), `${label}${at}`);
    for (const at of NOT_IN_BATCH) assert.strictEqual(ruleAt(at), creatorOnlyRule(prefix), `${label}${at}`);
  }
  /* "The recovery record's rule" is meant literally: same text, same reasons. */
  assert.strictEqual(rules.recovery.sessions.$sessionId[".write"], inBatchRule(S_PREFIX),
    "recovery/sessions/$sessionId no longer has the rule the in-batch configuration was given — " +
    "they are written in the same batch and must be let through, and refused, together");
  assert.strictEqual(rules.recovery.orgs.$orgSlug.sessions.$sessionId[".write"], inBatchRule(O_PREFIX));
});

test("the two trees state the same rule for each of the eight, differing by the path prefix only", () => {
  const [, s] = TREES[0];
  const [, o] = TREES[1];
  for (const key of ["controller", "workshopLabel", "scenarioId", "sections", "sectionBodies",
    "modules", "scenarioCustomJson", "scenarioRef"]) {
    assert.ok(s[key] && o[key], `${key}: missing from one of the trees`);
    assert.strictEqual(JSON.stringify(s[key]).split(S_PREFIX).join(O_PREFIX), JSON.stringify(o[key]),
      `${key}: the org copy is not a re-prefix of the session original`);
  }
});

test("createSession() still sends what the two rules were chosen for", () => {
  /* Which rule a node got depends on WHEN the client writes it. These are the
     facts that choice rests on; if one stops being true the rules have to be
     looked at again, and this says which. */
  const start = SCRIPT.indexOf("\nfunction createSession(");
  assert.notStrictEqual(start, -1, "createSession() not found in script.js");
  const end = SCRIPT.indexOf("\nfunction ", start + 1);
  const body = SCRIPT.slice(start, end === -1 ? undefined : end);
  assert.ok(body.length > 2000, "createSession() body not captured");
  const at = (needle, from) => {
    const i = body.indexOf(needle, from || 0);
    assert.notStrictEqual(i, -1, "createSession() no longer contains: " + needle);
    return i;
  };

  /* 1. Every path it writes under the session — so that a NINTH configuration
        field cannot join the batch without a line here, and a rule of its own
        that somebody has looked at. One write shape only: `.set()`. */
  const written = Array.from(
    body.matchAll(/oPath\(code, "([A-Za-z0-9_]+)(?:\/"[^)]*)?"?\)\)\.set\(/g), (m) => m[1]);
  assert.deepStrictEqual(Array.from(new Set(written)).sort(), [
    "adminPasswordHash", "controller", "created", "creatorUid", "modules", "scenarioCustomJson",
    "scenarioId", "scenarioRef", "sectionBodies", "sections", "workshopLabel",
  ], "createSession() writes a different set of session fields than this test knows");
  assert.doesNotMatch(body, /\.update\(/,
    "createSession() now uses update(): a multi-path write is judged against the data as it was " +
    "BEFORE the update, so a claim and a creator-only field sent together would be refused");

  /* 2. Everything is sent before the password. All eight rules close when
        `adminPasswordHash` exists; this was already true of `creatorUid` and
        the recovery record. */
  const password = at("hashPassword(password, code)");
  for (const field of ["workshopLabel", "controller", "scenarioCustomJson", "scenarioRef",
    "scenarioId", "modules", "sections"]) {
    assert.ok(at(`oPath(code, "${field}")).set(`) < password,
      `${field} must be issued before the password is set, or its rule refuses it`);
  }

  /* 3. The authored bodies are sent only once the batch has been acknowledged
        — which is what lets their rule be creator-only without betting on the
        order writes are applied in. */
  const batch = at("return Promise.all(writes)");
  const chained = at(".then(_bodyWrites)", batch);
  assert.ok(chained < at(".then(() => hashPassword(password, code))", batch),
    "the authored bodies must be chained between the batch and the password");
  assert.doesNotMatch(body, /writes\.push\([^\n]*sectionBodies/,
    "an authored body has joined the parallel batch: its rule is creator-only and may refuse it");

  /* 4. The only caller passes null for the four retired fields. If one comes
        back, it rides the batch with the claim — and its creator-only rule
        then depends on the order the database applies that batch in. Give it
        the in-batch rule, or chain it. */
  const calls = Array.from(SCRIPT.matchAll(/[^\w.]createSession\(([^;{]*?)\)\.then\(/g), (m) => m[1]);
  assert.strictEqual(calls.length, 1, "expected exactly one caller of createSession() in script.js");
  const args = calls[0].split(",").map((a) => a.trim());
  assert.deepStrictEqual(args.slice(3, 7), ["null", "null", "null", "null"],
    "createSession() is being handed a scenarioId / customJson / scenarioRef / modules again");
});
