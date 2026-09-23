/**
 * Knowledge Bank Service Tests
 * TDD: Tests for Firestore CRUD (mocked)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firebase before imports
vi.mock('@/config/firebase', () => ({
    db: {},
}));

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    serverTimestamp: vi.fn(() => new Date()),
    getCountFromServer: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
    query: vi.fn((...args: unknown[]) => args[0]),
    limit: vi.fn(),
    where: vi.fn(),
    writeBatch: vi.fn(() => ({ delete: vi.fn(), commit: vi.fn() })),
}));

vi.mock('../utils/sanitizer', () => ({
    sanitizeContent: (s: string) => s.replace(/<[^>]*>/g, ''), // basic strip for tests
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import { addKBEntry, updateKBEntry, deleteKBEntry, loadKBEntries, getServerDocumentCount } from '../services/knowledgeBankService';
// eslint-disable-next-line import-x/first
import { setDoc, getDocs, deleteDoc, getCountFromServer } from 'firebase/firestore';
// eslint-disable-next-line import-x/first
import type { KnowledgeBankEntryInput } from '../types/knowledgeBank';

describe('knowledgeBankService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const validInput: KnowledgeBankEntryInput = {
        type: 'text',
        title: 'Test Entry',
        content: 'Some test content',
    };

    describe('addKBEntry', () => {
        it('creates entry and calls setDoc', async () => {
            const entry = await addKBEntry('user-1', 'ws-1', validInput);
            expect(entry.title).toBe('Test Entry');
            expect(entry.content).toBe('Some test content');
            expect(entry.type).toBe('text');
            expect(entry.enabled).toBe(true);
            expect(entry.id).toMatch(/^kb-/);
            expect(setDoc).toHaveBeenCalledTimes(1);
        });

        it('rejects empty title', async () => {
            await expect(
                addKBEntry('user-1', 'ws-1', { ...validInput, title: '  ' })
            ).rejects.toThrow();
        });

        it('rejects oversized content', async () => {
            const bigContent = 'x'.repeat(10_001);
            await expect(
                addKBEntry('user-1', 'ws-1', { ...validInput, content: bigContent })
            ).rejects.toThrow();
        });

        it('rejects when max documents reached (server count)', async () => {
            vi.mocked(getCountFromServer).mockResolvedValueOnce(
                { data: () => ({ count: 25 }) } as never
            );

            await expect(
                addKBEntry('user-1', 'ws-1', validInput)
            ).rejects.toThrow();
        });

        it('uses getCountFromServer when currentCount is not provided', async () => {
            vi.mocked(getCountFromServer).mockResolvedValueOnce(
                { data: () => ({ count: 5 }) } as never
            );

            await addKBEntry('user-1', 'ws-1', validInput);
            expect(getCountFromServer).toHaveBeenCalledTimes(1);
        });

        it('skips server count when currentCount is provided', async () => {
            await addKBEntry('user-1', 'ws-1', validInput, undefined, 5);
            expect(getCountFromServer).not.toHaveBeenCalled();
        });

        it('writes pinned: false to Firestore for new entries', async () => {
            const entry = await addKBEntry('user-1', 'ws-1', validInput);
            expect(entry.pinned).toBe(false);
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            expect(passedData).toHaveProperty('pinned', false);
        });

        it('generates a crypto.randomUUID()-based id, not Date.now()', async () => {
            const entry = await addKBEntry('user-1', 'ws-1', validInput);
            expect(entry.id).toMatch(
                /^kb-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
        });

        it('persists storedFileName to Firestore when provided', async () => {
            const entry = await addKBEntry('user-1', 'ws-1', {
                ...validInput,
                originalFileName: 'photo.png',
                storedFileName: 'My Photo.jpg',
            });
            expect(entry.storedFileName).toBe('My Photo.jpg');
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            expect(passedData).toHaveProperty('storedFileName', 'My Photo.jpg');
        });

        it('omits storedFileName from Firestore when not provided', async () => {
            await addKBEntry('user-1', 'ws-1', validInput);
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            expect(passedData).not.toHaveProperty('storedFileName');
        });
    });

    describe('updateKBEntry', () => {
        it('calls setDoc with merge', async () => {
            await updateKBEntry('user-1', 'ws-1', 'kb-1', { title: 'Updated' });
            expect(setDoc).toHaveBeenCalledTimes(1);
        });

        it('rejects empty title update', async () => {
            await expect(
                updateKBEntry('user-1', 'ws-1', 'kb-1', { title: '' })
            ).rejects.toThrow();
        });

        it('rejects oversized content update', async () => {
            const bigContent = 'x'.repeat(10_001);
            await expect(
                updateKBEntry('user-1', 'ws-1', 'kb-1', { content: bigContent })
            ).rejects.toThrow();
        });

        it('sanitizes tags by stripping HTML', async () => {
            await updateKBEntry('user-1', 'ws-1', 'kb-1', {
                tags: ['<b>evil</b>', 'clean'],
            });
            expect(setDoc).toHaveBeenCalledTimes(1);
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            const tags = passedData.tags as string[];
            expect(tags[0]).not.toContain('<b>');
        });

        it('enforces max tags per entry', async () => {
            const tooManyTags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
            await updateKBEntry('user-1', 'ws-1', 'kb-1', { tags: tooManyTags });
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            const tags = passedData.tags as string[];
            expect(tags.length).toBeLessThanOrEqual(5);
        });

        it('enforces max tag length', async () => {
            const longTag = 'a'.repeat(50);
            await updateKBEntry('user-1', 'ws-1', 'kb-1', { tags: [longTag] });
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            const tags = passedData.tags as string[];
            expect(tags[0]!.length).toBeLessThanOrEqual(30);
        });

        it('deduplicates tags', async () => {
            await updateKBEntry('user-1', 'ws-1', 'kb-1', {
                tags: ['alpha', 'Alpha', 'ALPHA'],
            });
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            const tags = passedData.tags as string[];
            expect(tags).toEqual(['alpha']);
        });

        it('persists pinned: true to Firestore', async () => {
            await updateKBEntry('user-1', 'ws-1', 'kb-1', { pinned: true });
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            expect(passedData.pinned).toBe(true);
        });

        it('persists pinned: false to Firestore', async () => {
            await updateKBEntry('user-1', 'ws-1', 'kb-1', { pinned: false });
            const passedData = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
            expect(passedData.pinned).toBe(false);
        });
    });

    describe('deleteKBEntry', () => {
        it('calls deleteDoc', async () => {
            await deleteKBEntry('user-1', 'ws-1', 'kb-1');
            expect(deleteDoc).toHaveBeenCalledTimes(1);
        });
    });

    describe('getServerDocumentCount', () => {
        it('returns server-side document count via getCountFromServer', async () => {
            vi.mocked(getCountFromServer).mockResolvedValueOnce(
                { data: () => ({ count: 12 }) } as never
            );
            const count = await getServerDocumentCount('user-1', 'ws-1');
            expect(count).toBe(12);
            expect(getCountFromServer).toHaveBeenCalledTimes(1);
        });

        it('returns zero when no documents', async () => {
            vi.mocked(getCountFromServer).mockResolvedValueOnce(
                { data: () => ({ count: 0 }) } as never
            );
            const count = await getServerDocumentCount('user-1', 'ws-1');
            expect(count).toBe(0);
        });
    });

    describe('loadKBEntries', () => {
        it('returns empty array when no entries', async () => {
            vi.mocked(getDocs).mockResolvedValueOnce({ docs: [] } as never);
            const entries = await loadKBEntries('user-1', 'ws-1');
            expect(entries).toEqual([]);
        });

        it('maps Firestore docs to KnowledgeBankEntry', async () => {
            const mockDocs = [{
                id: 'kb-1',
                data: () => ({
                    type: 'text', title: 'Test',
                    content: 'Content', enabled: true,
                    createdAt: { toDate: () => new Date('2026-01-01') },
                    updatedAt: { toDate: () => new Date('2026-01-02') },
                }),
            }];
            vi.mocked(getDocs).mockResolvedValueOnce({ docs: mockDocs } as never);

            const entries = await loadKBEntries('user-1', 'ws-1');
            expect(entries).toHaveLength(1);
            expect(entries[0]!.id).toBe('kb-1');
            expect(entries[0]!.title).toBe('Test');
            expect(entries[0]!.workspaceId).toBe('ws-1');
        });

        it('defaults pinned to false for legacy entries without pinned field', async () => {
            const mockDocs = [{
                id: 'kb-legacy',
                data: () => ({
                    type: 'text', title: 'Legacy', content: 'Old entry',
                    enabled: true,
                    createdAt: { toDate: () => new Date() },
                    updatedAt: { toDate: () => new Date() },
                    // No pinned field — legacy data
                }),
            }];
            vi.mocked(getDocs).mockResolvedValueOnce({ docs: mockDocs } as never);

            const entries = await loadKBEntries('user-1', 'ws-1');
            expect(entries[0]!.pinned).toBe(false);
        });

        it('maps storedFileName from Firestore', async () => {
            const mockDocs = [{
                id: 'kb-img',
                data: () => ({
                    type: 'image', title: 'Photo', content: 'A photo',
                    enabled: true,
                    originalFileName: 'photo.png',
                    storedFileName: 'Photo.jpg',
                    createdAt: { toDate: () => new Date() },
                    updatedAt: { toDate: () => new Date() },
                }),
            }];
            vi.mocked(getDocs).mockResolvedValueOnce({ docs: mockDocs } as never);

            const entries = await loadKBEntries('user-1', 'ws-1');
            expect(entries[0]!.storedFileName).toBe('Photo.jpg');
        });

        it('preserves pinned: true from Firestore', async () => {
            const mockDocs = [{
                id: 'kb-pinned',
                data: () => ({
                    type: 'text', title: 'Pinned', content: 'Important',
                    enabled: true, pinned: true,
                    createdAt: { toDate: () => new Date() },
                    updatedAt: { toDate: () => new Date() },
                }),
            }];
            vi.mocked(getDocs).mockResolvedValueOnce({ docs: mockDocs } as never);

            const entries = await loadKBEntries('user-1', 'ws-1');
            expect(entries[0]!.pinned).toBe(true);
        });
    });
});
