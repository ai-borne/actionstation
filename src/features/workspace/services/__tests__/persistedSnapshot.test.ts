/**
 * persistedSnapshot tests — diffing the canvas against the last successful save
 * so autosave writes only changed nodes/edges.
 */
import { describe, it, expect } from 'vitest';
import { buildPersistedSnapshot, diffNodes, diffEdges } from '../persistedSnapshot';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

const makeNode = (id: string, overrides?: Partial<CanvasNode>): CanvasNode => ({
    id,
    workspaceId: 'ws-1',
    type: 'idea',
    data: { heading: `Heading ${id}` },
    position: { x: 0, y: 0 },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
});

const makeEdge = (id: string, overrides?: Partial<CanvasEdge>): CanvasEdge => ({
    id,
    workspaceId: 'ws-1',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
    relationshipType: 'related',
    ...overrides,
});

describe('buildPersistedSnapshot', () => {
    it('records the workspace id', () => {
        expect(buildPersistedSnapshot('ws-1', [], []).workspaceId).toBe('ws-1');
    });
});

describe('diffNodes', () => {
    const base = [makeNode('n1'), makeNode('n2')];
    const snapshot = buildPersistedSnapshot('ws-1', base, []);

    it('returns nothing when nodes are unchanged', () => {
        expect(diffNodes(snapshot, base)).toEqual({ upserts: [], deleted: [] });
    });

    it('treats equal content in new object references as unchanged', () => {
        const clones = base.map((n) => ({ ...n, data: { ...n.data }, position: { ...n.position } }));
        expect(diffNodes(snapshot, clones)).toEqual({ upserts: [], deleted: [] });
    });

    it('ignores updatedAt-only changes', () => {
        const touched = [{ ...base[0]!, updatedAt: new Date('2026-06-01') }, base[1]!];
        expect(diffNodes(snapshot, touched).upserts).toEqual([]);
    });

    it('upserts added nodes', () => {
        const added = makeNode('n3');
        expect(diffNodes(snapshot, [...base, added]).upserts).toEqual([added]);
    });

    it.each([
        ['data', { data: { heading: 'Edited' } }],
        ['position', { position: { x: 10, y: 0 } }],
        ['width', { width: 320 }],
        ['height', { height: 240 }],
        ['type', { type: 'media' as CanvasNode['type'] }],
    ])('upserts nodes whose %s changed', (_field, overrides) => {
        const changed = makeNode('n1', overrides);
        expect(diffNodes(snapshot, [changed, base[1]!]).upserts).toEqual([changed]);
    });

    it('returns the last persisted version of deleted nodes (for Storage cleanup)', () => {
        expect(diffNodes(snapshot, [base[1]!])).toEqual({ upserts: [], deleted: [base[0]] });
    });
});

describe('diffEdges', () => {
    const base = [makeEdge('e1'), makeEdge('e2', { targetNodeId: 'n3' })];
    const snapshot = buildPersistedSnapshot('ws-1', [], base);

    it('returns nothing when edges are unchanged', () => {
        expect(diffEdges(snapshot, base.map((e) => ({ ...e })))).toEqual({ upserts: [], deletedIds: [] });
    });

    it('upserts added edges', () => {
        const added = makeEdge('e3');
        expect(diffEdges(snapshot, [...base, added]).upserts).toEqual([added]);
    });

    it.each([
        ['sourceNodeId', { sourceNodeId: 'n9' }],
        ['targetNodeId', { targetNodeId: 'n9' }],
        ['relationshipType', { relationshipType: 'derived' as CanvasEdge['relationshipType'] }],
    ])('upserts edges whose %s changed', (_field, overrides) => {
        const changed = makeEdge('e1', overrides);
        expect(diffEdges(snapshot, [changed, base[1]!]).upserts).toEqual([changed]);
    });

    it('returns ids of deleted edges', () => {
        expect(diffEdges(snapshot, [base[0]!])).toEqual({ upserts: [], deletedIds: ['e2'] });
    });
});
