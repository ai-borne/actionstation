/**
 * URL Signer Tests
 * Validates HMAC signing/verification, cache-stable expiry, and tamper detection
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signImageUrl, verifySignedParams } from '../urlSigner.js';

const TEST_SIGNING_KEY = 'unit-test-hmac-key-not-a-real-secret';
const IMAGE_URL = 'https://example.com/image.png';
const HOUR_MS = 60 * 60 * 1000;

describe('urlSigner', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('signImageUrl', () => {
        it('returns a hex sha256 sig and a numeric exp', () => {
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(sig).toMatch(/^[a-f0-9]{64}$/);
            expect(Number.isInteger(exp)).toBe(true);
        });

        it('produces different signatures for different URLs', () => {
            expect(signImageUrl(IMAGE_URL, TEST_SIGNING_KEY).sig)
                .not.toBe(signImageUrl('https://other.com/img.jpg', TEST_SIGNING_KEY).sig);
        });

        it('produces different signatures for different secrets', () => {
            expect(signImageUrl(IMAGE_URL, 'hmac-key-alpha-placeholder').sig)
                .not.toBe(signImageUrl(IMAGE_URL, 'hmac-key-beta-placeholder').sig);
        });
    });

    describe('signImageUrl — cache-stable expiry', () => {
        it('returns an identical signature within one hour bucket (browser-cacheable URL)', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-01T10:05:00Z'));
            const first = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            vi.setSystemTime(new Date('2025-01-01T10:55:00Z'));
            expect(signImageUrl(IMAGE_URL, TEST_SIGNING_KEY)).toEqual(first);
        });

        it('expires between 1 and 2 hours after signing', () => {
            vi.useFakeTimers();
            const now = new Date('2025-01-01T10:59:59Z').getTime();
            vi.setSystemTime(now);
            const ttl = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY).exp - now;
            expect(ttl).toBeGreaterThanOrEqual(HOUR_MS);
            expect(ttl).toBeLessThanOrEqual(2 * HOUR_MS);
        });
    });

    describe('verifySignedParams', () => {
        it('returns true for a valid, non-expired signature', () => {
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams(IMAGE_URL, sig, String(exp), TEST_SIGNING_KEY)).toBe(true);
        });

        it('is still valid just before exp', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-01T10:05:00Z'));
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            vi.setSystemTime(exp - 1);
            expect(verifySignedParams(IMAGE_URL, sig, String(exp), TEST_SIGNING_KEY)).toBe(true);
        });

        it('returns false once exp has passed', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            vi.setSystemTime(exp + 1);
            expect(verifySignedParams(IMAGE_URL, sig, String(exp), TEST_SIGNING_KEY)).toBe(false);
        });

        it('returns false for a tampered signature', () => {
            const { exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams(IMAGE_URL, 'a'.repeat(64), String(exp), TEST_SIGNING_KEY)).toBe(false);
        });

        it('returns false for a tampered (extended) exp', () => {
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams(IMAGE_URL, sig, String(exp + HOUR_MS), TEST_SIGNING_KEY)).toBe(false);
        });

        it('returns false for a different image URL', () => {
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams('https://evil.com/bad.png', sig, String(exp), TEST_SIGNING_KEY)).toBe(false);
        });

        it('returns false for a wrong secret', () => {
            const { sig, exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams(IMAGE_URL, sig, String(exp), 'wrong-secret')).toBe(false);
        });

        it('returns false for non-numeric exp', () => {
            const { sig } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams(IMAGE_URL, sig, 'not-a-number', TEST_SIGNING_KEY)).toBe(false);
        });

        it('returns false for wrong-length sig without throwing', () => {
            const { exp } = signImageUrl(IMAGE_URL, TEST_SIGNING_KEY);
            expect(verifySignedParams(IMAGE_URL, 'x', String(exp), TEST_SIGNING_KEY)).toBe(false);
        });
    });
});
