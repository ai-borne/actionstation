/**
 * imageSigningService Tests
 * Batches signImageUrls calls, caches signed URLs until shortly before expiry,
 * and re-signs after — so previews keep loading past the signature TTL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createImageSigner, type ImageSignerDeps } from '../imageSigningService';

// Keep the real Firebase app (and App Check's refresh timers) out of fake-timer tests
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));

const HOUR = 60 * 60 * 1000;
const IMG = 'https://pbs.twimg.com/media/a.jpg';
const ICON = 'https://x.com/favicon.ico';

function makeDeps(now: { value: number }): ImageSignerDeps & { callSign: ReturnType<typeof vi.fn> } {
    const callSign = vi.fn((urls: readonly string[]) => Promise.resolve(
        Object.fromEntries(urls.map((u) => [u, { sig: `sig-${u.length}-${now.value}`, exp: now.value + HOUR }])),
    ));
    return {
        callSign,
        buildUrl: (raw, sig, exp) => `https://fn.test/proxyImage?url=${encodeURIComponent(raw)}&sig=${sig}&exp=${exp}`,
        now: () => now.value,
        maxBatch: 2,
    };
}

describe('createImageSigner', () => {
    const clock = { value: 1_000_000 };

    beforeEach(() => {
        vi.useFakeTimers();
        clock.value = 1_000_000;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Run the signer's batching tick, then let the call settle. */
    async function settle<T>(promise: Promise<T>): Promise<T> {
        await vi.advanceTimersByTimeAsync(0);
        return promise;
    }

    it('resolves a proxy URL built from the returned signature', async () => {
        const deps = makeDeps(clock);
        const signer = createImageSigner(deps);

        const url = await settle(signer.getSignedUrl(IMG));

        expect(url).toContain('https://fn.test/proxyImage?url=');
        expect(url).toContain(`exp=${clock.value + HOUR}`);
        expect(url).not.toContain('token=');
    });

    it('batches concurrent requests into one call', async () => {
        const deps = makeDeps(clock);
        const signer = createImageSigner(deps);

        await settle(Promise.all([signer.getSignedUrl(IMG), signer.getSignedUrl(ICON)]));

        expect(deps.callSign).toHaveBeenCalledTimes(1);
        expect(deps.callSign).toHaveBeenCalledWith([IMG, ICON]);
    });

    it('shares one in-flight request for the same URL', async () => {
        const deps = makeDeps(clock);
        const signer = createImageSigner(deps);

        const [a, b] = await settle(Promise.all([signer.getSignedUrl(IMG), signer.getSignedUrl(IMG)]));

        expect(a).toBe(b);
        expect(deps.callSign).toHaveBeenCalledWith([IMG]);
    });

    it('serves from cache while the signature is fresh', async () => {
        const deps = makeDeps(clock);
        const signer = createImageSigner(deps);
        const first = await settle(signer.getSignedUrl(IMG));

        clock.value += HOUR / 2;
        const second = await settle(signer.getSignedUrl(IMG));

        expect(second).toBe(first);
        expect(deps.callSign).toHaveBeenCalledTimes(1);
    });

    it('re-signs once the cached signature is about to expire (previews load past the TTL)', async () => {
        const deps = makeDeps(clock);
        const signer = createImageSigner(deps);
        const first = await settle(signer.getSignedUrl(IMG));

        clock.value += HOUR - 60_000; // inside the refresh margin
        const second = await settle(signer.getSignedUrl(IMG));

        expect(deps.callSign).toHaveBeenCalledTimes(2);
        expect(second).not.toBe(first);
    });

    it('splits large batches to respect the server batch cap', async () => {
        const deps = makeDeps(clock);
        const signer = createImageSigner(deps);
        const urls = ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'];

        await settle(Promise.all(urls.map((u) => signer.getSignedUrl(u))));

        expect(deps.callSign).toHaveBeenCalledTimes(2);
        expect(deps.callSign).toHaveBeenNthCalledWith(1, urls.slice(0, 2));
        expect(deps.callSign).toHaveBeenNthCalledWith(2, urls.slice(2));
    });

    it('rejects when the call fails, and retries on the next request', async () => {
        const deps = makeDeps(clock);
        deps.callSign.mockRejectedValueOnce(new Error('network'));
        const signer = createImageSigner(deps);

        const failed = expect(signer.getSignedUrl(IMG)).rejects.toThrow('network');
        await vi.advanceTimersByTimeAsync(0);
        await failed;

        await expect(settle(signer.getSignedUrl(IMG))).resolves.toContain('proxyImage');
        expect(deps.callSign).toHaveBeenCalledTimes(2);
    });

    it('rejects a URL the server did not sign', async () => {
        const deps = makeDeps(clock);
        deps.callSign.mockResolvedValueOnce({});
        const signer = createImageSigner(deps);

        const unsigned = expect(signer.getSignedUrl(IMG)).rejects.toThrow('not signed');
        await vi.advanceTimersByTimeAsync(0);
        await unsigned;
    });
});
