/**
 * applySwUpdate — "Update now" must always end in a reload, even when there is
 * no waiting worker to skip (already activated from another tab).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applySwUpdate, SW_RELOAD_FALLBACK_MS } from '../swUpdateAccept';

const mockLoggerError = vi.fn();
vi.mock('@/shared/services/logger', () => ({
    logger: { error: (...args: unknown[]) => mockLoggerError(...args), warn: vi.fn() },
}));

const reload = vi.fn();
const reg = (waiting: unknown) => ({ waiting }) as unknown as ServiceWorkerRegistration;

describe('applySwUpdate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.stubGlobal('location', { reload });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reloads immediately when the registration has no waiting worker', () => {
        const updateSw = vi.fn().mockResolvedValue(undefined);
        applySwUpdate(updateSw, reg(null));
        expect(reload).toHaveBeenCalledTimes(1);
        expect(updateSw).not.toHaveBeenCalled();
    });

    it('reloads immediately when the SW updater is not ready yet', () => {
        applySwUpdate(null, reg({}));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('sends skip-waiting when a worker is waiting, without reloading straight away', () => {
        const updateSw = vi.fn().mockResolvedValue(undefined);
        applySwUpdate(updateSw, reg({}));
        expect(updateSw).toHaveBeenCalledWith(true);
        expect(reload).not.toHaveBeenCalled();
    });

    it('falls back to reload if the controlling event never reloads the page', () => {
        applySwUpdate(vi.fn().mockResolvedValue(undefined), reg({}));
        vi.advanceTimersByTime(SW_RELOAD_FALLBACK_MS - 1);
        expect(reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('still calls updateSw when the registration is unknown', () => {
        const updateSw = vi.fn().mockResolvedValue(undefined);
        applySwUpdate(updateSw, null);
        expect(updateSw).toHaveBeenCalledWith(true);
    });

    it('logs and reloads when updateSw rejects', async () => {
        const err = new Error('boom');
        applySwUpdate(vi.fn().mockRejectedValue(err), reg({}));
        await vi.advanceTimersByTimeAsync(0);
        expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), err);
        expect(reload).toHaveBeenCalled();
    });
});
