/**
 * gdprExportService Tests — GDPR Article 20 full user data export
 *
 * TDD: tests written before implementation.
 * Verifies that fetchAllUserData correctly assembles ALL user data across
 * all workspaces (nodes, edges, KB entries) plus user profile and summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workspace } from '../../types/workspace';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import type { KnowledgeBankEntry } from '@/features/knowledgeBank/types/knowledgeBank';
import { fetchAllUserData } from '../gdprExportService';
import { fetchGdprServerExportData } from '../gdprServerExportClient';
import { legalStrings } from '@/shared/localization/legalStrings';
import { loadUserWorkspaces, loadNodes, loadEdges } from '../workspaceService';
import { loadKBEntries } from '@/features/knowledgeBank/services/knowledgeBankService';

// ── Mock dependencies ──────────────────────────────────────────────────────

const mockWorkspace = (id: string): Workspace =>
    ({
        id,
        userId: 'user-1',
        name: `Workspace ${id}`,
        type: 'workspace',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        orderIndex: 0,
        nodeCount: 0,
        canvasSettings: { backgroundColor: 'grid' },
        includeAllNodesInPool: false,
        clusterGroups: [],
        spatialChunkingEnabled: false,
    } as Workspace);

const mockNode = (id: string): CanvasNode =>
    ({
        id,
        type: 'idea',
        position: { x: 10, y: 20 },
        data: { prompt: 'Test prompt', output: 'Test output', colorKey: 'default', contentMode: 'text' },
        workspaceId: 'ws-1',
        width: 300,
        height: 200,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
    } as CanvasNode);

const mockEdge = (id: string): CanvasEdge =>
    ({ id, sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'related' } as CanvasEdge);

const mockKBEntry = (id: string): KnowledgeBankEntry =>
    ({
        id,
        workspaceId: 'ws-1',
        type: 'text',
        title: 'KB Title',
        content: 'KB Content',
        tags: ['tag1'],
        pinned: false,
        enabled: true,
        parentEntryId: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
    } as KnowledgeBankEntry);

vi.mock('../workspaceService', () => ({
    loadUserWorkspaces: vi.fn(),
    loadNodes: vi.fn(),
    loadEdges: vi.fn(),
}));

vi.mock('@/features/knowledgeBank/services/knowledgeBankService', () => ({
    loadKBEntries: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({ id: 'usage-aiDaily' })),
    getDoc: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ count: 12, date: '2026-06-12' }),
    }),
}));

vi.mock('@/features/subscription/services/subscriptionService', () => ({
    subscriptionService: {
        getSubscription: vi.fn().mockResolvedValue({
            tier: 'free',
            isActive: true,
            expiresAt: null,
            provider: undefined,
        }),
    },
}));

vi.mock('@/features/subscription/services/storageUsageService', () => ({
    tryGetStorageUsageMb: vi.fn().mockResolvedValue(24),
}));

vi.mock('../gdprServerExportClient', () => ({
    fetchGdprServerExportData: vi.fn().mockResolvedValue({
        calendar: { connected: true, connectedAt: '2026-01-01T00:00:00.000Z', scope: 'calendar.events' },
        storageFiles: [{ path: 'users/user-1/a.png', sizeBytes: 1024, contentType: 'image/png', updatedAt: null }],
    }),
}));

const mockLoadUserWorkspaces = vi.mocked(loadUserWorkspaces);
const mockLoadNodes = vi.mocked(loadNodes);
const mockLoadEdges = vi.mocked(loadEdges);
const mockLoadKBEntries = vi.mocked(loadKBEntries);
const mockFetchGdprServerExportData = vi.mocked(fetchGdprServerExportData);

const USER_PROFILE = { id: 'user-1', email: 'test@example.com', name: 'Test User' };

describe('fetchAllUserData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLoadUserWorkspaces.mockResolvedValue([mockWorkspace('ws-1')]);
        mockLoadNodes.mockResolvedValue([mockNode('n1'), mockNode('n2')]);
        mockLoadEdges.mockResolvedValue([mockEdge('e1')]);
        mockLoadKBEntries.mockResolvedValue([mockKBEntry('kb-1')]);
    });

    it('includes user profile in the export payload', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.user).toEqual(USER_PROFILE);
    });

    it('includes ISO exportedAt timestamp', async () => {
        const before = new Date().toISOString();
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.exportedAt >= before).toBe(true);
    });

    it('fetches all workspaces for the given userId', async () => {
        await fetchAllUserData('user-1', USER_PROFILE);
        expect(mockLoadUserWorkspaces).toHaveBeenCalledWith('user-1');
    });

    it('fetches nodes, edges and KB entries for each workspace', async () => {
        await fetchAllUserData('user-1', USER_PROFILE);
        expect(mockLoadNodes).toHaveBeenCalledWith('user-1', 'ws-1');
        expect(mockLoadEdges).toHaveBeenCalledWith('user-1', 'ws-1');
        expect(mockLoadKBEntries).toHaveBeenCalledWith('user-1', 'ws-1');
    });

    it('serializes nodes with id, type, position and data', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        const node = result.workspaces[0]?.nodes[0];
        expect(node).toMatchObject({ id: 'n1', type: 'idea', position: { x: 10, y: 20 } });
        expect(node?.data).toBeDefined();
    });

    it('serializes edges with id, sourceNodeId, targetNodeId, relationshipType', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        const edge = result.workspaces[0]?.edges[0];
        expect(edge).toMatchObject({ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'related' });
    });

    it('serializes KB entries with id, title, content and tags', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        const entry = result.workspaces[0]?.knowledgeBankEntries[0];
        expect(entry).toMatchObject({ id: 'kb-1', title: 'KB Title', content: 'KB Content' });
    });

    it('includes correct summary statistics', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.summary).toEqual({
            totalWorkspaces: 1,
            totalNodes: 2,
            totalEdges: 1,
            totalKBEntries: 1,
            totalStorageFiles: 1,
        });
    });

    it('handles user with no workspaces', async () => {
        mockLoadUserWorkspaces.mockResolvedValue([]);
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.workspaces).toHaveLength(0);
        expect(result.summary.totalWorkspaces).toBe(0);
        expect(result.summary.totalNodes).toBe(0);
    });

    it('handles workspaces with no nodes, edges or KB entries', async () => {
        mockLoadNodes.mockResolvedValue([]);
        mockLoadEdges.mockResolvedValue([]);
        mockLoadKBEntries.mockResolvedValue([]);
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.workspaces[0]?.nodes).toHaveLength(0);
        expect(result.workspaces[0]?.edges).toHaveLength(0);
        expect(result.workspaces[0]?.knowledgeBankEntries).toHaveLength(0);
    });

    it('aggregates totals across multiple workspaces', async () => {
        mockLoadUserWorkspaces.mockResolvedValue([
            mockWorkspace('ws-1'),
            mockWorkspace('ws-2'),
        ]);
        mockLoadNodes.mockResolvedValue([mockNode('n1')]);
        mockLoadEdges.mockResolvedValue([]);
        mockLoadKBEntries.mockResolvedValue([]);
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.summary.totalWorkspaces).toBe(2);
        // loadNodes called once per workspace, so 1 node * 2 workspaces
        expect(result.summary.totalNodes).toBe(2);
    });

    it('fetches workspace data for all workspaces in parallel', async () => {
        mockLoadUserWorkspaces.mockResolvedValue([
            mockWorkspace('ws-1'),
            mockWorkspace('ws-2'),
        ]);
        await fetchAllUserData('user-1', USER_PROFILE);
        expect(mockLoadNodes).toHaveBeenCalledTimes(2);
        expect(mockLoadEdges).toHaveBeenCalledTimes(2);
        expect(mockLoadKBEntries).toHaveBeenCalledTimes(2);
    });

    it('serializes workspace createdAt as ISO string', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(typeof result.workspaces[0]?.createdAt).toBe('string');
        expect(result.workspaces[0]?.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('includes subscription and usage in export payload', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.subscription).toEqual({
            tier: 'free',
            isActive: true,
            expiresAt: null,
            provider: null,
        });
        expect(result.usage).toEqual({
            storageMb: 24,
            aiDailyCount: 12,
            aiDailyDate: '2026-06-12',
        });
    });

    it('includes calendar metadata and storage file inventory', async () => {
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.calendar.connected).toBe(true);
        expect(result.storageFiles).toHaveLength(1);
        expect(result.summary.totalStorageFiles).toBe(1);
    });

    it('returns partial export with warning when server export fails', async () => {
        mockFetchGdprServerExportData.mockRejectedValue(new Error('callable unavailable'));
        const result = await fetchAllUserData('user-1', USER_PROFILE);
        expect(result.calendar).toEqual({ connected: false, connectedAt: null, scope: null });
        expect(result.storageFiles).toEqual([]);
        expect(result.warnings).toEqual([legalStrings.gdprServerExportFailed]);
        expect(result.summary.totalStorageFiles).toBe(0);
        expect(result.workspaces).toHaveLength(1);
    });
});
