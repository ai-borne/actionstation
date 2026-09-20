/**
 * useSaveCallback - Stable save function with latest-value refs.
 * Refs ensure save() always persists the latest state, avoiding
 * stale closure capture in debounced callbacks.
 *
 * @internal timeoutRef and lastPersistedWorkspaceRef are owned by this hook;
 * only useAutosave may read/write them. No other consumer should touch them.
 */
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { saveNodes, saveEdges, saveWorkspace } from '@/features/workspace/services/workspaceService';
import { saveTiledNodes } from '@/features/workspace/services/tiledNodeWriter';
import { useDirtyTileIds } from './useDirtyTileIds';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { useWorkspaceStore } from '@/features/workspace/stores/workspaceStore';
import type { Workspace } from '@/features/workspace/types/workspace';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useOfflineQueueStore } from '../stores/offlineQueueStore';
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';
import { appCheckReady } from '@/config/firebase';
import { resolveSpatialChunkingEnabled } from '@/config/featureFlags';

export function serializeWorkspacePoolFields(workspace: Workspace | null): string {
    if (!workspace) return '';
    return JSON.stringify({ includeAllNodesInPool: workspace.includeAllNodesInPool ?? false });
}

/** Saves workspace metadata if nodeCount or pool-fields changed. No-op when already up-to-date. */
async function persistWorkspaceIfNeeded(
    userId: string,
    workspaceId: string,
    workspace: Workspace | null,
    newNodeCount: number,
    lastPersistedRef: React.MutableRefObject<string>,
): Promise<void> {
    if (!workspace) return;
    const nodeCountChanged = workspace.nodeCount !== newNodeCount;
    const wsJson = serializeWorkspacePoolFields(workspace);
    if (!nodeCountChanged && lastPersistedRef.current === wsJson) return;
    await saveWorkspace(userId, { ...workspace, nodeCount: newNodeCount });
    if (nodeCountChanged) useWorkspaceStore.getState().setNodeCount(workspaceId, newNodeCount);
    lastPersistedRef.current = wsJson;
}

export function useSaveCallback(workspaceId: string) {
    const nodes = useCanvasStore((s) => s.nodes);
    const edges = useCanvasStore((s) => s.edges);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const currentWorkspace = useMemo(
        () => workspaces.find((w) => w.id === workspaceId) ?? null,
        [workspaces, workspaceId],
    );
    // Scalar selector — safe to list in useCallback deps without causing cascade re-renders.
    const userId = useAuthStore((s) => s.user?.id);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPersistedWorkspaceRef = useRef('');

    const spatialChunkingEnabled = resolveSpatialChunkingEnabled(currentWorkspace?.spatialChunkingEnabled);
    const dirtyTileIdsRef = useDirtyTileIds(nodes);
    const latestNodesRef = useRef(nodes);
    const latestEdgesRef = useRef(edges);
    const latestWorkspaceRef = useRef(currentWorkspace);
    latestNodesRef.current = nodes;
    latestEdgesRef.current = edges;
    latestWorkspaceRef.current = currentWorkspace;

    const save = useCallback(async () => {
        if (!userId || !workspaceId) return;
        const currentNodes = latestNodesRef.current;
        const currentEdges = latestEdgesRef.current;

        if (!useTabRoleStore.getState().isLeader) {
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            return;
        }
        if (!useNetworkStatusStore.getState().isOnline) {
            useOfflineQueueStore.getState().queueSave(userId, workspaceId, currentNodes, currentEdges);
            useSaveStatusStore.getState().setQueued();
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            return;
        }

        // Wait for App Check token before first Firestore write.
        // Prevents permission-denied on the initial save when reCAPTCHA is still loading.
        await appCheckReady;

        const { setSaving, setSaved, setError } = useSaveStatusStore.getState();
        setSaving();
        try {
            const nodeSave = spatialChunkingEnabled
                ? (async () => {
                    const dirty = dirtyTileIdsRef.current;
                    if (dirty.size === 0) return;
                    await saveTiledNodes(userId, workspaceId, currentNodes, dirty);
                    dirtyTileIdsRef.current = new Set<string>();
                })()
                : saveNodes(userId, workspaceId, currentNodes);
            await Promise.all([
                nodeSave,
                saveEdges(userId, workspaceId, currentEdges),
            ]);
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            await persistWorkspaceIfNeeded(userId, workspaceId, latestWorkspaceRef.current, currentNodes.length, lastPersistedWorkspaceRef);
            setSaved();
        } catch (error) {
            const message = error instanceof Error ? error.message : strings.offline.saveError;
            logger.error('[useSaveCallback] Save failed', error, { userId, workspaceId, message });
            setError(message);
            toast.error(strings.offline.saveFailed);
        }
    // dirtyTileIdsRef is a stable ref from useDirtyTileIds — omit from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref identity is stable
    }, [userId, workspaceId, spatialChunkingEnabled]);

    useEffect(() => {
        const flush = () => {
            if (!document.hidden || !timeoutRef.current) return;
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            void save();
        };
        document.addEventListener('visibilitychange', flush);
        return () => document.removeEventListener('visibilitychange', flush);
    }, [save]);

    return { save, nodes, edges, currentWorkspace, timeoutRef, lastPersistedWorkspaceRef };
}

