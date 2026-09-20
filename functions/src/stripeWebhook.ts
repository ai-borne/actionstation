/**
 * stripeWebhook Cloud Function — processes Stripe webhook events
 *
 * Security: HMAC-SHA256 signature verification (stripe-signature header).
 * NO bot detection — Stripe sends automated requests that would be flagged.
 * Decision 33: signature verification is cryptographically stronger than UA detection.
 *
 * CRITICAL: Must receive raw body for signature verification.
 * Firebase Cloud Functions provide req.rawBody automatically.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getStripeClient, stripeWebhookSecret } from './utils/stripeClient.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { recordThreatEvent } from './utils/threatMonitor.js';
import { claimWebhookEvent, releaseWebhookEvent } from './utils/webhookIdempotency.js';
import { errorMessages } from './utils/securityConstants.js';
import {
    handleCheckoutCompleted,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handleInvoicePaid,
    handleInvoicePaymentFailed,
} from './utils/stripeWebhookHandlers.js';
import type { HandlerResult } from './utils/stripeWebhookHandlers.js';
import type Stripe from 'stripe';

export const stripeWebhook = onRequest(
    {
        // NO CORS — webhooks are server-to-server, no browser origin
        secrets: [stripeWebhookSecret],
        timeoutSeconds: 30,
        maxInstances: 10,
        // minInstances: 1 — re-enable once live payment traffic exists to avoid cold-start delays
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        // Step 1: Verify Stripe signature (HMAC-SHA256)
        const sig = req.headers['stripe-signature'] as string | undefined;
        if (!sig) {
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_SIG_FAILURE,
                ip: req.ip ?? 'unknown',
                endpoint: 'stripeWebhook',
                message: 'Missing stripe-signature header',
            });
            recordThreatEvent('auth_failure_spike', {
                endpoint: 'stripeWebhook',
            });
            res.status(400).json({ error: errorMessages.missingSignature });
            return;
        }

        let event: Stripe.Event;
        try {
            const stripe = getStripeClient();
            event = stripe.webhooks.constructEvent(
                req.rawBody,
                sig,
                stripeWebhookSecret.value(),
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown';
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_SIG_FAILURE,
                ip: req.ip ?? 'unknown',
                endpoint: 'stripeWebhook',
                message: `Invalid signature: ${message}`,
            });
            recordThreatEvent('auth_failure_spike', {
                endpoint: 'stripeWebhook',
            });
            res.status(400).json({ error: errorMessages.invalidSignature });
            return;
        }

        // Step 2: Atomic idempotency claim (replaces legacy checkIdempotency + recordEvent)
        const claimed = await claimWebhookEvent(event.id, event.type, '_pending');
        if (!claimed) {
            res.status(200).json({ received: true, note: 'already processed' });
            return;
        }

        // Step 3: Route to handler
        let result: HandlerResult | null = null;
        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    result = await handleCheckoutCompleted(event);
                    break;
                case 'customer.subscription.updated':
                    result = await handleSubscriptionUpdated(event);
                    break;
                case 'customer.subscription.deleted':
                    result = await handleSubscriptionDeleted(event);
                    break;
                case 'invoice.paid':
                    result = await handleInvoicePaid(event);
                    break;
                case 'invoice.payment_failed':
                    result = await handleInvoicePaymentFailed(event);
                    break;
                default:
                    // Unhandled event type — acknowledge receipt
                    break;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown';
            logSecurityEvent({
                type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
                endpoint: 'stripeWebhook',
                message: `Handler failed: ${message}`,
                metadata: {
                    eventId: event.id,
                    eventType: event.type,
                },
            });
            await releaseWebhookEvent(event.id);
            res.status(500).json({
                error: errorMessages.webhookProcessingFailed,
            });
            return;
        }

        void result;
        res.status(200).json({ received: true });
    },
);
