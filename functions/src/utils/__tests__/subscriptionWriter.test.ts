/**
 * subscriptionWriter Tests
 * Validates Firestore write paths and data shapes for writeSubscription / downgradeToFree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubscriptionUpdate } from '../subscriptionWriter.js';

const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ set: mockSet }));
const mockTxGet = vi.fn();
const mockTxSet = vi.fn();
const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<boolean>) =>
    fn({ get: mockTxGet, set: mockTxSet }));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ doc: mockDoc, runTransaction: mockRunTransaction }),
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

const BASE_UPDATE: SubscriptionUpdate = {
    tier: 'pro',
    isActive: true,
    expiresAt: null,
    gatewayCustomerId: 'cus_abc',
    gatewaySubscriptionId: 'sub_abc',
    gatewayPlanId: 'price_abc',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    currency: 'usd',
    lastEventId: 'evt_abc',
    provider: 'stripe',
};

describe('subscriptionWriter', () => {
    beforeEach(() => {
        mockSet.mockReset();
        mockDoc.mockClear();
        mockSet.mockResolvedValue(undefined);
    });

    it('writeSubscription writes to correct Firestore path', async () => {
        const { writeSubscription } = await import('../subscriptionWriter.js');
        await writeSubscription('user-99', BASE_UPDATE);
        expect(mockDoc).toHaveBeenCalledWith('users/user-99/subscription/current');
    });

    it('writeSubscription merges data and adds updatedAt', async () => {
        const { writeSubscription } = await import('../subscriptionWriter.js');
        await writeSubscription('user-1', BASE_UPDATE);
        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({ ...BASE_UPDATE, updatedAt: 'SERVER_TS' }),
            { merge: true },
        );
    });

    it('downgradeToFree writes free tier with isActive=false', async () => {
        const { downgradeToFree } = await import('../subscriptionWriter.js');
        await downgradeToFree('user-2', 'cus_xyz', 'evt_del');
        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({
                tier: 'free',
                isActive: false,
                gatewayCustomerId: 'cus_xyz',
                lastEventId: 'evt_del',
            }),
            { merge: true },
        );
    });

    it('downgradeToFree clears subscription and plan IDs', async () => {
        const { downgradeToFree } = await import('../subscriptionWriter.js');
        await downgradeToFree('user-3', 'cus_999', 'evt_999');
        const written = mockSet.mock.calls[0]?.[0] as SubscriptionUpdate;
        expect(written.gatewaySubscriptionId).toBeNull();
        expect(written.gatewayPlanId).toBeNull();
    });

    describe('downgradeToFreeIfCurrentPayment', () => {
        beforeEach(() => {
            mockTxGet.mockReset();
            mockTxSet.mockReset();
        });

        it('downgrades when the refunded payment is the one granting Pro', async () => {
            mockTxGet.mockResolvedValue({ exists: true, data: () => ({ tier: 'pro', lastEventId: 'pay_1' }) });
            const { downgradeToFreeIfCurrentPayment } = await import('../subscriptionWriter.js');
            await expect(downgradeToFreeIfCurrentPayment('user-1', 'pay_1')).resolves.toBe(true);
            expect(mockTxSet).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ tier: 'free', isActive: false, provider: 'razorpay', lastEventId: 'pay_1' }),
                { merge: true },
            );
        });

        it('leaves a newer purchase alone when an older payment is refunded', async () => {
            mockTxGet.mockResolvedValue({ exists: true, data: () => ({ tier: 'pro', lastEventId: 'pay_2' }) });
            const { downgradeToFreeIfCurrentPayment } = await import('../subscriptionWriter.js');
            await expect(downgradeToFreeIfCurrentPayment('user-1', 'pay_1')).resolves.toBe(false);
            expect(mockTxSet).not.toHaveBeenCalled();
        });

        it('does nothing when there is no subscription document', async () => {
            mockTxGet.mockResolvedValue({ exists: false, data: () => undefined });
            const { downgradeToFreeIfCurrentPayment } = await import('../subscriptionWriter.js');
            await expect(downgradeToFreeIfCurrentPayment('user-1', 'pay_1')).resolves.toBe(false);
            expect(mockTxSet).not.toHaveBeenCalled();
        });
    });
});
