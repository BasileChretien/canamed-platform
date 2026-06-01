#!/usr/bin/env bash
# One-time setup for the CaNaMED private PII-archive bucket.
#
# Run this in Google Cloud Shell (https://console.cloud.google.com/ → the
# terminal icon), or any shell with gcloud authenticated as a canamed-69785
# project Owner/Editor. The script is idempotent — safe to re-run.
#
# It performs the three setup steps that back the public-repo
# backup-sessions / pseudonymise-export workflows:
#   1. Create a PRIVATE, EU-region bucket (uniform access +
#      public-access-prevention) for the PII archives.
#   2. Grant the Firebase Admin SDK service account roles/storage.objectAdmin
#      on JUST this bucket.  <-- ACCESS-CONTROL CHANGE: review before running.
#   3. Apply lifecycle rules: linkage/ = 14 days, backups/ + pseudonymised/
#      = 90 days (auto-deletion), mirroring scripts/ops/pii-bucket-lifecycle.json.
#
# After it succeeds, tell Claude — it will set the PII_ARCHIVE_BUCKET GitHub
# variable, dispatch both workflows to verify, and uncomment the schedules.

set -euo pipefail

PROJECT="canamed-69785"
BUCKET="canamed-pii-archive"
LOCATION="europe-west1"   # match the RTDB region — keep PII in the EU (GDPR)

echo "Project:  $PROJECT"
echo "Bucket:   gs://$BUCKET"
echo "Location: $LOCATION"
echo
gcloud config set project "$PROJECT"

# 1) Create the bucket (skip if it already exists) ---------------------------
if gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  echo "[1/3] Bucket already exists — skipping create."
else
  echo "[1/3] Creating private bucket..."
  gcloud storage buckets create "gs://$BUCKET" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

# 2) Grant the Firebase Admin SDK SA objectAdmin on the bucket ---------------
SA_EMAIL="$(gcloud iam service-accounts list \
  --project="$PROJECT" \
  --filter="email:firebase-adminsdk" \
  --format="value(email)" | head -n1)"

if [ -z "$SA_EMAIL" ]; then
  echo "ERROR: no firebase-adminsdk service account found in $PROJECT." >&2
  echo "       List them with: gcloud iam service-accounts list --project=$PROJECT" >&2
  exit 1
fi

echo
echo "[2/3] Service account: $SA_EMAIL"
echo "      About to grant roles/storage.objectAdmin on gs://$BUCKET."
echo "      This is an ACCESS-CONTROL change. Press Ctrl-C within 5s to abort."
sleep 5
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# 3) Lifecycle rules ---------------------------------------------------------
echo
echo "[3/3] Applying lifecycle rules (linkage 14d, backups/pseudonymised 90d)..."
LC_FILE="$(mktemp)"
cat > "$LC_FILE" <<'JSON'
{
  "rule": [
    { "action": { "type": "Delete" }, "condition": { "age": 14, "matchesPrefix": ["linkage/"] } },
    { "action": { "type": "Delete" }, "condition": { "age": 90, "matchesPrefix": ["backups/", "pseudonymised/"] } }
  ]
}
JSON
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$LC_FILE"
rm -f "$LC_FILE"

echo
echo "DONE — gs://$BUCKET is private, the SA can write to it, and lifecycle is set."
echo "Next: tell Claude to set PII_ARCHIVE_BUCKET=$BUCKET, dispatch the workflows,"
echo "      and enable the daily schedules."
