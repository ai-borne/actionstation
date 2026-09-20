/**
 * Spatial Chunking Migration — one-time conversion from flat nodes/ to tiles/.
 * Reads all nodes from the flat subcollection, computes tile IDs, and writes
 * each node into the appropriate tile subcollection.
 *
 * - Flat nodes/ docs are NOT deleted (kept as backup)
 * - Workspace gets spatialChunkingEnabled = true after completion
 * - Idempotent: re-running on an empty flat collection is a no-op
 */
import { doc, collection, getDocs, setDoc, updateDoc, query, limit, startAfter, orderBy, serverTimestamp, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { CanvasNode } from '@/features/canvas/types/node';
import { normalizeNodeColorKey } from '@/features/canvas/types/node';
import { normalizeContentMode } from '@/features/canvas/types/contentMode';
import { getTileId } from '@/features/workspace/services/tileCalculator';
import { removeUndefined } from '@/shared/utils/firebaseUtils';
import { stripBase64Images } from '@/shared/utils/contentSanitizer';
import { CURRENT_SCHEMA_VERSION } from '@/migrations/migrationRunner';
import { logger } from '@/shared/services/logger';
import { FIRESTORE_QUERY_CAP } from '@/config/firestoreQueryConfig';
import { SPATIAL_CHUNKING_PROD_ENABLED } from '@/config/featureFlags';

export interface MigrationResult {
    nodesProcessed: number;
    tilesCreated: number;
    durationMs: number;
}

interface FirestoreTimestamp {
    toDate?: () => Date;
}

function parseNodeFromDoc(
    docData: Record<string, unknown>,
    workspaceId: string,
): { node: CanvasNode; tileId: string } {
    const position = docData.position as CanvasNode['position'];
    const created = docData.createdAt as FirestoreTimestamp | undefined;
    const updated = docData.updatedAt as FirestoreTimestamp | undefined;
    const tileId = getTileId(position);
    const rawData = docData.data as CanvasNode['data'];

    const node: CanvasNode = {
        id: docData.id as string,
        workspaceId,
        type: docData.type as CanvasNode['type'],
        data: {
            ...rawData,
            colorKey: normalizeNodeColorKey(rawData.colorKey),
            contentMode: normalizeContentMode(rawData.contentMode),
        },
        position,
        width: docData.width as number | undefined,
        height: docData.height as number | undefined,
        createdAt: created?.toDate?.() ?? new Date(),
        updatedAt: updated?.toDate?.() ?? new Date(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        tileId,
    };
    return { node, tileId };
}

function writeTileNode(
    userId: string, workspaceId: string, node: CanvasNode, tileId: string,
): Promise<void> {
    const sanitizedData = stripBase64Images(removeUndefined(node.data as Record<string, unknown>));
    const tileDocRef = doc(
        db, 'users', userId, 'workspaces', workspaceId, 'tiles', tileId, 'nodes', node.id,
    );
    return setDoc(tileDocRef, removeUndefined({
        id: node.id, userId, workspaceId, tileId,
        type: node.type, data: sanitizedData, position: node.position,
        width: node.width, height: node.height,
        createdAt: node.createdAt, updatedAt: serverTimestamp(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
    }));
}

export async function migrateFlatToTiled(
    userId: string,
    workspaceId: string,
): Promise<MigrationResult> {
    const start = Date.now();
    const nodesRef = collection(db, 'users', userId, 'workspaces', workspaceId, 'nodes');
    const tileSet = new Set<string>();
    let totalProcessed = 0;
    let lastDoc: QueryDocumentSnapshot | undefined;

    for (;;) {
        const q = lastDoc
            ? query(nodesRef, orderBy('__name__'), startAfter(lastDoc), limit(FIRESTORE_QUERY_CAP))
            : query(nodesRef, orderBy('__name__'), limit(FIRESTORE_QUERY_CAP));
        const snapshot = await getDocs(q);
        if (snapshot.size === 0) break;

        const writes: Array<Promise<void>> = [];
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data() as Record<string, unknown>;
            const { node, tileId } = parseNodeFromDoc(data, workspaceId);
            tileSet.add(tileId);
            writes.push(writeTileNode(userId, workspaceId, node, tileId));
        }
        await Promise.all(writes);

        totalProcessed += snapshot.size;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < FIRESTORE_QUERY_CAP) break;
    }

    await updateDoc(
        doc(db, 'users', userId, 'workspaces', workspaceId),
        {
            spatialChunkingEnabled: SPATIAL_CHUNKING_PROD_ENABLED,
            updatedAt: serverTimestamp(),
        },
    );

    logger.info(`[spatialChunkingMigration] Migrated ${totalProcessed} nodes into ${tileSet.size} tiles`);

    return {
        nodesProcessed: totalProcessed,
        tilesCreated: tileSet.size,
        durationMs: Date.now() - start,
    };
}
