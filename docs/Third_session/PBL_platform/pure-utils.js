/* ===================================================================
 * pure-utils.js — CaNaMED pure presentation / utility helpers
 *
 * A small, side-effect-free slice carved out of script.js. Like lib.js,
 * the browser loads this via <script src="pure-utils.js"> BEFORE
 * script.js, so the engine keeps calling the helpers as plain globals
 * (colorFor(...), roomNames(...), …). Node loads it via require() so the
 * functions can be unit-tested directly — no DOM, Firebase, or live room
 * state required.
 *
 * Scope rule (same as lib.js): only genuinely pure helpers live here.
 * The room/admin runtime stays in script.js because it depends on shared
 * mutable state (pool, allRooms, roomStage, …) — see
 * ARCHITECTURE/script-js-map.md for why the big runtime extraction was
 * deferred. This file is the seed for migrating more pure helpers out of
 * script.js incrementally, in lockstep with their tests.
 * ================================================================ */

(function (root, factory) {
  const exports_ = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports_;
  }
  if (typeof window !== "undefined") {
    // expose each helper as a global so script.js can keep calling it by
    // bare name (colorFor(...) rather than CanamedPure.colorFor(...)).
    Object.keys(exports_).forEach(k => { window[k] = exports_[k]; });
    window.CanamedPure = exports_;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Deterministic, partnership-agnostic palette for per-name colour
  // assignment (presence chips, fallbacks). Only colorFor() reads it.
  const COLORS = ["#2E9FDF", "#E7B800", "#1e8449", "#c0392b", "#8e44ad",
                  "#e67e22", "#16a085", "#2c3e50", "#d81b60", "#00838f"];

  // Fast non-cryptographic string hash (xmur3-style). Used ONLY for stable
  // colour assignment — never for security (see lib.js hashPassword).
  function hashStr(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  // Memoised name → stable colour. Same name always maps to the same
  // palette entry so a participant keeps one colour across renders.
  const _colorCache = {};
  function colorFor(name) {
    if (!name) return "#6b7785";
    return _colorCache[name] ||
      (_colorCache[name] = COLORS[parseInt(hashStr(name).slice(0, 8), 16) % COLORS.length]);
  }

  // ["Room 1", "Room 2", …] for a given room count.
  function roomNames(count) {
    const out = [];
    for (let i = 1; i <= count; i++) out.push("Room " + i);
    return out;
  }

  // Whole minutes since a millisecond timestamp (null for a falsy input).
  function minsSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / 60000);
  }

  // prefers-reduced-motion gate; false when matchMedia is unavailable
  // (e.g. under Node in tests) so callers degrade to "animations on".
  function reducedMotion() {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  // Crockford base-32 alphabet (no I, L, O, U — avoids transcription ambiguity).
  const _CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  // Deterministic certificate ID for a (session, participant) seed, e.g.
  // canamedCertId(sessionCode + "|" + clientId) → "CNM-7K2QF-9X4A
  // The SAME inputs always produce the SAME id, so the student's downloaded
  // certificate and the facilitator's research export / attestation list agree
  // on it WITHOUT any extra storage — the export is the registry, and a cert is
  // "real" iff its (name, id) pair is in that list. NOTE: this is deterministic
  // and the algorithm is public, so it is NOT forgery-proof against someone who
  // can both guess a participant's clientId AND fabricate a registry entry —
  // it's sized for FACILITATOR-checked verification, where membership in the
  // export is the source of truth. If a PUBLIC self-service lookup is ever
  // added, switch to a random id persisted server-side (to prevent enumeration).
  function canamedCertId(seed) {
    const hex = hashStr(String(seed == null ? "" : seed));   // ~53-bit hex
    let n = parseInt(hex, 16) || 0;                            // within 2^53 (safe)
    let s = "";
    for (let i = 0; i < 10; i++) { s = _CROCK[n % 32] + s; n = Math.floor(n / 32); }
    return "CNM-" + s.slice(0, 5) + "-" + s.slice(5, 10);
  }

  // ── Public-verification primitives ─────────────────────────────────────
  // Cryptographically-random credential id for the public verification flow
  // (CNM-XXXXX-XXXXX in Crockford base-32 — same shape as canamedCertId so
  // human handling is identical). 50 bits of entropy = ~1.13e15 keyspace, so
  // collisions over the lifetime of the project are negligible and ids cannot
  // be enumerated by guessing through the public verification endpoint.
  function randomCredentialId() {
    const g = (typeof crypto !== "undefined") ? crypto :
              (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    if (!g || typeof g.getRandomValues !== "function") {
      throw new Error("crypto.getRandomValues not available");
    }
    const buf = new Uint8Array(7);   // 56 bits ⇒ 50 used + slack
    g.getRandomValues(buf);
    let bits = "";
    for (const b of buf) bits += b.toString(2).padStart(8, "0");
    let s = "";
    for (let i = 0; i < 10; i++) s += _CROCK[parseInt(bits.slice(i * 5, (i + 1) * 5), 2)];
    return "CNM-" + s.slice(0, 5) + "-" + s.slice(5, 10);
  }

  // Normalise a participant name so the same person types it the same way
  // when verifying (trim, collapse internal whitespace, NFC-normalise so the
  // composed/decomposed Unicode forms agree, casefold to lowercase).
  function normalizeName(s) {
    if (s == null) return "";
    let n = String(s).normalize ? String(s).normalize("NFC") : String(s);
    n = n.replace(/\s+/g, " ").trim().toLowerCase();
    return n;
  }

  // SHA-256 hex of `normalizeName(name) | sessionId`. Returns Promise<string>.
  // Used both at credential-write time (server-recorded) and at verification
  // time (the page hashes the verifier's typed name + session and compares).
  // No salt by design: the strict no-listing /credentials rule means an
  // attacker can only probe a specific id one at a time, and the stored
  // value is the hash, not the name.
  function credentialNameHash(name, sessionId) {
    const data = normalizeName(name) + "|" + String(sessionId == null ? "" : sessionId);
    const g = (typeof crypto !== "undefined") ? crypto :
              (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    if (g && g.subtle && typeof g.subtle.digest === "function" &&
        typeof TextEncoder !== "undefined") {
      const buf = new TextEncoder().encode(data);
      return g.subtle.digest("SHA-256", buf).then(function (h) {
        const arr = new Uint8Array(h);
        let hex = "";
        for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
        return hex;
      });
    }
    try {
      const c = (typeof require === "function") ? require("crypto") : null;
      if (c && typeof c.createHash === "function") {
        return Promise.resolve(c.createHash("sha256").update(data).digest("hex"));
      }
    } catch (e) { /* fall through */ }
    return Promise.reject(new Error("SHA-256 unavailable"));
  }

  return { COLORS, hashStr, colorFor, roomNames, minsSince, reducedMotion,
           canamedCertId, randomCredentialId, normalizeName, credentialNameHash };
});
