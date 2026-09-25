/**
 * Pool Toggle Persistence Tests for useAutosave
 * Regression: brain icon (WorkspacePoolButton) was reverting because
 * lastSavedRef was updated before save(), making workspaceFieldsChanged always false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutosave } from '../hooks/useAutosave';
import { saveWorkspace } from '@/features/workspace/services/workspaceService';
import type { Workspace } from '@/features/workspace/types/workspace';
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';

const canvasState = { current: { nodes: [] as unknown[], edges: [] as unknown[] } };
const workspaceState = { current: [] as Workspace[] };

vi.mock('@/config/firebase', () => ({
    appCheckReady: Promise.resolve(),
    db: {},
    auth: {},
    storage: {},
    functions: {},
}));

vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: Object.assign(
        vi.fn((sel?: (s: { nodes: unknown[]; edges: unknown[] }) => unknown) =>
            typeof sel === 'function' ? sel(canvasState.current) : canvasState.current,
        ),
        { getState: () => ({ ...canvasState.current, clearClusterGroups: vi.fn(), setClusterGroups: vi.fn(), pruneDeletedNodes: vi.fn() }) },
    ),
}));

const authState = { current: { user: { id: 'user-123' } as { id: string } | null } };
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((sel?: (s: typeof authState.current) => unknown) =>
        typeof sel === 'function' ? sel(authState.current) : authState.current,
    ),
}));

vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: Object.assign(
        vi.fn((sel?: (s: { workspaces: Workspace[] }) => unknown) =>
            typeof sel === 'function' ? sel({ workspaces: workspaceState.current }) : workspaceState.current,
        ),
        { getState: () => ({ workspaces: workspaceState.current, setNodeCount: vi.fn() }) },
    ),
}));

vi.mock('@/features/workspace/services/workspaceService', () => ({
    saveNodes: vi.fn().mockResolvedValue(undefined),
    saveEdges: vi.fn().mockResolvedValue(undefined),
    saveNodeChanges: vi.fn().mockResolvedValue(undefined),
    saveEdgeChanges: vi.fn().mockResolvedValue(undefined),
    saveWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/workspace/services/workspaceCache', () => ({
    workspaceCache: { update: vi.fn() },
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../stores/offlineQueueStore', () => ({
    useOfflineQueueStore: { getState: () => ({ queueSave: vi.fn(), discardWorkspace: vi.fn() }) },
}));

const WS_ID = 'ws-pool-test';

function makeWorkspace(pooled: boolean): Workspace {
    return {
        id: WS_ID, userId: 'user-123', name: 'Test Workspace',
        canvasSettings: { backgroundColor: 'grid' },
        createdAt: new Date(), updatedAt: new Date(),
        orderIndex: 0, type: 'workspace', nodeCount: 0,
        includeAllNodesInPool: pooled,
    };
}

describe('useAutosave — workspace pool toggle persistence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        canvasState.current = { nodes: [], edges: [] };
        workspaceState.current = [];
        useSaveStatusStore.setState({ status: 'idle', lastSavedAt: null, lastError: null });
        useNetworkStatusStore.setState({ isOnline: true });
        // Simulate being the leader tab; default is false to prevent write-window race (R2 fix)
        useTabRoleStore.setState({ isLeader: true });
    });

    afterEach(() => { vi.useRealTimers(); });

    it('saves to Firestore when includeAllNodesInPool is toggled off', async () => {
        workspaceState.current = [makeWorkspace(true)];

        const { rerender } = renderHook(
            ({ loading }: { loading: boolean }) => useAutosave(WS_ID, loading),
            { initialProps: { loading: true } },
        );
        await act(async () => { vi.advanceTimersByTime(1); });
        rerender({ loading: false });

        workspaceState.current = [makeWorkspace(false)];
        rerender({ loading: false });

        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(saveWorkspace).toHaveBeenCalledWith('user-123', expect.objectContaining({
            id: WS_ID, includeAllNodesInPool: false,
        }));
    });

    it('saves to Firestore when includeAllNodesInPool is toggled on', async () => {
        workspaceState.current = [makeWorkspace(false)];

        const { rerender } = renderHook(
            ({ loading }: { loading: boolean }) => useAutosave(WS_ID, loading),
            { initialProps: { loading: true } },
        );
        await act(async () => { vi.advanceTimersByTime(1); });
        rerender({ loading: false });

        workspaceState.current = [makeWorkspace(true)];
        rerender({ loading: false });

        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(saveWorkspace).toHaveBeenCalledWith('user-123', expect.objectContaining({
            id: WS_ID, includeAllNodesInPool: true,
        }));
    });

    it('does not call saveWorkspace when pool state has not changed since load', async () => {
        workspaceState.current = [makeWorkspace(false)];

        const { rerender } = renderHook(
            ({ loading }: { loading: boolean }) => useAutosave(WS_ID, loading),
            { initialProps: { loading: true } },
        );

        // Flush the deferred fingerprint from the loading path (setTimeout(0))
        await act(async () => { vi.advanceTimersByTime(1); });

        rerender({ loading: false });

        await act(async () => { vi.advanceTimersByTime(5000); });
        expect(saveWorkspace).not.toHaveBeenCalled();
    });

    it('saves workspace when node-edit timeout fires alongside a pool toggle', async () => {
        workspaceState.current = [makeWorkspace(true)];

        const { rerender } = renderHook(
            ({ loading }: { loading: boolean }) => useAutosave(WS_ID, loading),
            { initialProps: { loading: true } },
        );
        await act(async () => { vi.advanceTimersByTime(1); });
        rerender({ loading: false });

        workspaceState.current = [makeWorkspace(false)];
        canvasState.current = { nodes: [{ id: 'n-1', workspaceId: WS_ID, type: 'idea', position: { x: 0, y: 0 }, data: {} }], edges: [] };
        rerender({ loading: false });

        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(saveWorkspace).toHaveBeenCalledWith('user-123', expect.objectContaining({
            id: WS_ID, includeAllNodesInPool: false,
        }));
    });
});
