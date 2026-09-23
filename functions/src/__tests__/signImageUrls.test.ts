/**
 * signImageUrls Handler Tests
 * Mints HMAC signatures that let <img> tags load images through proxyImage
 * without carrying an ID token or App Check header.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { handleSignImageUrls } from '../signImageUrls.js';
import { verifySignedParams } from '../utils/urlSigner.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { MAX_SIGN_BATCH } from '../utils/securityConstants.js';

vi.mock('../utils/rateLimiter.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(true),
}));

const SECRET = 'unit-test-hmac-key-not-a-real-secret';
const IMG = 'https://pbs.twimg.com/media/abc.jpg';
const ICON = 'https://x.com/favicon.ico';

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(HttpsError);
    await expect(promise).rejects.toMatchObject({ code });
}

describe('handleSignImageUrls', () => {
    beforeEach(() => {
        vi.mocked(checkRateLimit).mockResolvedValue(true);
    });

    it('returns a verifiable signature for every requested URL', async () => {
        const result = await handleSignImageUrls({ urls: [IMG, ICON] }, 'user-1', SECRET);

        expect(Object.keys(result.signatures).sort()).toEqual([ICON, IMG].sort());
        for (const url of [IMG, ICON]) {
            const entry = result.signatures[url];
            expect(entry).toBeDefined();
            expect(verifySignedParams(url, entry?.sig ?? '', String(entry?.exp), SECRET)).toBe(true);
        }
    });

    it('de-duplicates repeated URLs', async () => {
        const result = await handleSignImageUrls({ urls: [IMG, IMG] }, 'user-1', SECRET);
        expect(Object.keys(result.signatures)).toEqual([IMG]);
    });

    it('rejects unauthenticated callers', async () => {
        await expectCode(handleSignImageUrls({ urls: [IMG] }, undefined, SECRET), 'unauthenticated');
    });

    it('fails closed when the signing secret is not configured', async () => {
        await expectCode(handleSignImageUrls({ urls: [IMG] }, 'user-1', ''), 'failed-precondition');
    });

    it.each([
        ['missing urls', {}],
        ['non-array urls', { urls: IMG }],
        ['empty array', { urls: [] }],
        ['non-string entry', { urls: [42] }],
        ['non-http scheme', { urls: ['javascript:alert(1)'] }],
        ['data: URI', { urls: ['data:image/png;base64,AAAA'] }],
        ['malformed URL', { urls: ['not a url'] }],
        ['over-long URL', { urls: [`https://example.com/${'a'.repeat(2100)}`] }],
    ])('rejects %s as invalid-argument', async (_label, data) => {
        await expectCode(handleSignImageUrls(data, 'user-1', SECRET), 'invalid-argument');
    });

    it('rejects batches larger than MAX_SIGN_BATCH', async () => {
        const urls = Array.from({ length: MAX_SIGN_BATCH + 1 }, (_, i) => `https://example.com/${i}.png`);
        await expectCode(handleSignImageUrls({ urls }, 'user-1', SECRET), 'invalid-argument');
    });

    it('accepts exactly MAX_SIGN_BATCH URLs', async () => {
        const urls = Array.from({ length: MAX_SIGN_BATCH }, (_, i) => `https://example.com/${i}.png`);
        const result = await handleSignImageUrls({ urls }, 'user-1', SECRET);
        expect(Object.keys(result.signatures)).toHaveLength(MAX_SIGN_BATCH);
    });

    it('rate-limits per user', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue(false);
        await expectCode(handleSignImageUrls({ urls: [IMG] }, 'user-1', SECRET), 'resource-exhausted');
        expect(checkRateLimit).toHaveBeenCalledWith('user-1', 'signImageUrls', expect.any(Number));
    });
});
