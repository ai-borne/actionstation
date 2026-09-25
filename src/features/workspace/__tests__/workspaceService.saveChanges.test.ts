/**
 * saveNodeChanges / saveEdgeChanges — change-only writes used by autosave
 * after the first full sync. Must never read the collection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveNodeChanges, saveEdgeChanges } from '../services/workspaceService';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

vi.mock('@/config/firebase', () => ({ db: {} }));

class MockServerTimestamp { readonly _methodName = 'serverTimestamp'; }

const mockGetDocs = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();
const mockRunTransaction = vi.fn((_db: unknown, cb: (txn: unknown) => Promise<void>) =>
    cb({ set: mockSet, delete: mockDelete }));
const mockCleanup = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_, ...path: string[]) => ({ id: path[path.length - 1] })),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    writeBatch: vi.fn(() => ({ set: mockSet, delete: mockDelete, commit: vi.fn().mockResolvedValue(undefined) })),
    runTransaction: (...args: Parameters<typeof mockRunTransaction>) => mockRunTransaction(...args),
    query: vi.fn((ref: unknown) => ref),
    limit: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    // A class instance, like the real FieldValue: copying it into a plain object corrupts the write.
    serverTimestamp: vi.fn(() => new MockServerTimestamp()),
}));

vi.mock('../services/nodeStorageCleanup', () => ({
    cleanupDeletedNodeStorage: (...args: unknown[]) => mockCleanup(...args),
}));

const makeNode = (id: string, data: CanvasNode['data'] = { heading: 'Test' }): CanvasNode => ({
    id, workspaceId: 'ws-1', type: 'idea', data, position: { x: 0, y: 0 },
    createdAt: new Date(), updatedAt: new Date(),
});

const makeEdge = (id: string): CanvasEdge => ({
    id, workspaceId: 'ws-1', sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'related',
});

describe('saveNodeChanges', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('writes only the given nodes and never reads the collection', async () => {
        await saveNodeChanges('user-1', 'ws-1', [makeNode('n1')], []);

        expect(mockGetDocs).not.toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockSet.mock.calls[0]?.[0]).toEqual({ id: 'n1' });
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('deletes removed nodes and cleans up their Storage files', async () => {
        const removed = makeNode('n2');
        await saveNodeChanges('user-1', 'ws-1', [], [removed]);

        expect(mockDelete).toHaveBeenCalledWith({ id: 'n2' });
        expect(mockCleanup).toHaveBeenCalledWith([removed]);
    });

    it('makes no Firestore call when nothing changed', async () => {
        await saveNodeChanges('user-1', 'ws-1', [], []);

        expect(mockRunTransaction).not.toHaveBeenCalled();
        expect(mockCleanup).not.toHaveBeenCalled();
    });

    it('writes updatedAt as the server-timestamp value itself, not a plain-object copy', async () => {
        await saveNodeChanges('user-1', 'ws-1', [makeNode('n1')], []);

        const written = mockSet.mock.calls[0]?.[1] as { updatedAt: unknown };
        expect(written.updatedAt).toBeInstanceOf(MockServerTimestamp);
    });

    it('strips base64 images and writes ownership fields', async () => {
        const base64 = '<img src="data:image/png;base64,AAAA">';
        await saveNodeChanges('user-1', 'ws-1', [makeNode('n1', { heading: 'H', output: base64 })], []);

        const written = mockSet.mock.calls[0]?.[1] as { userId: string; workspaceId: string; data: { output: string } };
        expect(written.data.output).not.toContain('data:image');
        expect(written.userId).toBe('user-1');
        expect(written.workspaceId).toBe('ws-1');
    });
});

describe('saveEdgeChanges', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('writes only the given edges and deletes removed ids, without reads', async () => {
        await saveEdgeChanges('user-1', 'ws-1', [makeEdge('e1')], ['e2']);

        expect(mockGetDocs).not.toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockDelete).toHaveBeenCalledWith({ id: 'e2' });
    });

    it('makes no Firestore call when nothing changed', async () => {
        await saveEdgeChanges('user-1', 'ws-1', [], []);

        expect(mockRunTransaction).not.toHaveBeenCalled();
    });
});
