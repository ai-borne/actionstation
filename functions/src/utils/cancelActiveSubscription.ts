/**
 * Cancels active payment-provider subscriptions before account deletion.
 * Razorpay annual one-time payments are logged for manual refund review.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { getStripeClient } from './stripeClient.js';
import { getRazorpayClient } from './razorpayClient.js';
import { logSecurityEvent, SecurityEventType } from './securityLogger.js';

interface SubscriptionDoc {
    tier?: string;
    isActive?: boolean;
    provider?: 'stripe' | 'razorpay';
    gatewaySubscriptionId?: string | null;
    lastEventId?: string;
}

export interface CancelSubscriptionResult {
    /** True when no active subscription needed cancellation, or cancellation succeeded. */
    readonly ok: boolean;
    /** True when an active pro subscription required provider cancellation. */
    readonly wasActive: boolean;
}

export async function cancelActiveSubscription(uid: string): Promise<CancelSubscriptionResult> {
    const snap = await getFirestore().doc(`users/${uid}/subscription/current`).get();
    if (!snap.exists) return { ok: true, wasActive: false };

    const data = snap.data() as SubscriptionDoc;
    if (data.tier !== 'pro' || data.isActive === false) return { ok: true, wasActive: false };

    if (data.provider === 'stripe' && data.gatewaySubscriptionId) {
        try {
            await getStripeClient().subscriptions.cancel(data.gatewaySubscriptionId);
            logSecurityEvent({
                type: SecurityEventType.SUBSCRIPTION_CHANGE,
                uid,
                endpoint: 'onUserDeleted',
                message: 'Stripe subscription cancelled on account deletion',
                metadata: { subscriptionId: data.gatewaySubscriptionId },
            });
            return { ok: true, wasActive: true };
        } catch (err: unknown) {
            logger.warn('[cancelActiveSubscription] Stripe cancel failed', { uid, err });
            logSecurityEvent({
                type: SecurityEventType.SUBSCRIPTION_CHANGE,
                uid,
                endpoint: 'onUserDeleted',
                message: 'Stripe subscription cancel failed on account deletion',
                metadata: { subscriptionId: data.gatewaySubscriptionId },
            });
            return { ok: false, wasActive: true };
        }
    }

    if (data.provider === 'razorpay' && data.gatewaySubscriptionId) {
        try {
            const razorpay = getRazorpayClient();
            await razorpay.subscriptions.cancel(data.gatewaySubscriptionId);
            logSecurityEvent({
                type: SecurityEventType.SUBSCRIPTION_CHANGE,
                uid,
                endpoint: 'onUserDeleted',
                message: 'Razorpay subscription cancelled on account deletion',
                metadata: { subscriptionId: data.gatewaySubscriptionId },
            });
            return { ok: true, wasActive: true };
        } catch (err: unknown) {
            logger.warn('[cancelActiveSubscription] Razorpay subscription cancel failed', { uid, err });
            logSecurityEvent({
                type: SecurityEventType.SUBSCRIPTION_CHANGE,
                uid,
                endpoint: 'onUserDeleted',
                message: 'Razorpay subscription cancel failed on account deletion',
                metadata: { subscriptionId: data.gatewaySubscriptionId },
            });
            return { ok: false, wasActive: true };
        }
    }

    if (data.provider === 'razorpay' && data.lastEventId) {
        logSecurityEvent({
            type: SecurityEventType.SUBSCRIPTION_CHANGE,
            uid,
            endpoint: 'onUserDeleted',
            message: 'Razorpay annual payment active — manual refund review if within policy',
            metadata: { paymentId: data.lastEventId },
        });
    }

    return { ok: true, wasActive: false };
}
