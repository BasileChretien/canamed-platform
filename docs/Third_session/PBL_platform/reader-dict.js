/* reader-dict.js — lazy loader for the bundled general dictionaries (Phase 2).
 *
 * The "Word help" reader resolves a hovered word against the curated clinical
 * glossary first; for everyday words it misses, it falls back to a full
 * EN->JA / EN->FR dictionary. Those are large (~1.5-1.8 MB gzipped), so they
 * are NOT in the splash bundle or the service-worker precache — they're
 * fetched on demand the first time a FR/JA student turns the reader on, then
 * runtime-cached by the SW.
 *
 * Files: dict/en-fr.txt.gz, dict/en-ja.txt.gz — gzipped `headword<TAB>gloss`
 * text (built by scripts/build-reader-dicts.mjs). Decompressed in the browser
 * with DecompressionStream('gzip') and parsed once into a Map per language.
 * Everything stays on-device — no text is ever sent anywhere.
 *
 * Public: window.CanamedReaderDict
 *   ensureDict(lang) -> Promise<Map|null>   // load + cache (null if unavailable)
 *   getDict(lang)    -> Map|null            // sync accessor once loaded
 */
(function () {
  "use strict";

  var FILES = { fr: "dict/en-fr.txt.gz", ja: "dict/en-ja.txt.gz" };
  var cache = {};   // lang -> Map | Promise<Map|null>

  // Cache-bust in lockstep with the shell version (script-loader owns it).
  function version() {
    try {
      return (window.CanamedLoader && window.CanamedLoader.SHELL_VERSION) || "";
    } catch (e) { return ""; }
  }

  // DecompressionStream lands the gz body without a JS inflate lib. Absent on
  // older Safari (<16.4): degrade gracefully — the reader stays glossary-only.
  function supported() {
    return typeof DecompressionStream === "function" &&
      typeof fetch === "function" && typeof Response === "function";
  }

  function parseInto(text) {
    var map = new Map();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var tab = lines[i].indexOf("\t");
      if (tab > 0) map.set(lines[i].slice(0, tab), lines[i].slice(tab + 1));
    }
    return map;
  }

  function load(lang) {
    if (!supported() || !FILES[lang]) return Promise.resolve(null);
    var v = version();
    var url = FILES[lang] + (v ? "?v=" + v : "");
    return fetch(url).then(function (resp) {
      if (!resp || !resp.ok || !resp.body) return null;
      var stream = resp.body.pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).text().then(parseInto);
    });
  }

  function ensureDict(lang) {
    if (lang !== "fr" && lang !== "ja") return Promise.resolve(null);
    if (cache[lang] instanceof Map) return Promise.resolve(cache[lang]);
    if (cache[lang]) return cache[lang];                 // in-flight promise
    var p = load(lang).then(function (map) {
      cache[lang] = map || null;                         // cache result (null = unavailable)
      return cache[lang];
    }).catch(function () {
      cache[lang] = null;
      return null;
    });
    cache[lang] = p;
    return p;
  }

  function getDict(lang) {
    return cache[lang] instanceof Map ? cache[lang] : null;
  }

  window.CanamedReaderDict = { ensureDict: ensureDict, getDict: getDict };
})();
