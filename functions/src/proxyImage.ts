/**
 * proxyImage Cloud Function - Securely proxies images for link previews
 * Prevents user IP/UA/cookie leakage to external image servers
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { validateUrlWithDns, validateUrlFormat } from './utils/urlValidator.js';
import { validateImageResponse } from './utils/imageValidator.js';
import { checkRateLimit } from './utils/rateLimiter.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { resolveProxyAuth } from './utils/authResolver.js';
import { readBytesWithLimit } from './utils/streamReader.js';
import {
    errorMessages,
    IMAGE_RATE_LIMIT,
    FETCH_TIMEOUT_MS,
    MAX_IMAGE_SIZE_BYTES,
    IMAGE_CACHE_MAX_AGE_SECONDS,
} from './utils/securityConstants.js';

const urlSigningSecret = defineSecret('URL_SIGNING_SECRET');

/**
 * Core handler logic extracted for testability.
 * Returns either image bytes with headers, or an error response.
 */
export async function handleProxyImage(
    imageUrl: string | undefined,
    uid: string,
): Promise<ProxyImageResult> {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return { type: 'error', status: 400, message: errorMessages.invalidUrl };
    }

    // Quick format check (no DNS needed for fast rejection)
    const formatCheck = validateUrlFormat(imageUrl);
    if (!formatCheck.valid) {
        return { type: 'error', status: 400, message: formatCheck.error ?? errorMessages.invalidUrl };
    }

    // Rate limit check
    if (!await checkRateLimit(uid, 'proxyImage', IMAGE_RATE_LIMIT)) {
        return { type: 'error', status: 429, message: errorMessages.rateLimited };
    }

    // Full URL validation with SSRF protection
    const validation = await validateUrlWithDns(imageUrl);
    if (!validation.valid) {
        return { type: 'error', status: 400, message: validation.error ?? errorMessages.ssrfBlocked };
    }

    // Fetch the image
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(imageUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'EdenImageProxy/1.0' },
            redirect: 'follow',
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return { type: 'error', status: 502, message: errorMessages.fetchFailed };
        }

        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');
        const imageValidation = validateImageResponse(contentType, contentLength);

        if (!imageValidation.valid) {
            return {
                type: 'error',
                status: 400,
                message: imageValidation.error ?? errorMessages.invalidContentType,
            };
        }

        // Read the image body with streaming size enforcement.
        // Content-Length pre-check above is advisory; servers may omit or lie.
        // readBytesWithLimit cancels the stream mid-transfer if the limit is exceeded,
        // preventing OOM from adversarial servers that stream arbitrarily large bodies.
        const buffer = await readBytesWithLimit(response, MAX_IMAGE_SIZE_BYTES);
        if (!buffer) {
            return { type: 'error', status: 400, message: errorMessages.responseTooLarge };
        }

        return {
            type: 'image',
            status: 200,
            contentType: contentType ?? 'application/octet-stream',
            buffer,
            cacheMaxAge: IMAGE_CACHE_MAX_AGE_SECONDS,
        };
    } catch {
        return { type: 'error', status: 502, message: errorMessages.fetchFailed };
    }
}

/** Result types for the proxy handler */
export type ProxyImageResult =
    | { type: 'error'; status: number; message: string }
    | { type: 'image'; status: number; contentType: string; buffer: Buffer; cacheMaxAge: number };


/**
 * Cloud Function entry point.
 * GET /proxyImage?url=<encoded_image_url>
 * Auth: sig+exp signed URL params (minted by signImageUrls), or Authorization header.
 */
export const proxyImage = onRequest(
    { cors: ALLOWED_ORIGINS, maxInstances: 20, secrets: [urlSigningSecret] },
    async (req, res) => {
        if (req.method !== 'GET') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        // No App Check gate here: this endpoint is loaded by <img src>, which can't
        // send headers. The HMAC-signed URL is the authorization — it can only be
        // minted by the signImageUrls callable, which enforces App Check + auth.
        const imageUrl = req.query['url'] as string | undefined;
        const auth = await resolveProxyAuth(
            req.headers.authorization,
            {
                sig: req.query['sig'] as string | undefined,
                exp: req.query['exp'] as string | undefined,
                url: imageUrl,
            },
            urlSigningSecret.value() || undefined,
        );

        if (!auth.uid) {
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        const result = await handleProxyImage(imageUrl, auth.uid);

        if (result.type === 'error') {
            res.status(result.status).json({ error: result.message });
            return;
        }

        res.set('Content-Type', result.contentType);
        res.set('Cache-Control', `public, max-age=${result.cacheMaxAge}`);
        res.set('X-Content-Type-Options', 'nosniff');
        res.status(200).send(result.buffer);
    },
);
