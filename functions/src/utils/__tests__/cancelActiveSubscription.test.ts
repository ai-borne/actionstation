/**
 * cancelActiveSubscription tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet }));
const mockStripeCancel = vi.fn().mockResolvedValue({});
const mockRazorpayCancel = vi.fn().mockResolvedValue({});

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ doc: mockDoc }),
}));

vi.mock('../stripeClient.js', () => ({
    getStripeClient: () => ({
        subscriptions: { cancel: mockStripeCancel },
    }),
}));

vi.mock('../razorpayClient.js', () => ({
    getRazorpayClient: () => ({
        subscriptions: { cancel: mockRazorpayCancel },
    }),
}));

vi.mock('../securityLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    SecurityEventType: { SUBSCRIPTION_CHANGE: 'subscription_change' },
}));

vi.mock('firebase-functions/v2', () => ({
    logger: { warn: vi.fn(), info: vi.fn() },
}));

describe('cancelActiveSubscription', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('cancels Stripe subscription when provider is stripe', async () => {
        mockGet.mockResolvedValue({
            exists: true,
            data: () => ({
                tier: 'pro',
                isActive: true,
                provider: 'stripe',
                gatewaySubscriptionId: 'sub_stripe_1',
            }),
        });
        const { cancelActiveSubscription } = await import('../cancelActiveSubscription.js');
        const result = await cancelActiveSubscription('user-1');
        expect(mockStripeCancel).toHaveBeenCalledWith('sub_stripe_1');
        expect(result).toEqual({ ok: true, wasActive: true });
    });

    it('cancels Razorpay subscription when subscription id exists', async () => {
        mockGet.mockResolvedValue({
            exists: true,
            data: () => ({
                tier: 'pro',
                isActive: true,
                provider: 'razorpay',
                gatewaySubscriptionId: 'sub_rzp_1',
            }),
        });
        const { cancelActiveSubscription } = await import('../cancelActiveSubscription.js');
        const result = await cancelActiveSubscription('user-1');
        expect(mockRazorpayCancel).toHaveBeenCalledWith('sub_rzp_1');
        expect(result).toEqual({ ok: true, wasActive: true });
    });

    it('returns ok:false when Stripe cancel throws', async () => {
        mockStripeCancel.mockRejectedValue(new Error('stripe down'));
        mockGet.mockResolvedValue({
            exists: true,
            data: () => ({
                tier: 'pro',
                isActive: true,
                provider: 'stripe',
                gatewaySubscriptionId: 'sub_stripe_1',
            }),
        });
        const { cancelActiveSubscription } = await import('../cancelActiveSubscription.js');
        const result = await cancelActiveSubscription('user-1');
        expect(result).toEqual({ ok: false, wasActive: true });
    });

    it('no-ops when subscription doc is missing', async () => {
        mockGet.mockResolvedValue({ exists: false });
        const { cancelActiveSubscription } = await import('../cancelActiveSubscription.js');
        const result = await cancelActiveSubscription('user-1');
        expect(mockStripeCancel).not.toHaveBeenCalled();
        expect(mockRazorpayCancel).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, wasActive: false });
    });
});
