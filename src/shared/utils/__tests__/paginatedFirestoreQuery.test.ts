/**
 * paginatedFirestoreQuery tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAllCollectionDocs } from '../paginatedFirestoreQuery';
import { FIRESTORE_QUERY_CAP } from '@/config/firestoreQueryConfig';

const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    query: vi.fn((ref: unknown) => ref),
    limit: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
}));

function makeDoc(id: string) {
    return { id, data: () => ({ id }) };
}

function makeSnapshot(docs: Array<ReturnType<typeof makeDoc>>) {
    return { docs };
}

describe('fetchAllCollectionDocs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns empty array when collection has no docs', async () => {
        mockGetDocs.mockResolvedValueOnce(makeSnapshot([]));
        const result = await fetchAllCollectionDocs({} as never);
        expect(result).toEqual([]);
        expect(mockGetDocs).toHaveBeenCalledTimes(1);
    });

    it('returns single page when below FIRESTORE_QUERY_CAP', async () => {
        const docs = [makeDoc('n1'), makeDoc('n2')];
        mockGetDocs.mockResolvedValueOnce(makeSnapshot(docs));
        const result = await fetchAllCollectionDocs({} as never);
        expect(result).toHaveLength(2);
        expect(mockGetDocs).toHaveBeenCalledTimes(1);
    });

    it('paginates when first page equals FIRESTORE_QUERY_CAP', async () => {
        const page1 = Array.from({ length: FIRESTORE_QUERY_CAP }, (_, i) => makeDoc(`n${i}`));
        const page2 = [makeDoc('overflow-1'), makeDoc('overflow-2')];
        mockGetDocs
            .mockResolvedValueOnce(makeSnapshot(page1))
            .mockResolvedValueOnce(makeSnapshot(page2));

        const result = await fetchAllCollectionDocs({} as never);
        expect(result).toHaveLength(FIRESTORE_QUERY_CAP + 2);
        expect(mockGetDocs).toHaveBeenCalledTimes(2);
    });
});
