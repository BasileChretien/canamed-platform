/* tests/ops-transfer-notice.test.js
 *
 * The scheduled maintenance jobs are a RECIPIENT and an international TRANSFER,
 * and the Art. 13 notice has to say so. Those facts live in two places that
 * nothing connected:
 *
 *   - enforced: .github/workflows/*.yml (which jobs actually have a live cron)
 *     and the scripts they run (which of those pull the session tree onto the
 *     runner)
 *   - published: privacy.html sections 6 and 7, EN/FR/JA
 *
 * The notice omitted this entirely until PIS v5. The reason it stayed invisible
 * is worth recording, because it is the trap this test exists to catch: the DPA
 * DID describe the transfer, but attributed it to the nightly BACKUP job. When
 * the backup was disabled on 2026-08-31 (no GCS on the Spark plan), it would
 * have been natural to conclude the transfer had stopped. It had not — two
 * OTHER jobs are still scheduled and each deep-reads the whole tree:
 *
 *   - scripts/firebase-cost-monitor.js  — db.ref("sessions").once("value")
 *   - scripts/cleanup-stale-sessions.js — via lib/session-trees.js, which reads
 *     `sessions` and `orgs` in full even though it uses only two timestamps
 *
 * So the test derives from what is SCHEDULED and what those scripts READ,
 * rather than from any job's name. Disable the backup and nothing here changes;
 * disable the cost monitor and the purge job, and the obligation genuinely goes
 * away and this test relaxes with it.
 *
 * NB the second of those reads is a data-minimisation defect in its own right
 * (Art. 5(1)(c)): the purge job needs `created/at` and `closed/at`, not the
 * bodies. Narrowing it is a change to a live retention job, so it is tracked
 * separately rather than bundled into a notice fix — but if it ever lands, this
 * test is where the notice's claim should be revisited.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

// ---- the enforced side -----------------------------------------------------

/* A `cron:` line that is COMMENTED OUT does not schedule anything. Both
   disabled workflows keep their cron as a comment so it can be restored, so
   matching the bare word would count them as live and make this test assert an
   obligation the platform no longer has. Require the line to start with a
   list-item dash before any `#`. */
function liveCrons(yml) {
  return yml
    .split("\n")
    .filter((l) => /^\s*-\s*cron:/.test(l) && !/^\s*#/.test(l)).length;
}

function scheduledWorkflows() {
  const dir = path.join(ROOT, ".github", "workflows");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => ({ file: f, yml: fs.readFileSync(path.join(dir, f), "utf8") }))
    .filter((w) => liveCrons(w.yml) > 0);
}

/* Which repo scripts does a workflow invoke? `node scripts/<name>.js` */
function scriptsOf(yml) {
  return [...yml.matchAll(/node\s+(scripts\/[\w./-]+\.js)/g)].map((m) => m[1]);
}

/* Does this script — or a lib it requires — read the session tree wholesale?
   One level of require() is enough here: session-trees.js is the only indirect
   reader, and a deeper walk would buy nothing but flakiness. */
function deepReadsSessions(rel, seen = new Set()) {
  if (seen.has(rel)) return false;
  seen.add(rel);
  let src;
  try {
    src = read(ROOT, rel);
  } catch {
    return false;
  }
  if (/\.ref\(\s*["'`]sessions["'`]\s*\)\s*\.once\(/.test(src)) return true;
  if (/\.ref\(\s*["'`]orgs["'`]\s*\)\s*\.once\(/.test(src)) return true;
  for (const m of src.matchAll(/require\(["'](\.\/[\w./-]+)["']\)/g)) {
    const dep = path.posix.join(path.posix.dirname(rel), m[1]);
    const cand = dep.endsWith(".js") ? dep : dep + ".js";
    if (deepReadsSessions(cand, seen)) return true;
  }
  return false;
}

function jobsReadingTheSessionTree() {
  const out = [];
  for (const w of scheduledWorkflows()) {
    for (const s of scriptsOf(w.yml)) {
      if (deepReadsSessions(s)) out.push({ workflow: w.file, script: s });
    }
  }
  return out;
}

// ---- the published side ----------------------------------------------------

const privacyHtml = read(PLATFORM, "privacy.html");

function privacySections() {
  const out = {};
  const re = /<section data-priv-lang="(en|fr|ja)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(privacyHtml))) out[m[1]] = m[2];
  return out;
}

/* Sections 6-7 only. The section-16 changelog describes this very change, so a
   whole-body search would be satisfied by the changelog alone — the same
   false-pass that llm-recipients-notice.test.js had to be narrowed to avoid. */
function recipientsAndTransfers(body, lang) {
  const start = body.indexOf("<h2>6.");
  const end = body.indexOf("<h2>8.");
  assert.ok(start >= 0 && end > start, "sections 6-7 not found in the " + lang + " body");
  return body.slice(start, end);
}

// ---- tests -----------------------------------------------------------------

test("the derivation finds the scheduled jobs that read the session tree", () => {
  /* Anti-vacuity. Every assertion below is conditional on this list being
     non-empty, so if the derivation silently broke — a renamed script, a
     reworded `node` invocation — the rest would pass by doing nothing. */
  const jobs = jobsReadingTheSessionTree();
  assert.ok(
    jobs.length > 0,
    "no scheduled workflow was found to deep-read the session tree.\n" +
      "If that is genuinely true now, this file's obligation has lapsed and the " +
      "notice can be revisited. If it is not true, the derivation is broken and " +
      "every other test here is passing vacuously."
  );
});

test("GitHub is named as a recipient, in every published language", () => {
  if (jobsReadingTheSessionTree().length === 0) return;
  const s = privacySections();
  for (const lang of ["en", "fr", "ja"]) {
    const sec = recipientsAndTransfers(s[lang], lang);
    assert.ok(
      /GitHub/.test(sec),
      "privacy.html [" + lang + "] sections 6-7 do not name GitHub, which reads the " +
        "whole session database onto its runners on a schedule.\n" +
        "Art. 13(1)(e): a recipient the notice does not name is an undisclosed recipient."
    );
  }
});

test("the transfer out of the EEA is disclosed, not just the recipient", () => {
  if (jobsReadingTheSessionTree().length === 0) return;
  const s = privacySections();
  /* Each body says it in its own language; matching an English token against
     the JA body would pass for the wrong reason. */
  const outside = { en: /outside the EEA/i, fr: /hors\s+EEE/i, ja: /EEA域外/ };
  const us = { en: /United States/i, fr: /États-Unis/i, ja: /米国/ };
  for (const lang of ["en", "fr", "ja"]) {
    const sec = recipientsAndTransfers(s[lang], lang);
    assert.ok(outside[lang].test(sec),
      "privacy.html [" + lang + "] never says this processing leaves the EEA (Art. 13(1)(f))");
    assert.ok(us[lang].test(sec),
      "privacy.html [" + lang + "] does not say where it goes (the United States)");
  }
});

test("the notice does not claim a transfer safeguard the DPA calls unresolved", () => {
  /* The one thing worse than omitting the transfer is asserting a mechanism
     that has not been established. GitHub's DPA does incorporate the SCCs, but
     its scope is tied to the Customer Agreement and it is not established that
     a free-plan public repo falls inside it — so Annex III row #5 records the
     mechanism as UNRESOLVED. The published notice must not get ahead of that.
     This test fails if the DPA still says unresolved while the notice has
     started claiming coverage. */
  if (jobsReadingTheSessionTree().length === 0) return;
  const dpa = read(PLATFORM, "legal", "dpa-draft.md");
  const unresolved = /Transfer mechanism UNRESOLVED/.test(dpa);
  if (!unresolved) return; // the question was settled; this guard steps aside

  const en = recipientsAndTransfers(privacySections().en, "en");
  assert.ok(
    /(not yet been confirmed|being confirmed)/i.test(en),
    "Annex III row #5 still records the GitHub transfer mechanism as UNRESOLVED, " +
      "but privacy.html no longer says the safeguard is unconfirmed. Either the " +
      "DPA row was settled and should say so, or the notice is overclaiming."
  );
});

test("the notice version moved past the one that omitted this", () => {
  if (jobsReadingTheSessionTree().length === 0) return;
  const declared = [...privacyHtml.matchAll(/PIS v(\d+)\s*·/g)].map((m) => Number(m[1]));
  assert.ok(declared.length > 0, "privacy.html declares no notice version");
  for (const v of declared) {
    assert.ok(v >= 5,
      "privacy.html still declares PIS v" + v + " · …; v4 and earlier predate the " +
        "GitHub Actions disclosure");
  }
});
