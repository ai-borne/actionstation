/**
 * Phase B — contentMode normalization on Firestore deserialization.
 *
 * Validates that loadNodes normalizes contentMode (parallel to colorKey)
 * so corrupted or future-unknown values don't reach the UI layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadNodes } from '../services/workspaceService';

vi.mock('@/config/firebase', () => ({ db: {} }));

const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({ id: 'mock-ref' })),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn(),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    getCountFromServer: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
    query: vi.fn((ref: unknown) => ref),
    limit: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
}));

const ts = { toDate: () => new Date('2025-01-01') };

function mockNode(id: string, dataOverrides: Record<string, unknown> = {}) {
    return {
        data: () => ({
            id,
            type: 'idea',
            data: { heading: 'Test', output: '# Topic', ...dataOverrides },
            position: { x: 0, y: 0 },
            createdAt: ts,
            updatedAt: ts,
        }),
    };
}

describe('loadNodes — contentMode normalization', () => {
    beforeEach(() => mockGetDocs.mockReset());

    it('preserves valid "mindmap" contentMode', async () => {
        mockGetDocs.mockResolvedValue({ docs: [mockNode('n1', { contentMode: 'mindmap' })] });
        const [node] = await loadNodes('u1', 'ws1');
        expect(node!.data.contentMode).toBe('mindmap');
    });

    it('preserves valid "text" contentMode', async () => {
        mockGetDocs.mockResolvedValue({ docs: [mockNode('n1', { contentMode: 'text' })] });
        const [node] = await loadNodes('u1', 'ws1');
        expect(node!.data.contentMode).toBe('text');
    });

    it('normalizes unknown string contentMode to "text"', async () => {
        mockGetDocs.mockResolvedValue({ docs: [mockNode('n1', { contentMode: 'flowchart' })] });
        const [node] = await loadNodes('u1', 'ws1');
        expect(node!.data.contentMode).toBe('text');
    });

    it('normalizes undefined contentMode to "text"', async () => {
        mockGetDocs.mockResolvedValue({ docs: [mockNode('n1')] });
        const [node] = await loadNodes('u1', 'ws1');
        expect(node!.data.contentMode).toBe('text');
    });

    it('normalizes numeric contentMode to "text"', async () => {
        mockGetDocs.mockResolvedValue({ docs: [mockNode('n1', { contentMode: 42 })] });
        const [node] = await loadNodes('u1', 'ws1');
        expect(node!.data.contentMode).toBe('text');
    });
});
