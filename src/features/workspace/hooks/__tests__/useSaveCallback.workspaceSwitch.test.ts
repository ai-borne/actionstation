/**
 * Regression (2026-09-25): a save that is still in flight when the user switches
 * workspace must record ITS node count on ITS workspace. It used to read the
 * "current workspace" ref after the network calls, so it wrote workspace A's
 * node count onto workspace B's doc (sidebar showed Dan Koe Ideas 49 with 7 docs,
 * Human 3.0 0 with 49 docs, Code Hacks 29 with 7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSaveCallback } from '../useSaveCallback';
import { saveNodes, saveWorkspace } from '@/features/workspace/services/workspaceService';

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
    saveNodes: vi.fn(),
    saveEdges: vi.fn().mockResolvedValue(undefined),
    saveNodeChanges: vi.fn().mockResolvedValue(undefined),
    saveEdgeChanges: vi.fn().mockResolvedValue(undefined),
    saveWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/workspace/services/workspaceCache', () => ({ workspaceCache: { update: vi.fn() } }));
vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: { getState: () => ({ setSaving: vi.fn(), setSaved: vi.fn(), setError: vi.fn(), setQueued: vi.fn() }) },
}));
vi.mock('@/shared/stores/networkStatusStore', () => ({ useNetworkStatusStore: { getState: () => ({ isOnline: true }) } }));
vi.mock('@/shared/stores/toastStore', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('../../stores/offlineQueueStore', () => ({ useOfflineQueueStore: { getState: () => ({ queueSave: vi.fn() }) } }));
vi.mock('@/shared/stores/tabRoleStore', () => ({ useTabRoleStore: { getState: () => ({ isLeader: true }) } }));
vi.mock('@/features/workspace/services/tiledNodeWriter', () => ({ saveTiledNodes: vi.fn() }));
vi.mock('@/config/firebase', () => ({ appCheckReady: Promise.resolve() }));

const node = (id: string) => ({
    id, workspaceId: 'ws-A', type: 'idea', data: { heading: id }, position: { x: 0, y: 0 },
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
});

describe('useSaveCallback: workspace switch during an in-flight save', () => {
    beforeEach(() => {
        canvasState.nodes = [node('a1'), node('a2'), node('a3')];
        canvasState.edges = [];
        workspaceState.workspaces = [{ id: 'ws-A', nodeCount: 0 }, { id: 'ws-B', nodeCount: 5 }];
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('records the count on the workspace that was saved, never on the one switched to', async () => {
        let finishNodeSave: () => void = () => undefined;
        vi.mocked(saveNodes).mockImplementationOnce(() => new Promise<void>((resolve) => { finishNodeSave = resolve; }));
        const hook = renderHook(({ id }) => useSaveCallback(id), { initialProps: { id: 'ws-A' } });

        let inFlight: Promise<void> = Promise.resolve();
        await act(async () => { inFlight = hook.result.current.save(); await Promise.resolve(); });
        hook.rerender({ id: 'ws-B' });
        await act(async () => { finishNodeSave(); await inFlight; });

        const written = vi.mocked(saveWorkspace).mock.calls.map(([, ws]) => ({ id: ws.id, nodeCount: ws.nodeCount }));
        expect(written).toEqual([{ id: 'ws-A', nodeCount: 3 }]);
        expect(workspaceState.setNodeCount).toHaveBeenCalledWith('ws-A', 3);
    });
});

/**
 * Regression (2026-09-25, owner: "it corrects the count while opening, but on hard reset it reverts"):
 * opening a workspace makes the switcher set its count IN MEMORY, and the save 2 s later compared
 * against that value, saw "unchanged" and never wrote the count to Firestore. The stored count
 * (e.g. Dan Koe Ideas 49 with 7 docs) survived every reload.
 */
describe('useSaveCallback: the stored count is written once per opened workspace', () => {
    const nodesFor = (ws: string, n: number) => Array.from({ length: n }, (_, i) => ({ ...node(`${ws}-${i}`), workspaceId: ws }));
    const writes = () => vi.mocked(saveWorkspace).mock.calls.map(([, ws]) => ({ id: ws.id, nodeCount: ws.nodeCount }));

    beforeEach(() => {
        // The switcher has already set the CORRECT counts in memory (nothing is persisted yet).
        workspaceState.workspaces = [{ id: 'ws-A', nodeCount: 3 }, { id: 'ws-B', nodeCount: 7 }];
    });

    it('writes the count for a second workspace even though the in-memory count already matches', async () => {
        canvasState.nodes = nodesFor('ws-A', 3);
        const hook = renderHook(({ id }) => useSaveCallback(id), { initialProps: { id: 'ws-A' } });
        await act(async () => { await hook.result.current.save(); });

        canvasState.nodes = nodesFor('ws-B', 7);
        hook.rerender({ id: 'ws-B' });
        await act(async () => { await hook.result.current.save(); });

        expect(writes()).toEqual([{ id: 'ws-A', nodeCount: 3 }, { id: 'ws-B', nodeCount: 7 }]);
    });

    it('does not rewrite the workspace doc on later saves when nothing changed', async () => {
        canvasState.nodes = nodesFor('ws-A', 3);
        const hook = renderHook(({ id }) => useSaveCallback(id), { initialProps: { id: 'ws-A' } });
        await act(async () => { await hook.result.current.save(); });
        await act(async () => { await hook.result.current.save(); });

        expect(writes()).toEqual([{ id: 'ws-A', nodeCount: 3 }]);
    });

    it('writes again when the node count changes', async () => {
        canvasState.nodes = nodesFor('ws-A', 3);
        const hook = renderHook(({ id }) => useSaveCallback(id), { initialProps: { id: 'ws-A' } });
        await act(async () => { await hook.result.current.save(); });
        canvasState.nodes = nodesFor('ws-A', 4);
        hook.rerender({ id: 'ws-A' });
        await act(async () => { await hook.result.current.save(); });

        expect(writes()).toEqual([{ id: 'ws-A', nodeCount: 3 }, { id: 'ws-A', nodeCount: 4 }]);
    });
});
