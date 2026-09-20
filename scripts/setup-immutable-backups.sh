#!/usr/bin/env bash
# setup-immutable-backups.sh — retention-protected bucket for daily Firestore exports
#
# Idempotent. Creates gs://<project>-firestore-backups-immutable with uniform
# bucket-level access, object versioning and a 30-day retention policy, then
# grants the identities that run/perform the export exactly what they need.
#
# The retention policy is left UNLOCKED. Locking is irreversible (nobody, not
# even project owners or Google Support, can shorten or remove it, and the bucket
# cannot be deleted until every object expires), so it is a separate, deliberate
# command printed at the end — run it only after a successful backup + restore drill.
#
# Identities (gen2 scheduled functions run as the DEFAULT COMPUTE service account):
#   - caller:  <project-number>-compute@developer.gserviceaccount.com
#              needs roles/datastore.importExportAdmin to start the export
#   - writer:  <project-id>@appspot.gserviceaccount.com
#              Firestore export writes objects with this account
#
# Prerequisites: gcloud auth login (owner or equivalent)
# Run: bash scripts/setup-immutable-backups.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-actionstation-244f0}"
BUCKET="gs://${PROJECT_ID}-firestore-backups-immutable"
LOCATION="us-central1"
RETENTION="30d"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")"
CALLER_SA="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
WRITER_SA="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "▶ Project:   $PROJECT_ID ($PROJECT_NUMBER)"
echo "▶ Bucket:    $BUCKET"
echo "▶ Retention: $RETENTION (unlocked)"
echo ""

# ── 1. Bucket ────────────────────────────────────────────────────────────────
echo "── 1. Bucket"
if gcloud storage buckets describe "$BUCKET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "  ✓ exists"
else
  gcloud storage buckets create "$BUCKET" --project="$PROJECT_ID" \
    --location="$LOCATION" --uniform-bucket-level-access \
    --public-access-prevention
  echo "  ✓ created"
fi

# ── 2. Versioning, retention, lifecycle ──────────────────────────────────────
echo "── 2. Versioning + retention + lifecycle"
cat > "$WORK_DIR/lifecycle.json" << 'EOF'
{
  "rule": [
    { "action": { "type": "Delete" }, "condition": { "age": 90, "isLive": false } }
  ]
}
EOF
gcloud storage buckets update "$BUCKET" --project="$PROJECT_ID" \
  --versioning --retention-period="$RETENTION" --lifecycle-file="$WORK_DIR/lifecycle.json"
echo "  ✓ versioning on, ${RETENTION} retention, non-current versions deleted after 90 days"

# ── 3. IAM ───────────────────────────────────────────────────────────────────
echo "── 3. IAM"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="$CALLER_SA" --role="roles/datastore.importExportAdmin" \
  --condition=None --quiet >/dev/null
echo "  ✓ ${CALLER_SA#serviceAccount:} → datastore.importExportAdmin (project)"

for ROLE in roles/storage.objectCreator roles/storage.objectViewer roles/storage.legacyBucketReader; do
  gcloud storage buckets add-iam-policy-binding "$BUCKET" --project="$PROJECT_ID" \
    --member="$WRITER_SA" --role="$ROLE" >/dev/null
done
echo "  ✓ ${WRITER_SA#serviceAccount:} → objectCreator, objectViewer, legacyBucketReader (bucket)"

# ── 4. Verify ────────────────────────────────────────────────────────────────
echo "── 4. Verify"
gcloud storage buckets describe "$BUCKET" --project="$PROJECT_ID" \
  --format="yaml(retention_policy,versioning_enabled,uniform_bucket_level_access,location)"

echo ""
echo "✓ Ready. Trigger a backup:"
echo "    gcloud scheduler jobs run firebase-schedule-firestoreBackup-us-central1 --location=us-central1 --project=$PROJECT_ID"
echo ""
echo "⚠  Retention is NOT locked. After a successful backup and restore drill, lock it (IRREVERSIBLE):"
echo "    gcloud storage buckets update $BUCKET --lock-retention-period"
