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
import { saveWorkspace } from '@/features/workspace/services/workspaceService';
import { persistCanvas } from '@/features/workspace/services/canvasPersistence';
import { registerSaveFlush } from '@/features/workspace/services/saveFlushRegistry';
import type { PersistedSnapshot } from '@/features/workspace/services/persistedSnapshot';
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
    // Last successful save — null forces the next save to do a full sync.
    const snapshotRef = useRef<PersistedSnapshot | null>(null);

    const spatialChunkingEnabled = resolveSpatialChunkingEnabled(currentWorkspace?.spatialChunkingEnabled);
    const dirtyTileIdsRef = useDirtyTileIds(nodes);
    const latestNodesRef = useRef(nodes);
    const latestEdgesRef = useRef(edges);
    const latestWorkspaceRef = useRef(currentWorkspace);
    latestNodesRef.current = nodes;
    latestEdgesRef.current = edges;
    latestWorkspaceRef.current = currentWorkspace;

    /** Resolves true when the state is safe (persisted or queued), false when this tab persisted nothing. */
    const save = useCallback(async (): Promise<boolean> => {
        if (!userId || !workspaceId) return false;
        const startedAt = Date.now();
        const currentNodes = latestNodesRef.current;
        const currentEdges = latestEdgesRef.current;
        // Captured with the nodes: after the awaits below the user may have switched workspace,
        // and the ref then holds the OTHER workspace (its doc would get this workspace's count).
        const workspaceAtStart = latestWorkspaceRef.current?.id === workspaceId ? latestWorkspaceRef.current : null;

        if (!useTabRoleStore.getState().isLeader) {
            snapshotRef.current = null;
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            return false;
        }
        if (!useNetworkStatusStore.getState().isOnline) {
            snapshotRef.current = null;
            useOfflineQueueStore.getState().queueSave(userId, workspaceId, currentNodes, currentEdges);
            useSaveStatusStore.getState().setQueued();
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            return true;
        }

        // Wait for App Check token before first Firestore write.
        // Prevents permission-denied on the initial save when reCAPTCHA is still loading.
        await appCheckReady;

        const { setSaving, setSaved, setError } = useSaveStatusStore.getState();
        setSaving();
        try {
            snapshotRef.current = await persistCanvas({
                userId, workspaceId, nodes: currentNodes, edges: currentEdges,
                snapshot: snapshotRef.current,
                dirtyTileIdsRef: spatialChunkingEnabled ? dirtyTileIdsRef : null,
            });
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            await persistWorkspaceIfNeeded(userId, workspaceId, workspaceAtStart, currentNodes.length, lastPersistedWorkspaceRef);
            setSaved();
            // Any snapshot queued before this save started is stale now.
            useOfflineQueueStore.getState().discardWorkspace(workspaceId, startedAt);
            return true;
        } catch (error) {
            snapshotRef.current = null;
            const message = error instanceof Error ? error.message : strings.offline.saveError;
            logger.error('[useSaveCallback] Save failed', error, { userId, workspaceId, message });
            setError(message);
            toast.error(strings.offline.saveFailed);
            // The toast promises a retry: keep the state in the queue so it is not lost.
            useOfflineQueueStore.getState().queueSave(userId, workspaceId, currentNodes, currentEdges);
            return true;
        }
    // dirtyTileIdsRef is a stable ref from useDirtyTileIds — omit from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref identity is stable
    }, [userId, workspaceId, spatialChunkingEnabled]);

    // Lets the workspace switcher save this workspace when the user leaves it.
    useEffect(() => {
        if (!workspaceId) return;
        return registerSaveFlush(workspaceId, save);
    }, [workspaceId, save]);

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

