import { useCallback } from 'react';
import clsx from 'clsx';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { PlusIcon, GridIcon, FreeFlowIcon, ClusterIcon, EraserIcon } from '@/shared/components/icons';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { clusterStrings } from '@/shared/localization/clusterStrings';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { useAddNode } from '@/features/canvas/hooks/useAddNode';
import { useWorkspaceContext } from '@/app/contexts/WorkspaceContext';
import { useUndoableActions } from '@/features/canvas/hooks/useUndoableActions';
import { useArrangeAnimation } from '@/features/canvas/hooks/useArrangeAnimation';
import { FIT_VIEW_AFTER_ARRANGE_EVENT } from '@/features/canvas/hooks/useFitViewAfterArrange';
import { useClusterActions } from '@/features/clustering/hooks/useClusterSuggestion';
import { useClusterPreviewStore } from '@/features/clustering/stores/clusterPreviewStore';
import { DeleteWorkspaceButton } from './DeleteWorkspaceButton';
import { ClearCanvasButton } from './ClearCanvasButton';
import { WorkspacePoolButton } from './WorkspacePoolButton';
import {
    CONTROLS_CONTAINER, CONTROLS_CONTAINER_STYLE,
    CONTROLS_BUTTON,
    CONTROLS_BUTTON_ACTIVE,
    CONTROLS_DIVIDER, CONTROLS_DIVIDER_STYLE,
} from './workspaceControlsStyles';

function useHandleArrange() {
    const nodeCount = useCanvasStore((s) => s.nodes.length);
    const pinnedCount = useCanvasStore((s) => s.pinnedCount);
    const { arrangeWithUndo } = useUndoableActions();
    const { animatedArrange, lastTotalAnimMsRef } = useArrangeAnimation(null, arrangeWithUndo);

    const handleArrangeNodes = useCallback(() => {
        if (nodeCount === 0) return;
        if (pinnedCount === nodeCount) {
            toast.info(strings.layout.allNodesPinned);
            return;
        }
        animatedArrange();
        window.dispatchEvent(new CustomEvent(FIT_VIEW_AFTER_ARRANGE_EVENT, {
            detail: { totalAnimMs: lastTotalAnimMsRef.current },
        }));
        if (pinnedCount > 0) {
            toast.success(strings.layout.arrangeSuccessWithPinned(pinnedCount));
        }
    }, [animatedArrange, lastTotalAnimMsRef, nodeCount, pinnedCount]);

    return { handleArrangeNodes, nodeCount };
}

export function WorkspaceControls() {
    const handleAddNode = useAddNode();
    const { isLoading } = useWorkspaceContext();
    const canvasFreeFlow = useSettingsStore((s) => s.canvasFreeFlow);
    const { handleArrangeNodes, nodeCount } = useHandleArrange();
    const { suggestClusters, clearClusters } = useClusterActions();
    const clusterPhase = useClusterPreviewStore((s) => s.phase);
    const hasActiveClusters = useCanvasStore((s) => s.clusterGroups.length > 0);

    return (
        <div className={CONTROLS_CONTAINER} style={CONTROLS_CONTAINER_STYLE}>
            <button className={CONTROLS_BUTTON} onClick={() => handleAddNode()} disabled={isLoading}
                title={strings.workspace.addNodeTooltip} data-testid="add-node-button">
                <PlusIcon size={20} />
            </button>
            <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
            <button className={CONTROLS_BUTTON} onClick={handleArrangeNodes}
                disabled={nodeCount === 0} title={strings.workspace.arrangeNodesTooltip}>
                <GridIcon size={20} />
            </button>
            <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
            <button
                className={clsx(CONTROLS_BUTTON, canvasFreeFlow && CONTROLS_BUTTON_ACTIVE)}
                onClick={() => useSettingsStore.getState().toggleCanvasFreeFlow()}
                aria-pressed={canvasFreeFlow} aria-label={strings.workspace.freeFlowTooltip}
                title={strings.workspace.freeFlowTooltip}>
                <FreeFlowIcon size={20} />
            </button>
            <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
            <button className={CONTROLS_BUTTON} onClick={suggestClusters}
                disabled={clusterPhase !== 'idle' || nodeCount === 0}
                title={clusterStrings.labels.suggestClusters} aria-label={clusterStrings.labels.suggestClusters}>
                <ClusterIcon size={20} />
            </button>
            {hasActiveClusters && <>
                <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
                <button className={CONTROLS_BUTTON} onClick={clearClusters}
                    title={clusterStrings.labels.clearClusters} aria-label={clusterStrings.labels.clearClusters}>
                    <EraserIcon size={20} />
                </button>
            </>}
            <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
            <ClearCanvasButton nodeCount={nodeCount} />
            <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
            <WorkspacePoolButton />
            <div className={CONTROLS_DIVIDER} style={CONTROLS_DIVIDER_STYLE} />
            <DeleteWorkspaceButton />
        </div>
    );
}
