/**
 * Workspace Service Load Edges Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadEdges } from '../services/workspaceService';

vi.mock('@/config/firebase', () => ({ db: {} }));

const mockSetDoc = vi.fn();
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockGetCountFromServer = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({ id: 'mock-ref' })),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    getCountFromServer: (...args: unknown[]) => mockGetCountFromServer(...args),
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

describe('WorkspaceService loadEdges', () => {
    beforeEach(() => {
        mockGetDoc.mockReset();
        mockGetDocs.mockReset();
        mockSetDoc.mockReset();
        mockGetCountFromServer.mockReset();
        mockSetDoc.mockResolvedValue(undefined);
        mockGetCountFromServer.mockResolvedValue({
            data: () => ({ count: 0 }),
        });
    });

    describe('loadEdges', () => {
        it('should return empty array when no edges exist', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            const result = await loadEdges('user-1', 'ws-1');

            expect(result).toEqual([]);
        });

        it('should return edges with correct structure', async () => {
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'edge-1',
                            sourceNodeId: 'node-1',
                            targetNodeId: 'node-2',
                            relationshipType: 'related',
                        }),
                    },
                    {
                        data: () => ({
                            id: 'edge-2',
                            sourceNodeId: 'node-2',
                            targetNodeId: 'node-3',
                            relationshipType: 'derived',
                        }),
                    },
                ],
            });

            const result = await loadEdges('user-1', 'ws-1');

            expect(result).toHaveLength(2);
            const firstEdge = result[0]!;
            const secondEdge = result[1]!;
            expect(firstEdge.id).toBe('edge-1');
            expect(firstEdge.sourceNodeId).toBe('node-1');
            expect(firstEdge.targetNodeId).toBe('node-2');
            expect(firstEdge.relationshipType).toBe('related');
            expect(secondEdge.id).toBe('edge-2');
        });
    });
});
