/**
 * useCalendarConnection — ViewModel for the Settings "Google Calendar" card (checklist A10c).
 * Owns: connection status, the busy flag, the confirm-then-disconnect flow and its toasts.
 * The View only renders what this returns; the service does the work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { calendarStrings as cs } from '../localization/calendarStrings';
import { AUTOSAVE_YIELD_MS } from '../config/connectTiming';
import { useCalendarConnection } from '../hooks/useCalendarConnection';

const mockConfirm = vi.fn();
vi.mock('@/shared/stores/confirmStore', () => ({ useConfirm: () => mockConfirm }));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('@/shared/stores/toastStore', () => ({
    toast: { success: (...a: unknown[]) => mockToastSuccess(...a), error: (...a: unknown[]) => mockToastError(...a) },
}));

const mockConnect = vi.fn();
const mockDisconnectConfirmed = vi.fn();
vi.mock('@/features/auth/services/calendarAuthService', () => ({
    connectGoogleCalendar: (...a: unknown[]) => mockConnect(...a),
    disconnectGoogleCalendarConfirmed: (...a: unknown[]) => mockDisconnectConfirmed(...a),
}));

describe('useCalendarConnection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({ isCalendarConnected: true });
        mockConfirm.mockResolvedValue(true);
        mockDisconnectConfirmed.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reflects the connection status from the auth store, reactively', () => {
        const { result } = renderHook(() => useCalendarConnection());
        expect(result.current.isConnected).toBe(true);

        act(() => useAuthStore.setState({ isCalendarConnected: false }));
        expect(result.current.isConnected).toBe(false);
    });

    it('asks for a normal (non-destructive) confirmation before disconnecting', async () => {
        const { result } = renderHook(() => useCalendarConnection());

        await act(() => result.current.disconnect());

        const options = mockConfirm.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(options.title).toBe(cs.connection.disconnectConfirmTitle);
        expect(options.message).toBe(cs.connection.disconnectConfirmMessage);
        expect(options.confirmText).toBe(cs.connection.disconnectConfirmButton);
        expect(options.isDestructive).not.toBe(true);
    });

    it('does nothing when the user cancels the confirmation', async () => {
        mockConfirm.mockResolvedValue(false);
        const { result } = renderHook(() => useCalendarConnection());

        await act(() => result.current.disconnect());

        expect(mockDisconnectConfirmed).not.toHaveBeenCalled();
        expect(mockToastSuccess).not.toHaveBeenCalled();
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('disconnects on the server, then shows a success toast', async () => {
        const { result } = renderHook(() => useCalendarConnection());

        await act(() => result.current.disconnect());

        expect(mockDisconnectConfirmed).toHaveBeenCalledTimes(1);
        expect(mockToastSuccess).toHaveBeenCalledWith(cs.connection.disconnectSuccess);
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('shows an error toast (and no success toast) when the server disconnect fails', async () => {
        mockDisconnectConfirmed.mockResolvedValue(false);
        const { result } = renderHook(() => useCalendarConnection());

        await act(() => result.current.disconnect());

        expect(mockToastError).toHaveBeenCalledWith(cs.connection.disconnectFailed);
        expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it('is busy while disconnecting and ignores a second click', async () => {
        let finish: (ok: boolean) => void = () => undefined;
        mockDisconnectConfirmed.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
        const { result } = renderHook(() => useCalendarConnection());

        let first: Promise<void> = Promise.resolve();
        await act(async () => {
            first = result.current.disconnect();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
        expect(result.current.isBusy).toBe(true);

        await act(() => result.current.disconnect());
        expect(mockDisconnectConfirmed).toHaveBeenCalledTimes(1);

        await act(async () => { finish(true); await first; });
        expect(result.current.isBusy).toBe(false);
    });

    it('starts the OAuth connect flow after giving autosave time to flush', async () => {
        vi.useFakeTimers();
        useAuthStore.setState({ isCalendarConnected: false });
        const { result } = renderHook(() => useCalendarConnection());

        let pending: Promise<void> = Promise.resolve();
        act(() => { pending = result.current.connect(); });
        expect(mockConnect).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_YIELD_MS); await pending; });
        expect(mockConnect).toHaveBeenCalledTimes(1);
    });
});
