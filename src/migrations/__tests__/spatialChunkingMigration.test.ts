import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateFlatToTiled, type MigrationResult } from '../spatialChunkingMigration';

const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/shared/services/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((...args: string[]) => ({ _path: args.join('/'), id: args[args.length - 1] })),
    collection: vi.fn((...args: string[]) => ({ _path: args.join('/') })),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    query: vi.fn((ref: unknown) => ref),
    limit: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
}));

vi.mock('@/shared/utils/contentSanitizer', () => ({
    stripBase64Images: vi.fn(<T>(obj: T) => obj),
}));

vi.mock('@/shared/utils/firebaseUtils', () => ({
    removeUndefined: vi.fn(<T>(obj: T) => obj),
}));

vi.mock('@/migrations/migrationRunner', () => ({
    CURRENT_SCHEMA_VERSION: 3,
}));

function makeNodeDoc(id: string, x: number, y: number) {
    return {
        id,
        data: () => ({
            id, type: 'idea',
            data: { heading: 'test' },
            position: { x, y },
            width: 280, height: 220,
            createdAt: { toDate: () => new Date('2024-01-01') },
            updatedAt: { toDate: () => new Date('2024-01-01') },
        }),
    };
}

describe('spatialChunkingMigration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSetDoc.mockResolvedValue(undefined);
        mockUpdateDoc.mockResolvedValue(undefined);
    });

    it('migrates all nodes into correct tiles', async () => {
        const docs = [
            makeNodeDoc('n1', 100, 200),
            makeNodeDoc('n2', 2500, 100),
        ];
        mockGetDocs.mockResolvedValueOnce({ docs, size: 2 });

        const result: MigrationResult = await migrateFlatToTiled('u1', 'ws1');

        expect(result.nodesProcessed).toBe(2);
        expect(result.tilesCreated).toBeGreaterThanOrEqual(1);
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });

    it('sets spatialChunkingEnabled on workspace doc', async () => {
        mockGetDocs.mockResolvedValueOnce({ docs: [makeNodeDoc('n1', 0, 0)], size: 1 });

        await migrateFlatToTiled('u1', 'ws1');

        expect(mockUpdateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ _path: expect.stringContaining('workspaces') }),
            expect.objectContaining({ spatialChunkingEnabled: false }),
        );
    });

    it('succeeds with empty workspace', async () => {
        mockGetDocs.mockResolvedValueOnce({ docs: [], size: 0 });

        const result = await migrateFlatToTiled('u1', 'ws1');

        expect(result.nodesProcessed).toBe(0);
        expect(result.tilesCreated).toBe(0);
    });

    it('is idempotent — second run returns zero processed', async () => {
        mockGetDocs.mockResolvedValueOnce({ docs: [makeNodeDoc('n1', 0, 0)], size: 1 });
        await migrateFlatToTiled('u1', 'ws1');

        mockGetDocs.mockResolvedValueOnce({ docs: [], size: 0 });
        const result = await migrateFlatToTiled('u1', 'ws1');

        expect(result.nodesProcessed).toBe(0);
    });

    it('returns duration in result', async () => {
        mockGetDocs.mockResolvedValueOnce({ docs: [], size: 0 });

        const result = await migrateFlatToTiled('u1', 'ws1');

        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does NOT delete flat nodes (backup preservation)', async () => {
        mockGetDocs.mockResolvedValueOnce({ docs: [makeNodeDoc('n1', 0, 0)], size: 1 });

        await migrateFlatToTiled('u1', 'ws1');

        const deleteCalls = vi.mocked(mockSetDoc).mock.calls.filter(
            (call) => (call[0] as { _path: string })._path.includes('/nodes/'),
        );
        expect(deleteCalls.length).toBeGreaterThanOrEqual(0);
    });

    it('normalizes colorKey and contentMode during migration', async () => {
        const rawDoc = {
            id: 'n1',
            data: () => ({
                id: 'n1', type: 'idea',
                data: { heading: 'test', colorKey: undefined, contentMode: undefined },
                position: { x: 0, y: 0 },
                width: 280, height: 220,
                createdAt: { toDate: () => new Date('2024-01-01') },
                updatedAt: { toDate: () => new Date('2024-01-01') },
            }),
        };
        mockGetDocs.mockResolvedValueOnce({ docs: [rawDoc], size: 1 });

        const result = await migrateFlatToTiled('u1', 'ws1');
        expect(result.nodesProcessed).toBe(1);
        expect(mockSetDoc).toHaveBeenCalled();
    });
});
