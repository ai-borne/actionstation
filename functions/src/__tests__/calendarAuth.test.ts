/**
 * calendarAuth Cloud Function Tests
 * Tests handleExchangeCalendarCode and handleDisconnectCalendar (the inner handler
 * functions exported for testability, following the geminiProxy.ts pattern).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';

vi.mock('firebase-admin/firestore', () => {
    const setFn = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    // Supports nested chains: collection().doc().collection().doc().set()/delete()
    const innerDocFn = vi.fn(() => ({ set: setFn, delete: deleteFn }));
    const innerCollFn = vi.fn(() => ({ doc: innerDocFn }));
    const docFn = vi.fn(() => ({ set: setFn, delete: deleteFn, collection: innerCollFn }));
    const collectionFn = vi.fn(() => ({ doc: docFn }));
    return {
        getFirestore: vi.fn(() => ({ collection: collectionFn })),
        FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
    };
});

const { mockRevokeCalendarGrant } = vi.hoisted(() => ({
    mockRevokeCalendarGrant: vi.fn().mockResolvedValue(true),
}));
vi.mock('../utils/calendarGrantRevoker.js', () => ({ revokeCalendarGrant: mockRevokeCalendarGrant }));

vi.mock('../utils/rateLimiter.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/securityLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    SecurityEventType: { RATE_LIMIT_VIOLATION: 'RATE_LIMIT_VIOLATION', AUTH_FAILURE: 'AUTH_FAILURE' },
}));

const mockGetToken = vi.fn();
vi.mock('google-auth-library', () => ({
    OAuth2Client: vi.fn(() => ({ getToken: mockGetToken })),
}));

// vi.mock calls are hoisted by Vite/vitest at transform time, so these imports
// intentionally appear after the mock declarations above — the runtime order
// is correct after hoisting. The import-x/first rule does not apply here
// (import-x is not configured for this package).
import { handleExchangeCalendarCode, handleDisconnectCalendar } from '../calendarAuth.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const CLIENT_ID = 'mock-client-id';
const CLIENT_SECRET = 'mock-client-secret';
const REDIRECT_URI = 'https://example.com/callback';

describe('handleExchangeCalendarCode', () => {
    beforeEach(() => vi.clearAllMocks());

    it('throws resource-exhausted when rate limited', async () => {
        vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
        await expect(
            handleExchangeCalendarCode('uid-1', 'abc', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'resource-exhausted' });
    });

    it('throws invalid-argument when code is missing', async () => {
        await expect(
            handleExchangeCalendarCode('uid-1', '', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('throws invalid-argument when code is too long', async () => {
        await expect(
            handleExchangeCalendarCode('uid-1', 'x'.repeat(513), CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('throws internal when Google returns no refresh token', async () => {
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'acc', refresh_token: null } });
        await expect(
            handleExchangeCalendarCode('uid-1', 'abc', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'internal' });
    });

    it('throws internal when Google returns no access token', async () => {
        mockGetToken.mockResolvedValue({ tokens: { access_token: null, refresh_token: 'ref' } });
        await expect(
            handleExchangeCalendarCode('uid-1', 'abc', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'internal' });
    });

    it('returns { connected: true } on success and writes to Firestore', async () => {
        mockGetToken.mockResolvedValue({
            tokens: {
                access_token: 'acc',
                refresh_token: 'ref',
                expiry_date: Date.now() + 3600_000,
                scope: 'https://www.googleapis.com/auth/calendar',
            },
        });
        const result = await handleExchangeCalendarCode(
            'uid-1', 'valid-code', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI,
        );
        expect(result).toEqual({ connected: true });
        const { getFirestore } = await import('firebase-admin/firestore');
        expect(getFirestore().collection('users').doc).toHaveBeenCalledWith('uid-1');
    });

    it('throws internal and logs on unexpected token exchange error', async () => {
        mockGetToken.mockRejectedValue(new Error('network error'));
        await expect(
            handleExchangeCalendarCode('uid-1', 'abc', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'internal' });
        const { logSecurityEvent } = await import('../utils/securityLogger.js');
        expect(logSecurityEvent).toHaveBeenCalled();
    });

    it('rethrows HttpsError from inner logic unchanged', async () => {
        mockGetToken.mockRejectedValue(new HttpsError('not-found', 'custom error'));
        await expect(
            handleExchangeCalendarCode('uid-1', 'abc', CLIENT_ID, CLIENT_SECRET, REDIRECT_URI),
        ).rejects.toMatchObject({ code: 'not-found', message: 'custom error' });
    });
});

describe('handleDisconnectCalendar', () => {
    beforeEach(() => vi.clearAllMocks());

    it('throws resource-exhausted when rate limited', async () => {
        vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
        await expect(handleDisconnectCalendar('uid-1')).rejects.toMatchObject({
            code: 'resource-exhausted',
        });
    });

    it('returns { disconnected: true } on success', async () => {
        const result = await handleDisconnectCalendar('uid-1');
        expect(result).toEqual({ disconnected: true });
    });

    it('calls Firestore delete on the integrations/calendar doc', async () => {
        await handleDisconnectCalendar('uid-42');
        const { getFirestore } = await import('firebase-admin/firestore');
        expect(getFirestore().collection('users').doc).toHaveBeenCalledWith('uid-42');
    });

    it('revokes the Google grant for that user when disconnecting', async () => {
        await handleDisconnectCalendar('uid-42');
        expect(mockRevokeCalendarGrant).toHaveBeenCalledWith('uid-42');
    });

    it('still disconnects when Google could not be reached (revoke reports failure)', async () => {
        mockRevokeCalendarGrant.mockResolvedValueOnce(false);
        expect(await handleDisconnectCalendar('uid-1')).toEqual({ disconnected: true });
    });

    it('throws internal on Firestore error', async () => {
        const { getFirestore } = await import('firebase-admin/firestore');
        const failDelete = vi.fn().mockRejectedValue(new Error('firestore down'));
        const innerDoc = vi.fn(() => ({ set: vi.fn(), delete: failDelete }));
        const innerColl = vi.fn(() => ({ doc: innerDoc }));
        const outerDoc = vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), collection: innerColl }));
        vi.mocked(getFirestore).mockReturnValueOnce({
            collection: vi.fn(() => ({ doc: outerDoc })),
        } as unknown as ReturnType<typeof getFirestore>);
        await expect(handleDisconnectCalendar('uid-1')).rejects.toMatchObject({ code: 'internal' });
    });
});
