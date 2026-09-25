/**
 * Persisted snapshot — what the last successful save wrote to Firestore.
 * Autosave diffs the canvas against it so each save writes only changed
 * nodes/edges instead of reading and rewriting the whole workspace.
 *
 * Keys cover every persisted field except server-managed ones (updatedAt).
 */
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

interface PersistedNode {
    readonly node: CanvasNode;
    readonly key: string;
}

export interface PersistedSnapshot {
    readonly workspaceId: string;
    readonly nodes: ReadonlyMap<string, PersistedNode>;
    readonly edges: ReadonlyMap<string, string>;
}

export interface NodeDiff {
    readonly upserts: CanvasNode[];
    /** Last persisted version of each removed node — needed for Storage cleanup. */
    readonly deleted: CanvasNode[];
}

export interface EdgeDiff {
    readonly upserts: CanvasEdge[];
    readonly deletedIds: string[];
}

function nodeKey(node: CanvasNode): string {
    return JSON.stringify([node.type, node.data, node.position, node.width, node.height]);
}

function edgeKey(edge: CanvasEdge): string {
    return JSON.stringify([edge.sourceNodeId, edge.targetNodeId, edge.relationshipType]);
}

export function buildPersistedSnapshot(
    workspaceId: string, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[],
): PersistedSnapshot {
    return {
        workspaceId,
        nodes: new Map(nodes.map((node) => [node.id, { node, key: nodeKey(node) }])),
        edges: new Map(edges.map((edge) => [edge.id, edgeKey(edge)])),
    };
}

export function diffNodes(snapshot: PersistedSnapshot, nodes: readonly CanvasNode[]): NodeDiff {
    const currentIds = new Set(nodes.map((n) => n.id));
    const upserts = nodes.filter((n) => snapshot.nodes.get(n.id)?.key !== nodeKey(n));
    const deleted = [...snapshot.nodes.values()]
        .filter((entry) => !currentIds.has(entry.node.id))
        .map((entry) => entry.node);
    return { upserts, deleted };
}

export function diffEdges(snapshot: PersistedSnapshot, edges: readonly CanvasEdge[]): EdgeDiff {
    const currentIds = new Set(edges.map((e) => e.id));
    const upserts = edges.filter((e) => snapshot.edges.get(e.id) !== edgeKey(e));
    const deletedIds = [...snapshot.edges.keys()].filter((id) => !currentIds.has(id));
    return { upserts, deletedIds };
}
