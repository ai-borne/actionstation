/**
 * Subscription Writer — Firestore write operations for subscription state
 * This is the ONLY write path for subscription documents.
 * Client reads use subscriptionService.ts (frontend).
 * Firestore rules block all client writes: allow write: if false.
 *
 * Path: users/{userId}/subscription/current
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** Shape of a subscription update written to Firestore */
export interface SubscriptionUpdate {
    tier: 'free' | 'pro';
    isActive: boolean;
    expiresAt: number | null;
    /** Provider-agnostic gateway customer ID (Stripe customer ID or Razorpay customer ID) */
    gatewayCustomerId: string;
    /** Provider-agnostic subscription ID (Stripe subscription ID or Razorpay subscription ID) */
    gatewaySubscriptionId: string | null;
    /** Provider-agnostic plan/price ID (Stripe price ID or Razorpay plan ID) */
    gatewayPlanId: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    currency: string;
    lastEventId: string;
    /** Payment provider that issued this subscription */
    provider: 'stripe' | 'razorpay';
}

/**
 * Write subscription state to Firestore (merge).
 * Adds server timestamp on every write.
 */
export async function writeSubscription(
    userId: string,
    update: SubscriptionUpdate,
): Promise<void> {
    const db = getFirestore();
    const docRef = db.doc(`users/${userId}/subscription/current`);

    await docRef.set(
        { ...update, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
    );
}

/**
 * Downgrade a user to free tier.
 * Called on subscription.cancelled / halted / deleted events.
 * isActive is false — subscription is no longer active.
 */
export async function downgradeToFree(
    userId: string,
    gatewayCustomerId: string,
    lastEventId: string,
    provider: 'stripe' | 'razorpay' = 'stripe',
): Promise<void> {
    await writeSubscription(userId, {
        tier: 'free',
        isActive: false,
        expiresAt: null,
        gatewayCustomerId,
        gatewaySubscriptionId: null,
        gatewayPlanId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        currency: '',
        lastEventId,
        provider,
    });
}

/**
 * Downgrade to free only if `paymentId` is the payment that currently grants Pro.
 * A refund of an older payment must not revoke a newer purchase.
 * Returns true when the user was downgraded.
 */
export async function downgradeToFreeIfCurrentPayment(
    userId: string,
    paymentId: string,
): Promise<boolean> {
    const db = getFirestore();
    const docRef = db.doc(`users/${userId}/subscription/current`);

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const data = snap.exists ? (snap.data() as { tier?: string; lastEventId?: string }) : undefined;
        if (data?.tier !== 'pro' || data.lastEventId !== paymentId) return false;

        tx.set(
            docRef,
            {
                tier: 'free',
                isActive: false,
                expiresAt: null,
                gatewaySubscriptionId: null,
                gatewayPlanId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                lastEventId: paymentId,
                provider: 'razorpay',
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
        return true;
    });
}
