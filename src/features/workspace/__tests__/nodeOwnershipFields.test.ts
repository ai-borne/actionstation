/**
 * Node Ownership Fields — Unit tests
 * Verifies that userId and workspaceId are written to Firestore node/edge documents.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendNode, saveNodes, saveEdges } from '../services/workspaceService';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDocs = vi.fn().mockResolvedValue({ docs: [], size: 0 });
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_, ...path: string[]) => ({ id: path[path.length - 1] })),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    getDoc: vi.fn(),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    getCountFromServer: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
    writeBatch: vi.fn(() => ({
        set: mockBatchSet,
        delete: mockBatchDelete,
        commit: mockBatchCommit,
    })),
    runTransaction: vi.fn((_db: unknown, cb: (txn: unknown) => Promise<void>) => {
        const txn = { set: mockBatchSet, delete: mockBatchDelete };
        return cb(txn);
    }),
    query: vi.fn((ref: unknown) => ref),
    limit: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
}));

vi.mock('@/config/firebase', () => ({
    db: {},
}));

vi.mock('@/shared/localization/strings', () => ({
    strings: { workspace: { untitled: 'Untitled' }, errors: {} },
}));

const TEST_USER_ID = 'user-123';
const TEST_WORKSPACE_ID = 'ws-456';

function makeNode(id: string): CanvasNode {
    return {
        id,
        workspaceId: TEST_WORKSPACE_ID,
        type: 'idea',
        data: { heading: 'Test' },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function makeEdge(id: string): CanvasEdge {
    return {
        id,
        workspaceId: TEST_WORKSPACE_ID,
        sourceNodeId: 'n1',
        targetNodeId: 'n2',
        relationshipType: 'related',
    };
}

describe('Node/Edge ownership fields', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDocs.mockResolvedValue({ docs: [], size: 0 });
    });

    it('appendNode writes userId and workspaceId to Firestore', async () => {
        await appendNode(TEST_USER_ID, TEST_WORKSPACE_ID, makeNode('n1'));
        const [, docData] = mockSetDoc.mock.calls[0]!;
        expect(docData.userId).toBe(TEST_USER_ID);
        expect(docData.workspaceId).toBe(TEST_WORKSPACE_ID);
    });

    it('saveNodes writes userId and workspaceId to each node', async () => {
        await saveNodes(TEST_USER_ID, TEST_WORKSPACE_ID, [makeNode('n1'), makeNode('n2')]);
        for (const call of mockBatchSet.mock.calls) {
            const docData = call[1] as Record<string, unknown>;
            expect(docData.userId).toBe(TEST_USER_ID);
            expect(docData.workspaceId).toBe(TEST_WORKSPACE_ID);
        }
    });

    it('saveEdges writes userId and workspaceId to each edge', async () => {
        await saveEdges(TEST_USER_ID, TEST_WORKSPACE_ID, [makeEdge('e1')]);
        const [, docData] = mockBatchSet.mock.calls[0]!;
        expect((docData as Record<string, unknown>).userId).toBe(TEST_USER_ID);
        expect((docData as Record<string, unknown>).workspaceId).toBe(TEST_WORKSPACE_ID);
    });
});
