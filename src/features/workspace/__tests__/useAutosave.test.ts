/**
 * Tests for useAutosave hook
 * Covers debounced autosave, save status lifecycle, and offline queueing.
 * Structural tests → useAutosave.structural.test.ts
 * Pool toggle tests → useAutosave.poolToggle.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutosave } from '../hooks/useAutosave';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
// useAuthStore is mocked below - no direct import needed
import { saveNodes, saveEdges } from '@/features/workspace/services/workspaceService';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';
import { toast } from '@/shared/stores/toastStore';

vi.mock('@/config/firebase', () => ({
    appCheckReady: Promise.resolve(),
    db: {},
    auth: {},
    storage: {},
    functions: {},
}));

vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: Object.assign(vi.fn(), {
        getState: () => ({ nodes: [], edges: [], clearClusterGroups: vi.fn(), setClusterGroups: vi.fn(), pruneDeletedNodes: vi.fn() }),
    }),
}));

/** Selector-aware mock: applies selector when called with one, returns full state otherwise */
function setCanvasState(state: { nodes: unknown[]; edges: unknown[] }) {
    vi.mocked(useCanvasStore).mockImplementation(
        ((selector?: (s: typeof state) => unknown) =>
            selector ? selector(state) : state
        ) as typeof useCanvasStore
    );
}

// Mock auth store - must handle selector pattern: useAuthStore((s) => s.user)
let mockAuthState: { user: { id: string } | null } = { user: { id: 'user-123' } };
function setAuthState(state: { user: { id: string } | null }) {
    mockAuthState = state;
}
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((selector?: (s: typeof mockAuthState) => unknown) => {
        return typeof selector === 'function' ? selector(mockAuthState) : mockAuthState;
    }),
}));

vi.mock('@/features/workspace/services/workspaceService', () => Object.fromEntries(
    ['saveNodes', 'saveEdges', 'saveNodeChanges', 'saveEdgeChanges'].map((k) => [k, vi.fn().mockResolvedValue(undefined)]),
));

vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: Object.assign(vi.fn(() => []), {
        getState: () => ({ workspaces: [], setNodeCount: vi.fn() }),
    }),
}));

vi.mock('@/features/workspace/services/workspaceCache', () => ({
    workspaceCache: { update: vi.fn() },
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const mockQueueSave = vi.fn();
vi.mock('../stores/offlineQueueStore', () => ({
    useOfflineQueueStore: {
        getState: () => ({ queueSave: mockQueueSave }),
    },
}));

describe('useAutosave', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        setAuthState({ user: { id: 'user-123' } });
        setCanvasState({ nodes: [], edges: [] });
        useSaveStatusStore.setState({ status: 'idle', lastSavedAt: null, lastError: null });
        useNetworkStatusStore.setState({ isOnline: true });
        // Simulate being the leader tab; default is false to prevent write-window race (R2 fix)
        useTabRoleStore.setState({ isLeader: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should not save when user is not logged in', async () => {
        setAuthState({ user: null });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(saveNodes).not.toHaveBeenCalled();
    });

    it('should not save when workspaceId is empty', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave(''));
        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(saveNodes).not.toHaveBeenCalled();
    });

    it('should debounce save calls', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        const { rerender } = renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(500); });
        rerender();
        await act(async () => { vi.advanceTimersByTime(500); });
        rerender();

        expect(saveNodes).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(saveNodes).toHaveBeenCalledTimes(1);
    });

    it('should save after debounce period', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [{ id: 'e-1', sourceNodeId: 'n-1', targetNodeId: 'n-2' }],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(saveNodes).toHaveBeenCalledWith('u-1', 'workspace-1', expect.any(Array));
        expect(saveEdges).toHaveBeenCalledWith('u-1', 'workspace-1', expect.any(Array));
    });

    it('should update cache after successful save', async () => {
        setAuthState({ user: { id: 'u-1' } });
        const testNodes = [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }];
        setCanvasState({ nodes: testNodes, edges: [] });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(workspaceCache.update).toHaveBeenCalledWith('workspace-1', testNodes, []);
    });

    it('should not save when data has not changed', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({ nodes: [], edges: [] });

        const { rerender } = renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });
        rerender();
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(saveNodes).toHaveBeenCalledTimes(1);
    });

    it('should set save status to saved after successful save', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(useSaveStatusStore.getState().status).toBe('saved');
        expect(useSaveStatusStore.getState().lastSavedAt).not.toBeNull();
    });

    it('should set save status to error and show toast on failure', async () => {
        vi.mocked(saveNodes).mockRejectedValueOnce(new Error('Network error'));
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(useSaveStatusStore.getState().status).toBe('error');
        expect(useSaveStatusStore.getState().lastError).toBe('Network error');
        expect(toast.error).toHaveBeenCalled();
    });

    it('should queue save when offline instead of calling Firestore', async () => {
        useNetworkStatusStore.setState({ isOnline: false });
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(mockQueueSave).toHaveBeenCalled();
        expect(saveNodes).not.toHaveBeenCalled();
        expect(saveEdges).not.toHaveBeenCalled();
    });

    it('should set status to queued when offline', async () => {
        useNetworkStatusStore.setState({ isOnline: false });
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(useSaveStatusStore.getState().status).toBe('queued');
    });

    it('should update cache even when queueing offline', async () => {
        useNetworkStatusStore.setState({ isOnline: false });
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        await act(async () => { vi.advanceTimersByTime(2500); });

        expect(workspaceCache.update).toHaveBeenCalled();
    });

    it('should cleanup timeout on unmount — no save fires after unmount', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        const { unmount } = renderHook(() => useAutosave('workspace-1'));
        unmount();

        // Advance past debounce — no save should fire after the hook is unmounted
        await act(async () => { vi.advanceTimersByTime(3000); });
        expect(saveNodes).not.toHaveBeenCalled();
    });

    it('should not schedule save when isWorkspaceLoading is true', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1', true));
        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(saveNodes).not.toHaveBeenCalled();
    });

    it('should flush pending save immediately when tab becomes hidden', async () => {
        setAuthState({ user: { id: 'u-1' } });
        setCanvasState({
            nodes: [{ id: 'n-1', workspaceId: 'ws-1', type: 'idea', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
        });

        renderHook(() => useAutosave('workspace-1'));
        // Debounce timer is set but has not fired yet
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(saveNodes).not.toHaveBeenCalled();

        // Simulate tab becoming hidden — should flush immediately
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });

        expect(saveNodes).toHaveBeenCalled();

        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });

});
