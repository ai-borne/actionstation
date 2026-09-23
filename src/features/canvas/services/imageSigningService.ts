/**
 * Image Signing Service - Resolves signed proxyImage URLs for link-preview images.
 *
 * <img> tags can't send auth/App Check headers, so each image URL is signed by
 * the signImageUrls callable (which does carry them). Requests made in the same
 * tick are batched into one call, and signed URLs are cached until shortly
 * before they expire — the server keeps a signature stable for its whole hour,
 * so a re-sign usually yields the same browser-cached URL.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { getSignedProxyImageUrl } from '@/config/linkPreviewConfig';

/** Mirrors MAX_SIGN_BATCH in functions/src/utils/securityConstants.ts */
const MAX_SIGN_BATCH = 25;
/** Re-sign when a cached signature has less than this left */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface Signature { sig: string; exp: number }

export interface ImageSignerDeps {
    callSign: (urls: readonly string[]) => Promise<Record<string, Signature>>;
    buildUrl: (rawUrl: string, sig: string, exp: number) => string;
    now: () => number;
    maxBatch?: number;
}

export interface ImageSigner {
    getSignedUrl: (rawUrl: string) => Promise<string>;
}

interface Waiter { rawUrl: string; resolve: (url: string) => void; reject: (err: unknown) => void }

export function createImageSigner(deps: ImageSignerDeps): ImageSigner {
    const maxBatch = deps.maxBatch ?? MAX_SIGN_BATCH;
    const cache = new Map<string, { url: string; exp: number }>();
    const inFlight = new Map<string, Promise<string>>();
    let queue: Waiter[] = [];
    let isFlushScheduled = false;

    function settleChunk(chunk: readonly Waiter[], signatures: Record<string, Signature>): void {
        for (const waiter of chunk) {
            inFlight.delete(waiter.rawUrl);
            const signature = signatures[waiter.rawUrl];
            if (!signature) {
                waiter.reject(new Error('Image URL was not signed'));
                continue;
            }
            const url = deps.buildUrl(waiter.rawUrl, signature.sig, signature.exp);
            cache.set(waiter.rawUrl, { url, exp: signature.exp });
            waiter.resolve(url);
        }
    }

    function flush(): void {
        isFlushScheduled = false;
        const pending = queue;
        queue = [];
        for (let i = 0; i < pending.length; i += maxBatch) {
            const chunk = pending.slice(i, i + maxBatch);
            deps.callSign(chunk.map((w) => w.rawUrl))
                .then((signatures) => settleChunk(chunk, signatures))
                .catch((err: unknown) => {
                    for (const waiter of chunk) {
                        inFlight.delete(waiter.rawUrl);
                        waiter.reject(err);
                    }
                });
        }
    }

    function getSignedUrl(rawUrl: string): Promise<string> {
        const cached = cache.get(rawUrl);
        if (cached && cached.exp - deps.now() > REFRESH_MARGIN_MS) return Promise.resolve(cached.url);

        const existing = inFlight.get(rawUrl);
        if (existing) return existing;

        const promise = new Promise<string>((resolve, reject) => {
            queue.push({ rawUrl, resolve, reject });
        });
        inFlight.set(rawUrl, promise);
        if (!isFlushScheduled) {
            isFlushScheduled = true;
            setTimeout(flush, 0);
        }
        return promise;
    }

    return { getSignedUrl };
}

const signImageUrlsCallable = httpsCallable<{ urls: readonly string[] }, { signatures: Record<string, Signature> }>(
    functions,
    'signImageUrls',
);

export const imageSigner: ImageSigner = createImageSigner({
    callSign: async (urls) => (await signImageUrlsCallable({ urls })).data.signatures,
    buildUrl: getSignedProxyImageUrl,
    now: () => Date.now(),
});
