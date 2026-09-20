/**
 * Razorpay one-time payment handlers (annual plan): payment.captured, refund.processed.
 *
 * Trust rule: the payer is resolved from the ORDER's notes, which only
 * `createRazorpayOrder` can set. Razorpay payment entities do not inherit order
 * notes, and payment notes are client-controlled, so they are never used.
 */
import { getRazorpayClient } from './razorpayClient.js';
import { writeSubscription, downgradeToFreeIfCurrentPayment } from './subscriptionWriter.js';
import { logSecurityEvent, SecurityEventType } from './securityLogger.js';
import { getOrderAmount, PRO_ANNUAL_ACCESS_DAYS } from './razorpayPricing.js';
import type { RazorpayPaymentEntity, RazorpayRefundEntity } from './razorpayWebhookTypes.js';

export type CaptureOutcome =
    | { readonly granted: true; readonly userId: string }
    | { readonly granted: false; readonly reason: string };

export interface RefundOutcome {
    readonly downgraded: boolean;
    readonly userId?: string;
}

interface OrderOwner {
    readonly userId: string;
    readonly planId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read the server-set owner and plan from an order; null when the order names no user. */
async function fetchOrderOwner(orderId: string): Promise<OrderOwner | null> {
    const order = await getRazorpayClient().orders.fetch(orderId);
    const userId = order.notes?.userId;
    if (typeof userId !== 'string' || userId === '') return null;
    return { userId, planId: String(order.notes?.planId ?? '') };
}

function logUnattributed(message: string, payment: RazorpayPaymentEntity): void {
    logSecurityEvent({
        type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
        endpoint: 'razorpayWebhook',
        message,
        metadata: { paymentId: payment.id, orderId: payment.order_id ?? null },
    });
}

/** Handle payment.captured — grants a year of Pro to the order's owner. */
export async function handlePaymentCaptured(payment: RazorpayPaymentEntity): Promise<CaptureOutcome> {
    if (!payment.order_id) {
        const reason = 'payment.captured: payment has no order';
        logUnattributed(reason, payment);
        return { granted: false, reason };
    }

    const owner = await fetchOrderOwner(payment.order_id);
    if (!owner) {
        const reason = 'payment.captured: order has no userId';
        logUnattributed(reason, payment);
        return { granted: false, reason };
    }

    const price = getOrderAmount(owner.planId, payment.currency.toUpperCase());
    if (price === null || payment.amount < price) {
        const reason = 'payment.captured: plan not purchasable or amount below plan price';
        logUnattributed(reason, payment);
        return { granted: false, reason };
    }

    // created_at is Unix seconds; using it (not "now") keeps retries idempotent.
    const paidAt = payment.created_at ? payment.created_at * 1000 : Date.now();
    const expiresAt = paidAt + PRO_ANNUAL_ACCESS_DAYS * DAY_MS;

    await writeSubscription(owner.userId, {
        tier: 'pro',
        isActive: true,
        expiresAt,
        gatewayCustomerId: '',
        gatewaySubscriptionId: null,
        gatewayPlanId: owner.planId,
        currentPeriodEnd: expiresAt,
        cancelAtPeriodEnd: false,
        currency: payment.currency.toLowerCase(),
        lastEventId: payment.id,
        provider: 'razorpay',
    });

    return { granted: true, userId: owner.userId };
}

/** Handle refund.processed — a full refund of the current payment ends Pro. */
export async function handleRefundProcessed(
    refund: RazorpayRefundEntity,
    payloadPayment: RazorpayPaymentEntity | undefined,
): Promise<RefundOutcome> {
    const payment = payloadPayment
        ?? (await getRazorpayClient().payments.fetch(refund.payment_id)) as unknown as RazorpayPaymentEntity;

    const owner = payment.order_id ? await fetchOrderOwner(payment.order_id) : null;
    if (!owner) {
        logUnattributed('refund.processed: cannot resolve payer from order', payment);
        return { downgraded: false };
    }

    if (refund.amount < payment.amount) {
        logSecurityEvent({
            type: SecurityEventType.SUBSCRIPTION_CHANGE,
            uid: owner.userId,
            endpoint: 'razorpayWebhook',
            message: 'Partial refund — Pro retained',
            metadata: { paymentId: payment.id, refundId: refund.id, refunded: refund.amount, paid: payment.amount },
        });
        return { downgraded: false, userId: owner.userId };
    }

    const downgraded = await downgradeToFreeIfCurrentPayment(owner.userId, payment.id);
    logSecurityEvent({
        type: SecurityEventType.SUBSCRIPTION_CHANGE,
        uid: owner.userId,
        endpoint: 'razorpayWebhook',
        message: downgraded ? 'Full refund — downgraded to free' : 'Full refund — payment no longer current, tier unchanged',
        metadata: { paymentId: payment.id, refundId: refund.id },
    });
    return { downgraded, userId: owner.userId };
}
