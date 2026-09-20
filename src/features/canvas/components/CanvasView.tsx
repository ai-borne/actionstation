/**
 * Canvas View - ReactFlow wrapper component
 * Store is the single source of truth, ReactFlow syncs to it
 */
import { useMemo, useRef, useReducer, memo, useEffect, useCallback } from 'react';
import { ReactFlow, Background, BackgroundVariant, ConnectionLineType, SelectionMode, PanOnScrollMode, Panel, type Node, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../stores/canvasStore';
import { useFocusStore } from '../stores/focusStore';
import { useWorkspaceContext } from '@/app/contexts/WorkspaceContext';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';
import { ZoomControls } from './ZoomControls';
import { FocusOverlay } from './FocusOverlay';
import { ViewportSync } from './ViewportSync';
import { SelectionToolbar } from '@/features/synthesis/components/SelectionToolbar';
import { ClusterOverlay } from '@/features/clustering/components/ClusterOverlay';
import { buildRfNodes, cleanupDataShells, type PrevRfNodes } from './buildRfNodes';
import { buildRfEdges, type PrevRfEdges } from './buildRfEdges';
import { applyPositionAndRemoveChanges } from './canvasChangeHelpers';
import { nodeTypes, edgeTypes, DEFAULT_EDGE_OPTIONS, SNAP_GRID, NO_DRAG_CLASS, PAN_ACTIVATION_KEY, MULTI_SELECT_KEY, BACKGROUND_GAP, BACKGROUND_DOT_SIZE } from './canvasViewConstants';
import { useCanvasHandlers } from '../hooks/useCanvasHandlers';
import { useCanvasDragHandlers } from '../hooks/useCanvasDragHandlers';
import { useSemanticZoom } from '../hooks/useSemanticZoom';
import { useBrowserZoomLock } from '../hooks/useBrowserZoomLock';
import '@/styles/semanticZoom.css';
import { dragPositionReducer, INITIAL_DRAG_STATE } from '../hooks/dragPositionReducer';
import { usePanToNode } from '../hooks/usePanToNode';
import { useDoubleClickToCreate } from '../hooks/useDoubleClickToCreate';
import { CanvasTooltip } from './CanvasTooltip';
import { PanToNodeContext } from '../contexts/PanToNodeContext';
import { useFitViewAfterArrange } from '../hooks/useFitViewAfterArrange';
import { useTabLeaderRole } from '@/shared/contexts/TabLeaderContext';
import styles from './CanvasView.module.css';

function getContainerClassName(isSwitching: boolean): string {
    return isSwitching ? `${styles.canvasContainer ?? ''} ${styles.switching ?? ''}` : (styles.canvasContainer ?? '');
}

function onMoveEndImpl(currentWorkspaceId: string | null | undefined, newViewport: Viewport): void {
    useCanvasStore.getState().setViewport(newViewport);
    if (!currentWorkspaceId) return;
    const cached = workspaceCache.get(currentWorkspaceId);
    if (cached) {
        workspaceCache.set(currentWorkspaceId, { ...cached, viewport: newViewport });
    }
}

function commitOverridesToStore(
    overrides: ReadonlyMap<string, { x: number; y: number }>,
    dispatch: React.Dispatch<{ type: 'RESET' }>,
): void {
    if (overrides.size === 0) return;
    useCanvasStore.setState((state) => {
        const changes = Array.from(overrides, ([id, position]) => ({
            type: 'position' as const, id, position,
        }));
        const result = applyPositionAndRemoveChanges(state.nodes, changes);
        return result !== state.nodes ? { nodes: result } : {};
    });
    dispatch({ type: 'RESET' });
}

function useCanvasViewState() {
    const nodes = useCanvasStore((s) => s.nodes);
    const edges = useCanvasStore((s) => s.edges);
    const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
    const viewport = useCanvasStore((s) => s.viewport);
    const { currentWorkspaceId, isSwitching } = useWorkspaceContext();
    const canvasGrid = useSettingsStore((s) => s.canvasGrid);
    const canvasScrollMode = useSettingsStore((s) => s.canvasScrollMode);
    const isCanvasLocked = useSettingsStore((s) => s.isCanvasLocked);
    const isFocused = useFocusStore((s) => s.focusedNodeId !== null);
    const isFollowerTab = !useTabLeaderRole();
    const isInteractionDisabled = isCanvasLocked || isFocused || isFollowerTab;
    const isNavigateMode = canvasScrollMode === 'navigate';
    return { nodes, edges, selectedNodeIds, viewport, currentWorkspaceId, isSwitching, canvasGrid, isCanvasLocked, isInteractionDisabled, isFocused, isNavigateMode };
}

function CanvasViewInner() {
    const { nodes, edges, selectedNodeIds, viewport, currentWorkspaceId, isSwitching, canvasGrid, isCanvasLocked, isInteractionDisabled, isFocused, isNavigateMode } = useCanvasViewState();
    const panCtx = usePanToNode();
    const prevRfNodesRef = useRef<PrevRfNodes>({ arr: [], map: new Map() });
    const prevRfEdgesRef = useRef<PrevRfEdges>({ arr: [], map: new Map() });
    const [dragState, dragDispatch] = useReducer(dragPositionReducer, INITIAL_DRAG_STATE);
    const handlers = useCanvasHandlers(currentWorkspaceId, isCanvasLocked, dragDispatch);
    useSemanticZoom();
    useBrowserZoomLock();
    useFitViewAfterArrange();
    const paneHandlers = useDoubleClickToCreate();
    const overridesRef = useRef(dragState.overrides);
    overridesRef.current = dragState.overrides;
    const commitDragOverrides = useCallback(() => commitOverridesToStore(overridesRef.current, dragDispatch), []);
    const drag = useCanvasDragHandlers(commitDragOverrides);
    const handleMoveEnd = useCallback(
        (_event: unknown, vp: Viewport) => onMoveEndImpl(currentWorkspaceId, vp), [currentWorkspaceId],
    );
    const rfNodes: Node[] = useMemo(
        () => buildRfNodes(nodes, selectedNodeIds, prevRfNodesRef, dragState.overrides),
        [nodes, selectedNodeIds, dragState.overrides],
    );
    const rfEdges = useMemo(() => buildRfEdges(edges, prevRfEdgesRef), [edges]);
    useEffect(() => { cleanupDataShells(new Set(nodes.map((n) => n.id))); }, [nodes]);

    return (
        <PanToNodeContext.Provider value={panCtx}>
        <div id="main-canvas" tabIndex={-1} className={getContainerClassName(isSwitching)} data-canvas-container onDoubleClick={paneHandlers.onDoubleClick} onTouchEnd={paneHandlers.onTouchEnd}>
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={handlers.onNodesChange}
                onEdgesChange={handlers.onEdgesChange}
                onConnect={handlers.onConnect}
                onSelectionChange={handlers.onSelectionChange}
                onNodeDragStart={drag.historyDragStart}
                onNodeDragStop={drag.handleNodeDragStop}
                onSelectionDragStart={drag.handleSelectionDragStart}
                onSelectionDragStop={drag.handleSelectionDragStop}
                onMoveEnd={handleMoveEnd}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                connectionLineType={ConnectionLineType.Bezier}
                defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                snapToGrid
                snapGrid={SNAP_GRID}
                minZoom={0.1}
                maxZoom={2}
                /* Double-click creates a new node — disable ReactFlow's default zoom.
                   Users zoom via pinch, scroll-wheel, or ZoomControls toolbar. */
                zoomOnDoubleClick={false}
                /* Interaction props — two separate lock categories:
                 * isInteractionDisabled (locked OR focused): blocks drag, pan, connect,
                 *   rubber-band select, and zoom so the canvas view is fully preserved.
                 * isFocused only: blocks elementsSelectable so ReactFlow does not emit
                 *   onSelectionChange events while a node is open in the FocusOverlay.
                 * When locked-but-not-focused, elementsSelectable stays true so the
                 * user can still click a node to select it (enables F key + context-
                 * menu Focus action). */
                zoomOnScroll={!isInteractionDisabled && !isNavigateMode}
                panOnScroll={!isInteractionDisabled && isNavigateMode}
                panOnDrag={isInteractionDisabled ? false : [1, 2]}
                nodesDraggable={!isInteractionDisabled}
                noDragClassName={NO_DRAG_CLASS}
                elementsSelectable={!isFocused}
                nodesConnectable={!isInteractionDisabled}
                {...(isNavigateMode && { panOnScrollMode: PanOnScrollMode.Free })}
                selectionOnDrag={!isInteractionDisabled}
                selectionMode={SelectionMode.Partial}
                panActivationKeyCode={PAN_ACTIVATION_KEY}
                multiSelectionKeyCode={MULTI_SELECT_KEY}
                onlyRenderVisibleElements
                proOptions={{ hideAttribution: true }}
            >
                <ViewportSync viewport={viewport} />
                {canvasGrid && <Background variant={BackgroundVariant.Dots} gap={BACKGROUND_GAP} size={BACKGROUND_DOT_SIZE} />}
                <ZoomControls />
                <Panel position="bottom-right" style={{ margin: '0 8px 8px 0', fontSize: '11px', color: 'var(--color-text-muted)', userSelect: 'none', pointerEvents: 'none' }}>
                    Action Station
                </Panel>
            </ReactFlow>
            <ClusterOverlay />
            <SelectionToolbar />
            <FocusOverlay />
            <CanvasTooltip />
        </div>
        </PanToNodeContext.Provider>
    );
}

export const CanvasView = memo(CanvasViewInner);
