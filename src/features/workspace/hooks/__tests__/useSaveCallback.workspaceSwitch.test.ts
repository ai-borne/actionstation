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
vi.mock('../../stores/offlineQueueStore', () => ({ useOfflineQueueStore: { getState: () => ({ queueSave: vi.fn(), discardWorkspace: vi.fn() }) } }));
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

        let inFlight: Promise<unknown> = Promise.resolve();
        await act(async () => { inFlight = hook.result.current.save(); await Promise.resolve(); });
        hook.rerender({ id: 'ws-B' });
        await act(async () => { finishNodeSave(); await inFlight; });

        const written = vi.mocked(saveWorkspace).mock.calls.map(([, ws]) => ({ id: ws.id, nodeCount: ws.nodeCount }));
        expect(written).toEqual([{ id: 'ws-A', nodeCount: 3 }]);
        expect(workspaceState.setNodeCount).toHaveBeenCalledWith('ws-A', 3);
    });
});
