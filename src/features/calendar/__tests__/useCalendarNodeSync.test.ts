import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const stop = vi.fn();
vi.mock('../services/calendarSyncController', () => ({
    startCalendarSync: vi.fn(() => stop),
}));

// eslint-disable-next-line import-x/first
import { startCalendarSync } from '../services/calendarSyncController';
// eslint-disable-next-line import-x/first
import { useCalendarNodeSync } from '../hooks/useCalendarNodeSync';

describe('useCalendarNodeSync', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('starts the background calendar sync on mount', () => {
        renderHook(() => { useCalendarNodeSync(); });
        expect(startCalendarSync).toHaveBeenCalledTimes(1);
    });

    it('stops it on unmount', () => {
        const { unmount } = renderHook(() => { useCalendarNodeSync(); });
        expect(stop).not.toHaveBeenCalled();
        unmount();
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('does not restart across re-renders', () => {
        const { rerender } = renderHook(() => { useCalendarNodeSync(); });
        rerender();
        rerender();
        expect(startCalendarSync).toHaveBeenCalledTimes(1);
    });
});
