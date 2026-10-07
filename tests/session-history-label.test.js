"use strict";
/* tests/session-history-label.test.js
 *
 * What a signed-in participant's history row says a session was, and that it
 * can always be stored.
 *
 * THE DEFECT THIS PINS. pushSessionToHistory() stored the session's whole name.
 * Since #275 (2026-08-04) a session picked from several sections is named after
 * all of them, joined with " + ", and the rule on `users/$uid/history/$code`
 * allows `scenarioName` 80 characters. `.validate` refuses the WHOLE entry when
 * one field fails, so the session never reached "Sessions you have joined" —
 * the list that carries the only "Withdraw consent" button a signed-in
 * participant has once a session is over. Nothing surfaced it: the write failed
 * into a console warning, and the LOCAL e2e suite models no rules.
 *
 * It was not a corner case. The assertion "most picks are over the limit"
 * below is here so the size of it stays on record: of the pairs a facilitator
 * can build from the shipped library, more than half produced a name the rule
 * refused.
 *
 * Three things are checked:
 *   1. sectionsLabel() — pure, in the lazy section-registry.js — never returns
 *      more than `max` characters, whatever it is given;
 *   2. what it returns reads sensibly, and is UNCHANGED for every session whose
 *      name already fitted (those entries were always accepted, and should not
 *      start reading differently);
 *   3. the number the client fits to is the number the rule enforces. That
 *      link is the whole fix, and nothing else ties the two files together.
 *
 * The rule itself is exercised against the real emulator in
 * tests-e2e/emulator/session-history.spec.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const REG = require(path.join(P, "section-registry.js"));
const LIB = require(path.join(P, "lib.js"));
const { sectionsLabel } = REG;

/* LF-normalised: a Windows checkout has CRLF, and `.` never matches \r. */
const read = f => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("script.js");
const RULES = JSON.parse(read("database.rules.json")).rules;

/* The shipped section library, loaded the way the browser loads it. */
function loadSections() {
  const win = {};
  ["case-content.js", "branched-seed.js", "mayumi-seed.js"].forEach(f => {
    // eslint-disable-next-line no-new-func
    new Function("window", "self", fs.readFileSync(path.join(P, f), "utf8")).call(win, win, win);
  });
  return REG.buildSectionRegistry(win.CANAMED_SCENARIOS || {});
}
const SECTIONS = loadSections();
const enName = id => {
  assert.ok(SECTIONS[id], id + " must be in the library");
  return LIB.tc(SECTIONS[id].name, "en");
};

/** Body of a named function declaration in script.js, by brace matching. */
function bodyOf(name) {
  const start = SCRIPT.indexOf("function " + name + "(");
  assert.notStrictEqual(start, -1, name + "() must exist");
  let depth = 0, i = SCRIPT.indexOf("{", start);
  const from = i;
  for (; i < SCRIPT.length; i++) {
    if (SCRIPT[i] === "{") depth++;
    else if (SCRIPT[i] === "}") { depth--; if (depth === 0) break; }
  }
  assert.ok(i < SCRIPT.length, name + "() braces must balance");
  return SCRIPT.slice(from, i + 1);
}

/* The limits, read out of the rule rather than typed here. */
const HISTORY_RULE = RULES.users.$uid.history.$code[".validate"];
function ruleLimit(field) {
  const m = HISTORY_RULE.match(
    new RegExp("newData\\.child\\('" + field + "'\\)\\.val\\(\\)\\.length <= (\\d+)"));
  assert.ok(m, "the history rule must bound `" + field + "` by length");
  return Number(m[1]);
}
const NAME_MAX = ruleLimit("scenarioName");

const hasLoneSurrogate = s => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xDC00 && d <= 0xDFFF)) return true;
      i++;
    } else if (c >= 0xDC00 && c <= 0xDFFF) return true;
  }
  return false;
};

/* ── 1. one name ─────────────────────────────────────────────────────────── */

test("a name of exactly the limit is stored whole", () => {
  const name = "n".repeat(NAME_MAX);
  assert.strictEqual(sectionsLabel([name], NAME_MAX), name);
});

test("a name one character over is cut to the limit and says so", () => {
  const name = "abcdefghij".repeat(8) + "Z";                 // 81
  assert.strictEqual(name.length, NAME_MAX + 1);
  const out = sectionsLabel([name], NAME_MAX);
  assert.strictEqual(out.length, NAME_MAX, "it uses the room it has");
  assert.strictEqual(out, name.slice(0, NAME_MAX - 1) + "…",
    "a cut name ends in an ellipsis — a silent slice reads as the real title");
});

test("an authored scenario's name may be 200 characters; it still fits", () => {
  /* `scenarios/$uid/$id/meta/name` is bounded at 200, so ONE authored section
     was enough to lose the entry — several sections were never required. */
  const out = sectionsLabel(["A very long authored title ".repeat(8).trim()], NAME_MAX);
  assert.ok(out.length <= NAME_MAX);
  assert.match(out, /…$/);
});

test("a cut never ends on a space before the ellipsis", () => {
  const name = "x".repeat(NAME_MAX - 2) + " yyyyyyyy";       // the cut lands after the space
  const out = sectionsLabel([name], NAME_MAX);
  assert.strictEqual(out, "x".repeat(NAME_MAX - 2) + "…");
});

test("nothing to name is an empty label, not a crash", () => {
  [[], [""], [null, undefined], ["   "], null, undefined].forEach(input => {
    assert.strictEqual(sectionsLabel(input, NAME_MAX), "", JSON.stringify(input));
  });
});

/* ── 2. several sections ─────────────────────────────────────────────────── */

test("names that fit together are joined exactly as the lobby shows them", () => {
  const a = "a".repeat(38), b = "b".repeat(39);              // 38 + 3 + 39 = 80
  assert.strictEqual(sectionsLabel([a, b], NAME_MAX), a + " + " + b);
  assert.strictEqual((a + " + " + b).length, NAME_MAX);
});

test("one character more and the second name gives way to a count", () => {
  const a = "a".repeat(38), b = "b".repeat(40);              // 81 joined
  assert.strictEqual(sectionsLabel([a, b], NAME_MAX), a + " + 1 more");
});

test("a joined name that fits is stored whole, even when a count after it would not fit", () => {
  /* The loop keeps a name only if the "+ N more" that might follow it still
     fits. With a short LAST name that refused the name before it — although
     nothing is left to count once the last one is in. So a join of 80 or
     under, which the rule accepts and which was stored whole before this
     change, came back shortened. Found by the independent review of #441. */
  const a = "a".repeat(75);
  assert.strictEqual(sectionsLabel([a, "BB"], NAME_MAX), a + " + BB");            // 80
  const b = "a".repeat(72);
  assert.strictEqual(sectionsLabel([b, "Quiz"], NAME_MAX), b + " + Quiz");        // 79
  const c = ["a".repeat(30), "b".repeat(41), "CCC"];
  assert.strictEqual(c.join(" + ").length, NAME_MAX);
  assert.strictEqual(sectionsLabel(c, NAME_MAX), c.join(" + "));
});

test("as many whole names as fit are kept, in pick order, then the rest are counted", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta"];
  assert.strictEqual(sectionsLabel(names, 80), "Alpha + Bravo + Charlie + Delta");
  assert.strictEqual(sectionsLabel(names, 25), "Alpha + Bravo + 2 more");
  assert.strictEqual(sectionsLabel(names, 14), "Alpha + 3 more");
  /* A name is never kept if the count that must follow it would not fit: the
     label always accounts for every section. */
  assert.strictEqual(sectionsLabel(names, 22), "Alpha + Bravo + 2 more");
  assert.strictEqual(sectionsLabel(names, 21), "Alpha + 3 more");
});

test("when even the first name is too long it is cut, and the count is kept", () => {
  const out = sectionsLabel(["F".repeat(200), "second", "third"], NAME_MAX);
  assert.strictEqual(out.length, NAME_MAX);
  assert.match(out, /^F+… \+ 2 more$/);
});

test("empty names are not counted as sections", () => {
  assert.strictEqual(sectionsLabel(["Alpha", "", null, "Bravo"], 80), "Alpha + Bravo");
});

/* ── the shipped library ─────────────────────────────────────────────────── */

test("the six-part Mayumi session reads as its first part and five more", () => {
  const six = [1, 2, 3, 4, 5, 6].map(n => enName("mayumi-" + n + "-pbl"));
  assert.ok(six.join(" + ").length > 250, "the premise: the joined name is far over the limit");
  const out = sectionsLabel(six, NAME_MAX);
  assert.strictEqual(out, six[0] + " + 5 more");
  assert.ok(out.length <= NAME_MAX);
});

test("both halves of the sore-throat case — a built-in pair that was refused", () => {
  const pair = [enName("sore-throat-pbl"), enName("sore-throat-roleplay")];
  assert.ok(pair.join(" + ").length > NAME_MAX, "the premise: this pair is over the limit");
  assert.strictEqual(sectionsLabel(pair, NAME_MAX), pair[0] + " + 1 more");
});

test("a session whose name already fitted reads exactly as it did before", () => {
  const pair = [enName("chronic-pain-pbl"), enName("chronic-pain-roleplay")];
  const joined = pair.join(" + ");
  assert.ok(joined.length <= NAME_MAX, "the premise: this pair fits");
  assert.strictEqual(sectionsLabel(pair, NAME_MAX), joined);
});

test("every pick from the shipped library fits, and most were over the limit before", () => {
  const ids = Object.keys(SECTIONS);
  assert.ok(ids.length >= 13, "the library must have loaded");
  let over = 0, total = 0;
  const check = picked => {
    const names = picked.map(enName);
    const joined = names.join(" + ");
    const out = sectionsLabel(names, NAME_MAX);
    assert.ok(out.length <= NAME_MAX, picked.join(",") + " -> " + out.length);
    assert.ok(out.startsWith(names[0].slice(0, 20)), "it starts with the first section");
    if (joined.length <= NAME_MAX) {
      assert.strictEqual(out, joined, "a name that fits is not rewritten: " + picked.join(","));
    } else {
      assert.match(out, / \+ \d+ more$/, picked.join(","));
      over++;
    }
    total++;
  };
  ids.forEach(a => check([a]));
  const singles = total;
  assert.strictEqual(over, 0, "no single shipped section is over the limit on its own");
  ids.forEach(a => ids.forEach(b => { if (a !== b) check([a, b]); }));
  /* Recorded, not incidental: this is how common the refused entry was. */
  assert.ok(over > (total - singles) / 2,
    "more than half of the two-section picks used to be refused (" + over + " of " + (total - singles) + ")");
  // Longer picks: every run of consecutive sections, up to the slot cap.
  for (let from = 0; from < ids.length; from++) {
    for (let n = 3; n <= 8 && from + n <= ids.length; n++) check(ids.slice(from, from + n));
  }
});

/* ── the bound holds by construction ─────────────────────────────────────── */

test("the result never exceeds max, for any input and any max", () => {
  /* A small deterministic generator: the failures must be reproducible. */
  let seed = 20261007;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ["a", "B", " ", "-", "é", "—", "子", String.fromCodePoint(0x1F600), "+"];
  for (let run = 0; run < 4000; run++) {
    const names = [];
    for (let i = rnd(10); i > 0; i--) {
      let s = "";
      for (let j = rnd(130); j > 0; j--) s += alphabet[rnd(alphabet.length)];
      names.push(s);
    }
    const max = rnd(140);
    const out = sectionsLabel(names, max);
    assert.strictEqual(typeof out, "string");
    assert.ok(out.length <= max,
      "max " + max + " exceeded (" + out.length + ") for " + JSON.stringify(names));
  }
});

test("a cut never leaves half of a surrogate pair", () => {
  /* An astral character is TWO UTF-16 units. Cutting between them stores an
     unpaired surrogate, which is not valid text and which a JSON round-trip
     through the database may replace or refuse. */
  const face = String.fromCodePoint(0x1F600);
  for (let lead = 0; lead < 6; lead++) {
    const name = "x".repeat(lead) + face.repeat(60);
    [[name], [name, "second"], [name, "second", "third"]].forEach(names => {
      const out = sectionsLabel(names, NAME_MAX);
      assert.ok(out.length <= NAME_MAX);
      assert.strictEqual(hasLoneSurrogate(out), false, "lead " + lead + ": " + JSON.stringify(out));
    });
  }
});

/* ── 3. the client fits to the number the rule enforces ──────────────────── */

test("both history names are bounded by the rule at one and the same limit", () => {
  assert.strictEqual(ruleLimit("workshopName"), NAME_MAX,
    "the client fits both names with one number; if the rule ever gives them " +
    "different limits, pushSessionToHistory() must fit each to its own");
});

test("pushSessionToHistory fits both names to the rule's limit before writing", () => {
  const body = bodyOf("pushSessionToHistory");
  const calls = [...body.matchAll(/sectionsLabel\(\s*[^,()]+,\s*(\d+)\s*\)/g)];
  assert.ok(calls.length >= 1, "the write must go through sectionsLabel()");
  calls.forEach(m => assert.strictEqual(Number(m[1]), NAME_MAX,
    "sectionsLabel() must be given the limit database.rules.json enforces (" +
    NAME_MAX + "), not " + m[1]));

  /* BOTH fields, and by the fitted value itself: a field assigned the raw name
     beside a fitted copy nobody uses would satisfy a looser check. */
  const write = body.slice(body.indexOf("db.ref("));
  assert.match(write, /workshopName:\s*fit\(\[CFG\.workshopName\]\)/,
    "workshopName must be the deployment's own name, fitted — not an empty or unrelated value");
  assert.match(write, /scenarioName:\s*fit\(/, "scenarioName must be the fitted value");
  assert.doesNotMatch(write, /scenarioName:\s*tc\(/,
    "the session's whole name must not be written as it stands — that is the defect");
});

/* `fit` is the two-line arrow inside pushSessionToHistory(). It is lifted out
   of the source and RUN here, both ways: with sectionsLabel() in scope, and
   without it — the state the page is in when section-registry.js failed to
   load, which the loader swallows by design and nothing else exercises. */
function liftFit(withHelper) {
  const m = bodyOf("pushSessionToHistory").match(/const fit = ([\s\S]*?);\n/);
  assert.ok(m, "pushSessionToHistory must define `fit`");
  // eslint-disable-next-line no-new-func
  return withHelper
    ? new Function("sectionsLabel", "return (" + m[1] + ");")(sectionsLabel)
    : new Function("return (" + m[1] + ");")();
}

test("with the section library loaded, the write site stores what sectionsLabel() returns", () => {
  const fit = liftFit(true);
  const six = [1, 2, 3, 4, 5, 6].map(n => enName("mayumi-" + n + "-pbl"));
  assert.strictEqual(fit(six), sectionsLabel(six, NAME_MAX));
  assert.strictEqual(fit(["CaNaMED Session 3"]), "CaNaMED Session 3");
  assert.strictEqual(fit([undefined]), "", "a deployment with no workshop name stores an empty one");
});

test("without the section library the names are still stored, and still fit", () => {
  /* Unnamed entries were the first draft of this fallback. A rejoin REPLACES
     the node, so a single failed chunk load would have blanked a name that had
     been stored correctly — an independent review caught that. */
  const fit = liftFit(false);
  assert.strictEqual(fit(["CaNaMED Session 3"]), "CaNaMED Session 3");
  assert.strictEqual(fit(["Alpha", "Bravo"]), "Alpha + Bravo");
  assert.strictEqual(fit([undefined]), "");
  const long = fit(["x".repeat(NAME_MAX + 40)]);
  assert.strictEqual(long.length, NAME_MAX, "the fallback is clamped to the rule's limit too");
  const six = [1, 2, 3, 4, 5, 6].map(n => enName("mayumi-" + n + "-pbl"));
  assert.ok(fit(six).length <= NAME_MAX);
  assert.ok(fit(six).startsWith(six[0]), "and it still starts with the first section");
});

/* The list of names handed to `fit` for scenarioName, lifted out of the source
   and RUN. With no pick — every single-scenario session, and any session whose
   pick does not resolve — the name is the scenario's own. Nothing ran that
   branch: replacing it with an empty object blanked the stored name of all
   such sessions and passed every test (independent review of #441). */
function liftScenarioNames(pick, scenarioName) {
  const m = bodyOf("pushSessionToHistory").match(/scenarioName:\s*fit\(([\s\S]*?)\),\s*\n\s*joinedAt/);
  assert.ok(m, "pushSessionToHistory must write scenarioName: fit(<names>) just before joinedAt");
  const tc = (v, lang) => (v && typeof v === "object" ? v[lang] : v);
  // eslint-disable-next-line no-new-func
  return new Function("pickedSections", "tc", "window", "return (" + m[1] + ");")(
    () => pick, tc, { CURRENT_SCENARIO_NAME: scenarioName });
}

test("a session with no pick is named after its scenario, as it was before", () => {
  assert.deepStrictEqual(liftScenarioNames(null, "Chronic Pain & the clinical case"),
    ["Chronic Pain & the clinical case"]);
  assert.deepStrictEqual(liftScenarioNames(null, { en: "Sore throat", fr: "Mal de gorge" }), ["Sore throat"]);
  /* ...and with a pick, after its sections, in order, in English. */
  assert.deepStrictEqual(
    liftScenarioNames([{ name: { en: "Alpha", fr: "Alfa" } }, { name: "Bravo" }], "ignored"),
    ["Alpha", "Bravo"]);
});

test("the fallback is clamped to the same limit as the rule", () => {
  const body = bodyOf("pushSessionToHistory");
  const clamps = [...body.matchAll(/\.slice\(0,\s*(\d+)\)/g)];
  assert.ok(clamps.length >= 1, "the no-library fallback must clamp");
  clamps.forEach(m => assert.strictEqual(Number(m[1]), NAME_MAX));
});

test("the names are fitted from the picked SECTIONS, not by splitting the joined name", () => {
  /* The joined name cannot be taken apart again: a section title may itself
     contain " + ". The pick is the only reliable list. */
  const body = bodyOf("pushSessionToHistory");
  assert.match(body, /pickedSections\(\)/);
  assert.doesNotMatch(body, /\.split\(/);
});

test("a session code can never be the field that is too long", () => {
  const codeMax = ruleLimit("code");
  const longest = LIB.sanitizeCode("a".repeat(500));
  assert.ok(longest.length <= codeMax,
    "sanitizeCode() yields at most " + longest.length + " characters; the rule allows " + codeMax);
});

test("a history write that fails is recorded, without the uid or the session code", () => {
  const body = bodyOf("pushSessionToHistory");
  const rec = body.match(/CanamedTelemetry\.record\(([^;]*)\)\s*;/);
  assert.ok(rec, "a failed write must reach the telemetry buffer, not only the console");
  /* The buffer is downloadable by a facilitator: what failed, never whose. The
     payload is pinned WHOLE — one key, the error's own code — because a
     deny-list of names (uid, path, code…) cannot see a field it did not think
     of, such as `s: sessionNum`. */
  assert.match(rec[1], /^\s*"history-write-failed",\s*\{\s*code:\s*String\(e && e\.code\)\s*\}\s*$/,
    "the record must carry the kind and the error's code, and nothing else");
});
