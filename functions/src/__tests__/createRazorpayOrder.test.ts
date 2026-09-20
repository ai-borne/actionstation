/**
 * createRazorpayOrder Tests — only the annual INR plan can be ordered, at the server price.
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

const mockOrdersCreate = vi.fn();
vi.mock('../utils/razorpayClient.js', () => ({
    getRazorpayClient: () => ({ orders: { create: mockOrdersCreate } }),
    razorpayKeyId: { value: () => 'rzp_test_id' },
    razorpayKeySecret: { value: () => 'rzp_test_secret' },
}));

vi.mock('../utils/appCheckVerifier.js', () => ({ verifyAppCheckToken: vi.fn().mockResolvedValue(true) }));
vi.mock('../utils/authVerifier.js', () => ({ verifyAuthToken: vi.fn().mockResolvedValue('user-1') }));
vi.mock('../utils/rateLimiter.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('../utils/ipRateLimiter.js', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('../utils/botDetector.js', () => ({
    detectBot: () => ({ isBot: false, confidence: 'low' }),
    extractClientIp: () => '1.2.3.4',
}));
vi.mock('../utils/securityLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    SecurityEventType: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock('../utils/threatMonitor.js', () => ({ recordThreatEvent: vi.fn() }));
vi.mock('../utils/corsConfig.js', () => ({ ALLOWED_ORIGINS: [] }));

function createMockRes() {
    const res: Record<string, unknown> = { statusCode: 0, body: null as unknown };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: unknown) => { res.body = data; return res; };
    return res;
}

function post(body: Record<string, unknown>) {
    return { method: 'POST', headers: { authorization: 'Bearer t' }, body };
}

describe('createRazorpayOrder', () => {
    beforeEach(async () => {
        capturedHandler = null;
        vi.resetModules();
        mockOrdersCreate.mockReset();
        mockOrdersCreate.mockResolvedValue({ id: 'order_1', amount: 299_900, currency: 'INR' });
        await import('../createRazorpayOrder.js');
    });

    it('creates an order for the annual INR plan at 299900 paise with userId in order notes', async () => {
        const { RAZORPAY_PLAN_IDS } = await import('../utils/securityConstants.js');
        const res = createMockRes();
        await capturedHandler!(post({ planId: RAZORPAY_PLAN_IDS.pro_annual_inr, currency: 'INR' }), res);

        expect(res.statusCode).toBe(200);
        expect(mockOrdersCreate).toHaveBeenCalledWith(expect.objectContaining({
            amount: 299_900,
            currency: 'INR',
            notes: { userId: 'user-1', planId: RAZORPAY_PLAN_IDS.pro_annual_inr, source: 'actionstation' },
        }));
    });

    it('rejects the 100 rupee monthly test plan with 400 and never calls Razorpay', async () => {
        const { RAZORPAY_PLAN_IDS } = await import('../utils/securityConstants.js');
        const res = createMockRes();
        await capturedHandler!(post({ planId: RAZORPAY_PLAN_IDS.pro_monthly_inr, currency: 'INR' }), res);

        expect(res.statusCode).toBe(400);
        expect(mockOrdersCreate).not.toHaveBeenCalled();
    });

    it('rejects USD orders with 400', async () => {
        const { RAZORPAY_PLAN_IDS } = await import('../utils/securityConstants.js');
        const res = createMockRes();
        await capturedHandler!(post({ planId: RAZORPAY_PLAN_IDS.pro_annual_usd, currency: 'USD' }), res);

        expect(res.statusCode).toBe(400);
        expect(mockOrdersCreate).not.toHaveBeenCalled();
    });
});
