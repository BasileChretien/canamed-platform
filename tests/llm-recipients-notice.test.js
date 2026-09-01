/* tests/llm-recipients-notice.test.js
 *
 * GDPR Art. 13(1)(e)/(f) requires the RECIPIENTS we publish to match the ones
 * that actually receive the data. For the simulated-patient chat, those two
 * facts live far apart:
 *
 *   - enforced: firebase-config.js (CANAMED_LLM_PROXY.url — the host the
 *     browser actually posts chat turns to) and the CSP connect-src that has
 *     to permit it, in BOTH index.html and firebase.json
 *   - published: privacy.html sections 6 and 7 (EN/FR/JA) and the in-product
 *     modA.chat.disclosure banner (i18n.js + fr/ja locales)
 *
 * Nothing tied those together, and the result was worse than drift: between
 * 2026-08-31 (the proxy going live on Scaleway) and 2026-09-01, the published
 * Art. 13 notice described the chat NOWHERE AT ALL — not the relay, not
 * Hugging Face, not the inference provider — in any of its three languages,
 * while participants were typing clinical free text into it. The missing
 * Scaleway line was the narrow version of the problem; the wide version was
 * that the most sensitive processing on the platform was undisclosed.
 *
 * This is the same shape as tests/retention-notice-consistency.test.js: derive
 * the truth from the ENFORCING source, then assert the published surfaces state
 * it. Deriving the host from firebase-config.js rather than hardcoding it is
 * the point — move the proxy to another provider and this test fails until the
 * notice is updated, which is exactly the moment the notice goes stale.
 *
 * NB it deliberately does NOT assert the reverse (that no unnamed recipient
 * exists). No file in this repo enumerates the onward chain, so a test claiming
 * to check it would be checking a hand-copied list against itself.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

// ---- the enforced side: what host does the browser actually post to? -------

const configSrc = read(PLATFORM, "firebase-config.js");

/* Strip /* … *​/ comments BEFORE looking for the assignment. The file's own
   doc-comment shows an EXAMPLE `window.CANAMED_LLM_PROXY = { url: … }`, and a
   naive match takes that instead of the live one — which is how the first run
   of this test reported the relay as Cloudflare while it had been Scaleway for
   a day. A test that reads the documentation instead of the configuration will
   pass or fail for reasons unrelated to what ships. */
const liveConfig = configSrc.replace(/\/\*[\s\S]*?\*\//g, "");

/* CANAMED_LLM_PROXY is either null (chat disabled -> nothing to disclose) or an
   object carrying the endpoint URL. Parse the url out rather than eval'ing the
   file, which expects a browser `window`. */
function proxyUrl() {
  const block = liveConfig.match(/window\.CANAMED_LLM_PROXY\s*=\s*([\s\S]*?);\s*\n/);
  assert.ok(block, "CANAMED_LLM_PROXY assignment not found in firebase-config.js");
  if (/^\s*null\s*$/.test(block[1])) return null;
  const url = block[1].match(/url\s*:\s*["']([^"']+)["']/);
  assert.ok(url, "CANAMED_LLM_PROXY is an object but carries no url");
  return url[1];
}

function hostOf(url) {
  const m = String(url).match(/^https:\/\/([^/]+)/);
  assert.ok(m, "proxy url is not an https origin: " + url);
  return m[1];
}

/* The relay's operator cannot be derived from the hostname — a domain does not
   name a company. It is asserted here so that changing provider forces a
   deliberate edit to this list AND to the notice, rather than one or the other.
   Keyed by the DNS suffix that identifies the provider. */
const RELAY_OPERATORS = [
  { suffix: ".scw.cloud", name: "Scaleway" },
  { suffix: ".workers.dev", name: "Cloudflare" },
  { suffix: ".deno.dev", name: "Deno" },
  { suffix: ".vercel.app", name: "Vercel" },
];

function operatorFor(host) {
  const hit = RELAY_OPERATORS.find((o) => host.endsWith(o.suffix));
  assert.ok(
    hit,
    "the LLM proxy is hosted at '" + host + "', whose operator this test cannot name.\n" +
      "Add it to RELAY_OPERATORS *and* name it in privacy.html sections 6 and 7 " +
      "(EN/FR/JA) and in modA.chat.disclosure. A relay that the notice does not " +
      "name is an undisclosed recipient."
  );
  return hit.name;
}

// ---- the published side ----------------------------------------------------

const privacyHtml = read(PLATFORM, "privacy.html");

/* privacy.html carries all three legal bodies in one file, as
   <section data-priv-lang="en|fr|ja">. Split so a recipient named in only one
   language is still a failure — the FR and JA bodies are not decoration, they
   are the notice served to French and Japanese participants. */
function privacySections() {
  const out = {};
  const re = /<section data-priv-lang="(en|fr|ja)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(privacyHtml))) out[m[1]] = m[2];
  return out;
}

/* Narrow to the OPERATIVE sections — "6. Recipients" through the end of
   "7. International transfers" — rather than searching the whole language body.
   The section-16 changelog necessarily names Scaleway and says "outside the
   EEA" in order to describe what this version changed, so a whole-body search
   is satisfied by the changelog alone. That is not a hypothetical: the first
   mutation run of this test could not detect the disclosure being deleted from
   section 6, because the changelog still mentioned it. The heading NUMBER is
   the same in all three languages even though the wording is not, so slice on
   that. */
/* Collapse whitespace before matching. privacy.html is hand-wrapped source, so a
   phrase like "Data Privacy Framework" can be split across a line break and an
   indent — a literal multi-word regex then fails on correct content, and, worse,
   a deletion could hide behind a re-wrap. Every match in this file runs against
   the normalised text for that reason. */
const flat = (t) => String(t).replace(/\s+/g, " ");

function recipientsAndTransfers(body, lang) {
  const start = body.indexOf("<h2>6.");
  const end = body.indexOf("<h2>8.");
  assert.ok(start >= 0, "no section 6 heading in the " + lang + " body");
  assert.ok(end > start, "no section 8 heading after section 6 in the " + lang + " body");
  return flat(body.slice(start, end));
}

test("privacy.html carries all three published language bodies", () => {
  const s = privacySections();
  assert.deepStrictEqual(Object.keys(s).sort(), ["en", "fr", "ja"]);
  for (const k of ["en", "fr", "ja"]) {
    assert.ok(s[k].length > 2000, k + " body is implausibly short (" + s[k].length + " chars)");
  }
});

test("the LLM relay's operator is named in the notice, in every language", () => {
  const url = proxyUrl();
  if (url === null) return; // chat disabled: nothing to disclose
  const operator = operatorFor(hostOf(url));
  const s = privacySections();
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(
      recipientsAndTransfers(s[lang], lang).includes(operator),
      "privacy.html [" + lang + "] does not name '" + operator + "', which is the host " +
        "the browser posts chat turns to (" + url + ").\n" +
        "Art. 13(1)(e): a recipient the notice does not name is an undisclosed recipient."
    );
  }
});

test("the onward chain is named too — routing and model execution", () => {
  if (proxyUrl() === null) return;
  /* The relay is not the only recipient: it forwards to a router, which
     forwards to whoever executes the model. Both were undisclosed before
     PIS v4. Derived from the proxy's own defaults so that changing them
     surfaces here. */
  const handler = read(ROOT, "proxy", "src", "handler.js");
  assert.ok(/HF_DEFAULT_PROVIDER\s*=\s*["']ovhcloud["']/.test(handler),
    "the pinned inference provider changed; update this test and the notice");

  const s = privacySections();
  for (const lang of ["en", "fr", "ja"]) {
    const sec = recipientsAndTransfers(s[lang], lang);
    assert.ok(sec.includes("Hugging Face"),
      "privacy.html [" + lang + "] sections 6-7 do not name the routing step (Hugging Face)");
    assert.ok(/OVHcloud/i.test(sec),
      "privacy.html [" + lang + "] sections 6-7 do not name who executes the model (OVHcloud)");
  }
});

test("the non-EEA leg is disclosed, not just the recipients", () => {
  if (proxyUrl() === null) return;
  /* Naming Hugging Face without saying the hop leaves the EEA would satisfy
     Art. 13(1)(e) and miss Art. 13(1)(f). The three bodies say it in their own
     language, so match each one's own wording rather than an English token. */
  const s = privacySections();
  const eeaClaim = { en: /outside the EEA/i, fr: /hors\s+EEE/i, ja: /EEA域外/ };
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(eeaClaim[lang].test(recipientsAndTransfers(s[lang], lang)),
      "privacy.html [" + lang + "] names the recipients but never says the routing " +
        "step leaves the EEA (Art. 13(1)(f))");
  }
});

test("the in-product chat banner names the relay operator too", () => {
  const url = proxyUrl();
  if (url === null) return;
  const operator = operatorFor(hostOf(url));
  /* The banner sits above the chat box and is the only disclosure a participant
     sees at the moment they type. It exists in EN (i18n.js) + fr/ja; the other
     five locales fall back to the English string. */
  const surfaces = [
    ["i18n.js", read(PLATFORM, "i18n.js")],
    ["locales/fr.js", read(PLATFORM, "locales", "fr.js")],
    ["locales/ja.js", read(PLATFORM, "locales", "ja.js")],
  ];
  for (const [name, src] of surfaces) {
    const line = src.split("\n").find((l) => l.includes("modA.chat.disclosure"));
    assert.ok(line, name + " has no modA.chat.disclosure string");
    assert.ok(
      line.includes(operator),
      name + "'s modA.chat.disclosure does not name '" + operator + "'.\n" +
        "It previously said the questions go to \"our server\", which stopped being " +
        "true when the relay moved off Google's platform."
    );
  }
});

test("the notice version was bumped past the version that omitted all this", () => {
  /* PIS v3 described the chat nowhere. Any notice still DECLARING v3 while the
     proxy is configured is the pre-correction text.

     Match the declaration form "PIS v<n> · <date>", not the bare token: the
     changelog has to say "Material changes since PIS v3" to describe what this
     version changed, and a test that forbade every mention of v3 would forbid
     the sentence explaining the fix. */
  if (proxyUrl() === null) return;
  const declared = [...privacyHtml.matchAll(/PIS v(\d+)\s*·/g)].map((m) => Number(m[1]));
  assert.ok(declared.length > 0, "privacy.html declares no notice version at all");
  for (const v of declared) {
    assert.ok(v >= 4,
      "privacy.html still declares notice version PIS v" + v + " · …; v3 and " +
        "earlier predate the simulated-patient disclosure");
  }
  const i18n = read(PLATFORM, "i18n.js");
  const line = i18n.split("\n").find((l) => l.includes("lobby.consent-version\""));
  assert.ok(line, "i18n.js has no lobby.consent-version string");
  const consent = line.match(/PIS v(\d+)\s*·/);
  assert.ok(consent && Number(consent[1]) >= 4,
    "the consent form still shows notice version " + (consent ? consent[0] : "(none)"));
});
