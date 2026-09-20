/**
 * Workspace Model - Strict type definition
 */
import type { ClusterGroup } from '@/features/clustering/types/cluster';

export type CanvasBackground = 'white' | 'light' | 'dark' | 'grid';

export interface CanvasSettings {
    backgroundColor: CanvasBackground;
}

export type WorkspaceType = 'workspace' | 'divider';

export interface Workspace {
    id: string;
    userId: string;
    name: string;
    canvasSettings: CanvasSettings;
    createdAt: Date;
    updatedAt: Date;
    orderIndex?: number;
    type?: WorkspaceType; // Undefined means 'workspace'
    nodeCount?: number;
    /** Include ALL nodes in this workspace in the AI Canvas Memory pool */
    includeAllNodesInPool?: boolean;
    /** Persisted cluster groups (stored as workspace metadata, not subcollection) */
    clusterGroups?: ClusterGroup[];
    /** Schema version for forward-compatible migrations */
    schemaVersion?: number;
    /** Enables tile-based spatial chunking — default false; gated by SPATIAL_CHUNKING_PROD_ENABLED until Sprint D */
    spatialChunkingEnabled?: boolean;
}

/**
 * Create a new workspace with defaults
 */
export function createWorkspace(
    id: string,
    userId: string,
    name: string
): Workspace {
    const now = new Date();
    return {
        id,
        userId,
        name,
        canvasSettings: {
            backgroundColor: 'grid',
        },
        createdAt: now,
        updatedAt: now,
        orderIndex: Date.now(),
        type: 'workspace',
    };
}

/**
 * Create a divider item instead of a full workspace
 */
export function createDivider(id: string, userId: string): Workspace {
    const now = new Date();
    return {
        id,
        userId,
        name: '---', // Keep a fallback name for backwards compatibility
        canvasSettings: { backgroundColor: 'white' },
        createdAt: now,
        updatedAt: now,
        orderIndex: Date.now(),
        type: 'divider',
    };
}
