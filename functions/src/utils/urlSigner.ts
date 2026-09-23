/**
 * URL Signer — Creates and verifies HMAC-signed proxy URLs
 * Eliminates the need to expose auth tokens in URL query parameters
 */
import * as crypto from 'crypto';

/**
 * Expiry is snapped to hour boundaries: a URL signed at any point within the
 * same hour gets the same exp — and therefore the same signed URL — so the
 * browser can reuse its cached proxied image instead of refetching on every
 * re-sign. Every signature stays valid for at least one hour (at most two).
 */
const SIGNED_URL_BUCKET_MS = 60 * 60 * 1000;

function bucketedExpiry(now: number): number {
    return (Math.floor(now / SIGNED_URL_BUCKET_MS) + 2) * SIGNED_URL_BUCKET_MS;
}

/** HMAC signature + expiry authorizing one image URL through proxyImage. */
export interface SignedImageParams {
    sig: string;
    exp: number;
}

/** Sign `imageUrl` so proxyImage will serve it until `exp` (epoch ms). */
export function signImageUrl(imageUrl: string, secret: string): SignedImageParams {
    const exp = bucketedExpiry(Date.now());
    const sig = crypto.createHmac('sha256', secret).update(`${imageUrl}:${exp}`).digest('hex');
    return { sig, exp };
}

/**
 * Verify that the sig + exp params are valid for the given image URL.
 * Returns false if expired or tampered.
 */
export function verifySignedParams(
    imageUrl: string,
    sig: string,
    exp: string,
    secret: string,
): boolean {
    const expNum = parseInt(exp, 10);
    if (isNaN(expNum) || Date.now() > expNum) return false;
    const payload = `${imageUrl}:${exp}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
