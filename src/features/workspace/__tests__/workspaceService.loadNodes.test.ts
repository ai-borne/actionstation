/**
 * Workspace Service Load Nodes Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadNodes } from '../services/workspaceService';

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

describe('WorkspaceService loadNodes', () => {
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

    describe('loadNodes', () => {
        it('should return empty array when no nodes exist', async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });

            const result = await loadNodes('user-1', 'ws-1');

            expect(result).toEqual([]);
        });

        it('should return nodes with correct structure', async () => {
            const mockTimestamp = { toDate: () => new Date('2024-01-01') };
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'node-1',
                            type: 'idea',
                            data: { prompt: 'Test prompt', output: 'Test output' },
                            position: { x: 100, y: 200 },
                            createdAt: mockTimestamp,
                            updatedAt: mockTimestamp,
                        }),
                    },
                    {
                        data: () => ({
                            id: 'node-2',
                            type: 'idea',
                            data: { prompt: 'Another prompt', output: undefined },
                            position: { x: 300, y: 400 },
                            createdAt: mockTimestamp,
                            updatedAt: mockTimestamp,
                        }),
                    },
                ],
            });

            const result = await loadNodes('user-1', 'ws-1');

            expect(result).toHaveLength(2);
            const firstNode = result[0]!;
            const secondNode = result[1]!;
            expect(firstNode.id).toBe('node-1');
            expect(firstNode.type).toBe('idea');
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            expect(firstNode.data.prompt).toBe('Test prompt');
            expect(firstNode.data.output).toBe('Test output');
            expect(firstNode.position).toEqual({ x: 100, y: 200 });
            expect(secondNode.id).toBe('node-2');
        });

        it('should handle nodes without timestamps gracefully', async () => {
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'node-1',
                            type: 'idea',
                            data: { prompt: 'Test' },
                            position: { x: 0, y: 0 },
                        }),
                    },
                ],
            });

            const result = await loadNodes('user-1', 'ws-1');

            const node = result[0]!;
            expect(node.id).toBe('node-1');
            expect(node.createdAt).toBeInstanceOf(Date);
            expect(node.updatedAt).toBeInstanceOf(Date);
        });

        it('should restore width and height when present in Firestore', async () => {
            const mockTimestamp = { toDate: () => new Date('2024-01-01') };
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'node-1',
                            type: 'idea',
                            data: { prompt: 'Test prompt', output: 'Test output' },
                            position: { x: 100, y: 200 },
                            width: 350,
                            height: 200,
                            createdAt: mockTimestamp,
                            updatedAt: mockTimestamp,
                        }),
                    },
                ],
            });

            const result = await loadNodes('user-1', 'ws-1');

            const node = result[0]!;
            expect(node.width).toBe(350);
            expect(node.height).toBe(200);
        });

        it('should handle nodes without width/height (default undefined)', async () => {
            const mockTimestamp = { toDate: () => new Date('2024-01-01') };
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'node-1',
                            type: 'idea',
                            data: { prompt: 'Test' },
                            position: { x: 0, y: 0 },
                            createdAt: mockTimestamp,
                            updatedAt: mockTimestamp,
                        }),
                    },
                ],
            });

            const result = await loadNodes('user-1', 'ws-1');

            const node = result[0]!;
            expect(node.width).toBeUndefined();
            expect(node.height).toBeUndefined();
        });

        it('maps legacy "primary" colorKey to "danger" on load', async () => {
            const mockTimestamp = { toDate: () => new Date('2024-01-01') };
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'node-1',
                            type: 'idea',
                            data: { prompt: 'Test', colorKey: 'primary' },
                            position: { x: 0, y: 0 },
                            createdAt: mockTimestamp,
                            updatedAt: mockTimestamp,
                        }),
                    },
                ],
            });

            const result = await loadNodes('user-1', 'ws-1');
            expect(result[0]?.data.colorKey).toBe('danger');
        });

        it('normalizes invalid node colorKey to default', async () => {
            const mockTimestamp = { toDate: () => new Date('2024-01-01') };
            mockGetDocs.mockResolvedValue({
                docs: [
                    {
                        data: () => ({
                            id: 'node-1',
                            type: 'idea',
                            data: { prompt: 'Test', colorKey: 'invalid-color' },
                            position: { x: 0, y: 0 },
                            createdAt: mockTimestamp,
                            updatedAt: mockTimestamp,
                        }),
                    },
                ],
            });

            const result = await loadNodes('user-1', 'ws-1');
            expect(result[0]?.data.colorKey).toBe('default');
        });
    });
});
