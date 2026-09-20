/**
 * calendarGrantRevoker Tests (checklist A10b)
 * Disconnecting Google Calendar or deleting the account must also revoke the grant at Google,
 * otherwise the app stays listed in the user's Google account. Best effort: it never throws
 * and never logs the token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockDocs: string[] = [];
vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            doc: (id: string) => {
                mockDocs.push(`${name}/${id}`);
                return {
                    collection: (sub: string) => ({
                        doc: (subId: string) => {
                            mockDocs.push(`${sub}/${subId}`);
                            return { get: mockGet };
                        },
                    }),
                };
            },
        }),
    }),
}));

const mockWarn = vi.fn();
const mockInfo = vi.fn();
vi.mock('firebase-functions/v2', () => ({ logger: { warn: mockWarn, info: mockInfo, error: vi.fn() } }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const REFRESH_TOKEN = '1//refresh-token-value';

describe('revokeCalendarGrant', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDocs.length = 0;
        mockGet.mockResolvedValue({ exists: true, data: () => ({ refreshToken: REFRESH_TOKEN }) });
        mockFetch.mockResolvedValue({ ok: true, status: 200 });
    });

    it('revokes the stored refresh token at Google and reports success', async () => {
        const { revokeCalendarGrant } = await import('../calendarGrantRevoker.js');

        expect(await revokeCalendarGrant('uid-1')).toBe(true);

        expect(mockDocs).toEqual(['users/uid-1', 'integrations/calendar']);
        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://oauth2.googleapis.com/revoke');
        expect(init.method).toBe('POST');
        expect(new URLSearchParams(init.body as string).get('token')).toBe(REFRESH_TOKEN);
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it.each([
        ['no integration document', { exists: false, data: () => undefined }],
        ['a document without a refresh token', { exists: true, data: () => ({}) }],
    ])('does nothing when there is %s', async (_label, snapshot) => {
        mockGet.mockResolvedValue(snapshot);
        const { revokeCalendarGrant } = await import('../calendarGrantRevoker.js');

        expect(await revokeCalendarGrant('uid-1')).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns false and warns (without the token) when Google rejects the revoke', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 400 });
        const { revokeCalendarGrant } = await import('../calendarGrantRevoker.js');

        expect(await revokeCalendarGrant('uid-1')).toBe(false);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockWarn.mock.calls)).not.toContain(REFRESH_TOKEN);
    });

    it.each([
        ['the network call fails', () => mockFetch.mockRejectedValue(new Error('offline'))],
        ['Firestore fails', () => mockGet.mockRejectedValue(new Error('firestore down'))],
    ])('never throws when %s', async (_label, arrange) => {
        arrange();
        const { revokeCalendarGrant } = await import('../calendarGrantRevoker.js');

        await expect(revokeCalendarGrant('uid-1')).resolves.toBe(false);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockWarn.mock.calls)).not.toContain(REFRESH_TOKEN);
    });
});
