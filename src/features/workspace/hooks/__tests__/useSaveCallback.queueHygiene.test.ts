/**
 * useSaveCallback and the offline queue.
 * - A successful online save discards the workspace's queued snapshot (it is stale now).
 * - A failed save keeps the state safe by queueing it ("Will retry when online" is what the toast promises).
 * - save() reports whether the state is safe (persisted or queued) so the switcher knows whether to queue.
 * - The hook registers a flush for its workspace so the switcher can save the workspace being left.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSaveCallback } from '../useSaveCallback';
import { saveNodes, saveNodeChanges } from '@/features/workspace/services/workspaceService';
import { flushWorkspaceSave } from '@/features/workspace/services/saveFlushRegistry';
import { toast } from '@/shared/stores/toastStore';

const canvasState = vi.hoisted(() => ({ nodes: [] as unknown[], edges: [] as unknown[] }));
vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: vi.fn((selector: (s: typeof canvasState) => unknown) => selector(canvasState)),
}));
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-1' } })),
}));
const workspaceState = vi.hoisted(() => ({
    workspaces: [] as Array<{ id: string; nodeCount: number }>,
    setNodeCount: vi.fn(),
}));
vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: Object.assign(
        vi.fn((selector: (s: typeof workspaceState) => unknown) => selector(workspaceState)),
        { getState: () => workspaceState },
    ),
}));
vi.mock('@/config/featureFlags', () => ({ resolveSpatialChunkingEnabled: () => false }));
vi.mock('@/features/workspace/services/workspaceService', () => ({
    saveNodes: vi.fn().mockResolvedValue(undefined),
    saveEdges: vi.fn().mockResolvedValue(undefined),
    saveNodeChanges: vi.fn().mockResolvedValue(undefined),
    saveEdgeChanges: vi.fn().mockResolvedValue(undefined),
    saveWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/workspace/services/workspaceCache', () => ({ workspaceCache: { update: vi.fn() } }));
vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: { getState: () => ({ setSaving: vi.fn(), setSaved: vi.fn(), setError: vi.fn(), setQueued: vi.fn() }) },
}));
const networkState = vi.hoisted(() => ({ isOnline: true }));
vi.mock('@/shared/stores/networkStatusStore', () => ({ useNetworkStatusStore: { getState: () => networkState } }));
vi.mock('@/shared/stores/toastStore', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
const queue = vi.hoisted(() => ({ queueSave: vi.fn(), discardWorkspace: vi.fn() }));
vi.mock('../../stores/offlineQueueStore', () => ({ useOfflineQueueStore: { getState: () => queue } }));
const tabRoleState = vi.hoisted(() => ({ isLeader: true }));
vi.mock('@/shared/stores/tabRoleStore', () => ({ useTabRoleStore: { getState: () => tabRoleState } }));
vi.mock('@/features/workspace/services/tiledNodeWriter', () => ({ saveTiledNodes: vi.fn() }));
vi.mock('@/config/firebase', () => ({ appCheckReady: Promise.resolve() }));

const node = (id: string) => ({
    id, workspaceId: 'ws-A', type: 'idea', data: { heading: id }, position: { x: 0, y: 0 },
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
});

describe('useSaveCallback and the offline queue', () => {
    beforeEach(() => {
        canvasState.nodes = [node('a1'), node('a2')];
        canvasState.edges = [];
        workspaceState.workspaces = [{ id: 'ws-A', nodeCount: 2 }];
        networkState.isOnline = true;
        tabRoleState.isLeader = true;
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('discards the workspace\'s queued snapshot after a successful online save', async () => {
        const { result } = renderHook(() => useSaveCallback('ws-A'));
        await act(async () => { await result.current.save(); });

        expect(queue.discardWorkspace).toHaveBeenCalledWith('ws-A', expect.any(Number));
        expect(queue.queueSave).not.toHaveBeenCalled();
    });

    it('resolves true when the state was persisted', async () => {
        const { result } = renderHook(() => useSaveCallback('ws-A'));
        let outcome: boolean | undefined;
        await act(async () => { outcome = await result.current.save(); });

        expect(outcome).toBe(true);
    });

    it('queues the state when the save fails, and still tells the user', async () => {
        vi.mocked(saveNodes).mockRejectedValueOnce(new Error('network down'));
        const { result } = renderHook(() => useSaveCallback('ws-A'));
        let outcome: boolean | undefined;
        await act(async () => { outcome = await result.current.save(); });

        expect(queue.queueSave).toHaveBeenCalledWith('user-1', 'ws-A', canvasState.nodes, canvasState.edges);
        expect(queue.discardWorkspace).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
        expect(outcome).toBe(true);
    });

    it('offline: queues (as before), does not discard, and resolves true', async () => {
        networkState.isOnline = false;
        const { result } = renderHook(() => useSaveCallback('ws-A'));
        let outcome: boolean | undefined;
        await act(async () => { outcome = await result.current.save(); });

        expect(queue.queueSave).toHaveBeenCalledTimes(1);
        expect(queue.discardWorkspace).not.toHaveBeenCalled();
        expect(saveNodes).not.toHaveBeenCalled();
        expect(outcome).toBe(true);
    });

    it('follower tab: persists nothing, so it resolves false and queues nothing itself', async () => {
        tabRoleState.isLeader = false;
        const { result } = renderHook(() => useSaveCallback('ws-A'));
        let outcome: boolean | undefined;
        await act(async () => { outcome = await result.current.save(); });

        expect(outcome).toBe(false);
        expect(queue.queueSave).not.toHaveBeenCalled();
    });

    it('registers a flush for its own workspace, and only that one', async () => {
        const { unmount } = renderHook(() => useSaveCallback('ws-A'));

        await expect(flushWorkspaceSave('ws-B')).resolves.toBe(false);
        await act(async () => { await expect(flushWorkspaceSave('ws-A')).resolves.toBe(true); });
        expect(saveNodes).toHaveBeenCalledTimes(1);

        unmount();
        await expect(flushWorkspaceSave('ws-A')).resolves.toBe(false);
    });

    it('flushing after a first save writes only what changed (no full re-sync)', async () => {
        const { result, rerender } = renderHook(() => useSaveCallback('ws-A'));
        await act(async () => { await result.current.save(); });
        canvasState.nodes = [node('a1'), { ...node('a2'), data: { heading: 'edited' } }];
        rerender();
        await act(async () => { await flushWorkspaceSave('ws-A'); });

        expect(saveNodes).toHaveBeenCalledTimes(1);
        expect(saveNodeChanges).toHaveBeenCalledTimes(1);
    });
});
