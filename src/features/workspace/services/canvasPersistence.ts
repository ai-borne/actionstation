/**
 * Canvas persistence for autosave — chooses full sync vs change-only save.
 *
 * Without a snapshot of the last successful save for this workspace (first
 * save, or any save that did not reach Firestore) it runs the full
 * read-and-rewrite delete-sync. Otherwise it writes only what changed, with
 * zero reads. Returns the snapshot to diff the next save against.
 */
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import { saveNodes, saveEdges, saveNodeChanges, saveEdgeChanges } from './workspaceService';
import { saveTiledNodes } from './tiledNodeWriter';
import { type PersistedSnapshot, buildPersistedSnapshot, diffNodes, diffEdges } from './persistedSnapshot';

export interface PersistCanvasArgs {
    readonly userId: string;
    readonly workspaceId: string;
    readonly nodes: CanvasNode[];
    readonly edges: CanvasEdge[];
    /** Last successful save; null (or another workspace's) forces a full sync. */
    readonly snapshot: PersistedSnapshot | null;
    /** Dirty tile ids when spatial chunking is on; null saves flat node docs. */
    readonly dirtyTileIdsRef: { current: Set<string> } | null;
}

async function saveCanvasNodes(args: PersistCanvasArgs, base: PersistedSnapshot | null): Promise<void> {
    const { userId, workspaceId, nodes, dirtyTileIdsRef } = args;
    if (dirtyTileIdsRef) {
        const dirty = dirtyTileIdsRef.current;
        if (dirty.size === 0) return;
        await saveTiledNodes(userId, workspaceId, nodes, dirty);
        dirtyTileIdsRef.current = new Set<string>();
        return;
    }
    if (!base) return saveNodes(userId, workspaceId, nodes);
    const { upserts, deleted } = diffNodes(base, nodes);
    return saveNodeChanges(userId, workspaceId, upserts, deleted);
}

async function saveCanvasEdges(args: PersistCanvasArgs, base: PersistedSnapshot | null): Promise<void> {
    const { userId, workspaceId, edges } = args;
    if (!base) return saveEdges(userId, workspaceId, edges);
    const { upserts, deletedIds } = diffEdges(base, edges);
    return saveEdgeChanges(userId, workspaceId, upserts, deletedIds);
}

export async function persistCanvas(args: PersistCanvasArgs): Promise<PersistedSnapshot> {
    const base = args.snapshot?.workspaceId === args.workspaceId ? args.snapshot : null;
    await Promise.all([saveCanvasNodes(args, base), saveCanvasEdges(args, base)]);
    return buildPersistedSnapshot(args.workspaceId, args.nodes, args.edges);
}
