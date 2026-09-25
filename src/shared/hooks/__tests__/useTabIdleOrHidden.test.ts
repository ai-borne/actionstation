import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTabIdleOrHidden, TAB_IDLE_MS } from '../useTabIdleOrHidden';

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('useTabIdleOrHidden', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setVisibility('visible');
    });
    afterEach(() => vi.useRealTimers());

    it('is false for a visible, active tab', () => {
        const { result } = renderHook(() => useTabIdleOrHidden());
        expect(result.current).toBe(false);
    });

    it('is true when the tab is hidden and false again when visible', () => {
        const { result } = renderHook(() => useTabIdleOrHidden());
        act(() => setVisibility('hidden'));
        expect(result.current).toBe(true);
        act(() => setVisibility('visible'));
        expect(result.current).toBe(false);
    });

    it('is true after the idle threshold with no input', () => {
        const { result } = renderHook(() => useTabIdleOrHidden());
        act(() => { vi.advanceTimersByTime(TAB_IDLE_MS); });
        expect(result.current).toBe(true);
    });

    it('input resets the idle timer and clears idle state', () => {
        const { result } = renderHook(() => useTabIdleOrHidden());
        act(() => { vi.advanceTimersByTime(TAB_IDLE_MS - 1); });
        act(() => { window.dispatchEvent(new Event('keydown')); });
        act(() => { vi.advanceTimersByTime(TAB_IDLE_MS - 1); });
        expect(result.current).toBe(false);

        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current).toBe(true);
        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        expect(result.current).toBe(false);
    });

    it('starts true when the tab is already hidden', () => {
        setVisibility('hidden');
        const { result } = renderHook(() => useTabIdleOrHidden());
        expect(result.current).toBe(true);
    });

    it('removes listeners and timers on unmount', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useTabIdleOrHidden());
        unmount();
        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
        remove.mockRestore();
    });
});
