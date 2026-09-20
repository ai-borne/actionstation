/**
 * Imperative refresh of storage usage in TierLimits reducer after uploads.
 */
import type { Dispatch } from 'react';
import { logger } from '@/shared/services/logger';
import { getStorageUsageMb } from './storageUsageService';
import type { TierLimitsAction } from '../types/tierLimits';

let dispatchRef: Dispatch<TierLimitsAction> | null = null;

export function registerStorageUsageDispatch(
    dispatch: Dispatch<TierLimitsAction> | null,
): void {
    dispatchRef = dispatch;
}

export async function refreshStorageUsageAfterUpload(userId: string): Promise<void> {
    if (!dispatchRef) return;
    try {
        const storageMb = await getStorageUsageMb(userId);
        dispatchRef({ type: 'STORAGE_UPDATED', storageMb });
    } catch (err: unknown) {
        logger.warn('[storageUsage] refresh after upload failed', err);
    }
}
