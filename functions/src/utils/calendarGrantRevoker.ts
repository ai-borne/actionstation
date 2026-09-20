/**
 * Revokes a user's Google Calendar grant at Google.
 *
 * Disconnecting Calendar or deleting the account removes our copy of the refresh token; without a
 * revoke the app would stay listed under the user's Google Account permissions. Google's revoke
 * endpoint needs only the token (no client secret). Best effort: this never throws, so a Google
 * outage cannot block a disconnect or an account deletion, and the token is never logged.
 */
import { logger } from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const REVOKE_TIMEOUT_MS = 5_000;

/** Returns true only when Google confirmed the revoke; false when there was nothing to revoke or it failed. */
export async function revokeCalendarGrant(uid: string): Promise<boolean> {
    try {
        const snapshot = await getFirestore()
            .collection('users').doc(uid)
            .collection('integrations').doc('calendar')
            .get();
        const refreshToken = snapshot.exists ? snapshot.data()?.refreshToken : undefined;
        if (typeof refreshToken !== 'string' || refreshToken === '') return false;

        const response = await fetch(REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refreshToken }).toString(),
            signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
        });
        if (!response.ok) {
            logger.warn('Calendar grant revoke was rejected by Google', { uid, status: response.status });
            return false;
        }
        return true;
    } catch (err) {
        logger.warn('Calendar grant revoke failed', { uid, error: err instanceof Error ? err.message : 'unknown' });
        return false;
    }
}
