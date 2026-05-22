"use strict";
/* tests/_i18n_source.js — shared helper for source-text i18n assertions.
 *
 * #48 (i18n locale lazy-load) moved the non-English translation strings out
 * of i18n.js into locales/<lang>.js. Those chunks are still deployed and still
 * reach users (fetched on demand at runtime), so a test that asserts a
 * translated string "ships in fr/ja" is still valid — it just has to read the
 * COMBINED source: the inline English canonical table in i18n.js PLUS every
 * locale chunk. The locale files are the JSON.stringify of the original
 * per-language objects, so the "key": "value" text the regexes match is
 * byte-faithful to the pre-split source.
 *
 * Not a *.test.js file, so `node --test tests/*.test.js` never runs it as a
 * suite; it's a plain require()-able module.
 */
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const LOCALES = ["fr", "ja", "es", "pt", "de", "ko", "zh"];

function readI18nSource() {
  let src = fs.readFileSync(path.join(PLATFORM, "i18n.js"), "utf8");
  for (const lang of LOCALES) {
    src += "\n" + fs.readFileSync(path.join(PLATFORM, "locales", lang + ".js"), "utf8");
  }
  return src;
}

module.exports = { readI18nSource };
