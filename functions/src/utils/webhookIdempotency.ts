/**
 * Webhook Idempotency Guard — atomic claim via Firestore create().
 * Documents have TTL via expiresAt field — Firestore TTL policy auto-deletes.
 *
 * Collection: _webhookEvents/{eventId}
 * Client access: none (Firestore rules: allow read, write: if false)
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const COLLECTION = '_webhookEvents';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ALREADY_EXISTS = 6;

function eventRef(eventId: string) {
    return getFirestore().collection(COLLECTION).doc(eventId);
}

function buildEventDoc(eventId: string, eventType: string, userId: string) {
    return {
        eventId,
        eventType,
        userId,
        processedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + TTL_MS),
    };
}

/**
 * Atomically claim an event for processing. Returns false if already claimed.
 */
export async function claimWebhookEvent(
    eventId: string,
    eventType: string,
    userId: string,
): Promise<boolean> {
    try {
        await eventRef(eventId).create(buildEventDoc(eventId, eventType, userId));
        return true;
    } catch (err: unknown) {
        const code = (err as { code?: number }).code;
        if (code === ALREADY_EXISTS) return false;
        throw err;
    }
}

/** Release a claim so Stripe/Razorpay can retry after handler failure. */
export async function releaseWebhookEvent(eventId: string): Promise<void> {
    try {
        await eventRef(eventId).delete();
    } catch (err: unknown) {
        logger.warn('[webhookIdempotency] release failed', { eventId, err });
    }
}

/** @deprecated Use claimWebhookEvent — kept for tests migrating from check/record split */
export async function checkIdempotency(eventId: string): Promise<boolean> {
    const doc = await eventRef(eventId).get();
    return doc.exists;
}

/** @deprecated Use claimWebhookEvent */
export async function recordEvent(
    eventId: string,
    eventType: string,
    userId: string,
): Promise<void> {
    await eventRef(eventId).set(buildEventDoc(eventId, eventType, userId));
}
