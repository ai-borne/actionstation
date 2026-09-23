/**
 * fetchLinkMeta Handler Tests
 * TDD: Validates request handling, auth, rate limiting, SSRF, and metadata parsing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleFetchLinkMeta } from '../fetchLinkMeta.js';
import { verifyAuthToken } from '../utils/authVerifier.js';
import { clearRateLimitStore } from '../utils/rateLimiter.js';
import { MAX_HTML_SIZE_BYTES } from '../utils/securityConstants.js';
import * as urlValidator from '../utils/urlValidator.js';

vi.mock('firebase-admin/auth', () => ({
    getAuth: () => ({
        verifyIdToken: vi.fn().mockImplementation((token: string) => {
            if (token === 'valid-token') {
                return Promise.resolve({ uid: 'test-uid' });
            }
            return Promise.reject(new Error('Invalid token'));
        }),
    }),
}));

const originalFetch = globalThis.fetch;

describe('fetchLinkMeta', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        await clearRateLimitStore();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('verifyAuthToken', () => {
        it('returns uid for valid Bearer token', async () => {
            const uid = await verifyAuthToken('Bearer valid-token');
            expect(uid).toBe('test-uid');
        });

        it('returns null for missing header', async () => {
            const uid = await verifyAuthToken(undefined);
            expect(uid).toBeNull();
        });

        it('returns null for non-Bearer header', async () => {
            const uid = await verifyAuthToken('Basic abc123');
            expect(uid).toBeNull();
        });

        it('returns null for invalid token', async () => {
            const uid = await verifyAuthToken('Bearer invalid-token');
            expect(uid).toBeNull();
        });
    });

    describe('handleFetchLinkMeta', () => {
        it('returns 400 for missing URL', async () => {
            const result = await handleFetchLinkMeta({}, 'user-1');
            expect(result.status).toBe(400);
            expect(result.data.error).toContain('Invalid');
        });

        it('returns 400 for non-string URL', async () => {
            const result = await handleFetchLinkMeta(
                { url: 123 as unknown as string },
                'user-1',
            );
            expect(result.status).toBe(400);
        });

        it('returns 429 when rate limited', async () => {
            // Exhaust the rate limit
            for (let i = 0; i < 20; i++) {
                vi.spyOn(urlValidator, 'validateUrlWithDns')
                    .mockResolvedValue({ valid: true });
                vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                    ok: true,
                    headers: new Headers(),
                    text: () => Promise.resolve('<html><head><title>Test</title></head></html>'),
                }));
                await handleFetchLinkMeta(
                    { url: `https://example.com/page-${i}` },
                    'rate-test-user',
                );
            }

            const result = await handleFetchLinkMeta(
                { url: 'https://example.com/page-21' },
                'rate-test-user',
            );
            expect(result.status).toBe(429);
            expect(result.data.error).toContain('Rate limit');
        });

        it('returns 400 for SSRF-blocked URL', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: false, error: 'URL target is not allowed' });

            const result = await handleFetchLinkMeta(
                { url: 'http://192.168.1.1' },
                'user-1',
            );
            expect(result.status).toBe(400);
            expect(result.data.error).toContain('not allowed');
        });

        it('returns parsed metadata on success', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            const html = `
                <html><head>
                    <meta property="og:title" content="Example Page" />
                    <meta property="og:description" content="A test page" />
                    <meta property="og:image" content="https://example.com/img.png" />
                </head><body></body></html>
            `;
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                text: () => Promise.resolve(html),
            }));

            const result = await handleFetchLinkMeta(
                { url: 'https://example.com' },
                'user-1',
            );
            expect(result.status).toBe(200);
            expect(result.data.title).toBe('Example Page');
            expect(result.data.description).toBe('A test page');
            expect(result.data.image).toBe('https://example.com/img.png');
            expect(result.data.error).toBeUndefined();
        });

        it('returns error metadata when fetch fails', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

            const result = await handleFetchLinkMeta(
                { url: 'https://unreachable.com' },
                'user-1',
            );
            expect(result.status).toBe(200);
            expect(result.data.error).toBe(true);
            expect(result.data.domain).toBe('unreachable.com');
        });

        it('returns error metadata when response is not ok', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                headers: new Headers(),
            }));

            const result = await handleFetchLinkMeta(
                { url: 'https://example.com/404' },
                'user-1',
            );
            expect(result.status).toBe(200);
            expect(result.data.error).toBe(true);
        });

        it('returns error metadata for oversized HTML streamed with no content-length (OOM guard)', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            // Simulate adversarial server: no Content-Length, streams > limit
            const oversizedData = new Uint8Array(MAX_HTML_SIZE_BYTES + 1024);
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(oversizedData);
                    controller.close();
                },
            });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(), // no content-length
                body,
            }));

            const result = await handleFetchLinkMeta(
                { url: 'https://example.com/oom' },
                'user-1',
            );
            expect(result.status).toBe(200);
            expect(result.data.error).toBe(true);
        });

        it('returns error metadata when HTML exceeds size limit', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            const oversizedHeaders = new Headers();
            oversizedHeaders.set('content-length', '2000000');
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: oversizedHeaders,
                text: () => Promise.resolve(''),
            }));

            const result = await handleFetchLinkMeta(
                { url: 'https://example.com/huge' },
                'user-1',
            );
            expect(result.status).toBe(200);
            expect(result.data.error).toBe(true);
        });

        it('returns 400 for ftp:// URL', async () => {
            const result = await handleFetchLinkMeta(
                { url: 'ftp://example.com/file' },
                'user-1',
            );
            expect(result.status).toBe(400);
        });

        it('returns raw image/favicon URLs only — no expiring signed URLs that would be persisted with the preview', async () => {
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            const html = `
                <html><head>
                    <meta property="og:image" content="https://example.com/img.png" />
                    <link rel="icon" href="https://example.com/favicon.ico" />
                </head><body></body></html>
            `;
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                text: () => Promise.resolve(html),
            }));

            const result = await handleFetchLinkMeta({ url: 'https://example.com' }, 'user-1');

            expect(result.status).toBe(200);
            expect(result.data.image).toBe('https://example.com/img.png');
            expect(result.data).not.toHaveProperty('proxyImage');
            expect(result.data).not.toHaveProperty('proxyFavicon');
            expect(JSON.stringify(result.data)).not.toMatch(/sig=|exp=/);
        });
    });
});
