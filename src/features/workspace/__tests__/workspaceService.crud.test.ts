/**
 * Workspace Service CRUD Tests - save, update, create
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveWorkspace, createNewWorkspace } from '../services/workspaceService';

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

describe('WorkspaceService CRUD', () => {
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

    describe('saveWorkspace', () => {
        it('should save workspace metadata to Firestore', async () => {
            mockSetDoc.mockResolvedValue(undefined);

            await saveWorkspace('user-1', {
                id: 'ws-1',
                userId: 'user-1',
                name: 'My Workspace',
                canvasSettings: { backgroundColor: 'grid' },
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            expect(mockSetDoc).toHaveBeenCalled();
        });
    });

    describe('updateWorkspaceNodeCount', () => {
        it('should update just the nodeCount and updatedAt on the workspace document', async () => {
            mockSetDoc.mockResolvedValue(undefined);
            const { updateWorkspaceNodeCount } = await import('../services/workspaceService');

            const firestore = await import('firebase/firestore');
            const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
            vi.mocked(firestore.updateDoc).mockImplementation(mockUpdateDoc);

            await updateWorkspaceNodeCount('user-1', 'ws-1', 42);

            expect(mockUpdateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ nodeCount: 42 })
            );
        });
    });

    describe('createNewWorkspace', () => {
        it('should create a new workspace with generated ID', async () => {
            mockSetDoc.mockResolvedValue(undefined);

            const result = await createNewWorkspace('user-1', 'My New Workspace');

            expect(mockSetDoc).toHaveBeenCalled();
            expect(result.name).toBe('My New Workspace');
            expect(result.userId).toBe('user-1');
            expect(result.id).toBeDefined();
            expect(result.id.length).toBeGreaterThan(0);
            expect(result.nodeCount).toBe(0);
        });

        it('should use default name if none provided', async () => {
            mockSetDoc.mockResolvedValue(undefined);

            const result = await createNewWorkspace('user-1');

            expect(result.name).toBe('Untitled Workspace');
        });
    });

    describe('createNewDividerWorkspace', () => {
        it('should create a divider item instead of a normal workspace', async () => {
            mockSetDoc.mockResolvedValue(undefined);
            const { createNewDividerWorkspace } = await import('../services/workspaceService');

            const result = await createNewDividerWorkspace('user-2');

            expect(mockSetDoc).toHaveBeenCalled();
            expect(result.type).toBe('divider');
            expect(result.name).toBe('---');
            expect(result.userId).toBe('user-2');
            expect(result.id).toBeDefined();
            expect(result.id).toContain('divider-');
        });
    });
});
