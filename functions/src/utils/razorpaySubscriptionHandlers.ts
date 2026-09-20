/**
 * Razorpay subscription-API webhook handlers (subscription.* events).
 * Launch uses one-time annual orders, so these are kept for the subscription API only.
 */
import { writeSubscription, downgradeToFree } from './subscriptionWriter.js';
import { logSecurityEvent, SecurityEventType } from './securityLogger.js';
import type { RazorpayWebhookPayload } from './razorpayWebhookTypes.js';

/** Handle subscription.activated / subscription.charged */
export async function handleSubscriptionActivated(payload: RazorpayWebhookPayload): Promise<string> {
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
export async function handleSubscriptionUpdated(payload: RazorpayWebhookPayload): Promise<string> {
    const sub = payload.payload.subscription?.entity;
    if (!sub) throw new Error('Missing subscription in payload');

    const userId = sub.notes?.userId ?? '';
    if (!userId) throw new Error('subscription.updated: missing userId in notes');

    const isActive = sub.status === 'active';

    await writeSubscription(userId, {
        tier: isActive ? 'pro' : 'free',
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
export async function handleSubscriptionCancelled(payload: RazorpayWebhookPayload): Promise<string> {
    const sub = payload.payload.subscription?.entity;
    if (!sub) throw new Error('Missing subscription in payload');

    const userId = sub.notes?.userId ?? '';
    if (!userId) throw new Error('subscription.cancelled: missing userId in notes');

    await downgradeToFree(userId, sub.customer_id, payload.payload.payment?.entity.id ?? '', 'razorpay');

    logSecurityEvent({
        type: SecurityEventType.SUBSCRIPTION_CHANGE,
        uid: userId,
        endpoint: 'razorpayWebhook',
        message: `Subscription ${payload.event} — downgraded to free`,
        metadata: { subscriptionId: sub.id },
    });

    return userId;
}
