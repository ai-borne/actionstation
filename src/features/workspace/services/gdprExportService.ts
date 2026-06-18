/**
 * gdprExportService — GDPR Article 20 full user data export
 *
 * Fetches all user data across all workspaces from Firestore and assembles
 * a structured payload for download. Pure async service — no Zustand, no React.
 *
 * Covers: user profile, all workspaces, nodes, edges, and KB entries.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { loadUserWorkspaces, loadNodes, loadEdges } from './workspaceService';
import { loadKBEntries } from '@/features/knowledgeBank/services/knowledgeBankService';
import { subscriptionService } from '@/features/subscription/services/subscriptionService';
import { tryGetStorageUsageMb } from '@/features/subscription/services/storageUsageService';
import { legalStrings } from '@/shared/localization/legalStrings';
import { logger } from '@/shared/services/logger';
import {
    fetchGdprServerExportData,
    type GdprCalendarExport,
    type GdprStorageFileExport,
} from './gdprServerExportClient';
import type { Workspace } from '../types/workspace';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import type { KnowledgeBankEntry } from '@/features/knowledgeBank/types/knowledgeBank';

// ── Export payload types (SSOT) ────────────────────────────────────────────

export interface GdprUserProfile {
    readonly id: string;
    readonly email: string;
    readonly name: string;
}

interface SerializedNode {
    readonly id: string;
    readonly type: string;
    readonly position: { readonly x: number; readonly y: number };
    readonly data: Record<string, unknown>;
    readonly createdAt: string;
}

interface SerializedEdge {
    readonly id: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly relationshipType: string;
}

interface SerializedKBEntry {
    readonly id: string;
    readonly title: string;
    readonly content: string;
    readonly tags: readonly string[] | undefined;
    readonly type: string;
    readonly createdAt: string;
}

interface WorkspaceExport {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly createdAt: string;
    readonly nodes: readonly SerializedNode[];
    readonly edges: readonly SerializedEdge[];
    readonly knowledgeBankEntries: readonly SerializedKBEntry[];
}

interface GdprSubscriptionExport {
    readonly tier: string;
    readonly isActive: boolean;
    readonly expiresAt: string | null;
    readonly provider: string | null;
}

interface GdprUsageExport {
    readonly storageMb: number;
    readonly aiDailyCount: number | null;
    readonly aiDailyDate: string | null;
}

const EMPTY_CALENDAR_EXPORT: GdprCalendarExport = {
    connected: false,
    connectedAt: null,
    scope: null,
};

export interface GdprExportPayload {
    readonly exportedAt: string;
    readonly user: GdprUserProfile;
    readonly subscription: GdprSubscriptionExport;
    readonly usage: GdprUsageExport;
    readonly calendar: GdprCalendarExport;
    readonly storageFiles: readonly GdprStorageFileExport[];
    readonly workspaces: readonly WorkspaceExport[];
    readonly warnings?: readonly string[];
    readonly summary: {
        readonly totalWorkspaces: number;
        readonly totalNodes: number;
        readonly totalEdges: number;
        readonly totalKBEntries: number;
        readonly totalStorageFiles: number;
    };
}

// ── Serialization helpers ──────────────────────────────────────────────────

function serializeNode(n: CanvasNode): SerializedNode {
    return {
        id: n.id, type: n.type, position: n.position,
        data: n.data as Record<string, unknown>,
        createdAt: (n.createdAt instanceof Date ? n.createdAt : new Date()).toISOString(),
    };
}

function serializeEdge(e: CanvasEdge): SerializedEdge {
    return { id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, relationshipType: e.relationshipType };
}

function serializeKBEntry(e: KnowledgeBankEntry): SerializedKBEntry {
    return {
        id: e.id, title: e.title, content: e.content, tags: e.tags, type: e.type,
        createdAt: (e.createdAt instanceof Date ? e.createdAt : new Date()).toISOString(),
    };
}

// ── Workspace data fetcher ─────────────────────────────────────────────────

async function buildWorkspaceExport(userId: string, workspace: Workspace): Promise<WorkspaceExport> {
    const [nodes, edges, kbEntries] = await Promise.all([
        loadNodes(userId, workspace.id),
        loadEdges(userId, workspace.id),
        loadKBEntries(userId, workspace.id),
    ]);
    return {
        id: workspace.id,
        name: workspace.name,
        type: workspace.type ?? 'workspace',
        createdAt: (workspace.createdAt instanceof Date ? workspace.createdAt : new Date()).toISOString(),
        nodes: nodes.map(serializeNode),
        edges: edges.map(serializeEdge),
        knowledgeBankEntries: kbEntries.map(serializeKBEntry),
    };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all data for a user from Firestore and return a structured GDPR export payload.
 * This satisfies GDPR Article 20 — right to data portability.
 */
async function loadUsageExport(userId: string): Promise<GdprUsageExport> {
    const [storageMb, aiSnap] = await Promise.all([
        tryGetStorageUsageMb(userId),
        getDoc(doc(db, 'users', userId, 'usage', 'aiDaily')),
    ]);
    const aiData = aiSnap.exists() ? aiSnap.data() as { count?: number; date?: string } : null;
    return {
        storageMb: storageMb ?? 0,
        aiDailyCount: aiData?.count ?? null,
        aiDailyDate: aiData?.date ?? null,
    };
}

async function loadSubscriptionExport(userId: string): Promise<GdprSubscriptionExport> {
    const info = await subscriptionService.getSubscription(userId);
    return {
        tier: info.tier,
        isActive: info.isActive,
        expiresAt: info.expiresAt ? new Date(info.expiresAt).toISOString() : null,
        provider: info.provider ?? null,
    };
}

async function loadServerExportData(): Promise<{
    calendar: GdprCalendarExport;
    storageFiles: readonly GdprStorageFileExport[];
    warnings?: readonly string[];
}> {
    try {
        const serverData = await fetchGdprServerExportData();
        return { calendar: serverData.calendar, storageFiles: serverData.storageFiles };
    } catch (error: unknown) {
        logger.warn('[gdprExportService] Server export failed — returning partial payload', error);
        return {
            calendar: EMPTY_CALENDAR_EXPORT,
            storageFiles: [],
            warnings: [legalStrings.gdprServerExportFailed],
        };
    }
}

export async function fetchAllUserData(
    userId: string,
    profile: GdprUserProfile,
): Promise<GdprExportPayload> {
    const [workspaces, subscription, usage, serverData] = await Promise.all([
        loadUserWorkspaces(userId),
        loadSubscriptionExport(userId),
        loadUsageExport(userId),
        loadServerExportData(),
    ]);
    const workspaceExports = await Promise.all(
        workspaces.map((ws) => buildWorkspaceExport(userId, ws)),
    );
    return {
        exportedAt: new Date().toISOString(),
        user: profile,
        subscription,
        usage,
        calendar: serverData.calendar,
        storageFiles: serverData.storageFiles,
        workspaces: workspaceExports,
        ...(serverData.warnings ? { warnings: serverData.warnings } : {}),
        summary: {
            totalWorkspaces: workspaceExports.length,
            totalNodes: workspaceExports.reduce((sum, w) => sum + w.nodes.length, 0),
            totalEdges: workspaceExports.reduce((sum, w) => sum + w.edges.length, 0),
            totalKBEntries: workspaceExports.reduce((sum, w) => sum + w.knowledgeBankEntries.length, 0),
            totalStorageFiles: serverData.storageFiles.length,
        },
    };
}
