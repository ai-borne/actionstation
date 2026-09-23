/**
 * useWorkspaceLoading — bounded load.
 * A wedged Firestore/IndexedDB (seen on Safari after clearing site data) used to
 * leave the sidebar empty and the canvas on "Loading..." forever with no error.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkspaceLoading, WORKSPACE_LIST_TIMEOUT_MS } from '../useWorkspaceLoading';
import { loadUserWorkspaces } from '@/features/workspace/services/workspaceService';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';
import { indexedDbService } from '@/shared/services/indexedDbService';
import { toastWithAction } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import type { Workspace } from '@/features/workspace/types/workspace';

const { mockSetWorkspaces, mockSetCurrentWorkspaceId } = vi.hoisted(() => ({
    mockSetWorkspaces: vi.fn(),
    mockSetCurrentWorkspaceId: vi.fn(),
}));

vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-1' } }),
}));

vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: {
        getState: () => ({
            currentWorkspaceId: null,
            setWorkspaces: mockSetWorkspaces,
            setCurrentWorkspaceId: mockSetCurrentWorkspaceId,
        }),
    },
}));

vi.mock('@/features/workspace/services/workspaceService', () => ({ loadUserWorkspaces: vi.fn() }));

vi.mock('@/features/workspace/services/workspaceCache', () => ({
    workspaceCache: { hydrateFromIdb: vi.fn(), preload: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/shared/services/indexedDbService', () => ({
    indexedDbService: { get: vi.fn(), put: vi.fn().mockResolvedValue(true) },
    IDB_STORES: { metadata: 'metadata' },
}));

vi.mock('@/shared/stores/toastStore', () => ({ toastWithAction: vi.fn() }));

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

const CACHED = [{ id: 'ws-cached', name: 'Cached', type: 'workspace', orderIndex: 0, updatedAt: 1 }];
const FRESH = [{
    id: 'ws-fresh', userId: 'user-1', name: 'Fresh', type: 'workspace', orderIndex: 0,
    canvasSettings: { backgroundColor: 'grid' }, createdAt: new Date(), updatedAt: new Date(),
}] as unknown as Workspace[];

describe('useWorkspaceLoading — load timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.mocked(workspaceCache.hydrateFromIdb).mockResolvedValue(undefined);
        vi.mocked(indexedDbService.get).mockResolvedValue(CACHED);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('applies fresh workspaces and shows no warning when the load finishes in time', async () => {
        vi.mocked(loadUserWorkspaces).mockResolvedValue(FRESH);
        renderHook(() => useWorkspaceLoading());

        await act(async () => { await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_TIMEOUT_MS + 1); });

        expect(mockSetWorkspaces).toHaveBeenCalledWith(FRESH);
        expect(toastWithAction).not.toHaveBeenCalled();
    });

    it('falls back to cached workspaces and warns with Retry when the list load hangs', async () => {
        vi.mocked(loadUserWorkspaces).mockReturnValue(never());
        renderHook(() => useWorkspaceLoading());

        await act(async () => { await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_TIMEOUT_MS - 1); });
        expect(toastWithAction).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(1); });

        expect(mockSetWorkspaces).toHaveBeenCalledWith([expect.objectContaining({ id: 'ws-cached', userId: 'user-1' })]);
        expect(toastWithAction).toHaveBeenCalledWith(
            strings.workspace.loadSlow,
            'warning',
            expect.objectContaining({ label: strings.common.retry }),
            expect.any(Number),
        );
    });

    it('also times out when IndexedDB hydration hangs', async () => {
        vi.mocked(workspaceCache.hydrateFromIdb).mockReturnValue(never());
        vi.mocked(loadUserWorkspaces).mockResolvedValue(FRESH);
        renderHook(() => useWorkspaceLoading());

        await act(async () => { await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_TIMEOUT_MS); });

        expect(toastWithAction).toHaveBeenCalledTimes(1);
    });

    it('still applies the fresh list if it arrives after the timeout', async () => {
        let resolveLoad: (ws: Workspace[]) => void = () => undefined;
        vi.mocked(loadUserWorkspaces).mockReturnValue(new Promise((r) => { resolveLoad = r; }));
        renderHook(() => useWorkspaceLoading());
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_TIMEOUT_MS); });

        await act(async () => { resolveLoad(FRESH); await vi.advanceTimersByTimeAsync(0); });

        expect(mockSetWorkspaces).toHaveBeenLastCalledWith(FRESH);
    });

    it('Retry re-runs the load', async () => {
        vi.mocked(loadUserWorkspaces).mockReturnValueOnce(never()).mockResolvedValueOnce(FRESH);
        renderHook(() => useWorkspaceLoading());
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_TIMEOUT_MS); });

        const action = vi.mocked(toastWithAction).mock.calls[0]?.[2];
        await act(async () => { action?.onClick(); await vi.advanceTimersByTimeAsync(0); });

        expect(loadUserWorkspaces).toHaveBeenCalledTimes(2);
        expect(mockSetWorkspaces).toHaveBeenLastCalledWith(FRESH);
    });

    it('ignores results that arrive after unmount', async () => {
        let resolveLoad: (ws: Workspace[]) => void = () => undefined;
        vi.mocked(loadUserWorkspaces).mockReturnValue(new Promise((r) => { resolveLoad = r; }));
        const { unmount } = renderHook(() => useWorkspaceLoading());
        unmount();

        await act(async () => { resolveLoad(FRESH); await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_TIMEOUT_MS); });

        expect(mockSetWorkspaces).not.toHaveBeenCalled();
        expect(toastWithAction).not.toHaveBeenCalled();
    });
});
