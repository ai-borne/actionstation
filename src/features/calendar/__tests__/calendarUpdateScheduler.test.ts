import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createUpdateScheduler } from '../services/calendarUpdateScheduler';
import type { SyncedEventField } from '../policy/calendarSyncPolicy';

const DEBOUNCE = 2000;

describe('calendarUpdateScheduler', () => {
    let flush: ReturnType<typeof vi.fn<(nodeId: string, fields: readonly SyncedEventField[]) => void>>;
    const make = () => createUpdateScheduler({ debounceMs: DEBOUNCE, flush });

    beforeEach(() => {
        vi.useFakeTimers();
        flush = vi.fn<(nodeId: string, fields: readonly SyncedEventField[]) => void>();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('flushes once after the quiet period', () => {
        const s = make();
        s.schedule('n1', ['title']);
        vi.advanceTimersByTime(DEBOUNCE - 1);
        expect(flush).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(flush).toHaveBeenCalledWith('n1', ['title']);
    });

    it('restarts the timer on every new edit and merges the dirty fields', () => {
        const s = make();
        s.schedule('n1', ['title']);
        vi.advanceTimersByTime(DEBOUNCE - 1);
        s.schedule('n1', ['notes']);
        vi.advanceTimersByTime(DEBOUNCE - 1);
        expect(flush).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(flush).toHaveBeenCalledTimes(1);
        expect(flush).toHaveBeenCalledWith('n1', ['title', 'notes']);
    });

    it('keeps nodes independent', () => {
        const s = make();
        s.schedule('n1', ['title']);
        s.schedule('n2', ['notes']);
        vi.advanceTimersByTime(DEBOUNCE);
        expect(flush).toHaveBeenCalledWith('n1', ['title']);
        expect(flush).toHaveBeenCalledWith('n2', ['notes']);
    });

    it('cancel drops a node\'s pending update', () => {
        const s = make();
        s.schedule('n1', ['title']);
        s.cancel('n1');
        vi.advanceTimersByTime(DEBOUNCE * 2);
        expect(flush).not.toHaveBeenCalled();
    });

    it('starts from a clean field set after a flush', () => {
        const s = make();
        s.schedule('n1', ['title']);
        vi.advanceTimersByTime(DEBOUNCE);
        s.schedule('n1', ['notes']);
        vi.advanceTimersByTime(DEBOUNCE);
        expect(flush).toHaveBeenLastCalledWith('n1', ['notes']);
    });

    it('flushNow flushes everything pending immediately', () => {
        const s = make();
        s.schedule('n1', ['title']);
        s.flushNow();
        expect(flush).toHaveBeenCalledWith('n1', ['title']);
        vi.advanceTimersByTime(DEBOUNCE);
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('dispose cancels everything', () => {
        const s = make();
        s.schedule('n1', ['title']);
        s.dispose();
        vi.advanceTimersByTime(DEBOUNCE * 2);
        expect(flush).not.toHaveBeenCalled();
    });
});
