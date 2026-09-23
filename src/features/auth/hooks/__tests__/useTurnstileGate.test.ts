/**
 * useTurnstileGate — runs the Turnstile challenge on mount so the sign-in click
 * can open the Google popup synchronously (no await before signInWithPopup).
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTurnstileGate } from '../useTurnstileGate';

const { mockExecute, turnstileState } = vi.hoisted(() => ({
    mockExecute: vi.fn<() => Promise<boolean>>(),
    turnstileState: { isLoading: false, error: null as string | null },
}));

vi.mock('../useTurnstile', () => ({
    useTurnstile: () => ({
        execute: mockExecute,
        isLoading: turnstileState.isLoading,
        error: turnstileState.error,
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    turnstileState.isLoading = false;
    turnstileState.error = null;
    mockExecute.mockResolvedValue(true);
});

describe('useTurnstileGate', () => {
    it('runs the challenge on mount without any user interaction', async () => {
        renderHook(() => useTurnstileGate());
        await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    });

    it('is not verified before the challenge resolves', () => {
        mockExecute.mockReturnValue(new Promise(() => undefined));
        const { result } = renderHook(() => useTurnstileGate());
        expect(result.current.isVerified).toBe(false);
    });

    it('becomes verified when the challenge passes', async () => {
        const { result } = renderHook(() => useTurnstileGate());
        await waitFor(() => expect(result.current.isVerified).toBe(true));
    });

    it('stays unverified when the challenge fails', async () => {
        mockExecute.mockResolvedValue(false);
        const { result } = renderHook(() => useTurnstileGate());
        await waitFor(() => expect(mockExecute).toHaveBeenCalled());
        expect(result.current.isVerified).toBe(false);
    });

    it('retry() re-runs the challenge and can recover to verified', async () => {
        mockExecute.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const { result } = renderHook(() => useTurnstileGate());
        await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));

        act(() => result.current.retry());

        await waitFor(() => expect(result.current.isVerified).toBe(true));
        expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('ignores a result that resolves after unmount', async () => {
        let resolve: (v: boolean) => void = () => undefined;
        mockExecute.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
        const { result, unmount } = renderHook(() => useTurnstileGate());
        unmount();
        await act(async () => { resolve(true); await Promise.resolve(); });
        expect(result.current.isVerified).toBe(false);
    });

    it('passes through isLoading and error from useTurnstile', async () => {
        turnstileState.isLoading = true;
        turnstileState.error = 'Challenge verification failed';
        const { result } = renderHook(() => useTurnstileGate());
        await act(async () => { await Promise.resolve(); });
        expect(result.current.isLoading).toBe(true);
        expect(result.current.error).toBe('Challenge verification failed');
    });
});
