/**
 * Tracks dirty tile IDs when nodes move, change, or are deleted.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { getTileId } from '@/features/workspace/services/tileCalculator';
import type { CanvasNode } from '@/features/canvas/types/node';

export function useDirtyTileIds(nodes: CanvasNode[]): MutableRefObject<Set<string>> {
    const dirtyTileIdsRef = useRef(new Set<string>());
    const prevNodesRef = useRef<CanvasNode[]>([]);

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

    return dirtyTileIdsRef;
}
