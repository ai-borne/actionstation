/**
 * onStorageUsage trigger handler tests
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

type StorageHandler = (event: { data: { name: string; size?: string | number } }) => Promise<void>;

const handlers = vi.hoisted(() => ({
    finalized: null as StorageHandler | null,
    deleted: null as StorageHandler | null,
}));

const mockAdjustStorageUsage = vi.fn();

function captureStorageHandler(...args: unknown[]): StorageHandler {
    const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as StorageHandler;
    return fn;
}

vi.mock('../utils/storageUsageAdmin.js', () => ({
    adjustStorageUsage: mockAdjustStorageUsage,
    parseUserIdFromStoragePath: (path: string) => {
        const match = /^users\/([^/]+)\//.exec(path);
        return match?.[1] ?? null;
    },
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
        mockAdjustStorageUsage.mockResolvedValue(undefined);
    });

    it('increments usage on object finalized for user path', async () => {
        await handlers.finalized!({
            data: { name: 'users/user-1/workspaces/ws/nodes/n1/a.png', size: '2048' },
        });
        expect(mockAdjustStorageUsage).toHaveBeenCalledWith('user-1', 2048);
    });

    it('decrements usage on object deleted for user path', async () => {
        await handlers.deleted!({
            data: { name: 'users/user-1/workspaces/ws/nodes/n1/a.png', size: 1024 },
        });
        expect(mockAdjustStorageUsage).toHaveBeenCalledWith('user-1', -1024);
    });

    it('skips non-user storage paths', async () => {
        await handlers.finalized!({
            data: { name: 'shared-snapshots/snap-1.png', size: '500' },
        });
        expect(mockAdjustStorageUsage).not.toHaveBeenCalled();
    });

    it('skips zero-size objects', async () => {
        await handlers.finalized!({
            data: { name: 'users/user-1/a.png', size: '0' },
        });
        expect(mockAdjustStorageUsage).not.toHaveBeenCalled();
    });
});
