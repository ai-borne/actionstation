/**
 * Calendar Events Cloud Functions
 * Server-side proxy for Google Calendar API — create, update, delete, list events.
 * Access tokens are retrieved server-side from Firestore; they never reach the client.
 *
 * Security layers (Firebase onCall — auth is verified automatically):
 *   1. Auth check (request.auth)
 *   2. User rate limit (Firestore-backed sliding window)
 *   3. Input size + format validation
 *   4. Security logging on every failure
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { checkRateLimit } from './utils/rateLimiter.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { CALENDAR_EVENTS_RATE_LIMIT } from './utils/securityConstants.js';
import { getCalendarAccessToken, CALENDAR_NOT_CONNECTED } from './utils/calendarTokenHelper.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';

const gclientId = defineSecret('GOOGLE_CLIENT_ID');
const gclientSecret = defineSecret('GOOGLE_CLIENT_SECRET');

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

type CalendarEventType = 'event' | 'reminder' | 'todo' | 'read';

interface CalendarEventMetadata {
    id: string; type: CalendarEventType; title: string; date: string;
    endDate?: string; notes?: string; status: 'synced'; syncedAt: number; calendarId: string;
}

/** Throw if eventId contains path-traversal or injection characters. */
function assertEventId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id.length > 128) {
        throw new HttpsError('invalid-argument', 'Invalid event ID');
    }
}

/** Convert intent date/time into Google Calendar start/end objects. */
function buildEventBody(title: string, date: string, endDate?: string, notes?: string) {
    const hasTime = date.includes('T');
    const start = hasTime ? { dateTime: new Date(date).toISOString() } : { date };
    let end: { dateTime?: string; date?: string };
    if (hasTime) {
        const endDt = endDate ? new Date(endDate) : (() => { const d = new Date(date); d.setHours(d.getHours() + 1); return d; })();
        end = { dateTime: endDt.toISOString() };
    } else {
        const endD = endDate ?? (() => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split('T')[0]; })();
        end = { date: endD };
    }
    return { summary: title, description: notes ?? '', start, end };
}

async function withToken<T>(uid: string, fn: (token: string) => Promise<T>): Promise<T> {
    if (!await checkRateLimit(uid, 'calendarEvents', CALENDAR_EVENTS_RATE_LIMIT)) {
        logSecurityEvent({
            type: SecurityEventType.RATE_LIMIT_VIOLATION,
            uid,
            endpoint: 'calendarEvents',
            message: 'Calendar events rate limit exceeded',
        });
        throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
    }
    try {
        const token = await getCalendarAccessToken(uid, gclientId.value(), gclientSecret.value());
        return await fn(token);
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err instanceof Error && err.message === CALENDAR_NOT_CONNECTED) {
            logSecurityEvent({
                type: SecurityEventType.AUTH_FAILURE,
                uid,
                endpoint: 'calendarEvents',
                message: 'Calendar not connected — REAUTH_REQUIRED',
            });
            throw new HttpsError('unauthenticated', 'REAUTH_REQUIRED');
        }
        logSecurityEvent({
            type: SecurityEventType.AUTH_FAILURE,
            uid,
            endpoint: 'calendarEvents',
            message: `Calendar token error: ${err instanceof Error ? err.message : 'unknown'}`,
        });
        throw new HttpsError('internal', err instanceof Error ? err.message : 'Calendar API error');
    }
}

/**
 * @param treatAsSuccess Status codes to resolve as `null` instead of throwing.
 *   Only pass this for operations where "already in the target state" is a
 *   real success — e.g. DELETE on an event Google has already removed (404/410).
 *   Left empty for create/update/list, where a 404 means a real error.
 */
async function gcalFetch<T>(
    token: string, path: string, init: RequestInit = {}, treatAsSuccess: readonly number[] = []
): Promise<T> {
    const res = await fetch(`${CALENDAR_API}${path}`, {
        ...init,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (res.status === 401 || res.status === 403) throw new HttpsError('unauthenticated', 'REAUTH_REQUIRED');
    if (res.status === 204) return null as T;
    if (treatAsSuccess.includes(res.status)) return null as T;
    if (!res.ok) throw new HttpsError('internal', 'Google Calendar API error');
    return (await res.json()) as T;
}

/** DELETE is idempotent: an event Google has already removed (404/410) counts as deleted. */
const DELETE_ALREADY_GONE = [404, 410] as const;

/** Create a Google Calendar event. */
export const calendarCreateEvent = onCall({ secrets: [...SECRETS], cors: ALLOWED_ORIGINS, enforceAppCheck: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');

    const { type, title, date, endDate, notes } = request.data as {
        type: CalendarEventType; title: string; date: string; endDate?: string; notes?: string;
    };
    if (!title || !date) throw new HttpsError('invalid-argument', 'title and date are required');

    return withToken<CalendarEventMetadata>(uid, async (token) => {
        const body = buildEventBody(title, date, endDate, notes);
        const data = await gcalFetch<{ id?: string }>(token, '/calendars/primary/events', {
            method: 'POST', body: JSON.stringify(body),
        });
        return { id: data.id ?? '', type, title, date, endDate, notes, status: 'synced', syncedAt: Date.now(), calendarId: 'primary' };
    });
});

/** Update an existing Google Calendar event. */
export const calendarUpdateEvent = onCall({ secrets: [...SECRETS], cors: ALLOWED_ORIGINS, enforceAppCheck: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');

    const { eventId, type, title, date, endDate, notes } = request.data as {
        eventId: string; type: CalendarEventType; title: string; date: string; endDate?: string; notes?: string;
    };
    assertEventId(eventId);
    if (!title || !date) throw new HttpsError('invalid-argument', 'title and date are required');

    return withToken<CalendarEventMetadata>(uid, async (token) => {
        const body = buildEventBody(title, date, endDate, notes);
        await gcalFetch(token, `/calendars/primary/events/${eventId}`, {
            method: 'PUT', body: JSON.stringify(body),
        });
        return { id: eventId, type, title, date, endDate, notes, status: 'synced', syncedAt: Date.now(), calendarId: 'primary' };
    });
});

/** Delete a Google Calendar event. */
export const calendarDeleteEvent = onCall({ secrets: [...SECRETS], cors: ALLOWED_ORIGINS, enforceAppCheck: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');

    const { eventId } = request.data as { eventId?: unknown };
    assertEventId(eventId);

    return withToken<null>(uid, async (token) => {
        await gcalFetch(token, `/calendars/primary/events/${eventId}`, { method: 'DELETE' }, DELETE_ALREADY_GONE);
        return null;
    });
});

interface GCalListItem { id?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }

/** List Google Calendar events within a time range. */
export const calendarListEvents = onCall({ secrets: [...SECRETS], cors: ALLOWED_ORIGINS, enforceAppCheck: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');

    const { startDate, endDate } = request.data as { startDate?: unknown; endDate?: unknown };
    if (typeof startDate !== 'string' || typeof endDate !== 'string') {
        throw new HttpsError('invalid-argument', 'startDate and endDate are required');
    }

    return withToken(uid, async (token) => {
        const q = new URLSearchParams({
            timeMin: new Date(startDate).toISOString(),
            timeMax: new Date(endDate).toISOString(),
            singleEvents: 'true', orderBy: 'startTime',
        });
        const data = await gcalFetch<{ items?: GCalListItem[] }>(token, `/calendars/primary/events?${q}`);
        return (data.items ?? []).map((item) => ({
            title: item.summary ?? 'Untitled Event',
            date: item.start?.dateTime ?? item.start?.date ?? '',
            endDate: item.end?.dateTime ?? item.end?.date,
        }));
    });
});
