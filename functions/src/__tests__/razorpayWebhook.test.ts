/**
 * razorpayWebhook Cloud Function Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

type MockHandler = (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<void>;
let capturedHandler: MockHandler | null = null;

vi.mock('firebase-functions/v2/https', () => ({
    onRequest: (_opts: unknown, handler: MockHandler) => {
        capturedHandler = handler;
        return handler;
    },
}));

vi.mock('../utils/razorpayClient.js', () => ({
    razorpayWebhookSecret: { value: () => 'whsec_razorpay_test' },
    razorpayKeyId: { value: () => 'rzp_test_id' },
    razorpayKeySecret: { value: () => 'rzp_test_secret' },
}));

const mockHandlePaymentCaptured = vi.fn();
const mockHandleRefundProcessed = vi.fn();
vi.mock('../utils/razorpayPaymentHandlers.js', () => ({
    handlePaymentCaptured: mockHandlePaymentCaptured,
    handleRefundProcessed: mockHandleRefundProcessed,
}));

vi.mock('../utils/securityLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    SecurityEventType: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock('../utils/threatMonitor.js', () => ({ recordThreatEvent: vi.fn() }));

const mockClaimWebhookEvent = vi.fn();
const mockReleaseWebhookEvent = vi.fn();
vi.mock('../utils/webhookIdempotency.js', () => ({
    claimWebhookEvent: mockClaimWebhookEvent,
    releaseWebhookEvent: mockReleaseWebhookEvent,
}));

const mockWriteSubscription = vi.fn();
const mockDowngradeToFree = vi.fn();
vi.mock('../utils/subscriptionWriter.js', () => ({
    writeSubscription: mockWriteSubscription,
    downgradeToFree: mockDowngradeToFree,
}));

vi.mock('../utils/securityConstants.js', async (orig) => {
    const actual = await orig<Record<string, unknown>>();
    return { ...actual };
});

function signBody(rawBody: string): string {
    return crypto.createHmac('sha256', 'whsec_razorpay_test').update(rawBody).digest('hex');
}

function paymentCapturedPayload() {
    return {
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id: 'pay_test_001',
                    amount: 299900,
                    currency: 'INR',
                    status: 'captured',
                    order_id: 'order_test_001',
                    created_at: 1_700_000_000,
                    notes: [],
                },
            },
        },
    };
}

function createMockRes() {
    const res: Record<string, unknown> = { statusCode: 0, body: null as unknown };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: unknown) => { res.body = data; return res; };
    return res;
}

function createMockReq(body: object, overrides: Record<string, unknown> = {}) {
    const raw = JSON.stringify(body);
    return {
        method: 'POST',
        ip: '1.2.3.4',
        rawBody: Buffer.from(raw),
        headers: { 'x-razorpay-signature': signBody(raw) },
        ...overrides,
    };
}

describe('razorpayWebhook', () => {
    beforeEach(async () => {
        capturedHandler = null;
        vi.clearAllMocks();
        vi.resetModules();
        mockClaimWebhookEvent.mockResolvedValue(true);
        mockReleaseWebhookEvent.mockResolvedValue(undefined);
        mockWriteSubscription.mockResolvedValue(undefined);
        mockDowngradeToFree.mockResolvedValue(undefined);
        mockHandlePaymentCaptured.mockResolvedValue({ granted: true, userId: 'user-1' });
        mockHandleRefundProcessed.mockResolvedValue({ downgraded: true, userId: 'user-1' });
        await import('../razorpayWebhook.js');
    });

    it('returns 405 for non-POST methods', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload(), { method: 'GET' }), res);
        expect(res.statusCode).toBe(405);
    });

    it('returns 400 when x-razorpay-signature header is missing', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload(), { headers: {} }), res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when signature verification fails', async () => {
        const res = createMockRes();
        const req = createMockReq(paymentCapturedPayload());
        req.headers = { 'x-razorpay-signature': 'bad_sig' };
        await capturedHandler!(req, res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when entity id is missing for idempotency', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq({ event: 'payment.captured', payload: {} }), res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 200 immediately when event already processed (idempotency)', async () => {
        mockClaimWebhookEvent.mockResolvedValue(false);
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload()), res);
        expect(res.statusCode).toBe(200);
        expect((res.body as Record<string, unknown>).note).toContain('already processed');
        expect(mockWriteSubscription).not.toHaveBeenCalled();
    });

    it('claims idempotency with stable eventId payment.captured_payId', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload()), res);
        expect(mockClaimWebhookEvent).toHaveBeenCalledWith(
            'payment.captured_pay_test_001',
            'payment.captured',
            '_pending',
        );
        expect(res.statusCode).toBe(200);
    });

    it('routes payment.captured to the order-resolving payment handler', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload()), res);
        expect(mockHandlePaymentCaptured).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'pay_test_001', order_id: 'order_test_001' }),
        );
        expect(res.statusCode).toBe(200);
    });

    it('acknowledges with 200 and keeps the claim when the payment cannot be attributed', async () => {
        mockHandlePaymentCaptured.mockResolvedValue({ granted: false, reason: 'order has no userId' });
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload()), res);
        expect(res.statusCode).toBe(200);
        expect(mockReleaseWebhookEvent).not.toHaveBeenCalled();
    });

    it('routes refund.processed and claims idempotency on the refund id', async () => {
        const res = createMockRes();
        const body = {
            event: 'refund.processed',
            payload: {
                refund: { entity: { id: 'rfnd_1', payment_id: 'pay_test_001', amount: 299900, status: 'processed' } },
                payment: paymentCapturedPayload().payload.payment,
            },
        };
        await capturedHandler!(createMockReq(body), res);
        expect(mockClaimWebhookEvent).toHaveBeenCalledWith('refund.processed_rfnd_1', 'refund.processed', '_pending');
        expect(mockHandleRefundProcessed).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'rfnd_1' }),
            expect.objectContaining({ id: 'pay_test_001' }),
        );
        expect(res.statusCode).toBe(200);
    });

    it('downgrades a cancelled subscription as a razorpay subscription', async () => {
        const res = createMockRes();
        const body = {
            event: 'subscription.cancelled',
            payload: { subscription: { entity: { id: 'sub_1', status: 'cancelled', plan_id: 'p', customer_id: 'cus_1', notes: { userId: 'user-1', source: 'actionstation' } } } },
        };
        await capturedHandler!(createMockReq(body), res);
        expect(mockDowngradeToFree).toHaveBeenCalledWith('user-1', 'cus_1', '', 'razorpay');
    });

    it.each(['subscription.activated', 'subscription.updated', 'subscription.cancelled'])(
        'ignores %s from another product sharing the Razorpay account: 200, nothing written',
        async (event) => {
            const res = createMockRes();
            const body = {
                event,
                payload: { subscription: { entity: { id: 'sub_x', status: 'active', plan_id: 'plan_ssbmax', customer_id: 'cus_x', notes: { userId: 'ssbmax-user', source: 'ssbmax' } } } },
            };
            await capturedHandler!(createMockReq(body), res);
            expect(res.statusCode).toBe(200);
            expect(mockWriteSubscription).not.toHaveBeenCalled();
            expect(mockDowngradeToFree).not.toHaveBeenCalled();
            expect(mockReleaseWebhookEvent).not.toHaveBeenCalled();
        },
    );

    it('returns 500 and releases claim when handler throws', async () => {
        mockHandlePaymentCaptured.mockRejectedValue(new Error('Firestore write failed'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(paymentCapturedPayload()), res);
        expect(res.statusCode).toBe(500);
        expect(mockReleaseWebhookEvent).toHaveBeenCalledWith('payment.captured_pay_test_001');
    });
});
