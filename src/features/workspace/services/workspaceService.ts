/** Workspace Service - Firestore persistence for workspaces */
import { doc, setDoc, getDoc, getDocs, collection, writeBatch, serverTimestamp, getCountFromServer, updateDoc, query, limit } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { type Workspace, createWorkspace, createDivider } from '../types/workspace';
import { strings } from '@/shared/localization/strings';
import { generateUUID } from '@/shared/utils/uuid';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import { removeUndefined, batchDeleteCollection } from '@/shared/utils/firebaseUtils';
import { cleanupDeletedNodeStorage } from './nodeStorageCleanup';
import { offlineQueueService } from './offlineQueueService';
import { stripBase64Images } from '@/shared/utils/contentSanitizer';
import { getSubcollectionRef, getSubcollectionDocRef } from './workspaceCollectionRefs';
import {
    saveNodes as persistSaveNodes,
    saveEdges as persistSaveEdges,
    loadNodes as persistLoadNodes,
    loadEdges as persistLoadEdges,
    loadAllNodeDocsForCleanup,
} from './workspaceNodeEdgePersistence';
import { loadWorkspaceBundle, invalidateBundleCache } from './bundleLoader';
import { migrateWorkspace, CURRENT_SCHEMA_VERSION } from '@/migrations/migrationRunner';
import { logger } from '@/shared/services/logger';
import { WORKSPACE_LIST_CAP } from '@/config/firestoreQueryConfig';

/** Create a new workspace and save to Firestore */
export async function createNewWorkspace(userId: string, name?: string): Promise<Workspace> {
    const workspaceId = `workspace-${generateUUID()}`;
    const workspace = createWorkspace(workspaceId, userId, name ?? strings.workspace.untitled);
    workspace.nodeCount = 0;
    await saveWorkspace(userId, workspace);
    invalidateBundleCache();
    return workspace;
}

/** Create a new divider and save to Firestore */
export async function createNewDividerWorkspace(userId: string): Promise<Workspace> {
    const workspaceId = `divider-${generateUUID()}`;
    const workspace = createDivider(workspaceId, userId);
    await saveWorkspace(userId, workspace);
    invalidateBundleCache();
    return workspace;
}

/** Save workspace metadata to Firestore */
export async function saveWorkspace(userId: string, workspace: Workspace): Promise<void> {
    const workspaceRef = doc(db, 'users', userId, 'workspaces', workspace.id);
    await setDoc(workspaceRef, {
        id: workspace.id,
        name: workspace.name,
        canvasSettings: workspace.canvasSettings,
        createdAt: workspace.createdAt,
        updatedAt: serverTimestamp(),
        orderIndex: workspace.orderIndex ?? Date.now(),
        type: workspace.type ?? 'workspace',
        nodeCount: workspace.nodeCount ?? 0,
        includeAllNodesInPool: workspace.includeAllNodesInPool ?? false,
        clusterGroups: workspace.clusterGroups ?? [],
        // Default false — gated by SPATIAL_CHUNKING_PROD_ENABLED until Sprint D wires tile load/save
        spatialChunkingEnabled: workspace.spatialChunkingEnabled ?? false,
    });
}

/** Efficiently update the node count of a workspace without rewriting other metadata */
export async function updateWorkspaceNodeCount(userId: string, workspaceId: string, nodeCount: number): Promise<void> {
    await updateDoc(doc(db, 'users', userId, 'workspaces', workspaceId), { nodeCount, updatedAt: serverTimestamp() });
}

/** Firestore workspace document shape */
interface WorkspaceDoc {
    id: string;
    name: string;
    canvasSettings?: Workspace['canvasSettings'];
    createdAt?: { toDate?: () => Date };
    updatedAt?: { toDate?: () => Date };
    orderIndex?: number;
    type?: 'workspace' | 'divider';
    nodeCount?: number;
    includeAllNodesInPool?: boolean;
    clusterGroups?: unknown[];
    spatialChunkingEnabled?: boolean;
}

function validateClusterGroups(raw: unknown[] | undefined): Workspace['clusterGroups'] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is NonNullable<Workspace['clusterGroups']>[number] =>
        typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).id === 'string'
        && Array.isArray((item as Record<string, unknown>).nodeIds)
        && typeof (item as Record<string, unknown>).label === 'string'
        && typeof (item as Record<string, unknown>).colorIndex === 'number');
}

async function backfillNodeCount(
    userId: string, workspaceId: string, docRef: ReturnType<typeof doc>,
): Promise<number> {
    try {
        const countSnap = await getCountFromServer(getSubcollectionRef(userId, workspaceId, 'nodes'));
        const count = countSnap.data().count;
        setDoc(docRef, { nodeCount: count }, { merge: true })
            .catch((err: unknown) => logger.error('[workspaceService] Failed to backfill nodeCount:', err));
        return count;
    } catch (error: unknown) {
        logger.error('[workspaceService] Failed to get nodeCount for workspace', error, { workspaceId });
        return 0;
    }
}

function buildWorkspace(data: WorkspaceDoc, userId: string, nodeCount: number): Workspace {
    return migrateWorkspace({
        id: data.id, userId, name: data.name,
        canvasSettings: data.canvasSettings ?? { backgroundColor: 'grid' },
        createdAt: data.createdAt?.toDate?.() ?? new Date(),
        updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
        orderIndex: data.orderIndex ?? Date.now(), type: data.type ?? 'workspace',
        nodeCount, includeAllNodesInPool: data.includeAllNodesInPool ?? false,
        clusterGroups: validateClusterGroups(data.clusterGroups),
        spatialChunkingEnabled: data.spatialChunkingEnabled ?? false,
    });
}

/** Load workspace from Firestore */
export async function loadWorkspace(userId: string, workspaceId: string): Promise<Workspace | null> {
    const workspaceRef = doc(db, 'users', userId, 'workspaces', workspaceId);
    const snapshot = await getDoc(workspaceRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as WorkspaceDoc;
    const nodeCount = data.nodeCount !== undefined || data.type === 'divider'
        ? (data.nodeCount ?? 0)
        : await backfillNodeCount(userId, workspaceId, workspaceRef);
    return buildWorkspace(data, userId, nodeCount);
}

/** Load all workspaces for a user from Firestore (tries bundle first, falls back to direct query) */
export async function loadUserWorkspaces(userId: string): Promise<Workspace[]> {
    const bundleSnapshot = await loadWorkspaceBundle();
    const workspacesRef = collection(db, 'users', userId, 'workspaces');
    const q = query(workspacesRef, limit(WORKSPACE_LIST_CAP));
    const snapshot = bundleSnapshot ?? await getDocs(q);
    if (snapshot.size >= WORKSPACE_LIST_CAP) {
        logger.warn('[workspaceService] Workspace list cap reached', { cap: WORKSPACE_LIST_CAP });
    }
    const workspaces: Workspace[] = [];
    const CHUNK_SIZE = 20;
    for (let i = 0; i < snapshot.docs.length; i += CHUNK_SIZE) {
        const chunk = snapshot.docs.slice(i, i + CHUNK_SIZE);
        const processed = await Promise.all(chunk.map(async (docSnap) => {
            const data = docSnap.data() as WorkspaceDoc;
            const nodeCount = data.nodeCount !== undefined || data.type === 'divider'
                ? (data.nodeCount ?? 0)
                : await backfillNodeCount(userId, data.id, docSnap.ref as ReturnType<typeof doc>);
            return buildWorkspace(data, userId, nodeCount);
        }));
        workspaces.push(...processed);
    }
    return workspaces;
}

/** Append a single node to a workspace without disturbing existing nodes */
export async function appendNode(userId: string, workspaceId: string, node: CanvasNode): Promise<void> {
    const sanitizedData = stripBase64Images(removeUndefined(node.data as Record<string, unknown>));
    const nodeDoc = removeUndefined({
        id: node.id, userId, workspaceId, type: node.type, data: sanitizedData, position: node.position,
        width: node.width, height: node.height, createdAt: node.createdAt, updatedAt: serverTimestamp(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    await setDoc(getSubcollectionDocRef(userId, workspaceId, 'nodes', node.id), nodeDoc);
}

/** Save nodes — stripBase64Images applied in workspaceNodeEdgePersistence.buildNodeDoc */
export async function saveNodes(userId: string, workspaceId: string, nodes: CanvasNode[]): Promise<void> {
    void stripBase64Images;
    await persistSaveNodes(userId, workspaceId, nodes);
}

export async function saveEdges(userId: string, workspaceId: string, edges: CanvasEdge[]): Promise<void> {
    await persistSaveEdges(userId, workspaceId, edges);
}

/** Change-only node/edge saves (no reads) — stripBase64Images applied in buildNodeDoc */
export { saveNodeChanges, saveEdgeChanges } from './workspaceNodeEdgePersistence';

export async function loadNodes(userId: string, workspaceId: string): Promise<CanvasNode[]> {
    return persistLoadNodes(userId, workspaceId);
}

export async function loadEdges(userId: string, workspaceId: string): Promise<CanvasEdge[]> {
    return persistLoadEdges(userId, workspaceId);
}

/** Delete a workspace and all its contents (nodes, edges, KB entries, Storage files) */
export async function deleteWorkspace(userId: string, workspaceId: string): Promise<void> {
    const { deleteAllKBEntries } = await import('@/features/knowledgeBank/services/knowledgeBankService');
    await deleteAllKBEntries(userId, workspaceId);
    const nodesRef = getSubcollectionRef(userId, workspaceId, 'nodes');
    const edgesRef = getSubcollectionRef(userId, workspaceId, 'edges');
    const nodesToClean = await loadAllNodeDocsForCleanup(userId, workspaceId);
    void cleanupDeletedNodeStorage(nodesToClean).catch((err: unknown) =>
        logger.warn('[workspaceService] deleteWorkspace storage cleanup failed:', err));
    await batchDeleteCollection(nodesRef);
    await batchDeleteCollection(edgesRef);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', userId, 'workspaces', workspaceId));
    await batch.commit();
    // A queued offline snapshot would recreate the deleted nodes on the next drain.
    offlineQueueService.discardWorkspace(workspaceId);
    invalidateBundleCache();
}
export { updateWorkspaceOrder } from './workspaceOrderService';
