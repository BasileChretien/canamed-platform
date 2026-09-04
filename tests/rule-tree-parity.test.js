/* tests/rule-tree-parity.test.js
 *
 * Annex VI G9 — the `orgs/` rule subtree must mirror the `sessions/` one.
 *
 * WHY A TEST AND NOT A CHECKLIST. This gap was found three times by hand — the
 * 2026-05-30 round-3 review, the 2026-08-05 mechanical subtree diff, and the
 * 2026-09-03 Annex VI verification pass — and each pass found a DIFFERENT set of
 * nodes, because the trees kept drifting between audits. Nothing linked them, so
 * every new session-level node landed in one tree and was noticed months later,
 * if at all. A missing org rule fails CLOSED (a denial, not a hole), so it never
 * announces itself in production: an org-scoped session just silently loses the
 * feature.
 *
 * THE CONTRACT IS IDENTITY, AND DELIBERATE ASYMMETRY MUST BE DECLARED. If a node
 * ever genuinely belongs to only one tree, add it to ASYMMETRIC below with the
 * reason. That makes the exception a decision somebody wrote down, rather than
 * the accident this has been every time so far.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RULES = path.join(
  __dirname, "..", "docs", "Third_session", "PBL_platform", "database.rules.json");
const rules = JSON.parse(fs.readFileSync(RULES, "utf8")).rules;

const S = rules.sessions.$sessionId;
const O = rules.orgs.$orgSlug.sessions.$sessionId;

/** Nodes intentionally present in only one tree: node -> why. Empty today. */
const ASYMMETRIC = Object.create(null);

const diff = (a, b) => Object.keys(a)
  .filter((k) => !(k in b))
  .filter((k) => !(k in ASYMMETRIC));

test("the two subtrees exist and are non-trivial (anti-vacuity)", () => {
  assert.ok(Object.keys(S).length > 20,
    "the sessions subtree lookup has stopped working");
  assert.ok(Object.keys(O).length > 20,
    "the orgs subtree lookup has stopped working");
  assert.ok(S.rooms && S.rooms.$roomId && O.rooms && O.rooms.$roomId,
    "the room subtree lookup has stopped working");
});

test("session-level node sets match", () => {
  assert.deepStrictEqual(diff(S, O), [],
    "present under sessions/$sessionId but NOT under orgs/…/$sessionId — an " +
    "org-scoped session silently loses these (writes fail closed)");
  assert.deepStrictEqual(diff(O, S), [],
    "present under orgs/…/$sessionId but NOT under sessions/$sessionId");
});

test("room-level node sets match", () => {
  const sr = S.rooms.$roomId;
  const or = O.rooms.$roomId;
  assert.deepStrictEqual(diff(sr, or), [],
    "present under sessions/…/rooms/$roomId but NOT under the org equivalent");
  assert.deepStrictEqual(diff(or, sr), [],
    "present under the org rooms subtree but NOT under sessions/…/rooms/$roomId");
});

test("every org rule addresses the org tree, never the default one", () => {
  /* The failure mode a hand-written mirror produces: a rule copied into the org
     tree that still reads root.child('sessions'), so an org session's gate is
     evaluated against a DIFFERENT session's data — or against nothing. That is
     worse than the missing rule it replaced, because it fails OPEN. */
  const bad = [];
  (function walk(node, at) {
    if (typeof node === "string") {
      if (node.includes("root.child('sessions').child($sessionId)")) bad.push(at);
      return;
    }
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) walk(node[k], at + "/" + k);
    }
  })(O, "orgs/$orgSlug/sessions/$sessionId");
  assert.deepStrictEqual(bad, [],
    "these org rules still address root.child('sessions') — they would be " +
    "evaluated against the default tree, which fails OPEN rather than closed");
});

test("the three G9 nodes are pure re-prefixes of their session originals", () => {
  /* Cloned, not retyped. If someone later edits one copy only, this fails. */
  const OLD = "root.child('sessions').child($sessionId)";
  const NEW = "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)";
  const pairs = [
    ["poll", S.poll, O.poll],
    ["answerReplies", S.rooms.$roomId.answerReplies, O.rooms.$roomId.answerReplies],
    ["observers", S.rooms.$roomId.observers, O.rooms.$roomId.observers],
  ];
  for (const [name, src, dst] of pairs) {
    assert.ok(src && dst, `${name}: missing from one of the trees`);
    assert.strictEqual(
      JSON.stringify(src).split(OLD).join(NEW),
      JSON.stringify(dst),
      `${name}: the org copy has drifted from the session original — they are ` +
      `meant to differ ONLY by the path prefix`);
  }
});
