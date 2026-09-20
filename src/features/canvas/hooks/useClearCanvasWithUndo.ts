/**
 * useClearCanvasWithUndo — Undoable clear-canvas with confirmation.
 * Snapshots the entire canvas before clearing, enabling full restoration via undo.
 * Extracted from ClearCanvasButton so logic lives in the hook layer, not the view.
 */
import { useCallback } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { useHistoryStore } from '../stores/historyStore';
import { withUndo } from '../utils/historyUtils';
import { toastWithAction } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { useConfirm } from '@/shared/stores/confirmStore';

export function useClearCanvasWithUndo() {
    const confirm = useConfirm();

    const clearCanvasWithUndo = useCallback(async () => {
        const state = useCanvasStore.getState();
        if (state.nodes.length === 0) return; // Nothing to clear — no-op

        const confirmed = await confirm({
            title: strings.canvas.clearConfirmTitle,
            message: strings.canvas.clearConfirm,
            confirmText: strings.canvas.clearConfirmButton,
            isDestructive: true,
        });
        if (!confirmed) return;

        // Snapshot entire canvas before clearing (structuredClone = deep-freeze safe copy)
        const frozenNodes = structuredClone(state.nodes);
        const frozenEdges = structuredClone(state.edges);

        withUndo('clearCanvas', () => {
            useCanvasStore.getState().deleteAllNodes();
        }, () => {
            // UNDO: restore nodes + edges atomically — ONE setState call, no cascade
            const restoredNodeIds = new Set(frozenNodes.map((n) => n.id));
            const validEdges = frozenEdges.filter(
                (e) => restoredNodeIds.has(e.sourceNodeId) && restoredNodeIds.has(e.targetNodeId)
            );
            useCanvasStore.setState({ nodes: frozenNodes, edges: validEdges, selectedNodeIds: new Set() });
        });

        toastWithAction(strings.canvas.history.canvasCleared, 'info', {
            label: strings.common.undo,
            onClick: () => useHistoryStore.getState().dispatch({ type: 'UNDO', source: 'toast' }),
        });
    }, [confirm]);

    return { clearCanvasWithUndo };
}
