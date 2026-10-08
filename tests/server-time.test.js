/* tests/server-time.test.js
 *
 * Every date the client stores in the database is taken from the SERVER's
 * clock, not the device's.
 *
 * database.rules.json compares a client-supplied date with the server's `now`
 * in about a hundred places — 92 of them allow five seconds of lead and no
 * more, and most have a floor as well (two minutes for the join, thirty for an
 * answer). The client used to send Date.now(). A participant whose laptop was a
 * minute fast was therefore refused the join, the answers, the votes and the
 * withdrawal, with a permission-denied in the console as the only trace; and
 * `created` / `closed`, which the retention clock runs from, were as wrong as
 * the facilitator's laptop.
 *
 * The client now uses serverNow() (lib.js): the device clock plus the offset
 * the database publishes at .info/serverTimeOffset. What this file holds:
 *
 *   1. the helper itself;
 *   2. where the offset comes from, and that LOCAL mode never asks for it;
 *   3. THE INVENTORY — every read of the device clock left in the client is
 *      listed below with what it is for. A new one fails the suite until it is
 *      classified, which is the point: the rule that refuses a device-clock
 *      date is evaluated on the server, so nothing local would otherwise say;
 *   4. the dated FIELDS, derived from the rules rather than listed by hand: a
 *      rule that mentions `now` names a field, and a client write to a field of
 *      that name may not be fed from the device clock, even through a variable;
 *   5. the chunks that load later than the shell, which must still run on a
 *      shell cached before serverNow() existed.
 *
 * None of this evaluates a rule. tests-e2e/emulator/device-clock.spec.js does:
 * it runs the real client with the page's clock an hour, and thirteen hours,
 * wrong in each direction.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
/* LF at the read site: this checkout may be CRLF, and `.` never matches a CR. */
const read = (...p) => fs.readFileSync(path.join(PLATFORM, ...p), "utf8").replace(/\r\n/g, "\n");

/* A fresh copy each time: the offset is module state, and one test must not
   leave it set for the next. */
function freshLib() {
  const file = path.join(PLATFORM, "lib.js");
  delete require.cache[require.resolve(file)];
  return require(file);
}

/* ── 1. the helper ─────────────────────────────────────────────────────── */

test("serverNow() is the device clock until an offset is known — LOCAL mode, unchanged", () => {
  const lib = freshLib();
  const before = Date.now();
  const got = lib.serverNow();
  assert.ok(got >= before && got <= Date.now(), "with no offset, serverNow() must be Date.now()");
  assert.strictEqual(typeof got, "number", "a number, never the SDK's placeholder object: LocalDB stores what it is given");
});

test("serverNow() adds the offset the database publishes, in either direction", () => {
  const HOUR = 3600000;
  for (const offset of [HOUR, -HOUR, 13 * HOUR, -13 * HOUR, 250, -250]) {
    const lib = freshLib();
    lib.setServerOffset(offset);
    const before = Date.now();
    const got = lib.serverNow();
    assert.ok(got >= before + offset && got <= Date.now() + offset,
      `offset ${offset}: serverNow() must be the device clock plus the offset`);
  }
});

test("a value that is not a finite number never becomes the offset", () => {
  /* The SDK reports null until the first connection. Adopting it — or a
     string, or NaN — would turn every stored date into NaN, which the rules
     refuse (isNumber) and which sorts nowhere. */
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, "3600000", {}, [], true]) {
    const lib = freshLib();
    lib.setServerOffset(5000);
    lib.setServerOffset(bad);
    const before = Date.now();
    const got = lib.serverNow();
    assert.ok(got >= before + 5000 && got <= Date.now() + 5000,
      `setServerOffset(${String(bad)}) must leave the last known offset in place`);
  }
});

test("a later offset replaces an earlier one (the SDK re-measures on every reconnect)", () => {
  const lib = freshLib();
  lib.setServerOffset(60000);
  lib.setServerOffset(-60000);
  const before = Date.now();
  assert.ok(lib.serverNow() <= before - 60000 + 50, "the second offset must be the one in force");
  lib.setServerOffset(0);
  assert.ok(Math.abs(lib.serverNow() - Date.now()) < 50, "and zero is a value, not a missing one");
});

/* ── 2. where the offset comes from ────────────────────────────────────── */

const SCRIPT = read("script.js");

function dbInitBody() {
  const start = SCRIPT.indexOf("\nfunction dbInit() {");
  assert.ok(start >= 0, "script.js no longer has dbInit()");
  const end = SCRIPT.indexOf("\n}\n", start);
  return SCRIPT.slice(start, end);
}

test("the page subscribes to the server's clock offset, in shared mode only", () => {
  const body = dbInitBody();
  const shared = body.indexOf('if (MODE === "shared") {');
  const local = body.indexOf("db = new LocalDB();");
  const sub = body.indexOf('.ref(".info/serverTimeOffset")');
  assert.ok(shared >= 0 && local > shared, "dbInit() no longer has its shared / LOCAL branches where this test looks");
  assert.ok(sub > shared && sub < local,
    "the subscription must sit in the SHARED branch: LocalDB has no .info and no server");
  assert.ok(sub > body.indexOf("db = firebase.database();"),
    "and after the database handle exists");
  assert.strictEqual(SCRIPT.split(".info/serverTimeOffset").length - 1, 1,
    "one subscription, in dbInit(): a second writer of the offset is a second clock");
});

test("that subscription feeds serverNow(): null is ignored, a number is adopted", () => {
  /* The statement itself, lifted from script.js and run against a stand-in
     database — so what is tested is the line that ships. */
  const m = dbInitBody().match(/db\.ref\("\.info\/serverTimeOffset"\)\.on\("value", [^\n]*?\)\);/);
  assert.ok(m, "could not lift the subscription statement out of dbInit()");
  const lib = freshLib();
  let listener = null;
  const db = { ref: (p) => ({ on: (ev, cb) => { listener = { p, ev, cb }; } }) };
  new Function("db", "setServerOffset", m[0])(db, lib.setServerOffset);
  assert.deepStrictEqual([listener.p, listener.ev], [".info/serverTimeOffset", "value"]);

  listener.cb({ val: () => null });            // before the first connection
  assert.ok(Math.abs(lib.serverNow() - Date.now()) < 50, "null must leave the clock alone");
  listener.cb({ val: () => -3600000 });        // a device one hour fast
  const before = Date.now();
  assert.ok(lib.serverNow() <= before - 3600000 + 50, "the published offset must be applied");
});

test("the scenario editor is a page of its own and keeps its own offset", () => {
  /* scenario-author.html loads neither lib.js nor script.js, and `updatedAt`
     has the same five-second lead as everything else. */
  const src = read("scenario-author-cloud.js");
  assert.ok(src.includes('db.ref(".info/serverTimeOffset").on("value"'),
    "scenario-author-cloud.js must subscribe to the server's clock offset");
  assert.ok(/var now = Date\.now\(\) \+ serverOffset;/.test(src),
    "and date a save with it");
  assert.ok(!/<script[^>]+src="(?:\/)?lib\.js/.test(read("scenario-author.html")),
    "scenario-author.html now loads lib.js: use its serverNow() and drop the page's own offset");
});

/* ── 3. the inventory ──────────────────────────────────────────────────── */

const VENDORED = new Set(["pdfmake.min.js", "purify.min.js", "qrcode.js", "vfs_fonts.js"]);
const CLIENT_FILES = fs.readdirSync(PLATFORM)
  .filter((f) => f.endsWith(".js") && !VENDORED.has(f))
  .sort();

/* A read of the device's clock as a NUMBER. `new Date().toISOString()` and
   friends — a label on an exported file, a line in the local error log — are
   not dates the rules see, and are deliberately not matched. */
const DEVICE_CLOCK = /Date\.now\b|new Date\(\s*\)\s*\.\s*(?:getTime|valueOf)\b|(?:^|[=(,:?&|!~{[;]|return)\s*\+\s*new Date\b|Number\(\s*new Date\b/;

function codeLines(file) {
  const out = [];
  let inBlock = false;
  read(file).split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    /* Block comments opened on this line. Good enough for these files: none
       has a slash-star inside a string on a line that also reads the clock —
       and a line wrongly KEPT only costs an entry in the inventory. */
    for (;;) {
      const open = line.indexOf("/*");
      if (open < 0) break;
      const close = line.indexOf("*/", open + 2);
      if (close < 0) { line = line.slice(0, open); inBlock = true; break; }
      line = line.slice(0, open) + line.slice(close + 2);
    }
    const t = line.trim();
    if (!t || t.startsWith("//")) return;
    out.push({ n: i + 1, text: t });
  });
  return out;
}

/* Every device-clock read the client is allowed to keep. `has` is a fragment of
   the line; `n` how many lines carry it.
   Adding an entry is a claim that the value is never stored in the database
   and never compared with a stored date. If it is, use serverNow(). */
const DEVICE_CLOCK_ALLOWED = {
  "lib.js": [
    { has: "function serverNow() { return Date.now() + serverOffset; }", n: 1,
      why: "the helper: the one place the device clock becomes the server's" }
  ],
  "scenario-author-cloud.js": [
    { has: "var now = Date.now() + serverOffset;", n: 1,
      why: "the scenario editor's own serverNow(): that page loads neither lib.js nor script.js" }
  ],
  "script.js": [
    { has: "firebase.database.ServerValue.TIMESTAMP) || Date.now();", n: 1,
      why: "the fallback of the password reset's placeholder (R3-D1), reached only without the SDK" },
    { has: "{ updatedAt: Date.now() }", n: 1,
      why: "saveLastWorkshop(): this browser's own localStorage, never the database" },
    { has: "openedAt: Date.now()", n: 1,
      why: "the list of sessions this browser created: localStorage" },
    { has: "const dMs = Date.now() - ms;", n: 1,
      why: "'Opened 2 h ago' for that list: a localStorage date against the clock that wrote it" }
  ],
  "script-admin.js": [
    { has: "window.serverNow = function () { return Date.now(); };", n: 1,
      why: "the old-shell fallback (section 5)" },
    { has: "firebase.database.ServerValue.TIMESTAMP) || Date.now();", n: 1,
      why: "the fallback of the password reset's placeholder (R3-D1)" },
    { has: "seen.lastSeenAt", n: 2,
      why: "how long ago THIS dashboard last saw a participant: both ends are this device's clock" },
    { has: "const now = Date.now();", n: 1,
      why: "renderPrestart(): stamps lastSeenAt, the other end of the line above" }
  ],
  "modA-llm-init.js": [
    { has: "window.serverNow = function () { return Date.now(); };", n: 1,
      why: "the old-shell fallback (section 5)" },
    { has: "startedAt: Date.now(), hintAfter:", n: 1,
      why: "when this device began waiting for a reply: a duration, never stored" },
    { has: "var ms = Date.now() - w.startedAt;", n: 1,
      why: "the other end of that duration" }
  ],
  "modA-triage.js": [
    { has: "window.serverNow = function () { return Date.now(); };", n: 1,
      why: "the old-shell fallback (section 5)" }
  ],
  "takehome.js": [
    { has: "window.serverNow = function () { return Date.now(); };", n: 1,
      why: "the old-shell fallback (section 5)" }
  ],
  "pure-utils.js": [
    { has: "return Math.floor((Date.now() - ts) / 60000);", n: 1,
      why: "minsSince(): no caller in the app since the dashboard counts from the server's clock " +
           "(minsSinceStored). Left in place: the file is the verify page's too, with a version of its own" }
  ],
  "localdb.js": [
    { has: '"-" + Date.now().toString(36)', n: 1, why: "a push key for LOCAL mode, not a date" }
  ],
  "healthcheck.js": [
    { has: 'var token = "hc-" + Date.now();', n: 2, why: "a throwaway token for the operator's check, not a date" }
  ]
};

test("every read of the device clock left in the client is accounted for", () => {
  const unlisted = [];
  const miscounted = [];
  for (const file of CLIENT_FILES) {
    const allowed = (DEVICE_CLOCK_ALLOWED[file] || []).map((a) => Object.assign({ seen: 0 }, a));
    for (const line of codeLines(file)) {
      if (!DEVICE_CLOCK.test(line.text)) continue;
      const hit = allowed.find((a) => line.text.includes(a.has));
      if (hit) hit.seen++;
      else unlisted.push(`${file}:${line.n}  ${line.text.slice(0, 110)}`);
    }
    for (const a of allowed) {
      if (a.seen !== a.n) miscounted.push(`${file}: "${a.has}" — expected ${a.n}, found ${a.seen}`);
    }
  }
  for (const file of Object.keys(DEVICE_CLOCK_ALLOWED)) {
    assert.ok(CLIENT_FILES.includes(file), `the inventory names ${file}, which is not a client file any more`);
  }
  assert.deepStrictEqual(unlisted, [],
    "The device clock is read here, and the line is not in the inventory.\n" +
    "If the value is stored in the database, or compared with a date that was, use serverNow() " +
    "(lib.js): the rules refuse a date more than 5 s ahead of the server, so a participant whose " +
    "clock is a minute fast would be refused this write and never told.\n" +
    "If it is a duration, a throttle, a key or localStorage bookkeeping, add it to " +
    "DEVICE_CLOCK_ALLOWED with the reason.\n" + unlisted.join("\n"));
  assert.deepStrictEqual(miscounted, [],
    "The inventory no longer matches the code. Re-read each site before changing a count.\n" +
    miscounted.join("\n"));
});

test("the inventory can see a device-clock date — the patterns it must catch", () => {
  /* Without this the test above passes on a scanner that matches nothing. */
  for (const bad of [
    "const payload = { at: Date.now() };",
    "ref.set({ at: new Date().getTime() });",
    "const at = +new Date();",
    "return +new Date;",
    "x = Number(new Date());",
    "const clock = Date.now;",
    "at: new Date().valueOf()"
  ]) assert.ok(DEVICE_CLOCK.test(bad), "not recognised as a device-clock read: " + bad);
  for (const fine of [
    'lines.push("Generated: " + new Date().toISOString());',
    "const when = new Date();",
    "const d = new Date(entry.at);",
    "return serverNow() - at;"
  ]) assert.ok(!DEVICE_CLOCK.test(fine), "wrongly flagged: " + fine);
});

test("the placeholder stays where it was: nothing else hands the database an object for a date", () => {
  /* firebase.database.ServerValue.TIMESTAMP is exact, and is right for the
     password reset (R3-D1). It is also an OBJECT until the server replaces it:
     LocalDB would store { ".sv": "timestamp" } as the date, and a site that
     reads back, sorts by or subtracts what it wrote would get NaN. serverNow()
     is a number in both modes, which is why the other sixty sites use it. */
  const users = CLIENT_FILES.filter((f) => codeLines(f).some((l) => l.text.includes("ServerValue")));
  assert.deepStrictEqual(users, ["script-admin.js", "script.js"],
    "ServerValue is used somewhere new. If it dates a payload, use serverNow() instead.");
});

/* ── 4. the dated fields, derived from the rules ───────────────────────── */

const RULES = JSON.parse(read("database.rules.json")).rules;

/* Every field a rule compares with the server's clock: the last child() of the
   operand, or the node the rule sits on when the operand is the node itself. */
function datedFields() {
  const fields = new Map();   // name -> number of bounds
  let upperFiveSeconds = 0;
  const cmp = /(?:newData|data|root)((?:\.child\((?:'[^']+'|\$[A-Za-z]+)\))*)\.val\(\)\s*(<=|>=)\s*now\s*([+-])\s*(\d+)/g;
  (function walk(node, key) {
    if (node === null || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v !== "string") { walk(v, k); continue; }
      let m;
      cmp.lastIndex = 0;
      while ((m = cmp.exec(v))) {
        const kids = m[1].match(/'([^']+)'/g) || [];
        const name = kids.length ? kids[kids.length - 1].slice(1, -1) : key;
        fields.set(name, (fields.get(name) || 0) + 1);
        if (m[2] === "<=" && m[3] === "+" && m[4] === "5000") upperFiveSeconds++;
      }
    }
  })(RULES, null);
  return { fields, upperFiveSeconds };
}

test("the rules bound a known set of fields against the server clock", () => {
  const { fields, upperFiveSeconds } = datedFields();
  /* Not an exact list: a new dated field is welcome, and is covered below
     without touching this file. These are here so that a derivation that has
     stopped finding anything fails loudly instead of covering nothing. */
  for (const name of ["at", "stageAt", "startedAt", "completedAt", "updatedAt"]) {
    assert.ok(fields.has(name), `the derivation no longer finds '${name}' — has the rules' syntax changed?`);
  }
  assert.ok(upperFiveSeconds >= 50,
    `only ${upperFiveSeconds} five-second upper bounds found; there were 92 when this was written`);
  const allNow = (read("database.rules.json").match(/\bnow\b/g) || []).length;
  const parsed = [...fields.values()].reduce((a, b) => a + b, 0);
  assert.strictEqual(parsed, allNow,
    `the rules mention \`now\` ${allNow} times and the derivation accounts for ${parsed}: ` +
    "a rule compares a date with the clock in a shape this test does not read");
});

test("no client write to a dated field is fed from the device clock, even through a variable", () => {
  /* The inventory counts the device-clock reads; it cannot tell where one
     goes. This can: `at: now` is traced back to the nearest assignment of
     `now` above it — the help call's date is its throttle's `now`, and
     both have to be the server's. */
  const names = [...datedFields().fields.keys()].filter((n) => /^[A-Za-z_]\w*$/.test(n));
  const prop = new RegExp("(?:^|[{,(\\s])(" + names.join("|") + ")\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*(?=[,})]|$)");
  const offenders = [];
  let traced = 0;
  for (const file of CLIENT_FILES) {
    const lines = codeLines(file);
    lines.forEach((line, i) => {
      const m = prop.exec(line.text);
      if (!m) return;
      const ident = m[2];
      if (/^(?:true|false|null|undefined)$/.test(ident)) return;
      const assign = new RegExp("(?:^|[\\s;(,])(?:const |let |var )?" + ident + "\\s*=(?!=)\\s*(.+)$");
      for (let j = i - 1; j >= Math.max(0, i - 80); j--) {
        const a = assign.exec(lines[j].text);
        if (!a) continue;
        traced++;
        if (DEVICE_CLOCK.test(a[1]) && !/\+\s*serverOffset\b/.test(a[1])) {
          offenders.push(`${file}:${line.n}  \`${m[1]}: ${ident}\` — and ${ident} is the device clock (line ${lines[j].n})`);
        }
        break;
      }
    });
  }
  assert.ok(traced >= 4,
    `only ${traced} dated fields were traced to a variable; createSession()'s \`at: at\` and the ` +
    "scenario save's `updatedAt: now` alone should give more — the trace has stopped working");
  assert.deepStrictEqual(offenders, [],
    "A date the rules compare with the server's clock is taken from the device's:\n" + offenders.join("\n"));
});

test("a stored date is compared with the server's clock, not the device's", () => {
  /* The other half. `stageAt`, a help call's `at`, a chat turn's `at` and the
     facilitator heartbeat were written by ANOTHER device, on the server's
     clock. Counted from this device's, "minutes on this stage" is off by this
     device's error, and a reply is not "new" for as long as this clock is
     ahead. */
  const admin = read("script-admin.js");
  const fn = admin.match(/function minsSinceStored\(ts\) \{\n[^\n]+\n\}/);
  assert.ok(fn, "script-admin.js no longer has minsSinceStored()");
  const at = 10 * 60000 + 5;
  const minsSinceStored = new Function("serverNow", fn[0] + "\nreturn minsSinceStored;")(() => at);
  assert.strictEqual(minsSinceStored(60000), 9, "nine whole minutes on the server's clock");
  assert.strictEqual(minsSinceStored(0), null);
  assert.strictEqual(minsSinceStored(undefined), null);

  const calls = (file, re) => codeLines(file).filter((l) => re.test(l.text)).map((l) => l.n + ": " + l.text);
  for (const file of ["script.js", "script-admin.js"]) {
    assert.deepStrictEqual(calls(file, /(?:^|[^.\w])minsSince\(/), [],
      file + " counts minutes from the device clock again: use minsSinceStored() for a stored date");
  }
  assert.ok(calls("script-admin.js", /minsSinceStored\(/).length >= 4,
    "the dashboard's stage and help-call timers should all go through minsSinceStored()");
  assert.ok(/var initStartedAt = serverNow\(\);/.test(read("modA-llm-init.js")),
    "the chat decides whether a reply is new by comparing its stored date with the moment the " +
    "panel opened: both must be on the server's clock");
  assert.ok(/\(serverNow\(\) - at\) > FACILITATOR_STALE_MS/.test(SCRIPT),
    "the 'facilitator may be offline' banner compares a stored heartbeat with now");
});

/* ── 5. chunks that load after the shell ───────────────────────────────── */

test("a chunk that is not in the shell's eager set defines serverNow() if the shell did not", () => {
  /* After a deploy, a page that was already open — or was served the old shell
     from cache and is past the splash, so it is not reloaded — asks for its
     lazy chunks from the network and gets the NEW ones. Its lib.js is the old
     one. Without this line every dated write in the chunk would throw
     `serverNow is not defined`: the dashboard could not close the session, and
     the chat would not start. With it, such a page dates its writes from the
     device clock, exactly as it did before. */
  const eager = new Set((read("index.html").match(/<script[^>]+src="\/([^"?]+\.js)\?v=v\d+"/g) || [])
    .map((tag) => /src="\/([^"?]+)/.exec(tag)[1]));
  assert.ok(eager.has("lib.js") && eager.has("script.js"),
    "could not read the eager script list out of index.html");
  const SHIM = 'if (typeof serverNow !== "function") window.serverNow = function () { return Date.now(); };';
  const lazyUsers = CLIENT_FILES.filter((f) => !eager.has(f) &&
    codeLines(f).some((l) => /\bserverNow\(\)/.test(l.text) && !l.text.includes(SHIM)));
  assert.ok(lazyUsers.includes("script-admin.js") && lazyUsers.includes("modA-llm-init.js"),
    "expected the dashboard and the chat among the lazy chunks that date a write");
  for (const file of lazyUsers) {
    const lines = codeLines(file);
    const shimAt = lines.findIndex((l) => l.text.includes(SHIM));
    const firstUse = lines.findIndex((l) => /\bserverNow\(\)/.test(l.text) && !l.text.includes(SHIM));
    assert.ok(shimAt >= 0, `${file} calls serverNow() but is not in the eager set, and has no fallback for an older shell`);
    assert.ok(shimAt < firstUse, `${file}: the fallback must come before the first use of serverNow()`);
  }
});
