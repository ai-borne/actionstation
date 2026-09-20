/**
 * createRazorpayOrder Cloud Function — creates a Razorpay Order for one-time payments
 * Used for annual subscriptions (Razorpay subscriptions handle monthly via subscription API).
 *
 * Security layers (same pattern as Stripe checkout):
 *  1. Bot detection
 *  2. IP rate limit
 *  3. Auth verification
 *  4. User rate limit
 *  5. Input validation (plan ID whitelist)
 *  6. Security logging
 */
import { onRequest } from 'firebase-functions/v2/https';
import { verifyAppCheckToken } from './utils/appCheckVerifier.js';
import { verifyAuthToken } from './utils/authVerifier.js';
import { checkRateLimit } from './utils/rateLimiter.js';
import { checkIpRateLimit } from './utils/ipRateLimiter.js';
import { detectBot, extractClientIp } from './utils/botDetector.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { recordThreatEvent } from './utils/threatMonitor.js';
import {
    getRazorpayClient,
    razorpayKeyId,
    razorpayKeySecret,
} from './utils/razorpayClient.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { getOrderAmount } from './utils/razorpayPricing.js';
import {
    CHECKOUT_RATE_LIMIT,
    IP_RATE_LIMIT_CHECKOUT,
    errorMessages,
} from './utils/securityConstants.js';

/** Request body shape */
interface OrderRequestBody {
    planId?: string;
    currency?: 'INR' | 'USD';
    receipt?: string;
}

export const createRazorpayOrder = onRequest(
    {
        cors: ALLOWED_ORIGINS,
        secrets: [razorpayKeyId, razorpayKeySecret],
        maxInstances: 10,
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        const ip = extractClientIp(req);

        // Layer 1: Bot detection
        const bot = detectBot(req);
        if (bot.isBot && bot.confidence !== 'low') {
            logSecurityEvent({
                type: SecurityEventType.BOT_DETECTED,
                ip,
                endpoint: 'createRazorpayOrder',
                message: bot.reason ?? 'Bot detected',
            });
            recordThreatEvent('bot_spike', { ip, endpoint: 'createRazorpayOrder' });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Layer 1.5: App Check
        if (!await verifyAppCheckToken(req)) {
            logSecurityEvent({
                type: SecurityEventType.APP_CHECK_FAILURE,
                ip,
                endpoint: 'createRazorpayOrder',
                message: 'Missing or invalid App Check token',
            });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 2: IP rate limit
        if (!await checkIpRateLimit(ip, 'razorpayOrder', IP_RATE_LIMIT_CHECKOUT)) {
            logSecurityEvent({
                type: SecurityEventType.IP_BLOCKED,
                ip,
                endpoint: 'createRazorpayOrder',
                message: 'IP rate limit exceeded',
            });
            recordThreatEvent('429_spike', { ip, endpoint: 'createRazorpayOrder' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Layer 3: Auth verification
        const uid = await verifyAuthToken(req.headers.authorization);
        if (!uid) {
            logSecurityEvent({
                type: SecurityEventType.AUTH_FAILURE,
                ip,
                endpoint: 'createRazorpayOrder',
                message: 'Missing or invalid auth token',
            });
            recordThreatEvent('auth_failure_spike', { ip, endpoint: 'createRazorpayOrder' });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 4: User rate limit
        if (!await checkRateLimit(uid, 'razorpayOrder', CHECKOUT_RATE_LIMIT)) {
            logSecurityEvent({
                type: SecurityEventType.RATE_LIMIT_VIOLATION,
                uid,
                endpoint: 'createRazorpayOrder',
                message: 'User rate limit exceeded',
            });
            recordThreatEvent('429_spike', { uid, endpoint: 'createRazorpayOrder' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Layer 5: Input validation — only orderable plan/currency pairs have a price
        const body = req.body as OrderRequestBody;
        const planId = body.planId;
        const currency = body.currency ?? 'INR';

        const amount = planId ? getOrderAmount(planId, currency) : null;
        if (!planId || amount === null) {
            res.status(400).json({ error: errorMessages.invalidPriceId });
            return;
        }

        // Validate API credentials are present before attempting the API call.
        // Empty keys mean secrets are not configured in this environment.
        const keyId = razorpayKeyId.value();
        const keySecret = razorpayKeySecret.value();
        if (!keyId || !keySecret ||
            keyId.startsWith('REPLACE_WITH') || keySecret.startsWith('REPLACE_WITH')) {
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                uid,
                endpoint: 'createRazorpayOrder',
                message: 'Razorpay credentials not configured',
            });
            res.status(503).json({ error: 'Payment service not yet configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET secrets then redeploy.' });
            return;
        }

        // Create Razorpay Order
        try {
            const razorpay = getRazorpayClient();
            const order = await razorpay.orders.create({
                amount,
                currency,
                // Razorpay receipt limit is 40 chars — use short UID prefix + UUID fragment
                receipt: body.receipt ?? `r_${uid.slice(0, 10)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
                notes: {
                    userId: uid,
                    planId,
                    source: 'actionstation',
                },
            });

            logSecurityEvent({
                type: SecurityEventType.CHECKOUT_CREATED,
                uid,
                endpoint: 'createRazorpayOrder',
                message: 'Razorpay order created',
                metadata: { planId, orderId: order.id },
            });

            res.status(200).json({
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: razorpayKeyId.value(),
            });
        } catch (error: unknown) {
            // Razorpay SDK v2 throws plain objects: { statusCode, error: { code, description } }
            let message: string;
            if (error instanceof Error) {
                message = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const rzrErr = error as Record<string, unknown>;
                const inner = rzrErr['error'] as Record<string, unknown> | undefined;
                message = inner?.['description']
                    ? `${String(inner['code'] ?? 'API_ERROR')}: ${String(inner['description'])}`
                    : JSON.stringify(error);
            } else {
                message = String(error);
            }
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                uid,
                endpoint: 'createRazorpayOrder',
                message: `Order creation failed: ${message}`,
            });
            res.status(500).json({ error: errorMessages.checkoutFailed });
        }
    },
);
