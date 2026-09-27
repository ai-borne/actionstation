/**
 * createBillingPortalSession Cloud Function — redirects to Stripe Customer Portal
 * Allows users to manage subscriptions, update payment methods, and cancel.
 *
 * Security layers (in order):
 *  1. Bot detection       — reject scanners / headless browsers
 *  2. IP rate limit       — per-IP ceiling (20/min)
 *  3. Auth verification   — Firebase ID token
 *  4. User rate limit     — per-user (10/min)
 *  5. Security logging    — every event to Cloud Logging
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAppCheckToken } from './utils/appCheckVerifier.js';
import { verifyAuthToken } from './utils/authVerifier.js';
import { checkRateLimit } from './utils/rateLimiter.js';
import { checkIpRateLimit } from './utils/ipRateLimiter.js';
import { detectBot, extractClientIp } from './utils/botDetector.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { recordThreatEvent } from './utils/threatMonitor.js';
import { checkArcjetBrowser, arcjetKey } from './utils/arcjetClient.js';
import { getStripeClient, stripeSecretKey } from './utils/stripeClient.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import {
    BILLING_PORTAL_RATE_LIMIT,
    IP_RATE_LIMIT_BILLING_PORTAL,
    errorMessages,
} from './utils/securityConstants.js';

/** Default return URL after exiting the billing portal */
const DEFAULT_RETURN_URL = 'https://www.actionstation.in';

export const createBillingPortalSession = onRequest(
    {
        cors: ALLOWED_ORIGINS,
        secrets: [stripeSecretKey, arcjetKey],
        maxInstances: 10,
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        const ip = extractClientIp(req);

        // Layer 0: Arcjet WAF (shield + bot detection)
        const waf = await checkArcjetBrowser(req);
        if (waf.blocked) {
            logSecurityEvent({
                type: SecurityEventType.WAF_BLOCKED,
                ip,
                endpoint: 'createBillingPortalSession',
                message: `Arcjet blocked request (${waf.reason})`,
            });
            recordThreatEvent('bot_spike', { ip, endpoint: 'createBillingPortalSession' });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Layer 1: Bot detection
        const bot = detectBot(req);
        if (bot.isBot && bot.confidence !== 'low') {
            logSecurityEvent({
                type: SecurityEventType.BOT_DETECTED,
                ip,
                endpoint: 'createBillingPortalSession',
                message: bot.reason ?? 'Bot detected',
            });
            recordThreatEvent('bot_spike', { ip, endpoint: 'createBillingPortalSession' });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Layer 1.5: App Check
        if (!await verifyAppCheckToken(req)) {
            logSecurityEvent({
                type: SecurityEventType.APP_CHECK_FAILURE,
                ip,
                endpoint: 'createBillingPortalSession',
                message: 'Missing or invalid App Check token',
            });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 2: IP rate limit
        const ipKey = 'billingPortal';
        if (!await checkIpRateLimit(ip, ipKey, IP_RATE_LIMIT_BILLING_PORTAL)) {
            logSecurityEvent({
                type: SecurityEventType.IP_BLOCKED,
                ip,
                endpoint: 'createBillingPortalSession',
                message: 'IP rate limit exceeded',
            });
            recordThreatEvent('429_spike', { ip, endpoint: 'createBillingPortalSession' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Layer 3: Auth verification
        const uid = await verifyAuthToken(req.headers.authorization);
        if (!uid) {
            logSecurityEvent({
                type: SecurityEventType.AUTH_FAILURE,
                ip,
                endpoint: 'createBillingPortalSession',
                message: 'Missing or invalid auth token',
            });
            recordThreatEvent('auth_failure_spike', { ip, endpoint: 'createBillingPortalSession' });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 4: User rate limit
        const userKey = 'billingPortal';
        if (!await checkRateLimit(uid, userKey, BILLING_PORTAL_RATE_LIMIT)) {
            logSecurityEvent({
                type: SecurityEventType.RATE_LIMIT_VIOLATION,
                uid,
                endpoint: 'createBillingPortalSession',
                message: 'User rate limit exceeded',
            });
            recordThreatEvent('429_spike', { uid, endpoint: 'createBillingPortalSession' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Look up Stripe customer ID from Firestore
        const db = getFirestore();
        const subDoc = await db
            .doc(`users/${uid}/subscription/current`)
            .get();
        // Read provider-agnostic field; fall back to legacy stripeCustomerId for
        // documents written before the field rename.
        const docData = subDoc.data() as Record<string, unknown> | undefined;
        const customerId = (docData?.gatewayCustomerId ?? docData?.stripeCustomerId) as
            | string
            | undefined;

        if (!customerId) {
            res.status(404).json({ error: 'No subscription found' });
            return;
        }

        // Create Stripe Billing Portal session
        try {
            const stripe = getStripeClient();
            const session = await stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: DEFAULT_RETURN_URL,
            });

            res.status(200).json({ portalUrl: session.url });
        } catch (error: unknown) {
            const message = error instanceof Error
                ? error.message : 'Unknown error';
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                uid,
                endpoint: 'createBillingPortalSession',
                message: `Billing portal creation failed: ${message}`,
            });
            res.status(500).json({
                error: errorMessages.billingPortalFailed,
            });
        }
    },
);
