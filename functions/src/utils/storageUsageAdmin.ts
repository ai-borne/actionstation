/**
 * Server-side storage usage counter — sole writer for users/{uid}/usage/storage.
 * Per-object tracking prevents double-counting on re-upload (overwrite).
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

const USAGE_PATH = (uid: string) => `users/${uid}/usage/storage`;
const OBJECT_PATH = (uid: string, objectDocId: string) =>
    `users/${uid}/usage/storageObjects/${objectDocId}`;

export function parseUserIdFromStoragePath(filePath: string): string | null {
    const match = /^users\/([^/]+)\//.exec(filePath);
    return match?.[1] ?? null;
}

/** Firestore-safe doc id for a GCS object path (no slashes). */
export function storagePathToDocId(filePath: string): string {
    return Buffer.from(filePath, 'utf8').toString('base64url');
}

/** Record finalized object — delta is newSize minus previously tracked size. */
export async function recordStorageObjectFinalized(
    uid: string,
    filePath: string,
    sizeBytes: number,
): Promise<void> {
    if (!uid || !filePath || sizeBytes <= 0) return;

    const db = getFirestore();
    const usageRef = db.doc(USAGE_PATH(uid));
    const objectRef = db.doc(OBJECT_PATH(uid, storagePathToDocId(filePath)));

    try {
        await db.runTransaction(async (tx) => {
            const [usageSnap, objectSnap] = await Promise.all([
                tx.get(usageRef),
                tx.get(objectRef),
            ]);
            const currentTotal = usageSnap.exists
                ? ((usageSnap.data() as { totalBytes?: number }).totalBytes ?? 0)
                : 0;
            const previousSize = objectSnap.exists
                ? ((objectSnap.data() as { bytes?: number }).bytes ?? 0)
                : 0;
            const delta = sizeBytes - previousSize;
            if (delta === 0) return;

            const nextTotal = Math.max(0, currentTotal + delta);
            tx.set(usageRef, {
                totalBytes: nextTotal,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            tx.set(objectRef, {
                bytes: sizeBytes,
                path: filePath,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        });
    } catch (err: unknown) {
        logger.warn('[storageUsageAdmin] finalize failed', { uid, filePath, sizeBytes, err });
    }
}

/** Remove object from tracking — uses tracked bytes when available. */
export async function recordStorageObjectDeleted(
    uid: string,
    filePath: string,
    reportedSizeBytes: number,
): Promise<void> {
    if (!uid || !filePath) return;

    const db = getFirestore();
    const usageRef = db.doc(USAGE_PATH(uid));
    const objectRef = db.doc(OBJECT_PATH(uid, storagePathToDocId(filePath)));

    try {
        await db.runTransaction(async (tx) => {
            const [usageSnap, objectSnap] = await Promise.all([
                tx.get(usageRef),
                tx.get(objectRef),
            ]);
            const trackedBytes = objectSnap.exists
                ? ((objectSnap.data() as { bytes?: number }).bytes ?? 0)
                : 0;
            const removeBytes = trackedBytes > 0 ? trackedBytes : reportedSizeBytes;
            if (removeBytes <= 0) {
                if (objectSnap.exists) tx.delete(objectRef);
                return;
            }

            const currentTotal = usageSnap.exists
                ? ((usageSnap.data() as { totalBytes?: number }).totalBytes ?? 0)
                : 0;
            const nextTotal = Math.max(0, currentTotal - removeBytes);
            tx.set(usageRef, {
                totalBytes: nextTotal,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            if (objectSnap.exists) tx.delete(objectRef);
        });
    } catch (err: unknown) {
        logger.warn('[storageUsageAdmin] delete failed', { uid, filePath, reportedSizeBytes, err });
    }
}
