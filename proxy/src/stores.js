/* stores.js — the rate-limit counter backends.
 *
 * The callable kept its counters in RTDB through the admin SDK. The proxy has
 * no admin credentials by design (see handler.js), so it needs a counter store
 * it can drive with what it actually holds.
 *
 * ── THE INTERFACE IS increment(), NOT get()/put() ────────────────────────
 * It started as get/put, which forced every backend into a read-modify-write
 * and made the ceiling approximate on all of them. Asking for the operation
 * the caller actually wants lets a backend that HAS an atomic increment use
 * it, and confines the racy emulation to the ones that do not. `rtdbStore`
 * below is the one that benefits.
 *
 *   increment(counter, ttlSeconds) -> Promise<number>   the value AFTER this call
 *
 * `counter` is structured — { scope, id, bucket } — rather than a flat string,
 * because rtdbStore has to turn it into a PATH whose ownership the database
 * rules can check. A flat "u:<uid>:<hour>" key cannot be authorised.
 */

"use strict";

/* Flat key for the backends that just want a string. */
function flatKey(c) {
  return `${c.scope}:${c.id}:${c.bucket}`;
}

/* ── RTDB (the Scaleway / no-KV backend, and the default) ────────────────
 *
 * WHY RTDB AND NOT A KV SERVICE. Scaleway's free tier covers Functions
 * generously (1M requests + 400k GB-s per month) but includes no key/value
 * store, and Serverless SQL Database has no free tier at all — it bills from
 * ~€0.10/month even when idle. Every third-party KV (Upstash and friends)
 * would be a NEW SUB-PROCESSOR, which is the exact thing this migration is
 * trying to keep under control, and would need adding to the privacy notice
 * and the DPA for the sake of storing four integers.
 *
 * RTDB is already the platform's database, already in europe-west1, already
 * named in the DPA, and free on Spark. The counters hold a uid, a time bucket
 * and an integer — no clinical text.
 *
 * ── HOW IT IS SAFE WITHOUT ADMIN CREDENTIALS ─────────────────────────────
 * The proxy writes with the CALLER'S OWN token, so a caller could in
 * principle write the same node directly and reset their counter to zero. The
 * database rules stop that: `rateLimits` is INCREMENT-ONLY. A write is allowed
 * only when it is exactly `data + 1` (or a first write of 1). The worst a
 * participant can do to their own counter is make it larger, which only
 * restricts them further.
 *
 * That rule also buys ATOMICITY, which is the part worth noticing. Two
 * concurrent requests both read N and both try to write N+1; the second is
 * REJECTED by the rule, because by then `data` is N+1 and N+1 !== N+2. The
 * loser re-reads and retries. A read-modify-write against an eventually
 * consistent KV silently loses that increment instead — which is why the
 * Cloudflare adapter's ceiling is documented as approximate and this one's is
 * not.
 */
export function rtdbStore(rtdbUrl, idToken, deps) {
  const d = deps || {};
  const doFetch = d.fetch || fetch;
  const base = String(rtdbUrl).replace(/\/$/, "");
  const MAX_ATTEMPTS = 6;

  const pathFor = (c) => {
    /* Structured per scope so database.rules.json can bind ownership: the uid
     * tree is writable only by that uid, the session tree only by someone who
     * holds a roomOf claim in that session. */
    if (c.scope === "uid") return `rateLimits/uid/${c.id}/${c.bucket}`;
    if (c.scope === "session") return `rateLimits/session/${c.id}/${c.bucket}`;
    throw new Error("rtdbStore: unknown counter scope " + c.scope);
  };

  const url = (p) => `${base}/${p}.json?auth=${encodeURIComponent(idToken)}`;

  return {
    async increment(counter, _ttlSeconds) {
      /* TTL is ignored here on purpose: RTDB has no expiry. The BUCKET is the
       * window — an hour or a UTC day is baked into the key — so a counter
       * simply stops being consulted when its window passes. The stale nodes
       * are swept by scripts/cleanup-stale-sessions.js, same as the hfPatient
       * metrics tree. */
      const p = pathFor(counter);
      let last = 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const readRes = await doFetch(url(p));
        if (!readRes.ok) throw new Error("rate-limit read failed: HTTP " + readRes.status);
        const cur = await readRes.json();
        const next = (typeof cur === "number" && Number.isFinite(cur) ? cur : 0) + 1;
        last = next;

        const writeRes = await doFetch(url(p), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next)
        });
        if (writeRes.ok) return next;
        /* 401/403 is the RULE rejecting a stale increment — someone else
         * incremented between our read and our write. Re-read and retry. Any
         * other status is a real failure and must propagate: swallowing it
         * would silently disable metering. */
        if (writeRes.status !== 401 && writeRes.status !== 403) {
          throw new Error("rate-limit write failed: HTTP " + writeRes.status);
        }
      }
      /* Losing MAX_ATTEMPTS races in a row means genuine contention on one
       * counter. Failing closed is correct: the alternative is letting the
       * request through unmetered, which is what the limit exists to stop. */
      throw new Error("rate-limit contention: gave up after " + MAX_ATTEMPTS +
        " attempts (last=" + last + ")");
    }
  };
}

/* ── Cloudflare Workers KV ───────────────────────────────────────────────
 * Kept so the cloudflare/ adapter still works, but note the difference from
 * rtdbStore above: KV has no atomic increment and is eventually consistent,
 * so concurrent requests can overwrite each other's increments and the true
 * count can run BELOW the recorded one. The limits are therefore APPROXIMATE
 * on this backend. At workshop scale the slippage is a handful of calls, but
 * do not describe it as exact. */
export function kvStore(namespace) {
  return {
    async increment(counter, ttlSeconds) {
      const key = flatKey(counter);
      const next = Number((await namespace.get(key)) || 0) + 1;
      // Cloudflare rejects expirationTtl below 60s.
      await namespace.put(key, String(next), { expirationTtl: Math.max(60, Number(ttlSeconds) || 60) });
      return next;
    }
  };
}

/* In-memory, for tests and local runs ONLY.
 *
 * Not offered as a production fallback on purpose. A per-instance counter
 * would make the limits look enforced while every new instance started from
 * zero — a control that reports success and stops nothing, which is worse
 * than no control because it invites trust. handler.js refuses to serve when
 * no store is bound rather than quietly degrading to this. */
export function memoryStore(clock) {
  const map = new Map();
  const now = () => (clock ? clock() : Date.now());
  return {
    async increment(counter, ttlSeconds) {
      const key = flatKey(counter);
      const e = map.get(key);
      const live = e && e.expiresAt > now();
      const next = (live ? e.value : 0) + 1;
      map.set(key, { value: next, expiresAt: now() + (Number(ttlSeconds) || 60) * 1000 });
      return next;
    },
    _peek: (counter) => {
      const e = map.get(flatKey(counter));
      return e && e.expiresAt > now() ? e.value : 0;
    }
  };
}
