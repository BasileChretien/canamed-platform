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

  return { COLORS, hashStr, colorFor, roomNames, minsSince, reducedMotion };
});
