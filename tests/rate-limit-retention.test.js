"use strict";
/* tests/rate-limit-retention.test.js
 *
 * The LLM proxy's rate-limit counters (rateLimits/{uid,session}/<id>/<bucket>)
 * had NO retention. `rtdbStore.increment()` is handed a TTL and ignores it,
 * under a comment saying the stale nodes "are swept by
 * scripts/cleanup-stale-sessions.js" — and no script in the repository
 * referenced `rateLimits` at all. Found 2026-10-07 tracing uid-keyed nodes for
 * issue #347: every hour and day a participant used the chat stayed on record
 * under their Auth uid, indefinitely.
 *
 * These are deletion rules for a key format this file does not own, so the
 * tests lean on the two directions that hurt: deleting a counter that is still
 * enforcing a limit, and keeping one for ever. The format itself is pinned
 * against the proxy's source at the bottom.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  bucketWindow, isStaleBucket, planRateLimitSweep, TTL_WINDOWS, HOUR_MS, DAY_MS
} = require("../scripts/lib/rate-limit-retention");
const { dayKey } = require("../docs/Third_session/PBL_platform/functions/lib/hf-helpers");

const ROOT = path.join(__dirname, "..");
const NOW = Date.UTC(2026, 9, 7, 12, 30, 0);          // fixed clock

/* The keys exactly as proxy/src/handler.js builds them. */
const hourKey = (ms) => "h" + Math.floor(ms / HOUR_MS);
const dayBucket = (ms) => "d" + dayKey(ms);

test("bucketWindow: reads the two formats the proxy writes", () => {
  const h = bucketWindow(hourKey(NOW));
  assert.strictEqual(h.windowMs, HOUR_MS);
  assert.ok(h.startMs <= NOW && NOW < h.startMs + HOUR_MS, "the hour bucket must contain now");

  const d = bucketWindow(dayBucket(NOW));
  assert.deepStrictEqual(d, { startMs: Date.UTC(2026, 9, 7), windowMs: DAY_MS });
});

test("bucketWindow: anything else is not a bucket", () => {
  for (const k of ["", "h", "d", "h-1", "h1.5", "hx", "d2026107", "d202610070", "20261007",
                   "D20261007", "m123", "h1234567890", null, undefined, 42, {}]) {
    assert.strictEqual(bucketWindow(k), null, JSON.stringify(k) + " must not parse");
  }
});

test("bucketWindow: an impossible calendar date is rejected, not rolled forward", () => {
  /* Date.UTC(2026, 1, 31) is 3 March. Accepting that would hand a junk key a
     real window LATER than it claims, keeping it alive. */
  assert.strictEqual(bucketWindow("d20260231"), null);
  assert.strictEqual(bucketWindow("d20261301"), null);
  assert.strictEqual(bucketWindow("d20260100"), null);
  assert.ok(bucketWindow("d20240229"), "a real leap day is a real bucket");
});

test("a counter still enforcing a limit is NEVER stale", () => {
  /* The direction that would matter in use: sweeping the current bucket hands
     the participant a fresh allowance. */
  assert.strictEqual(isStaleBucket(hourKey(NOW), NOW), false);
  assert.strictEqual(isStaleBucket(dayBucket(NOW), NOW), false);
  // ...at either edge of its own window
  const hStart = Math.floor(NOW / HOUR_MS) * HOUR_MS;
  assert.strictEqual(isStaleBucket(hourKey(hStart), hStart), false);
  assert.strictEqual(isStaleBucket(hourKey(hStart), hStart + HOUR_MS - 1), false);
  const dStart = Date.UTC(2026, 9, 7);
  assert.strictEqual(isStaleBucket(dayBucket(dStart), dStart + DAY_MS - 1), false);
});

test("stale exactly at the TTL the proxy asks for — twice the window", () => {
  assert.strictEqual(TTL_WINDOWS, 2);
  const hStart = Math.floor(NOW / HOUR_MS) * HOUR_MS;
  assert.strictEqual(isStaleBucket(hourKey(hStart), hStart + 2 * HOUR_MS - 1), false);
  assert.strictEqual(isStaleBucket(hourKey(hStart), hStart + 2 * HOUR_MS), true);

  const dStart = Date.UTC(2026, 9, 7);
  assert.strictEqual(isStaleBucket("d20261007", dStart + 2 * DAY_MS - 1), false);
  assert.strictEqual(isStaleBucket("d20261007", dStart + 2 * DAY_MS), true);
});

test("a key in no known format is stale, so junk cannot outlive the policy", () => {
  /* The rules let a participant write ANY bucket name under their own uid. */
  for (const k of ["junk", "h", "d20260231", "forever"]) {
    assert.strictEqual(isStaleBucket(k, NOW), true, k);
  }
});

test("plan: stale buckets go, current ones stay, in both scopes", () => {
  const old = NOW - 5 * DAY_MS;
  const tree = {
    uid: {
      alice: { [hourKey(old)]: 3, [dayBucket(old)]: 9, [hourKey(NOW)]: 1, [dayBucket(NOW)]: 4 },
      bob: { [dayBucket(NOW)]: 2 }
    },
    session: { ABC123: { [hourKey(old)]: 40, [hourKey(NOW)]: 7 } }
  };
  const plan = planRateLimitSweep(tree, NOW);
  assert.deepStrictEqual(plan.paths.sort(), [
    "session/ABC123/" + hourKey(old),
    "uid/alice/" + dayBucket(old),
    "uid/alice/" + hourKey(old)
  ].sort());
  assert.deepStrictEqual(plan.stale, { uid: 2, session: 1 });
  assert.strictEqual(plan.kept, 4);
  assert.strictEqual(plan.unparsed, 0);
});

test("plan: unknown formats are swept AND counted apart", () => {
  /* A non-zero `unparsed` is how a change of key format on the proxy side
     becomes visible in the job's output instead of hiding in the total. */
  const plan = planRateLimitSweep({ uid: { u: { weird: 1, [hourKey(NOW)]: 1 } } }, NOW);
  assert.deepStrictEqual(plan.paths, ["uid/u/weird"]);
  assert.strictEqual(plan.unparsed, 1);
  assert.strictEqual(plan.kept, 1);
});

test("plan: a bare value where a bucket map belongs is removed whole", () => {
  const plan = planRateLimitSweep({ uid: { broken: 7, ok: { [hourKey(NOW)]: 1 } } }, NOW);
  assert.deepStrictEqual(plan.paths, ["uid/broken"]);
  assert.strictEqual(plan.stale.uid, 1);
});

test("plan: never reaches above an id, and ignores scopes the rules do not declare", () => {
  const old = NOW - 9 * DAY_MS;
  const plan = planRateLimitSweep({
    uid: { u: { [dayBucket(old)]: 1 } },
    global: { [dayBucket(old)]: 999 },      // not a declared scope: left alone
    session: null
  }, NOW);
  assert.deepStrictEqual(plan.paths, ["uid/u/" + dayBucket(old)]);
  for (const p of plan.paths) {
    assert.ok(p.split("/").length >= 2, "a path must never be a bare scope: " + p);
  }
});

test("plan: empty / missing / malformed trees are a no-op, not a crash", () => {
  for (const v of [null, undefined, {}, "nope", 42, [], { uid: "x" }, { uid: {} }]) {
    const plan = planRateLimitSweep(v, NOW);
    assert.deepStrictEqual(plan.paths, []);
    assert.strictEqual(plan.kept, 0);
  }
});

/* ── The format is the proxy's, not this file's ───────────────────────────
 * Everything above deletes on the strength of two key shapes and one factor
 * defined in proxy/src/. The proxy is ESM and deployed separately, so it cannot
 * be imported here; the source is read instead. If any of these stops matching,
 * the sweep is deleting on a format that no longer exists — update both. */

const HANDLER = fs.readFileSync(path.join(ROOT, "proxy", "src", "handler.js"), "utf8");
const STORES = fs.readFileSync(path.join(ROOT, "proxy", "src", "stores.js"), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

test("lockstep: the proxy still builds its buckets the way the sweep reads them", () => {
  const h = flat(HANDLER);
  assert.match(h, /RATE_LIMIT_WINDOW_MS: 60 \* 60 \* 1000/,
    "the hour bucket is no longer one hour wide");
  assert.match(h, /const hourBucket = "h" \+ Math\.floor\(now \/ c\.RATE_LIMIT_WINDOW_MS\)/,
    "the hour bucket key changed shape");
  assert.match(h, /const day = "d" \+ dayKey\(now\)/, "the day bucket key changed shape");
});

test("lockstep: the TTLs the proxy requests are still twice each window", () => {
  const h = flat(HANDLER);
  const hourly = [...h.matchAll(/bucket: hourBucket \}, 2 \* 3600\)/g)];
  assert.strictEqual(hourly.length, 2, "expected the per-uid and per-session hour counters");
  assert.match(h, /bucket: day \}, 2 \* 24 \* 3600\)/);
});

test("lockstep: the counters still live where the sweep looks", () => {
  assert.ok(STORES.includes("`rateLimits/uid/${c.id}/${c.bucket}`"));
  assert.ok(STORES.includes("`rateLimits/session/${c.id}/${c.bucket}`"));
});

test("the store's claim that something sweeps these nodes names a script that does", () => {
  /* The original comment named cleanup-stale-sessions.js, which never touched
     `rateLimits`. A claim like that is only worth having if it is checked. */
  const m = /swept by (scripts\/[\w./-]+\.js)/.exec(flat(STORES));
  assert.ok(m, "stores.js no longer says what sweeps the stale counters");
  const reaches = (rel, seen = new Set()) => {
    if (seen.has(rel)) return false;
    seen.add(rel);
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (/planRateLimitSweep\s*\(/.test(src)) return true;
    return [...src.matchAll(/require\(["'](\.\/[\w./-]+)["']\)/g)].some((r) => {
      const dep = path.posix.join(path.posix.dirname(rel), r[1]);
      return reaches(dep.endsWith(".js") ? dep : dep + ".js", seen);
    });
  };
  assert.ok(reaches(m[1]), m[1] + " is named as the sweeper but never plans a sweep");
});
