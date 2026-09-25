/**
 * useSaveCallback delta-save tests — first save does a full sync; later saves
 * write only what changed since the last successful save. Any save that did
 * not reach Firestore (error, follower tab, offline) forces the next one to
 * fully sync again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSaveCallback } from '../useSaveCallback';
import {
    saveNodes, saveEdges, saveNodeChanges, saveEdgeChanges,
} from '@/features/workspace/services/workspaceService';
import { saveTiledNodes } from '@/features/workspace/services/tiledNodeWriter';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

const canvasState = vi.hoisted(() => ({ nodes: [] as unknown[], edges: [] as unknown[] }));
vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: vi.fn((selector: (s: typeof canvasState) => unknown) => selector(canvasState)),
}));
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-1' } })),
}));
const workspaceState = vi.hoisted(() => ({
    workspaces: [] as Array<{ id: string; spatialChunkingEnabled?: boolean; nodeCount?: number }>,
    setNodeCount: vi.fn(),
}));
vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: vi.fn((selector: (s: typeof workspaceState) => unknown) => selector(workspaceState)),
}));
const chunkingGuard = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/config/featureFlags', () => ({
    resolveSpatialChunkingEnabled: (flag?: boolean) => chunkingGuard.enabled && flag === true,
}));
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
vi.mock('../../stores/offlineQueueStore', () => ({ useOfflineQueueStore: { getState: () => ({ queueSave: vi.fn(), discardWorkspace: vi.fn() }) } }));
const tabRoleState = vi.hoisted(() => ({ isLeader: true }));
vi.mock('@/shared/stores/tabRoleStore', () => ({ useTabRoleStore: { getState: () => tabRoleState } }));
vi.mock('@/features/workspace/services/tiledNodeWriter', () => ({ saveTiledNodes: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/config/firebase', () => ({ appCheckReady: Promise.resolve() }));

const makeNode = (id: string, heading = 'H'): CanvasNode => ({
    id, workspaceId: 'ws-1', type: 'idea', data: { heading }, position: { x: 0, y: 0 },
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
});
const makeEdge = (id: string): CanvasEdge => ({
    id, workspaceId: 'ws-1', sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'related',
});

function setup(workspaceId = 'ws-1') {
    const hook = renderHook(({ id }) => useSaveCallback(id), { initialProps: { id: workspaceId } });
    const save = async () => { await act(async () => { await hook.result.current.save(); }); };
    const edit = (nodes: CanvasNode[], edges: CanvasEdge[] = canvasState.edges as CanvasEdge[]) => {
        canvasState.nodes = nodes;
        canvasState.edges = edges;
        hook.rerender({ id: workspaceId });
    };
    return { hook, save, edit };
}

describe('useSaveCallback delta saves', () => {
    beforeEach(() => {
        canvasState.nodes = [makeNode('n1'), makeNode('n2')];
        canvasState.edges = [makeEdge('e1')];
        workspaceState.workspaces = [];
        tabRoleState.isLeader = true;
        networkState.isOnline = true;
        chunkingGuard.enabled = false;
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('first save does a full sync', async () => {
        const { save } = setup();
        await save();

        expect(saveNodes).toHaveBeenCalledTimes(1);
        expect(saveEdges).toHaveBeenCalledTimes(1);
        expect(saveNodeChanges).not.toHaveBeenCalled();
        expect(saveEdgeChanges).not.toHaveBeenCalled();
    });

    it('later saves write only what changed since the last save', async () => {
        const { save, edit } = setup();
        await save();
        const edited = makeNode('n1', 'Edited');
        const added = makeNode('n3');
        const removed = canvasState.nodes[1];
        edit([edited, added], [makeEdge('e2')]);
        await save();

        expect(saveNodes).toHaveBeenCalledTimes(1);
        expect(saveNodeChanges).toHaveBeenCalledWith('user-1', 'ws-1', [edited, added], [removed]);
        expect(saveEdgeChanges).toHaveBeenCalledWith('user-1', 'ws-1', [makeEdge('e2')], ['e1']);
    });

    it('diffs against the latest successful save, not the first', async () => {
        const { save, edit } = setup();
        await save();
        edit([makeNode('n1', 'A'), makeNode('n2')]);
        await save();
        edit([makeNode('n1', 'A'), makeNode('n2', 'B')]);
        await save();

        expect(saveNodeChanges).toHaveBeenLastCalledWith('user-1', 'ws-1', [makeNode('n2', 'B')], []);
    });

    it('falls back to a full sync after a failed save', async () => {
        const { save, edit } = setup();
        await save();
        vi.mocked(saveNodeChanges).mockRejectedValueOnce(new Error('boom'));
        edit([makeNode('n1', 'A'), makeNode('n2')]);
        await save();
        await save();

        expect(saveNodes).toHaveBeenCalledTimes(2);
    });

    it('falls back to a full sync after saving as a follower tab', async () => {
        const { save } = setup();
        await save();
        tabRoleState.isLeader = false;
        await save();
        tabRoleState.isLeader = true;
        await save();

        expect(saveNodes).toHaveBeenCalledTimes(2);
        expect(saveNodeChanges).not.toHaveBeenCalled();
    });

    it('falls back to a full sync after an offline save', async () => {
        const { save } = setup();
        await save();
        networkState.isOnline = false;
        await save();
        networkState.isOnline = true;
        await save();

        expect(saveNodes).toHaveBeenCalledTimes(2);
    });

    it('does a full sync when the workspace changes', async () => {
        const { hook, save } = setup();
        await save();
        hook.rerender({ id: 'ws-2' });
        await act(async () => { await hook.result.current.save(); });

        expect(saveNodes).toHaveBeenLastCalledWith('user-1', 'ws-2', canvasState.nodes);
        expect(saveNodeChanges).not.toHaveBeenCalled();
    });

    it('keeps tile saves for nodes and uses delta saves for edges when chunking is on', async () => {
        chunkingGuard.enabled = true;
        workspaceState.workspaces = [{ id: 'ws-1', spatialChunkingEnabled: true, nodeCount: 2 }];
        const { save, edit } = setup();
        await save();
        edit([makeNode('n1', 'A'), makeNode('n2')], [makeEdge('e2')]);
        await save();

        expect(saveTiledNodes).toHaveBeenCalled();
        expect(saveNodes).not.toHaveBeenCalled();
        expect(saveNodeChanges).not.toHaveBeenCalled();
        expect(saveEdgeChanges).toHaveBeenCalledWith('user-1', 'ws-1', [makeEdge('e2')], ['e1']);
    });
});
