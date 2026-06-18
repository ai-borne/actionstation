/**
 * verifyTurnstile Handler Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockHandler = (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
) => Promise<void> | void;

let capturedHandler: MockHandler | null = null;

const mockCheckIpRateLimit = vi.fn();
const mockVerifyTurnstileToken = vi.fn();
const mockLogSecurityEvent = vi.fn();

vi.mock('firebase-functions/v2/https', () => ({
    onRequest: (_opts: unknown, handler: MockHandler) => {
        capturedHandler = handler;
        return handler;
    },
}));

vi.mock('firebase-functions/params', () => ({
    defineSecret: () => ({ value: () => 'test-turnstile-secret' }),
}));

vi.mock('../utils/botDetector.js', () => ({
    extractClientIp: () => '203.0.113.1',
}));

vi.mock('../utils/ipRateLimiter.js', () => ({
    checkIpRateLimit: (...args: unknown[]) => mockCheckIpRateLimit(...args),
}));

vi.mock('../utils/captchaValidator.js', () => ({
    verifyTurnstileToken: (...args: unknown[]) => mockVerifyTurnstileToken(...args),
}));

vi.mock('../utils/securityLogger.js', () => ({
    logSecurityEvent: (...args: unknown[]) => mockLogSecurityEvent(...args),
    SecurityEventType: { RATE_LIMIT_VIOLATION: 'rate_limit_violation', CAPTCHA_FAILED: 'captcha_failed' },
}));

vi.mock('../utils/corsConfig.js', () => ({
    ALLOWED_ORIGINS: ['http://localhost:5173'],
}));

function createMockRes() {
    const res = {
        statusCode: 0,
        body: null as unknown,
        status(code: number) { res.statusCode = code; return res; },
        json(data: unknown) { res.body = data; return res; },
    };
    return res;
}

describe('verifyTurnstile', () => {
    beforeEach(async () => {
        capturedHandler = null;
        vi.clearAllMocks();
        mockCheckIpRateLimit.mockResolvedValue(true);
        mockVerifyTurnstileToken.mockResolvedValue({ success: true });
        vi.resetModules();
        await import('../verifyTurnstile.js');
    });

    it('returns 405 for non-POST methods', async () => {
        const res = createMockRes();
        await capturedHandler!({ method: 'GET', body: {} }, res);
        expect(res.statusCode).toBe(405);
    });

    it('returns 429 when IP rate limit exceeded', async () => {
        mockCheckIpRateLimit.mockResolvedValue(false);
        const res = createMockRes();
        await capturedHandler!({ method: 'POST', body: { token: 'tok' } }, res);
        expect(res.statusCode).toBe(429);
        expect(mockLogSecurityEvent).toHaveBeenCalled();
    });

    it('returns 400 for missing token', async () => {
        const res = createMockRes();
        await capturedHandler!({ method: 'POST', body: {} }, res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 403 when Turnstile verification fails', async () => {
        mockVerifyTurnstileToken.mockResolvedValue({ success: false, errorCodes: ['invalid-input'] });
        const res = createMockRes();
        await capturedHandler!({ method: 'POST', body: { token: 'bad-token' } }, res);
        expect(res.statusCode).toBe(403);
        expect(mockLogSecurityEvent).toHaveBeenCalled();
    });

    it('returns 200 when verification succeeds', async () => {
        const res = createMockRes();
        await capturedHandler!({ method: 'POST', body: { token: 'valid-token' } }, res);
        expect(res.statusCode).toBe(200);
        expect((res.body as { success: boolean }).success).toBe(true);
        expect(mockVerifyTurnstileToken).toHaveBeenCalledWith(
            'valid-token',
            'test-turnstile-secret',
            '203.0.113.1',
        );
    });
});
