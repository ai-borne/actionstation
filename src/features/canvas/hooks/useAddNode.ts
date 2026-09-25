/**
 * useAddNode Hook - Create new nodes at next grid position or a specified position
 * Single source of truth for node creation logic (used by N shortcut, + button, and double-click)
 */
import { useCallback } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { useWorkspaceContext } from '@/app/contexts/WorkspaceContext';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { useFocusStore } from '../stores/focusStore';
import { createIdeaNode, type NodePosition } from '../types/node';
import { generateUUID } from '@/shared/utils/uuid';
import { calculateNextNodePosition } from '../stores/canvasStoreHelpers';
import { calculateSmartPlacement } from '../services/freeFlowPlacementService';
import { resolveGridColumnsFromStore } from '../services/gridColumnsResolver';
import { usePanToNode } from './usePanToNode';
import { trackNodeCreated } from '@/shared/services/analyticsService';
import { useUndoableActions } from './useUndoableActions';
import { useNodeCreationGuard } from '@/features/subscription/hooks/useNodeCreationGuard';

export interface AddNodeOptions {
    /** When provided, node is placed at this exact position (double-click-to-create). */
    position?: NodePosition;
    /** Analytics source label. Defaults to 'idea'. Pass 'canvas-double-click' for pane creation. */
    source?: string;
}

export function useAddNode() {
    const { currentWorkspaceId, isLoading } = useWorkspaceContext();
    const canvasFreeFlow = useSettingsStore((s) => s.canvasFreeFlow);
    const { panToPosition } = usePanToNode();
    const { addNodeWithUndo } = useUndoableActions();
    const { guardNodeCreation } = useNodeCreationGuard();

    /**
     * Creates a new IdeaCard node.
     *
     * @param optionsOrPosition - Either an AddNodeOptions object, a NodePosition
     *   for backward compatibility, or omitted for auto-placement.
     * @returns The new node's ID, or undefined if creation was skipped.
     */
    const handleAddNode = useCallback((optionsOrPosition?: AddNodeOptions | NodePosition): string | undefined => {
        // A card added while the workspace loads is wiped when the load replaces the canvas.
        if (!currentWorkspaceId || isLoading) return undefined;
        if (!guardNodeCreation()) return undefined;

        // Normalize overloaded parameter: AddNodeOptions | NodePosition | React event | undefined
        let validPosition: NodePosition | undefined;
        let source = 'idea';

        if (optionsOrPosition && 'source' in optionsOrPosition) {
            // AddNodeOptions shape
            validPosition = optionsOrPosition.position;
            source = optionsOrPosition.source ?? 'idea';
        } else if (
            optionsOrPosition &&
            typeof (optionsOrPosition as NodePosition).x === 'number' &&
            typeof (optionsOrPosition as NodePosition).y === 'number' &&
            !('nativeEvent' in optionsOrPosition)
        ) {
            // Plain NodePosition (backward compat)
            validPosition = optionsOrPosition as NodePosition;
        }
        // else: React event or undefined → fall through to auto-placement

        // Read at call time via getState() — no subscription to avoid cascade.
        const nodes = useCanvasStore.getState().nodes;
        const focusedNodeId = useFocusStore.getState().focusedNodeId;

        const cols = resolveGridColumnsFromStore();
        const position = validPosition
            ?? (canvasFreeFlow
                ? calculateSmartPlacement(nodes, focusedNodeId ?? undefined)
                : calculateNextNodePosition(nodes, cols));

        const nodeId = `idea-${generateUUID()}`;
        const newNode = createIdeaNode(nodeId, currentWorkspaceId, position);

        addNodeWithUndo(newNode);
        trackNodeCreated(source);
        panToPosition(position.x, position.y);

        return nodeId;
    }, [currentWorkspaceId, isLoading, canvasFreeFlow, panToPosition, addNodeWithUndo, guardNodeCreation]);

    return handleAddNode;
}
