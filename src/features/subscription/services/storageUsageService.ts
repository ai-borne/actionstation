/**
 * storageUsageService — Per-user storage usage tracking in Firestore
 *
 * Counter is written by Cloud Functions (onStorageObjectFinalized/Deleted).
 * Client is read-only.
 *
 * Firestore path: users/{userId}/usage/storage
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { logger } from '@/shared/services/logger';

const USAGE_DOC = 'storage';

export class StorageUsageReadError extends Error {
    readonly readCause: unknown;

    constructor(cause: unknown) {
        super('Storage usage could not be read');
        this.name = 'StorageUsageReadError';
        this.readCause = cause;
    }
}

function storageDocRef(userId: string) {
    return doc(db, `users/${userId}/usage/${USAGE_DOC}`);
}

/**
 * Get the user's total storage usage in MB.
 * Throws StorageUsageReadError on Firestore failure — fail-closed for upload guards.
 * Returns 0 when the doc is missing (no usage recorded yet).
 */
export async function getStorageUsageMb(userId: string): Promise<number> {
    try {
        const snap = await getDoc(storageDocRef(userId));
        if (!snap.exists()) return 0;
        const bytes: number = (snap.data() as { totalBytes?: number }).totalBytes ?? 0;
        return bytes / (1024 * 1024);
    } catch (err) {
        logger.warn('[storageUsage] getStorageUsageMb failed', err);
        throw new StorageUsageReadError(err);
    }
}

/** Best-effort read for non-guard paths (e.g. GDPR export). Returns null on failure. */
export async function tryGetStorageUsageMb(userId: string): Promise<number | null> {
    try {
        return await getStorageUsageMb(userId);
    } catch (err) {
        logger.warn('[storageUsage] tryGetStorageUsageMb failed', err);
        return null;
    }
}
