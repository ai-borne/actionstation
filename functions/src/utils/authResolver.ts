/**
 * Auth Resolver — Resolves user identity from multiple auth strategies
 * Supports a Firebase ID token in the Authorization header and HMAC-signed URLs.
 * ID tokens are never accepted from the query string: URLs leak into browser
 * history, server logs and error reporting.
 */
import * as crypto from 'crypto';
import { verifyAuthToken } from './authVerifier.js';
import { verifySignedParams } from './urlSigner.js';

interface AuthQuery {
    sig?: string;
    exp?: string;
    url?: string;
}

interface AuthResult {
    uid: string | null;
    method: 'token' | 'signed-url' | 'none';
}

/**
 * Resolve auth from request headers/query params.
 * Priority: 1) Authorization header, 2) signed URL params.
 */
export async function resolveProxyAuth(
    authHeader: string | undefined,
    query: AuthQuery,
    signingSecret: string | undefined,
): Promise<AuthResult> {
    if (authHeader) {
        const uid = await verifyAuthToken(authHeader);
        return { uid, method: uid ? 'token' : 'none' };
    }

    if (query.sig && query.exp && query.url && signingSecret) {
        const valid = verifySignedParams(query.url, query.sig, query.exp, signingSecret);
        if (valid) {
            const urlHash = crypto.createHash('sha256').update(query.url).digest('hex').slice(0, 16);
            return { uid: `__signed__:${urlHash}`, method: 'signed-url' };
        }
        return { uid: null, method: 'none' };
    }

    return { uid: null, method: 'none' };
}
