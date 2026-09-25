/**
 * useSaveCallback Tests
 * TDD RED: Verifies save() reads from refs (not stale closure)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSaveCallback, serializeWorkspacePoolFields } from '../useSaveCallback';
import { saveNodes, saveEdges } from '@/features/workspace/services/workspaceService';
import { saveTiledNodes } from '@/features/workspace/services/tiledNodeWriter';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';

vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: vi.fn((selector?: (s: { nodes: unknown[]; edges: unknown[] }) => unknown) => {
        const state = { nodes: [], edges: [] };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
        const state = { user: { id: 'user-1' } };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

const workspaceState = vi.hoisted(() => ({
    workspaces: [] as Array<{ id: string; spatialChunkingEnabled?: boolean; nodeCount?: number }>,
    setNodeCount: vi.fn(),
}));

vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: vi.fn((selector?: (s: typeof workspaceState) => unknown) => {
        return typeof selector === 'function' ? selector(workspaceState) : workspaceState;
    }),
}));

const chunkingGuard = vi.hoisted(() => ({
    prodEnabled: false,
}));

vi.mock('@/config/featureFlags', () => ({
    resolveSpatialChunkingEnabled: (flag?: boolean) => chunkingGuard.prodEnabled && flag === true,
    SPATIAL_CHUNKING_PROD_ENABLED: false,
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

vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: {
        getState: () => ({
            setSaving: vi.fn(), setSaved: vi.fn(), setError: vi.fn(), setQueued: vi.fn(),
        }),
    },
}));

vi.mock('@/shared/stores/networkStatusStore', () => ({
    useNetworkStatusStore: { getState: () => ({ isOnline: true }) },
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../stores/offlineQueueStore', () => ({
    useOfflineQueueStore: { getState: () => ({ queueSave: vi.fn() }) },
}));

const tabRoleState = vi.hoisted(() => ({ isLeader: true }));

vi.mock('@/shared/stores/tabRoleStore', () => ({
    useTabRoleStore: { getState: () => tabRoleState },
}));

vi.mock('@/features/workspace/services/tiledNodeWriter', () => ({
    saveTiledNodes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/config/firebase', () => ({
    appCheckReady: Promise.resolve(),
}));

describe('useSaveCallback', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        tabRoleState.isLeader = true;
        workspaceState.workspaces = [];
        chunkingGuard.prodEnabled = false;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('returns a stable save function', () => {
        const { result } = renderHook(() => useSaveCallback('ws-1'));
        expect(typeof result.current.save).toBe('function');
    });

    it('exposes nodes, edges, and currentWorkspace', () => {
        const { result } = renderHook(() => useSaveCallback('ws-1'));
        expect(result.current.nodes).toEqual([]);
        expect(result.current.edges).toEqual([]);
        expect(result.current.currentWorkspace).toBeNull();
    });

    it('serializeWorkspacePoolFields handles null workspace', () => {
        expect(serializeWorkspacePoolFields(null)).toBe('');
    });

    it('save callback depends only on user and workspaceId', async () => {
        const { result } = renderHook(() => useSaveCallback('ws-1'));
        const firstSave = result.current.save;

        await act(async () => {
            await result.current.save();
        });

        expect(result.current.save).toBe(firstSave);
    });

    it('follower tab updates cache only — no Firestore writes', async () => {
        tabRoleState.isLeader = false;
        const { result } = renderHook(() => useSaveCallback('ws-1'));

        await act(async () => {
            await result.current.save();
        });

        expect(workspaceCache.update).toHaveBeenCalledWith('ws-1', [], []);
        expect(saveNodes).not.toHaveBeenCalled();
        expect(saveEdges).not.toHaveBeenCalled();
        expect(saveTiledNodes).not.toHaveBeenCalled();
    });

    it('uses flat save when prod spatial chunking guard is off', async () => {
        chunkingGuard.prodEnabled = false;
        workspaceState.workspaces = [{
            id: 'ws-1',
            spatialChunkingEnabled: true,
            nodeCount: 0,
        }];
        const { result } = renderHook(() => useSaveCallback('ws-1'));

        await act(async () => {
            await result.current.save();
        });

        expect(saveNodes).toHaveBeenCalled();
        expect(saveTiledNodes).not.toHaveBeenCalled();
    });

    it('uses tiled save path when spatialChunkingEnabled and prod guard on', async () => {
        chunkingGuard.prodEnabled = true;
        workspaceState.workspaces = [{
            id: 'ws-1',
            spatialChunkingEnabled: true,
            nodeCount: 0,
        }];
        const { result } = renderHook(() => useSaveCallback('ws-1'));

        await act(async () => {
            await result.current.save();
        });

        expect(saveNodes).not.toHaveBeenCalled();
        expect(saveEdges).toHaveBeenCalled();
    });
});
