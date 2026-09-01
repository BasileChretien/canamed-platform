/* tests/archive-destination.test.js
 *
 * The retention purge deletes every night. The backup is what makes that
 * recoverable — and it produced nothing between 2026-08-27 and 2026-09-01,
 * because it wrote to GCS and the project left the paid plan. These tests cover
 * the replacement path (S3-compatible, Scaleway Object Storage in fr-par) and,
 * more importantly, the two invariants that make the arrangement safe.
 *
 * INVARIANT 1 — NO DESTINATION MEANS NO MARKER. `writeBackupMarker` is what
 * authorises the nightly purge to delete (scripts/lib/backup-marker.js). It must
 * be written only after an upload has actually resolved. A backup that vouches
 * for an archive it did not create is worse than no backup at all: it would arm
 * a purge on a false premise.
 *
 * INVARIANT 2 — THE ARTEFACTS NEVER GO SOMEWHERE PUBLIC. These files are the
 * identified `/sessions` tree and a real-name → pseudonym linkage table. They
 * were deliberately moved off GitHub artifacts (world-downloadable on a public
 * repo) and must stay off. Uploads are private-ACL, no-store, https-only.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { chooseDestination, describeDestination, uploadArchive } =
  require("../scripts/lib/archive");
const { uploadToS3, s3ConfigFromEnv } = require("../scripts/lib/s3-archive");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const S3_ENV = {
  BACKUP_S3_BUCKET: "canamed-pii-archive",
  SCW_ACCESS_KEY: "AK",
  SCW_SECRET_KEY: "SK"
};

// ---- choosing a destination -------------------------------------------------

test("S3 wins when configured; GCS is the fallback; neither gives null", () => {
  assert.strictEqual(
    chooseDestination({ gcsBucket: "gcs-bucket", env: S3_ENV }).kind, "s3",
    "S3 must take precedence — it is the destination that currently works");
  assert.strictEqual(
    chooseDestination({ gcsBucket: "gcs-bucket", env: {} }).kind, "gcs",
    "GCS must remain usable, so restoring billing is a config change not a revert");
  assert.strictEqual(
    chooseDestination({ gcsBucket: "", env: {} }), null,
    "no destination must be null, not a throw — the callers decide what that means");
});

test("the environment supplies EEA defaults, so a bare bucket name is enough", () => {
  const c = s3ConfigFromEnv(S3_ENV);
  assert.strictEqual(c.region, "fr-par");
  assert.strictEqual(c.endpoint, "https://s3.fr-par.scw.cloud");
  /* fr-par is Paris. The archive holds identified participant data, and the
     published notice says the platform's data stays in the EEA except for the
     legs it names — an archive quietly defaulting to another region would make
     that false. */
  assert.match(c.endpoint, /\.fr-par\./);
});

test("no bucket means no S3 config at all, rather than a half-built one", () => {
  assert.strictEqual(s3ConfigFromEnv({}), null);
  assert.strictEqual(s3ConfigFromEnv({ SCW_ACCESS_KEY: "AK" }), null);
});

test("describeDestination says plainly when nothing will be archived", () => {
  const line = describeDestination(null);
  assert.match(line, /NOTHING WILL BE ARCHIVED/);
  assert.match(line, /no backup marker/,
    "the log line must connect 'no archive' to 'no marker', because that is the " +
      "consequence that matters for the purge");
});

// ---- the upload itself ------------------------------------------------------

function tmpFile(contents) {
  const p = path.join(os.tmpdir(), "canamed-archive-test-" + process.pid + ".json");
  fs.writeFileSync(p, contents);
  return p;
}

test("the upload is private and uncacheable, and lands at the requested key", async () => {
  const sent = [];
  const local = tmpFile('{"sessions":{}}');
  const uri = await uploadToS3(Object.assign({}, s3ConfigFromEnv(S3_ENV), {
    localPath: local,
    destination: "backups/canamed-backup-2026-09-01.json",
    client: { send: async (p) => { sent.push(p); } }
  }));

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].Bucket, "canamed-pii-archive");
  assert.strictEqual(sent[0].Key, "backups/canamed-backup-2026-09-01.json");
  assert.strictEqual(sent[0].ACL, "private",
    "an object ACL cannot rescue a public bucket, but it must not itself be the hole");
  assert.match(sent[0].CacheControl, /no-store/);
  assert.strictEqual(sent[0].Body.toString(), '{"sessions":{}}');
  assert.strictEqual(uri, "s3://canamed-pii-archive/backups/canamed-backup-2026-09-01.json");
  fs.unlinkSync(local);
});

test("every missing field is named, so a broken run points at the fix", async () => {
  const local = tmpFile("{}");
  await assert.rejects(
    () => uploadToS3({ localPath: local, destination: "k", client: { send: async () => {} } }),
    (e) => {
      /* One error listing everything absent, not a cascade of one-at-a-time
         failures across successive nightly runs. */
      for (const name of ["BACKUP_S3_BUCKET", "BACKUP_S3_ENDPOINT",
                          "BACKUP_S3_REGION", "SCW_ACCESS_KEY", "SCW_SECRET_KEY"]) {
        assert.ok(e.message.includes(name), "should name " + name + ": " + e.message);
      }
      return true;
    }
  );
  fs.unlinkSync(local);
});

test("a plaintext endpoint is refused — the body is the identified session tree", async () => {
  const local = tmpFile("{}");
  await assert.rejects(
    () => uploadToS3(Object.assign({}, s3ConfigFromEnv(S3_ENV), {
      endpoint: "http://s3.fr-par.scw.cloud",
      localPath: local, destination: "k", client: { send: async () => {} }
    })),
    /endpoint must be https/
  );
  fs.unlinkSync(local);
});

test("uploadArchive refuses to be called with no destination", async () => {
  await assert.rejects(() => uploadArchive(null, { localPath: "x", destination: "y" }),
    /no destination configured/);
});

// ---- the invariants, asserted against the jobs themselves -------------------

test("the backup writes its marker INSIDE the destination branch, never outside", () => {
  /* This is invariant 1, and it is a source-level check because the alternative
     is running the whole job. If the marker write ever moves out of the `if
     (dest)` block, a run with no destination would tell the purge an archive
     exists. */
  const src = read("scripts/backup-sessions.js");
  const branch = src.indexOf("if (dest) {");
  const marker = src.indexOf("writeBackupMarker(");
  assert.ok(branch > 0, "the destination branch is gone — did the archive path change?");
  assert.ok(marker > branch,
    "writeBackupMarker is no longer inside the destination branch. A backup that " +
      "records a marker without uploading would arm the nightly purge on a false " +
      "premise — see scripts/lib/backup-marker.js.");
});

test("both PII jobs archive through the dispatcher, not a hardcoded provider", () => {
  for (const job of ["scripts/backup-sessions.js", "scripts/pseudonymise-export.js"]) {
    const src = read(job);
    assert.match(src, /uploadArchive\(/, job + " must use the shared dispatcher");
    assert.ok(!/uploadToGcs\(/.test(src),
      job + " still calls uploadToGcs directly; the provider choice must live in " +
        "one place or the two jobs will drift over where PII is written");
  }
});

test("the require-archive guard checks for ANY destination, not the GCS bucket", () => {
  /* The old guard was `REQUIRE_GCS && !GCS_BUCKET`, which would refuse to run a
     perfectly good S3-backed backup — i.e. it would have kept the outage going
     after the fix. */
  for (const job of ["scripts/backup-sessions.js", "scripts/pseudonymise-export.js"]) {
    const src = read(job);
    assert.match(src, /REQUIRE_GCS && !chooseDestination\(/,
      job + "'s archive-required guard still keys on the GCS bucket alone");
  }
});

test("the SDK is lazy — the archive path loads without it installed", () => {
  /* Asserted because it is load-bearing for these very tests: they run on a
     checkout where @aws-sdk/client-s3 is not present. A top-level require would
     turn every test in this file into a dependency check. */
  const src = read("scripts/lib/s3-archive.js");
  const top = src.slice(0, src.indexOf("async function uploadToS3"));
  assert.ok(!/^const .*require\("@aws-sdk/m.test(top),
    "@aws-sdk/client-s3 must not be required at module top level");
  assert.match(src, /function loadSdk\(\)/);
});

test("the dependency is declared where the workflows will install it", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.devDependencies["@aws-sdk/client-s3"],
    "the PII jobs run `npm ci` at the repo root, so the SDK must be declared there");
  assert.match(read("package-lock.json"), /@aws-sdk\/client-s3/,
    "lockfile must pin it — a floating install is what caused the 5-day retention " +
      "gap in August");
});
