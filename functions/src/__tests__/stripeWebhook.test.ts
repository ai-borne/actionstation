/**
 * stripeWebhook Cloud Function Tests
 * Validates signature verification, idempotency, event routing, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockHandler = (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<void>;
let capturedHandler: MockHandler | null = null;

vi.mock('firebase-functions/v2/https', () => ({
    onRequest: (_opts: unknown, handler: MockHandler) => {
        capturedHandler = handler;
        return handler;
    },
}));

const mockConstructEvent = vi.fn();
vi.mock('../utils/stripeClient.js', () => ({
    stripeWebhookSecret: { value: () => 'whsec_test' },
    getStripeClient: () => ({
        webhooks: { constructEvent: mockConstructEvent },
    }),
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

const mockHandleCheckoutCompleted = vi.fn();
const mockHandleSubscriptionUpdated = vi.fn();
const mockHandleSubscriptionDeleted = vi.fn();
const mockHandleInvoicePaid = vi.fn();
const mockHandleInvoicePaymentFailed = vi.fn();

vi.mock('../utils/stripeWebhookHandlers.js', () => ({
    handleCheckoutCompleted: mockHandleCheckoutCompleted,
    handleSubscriptionUpdated: mockHandleSubscriptionUpdated,
    handleSubscriptionDeleted: mockHandleSubscriptionDeleted,
    handleInvoicePaid: mockHandleInvoicePaid,
    handleInvoicePaymentFailed: mockHandleInvoicePaymentFailed,
}));

vi.mock('../utils/securityConstants.js', async (orig) => {
    const actual = await orig<Record<string, unknown>>();
    return { ...actual };
});

function makeStripeEvent(type: string) {
    return { id: 'evt_test_001', type };
}

function createMockRes() {
    const res: Record<string, unknown> = { statusCode: 0, body: null as unknown };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: unknown) => { res.body = data; return res; };
    return res;
}

function createMockReq(overrides: Record<string, unknown> = {}) {
    return {
        method: 'POST',
        ip: '1.2.3.4',
        rawBody: Buffer.from('{}'),
        headers: { 'stripe-signature': 't=123,v1=abc' },
        ...overrides,
    };
}

describe('stripeWebhook', () => {
    beforeEach(async () => {
        capturedHandler = null;
        vi.resetModules();
        mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed'));
        mockClaimWebhookEvent.mockResolvedValue(true);
        mockReleaseWebhookEvent.mockReset();
        mockReleaseWebhookEvent.mockResolvedValue(undefined);
        mockHandleCheckoutCompleted.mockResolvedValue({ userId: 'user-1' });
        mockHandleSubscriptionUpdated.mockResolvedValue({ userId: 'user-1' });
        mockHandleSubscriptionDeleted.mockResolvedValue({ userId: 'user-1' });
        mockHandleInvoicePaid.mockResolvedValue({ userId: 'user-1' });
        mockHandleInvoicePaymentFailed.mockResolvedValue({ userId: 'user-1' });
        await import('../stripeWebhook.js');
    });

    it('returns 405 for non-POST methods', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq({ method: 'GET' }), res);
        expect(res.statusCode).toBe(405);
    });

    it('returns 400 when stripe-signature header is missing', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq({ headers: {} }), res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when signature verification fails', async () => {
        mockConstructEvent.mockImplementation(() => { throw new Error('Bad sig'); });
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 200 immediately when event already processed (idempotency)', async () => {
        mockClaimWebhookEvent.mockResolvedValue(false);
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(res.statusCode).toBe(200);
        expect((res.body as Record<string, unknown>).note).toContain('already processed');
        expect(mockHandleCheckoutCompleted).not.toHaveBeenCalled();
    });

    it('routes checkout.session.completed to handleCheckoutCompleted', async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockHandleCheckoutCompleted).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
    });

    it('routes customer.subscription.updated to handleSubscriptionUpdated', async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.updated'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockHandleSubscriptionUpdated).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
    });

    it('routes customer.subscription.deleted to handleSubscriptionDeleted', async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.deleted'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockHandleSubscriptionDeleted).toHaveBeenCalled();
    });

    it('routes invoice.paid to handleInvoicePaid', async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent('invoice.paid'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockHandleInvoicePaid).toHaveBeenCalled();
    });

    it('routes invoice.payment_failed to handleInvoicePaymentFailed', async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent('invoice.payment_failed'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockHandleInvoicePaymentFailed).toHaveBeenCalled();
    });

    it('returns 200 for unhandled event types (acknowledge without processing)', async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent('customer.created'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(res.statusCode).toBe(200);
    });

    it('returns 500 when handler throws (allows Stripe to retry)', async () => {
        mockHandleCheckoutCompleted.mockRejectedValue(new Error('Write failed'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(res.statusCode).toBe(500);
    });

    it('claims idempotency before routing to handler', async () => {
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockClaimWebhookEvent).toHaveBeenCalledWith('evt_test_001', expect.any(String), '_pending');
        expect(res.statusCode).toBe(200);
    });

    it('releases idempotency claim when handler throws', async () => {
        mockHandleCheckoutCompleted.mockRejectedValue(new Error('fail'));
        const res = createMockRes();
        await capturedHandler!(createMockReq(), res);
        expect(mockReleaseWebhookEvent).toHaveBeenCalledWith('evt_test_001');
    });
});
