/**
 * Node/edge Firestore persistence — paginated load and delete-sync save.
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

export async function saveNodes(userId: string, workspaceId: string, nodes: CanvasNode[]): Promise<void> {
    const nodesRef = getSubcollectionRef(userId, workspaceId, 'nodes');
    const existingDocs = await fetchAllCollectionDocs(nodesRef);
    const existingIds = new Set(existingDocs.map((d) => d.id));
    const currentIds = new Set(nodes.map((n) => n.id));
    const deletedNodeData: CanvasNode[] = existingDocs
        .filter((d) => !currentIds.has(d.id))
        .map((d) => ({ id: d.id, data: (d.data() as Record<string, unknown>).data ?? {}, type: 'idea', position: { x: 0, y: 0 } }) as CanvasNode);

    if (existingDocs.length >= FIRESTORE_QUERY_CAP) {
        logger.info('[workspaceService] Paginated node delete-sync', { workspaceId, existing: existingDocs.length });
    }

    const totalOps = deletedNodeData.length + nodes.length;
    if (totalOps <= TRANSACTION_WRITE_LIMIT) {
        await runTransaction(db, (txn) => {
            existingIds.forEach((id) => { if (!currentIds.has(id)) txn.delete(getSubcollectionDocRef(userId, workspaceId, 'nodes', id)); });
            nodes.forEach((node) => txn.set(getSubcollectionDocRef(userId, workspaceId, 'nodes', node.id), buildNodeDoc(userId, workspaceId, node)));
            return Promise.resolve();
        });
    } else {
        const ops: Array<{ type: 'set' | 'delete'; ref: ReturnType<typeof getSubcollectionDocRef>; data?: Record<string, unknown> }> = [];
        existingIds.forEach((id) => { if (!currentIds.has(id)) ops.push({ type: 'delete', ref: getSubcollectionDocRef(userId, workspaceId, 'nodes', id) }); });
        nodes.forEach((node) => ops.push({ type: 'set', ref: getSubcollectionDocRef(userId, workspaceId, 'nodes', node.id), data: buildNodeDoc(userId, workspaceId, node) }));
        await chunkedBatchWrite(ops as Parameters<typeof chunkedBatchWrite>[0]);
    }

    if (deletedNodeData.length > 0) {
        cleanupDeletedNodeStorage(deletedNodeData).catch((err: unknown) =>
            logger.warn('[workspaceService] Storage cleanup failed:', err));
    }
}

export async function saveEdges(userId: string, workspaceId: string, edges: CanvasEdge[]): Promise<void> {
    const edgesRef = getSubcollectionRef(userId, workspaceId, 'edges');
    const existingDocs = await fetchAllCollectionDocs(edgesRef);
    const existingIds = new Set(existingDocs.map((d) => d.id));
    const currentIds = new Set(edges.map((e) => e.id));
    const buildEdgeDoc = (edge: CanvasEdge) => ({
        id: edge.id, userId, workspaceId, sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId, relationshipType: edge.relationshipType,
    });
    const totalOps = Math.max(0, existingIds.size - currentIds.size) + edges.length;
    if (totalOps <= TRANSACTION_WRITE_LIMIT) {
        await runTransaction(db, (txn) => {
            existingIds.forEach((id) => { if (!currentIds.has(id)) txn.delete(getSubcollectionDocRef(userId, workspaceId, 'edges', id)); });
            edges.forEach((edge) => txn.set(getSubcollectionDocRef(userId, workspaceId, 'edges', edge.id), buildEdgeDoc(edge)));
            return Promise.resolve();
        });
    } else {
        const ops: Array<{ type: 'set' | 'delete'; ref: ReturnType<typeof getSubcollectionDocRef>; data?: Record<string, unknown> }> = [];
        existingIds.forEach((id) => { if (!currentIds.has(id)) ops.push({ type: 'delete', ref: getSubcollectionDocRef(userId, workspaceId, 'edges', id) }); });
        edges.forEach((edge) => ops.push({ type: 'set', ref: getSubcollectionDocRef(userId, workspaceId, 'edges', edge.id), data: buildEdgeDoc(edge) }));
        await chunkedBatchWrite(ops as Parameters<typeof chunkedBatchWrite>[0]);
    }
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
