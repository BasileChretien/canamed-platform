#!/usr/bin/env node
/* Pick an archive destination and upload to it.
 *
 * One dispatcher, two call sites (backup-sessions, pseudonymise-export). The
 * choice must not be duplicated in each script: they would drift, and the thing
 * that would drift is where identified PII gets written.
 *
 * Order is S3 first, then GCS. GCS is not deleted because nothing about it was
 * wrong — it stopped working when the project left the paid plan, and it is the
 * better destination if billing ever returns (same trust domain as the database,
 * no extra vendor). Keeping both means restoring Blaze is a config change rather
 * than a revert.
 *
 * ⚠️ `chooseDestination()` returning null means NO ARCHIVE, which the callers
 * must treat as "do not write the backup marker". The marker is what authorises
 * the nightly purge to delete (scripts/lib/backup-marker.js); vouching for an
 * archive that does not exist is the one failure this whole arrangement exists
 * to prevent.
 */

"use strict";

const { uploadToGcs } = require("./gcs-archive");
const { uploadToS3, s3ConfigFromEnv } = require("./s3-archive");

/**
 * Decide where this run should archive to.
 *
 * @param {object} opts
 * @param {string} [opts.gcsBucket]  the job's GCS bucket env value
 * @param {object} [opts.env]        defaults to process.env
 * @returns {{kind:"s3", config:object} | {kind:"gcs", bucket:string} | null}
 */
function chooseDestination({ gcsBucket = "", env = process.env } = {}) {
  const s3 = s3ConfigFromEnv(env);
  if (s3) return { kind: "s3", config: s3 };
  if (gcsBucket) return { kind: "gcs", bucket: gcsBucket };
  return null;
}

/**
 * Upload one file to the chosen destination.
 *
 * @param {object} dest         from chooseDestination()
 * @param {object} opts
 * @param {string} opts.localPath
 * @param {string} opts.destination  object key
 * @returns {Promise<string>} a `s3://…` or `gs://…` URI
 */
async function uploadArchive(dest, { localPath, destination }) {
  if (!dest) throw new Error("uploadArchive: no destination configured");
  if (dest.kind === "s3") {
    return uploadToS3(Object.assign({}, dest.config, { localPath, destination }));
  }
  if (dest.kind === "gcs") {
    return uploadToGcs({ bucket: dest.bucket, localPath, destination });
  }
  throw new Error("uploadArchive: unknown destination kind: " + dest.kind);
}

/** A one-line description for the job log, so a run says where it archived. */
function describeDestination(dest) {
  if (!dest) return "none — NOTHING WILL BE ARCHIVED and no backup marker will be written";
  if (dest.kind === "s3") {
    return `S3-compatible: ${dest.config.bucket} at ${dest.config.endpoint} (${dest.config.region})`;
  }
  return `Google Cloud Storage: ${dest.bucket}`;
}

module.exports = { chooseDestination, uploadArchive, describeDestination };
