/**
 * useTiledSaveCallback — Save function for spatially-chunked workspaces.
 * Wraps saveTiledNodes to write only dirty tiles, with dirty-tile tracking.
 *
 * Zustand compliance:
 * - Selectors for state reads
 * - getState() for actions
 * - Refs for stale-closure prevention
 */
import { useRef, useCallback, useEffect } from 'react';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { saveTiledNodes } from '@/features/workspace/services/tiledNodeWriter';
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useOfflineQueueStore } from '../stores/offlineQueueStore';
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { getTileId } from '@/features/workspace/services/tileCalculator';
import type { CanvasNode } from '@/features/canvas/types/node';

/**
 * Returns a save function that persists only dirty tiles.
 * Dirty tiles are computed by comparing tileIds of changed nodes.
 */
export function useTiledSaveCallback(workspaceId: string) {
    const nodes = useCanvasStore((s) => s.nodes);
    const edges = useCanvasStore((s) => s.edges);
    const userId = useAuthStore((s) => s.user?.id);
    const dirtyTileIdsRef = useRef(new Set<string>());
    const prevNodesRef = useRef<CanvasNode[]>([]);

    const latestNodesRef = useRef(nodes);
    const latestEdgesRef = useRef(edges);
    latestNodesRef.current = nodes;
    latestEdgesRef.current = edges;

    useEffect(() => {
        const prev = prevNodesRef.current;
        if (nodes === prev) return;
        const prevMap = new Map(prev.map((n) => [n.id, n]));
        for (const node of nodes) {
            const prevNode = prevMap.get(node.id);
            if (!prevNode || prevNode !== node) {
                dirtyTileIdsRef.current.add(node.tileId ?? getTileId(node.position));
            }
        }
        for (const p of prev) {
            if (!nodes.some((n) => n.id === p.id)) {
                dirtyTileIdsRef.current.add(p.tileId ?? getTileId(p.position));
            }
        }
        prevNodesRef.current = nodes;
    }, [nodes]);

    const save = useCallback(async () => {
        if (!userId || !workspaceId) return;
        const currentNodes = latestNodesRef.current;
        const currentEdges = latestEdgesRef.current;

        if (!useTabRoleStore.getState().isLeader) {
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            return;
        }

        const isOnline = useNetworkStatusStore.getState().isOnline;
        if (!isOnline) {
            useOfflineQueueStore.getState().queueSave(userId, workspaceId, currentNodes, currentEdges);
            useSaveStatusStore.getState().setQueued();
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            return;
        }

        const dirty = dirtyTileIdsRef.current;
        if (dirty.size === 0) return;

        const { setSaving, setSaved, setError } = useSaveStatusStore.getState();
        setSaving();
        try {
            await saveTiledNodes(userId, workspaceId, currentNodes, dirty);
            workspaceCache.update(workspaceId, currentNodes, currentEdges);
            dirtyTileIdsRef.current = new Set<string>();
            setSaved();
        } catch (error) {
            const message = error instanceof Error ? error.message : strings.offline.saveError;
            setError(message);
            toast.error(strings.offline.saveFailed);
        }
    }, [userId, workspaceId]);

    return { save, nodes, edges, dirtyTileIdsRef };
}
