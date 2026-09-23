/**
 * useDocumentGroupHandlers — Group-level toggle and delete for document chunks
 * Handles Firestore persistence and Storage cleanup for document groups
 */
import { useCallback } from 'react';
import { useKnowledgeBankStore } from '../stores/knowledgeBankStore';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useWorkspaceStore } from '@/features/workspace/stores/workspaceStore';
import { useConfirmStore } from '@/shared/stores/confirmStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';

export function useDocumentGroupHandlers() {
    const handleToggleGroup = useCallback(async (parentId: string) => {
        const userId = useAuthStore.getState().user?.id;
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
        if (!userId || !workspaceId) return;

        useKnowledgeBankStore.getState().toggleDocumentGroup(parentId);

        const entries = useKnowledgeBankStore.getState().entries;
        const affected = entries.filter(
            (e) => e.id === parentId || e.parentEntryId === parentId
        );

        try {
            const { updateKBEntryBatch } = await import('../services/knowledgeBankService');
            const updates = affected.map((e) => ({ entryId: e.id, enabled: e.enabled }));
            await updateKBEntryBatch(userId, workspaceId, updates);
        } catch (error) {
            logger.error('KB group toggle persist failed', error);
            useKnowledgeBankStore.getState().toggleDocumentGroup(parentId);
            toast.error(strings.knowledgeBank.errors.saveFailed);
        }
    }, []);

    const handleDeleteGroup = useCallback(async (parentId: string) => {
        const userId = useAuthStore.getState().user?.id;
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
        if (!userId || !workspaceId) return;

        const kb = strings.knowledgeBank;
        const confirmed = await useConfirmStore.getState().confirm({
            title: kb.documentGroup.deleteDocument,
            message: kb.documentGroup.deleteDocumentConfirm,
            isDestructive: true,
        });
        if (!confirmed) return;

        const entries = useKnowledgeBankStore.getState().entries;
        const groupEntries = entries.filter(
            (e) => e.id === parentId || e.parentEntryId === parentId
        );
        const entryIds = groupEntries.map((e) => e.id);

        try {
            const { deleteKBEntryBatch } = await import('../services/knowledgeBankService');
            const { deleteKBFile } = await import('../services/storageService');
            await deleteKBEntryBatch(userId, workspaceId, entryIds);
            useKnowledgeBankStore.getState().removeDocumentGroup(parentId);

            // Best-effort Storage cleanup after authoritative Firestore delete
            const storageCleanups = groupEntries
                .map((e) => ({ id: e.id, fileName: e.storedFileName ?? e.originalFileName }))
                .filter((e): e is { id: string; fileName: string } => Boolean(e.fileName))
                .map((e) => deleteKBFile(userId, workspaceId, e.id, e.fileName));
            await Promise.allSettled(storageCleanups);
        } catch (error) {
            logger.error('KB group delete failed', error);
            toast.error(kb.errors.deleteFailed);
        }
    }, []);

    return { handleToggleGroup, handleDeleteGroup };
}
