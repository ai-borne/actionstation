#!/usr/bin/env bash
# setup-monitoring-alerts.sh
# Idempotent: creates or updates log-based metrics and alert policies.
# Safe to re-run — policies are matched by displayName, metrics by name.
#
# All functions are gen2 (Cloud Run), so logs carry resource.type="cloud_run_revision"
# and the service name label is lowercase (e.g. geminiproxy). Counts are per minute
# (ALIGN_DELTA over 60s); ALIGN_RATE would be per second.
#
# Alerts:
#   1. Cloud Run 5xx > 50/min (any function)
#   2. geminiProxy 429 > 20/min
#   3. CRITICAL webhook signature failures > 5/min
#   4. Payment failures > 10/hour
#   5. Checkout 429 > 10/min
#   6. CRITICAL auth failures > 10/min
#   7. HIGH bot detections > 5/min
#   8. HIGH Firestore backup failed (any ERROR from firestoreBackup)
#
# Prerequisites: gcloud auth login (roles: monitoring.editor, logging.configWriter)
# Run: bash scripts/setup-monitoring-alerts.sh
# Env: GCP_PROJECT, ALERT_EMAIL, SLACK_WEBHOOK_URL (optional)

set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-actionstation-244f0}"
NOTIFICATION_EMAIL="${ALERT_EMAIL:-mail.sunilpawar@gmail.com}"
CHANNEL_DISPLAY_NAME="Eden Alerts"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "▶ Project: $PROJECT_ID"
echo "▶ Alert email: $NOTIFICATION_EMAIL"
echo ""

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
  echo "✗ Not authenticated. Run: gcloud auth login"
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
# upsert_metric NAME DESCRIPTION FILTER
upsert_metric() {
  local name="$1" description="$2" filter="$3"
  if gcloud logging metrics describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud logging metrics update "$name" --description="$description" \
      --log-filter="$filter" --project="$PROJECT_ID" --quiet >/dev/null
    echo "  ✓ metric updated: $name"
  else
    gcloud logging metrics create "$name" --description="$description" \
      --log-filter="$filter" --project="$PROJECT_ID" --quiet >/dev/null
    echo "  ✓ metric created: $name"
  fi
}

# upsert_policy DISPLAY_NAME FILE — updates in place when displayName already exists
upsert_policy() {
  local display_name="$1" file="$2" existing
  existing=$(gcloud alpha monitoring policies list --project="$PROJECT_ID" \
    --filter="displayName=\"${display_name}\"" --format="value(name)" | head -1)
  if [[ -n "$existing" ]]; then
    gcloud alpha monitoring policies update "$existing" --policy-from-file="$file" \
      --project="$PROJECT_ID" --quiet >/dev/null
    echo "  ✓ policy updated: $display_name"
  else
    gcloud alpha monitoring policies create --policy-from-file="$file" \
      --project="$PROJECT_ID" --quiet >/dev/null
    echo "  ✓ policy created: $display_name"
  fi
}

# ── 1. Email notification channel ─────────────────────────────────────────────
echo "▶ Notification channel..."
CHANNEL_NAME=$(gcloud beta monitoring channels list \
  --filter="displayName=\"${CHANNEL_DISPLAY_NAME}\" AND type=\"email\"" \
  --format="value(name)" --project="$PROJECT_ID" | head -1)

if [[ -z "$CHANNEL_NAME" ]]; then
  CHANNEL_NAME=$(gcloud beta monitoring channels create \
    --display-name="$CHANNEL_DISPLAY_NAME" --type=email \
    --channel-labels="email_address=${NOTIFICATION_EMAIL}" \
    --project="$PROJECT_ID" --quiet --format="value(name)")
fi
echo "  ✓ $CHANNEL_NAME"
echo ""

# ── 2. Log-based metrics ──────────────────────────────────────────────────────
echo "▶ Log-based metrics..."
SECURITY_FILTER='resource.type="cloud_run_revision" AND jsonPayload.labels.eden_security="true"'

upsert_metric geminiProxy_429 "HTTP 429 responses from geminiProxy" \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="geminiproxy" AND httpRequest.status=429'
upsert_metric checkout_429 "HTTP 429 responses from createCheckoutSession" \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="createcheckoutsession" AND httpRequest.status=429'
upsert_metric webhook_sig_failure "Payment webhook signature verification failures" \
  "${SECURITY_FILTER} AND jsonPayload.labels.event_type=\"webhook_sig_failure\""
upsert_metric payment_failed_events "Payment failure events from webhooks" \
  "${SECURITY_FILTER} AND jsonPayload.labels.event_type=\"payment_failed\""
upsert_metric auth_failure_spike "Auth failures logged by the Cloud Functions security layer" \
  "${SECURITY_FILTER} AND jsonPayload.labels.event_type=\"auth_failure\""
upsert_metric bot_detected_spike "Bot/scanner detections from the Cloud Functions bot detector" \
  "${SECURITY_FILTER} AND jsonPayload.labels.event_type=\"bot_detected\""
upsert_metric firestore_backup_failed "ERROR logs from the scheduled Firestore backup" \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="firestorebackup" AND severity>=ERROR'
echo ""

# ── 3. Alert policies ─────────────────────────────────────────────────────────
echo "▶ Alert policies..."

cat > "$WORK_DIR/error-rate.json" << EOF
{
  "displayName": "Cloud Function Error Rate > 50/min",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Cloud Run 5xx responses",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\"",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.label.service_name"]
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 50,
        "duration": "0s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "documentation": {
    "content": "A function is returning 5xx at > 50/min. Logs: https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%20severity%3DERROR?project=${PROJECT_ID}",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "Cloud Function Error Rate > 50/min" "$WORK_DIR/error-rate.json"

cat > "$WORK_DIR/gemini-429.json" << EOF
{
  "displayName": "geminiProxy 429 Rate > 20/min",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "geminiProxy rate limit hits",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/geminiProxy_429\"",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 20,
        "duration": "0s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "documentation": {
    "content": "geminiProxy is rate-limiting users at > 20/min. Consider raising GEMINI_RATE_LIMIT in securityConstants.ts or moving the limiter to Redis.",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "geminiProxy 429 Rate > 20/min" "$WORK_DIR/gemini-429.json"

cat > "$WORK_DIR/webhook-sig.json" << EOF
{
  "displayName": "CRITICAL: Webhook Signature Failure Spike > 5/min",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Payment webhook signature verification failures",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/webhook_sig_failure\"",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 5,
        "duration": "0s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "severity": "CRITICAL",
  "documentation": {
    "content": "Payment webhook signature verification is failing at > 5/min. Possible attack or a mismatched webhook secret. Runbook: docs/runbooks/PAYMENT-INCIDENTS.md",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "CRITICAL: Webhook Signature Failure Spike > 5/min" "$WORK_DIR/webhook-sig.json"

cat > "$WORK_DIR/payment-failed.json" << EOF
{
  "displayName": "Payment Failure Spike > 10/hour",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Payment failures",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/payment_failed_events\"",
        "aggregations": [
          {
            "alignmentPeriod": "3600s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 10,
        "duration": "0s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "documentation": {
    "content": "More than 10 payment failures in an hour. Check the payment provider dashboard. Runbook: docs/runbooks/PAYMENT-INCIDENTS.md",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "Payment Failure Spike > 10/hour" "$WORK_DIR/payment-failed.json"

cat > "$WORK_DIR/checkout-429.json" << EOF
{
  "displayName": "Checkout 429 Rate > 10/min",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Checkout session rate limiting",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/checkout_429\"",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 10,
        "duration": "0s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "documentation": {
    "content": "Checkout endpoint is rate-limiting at > 10/min. Possible abuse or a legitimate spike. See IP rate limit config in securityConstants.ts.",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "Checkout 429 Rate > 10/min" "$WORK_DIR/checkout-429.json"

cat > "$WORK_DIR/auth-failure.json" << EOF
{
  "displayName": "CRITICAL: Auth Failure Spike > 10/min",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "auth_failure_spike > 10/min",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/auth_failure_spike\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 10,
        "duration": "0s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "severity": "CRITICAL",
  "documentation": {
    "content": "Auth failure spike. Possible credential stuffing. Check Cloud Logging for auth_failure events and review IP patterns.",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "CRITICAL: Auth Failure Spike > 10/min" "$WORK_DIR/auth-failure.json"

cat > "$WORK_DIR/bot-detected.json" << EOF
{
  "displayName": "HIGH: Bot Detection Spike > 5/min",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "bot_detected_spike > 5/min",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/bot_detected_spike\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 5,
        "duration": "0s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "severity": "WARNING",
  "documentation": {
    "content": "Bot/scanner activity spike. Review Cloud Logging for bot_detected events and consider IP blocks.",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "HIGH: Bot Detection Spike > 5/min" "$WORK_DIR/bot-detected.json"

cat > "$WORK_DIR/backup-failed.json" << EOF
{
  "displayName": "HIGH: Firestore Backup Failed",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "firestoreBackup logged an ERROR",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/firestore_backup_failed\"",
        "aggregations": [
          {
            "alignmentPeriod": "3600s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "86400s" },
  "severity": "ERROR",
  "documentation": {
    "content": "The daily Firestore export failed. Check logs for firestoreBackup, then IAM (compute SA needs roles/datastore.importExportAdmin) and the bucket gs://${PROJECT_ID}-firestore-backups-immutable. Runbook: docs/runbooks/FIRESTORE-RESTORE.md",
    "mimeType": "text/markdown"
  }
}
EOF
upsert_policy "HIGH: Firestore Backup Failed" "$WORK_DIR/backup-failed.json"
echo ""

# ── 4. Optional Slack channel ─────────────────────────────────────────────────
if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
  SLACK_CHANNEL=$(gcloud beta monitoring channels create \
    --display-name="Eden Slack Alerts" \
    --type=slack \
    --channel-labels="url=${SLACK_WEBHOOK_URL}" \
    --project="$PROJECT_ID" --quiet --format="value(name)")
  echo "  ✓ Slack channel created: $SLACK_CHANNEL"
  echo "  (Add it to notificationChannels of the CRITICAL policies to enable Slack)"
else
  echo "  (SLACK_WEBHOOK_URL not set — skipping Slack channel)"
fi
echo ""
echo "✓ Done: https://console.cloud.google.com/monitoring/alerting?project=$PROJECT_ID"
echo "  Email channels may need a verification click from GCP before alerts deliver."
