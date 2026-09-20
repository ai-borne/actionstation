/**
 * paymentRecordWriter Tests — a paid annual plan leaves a minimal server-only record
 * when the account is deleted, so a refund review and tax trail survive erasure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn((path: string) => ({ get: mockGet, set: (d: unknown) => mockSet(path, d) }));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ doc: mockDoc }),
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

vi.mock('../securityLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    SecurityEventType: new Proxy({}, { get: (_t, p) => String(p) }),
}));

const ACTIVE_ANNUAL = {
    tier: 'pro',
    isActive: true,
    provider: 'razorpay',
    gatewaySubscriptionId: null,
    gatewayPlanId: 'plan_pro_annual_inr',
    lastEventId: 'pay_1',
    currency: 'inr',
    expiresAt: 1_800_000_000_000,
};

function snap(data: Record<string, unknown> | undefined) {
    return { exists: data !== undefined, data: () => data };
}

describe('retainPaymentRecord', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSet.mockResolvedValue(undefined);
    });

    it('writes a minimal record keyed by payment id for an active annual plan', async () => {
        mockGet.mockResolvedValue(snap(ACTIVE_ANNUAL));
        const { retainPaymentRecord } = await import('../paymentRecordWriter.js');

        await expect(retainPaymentRecord('user-1')).resolves.toBe(true);

        expect(mockSet).toHaveBeenCalledWith('paymentRecords/pay_1', {
            paymentId: 'pay_1',
            uid: 'user-1',
            provider: 'razorpay',
            planId: 'plan_pro_annual_inr',
            currency: 'inr',
            expiresAt: 1_800_000_000_000,
            reason: 'account_deleted_with_active_plan',
            recordedAt: 'SERVER_TS',
        });
    });

    it.each([
        ['no subscription document', undefined],
        ['a free user', { tier: 'free', provider: 'razorpay', lastEventId: 'pay_1' }],
        ['an inactive plan', { ...ACTIVE_ANNUAL, isActive: false }],
        ['a Stripe plan', { ...ACTIVE_ANNUAL, provider: 'stripe' }],
        ['a Razorpay subscription-API plan', { ...ACTIVE_ANNUAL, gatewaySubscriptionId: 'sub_1' }],
        ['a plan with no payment id', { ...ACTIVE_ANNUAL, lastEventId: '' }],
    ])('writes nothing and succeeds for %s', async (_label, data) => {
        mockGet.mockResolvedValue(snap(data));
        const { retainPaymentRecord } = await import('../paymentRecordWriter.js');

        await expect(retainPaymentRecord('user-1')).resolves.toBe(true);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('reports failure when the record cannot be written', async () => {
        mockGet.mockResolvedValue(snap(ACTIVE_ANNUAL));
        mockSet.mockRejectedValue(new Error('Firestore down'));
        const { retainPaymentRecord } = await import('../paymentRecordWriter.js');

        await expect(retainPaymentRecord('user-1')).resolves.toBe(false);
    });
});
