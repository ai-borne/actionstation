/**
 * Razorpay one-time payment handlers (annual plan): payment.captured, refund.processed.
 *
 * Trust rule: the payer is resolved from the ORDER's notes, which only
 * `createRazorpayOrder` can set. Payment notes are client-controlled, so they are never used.
 *
 * Shared account: other products (SSBMax) use the same Razorpay account and their payments
 * are delivered to this webhook too. A payment whose order lacks our `source` marker is not
 * ours: it is acknowledged with an info log, never an error, so it cannot page anyone.
 */
import { logger } from 'firebase-functions/v2';
import { getRazorpayClient } from './razorpayClient.js';
import { writeSubscription, downgradeToFreeIfCurrentPayment } from './subscriptionWriter.js';
import { logSecurityEvent, SecurityEventType } from './securityLogger.js';
import { getOrderAmount, PRO_ANNUAL_ACCESS_DAYS } from './razorpayPricing.js';
import { isActionStationNotes } from './razorpayOrderNotes.js';
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

/** Result of looking up an order: ours (with its owner, if named) or another product's. */
type OrderLookup =
    | { readonly isOurs: false }
    | { readonly isOurs: true; readonly owner: OrderOwner | null };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read an order and decide whether it is ours; if so, its server-set owner and plan. */
async function lookupOrder(orderId: string): Promise<OrderLookup> {
    const order = await getRazorpayClient().orders.fetch(orderId);
    if (!isActionStationNotes(order.notes)) return { isOurs: false };
    const userId = order.notes?.userId;
    if (typeof userId !== 'string' || userId === '') return { isOurs: true, owner: null };
    return { isOurs: true, owner: { userId, planId: String(order.notes?.planId ?? '') } };
}

function logForeign(event: string, payment: RazorpayPaymentEntity): void {
    logger.info(`${event}: not an ActionStation order — ignored`, {
        paymentId: payment.id,
        orderId: payment.order_id ?? null,
    });
}

function logUnattributed(message: string, payment: RazorpayPaymentEntity): void {
    logSecurityEvent({
        type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
        endpoint: 'razorpayWebhook',
        message,
        metadata: { paymentId: payment.id, orderId: payment.order_id ?? null },
    });
}

/**
 * True when the payment has already been fully refunded. A retried `payment.captured` can arrive
 * after `refund.processed` and its payload status is stale, so read the payment's current state.
 * A fetch failure throws: Razorpay retries, and nothing is granted on an unchecked payment.
 * A partial refund keeps Pro, as in handleRefundProcessed.
 */
async function isFullyRefunded(payment: RazorpayPaymentEntity): Promise<boolean> {
    const current = (await getRazorpayClient().payments.fetch(payment.id)) as unknown as RazorpayPaymentEntity;
    const isRefunded = current.status === 'refunded' || (current.amount_refunded ?? 0) >= payment.amount;
    if (isRefunded) {
        logger.info('payment.captured: payment already refunded — Pro not granted', { paymentId: payment.id });
    }
    return isRefunded;
}

/** Handle payment.captured — grants a year of Pro to the order's owner. */
export async function handlePaymentCaptured(payment: RazorpayPaymentEntity): Promise<CaptureOutcome> {
    if (!payment.order_id) {
        // Every ActionStation payment is made through an order, so this one is not ours.
        logForeign('payment.captured', payment);
        return { granted: false, reason: 'payment has no order' };
    }

    const lookup = await lookupOrder(payment.order_id);
    if (!lookup.isOurs) {
        logForeign('payment.captured', payment);
        return { granted: false, reason: 'not an ActionStation order' };
    }
    const owner = lookup.owner;
    if (!owner) {
        const reason = 'payment.captured: ActionStation order has no userId';
        logUnattributed(reason, payment);
        return { granted: false, reason };
    }

    const price = getOrderAmount(owner.planId, payment.currency.toUpperCase());
    if (price === null || payment.amount < price) {
        const reason = 'payment.captured: plan not purchasable or amount below plan price';
        logUnattributed(reason, payment);
        return { granted: false, reason };
    }
    if (await isFullyRefunded(payment)) return { granted: false, reason: 'payment already fully refunded' };

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

    const lookup = payment.order_id ? await lookupOrder(payment.order_id) : { isOurs: false as const };
    if (!lookup.isOurs) {
        logForeign('refund.processed', payment);
        return { downgraded: false };
    }
    const owner = lookup.owner;
    if (!owner) {
        logUnattributed('refund.processed: ActionStation order has no userId', payment);
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
