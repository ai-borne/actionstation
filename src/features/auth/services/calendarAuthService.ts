/**
 * Calendar Auth Service - Google OAuth 2.0 Authorization Code flow
 * Replaces the GIS Token (implicit) flow with server-backed refresh tokens.
 *
 * Flow:
 *  1. connectGoogleCalendar() → redirects browser to Google OAuth consent screen
 *  2. Google redirects back to /auth/calendar/callback with an authorization code
 *  3. CalendarCallback component calls handleCalendarCallback(code, state)
 *  4. handleCalendarCallback calls the exchangeCalendarCode Cloud Function
 *  5. Cloud Function stores refresh_token in Firestore; returns { connected: true }
 *  6. setCalendarConnected(true) + CONNECTED_KEY flag in localStorage
 *
 * No access tokens are stored client-side. All Calendar API calls go through
 * calendarCreateEvent / calendarListEvents / etc. Cloud Functions.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '@/config/firebase';
import { useAuthStore } from '../stores/authStore';
import { logger } from '@/shared/services/logger';

/** localStorage key: boolean flag indicating the user has connected their calendar. */
export const CONNECTED_KEY = 'actionstation_calendar_connected';

/** Narrowest scope that covers our use: events on calendars the user owns (we only touch their primary one). */
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Returns true if the user currently has a connected Google Calendar. */
export function isCalendarConnected(): boolean {
    return localStorage.getItem(CONNECTED_KEY) === 'true';
}

/** Generate a cryptographically random state string for CSRF protection. */
function generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Initiate the OAuth Authorization Code flow.
 * Saves CSRF state in sessionStorage, then redirects to Google consent screen.
 * Returns false immediately — the browser navigates away before this resolves.
 */
export function connectGoogleCalendar(): boolean {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !auth.currentUser) return false;

    const state = generateState();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_return_to', window.location.pathname);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${window.location.origin}/auth/calendar/callback`,
        response_type: 'code',
        scope: CALENDAR_SCOPE,
        access_type: 'offline',   // request refresh token
        prompt: 'consent',        // always show consent to get refresh token
        state,
    });

    window.location.href = `${GOOGLE_AUTH_URL}?${params}`;
    return false; // Never reached — satisfies type-checker
}

/**
 * Complete the OAuth flow after Google redirects back.
 * Validates CSRF state, then calls the exchangeCalendarCode Cloud Function.
 * On success sets the CONNECTED_KEY flag and updates the auth store.
 */
export async function handleCalendarCallback(
    code: string,
    state: string,
): Promise<boolean> {
    const storedState = sessionStorage.getItem('oauth_state');
    if (!storedState || state !== storedState) {
        logger.warn('[CalendarAuth] CSRF state mismatch — aborting callback');
        sessionStorage.removeItem('oauth_state');
        return false;
    }
    sessionStorage.removeItem('oauth_state');

    try {
        const redirectUri = `${window.location.origin}/auth/calendar/callback`;
        const fn = httpsCallable<{ code: string; redirectUri: string }, { connected: boolean }>(
            getFunctions(),
            'exchangeCalendarCode',
        );
        const result = await fn({ code, redirectUri });
        if (result.data.connected) {
            localStorage.setItem(CONNECTED_KEY, 'true');
            useAuthStore.getState().setCalendarConnected(true);
            return true;
        }
        return false;
    } catch (err) {
        logger.warn('[CalendarAuth] exchangeCalendarCode failed', err as Error);
        return false;
    }
}

/** Clear the local "connected" flag and the auth-store state. */
function clearLocalConnection(): void {
    localStorage.removeItem(CONNECTED_KEY);
    useAuthStore.getState().setCalendarConnected(false);
}

/** Ask the server to revoke the grant at Google and delete the stored token. */
function callDisconnectFunction(): Promise<unknown> {
    return httpsCallable(getFunctions(), 'disconnectCalendar')({});
}

/**
 * Disconnect Google Calendar automatically (e.g. the Google session expired): local state is
 * cleared immediately and the server cleanup is fire-and-forget.
 */
export function disconnectGoogleCalendar(): boolean {
    if (!auth.currentUser) return false;

    clearLocalConnection();
    callDisconnectFunction().catch((err: unknown) => {
        logger.warn('[CalendarAuth] disconnectCalendar Cloud Function failed', err as Error);
    });

    return true;
}

/**
 * User-initiated disconnect: waits for the server, and only when it confirms clears the local state.
 * Returns false (staying connected, so the user can retry) if the server call fails.
 */
export async function disconnectGoogleCalendarConfirmed(): Promise<boolean> {
    if (!auth.currentUser) return false;

    try {
        await callDisconnectFunction();
    } catch (err) {
        logger.warn('[CalendarAuth] disconnectCalendar Cloud Function failed', err as Error);
        return false;
    }
    clearLocalConnection();
    return true;
}

/**
 * Restore isCalendarConnected state from the localStorage flag.
 * Called on auth state change so the store reflects the persisted connection.
 */
export function checkCalendarConnection(): void {
    if (!auth.currentUser) return;
    useAuthStore.getState().setCalendarConnected(isCalendarConnected());
}
