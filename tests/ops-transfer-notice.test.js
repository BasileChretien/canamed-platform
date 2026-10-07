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
/* A CALL, never the definition. The first version of the library follow-through
   below matched `readSessionLocationsShallow(` anywhere in a dependency — and
   lib/session-trees.js DEFINES that function, and every session-reading script
   requires that file. So the backup, the export and the data-rights monitor
   were all classed as shallow, derivation B came back empty, and the full-copy
   disclosure test returned having asserted nothing. An independent review
   caught it; "the derivation still sees the jobs that copy everything", below,
   is what fails if it happens again. */
const CALLS_SHALLOW = /(?<!function\s+)\breadSessionLocationsShallow\s*\(/;
const CALLS_DEEP = /(?<!function\s+)\breadSessionLocations\s*\(/;

/* The rule itself, on source text, so it can be shown on cases the repository
   does not contain today. */
function classifiesAsShallow(src, libSources) {
  if (CALLS_SHALLOW.test(src)) return true;
  /* A script that itself calls the deep reader, and never the shallow one, is
     not excused by anything it imports. */
  if (CALLS_DEEP.test(src)) return false;
  /* ...or through the library that does its reading. cleanup-anonymous-accounts
     keeps its orchestration in lib/anonymous-retention-job.js so it can be
     driven against fakes, and THAT file calls the shallow enumerator. One
     level, and only into ./lib/ — the same reach the deep-read check has.
     That the library never reads a session body is asserted where it can be
     shown by running it: tests/anonymous-retention-job.test.js, "the only
     value ever read whole is a session's creator uid". */
  return libSources.some((lib) => CALLS_SHALLOW.test(lib));
}

function enumeratesShallowly(rel) {
  let src;
  try {
    src = read(ROOT, rel);
  } catch {
    return false;
  }
  const libs = [];
  for (const m of src.matchAll(/require\(["'](\.\/lib\/[\w.-]+)["']\)/g)) {
    const dep = path.posix.join(path.posix.dirname(rel), m[1]);
    try {
      libs.push(read(ROOT, dep.endsWith(".js") ? dep : dep + ".js"));
    } catch {
      /* an unreadable dependency proves nothing either way */
    }
  }
  return classifiesAsShallow(src, libs);
}

/* The two jobs whose PURPOSE is a full copy. Section 6 of the notice names
   them and says where the copy goes. Everything else on a schedule must read
   no session body at all. */
const FULL_COPY = ["scripts/backup-sessions.js", "scripts/pseudonymise-export.js"];

/* Read from the workflows directly, NOT through derivation B — it is what
   derivation B is checked against. */
function scheduledScripts() {
  return scheduledWorkflows().flatMap((w) => scriptsOf(w.yml));
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
/* Collapse whitespace before matching. privacy.html is hand-wrapped source, so a
   phrase like "Data Privacy Framework" can be split across a line break and an
   indent — a literal multi-word regex then fails on correct content, and, worse,
   a deletion could hide behind a re-wrap. Every match in this file runs against
   the normalised text for that reason. */
const flat = (t) => String(t).replace(/\s+/g, " ");

function recipientsAndTransfers(body, lang) {
  const start = body.indexOf("<h2>6.");
  const end = body.indexOf("<h2>8.");
  assert.ok(start >= 0 && end > start, "sections 6-7 not found in the " + lang + " body");
  return flat(body.slice(start, end));
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

test("the derivation still sees the jobs that copy everything", () => {
  /* Anti-vacuity for derivation B, in the direction that matters: a derivation
     that finds NOTHING makes the two tests below pass by doing nothing. The
     backup and the export read the whole database by design, so while either
     is on a live cron it must be reported. */
  const scheduled = scheduledScripts();
  const bulk = jobsReadingSessionBodies().map((j) => j.script);
  for (const job of FULL_COPY) {
    if (!scheduled.includes(job)) continue; // switched off: correctly not reported
    assert.ok(bulk.includes(job),
      job + " runs on a schedule and copies the database, but the derivation no longer " +
      "reports it as reading session bodies. The disclosure tests here would pass vacuously.");
  }
  /* The two helpers must tell the readers apart, whatever the schedule says. */
  assert.strictEqual(enumeratesShallowly("scripts/backup-sessions.js"), false);
  assert.strictEqual(enumeratesShallowly("scripts/pseudonymise-export.js"), false);
  assert.strictEqual(enumeratesShallowly("scripts/cleanup-anonymous-accounts.js"), true);
  assert.strictEqual(enumeratesShallowly("scripts/lib/session-trees.js"), false,
    "the module that DEFINES the shallow enumerator is not thereby a caller of it");
  /* ...and the rule on the three shapes that decide it. */
  const definesIt = "async function readSessionLocationsShallow(opts) {\n}";
  const callsIt = "const locations = await readSessionLocationsShallow({ app });";
  const viaLib = 'const job = require("./lib/some-job");';
  assert.strictEqual(classifiesAsShallow(viaLib, [definesIt]), false,
    "a library that only DEFINES the shallow enumerator excused a script");
  assert.strictEqual(classifiesAsShallow(viaLib, [callsIt]), true);
  assert.strictEqual(
    classifiesAsShallow(viaLib + "\nconst all = await readSessionLocations(db);", [callsIt]), false,
    "a script that calls the deep reader itself was excused by a library it imports");
});

test("the DAILY jobs read no session content — the notice says so in three languages", () => {
  /* The claim in section 6 is scoped, and the scoping is the whole point.
     Between PIS v7 and v9 it read "None of them reads your session content",
     which was true only while the backup and the research export were switched
     off. Re-enabling them on 2026-09-01 made the unqualified version FALSE, and
     this test is what caught it — the notice and the schedule had moved in
     opposite directions inside one change.

     So: the full-copy jobs are allowed to read bodies, and are disclosed
     separately (next test); NOTHING ELSE on a schedule may.

     This used to check a hand-written list of "daily" scripts. The data-rights
     monitor was added to the schedule on 2026-09-03 and not to the list, and it
     deep-read every session every day for a month while the notice said no
     daily job did. The rule is now derived: whatever is scheduled and is not
     one of the two disclosed copies. */
  const offenders = jobsReadingSessionBodies()
    .map((j) => j.script)
    .filter((j) => !FULL_COPY.includes(j));
  assert.deepStrictEqual(
    offenders, [],
    "a scheduled job other than the two disclosed full copies reads session bodies: " +
      offenders.join(", ") +
      "\nprivacy.html section 6 tells participants the daily jobs do not read " +
      "session content. Enumerate with readSessionLocationsShallow() instead."
  );

  const s = privacySections();
  const claim = {
    en: /jobs that run every day do not read your session\s+content/i,
    fr: /tâches qui s'exécutent chaque jour ne lisent pas le contenu\s+de vos séances/i,
    ja: /毎日実行される処理は、セッションの内容を読み込みません/
  };
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(claim[lang].test(recipientsAndTransfers(s[lang], lang)),
      "privacy.html [" + lang + "] no longer scopes the no-content claim to the " +
        "daily jobs");
  }
});

/* DERIVATION C — scheduled jobs that read the REQUEST ledgers whole: the
   withdrawals people have made and the record of erasures carried out. Each
   entry names a session and a person's technical identifiers. */
function readsRequestLedgers(rel, seen = new Set()) {
  if (seen.has(rel)) return false;
  seen.add(rel);
  let src;
  try {
    src = read(ROOT, rel);
  } catch {
    return false;
  }
  if (/\.ref\(\s*["'`](withdrawals|erasures)["'`]\s*\)\s*\.(get|once)\(/.test(src)) return true;
  for (const m of src.matchAll(/require\(["'](\.\/[\w./-]+)["']\)/g)) {
    const dep = path.posix.join(path.posix.dirname(rel), m[1]);
    if (readsRequestLedgers(dep.endsWith(".js") ? dep : dep + ".js", seen)) return true;
  }
  return false;
}

test("the notice says the daily jobs read withdrawal and erasure requests", () => {
  /* The data-rights monitor went on a daily cron on 2026-09-03 and section 6
     went on listing "session identifiers and two dates" as everything the
     daily jobs read. A request to withdraw or to be erased names a session and
     a person; a job that reads those on a runner in the United States is a
     reader the notice has to name. */
  const readers = scheduledScripts().filter((rel) => readsRequestLedgers(rel));
  assert.ok(readers.includes("scripts/data-rights-monitor.js"),
    "the derivation no longer sees the data-rights monitor reading the request ledgers " +
    "(found: " + (readers.join(", ") || "none") + "). Either it stopped, and the notice can " +
    "say less, or the derivation is broken and this test is passing on nothing.");

  const s = privacySections();
  const said = {
    en: [/Requests to withdraw consent or to have data erased are read too, with the record of those already carried out/,
         /for each, the session's identifier, the person's technical identifiers, a date and what was asked, and for a request already carried out the operator's note of the reason/],
    fr: [/Les demandes de retrait du consentement ou d'effacement des données sont lues elles aussi, ainsi que la trace de celles déjà traitées/,
         /pour chacune, l'identifiant de la séance, les identifiants techniques de la personne, une date et l'objet de la demande, ainsi que, pour une demande déjà traitée, le motif noté par l'exploitant/],
    ja: [/同意の撤回やデータ削除のご請求と、対応済みのご請求の記録も読み込みます/,
         /それぞれについて読み込むのは、セッション識別子、ご本人の技術的識別子、日付、ご請求の内容です/,
         /対応済みのご請求については、運営者が記録した理由も読み込みます/]
  };
  for (const lang of ["en", "fr", "ja"]) {
    const sec = recipientsAndTransfers(s[lang], lang);
    for (const re of said[lang]) {
      assert.ok(re.test(sec), "privacy.html [" + lang + "] sections 6-7 do not say: " + re +
        "\nScheduled jobs that read the request ledgers: " + readers.join(", "));
    }
  }
});

test("the notice admits the month in which a third daily job copied every session", () => {
  /* From its first run on 2026-09-04 (it was merged the day before, after
     that day's slot) the data-rights monitor enumerated sessions with the deep
     reader, so it copied the whole live database to a GitHub runner every day
     while section 6 said no daily job read session content. The same section
     already owns up to the two jobs that did so until 2026-09-01; leaving this
     one out would make that paragraph read as the full account. */
  const s = privacySections();
  const said = {
    en: /A third job, which watches for erasure requests that have gone unanswered, did the same from 2026-09-04 to 2026-10-07, although it needed only the requests; it has been corrected/,
    fr: /Une troisième tâche, qui surveille les demandes d'effacement restées sans réponse, a fait de même du 04\/09\/2026 au 07\/10\/2026, alors qu'elle n'avait besoin que des demandes ; elle a été corrigée/,
    ja: /対応されていない削除のご請求を監視する3つ目の処理も、2026年9月4日から2026年10月7日まで同じように複製していました/
  };
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(said[lang].test(recipientsAndTransfers(s[lang], lang)),
      "privacy.html [" + lang + "] sections 6-7 no longer admit that the data-rights monitor " +
      "copied the whole session database daily from 2026-09-04 to 2026-10-07");
  }
});

/* Section 16 only: the changelog of the version in force. */
function changelog(body, lang) {
  const start = body.indexOf("<h2>16.");
  const end = body.indexOf("<h2>17.");
  assert.ok(start >= 0 && end > start, "section 16 not found in the " + lang + " body");
  return flat(body.slice(start, end));
}

test("the full copies are made on a GitHub machine, and the notice says session content crosses for them", () => {
  /* The backup and the research export write to storage in Paris, and the
     notice said so — and, one section later, that "what crosses is session
     identifiers ... rather than your session content". But both jobs RUN on
     GitHub-hosted runners: to make the copy they read the whole session
     database there, every day. The destination was disclosed; the place where
     the reading happens was not, and section 7 denied it. Found by an
     independent review of PIS v12; true since those jobs were introduced.

     What they read is `sessions` and `orgs` (scripts/lib/session-trees.js),
     NOT the whole database: the chat tree, the account profiles and the rest
     are not touched. The first wording said "the whole database", which told
     a participant their chat was read on a US machine when it was not; the
     notice's own phrase for the same reader, "the whole live session
     database", is the accurate one.

     Derived from the workflows: while a full-copy job runs on a GitHub-hosted
     runner the notice must say the content crosses. Move one to a runner in
     the EEA and this fails until the notice is changed back. */
  const fullCopy = scheduledWorkflows()
    .filter((w) => scriptsOf(w.yml).some((rel) => FULL_COPY.includes(rel)));
  /* EVERY job in the file, and only GitHub's own labels: a second job left on
     ubuntu-latest, or a self-hosted label that merely begins "ubuntu-", must
     not make a moved job look hosted. */
  const HOSTED = /^(ubuntu|windows|macos)-(latest|[\d.]+)$/;
  const runsOn = (yml) => [...yml.matchAll(/^[ \t]*runs-on:[ \t]*(.*?)[ \t\r]*$/gm)].map((m) => m[1]);
  const hosted = fullCopy
    .filter((w) => { const r = runsOn(w.yml); return r.length > 0 && r.every((v) => HOSTED.test(v)); })
    .map((w) => w.file);
  /* "Once a day": one live cron each, of the form "M H * * *". */
  for (const w of fullCopy) {
    const crons = w.yml.split(/\r?\n/)
      .filter((l) => /^\s*-\s*cron:/.test(l))
      .map((l) => l.replace(/^\s*-\s*cron:\s*/, "").replace(/\s+#.*$/, "").replace(/["']/g, "").trim());
    assert.deepEqual(crons.map((c) => /^\d+ \d+ \* \* \*$/.test(c)), [true],
      w.file + " is not scheduled exactly once a day (" + crons.join(" | ") + "); the notice says it is");
  }
  /* The notice says "these two jobs", so it is BOTH or the sentence is wrong:
     one job moved to a runner in the EEA leaves the notice overstating the
     transfer for that one, and a third full-copy job leaves it understating. */
  assert.equal(fullCopy.length, FULL_COPY.length,
    "the notice describes " + FULL_COPY.length + " scheduled full-copy jobs; the workflows have " +
    fullCopy.map((w) => w.file).join(", "));
  assert.deepEqual(hosted, fullCopy.map((w) => w.file),
    "a scheduled full-copy job no longer runs on a GitHub-hosted runner. If that is true, " +
    "sections 6 and 7 of the notice now overstate the transfer for it; if not, this derivation is broken.");

  const s = privacySections();
  const said = {
    en: [/Apart from the two full copies described at the end of this paragraph, the jobs that run every day do not read your session content/,
         /each of these two jobs reads the whole live session database on the same GitHub machines as the other jobs, once a day, and the content is on that machine for as long as the job runs/,
         /From 2026-08-27, when the platform left Google's paid plan and the storage they used stopped accepting writes, they still ran each day but could store no copy; they were switched off on 2026-08-31/,
         /For all but two of them, what crosses is session identifiers, two dates per session and the certificate records, rather than your session content/,
         /The two that copy the session database in full \(section 6\) are the exception: they read all of it on a GitHub machine, so your session content does cross, once a day for each, while the job runs/],
    fr: [/À l'exception des deux copies intégrales décrites à la fin de ce paragraphe, les tâches qui s'exécutent chaque jour ne lisent pas le contenu de vos séances/,
         /chacune de ces deux tâches lit l'intégralité de la base de session en cours sur les mêmes machines GitHub que les autres tâches, une fois par jour, et le contenu se trouve sur cette machine pendant toute la durée de la tâche/,
         /À partir du 27\/08\/2026, date à laquelle la plateforme a quitté l'offre payante de Google et le stockage qu'elles utilisaient a cessé d'accepter les écritures, elles s'exécutaient encore chaque jour mais ne pouvaient plus enregistrer de copie ; elles ont été désactivées le 31\/08\/2026/,
         /Pour toutes sauf deux, ce qui franchit la frontière, ce sont des identifiants de séance, deux dates par séance et les enregistrements de certificats, et non le contenu de vos séances/,
         /Les deux tâches qui copient la base de session intégralement \(section 6\) font exception : elles la lisent en entier sur une machine GitHub, de sorte que le contenu de vos séances franchit bien la frontière, une fois par jour pour chacune, pendant la durée de la tâche/],
    ja: [/この段落の最後で述べる、セッションデータベース全体を複製する2つの処理を除き、毎日実行される処理は、セッションの内容を読み込みません/,
         /この2つの処理は、複製を作るために、ほかの処理と同じGitHubのマシン上で稼働中のセッションデータベース全体を1日1回ずつ読み込みます。処理が終わるまでのあいだ、その内容はそのマシン上にあります/,
         /これらの処理はその後も毎日実行されていましたが、複製を保存できず、2026年8月31日に停止しました/,
         /ただし2つの処理を除けば、国境を越えるのは、セッション識別子、各セッションの2つの日付、および証明書レコードであり、セッションの内容ではありません/,
         /この2つはGitHubのマシン上でその全体を読み込むため、処理が動いているあいだ、セッションの内容も毎日国境を越えます/]
  };
  /* The headline points at "the end of this paragraph", so the description has
     to BE in that paragraph: moved into one of its own, the pointer is wrong. */
  const fullCopySentence = { en: /copy the session database in full/, fr: /copient la base de session intégralement/,
                             ja: /セッションデータベース全体を複製する残る2つの処理/ };
  /* What these two jobs read is the session database. "The whole database" is
     more than they read, in any of the three languages. */
  const overstated = { en: /reads? the whole database\b|copy the database in full/, fr: /l'intégralité de la base (?!de session)|copient la base intégralement/,
                       ja: /マシン上でデータベース全体を/ };
  for (const lang of ["en", "fr", "ja"]) {
    const sec = recipientsAndTransfers(s[lang], lang);
    for (const re of said[lang]) {
      assert.ok(re.test(sec), "privacy.html [" + lang + "] sections 6-7 do not say: " + re +
        "\nFull-copy jobs on a GitHub-hosted runner: " + hosted.join(", "));
    }
    const headline = said[lang][0];
    const para = s[lang].split(/<p[\s>]/).map(flat).filter((p) => headline.test(p));
    assert.equal(para.length, 1, "privacy.html [" + lang + "]: the section 6 headline is not in exactly one paragraph");
    assert.ok(fullCopySentence[lang].test(para[0]) && said[lang][1].test(para[0]),
      "privacy.html [" + lang + "]: the two full copies are no longer described in the paragraph whose " +
      "headline says they are described at its end");
    assert.ok(!overstated[lang].test(sec), "privacy.html [" + lang + "] sections 6-7 say the two jobs read " +
      "the whole database; they read the session database (" + overstated[lang] + ")");
    /* ...and the unqualified denial must not come back. */
    const denial = { en: /&mdash; what crosses is session identifiers/, fr: /&mdash; ce qui franchit la frontière, ce sont des identifiants/,
                     ja: /ただし国境を越えるのは、セッション識別子/ }[lang];
    assert.ok(!denial.test(sec), "privacy.html [" + lang + "] section 7 again says, without exception, " +
      "that only identifiers and dates cross the border");
  }
});

test("section 7 says the requests cross too, and section 16 records what v12 added to sections 6 and 7", () => {
  /* Each of these was changed during review and was pinned by nothing: a
     revert of the corrected date in the changelog passed the whole suite. */
  const s = privacySections();
  const transfers = {
    en: /So do the requests to withdraw consent or to have data erased, and the record of those carried out/,
    fr: /Il en va de même des demandes de retrait du consentement ou d'effacement et de la trace de celles déjà traitées/,
    ja: /同意の撤回やデータ削除のご請求と、対応済みのご請求の記録も国境を越えます/
  };
  const log = {
    en: [/the daily jobs read requests to withdraw consent or to have data erased, which earlier versions did not mention/,
         /one of them copied the whole live session database to a GitHub machine every day from 2026-09-04 to 2026-10-07 without needing to/,
         /the backup and the research export read the whole live session database on a GitHub machine once a day, so that session content crosses the border while they run; earlier versions said it did not/,
         /Corrected in v12, above: the backup and the research export do read session content/],
    fr: [/les tâches quotidiennes lisent les demandes de retrait du consentement ou d'effacement, ce que les versions précédentes ne mentionnaient pas/,
         /du 04\/09\/2026 au 07\/10\/2026, sans en avoir besoin/,
         /la sauvegarde et l'export de recherche lisent chaque jour l'intégralité de la base de session en cours sur une machine GitHub, de sorte que le contenu des séances franchit la frontière pendant leur exécution ; les versions précédentes affirmaient le contraire/,
         /Corrigé en v12, ci-dessus : la sauvegarde et l'export de recherche lisent bien le contenu des séances/],
    ja: [/毎日実行される処理が同意の撤回やデータ削除のご請求を読み込むことも記載しました/,
         /そのうち1つの処理は、2026年9月4日から2026年10月7日まで、/,
         /バックアップと研究用エクスポートがGitHubのマシン上で稼働中のセッションデータベース全体を毎日読み込むことも、今回はじめて記載しました/,
         /従来のバージョンには、越えないと記載していました/,
         /この記載は、バックアップと研究用エクスポートについては誤りでした。v12（上記）で訂正しています/]
  };
  /* The entry carried forward from v7 says "no scheduled maintenance job reads
     your session content at all now". It is history, so it stays — but it is
     in the present tense and points at sections that now say the opposite, so
     the correction has to stand in the SAME entry, not only in the v12 one. */
  const stale = {
    en: [/no scheduled maintenance job reads your session content at all now/, /Corrected in v12, above/, /Material changes since PIS v5/],
    fr: [/aucune tâche de maintenance planifiée ne lit plus le contenu de vos séances/, /Corrigé en v12, ci-dessus/, /depuis la version PIS v5/],
    ja: [/セッションの内容を一切読み込まなくなりました/, /v12（上記）で訂正しています/, /PIS v5からの重要な変更/]
  };
  for (const lang of ["en", "fr", "ja"]) {
    assert.ok(transfers[lang].test(recipientsAndTransfers(s[lang], lang)),
      "privacy.html [" + lang + "] section 7 does not say the requests cross the border");
    const cl = changelog(s[lang], lang);
    for (const re of log[lang]) {
      assert.ok(re.test(cl), "privacy.html [" + lang + "] section 16 does not record: " + re);
    }
    const [claim, fix, next] = stale[lang].map((re) => cl.search(re));
    assert.ok(claim >= 0 && fix > claim && next > fix,
      "privacy.html [" + lang + "] section 16: the v7 entry's claim that no scheduled job reads session " +
      "content is not followed, inside that entry, by its correction (claim " + claim + ", correction " + fix +
      ", next entry " + next + ")");
  }
});

test("if a scheduled job DOES copy the database, the notice says so and says where", () => {
  /* The backup and the pseudonymised export copy everything — that is their
     purpose, and they were re-enabled on 2026-09-01 after five days in which the
     nightly purge deleted with no archive behind it. A full copy of the
     identified database leaving on a schedule is exactly the kind of processing
     Art. 13 exists to surface, so it may run only while the notice describes it
     AND names the destination. */
  /* Whether there is anything to disclose is read from the SCHEDULE, not from
     derivation B: a conditional on the derivation under test is how this test
     once returned early with both jobs running. */
  const bulk = FULL_COPY.filter((job) => scheduledScripts().includes(job));
  if (bulk.length === 0) return; // both switched off again; nothing to disclose

  const s = privacySections();
  const disclosed = {
    en: [/copy the session database in full/i, /Scaleway/, /Paris/],
    fr: [/copient la base de session intégralement/i, /Scaleway/, /Paris/],
    ja: [/セッションデータベース全体を\s*複製/, /Scaleway/, /パリ/]
  };
  for (const lang of ["en", "fr", "ja"]) {
    const sec = recipientsAndTransfers(s[lang], lang);
    for (const re of disclosed[lang]) {
      assert.ok(re.test(sec),
        "privacy.html [" + lang + "] does not disclose the full-copy jobs and where " +
          "they write, but these are scheduled: " + bulk.join(", ") +
          " (missing: " + re + ")");
    }
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

/* REMOVED 2026-09-01 — "the notice does not claim a transfer safeguard the DPA
   calls unresolved". It was conditional on Annex III row #5 saying UNRESOLVED,
   and stepped aside the moment that was settled, leaving a test that could never
   fail again. A conditional wrapping the only assertion is a green test that
   tests nothing, so it is deleted rather than left as decoration.

   Its job moved to tests/github-dpf-currency.test.js, running the other way
   round: the transfer now rests on EU-US Data Privacy Framework adequacy, so the
   notice must NAME that basis, must not still say the check is outstanding, and
   the certification's expiry date is watched — an adequacy basis can lapse
   without anything in this repo noticing. */

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
