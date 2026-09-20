/**
 * Workspace Service Save Tests - Delete Sync Feature
 * Tests for saving nodes/edges with delete synchronization
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveNodes, saveEdges } from '../services/workspaceService';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

// Mock Firestore
vi.mock('@/config/firebase', () => ({
    db: {},
}));

// Mock Firestore functions
const mockGetDocs = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_, ...path: string[]) => ({ id: path[path.length - 1] })),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
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

describe('WorkspaceService Save with Delete Sync', () => {
    beforeEach(() => {
        mockGetDocs.mockReset();
        mockBatchSet.mockReset();
        mockBatchDelete.mockReset();
        mockBatchCommit.mockReset().mockResolvedValue(undefined);
    });

    describe('saveNodes', () => {
        const createMockNode = (id: string, overrides?: Partial<CanvasNode>): CanvasNode => ({
            id,
            workspaceId: 'ws-1',
            type: 'idea',
            data: { prompt: 'Test' },
            position: { x: 0, y: 0 },
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        });

        it('should delete nodes from Firestore that no longer exist locally', async () => {
            mockGetDocs.mockResolvedValue({
                docs: [
                    { id: 'node-a', data: () => ({ data: {} }) },
                    { id: 'node-b', data: () => ({ data: {} }) },
                    { id: 'node-c', data: () => ({ data: {} }) },
                ],
            });

            await saveNodes('user-1', 'ws-1', [
                createMockNode('node-a'),
                createMockNode('node-b'),
            ]);

            expect(mockBatchDelete).toHaveBeenCalled();
        });

        it('should save all current nodes', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            await saveNodes('user-1', 'ws-1', [
                createMockNode('node-a'),
                createMockNode('node-b'),
            ]);

            expect(mockBatchSet).toHaveBeenCalledTimes(2);
        });

        it('should handle empty nodes array', async () => {
            mockGetDocs.mockResolvedValue({
                docs: [{ id: 'node-a', data: () => ({ data: {} }) }],
            });

            await saveNodes('user-1', 'ws-1', []);

            expect(mockBatchDelete).toHaveBeenCalled();
        });

        // REGRESSION: Firebase undefined value sanitization
        it('should sanitize undefined values from node data (Firebase compatibility)', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            // Node with undefined optional fields (width, height, data.output)
            const nodeWithUndefined = createMockNode('node-1', {
                width: undefined,
                height: undefined,
                data: { prompt: 'Test', output: undefined, isGenerating: undefined },
            });

            await saveNodes('user-1', 'ws-1', [nodeWithUndefined]);

            expect(mockBatchSet).toHaveBeenCalledTimes(1);
            const savedData = mockBatchSet.mock.calls[0]?.[1] as Record<string, unknown>;

            // Verify undefined values are NOT in the saved data
            expect(savedData).not.toHaveProperty('width');
            expect(savedData).not.toHaveProperty('height');
            expect(savedData.data).not.toHaveProperty('output');
            expect(savedData.data).not.toHaveProperty('isGenerating');
            // Verify defined values ARE preserved
            expect((savedData.data as Record<string, unknown>).prompt).toBe('Test');
            expect(savedData.id).toBe('node-1');
        });

        // REGRESSION: Link preview nodes fail to save due to nested undefined values
        it('should strip undefined values from nested linkPreviews (deep sanitization)', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            const nodeWithLinkPreview = createMockNode('node-link', {
                data: {
                    prompt: 'Check this link',
                    output: 'https://x.com/example/status/123',
                    linkPreviews: {
                        'https://x.com/example/status/123': {
                            url: 'https://x.com/example/status/123',
                            title: undefined,
                            description: undefined,
                            image: undefined,
                            favicon: undefined,
                            domain: 'x.com',
                            cardType: undefined,
                            fetchedAt: 1700000000000,
                            error: undefined,
                        },
                    },
                },
            });

            await saveNodes('user-1', 'ws-1', [nodeWithLinkPreview]);

            expect(mockBatchSet).toHaveBeenCalledTimes(1);
            const savedData = mockBatchSet.mock.calls[0]?.[1] as Record<string, unknown>;
            const savedNodeData = savedData.data as Record<string, unknown>;
            const savedPreviews = savedNodeData.linkPreviews as Record<string, Record<string, unknown>>;
            const preview = savedPreviews['https://x.com/example/status/123']!;

            // Defined values must be preserved
            expect(preview.url).toBe('https://x.com/example/status/123');
            expect(preview.domain).toBe('x.com');
            expect(preview.fetchedAt).toBe(1700000000000);

            // Undefined values must be stripped (Firestore rejects undefined at any depth)
            expect(preview).not.toHaveProperty('title');
            expect(preview).not.toHaveProperty('description');
            expect(preview).not.toHaveProperty('image');
            expect(preview).not.toHaveProperty('favicon');
            expect(preview).not.toHaveProperty('cardType');
            expect(preview).not.toHaveProperty('error');
        });

        it('should preserve defined width/height when present', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            const nodeWithDimensions = createMockNode('node-1', {
                width: 300,
                height: 200,
            });

            await saveNodes('user-1', 'ws-1', [nodeWithDimensions]);

            const savedData = mockBatchSet.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(savedData.width).toBe(300);
            expect(savedData.height).toBe(200);
        });
    });

    describe('saveEdges', () => {
        const createMockEdge = (id: string): CanvasEdge => ({
            id,
            workspaceId: 'ws-1',
            sourceNodeId: 'node-1',
            targetNodeId: 'node-2',
            relationshipType: 'related',
        });

        it('should delete edges from Firestore that no longer exist locally', async () => {
            mockGetDocs.mockResolvedValue({
                docs: [
                    { id: 'edge-a' },
                    { id: 'edge-b' },
                ],
            });

            await saveEdges('user-1', 'ws-1', [createMockEdge('edge-a')]);

            expect(mockBatchDelete).toHaveBeenCalled();
        });

        it('should save all current edges', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            await saveEdges('user-1', 'ws-1', [
                createMockEdge('edge-a'),
                createMockEdge('edge-b'),
            ]);

            expect(mockBatchSet).toHaveBeenCalledTimes(2);
        });
    });
});
