/**
 * Node Ownership Fields — Integration test
 * Verifies backward compatibility: loadNodes works with documents
 * that lack the userId field (simulating legacy documents).
 */
import { describe, it, expect, vi } from 'vitest';
import { loadNodes, loadEdges } from '../services/workspaceService';

const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({ id: 'mock-ref' })),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn(),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    getCountFromServer: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
    writeBatch: vi.fn(() => ({
        set: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    })),
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

describe('Backward compatibility — documents without userId', () => {
    it('loadNodes works with legacy documents lacking userId', async () => {
        mockGetDocs.mockResolvedValue({
            docs: [{
                id: 'n1',
                data: () => ({
                    id: 'n1',
                    type: 'idea',
                    data: { heading: 'Legacy node', colorKey: 'default' },
                    position: { x: 10, y: 20 },
                    width: 280,
                    height: 220,
                    createdAt: { toDate: () => new Date('2024-01-01') },
                    updatedAt: { toDate: () => new Date('2024-01-02') },
                }),
            }],
            size: 1,
        });

        const nodes = await loadNodes('user-1', 'ws-1');
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.id).toBe('n1');
        expect(nodes[0]!.workspaceId).toBe('ws-1');
        expect(nodes[0]!.userId).toBeUndefined();
    });

    it('loadEdges works with legacy documents lacking userId', async () => {
        mockGetDocs.mockResolvedValue({
            docs: [{
                id: 'e1',
                data: () => ({
                    id: 'e1',
                    sourceNodeId: 'n1',
                    targetNodeId: 'n2',
                    relationshipType: 'related',
                }),
            }],
            size: 1,
        });

        const edges = await loadEdges('user-1', 'ws-1');
        expect(edges).toHaveLength(1);
        expect(edges[0]!.id).toBe('e1');
    });
});
