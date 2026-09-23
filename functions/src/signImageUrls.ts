/**
 * signImageUrls Cloud Function — mints HMAC signatures for proxyImage.
 *
 * Link-preview images render through <img src=".../proxyImage?...">, which can't
 * send an Authorization or App Check header. This callable (App Check + auth
 * enforced) is where that trust is established; it returns { sig, exp } per URL
 * and the client appends them to the proxyImage URL. No ID token ever enters a URL.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { checkRateLimit } from './utils/rateLimiter.js';
import { signImageUrl, type SignedImageParams } from './utils/urlSigner.js';
import {
    ALLOWED_SCHEMES,
    MAX_SIGN_BATCH,
    MAX_URL_LENGTH,
    SIGN_IMAGE_RATE_LIMIT,
    errorMessages,
} from './utils/securityConstants.js';

const urlSigningSecret = defineSecret('URL_SIGNING_SECRET');

export interface SignImageUrlsResult {
    signatures: Record<string, SignedImageParams>;
}

function isAllowedImageUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
    try {
        return (ALLOWED_SCHEMES as readonly string[]).includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function parseUrls(data: unknown): readonly string[] {
    const urls = (data as { urls?: unknown } | null)?.urls;
    if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_SIGN_BATCH) {
        throw new HttpsError('invalid-argument', errorMessages.invalidUrl);
    }
    if (!urls.every(isAllowedImageUrl)) {
        throw new HttpsError('invalid-argument', errorMessages.invalidUrl);
    }
    return [...new Set(urls)];
}

/** Core handler, extracted for testability. */
export async function handleSignImageUrls(
    data: unknown,
    uid: string | undefined,
    secret: string,
): Promise<SignImageUrlsResult> {
    if (!uid) throw new HttpsError('unauthenticated', errorMessages.authRequired);
    // Fail closed: without the secret nothing proxyImage accepts can be minted.
    if (!secret) throw new HttpsError('failed-precondition', errorMessages.signingUnavailable);

    const urls = parseUrls(data);
    if (!await checkRateLimit(uid, 'signImageUrls', SIGN_IMAGE_RATE_LIMIT)) {
        throw new HttpsError('resource-exhausted', errorMessages.rateLimited);
    }

    const signatures: Record<string, SignedImageParams> = {};
    for (const url of urls) signatures[url] = signImageUrl(url, secret);
    return { signatures };
}

export const signImageUrls = onCall(
    { cors: ALLOWED_ORIGINS, enforceAppCheck: true, maxInstances: 10, secrets: [urlSigningSecret] },
    (request) => handleSignImageUrls(request.data, request.auth?.uid, urlSigningSecret.value()),
);
