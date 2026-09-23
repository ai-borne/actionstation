#!/usr/bin/env bash
# =============================================================================
# setup-cloud-armor.sh — Attach Google Cloud Armor WAF to Cloud Run services
#
# Cloud Armor policies attach to load-balancer backend services, not directly
# to Cloud Run / Firebase Functions URLs. This script:
#
#   1. Enables required APIs
#   2. Creates a Cloud Armor security policy with pre-configured WAF rules
#      (SQLi, XSS, LFI, RCE, Scanner detection)
#   3. Creates serverless NEGs (Network Endpoint Groups) pointing at each
#      Cloud Run service that Firebase Functions v2 deployed
#   4. Wraps each NEG in a backend service and attaches the security policy
#   5. Creates a single HTTPS load balancer URL-map routing traffic through
#      those backend services
#
# After this script runs, update your DNS / firebase.json rewrites so that
# external traffic goes through the load balancer IP instead of directly to
# *.cloudfunctions.net.  (Or use it as an additional WAF layer with Cloud CDN.)
#
# COST: Cloud Armor charges ~$5/month per policy + $0.75/million requests.
#       Serverless NEG + HTTPS LB: ~$18/month base.
#
# PREREQUISITES
#   gcloud CLI authenticated:  gcloud auth login
#   Project set:               gcloud config set project $PROJECT_ID
#   Billing enabled on project
# =============================================================================
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="actionstation-244f0"
REGION="us-central1"
POLICY_NAME="eden-waf-policy"
LB_NAME="eden-lb"
URL_MAP_NAME="eden-url-map"
TARGET_HTTPS_PROXY="eden-https-proxy"
FORWARDING_RULE="eden-https-forwarding-rule"
SSL_CERT_NAME="eden-ssl-cert"        # managed cert — fill DOMAIN below
DOMAIN="www.actionstation.in"

# Cloud Run service names for HTTP-callable Cloud Functions only.
# Event triggers (Firestore/Storage/Scheduler) are NOT routable via HTTPS LB.
# Run: gcloud run services list --project=$PROJECT_ID --region=$REGION
SERVICES=(
  "fetchlinkmeta"
  "proxyimage"
  "signimageurls"
  "geminiproxy"
  "workspacebundle"
  "health"
  "verifyturnstile"
  "exchangecalendarcode"
  "disconnectcalendar"
  "calendarcreateevent"
  "calendarupdateevent"
  "calendardeleteevent"
  "calendarlistevents"
  "createcheckoutsession"
  "stripewebhook"
  "createbillingportalsession"
  "createrazorpayorder"
  "razorpaywebhook"
  "onuserdeleted"
  "gdprserverexport"
)

echo "► Project: $PROJECT_ID  Region: $REGION"

# ─── 1. Enable APIs ──────────────────────────────────────────────────────────
echo ""
echo "── Step 1: Enabling required APIs ──────────────────────────────────────"
gcloud services enable \
  compute.googleapis.com \
  networksecurity.googleapis.com \
  --project="$PROJECT_ID"

echo "APIs enabled."

# ─── 2. Create Cloud Armor security policy ───────────────────────────────────
echo ""
echo "── Step 2: Creating Cloud Armor security policy ────────────────────────"

gcloud compute security-policies create "$POLICY_NAME" \
  --description="Eden WAF policy — OWASP Top-10 rules + rate limiting" \
  --project="$PROJECT_ID" 2>/dev/null || echo "Policy already exists, continuing."

# --- WAF preconfigured rule sets -----------------------------------------
# Each rule set maps to a named OWASP CRS group.
# Priority lower number = higher precedence; default allow rule is 2147483647.

declare -A WAF_RULES=(
  ["1000"]="sqli-v33-stable"          # SQL injection
  ["1001"]="xss-v33-stable"           # Cross-site scripting
  ["1002"]="lfi-v33-stable"           # Local file inclusion
  ["1003"]="rfi-v33-stable"           # Remote file inclusion
  ["1004"]="rce-v33-stable"           # Remote code execution
  ["1005"]="methodenforcement-v33-stable"  # HTTP method enforcement
  ["1006"]="scannerdetection-v33-stable"   # Scanner / probe detection
  ["1007"]="protocolattack-v33-stable"     # Protocol attack
)

for PRIORITY in "${!WAF_RULES[@]}"; do
  RULESET="${WAF_RULES[$PRIORITY]}"
  echo "  Adding rule priority=$PRIORITY  expr=evaluatePreconfiguredExpr('${RULESET}')"
  gcloud compute security-policies rules create "$PRIORITY" \
    --security-policy="$POLICY_NAME" \
    --expression="evaluatePreconfiguredExpr('${RULESET}')" \
    --action=deny-403 \
    --description="OWASP CRS: ${RULESET}" \
    --project="$PROJECT_ID" 2>/dev/null \
    || echo "  Rule $PRIORITY already exists, skipping."
done

# --- Webhook burst protection rule (priority 850) ------------------------
# Priority 850 evaluates BEFORE the general 100 req/min limit (priority 900).
# Stripe/Razorpay send bursts of webhooks on payment events; the general limit
# would silently drop legitimate webhook events. This rule allows 500 req/min
# for webhook endpoints specifically, banning IPs that exceed even that.
echo "  Adding webhook rate-limit rule (priority=850)"
gcloud compute security-policies rules create 850 \
  --security-policy="$POLICY_NAME" \
  --expression="request.path.matches('/stripeWebhook') || request.path.matches('/razorpayWebhook')" \
  --action=rate-based-ban \
  --rate-limit-threshold-count=500 \
  --rate-limit-threshold-interval-sec=60 \
  --ban-duration-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP \
  --description="Webhook endpoints: 500 req/min burst tolerance (Stripe/Razorpay)" \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "  Webhook rate-limit rule already exists, skipping."

# --- IP-based rate limiting rule (priority 900) ---------------------------
# Throttle each source IP to 100 requests/minute across all endpoints.
echo "  Adding IP rate-limit rule (priority=900)"
gcloud compute security-policies rules create 900 \
  --security-policy="$POLICY_NAME" \
  --expression="true" \
  --action=rate-based-ban \
  --rate-limit-threshold-count=100 \
  --rate-limit-threshold-interval-sec=60 \
  --ban-duration-sec=300 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP \
  --description="Global IP rate limit: 100 req/min, ban 5 min on breach" \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "  Rate-limit rule already exists, skipping."

# --- Block known Tor exit nodes & abuse ranges (optional, extend as needed)
# gcloud compute security-policies rules create 800 \
#   --security-policy="$POLICY_NAME" \
#   --src-ip-ranges="<range1>,<range2>" \
#   --action=deny-403 \
#   --description="Block known abuse IP ranges" \
#   --project="$PROJECT_ID"

echo "Security policy '$POLICY_NAME' configured."

# ─── 3. Create serverless NEGs ───────────────────────────────────────────────
echo ""
echo "── Step 3: Creating serverless Network Endpoint Groups ─────────────────"

for SVC in "${SERVICES[@]}"; do
  NEG_NAME="neg-${SVC}"
  echo "  NEG: $NEG_NAME → Cloud Run service: $SVC"
  gcloud compute network-endpoint-groups create "$NEG_NAME" \
    --region="$REGION" \
    --network-endpoint-type=serverless \
    --cloud-run-service="$SVC" \
    --project="$PROJECT_ID" 2>/dev/null \
    || echo "  $NEG_NAME already exists, skipping."
done

echo "Serverless NEGs created."

# ─── 4. Create backend services and attach security policy ───────────────────
echo ""
echo "── Step 4: Creating backend services + attaching Cloud Armor policy ─────"

for SVC in "${SERVICES[@]}"; do
  NEG_NAME="neg-${SVC}"
  BACKEND_NAME="backend-${SVC}"

  echo "  Backend: $BACKEND_NAME"
  gcloud compute backend-services create "$BACKEND_NAME" \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --global \
    --project="$PROJECT_ID" 2>/dev/null \
    || echo "  $BACKEND_NAME already exists, skipping."

  # Add the serverless NEG to the backend
  gcloud compute backend-services add-backend "$BACKEND_NAME" \
    --network-endpoint-group="$NEG_NAME" \
    --network-endpoint-group-region="$REGION" \
    --global \
    --project="$PROJECT_ID" 2>/dev/null \
    || echo "  NEG already in backend, skipping."

  # Attach the Cloud Armor policy
  gcloud compute backend-services update "$BACKEND_NAME" \
    --security-policy="$POLICY_NAME" \
    --global \
    --project="$PROJECT_ID"
  echo "  ✓ Policy '$POLICY_NAME' attached to '$BACKEND_NAME'"
done

echo "Backend services configured."

# ─── 5. Create HTTPS load balancer ───────────────────────────────────────────
echo ""
echo "── Step 5: Creating HTTPS load balancer ────────────────────────────────"

# URL map — default backend routes to health function; add path rules as needed
gcloud compute url-maps create "$URL_MAP_NAME" \
  --default-service="backend-health" \
  --global \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "URL map already exists, skipping."

# Add path-matcher rules for each function endpoint
# NOTE: Every service in SERVICES=() must have a corresponding pathRules entry here.
# Missing entries cause traffic to fall through to backend-health (silently misrouted).
gcloud compute url-maps import "$URL_MAP_NAME" \
  --global \
  --source=- \
  --project="$PROJECT_ID" << 'URLMAP'
defaultService: global/backendServices/backend-health
hostRules:
  - hosts:
      - "*"
    pathMatcher: allpaths
pathMatchers:
  - name: allpaths
    defaultService: global/backendServices/backend-health
    pathRules:
      - paths: ["/fetchLinkMeta", "/fetchLinkMeta/*"]
        service: global/backendServices/backend-fetchlinkmeta
      - paths: ["/proxyImage", "/proxyImage/*"]
        service: global/backendServices/backend-proxyimage
      - paths: ["/signImageUrls", "/signImageUrls/*"]
        service: global/backendServices/backend-signimageurls
      - paths: ["/geminiProxy", "/geminiProxy/*"]
        service: global/backendServices/backend-geminiproxy
      - paths: ["/onUserDeleted", "/onUserDeleted/*"]
        service: global/backendServices/backend-onuserdeleted
      - paths: ["/workspaceBundle", "/workspaceBundle/*"]
        service: global/backendServices/backend-workspacebundle
      - paths: ["/health"]
        service: global/backendServices/backend-health
      - paths: ["/verifyTurnstile", "/verifyTurnstile/*"]
        service: global/backendServices/backend-verifyturnstile
      - paths: ["/exchangeCalendarCode", "/exchangeCalendarCode/*"]
        service: global/backendServices/backend-exchangecalendarcode
      - paths: ["/disconnectCalendar", "/disconnectCalendar/*"]
        service: global/backendServices/backend-disconnectcalendar
      - paths: ["/calendarCreateEvent", "/calendarCreateEvent/*"]
        service: global/backendServices/backend-calendarcreateevent
      - paths: ["/calendarUpdateEvent", "/calendarUpdateEvent/*"]
        service: global/backendServices/backend-calendarupdateevent
      - paths: ["/calendarDeleteEvent", "/calendarDeleteEvent/*"]
        service: global/backendServices/backend-calendardeleteevent
      - paths: ["/calendarListEvents", "/calendarListEvents/*"]
        service: global/backendServices/backend-calendarlistevents
      - paths: ["/createCheckoutSession", "/createCheckoutSession/*"]
        service: global/backendServices/backend-createcheckoutsession
      - paths: ["/stripeWebhook", "/stripeWebhook/*"]
        service: global/backendServices/backend-stripewebhook
      - paths: ["/createBillingPortalSession", "/createBillingPortalSession/*"]
        service: global/backendServices/backend-createbillingportalsession
      - paths: ["/createRazorpayOrder", "/createRazorpayOrder/*"]
        service: global/backendServices/backend-createrazorpayorder
      - paths: ["/razorpayWebhook", "/razorpayWebhook/*"]
        service: global/backendServices/backend-razorpaywebhook
      - paths: ["/gdprServerExport", "/gdprServerExport/*"]
        service: global/backendServices/backend-gdprserverexport
URLMAP

# Google-managed SSL certificate (auto-renews; domain must already point here)
gcloud compute ssl-certificates create "$SSL_CERT_NAME" \
  --domains="$DOMAIN" \
  --global \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "SSL cert already exists, skipping."

# Target HTTPS proxy
gcloud compute target-https-proxies create "$TARGET_HTTPS_PROXY" \
  --url-map="$URL_MAP_NAME" \
  --ssl-certificates="$SSL_CERT_NAME" \
  --global \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "Target proxy already exists, skipping."

# Reserve a global static IP
gcloud compute addresses create "${LB_NAME}-ip" \
  --network-tier=PREMIUM \
  --ip-version=IPV4 \
  --global \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "IP already reserved, skipping."

LB_IP=$(gcloud compute addresses describe "${LB_NAME}-ip" \
  --global \
  --format="get(address)" \
  --project="$PROJECT_ID")

# Forwarding rule (HTTPS on port 443)
gcloud compute forwarding-rules create "$FORWARDING_RULE" \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --network-tier=PREMIUM \
  --address="${LB_NAME}-ip" \
  --target-https-proxy="$TARGET_HTTPS_PROXY" \
  --global \
  --ports=443 \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "Forwarding rule already exists, skipping."

# HTTP → HTTPS redirect (port 80 → 443)
# Without this, users hitting http://... get connection refused instead of a redirect.
gcloud compute url-maps create "${URL_MAP_NAME}-http-redirect" \
  --default-redirect-uri="https://\$host\$request_uri" \
  --redirect-response-code=MOVED_PERMANENTLY_DEFAULT \
  --https-redirect \
  --global \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "HTTP redirect map already exists, skipping."

gcloud compute target-http-proxies create "${TARGET_HTTPS_PROXY}-http" \
  --url-map="${URL_MAP_NAME}-http-redirect" \
  --global \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "HTTP target proxy already exists, skipping."

gcloud compute forwarding-rules create "${FORWARDING_RULE}-http" \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --network-tier=PREMIUM \
  --address="${LB_NAME}-ip" \
  --target-http-proxy="${TARGET_HTTPS_PROXY}-http" \
  --global \
  --ports=80 \
  --project="$PROJECT_ID" 2>/dev/null \
  || echo "HTTP forwarding rule already exists, skipping."

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ✓ Cloud Armor WAF setup complete!"
echo ""
echo "  Load balancer IP: $LB_IP"
echo "  → Point your DNS A record for $DOMAIN to: $LB_IP"
echo "  → SSL cert will provision automatically once DNS propagates."
echo "  → HTTP (port 80) → HTTPS redirect is active on the same IP."
echo ""
echo "  ⚠  IMPORTANT: Until DNS is updated, traffic still reaches Cloud Run"
echo "     directly at *.cloudfunctions.net — Cloud Armor only protects"
echo "     traffic routed through this load balancer."
echo ""
echo "  To verify WAF rules are blocking correctly:"
echo "    curl -I 'https://$DOMAIN/health?q=1+OR+1=1--'"
echo "    # should return HTTP 403"
echo "  To verify HTTP redirect:"
echo "    curl -I 'http://$DOMAIN/health'"
echo "    # should return HTTP 301 → https://"
echo "═══════════════════════════════════════════════════════════════════════"
