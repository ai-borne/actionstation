/**
 * calendarEvents Cloud Function Tests
 * Tests calendarCreateEvent, calendarUpdateEvent, calendarDeleteEvent, calendarListEvents.
 *
 * Uses the same mock-onCall technique as onNodeDeleted.test.ts:
 *   onCall(_opts, handler) => handler   — returns the inner handler directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (must come before imports) ---

vi.mock('firebase-functions/v2/https', () => {
    // Class must be defined inside the factory — vi.mock is hoisted, top-level vars are not.
    class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    }
    return {
        onCall: (_opts: unknown, handler: unknown) => handler,
        HttpsError,
    };
});

vi.mock('firebase-functions/params', () => ({
    defineSecret: vi.fn((name: string) => ({ value: () => `mock-${name.toLowerCase()}` })),
}));

vi.mock('../utils/rateLimiter.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/securityLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    SecurityEventType: { RATE_LIMIT_VIOLATION: 'RATE_LIMIT_VIOLATION', AUTH_FAILURE: 'AUTH_FAILURE' },
}));

vi.mock('../utils/calendarTokenHelper.js', () => ({
    getCalendarAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
    CALENDAR_NOT_CONNECTED: 'CALENDAR_NOT_CONNECTED',
}));

// vi.mock calls are hoisted by Vite/vitest at transform time, so these imports
// intentionally appear after the mock declarations above — the runtime order
// is correct after hoisting. The import-x/first rule does not apply here
// (import-x is not configured for this package).
import {
    calendarCreateEvent,
    calendarUpdateEvent,
    calendarDeleteEvent,
    calendarListEvents,
} from '../calendarEvents.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { getCalendarAccessToken } from '../utils/calendarTokenHelper.js';

const AUTHED = { auth: { uid: 'uid-1' } };
const NO_AUTH = { auth: undefined };

// Typed helper so we don't repeat casts everywhere
function call<T = unknown>(fn: unknown, req: Record<string, unknown>): Promise<T> {
    return (fn as (r: unknown) => Promise<T>)(req);
}

const originalFetch = globalThis.fetch;

describe('calendarCreateEvent', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('throws unauthenticated when no auth', async () => {
        await expect(call(calendarCreateEvent, { ...NO_AUTH, data: { title: 'T', date: '2025-01-01' } }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('throws resource-exhausted when rate limited', async () => {
        vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
        await expect(call(calendarCreateEvent, { ...AUTHED, data: { title: 'T', date: '2025-01-01' } }))
            .rejects.toMatchObject({ code: 'resource-exhausted' });
    });

    it('throws invalid-argument when title is missing', async () => {
        await expect(call(calendarCreateEvent, { ...AUTHED, data: { date: '2025-01-01' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('throws invalid-argument when date is missing', async () => {
        await expect(call(calendarCreateEvent, { ...AUTHED, data: { title: 'Meeting' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('creates event and returns metadata on success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200,
            json: () => Promise.resolve({ id: 'gcal-event-123' }),
        }));
        const result = await call<{ id: string; status: string }>(calendarCreateEvent, {
            ...AUTHED,
            data: { type: 'event', title: 'Team Meeting', date: '2025-06-15', notes: 'Bring slides' },
        });
        expect(result.id).toBe('gcal-event-123');
        expect(result.status).toBe('synced');
    });

    it('passes Bearer token from getCalendarAccessToken to Google API', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true, status: 200, json: () => Promise.resolve({ id: 'x' }),
        });
        vi.stubGlobal('fetch', mockFetch);
        await call(calendarCreateEvent, {
            ...AUTHED,
            data: { type: 'event', title: 'T', date: '2025-01-01' },
        });
        const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer mock-access-token');
    });

    it('throws unauthenticated (REAUTH_REQUIRED) when calendar not connected', async () => {
        vi.mocked(getCalendarAccessToken).mockRejectedValueOnce(new Error('CALENDAR_NOT_CONNECTED'));
        await expect(call(calendarCreateEvent, {
            ...AUTHED, data: { title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('throws unauthenticated when Google API returns 401', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
        await expect(call(calendarCreateEvent, {
            ...AUTHED, data: { title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'unauthenticated' });
    });
});

describe('calendarUpdateEvent', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('throws unauthenticated when no auth', async () => {
        await expect(call(calendarUpdateEvent, {
            ...NO_AUTH, data: { eventId: 'abc', title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('throws invalid-argument for path-traversal eventId', async () => {
        await expect(call(calendarUpdateEvent, {
            ...AUTHED, data: { eventId: '../etc/passwd', title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('throws invalid-argument for eventId with slashes', async () => {
        await expect(call(calendarUpdateEvent, {
            ...AUTHED, data: { eventId: 'a/b', title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('throws invalid-argument for overly long eventId', async () => {
        await expect(call(calendarUpdateEvent, {
            ...AUTHED, data: { eventId: 'a'.repeat(129), title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('updates event and returns metadata on success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) }));
        const result = await call<{ id: string; title: string; status: string }>(calendarUpdateEvent, {
            ...AUTHED,
            data: { eventId: 'valid-id', type: 'event', title: 'Updated', date: '2025-07-01' },
        });
        expect(result.id).toBe('valid-id');
        expect(result.title).toBe('Updated');
        expect(result.status).toBe('synced');
    });

    it('still throws internal on 404 — update is not delete, a missing event is a real error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        await expect(call(calendarUpdateEvent, {
            ...AUTHED, data: { eventId: 'valid-id', title: 'T', date: '2025-01-01' },
        })).rejects.toMatchObject({ code: 'internal' });
    });
});

describe('calendarDeleteEvent', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('throws unauthenticated when no auth', async () => {
        await expect(call(calendarDeleteEvent, { ...NO_AUTH, data: { eventId: 'abc' } }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('throws invalid-argument for invalid eventId', async () => {
        await expect(call(calendarDeleteEvent, { ...AUTHED, data: { eventId: '<script>' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('returns null on successful delete (204 No Content)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
        const result = await call(calendarDeleteEvent, { ...AUTHED, data: { eventId: 'valid-id' } });
        expect(result).toBeNull();
    });

    it('returns null (treats as success) when Google returns 404 — event already gone', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        const result = await call(calendarDeleteEvent, { ...AUTHED, data: { eventId: 'valid-id' } });
        expect(result).toBeNull();
    });

    it('returns null (treats as success) when Google returns 410 — event already gone', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));
        const result = await call(calendarDeleteEvent, { ...AUTHED, data: { eventId: 'valid-id' } });
        expect(result).toBeNull();
    });

    it('still throws internal on other Google errors (e.g. 500)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        await expect(call(calendarDeleteEvent, { ...AUTHED, data: { eventId: 'valid-id' } }))
            .rejects.toMatchObject({ code: 'internal' });
    });

    it('still throws unauthenticated on 401/403 from Google', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
        await expect(call(calendarDeleteEvent, { ...AUTHED, data: { eventId: 'valid-id' } }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });
});

describe('calendarListEvents', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('throws unauthenticated when no auth', async () => {
        await expect(call(calendarListEvents, {
            ...NO_AUTH, data: { startDate: '2025-01-01', endDate: '2025-01-31' },
        })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('throws invalid-argument when startDate is missing', async () => {
        await expect(call(calendarListEvents, { ...AUTHED, data: { endDate: '2025-01-31' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('throws invalid-argument when endDate is missing', async () => {
        await expect(call(calendarListEvents, { ...AUTHED, data: { startDate: '2025-01-01' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('returns mapped event list on success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200,
            json: () => Promise.resolve({
                items: [
                    { id: 'e1', summary: 'Standup', start: { dateTime: '2025-01-10T09:00:00Z' }, end: { dateTime: '2025-01-10T09:30:00Z' } },
                    { id: 'e2', summary: 'Review', start: { date: '2025-01-15' }, end: { date: '2025-01-16' } },
                ],
            }),
        }));
        const result = await call<{ title: string; date: string }[]>(calendarListEvents, {
            ...AUTHED, data: { startDate: '2025-01-01', endDate: '2025-01-31' },
        });
        expect(result).toHaveLength(2);
        expect(result[0].title).toBe('Standup');
        expect(result[1].title).toBe('Review');
    });

    it('returns empty array when items is missing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200, json: () => Promise.resolve({}),
        }));
        const result = await call<unknown[]>(calendarListEvents, {
            ...AUTHED, data: { startDate: '2025-01-01', endDate: '2025-01-31' },
        });
        expect(result).toEqual([]);
    });
});
