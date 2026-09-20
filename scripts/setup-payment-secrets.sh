#!/usr/bin/env bash
#
# setup-payment-secrets.sh — Store payment secrets in Google Cloud Secret Manager
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Every command passes --project explicitly; the script never changes your gcloud default
#   - Secret Manager API enabled
#
# Usage:
#   ./scripts/setup-payment-secrets.sh
#
# Supports partial setup — you can configure Razorpay now and add Stripe/Turnstile later.
#
set -euo pipefail

PROJECT_ID="actionstation-244f0"
# Gen2 functions run as the default compute SA; the appspot SA is kept for gen1/legacy callers.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
SERVICE_ACCOUNTS=(
    "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    "${PROJECT_ID}@appspot.gserviceaccount.com"
)

echo "==> Using project ${PROJECT_ID} (${PROJECT_NUMBER})"

echo "==> Enabling Secret Manager API (if not already enabled)"
gcloud services enable secretmanager.googleapis.com --project "${PROJECT_ID}"

# ── Helper: create or update a secret ──────────────────────────────────────

create_or_update_secret() {
    local SECRET_NAME="$1"
    local SECRET_VALUE="$2"

    if gcloud secrets describe "${SECRET_NAME}" --project "${PROJECT_ID}" &>/dev/null; then
        echo "    Secret '${SECRET_NAME}' exists — adding new version"
    else
        echo "    Creating secret '${SECRET_NAME}'"
        gcloud secrets create "${SECRET_NAME}" \
            --replication-policy="automatic" \
            --project "${PROJECT_ID}" \
            --quiet
    fi

    echo -n "${SECRET_VALUE}" | gcloud secrets versions add "${SECRET_NAME}" \
        --data-file=- \
        --project "${PROJECT_ID}" \
        --quiet

    echo "    ✓ ${SECRET_NAME} version added"
}

# ── Helper: grant SA access to a secret ────────────────────────────────────

grant_sa_access() {
    local SECRET_NAME="$1"
    local SA
    for SA in "${SERVICE_ACCOUNTS[@]}"; do
        echo "    Granting ${SA} access to ${SECRET_NAME}"
        gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
            --member="serviceAccount:${SA}" \
            --role="roles/secretmanager.secretAccessor" \
            --project "${PROJECT_ID}" \
            --quiet >/dev/null
    done
}

# ── Prompt: Razorpay (required) ───────────────────────────────────────────

echo ""
echo "=========================================="
echo "  STEP 1: Razorpay (required for India)"
echo "=========================================="
echo ""
echo "  Get these from: Razorpay Dashboard → Settings → API Keys"
echo ""

read -rsp "Razorpay Key ID (rzp_test_... or rzp_live_...): " RAZORPAY_KEY_ID
echo ""
read -rsp "Razorpay Key Secret: " RAZORPAY_KEY_SECRET
echo ""
read -rsp "Razorpay Webhook Secret: " RAZORPAY_WEBHOOK_SECRET
echo ""

if [[ -z "${RAZORPAY_KEY_ID}" || -z "${RAZORPAY_KEY_SECRET}" || -z "${RAZORPAY_WEBHOOK_SECRET}" ]]; then
    echo "ERROR: Razorpay secrets are required. Aborting."
    exit 1
fi

# ── Prompt: Stripe (optional — skip if not available yet) ─────────────────

echo ""
echo "=========================================="
echo "  STEP 2: Stripe (optional — press Enter to skip)"
echo "=========================================="
echo ""

read -rsp "Stripe Secret Key (sk_test_... or sk_live_..., Enter to skip): " STRIPE_SECRET_KEY
echo ""
read -rsp "Stripe Webhook Secret (whsec_..., Enter to skip): " STRIPE_WEBHOOK_SECRET
echo ""
read -rsp "Stripe Publishable Key (pk_test_... or pk_live_..., Enter to skip): " STRIPE_PUBLISHABLE_KEY
echo ""

# ── Prompt: Turnstile (optional) ──────────────────────────────────────────

echo ""
echo "=========================================="
echo "  STEP 3: Turnstile CAPTCHA (optional — press Enter to skip)"
echo "=========================================="
echo ""

read -rsp "Cloudflare Turnstile Secret Key (Enter to skip): " TURNSTILE_SECRET
echo ""

# ── Store secrets ─────────────────────────────────────────────────────────

echo ""
echo "==> Storing secrets in GCP Secret Manager"

# Always store Razorpay
create_or_update_secret "RAZORPAY_KEY_ID" "${RAZORPAY_KEY_ID}"
create_or_update_secret "RAZORPAY_KEY_SECRET" "${RAZORPAY_KEY_SECRET}"
create_or_update_secret "RAZORPAY_WEBHOOK_SECRET" "${RAZORPAY_WEBHOOK_SECRET}"

# Store Stripe if provided
if [[ -n "${STRIPE_SECRET_KEY}" ]]; then
    create_or_update_secret "STRIPE_SECRET_KEY" "${STRIPE_SECRET_KEY}"
fi
if [[ -n "${STRIPE_WEBHOOK_SECRET}" ]]; then
    create_or_update_secret "STRIPE_WEBHOOK_SECRET" "${STRIPE_WEBHOOK_SECRET}"
fi

# Store Turnstile if provided
if [[ -n "${TURNSTILE_SECRET}" ]]; then
    create_or_update_secret "TURNSTILE_SECRET" "${TURNSTILE_SECRET}"
fi

# ── Grant SA access ───────────────────────────────────────────────────────

echo ""
echo "==> Granting service account access to secrets"

# Always grant Razorpay
grant_sa_access "RAZORPAY_KEY_ID"
grant_sa_access "RAZORPAY_KEY_SECRET"
grant_sa_access "RAZORPAY_WEBHOOK_SECRET"

# Grant Stripe if provided
if [[ -n "${STRIPE_SECRET_KEY}" ]]; then
    grant_sa_access "STRIPE_SECRET_KEY"
fi
if [[ -n "${STRIPE_WEBHOOK_SECRET}" ]]; then
    grant_sa_access "STRIPE_WEBHOOK_SECRET"
fi

# Grant Turnstile if provided
if [[ -n "${TURNSTILE_SECRET}" ]]; then
    grant_sa_access "TURNSTILE_SECRET"
fi

# ── Verify ────────────────────────────────────────────────────────────────

echo ""
echo "==> Verifying secret access"

SECRETS_TO_CHECK="RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET"
[[ -n "${STRIPE_SECRET_KEY}" ]] && SECRETS_TO_CHECK="$SECRETS_TO_CHECK STRIPE_SECRET_KEY"
[[ -n "${STRIPE_WEBHOOK_SECRET}" ]] && SECRETS_TO_CHECK="$SECRETS_TO_CHECK STRIPE_WEBHOOK_SECRET"
[[ -n "${TURNSTILE_SECRET}" ]] && SECRETS_TO_CHECK="$SECRETS_TO_CHECK TURNSTILE_SECRET"

for SECRET in $SECRETS_TO_CHECK; do
    if gcloud secrets versions access latest --secret="${SECRET}" --project "${PROJECT_ID}" &>/dev/null; then
        echo "    ✓ ${SECRET} accessible"
    else
        echo "    ✗ ${SECRET} NOT accessible — check IAM permissions"
    fi
done

# ── Summary ───────────────────────────────────────────────────────────────

echo ""
echo "==> Secrets setup complete!"
echo ""
echo "Secrets configured:"
echo "  ✓ Razorpay: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET"
[[ -n "${STRIPE_SECRET_KEY}" ]] && echo "  ✓ Stripe: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET"
[[ -n "${TURNSTILE_SECRET}" ]] && echo "  ✓ Turnstile: TURNSTILE_SECRET"
echo ""
echo "Next steps (see docs/runbooks/PAYMENT-INCIDENTS.md, Runbook 5):"
echo "  1. Functions pin a secret VERSION at deploy — redeploy so the new versions are used:"
echo "     firebase deploy --only functions:razorpayWebhook,functions:createRazorpayOrder,functions:onUserDeleted --project ${PROJECT_ID}"
echo ""
echo "  2. Register the webhook in the Razorpay dashboard (test and live mode are separate),"
echo "     events: payment.captured, refund.processed:"
echo "     https://razorpaywebhook-hirwmylcjq-uc.a.run.app"
echo ""
if [[ -n "${STRIPE_PUBLISHABLE_KEY}" ]]; then
echo "  3. Add VITE_STRIPE_PUBLISHABLE_KEY to GitHub Secrets (if deploying)"
echo ""
fi
echo "  Deploy Hosting (when ready):"
echo "     firebase deploy --only hosting"
echo ""
