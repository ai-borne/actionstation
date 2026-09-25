/**
 * Firestore Schema Migration Runner
 * Runs idempotent, backward-compatible migrations on workspace load.
 * Each migration is a pure function that transforms a document in place.
 */
import type { Workspace } from '@/features/workspace/types/workspace';
import type { CanvasNode } from '@/features/canvas/types/node';
import { logger } from '@/shared/services/logger';
import { getTileId } from '@/features/workspace/services/tileCalculator';

export const CURRENT_SCHEMA_VERSION = 3;

export interface Migration {
    readonly version: number;
    readonly name: string;
    readonly migrateWorkspace?: (ws: Workspace) => Workspace;
    readonly migrateNode?: (node: CanvasNode) => CanvasNode;
}

const migrations: Migration[] = [
    {
        version: 1,
        name: 'add_schema_version',
        migrateWorkspace: (ws) => ({ ...ws, schemaVersion: ws.schemaVersion ?? 1 }),
        migrateNode: (node) => ({ ...node, schemaVersion: node.schemaVersion ?? 1 }),
    },
    {
        // userId is written by workspaceService.saveNodes on every save — no client-side backfill needed.
        // (firestore.rules must tolerate docs that predate userId, or that save is denied: see F9.)
        version: 2,
        name: 'ensure_userId_field',
    },
    {
        version: 3,
        name: 'add_tileId_field',
        migrateNode: (node) => ({
            ...node,
            tileId: node.tileId ?? getTileId(node.position),
        }),
    },
];

function getDocVersion(doc: { schemaVersion?: number }): number {
    return doc.schemaVersion ?? 0;
}

/** Apply all pending migrations to a workspace document. Pure + idempotent. */
export function migrateWorkspace(ws: Workspace): Workspace {
    let current = ws;
    const startVersion = getDocVersion(current);
    for (const m of migrations) {
        if (m.version > startVersion && m.migrateWorkspace) {
            current = m.migrateWorkspace(current);
        }
    }
    current = { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
    if (startVersion < CURRENT_SCHEMA_VERSION) {
        logger.info(`Migrated workspace ${ws.id}: v${startVersion} → v${CURRENT_SCHEMA_VERSION}`);
    }
    return current;
}

/** Apply all pending migrations to a node document. Pure + idempotent. */
export function migrateNode(node: CanvasNode): CanvasNode {
    let current = node;
    const startVersion = getDocVersion(current);
    for (const m of migrations) {
        if (m.version > startVersion && m.migrateNode) {
            current = m.migrateNode(current);
        }
    }
    return { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
}
