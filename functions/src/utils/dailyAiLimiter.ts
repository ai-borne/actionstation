/**
 * dailyAiLimiter.ts — Firestore-backed daily AI generation counter
 * Uses atomic transactions to prevent race conditions during concurrent requests
 * Resets counter daily (UTC date boundary)
 *
 * Pattern: Same as ipRateLimiter.ts — admin SDK bypasses security rules
 */
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

/**
 * Check and increment daily AI generation count for a user.
 * Returns true if generation allowed; false if limit reached.
 *
 * Atomically:
 * 1. Reads current count + date from `users/{userId}/usage/aiDaily`
 * 2. If date is today and count >= maxDaily, returns false
 * 3. If date is old, resets count to 1 and updates date
 * 4. Otherwise increments count by 1 and returns true
 *
 * Uses Firestore transaction for atomicity — safe for concurrent calls.
 */
export async function checkAndIncrementDailyAi(
    userId: string,
    maxDaily: number,
): Promise<boolean> {
    const db = getFirestore();
    const docRef = db.doc(`users/${userId}/usage/aiDaily`);

    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);

            const today = new Date().toISOString().slice(0, 10);
            const existing = snap.exists ? (snap.data() as { count: number; date: string }) : null;

            // First call or old day — reset counter
            if (!existing || existing.date !== today) {
                tx.set(docRef, { count: 1, date: today }, { merge: true });
                return true;
            }

            // Today's count reached limit
            if (existing.count >= maxDaily) {
                return false;
            }

            // Increment and allow
            tx.update(docRef, { count: existing.count + 1 });
            return true;
        });
    } catch (err) {
        logger.error('[dailyAiLimiter] transaction failed', { userId, err });
        // Fail closed — deny generation when counter state is unknown
        return false;
    }
}
