/**
 * Workspace Service Batch Tests - updateWorkspaceOrder
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateWorkspaceOrder } from '../services/workspaceService';

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
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    })),
    query: vi.fn((ref: unknown) => ref),
    limit: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
}));

describe('WorkspaceService updateWorkspaceOrder', () => {
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

    describe('updateWorkspaceOrder', () => {
        it('should batch update orderIndex for provided workspaces', async () => {
            const mockBatchUpdate = vi.fn();
            const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

            const firestore = await import('firebase/firestore');
            vi.mocked(firestore.writeBatch).mockReturnValue({
                set: vi.fn(),
                delete: vi.fn(),
                update: mockBatchUpdate,
                commit: mockBatchCommit,
            } as unknown as ReturnType<typeof firestore.writeBatch>);

            await updateWorkspaceOrder('user-1', [
                { id: 'ws-1', orderIndex: 0 },
                { id: 'ws-2', orderIndex: 1 }
            ]);

            expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
            expect(mockBatchUpdate).toHaveBeenNthCalledWith(
                1,
                expect.anything(),
                expect.objectContaining({ orderIndex: 0 })
            );
            expect(mockBatchUpdate).toHaveBeenNthCalledWith(
                2,
                expect.anything(),
                expect.objectContaining({ orderIndex: 1 })
            );
            expect(mockBatchCommit).toHaveBeenCalled();
        });

        it('should chunk updates into batches of 500 max to respect Firestore limits', async () => {
            const mockBatchUpdate = vi.fn();
            const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

            const firestore = await import('firebase/firestore');
            vi.mocked(firestore.writeBatch).mockReturnValue({
                set: vi.fn(),
                delete: vi.fn(),
                update: mockBatchUpdate,
                commit: mockBatchCommit,
            } as unknown as ReturnType<typeof firestore.writeBatch>);

            const manyUpdates = Array.from({ length: 1200 }, (_, i) => ({
                id: `ws-${i}`,
                orderIndex: i
            }));

            await updateWorkspaceOrder('user-1', manyUpdates);

            expect(mockBatchUpdate).toHaveBeenCalledTimes(1200);
            expect(mockBatchCommit).toHaveBeenCalledTimes(3);
        });
    });
});
