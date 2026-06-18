/**
 * storageUsageAdmin tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn();
const mockDelete = vi.fn();
const mockGet = vi.fn();
const mockRunTransaction = vi.fn();
const mockDoc = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        doc: mockDoc,
        runTransaction: mockRunTransaction,
    }),
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

vi.mock('firebase-functions/v2', () => ({
    logger: { warn: vi.fn() },
}));

function makeSnap(exists: boolean, data: Record<string, unknown> = {}) {
    return { exists, data: () => data };
}

describe('storageUsageAdmin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDoc.mockImplementation((path: string) => path);
        mockRunTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
            await cb({ get: mockGet, set: mockSet, delete: mockDelete });
        });
    });

    it('parseUserIdFromStoragePath extracts uid', async () => {
        const { parseUserIdFromStoragePath } = await import('../storageUsageAdmin.js');
        expect(parseUserIdFromStoragePath('users/u1/workspaces/ws/nodes/n1/a.png')).toBe('u1');
        expect(parseUserIdFromStoragePath('shared-snapshots/x')).toBeNull();
    });

    it('storagePathToDocId is slash-safe', async () => {
        const { storagePathToDocId } = await import('../storageUsageAdmin.js');
        const id = storagePathToDocId('users/u1/a.png');
        expect(id).not.toContain('/');
    });

    it('recordStorageObjectFinalized adds full size for new object', async () => {
        mockGet
            .mockResolvedValueOnce(makeSnap(true, { totalBytes: 100 }))
            .mockResolvedValueOnce(makeSnap(false));
        const { recordStorageObjectFinalized } = await import('../storageUsageAdmin.js');
        await recordStorageObjectFinalized('user-1', 'users/user-1/a.png', 50);
        expect(mockSet).toHaveBeenCalledWith(
            'users/user-1/usage/storage',
            expect.objectContaining({ totalBytes: 150 }),
            { merge: true },
        );
    });

    it('recordStorageObjectFinalized only adds delta on re-upload', async () => {
        mockGet
            .mockResolvedValueOnce(makeSnap(true, { totalBytes: 2048 }))
            .mockResolvedValueOnce(makeSnap(true, { bytes: 2048 }));
        const { recordStorageObjectFinalized } = await import('../storageUsageAdmin.js');
        await recordStorageObjectFinalized('user-1', 'users/user-1/a.png', 3000);
        expect(mockSet).toHaveBeenCalledWith(
            'users/user-1/usage/storage',
            expect.objectContaining({ totalBytes: 3000 }),
            { merge: true },
        );
    });

    it('recordStorageObjectFinalized skips when size unchanged', async () => {
        mockGet
            .mockResolvedValueOnce(makeSnap(true, { totalBytes: 2048 }))
            .mockResolvedValueOnce(makeSnap(true, { bytes: 2048 }));
        const { recordStorageObjectFinalized } = await import('../storageUsageAdmin.js');
        await recordStorageObjectFinalized('user-1', 'users/user-1/a.png', 2048);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('recordStorageObjectDeleted uses tracked bytes', async () => {
        mockGet
            .mockResolvedValueOnce(makeSnap(true, { totalBytes: 5000 }))
            .mockResolvedValueOnce(makeSnap(true, { bytes: 2048 }));
        const { recordStorageObjectDeleted, storagePathToDocId } = await import('../storageUsageAdmin.js');
        const path = 'users/user-1/a.png';
        const objectDocPath = `users/user-1/usage/storageObjects/${storagePathToDocId(path)}`;
        await recordStorageObjectDeleted('user-1', path, 999);
        expect(mockSet).toHaveBeenCalledWith(
            'users/user-1/usage/storage',
            expect.objectContaining({ totalBytes: 2952 }),
            { merge: true },
        );
        expect(mockDelete).toHaveBeenCalledWith(objectDocPath);
    });
});
