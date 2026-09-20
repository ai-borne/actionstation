/**
 * razorpayWebhook Cloud Function — processes Razorpay webhook events
 *
 * Security: HMAC-SHA256 signature verification (x-razorpay-signature header).
 *
 * Supported events:
 *  - subscription.activated
 *  - subscription.charged
 *  - subscription.updated
 *  - subscription.cancelled
 *  - subscription.halted
 *  - payment.captured
 */
import { onRequest } from 'firebase-functions/v2/https';
import crypto from 'crypto';
import { razorpayWebhookSecret } from './utils/razorpayClient.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { recordThreatEvent } from './utils/threatMonitor.js';
import { claimWebhookEvent, releaseWebhookEvent } from './utils/webhookIdempotency.js';
import { writeSubscription, downgradeToFree } from './utils/subscriptionWriter.js';
import { errorMessages } from './utils/securityConstants.js';

/** Razorpay wraps each resource in an `entity` sub-object */
interface RazorpaySubscriptionEntity {
    id: string;
    status: string;
    plan_id: string;
    customer_id: string;
    current_start?: number;
    current_end?: number;
    quantity?: number;
    notes?: Record<string, string>;
}

interface RazorpayPaymentEntity {
    id: string;
    amount: number;
    currency: string;
    status: string;
    order_id?: string;
    /** Unix timestamp (seconds) of when payment was created */
    created_at?: number;
    notes?: Record<string, string>;
}

/** Payload shape from Razorpay webhooks */
interface RazorpayWebhookPayload {
    event: string;
    payload: {
        subscription?: { entity: RazorpaySubscriptionEntity };
        payment?: { entity: RazorpayPaymentEntity };
    };
}

export const razorpayWebhook = onRequest(
    {
        secrets: [razorpayWebhookSecret],
        timeoutSeconds: 30,
        maxInstances: 10,
        // minInstances: 1 — re-enable once live payment traffic exists to avoid cold-start delays
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        // Step 1: Verify Razorpay webhook signature
        const signature = req.headers['x-razorpay-signature'] as string | undefined;
        if (!signature) {
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_SIG_FAILURE,
                ip: req.ip ?? 'unknown',
                endpoint: 'razorpayWebhook',
                message: 'Missing x-razorpay-signature header',
            });
            recordThreatEvent('auth_failure_spike', { endpoint: 'razorpayWebhook' });
            res.status(400).json({ error: errorMessages.missingSignature });
            return;
        }

        const webhookSecret = razorpayWebhookSecret.value();
        const rawBody = typeof req.rawBody === 'string'
            ? req.rawBody
            : req.rawBody?.toString() ?? '';

        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');

        if (signature !== expectedSignature) {
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_SIG_FAILURE,
                ip: req.ip ?? 'unknown',
                endpoint: 'razorpayWebhook',
                message: 'Invalid webhook signature',
            });
            recordThreatEvent('auth_failure_spike', { endpoint: 'razorpayWebhook' });
            res.status(400).json({ error: errorMessages.invalidSignature });
            return;
        }

        // Step 2: Parse payload
        let payload: RazorpayWebhookPayload;
        try {
            payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
        } catch {
            res.status(400).json({ error: 'Invalid JSON payload' });
            return;
        }

        const subId = payload.payload.subscription?.entity.id;
        const payId = payload.payload.payment?.entity.id;
        const orderId = payload.payload.payment?.entity.order_id;
        const entityId = subId ?? payId ?? orderId;
        if (!entityId) {
            res.status(400).json({ error: 'Missing entity id for webhook idempotency' });
            return;
        }
        const eventId = `${payload.event}_${entityId}`;

        // Step 3: Atomic idempotency claim
        const claimed = await claimWebhookEvent(eventId, payload.event, '_pending');
        if (!claimed) {
            res.status(200).json({ received: true, note: 'already processed' });
            return;
        }

        // Step 4: Route to handler
        let handlerError = false;
        try {
            switch (payload.event) {
                case 'subscription.activated':
                case 'subscription.charged':
                    await handleSubscriptionActivated(payload);
                    break;
                case 'subscription.updated':
                    await handleSubscriptionUpdated(payload);
                    break;
                case 'subscription.cancelled':
                case 'subscription.halted':
                    await handleSubscriptionCancelled(payload);
                    break;
                case 'payment.captured':
                    await handlePaymentCaptured(payload);
                    break;
                default:
                    break;
            }
        } catch (err: unknown) {
            handlerError = true;
            const message = err instanceof Error ? err.message : 'Unknown';
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                endpoint: 'razorpayWebhook',
                message: `Handler failed: ${message}`,
                metadata: { eventId, eventType: payload.event },
            });
            await releaseWebhookEvent(eventId);
            res.status(500).json({ error: errorMessages.webhookProcessingFailed });
            return;
        }

        if (!handlerError) {
            res.status(200).json({ received: true });
        }
    },
);

/** Handle subscription.activated / subscription.charged */
async function handleSubscriptionActivated(
    payload: RazorpayWebhookPayload,
): Promise<string> {
    const sub = payload.payload.subscription?.entity;
    if (!sub) throw new Error('Missing subscription in payload');

    const userId = sub.notes?.userId ?? '';
    if (!userId) throw new Error('subscription.activated: missing userId in notes');

    await writeSubscription(userId, {
        tier: 'pro',
        isActive: true,
        expiresAt: sub.current_end ? sub.current_end * 1000 : null,
        gatewayCustomerId: sub.customer_id,
        gatewaySubscriptionId: sub.id,
        gatewayPlanId: sub.plan_id,
        currentPeriodEnd: sub.current_end ? sub.current_end * 1000 : null,
        cancelAtPeriodEnd: false,
        currency: 'inr',
        lastEventId: payload.payload.payment?.entity.id ?? '',
        provider: 'razorpay',
    });

    logSecurityEvent({
        type: SecurityEventType.SUBSCRIPTION_CHANGE,
        uid: userId,
        endpoint: 'razorpayWebhook',
        message: `Subscription ${payload.event}`,
        metadata: { subscriptionId: sub.id, planId: sub.plan_id },
    });

    return userId;
}

/** Handle subscription.updated */
async function handleSubscriptionUpdated(
    payload: RazorpayWebhookPayload,
): Promise<string> {
    const sub = payload.payload.subscription?.entity;
    if (!sub) throw new Error('Missing subscription in payload');

    const userId = sub.notes?.userId ?? '';
    if (!userId) throw new Error('subscription.updated: missing userId in notes');

    const isActive = sub.status === 'active';
    const tier = isActive ? 'pro' : 'free';

    await writeSubscription(userId, {
        tier,
        isActive,
        expiresAt: sub.current_end ? sub.current_end * 1000 : null,
        gatewayCustomerId: sub.customer_id,
        gatewaySubscriptionId: sub.id,
        gatewayPlanId: sub.plan_id,
        currentPeriodEnd: sub.current_end ? sub.current_end * 1000 : null,
        cancelAtPeriodEnd: false,
        currency: 'inr',
        lastEventId: '',
        provider: 'razorpay',
    });

    return userId;
}

/** Handle subscription.cancelled / subscription.halted */
async function handleSubscriptionCancelled(
    payload: RazorpayWebhookPayload,
): Promise<string> {
    const sub = payload.payload.subscription?.entity;
    if (!sub) throw new Error('Missing subscription in payload');

    const userId = sub.notes?.userId ?? '';
    if (!userId) throw new Error('subscription.cancelled: missing userId in notes');

    await downgradeToFree(userId, sub.customer_id, payload.payload.payment?.entity.id ?? '');

    logSecurityEvent({
        type: SecurityEventType.SUBSCRIPTION_CHANGE,
        uid: userId,
        endpoint: 'razorpayWebhook',
        message: `Subscription ${payload.event} — downgraded to free`,
        metadata: { subscriptionId: sub.id },
    });

    return userId;
}

/** Handle payment.captured — one-time payment (e.g., annual plan) */
async function handlePaymentCaptured(
    payload: RazorpayWebhookPayload,
): Promise<string> {
    const payment = payload.payload.payment?.entity;
    if (!payment) throw new Error('Missing payment in payload');

    const userId = payment.notes?.userId ?? '';
    if (!userId) throw new Error('payment.captured: missing userId in notes');

    const planId = payment.notes?.planId ?? null;

    // Use payment creation timestamp for expiry to be idempotent across retries.
    // created_at is Unix seconds; fall back to current time only if missing.
    const paymentCreatedAt = payment.created_at
        ? payment.created_at * 1000
        : Date.now();
    const expiresAt = paymentCreatedAt + 365 * 24 * 60 * 60 * 1000;

    await writeSubscription(userId, {
        tier: 'pro',
        isActive: true,
        expiresAt,
        gatewayCustomerId: '',
        gatewaySubscriptionId: null,
        gatewayPlanId: planId,
        currentPeriodEnd: expiresAt,
        cancelAtPeriodEnd: false,
        currency: payment.currency?.toLowerCase() ?? 'inr',
        lastEventId: payment.id,
        provider: 'razorpay',
    });

    return userId;
}
