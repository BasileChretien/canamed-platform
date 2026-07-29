/* tests/retention-notice-consistency.test.js
 *
 * GDPR Art. 13 requires the retention period we PUBLISH to match the one we
 * actually ENFORCE. Those two facts live far apart in this repo:
 *
 *   - enforced: scripts/cleanup-stale-sessions.js (CLEANUP_RETENTION_CLOSED_DAYS
 *     / CLEANUP_RETENTION_OPEN_DAYS defaults) + the values the daily workflow
 *     passes in .github/workflows/cleanup-stale-sessions.yml
 *   - published: privacy.html section 8 (EN/FR/JA), the lobby.privacy.p3 key in
 *     i18n.js, its seven locales/*.js translations, and the hardcoded fallback
 *     paragraph in index.html
 *
 * Nothing tied those together, so they silently disagreed for months: the notice
 * promised "purged within 7 days" while the deployed job kept closed sessions 30
 * days and abandoned ones 90. That was caught by hand on 2026-07-29 while
 * preparing the CER Unicaen ethics dossier — exactly the kind of drift a human
 * only finds by luck. These tests make the agreement mechanical.
 *
 * If you change the retention policy, change it in the script/workflow AND in
 * every published string; these tests tell you which one you forgot.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");

const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

// ---- the enforced side -----------------------------------------------------

const cleanupSrc = read(ROOT, "scripts", "cleanup-stale-sessions.js");

function enforcedDefault(envVar) {
  // e.g. process.env.CLEANUP_RETENTION_CLOSED_DAYS || "30"
  const m = cleanupSrc.match(
    new RegExp(`process\\.env\\.${envVar}\\s*\\|\\|\\s*"(\\d+)"`)
  );
  assert.ok(m, `could not read the ${envVar} default out of cleanup-stale-sessions.js`);
  return Number(m[1]);
}

const CLOSED_DAYS = enforcedDefault("CLEANUP_RETENTION_CLOSED_DAYS");
const OPEN_DAYS = enforcedDefault("CLEANUP_RETENTION_OPEN_DAYS");

test("retention: the scheduled workflow passes the same days as the script defaults", () => {
  const wf = read(ROOT, ".github", "workflows", "cleanup-stale-sessions.yml");
  // The workflow pins the values explicitly for scheduled runs; a mismatch here
  // means production purges on a different clock than the script's documented
  // default, and the notice can only agree with one of them.
  const closed = wf.match(/CLEANUP_RETENTION_CLOSED_DAYS:.*?'(\d+)'/);
  const open = wf.match(/CLEANUP_RETENTION_OPEN_DAYS:\s*.*?'(\d+)'/);
  assert.ok(closed, "workflow does not pin CLEANUP_RETENTION_CLOSED_DAYS");
  assert.ok(open, "workflow does not pin CLEANUP_RETENTION_OPEN_DAYS");
  assert.strictEqual(Number(closed[1]), CLOSED_DAYS,
    "workflow closed-retention disagrees with the script default");
  assert.strictEqual(Number(open[1]), OPEN_DAYS,
    "workflow open-retention disagrees with the script default");
});

// ---- the published side ----------------------------------------------------

// Every published surface that states the live-session retention period. Each
// entry yields the one string a participant actually reads.
function publishedStrings() {
  const out = [];

  // lobby.privacy.p3 — English canonical in i18n.js, translations in locales/.
  const i18nSrc = read(PLATFORM, "i18n.js");
  const enP3 = i18nSrc.match(/"lobby\.privacy\.p3":\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(enP3, "i18n.js is missing lobby.privacy.p3");
  out.push({ where: "i18n.js lobby.privacy.p3 (en)", text: enP3[1] });

  const localeDir = path.join(PLATFORM, "locales");
  for (const f of fs.readdirSync(localeDir).filter(f => f.endsWith(".js"))) {
    const m = read(localeDir, f).match(/"lobby\.privacy\.p3":\s*"((?:[^"\\]|\\.)*)"/);
    assert.ok(m, `locales/${f} is missing lobby.privacy.p3`);
    out.push({ where: `locales/${f} lobby.privacy.p3`, text: m[1] });
  }

  // The hardcoded fallback paragraph in index.html, shown before i18n applies.
  const indexSrc = read(PLATFORM, "index.html");
  const fallback = indexSrc.match(
    /<p data-i18n-html="lobby\.privacy\.p3">([\s\S]*?)<\/p>/
  );
  assert.ok(fallback, "index.html is missing the lobby.privacy.p3 fallback paragraph");
  out.push({ where: "index.html lobby.privacy.p3 fallback", text: fallback[1] });

  // privacy.html section 8 — one <ul> per language (EN/FR/JA).
  const privacySrc = read(PLATFORM, "privacy.html");
  const sections = privacySrc.match(
    /<h2>8\.[^<]*<\/h2>\s*<ul>([\s\S]*?)<\/ul>/g
  ) || [];
  assert.strictEqual(sections.length, 3,
    "expected exactly 3 language variants of privacy.html section 8, got " + sections.length);
  sections.forEach((s, i) => {
    const firstLi = s.match(/<li>([\s\S]*?)<\/li>/);
    assert.ok(firstLi, `privacy.html section 8 variant ${i} has no <li>`);
    out.push({ where: `privacy.html section 8 variant ${i + 1}`, text: firstLi[1] });
  });

  return out;
}

const PUBLISHED = publishedStrings();

test("retention: every published notice covers all 8 languages plus the two HTML surfaces", () => {
  // 1 (i18n en) + 7 locales + 1 (index fallback) + 3 (privacy.html) = 12.
  assert.strictEqual(PUBLISHED.length, 12,
    "a published retention surface was added or removed — update this test:\n" +
    PUBLISHED.map(p => "  " + p.where).join("\n"));
});

test("retention: every published notice states the ENFORCED closed-session period", () => {
  for (const { where, text } of PUBLISHED) {
    assert.ok(new RegExp(`\\b${CLOSED_DAYS}\\b`).test(text),
      `${where} does not state the enforced closed-session retention (${CLOSED_DAYS} days).\n` +
      `  got: ${text.replace(/\s+/g, " ").trim()}`);
  }
});

test("retention: every published notice states the ENFORCED abandoned-session period", () => {
  for (const { where, text } of PUBLISHED) {
    assert.ok(new RegExp(`\\b${OPEN_DAYS}\\b`).test(text),
      `${where} does not state the enforced abandoned-session retention (${OPEN_DAYS} days).\n` +
      `  got: ${text.replace(/\s+/g, " ").trim()}`);
  }
});

test("retention: no published notice still claims the old 7-day purge", () => {
  // The literal defect this suite exists to prevent. Matches "7 days", "7 jours",
  // "7日", "7 días", "7 Tagen", "7 dias", "7일", "7 天" — but not "30"/"90"/"7 %".
  const STALE = /(?:^|[^\d])7\s*(?:days?|jours?|日|d[ií]as?|Tagen?|일|天)/;
  for (const { where, text } of PUBLISHED) {
    assert.ok(!STALE.test(text),
      `${where} still claims a 7-day purge, contradicting the deployed job.\n` +
      `  got: ${text.replace(/\s+/g, " ").trim()}`);
  }
});

test("retention: the research dataset is described as identifiable, never pseudonymised", () => {
  // The same sentence also states how the research copy is STORED. privacy.html
  // and the CER dossier both declare it kept LINKED to the participant
  // (identifiable) for up to 5 years; five locale files and the index.html
  // fallback used to say "pseudonymised", which is a materially different Art. 13
  // claim and would have made those participants' consent rest on a false premise.
  // (Publishing pseudonymised is a separate, accurate claim made by
  // lobby.consent-research — that key is deliberately not checked here.)
  const PSEUDO = /pseudonym|pseudonim|seudonim|가명화|假名化/i;
  for (const { where, text } of PUBLISHED) {
    assert.ok(!PSEUDO.test(text),
      `${where} describes the research dataset as pseudonymised, but it is stored identifiably.\n` +
      `  got: ${text.replace(/\s+/g, " ").trim()}`);
  }
});
