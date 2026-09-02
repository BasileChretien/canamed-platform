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
  /* e.g. retentionDays("CLEANUP_RETENTION_CLOSED_DAYS", 30)
     Was `process.env.<VAR> || "30"` until 2026-08-12, when the windows moved
     behind a validator — a free-form workflow input reaching parseInt() meant
     "-1" put the cutoff in the FUTURE and deleted live data. The older form is
     still accepted so this guard keeps working on either shape rather than
     going quiet, which for a consistency check is the failure that matters. */
  const m = cleanupSrc.match(new RegExp(`retentionDays\\("${envVar}",\\s*(\\d+)\\)`))
    || cleanupSrc.match(new RegExp(`process\\.env\\.${envVar}\\s*\\|\\|\\s*"(\\d+)"`));
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

  // privacy.html section 8 — one <ul> per language (EN/FR/JA). The live-session
  // period is the FIRST <li>; the research-storage claim is a separate <li>
  // collected by researchStorageStrings() below.
  sections8().forEach((s, i) => {
    const firstLi = s.match(/<li>([\s\S]*?)<\/li>/);
    assert.ok(firstLi, `privacy.html section 8 variant ${i} has no <li>`);
    out.push({ where: `privacy.html section 8 variant ${i + 1}`, text: firstLi[1] });
  });

  return out;
}

// privacy.html section 8, one <ul> per language, in EN/FR/JA document order.
function sections8() {
  const privacySrc = read(PLATFORM, "privacy.html");
  const sections = privacySrc.match(
    /<h2>8\.[^<]*<\/h2>\s*<ul>([\s\S]*?)<\/ul>/g
  ) || [];
  assert.strictEqual(sections.length, 3,
    "expected exactly 3 language variants of privacy.html section 8, got " + sections.length);
  return sections;
}

// The research-dataset <li> of each privacy.html section 8. Kept separate from
// PUBLISHED because it makes a DIFFERENT claim (how the research copy is stored)
// from the live-session retention period, and because a negative-only check
// would pass if the disclosure were deleted outright.
const RESEARCH_STORAGE = [
  // [document order, the localized wording that must be present]
  { lang: "en", must: /stored\s+linked\s+to\s+you\s*\(identifiable\)/i, years: /5\s*years/i },
  { lang: "fr", must: /conservé\s+de\s+façon\s+nominative\s*\(identifiable\)/i, years: /5\s*ans/i },
  { lang: "ja", must: /紐づけた\s*\(\s*識別可能な\s*\)\s*形式/, years: /最長\s*5\s*年/ },
].map((spec, i) => {
  /* Select the research-dataset item BY CONTENT, not by position. This read
     `lis[1]` until 2026-09-02, when PIS v10 inserted a backup-persistence item
     ahead of it and the test failed on a CORRECT notice. A positional selector
     makes any future addition to section 8 look like a deleted disclosure. */
  const lis = (sections8()[i].match(/<li>([\s\S]*?)<\/li>/g) || [])
    .map((li) => li.replace(/<[^>]+>/g, ""));
  const hits = lis.filter((t) => spec.must.test(t));
  assert.strictEqual(hits.length, 1,
    `privacy.html section 8 variant ${i + 1} (${spec.lang}): expected exactly ` +
    `one <li> matching ${spec.must} for the research-dataset disclosure, found ` +
    `${hits.length}. Zero means it was deleted or reworded; more than one means ` +
    `the pattern no longer identifies it uniquely.`);
  return { ...spec, where: `privacy.html section 8 (${spec.lang}) research-dataset item`,
           text: hits[0] };
});

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

test("retention: privacy.html POSITIVELY discloses identifiable research storage", () => {
  // The negative check above would also pass if the disclosure were deleted
  // outright — silence is not compliance for an Art. 13 notice. Assert the
  // claim is actually present, in each language, with its 5-year period.
  for (const { where, must, years, text } of RESEARCH_STORAGE) {
    assert.ok(must.test(text),
      `${where} no longer states that the research dataset is stored linked to the ` +
      `participant (identifiable).\n  got: ${text.replace(/\s+/g, " ").trim()}`);
    assert.ok(years.test(text),
      `${where} no longer states the 5-year research retention.\n` +
      `  got: ${text.replace(/\s+/g, " ").trim()}`);
  }
});

test("retention: the research-storage claim is never described as pseudonymised either", () => {
  const PSEUDO = /pseudonym|pseudonim|seudonim|仮名|가명화|假名化/i;
  for (const { where, text } of RESEARCH_STORAGE) {
    assert.ok(!PSEUDO.test(text),
      `${where} describes the research dataset as pseudonymised, but it is stored identifiably.\n` +
      `  got: ${text.replace(/\s+/g, " ").trim()}`);
  }
});

// ---- the archive half (PIS v10, 2026-09-02) --------------------------------
//
// The purge is not the end of the story: a copy of every session rides in the
// nightly backups, whose objects expire on their own clock. Until PIS v10 the
// notice said "purged within 30/90 days" and stopped there, so a participant
// reading it would conclude their data was gone months before the last copy
// actually expired. That is the SAME defect as the 7-day claim this file was
// written for, one layer down — a published period contradicted by an enforcing
// constant nothing linked it to.
//
// Deferred erasure from backups can be lawful; silently deferred erasure cannot.
// So the horizon is derived here and every published surface must state it.

const ARCHIVE_DAYS = (() => {
  const doc = JSON.parse(read(ROOT, "scripts", "ops", "pii-bucket-lifecycle.json"));
  const rule = (doc.rule || doc.rules || []).find((r) =>
    (r.condition?.matchesPrefix || []).includes("backups/"));
  assert.ok(rule, "pii-bucket-lifecycle.json has no rule for the backups/ prefix");
  assert.strictEqual(rule.action?.type, "Delete",
    "the backups/ lifecycle rule does not delete, so nothing bounds the archive");
  return rule.condition.age;
})();

const CLOSED_HORIZON = CLOSED_DAYS + ARCHIVE_DAYS;
const OPEN_HORIZON = OPEN_DAYS + ARCHIVE_DAYS;

/* PUBLISHED takes only the FIRST <li> of each privacy.html section 8, because
   that is where the purge window lives. The archive disclosure is a second <li>
   beside it, so these checks read the whole <ul> for the long-form notice — the
   participant reads the list, not one bullet. The nine short surfaces are
   single strings and are used unchanged. Deliberately a separate list rather
   than a widened PUBLISHED: the existing assertions are calibrated to the
   narrow one, and widening it silently would change what they mean. */
const ARCHIVE_SURFACES = [
  ...PUBLISHED.filter((p) => !p.where.startsWith("privacy.html")),
  ...sections8().map((s, i) => ({
    where: `privacy.html section 8 variant ${i + 1} (whole list)`,
    text: s.replace(/<[^>]+>/g, " "),
  })),
];

test("archive: the horizon actually exceeds the published purge window", () => {
  /* Anti-vacuity. If the archive were ever shortened to nothing, every
     assertion below would be describing a disclosure that should be REMOVED
     rather than kept — and a test demanding stale text is worse than none. */
  assert.ok(ARCHIVE_DAYS > 0,
    `archive lifetime is ${ARCHIVE_DAYS} days; the disclosure this file pins ` +
    `assumes backups outlive the purge. If that stopped being true, delete the ` +
    `archive sentences from all 12 surfaces instead of updating them.`);
  assert.ok(CLOSED_HORIZON > CLOSED_DAYS && OPEN_HORIZON > OPEN_DAYS,
    "the archive no longer extends the retention horizon");
});

test("archive: all 12 published surfaces state the real erasure horizon", () => {
  const missing = ARCHIVE_SURFACES.filter(
    (p) => !p.text.includes(String(CLOSED_HORIZON))
  );
  assert.deepStrictEqual(missing.map((m) => m.where), [],
    `these surfaces do not state the ${CLOSED_HORIZON}-day horizon ` +
    `(${CLOSED_DAYS}-day purge + ${ARCHIVE_DAYS}-day archive). A participant ` +
    `reading them would believe their data is gone ${CLOSED_DAYS} days after a ` +
    `session closes. If you changed either constant, every one of the 12 ` +
    `surfaces needs the new figure — and PIS/LOCALE/SHELL versions need bumping ` +
    `or returning browsers keep serving the old text.`);
});

test("archive: the long-form notice also states the never-closed horizon", () => {
  // Only privacy.html has room for both figures; the join-screen summary
  // deliberately carries the common case only.
  const longForm = ARCHIVE_SURFACES.filter((p) => p.where.startsWith("privacy.html"));
  assert.strictEqual(longForm.length, 3, "expected 3 privacy.html variants");
  const missing = longForm.filter((p) => !p.text.includes(String(OPEN_HORIZON)));
  assert.deepStrictEqual(missing.map((m) => m.where), [],
    `privacy.html must also state the ${OPEN_HORIZON}-day horizon for sessions ` +
    `that are never closed (${OPEN_DAYS}-day purge + ${ARCHIVE_DAYS}-day archive).`);
});

test("archive: no surface still promises deletion without mentioning backups", () => {
  /* The failure mode is not a wrong number, it is a TRUE number presented as
     the whole truth — which is exactly how the 7-day claim survived for months.
     Each surface stating a purge window must also carry a backup word. */
  const BACKUP_WORDS =
    /backup|sauvegarde|sicherung|copias de seguridad|backups|バックアップ|백업|备份/i;
  const bad = ARCHIVE_SURFACES.filter((p) => !BACKUP_WORDS.test(p.text));
  assert.deepStrictEqual(bad.map((b) => b.where), [],
    "these surfaces state a retention period without disclosing that a copy " +
    "survives in the nightly backups");
});
