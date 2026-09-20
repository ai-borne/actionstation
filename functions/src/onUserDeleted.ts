/**
 * Cloud Function: onUserDeleted (HTTPS Callable)
 * Called by the client immediately before deleting their Firebase Auth account.
 * Performs GDPR Article 17 (right to erasure) cleanup of ALL user data in
 * Firestore and Firebase Storage.
 *
 * The client must call this function BEFORE calling Firebase Auth `deleteUser()`.
 * It requires a live, authenticated session (request.auth.uid must match uid arg).
 *
 * Data deleted:
 *  • Firestore: users/{uid}/** (all workspaces, nodes, edges, KB, usage, subscription)
 *  • Storage:   users/{uid}/** (all uploaded images and attachments)
 *
 * Returns per-step status so the client never assumes full success on partial failure.
 * Active subscription cancel failure aborts Firestore/Storage delete (no split-brain).
 * An active annual Razorpay plan first leaves a minimal server-only payment record
 * (paymentRecords/{paymentId}); if that cannot be written the delete is aborted too.
 * Both are reported through `subscriptionCancelled` — the "billing step" flag.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { cancelActiveSubscription } from './utils/cancelActiveSubscription.js';
import { retainPaymentRecord } from './utils/paymentRecordWriter.js';
import { stripeSecretKey } from './utils/stripeClient.js';
import { razorpayKeyId, razorpayKeySecret } from './utils/razorpayClient.js';

export interface OnUserDeletedResult {
    readonly success: boolean;
    readonly firestoreOk: boolean;
    readonly storageOk: boolean;
    readonly subscriptionCancelled: boolean;
}

// ── Storage cleanup ────────────────────────────────────────────────────────

async function deleteUserStorage(uid: string): Promise<boolean> {
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
    if (files.length === 0) return true;

    const results = await Promise.allSettled(files.map((file) => file.delete()));
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
        logger.warn(`onUserDeleted: ${failures.length}/${files.length} storage files failed`, { uid });
        return false;
    }
    return true;
}

// ── Firestore cleanup ──────────────────────────────────────────────────────

async function deleteUserFirestore(uid: string): Promise<boolean> {
    const db = getFirestore();
    await db.recursiveDelete(db.collection('users').doc(uid));
    return true;
}

// ── Handler ────────────────────────────────────────────────────────────────

export const onUserDeleted = onCall(
    {
        minInstances: 0,
        cors: ALLOWED_ORIGINS,
        enforceAppCheck: true,
        secrets: [stripeSecretKey, razorpayKeyId, razorpayKeySecret],
    },
    async (request): Promise<OnUserDeletedResult> => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Must be authenticated to delete account data.');

        logger.info(`onUserDeleted: starting cleanup for uid=${uid}`);

        let subscriptionCancelled = true;
        let blockDataDelete = false;
        try {
            const subResult = await cancelActiveSubscription(uid);
            subscriptionCancelled = subResult.ok;
            if (subResult.wasActive && !subResult.ok) {
                blockDataDelete = true;
                logger.warn('onUserDeleted: aborting data delete — active subscription cancel failed', { uid });
            }
            if (!blockDataDelete && !(await retainPaymentRecord(uid))) {
                subscriptionCancelled = false;
                blockDataDelete = true;
                logger.warn('onUserDeleted: aborting data delete — payment record not retained', { uid });
            }
        } catch (err: unknown) {
            subscriptionCancelled = false;
            blockDataDelete = true;
            logger.warn('onUserDeleted: subscription cancel failed', { uid, err });
            logSecurityEvent({
                type: SecurityEventType.SUBSCRIPTION_CHANGE,
                uid,
                endpoint: 'onUserDeleted',
                message: 'Subscription cancel threw on account deletion',
            });
        }

        let firestoreOk = false;
        let storageOk = false;

        if (!blockDataDelete) {
            try {
                await deleteUserFirestore(uid);
                firestoreOk = true;
                logger.info(`onUserDeleted: Firestore cleanup complete for uid=${uid}`);
            } catch (err: unknown) {
                logger.error('onUserDeleted: Firestore cleanup failed', err, { uid });
            }

            try {
                storageOk = await deleteUserStorage(uid);
                if (storageOk) {
                    logger.info(`onUserDeleted: Storage cleanup complete for uid=${uid}`);
                }
            } catch (err: unknown) {
                logger.error('onUserDeleted: Storage cleanup failed', err, { uid });
            }
        } else {
            logger.info(`onUserDeleted: skipped Firestore/Storage delete for uid=${uid}`);
        }

        const success = firestoreOk && storageOk && subscriptionCancelled;
        const result: OnUserDeletedResult = { success, firestoreOk, storageOk, subscriptionCancelled };

        logSecurityEvent({
            type: SecurityEventType.ACCOUNT_DELETED,
            uid,
            endpoint: 'onUserDeleted',
            message: success
                ? `User account data deleted for uid: ${uid}`
                : `User account deletion partial failure for uid: ${uid}`,
            metadata: { ...result },
        });

        return result;
    },
);
