/**
 * deleteWorkspace must also drop the workspace's queued offline snapshot.
 * Otherwise the next offline->online drain rewrites its nodes under a workspace
 * that no longer exists (orphaned docs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteWorkspace } from '../services/workspaceService';
import { offlineQueueService } from '../services/offlineQueueService';

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})), collection: vi.fn(() => ({})), getDocs: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(),
    updateDoc: vi.fn(), getCountFromServer: vi.fn(), query: vi.fn(), limit: vi.fn(), orderBy: vi.fn(),
    startAfter: vi.fn(), runTransaction: vi.fn(), serverTimestamp: vi.fn(),
    writeBatch: vi.fn(() => ({ delete: vi.fn(), set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock('@/features/knowledgeBank/services/knowledgeBankService', () => ({
    deleteAllKBEntries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/nodeStorageCleanup', () => ({ cleanupDeletedNodeStorage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/bundleLoader', () => ({ loadWorkspaceBundle: vi.fn(), invalidateBundleCache: vi.fn() }));
vi.mock('@/shared/utils/firebaseUtils', () => ({
    removeUndefined: <T,>(o: T) => o,
    batchDeleteCollection: vi.fn().mockResolvedValue(undefined),
    chunkedBatchWrite: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/workspaceNodeEdgePersistence', () => ({
    saveNodes: vi.fn(), saveEdges: vi.fn(), loadNodes: vi.fn(), loadEdges: vi.fn(),
    loadAllNodeDocsForCleanup: vi.fn().mockResolvedValue([]),
}));

const op = (workspaceId: string) => ({
    id: `save-${workspaceId}`, userId: 'user-1', workspaceId, nodes: [], edges: [], queuedAt: 1, retryCount: 0,
});

describe('deleteWorkspace and the offline queue', () => {
    beforeEach(() => { offlineQueueService.clear(); });

    it('drops the deleted workspace\'s queued snapshot and keeps the others', async () => {
        offlineQueueService.enqueue(op('ws-A'));
        offlineQueueService.enqueue(op('ws-B'));

        await deleteWorkspace('user-1', 'ws-A');

        expect(offlineQueueService.getQueue().map((o) => o.workspaceId)).toEqual(['ws-B']);
    });
});
