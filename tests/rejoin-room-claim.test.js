/* tests/rejoin-room-claim.test.js
 *
 * A participant holds one room per session (`roomOf/<uid>`, write-once), and
 * the rules refuse their room writes everywhere else. These tests RUN the
 * client's placement code — maybeSelfAssign(), readRoomClaim()'s caller, and
 * the score-transaction helper — extracted from script.js, against stub refs.
 * The end-to-end proof, with the real rules, is
 * tests-e2e/emulator/rejoin-room-claim.spec.js.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("script.js");

function extract(src, name) {
  const m = src.match(new RegExp("\\nfunction " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("could not extract " + name + " from script.js");
  return m[0];
}
const roomNames = (count) => { const o = []; for (let i = 1; i <= count; i++) o.push("Room " + i); return o; };

/* maybeSelfAssign with every global it touches supplied by the test. Returns
   the room it wrote to pool/<cid>/room (or null if it wrote nothing). */
function runSelfAssign({ poolNow, roomCount, claim, best }) {
  const code = extract(SCRIPT, "claimedRoom") + extract(SCRIPT, "maybeSelfAssign") +
    "\nreturn maybeSelfAssign;";
  let written = null;
  const snap = (v) => ({ val: () => v });
  const env = {
    myRoom: null, selfAssigning: false, started: true, clientId: "cMe",
    pool: poolNow,
    refPool: { once: () => Promise.resolve(snap(poolNow)) },
    refRoomCount: { once: () => Promise.resolve(snap(roomCount)) },
    readRoomClaim: () => Promise.resolve(claim),
    bestRoomFor: () => best,
    refMyPool: { child: () => ({ set: (v) => { written = v; return Promise.resolve(); } }) },
    roomNames, el: () => ({}), tFallback: (k, en) => en, console,
    setTimeout, clearTimeout,
  };
  const names = Object.keys(env);
  const fn = new Function(...names, code)(...names.map((n) => env[n]));
  fn();
  return new Promise((r) => setTimeout(() => r(written), 20));
}

const poolNow = {
  cMe: { name: "Ben", university: "Nagoya", room: null },
  cA: { name: "Ana", university: "Caen", room: "Room 1" },
  cC: { name: "Cleo", university: "Caen", room: "Room 2" },
};

test("a participant who already holds a claim is placed in the claimed room, not where bestRoomFor would put them", async () => {
  const room = await runSelfAssign({ poolNow, roomCount: 2, claim: { room: "Room 2", cid: "cMe" }, best: "Room 1" });
  assert.strictEqual(room, "Room 2");
});

test("ALLOW leg: with no claim, placement is still bestRoomFor's", async () => {
  const room = await runSelfAssign({ poolNow, roomCount: 2, claim: null, best: "Room 1" });
  assert.strictEqual(room, "Room 1");
});

test("a claim naming no room of this session is ignored, not obeyed", async () => {
  for (const claim of [{ room: "Room 7", cid: "cMe" }, { room: 42 }, { cid: "cMe" }, "Room 2"]) {
    const room = await runSelfAssign({ poolNow, roomCount: 2, claim, best: "Room 1" });
    assert.strictEqual(room, "Room 1", JSON.stringify(claim));
  }
});

test("maybeSelfAssign reads the claim in the same round as the pool (not after placing)", () => {
  const fn = extract(SCRIPT, "maybeSelfAssign");
  assert.match(fn, /Promise\.all\(\[refPool\.once\("value"\), refRoomCount\.once\("value"\), readRoomClaim\(\)\]\)/);
});

test("the claim is read at this session's path, for this account only", () => {
  const fn = extract(SCRIPT, "readRoomClaim");
  assert.match(fn, /sPath\("roomOf\/" \+ me\)/);
  assert.match(fn, /currentUser && currentUser\.uid/);
  assert.match(fn, /MODE !== "shared"/, "LOCAL mode has no accounts and no claims");
});

/* ---- after Leave, the next student in the same tab gets a row of their own ---- */

/* ownClientId() with a stub database whose pool row for the tab's id carries
   `existingName` (undefined: no row). Returns the client id afterwards. */
async function runOwnClientId(existingName, typedName) {
  const code = extract(SCRIPT, "ownClientId") +
    "\nreturn { run: ownClientId, id: () => clientId };";
  const env = {
    db: { ref: () => ({ once: () => Promise.resolve({ val: () => existingName }) }) },
    sessionNum: "abc-def", clientId: "cTab", myName: typedName,
    sPath: (p) => "sessions/abc-def/" + p, mintClientId: () => "cFresh",
  };
  const names = Object.keys(env);
  const api = new Function(...names, code)(...names.map((n) => env[n]));
  await api.run();
  return api.id();
}

test("a different name on the tab's existing pool row takes a fresh client id", async () => {
  assert.strictEqual(await runOwnClientId("Ana Leaver", "Zoe Next"), "cFresh",
    "otherwise Zoe's join rewrites Ana's row — her name and her consent record");
});

test("ALLOW leg: the same name keeps the id — the leaver coming back has one row", async () => {
  assert.strictEqual(await runOwnClientId("Zoe Next", "  zoe NEXT "), "cTab");
});

test("no row under the tab's id (a first join, a new tab) keeps the id", async () => {
  assert.strictEqual(await runOwnClientId(null, "Zoe Next"), "cTab");
  assert.strictEqual(await runOwnClientId(undefined, "Zoe Next"), "cTab");
});

test("the join chain checks the row after the membership claim and before the id is bound", () => {
  const fn = extract(SCRIPT, "_joinParticipantAfterAuth");
  const order = ["claimMembership(", "ownClientId()", "claimClientMapping()"].map((s) => fn.indexOf(s));
  assert.ok(order.every((i) => i > -1), "all three are in the chain: " + order);
  assert.ok(order[0] < order[1] && order[1] < order[2],
    "membership first (the read needs it), then the row check, then the clientMapping write");
});

/* ---- a score is announced only once the server has accepted it ---- */

test("scoreTx sends a score transaction with applyLocally = false", () => {
  const scoreTx = new Function(extract(SCRIPT, "scoreTx") + "\nreturn scoreTx;")();
  let args = null;
  const ref = { transaction: (...a) => { args = a; return Promise.resolve({ committed: true }); } };
  const fn = (cur) => cur;
  scoreTx(ref, fn);
  assert.strictEqual(args[0], fn);
  assert.strictEqual(args[1], undefined);
  assert.strictEqual(args[2], false,
    "applied locally, the score listener fires before the server judges the write — " +
    "a refused write then toasted '+3 — First answer written'");
});

/* Every transaction on a score node, in every file that writes one, goes out
   the same way. Derived from the call sites, so a new score write that applies
   locally fails here rather than in a classroom. */
test("no score transaction anywhere applies locally", () => {
  const files = ["script.js", "modA-triage.js", "modA-llm-init.js"];
  let seen = 0;
  for (const f of files) {
    const src = read(f);
    const re = /([A-Za-z_.]*(?:refScore|scoreAuto|scorePenalties)[^\n;]*?)\.transaction\(/g;
    let m;
    while ((m = re.exec(src))) {
      seen++;
      // From the call's opening parenthesis to its matching close.
      let i = m.index + m[0].length, depth = 1;
      while (depth && i < src.length) { const c = src[i++]; if (c === "(") depth++; else if (c === ")") depth--; }
      const call = src.slice(m.index, i);
      assert.match(call, /,\s*undefined,\s*false[\s\S]*\)$/,
        f + ": a score transaction must pass applyLocally = false (or go through scoreTx):\n" + call);
    }
  }
  // scoreTx itself carries the four in checkScoreEvents.
  assert.ok((SCRIPT.match(/scoreTx\(refScore\.child\("(?:auto|penalties)"\)/g) || []).length === 4,
    "the four score writes in checkScoreEvents go through scoreTx");
  assert.ok(seen >= 4, "the triage and chat score writes were found (" + seen + ")");
});
