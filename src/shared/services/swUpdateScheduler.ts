/**
 * swUpdateScheduler — keeps long-lived tabs asking for a new service worker.
 *
 * The browser only looks for a new sw.js on navigation, so a tab left open for days never
 * shows the "new version available" prompt. Until the user accepts it they keep the old
 * page shell and its old Content-Security-Policy header (cached with the shell), so a CSP
 * fix cannot reach them. Checking hourly and whenever the tab becomes visible makes the
 * prompt appear promptly.
 */
import { logger } from '@/shared/services/logger';

export const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Start periodic update checks; returns a function that stops them. */
export function scheduleSwUpdateChecks(registration: ServiceWorkerRegistration): () => void {
    const check = (): void => {
        registration.update().catch((err: unknown) => {
            logger.warn('[sw] update check failed', err);
        });
    };
    const onVisibility = (): void => {
        if (document.visibilityState === 'visible') check();
    };

    const timer = setInterval(check, SW_UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
