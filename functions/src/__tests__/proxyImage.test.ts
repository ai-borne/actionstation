/**
 * proxyImage Handler Tests
 * TDD: Validates image proxying, auth, rate limiting, SSRF, content validation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleProxyImage } from '../proxyImage.js';
import { clearRateLimitStore } from '../utils/rateLimiter.js';
import { MAX_IMAGE_SIZE_BYTES } from '../utils/securityConstants.js';
import * as urlValidator from '../utils/urlValidator.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock firebase-admin/auth
vi.mock('firebase-admin/auth', () => ({
    getAuth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
    }),
}));

const originalFetch = globalThis.fetch;

describe('proxyImage', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        await clearRateLimitStore();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('handleProxyImage', () => {
        it('returns 400 for missing URL', async () => {
            const result = await handleProxyImage(undefined, 'user-1');
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(400);
            }
        });

        it('returns 400 for non-string URL', async () => {
            const result = await handleProxyImage(
                123 as unknown as string,
                'user-1',
            );
            expect(result.type).toBe('error');
        });

        it('returns 400 for invalid URL format', async () => {
            const result = await handleProxyImage('not-a-url', 'user-1');
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(400);
            }
        });

        it('returns 429 when rate limited', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({
                    'content-type': 'image/png',
                    'content-length': '4',
                }),
                arrayBuffer: () => Promise.resolve(pngBytes.buffer),
            }));

            // Exhaust rate limit (30 for images)
            for (let i = 0; i < 30; i++) {
                await handleProxyImage(
                    `https://example.com/img-${i}.png`,
                    'rate-img-user',
                );
            }

            const result = await handleProxyImage(
                'https://example.com/img-31.png',
                'rate-img-user',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(429);
            }
        });

        it('returns 400 for SSRF-blocked URL', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: false, error: 'URL target is not allowed' });

            const result = await handleProxyImage(
                'http://192.168.1.1/logo.png',
                'user-1',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(400);
            }
        });

        it('returns image bytes on success', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({
                    'content-type': 'image/png',
                    'content-length': '4',
                }),
                arrayBuffer: () => Promise.resolve(pngData.buffer.slice(0, 4)),
            }));

            const result = await handleProxyImage(
                'https://example.com/logo.png',
                'user-1',
            );
            expect(result.type).toBe('image');
            if (result.type === 'image') {
                expect(result.contentType).toBe('image/png');
                expect(result.buffer.length).toBe(4);
                expect(result.cacheMaxAge).toBe(86400);
            }
        });

        it('returns 400 for non-image content type', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({
                    'content-type': 'text/html',
                    'content-length': '100',
                }),
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
            }));

            const result = await handleProxyImage(
                'https://example.com/page.html',
                'user-1',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(400);
                expect(result.message).toContain('not a valid image');
            }
        });

        it('returns 502 when upstream returns non-ok', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                headers: new Headers(),
            }));

            const result = await handleProxyImage(
                'https://example.com/missing.png',
                'user-1',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(502);
            }
        });

        it('returns 502 when fetch throws', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
                new Error('Network failure'),
            ));

            const result = await handleProxyImage(
                'https://example.com/timeout.png',
                'user-1',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(502);
            }
        });

        it('returns 400 for oversized image streamed with no content-length (OOM guard)', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            // Simulate adversarial server: no Content-Length, streams > limit
            const oversizedData = new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1024);
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(oversizedData);
                    controller.close();
                },
            });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({ 'content-type': 'image/png' }), // no content-length
                body,
            }));

            const result = await handleProxyImage(
                'https://example.com/oom.png',
                'user-1',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(400);
                expect(result.message).toContain('size limit');
            }
        });

        it('returns 400 for oversized image declared in content-length', async () => {
            vi.spyOn(urlValidator, 'validateUrlFormat')
                .mockReturnValue({ valid: true });
            vi.spyOn(urlValidator, 'validateUrlWithDns')
                .mockResolvedValue({ valid: true });

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({
                    'content-type': 'image/jpeg',
                    'content-length': '10000000',
                }),
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(10000000)),
            }));

            const result = await handleProxyImage(
                'https://example.com/huge.jpg',
                'user-1',
            );
            expect(result.type).toBe('error');
            if (result.type === 'error') {
                expect(result.status).toBe(400);
            }
        });
    });
});

/**
 * Entry-point auth contract. proxyImage is loaded by <img src>, which can never
 * attach headers (no X-Firebase-AppCheck, no Authorization). Authorization is
 * therefore the HMAC-signed URL minted by the App Check–enforced signImageUrls
 * callable; the entry point must neither demand App Check nor read ?token=.
 */
describe('proxyImage entry point — <img>-compatible auth', () => {
    const source = readFileSync(join(__dirname, '..', 'proxyImage.ts'), 'utf-8');

    it('does not gate on an App Check header (<img> cannot send one)', () => {
        expect(source).not.toMatch(/verifyAppCheckToken\s*\(/);
    });

    it('never reads an ID token from the query string', () => {
        expect(source).not.toMatch(/query\[['"]token['"]\]/);
    });

    it('authorizes via signed URL params through resolveProxyAuth', () => {
        expect(source).toContain('resolveProxyAuth');
        expect(source).toMatch(/query\[['"]sig['"]\]/);
        expect(source).toMatch(/query\[['"]exp['"]\]/);
    });
});
