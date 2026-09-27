/**
 * Security Logger — structured security event logging for Cloud Logging
 * Writing structured JSON to stdout/stderr is automatically ingested by
 * Google Cloud Logging when running in Cloud Functions.
 *
 * Set up a Cloud Monitoring log-based alert on:
 *   jsonPayload.labels.eden_security="true" AND severity>=ERROR
 * to receive real-time threat notifications.
 */

/** All security event types this system records */
export const SecurityEventType = {
    /** AI prompt accepted — records sanitized prompt hash for audit */
    AI_PROMPT: 'ai_prompt',
    /** Firebase Auth token missing or invalid */
    AUTH_FAILURE: 'auth_failure',
    /** Per-user rate limit exceeded */
    RATE_LIMIT_VIOLATION: 'rate_limit_violation',
    /** Per-IP rate limit exceeded */
    IP_BLOCKED: 'ip_blocked',
    /** Firestore rule or function ACL denied access */
    RULE_DENIAL: 'rule_denial',
    /** Request matched bot/scanner signature */
    BOT_DETECTED: 'bot_detected',
    /** Prompt injection or exfiltration pattern found */
    PROMPT_INJECTION: 'prompt_injection',
    /** Cross-endpoint spike threshold exceeded */
    THREAT_SPIKE: 'threat_spike',
    /** File upload rejected by validator */
    UPLOAD_REJECTED: 'upload_rejected',
    /** Cloudflare Turnstile or Google reCAPTCHA challenge failed */
    CAPTCHA_FAILED: 'captcha_failed',
    /** Firebase App Check token missing or invalid */
    APP_CHECK_FAILURE: 'app_check_failure',
    /** Subscription tier changed (free→pro, pro→free, etc.) */
    SUBSCRIPTION_CHANGE: 'subscription_change',
    /** Invoice payment failed via Stripe webhook */
    PAYMENT_FAILED: 'payment_failed',
    /** Stripe webhook signature verification failed */
    WEBHOOK_SIG_FAILURE: 'webhook_sig_failure',
    /** Checkout session created successfully */
    CHECKOUT_CREATED: 'checkout_created',
    /** Webhook processing error (handler threw) */
    WEBHOOK_PROCESSING_ERROR: 'webhook_processing_error',
    /** Firebase Auth user deletion triggered cleanup */
    ACCOUNT_DELETED: 'account_deleted',
    /** Arcjet WAF rule (shield or bot detection) denied the request */
    WAF_BLOCKED: 'waf_blocked',
} as const;

export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];

/** Shape of every security log entry */
export interface SecurityEvent {
    type: SecurityEventType;
    /** Firebase UID, if authenticated */
    uid?: string;
    /** Client IP (from X-Forwarded-For or req.ip) */
    ip?: string;
    /** Cloud Function endpoint name */
    endpoint: string;
    /** Human-readable description of the event */
    message: string;
    /** Additional structured context (kept shallow to stay searchable) */
    metadata?: Record<string, unknown>;
}

/**
 * Write a structured security event to Cloud Logging.
 *
 * Cloud Functions maps:
 *   - console.log   → INFO
 *   - console.warn  → WARNING
 *   - console.error → ERROR
 *
 * HIGH/CRITICAL events write to stderr so Cloud Alerting policies can
 * trigger on severity >= ERROR without extra configuration.
 */
export function logSecurityEvent(event: SecurityEvent): void {
    const severity = getSeverity(event.type);

    const entry = {
        severity,
        message: `[SECURITY:${event.type}] ${event.message}`,
        labels: {
            eden_security: 'true',
            event_type: event.type,
        },
        uid: event.uid ?? 'anonymous',
        ip: event.ip ?? 'unknown',
        endpoint: event.endpoint,
        timestamp: new Date().toISOString(),
        ...(event.metadata ?? {}),
    };

    const line = JSON.stringify(entry);

    // console.error/warn is intentional here — Cloud Functions routes these to
    // Cloud Logging at ERROR/WARNING severity respectively. The firebase-functions
    // logger wraps JSON differently; raw console output gives us structured JSON
    // ingestion with the correct severity level.
    if (severity === 'ERROR' || severity === 'CRITICAL') {
        // eslint-disable-next-line no-console
        console.error(line);
    } else {
        // eslint-disable-next-line no-console
        console.warn(line);
    }
}

function getSeverity(
    type: SecurityEventType,
): 'WARNING' | 'ERROR' | 'CRITICAL' {
    switch (type) {
        case SecurityEventType.THREAT_SPIKE:
            return 'CRITICAL';
        case SecurityEventType.BOT_DETECTED:
        case SecurityEventType.PROMPT_INJECTION:
        case SecurityEventType.IP_BLOCKED:
        case SecurityEventType.WEBHOOK_SIG_FAILURE:
        case SecurityEventType.WEBHOOK_PROCESSING_ERROR:
        case SecurityEventType.APP_CHECK_FAILURE:
            return 'ERROR';
        default:
            return 'WARNING';
    }
}
