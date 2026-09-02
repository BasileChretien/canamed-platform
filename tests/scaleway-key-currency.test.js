/* tests/scaleway-key-currency.test.js
 *
 * The nightly backup and the pseudonymised research export both authenticate to
 * Scaleway object storage with an API key. Scaleway caps API keys at 12 months,
 * so that key HAS an expiry date, and when it passes both jobs start failing.
 *
 * WHY THAT NEEDS A TEST RATHER THAN A CALENDAR ENTRY. A credential does not
 * announce its own expiry. Nothing in this repo changes on the day it lapses:
 * the code is fine, the bucket is fine, the schedule still fires. The jobs just
 * begin failing, and this project's whole history with scheduled jobs is that
 * failures go unread — the ≈11-day billing gap, the 5-day dependency gap, and
 * `cleanup-expired-credentials`, which had NEVER completed in 11 runs and was
 * found by accident. Worse here: if backups stop, the armed purge interlock
 * stops the retention purge too within CLEANUP_BACKUP_MAX_AGE_DAYS, so an
 * expired key becomes a storage-limitation problem a few days later.
 *
 * So the deadline is encoded as a failing test. THIS FILE IS MEANT TO FAIL ONE
 * DAY — about 45 days before the recorded date. A red run here is a prompt, not
 * a defect; the failure message says exactly what to do.
 *
 * Recorded 2026-09-02 from the Scaleway console: key created 2 Sept 2026,
 * "Expires in 12 months", bearer basile.chretien (OWNER), described as
 * "GitHub Actions - nightly PII archive to canamed-pii-archive".
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const BACKUP_WF = ".github/workflows/backup-sessions.yml";
const EXPORT_WF = ".github/workflows/pseudonymise-export.yml";

/* 45 days, where the GitHub DPF guard uses 90. Deliberately different, and the
   reason is the remedy: rotating this key is a ten-minute job (generate, set two
   secrets, dispatch to verify), whereas losing DPF adequacy could force an
   architecture change. A lead time much longer than the fix leaves the suite red
   for months, which teaches people to ignore it. */
const LEAD_DAYS = 45;

function recordedExpiry() {
  const m = read(BACKUP_WF).match(/SCW_KEY_EXPIRES:\s*(\d{4})-(\d{2})-(\d{2})/);
  assert.ok(
    m,
    "No `SCW_KEY_EXPIRES: YYYY-MM-DD` marker in " + BACKUP_WF + ".\n" +
      "That marker is the only thing making the credential's lifetime checkable " +
      "from inside the repo. Do not delete it without replacing the mechanism."
  );
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
}

test("the key's expiry date is recorded and parseable", () => {
  /* Anti-vacuity: the check below is conditional on this parsing, so a marker
     that silently stopped matching would make the whole file pass while
     measuring nothing. */
  const { iso, ms } = recordedExpiry();
  assert.ok(Number.isFinite(ms), "unparseable date: " + iso);
  assert.ok(ms > Date.UTC(2026, 0, 1), "implausible date: " + iso);
});

test("the Scaleway API key is not close to expiring", () => {
  const { iso, ms } = recordedExpiry();
  const daysLeft = Math.floor((ms - Date.now()) / 86400000);

  assert.ok(
    daysLeft > LEAD_DAYS,
    "\n" +
      "The Scaleway API key used by the backup and the research export expires " +
      "on " + iso + " — " +
      (daysLeft < 0 ? Math.abs(daysLeft) + " days AGO" : "in " + daysLeft + " days") + ".\n\n" +
      "THIS IS A PROMPT, NOT A BUG.\n\n" +
      "When it lapses both jobs fail, and because the purge interlock is ARMED " +
      "the retention purge stops too, a few days later. Nothing else in this " +
      "repo would flag it.\n\n" +
      "To rotate:\n" +
      "  1. Scaleway console > IAM > API keys > Generate API key.\n" +
      "     Bearer: yourself. ⚠ Set \"Will this API key be used for Object " +
      "Storage?\" to YES and pick the Canamed project — the default is No, and " +
      "a key without it is valid but cannot resolve the bucket.\n" +
      "  2. Copy BOTH values; the secret key is shown once. In GitHub > " +
      "Settings > Secrets > Actions, the key id goes in the SECRET box of " +
      "SCW_ACCESS_KEY (not the Name box), and the secret key in that of " +
      "SCW_SECRET_KEY.\n" +
      "  3. Dispatch \"Backup sessions\" and confirm a new object appears under " +
      "backups/ in the bucket — the job log alone is not proof.\n" +
      "  4. Update SCW_KEY_EXPIRES in " + BACKUP_WF + " to the new date, and " +
      "delete the old key in the console.\n"
  );
});

test("the guard is guarding a credential that is actually in use", () => {
  /* If the jobs stopped using these secrets — say billing returned and they
     moved back to GCS — this file would be enforcing a deadline that no longer
     matters, and would eventually fail for nothing. Tie it to reality. */
  const backup = read(BACKUP_WF);
  const exp = read(EXPORT_WF);
  for (const [name, src] of [[BACKUP_WF, backup], [EXPORT_WF, exp]]) {
    assert.match(src, /SCW_ACCESS_KEY:\s*\$\{\{\s*secrets\.SCW_ACCESS_KEY\s*\}\}/,
      name + " no longer passes SCW_ACCESS_KEY. If Scaleway is no longer the " +
        "archive destination, remove this guard in the same change — a deadline " +
        "for an unused credential is noise.");
    assert.match(src, /SCW_SECRET_KEY:\s*\$\{\{\s*secrets\.SCW_SECRET_KEY\s*\}\}/,
      name + " no longer passes SCW_SECRET_KEY");
  }
});

test("the rotation runbook does not leak the access key id into a public repo", () => {
  /* An access key id is not a credential by itself, but this repo is public and
     there is no reason to publish one. The runbook identifies the key by its
     DESCRIPTION instead; assert that choice stays made. */
  const backup = read(BACKUP_WF);
  assert.ok(!/SCW[A-Z0-9]{17}/.test(backup),
    "an access-key-shaped string appears in " + BACKUP_WF + ". Identify the key " +
      "by its console description, not its id — this repo is public.");
  assert.match(backup, /GitHub Actions - nightly PII archive/,
    "the runbook should name the key's console description so the right key can " +
      "be found without recording its id");
});
