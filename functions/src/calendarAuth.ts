/**
 * Calendar Auth Cloud Functions
 * OAuth 2.0 Authorization Code flow for Google Calendar integration.
 * Refresh tokens are stored in Firestore; access tokens are never sent to clients.
 *
 * Security layers (Firebase onCall — auth is verified automatically):
 *   1. Auth check (request.auth)
 *   2. User rate limit (Firestore-backed sliding window)
 *   3. Input validation
 *   4. Security logging on every failure
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { checkRateLimit } from './utils/rateLimiter.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { CALENDAR_AUTH_RATE_LIMIT } from './utils/securityConstants.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { revokeCalendarGrant } from './utils/calendarGrantRevoker.js';

const gclientId = defineSecret('GOOGLE_CLIENT_ID');
const gclientSecret = defineSecret('GOOGLE_CLIENT_SECRET');

const CALENDAR_SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

/** Allowlist of URIs the frontend is permitted to send as the OAuth redirect_uri. */
const ALLOWED_REDIRECT_URIS = new Set([
    'https://actionstation-244f0.web.app/auth/calendar/callback',
    'https://actionstation-244f0.firebaseapp.com/auth/calendar/callback',
    'https://www.actionstation.in/auth/calendar/callback',
    'http://localhost:5173/auth/calendar/callback',
    'http://localhost:4173/auth/calendar/callback',
]);

/**
 * Core logic for exchanging an authorization code.
 * Exported for unit-testability.
 */
export async function handleExchangeCalendarCode(
    uid: string,
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
): Promise<{ connected: true }> {
    if (!await checkRateLimit(uid, 'exchangeCalendarCode', CALENDAR_AUTH_RATE_LIMIT)) {
        logSecurityEvent({
            type: SecurityEventType.RATE_LIMIT_VIOLATION,
            uid,
            endpoint: 'exchangeCalendarCode',
            message: 'Rate limit exceeded',
        });
        throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
    }

    if (!code || typeof code !== 'string' || code.length > 512) {
        throw new HttpsError('invalid-argument', 'Authorization code required');
    }

    try {
        const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
        const { tokens } = await oauth2.getToken(code);

        if (!tokens.access_token || !tokens.refresh_token) {
            throw new HttpsError('internal', 'Failed to obtain tokens from Google');
        }

        await getFirestore()
            .collection('users').doc(uid)
            .collection('integrations').doc('calendar')
            .set({
                refreshToken: tokens.refresh_token,
                accessToken: tokens.access_token,
                expiryDate: tokens.expiry_date ?? null,
                scope: tokens.scope ?? '',
                connectedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

        return { connected: true };
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        const googleErr = err as { message?: string; response?: { data?: unknown } };
        logSecurityEvent({
            type: SecurityEventType.AUTH_FAILURE,
            uid,
            endpoint: 'exchangeCalendarCode',
            message: `Token exchange failed: ${googleErr.message ?? 'unknown'}`,
        });
        throw new HttpsError('internal', 'Failed to exchange authorization code');
    }
}

/**
 * Core logic for disconnecting a calendar. Exported for unit-testability.
 */
export async function handleDisconnectCalendar(uid: string): Promise<{ disconnected: true }> {
    if (!await checkRateLimit(uid, 'disconnectCalendar', CALENDAR_AUTH_RATE_LIMIT)) {
        throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
    }
    // Best effort and never throws: the grant is revoked at Google before our copy of the token goes.
    await revokeCalendarGrant(uid);
    try {
        await getFirestore()
            .collection('users').doc(uid)
            .collection('integrations').doc('calendar')
            .delete();
        return { disconnected: true };
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        throw new HttpsError('internal', 'Failed to disconnect calendar');
    }
}

/**
 * Exchange a Google OAuth authorization code for access + refresh tokens.
 * Stores the refresh token in Firestore. Returns { connected: true }.
 */
export const exchangeCalendarCode = onCall(
    { secrets: [...CALENDAR_SECRETS], cors: ALLOWED_ORIGINS, enforceAppCheck: true },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');
        const { code, redirectUri } = request.data as { code?: string; redirectUri?: string };
        if (!redirectUri || !ALLOWED_REDIRECT_URIS.has(redirectUri)) {
            throw new HttpsError('invalid-argument', 'Invalid redirect URI');
        }
        return handleExchangeCalendarCode(
            uid, code ?? '', gclientId.value(), gclientSecret.value(), redirectUri,
        );
    },
);

/**
 * Remove the Google Calendar integration from Firestore.
 */
export const disconnectCalendar = onCall(
    { secrets: [...CALENDAR_SECRETS], cors: ALLOWED_ORIGINS, enforceAppCheck: true },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');
        return handleDisconnectCalendar(uid);
    },
);
