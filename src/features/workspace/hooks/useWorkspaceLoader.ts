/**
 * useWorkspaceLoader - Cache-first workspace loading
 * Loads from cache instantly, background-refreshes from Firestore when online.
 * Falls back to Firestore on cache miss. Shows error when offline + no cache.
 *
 * Background refresh uses two-layer merge (editingNodeId guard + timestamp)
 * to prevent overwriting local edits. @see mergeNodes.ts
 */
import { useState, useEffect } from 'react';
import type { Viewport } from '@xyflow/react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useCanvasStore, EMPTY_SELECTED_IDS } from '@/features/canvas/stores/canvasStore';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import { loadNodes, loadEdges } from '../services/workspaceService';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { workspaceCache } from '../services/workspaceCache';
import { mergeNodes, mergeEdges } from '../services/mergeNodes';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useHistoryStore } from '@/features/canvas/stores/historyStore';
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';
import { resolveSpatialChunkingEnabled } from '@/config/featureFlags';

interface UseWorkspaceLoaderResult {
    isLoading: boolean;
    error: string | null;
    hasOfflineData: boolean;
    spatialChunkingEnabled: boolean;
}

type UpdateCallback = (nodes: CanvasNode[], edges: CanvasEdge[], viewport?: Viewport) => void;
type MergeCallback = (freshNodes: CanvasNode[], freshEdges: CanvasEdge[]) => void;

const DEFAULT_VIEWPORT: Viewport = { x: 32, y: 32, zoom: 1 };

/** Background-refresh from Firestore, merging with local state */
async function backgroundRefresh(
    userId: string,
    workspaceId: string,
    onMerge: MergeCallback
): Promise<void> {
    if (!useNetworkStatusStore.getState().isOnline) return;

    try {
        const [freshNodes, freshEdges] = await Promise.all([
            loadNodes(userId, workspaceId),
            loadEdges(userId, workspaceId),
        ]);

        onMerge(freshNodes, freshEdges);
    } catch (err) {
        logger.warn('[useWorkspaceLoader] Background refresh failed:', err);
    }
}

/** Load workspace from Firestore on cache miss */
async function loadFromFirestore(
    userId: string,
    workspaceId: string,
    onUpdate: UpdateCallback
): Promise<void> {
    const [nodes, edges] = await Promise.all([
        loadNodes(userId, workspaceId),
        loadEdges(userId, workspaceId),
    ]);
    onUpdate(nodes, edges, DEFAULT_VIEWPORT);
    workspaceCache.set(workspaceId, { nodes, edges, viewport: DEFAULT_VIEWPORT, loadedAt: Date.now() });
}

/** Apply canvas state update only if still mounted */
function applyIfMounted(
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    viewport: Viewport | undefined,
    getMounted: () => boolean
): void {
    if (!getMounted()) return;
    const current = useCanvasStore.getState();
    const newViewport = viewport ?? DEFAULT_VIEWPORT;

    // Skip update only if nodes, edges, AND viewport are identical
    if (
        current.nodes === nodes &&
        current.edges === edges &&
        current.viewport.x === newViewport.x &&
        current.viewport.y === newViewport.y &&
        current.viewport.zoom === newViewport.zoom
    ) {
        return;
    }

    useCanvasStore.setState({
        nodes,
        edges,
        selectedNodeIds: EMPTY_SELECTED_IDS as Set<string>,
        viewport: newViewport,
    });
}

/** Merge fresh server data into local state only if still mounted */
function mergeIfMounted(
    freshNodes: CanvasNode[],
    freshEdges: CanvasEdge[],
    getMounted: () => boolean,
    workspaceId: string
): void {
    if (!getMounted()) return;

    const state = useCanvasStore.getState();
    const mergedNodes = mergeNodes(state.nodes, freshNodes, state.editingNodeId);
    const mergedEdges = mergeEdges(state.edges, freshEdges);

    useCanvasStore.setState({ nodes: mergedNodes, edges: mergedEdges });
    workspaceCache.set(workspaceId, {
        nodes: mergedNodes,
        edges: mergedEdges,
        viewport: state.viewport,
        loadedAt: Date.now(),
    });
}

/** Load cluster groups from workspace store and prune deleted nodes (mount-guarded) */
function loadClustersIfMounted(workspaceId: string, getMounted: () => boolean): void {
    useCanvasStore.getState().clearClusterGroups();
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
    const groups = ws?.clusterGroups;
    if (!getMounted() || !groups || groups.length === 0) return;
    useCanvasStore.getState().setClusterGroups(groups);
    const existingNodeIds = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().pruneDeletedNodes(existingNodeIds);
}

/** Load Knowledge Bank entries into store (non-blocking, mount-guarded) */
async function loadKBIfMounted(
    userId: string,
    workspaceId: string,
    getMounted: () => boolean
): Promise<void> {
    try {
        const { loadKBEntries } = await import('@/features/knowledgeBank/services/knowledgeBankService');
        const { useKnowledgeBankStore } = await import('@/features/knowledgeBank/stores/knowledgeBankStore');
        const kbEntries = await loadKBEntries(userId, workspaceId);
        if (getMounted()) {
            useKnowledgeBankStore.getState().setEntries(kbEntries);
        }
    } catch (err: unknown) {
        logger.error('[useWorkspaceLoader] KB load failed:', err);
    }
}

interface LoadParams {
    userId: string;
    workspaceId: string;
    getMounted: () => boolean;
    setIsLoading: (v: boolean) => void;
    setError: (v: string | null) => void;
    setHasOfflineData: (v: boolean) => void;
}

async function runWorkspaceLoad(p: LoadParams): Promise<void> {
    const { userId, workspaceId, getMounted, setIsLoading, setError, setHasOfflineData } = p;
    const applyCallback: UpdateCallback = (n, e, vp) =>
        applyIfMounted(n, e, vp, getMounted);
    const mergeCallback: MergeCallback = (fn, fe) =>
        mergeIfMounted(fn, fe, getMounted, workspaceId);

    setIsLoading(true);
    setError(null);

    const cached = workspaceCache.get(workspaceId);
    if (getMounted()) setHasOfflineData(cached != null);

    if (cached) {
        applyCallback(cached.nodes, cached.edges, cached.viewport);
        if (getMounted()) setIsLoading(false);
        await backgroundRefresh(userId, workspaceId, mergeCallback);
        return;
    }

    const isOnline = useNetworkStatusStore.getState().isOnline;
    if (!isOnline) {
        if (getMounted()) { setError(strings.offline.noOfflineData); setIsLoading(false); }
        return;
    }

    try {
        await loadFromFirestore(userId, workspaceId, applyCallback);
    } catch (err) {
        if (getMounted()) {
            setError(err instanceof Error ? err.message : strings.offline.noOfflineData);
            logger.error('[useWorkspaceLoader]', err);
        }
    } finally {
        if (getMounted()) setIsLoading(false);
    }
}

export function useWorkspaceLoader(workspaceId: string): UseWorkspaceLoaderResult {
    const userId = useAuthStore((s) => s.user?.id);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasOfflineData, setHasOfflineData] = useState(false);
    const [spatialChunkingEnabled, setSpatialChunkingEnabled] = useState(false);

    useEffect(() => {
        useHistoryStore.getState().dispatch({ type: 'CLEAR' });
        useSaveStatusStore.getState().setIdle();

        if (!userId || !workspaceId) { setIsLoading(false); return; }

        let mounted = true;
        const getMounted = () => mounted;

        setSpatialChunkingEnabled(false);
        const checkChunking = () => {
            const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
            if (mounted) {
                setSpatialChunkingEnabled(resolveSpatialChunkingEnabled(ws?.spatialChunkingEnabled));
            }
        };

        void runWorkspaceLoad({ userId, workspaceId, getMounted, setIsLoading, setError, setHasOfflineData })
            .then(() => { loadClustersIfMounted(workspaceId, getMounted); checkChunking(); });
        void loadKBIfMounted(userId, workspaceId, getMounted);

        return () => { mounted = false; };
    }, [userId, workspaceId]);

    return { isLoading, error, hasOfflineData, spatialChunkingEnabled };
}
