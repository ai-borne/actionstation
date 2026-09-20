/**
 * swUpdateScheduler Tests — long-lived tabs re-check for a new service worker
 * (hourly and when the tab becomes visible) so the "new version" prompt, and any
 * CSP/header fix that ships with it, reaches users without a manual reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleSwUpdateChecks, SW_UPDATE_CHECK_INTERVAL_MS } from '../swUpdateScheduler';

const mockWarn = vi.fn();
vi.mock('@/shared/services/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a) } }));

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('scheduleSwUpdateChecks', () => {
    const update = vi.fn();
    const registration = { update } as unknown as ServiceWorkerRegistration;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        update.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        setVisibility('visible');
    });

    it('checks hourly, and not before the interval elapses', () => {
        const stop = scheduleSwUpdateChecks(registration);
        vi.advanceTimersByTime(SW_UPDATE_CHECK_INTERVAL_MS - 1);
        expect(update).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(update).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(SW_UPDATE_CHECK_INTERVAL_MS);
        expect(update).toHaveBeenCalledTimes(2);
        stop();
    });

    it('checks when the tab becomes visible, not when it is hidden', () => {
        const stop = scheduleSwUpdateChecks(registration);
        setVisibility('hidden');
        expect(update).not.toHaveBeenCalled();
        setVisibility('visible');
        expect(update).toHaveBeenCalledTimes(1);
        stop();
    });

    it('stops checking after cleanup', () => {
        const stop = scheduleSwUpdateChecks(registration);
        stop();
        vi.advanceTimersByTime(SW_UPDATE_CHECK_INTERVAL_MS * 2);
        setVisibility('visible');
        expect(update).not.toHaveBeenCalled();
    });

    it('logs and survives a failed check (offline)', async () => {
        update.mockRejectedValue(new Error('offline'));
        const stop = scheduleSwUpdateChecks(registration);
        vi.advanceTimersByTime(SW_UPDATE_CHECK_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(0);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        stop();
    });
});
