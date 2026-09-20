/**
 * Tier Limits — Integration Tests
 *
 * Validates the guard chain WITHOUT mocking intermediate hooks:
 *   Zustand stores → useTierLimits reducer → check(kind) → useNodeCreationGuard
 *
 * Only leaf dependencies are mocked (Zustand stores, service calls, toast).
 * The real useTierLimits + useNodeCreationGuard + checkLimit compose together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TierLimitsProvider } from '../contexts/TierLimitsContext';
import { useTierLimits } from '../hooks/useTierLimits';
import { useNodeCreationGuard } from '../hooks/useNodeCreationGuard';
import { FREE_TIER_LIMITS, PRO_TIER_LIMITS } from '../types/tierLimits';

// ── Mutable store state ────────────────────────────────────────────────────────

let mockTier = 'free';
let mockWorkspaces: Array<{ type?: string }> = [];
let mockNodeCount = 0;
const mockToastWithAction = vi.fn();

vi.mock('../stores/subscriptionStore', () => ({
    useSubscriptionStore: (s: (st: Record<string, unknown>) => unknown) => s({ tier: mockTier }),
}));
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: (s: (st: Record<string, unknown>) => unknown) => s({ user: { id: 'user-1' } }),
}));
vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: (s: (st: Record<string, unknown>) => unknown) => s({ workspaces: mockWorkspaces }),
}));
vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: (s: (st: Record<string, unknown>) => unknown) =>
        s({ nodes: new Array(mockNodeCount).fill(null) }),
}));
vi.mock('../services/usageCountService', () => ({
    loadAiDailyCount: vi.fn().mockResolvedValue({ count: 0, date: '' }),
}));
vi.mock('../services/storageUsageService', () => ({
    getStorageUsageMb: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/shared/stores/toastStore', () => ({
    toastWithAction: (...args: unknown[]) => mockToastWithAction(...args),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/shared/services/logger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/shared/localization/strings', () => ({
    strings: {
        subscription: {
            limits: {
                nodeLimit: 'Node limit reached',
                aiDailyLimit: 'AI limit reached',
                workspaceLimit: 'Workspace limit',
                storageLimit: 'Storage limit',
            },
            upgradeCta: 'Upgrade to Pro',
        },
    },
}));

function wrapper({ children }: { children: ReactNode }) {
    return <TierLimitsProvider>{children}</TierLimitsProvider>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Tier Limits — integration', () => {
    beforeEach(() => {
        mockTier = 'free';
        mockWorkspaces = [];
        mockNodeCount = 0;
        vi.clearAllMocks();
    });

    // Workspace limit
    it('free user at workspace limit: check returns not-allowed', () => {
        mockWorkspaces = Array.from({ length: 5 }, () => ({ type: 'workspace' }));
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.check('workspace').allowed).toBe(false);
        expect(result.current.check('workspace').current).toBe(FREE_TIER_LIMITS.maxWorkspaces);
    });

    it('workspace deletion re-enables creation', async () => {
        mockWorkspaces = Array.from({ length: 5 }, () => ({ type: 'workspace' }));
        const { result, rerender } = renderHook(() => useTierLimits(), { wrapper });
        expect(result.current.check('workspace').allowed).toBe(false);

        mockWorkspaces = Array.from({ length: 4 }, () => ({ type: 'workspace' }));
        await act(async () => { rerender(); });

        expect(result.current.check('workspace').allowed).toBe(true);
    });

    // Node creation guard
    it('guardNodeCreation returns false and fires toast at free node limit', () => {
        mockNodeCount = FREE_TIER_LIMITS.maxNodesPerWorkspace;
        const { result } = renderHook(() => useNodeCreationGuard(), { wrapper });

        let allowed = true;
        act(() => { allowed = result.current.guardNodeCreation(); });

        expect(allowed).toBe(false);
        expect(mockToastWithAction).toHaveBeenCalledOnce();
    });

    it('guardNodeCreation returns true below free node limit', () => {
        mockNodeCount = FREE_TIER_LIMITS.maxNodesPerWorkspace - 1;
        const { result } = renderHook(() => useNodeCreationGuard(), { wrapper });

        let allowed = false;
        act(() => { allowed = result.current.guardNodeCreation(); });

        expect(allowed).toBe(true);
        expect(mockToastWithAction).not.toHaveBeenCalled();
    });

    it('pro user: guardNodeCreation allows creation under soft cap', () => {
        mockTier = 'pro';
        mockNodeCount = PRO_TIER_LIMITS.maxNodesPerWorkspace - 1;
        const { result } = renderHook(() => useNodeCreationGuard(), { wrapper });

        let allowed = false;
        act(() => { allowed = result.current.guardNodeCreation(); });

        expect(allowed).toBe(true);
        expect(mockToastWithAction).not.toHaveBeenCalled();
    });

    it('pro user: guardNodeCreation blocks at node soft cap', () => {
        mockTier = 'pro';
        mockNodeCount = PRO_TIER_LIMITS.maxNodesPerWorkspace;
        const { result } = renderHook(() => useNodeCreationGuard(), { wrapper });

        let allowed = true;
        act(() => { allowed = result.current.guardNodeCreation(); });

        expect(allowed).toBe(false);
        expect(mockToastWithAction).toHaveBeenCalledOnce();
    });

    // AI daily limit
    it('free user at AI daily limit: check returns not-allowed', () => {
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        act(() => {
            result.current.dispatch({
                type: 'AI_DAILY_LOADED',
                count: FREE_TIER_LIMITS.maxAiGenerationsPerDay,
                date: new Date().toISOString().slice(0, 10),
            });
        });
        expect(result.current.check('aiDaily').allowed).toBe(false);
    });

    it('AI_GENERATED increments counter and blocks at limit', () => {
        const { result } = renderHook(() => useTierLimits(), { wrapper });
        act(() => {
            result.current.dispatch({
                type: 'AI_DAILY_LOADED',
                count: FREE_TIER_LIMITS.maxAiGenerationsPerDay - 1,
                date: new Date().toISOString().slice(0, 10),
            });
        });
        expect(result.current.check('aiDaily').allowed).toBe(true);

        act(() => { result.current.dispatch({ type: 'AI_GENERATED' }); });
        expect(result.current.check('aiDaily').allowed).toBe(false);
        expect(result.current.check('aiDaily').current).toBe(FREE_TIER_LIMITS.maxAiGenerationsPerDay);
    });
});
