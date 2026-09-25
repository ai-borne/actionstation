/**
 * offlineQueueStore.discardWorkspace: a queued snapshot must not outlive the
 * reason it was queued (a good online save, or the workspace being deleted),
 * or a later drain replays stale data over newer edits / recreates deleted cards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOfflineQueueStore } from '../offlineQueueStore';
import { offlineQueueService } from '../../services/offlineQueueService';
import { useWorkspaceStore } from '../workspaceStore';
import { saveNodes } from '../../services/workspaceService';
import type { Workspace } from '../../types/workspace';
import type { CanvasNode } from '@/features/canvas/types/node';

vi.mock('../../services/workspaceService', () => ({
    saveNodes: vi.fn().mockResolvedValue(undefined),
    saveEdges: vi.fn().mockResolvedValue(undefined),
    updateWorkspaceNodeCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: { getState: () => ({ hasAccess: () => false }) },
}));
vi.mock('@/shared/stores/toastStore', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const node = (id: string): CanvasNode => ({
    id, workspaceId: 'ws-A', type: 'idea', data: { heading: id }, position: { x: 0, y: 0 },
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
});

describe('offlineQueueStore.discardWorkspace', () => {
    beforeEach(() => {
        offlineQueueService.clear();
        useOfflineQueueStore.setState({ pendingCount: 0 });
    });

    it('removes only that workspace\'s queued snapshot and updates pendingCount', () => {
        const store = useOfflineQueueStore.getState();
        store.queueSave('user-1', 'ws-A', [node('a1')], []);
        store.queueSave('user-1', 'ws-B', [node('b1')], []);
        expect(useOfflineQueueStore.getState().pendingCount).toBe(2);

        useOfflineQueueStore.getState().discardWorkspace('ws-A');

        expect(offlineQueueService.getQueue().map((op) => op.workspaceId)).toEqual(['ws-B']);
        expect(useOfflineQueueStore.getState().pendingCount).toBe(1);
    });

    it('with a cut-off, keeps a snapshot queued after it (newer than the save that just finished)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(2000);
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-A', [node('a1')], []);

        useOfflineQueueStore.getState().discardWorkspace('ws-A', 1000);
        expect(offlineQueueService.size()).toBe(1);

        useOfflineQueueStore.getState().discardWorkspace('ws-A', 2000);
        expect(offlineQueueService.size()).toBe(0);
        vi.useRealTimers();
    });

    it('keeps a snapshot that already failed to sync: it may be the only copy of that content', () => {
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-A', [node('a1')], []);
        const [op] = offlineQueueService.getQueue();
        offlineQueueService.updateRetryCount(op!.id, 2);

        useOfflineQueueStore.getState().discardWorkspace('ws-A');

        expect(offlineQueueService.size()).toBe(1);
    });

    it('does nothing for a workspace with no queued snapshot', () => {
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-B', [node('b1')], []);

        useOfflineQueueStore.getState().discardWorkspace('ws-A');

        expect(offlineQueueService.size()).toBe(1);
        expect(useOfflineQueueStore.getState().pendingCount).toBe(1);
    });
});

/**
 * Real case (2026-09-25): the owner's browser held 18 queued snapshots, 5 of them 5+ days old,
 * one for a workspace deleted long ago. The next drain would have rewritten its nodes
 * (recreating the orphans that had just been cleaned up).
 */
describe('offlineQueueStore.drainQueue and deleted workspaces', () => {
    const workspace = (id: string) => ({ id, name: id, type: 'workspace' }) as unknown as Workspace;

    beforeEach(() => {
        offlineQueueService.clear();
        vi.clearAllMocks();
        useOfflineQueueStore.setState({ pendingCount: 0, isDraining: false });
    });

    it('drops a snapshot whose workspace no longer exists instead of recreating its nodes', async () => {
        useWorkspaceStore.getState().setWorkspaces([workspace('ws-B')]);
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-A', [node('a1')], []);
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-B', [node('b1')], []);

        await useOfflineQueueStore.getState().drainQueue();

        expect(vi.mocked(saveNodes).mock.calls.map(([, ws]) => ws)).toEqual(['ws-B']);
        expect(offlineQueueService.size()).toBe(0);
    });

    it('leaves a snapshot that already failed to sync untouched, even for a missing workspace (maybe the only copy)', async () => {
        useWorkspaceStore.getState().setWorkspaces([workspace('ws-B')]);
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-A', [node('a1')], []);
        const [op] = offlineQueueService.getQueue();
        offlineQueueService.updateRetryCount(op!.id, 2);

        await useOfflineQueueStore.getState().drainQueue();

        expect(saveNodes).not.toHaveBeenCalled();
        expect(offlineQueueService.getQueue().map((o) => o.workspaceId)).toEqual(['ws-A']);
    });

    it('never prunes blind: with no workspace list loaded yet, every snapshot is replayed', async () => {
        useWorkspaceStore.getState().setWorkspaces([]);
        useOfflineQueueStore.getState().queueSave('user-1', 'ws-A', [node('a1')], []);

        await useOfflineQueueStore.getState().drainQueue();

        expect(vi.mocked(saveNodes).mock.calls.map(([, ws]) => ws)).toEqual(['ws-A']);
    });
});
