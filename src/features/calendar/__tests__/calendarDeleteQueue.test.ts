import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDeleteQueue } from '../services/calendarDeleteQueue';
import type { SyncOutcome } from '../services/calendarNodeOps';

const OK: SyncOutcome = { isOk: true, isReauth: false, message: null };
const FAIL: SyncOutcome = { isOk: false, isReauth: false, message: 'x' };
const REAUTH: SyncOutcome = { isOk: false, isReauth: true, message: 'expired' };
const GRACE = 6000;

describe('calendarDeleteQueue', () => {
    let run: ReturnType<typeof vi.fn<(id: string) => Promise<SyncOutcome>>>;
    let onFailed: ReturnType<typeof vi.fn<(count: number) => void>>;
    const make = () => createDeleteQueue({ graceMs: GRACE, run, onFailed });

    beforeEach(() => {
        vi.useFakeTimers();
        run = vi.fn<(id: string) => Promise<SyncOutcome>>().mockResolvedValue(OK);
        onFailed = vi.fn<(count: number) => void>();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('waits for the grace window before deleting', async () => {
        const q = make();
        q.schedule(['a']);
        await vi.advanceTimersByTimeAsync(GRACE - 1);
        expect(run).not.toHaveBeenCalled();
        expect(q.isPending('a')).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledWith('a');
        expect(q.isPending('a')).toBe(false);
    });

    it('cancel inside the window prevents the delete and reports it was pending', async () => {
        const q = make();
        q.schedule(['a', 'b']);
        expect(q.cancel('a')).toBe(true);
        expect(q.cancel('zzz')).toBe(false);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('b');
    });

    it('cancelling every id of a batch clears its timer', async () => {
        const q = make();
        q.schedule(['a']);
        q.cancel('a');
        await vi.advanceTimersByTimeAsync(GRACE * 2);
        expect(run).not.toHaveBeenCalled();
    });

    it('remembers deleted ids so a later restore can be detected', async () => {
        const q = make();
        q.schedule(['a']);
        expect(q.wasDeleted('a')).toBe(false);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(q.wasDeleted('a')).toBe(true);
    });

    it('does not remember an id whose delete failed (the event still exists)', async () => {
        run.mockResolvedValue(FAIL);
        const q = make();
        q.schedule(['a']);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(q.wasDeleted('a')).toBe(false);
    });

    it('deletes a batch sequentially and reports ONE failure count', async () => {
        run.mockImplementation((id) => Promise.resolve(id === 'ok' ? OK : FAIL));
        const q = make();
        q.schedule(['a', 'ok', 'b']);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(run).toHaveBeenCalledTimes(3);
        expect(onFailed).toHaveBeenCalledTimes(1);
        expect(onFailed).toHaveBeenCalledWith(2);
    });

    it('reports nothing when every delete succeeds', async () => {
        const q = make();
        q.schedule(['a', 'b']);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(onFailed).not.toHaveBeenCalled();
    });

    it('stops the batch on REAUTH and does not add a second failure notice', async () => {
        run.mockResolvedValue(REAUTH);
        const q = make();
        q.schedule(['a', 'b', 'c']);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(run).toHaveBeenCalledTimes(1);
        expect(onFailed).not.toHaveBeenCalled();
    });

    it('flushNow runs pending deletes immediately', async () => {
        const q = make();
        q.schedule(['a']);
        await q.flushNow();
        expect(run).toHaveBeenCalledWith('a');
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('dispose cancels timers without deleting', async () => {
        const q = make();
        q.schedule(['a']);
        q.dispose();
        await vi.advanceTimersByTimeAsync(GRACE * 2);
        expect(run).not.toHaveBeenCalled();
    });

    it('ignores an empty schedule', async () => {
        const q = make();
        q.schedule([]);
        await vi.advanceTimersByTimeAsync(GRACE);
        expect(run).not.toHaveBeenCalled();
    });
});
