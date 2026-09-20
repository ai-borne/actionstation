/**
 * withRetry — Unit tests
 * TDD: written before implementation.
 * Verifies: success on first try, retry on transient errors,
 * no retry on auth errors, exhaustion throws final error.
 *
 * NOTE: We use vi.advanceTimersByTimeAsync(n) rather than vi.runAllTimersAsync()
 * to avoid triggering Firebase App Check's self-rescheduling internal timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../firebaseUtils';

// Simulate a FirebaseError-shaped object (duck typing)
function makeFirebaseError(code: string): Error {
    const err = new Error(`Firebase: ${code}`);
    (err as unknown as Record<string, unknown>).code = code;
    return err;
}

describe('withRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('returns value immediately on first-try success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        // No timers needed — fn resolves without any retry delay
        const result = await withRetry(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on UNAVAILABLE and succeeds on 2nd attempt', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(makeFirebaseError('unavailable'))
            .mockResolvedValue('ok');
        const promise = withRetry(fn, { baseDelayMs: 100, maxRetries: 3 });
        // Advance exactly past the 1st retry delay (100ms)
        await vi.advanceTimersByTimeAsync(200);
        expect(await promise).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on DEADLINE_EXCEEDED', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(makeFirebaseError('deadline-exceeded'))
            .mockResolvedValue('done');
        const promise = withRetry(fn, { baseDelayMs: 50, maxRetries: 3 });
        // Advance past the 1st retry delay (50ms)
        await vi.advanceTimersByTimeAsync(100);
        expect(await promise).toBe('done');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on generic network Error', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('network request failed'))
            .mockResolvedValue('ok');
        const promise = withRetry(fn, { baseDelayMs: 50, maxRetries: 3 });
        // Advance past the 1st retry delay (50ms)
        await vi.advanceTimersByTimeAsync(100);
        expect(await promise).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on PERMISSION_DENIED — fails fast (security invariant)', async () => {
        const fn = vi.fn().mockRejectedValue(makeFirebaseError('permission-denied'));
        // Attach rejection handler before timers run to prevent unhandled rejection
        const result = expect(withRetry(fn, { baseDelayMs: 50, maxRetries: 3 })).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(100);
        await result;
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on UNAUTHENTICATED — fails fast (security invariant)', async () => {
        const fn = vi.fn().mockRejectedValue(makeFirebaseError('unauthenticated'));
        // Attach rejection handler before timers run to prevent unhandled rejection
        const result = expect(withRetry(fn, { baseDelayMs: 50, maxRetries: 3 })).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(100);
        await result;
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('exhausts retries and throws final error', async () => {
        const fn = vi.fn().mockRejectedValue(makeFirebaseError('unavailable'));
        // baseDelayMs=50, maxRetries=2 → delays: 50ms, 100ms → total 150ms needed
        const result = expect(withRetry(fn, { baseDelayMs: 50, maxRetries: 2 })).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(300);
        await result;
        expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('uses exponential backoff — 2nd delay is double the 1st', async () => {
        // Read the delays off the (fake) clock and the call count instead of spying on the global
        // setTimeout: a spy also sees unrelated timers in the process (e.g. Firebase's) and made
        // this test flaky (checklist C14).
        const fn = vi
            .fn()
            .mockRejectedValueOnce(makeFirebaseError('unavailable'))
            .mockRejectedValueOnce(makeFirebaseError('unavailable'))
            .mockResolvedValue('ok');

        const promise = withRetry(fn, { baseDelayMs: 200, maxRetries: 3 });

        await vi.advanceTimersByTimeAsync(199); // t=199: 1st delay (200 ms) not over yet
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1); // t=200: 1st retry fires
        expect(fn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(399); // t=599: 2nd delay (400 ms) not over yet
        expect(fn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1); // t=600: 2nd retry fires and succeeds

        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });
});
