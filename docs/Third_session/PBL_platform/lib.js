/* ===================================================================
 * lib.js — CaNaMED pure utility functions
 *
 * These functions are the testable, side-effect-free core of the engine:
 * input sanitisation, password hashing, code generation, score math,
 * URL/href safety. The browser loads this file via <script src="lib.js">
 * BEFORE script.js, so the rest of the engine can use the functions as
 * plain globals (safeHref(...), hashPassword(...), etc.).
 *
 * Node loads the same file via require("./lib") so the unit tests under
 * tests/ can drive these functions directly without spinning up a
 * browser, a DOM, or Firebase. The UMD-ish wrapper at the bottom exports
 * them via module.exports in Node and attaches them to window in the
 * browser.
 *
 * Anything that needs the DOM, Firebase, window.CANAMED_CONFIG, the live
 * room state etc. stays in script.js — this file is meant to be 100%
 * pure JS and free of platform dependencies, so tests don't need stubs.
 * ================================================================ */

(function (root, factory) {
  const exports_ = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports_;
  }
  if (typeof window !== "undefined") {
    // expose each function as a global so script.js can keep calling
    // them by name (safeHref(...) rather than CanamedLib.safeHref(...))
    Object.keys(exports_).forEach(k => { window[k] = exports_[k]; });
    window.CanamedLib = exports_;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------
  // safeHref
  // ---------------------------------------------------------------
  // Only ever put an https:// URL into an href. The Teams /
  // questionnaire links are admin-writable but rendered in every
  // participant's page; a stored "javascript:" or "data:" URL would
  // run as XSS on click, and a "mailto:" could be used to phish
  // (auto-opens the user's email client addressed to an attacker).
  // The database rules also enforce a regex, but defence-in-depth.
  function safeHref(url) {
    if (typeof url !== "string" || !url) return null;
    try {
      const u = new URL(url.trim());
      return u.protocol === "https:" ? u.href : null;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------
  // sanitizeCode
  // ---------------------------------------------------------------
  // Normalise a session code typed by the user: trim, lowercase,
  // strip anything that isn't [a-z0-9_-], cap at 20 chars.
  function sanitizeCode(raw) {
    return String(raw == null ? "" : raw)
      .trim().toLowerCase()
      .replace(/[^a-z0-9_-]/g, "").slice(0, 20);
  }

  // ---------------------------------------------------------------
  // sanitizeResume
  // ---------------------------------------------------------------
  // localStorage is attacker-writable and survives across users on a
  // shared lab machine — never trust resume data, clamp every field.
  // `validUniIds` is the list of university IDs accepted (comes from
  // the deployment's COHORTS in script.js); if omitted, the legacy
  // Caen/Nagoya pair is used (back-compat).
  function sanitizeResume(r, validUniIds) {
    if (!r || typeof r !== "object") return null;
    const unis = (Array.isArray(validUniIds) && validUniIds.length)
      ? validUniIds : ["Caen", "Nagoya"];
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    const out = {
      sessionNum: str(r.sessionNum, 20).replace(/[^a-zA-Z0-9_-]/g, ""),
      name: str(r.name, 40),
      university: unis.indexOf(r.university) >= 0 ? r.university : "",
      year: [1, 2, 3, 4, 5, 6, 7].indexOf(r.year) >= 0 ? r.year : 1,
      english: ["A2", "B1", "B2", "C1", "C2"].indexOf(r.english) >= 0 ? r.english : "B2",
      room: typeof r.room === "string" ? r.room.slice(0, 30) : null,
      consent: (r.consent && typeof r.consent === "object"
        && typeof r.consent.version === "string"
        && r.consent.version.length <= 40
        && typeof r.consent.workshop === "boolean"
        && typeof r.consent.research === "boolean"
        && typeof r.consent.at === "number")
        ? { workshop: r.consent.workshop, research: r.consent.research,
            version: r.consent.version.slice(0, 40), at: r.consent.at }
        : null
    };
    return (out.sessionNum && out.name) ? out : null;
  }

  // ---------------------------------------------------------------
  // entriesSorted
  // ---------------------------------------------------------------
  // Convert an object of { id1: {at, ...}, id2: ... } into an array
  // sorted by `at`. Used by the answers list, score events, etc.
  function entriesSorted(obj) {
    return Object.keys(obj || {})
      .map(k => Object.assign({ id: k }, obj[k]))
      .sort((a, b) => (a.at || 0) - (b.at || 0));
  }

  // ---------------------------------------------------------------
  // normalizeForScore
  // ---------------------------------------------------------------
  // forgiving text match for the concept families: lowercase, strip
  // accents, collapse whitespace, then substring (stem) match — kind
  // to second-language English answers.
  function normalizeForScore(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")  // strip accents
      .replace(/\s+/g, " ");
  }

  // ---------------------------------------------------------------
  // tc — translate content (accessor for {en, fr, ja} wrapped strings)
  // ---------------------------------------------------------------
  // case-content.js wraps every user-facing string as { en, fr, ja } so
  // medical educators can edit translations alongside the English. tc()
  // is the read accessor used by script.js wherever such a field is
  // rendered. Rules:
  //   - plain string passes through unchanged (back-compat for any
  //     legacy content / custom scenarios still using strings),
  //   - { en, fr, ja } object: return value[lang] if non-empty, else
  //     fall back to en if non-empty, else first non-empty value, else
  //     "" — so a translator can ship empty fr/ja stubs and the user
  //     still sees the English without an "undefined" leaking through,
  //   - null / undefined / anything else: return "".
  // Pure: no DOM, no Firebase, no i18n.js dependency (the caller passes
  // the language tag from getLang()).
  function tc(value, lang) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const pick = k => (typeof value[k] === "string" && value[k]) ? value[k] : null;
    const wanted = pick(lang);
    if (wanted) return wanted;
    const en = pick("en");
    if (en) return en;
    // last-ditch: first non-empty string among the known language keys,
    // then any string-valued key in the object
    const langKeys = ["en", "fr", "ja"];
    for (const k of langKeys) { const v = pick(k); if (v) return v; }
    for (const k of Object.keys(value)) { const v = pick(k); if (v) return v; }
    return "";
  }

  // ---------------------------------------------------------------
  // decisionShort
  // ---------------------------------------------------------------
  // Short label for a decision — the prompt, capped at 64 chars.
  // `d.prompt` may be either a plain string (legacy) or a translatable
  // { en, fr, ja } object — tc() handles both shapes.
  function decisionShort(d, lang) {
    const p = tc(d && d.prompt, lang || "en");
    return p.length > 64 ? p.slice(0, 61).trim() + "…" : p;
  }

  // ---------------------------------------------------------------
  // scoreTotal
  // ---------------------------------------------------------------
  // Sum auto + min(manual, cap) − penalties, floored at 0. The
  // cap on facilitator-awarded points is a parameter so the
  // function stays pure.
  function scoreTotal(roomData, manualCap) {
    const s = (roomData && roomData.score) || {};
    const cap = (typeof manualCap === "number") ? manualCap : 70;
    let auto = 0, manual = 0, pen = 0;
    Object.keys(s.auto || {}).forEach(k => { auto += (s.auto[k] && s.auto[k].points) || 0; });
    Object.keys(s.manual || {}).forEach(k => { manual += (s.manual[k] && s.manual[k].points) || 0; });
    Object.keys(s.penalties || {}).forEach(k => { pen += (s.penalties[k] && s.penalties[k].points) || 0; });
    return Math.max(0, auto + Math.min(manual, cap) - pen);
  }

  // ---------------------------------------------------------------
  // constantTimeEq
  // ---------------------------------------------------------------
  // Constant-time compare of two equal-length strings. Returns false
  // on length mismatch. Manual XOR-reduce because browsers don't
  // expose timingSafeEqual; effectively constant-time for the same
  // reason Node's implementation is.
  function constantTimeEq(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // ---------------------------------------------------------------
  // Password hashing — PBKDF2-SHA256, 100k iterations, salt = "canamed:" + session.
  // verifyPassword accepts both the new "v2$iters$hex" envelope AND
  // legacy raw-SHA-256 (for sessions created before the upgrade).
  // ---------------------------------------------------------------
  const PBKDF2_ITERS_DEFAULT = 100000;

  function _subtle() {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      throw new Error("Web Crypto API not available");
    }
    return crypto.subtle;
  }

  async function pbkdf2(pass, salt, iterations) {
    const subtle = _subtle();
    const key = await subtle.importKey(
      "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await subtle.deriveBits({
      name: "PBKDF2",
      salt: new TextEncoder().encode("canamed:" + salt),
      iterations: iterations,
      hash: "SHA-256"
    }, key, 256);
    return Array.from(new Uint8Array(bits))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(s) {
    const subtle = _subtle();
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(pass, saltSession) {
    const hex = await pbkdf2(pass, saltSession, PBKDF2_ITERS_DEFAULT);
    return "v2$" + PBKDF2_ITERS_DEFAULT + "$" + hex;
  }

  async function verifyPassword(pass, saltSession, stored) {
    if (typeof stored !== "string" || !stored) return false;
    if (stored.indexOf("v2$") === 0) {
      const parts = stored.split("$");
      if (parts.length !== 3) return false;
      const iters = parseInt(parts[1], 10);
      if (!isFinite(iters) || iters < 1000) return false;
      const want = await pbkdf2(pass, saltSession, iters);
      return constantTimeEq("v2$" + iters + "$" + want, stored);
    }
    // legacy format: salted SHA-256 ("canamed:<session>:<pass>")
    const legacy = await sha256Hex("canamed:" + saltSession + ":" + pass);
    return constantTimeEq(legacy, stored);
  }

  // ---------------------------------------------------------------
  // computeCohortCounts — per-cohort tally for the waiting room.
  // ---------------------------------------------------------------
  // Counts how many waiting-room participants belong to each cohort
  // (e.g. Caen / Nagoya). The chip row in the facilitator dashboard
  // uses this so the prof can see the Franco-Japanese balance at a
  // glance instead of counting individual chips by hand.
  //
  // Pure, deterministic: a stable iteration order on the cohort list
  // is the caller's responsibility (the caller passes a registered
  // COHORTS array). Unknown universities (free-text or stale data)
  // bucket under "__other__".
  //
  // Returns: { [cohortId]: count, ...optional __other__ }
  function computeCohortCounts(waiting, cohorts) {
    const cohortIds = Array.isArray(cohorts) ? cohorts.map(c => c && c.id).filter(Boolean) : [];
    const counts = {};
    cohortIds.forEach(id => { counts[id] = 0; });
    let other = 0;
    (Array.isArray(waiting) ? waiting : []).forEach(p => {
      const u = p && p.university;
      if (u && Object.prototype.hasOwnProperty.call(counts, u)) counts[u] += 1;
      else if (u) other += 1;
    });
    if (other > 0) counts.__other__ = other;
    return counts;
  }

  // ---------------------------------------------------------------
  // pseudonymiseTree — replace real participant names everywhere
  // ---------------------------------------------------------------
  // R2-23 fix: the admin "Pseudonymise names in export" checkbox used to
  // only affect the .txt download. The full JSON archive shipped raw names.
  // This walker pseudonymises a session subtree (the same shape /sessions/
  // {code} has in RTDB) using deterministic Student-A / Student-B / ...
  // codes ordered by /pool/{cid}.at (join order). Matches the strategy
  // used by scripts/pseudonymise-export.js for the daily research export
  // so the on-demand archive and the cron-export are interchangeable.
  //
  // Pure: no DOM, no Firebase, no mutation of the input. Returns a new
  // tree plus the realName -> pseudonym map (linkage table) so callers
  // (e.g. UI) can choose to display, log, or discard it.
  //
  // The walker rewrites every string value matching a known real name,
  // wherever it appears in the tree — covers pool.name, answers.{}.by,
  // score.manual.{}.by, calls.{}.by, plus any future field that holds a
  // participant name. It does not modify booleans, numbers, or object
  // keys (only values), so cids (used as keys throughout) are untouched.
  function pseudoCode(i) {
    if (i < 26) return "Student-" + String.fromCharCode(65 + i);
    const a = Math.floor(i / 26) - 1;
    const b = i % 26;
    return "Student-" + String.fromCharCode(65 + a) +
      String.fromCharCode(65 + b);
  }

  function pseudonymiseTree(tree) {
    const empty = { tree: tree, linkage: {} };
    if (!tree || typeof tree !== "object") return empty;
    const pool = (tree.pool && typeof tree.pool === "object") ? tree.pool : {};
    // Stable order by join time. Falls back to lexicographic cid order
    // (also deterministic) when `at` is absent on legacy data.
    const cids = Object.keys(pool).sort((a, b) => {
      const ta = (pool[a] && typeof pool[a].at === "number") ? pool[a].at : 0;
      const tb = (pool[b] && typeof pool[b].at === "number") ? pool[b].at : 0;
      if (ta !== tb) return ta - tb;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    const nameToPseudo = {};
    cids.forEach(cid => {
      const name = pool[cid] && pool[cid].name;
      if (typeof name === "string" && name.length > 0 &&
          !Object.prototype.hasOwnProperty.call(nameToPseudo, name)) {
        nameToPseudo[name] = pseudoCode(Object.keys(nameToPseudo).length);
      }
    });
    // Deep clone via JSON so the input tree is never mutated. Functions /
    // undefined / cycles are not expected in a Firebase RTDB tree.
    const out = JSON.parse(JSON.stringify(tree));
    // Strip the admin password hash defence-in-depth — a pseudonymised
    // export is meant to be shareable; the hash never should be in it.
    if (out && Object.prototype.hasOwnProperty.call(out, "adminPasswordHash")) {
      delete out.adminPasswordHash;
    }

    function rewrite(v) {
      if (typeof v === "string" &&
          Object.prototype.hasOwnProperty.call(nameToPseudo, v)) {
        return nameToPseudo[v];
      }
      return v;
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          node[i] = rewrite(node[i]);
          if (node[i] && typeof node[i] === "object") walk(node[i]);
        }
        return;
      }
      for (const k of Object.keys(node)) {
        node[k] = rewrite(node[k]);
        if (node[k] && typeof node[k] === "object") walk(node[k]);
      }
    }
    walk(out);
    return { tree: out, linkage: nameToPseudo };
  }

  // ---------------------------------------------------------------
  // generateSessionCode
  // ---------------------------------------------------------------
  // A short, easy-to-read code from a 31-char alphabet (skips visually
  // ambiguous chars i/l/o/0/1). Formatted "abc-def". 31^6 ≈ 887M.
  // Uses crypto.getRandomValues with modulo-bias rejection so codes
  // cannot be predicted from PRNG state.
  function generateSessionCode() {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const cutoff = Math.floor(256 / alphabet.length) * alphabet.length;
    const chars = [];
    while (chars.length < 6) {
      const buf = new Uint8Array(6 - chars.length);
      crypto.getRandomValues(buf);
      for (let i = 0; i < buf.length && chars.length < 6; i++) {
        if (buf[i] < cutoff) chars.push(alphabet[buf[i] % alphabet.length]);
      }
    }
    const s = chars.join("");
    return s.slice(0, 3) + "-" + s.slice(3);
  }

  // ---------------------------------------------------------------
  // exports
  // ---------------------------------------------------------------
  return {
    safeHref: safeHref,
    sanitizeCode: sanitizeCode,
    sanitizeResume: sanitizeResume,
    entriesSorted: entriesSorted,
    normalizeForScore: normalizeForScore,
    tc: tc,
    decisionShort: decisionShort,
    scoreTotal: scoreTotal,
    constantTimeEq: constantTimeEq,
    pbkdf2: pbkdf2,
    sha256Hex: sha256Hex,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    generateSessionCode: generateSessionCode,
    computeCohortCounts: computeCohortCounts,
    pseudonymiseTree: pseudonymiseTree,
    pseudoCode: pseudoCode,
    // expose the constant so tests can assert it
    PBKDF2_ITERS_DEFAULT: PBKDF2_ITERS_DEFAULT
  };
});
