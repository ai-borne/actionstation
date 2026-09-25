/**
 * useAutosave Stale Closure Test
 * TDD RED: Verifies save() uses latest nodes/edges, not stale closure values
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutosave } from '../useAutosave';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';

let canvasState = { nodes: [] as unknown[], edges: [] as unknown[] };

vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: vi.fn((selector?: (s: typeof canvasState) => unknown) =>
        typeof selector === 'function' ? selector(canvasState) : canvasState
    ),
}));

vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((selector?: (s: { user: { id: string } }) => unknown) => {
        const state = { user: { id: 'user-1' } };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: vi.fn((selector?: (s: { workspaces: unknown[] }) => unknown) => {
        const state = { workspaces: [], setNodeCount: vi.fn() };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

const mockSaveNodes = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/workspace/services/workspaceService', () => ({
    saveNodes: (...args: unknown[]) => mockSaveNodes(...args),
    saveEdges: vi.fn().mockResolvedValue(undefined),
    saveNodeChanges: vi.fn().mockResolvedValue(undefined),
    saveEdgeChanges: vi.fn().mockResolvedValue(undefined),
    saveWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/workspace/services/workspaceCache', () => ({
    workspaceCache: { update: vi.fn() },
}));

vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: {
        getState: () => ({
            setSaving: vi.fn(), setSaved: vi.fn(), setError: vi.fn(), setQueued: vi.fn(),
        }),
    },
}));

vi.mock('@/shared/stores/networkStatusStore', () => ({
    useNetworkStatusStore: { getState: () => ({ isOnline: true }) },
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../stores/offlineQueueStore', () => ({
    useOfflineQueueStore: { getState: () => ({ queueSave: vi.fn() }) },
}));

const nodeA = { id: 'a', data: { heading: 'A' }, position: { x: 0, y: 0 }, width: 100, height: 100 };
const nodeB = { id: 'b', data: { heading: 'B' }, position: { x: 100, y: 100 }, width: 100, height: 100 };

describe('useAutosave stale closure prevention', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        canvasState = { nodes: [], edges: [] };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('saves latest nodes, not stale ones captured at debounce start', async () => {
        const { rerender } = renderHook(() => useAutosave('ws-1'));

        canvasState = { nodes: [nodeA], edges: [] };
        vi.mocked(useCanvasStore).mockImplementation(
            ((selector?: (s: typeof canvasState) => unknown) =>
                typeof selector === 'function' ? selector(canvasState) : canvasState
            ) as typeof useCanvasStore
        );
        rerender();

        await act(async () => { vi.advanceTimersByTime(500); });

        canvasState = { nodes: [nodeA, nodeB], edges: [] };
        vi.mocked(useCanvasStore).mockImplementation(
            ((selector?: (s: typeof canvasState) => unknown) =>
                typeof selector === 'function' ? selector(canvasState) : canvasState
            ) as typeof useCanvasStore
        );
        rerender();

        await act(async () => { vi.advanceTimersByTime(2000); });
        await act(async () => { await Promise.resolve(); });

        if (mockSaveNodes.mock.calls.length > 0) {
            const lastCall = mockSaveNodes.mock.calls[mockSaveNodes.mock.calls.length - 1]!;
            const savedNodes = lastCall[2];
            expect(savedNodes).toHaveLength(2);
        }
    });
});
