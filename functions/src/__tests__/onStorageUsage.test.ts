/**
 * onStorageUsage trigger handler tests
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

type StorageHandler = (event: { data: { name: string; size?: string | number } }) => Promise<void>;

const handlers = vi.hoisted(() => ({
    finalized: null as StorageHandler | null,
    deleted: null as StorageHandler | null,
}));

const mockRecordFinalized = vi.fn();
const mockRecordDeleted = vi.fn();

function captureStorageHandler(...args: unknown[]): StorageHandler {
    const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as StorageHandler;
    return fn;
}

vi.mock('../utils/storageUsageAdmin.js', () => ({
    parseUserIdFromStoragePath: (path: string) => {
        const match = /^users\/([^/]+)\//.exec(path);
        return match?.[1] ?? null;
    },
    recordStorageObjectFinalized: mockRecordFinalized,
    recordStorageObjectDeleted: mockRecordDeleted,
}));

vi.mock('firebase-functions/v2/storage', () => ({
    onObjectFinalized: (...args: unknown[]) => {
        handlers.finalized = captureStorageHandler(...args);
        return handlers.finalized;
    },
    onObjectDeleted: (...args: unknown[]) => {
        handlers.deleted = captureStorageHandler(...args);
        return handlers.deleted;
    },
}));

vi.mock('firebase-functions/v2', () => ({
    logger: { info: vi.fn(), warn: vi.fn() },
}));

describe('onStorageUsage triggers', () => {
    beforeAll(async () => {
        await import('../onStorageUsage.js');
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockRecordFinalized.mockResolvedValue(undefined);
        mockRecordDeleted.mockResolvedValue(undefined);
    });

    it('records usage on object finalized for user path', async () => {
        const path = 'users/user-1/workspaces/ws/nodes/n1/a.png';
        await handlers.finalized!({ data: { name: path, size: '2048' } });
        expect(mockRecordFinalized).toHaveBeenCalledWith('user-1', path, 2048);
    });

    it('records usage removal on object deleted for user path', async () => {
        const path = 'users/user-1/workspaces/ws/nodes/n1/a.png';
        await handlers.deleted!({ data: { name: path, size: 1024 } });
        expect(mockRecordDeleted).toHaveBeenCalledWith('user-1', path, 1024);
    });

    it('skips non-user storage paths', async () => {
        await handlers.finalized!({
            data: { name: 'shared-snapshots/snap-1.png', size: '500' },
        });
        expect(mockRecordFinalized).not.toHaveBeenCalled();
    });

    it('skips zero-size finalized objects', async () => {
        await handlers.finalized!({
            data: { name: 'users/user-1/a.png', size: '0' },
        });
        expect(mockRecordFinalized).not.toHaveBeenCalled();
    });

    it('still processes delete when reported size is zero (tracked bytes used server-side)', async () => {
        const path = 'users/user-1/a.png';
        await handlers.deleted!({ data: { name: path, size: '0' } });
        expect(mockRecordDeleted).toHaveBeenCalledWith('user-1', path, 0);
    });
});
