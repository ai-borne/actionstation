/**
 * storageGuardService tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertStorageWithinLimit } from '../storageGuardService';
import { FREE_TIER_LIMITS } from '../../types/tierLimits';

const { mockGetSubscription, mockGetStorageUsageMb } = vi.hoisted(() => ({
    mockGetSubscription: vi.fn(),
    mockGetStorageUsageMb: vi.fn(),
}));

vi.mock('../subscriptionService', () => ({
    subscriptionService: {
        getSubscription: mockGetSubscription,
    },
}));

vi.mock('../storageUsageService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../storageUsageService')>();
    return {
        ...actual,
        getStorageUsageMb: mockGetStorageUsageMb,
    };
});

describe('assertStorageWithinLimit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSubscription.mockResolvedValue({
            tier: 'free',
            isActive: true,
            expiresAt: null,
        });
    });

    it('allows upload when under free tier cap', async () => {
        mockGetStorageUsageMb.mockResolvedValue(10);
        await expect(assertStorageWithinLimit('user-1', 1024 * 1024)).resolves.toBeUndefined();
    });

    it('throws when upload would exceed free tier cap', async () => {
        mockGetStorageUsageMb.mockResolvedValue(FREE_TIER_LIMITS.maxStorageMb - 1);
        await expect(assertStorageWithinLimit('user-1', 2 * 1024 * 1024)).rejects.toThrow();
    });

    it('blocks upload when storage read fails (fail-closed)', async () => {
        const { StorageUsageReadError } = await import('../storageUsageService');
        mockGetStorageUsageMb.mockRejectedValue(new StorageUsageReadError(new Error('offline')));
        await expect(assertStorageWithinLimit('user-1', 1024)).rejects.toThrow();
    });

    it('uses pro tier cap for pro users', async () => {
        mockGetSubscription.mockResolvedValue({
            tier: 'pro',
            isActive: true,
            expiresAt: null,
        });
        mockGetStorageUsageMb.mockResolvedValue(4000);
        await expect(assertStorageWithinLimit('user-1', 1024 * 1024)).resolves.toBeUndefined();
    });
});
