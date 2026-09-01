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
 * OTHER scheduled jobs were each deep-reading the whole tree.
 *
 * So the test derives from what is SCHEDULED and what those scripts READ,
 * rather than from any job's name. Disable the backup and nothing here changes.
 *
 * BOTH have since been fixed — the purge in PIS v6, the storage monitor in
 * PIS v7 — so NO scheduled job reads session content any more. The monitor's
 * case was the more interesting one: sizing a tree means reading it, RTDB
 * exposes no size API, and the number it produced was 0.003% of the cap it
 * guarded. The measurement cost more than it bought, so it became opt-in and a
 * content-free count tripwire took over the alarm.
 *
 * THE OBLIGATION DID NOT GO AWAY WITH IT, and that is why this file is now
 * shaped around two derivations rather than one:
 *
 *   A. Scheduled jobs that touch the database AT ALL. Session identifiers, the
 *      two lifecycle dates and the certificate records still reach a US runner,
 *      and those are still personal data — session codes are treated as
 *      semi-sensitive elsewhere in this repo (CLEANUP_QUIET exists so they never
 *      reach a world-readable log). So GitHub stays a named recipient and
 *      section 7 must still describe a transfer.
 *
 *   B. Scheduled jobs that read session BODIES. This must now be EMPTY, and the
 *      notice says so in three languages. A regression puts a job back in the
 *      set and fails here.
 *
 * An earlier version of this file keyed everything on B alone. When B emptied,
 * its anti-vacuity test fired — correctly, as a prompt to revisit the notice
 * rather than to relax the test. This is that revision.
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

/* A script that enumerates with readSessionLocationsShallow does NOT copy
   session bodies, even though the deep reader is still reachable from the
   module it imports: cleanup-stale-sessions keeps `readSessionLocations(db)`
   behind CLEANUP_DEEP_ENUM=1 as an operator escape hatch, and backup/export
   genuinely need it. Without this exclusion the derivation reports the purge
   as a full-database transfer, which stopped being true on 2026-09-01 and
   would make the notice's wording wrong in the other direction.

   That the escape hatch really is opt-in — never a catch-block fallback — is
   asserted in tests/session-enum-shallow.test.js, which is where that
   invariant belongs. */
function enumeratesShallowly(rel) {
  try {
    return /readSessionLocationsShallow\s*\(/.test(read(ROOT, rel));
  } catch {
    return false;
  }
}

/* DERIVATION A — scheduled jobs that reach the database at all, by any route.
   Enumerating by key still sends session identifiers to a US runner, so this is
   the set that keeps GitHub a disclosed recipient. */
function jobsTouchingTheDatabase() {
  const out = [];
  for (const w of scheduledWorkflows()) {
    for (const rel of scriptsOf(w.yml)) {
      if (touchesDatabase(rel)) out.push({ workflow: w.file, script: rel });
    }
  }
  return out;
}

function touchesDatabase(rel, seen = new Set()) {
  if (seen.has(rel)) return false;
  seen.add(rel);
  let src;
  try {
    src = read(ROOT, rel);
  } catch {
    return false;
  }
  if (/firebase-admin\/database|readSessionLocations|db\.ref\(/.test(src)) return true;
  for (const m of src.matchAll(/require\(["'](\.\/[\w./-]+)["']\)/g)) {
    const dep = path.posix.join(path.posix.dirname(rel), m[1]);
    if (touchesDatabase(dep.endsWith(".js") ? dep : dep + ".js", seen)) return true;
  }
  return false;
}

/* DERIVATION B — scheduled jobs that read session BODIES. Expected to be empty
   since PIS v7. A script that enumerates shallowly does not qualify even though
   the deep reader is still reachable from the module it imports: both the purge
   and the monitor keep it behind an explicit opt-out env var, and
   backup/export genuinely need it. */
function jobsReadingSessionBodies() {
  const out = [];
  for (const w of scheduledWorkflows()) {
    for (const rel of scriptsOf(w.yml)) {
      if (deepReadsSessions(rel) && !enumeratesShallowly(rel)) {
        out.push({ workflow: w.file, script: rel });
      }
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

test("the derivation finds the scheduled jobs that touch the database", () => {
  /* Anti-vacuity for derivation A. The disclosure tests below are conditional
     on this being non-empty, so a renamed script or a reworded `node`
     invocation would otherwise make them pass by doing nothing. */
  const jobs = jobsTouchingTheDatabase();
  assert.ok(
    jobs.length > 0,
    "no scheduled workflow was found to touch the database at all.\n" +
      "If that is genuinely true, GitHub has stopped being a recipient and the " +
      "notice can be revisited. If it is not, the derivation is broken and the " +
      "disclosure tests here are passing vacuously."
  );
});

test("no scheduled job reads session bodies — the notice says so in three languages", () => {
  /* The PIS v7 claim, and the reason the two derivations are separate: this one
     asserts an ABSENCE, so it cannot share the anti-vacuity guard above. */
  const offenders = jobsReadingSessionBodies();
  assert.deepStrictEqual(
    offenders, [],
    "a scheduled job reads session bodies again: " +
      offenders.map((o) => o.script).join(", ") + "\n" +
      "privacy.html section 6 tells participants that none of them reads session " +
      "content. Either narrow the job or correct the notice."
  );

  const s = privacySections();
  const claim = {
    en: /None of them reads your session content/i,
    fr: /Aucune d'elles ne lit le contenu de vos séances/i,
    ja: /いずれの処理もセッションの内容は読み込みません/
  };
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(claim[lang].test(recipientsAndTransfers(s[lang], lang)),
      "privacy.html [" + lang + "] no longer states that no job reads session content");
  }
});

test("GitHub is named as a recipient, in every published language", () => {
  if (jobsTouchingTheDatabase().length === 0) return;
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
  if (jobsTouchingTheDatabase().length === 0) return;
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
  if (jobsTouchingTheDatabase().length === 0) return;
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
  if (jobsTouchingTheDatabase().length === 0) return;
  const declared = [...privacyHtml.matchAll(/PIS v(\d+)\s*·/g)].map((m) => Number(m[1]));
  assert.ok(declared.length > 0, "privacy.html declares no notice version");
  for (const v of declared) {
    assert.ok(v >= 5,
      "privacy.html still declares PIS v" + v + " · …; v4 and earlier predate the " +
        "GitHub Actions disclosure");
  }
});

test("the purge job in particular still enumerates shallowly", () => {
  /* Kept as its own case even though the absence test above would also catch a
     regression: this one names the file, so a failure says which job changed
     rather than only that one did. */
  const purge = "scripts/cleanup-stale-sessions.js";
  const monitor = "scripts/firebase-cost-monitor.js";
  for (const job of [purge, monitor]) {
    assert.ok(enumeratesShallowly(job),
      job + " no longer enumerates shallowly, but privacy.html section 6 still " +
        "tells participants that no scheduled job reads session content.");
  }
});
