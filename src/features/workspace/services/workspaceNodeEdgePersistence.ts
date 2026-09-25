/**
 * Node/edge Firestore persistence — paginated load, full delete-sync save,
 * and change-only save (used by autosave after the first full sync).
 */
import { runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { type CanvasNode, normalizeNodeColorKey } from '@/features/canvas/types/node';
import { normalizeContentMode } from '@/features/canvas/types/contentMode';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import { removeUndefined, chunkedBatchWrite } from '@/shared/utils/firebaseUtils';
import { stripBase64Images } from '@/shared/utils/contentSanitizer';
import { fetchAllCollectionDocs } from '@/shared/utils/paginatedFirestoreQuery';
import { cleanupDeletedNodeStorage } from './nodeStorageCleanup';
import { migrateNode, CURRENT_SCHEMA_VERSION } from '@/migrations/migrationRunner';
import { logger } from '@/shared/services/logger';
import { FIRESTORE_QUERY_CAP } from '@/config/firestoreQueryConfig';
import {
    getSubcollectionRef,
    getSubcollectionDocRef,
} from './workspaceCollectionRefs';

const TRANSACTION_WRITE_LIMIT = 500;

function buildNodeDoc(userId: string, workspaceId: string, node: CanvasNode) {
    const sanitizedData = stripBase64Images(removeUndefined(node.data as Record<string, unknown>));
    return removeUndefined({
        id: node.id, userId, workspaceId, type: node.type, data: sanitizedData, position: node.position,
        width: node.width, height: node.height, createdAt: node.createdAt, updatedAt: serverTimestamp(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
    });
}

function firestoreTimestamp(value: unknown): Date {
    const ts = value as { toDate?: () => Date } | null | undefined;
    return ts?.toDate?.() ?? new Date();
}

function parseNodeDoc(data: Record<string, unknown>, workspaceId: string): CanvasNode {
    return migrateNode({
        id: data.id, workspaceId, type: data.type,
        data: {
            ...(data.data as CanvasNode['data']),
            colorKey: normalizeNodeColorKey((data.data as CanvasNode['data']).colorKey),
            contentMode: normalizeContentMode((data.data as CanvasNode['data']).contentMode),
        },
        position: data.position, width: data.width, height: data.height,
        createdAt: firestoreTimestamp(data.createdAt),
        updatedAt: firestoreTimestamp(data.updatedAt),
    } as CanvasNode);
}

type WriteOp = Parameters<typeof chunkedBatchWrite>[0][number];

/** Commits ops in one transaction when they fit, else in chunked batches. No-op when empty. */
async function commitOps(ops: WriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    if (ops.length > TRANSACTION_WRITE_LIMIT) {
        await chunkedBatchWrite(ops);
        return;
    }
    await runTransaction(db, (txn) => {
        ops.forEach((op) => { if (op.type === 'set') txn.set(op.ref, op.data); else txn.delete(op.ref); });
        return Promise.resolve();
    });
}

function buildEdgeDoc(userId: string, workspaceId: string, edge: CanvasEdge) {
    return {
        id: edge.id, userId, workspaceId, sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId, relationshipType: edge.relationshipType,
    };
}

function nodeOps(userId: string, workspaceId: string, upserts: readonly CanvasNode[], deletedIds: readonly string[]): WriteOp[] {
    const ref = (id: string) => getSubcollectionDocRef(userId, workspaceId, 'nodes', id);
    return [
        ...deletedIds.map((id): WriteOp => ({ type: 'delete', ref: ref(id) })),
        ...upserts.map((node): WriteOp => ({ type: 'set', ref: ref(node.id), data: buildNodeDoc(userId, workspaceId, node) })),
    ];
}

function edgeOps(userId: string, workspaceId: string, upserts: readonly CanvasEdge[], deletedIds: readonly string[]): WriteOp[] {
    const ref = (id: string) => getSubcollectionDocRef(userId, workspaceId, 'edges', id);
    return [
        ...deletedIds.map((id): WriteOp => ({ type: 'delete', ref: ref(id) })),
        ...upserts.map((edge): WriteOp => ({ type: 'set', ref: ref(edge.id), data: buildEdgeDoc(userId, workspaceId, edge) })),
    ];
}

function cleanupStorage(deletedNodes: CanvasNode[]): void {
    if (deletedNodes.length === 0) return;
    cleanupDeletedNodeStorage(deletedNodes).catch((err: unknown) =>
        logger.warn('[workspaceService] Storage cleanup failed:', err));
}

/** Full sync: reads every node doc, deletes ones missing locally, rewrites all local nodes. */
export async function saveNodes(userId: string, workspaceId: string, nodes: CanvasNode[]): Promise<void> {
    const existingDocs = await fetchAllCollectionDocs(getSubcollectionRef(userId, workspaceId, 'nodes'));
    const currentIds = new Set(nodes.map((n) => n.id));
    const deletedNodeData: CanvasNode[] = existingDocs
        .filter((d) => !currentIds.has(d.id))
        .map((d) => ({ id: d.id, data: (d.data() as Record<string, unknown>).data ?? {}, type: 'idea', position: { x: 0, y: 0 } }) as CanvasNode);

    if (existingDocs.length >= FIRESTORE_QUERY_CAP) {
        logger.info('[workspaceService] Paginated node delete-sync', { workspaceId, existing: existingDocs.length });
    }

    await commitOps(nodeOps(userId, workspaceId, nodes, deletedNodeData.map((n) => n.id)));
    cleanupStorage(deletedNodeData);
}

/** Full sync: reads every edge doc, deletes ones missing locally, rewrites all local edges. */
export async function saveEdges(userId: string, workspaceId: string, edges: CanvasEdge[]): Promise<void> {
    const existingDocs = await fetchAllCollectionDocs(getSubcollectionRef(userId, workspaceId, 'edges'));
    const currentIds = new Set(edges.map((e) => e.id));
    const deletedIds = existingDocs.map((d) => d.id).filter((id) => !currentIds.has(id));
    await commitOps(edgeOps(userId, workspaceId, edges, deletedIds));
}

/** Change-only save: writes the given nodes and deletes removed ones. Never reads. */
export async function saveNodeChanges(
    userId: string, workspaceId: string, upserts: readonly CanvasNode[], deleted: CanvasNode[],
): Promise<void> {
    await commitOps(nodeOps(userId, workspaceId, upserts, deleted.map((n) => n.id)));
    cleanupStorage(deleted);
}

/** Change-only save: writes the given edges and deletes removed ids. Never reads. */
export async function saveEdgeChanges(
    userId: string, workspaceId: string, upserts: readonly CanvasEdge[], deletedIds: readonly string[],
): Promise<void> {
    await commitOps(edgeOps(userId, workspaceId, upserts, deletedIds));
}

export async function loadNodes(userId: string, workspaceId: string): Promise<CanvasNode[]> {
    const nodesRef = getSubcollectionRef(userId, workspaceId, 'nodes');
    const docs = await fetchAllCollectionDocs(nodesRef);
    return docs.map((docSnapshot) => parseNodeDoc(docSnapshot.data() as Record<string, unknown>, workspaceId));
}

export async function loadEdges(userId: string, workspaceId: string): Promise<CanvasEdge[]> {
    const edgesRef = getSubcollectionRef(userId, workspaceId, 'edges');
    const docs = await fetchAllCollectionDocs(edgesRef);
    return docs.map((docSnapshot) => {
        const data = docSnapshot.data();
        /* eslint-disable @typescript-eslint/no-unsafe-assignment */
        return {
            id: data.id, sourceNodeId: data.sourceNodeId,
            targetNodeId: data.targetNodeId, relationshipType: data.relationshipType,
        } as CanvasEdge;
        /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
}

/** Load all node docs for workspace deletion cleanup (paginated). */
export async function loadAllNodeDocsForCleanup(
    userId: string,
    workspaceId: string,
): Promise<CanvasNode[]> {
    const nodesRef = getSubcollectionRef(userId, workspaceId, 'nodes');
    const docs = await fetchAllCollectionDocs(nodesRef);
    return docs.map((d) => ({
        id: d.id,
        data: (d.data() as Record<string, unknown>).data ?? {},
        type: 'idea',
        position: { x: 0, y: 0 },
    }) as CanvasNode);
}
