/* tests/session-enum-shallow.test.js
 *
 * The retention purge used to enumerate sessions by DEEP-READING both trees —
 * every participant name, answer and chat turn — and then use nothing but two
 * timestamps per session, which it re-read separately. On GitHub Actions that
 * meant copying the whole identified database onto a US runner nightly for no
 * purpose (GDPR Art. 5(1)(c)). `readSessionLocationsShallow` enumerates by key
 * alone instead.
 *
 * Two properties have to hold, and they pull in opposite directions:
 *
 *   1. IT MUST FIND THE SAME SESSIONS. The purge derives the nodes it DELETES
 *      from these objects. If the shallow enumerator built a path even slightly
 *      differently, the job would delete the wrong node or silently skip one.
 *      Hence one shared builder and the equivalence test below.
 *
 *   2. IT MUST NEVER FAIL TO AN EMPTY LIST. This is the dangerous direction: a
 *      broken read that yields [] makes the job print "0 sessions", exit 0, and
 *      look healthy while retention silently stops. Every non-empty-node
 *      failure has to throw.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  sessionLocations,
  sessionLocationsFromKeys,
  readSessionLocationsShallow,
  shallowKeysOf
} = require("../scripts/lib/session-trees");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SESSIONS = {
  ABC: { created: { at: 1 }, roster: { u1: { name: "Ada" } } },
  DEF: { created: { at: 2 }, closed: { at: 3 } }
};
const ORGS = {
  "caen-nagoya": { sessions: { ABC: { created: { at: 4 } }, XYZ: { created: { at: 5 } } } },
  "e2e-org": { sessions: { QRS: { created: { at: 6 } } } }
};

// ---- property 1: the two enumerators agree on every purge target -----------

test("shallow enumeration derives byte-identical paths to the deep one", () => {
  const deep = sessionLocations(SESSIONS, ORGS);
  const shallow = sessionLocationsFromKeys(
    Object.keys(SESSIONS),
    Object.fromEntries(Object.keys(ORGS).map((s) => [s, Object.keys(ORGS[s].sessions)]))
  );

  assert.strictEqual(shallow.length, deep.length, "different number of sessions found");

  const strip = (o) => {
    const { data, metadataOnly, ...rest } = o;
    return rest;
  };
  const byKey = (arr) => Object.fromEntries(arr.map((l) => [l.key, strip(l)]));

  /* deepStrictEqual over the whole map, not a spot-check of one field: these
     objects ARE the delete list, so every property has to match. */
  assert.deepStrictEqual(byKey(shallow), byKey(deep));
});

test("the shallow objects carry no session body, and say so", () => {
  const locs = sessionLocationsFromKeys(["ABC"], {});
  assert.ok(!("data" in locs[0]),
    "a `data` key must be ABSENT, not null — a caller needing bodies should " +
      "break loudly rather than write nulls into a backup");
  assert.strictEqual(locs[0].metadataOnly, true);
});

test("empty and missing inputs produce an empty list without throwing", () => {
  assert.deepStrictEqual(sessionLocationsFromKeys([], {}), []);
  assert.deepStrictEqual(sessionLocationsFromKeys(null, null), []);
  assert.deepStrictEqual(sessionLocationsFromKeys(undefined, undefined), []);
});

// ---- property 2: no failure may look like "no sessions" --------------------

test("shallowKeysOf treats only a genuinely empty node as empty", () => {
  assert.deepStrictEqual(shallowKeysOf(null, "sessions"), []);
  assert.deepStrictEqual(shallowKeysOf(undefined, "sessions"), []);
  assert.deepStrictEqual(shallowKeysOf({ A: true, B: true }, "sessions"), ["A", "B"]);
});

test("shallowKeysOf throws on anything else rather than reporting nothing", () => {
  for (const bad of [true, false, 0, 42, "", "oops", ["A"]]) {
    assert.throws(
      () => shallowKeysOf(bad, "sessions"),
      /expected an object of keys or null/,
      "shallowKeysOf(" + JSON.stringify(bad) + ") must throw, not return []"
    );
  }
});

test("a failing fetch propagates instead of yielding an empty session list", async () => {
  await assert.rejects(
    readSessionLocationsShallow({
      databaseURL: "https://example.firebasedatabase.app",
      fetchShallow: async () => { throw new Error("HTTP 401"); }
    }),
    /HTTP 401/
  );
});

test("a truthy-but-wrong body fails the run rather than emptying it", async () => {
  await assert.rejects(
    readSessionLocationsShallow({
      databaseURL: "https://example.firebasedatabase.app",
      fetchShallow: async () => "Permission denied"
    }),
    /expected an object of keys or null/
  );
});

// ---- the request shape -----------------------------------------------------

test("it asks for both trees, then one request per org, and nothing else", async () => {
  const asked = [];
  const locs = await readSessionLocationsShallow({
    databaseURL: "https://example.firebasedatabase.app",
    fetchShallow: async (p) => {
      asked.push(p);
      if (p === "sessions") return { ABC: true, DEF: true };
      if (p === "orgs") return { "caen-nagoya": true };
      if (p === "orgs/caen-nagoya/sessions") return { XYZ: true };
      throw new Error("unexpected path " + p);
    }
  });

  assert.deepStrictEqual(asked, ["sessions", "orgs", "orgs/caen-nagoya/sessions"]);
  assert.deepStrictEqual(locs.map((l) => l.key).sort(), ["ABC", "DEF", "orgs/caen-nagoya/XYZ"]);
});

test("an org with no sessions contributes nothing and does not throw", async () => {
  const locs = await readSessionLocationsShallow({
    databaseURL: "https://example.firebasedatabase.app",
    fetchShallow: async (p) =>
      p === "sessions" ? null : p === "orgs" ? { empty: true } : null
  });
  assert.deepStrictEqual(locs, []);
});

/* assert.REJECTS, not assert.throws: readSessionLocationsShallow is async, so
   a bad config comes back as a rejected promise. assert.throws sees the
   promise being returned, calls that "no exception", and fails — which is at
   least loud. The dangerous version of this mistake is the opposite one, where
   a test awaits nothing and passes on a rejection it never observed. */
test("the REST reader refuses a non-https database URL", async () => {
  await assert.rejects(
    readSessionLocationsShallow({ databaseURL: "http://insecure.example" }),
    /https databaseURL/
  );
});

test("the REST reader refuses an app with no usable credential", async () => {
  await assert.rejects(
    readSessionLocationsShallow({
      databaseURL: "https://example.firebasedatabase.app",
      app: { options: {} }
    }),
    /getAccessToken/
  );
});

test("the credential never travels in the URL", () => {
  /* RTDB REST also accepts ?access_token=, which would put an OAuth token
     somewhere a proxy or log could keep it. The header form is deliberate. */
  /* Strip comments first. The source explains WHY it avoids ?access_token=,
     so a naive grep matches that explanation and fails on correct code — the
     same shape as the repo's `grep -L "npm ci"` note, where a comment
     mentioning the thing satisfied the check. Test the code, not the prose. */
  const src = read("scripts/lib/session-trees.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(!/access_token=/.test(src),
    "the shallow reader must not pass the credential as a query parameter");
  assert.match(src, /Authorization:\s*"Bearer "/);
});

// ---- which job uses which ---------------------------------------------------

test("the purge enumerates shallowly; backup and export still read bodies", () => {
  const cleanup = read("scripts/cleanup-stale-sessions.js");
  assert.match(cleanup, /readSessionLocationsShallow\(/,
    "the purge must enumerate by key — it uses only created/at and closed/at");

  /* These two genuinely need the bodies: one archives them, the other
     pseudonymises them. Pointing either at the shallow enumerator would
     produce an empty backup or an empty export, which is worse than the
     transfer being fixed here. */
  for (const job of ["scripts/backup-sessions.js", "scripts/pseudonymise-export.js"]) {
    const src = read(job);
    assert.ok(!/readSessionLocationsShallow/.test(src),
      job + " needs session bodies and must keep the deep read");
    assert.match(src, /loc\.data/, job + " is expected to consume loc.data");
  }
});

test("the deep-enumeration escape hatch is opt-in and never automatic", () => {
  const src = read("scripts/cleanup-stale-sessions.js");
  assert.match(src, /CLEANUP_DEEP_ENUM/);
  /* It must be selected by the operator setting the variable, never by a
     catch block: a silent fallback would restore the daily full-database
     transfer and hide whatever broke. */
  assert.ok(!/catch[\s\S]{0,200}readSessionLocations\(db\)/.test(src),
    "the deep read must not be reachable from a catch — that is a silent fallback");
});
