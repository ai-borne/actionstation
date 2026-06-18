/**
 * Storage Guard — Pre-upload tier limit check (imperative, non-React).
 */
import { strings } from '@/shared/localization/strings';
import { getLimitsForTier } from '../types/tierLimits';
import { subscriptionService } from './subscriptionService';
import { getStorageUsageMb, StorageUsageReadError } from './storageUsageService';

const BYTES_PER_MB = 1024 * 1024;

/** Throws localized error when upload would exceed the user's storage cap. */
export async function assertStorageWithinLimit(
    userId: string,
    additionalBytes: number,
): Promise<void> {
    let usageMb: number;
    try {
        usageMb = await getStorageUsageMb(userId);
    } catch (err) {
        if (err instanceof StorageUsageReadError) {
            throw new Error(strings.subscription.limits.storageReadFailed);
        }
        throw err;
    }

    const subscription = await subscriptionService.getSubscription(userId);
    const maxMb = getLimitsForTier(subscription.tier).maxStorageMb;
    const additionalMb = additionalBytes / BYTES_PER_MB;
    if (usageMb + additionalMb > maxMb) {
        throw new Error(strings.subscription.limits.storageLimit);
    }
}
