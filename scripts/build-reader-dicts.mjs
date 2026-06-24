/* scripts/build-reader-dicts.mjs — generate the offline reading-aid dictionaries.
 *
 * Phase 2 of the in-page reader (see reader-core.js / lang-reader.js): produces
 * the bundled, gzipped EN->JA and EN->FR dictionaries the "Word help" tool
 * falls back to for words the curated clinical glossary doesn't cover.
 *
 * Sources (both freely redistributable):
 *   EN->JA  EJDict (kujirahand/EJDict) — PUBLIC DOMAIN. Tab-separated
 *           `headword<TAB>japanese`, 26 alphabetical files under src/.
 *   EN->FR  WikDict en-fr (https://www.wikdict.com) — CC BY-SA, generated from
 *           Wiktionary. A SQLite `translation` table (written_rep -> trans_list,
 *           with score/importance for ranking).
 *
 * Output (committed under docs/Third_session/PBL_platform/dict/):
 *   en-ja.txt.gz, en-fr.txt.gz   — gzipped `key<TAB>gloss` text, one line per
 *                                   lowercased headword. Decompressed in the
 *                                   browser via DecompressionStream('gzip') and
 *                                   parsed into a Map (reader-dict.js).
 *   ATTRIBUTION.md               — license + source provenance (required by the
 *                                   WikDict CC BY-SA terms).
 *
 * This is a DEV tool, run by hand when refreshing the dictionaries — NOT part
 * of CI (it downloads ~30 MB). Raw downloads are cached under .dict-cache/
 * (gitignored) so re-runs are fast. Run:  node scripts/build-reader-dicts.mjs
 *
 * Requires Node >= 22.13.0 (or >= 23.4.0): `node:sqlite` (DatabaseSync) is only
 * available without the --experimental-sqlite flag from those versions on. The
 * repo's package.json engines.node is pinned accordingly.
 *
 * The byte output is deterministic (same sources + same code -> same gzip), so
 * the committed assets can be regenerated and diffed.
 */
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT_DIR = join(ROOT, "docs", "Third_session", "PBL_platform", "dict");
const CACHE = join(ROOT, ".dict-cache");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const EJDICT_BASE = "https://raw.githubusercontent.com/kujirahand/EJDict/master/src";
const WIKDICT_URL =
  "https://download.wikdict.com/dictionaries/sqlite/2_2024-03/en-fr.sqlite3";

async function cachedFetch(url, cacheName, asBuffer) {
  const path = join(CACHE, cacheName);
  if (existsSync(path)) return asBuffer ? readFileSync(path) : readFileSync(path, "utf8");
  process.stdout.write(`  fetching ${url}\n`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(path, buf);
  return asBuffer ? buf : buf.toString("utf8");
}

// Lowercase, strip EJDict's optional-letter brackets (`dollar[s]` -> `dollar`,
// `colo[u]r` -> `color`) and surrounding whitespace. Returns "" for junk.
function cleanKey(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function writeDict(name, map) {
  const lines = [];
  for (const [k, v] of map) if (k && v) lines.push(k + "\t" + v);
  lines.sort();
  const text = lines.join("\n") + "\n";
  const gz = gzipSync(text, { level: 9 });
  writeFileSync(join(OUT_DIR, name + ".gz"), gz);
  const kb = (n) => (n / 1024).toFixed(0) + " KB";
  console.log(`  ${name}.gz: ${map.size} entries, ${kb(text.length)} raw, ${kb(gz.length)} gzip`);
  return { entries: map.size, raw: text.length, gz: gz.length };
}

async function buildEnJa() {
  console.log("EN->JA (EJDict, public domain):");
  const map = new Map();
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    const txt = await cachedFetch(`${EJDICT_BASE}/${letter}.txt`, `ejdict-${letter}.txt`, false);
    for (const line of txt.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const key = cleanKey(line.slice(0, tab));
      const gloss = line.slice(tab + 1).replace(/\s+/g, " ").trim();
      if (!key || !gloss || map.has(key)) continue; // keep first definition per key
      map.set(key, gloss);
    }
  }
  return writeDict("en-ja.txt", map);
}

async function buildEnFr() {
  console.log("EN->FR (WikDict / Wiktionary, CC BY-SA):");
  const buf = await cachedFetch(WIKDICT_URL, "wikdict-en-fr.sqlite3", true);
  const dbPath = join(CACHE, "wikdict-en-fr.sqlite3");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  // Strongest senses first, so the first 3 distinct translations we keep per
  // headword are the best-ranked ones.
  const rows = db.prepare(`
    SELECT written_rep AS w, trans_list AS t
    FROM translation
    WHERE written_rep IS NOT NULL AND trans_list IS NOT NULL AND trans_list <> ''
    ORDER BY is_good DESC, score DESC, importance DESC
  `).all();
  const acc = new Map(); // key -> [fr...]
  for (const r of rows) {
    const key = cleanKey(r.w);
    const fr = String(r.t).replace(/\s+/g, " ").trim();
    if (!key || !fr) continue;
    let arr = acc.get(key);
    if (!arr) { arr = []; acc.set(key, arr); }
    if (arr.length < 3 && !arr.includes(fr)) arr.push(fr);
  }
  db.close();
  const map = new Map();
  for (const [k, arr] of acc) map.set(k, arr.join("; "));
  return writeDict("en-fr.txt", map);
}

function writeAttribution(ja, fr) {
  const md = `# Reading-aid dictionaries — sources & licenses

These bundled dictionaries power the in-page "Word help" reader's fallback
lookup (general vocabulary the curated clinical glossary doesn't cover). They
are generated by \`scripts/build-reader-dicts.mjs\`.

## EN -> JA (\`en-ja.txt.gz\`, ${ja.entries} entries)
- Source: **EJDict** — https://github.com/kujirahand/EJDict
- License: **Public Domain** (EJDict-hand). No attribution required; provenance
  recorded here for transparency.

## EN -> FR (\`en-fr.txt.gz\`, ${fr.entries} entries)
- Source: **WikDict** — https://www.wikdict.com — generated from **Wiktionary**.
- License: **CC BY-SA** (same as Wiktionary). Attribution: data derived from
  Wiktionary (https://www.wiktionary.org) via WikDict; the dictionary file is
  distributed under CC BY-SA, like its source.

Format: gzipped UTF-8 text, one \`headword<TAB>gloss\` line per lowercased
headword. Decompressed client-side via \`DecompressionStream('gzip')\`.
`;
  writeFileSync(join(OUT_DIR, "ATTRIBUTION.md"), md);
  console.log("  ATTRIBUTION.md written");
}

const ja = await buildEnJa();
const fr = await buildEnFr();
writeAttribution(ja, fr);
console.log("Done.");
