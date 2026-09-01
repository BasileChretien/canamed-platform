#!/usr/bin/env node
/* Upload a local file to a PRIVATE S3-compatible bucket.
 *
 * WHY THIS EXISTS. The retention purge deletes sessions every night. Its
 * counterpart, the backup, has not produced an archive since 2026-08-27: it
 * writes to Google Cloud Storage, GCS needs an active billing account, and the
 * project returned to the Spark plan. So deletion has been running with no
 * recovery path, and the backup/purge interlock is deliberately DISARMED
 * because arming it would block deletion forever and turn a missing-archive
 * problem into a standing retention breach (see scripts/lib/backup-marker.js).
 *
 * Both halves of GCS were checked before adding this, rather than assumed:
 *   - the existing bucket returns "The billing account for the owning project
 *     is disabled in state closed";
 *   - the Firebase default bucket returns "The specified bucket does not
 *     exist" — it was never provisioned, and provisioning one also needs
 *     billing.
 * So GCS is unavailable, not misconfigured.
 *
 * WHY SCALEWAY, and not a new vendor. Scaleway is ALREADY a disclosed
 * sub-processor for this platform (it hosts the language-model relay), its DPA
 * is already in force, its Object Storage is in `fr-par` (Paris, EEA) so the
 * archive does not leave the EEA, and the free allowance is 75 GB against an
 * artefact measured in tens of kilobytes. Adding a different provider would
 * mean a new DPA, a new Annex III row and a new disclosure in eight languages,
 * for no benefit.
 *
 * ⚠️ THE BUCKET MUST BE PRIVATE. These artefacts are the identified `/sessions`
 * tree and a real-name → pseudonym linkage table. Uploads here are explicitly
 * private-ACL and no-store, but an object ACL cannot save a bucket that is
 * world-readable — check the bucket's visibility, and set a lifecycle rule
 * matching the retention policy.
 */

"use strict";

const fs = require("fs");

/* The SDK is required LAZILY, inside the upload, for two reasons. It is a large
 * dependency that jobs which never archive should not pay to load; and it keeps
 * this module require-able — hence testable, with an injected client — on a
 * checkout where it is not installed. A top-level require would make every test
 * that touches the archive dispatcher depend on the dependency being present. */
function loadSdk() {
  try {
    return require("@aws-sdk/client-s3");
  } catch (e) {
    throw new Error(
      "uploadToS3: @aws-sdk/client-s3 is not installed. The workflows install it " +
      "via `npm ci` from the root package.json; if you are running this by hand, " +
      "install it first. (" + e.code + ")"
    );
  }
}

/**
 * @param {object} opts
 * @param {string} opts.bucket           bucket name
 * @param {string} opts.localPath        file on disk to upload
 * @param {string} opts.destination      object key within the bucket
 * @param {string} opts.endpoint         e.g. https://s3.fr-par.scw.cloud
 * @param {string} opts.region           e.g. fr-par
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {object} [opts.client]         injected S3 client, for tests
 * @returns {Promise<string>} an `s3://bucket/key` URI
 */
async function uploadToS3(opts) {
  const { bucket, localPath, destination, endpoint, region,
          accessKeyId, secretAccessKey } = opts || {};

  /* Fail on each missing field BY NAME. A generic "bad config" here would be
   * read as "the backup is broken" and send someone into the script, when the
   * real fix is a one-line secret. */
  const missing = [];
  if (!bucket) missing.push("bucket (BACKUP_S3_BUCKET)");
  if (!localPath) missing.push("localPath");
  if (!destination) missing.push("destination");
  if (!endpoint) missing.push("endpoint (BACKUP_S3_ENDPOINT)");
  if (!region) missing.push("region (BACKUP_S3_REGION)");
  if (!accessKeyId) missing.push("accessKeyId (SCW_ACCESS_KEY)");
  if (!secretAccessKey) missing.push("secretAccessKey (SCW_SECRET_KEY)");
  if (missing.length) {
    throw new Error("uploadToS3: missing " + missing.join(", "));
  }

  /* https only. The credentials sign the request but the BODY is the identified
   * session tree; over http it would cross the network in clear. */
  if (!/^https:\/\//i.test(endpoint)) {
    throw new Error("uploadToS3: endpoint must be https, got: " + endpoint);
  }

  const params = {
    Bucket: bucket,
    Key: destination,
    Body: fs.readFileSync(localPath),
    ContentType: "application/json",
    // Belt and braces on top of a private bucket.
    ACL: "private",
    CacheControl: "private, no-store"
  };

  /* An injected client receives the PARAMS directly, so a test can assert on
     them without the SDK being installed. Only the real path loads the SDK and
     wraps them in a command object. */
  if (opts.client) {
    await opts.client.send(params);
    return `s3://${bucket}/${destination}`;
  }

  const { S3Client, PutObjectCommand } = loadSdk();
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    /* Scaleway supports virtual-hosted-style, but path-style is what its own
     * docs use for the S3 endpoint and it avoids a DNS dependency on the
     * bucket name. */
    forcePathStyle: true
  });
  await client.send(new PutObjectCommand(params));

  return `s3://${bucket}/${destination}`;
}

/**
 * Read the S3 destination out of the environment.
 *
 * Returns null when no S3 bucket is configured, so a caller can fall back to
 * GCS or to the no-archive path. Deliberately does NOT throw on a missing
 * bucket: "not configured" and "configured wrongly" are different states and
 * only the second is an error.
 */
function s3ConfigFromEnv(env = process.env) {
  const bucket = env.BACKUP_S3_BUCKET || "";
  if (!bucket) return null;
  return {
    bucket,
    endpoint: env.BACKUP_S3_ENDPOINT || "https://s3.fr-par.scw.cloud",
    region: env.BACKUP_S3_REGION || "fr-par",
    accessKeyId: env.SCW_ACCESS_KEY || "",
    secretAccessKey: env.SCW_SECRET_KEY || ""
  };
}

module.exports = { uploadToS3, s3ConfigFromEnv };
