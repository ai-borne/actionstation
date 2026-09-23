/**
 * useTurnstile Hook — lifecycle regressions
 *
 *  - StrictMode (used in main.tsx) mounts → unmounts → remounts every component.
 *    The remount must leave the hook usable, not permanently "cancelled".
 *  - A second execute() supersedes the first: the stale run must bail out
 *    quietly instead of timing out later and overwriting error/loading state.
 */
import { StrictMode, createElement } from 'react';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MOCK_TOKEN = 'cf-test-token-abc123';
const MOCK_SITE_KEY = 'test-site-key-0x4AAAAAAA';

const strictWrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);

describe('useTurnstile — lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_TURNSTILE_SITE_KEY', MOCK_SITE_KEY);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) }));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('execute() still succeeds after a StrictMode mount/unmount/remount cycle', async () => {
        vi.stubGlobal('turnstile', {
            render: vi.fn().mockReturnValue('w1'),
            execute: vi.fn(),
            reset: vi.fn(),
            remove: vi.fn(),
            getResponse: vi.fn().mockReturnValue(MOCK_TOKEN),
            ready: vi.fn(),
        });
        const { useTurnstile } = await import('../hooks/useTurnstile');
        const { result } = renderHook(() => useTurnstile(), { wrapper: strictWrapper });

        let value = false;
        await act(async () => { value = await result.current.execute(); });

        expect(value).toBe(true);
        expect(result.current.error).toBeNull();
    });

    it('a superseded execute() resolves false without setting an error', async () => {
        vi.stubGlobal('turnstile', {
            render: vi.fn().mockReturnValueOnce('stale').mockReturnValueOnce('fresh'),
            execute: vi.fn(),
            reset: vi.fn(),
            remove: vi.fn(),
            getResponse: vi.fn((id: string) => (id === 'fresh' ? MOCK_TOKEN : undefined)),
            ready: vi.fn(),
        });
        const { useTurnstile } = await import('../hooks/useTurnstile');
        const { result } = renderHook(() => useTurnstile());

        let first: Promise<boolean> = Promise.resolve(true);
        let second = false;
        await act(async () => {
            first = result.current.execute();
            second = await result.current.execute();
        });
        let firstValue = true;
        await act(async () => { firstValue = await first; });

        expect(second).toBe(true);
        expect(firstValue).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.isLoading).toBe(false);
    });
});
