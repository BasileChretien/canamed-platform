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
  // tc — translate content (accessor for {en, fr, ja, ...} wrapped strings)
  // ---------------------------------------------------------------
  // case-content.js wraps every user-facing string as { en, fr, ja } (or
  // any superset, e.g. { en, fr, ja, de }) so medical educators can edit
  // translations alongside the English. tc() is the read accessor used by
  // script.js wherever such a field is rendered.
  //
  // === STRICT FALLBACK PRIORITY (R3 deep-i18n) ===========================
  // The order below is the contract. Tests in tests/lib.test.js pin each
  // step so a future "small refactor" can't silently change behaviour.
  //
  //   PRIORITY 1 — defensive type guard
  //     If `value` is null/undefined, a non-string non-object (number,
  //     boolean), or an Array, return "" immediately. Plain strings
  //     pass through unchanged at PRIORITY 2 below.
  //
  //   PRIORITY 2 — plain-string back-compat
  //     If `value` is a string, return it verbatim (including the empty
  //     string ""). Custom-JSON scenarios and legacy content predate
  //     the { en, fr, ja } convention; this keeps them rendering.
  //
  //   PRIORITY 3 — the requested language
  //     If value[lang] is a NON-EMPTY string, return it. Empty string
  //     "" is treated as "translator deliberately left this blank, fall
  //     through to en" — the canonical EN must be shown rather than a
  //     blank field. (`lang` itself may be undefined/null; that's fine,
  //     it just won't match any key and we fall through.)
  //
  //   PRIORITY 4 — English canonical fallback
  //     If value.en is a non-empty string, return it. This is the
  //     dominant production path for partially-translated content.
  //
  //   PRIORITY 5 — first non-empty among known language keys
  //     Iterate the known SUPPORTED set (en, fr, ja, es, pt, de, ko, zh)
  //     and return the first non-empty string. Caters to content that
  //     ships in fr or ja but not en yet (e.g. a Japanese-authored
  //     scenario in early draft).
  //
  //   PRIORITY 6 — first non-empty string-valued key in insertion order
  //     For exotic shapes like { ar: "..." } added by a future translator
  //     before lib.js's SUPPORTED list catches up — never lose the
  //     content just because the language code is new.
  //
  //   PRIORITY 7 — last-ditch empty string
  //     Empty object {}, all-empty { en: "", fr: "" }, or any input that
  //     hit none of the above: return "" so the UI never paints the
  //     literal word "undefined".
  //
  // Pure: no DOM, no Firebase, no i18n.js dependency (the caller passes
  // the language tag from getLang()).
  const _TC_KNOWN_LANGS = ["en", "fr", "ja", "es", "pt", "de", "ko", "zh"];
  function tc(value, lang) {
    // PRIORITY 1 — defensive type guard (null, undefined, number, boolean,
    // Array — Arrays are objects too, but a translation triplet is never
    // meant to be an array; treat them as malformed input).
    if (value == null) return "";
    if (Array.isArray(value)) return "";
    // PRIORITY 2 — plain-string back-compat
    if (typeof value === "string") return value;
    // any non-object input that survived the guard (Symbol, function, ...)
    if (typeof value !== "object") return "";
    const pick = k => (typeof value[k] === "string" && value[k]) ? value[k] : null;
    // PRIORITY 3 — the requested language (non-empty wins; empty falls through)
    const wanted = pick(lang);
    if (wanted) return wanted;
    // PRIORITY 4 — English canonical fallback
    const en = pick("en");
    if (en) return en;
    // PRIORITY 5 — first non-empty among the known SUPPORTED languages
    for (const k of _TC_KNOWN_LANGS) {
      if (k === lang || k === "en") continue;  // already tried above
      const v = pick(k);
      if (v) return v;
    }
    // PRIORITY 6 — first non-empty string-valued key in insertion order
    // (covers exotic translations added before _TC_KNOWN_LANGS is updated)
    for (const k of Object.keys(value)) {
      const v = pick(k);
      if (v) return v;
    }
    // PRIORITY 7 — last-ditch empty string
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
  // localCountryName / buildCohortPair — cohort-aware string templates
  // ---------------------------------------------------------------
  // R3 deep-i18n fix for the systemic issue Pr. Müller flagged: i18n
  // strings used to bake the cohort pair (e.g. "Franco-Japanese",
  // "deutsch-japanisch") as a literal in every language. Adding a
  // Berlin-Tokyo partnership meant editing every language entry by hand
  // — and the German team accidentally projected their future deployment
  // into the live Caen-Nagoya version, telling German participants they
  // were joining a "deutsch-japanisch" room when they were not.
  //
  // The new contract: i18n strings carry a `{cohortPair}` placeholder
  // (or per-locale variants like `{cohortPair.adj}`); the engine renders
  // the active COHORTS list into the active language via the two
  // helpers below. Adding a new partnership becomes a COHORTS edit, not
  // an i18n rewrite per language.
  //
  // Country name lookup table — covers every country in production use
  // and the immediately-plausible expansions (Berlin-Tokyo / Lyon-Tokyo /
  // Sao Paulo-Seoul demos). The keys are the COHORTS[].country strings,
  // case-sensitive English canonical names. Missing entries fall back to
  // the canonical English name unchanged (still readable in any language,
  // safer than rendering "undefined" or an empty span).
  const COUNTRY_NAMES = {
    France:        { en: "France",        fr: "France",         ja: "フランス",   es: "Francia",        pt: "França",        de: "Frankreich", ko: "프랑스",   zh: "法国" },
    Japan:         { en: "Japan",         fr: "Japon",          ja: "日本",       es: "Japón",          pt: "Japão",         de: "Japan",      ko: "일본",     zh: "日本" },
    Germany:       { en: "Germany",       fr: "Allemagne",      ja: "ドイツ",     es: "Alemania",       pt: "Alemanha",      de: "Deutschland",ko: "독일",     zh: "德国" },
    Spain:         { en: "Spain",         fr: "Espagne",        ja: "スペイン",   es: "España",         pt: "Espanha",       de: "Spanien",    ko: "스페인",   zh: "西班牙" },
    Brazil:        { en: "Brazil",        fr: "Brésil",         ja: "ブラジル",   es: "Brasil",         pt: "Brasil",        de: "Brasilien",  ko: "브라질",   zh: "巴西" },
    Portugal:      { en: "Portugal",      fr: "Portugal",       ja: "ポルトガル", es: "Portugal",       pt: "Portugal",      de: "Portugal",   ko: "포르투갈", zh: "葡萄牙" },
    Korea:         { en: "Korea",         fr: "Corée",          ja: "韓国",       es: "Corea",          pt: "Coreia",        de: "Korea",      ko: "한국",     zh: "韩国" },
    China:         { en: "China",         fr: "Chine",          ja: "中国",       es: "China",          pt: "China",         de: "China",      ko: "중국",     zh: "中国" },
    UnitedKingdom: { en: "United Kingdom",fr: "Royaume-Uni",    ja: "イギリス",   es: "Reino Unido",    pt: "Reino Unido",   de: "Vereinigtes Königreich", ko: "영국", zh: "英国" },
    UnitedStates:  { en: "United States", fr: "États-Unis",     ja: "アメリカ",   es: "Estados Unidos", pt: "Estados Unidos",de: "Vereinigte Staaten",     ko: "미국", zh: "美国" }
  };
  // Returns the localised country name for `country` in `lang`, falling
  // back to the canonical English country name if either is unknown.
  // Pure: no DOM, no Firebase. Callers: buildCohortPair (below) and any
  // future per-cohort rendering (e.g. cohort chips in the waiting room).
  function localCountryName(country, lang) {
    if (typeof country !== "string" || !country) return "";
    // tolerate "United Kingdom" / "united-kingdom" / "United_Kingdom"
    const key = country.replace(/[\s_-]+/g, "");
    const entry = COUNTRY_NAMES[key] || COUNTRY_NAMES[country];
    if (!entry) return country;
    const l = typeof lang === "string" ? lang : "en";
    if (typeof entry[l] === "string" && entry[l]) return entry[l];
    return entry.en || country;
  }

  // Builds the cohort-pair string for the active language from a COHORTS
  // array. Default join is "-" producing strings like:
  //   en: "France-Japan"           fr: "France-Japon"
  //   ja: "フランス-日本"          de: "Frankreich-Japan"
  // Adapts trivially to a 3-cohort partnership ("France-Japan-Korea").
  //
  // Falls back to the canonical English label "International" when the
  // cohorts list is empty/malformed — defensive, never returns a string
  // that would render the literal "undefined" in the UI.
  //
  // Pure: no DOM, no Firebase. Caller is expected to substitute the
  // returned string into an i18n template's "{cohortPair}" placeholder.
  function buildCohortPair(cohorts, lang, separator) {
    if (!Array.isArray(cohorts) || cohorts.length === 0) return "International";
    const sep = typeof separator === "string" ? separator : "-";
    const parts = [];
    for (const c of cohorts) {
      if (!c || typeof c !== "object") continue;
      const country = typeof c.country === "string" && c.country ? c.country : null;
      const fallback = typeof c.short === "string" && c.short ? c.short
                     : typeof c.id === "string" && c.id ? c.id : null;
      if (country) parts.push(localCountryName(country, lang));
      else if (fallback) parts.push(fallback);
    }
    if (parts.length === 0) return "International";
    return parts.join(sep);
  }

  // Applies `{cohortPair}` (and any future `{key}` placeholder) substitutions
  // to an i18n template string. Unknown placeholders are left as-is so a
  // missing substitution is visible rather than silently dropped. Pure.
  function applyTemplate(template, vars) {
    if (typeof template !== "string") return "";
    if (!vars || typeof vars !== "object") return template;
    return template.replace(/\{(\w+)\}/g, (m, k) => {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
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
    // R3-D4 — _superadminReset.by carries the SUPER-ADMIN's name (not a
    // student name), so the pool-derived linkage never matches it. Strip
    // the flag entirely from any pseudonymised export — it's a forensic
    // signal whose presence the operator runbook does not yet document,
    // and leaving it in would identify the operator by name.
    if (out && Object.prototype.hasOwnProperty.call(out, "_superadminReset")) {
      delete out._superadminReset;
    }
    // R3-D4 — _adminPresence.by likewise names the operator. Strip.
    if (out && Object.prototype.hasOwnProperty.call(out, "_adminPresence")) {
      delete out._adminPresence;
    }
    // R3-A1 — operator-name leaks in session.created.by and session.closed.by
    // would survive the pool-derived walker (operator usually never joins as
    // a student). Replace the operator name with a generic "Admin" so the
    // archive's audit trail is preserved (the timestamps stay) without
    // re-identifying the facilitator.
    ["created", "closed"].forEach(k => {
      if (out && out[k] && typeof out[k] === "object" &&
          typeof out[k].by === "string") {
        out[k].by = "Admin";
      }
    });

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
  // dedupeBallotsByStableId — collapse split-personality ballots
  // ---------------------------------------------------------------
  // R3-F1 fix. If a participant opens a new tab mid-vote (or refreshes
  // in a way that allocates a new clientId), their old ballot persists
  // under the old clientId in /votes/{decisionId}/ballots/{cid} and a
  // fresh vote lands under the new clientId — over-counting them by 1.
  //
  // This helper takes the raw ballots map (keyed by clientId, value is
  // `{ choice, at, stableId? }`) and returns a new map with at most one
  // ballot per stableId — keeping the MOST RECENT (max `at`) so that a
  // person who changes their mind in a fresh tab still wins. Ballots
  // without a stableId (legacy entries, pre-R3) are passed through
  // unchanged keyed by clientId — preserves prior behaviour for
  // pre-fix sessions.
  //
  // Pure: no DOM, no Firebase, no mutation of input.
  function dedupeBallotsByStableId(ballots) {
    if (!ballots || typeof ballots !== "object") return {};
    const byStable = {};   // stableId -> { cid, ballot }
    const passthrough = {}; // ballots without stableId
    Object.keys(ballots).forEach(cid => {
      const b = ballots[cid];
      if (!b || typeof b !== "object") return;
      const sid = (typeof b.stableId === "string" && b.stableId) ? b.stableId : null;
      if (!sid) { passthrough[cid] = b; return; }
      const existing = byStable[sid];
      const bAt = (typeof b.at === "number") ? b.at : 0;
      const eAt = (existing && typeof existing.ballot.at === "number") ? existing.ballot.at : -1;
      if (!existing || bAt >= eAt) {
        byStable[sid] = { cid: cid, ballot: b };
      }
    });
    const out = {};
    Object.keys(passthrough).forEach(cid => { out[cid] = passthrough[cid]; });
    Object.keys(byStable).forEach(sid => {
      const win = byStable[sid];
      out[win.cid] = win.ballot;
    });
    return out;
  }

  // ---------------------------------------------------------------
  // bestRoomFor — assign a single (late-joining) participant to a room
  // ---------------------------------------------------------------
  // R3-C3 fix. Picks the room with the lowest cost (= sameUni * 100 +
  // members * 10), but prefers any room still under the soft cap so a
  // facilitator who balanced 4×5 at start time doesn't end up with one
  // room of 8 after three late-joiners.
  //
  // Soft cap = ceil(assigned / roomCount) + 2 — a room is allowed to
  // grow two members beyond the per-room target. If every room is at or
  // beyond the cap (e.g. dozens of late-joiners), fall back to the
  // original min-cost pick so the function never refuses to place a
  // joiner.
  //
  // Pure: no DOM, no Firebase. assignedPool is an array of pool entries
  // (each with .room and .university); roomCount is the integer number
  // of rooms created at startSession() time. The function returns the
  // target room name.
  function bestRoomFor(person, assignedPool, roomCount, roomNamesList) {
    const rc = Math.max(1, parseInt(roomCount, 10) || 1);
    const names = Array.isArray(roomNamesList) && roomNamesList.length
      ? roomNamesList.slice(0, rc)
      : (function () {
          const out = [];
          for (let i = 1; i <= rc; i++) out.push("Room " + i);
          return out;
        })();
    const rooms = {};
    names.forEach(n => { rooms[n] = []; });
    (Array.isArray(assignedPool) ? assignedPool : []).forEach(p => {
      if (p && p.room && rooms[p.room]) rooms[p.room].push(p);
    });
    const assignedCount = (Array.isArray(assignedPool) ? assignedPool : [])
      .filter(p => p && !!p.room).length;
    const target = Math.ceil(assignedCount / rc);
    const softCap = target + 2;
    let best = names[0], bestCost = Infinity;
    let bestUnderCap = null, bestUnderCapCost = Infinity;
    const personUni = person && person.university;
    names.forEach(n => {
      const members = rooms[n];
      const sameUni = members.filter(m => m.university === personUni).length;
      const cost = sameUni * 100 + members.length * 10;
      if (cost < bestCost) { bestCost = cost; best = n; }
      if (members.length < softCap && cost < bestUnderCapCost) {
        bestUnderCapCost = cost; bestUnderCap = n;
      }
    });
    return bestUnderCap || best;
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
    localCountryName: localCountryName,
    buildCohortPair: buildCohortPair,
    applyTemplate: applyTemplate,
    pseudonymiseTree: pseudonymiseTree,
    pseudoCode: pseudoCode,
    bestRoomFor: bestRoomFor,
    dedupeBallotsByStableId: dedupeBallotsByStableId,
    // expose the constant so tests can assert it
    PBKDF2_ITERS_DEFAULT: PBKDF2_ITERS_DEFAULT
  };
});
