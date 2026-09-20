/**
 * nodeDeletionSignal - The single choke point that announces USER-INTENDED node deletions.
 * The canvas store emits here from every deleting action; other features (e.g. calendar)
 * subscribe, so the canvas never imports them and no caller has to remember cleanup.
 * Unloading a canvas (workspace switch, new workspace, tile eviction) is NOT a deletion
 * and never emits.
 */
import { logger } from '@/shared/services/logger';
import type { CanvasNode } from '../types/node';

export type NodesDeletedListener = (nodes: readonly CanvasNode[]) => void;

const listeners = new Set<NodesDeletedListener>();

/** Subscribe to deletions. Returns the unsubscribe function. */
export function onNodesDeleted(listener: NodesDeletedListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function emitNodesDeleted(nodes: readonly CanvasNode[]): void {
    if (nodes.length === 0) return;
    for (const listener of [...listeners]) {
        try {
            listener(nodes);
        } catch (err) {
            // A subscriber must never break the deletion itself or the other subscribers.
            logger.error('[nodeDeletionSignal] listener failed', err instanceof Error ? err : new Error(String(err)));
        }
    }
}
