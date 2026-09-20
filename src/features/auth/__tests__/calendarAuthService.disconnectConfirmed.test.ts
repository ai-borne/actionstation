/**
 * disconnectGoogleCalendarConfirmed (checklist A10c) — the user-initiated disconnect.
 * Unlike the automatic, fire-and-forget disconnect on an expired session, this one WAITS for the
 * server (which revokes the grant at Google and deletes the stored token) and only then clears the
 * local "connected" state. If the server call fails the user stays connected and can retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auth } from '@/config/firebase';
import { disconnectGoogleCalendarConfirmed, CONNECTED_KEY } from '../services/calendarAuthService';

vi.mock('@/config/firebase', () => ({
    auth: { currentUser: { uid: 'test-uid' } },
}));

const mockCallable = vi.fn();
const mockHttpsCallable = vi.fn((..._args: unknown[]) => mockCallable);
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

const mockSetCalendarConnected = vi.fn();
vi.mock('../stores/authStore', () => ({
    useAuthStore: { getState: () => ({ setCalendarConnected: mockSetCalendarConnected }) },
}));

const mockWarn = vi.fn();
vi.mock('@/shared/services/logger', () => ({
    logger: { warn: (...args: unknown[]) => mockWarn(...args), error: vi.fn() },
}));

describe('disconnectGoogleCalendarConfirmed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        localStorage.setItem(CONNECTED_KEY, 'true');
        mockCallable.mockResolvedValue({ data: { disconnected: true } });
    });

    it('calls the disconnectCalendar function, then clears local state and returns true', async () => {
        const result = await disconnectGoogleCalendarConfirmed();

        expect(result).toBe(true);
        expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'disconnectCalendar');
        expect(mockCallable).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
        expect(mockSetCalendarConnected).toHaveBeenCalledWith(false);
    });

    it('does not clear local state until the server has answered', async () => {
        let release: (value: unknown) => void = () => undefined;
        mockCallable.mockReturnValue(new Promise((resolve) => { release = resolve; }));

        const pending = disconnectGoogleCalendarConfirmed();
        await Promise.resolve();
        expect(localStorage.getItem(CONNECTED_KEY)).toBe('true');
        expect(mockSetCalendarConnected).not.toHaveBeenCalled();

        release({ data: { disconnected: true } });
        await pending;
        expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
    });

    it('stays connected and returns false when the server call fails', async () => {
        mockCallable.mockRejectedValue(new Error('network down'));

        expect(await disconnectGoogleCalendarConfirmed()).toBe(false);

        expect(localStorage.getItem(CONNECTED_KEY)).toBe('true');
        expect(mockSetCalendarConnected).not.toHaveBeenCalled();
        expect(mockWarn).toHaveBeenCalledTimes(1);
    });

    it('returns false without calling the server when nobody is signed in', async () => {
        const original = auth.currentUser;
        // @ts-expect-error Mocking readonly property
        auth.currentUser = null;

        expect(await disconnectGoogleCalendarConfirmed()).toBe(false);
        expect(mockCallable).not.toHaveBeenCalled();

        // @ts-expect-error Mocking readonly property
        auth.currentUser = original;
    });
});
