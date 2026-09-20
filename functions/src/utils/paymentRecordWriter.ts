/**
 * Payment record retention on account deletion.
 *
 * A Razorpay annual plan is a one-time payment with no provider-side subscription to
 * cancel. Erasing the user's data would also erase the only link between the payment
 * and the user, so a minimal server-only record is kept in `paymentRecords/{paymentId}`
 * (payment id, plan, dates, uid) for refund review and tax records. Firestore rules deny
 * all client access to this collection (default deny).
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logSecurityEvent, SecurityEventType } from './securityLogger.js';

interface SubscriptionDoc {
    tier?: string;
    isActive?: boolean;
    provider?: string;
    gatewaySubscriptionId?: string | null;
    gatewayPlanId?: string | null;
    lastEventId?: string;
    currency?: string;
    expiresAt?: number | null;
}

/** True only for an active Razorpay one-time (annual) plan with a known payment id. */
function isActiveAnnualPayment(data: SubscriptionDoc | undefined): data is SubscriptionDoc & { lastEventId: string } {
    return data?.tier === 'pro'
        && data.isActive !== false
        && data.provider === 'razorpay'
        && !data.gatewaySubscriptionId
        && typeof data.lastEventId === 'string'
        && data.lastEventId !== '';
}

/**
 * Retain a payment record if the user has an active annual plan.
 * Resolves true when there was nothing to retain or the record was written;
 * false when the write failed (the caller must not delete the user's data then).
 */
export async function retainPaymentRecord(uid: string): Promise<boolean> {
    try {
        const db = getFirestore();
        const snap = await db.doc(`users/${uid}/subscription/current`).get();
        const data = snap.exists ? (snap.data() as SubscriptionDoc) : undefined;
        if (!isActiveAnnualPayment(data)) return true;

        await db.doc(`paymentRecords/${data.lastEventId}`).set({
            paymentId: data.lastEventId,
            uid,
            provider: 'razorpay',
            planId: data.gatewayPlanId ?? null,
            currency: data.currency ?? '',
            expiresAt: data.expiresAt ?? null,
            reason: 'account_deleted_with_active_plan',
            recordedAt: FieldValue.serverTimestamp(),
        });

        logSecurityEvent({
            type: SecurityEventType.SUBSCRIPTION_CHANGE,
            uid,
            endpoint: 'onUserDeleted',
            message: 'Account deleted with active annual plan — payment record retained for refund review',
            metadata: { paymentId: data.lastEventId },
        });
        return true;
    } catch (err: unknown) {
        logSecurityEvent({
            type: SecurityEventType.SUBSCRIPTION_CHANGE,
            uid,
            endpoint: 'onUserDeleted',
            message: `Payment record could not be retained: ${err instanceof Error ? err.message : 'unknown'}`,
        });
        return false;
    }
}
