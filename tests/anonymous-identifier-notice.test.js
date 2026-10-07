"use strict";
/* tests/anonymous-identifier-notice.test.js
 *
 * The anonymous sign-in identifier (issue #347) is disclosed in the Art. 13
 * notice, and the notice makes three claims about it that are enforced
 * somewhere else entirely:
 *
 *   published                                   enforced
 *   ─────────                                   ────────
 *   "deleted after N days without use"          the retention job's window, and
 *                                               the fact that it RUNS and DELETES
 *   "…or with the session, about M days later"  the session purge's closed window
 *   "counters deleted within K days"            the proxy's TTL + a daily sweep
 *   "receives no name and no e-mail address"    the partial-response mask
 *   "a report … is not deleted automatically"   the job's path allowlist
 *
 * WHY THE SCHEDULE IS PART OF THE NOTICE. A period nothing enforces is the
 * exact defect this issue was opened for, and it can be reintroduced without
 * touching a word of the notice: comment out one cron line, or flip the
 * schedule back to a dry run, and section 8 states a deletion that no longer
 * happens. So the workflow is read here as carefully as the text is.
 *
 * The other direction is covered too. A scheduled run sends account
 * identifiers to a GitHub runner in the United States; if sections 6 and 7
 * stopped saying so, that would be an undisclosed transfer.
 *
 * This file REPLACES a placeholder in anonymous-retention-job.test.js that
 * asserted the workflow had no cron while the notice was silent. The three
 * landed together, as that placeholder required.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS, assertSafePaths
} = require("../scripts/lib/anonymous-retention");
const { TTL_WINDOWS } = require("../scripts/lib/rate-limit-retention");
const {
  FIELD_MASK, USER_MASK, ACCOUNT_KEYS, PROVIDER_KEYS
} = require("../scripts/lib/auth-accounts");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
/* Read as LF, whatever the checkout. With core.autocrlf=true the working tree
   is CRLF, and `.` does not match `\r` — so a pattern that walks lines with
   `.*\n` finds nothing on Windows while passing in CI. The first version of
   the job's own workflow test had exactly that fault. */
const read = (...p) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");

// ---- the enforced side -----------------------------------------------------

const WORKFLOW = read(ROOT, ".github", "workflows", "cleanup-anonymous-accounts.yml");
const liveCronLines = WORKFLOW.split("\n")
  .filter((l) => /^\s*-\s*cron:/.test(l) && !/^\s*#/.test(l));

/* The closed-session window: how long a session outlives its closing, and so
   how much later than N days an identifier can go. Read from the purge job. */
const CLOSED_DAYS = (() => {
  const src = read(ROOT, "scripts", "cleanup-stale-sessions.js");
  const m = src.match(/retentionDays\("CLEANUP_RETENTION_CLOSED_DAYS",\s*(\d+)\)/);
  assert.ok(m, "could not read the closed-session window out of cleanup-stale-sessions.js");
  return Number(m[1]);
})();

/* A day bucket is stale TTL_WINDOWS days after it starts, and the sweep runs
   once a day — so the oldest counter a participant can have is that plus one. */
const COUNTER_DAYS = TTL_WINDOWS + 1;

// ---- the published side ----------------------------------------------------

const privacyHtml = read(PLATFORM, "privacy.html");

function sections() {
  const out = {};
  const re = /<section data-priv-lang="(en|fr|ja)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(privacyHtml))) out[m[1]] = m[2];
  return out;
}

/* privacy.html is hand-wrapped, so a phrase can straddle a line break. English
   and French are matched with whitespace collapsed; Japanese with whitespace
   REMOVED, because a wrap in the middle of a Japanese sentence is not a space. */
const norm = (lang, t) => (lang === "ja" ? t.replace(/\s+/g, "") : t.replace(/\s+/g, " "));

function part(lang, from, to) {
  const body = sections()[lang];
  assert.ok(body, "no <section data-priv-lang=\"" + lang + "\"> in privacy.html");
  const a = body.indexOf("<h2>" + from + ".");
  const b = body.indexOf("<h2>" + to + ".");
  assert.ok(a >= 0 && b > a, "sections " + from + "–" + to + " not found in the " + lang + " body");
  return norm(lang, body.slice(a, b));
}

/** The one <li> of section 8 that matches `re` — selected by content, never by
 *  position, so a later addition to the list cannot look like a deletion. */
function retentionItem(lang, re) {
  const items = (part(lang, 8, 9).match(/<li>([\s\S]*?)<\/li>/g) || []);
  const hits = items.filter((li) => re.test(li));
  assert.strictEqual(hits.length, 1,
    "privacy.html [" + lang + "] section 8: expected exactly one item matching " + re +
    ", found " + hits.length);
  return hits[0];
}

const LANGS = ["en", "fr", "ja"];

// ---- tests -----------------------------------------------------------------

test("the job RUNS: one live daily cron", () => {
  /* Anti-vacuity for everything below, and the first way the notice can be
     made false without editing it. */
  assert.strictEqual(liveCronLines.length, 1,
    "cleanup-anonymous-accounts.yml must have exactly one live cron line. " +
    "Without it, section 8 of the notice states a deletion nothing performs.");
  assert.match(liveCronLines[0], /cron:\s*"\d+ \d+ \* \* \*"/,
    "the schedule is no longer daily, but the counters are promised gone within " +
    COUNTER_DAYS + " days on the strength of a daily sweep");
});

test("the job DELETES on schedule: a scheduled run is not a dry run", () => {
  /* The second way: the cron still fires and the run still goes green, but
     nothing is removed. cleanup-expired-credentials.yml is in exactly that
     state on purpose — and its retention period is not in the notice. */
  assert.match(WORKFLOW,
    /ANON_CONFIRM: \$\{\{ \(github\.event_name == 'schedule' \|\| github\.event\.inputs\.confirm == 'true'\) && '1' \|\| '0' \}\}/,
    "a scheduled run must set ANON_CONFIRM=1");
  const confirmInput = /confirm:\s*\n(?:\s+.*\n)*?\s+default: (\w+)/.exec(WORKFLOW);
  assert.ok(confirmInput && confirmInput[1] === "false",
    "a MANUAL dispatch must still default to a dry run");
});

test("nothing in the workflow lets a scheduled run skip the job, or run something else", () => {
  /* An independent fact-check made the notice false three ways while the two
     tests above stayed green: an `if:` on the job that excluded the schedule,
     a `run:` line replaced by `echo`, and a commented-out `schedule:` key
     above a cron line that was still "live" to a regex. */
  assert.ok(!/^\s*if:/m.test(WORKFLOW),
    "the workflow gained an `if:`. A condition that skips the job on schedule leaves the " +
    "cron and ANON_CONFIRM untouched and deletes nothing.");
  assert.match(WORKFLOW, /^on:\n  schedule:\n    - cron: "\d+ \d+ \* \* \*"/m,
    "the cron line is not under a live `schedule:` key directly beneath `on:`");
  const runs = [...WORKFLOW.matchAll(/^\s+run:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(runs.includes("node scripts/cleanup-anonymous-accounts.js"),
    "no step runs the retention script any more. Steps found: " + JSON.stringify(runs));
  assert.ok(!/continue-on-error:\s*true/.test(WORKFLOW),
    "a failed run must fail the workflow, or nobody is told the deletion stopped");
});

test("the window the workflow passes is the one the rules default to, and its ceiling", () => {
  const m = /ANON_RETENTION_DAYS: \$\{\{ github\.event\.inputs\.retention_days \|\| '(\d+)' \}\}/.exec(WORKFLOW);
  assert.ok(m, "ANON_RETENTION_DAYS is no longer wired to the dispatch input");
  assert.strictEqual(Number(m[1]), DEFAULT_RETENTION_DAYS);
  assert.strictEqual(MAX_RETENTION_DAYS, DEFAULT_RETENTION_DAYS,
    "a ceiling above the published period would let a dispatch keep identifiers " +
    "longer than participants are told");
});

test("section 4 says the identifier exists, for every visitor, before any consent", () => {
  const must = {
    en: [/From <strong>Google Firebase Authentication<\/strong>, for every visitor/,
         /signed in <strong>anonymously<\/strong>/, /before you enter a session code or tick any box/,
         /random technical identifier/, /stays the same from one visit to the next/],
    fr: [/De <strong>Google Firebase Authentication<\/strong>, pour chaque visiteur/,
         /connecté de façon <strong>anonyme<\/strong>/, /avant que vous ne saisissiez un code de séance/,
         /identifiant technique aléatoire/, /reste le même d'une visite à l'autre/],
    ja: [/<strong>GoogleFirebaseAuthentication<\/strong>から（すべての訪問者について）/,
         /<strong>匿名で<\/strong>サインインされます/, /同意欄へのチェックよりも前に/,
         /ランダムな技術的識別子/, /次に訪問したときも同じ識別子が使われます/]
  };
  for (const lang of LANGS) {
    const s4 = part(lang, 4, 5);
    for (const re of must[lang]) {
      assert.ok(re.test(s4), "privacy.html [" + lang + "] section 4 no longer says: " + re);
    }
  }
});

test("section 4 no longer reads as though Google Auth begins at sign-in", () => {
  /* The original defect, as issue #347 put it: the notice described what
     Google supplies "if you sign in" and was silent on what it supplies to
     everyone. That sentence is still there and still true — it must simply
     not be the only one. */
  for (const lang of LANGS) {
    const s4 = part(lang, 4, 5);
    const paragraphs = (s4.match(/<p>/g) || []).length;
    assert.ok(paragraphs >= 3,
      "privacy.html [" + lang + "] section 4 is back to a single paragraph");
  }
});

test("section 4 discloses the chat's usage counters", () => {
  const must = {
    en: /messages you send per hour and per day is counted against that identifier/,
    fr: /messages que vous envoyez par heure et par jour est décompté sous cet identifiant/,
    ja: /1時間ごと・1日ごとの送信メッセージ数が、この識別子と結びつけて数えられます/
  };
  for (const lang of LANGS) {
    assert.ok(must[lang].test(part(lang, 4, 5)),
      "privacy.html [" + lang + "] section 4 does not disclose the usage counters");
  }
});

test("section 8 states the ENFORCED period, in every language", () => {
  const item = { en: /technical identifier your browser is given/, fr: /identifiant technique attribué/,
                 ja: /割り当てられる技術的識別子/ };
  const days = {
    en: new RegExp("<strong>" + DEFAULT_RETENTION_DAYS + " days</strong> without being used"),
    fr: new RegExp("<strong>" + DEFAULT_RETENTION_DAYS + " jours</strong> sans utilisation"),
    ja: new RegExp("<strong>" + DEFAULT_RETENTION_DAYS + "日間</strong>利用がなければ削除します")
  };
  for (const lang of LANGS) {
    const li = retentionItem(lang, item[lang]);
    assert.ok(days[lang].test(li),
      "privacy.html [" + lang + "] section 8 does not state the " + DEFAULT_RETENTION_DAYS +
      "-day window the job enforces.\n  got: " + li);
  }
});

test("section 8 does not state the period as a bare number: the live-session clause is there", () => {
  /* "90 days" alone would be false. An account that a live session still names
     is not removed, and a session closed at the last moment lives CLOSED_DAYS
     more — so the honest bound is the window plus that. */
  const item = { en: /technical identifier your browser is given/, fr: /identifiant technique attribué/,
                 ja: /割り当てられる技術的識別子/ };
  const clause = {
    en: new RegExp("If a session you joined still exists.*about " + CLOSED_DAYS + " days later at most"),
    fr: new RegExp("Si une séance à laquelle vous avez participé existe encore.*environ " + CLOSED_DAYS +
                   " jours plus tard au maximum"),
    ja: new RegExp("参加したセッションがその時点でまだ残っている場合は.*最長で約" + CLOSED_DAYS + "日後")
  };
  for (const lang of LANGS) {
    const li = retentionItem(lang, item[lang]);
    assert.ok(clause[lang].test(li),
      "privacy.html [" + lang + "] section 8 states the window without the live-session " +
      "clause, or with a figure other than the closed-session window (" + CLOSED_DAYS + " days)");
  }
});

test("section 8 states when the usage counters go, and the figure is the real one", () => {
  /* "About", because the bound has no slack: a day bucket goes stale two days
     after it starts and the sweep runs once a day, so one missed night already
     exceeds three days exactly. The figure is still tied to the code. */
  assert.strictEqual(COUNTER_DAYS, 3,
    "the proxy's TTL or the sweep's factor changed: the counters now live " + COUNTER_DAYS +
    " days at most, and the notice says about three. Change both.");
  const must = {
    en: /usage counters are deleted within about three days/,
    fr: /compteurs d'utilisation de la conversation avec le patient simulé sont supprimés sous trois jours environ/,
    ja: /利用回数カウンターは、おおむね3日以内に削除します/
  };
  for (const lang of LANGS) {
    assert.ok(must[lang].test(part(lang, 8, 9)),
      "privacy.html [" + lang + "] section 8 does not state the counters' retention");
  }
});

test("section 8 states the two things that outlast the period, instead of a bare number", () => {
  /* Found by an independent fact-check: "deleted after 90 days" was stated
     flatly, while (a) the identifier survives in the nightly backups of the
     sessions it joined, and (b) the job deliberately keeps an account an
     operator has allowlisted, or one the database says is not anonymous. */
  const item = { en: /technical identifier your browser is given/, fr: /identifiant technique attribué/,
                 ja: /割り当てられる技術的識別子/ };
  const must = {
    en: [/remain in the nightly backups until those expire/,
         /kept longer only if it belongs to an approved facilitator or moderator, or if a profile or authored scenarios are stored under it/],
    fr: [/subsistent dans les sauvegardes nocturnes jusqu'à leur expiration/,
         /conservé plus longtemps que s'il appartient à un animateur ou à un modérateur approuvé, ou si un profil ou des scénarios rédigés sont enregistrés/],
    ja: [/毎晩のバックアップに残る複製は、この一覧の2番目の項の期間で失効します/,
         /承認済みのファシリテーターまたはモデレーターの識別子である場合と、プロフィールまたは作成したシナリオが保存されている場合に限り、これより長く保持します/]
  };
  for (const lang of LANGS) {
    const li = retentionItem(lang, item[lang]);
    for (const re of must[lang]) {
      assert.ok(re.test(li), "privacy.html [" + lang + "] section 8 no longer says: " + re);
    }
  }
  /* The exceptions are the job's, so they are read from it. */
  const job = read(ROOT, "scripts", "lib", "anonymous-retention-job.js");
  assert.match(job, /\["facilitatorGate\/allow", "moderators"\]/,
    "the job no longer protects allowlisted accounts, but the notice says it does");
  assert.match(job, /hasOwnProperty\.call\(node, "profile"\)/,
    "the job no longer spares an account with a profile, but the notice says it does");
  assert.match(job, /if \(scenarios\.has\(uid\)\) contradicted\.add\(uid\)/,
    "the job no longer spares an account with scenarios, but the notice says it does");
});

test("section 8 says a moderation report is KEPT — and the job really cannot delete one", () => {
  /* The identifier is deleted; a report filed under it is not. Saying only the
     first would overclaim. And if the job is ever taught to delete reports,
     this fails until the notice is changed with it. */
  const must = {
    en: /report is kept under that identifier and is not deleted automatically/,
    fr: /signalement est conservé sous cet identifiant et n'est pas supprimé automatiquement/,
    ja: /その報告はこの識別子と結びつけて保持します。この報告は自動的には削除されません/
  };
  for (const lang of LANGS) {
    assert.ok(must[lang].test(part(lang, 8, 9)),
      "privacy.html [" + lang + "] section 8 no longer says reports are kept");
  }
  assert.throws(() => assertSafePaths(["reports/scenarios/share_1/AbC123"]), /unrecognised shape/,
    "the retention job can now delete moderation reports, but the notice says they are kept");
});

test("sections 6-7 say what the job reads, and that it reads no name and no e-mail address", () => {
  const reads = {
    en: [/A further job, which deletes technical identifiers that are no longer in use/,
         /identifiers of the members and the creator of each current session/,
         /whether a profile, a session history or authored scenarios are stored under an identifier, but not what they contain/,
         /operator's lists of approved facilitators and moderators/,
         /which identifier or session it belongs to and its time slot/,
         /receives no name and no e-mail address/,
         /only its identifier, its dates and the name of the sign-in method/],
    fr: [/Une autre tâche, qui supprime les identifiants techniques devenus inutiles/,
         /identifiants des membres et du créateur de chaque séance en cours/,
         /d'un profil, d'un historique de séances ou de scénarios rédigés, mais pas leur contenu/,
         /listes d'animateurs et de modérateurs approuvés tenues par l'exploitant/,
         /l'identifiant ou la séance auquel il se rapporte et son créneau horaire/,
         /ne reçoit ni nom ni adresse électronique/,
         /seulement son identifiant, ses dates et le nom du mode de connexion/],
    ja: [/さらに別の処理が、使われなくなった技術的識別子を削除します/,
         /現在あるセッションの各メンバーおよび作成者の識別子も読み込みます/,
         /作成したシナリオが保存されているかどうかも確認しますが、その内容は読み込みません/,
         /運営者が管理する承認済みファシリテーターとモデレーターの一覧も読み込みます/,
         /対象の識別子またはセッションと、その時間帯を読み込みます/,
         /氏名やメールアドレスは受け取りません/,
         /受け取るのは識別子と日付、サインイン方法の名称だけです/]
  };
  for (const lang of LANGS) {
    const s = part(lang, 6, 8);
    for (const re of reads[lang]) {
      assert.ok(re.test(s), "privacy.html [" + lang + "] sections 6-7 no longer say: " + re);
    }
  }
});

test("the job RECEIVES exactly what the notice says: five fields, provider names only", () => {
  /* "No name and no e-mail address — only its identifier, its dates and the
     name of the sign-in method" is only as good as the mask behind it, and a
     ban list is not enough: an independent fact-check widened the mask to ask
     for Google's persistent account id (`rawId`) and the earlier version of
     this test, which banned four field names, still passed. So the allowlist
     is pinned whole. Add a field here and the sentence above has to change. */
  assert.deepStrictEqual(ACCOUNT_KEYS,
    ["localId", "createdAt", "lastLoginAt", "lastRefreshAt", "providerUserInfo"]);
  assert.deepStrictEqual(PROVIDER_KEYS, ["providerId"]);
  assert.strictEqual(USER_MASK,
    "users(localId,createdAt,lastLoginAt,lastRefreshAt,providerUserInfo(providerId))");
  assert.strictEqual(FIELD_MASK, "nextPageToken," + USER_MASK);
});

test("the job READS exactly what the notice lists: a new read fails here", () => {
  /* Section 6 enumerates what this job reads, and it reads as exhaustive. The
     first version of it left out the operator's allowlists and the per-account
     key check, and nothing noticed. Every database read in the job goes through
     `read.shallow` / `read.value`, so they can be listed from the source. */
  const job = read(ROOT, "scripts", "lib", "anonymous-retention-job.js");
  const targets = [...job.matchAll(/read\.(shallow|value)\(\s*([^,]+),/g)]
    .map((m) => m[1] + " " + m[2].replace(/\s+/g, " ").trim());
  assert.deepStrictEqual([...new Set(targets)].sort(), [
    'shallow "rateLimits/" + scope + "/" + id',   // usage counters: identifier or session, time slot
    'shallow "users/" + uid',                      // is a profile / a history stored under it
    "shallow label",                               // rateLimits/<scope>: which identifiers and sessions
    'shallow loc.path + "/members"',               // members of each current session
    "shallow node",                                // the two operator allowlists
    "shallow p",                                   // the list of sessions
    "shallow path",                                // which identifiers have users/ or scenarios/ records
    'value loc.path + "/creatorUid"'               // creator of each current session
  ], "the job's database reads changed. privacy.html section 6 lists them, in three " +
     "languages — update the notice, the job's header and this list together.");
  assert.match(job, /users: await keys\("users"\), scenarios: await keys\("scenarios"\)/);
});

test("section 7 says the identifiers cross the border with the rest", () => {
  const must = {
    en: /technical identifiers described in section 4 cross with them/,
    fr: /identifiants techniques décrits en section 4 la franchissent également/,
    ja: /第4条に記載した技術的識別子も、その日付および利用回数カウンターの時間帯とともに国境を越えます/
  };
  for (const lang of LANGS) {
    assert.ok(must[lang].test(part(lang, 7, 8)),
      "privacy.html [" + lang + "] section 7 does not say the technical identifiers leave " +
      "the EEA. A scheduled job sends them to a US runner every night.");
  }
});

test("section 17 lists the stored credential among the data kept on the device", () => {
  /* The identifier is "the same from one visit to the next" only because its
     credential is written to the browser's storage, on the first page load. A
     list of local data that leaves it out is the ePrivacy half of the same
     omission. */
  const must = {
    en: [/sign-in credential behind the technical identifier described in section 4/, /IndexedDB/],
    fr: [/informations de connexion correspondant à l'identifiant technique décrit en section 4/, /IndexedDB/],
    ja: [/第4条に記載した技術的識別子のサインイン情報も保存されます/, /IndexedDB/]
  };
  for (const lang of LANGS) {
    const s17 = part(lang, 17, 18);
    for (const re of must[lang]) {
      assert.ok(re.test(s17), "privacy.html [" + lang + "] section 17 no longer says: " + re);
    }
  }
});

test("the notice was re-issued for this: PIS v12 or later, with the change recorded", () => {
  const declared = [...privacyHtml.matchAll(/PIS v(\d+)\s*·/g)].map((m) => Number(m[1]));
  assert.ok(declared.length > 0, "privacy.html declares no notice version");
  for (const v of declared) {
    assert.ok(v >= 12, "privacy.html still declares PIS v" + v +
      "; v11 and earlier do not mention the anonymous identifier");
  }
  /* The changelog also owns up to the history record a since-fixed bug wrote
     for every anonymous joiner. A past processing nobody was told about does
     not stop needing disclosure because it has stopped. */
  const bug = { en: /until 2026-08-25 a programming error recorded/,
                fr: /jusqu'au 25\/08\/2026, une erreur de programmation enregistrait/,
                ja: /2026年8月25日までは、プログラムの誤りによる記録がありました/ };
  for (const lang of LANGS) {
    assert.ok(bug[lang].test(part(lang, 16, 17)),
      "privacy.html [" + lang + "] section 16 no longer records the history bug");
  }
});
