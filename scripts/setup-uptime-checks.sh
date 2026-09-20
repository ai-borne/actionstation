#!/usr/bin/env bash
# setup-uptime-checks.sh — Cloud Monitoring uptime checks + email alerts (idempotent)
#
# Checks (every 5 min from all probe regions, 10 s timeout):
#   1. https://www.actionstation.in/            → 2xx, valid SSL
#   2. <functions host>/health                  → 2xx and body contains "status":"ok"
#
# Each check gets an alert policy on the existing "Eden Alerts" email channel that
# fires when 2+ probe regions report failure. The 10 s timeout leaves room for the
# health function's ~5 s cold start (minInstances is 0 by design).
#
# Requires the channel created by scripts/setup-monitoring-alerts.sh.
# Prerequisites: gcloud auth login
# Run: bash scripts/setup-uptime-checks.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-actionstation-244f0}"
SITE_HOST="${SITE_HOST:-www.actionstation.in}"
FUNCTIONS_HOST="${FUNCTIONS_HOST:-us-central1-${PROJECT_ID}.cloudfunctions.net}"
CHANNEL_DISPLAY_NAME="Eden Alerts"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

CHANNEL_NAME=$(gcloud beta monitoring channels list \
  --filter="displayName=\"${CHANNEL_DISPLAY_NAME}\" AND type=\"email\"" \
  --format="value(name)" --project="$PROJECT_ID" | head -1)
if [[ -z "$CHANNEL_NAME" ]]; then
  echo "✗ Email channel '${CHANNEL_DISPLAY_NAME}' not found. Run scripts/setup-monitoring-alerts.sh first."
  exit 1
fi
echo "▶ Project: $PROJECT_ID   Channel: $CHANNEL_NAME"
echo ""

# ensure_check DISPLAY_NAME HOST PATH [extra gcloud flags...] → prints the check id
ensure_check() {
  local display_name="$1" host="$2" path="$3"
  shift 3
  local existing
  existing=$(gcloud monitoring uptime list-configs --project="$PROJECT_ID" \
    --filter="displayName=\"${display_name}\"" --format="value(name)" | head -1)
  if [[ -z "$existing" ]]; then
    gcloud monitoring uptime create "$display_name" \
      --project="$PROJECT_ID" --resource-type=uptime-url \
      --resource-labels="host=${host},project_id=${PROJECT_ID}" \
      --protocol=https --path="$path" --port=443 --request-method=get \
      --validate-ssl=true --status-classes=2xx --period=5 --timeout=10 "$@" >&2
    existing=$(gcloud monitoring uptime list-configs --project="$PROJECT_ID" \
      --filter="displayName=\"${display_name}\"" --format="value(name)" | head -1)
    echo "  ✓ check created: $display_name" >&2
  else
    echo "  ✓ check exists:  $display_name" >&2
  fi
  basename "$existing"
}

# ensure_alert DISPLAY_NAME CHECK_ID DOC
ensure_alert() {
  local display_name="$1" check_id="$2" doc="$3" file existing
  file="$WORK_DIR/${check_id}.json"
  cat > "$file" << EOF
{
  "displayName": "${display_name}",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Uptime check failing from 2+ regions",
      "conditionThreshold": {
        "filter": "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${check_id}\"",
        "aggregations": [
          {
            "alignmentPeriod": "1200s",
            "perSeriesAligner": "ALIGN_NEXT_OLDER",
            "crossSeriesReducer": "REDUCE_COUNT_FALSE",
            "groupByFields": ["resource.label.*"]
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 1,
        "duration": "60s"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": { "autoClose": "604800s" },
  "severity": "CRITICAL",
  "documentation": { "content": "${doc}", "mimeType": "text/markdown" }
}
EOF
  existing=$(gcloud alpha monitoring policies list --project="$PROJECT_ID" \
    --filter="displayName=\"${display_name}\"" --format="value(name)" | head -1)
  if [[ -n "$existing" ]]; then
    gcloud alpha monitoring policies update "$existing" --policy-from-file="$file" \
      --project="$PROJECT_ID" --quiet >/dev/null
    echo "  ✓ alert updated: $display_name"
  else
    gcloud alpha monitoring policies create --policy-from-file="$file" \
      --project="$PROJECT_ID" --quiet >/dev/null
    echo "  ✓ alert created: $display_name"
  fi
}

echo "▶ Uptime checks"
SITE_ID=$(ensure_check "ActionStation site (www)" "$SITE_HOST" "/")
HEALTH_ID=$(ensure_check "ActionStation /health" "$FUNCTIONS_HOST" "/health" \
  --matcher-type=contains-string --matcher-content='"status":"ok"')
echo ""

echo "▶ Alert policies"
ensure_alert "CRITICAL: Site Down (www.actionstation.in)" "$SITE_ID" \
  "https://${SITE_HOST}/ is failing from 2+ probe regions. Check Firebase Hosting status and the last deploy."
ensure_alert "CRITICAL: /health Down" "$HEALTH_ID" \
  "The health function is failing from 2+ probe regions. Check Cloud Run logs for the health service and the last functions deploy."
echo ""
echo "✓ Done: https://console.cloud.google.com/monitoring/uptime?project=$PROJECT_ID"
