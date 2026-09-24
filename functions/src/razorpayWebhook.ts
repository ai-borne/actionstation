/**
 * razorpayWebhook Cloud Function — processes Razorpay webhook events
 *
 * Security: HMAC-SHA256 signature verification (x-razorpay-signature header).
 *
 * Supported events:
 *  - subscription.activated / charged / updated / cancelled / halted
 *  - payment.captured   (annual plan: payer resolved from the server-set order)
 *  - refund.processed   (full refund of the current payment downgrades to free)
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import crypto from 'crypto';
import { razorpayWebhookSecret, razorpayKeyId, razorpayKeySecret } from './utils/razorpayClient.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { recordThreatEvent } from './utils/threatMonitor.js';
import { claimWebhookEvent, releaseWebhookEvent } from './utils/webhookIdempotency.js';
import { errorMessages } from './utils/securityConstants.js';
import { handlePaymentCaptured, handleRefundProcessed } from './utils/razorpayPaymentHandlers.js';
import {
    handleSubscriptionActivated,
    handleSubscriptionUpdated,
    handleSubscriptionCancelled,
} from './utils/razorpaySubscriptionHandlers.js';
import { isActionStationNotes } from './utils/razorpayOrderNotes.js';
import type { RazorpayWebhookPayload } from './utils/razorpayWebhookTypes.js';

/** Route a verified, claimed event to its handler. Unknown events are acknowledged. */
async function routeEvent(payload: RazorpayWebhookPayload): Promise<void> {
    const { payment, refund, subscription } = payload.payload;
    if (payload.event.startsWith('subscription.') && !isActionStationNotes(subscription?.entity.notes)) {
        // Another product on the shared Razorpay account (e.g. SSBMax) — never write its users here.
        logger.info(`${payload.event}: not an ActionStation subscription — ignored`, {
            subscriptionId: subscription?.entity.id ?? null,
        });
        return;
    }
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
            if (!payment) throw new Error('Missing payment in payload');
            // An unattributable payment is logged by the handler and acknowledged:
            // retrying can never make a missing userId appear.
            await handlePaymentCaptured(payment.entity);
            break;
        case 'refund.processed':
            if (!refund) throw new Error('Missing refund in payload');
            await handleRefundProcessed(refund.entity, payment?.entity);
            break;
        default:
            break;
    }
}

export const razorpayWebhook = onRequest(
    {
        // Key id/secret let the handlers read the server-set order behind a payment.
        secrets: [razorpayWebhookSecret, razorpayKeyId, razorpayKeySecret],
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

        // A refund id is unique per refund; a payment can be refunded more than once.
        const entityId = payload.payload.subscription?.entity.id
            ?? payload.payload.refund?.entity.id
            ?? payload.payload.payment?.entity.id
            ?? payload.payload.payment?.entity.order_id;
        if (!entityId) {
            // Signed but unkeyable (another product on the shared account, e.g. a payout event).
            // Acknowledge: a 4xx would make Razorpay retry and eventually disable this webhook.
            logger.info(`${payload.event}: no payment/refund/subscription entity — ignored`);
            res.status(200).json({ received: true, note: 'ignored: no entity id' });
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
        try {
            await routeEvent(payload);
        } catch (err: unknown) {
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

        res.status(200).json({ received: true });
    },
);
