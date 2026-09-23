/**
 * ParseResult Persister Tests
 * TDD: storedFileName must match the actual uploaded Storage filename so
 * that a later delete targets the real object (E9).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnowledgeBankEntry } from '../types/knowledgeBank';
import type { ParseResult } from '../parsers/types';

const addKBEntryMock = vi.fn(
    async (
        _userId: string,
        _workspaceId: string,
        input: Record<string, unknown>,
        entryId?: string,
    ): Promise<KnowledgeBankEntry> =>
        ({ id: entryId ?? 'kb-generated', ...input }) as unknown as KnowledgeBankEntry
);
const uploadKBFileMock = vi.fn(async () => 'https://storage.example/download-url');

vi.mock('../services/knowledgeBankService', () => ({
    addKBEntry: addKBEntryMock,
    getServerDocumentCount: vi.fn(async () => 0),
}));

vi.mock('../services/storageService', () => ({
    uploadKBFile: uploadKBFileMock,
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import { persistParseResult } from '../services/parseResultPersister';

describe('parseResultPersister', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uploads an image under the same filename it later persists as storedFileName', async () => {
        const result: ParseResult = {
            title: 'My Photo',
            content: 'A description',
            mimeType: 'image/jpeg',
            originalFileName: 'photo.png',
            blob: new Blob(['fake'], { type: 'image/jpeg' }),
            metadata: { requiresUpload: true },
        };

        await persistParseResult('user-1', 'ws-1', result);

        expect(uploadKBFileMock).toHaveBeenCalledTimes(1);
        const uploadCallArgs = uploadKBFileMock.mock.calls[0] as unknown as unknown[];
        const uploadedFilename = uploadCallArgs[4] as string;

        expect(addKBEntryMock).toHaveBeenCalledTimes(1);
        const persistedInput = addKBEntryMock.mock.calls[0]![2] as Record<string, unknown>;

        expect(persistedInput.storedFileName).toBe(uploadedFilename);
        expect(persistedInput.originalFileName).toBe('photo.png');
        // The two names diverge whenever the title differs from the original stem —
        // this is exactly the case that broke delete (E9).
        expect(persistedInput.storedFileName).not.toBe(persistedInput.originalFileName);
    });

    it('generates a crypto.randomUUID()-based entry id for uploaded images', async () => {
        const result: ParseResult = {
            title: 'Shot',
            content: 'desc',
            mimeType: 'image/jpeg',
            originalFileName: 'shot.png',
            blob: new Blob(['fake']),
            metadata: { requiresUpload: true },
        };

        await persistParseResult('user-1', 'ws-1', result);

        const entryId = addKBEntryMock.mock.calls[0]![3] as string;
        expect(entryId).toMatch(
            /^kb-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
    });

    it('leaves storedFileName undefined for text entries (no upload)', async () => {
        const result: ParseResult = {
            title: 'Note',
            content: 'plain text',
            mimeType: 'text/plain',
            originalFileName: 'note.txt',
        };

        await persistParseResult('user-1', 'ws-1', result);

        expect(uploadKBFileMock).not.toHaveBeenCalled();
        const persistedInput = addKBEntryMock.mock.calls[0]![2] as Record<string, unknown>;
        expect(persistedInput.storedFileName).toBeUndefined();
    });
});
