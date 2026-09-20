/**
 * canvasStoreActions — Action factory functions for the canvas Zustand store.
 * Each factory receives (set, get) and returns a group of related actions.
 * Keeps canvasStore.ts under the 300-line limit by separating action logic.
 */
import type { Viewport } from '@xyflow/react';
import type { CanvasNode, IdeaNodeData, LinkPreviewMetadata, NodeColorKey } from '../types/node';
import type { ContentMode } from '../types/contentMode';
import type { CalendarEventMetadata } from '@/features/calendar/types/calendarEvent';
import type { InputMode } from '../types/slashCommand';
import type { CanvasEdge } from '../types/edge';
import {
    updateNodeDimensionsInArray,
    updateNodeDataField,
    updateContentModeInArray,
    appendToNodeOutputInArray,
    togglePromptCollapsedInArray,
    deleteNodeFromArrays,
    getConnectedNodeIds,
    getUpstreamNodesFromArrays,
    arrangeNodesInGrid,
    arrangeNodesAfterResize,
    toggleNodePinnedInArray,
    toggleNodeCollapsedInArray,
    toggleNodePoolInArray,
    clearAllNodePoolInArray,
    setNodeColorInArray,
    insertNodeAtIndexInArray,
    deleteNodesFromArrays,
} from './canvasStoreHelpers';
import { emitNodesDeleted } from '../services/nodeDeletionSignal';
import { duplicateNode as cloneNode } from '../services/nodeDuplicationService';
import { resolveGridColumnsFromStore } from '../services/gridColumnsResolver';
import { EMPTY_SELECTED_IDS, getNodeMap, DEFAULT_VIEWPORT, DEFAULT_INPUT_MODE, countPooledNodes, countPinnedNodes } from './canvasStoreUtils';
import type { CanvasStore } from './canvasStore';
import type { ClusterGroup } from '@/features/clustering/types/cluster';

type SetFn = (partial: Partial<CanvasStore> | ((s: CanvasStore) => Partial<CanvasStore>)) => void;
type GetFn = () => CanvasStore;

function pruneClusterGroups(
    groups: readonly ClusterGroup[], existingNodeIds: ReadonlySet<string>,
): { clusterGroups: ClusterGroup[] } {
    return {
        clusterGroups: groups
            .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => existingNodeIds.has(id)) }))
            .filter((g) => g.nodeIds.length >= 2),
    };
}

function nodeDelta(node: CanvasNode) {
    return {
        pool: node.data.includeInAIPool ? 1 : 0,
        pin: node.data.isPinned ? 1 : 0,
    } as const;
}

/** Node mutation actions (structural: add, duplicate, delete, bulk) */
export function createNodeMutationActions(set: SetFn, get: GetFn) {
    return {
        addNode: (node: CanvasNode) => { const d = nodeDelta(node); set((s) => ({
            nodes: [...s.nodes, node], poolCount: s.poolCount + d.pool, pinnedCount: s.pinnedCount + d.pin,
        })); },
        addNodeAndEdge: (node: CanvasNode, edge: CanvasEdge) => { const d = nodeDelta(node); set((s) => ({
            nodes: [...s.nodes, node], edges: [...s.edges, edge],
            poolCount: s.poolCount + d.pool, pinnedCount: s.pinnedCount + d.pin,
        })); },
        duplicateNode: (nodeId: string): string | undefined => {
            const node = getNodeMap(get().nodes).get(nodeId);
            if (!node) return undefined;
            const newNode = cloneNode(node, get().nodes);
            const d = nodeDelta(newNode);
            set((s) => ({ nodes: [...s.nodes, newNode], poolCount: s.poolCount + d.pool, pinnedCount: s.pinnedCount + d.pin }));
            return newNode.id;
        },
        updateNodeDimensions: (nodeId: string, width: number, height: number) =>
            set((s) => ({ nodes: updateNodeDimensionsInArray(s.nodes, nodeId, width, height) })),
        updateNodeContent: (nodeId: string, content: string) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'content', content) })),
        setNodes: (nodes: CanvasNode[]) => set({
            nodes, poolCount: countPooledNodes(nodes), pinnedCount: countPinnedNodes(nodes),
        }),
        insertNodeAtIndex: (node: CanvasNode, index: number) => { const d = nodeDelta(node); set((s) => ({
            nodes: insertNodeAtIndexInArray(s.nodes, node, index),
            poolCount: s.poolCount + d.pool, pinnedCount: s.pinnedCount + d.pin,
        })); },
        insertNodesAtIndices: (entries: Array<{ node: CanvasNode; index: number }>) =>
            set((s) => {
                let nodes = s.nodes;
                for (const { node, index } of entries) { nodes = insertNodeAtIndexInArray(nodes, node, index); }
                return { nodes, poolCount: countPooledNodes(nodes), pinnedCount: countPinnedNodes(nodes) };
            }),
    };
}

/** Node deletion + clear actions (cluster-pruning logic) */
export function createNodeDeletionActions(set: SetFn, get: GetFn) {
    /** Run a deleting mutation, then announce exactly the nodes it removed (cascades included). */
    const announceRemoved = (mutate: () => void) => {
        const before = get().nodes;
        mutate();
        const remaining = getNodeMap(get().nodes);
        emitNodesDeleted(before.filter((n) => !remaining.has(n.id)));
    };

    return {
        deleteNode: (nodeId: string) => announceRemoved(() => {
            set((s) => {
                const deletedNode = getNodeMap(s.nodes).get(nodeId);
                const poolDelta = deletedNode?.data.includeInAIPool ? -1 : 0;
                const pinnedDelta = deletedNode?.data.isPinned ? -1 : 0;
                const deletion = deleteNodeFromArrays(s.nodes, s.edges, s.selectedNodeIds, nodeId);
                const editingClear = s.editingNodeId === nodeId
                    ? { editingNodeId: null, draftContent: null, inputMode: DEFAULT_INPUT_MODE } : {};
                const clusterPrune = s.clusterGroups.length > 0
                    ? pruneClusterGroups(s.clusterGroups, new Set(deletion.nodes.map((n) => n.id))) : {};
                return {
                    ...deletion, ...editingClear, ...clusterPrune,
                    poolCount: s.poolCount + poolDelta, pinnedCount: s.pinnedCount + pinnedDelta,
                };
            });
        }),

        deleteNodes: (nodeIds: string[]) => announceRemoved(() => {
            const idSet = new Set(nodeIds);
            set((s) => {
                const deletion = deleteNodesFromArrays(s.nodes, s.edges, s.selectedNodeIds, idSet);
                const editingClear = s.editingNodeId && idSet.has(s.editingNodeId)
                    ? { editingNodeId: null, draftContent: null, inputMode: DEFAULT_INPUT_MODE } : {};
                const clusterPrune = s.clusterGroups.length > 0
                    ? pruneClusterGroups(s.clusterGroups, new Set(deletion.nodes.map((n) => n.id))) : {};
                return {
                    ...deletion, ...editingClear, ...clusterPrune,
                    poolCount: countPooledNodes(deletion.nodes), pinnedCount: countPinnedNodes(deletion.nodes),
                };
            });
        }),

        /** User-intended "delete everything" (announces deletions). Unlike clearCanvas, which only unloads. */
        deleteAllNodes: () => announceRemoved(() => get().clearCanvas()),

        /** Unload the canvas (workspace switch / new workspace). The nodes still exist in storage. */
        clearCanvas: () => set({
            nodes: [], edges: [], selectedNodeIds: EMPTY_SELECTED_IDS as Set<string>,
            viewport: DEFAULT_VIEWPORT, poolCount: 0, pinnedCount: 0,
            editingNodeId: null, draftContent: null, inputMode: DEFAULT_INPUT_MODE, clusterGroups: [],
        }),
    };
}

/** Node data actions (field updates, toggles, flags) */
export function createNodeDataActions(set: SetFn) {
    return {
        updateNodeHeading: (nodeId: string, heading: string) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'heading', heading) })),
        updateNodePrompt: (nodeId: string, prompt: string) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'prompt', prompt) })),
        updateNodeOutput: (nodeId: string, output: string) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'output', output) })),
        updateNodeTags: (nodeId: string, tags: string[]) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'tags', tags) })),
        updateNodeAttachments: (nodeId: string, attachments: IdeaNodeData['attachments']) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'attachments', attachments) })),
        updateNodeColor: (nodeId: string, colorKey: NodeColorKey) =>
            set((s) => ({ nodes: setNodeColorInArray(s.nodes, nodeId, colorKey) })),
        appendToNodeOutput: (nodeId: string, chunk: string) =>
            set((s) => ({ nodes: appendToNodeOutputInArray(s.nodes, nodeId, chunk) })),
        setNodeGenerating: (nodeId: string, isGenerating: boolean) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'isGenerating', isGenerating) })),
        togglePromptCollapsed: (nodeId: string) =>
            set((s) => ({ nodes: togglePromptCollapsedInArray(s.nodes, nodeId) })),
        toggleNodePinned: (nodeId: string) => set((s) => {
            const node = getNodeMap(s.nodes).get(nodeId);
            if (!node) return {};
            const wasPinned = Boolean(node.data.isPinned);
            return { nodes: toggleNodePinnedInArray(s.nodes, nodeId), pinnedCount: s.pinnedCount + (wasPinned ? -1 : 1) };
        }),
        toggleNodeCollapsed: (nodeId: string) =>
            set((s) => ({ nodes: toggleNodeCollapsedInArray(s.nodes, nodeId) })),
        toggleNodePoolMembership: (nodeId: string) => set((s) => {
            const node = getNodeMap(s.nodes).get(nodeId);
            if (!node) return {};
            const wasPooled = Boolean(node.data.includeInAIPool);
            return { nodes: toggleNodePoolInArray(s.nodes, nodeId), poolCount: s.poolCount + (wasPooled ? -1 : 1) };
        }),
        clearAllNodePool: () =>
            set((s) => ({ nodes: clearAllNodePoolInArray(s.nodes), poolCount: 0 })),
        setNodeCalendarEvent: (nodeId: string, event: CalendarEventMetadata | undefined) =>
            set((s) => ({ nodes: updateNodeDataField(s.nodes, nodeId, 'calendarEvent', event) })),
        updateNodeContentMode: (nodeId: string, contentMode: ContentMode) =>
            set((s) => ({ nodes: updateContentModeInArray(s.nodes, nodeId, contentMode) })),
    };
}

/** Edge, layout, and query actions */
export function createEdgeAndLayoutActions(set: SetFn, get: GetFn) {
    return {
        addEdge: (edge: CanvasEdge) => set((s) => ({ edges: [...s.edges, edge] })),

        deleteEdge: (edgeId: string) =>
            set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) })),

        setEdges: (edges: CanvasEdge[]) => set({ edges }),

        arrangeNodes: () => {
            const cols = resolveGridColumnsFromStore();
            set((s) => ({ nodes: arrangeNodesInGrid(s.nodes, cols) }));
        },

        arrangeAfterResize: (nodeId: string) => {
            const cols = resolveGridColumnsFromStore();
            set((s) => ({ nodes: arrangeNodesAfterResize(s.nodes, nodeId, cols) }));
        },

        setViewport: (viewport: Viewport) => set({ viewport }),

        getConnectedNodes: (nodeId: string) => getConnectedNodeIds(get().edges, nodeId),

        getUpstreamNodes: (nodeId: string) =>
            getUpstreamNodesFromArrays(get().nodes, get().edges, nodeId),
    };
}
/** Selection actions (decoupled from nodes array for performance) */
export function createSelectionActions(set: SetFn, get: GetFn) {
    return {
        selectNode: (nodeId: string) =>
            set((s) => ({ selectedNodeIds: new Set([...s.selectedNodeIds, nodeId]) })),

        deselectNode: (nodeId: string) =>
            set((s) => {
                const newSet = new Set(s.selectedNodeIds);
                newSet.delete(nodeId);
                return { selectedNodeIds: newSet };
            }),

        clearSelection: () => {
            if (get().selectedNodeIds.size === 0) return;
            set({ selectedNodeIds: EMPTY_SELECTED_IDS as Set<string> });
        },
    };
}
/** Editing state actions */
export function createEditingActions(set: SetFn, get: GetFn) {
    return {
        startEditing: (nodeId: string) => {
            if (get().editingNodeId === nodeId) return;
            set({ editingNodeId: nodeId, draftContent: null, inputMode: DEFAULT_INPUT_MODE });
        },

        stopEditing: () => { const s = get();
            if (!s.editingNodeId && !s.draftContent && s.inputMode === DEFAULT_INPUT_MODE) return;
            set({ editingNodeId: null, draftContent: null, inputMode: DEFAULT_INPUT_MODE });
        },

        updateDraft: (content: string) => set({ draftContent: content }),

        setInputMode: (mode: InputMode) => set({ inputMode: mode }),
    };
}
/** Link preview actions */
export function createLinkPreviewActions(set: SetFn) {
    return {
        addLinkPreview: (nodeId: string, url: string, metadata: LinkPreviewMetadata) =>
            set((s) => ({
                nodes: s.nodes.map((n) => n.id !== nodeId ? n : {
                    ...n, updatedAt: new Date(),
                    data: { ...n.data, linkPreviews: { ...n.data.linkPreviews, [url]: metadata } },
                }),
            })),

        removeLinkPreview: (nodeId: string, url: string) =>
            set((s) => ({
                nodes: s.nodes.map((n) => {
                    if (n.id !== nodeId) return n;
                    const { [url]: _, ...rest } = n.data.linkPreviews ?? {};
                    return { ...n, data: { ...n.data, linkPreviews: rest }, updatedAt: new Date() };
                }),
            })),
    };
}
