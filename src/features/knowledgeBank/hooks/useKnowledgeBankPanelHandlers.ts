import { useCallback } from 'react';
import { useKnowledgeBankStore } from '../stores/knowledgeBankStore';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useWorkspaceStore } from '@/features/workspace/stores/workspaceStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';

export function useKnowledgeBankPanelHandlers() {
    const kb = strings.knowledgeBank;

    const handleToggle = useCallback(async (entryId: string) => {
        const userId = useAuthStore.getState().user?.id;
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
        if (!userId || !workspaceId) return;

        const current = useKnowledgeBankStore.getState().entries.find((e) => e.id === entryId);
        if (!current) return;
        const newEnabled = !current.enabled;

        useKnowledgeBankStore.getState().toggleEntry(entryId);
        try {
            const { updateKBEntry } = await import('../services/knowledgeBankService');
            await updateKBEntry(userId, workspaceId, entryId, { enabled: newEnabled });
        } catch (error) {
            logger.error('KB toggle persist failed', error);
            useKnowledgeBankStore.getState().toggleEntry(entryId);
            toast.error(kb.errors.saveFailed);
        }
    }, [kb.errors.saveFailed]);

    const handlePin = useCallback(async (entryId: string) => {
        const userId = useAuthStore.getState().user?.id;
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
        if (!userId || !workspaceId) return;

        const current = useKnowledgeBankStore.getState().entries.find((e) => e.id === entryId);
        if (!current) return;
        const newPinned = !current.pinned;

        if (newPinned) {
            useKnowledgeBankStore.getState().pinEntry(entryId);
        } else {
            useKnowledgeBankStore.getState().unpinEntry(entryId);
        }
        try {
            const { updateKBEntry } = await import('../services/knowledgeBankService');
            await updateKBEntry(userId, workspaceId, entryId, { pinned: newPinned });
        } catch (error) {
            logger.error('KB pin persist failed', error);
            if (newPinned) {
                useKnowledgeBankStore.getState().unpinEntry(entryId);
            } else {
                useKnowledgeBankStore.getState().pinEntry(entryId);
            }
            toast.error(kb.errors.saveFailed);
        }
    }, [kb.errors.saveFailed]);

    const handleUpdate = useCallback(async (entryId: string, updates: { title: string; content: string; tags: string[] }) => {
        const userId = useAuthStore.getState().user?.id;
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
        if (!userId || !workspaceId) return;

        useKnowledgeBankStore.getState().updateEntry(entryId, updates);
        try {
            const { updateKBEntry } = await import('../services/knowledgeBankService');
            await updateKBEntry(userId, workspaceId, entryId, updates);
        } catch (error) {
            logger.error('KB update persist failed', error);
            toast.error(kb.errors.saveFailed);
        }
    }, [kb.errors.saveFailed]);

    const handleDelete = useCallback(async (entryId: string) => {
        const userId = useAuthStore.getState().user?.id;
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
        if (!userId || !workspaceId) return;

        const entry = useKnowledgeBankStore.getState().entries.find((e) => e.id === entryId);
        try {
            const { deleteKBEntry } = await import('../services/knowledgeBankService');
            const fileName = entry?.storedFileName ?? entry?.originalFileName;
            if (fileName) {
                const { deleteKBFile } = await import('../services/storageService');
                await deleteKBFile(userId, workspaceId, entryId, fileName);
            }
            await deleteKBEntry(userId, workspaceId, entryId);
            useKnowledgeBankStore.getState().removeEntry(entryId);
        } catch (error) {
            logger.error('KB delete failed', error);
            toast.error(kb.errors.deleteFailed);
        }
    }, [kb.errors.deleteFailed]);

    return { handleToggle, handlePin, handleUpdate, handleDelete };
}
