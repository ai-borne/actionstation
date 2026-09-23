/**
 * KB delete-path tests (E9)
 * TDD: entry deletion must target the actual Storage object name
 * (storedFileName), not the pre-compression originalFileName — the two
 * diverge for compressed images and previously caused deleteObject to
 * silently no-op on the wrong path, orphaning the file in Storage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { KnowledgeBankEntry } from '../types/knowledgeBank';

const deleteKBEntryMock = vi.fn(async () => undefined);
const deleteKBEntryBatchMock = vi.fn(async () => undefined);
const deleteKBFileMock = vi.fn(async () => undefined);

vi.mock('../services/knowledgeBankService', () => ({
    deleteKBEntry: deleteKBEntryMock,
    deleteKBEntryBatch: deleteKBEntryBatchMock,
    updateKBEntry: vi.fn(async () => undefined),
    updateKBEntryBatch: vi.fn(async () => undefined),
}));

vi.mock('../services/storageService', () => ({
    deleteKBFile: deleteKBFileMock,
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import { useKnowledgeBankPanelHandlers } from '../hooks/useKnowledgeBankPanelHandlers';
// eslint-disable-next-line import-x/first
import { useDocumentGroupHandlers } from '../hooks/useDocumentGroupHandlers';
// eslint-disable-next-line import-x/first
import { useKnowledgeBankStore } from '../stores/knowledgeBankStore';
// eslint-disable-next-line import-x/first
import { useAuthStore } from '@/features/auth/stores/authStore';
// eslint-disable-next-line import-x/first
import { useWorkspaceStore } from '@/features/workspace/stores/workspaceStore';
// eslint-disable-next-line import-x/first
import { useConfirmStore } from '@/shared/stores/confirmStore';

function makeEntry(overrides: Partial<KnowledgeBankEntry> = {}): KnowledgeBankEntry {
    return {
        id: 'kb-1',
        workspaceId: 'ws-1',
        type: 'image',
        title: 'Photo',
        content: 'A photo',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

describe('KB delete uses storedFileName over originalFileName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({ user: { id: 'user-1' } as never });
        useWorkspaceStore.setState({ currentWorkspaceId: 'ws-1' });
    });

    describe('useKnowledgeBankPanelHandlers.handleDelete', () => {
        it('deletes the Storage object at storedFileName, not originalFileName', async () => {
            const entry = makeEntry({
                originalFileName: 'photo.png',
                storedFileName: 'My Photo.jpg',
            });
            useKnowledgeBankStore.setState({ entries: [entry] });

            const { result } = renderHook(() => useKnowledgeBankPanelHandlers());
            await act(async () => {
                await result.current.handleDelete('kb-1');
            });

            expect(deleteKBFileMock).toHaveBeenCalledWith('user-1', 'ws-1', 'kb-1', 'My Photo.jpg');
        });

        it('falls back to originalFileName for legacy entries with no storedFileName', async () => {
            const entry = makeEntry({ originalFileName: 'legacy.png', storedFileName: undefined });
            useKnowledgeBankStore.setState({ entries: [entry] });

            const { result } = renderHook(() => useKnowledgeBankPanelHandlers());
            await act(async () => {
                await result.current.handleDelete('kb-1');
            });

            expect(deleteKBFileMock).toHaveBeenCalledWith('user-1', 'ws-1', 'kb-1', 'legacy.png');
        });

        it('skips Storage delete for text entries with no file at all', async () => {
            const entry = makeEntry({
                type: 'text', originalFileName: undefined, storedFileName: undefined,
            });
            useKnowledgeBankStore.setState({ entries: [entry] });

            const { result } = renderHook(() => useKnowledgeBankPanelHandlers());
            await act(async () => {
                await result.current.handleDelete('kb-1');
            });

            expect(deleteKBFileMock).not.toHaveBeenCalled();
            expect(deleteKBEntryMock).toHaveBeenCalledWith('user-1', 'ws-1', 'kb-1');
        });
    });

    describe('useDocumentGroupHandlers.handleDeleteGroup', () => {
        it('deletes each grouped entry\'s Storage object by storedFileName', async () => {
            useConfirmStore.setState({ confirm: vi.fn(async () => true) as never });
            const parent = makeEntry({
                id: 'kb-parent', originalFileName: 'doc.png', storedFileName: 'Doc.jpg',
            });
            const child = makeEntry({
                id: 'kb-child', parentEntryId: 'kb-parent',
                originalFileName: 'doc.png', storedFileName: 'Doc-2.jpg',
            });
            useKnowledgeBankStore.setState({ entries: [parent, child] });

            const { result } = renderHook(() => useDocumentGroupHandlers());
            await act(async () => {
                await result.current.handleDeleteGroup('kb-parent');
            });

            expect(deleteKBFileMock).toHaveBeenCalledWith('user-1', 'ws-1', 'kb-parent', 'Doc.jpg');
            expect(deleteKBFileMock).toHaveBeenCalledWith('user-1', 'ws-1', 'kb-child', 'Doc-2.jpg');
        });
    });
});
