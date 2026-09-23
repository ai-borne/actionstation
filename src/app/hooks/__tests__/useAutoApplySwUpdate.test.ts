/**
 * useAutoApplySwUpdate Tests
 * Signed-out visitors (landing, /login) get a new app version immediately;
 * signed-in users keep the "Update now" prompt so an open canvas never reloads.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAutoApplySwUpdate, AUTO_APPLY_COOLDOWN_MS } from '../useAutoApplySwUpdate';
import type { SwRegistrationResult } from '@/shared/hooks/useSwRegistration';

const auth = vi.hoisted(() => ({ state: { isAuthenticated: false, isLoading: false } }));

vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: (selector: (s: typeof auth.state) => unknown) => selector(auth.state),
}));

function registration(needRefresh: boolean, acceptUpdate = vi.fn()): SwRegistrationResult {
    return { needRefresh, offlineReady: false, acceptUpdate, dismissUpdate: vi.fn() };
}

describe('useAutoApplySwUpdate', () => {
    beforeEach(() => {
        auth.state = { isAuthenticated: false, isLoading: false };
        sessionStorage.clear();
        vi.useRealTimers();
    });

    it('applies a waiting update immediately for a signed-out visitor', () => {
        const reg = registration(true);
        renderHook(() => useAutoApplySwUpdate(reg));
        expect(reg.acceptUpdate).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no update is waiting', () => {
        const reg = registration(false);
        renderHook(() => useAutoApplySwUpdate(reg));
        expect(reg.acceptUpdate).not.toHaveBeenCalled();
    });

    it('never auto-applies for a signed-in user (keeps the prompt)', () => {
        auth.state = { isAuthenticated: true, isLoading: false };
        const reg = registration(true);
        renderHook(() => useAutoApplySwUpdate(reg));
        expect(reg.acceptUpdate).not.toHaveBeenCalled();
    });

    it('waits while auth is resolving or a sign-in is in progress', () => {
        auth.state = { isAuthenticated: false, isLoading: true };
        const reg = registration(true);
        renderHook(() => useAutoApplySwUpdate(reg));
        expect(reg.acceptUpdate).not.toHaveBeenCalled();
    });

    it('applies once auth settles to signed out', () => {
        auth.state = { isAuthenticated: false, isLoading: true };
        const reg = registration(true);
        const { rerender } = renderHook(() => useAutoApplySwUpdate(reg));

        auth.state = { isAuthenticated: false, isLoading: false };
        rerender();

        expect(reg.acceptUpdate).toHaveBeenCalledTimes(1);
    });

    it('applies an update that is already pending when the user signs out', () => {
        auth.state = { isAuthenticated: true, isLoading: false };
        const reg = registration(true);
        const { rerender } = renderHook(() => useAutoApplySwUpdate(reg));
        expect(reg.acceptUpdate).not.toHaveBeenCalled();

        auth.state = { isAuthenticated: false, isLoading: false };
        rerender();

        expect(reg.acceptUpdate).toHaveBeenCalledTimes(1);
    });

    it('does not auto-apply again within the cooldown (no reload loop if activation fails)', () => {
        vi.useFakeTimers();
        const first = registration(true);
        renderHook(() => useAutoApplySwUpdate(first)).unmount();
        expect(first.acceptUpdate).toHaveBeenCalledTimes(1);

        // Simulates the reloaded page still seeing a waiting worker
        vi.advanceTimersByTime(AUTO_APPLY_COOLDOWN_MS - 1);
        const second = registration(true);
        renderHook(() => useAutoApplySwUpdate(second));
        expect(second.acceptUpdate).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        const third = registration(true);
        renderHook(() => useAutoApplySwUpdate(third));
        expect(third.acceptUpdate).toHaveBeenCalledTimes(1);
    });

    it('still applies when sessionStorage is unavailable', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        const reg = registration(true);

        renderHook(() => useAutoApplySwUpdate(reg));

        expect(reg.acceptUpdate).toHaveBeenCalledTimes(1);
        getItem.mockRestore();
        setItem.mockRestore();
    });
});

describe('App wiring', () => {
    it('App passes its SW registration to useAutoApplySwUpdate', async () => {
        const { readFileSync } = await import('fs');
        const { resolve } = await import('path');
        const source = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf-8');
        expect(source).toMatch(/useAutoApplySwUpdate\(swRegistration\)/);
    });
});
