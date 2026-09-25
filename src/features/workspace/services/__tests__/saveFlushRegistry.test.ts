/**
 * saveFlushRegistry: lets code outside the autosave hook (the workspace switcher)
 * save the workspace being left, without touching another workspace's state.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerSaveFlush, flushWorkspaceSave } from '../saveFlushRegistry';

describe('saveFlushRegistry', () => {
    it('runs the flush registered for that workspace and returns its result', async () => {
        const flush = vi.fn().mockResolvedValue(true);
        const unregister = registerSaveFlush('ws-A', flush);

        await expect(flushWorkspaceSave('ws-A')).resolves.toBe(true);
        expect(flush).toHaveBeenCalledTimes(1);
        unregister();
    });

    it('returns false without running anything when another workspace is registered', async () => {
        const flush = vi.fn().mockResolvedValue(true);
        const unregister = registerSaveFlush('ws-A', flush);

        await expect(flushWorkspaceSave('ws-B')).resolves.toBe(false);
        expect(flush).not.toHaveBeenCalled();
        unregister();
    });

    it('returns false after unregistering', async () => {
        const unregister = registerSaveFlush('ws-A', vi.fn().mockResolvedValue(true));
        unregister();

        await expect(flushWorkspaceSave('ws-A')).resolves.toBe(false);
    });

    it('keeps the newer registration when an older one unregisters late', async () => {
        const first = vi.fn().mockResolvedValue(true);
        const second = vi.fn().mockResolvedValue(true);
        const unregisterFirst = registerSaveFlush('ws-A', first);
        const unregisterSecond = registerSaveFlush('ws-A', second);
        unregisterFirst();

        await flushWorkspaceSave('ws-A');
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
        unregisterSecond();
    });
});
