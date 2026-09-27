/**
 * createCheckoutSession Cloud Function — creates a Stripe Checkout Session
 * User is redirected to Stripe's hosted checkout page (SAQ A compliant).
 * Card data never enters ActionStation infrastructure.
 *
 * Security layers (in order):
 *  1. Bot detection       — reject scanners / headless browsers
 *  2. IP rate limit       — per-IP ceiling (10/min)
 *  3. Auth verification   — Firebase ID token
 *  4. User rate limit     — per-user (5/min)
 *  5. Input validation    — priceId whitelist
 *  6. Security logging    — every event to Cloud Logging
 */
import { onRequest } from 'firebase-functions/v2/https';
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
    CHECKOUT_RATE_LIMIT,
    IP_RATE_LIMIT_CHECKOUT,
    errorMessages,
} from './utils/securityConstants.js';

/**
 * Allowed Stripe price IDs.
 * Replace placeholder values with actual Stripe price IDs after account setup.
 */
const VALID_PRICE_IDS = new Set([
    process.env.STRIPE_PRICE_PRO_MONTHLY_INR ?? 'price_pro_monthly_inr',
    process.env.STRIPE_PRICE_PRO_ANNUAL_INR ?? 'price_pro_annual_inr',
    process.env.STRIPE_PRICE_PRO_MONTHLY_USD ?? 'price_pro_monthly_usd',
    process.env.STRIPE_PRICE_PRO_ANNUAL_USD ?? 'price_pro_annual_usd',
]);

/** Success/cancel URLs — hardcoded server-side; never user-controlled (open redirect prevention) */
const SUCCESS_URL = 'https://www.actionstation.in?checkout=success';
const CANCEL_URL = 'https://www.actionstation.in?checkout=cancelled';

/** Request body shape — only priceId is accepted from the client */
interface CheckoutRequestBody {
    priceId?: string;
}

export const createCheckoutSession = onRequest(
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
                endpoint: 'createCheckoutSession',
                message: `Arcjet blocked request (${waf.reason})`,
            });
            recordThreatEvent('bot_spike', { ip, endpoint: 'createCheckoutSession' });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Layer 1: Bot detection
        const bot = detectBot(req);
        if (bot.isBot && bot.confidence !== 'low') {
            logSecurityEvent({
                type: SecurityEventType.BOT_DETECTED,
                ip,
                endpoint: 'createCheckoutSession',
                message: bot.reason ?? 'Bot detected',
                metadata: { confidence: bot.confidence },
            });
            recordThreatEvent('bot_spike', { ip, endpoint: 'createCheckoutSession' });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Layer 1.5: App Check
        if (!await verifyAppCheckToken(req)) {
            logSecurityEvent({
                type: SecurityEventType.APP_CHECK_FAILURE,
                ip,
                endpoint: 'createCheckoutSession',
                message: 'Missing or invalid App Check token',
            });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 2: IP rate limit
        if (!await checkIpRateLimit(ip, 'checkout', IP_RATE_LIMIT_CHECKOUT)) {
            logSecurityEvent({
                type: SecurityEventType.IP_BLOCKED,
                ip,
                endpoint: 'createCheckoutSession',
                message: 'IP rate limit exceeded',
            });
            recordThreatEvent('429_spike', { ip, endpoint: 'createCheckoutSession' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Layer 3: Auth verification
        const uid = await verifyAuthToken(req.headers.authorization);
        if (!uid) {
            logSecurityEvent({
                type: SecurityEventType.AUTH_FAILURE,
                ip,
                endpoint: 'createCheckoutSession',
                message: 'Missing or invalid auth token',
            });
            recordThreatEvent('auth_failure_spike', { ip, endpoint: 'createCheckoutSession' });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 4: User rate limit
        if (!await checkRateLimit(uid, 'checkout', CHECKOUT_RATE_LIMIT)) {
            logSecurityEvent({
                type: SecurityEventType.RATE_LIMIT_VIOLATION,
                uid,
                endpoint: 'createCheckoutSession',
                message: 'User rate limit exceeded',
            });
            recordThreatEvent('429_spike', { uid, endpoint: 'createCheckoutSession' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Layer 5: Input validation
        const body = req.body as CheckoutRequestBody;
        const { priceId } = body;

        if (!priceId || !VALID_PRICE_IDS.has(priceId)) {
            res.status(400).json({ error: errorMessages.invalidPriceId });
            return;
        }

        // Create Stripe Checkout Session
        try {
            const stripe = getStripeClient();
            const session = await stripe.checkout.sessions.create({
                mode: 'subscription',
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: SUCCESS_URL,
                cancel_url: CANCEL_URL,
                client_reference_id: uid,
                metadata: { userId: uid, source: 'actionstation' },
                allow_promotion_codes: true,
            });

            logSecurityEvent({
                type: SecurityEventType.CHECKOUT_CREATED,
                uid,
                endpoint: 'createCheckoutSession',
                message: 'Checkout session created',
                metadata: { priceId },
            });

            if (!session.url) {
                logSecurityEvent({
                    type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                    uid,
                    endpoint: 'createCheckoutSession',
                    message: 'Stripe returned null session.url',
                    metadata: { priceId },
                });
                res.status(500).json({ error: errorMessages.checkoutFailed });
                return;
            }

            res.status(200).json({ checkoutUrl: session.url });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                uid,
                endpoint: 'createCheckoutSession',
                message: `Checkout creation failed: ${message}`,
            });
            res.status(500).json({ error: errorMessages.checkoutFailed });
        }
    },
);
