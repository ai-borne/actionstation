/**
 * razorpayPaymentHandlers Tests
 * The payer is resolved from the SERVER-SET order notes, never from client-supplied payment notes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrdersFetch = vi.fn();
const mockPaymentsFetch = vi.fn();
vi.mock('../razorpayClient.js', () => ({
    getRazorpayClient: () => ({
        orders: { fetch: mockOrdersFetch },
        payments: { fetch: mockPaymentsFetch },
    }),
}));

const mockWriteSubscription = vi.fn();
const mockDowngradeIfCurrent = vi.fn();
vi.mock('../subscriptionWriter.js', () => ({
    writeSubscription: mockWriteSubscription,
    downgradeToFreeIfCurrentPayment: mockDowngradeIfCurrent,
}));

const mockLogSecurityEvent = vi.fn();
vi.mock('../securityLogger.js', () => ({
    logSecurityEvent: mockLogSecurityEvent,
    SecurityEventType: new Proxy({}, { get: (_t, p) => String(p) }),
}));

const ANNUAL_PLAN = 'plan_pro_annual_inr';

function payment(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pay_1',
        amount: 299_900,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_1',
        created_at: 1_700_000_000,
        notes: [] as unknown,
        ...overrides,
    };
}

function order(notes: Record<string, string> | undefined) {
    return { id: 'order_1', amount: 299_900, notes };
}

describe('handlePaymentCaptured', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWriteSubscription.mockResolvedValue(undefined);
    });

    it('grants Pro to the user named in the ORDER notes when payment notes are empty', async () => {
        mockOrdersFetch.mockResolvedValue(order({ userId: 'user-1', planId: ANNUAL_PLAN }));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(payment());

        expect(outcome).toEqual({ granted: true, userId: 'user-1' });
        expect(mockOrdersFetch).toHaveBeenCalledWith('order_1');
        expect(mockWriteSubscription).toHaveBeenCalledWith('user-1', expect.objectContaining({
            tier: 'pro',
            isActive: true,
            provider: 'razorpay',
            gatewayPlanId: ANNUAL_PLAN,
            lastEventId: 'pay_1',
            expiresAt: 1_700_000_000_000 + 365 * 24 * 60 * 60 * 1000,
        }));
    });

    it('ignores a userId in payment notes when the order names a different user', async () => {
        mockOrdersFetch.mockResolvedValue(order({ userId: 'real-owner', planId: ANNUAL_PLAN }));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        await handlePaymentCaptured(payment({ notes: { userId: 'attacker-chosen' } }));

        expect(mockWriteSubscription).toHaveBeenCalledWith('real-owner', expect.anything());
    });

    it('does not grant, and logs once, when the payment has no order', async () => {
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(payment({ order_id: undefined, notes: { userId: 'u' } }));

        expect(outcome.granted).toBe(false);
        expect(mockWriteSubscription).not.toHaveBeenCalled();
        expect(mockLogSecurityEvent).toHaveBeenCalledTimes(1);
        expect(mockLogSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'WEBHOOK_PROCESSING_ERROR',
            metadata: expect.objectContaining({ paymentId: 'pay_1' }),
        }));
    });

    it('does not grant when the order carries no userId', async () => {
        mockOrdersFetch.mockResolvedValue(order({ planId: ANNUAL_PLAN }));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(payment());

        expect(outcome.granted).toBe(false);
        expect(mockWriteSubscription).not.toHaveBeenCalled();
        expect(mockLogSecurityEvent).toHaveBeenCalledTimes(1);
    });

    it('does not grant when the order plan is not the annual INR plan (the 100 rupee plan)', async () => {
        mockOrdersFetch.mockResolvedValue(order({ userId: 'user-1', planId: 'plan_SWtIj1spzXCZbR' }));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(payment({ amount: 10_000 }));

        expect(outcome.granted).toBe(false);
        expect(mockWriteSubscription).not.toHaveBeenCalled();
    });

    it('does not grant when the amount paid is below the plan price', async () => {
        mockOrdersFetch.mockResolvedValue(order({ userId: 'user-1', planId: ANNUAL_PLAN }));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(payment({ amount: 10_000 }));

        expect(outcome.granted).toBe(false);
        expect(mockWriteSubscription).not.toHaveBeenCalled();
    });

    it('throws (so Razorpay retries) when the order lookup fails transiently', async () => {
        mockOrdersFetch.mockRejectedValue(new Error('network down'));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        await expect(handlePaymentCaptured(payment())).rejects.toThrow('network down');
        expect(mockWriteSubscription).not.toHaveBeenCalled();
    });
});

describe('handleRefundProcessed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockOrdersFetch.mockResolvedValue(order({ userId: 'user-1', planId: ANNUAL_PLAN }));
    });

    it('downgrades the owner after a full refund of the current payment', async () => {
        mockDowngradeIfCurrent.mockResolvedValue(true);
        const { handleRefundProcessed } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handleRefundProcessed(
            { id: 'rfnd_1', payment_id: 'pay_1', amount: 299_900, status: 'processed' },
            payment(),
        );

        expect(outcome).toEqual({ downgraded: true, userId: 'user-1' });
        expect(mockDowngradeIfCurrent).toHaveBeenCalledWith('user-1', 'pay_1');
    });

    it('fetches the payment when the webhook payload omits it', async () => {
        mockPaymentsFetch.mockResolvedValue(payment());
        mockDowngradeIfCurrent.mockResolvedValue(true);
        const { handleRefundProcessed } = await import('../razorpayPaymentHandlers.js');

        await handleRefundProcessed({ id: 'rfnd_1', payment_id: 'pay_1', amount: 299_900, status: 'processed' }, undefined);

        expect(mockPaymentsFetch).toHaveBeenCalledWith('pay_1');
        expect(mockDowngradeIfCurrent).toHaveBeenCalledWith('user-1', 'pay_1');
    });

    it('keeps Pro on a partial refund and records that it did', async () => {
        const { handleRefundProcessed } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handleRefundProcessed(
            { id: 'rfnd_1', payment_id: 'pay_1', amount: 100_000, status: 'processed' },
            payment(),
        );

        expect(outcome.downgraded).toBe(false);
        expect(mockDowngradeIfCurrent).not.toHaveBeenCalled();
        expect(mockLogSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SUBSCRIPTION_CHANGE',
        }));
    });

    it('reports not downgraded when the refunded payment is no longer the current one', async () => {
        mockDowngradeIfCurrent.mockResolvedValue(false);
        const { handleRefundProcessed } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handleRefundProcessed(
            { id: 'rfnd_1', payment_id: 'pay_1', amount: 299_900, status: 'processed' },
            payment(),
        );

        expect(outcome).toEqual({ downgraded: false, userId: 'user-1' });
    });

    it('logs and ignores a refund whose order names no user', async () => {
        mockOrdersFetch.mockResolvedValue(order({ planId: ANNUAL_PLAN }));
        const { handleRefundProcessed } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handleRefundProcessed(
            { id: 'rfnd_1', payment_id: 'pay_1', amount: 299_900, status: 'processed' },
            payment(),
        );

        expect(outcome.downgraded).toBe(false);
        expect(mockDowngradeIfCurrent).not.toHaveBeenCalled();
        expect(mockLogSecurityEvent).toHaveBeenCalledTimes(1);
    });
});
