/**
 * useTierLimits hook tests — verifies store sync and check function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTierLimits } from '../useTierLimits';
import { TierLimitsProvider } from '../../contexts/TierLimitsContext';
import { FREE_TIER_LIMITS } from '../../types/tierLimits';

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockTier = 'free';
let mockUserId: string | undefined = 'user-1';
let mockWorkspaces: Array<{ type?: string }> = [];
let mockNodeCount = 0;

vi.mock('../../stores/subscriptionStore', () => ({
    useSubscriptionStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ tier: mockTier }),
}));
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ user: mockUserId ? { id: mockUserId } : null }),
}));
vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ workspaces: mockWorkspaces }),
}));
vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ nodes: new Array(mockNodeCount).fill(null) }),
}));
vi.mock('../../services/usageCountService', () => ({
    loadAiDailyCount: vi.fn().mockResolvedValue({ count: 0, date: '' }),
}));
vi.mock('@/shared/services/logger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
    return <TierLimitsProvider>{children}</TierLimitsProvider>;
}

describe('useTierLimits', () => {
    beforeEach(() => {
        mockTier = 'free';
        mockUserId = 'user-1';
        mockWorkspaces = [];
        mockNodeCount = 0;
    });

    it('returns check function that reports allowed at zero counts', () => {
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.check('workspace').allowed).toBe(true);
        expect(result.current.check('node').allowed).toBe(true);
        expect(result.current.check('aiDaily').allowed).toBe(true);
    });

    it('blocks workspace creation at free limit', () => {
        mockWorkspaces = Array.from({ length: 5 }, () => ({ type: 'workspace' }));
        const { result } = renderHook(() => useTierLimits(), { wrapper });

        // The useEffect will sync workspace count
        const wsCheck = result.current.check('workspace');
        expect(wsCheck.allowed).toBe(false);
        expect(wsCheck.current).toBe(5);
        expect(wsCheck.max).toBe(FREE_TIER_LIMITS.maxWorkspaces);
    });

    it('excludes dividers from workspace count', () => {
        mockWorkspaces = [
            { type: 'workspace' }, { type: 'workspace' }, { type: 'workspace' },
            { type: 'divider' }, { type: 'divider' },
        ];
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.check('workspace').current).toBe(3);
        expect(result.current.check('workspace').allowed).toBe(true);
    });

    it('blocks node creation at free limit', () => {
        mockNodeCount = 12;
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.check('node').allowed).toBe(false);
    });

    it('allows pro user under soft caps', () => {
        mockTier = 'pro';
        mockWorkspaces = Array.from({ length: 49 }, () => ({ type: 'workspace' }));
        mockNodeCount = 499;
        const { result } = renderHook(() => useTierLimits(), { wrapper });

        expect(result.current.check('workspace').allowed).toBe(true);
        expect(result.current.check('node').allowed).toBe(true);
    });

    it('dispatches AI_GENERATED to increment count', () => {
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.check('aiDaily').current).toBe(0);

        act(() => {
            result.current.dispatch({ type: 'AI_GENERATED' });
        });
        expect(result.current.check('aiDaily').current).toBe(1);
    });

    it('exposes current tier', () => {
        mockTier = 'pro';
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.tier).toBe('pro');
    });
});
