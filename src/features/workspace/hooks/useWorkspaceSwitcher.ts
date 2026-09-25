/**
 * useWorkspaceSwitcher - Atomic workspace switching with cache-first pattern
 */
import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useCanvasStore, EMPTY_SELECTED_IDS } from '@/features/canvas/stores/canvasStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { loadNodes, loadEdges } from '../services/workspaceService';
import { workspaceCache } from '../services/workspaceCache';
import { useOfflineQueueStore } from '../stores/offlineQueueStore';
import { flushWorkspaceSave } from '../services/saveFlushRegistry';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { loadWorkspaceKB } from '../services/workspaceSwitchHelpers';
import { persistLastWorkspaceId } from '../services/lastWorkspaceService';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';

interface UseWorkspaceSwitcherResult {
    isSwitching: boolean;
    error: string | null;
    switchWorkspace: (workspaceId: string) => Promise<void>;
}


/**
 * Online: start saving the workspace being left (its save reads the canvas synchronously,
 * so swapping the canvas right after is safe) and queue a snapshot only if that reports failure.
 * Offline: queue the snapshot as before.
 */
function saveLeavingWorkspace(
    userId: string, workspaceId: string,
    nodes: ReturnType<typeof useCanvasStore.getState>['nodes'],
    edges: ReturnType<typeof useCanvasStore.getState>['edges'],
): void {
    const queue = () => useOfflineQueueStore.getState().queueSave(userId, workspaceId, nodes, edges);
    if (!useNetworkStatusStore.getState().isOnline) { queue(); return; }
    flushWorkspaceSave(workspaceId)
        .then((isSafe) => { if (!isSafe) queue(); })
        .catch((err: unknown) => { logger.warn('[useWorkspaceSwitcher] Save on leave failed:', err); queue(); });
}

export function useWorkspaceSwitcher(): UseWorkspaceSwitcherResult {
    const user = useAuthStore((s) => s.user);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const isSwitching = useWorkspaceStore((s) => s.isSwitching);

    const [error, setError] = useState<string | null>(null);
    const switchingRef = useRef(false);
    const currentIdRef = useRef(currentWorkspaceId);
    const userRef = useRef(user);
    currentIdRef.current = currentWorkspaceId;
    userRef.current = user;

    const switchWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
        const currentUser = userRef.current;
        const curId = currentIdRef.current;
        if (workspaceId === curId || !currentUser) return;
        if (switchingRef.current) return;

        switchingRef.current = true;
        useWorkspaceStore.getState().setSwitching(true);
        setError(null);

        try {
            const { nodes: currentNodes, edges: currentEdges } = useCanvasStore.getState();
            if (curId && (currentNodes.length > 0 || currentEdges.length > 0)) {
                useWorkspaceStore.getState().setNodeCount(curId, currentNodes.length);
                saveLeavingWorkspace(currentUser.id, curId, currentNodes, currentEdges);
            }

            const cached = workspaceCache.get(workspaceId);
            let newNodes;
            let newEdges;

            if (cached) {
                newNodes = cached.nodes;
                newEdges = cached.edges;
            } else {
                [newNodes, newEdges] = await Promise.all([
                    loadNodes(currentUser.id, workspaceId),
                    loadEdges(currentUser.id, workspaceId),
                ]);
                workspaceCache.set(workspaceId, { nodes: newNodes, edges: newEdges, loadedAt: Date.now() });
            }

            useCanvasStore.setState({
                nodes: newNodes,
                edges: newEdges,
                selectedNodeIds: EMPTY_SELECTED_IDS as Set<string>,
            });
            useWorkspaceStore.getState().setNodeCount(workspaceId, newNodes.length);
            useWorkspaceStore.getState().setCurrentWorkspaceId(workspaceId);
            persistLastWorkspaceId(workspaceId);
            void loadWorkspaceKB(currentUser.id, workspaceId);
        } catch (err) {
            const message = err instanceof Error ? err.message : strings.workspace.switchError;
            setError(message);
            logger.error('[useWorkspaceSwitcher]', err);
        } finally {
            useWorkspaceStore.getState().setSwitching(false);
            switchingRef.current = false;
        }
    }, []); // stable — reads live values via refs

    return { isSwitching, error, switchWorkspace };
}
