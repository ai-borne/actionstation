/**
 * handlePaymentCaptured — late retry after a refund (checklist B16).
 * Razorpay retries failed deliveries for up to 24 h, so a `payment.captured` retry can land
 * AFTER `refund.processed`. The payload's status is a stale "captured", so the handler must
 * read the payment's current state and never re-grant Pro for a fully refunded payment.
 * A partial refund keeps Pro (same policy as handleRefundProcessed).
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
vi.mock('../subscriptionWriter.js', () => ({
    writeSubscription: mockWriteSubscription,
    downgradeToFreeIfCurrentPayment: vi.fn(),
}));

const mockLogSecurityEvent = vi.fn();
vi.mock('../securityLogger.js', () => ({
    logSecurityEvent: mockLogSecurityEvent,
    SecurityEventType: new Proxy({}, { get: (_t, p) => String(p) }),
}));

const mockLoggerInfo = vi.fn();
vi.mock('firebase-functions/v2', () => ({ logger: { info: mockLoggerInfo, warn: vi.fn(), error: vi.fn() } }));

/** The stale payload entity: always "captured", as delivered by the retried event. */
const PAYLOAD_PAYMENT = {
    id: 'pay_1',
    amount: 299_900,
    currency: 'INR',
    status: 'captured',
    order_id: 'order_1',
    created_at: 1_700_000_000,
};

describe('handlePaymentCaptured — late retry after a refund', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWriteSubscription.mockResolvedValue(undefined);
        mockOrdersFetch.mockResolvedValue({
            id: 'order_1',
            notes: { source: 'actionstation', userId: 'user-1', planId: 'plan_pro_annual_inr' },
        });
    });

    it.each([
        ['status is refunded', { status: 'refunded', amount_refunded: 299_900 }],
        ['amount_refunded covers the whole payment', { status: 'captured', amount_refunded: 299_900 }],
    ])('does not grant Pro when %s', async (_label, current) => {
        mockPaymentsFetch.mockResolvedValue({ ...PAYLOAD_PAYMENT, ...current });
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(PAYLOAD_PAYMENT);

        expect(outcome).toEqual({ granted: false, reason: 'payment already fully refunded' });
        expect(mockPaymentsFetch).toHaveBeenCalledWith('pay_1');
        expect(mockWriteSubscription).not.toHaveBeenCalled();
        // Expected after an outage, not a bug: info log only, nothing that pages.
        expect(mockLogSecurityEvent).not.toHaveBeenCalled();
        expect(mockLoggerInfo).toHaveBeenCalledWith(
            expect.stringContaining('already refunded'),
            expect.objectContaining({ paymentId: 'pay_1' }),
        );
    });

    it('still grants Pro after a PARTIAL refund (partial refund keeps Pro)', async () => {
        mockPaymentsFetch.mockResolvedValue({ ...PAYLOAD_PAYMENT, status: 'partially_refunded', amount_refunded: 100_000 });
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        const outcome = await handlePaymentCaptured(PAYLOAD_PAYMENT);

        expect(outcome).toEqual({ granted: true, userId: 'user-1' });
        expect(mockWriteSubscription).toHaveBeenCalledTimes(1);
    });

    it('grants Pro for a payment with no refund', async () => {
        mockPaymentsFetch.mockResolvedValue({ ...PAYLOAD_PAYMENT, amount_refunded: 0 });
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        expect((await handlePaymentCaptured(PAYLOAD_PAYMENT)).granted).toBe(true);
    });

    it('fails closed: when the payment cannot be fetched it throws (Razorpay retries) and grants nothing', async () => {
        mockPaymentsFetch.mockRejectedValue(new Error('Razorpay unavailable'));
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        await expect(handlePaymentCaptured(PAYLOAD_PAYMENT)).rejects.toThrow('Razorpay unavailable');
        expect(mockWriteSubscription).not.toHaveBeenCalled();
    });

    it('does not spend an API call on another product\'s payment', async () => {
        mockOrdersFetch.mockResolvedValue({ id: 'order_1', notes: { userId: 'ssbmax-user' } });
        const { handlePaymentCaptured } = await import('../razorpayPaymentHandlers.js');

        await handlePaymentCaptured(PAYLOAD_PAYMENT);

        expect(mockPaymentsFetch).not.toHaveBeenCalled();
    });
});
