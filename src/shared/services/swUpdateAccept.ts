/**
 * swUpdateAccept — applies a pending PWA update and guarantees the page reloads.
 *
 * With registerType 'prompt', the library's updateSW(true) only messages the *waiting*
 * worker; the reload comes from a 'controlling' listener. If no worker is waiting any
 * more (another tab already activated it) nothing would ever happen, so the
 * "Update now" button looked dead. Reload directly in that case, and keep a timed
 * fallback for when the message is sent but 'controlling' never fires.
 */
import { logger } from '@/shared/services/logger';

export const SW_RELOAD_FALLBACK_MS = 3_000;

type UpdateSw = (reloadPage?: boolean) => Promise<void>;

export function applySwUpdate(
    updateSw: UpdateSw | null,
    registration: ServiceWorkerRegistration | null,
): void {
    const reload = (): void => window.location.reload();
    const hasNoWaitingWorker = registration !== null && !registration.waiting;
    if (!updateSw || hasNoWaitingWorker) {
        reload();
        return;
    }
    setTimeout(reload, SW_RELOAD_FALLBACK_MS);
    updateSw(true).catch((err: unknown) => {
        logger.error('[sw] applying update failed', err);
        reload();
    });
}
