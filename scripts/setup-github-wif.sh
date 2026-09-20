#!/usr/bin/env bash
# setup-github-wif.sh — keyless GitHub Actions → Google Cloud auth (idempotent)
#
# Creates:
#   - Workload Identity pool "github-actions" + OIDC provider "github", locked to
#     one repository (assertion.repository == GITHUB_REPO). Fork PRs carry a
#     different repository claim, so they can never obtain a token.
#   - Service account "ci-dryrun": READ-ONLY roles, used by the PR "Firebase Deploy
#     Dry-Run" job. PR workflows can be edited by anyone who can push a branch, so
#     this identity must not be able to change production.
#   - Two GitHub repo variables (identifiers, not secrets): GCP_WIF_PROVIDER, GCP_DRYRUN_SA
#
# NOT created here: the deploy identity that replaces FIREBASE_TOKEN in deploy.yml.
# It must be a separate service account whose workloadIdentityUser binding is limited
# to refs/heads/main (the provider already maps attribute.ref). Tracked as checklist C11a.
#
# Prerequisites: gcloud auth login (owner), gh auth login (repo admin)
# Run: bash scripts/setup-github-wif.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-actionstation-244f0}"
GITHUB_REPO="${GITHUB_REPO:-ai-borne/actionstation}"
POOL="github-actions"
PROVIDER="github"
SA_NAME="ci-dryrun"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")"
POOL_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
PROVIDER_PATH="${POOL_PATH}/providers/${PROVIDER}"

# Function runtime identities (gen2 defaults) — see the actAs note in step 3
RUNTIME_SAS=(
  "${PROJECT_ID}@appspot.gserviceaccount.com"
  "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
)

# Read-only: enough for `firebase deploy --dry-run` to validate rules, indexes and functions.
DRYRUN_ROLES=(
  roles/firebase.viewer
  roles/cloudfunctions.viewer
  roles/run.viewer
  roles/cloudscheduler.viewer
  roles/eventarc.viewer
  roles/pubsub.viewer
  roles/artifactregistry.reader
  roles/secretmanager.viewer
  roles/serviceusage.serviceUsageViewer
  roles/serviceusage.serviceUsageConsumer
  roles/datastore.viewer
)

echo "▶ Project: $PROJECT_ID ($PROJECT_NUMBER)   Repo: $GITHUB_REPO"
echo ""

echo "── 1. APIs"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com \
  --project="$PROJECT_ID"

echo "── 2. Workload Identity pool + provider"
if gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "  ✓ pool exists"
else
  gcloud iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT_ID" \
    --display-name="GitHub Actions" >/dev/null
  echo "  ✓ pool created"
fi
PROVIDER_FLAGS=(
  --location=global --project="$PROJECT_ID" --workload-identity-pool="$POOL"
  --issuer-uri="https://token.actions.githubusercontent.com"
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name"
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
)
if gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --project="$PROJECT_ID" --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" "${PROVIDER_FLAGS[@]}" >/dev/null
  echo "  ✓ provider updated"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" "${PROVIDER_FLAGS[@]}" \
    --display-name="GitHub" >/dev/null
  echo "  ✓ provider created"
fi

echo "── 3. Dry-run service account (read-only)"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "  ✓ exists: $SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT_ID" \
    --display-name="CI Firebase deploy dry-run (read-only)" >/dev/null
  echo "  ✓ created: $SA_EMAIL"
fi
for ROLE in "${DRYRUN_ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" --condition=None --quiet >/dev/null
done
echo "  ✓ ${#DRYRUN_ROLES[@]} read-only roles bound"

# Compiling rules during a dry-run calls firebaserules `:test`. Every predefined role that has
# firebaserules.rulesets.test also has releases.create/update (i.e. could overwrite production
# security rules), so grant a custom role holding ONLY the test permission.
RULES_TEST_ROLE="ciDryRunRulesTest"
if gcloud iam roles describe "$RULES_TEST_ROLE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles update "$RULES_TEST_ROLE" --project="$PROJECT_ID" --quiet \
    --permissions="firebaserules.rulesets.test" >/dev/null
else
  gcloud iam roles create "$RULES_TEST_ROLE" --project="$PROJECT_ID" --quiet \
    --title="CI dry-run: test Firebase rules" --stage=GA \
    --permissions="firebaserules.rulesets.test" >/dev/null
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="projects/${PROJECT_ID}/roles/${RULES_TEST_ROLE}" \
  --condition=None --quiet >/dev/null
echo "  ✓ custom role ${RULES_TEST_ROLE} (rulesets.test only) bound"

# firebase-tools checks iam.serviceAccounts.actAs on the function runtime SA(s) even for
# --dry-run. Granted on those SAs only (not project-wide). It is inert on its own:
# ci-dryrun has no permission to create any resource that could run as them.
for RUNTIME_SA in "${RUNTIME_SAS[@]}"; do
  gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT_ID" \
    --role="roles/iam.serviceAccountUser" --member="serviceAccount:${SA_EMAIL}" \
    --condition=None --quiet >/dev/null
  echo "  ✓ ${SA_NAME} may actAs ${RUNTIME_SA}"
done

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_PATH}/attribute.repository/${GITHUB_REPO}" \
  --condition=None --quiet >/dev/null
echo "  ✓ ${GITHUB_REPO} may impersonate ${SA_NAME}"

echo "── 4. GitHub repo variables"
gh variable set GCP_WIF_PROVIDER --repo "$GITHUB_REPO" --body "$PROVIDER_PATH"
gh variable set GCP_DRYRUN_SA --repo "$GITHUB_REPO" --body "$SA_EMAIL"
echo "  ✓ GCP_WIF_PROVIDER, GCP_DRYRUN_SA set"

echo ""
echo "✓ Done. Provider: $PROVIDER_PATH"
