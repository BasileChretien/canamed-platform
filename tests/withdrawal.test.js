/* tests/withdrawal.test.js
 *
 * In-product withdrawal of research consent — GDPR Art. 7(3), the half of
 * Annex VI G12 that a CLI could never close ("as easy to withdraw as to give",
 * and consent was given by ticking a box).
 *
 * The load-bearing property is unusual enough to be worth stating: the
 * `withdrawals` node must be writable WHEN THE SESSION IS CLOSED. Every other
 * participant-writable path in these rules is `!closed`-guarded, because those
 * paths carry session work. Withdrawal is not work — it is a right, exercised
 * precisely once the session is over. A well-meaning future edit that "makes
 * withdrawals consistent with the other participant paths" would silently
 * restore the defect, so the absence of that guard is asserted, not assumed.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

const rules = JSON.parse(read(PLATFORM, "database.rules.json")).rules;
const { applyWithdrawals, hasResearchConsent, sessionHasConsent } =
  require("../scripts/lib/pseudonymise");

const LEAVES = [
  ["default", () => rules.withdrawals.$sessionId.$uid],
  ["orgs", () => rules.withdrawals.orgs.$orgSlug.$sessionId.$uid],
];

// ------------------------------------------------------------------- rules

test("the withdrawals node exists in BOTH trees", () => {
  /* Org parity has been got wrong before — the `rosters` org branch was
     mis-nested for weeks and fail-closed silently. */
  for (const [label, get] of LEAVES) {
    assert.ok(get(), `${label} tree has no withdrawals leaf`);
  }
});

test("withdrawal stays possible AFTER the session closes", () => {
  for (const [label, get] of LEAVES) {
    const leaf = get();
    assert.ok(!/closed/.test(JSON.stringify(leaf)),
      `${label}: the withdrawals rule references \`closed\`. Withdrawal is ` +
      `exercised after a session ends — a closed-guard here makes the right ` +
      `unexercisable exactly when it is needed, which is the G12 defect.`);
  }
});

test("only the participant themselves may write or read it", () => {
  for (const [label, get] of LEAVES) {
    const leaf = get();
    assert.match(leaf[".write"], /auth\.uid == \$uid/, label);
    assert.match(leaf[".read"], /auth\.uid == \$uid/, label);
    assert.match(leaf[".write"], /auth != null/, label);
  }
});

test("the node can only ever record WITHDRAWAL, never assert consent", () => {
  /* Otherwise a withdrawal channel becomes a consent-forging one: a client
     could write research:true and re-enter the research dataset without ever
     passing the lobby's consent flow. */
  for (const [label, get] of LEAVES) {
    const v = get().research[".validate"];
    assert.match(v, /=== false/, `${label}: research is not pinned to false`);
  }
});

test("unknown keys are rejected and the timestamp cannot be in the future", () => {
  for (const [label, get] of LEAVES) {
    const leaf = get();
    assert.strictEqual(leaf.$other[".validate"], false, label);
    assert.match(leaf.at[".validate"], /<= now/, label);
    assert.match(leaf[".validate"], /hasChildren\(\['research','at'\]\)/, label);
  }
});

/* The one place the two leaves may differ: each addresses its OWN tree's
   session and its own tree's purge marker. */
const SESSION_AT = {
  default: "root.child('sessions').child($sessionId).child('created')",
  orgs: "root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('created')",
};
const MARKER_AT = {
  default: "root.child('purgedSessions').child($sessionId)",
  orgs: "root.child('purgedSessions').child('orgs').child($orgSlug).child($sessionId)",
};
/* The switch: the same node in both trees, written by the marker backfill and
   by nothing else. The rule's text is derived from the constant the backfill
   writes to, so the two cannot name different nodes. */
const { PURGED_MARKERS_BACKFILLED_PATH } = require("../scripts/lib/session-trees");
const BACKFILLED = "root" + String(PURGED_MARKERS_BACKFILLED_PATH).split("/")
  .map((seg) => `.child('${seg}')`).join("");

test("both trees carry the same leaf, each addressing its own tree", () => {
  /* Compared as a re-prefix, not as text: the default leaf, with its session
     and marker paths rewritten for the org tree, must BE the org leaf. Editing
     one copy alone fails here. */
  const asOrg = JSON.parse(JSON.stringify(LEAVES[0][1]())
    .split(SESSION_AT.default).join(SESSION_AT.orgs)
    .split(MARKER_AT.default).join(MARKER_AT.orgs));
  assert.deepStrictEqual(LEAVES[1][1](), asOrg,
    "the org and default withdrawal rules differ — one of them is wrong, and " +
    "the client picks the tree by deployment, so the difference would only " +
    "show up for whichever tenant is unlucky");
});

test("a withdrawal can only name a session that was CREATED, or was purged", () => {
  /* Until 2026-10-07 the write looked at the uid and nothing else, so any
     signed-in visitor — anonymous included — could record an erasure request
     for a code that never existed, and the daily monitor counted it.

     The evidence is the session's `created` record, not "something exists
     under this code". The first version of this rule tested the session node
     itself, and `sessions/<any code>/members/<own uid>` is writable by any
     signed-in visitor: one extra write, and the code "existed". (Found by an
     independent review; the same objection had been used to reject
     `users/<uid>/history/<code>` as the evidence.) `created` is written once,
     by whoever creates the session, and is the write the facilitator gate
     governs when it is enforced. The purge marker stands in for it once the
     session is gone: no client can write that. */
  for (const [label, get] of LEAVES) {
    const w = get()[".write"];
    assert.strictEqual(w,
      `auth != null && auth.uid == $uid && (!${BACKFILLED}.exists() || ${SESSION_AT[label]}.exists() || ${MARKER_AT[label]}.exists())`,
      `${label}: the write is not bound to its own session or its own marker`);
  }
  /* A mis-copied prefix here fails OPEN in one direction — an org record
     accepted because some unrelated default-tree session shares the code. */
  const org = LEAVES[1][1]()[".write"];
  assert.ok(!org.includes(SESSION_AT.default) && !org.includes(MARKER_AT.default + ".exists()"),
    "the org rule addresses the default tree");
});

test("the session-or-marker requirement is OFF until the marker backfill has run", () => {
  /* Sessions purged before the purge wrote markers have none. Had the rule
     required one from the day it shipped, a participant returning to withdraw
     from such a session — the route the account dialog's history row exists
     for, and one that worked the day before — would have been refused until an
     operator ran the backfill, and for a session purged more than 90 days
     earlier, for good. So the requirement waits for a switch:
     `ops/purgedMarkersBackfilledAt`, which the backfill writes in the same
     update as the markers. Absent, the rule asks what it asked before this
     change: that the record be the writer's own. */
  assert.strictEqual(PURGED_MARKERS_BACKFILLED_PATH, "ops/purgedMarkersBackfilledAt");
  for (const [label, get] of LEAVES) {
    const w = get()[".write"];
    assert.ok(w.startsWith(`auth != null && auth.uid == $uid && (!${BACKFILLED}.exists() || `),
      `${label}: with the switch absent the write must need nothing but the writer's own uid`);
    // The switch is ONE node, the same for both trees — not a per-tree one a
    // mis-copied prefix could leave permanently off for organisations.
    assert.strictEqual(w.split(BACKFILLED).length - 1, 1, label);
  }
  /* What stays ON whatever the switch says: the date window and the record's
     shape. They are `.validate` rules and do not mention it. */
  for (const [label, get] of LEAVES) {
    assert.ok(!JSON.stringify([get()[".validate"], get().at, get().research, get().erasure])
      .includes("purgedMarkersBackfilledAt"), label + ": a validate rule was put behind the switch");
  }
});

test("no client can read or set the switch", () => {
  /* It is a standing change to what every participant may write. `ops/` has
     no entry in the rules, so the root's `.read: false` / `.write: false`
     apply to all of it; an entry that opened any part of it would hand the
     switch to whoever found it. (What the rules really do with a client's
     write is the emulator suite's to show.) */
  assert.strictEqual(rules[".read"], false);
  assert.strictEqual(rules[".write"], false);
  assert.strictEqual(rules.ops, undefined,
    "an `ops` entry appeared in the rules. If it must exist, it must deny every " +
    "client read and write, and this test must say so explicitly.");
  // Nothing else in the rules may grant a write there by another route.
  const text = JSON.stringify(rules);
  assert.strictEqual(text.split("purgedMarkersBackfilledAt").length - 1, 2,
    "the switch is read by exactly the two withdrawal rules, and written by none");
});

test("the request's date is the server's, to within a day", () => {
  /* `at` starts the Art. 12(3) clock, and it is typed by the client. With only
     `<= now` a record written today with `at: 1` was decades overdue on the
     monitor's next run. A day of slack is for a slow device clock; a working
     client is never further behind than that (TLS fails first). */
  for (const [label, get] of LEAVES) {
    const v = get().at[".validate"];
    assert.match(v, /newData\.val\(\) >= now - 86400000\b/, `${label}: the date can be back-dated`);
  }
});

test("the date is judged on the RECORD, so one field cannot be added to an old one", () => {
  /* A `.validate` runs for the node being written and for its ancestors — not
     for its siblings. With the window on the `at` child alone, writing
     `…/erasure = true` on its own never looked at the date: a bare withdrawal
     recorded on day 0 (which the monitor ignores) became, on day 40, an
     erasure request that was "40 days old" the first time anyone could see it.
     One write, the monitor red, for a request that was never open. (Review
     finding B2; tests-e2e/emulator/pool-stale-at-rules.spec.js records the
     same mechanism on another node.)

     So the window is on the record: any write under it — whole or one field —
     is judged against the date the record will then carry. The client writes
     the whole record with today's date, so nothing it does changes. What the
     rule really does is the emulator suite's to show ("an old withdrawal
     cannot be turned into a request that is already overdue"). */
  const WINDOW = "newData.child('at').val() <= now + 5000 && newData.child('at').val() >= now - 86400000";
  for (const [label, get] of LEAVES) {
    assert.strictEqual(get()[".validate"],
      "newData.hasChildren(['research','at']) && newData.child('at').isNumber() && " + WINDOW,
      `${label}: a write to one field of the record is not judged against its date`);
    /* The same window as the field's own rule — two copies, so they are held
       together here rather than left to drift. */
    assert.strictEqual(get().at[".validate"],
      "newData.isNumber() && " + WINDOW.split("newData.child('at').val()").join("newData.val()"), label);
  }
});

test("a device clock a few seconds fast does not cost someone their withdrawal", () => {
  /* The client stamps the record with its own clock. Every other timestamp
     rule in this file allows five seconds of lead for exactly that reason;
     this one alone said `<= now`, so a device running ahead by more than the
     network delay was told "Could not record your withdrawal" — on the one
     write that exercises a right. Found 2026-10-07 while bounding the other
     side. The house tolerance, and no more: a date an hour ahead is refused. */
  for (const [label, get] of LEAVES) {
    assert.strictEqual(get().at[".validate"],
      "newData.isNumber() && newData.val() <= now + 5000 && newData.val() >= now - 86400000", label);
  }
  const text = JSON.stringify(rules);
  const bare = text.match(/\.val\(\) <= now(?! \+)/g) || [];
  assert.deepStrictEqual(bare, [],
    "a timestamp rule somewhere allows no clock lead at all — the same defect");
});

test("the purge marker is written by the Admin SDK and by nothing else", () => {
  assert.deepStrictEqual(rules.purgedSessions, { ".read": false, ".write": false },
    "purgedSessions must be closed to every client, with no child rule that " +
    "could reopen it — a client-writable marker is a self-issued permission " +
    "to record a withdrawal for any code");
});

// -------------------------------------------------------- the export gate

const session = () => ({
  closed: { at: 9 },
  clientMapping: { c1: "uA", c2: "uA", c3: "uB" },
  pool: {
    c1: { name: "A", consent: { research: true } },
    c2: { name: "A", consent: { research: true } },
    c3: { name: "B", consent: { research: true } },
  },
});

test("a withdrawal clears consent on EVERY clientId that person holds", () => {
  const out = applyWithdrawals(session(), { uA: { research: false, at: 1 } });
  assert.strictEqual(hasResearchConsent(out.pool.c1), false);
  assert.strictEqual(hasResearchConsent(out.pool.c2), false,
    "the person's second browser still consents — one clientId was missed");
  assert.strictEqual(hasResearchConsent(out.pool.c3), true,
    "somebody else's consent was cleared");
});

test("applying withdrawals does not mutate the input session", () => {
  const s = session();
  applyWithdrawals(s, { uA: { research: false, at: 1 } });
  assert.strictEqual(hasResearchConsent(s.pool.c1), true);
});

test("a record that is not a withdrawal changes nothing", () => {
  /* The rules forbid research:true, but this library also runs over data read
     from a database, and a gate that trusts the rules to have been enforced is
     a gate that fails when they are not. */
  const out = applyWithdrawals(session(), { uA: { research: true, at: 1 } });
  assert.strictEqual(hasResearchConsent(out.pool.c1), true);
});

test("no withdrawals, malformed withdrawals, and null sessions are all safe", () => {
  for (const w of [null, undefined, {}, { uA: null }, { uA: 5 }, "nope"]) {
    const out = applyWithdrawals(session(), w);
    assert.strictEqual(hasResearchConsent(out.pool.c1), true);
  }
  assert.strictEqual(applyWithdrawals(null, { uA: { research: false } }), null);
});

test("when everyone withdraws, the session drops out of the export entirely", () => {
  const out = applyWithdrawals(session(),
    { uA: { research: false, at: 1 }, uB: { research: false, at: 2 } });
  assert.strictEqual(sessionHasConsent(out), false,
    "the session would still be exported as a husk with every participant " +
    "stripped, which is what the consent gate exists to avoid");
});

// ------------------------------------------------------------ the wiring

test("the export reads withdrawals and fails CLOSED when it cannot", () => {
  const src = read(ROOT, "scripts", "pseudonymise-export.js");
  assert.match(src, /applyWithdrawals/,
    "the export does not apply withdrawals, so withdrawing has no effect on " +
    "the research dataset — the one thing withdrawal is for");
  assert.match(src, /withdrawalsPath/);
  assert.match(src, /process\.exit\(4\)/,
    "an unreadable withdrawals node must abort the export. It is " +
    "indistinguishable from an empty one, and guessing empty exports people " +
    "who asked to be left out.");
});

test("the client writes the node, and outside the session subtree", () => {
  const src = read(PLATFORM, "script.js");
  assert.match(src, /function withdrawalPath\(/);
  assert.match(src, /"withdrawals\/" \+ code/);
  assert.match(src, /"withdrawals\/orgs\/" \+ currentOrg/,
    "the client cannot address the org tree, so withdrawal would be denied " +
    "for every org-scoped session");
  assert.match(src, /function withdrawResearchConsent\(/);
});

test("both in-product entry points are wired", () => {
  const src = read(PLATFORM, "script.js");
  const html = read(PLATFORM, "index.html");
  assert.match(html, /id="gdpr-withdraw-btn"/,
    "the waiting-screen control is missing — it is the only route for " +
    "ANONYMOUS participants, who have no account history");
  assert.match(src, /gdpr-withdraw-btn/);
  assert.match(src, /account-history-withdraw/,
    "the account-history control is missing — it is the only route for " +
    "someone withdrawing after the session, weeks later");
});

test("the button sits beside the Art. 15 export, not somewhere else", () => {
  /* Art. 7(3) is about effort. A control buried on another screen is not "as
     easy as" a tick-box, and the export button is the established home for
     data rights on the one screen every participant passes through. */
  const html = read(PLATFORM, "index.html");
  const exportAt = html.indexOf('id="gdpr-export-btn"');
  const withdrawAt = html.indexOf('id="gdpr-withdraw-btn"');
  assert.ok(exportAt > 0 && withdrawAt > exportAt,
    "the withdraw button is not in the data-rights row after the export button");
  assert.ok(withdrawAt - exportAt < 1200,
    "the two data-rights controls have drifted apart in the markup");
});
