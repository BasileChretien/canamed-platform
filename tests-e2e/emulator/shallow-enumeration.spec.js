/* tests-e2e/emulator/shallow-enumeration.spec.js
 *
 * The retention purge enumerates sessions over the RTDB REST API with
 * `?shallow=true` instead of deep-reading both trees, so that the whole
 * identified database stops being copied onto a US GitHub Actions runner every
 * night for no purpose (Art. 5(1)(c) — the job uses two timestamps per session
 * and nothing else).
 *
 * The unit tests cover that logic with an injected `fetchShallow`. What they
 * CANNOT cover is the assumption the whole change rests on: that a real RTDB
 * answers `?shallow=true` with `{key: true, …}` and not something else. That
 * assumption was verified by hand against this emulator before the change
 * landed; this spec is the same check, kept, so it cannot rot silently.
 *
 * Why that matters more than it looks: if the shape assumption were wrong,
 * shallowKeysOf() would throw and the nightly purge would go red — recoverable,
 * but only if someone reads the alert. This repo has a documented history of
 * scheduled jobs failing unnoticed for days (the ≈11-day and 5-day retention
 * gaps). A test is cheaper than that.
 *
 * Uses the emulator's owner bypass for BOTH seeding and reading, deliberately:
 * nothing here is an allow/deny verdict, so the bypass is observation only —
 * the same rule fixtures.js states for dbReadAsOwner.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");
const {
  sessionLocations,
  readSessionLocationsShallow
} = require("../../scripts/lib/session-trees.js");

const EMU = "http://127.0.0.1:9000";
const NS = "canamed-sim";
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const url = (p, q = "") => `${EMU}/${p}.json?ns=${NS}${q}`;

async function put(path, value) {
  const r = await fetch(url(path), {
    method: "PUT", headers: OWNER, body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error(`seed ${path}: HTTP ${r.status}`);
}
const getJson = async (p, q = "") => (await fetch(url(p, q), { headers: OWNER })).json();

/* A distinctive name, so "no body leaked" is a real assertion and not a
   coincidence of the seed data being small. */
const CANARY = "Ada Lovelace ZZQX";

test.describe("shallow session enumeration (the retention purge's list)", () => {
  test.beforeEach(async () => {
    await put("sessions/SHLW1", { created: { at: 1 }, roster: { u1: { name: CANARY } } });
    await put("sessions/SHLW2", { created: { at: 2 }, closed: { at: 3 } });
    await put("orgs/shlw-org/sessions/SHLW3", { created: { at: 4 } });
  });

  test("?shallow=true returns a key map, and carries no session body", async () => {
    const shallow = await getJson("sessions", "&shallow=true");
    const deep = await getJson("sessions");

    /* The shape the change depends on. RTDB documents `{key: true}` for object
       children; assert it rather than trusting the doc. */
    expect(typeof shallow).toBe("object");
    expect(shallow).not.toBeNull();
    for (const v of Object.values(shallow)) expect(v).toBe(true);
    expect(Object.keys(shallow)).toEqual(expect.arrayContaining(["SHLW1", "SHLW2"]));

    /* The entire point: the participant's name is in the deep read and must not
       be in the shallow one. */
    expect(JSON.stringify(deep)).toContain(CANARY);
    expect(JSON.stringify(shallow)).not.toContain(CANARY);
  });

  test("a missing node answers null, which must read as empty and not as an error", async () => {
    /* shallowKeysOf() treats null — and ONLY null — as a genuinely empty tree.
       If RTDB answered something else here (say `{}` or a 404), an empty
       database would throw and the purge would fail every night on a healthy
       system. */
    expect(await getJson("no-such-tree-here", "&shallow=true")).toBeNull();
  });

  test("shallow enumeration finds exactly what the deep read finds", async () => {
    const fetchShallow = (p) => getJson(p, "&shallow=true");
    const shallowLocs = await readSessionLocationsShallow({
      databaseURL: "https://unused.example", fetchShallow
    });
    const deepLocs = sessionLocations(await getJson("sessions"), await getJson("orgs"));

    /* These objects are the purge's DELETE list, so compare all derived paths,
       not just the keys. */
    const strip = (o) => { const { data, metadataOnly, ...rest } = o; return rest; };
    const byKey = (a) => Object.fromEntries(a.map((l) => [l.key, strip(l)]));

    expect(byKey(shallowLocs)).toEqual(byKey(deepLocs));

    // and it really did see both trees, so the equality above is not vacuous
    const keys = shallowLocs.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["SHLW1", "SHLW2", "orgs/shlw-org/SHLW3"]));
  });
});
