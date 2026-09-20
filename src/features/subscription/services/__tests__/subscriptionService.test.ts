/**
 * Subscription Service Tests
 * TDD: Verifies Firestore reads and caching for subscription data
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscriptionService } from '../subscriptionService';

// Mock Firebase Firestore
const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

vi.mock('@/config/firebase', () => ({
    db: {},
}));

describe('subscriptionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        subscriptionService.clearCache();
        // Ensure dev bypass is disabled for tests
        delete (import.meta.env as Record<string, unknown>).VITE_DEV_BYPASS_SUBSCRIPTION;
    });

    it('returns free tier when subscription doc does not exist', async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });

        const result = await subscriptionService.getSubscription('user-1');
        expect(result.tier).toBe('free');
        expect(result.isActive).toBe(true);
    });

    it('returns pro tier when Firestore has pro subscription', async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                tier: 'pro',
                expiresAt: null,
                isActive: true,
            }),
        });

        const result = await subscriptionService.getSubscription('user-1');
        expect(result.tier).toBe('pro');
    });

    it('returns provider when present on subscription doc', async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                tier: 'pro',
                expiresAt: null,
                isActive: true,
                provider: 'razorpay',
            }),
        });

        const result = await subscriptionService.getSubscription('user-1');
        expect(result.provider).toBe('razorpay');
    });

    it('downgrades expired pro to free', async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                tier: 'pro',
                expiresAt: Date.now() - 86400000, // expired yesterday
                isActive: true,
            }),
        });

        const result = await subscriptionService.getSubscription('user-1');
        expect(result.tier).toBe('free');
        expect(result.isActive).toBe(false);
    });

    it('caches result for same user', async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ tier: 'pro', expiresAt: null, isActive: true }),
        });

        await subscriptionService.getSubscription('user-1');
        await subscriptionService.getSubscription('user-1');

        // Should only call Firestore once (cached second call)
        expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('refetches when user changes', async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ tier: 'pro', expiresAt: null, isActive: true }),
        });

        await subscriptionService.getSubscription('user-1');
        await subscriptionService.getSubscription('user-2');

        expect(mockGetDoc).toHaveBeenCalledTimes(2);
    });

    it('returns free on Firestore error', async () => {
        mockGetDoc.mockRejectedValue(new Error('Offline'));

        const result = await subscriptionService.getSubscription('user-1');
        expect(result.tier).toBe('free');
    });

    it('re-fetches after cache TTL and defaults to free on Firestore error', async () => {
        vi.useFakeTimers();
        mockGetDoc
            .mockResolvedValueOnce({
                exists: () => true,
                data: () => ({ tier: 'pro', expiresAt: null, isActive: true }),
            })
            .mockRejectedValueOnce(new Error('Offline'));

        const first = await subscriptionService.getSubscription('user-1');
        expect(first.tier).toBe('pro');

        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
        const second = await subscriptionService.getSubscription('user-1');
        expect(second.tier).toBe('free');
        expect(mockGetDoc).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('clearCache resets internal cache', async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ tier: 'pro', expiresAt: null, isActive: true }),
        });

        await subscriptionService.getSubscription('user-1');
        subscriptionService.clearCache();
        await subscriptionService.getSubscription('user-1');

        expect(mockGetDoc).toHaveBeenCalledTimes(2);
    });

    describe('dev bypass', () => {
        it('returns pro tier when VITE_DEV_BYPASS_SUBSCRIPTION=true', async () => {
            (import.meta.env as Record<string, unknown>).VITE_DEV_BYPASS_SUBSCRIPTION = 'true';

            const result = await subscriptionService.getSubscription('user-1');

            expect(result.tier).toBe('pro');
            expect(result.isActive).toBe(true);
            // Should not call Firestore when bypass is enabled
            expect(mockGetDoc).not.toHaveBeenCalled();
        });

        it('ignores bypass when env var is not "true"', async () => {
            (import.meta.env as Record<string, unknown>).VITE_DEV_BYPASS_SUBSCRIPTION = 'false';
            mockGetDoc.mockResolvedValue({ exists: () => false });

            const result = await subscriptionService.getSubscription('user-1');

            expect(result.tier).toBe('free');
            expect(mockGetDoc).toHaveBeenCalled();
        });
    });
});
