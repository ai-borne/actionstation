import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useWorkspaceStore, DEFAULT_WORKSPACE_ID } from '../stores/workspaceStore';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { emitNodesDeleted } from '@/features/canvas/services/nodeDeletionSignal';
import { deleteWorkspace } from '../services/workspaceService';
import { TrashIcon } from '@/shared/components/icons';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { useConfirm } from '@/shared/stores/confirmStore';
import { CONTROLS_BUTTON, CONTROLS_DELETE_BUTTON } from './workspaceControlsStyles';
import { logger } from '@/shared/services/logger';

export function DeleteWorkspaceButton() {
    const user = useAuthStore((s) => s.user);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const [isDeleting, setIsDeleting] = useState(false);
    const confirm = useConfirm();

    const handleDeleteWorkspace = useCallback(async () => {
        if (!user || !currentWorkspaceId || isDeleting) return;
        const userId = user.id;

        if (currentWorkspaceId === DEFAULT_WORKSPACE_ID) {
            toast.error(strings.workspace.deleteDefaultError);
            return;
        }

        const confirmed = await confirm({
            title: strings.workspace.deleteConfirmTitle,
            message: strings.workspace.deleteConfirm,
            confirmText: strings.workspace.deleteConfirmButton,
            isDestructive: true,
        });
        if (!confirmed) return;

        setIsDeleting(true);
        try {
            await deleteWorkspace(userId, currentWorkspaceId);
            // The loaded cards are gone for good: announce them (their Google events go too).
            // The canvas itself is swapped by the next workspace load, so nothing is cleared here.
            emitNodesDeleted(useCanvasStore.getState().nodes);
            useWorkspaceStore.getState().removeWorkspace(currentWorkspaceId);

            const remainingWorkspaces = workspaces.filter(ws => ws.id !== currentWorkspaceId);
            const nextWorkspace = remainingWorkspaces[0];
            if (nextWorkspace) {
                useWorkspaceStore.getState().setCurrentWorkspaceId(nextWorkspace.id);
            } else {
                useWorkspaceStore.getState().setCurrentWorkspaceId(DEFAULT_WORKSPACE_ID);
                useCanvasStore.getState().clearCanvas();
            }

            toast.success(strings.workspace.deleteSuccess);
        } catch (error) {
            logger.error('[DeleteWorkspaceButton] Failed to delete workspace:', error);
            toast.error(strings.errors.generic);
        } finally {
            setIsDeleting(false);
        }
    }, [user, currentWorkspaceId, workspaces, isDeleting, confirm]);

    return (
        <button
            className={clsx(CONTROLS_BUTTON, CONTROLS_DELETE_BUTTON)}
            onClick={handleDeleteWorkspace}
            disabled={isDeleting}
            title={strings.workspace.deleteWorkspaceTooltip}
        >
            <TrashIcon size={20} />
        </button>
    );
}
