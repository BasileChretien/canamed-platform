#!/usr/bin/env node
/* Upload a local file to a PRIVATE Google Cloud Storage bucket using the
 * already-initialised firebase-admin app's credentials.
 *
 * Why this exists: backup-sessions.js and pseudonymise-export.js produce
 * artefacts containing identified PII. The original workflows uploaded them
 * as GitHub Actions artifacts, which is fine on a PRIVATE repo but a breach
 * on a PUBLIC one (public-repo artifacts are downloadable by anyone with
 * read access — i.e. everyone). Routing the artefacts to a private GCS
 * bucket instead lets those jobs run from the public repo: the job LOGS
 * carry no PII, and the PII lands in a bucket only the service account and
 * project admins can read.
 *
 * firebase-admin bundles @google-cloud/storage, so this needs no extra
 * dependency beyond the firebase-admin the workflows already install.
 *
 * The caller MUST ensure the bucket is private (no `allUsers` /
 * `allAuthenticatedUsers` IAM binding) and ideally has lifecycle rules that
 * auto-delete objects per the retention policy (see the workflow headers).
 */

"use strict";

const admin = require("firebase-admin");

/**
 * @param {object}  opts
 * @param {string}  opts.bucket       GCS bucket name (no `gs://` prefix).
 * @param {string}  opts.localPath    Path to the file on disk to upload.
 * @param {string}  opts.destination  Object path within the bucket.
 * @returns {Promise<string>} The `gs://bucket/object` URI of the uploaded file.
 */
async function uploadToGcs({ bucket, localPath, destination }) {
  if (!bucket) throw new Error("uploadToGcs: bucket name is required");
  if (!localPath) throw new Error("uploadToGcs: localPath is required");
  if (!destination) throw new Error("uploadToGcs: destination is required");

  const [file] = await admin.storage().bucket(bucket).upload(localPath, {
    destination,
    resumable: false, // small JSON files — one-shot upload is simpler/faster
    metadata: {
      // Belt-and-braces: never let a CDN/proxy cache PII, even though the
      // bucket itself must be private.
      cacheControl: "private, no-store"
    }
  });
  return `gs://${bucket}/${file.name}`;
}

module.exports = { uploadToGcs };
