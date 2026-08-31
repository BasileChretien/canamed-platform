/* stores.js — the rate-limit counter backends.
 *
 * The callable kept its counters in RTDB through the admin SDK. The proxy has
 * no admin credentials by design (see handler.js), so it needs a small
 * key/value store of its own. The interface is deliberately two methods so any
 * host's KV can be adapted in a few lines.
 *
 * ⚠ THE STORE IS LOAD-BEARING, not a cache. It carries the GLOBAL DAILY CAP,
 * which is the only hard ceiling on the Hugging Face bill. handler.js refuses
 * to serve when no store is bound, precisely so a misconfigured deploy fails
 * loudly instead of quietly serving unmetered traffic on someone else's money.
 */

/* Cloudflare Workers KV. Free plan allows 1,000 writes/day — enough for
 * workshop scale (30 students x ~10 turns = ~300 turns, 4 counter writes each
 * would be 1,200, so see the note in README about batching if you run several
 * sessions a day). Reads are 100,000/day and are not the constraint. */
export function kvStore(namespace) {
  return {
    async get(key) { return namespace.get(key); },
    async put(key, value, ttlSeconds) {
      // Cloudflare rejects expirationTtl below 60s.
      const ttl = Math.max(60, Number(ttlSeconds) || 60);
      return namespace.put(key, value, { expirationTtl: ttl });
    }
  };
}

/* In-memory, for tests and local runs ONLY.
 *
 * Not exported as a production fallback on purpose. A per-instance counter
 * would make the global cap look enforced while each new instance started
 * counting from zero — a limit that reports success and stops nothing, which
 * is worse than no limit at all because it invites trust. */
export function memoryStore(clock) {
  const map = new Map();
  const now = () => (clock ? clock() : Date.now());
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.expiresAt <= now()) { map.delete(key); return null; }
      return e.value;
    },
    async put(key, value, ttlSeconds) {
      map.set(key, { value: String(value), expiresAt: now() + (Number(ttlSeconds) || 60) * 1000 });
    },
    _size: () => map.size
  };
}
