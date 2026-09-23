/**
 * Auth Resolver Tests
 * Validates the two auth paths (header token, signed URL) and that ?token= is rejected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { resolveProxyAuth } from '../authResolver.js';
import { signImageUrl } from '../urlSigner.js';
import { verifyAuthToken } from '../authVerifier.js';

vi.mock('../authVerifier.js', () => ({
    verifyAuthToken: vi.fn(async (value: string | undefined) => {
        if (!value) return null;
        if (value === 'Bearer valid-token') return 'user-123';
        return null;
    }),
}));

const SECRET = 'unit-test-hmac-key-not-a-real-secret';
const IMAGE_URL = 'https://example.com/photo.jpg';

describe('resolveProxyAuth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('authenticates via Authorization header (priority 1)', async () => {
        const result = await resolveProxyAuth('Bearer valid-token', {}, undefined);
        expect(result.uid).toBe('user-123');
        expect(result.method).toBe('token');
    });

    it('returns null uid for invalid Authorization header', async () => {
        const result = await resolveProxyAuth('Bearer bad-token', {}, undefined);
        expect(result.uid).toBeNull();
        expect(result.method).toBe('none');
    });

    it('authenticates via signed URL params (priority 2)', async () => {
        const signed = signImageUrl(IMAGE_URL, SECRET);
        const parsed = new URLSearchParams({ sig: signed.sig, exp: String(signed.exp) });

        const result = await resolveProxyAuth(undefined, {
            sig: parsed.get('sig')!,
            exp: parsed.get('exp')!,
            url: IMAGE_URL,
        }, SECRET);

        const expectedHash = crypto.createHash('sha256').update(IMAGE_URL).digest('hex').slice(0, 16);
        expect(result.uid).toBe(`__signed__:${expectedHash}`);
        expect(result.method).toBe('signed-url');
    });

    it('rejects expired signed URL params', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        const signed = signImageUrl(IMAGE_URL, SECRET);
        const parsed = new URLSearchParams({ sig: signed.sig, exp: String(signed.exp) });

        vi.setSystemTime(Number(parsed.get('exp')) + 1);

        const result = await resolveProxyAuth(undefined, {
            sig: parsed.get('sig')!,
            exp: parsed.get('exp')!,
            url: IMAGE_URL,
        }, SECRET);

        expect(result.uid).toBeNull();
        expect(result.method).toBe('none');
    });

    it('rejects tampered signed URL params', async () => {
        const signed = signImageUrl(IMAGE_URL, SECRET);
        const parsed = new URLSearchParams({ sig: signed.sig, exp: String(signed.exp) });

        const result = await resolveProxyAuth(undefined, {
            sig: 'a'.repeat(64),
            exp: parsed.get('exp')!,
            url: IMAGE_URL,
        }, SECRET);

        expect(result.uid).toBeNull();
        expect(result.method).toBe('none');
    });

    it('rejects an ID token passed as a ?token= query param (tokens must never ride in URLs)', async () => {
        const result = await resolveProxyAuth(undefined, {
            token: 'valid-token',
        } as Parameters<typeof resolveProxyAuth>[1], undefined);

        expect(result.uid).toBeNull();
        expect(result.method).toBe('none');
        expect(vi.mocked(verifyAuthToken)).not.toHaveBeenCalled();
    });

    it('returns null when no auth is provided', async () => {
        const result = await resolveProxyAuth(undefined, {}, undefined);
        expect(result.uid).toBeNull();
        expect(result.method).toBe('none');
    });

    it('prefers header over signed URL', async () => {
        const signed = signImageUrl(IMAGE_URL, SECRET);
        const parsed = new URLSearchParams({ sig: signed.sig, exp: String(signed.exp) });

        const result = await resolveProxyAuth('Bearer valid-token', {
            sig: parsed.get('sig')!,
            exp: parsed.get('exp')!,
            url: IMAGE_URL,
        }, SECRET);

        expect(result.method).toBe('token');
    });
});
